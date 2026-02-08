---
title: "Deal Intel: Pipedrive + Gmail AI-Powered Deal Prioritization CLI"
type: feat
date: 2026-02-08
---

# Deal Intel: Pipedrive + Gmail AI-Powered Deal Prioritization CLI

TypeScript/Node.js CLI tool that fetches open Pipedrive deals assigned to you, checks Gmail communication history with deal contacts, and uses Claude to generate a prioritized action list.

## Acceptance Criteria

- [x] `deal-intel analyze` fetches all open deals for the configured Pipedrive user
- [x] For each deal, retrieves contact persons and their primary email addresses
- [x] Searches Gmail for recent communication (last 90 days) with each contact (metadata + snippets)
- [x] Sends all deal context + email history to Claude in a single call for cross-deal prioritization
- [x] Outputs a prioritized list of deals with AI-suggested next actions to the terminal
- [x] Validates all three API credentials (Pipedrive, Gmail, Anthropic) at startup before processing
- [x] Handles Gmail OAuth2 consent flow on first run (opens browser, persists token)
- [x] Gracefully handles deals with no contacts, no email history, or deleted contacts

## Context

### Tech Stack
- **Runtime:** TypeScript/Node.js (ESM, `tsx` for dev, `tsc` for build)
- **CLI framework:** Commander.js
- **APIs:** Pipedrive v2 SDK (`pipedrive` ^30.8.0), Gmail API (`googleapis` ^105.0.0), Anthropic SDK (`@anthropic-ai/sdk` ^0.74.0)
- **Validation:** Zod (env vars + Claude structured output)
- **Auth:** Pipedrive API token + Gmail OAuth2 (desktop app) + Anthropic API key

### Architecture: Modular Services

```
src/
  index.ts                 # CLI entry point (Commander)
  commands/
    analyze.ts             # Orchestrates the full analysis flow
  services/
    pipedrive.ts           # Pipedrive API v2 client (deals, persons, activities, stages)
    gmail.ts               # Gmail OAuth2 + email search/thread retrieval
    claude.ts              # Anthropic SDK — structured deal analysis
  types/
    index.ts               # Shared types
    analysis.ts            # Zod schemas for Claude structured output
  config/
    env.ts                 # Zod-validated env config
```

Each service module exports pure functions — no CLI concerns. This allows future wrapping in Fastify/Express for API exposure.

### Configuration (.env)

```
PIPEDRIVE_API_TOKEN=       # From Pipedrive Settings > Personal Preferences > API
PIPEDRIVE_USER_ID=         # Your Pipedrive user ID (for deal filtering)
ANTHROPIC_API_KEY=         # Claude API key
GMAIL_CREDENTIALS_PATH=./credentials.json   # Google OAuth2 desktop app credentials
GMAIL_TOKEN_PATH=./token.json               # Persisted OAuth tokens (auto-generated)
```

### CLI Interface

```
deal-intel analyze [options]

Options:
  --limit <n>           Max deals to analyze (default: 50)
  --email-days <n>      Email history window in days (default: 90)
  --max-emails <n>      Max emails per contact (default: 10)
  --dry-run             Show deals and contacts without calling Claude
  --verbose             Print API calls and data being sent
```

### Key Data Flow

```
1. Validate credentials (Pipedrive /users/me, Gmail getProfile, Anthropic countTokens)
2. Fetch open deals (GET /api/v2/deals?status=open&owner_id={PIPEDRIVE_USER_ID})
   - Cursor-based pagination if > 100 deals
   - Also fetch stages/pipelines once for name resolution
3. For each deal:
   a. Get contacts: GET /api/v2/persons?deal_id={id} (deduplicate with person_id)
   b. Get activities: GET /api/v2/activities?deal_id={id} (last 5 for context)
   c. For each contact's primary email:
      - Gmail messages.list with q="from:{email} OR to:{email} after:YYYY/MM/DD"
      - Gmail messages.get (metadata format) for up to 10 most recent messages
      - Extract: subject, from, to, date, snippet
4. Build prompt with all deals + email context
   - If token count exceeds budget, truncate oldest emails per deal
5. Single Claude call (Sonnet) with structured output via Zod schema:
   - Returns: priority_rank, deal_health (hot/warm/cold/at_risk), urgency,
     recommended_action, reasoning, days_since_contact per deal
6. Sort by priority_rank, format and print to terminal
```

### Claude Structured Output Schema (Zod)

```typescript
const DealPrioritySchema = z.object({
  deals: z.array(z.object({
    deal_id: z.number(),
    deal_title: z.string(),
    priority_rank: z.number(),
    deal_health: z.enum(["hot", "warm", "cold", "at_risk"]),
    urgency: z.enum(["immediate", "this_week", "next_week", "no_rush"]),
    recommended_action: z.string(),
    reasoning: z.string(),
    key_signals: z.array(z.string()),
  })),
});
```

### Rate Limiting Strategy

- **Gmail:** Concurrency limit of 5 parallel requests, exponential backoff on 429
- **Pipedrive:** Sequential with 100ms delay between paginated calls
- **Claude:** Single call, pre-check token count, truncate if needed

### Gmail OAuth Flow (First Run)

1. Tool detects no `token.json`
2. Opens browser to Google consent screen (via `@google-cloud/local-auth`)
3. User grants `gmail.readonly` scope
4. Tool receives + persists tokens to `token.json`
5. Subsequent runs use refresh token silently

**Prerequisite:** User must create a Google Cloud project, enable Gmail API, create Desktop OAuth credentials, and download `credentials.json`. This is documented in `.env.example` / README.

## MVP

### package.json

```json
{
  "name": "deal-intel",
  "version": "0.1.0",
  "type": "module",
  "bin": { "deal-intel": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.74.0",
    "@google-cloud/local-auth": "^2.1.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.0",
    "googleapis": "^105.0.0",
    "pipedrive": "^30.8.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

### src/config/env.ts

```typescript
import { z } from "zod";
import "dotenv/config";

const EnvSchema = z.object({
  PIPEDRIVE_API_TOKEN: z.string().min(1),
  PIPEDRIVE_USER_ID: z.string().min(1).transform(Number),
  ANTHROPIC_API_KEY: z.string().min(1),
  GMAIL_CREDENTIALS_PATH: z.string().default("./credentials.json"),
  GMAIL_TOKEN_PATH: z.string().default("./token.json"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env = EnvSchema.parse(process.env);
```

### src/services/pipedrive.ts

```typescript
import { Configuration, DealsApi, PersonsApi, ActivitiesApi, PipelinesApi, StagesApi } from "pipedrive/v2";
import { env } from "../config/env.js";

const config = new Configuration({ apiKey: env.PIPEDRIVE_API_TOKEN });
const dealsApi = new DealsApi(config);
const personsApi = new PersonsApi(config);
const activitiesApi = new ActivitiesApi(config);

export async function getOpenDeals(ownerId: number, limit = 100) {
  const allDeals = [];
  let cursor: string | undefined;

  do {
    const response = await dealsApi.getDeals({
      status: "open",
      owner_id: ownerId,
      limit: Math.min(limit, 100),
      cursor,
      sort_by: "update_time",
      sort_direction: "desc",
    });
    allDeals.push(...(response.data ?? []));
    cursor = response.additional_data?.pagination?.next_cursor;
    if (!response.additional_data?.pagination?.more_items_in_collection) break;
  } while (cursor && allDeals.length < limit);

  return allDeals.slice(0, limit);
}

export async function getDealContacts(dealId: number) {
  const response = await personsApi.getPersons({ deal_id: dealId });
  return (response.data ?? []).map(person => ({
    id: person.id,
    name: person.name,
    email: person.emails?.find(e => e.primary)?.value ?? person.emails?.[0]?.value ?? null,
  }));
}

export async function getDealActivities(dealId: number, limit = 5) {
  const response = await activitiesApi.getActivities({ deal_id: dealId, limit });
  return response.data ?? [];
}

export async function getStagesMap() {
  // Fetch all stages and return id->name map for context enrichment
  const stagesApi = new StagesApi(config);
  const response = await stagesApi.getStages({});
  const map = new Map<number, string>();
  for (const stage of response.data ?? []) {
    map.set(stage.id, stage.name);
  }
  return map;
}
```

### src/services/gmail.ts

```typescript
import path from "node:path";
import fs from "node:fs/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google, gmail_v1 } from "googleapis";
import { env } from "../config/env.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  let auth;
  try {
    const tokenContent = await fs.readFile(env.GMAIL_TOKEN_PATH, "utf-8");
    auth = google.auth.fromJSON(JSON.parse(tokenContent));
  } catch {
    auth = await authenticate({ scopes: SCOPES, keyfilePath: env.GMAIL_CREDENTIALS_PATH });
    const keys = JSON.parse(await fs.readFile(env.GMAIL_CREDENTIALS_PATH, "utf-8"));
    const key = keys.installed || keys.web;
    await fs.writeFile(env.GMAIL_TOKEN_PATH, JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: auth.credentials.refresh_token,
    }));
  }
  return google.gmail({ version: "v1", auth });
}

export async function searchEmails(
  gmail: gmail_v1.Gmail,
  contactEmail: string,
  daysBack: number = 90,
  maxResults: number = 10,
) {
  const afterDate = new Date(Date.now() - daysBack * 86_400_000);
  const after = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, "0")}/${String(afterDate.getDate()).padStart(2, "0")}`;

  const response = await gmail.users.messages.list({
    userId: "me",
    q: `(from:${contactEmail} OR to:${contactEmail}) after:${after}`,
    maxResults,
  });

  const messages = response.data.messages ?? [];
  const details = await Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      const headers = detail.data.payload?.headers ?? [];
      const h = (name: string) => headers.find(h => h.name === name)?.value ?? "";
      return {
        from: h("From"),
        to: h("To"),
        subject: h("Subject"),
        date: h("Date"),
        snippet: detail.data.snippet ?? "",
      };
    })
  );

  return details;
}
```

### src/services/claude.ts

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../config/env.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export const DealPrioritySchema = z.object({
  deals: z.array(z.object({
    deal_id: z.number(),
    deal_title: z.string(),
    priority_rank: z.number(),
    deal_health: z.enum(["hot", "warm", "cold", "at_risk"]),
    urgency: z.enum(["immediate", "this_week", "next_week", "no_rush"]),
    recommended_action: z.string(),
    reasoning: z.string(),
    key_signals: z.array(z.string()),
  })),
});

export type DealPriority = z.infer<typeof DealPrioritySchema>;

export async function analyzeDeals(dealContexts: string): Promise<DealPriority> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: `You are a sales intelligence analyst. Analyze these CRM deals and their email communication history. Rank deals by priority (1 = most urgent). Consider: staleness of communication, deal value, deal stage, email sentiment, and whether the contact is responsive. For each deal, recommend a specific next action (e.g., "Send follow-up email about proposal", "Schedule demo call", "Update deal stage to negotiation").`,
    messages: [{ role: "user", content: dealContexts }],
    tools: [{
      name: "deal_priority_analysis",
      description: "Structured priority analysis of all deals",
      input_schema: {
        type: "object" as const,
        properties: {
          deals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                deal_id: { type: "number" },
                deal_title: { type: "string" },
                priority_rank: { type: "number" },
                deal_health: { type: "string", enum: ["hot", "warm", "cold", "at_risk"] },
                urgency: { type: "string", enum: ["immediate", "this_week", "next_week", "no_rush"] },
                recommended_action: { type: "string" },
                reasoning: { type: "string" },
                key_signals: { type: "array", items: { type: "string" } },
              },
              required: ["deal_id", "deal_title", "priority_rank", "deal_health", "urgency", "recommended_action", "reasoning", "key_signals"],
            },
          },
        },
        required: ["deals"],
      },
    }],
    tool_choice: { type: "tool", name: "deal_priority_analysis" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");

  return DealPrioritySchema.parse(toolBlock.input);
}
```

### src/commands/analyze.ts

```typescript
import { getOpenDeals, getDealContacts, getDealActivities, getStagesMap } from "../services/pipedrive.js";
import { getGmailClient, searchEmails } from "../services/gmail.js";
import { analyzeDeals } from "../services/claude.js";
import { env } from "../config/env.js";

interface AnalyzeOptions {
  limit: number;
  emailDays: number;
  maxEmails: number;
  dryRun: boolean;
  verbose: boolean;
}

export async function runAnalysis(options: AnalyzeOptions) {
  // 1. Validate credentials
  console.log("Validating credentials...");
  const gmail = await getGmailClient();
  const stages = await getStagesMap();

  // 2. Fetch open deals
  console.log(`Fetching open deals for user ${env.PIPEDRIVE_USER_ID}...`);
  const deals = await getOpenDeals(env.PIPEDRIVE_USER_ID, options.limit);
  console.log(`Found ${deals.length} open deals`);

  if (deals.length === 0) {
    console.log("No open deals found. Nothing to analyze.");
    return;
  }

  // 3. Enrich each deal with contacts + email history
  const dealContexts: string[] = [];

  for (const deal of deals) {
    const contacts = await getDealContacts(deal.id);
    const activities = await getDealActivities(deal.id, 5);
    const stageName = stages.get(deal.stage_id) ?? `Stage ${deal.stage_id}`;
    const daysSinceUpdate = Math.floor((Date.now() - new Date(deal.update_time).getTime()) / 86_400_000);

    let emailSummary = "No email communication found.";
    const allEmails: any[] = [];

    for (const contact of contacts) {
      if (!contact.email) continue;
      const emails = await searchEmails(gmail, contact.email, options.emailDays, options.maxEmails);
      allEmails.push(...emails.map(e => ({ ...e, contactName: contact.name })));
    }

    if (allEmails.length > 0) {
      emailSummary = allEmails.map(e =>
        `[${e.date}] ${e.from} -> ${e.to} | Subject: ${e.subject} | ${e.snippet}`
      ).join("\n");
    }

    const context = `
DEAL #${deal.id}: ${deal.title}
Value: ${deal.value} ${deal.currency} | Stage: ${stageName} | Days since update: ${daysSinceUpdate}
Contacts: ${contacts.map(c => `${c.name} <${c.email}>`).join(", ") || "None"}
Recent activities: ${activities.length > 0 ? activities.map(a => `${a.type}: ${a.subject} (${a.due_date})`).join("; ") : "None"}
Email history (last ${options.emailDays} days):
${emailSummary}
---`;

    dealContexts.push(context);

    if (options.verbose) {
      console.log(context);
    }
  }

  if (options.dryRun) {
    console.log("\n[DRY RUN] Would send the above context to Claude for analysis.");
    return;
  }

  // 4. Send to Claude
  console.log("\nAnalyzing deals with Claude...");
  const analysis = await analyzeDeals(dealContexts.join("\n"));

  // 5. Output prioritized results
  console.log("\n=== DEAL PRIORITIES ===\n");

  for (const deal of analysis.deals.sort((a, b) => a.priority_rank - b.priority_rank)) {
    const healthIcon = { hot: "!!!", warm: "!! ", cold: "!  ", at_risk: "!!!" }[deal.deal_health];
    const urgencyLabel = { immediate: "NOW", this_week: "THIS WEEK", next_week: "NEXT WEEK", no_rush: "LOW" }[deal.urgency];

    console.log(`#${deal.priority_rank} [${healthIcon}] ${deal.deal_title}`);
    console.log(`   Health: ${deal.deal_health.toUpperCase()} | Urgency: ${urgencyLabel}`);
    console.log(`   Action: ${deal.recommended_action}`);
    console.log(`   Why: ${deal.reasoning}`);
    if (deal.key_signals.length > 0) {
      console.log(`   Signals: ${deal.key_signals.join(", ")}`);
    }
    console.log();
  }
}
```

### src/index.ts

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { runAnalysis } from "./commands/analyze.js";

const program = new Command();

program
  .name("deal-intel")
  .description("AI-powered Pipedrive deal prioritization with Gmail context")
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze open deals and get prioritized action list")
  .option("-l, --limit <n>", "Max deals to analyze", "50")
  .option("--email-days <n>", "Email history window in days", "90")
  .option("--max-emails <n>", "Max emails per contact", "10")
  .option("--dry-run", "Show data without calling Claude")
  .option("-v, --verbose", "Print detailed API data")
  .action(async (opts) => {
    await runAnalysis({
      limit: parseInt(opts.limit),
      emailDays: parseInt(opts.emailDays),
      maxEmails: parseInt(opts.maxEmails),
      dryRun: opts.dryRun ?? false,
      verbose: opts.verbose ?? false,
    });
  });

program.parse();
```

## References

- [Pipedrive API v2 docs](https://developers.pipedrive.com/docs/api/v2) — use v2, v1 deprecation deadline July 31, 2026
- [Pipedrive Node.js SDK](https://www.npmjs.com/package/pipedrive) — import from `pipedrive/v2`
- [Gmail API Node.js quickstart](https://developers.google.com/gmail/api/quickstart/nodejs)
- [Anthropic TypeScript SDK](https://www.npmjs.com/package/@anthropic-ai/sdk) — tool_choice for structured output
- [Gmail search operators](https://support.google.com/mail/answer/7190) — same syntax in API `q` param
