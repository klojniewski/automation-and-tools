---
title: "feat: Deploy to Trigger.dev for N8N-triggered automations"
type: feat
date: 2026-02-11
---

# Deploy to Trigger.dev for N8N-triggered Automations

## Overview

Migrate the existing CLI-based automation tool (`deal-intel`) to **Trigger.dev v4** so that all commands become HTTP-triggerable tasks that N8N can invoke on schedule. Each task writes to Google Sheets (side-effect) and returns structured JSON that N8N can use in downstream workflow steps.

**Three automation flows:**

| Flow | Trigger | Schedule | What it does |
|------|---------|----------|-------------|
| Weekly Scorecard | N8N cron | Monday morning | GA4 metrics + Pipedrive deals -> Google Sheet + JSON |
| Weekly Marketing Stats | N8N cron | Monday morning | GA4 metrics only -> Google Sheet + JSON |
| Daily Deal Follow-ups | N8N cron | Every morning | Pipedrive deals + Gmail + Claude AI analysis -> JSON |

## Problem Statement / Motivation

The project currently runs as a local CLI tool (`tsx src/index.ts marketing updateScorecard`). This means:

1. **Manual execution** — someone must run it from their laptop
2. **No scheduling** — N8N cannot trigger it
3. **No JSON output** — results go to `console.log`, not a structured response
4. **Browser-dependent auth** — Google OAuth2 uses `@google-cloud/local-auth` which opens a browser; won't work in a server environment
5. **`process.exit(1)` on errors** — kills the process instead of returning error info

## Proposed Solution

Deploy to **Trigger.dev v4** (TypeScript-native task runner with REST API). Trigger.dev was chosen over alternatives because:

- **No web server needed** — tasks deploy as standalone units (unlike Inngest which requires an existing Express/Next.js server)
- **First-class cron support** — `schedules.task()` with timezone awareness
- **REST API for N8N** — `POST /api/v1/tasks/{taskId}/trigger` returns a run ID; N8N can optionally poll for results
- **No execution timeouts** — GA4 batch reports can be slow; no Lambda-style 10s timeout
- **Free tier covers this** — micro machine at ~$0.001/minute, a few runs per week = $0/month

### Architecture After Migration

```
N8N (scheduler/orchestrator)
  │
  ├── POST /api/v1/tasks/update-scorecard/trigger    (weekly, Monday)
  ├── POST /api/v1/tasks/analyze-deals/trigger        (daily, morning)
  └── POST /api/v1/tasks/get-ga4-stats/trigger        (on-demand)
        │
        ▼
  Trigger.dev Cloud (runs tasks)
        │
        ├── Google Sheets API (write metrics)
        ├── GA4 API (read analytics)
        ├── Pipedrive API (read deals)
        ├── Gmail API (read emails)
        └── Claude API (analyze deals)
        │
        ▼
  Returns JSON → N8N uses in further automations
```

## Technical Approach

### Phase 1: Refactor Business Logic to Return JSON

**Goal:** Decouple business logic from CLI concerns (console.log, process.exit, Commander.js).

Currently, each command function (e.g., `runUpdateScorecard`) prints to console and calls `process.exit`. We need them to return structured data instead.

#### 1a. Create pure business logic functions in `src/lib/`

Move and refactor existing service files:

| Current path | New path | Change |
|---|---|---|
| `src/services/google-auth.ts` | `src/lib/google-auth.ts` | Replace OAuth2 browser flow with service account |
| `src/services/ga4.ts` | `src/lib/ga4.ts` | No changes needed (already returns typed data) |
| `src/services/sheets.ts` | `src/lib/sheets.ts` | Update to use new auth |
| `src/services/pipedrive.ts` | `src/lib/pipedrive.ts` | No changes needed |
| `src/services/gmail.ts` | `src/lib/gmail.ts` | Update auth (see Gmail section below) |
| `src/services/claude.ts` | `src/lib/claude.ts` | No changes needed |
| `src/config/marketing.ts` | `src/lib/marketing-config.ts` | No changes needed |
| `src/config/env.ts` | `src/lib/env.ts` | Remove `process.exit`, throw instead |
| `src/utils/week.ts` | `src/lib/week.ts` | No changes needed |

#### 1b. Replace Google Auth with Service Account

**Current** (`src/services/google-auth.ts`):
```typescript
// PROBLEM: opens browser for OAuth consent
import { authenticate } from "@google-cloud/local-auth";
_authClient = await authenticate({ scopes: SCOPES, keyfilePath: env.GMAIL_CREDENTIALS_PATH });
```

**New** (`src/lib/google-auth.ts`):
```typescript
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.readonly",
];

let _auth: ReturnType<typeof google.auth.GoogleAuth> | null = null;

export function getGoogleAuth() {
  if (_auth) return _auth;

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");

  let credentials: any;
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8"));
  }

  _auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  return _auth;
}
```

**Google Cloud setup required:**
- [ ] Create a service account in Google Cloud Console
- [ ] Download JSON key
- [ ] Share the Google Sheet with the service account email (Editor)
- [ ] Add service account email to GA4 property as Viewer
- [ ] Base64-encode the JSON key: `base64 -i service-account-key.json | tr -d '\n'`
- [ ] Store as `GOOGLE_SERVICE_ACCOUNT_KEY` env var in Trigger.dev

#### 1c. Handle Gmail Auth

Gmail is special: service accounts cannot access personal Gmail unless Google Workspace domain-wide delegation is configured.

**Two options:**

**Option A (Recommended): Store OAuth2 refresh token as env var**

The existing `token.json` already has a refresh token. Extract it and store as `GOOGLE_GMAIL_REFRESH_TOKEN`. Reconstruct the OAuth2 client from env vars:

```typescript
export function getGmailAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    refresh_token: process.env.GOOGLE_GMAIL_REFRESH_TOKEN,
  });
  return oauth2;
}
```

New env vars needed: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_GMAIL_REFRESH_TOKEN`.

**Option B: Domain-wide delegation** (only if using Google Workspace). More complex setup, skip unless needed.

#### 1d. Refactor command functions to return JSON

**Current pattern** (e.g., `src/commands/marketing/updatescorecard.ts`):
```typescript
export async function runUpdateScorecard(options: UpdateScorecardOptions): Promise<void> {
  // ... business logic ...
  console.log(`Scorecard updated for ${label}.`);
  // returns nothing
}
```

**New pattern** (`src/lib/scorecard.ts`):
```typescript
export interface ScorecardResult {
  weekLabel: string;
  row: number | null;
  written: boolean;
  ga4: GA4Metrics;
  deals: { total: number; mql: number; sql: number };
  channels: Record<string, { all: number; mql: number; sql: number }>;
}

export async function updateScorecard(options: {
  week?: string;
  pipeline?: number;
  dryRun?: boolean;
}): Promise<ScorecardResult> {
  const pipelineId = options.pipeline ?? 22;
  const { weekNum, startDate, endDate } = resolveWeek(options.week);

  const [metrics, deals] = await Promise.all([
    fetchGA4Metrics(startDate, endDate),
    fetchDealsInRange(pipelineId, startDate, endDate, [MQL_FIELD_KEY, SQL_FIELD_KEY]),
  ]);

  const { channels, totalMql, totalSql } = aggregateDeals(deals);
  const label = weekLabel(weekNum);

  if (!options.dryRun) {
    const rowNum = await findRowByWeek(label);
    if (!rowNum) throw new Error(`Row for ${label} not found`);
    await updateMappedCells(rowNum, allData, SCORECARD_COLUMN_MAP);
    return { weekLabel: label, row: rowNum, written: true, ga4: metrics, deals: { total: deals.length, mql: totalMql, sql: totalSql }, channels };
  }

  return { weekLabel: label, row: null, written: false, ga4: metrics, deals: { total: deals.length, mql: totalMql, sql: totalSql }, channels };
}
```

Same pattern for `getGA4Stats`, `getPipedriveDeals`, and `analyze`.

#### 1e. Update env.ts — throw instead of process.exit

```typescript
// src/lib/env.ts
export function getEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Missing env vars: ${result.error.issues.map(i => i.path.join(".")).join(", ")}`);
  }
  return result.data;
}
```

### Phase 2: Add Trigger.dev Task Definitions

#### 2a. Install dependencies

```bash
npm install @trigger.dev/sdk
npm install -D @trigger.dev/build
```

Remove `@google-cloud/local-auth` (no longer needed):
```bash
npm uninstall @google-cloud/local-auth
```

#### 2b. Create `trigger.config.ts`

```typescript
// trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "<your-project-ref>",  // from Trigger.dev dashboard
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 300,
  logLevel: "info",
  build: {
    external: ["googleapis"],  // large package, don't bundle
  },
});
```

#### 2c. Create task files

**`src/trigger/update-scorecard.ts`** — Weekly scorecard (GA4 + Pipedrive -> Sheet + JSON):

```typescript
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { updateScorecard } from "../lib/scorecard";

export const updateScorecardTask = schemaTask({
  id: "update-scorecard",
  schema: z.object({
    week: z.string().optional(),
    pipeline: z.number().default(22),
    dryRun: z.boolean().default(false),
  }),
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return await updateScorecard(payload);
  },
});
```

**`src/trigger/get-ga4-stats.ts`** — GA4 metrics only:

```typescript
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { getGA4Stats } from "../lib/ga4-stats";

export const getGA4StatsTask = schemaTask({
  id: "get-ga4-stats",
  schema: z.object({
    week: z.string().optional(),
    dryRun: z.boolean().default(false),
  }),
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return await getGA4Stats(payload);
  },
});
```

**`src/trigger/analyze-deals.ts`** — Daily deal analysis (Pipedrive + Gmail + Claude):

```typescript
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { analyzeDealPipeline } from "../lib/deal-analysis";

export const analyzeDealsTask = schemaTask({
  id: "analyze-deals",
  schema: z.object({
    limit: z.number().default(50),
    emailDays: z.number().default(90),
    maxEmails: z.number().default(10),
  }),
  machine: "small-1x",  // needs more memory for Claude responses
  maxDuration: 300,      // Claude analysis can be slow
  retry: { maxAttempts: 1 },  // don't retry Claude calls (expensive)
  run: async (payload) => {
    return await analyzeDealPipeline(payload);
  },
});
```

**`src/trigger/get-pipedrive-deals.ts`** — Pipedrive deals only:

```typescript
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { getPipedriveDeals } from "../lib/pipedrive-stats";

export const getPipedriveDealsTask = schemaTask({
  id: "get-pipedrive-deals",
  schema: z.object({
    week: z.string().optional(),
    pipeline: z.number().default(22),
    dryRun: z.boolean().default(false),
  }),
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return await getPipedriveDeals(payload);
  },
});
```

### Phase 3: Keep CLI Working (Optional but Recommended)

Keep `src/index.ts` as a thin CLI wrapper that calls the same `src/lib/` functions. This lets you still run commands locally for debugging:

```typescript
// src/index.ts stays as CLI entry point
// But now imports from src/lib/ instead of src/commands/
// Uses console.log to pretty-print the JSON results
```

### Phase 4: N8N Integration

#### N8N Webhook Configuration

Each task is triggered via Trigger.dev's REST API:

**Endpoint:** `POST https://api.trigger.dev/api/v1/tasks/{taskId}/trigger`

**Headers:**
```
Authorization: Bearer tr_prod_YOUR_SECRET_KEY
Content-Type: application/json
```

#### Weekly Scorecard (N8N Workflow)

```
[Schedule Trigger: Monday 9:00 AM]
  → [HTTP Request: POST update-scorecard]
     Body: { "payload": { "pipeline": 22 } }
     Options: { "idempotencyKey": "scorecard-{{$now.format('YYYY')}}-W{{$now.isoWeek()}}" }
  → [Wait: 30s]
  → [HTTP Request: GET /api/v3/runs/{runId}]
  → [IF status == "COMPLETED"]
     → [Use output JSON in further N8N nodes]
```

#### Daily Deal Analysis (N8N Workflow)

```
[Schedule Trigger: Daily 8:00 AM]
  → [HTTP Request: POST analyze-deals]
     Body: { "payload": { "limit": 50, "emailDays": 90 } }
  → [Wait: 60s]
  → [HTTP Request: GET /api/v3/runs/{runId}]
  → [IF status == "COMPLETED"]
     → [Parse JSON output.deals]
     → [Filter: urgency == "immediate"]
     → [Slack/Email notification with deal priorities]
```

#### Alternative: Callback Pattern

Instead of polling, pass an N8N webhook URL in the payload:

```json
{
  "payload": {
    "pipeline": 22,
    "callbackUrl": "https://your-n8n.example.com/webhook/scorecard-result"
  }
}
```

The task POSTs results to `callbackUrl` when done. This avoids polling but requires adding HTTP callback logic to your tasks.

### Phase 5: Deploy

```bash
# 1. Sign up at trigger.dev, create a project
# 2. Run init to get project ref
npx trigger.dev@latest init

# 3. Set env vars in Trigger.dev dashboard:
#    GOOGLE_SERVICE_ACCOUNT_KEY, GA4_PROPERTY_ID, GOOGLE_SHEETS_ID,
#    GOOGLE_SHEETS_TAB, PIPEDRIVE_API_TOKEN, PIPEDRIVE_USER_ID,
#    PIPEDRIVE_DOMAIN, ANTHROPIC_API_KEY,
#    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GMAIL_REFRESH_TOKEN

# 4. Test locally
npx trigger.dev@latest dev

# 5. Deploy
npx trigger.dev@latest deploy
```

## File Changes Summary

### New files

| File | Purpose |
|------|---------|
| `trigger.config.ts` | Trigger.dev project configuration |
| `src/trigger/update-scorecard.ts` | Task: weekly scorecard |
| `src/trigger/get-ga4-stats.ts` | Task: GA4 stats |
| `src/trigger/get-pipedrive-deals.ts` | Task: Pipedrive deals |
| `src/trigger/analyze-deals.ts` | Task: daily deal analysis |
| `src/lib/google-auth.ts` | Service account auth (replaces OAuth2 browser flow) |
| `src/lib/scorecard.ts` | Business logic: scorecard update (returns JSON) |
| `src/lib/ga4-stats.ts` | Business logic: GA4 stats (returns JSON) |
| `src/lib/pipedrive-stats.ts` | Business logic: Pipedrive deals (returns JSON) |
| `src/lib/deal-analysis.ts` | Business logic: deal analysis (returns JSON) |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add `@trigger.dev/sdk`, `@trigger.dev/build`; remove `@google-cloud/local-auth` |
| `src/config/env.ts` | Throw instead of `process.exit`; add Gmail OAuth env vars |
| `src/index.ts` | Update imports to `src/lib/`; wrap returned JSON with console.log |
| `.gitignore` | Add `.trigger/` directory |
| `.env.example` | Add `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_GMAIL_REFRESH_TOKEN` |

### Moved files (refactored)

| From | To |
|------|------|
| `src/services/ga4.ts` | `src/lib/ga4.ts` |
| `src/services/sheets.ts` | `src/lib/sheets.ts` |
| `src/services/pipedrive.ts` | `src/lib/pipedrive.ts` |
| `src/services/gmail.ts` | `src/lib/gmail.ts` |
| `src/services/claude.ts` | `src/lib/claude.ts` |
| `src/config/marketing.ts` | `src/lib/marketing-config.ts` |
| `src/utils/week.ts` | `src/lib/week.ts` |

### Removed files

| File | Reason |
|------|--------|
| `src/services/google-auth.ts` | Replaced by `src/lib/google-auth.ts` (service account) |
| `src/commands/marketing/getga4stats.ts` | Logic moved to `src/lib/ga4-stats.ts` |
| `src/commands/marketing/getpipedrivedeals.ts` | Logic moved to `src/lib/pipedrive-stats.ts` |
| `src/commands/marketing/updatescorecard.ts` | Logic moved to `src/lib/scorecard.ts` |
| `src/commands/analyze.ts` | Logic moved to `src/lib/deal-analysis.ts` |

## Acceptance Criteria

### Functional Requirements

- [ ] All 4 tasks deploy to Trigger.dev and appear in dashboard
- [ ] `update-scorecard` task: fetches GA4 + Pipedrive, writes to Sheet, returns JSON with metrics
- [ ] `get-ga4-stats` task: fetches GA4 metrics, writes to Sheet, returns JSON
- [ ] `get-pipedrive-deals` task: fetches Pipedrive deals, writes to Sheet, returns JSON
- [ ] `analyze-deals` task: fetches deals + emails + Claude analysis, returns prioritized JSON
- [ ] N8N can trigger each task via HTTP Request node and receive JSON output
- [ ] Google Sheets writes work identically to current CLI behavior
- [ ] CLI still works locally for debugging (`tsx src/index.ts marketing updateScorecard`)

### Non-Functional Requirements

- [ ] Each task completes in under 2 minutes (except `analyze-deals` which may take up to 5 minutes)
- [ ] Tasks use `micro` machine by default (0.25 vCPU, cheapest)
- [ ] `analyze-deals` uses `small-1x` (0.5 vCPU) for Claude API response processing
- [ ] Idempotency keys prevent duplicate runs when N8N retries
- [ ] No secrets in task payloads — all credentials via env vars
- [ ] Monthly cost stays within free tier ($5 credit)

## Cost Estimate

| Task | Frequency | Machine | Duration | Cost/run | Monthly |
|------|-----------|---------|----------|----------|---------|
| update-scorecard | Weekly | micro | ~30s | $0.0005 | $0.002 |
| get-ga4-stats | On-demand | micro | ~20s | $0.0003 | ~$0 |
| get-pipedrive-deals | On-demand | micro | ~15s | $0.0003 | ~$0 |
| analyze-deals | Daily | small-1x | ~120s | $0.004 | $0.12 |
| **Total** | | | | | **~$0.13/month** |

Well within the free tier's $5/month credit.

## Dependencies & Prerequisites

- [ ] Trigger.dev account (free tier)
- [ ] Google Cloud service account with GA4 Viewer + Sheets Editor access
- [ ] Gmail OAuth refresh token extracted from existing `token.json`
- [ ] N8N instance with HTTP Request node capability

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gmail refresh token expires | Daily deal analysis breaks | Set token to "offline" access type; monitor for 401 errors; add `onFailure` hook to alert |
| GA4 API rate limiting | Metrics fetch fails | Already using batchRunReports (3 batches vs 13 individual calls); add retry config |
| Trigger.dev cold starts | Slow first run of the day | Use `processKeepAlive` in config; acceptable for weekly/daily tasks |
| Google Sheet structure changes | Writes go to wrong cells | Column mapping in `marketing-config.ts` is already externalized; easy to update |

## References

### Internal References

- Current CLI entry point: `src/index.ts`
- GA4 batch reports: `src/services/ga4.ts:155` (`fetchGA4Metrics`)
- Google OAuth (to replace): `src/services/google-auth.ts:14`
- Scorecard update logic: `src/commands/marketing/updatescorecard.ts:143`
- Deal analysis: `src/commands/analyze.ts:21`
- Week utilities: `src/utils/week.ts`
- Env validation: `src/config/env.ts`
- Marketing config: `src/config/marketing.ts`

### External References

- Trigger.dev v4 docs: https://trigger.dev/docs
- Trigger.dev schemaTask: https://trigger.dev/docs/tasks/schemaTask
- Trigger.dev REST API trigger: https://trigger.dev/docs/management/tasks/trigger
- Trigger.dev environment variables: https://trigger.dev/docs/deploy-environment-variables
- Trigger.dev config file: https://trigger.dev/docs/config/config-file
- Trigger.dev pricing: https://trigger.dev/pricing
- Google service account auth: https://developers.google.com/identity/protocols/oauth2/service-account
- N8N HTTP Request node: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
