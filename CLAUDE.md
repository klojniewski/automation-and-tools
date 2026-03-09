# Project: Marketing Automations

Trigger.dev automation project + local CLI for marketing scorecard, deal intelligence, Gmail, and Pipedrive integrations.
Deployed on Trigger.dev (prod env).

## Architecture

### Stack
- Runtime: Trigger.dev v4 (task scheduler) + local CLI (Commander)
- Language: TypeScript
- APIs: Google Analytics (GA4), Google Sheets, YouTube Analytics, Pipedrive, Gmail, Anthropic (Claude)
- Config: `trigger.config.ts`, env vars via `src/lib/env.ts` (zod validated)

### Running Locally (CLI)

All tasks can be run locally via the Commander CLI:

```bash
npx tsx src/index.ts <command>
```

**Deal intelligence:**
- `analyze` — AI-powered deal prioritization with Gmail context
  - Options: `--limit <n>`, `--top <n>` (default 20), `--email-days <n>`, `--max-emails <n>`, `-p <pipeline>`, `--exclude-stages <stages...>`
  - Excludes "Lead In" stage by default
- `deal <id>` — analyze a single deal by Pipedrive deal ID
  - Options: `--email-days <n>`, `--max-emails <n>`
  - Output includes: pipeline stage → next stage, draft follow-up email with send date, Gmail links in deal history

**Marketing scorecard:**
- `marketing getga4stats` — fetch weekly GA4 metrics
- `marketing getpipedrivedeals` — fetch weekly Pipedrive deals count
- `marketing getyoutubestats` — fetch weekly YouTube views
- `marketing updateScorecard` — full scorecard update (all sources → Sheet)
- All marketing commands support `--week <YYWW>` and `--dry-run`

### Trigger.dev Tasks

All task definitions live in `src/trigger/`:

| Task ID | File | Machine | Schedule |
|---------|------|---------|----------|
| `update-scorecard` | `update-scorecard.ts` | micro, 120s | weekly |
| `analyze-deals` | `analyze-deals.ts` | small-1x, 300s | on-demand |
| `get-pipedrive-deals` | `get-pipedrive-deals.ts` | micro, 120s | on-demand |
| `get-ga4-stats` | `get-ga4-stats.ts` | micro | on-demand |
| `get-youtube-stats` | `get-youtube-stats.ts` | micro | on-demand |

On-demand tasks can be triggered from the Trigger.dev dashboard or run locally via CLI.

### Directory Structure
- `src/index.ts` — CLI entrypoint (Commander)
- `src/trigger/` — Trigger.dev task definitions
- `src/lib/` — shared business logic (auth, API wrappers, config)
- `scripts/` — utility scripts (see Scripts section)

### Key Files
- `src/index.ts` — CLI entrypoint (Commander)
- `src/trigger/update-scorecard.ts` — weekly scorecard task
- `src/trigger/analyze-deals.ts` — deal analysis task
- `src/trigger/get-pipedrive-deals.ts` — Pipedrive deals task
- `src/lib/scorecard.ts` — orchestration (GA4 + Pipedrive + YouTube → Sheets)
- `src/lib/deal-analysis.ts` — deal enrichment, pipeline stages, conversation status detection
- `src/lib/pipedrive.ts` / `src/lib/pipedrive-stats.ts` — Pipedrive API wrappers
- `src/lib/google-auth.ts` — all Google auth clients
- `src/lib/marketing-config.ts` — column mappings

## Scripts (`scripts/`)

Utility scripts for managing YouTube OAuth tokens and debugging API access.
Run with `npx tsx scripts/<name>.ts` (requires `.env` with Google credentials).

- **`refresh-youtube-token.ts`** — Generates a new YouTube OAuth2 refresh token.
  Opens a browser for Google consent, then prints the new token to update in `.env`
  and Trigger.dev prod env vars. Needed when the token expires or is invalidated.
  Important: must authenticate as the Pagepro brand account during consent.
- **`check-youtube-channel.ts`** — Queries YouTube Analytics API for monthly views
  and totals. Useful for verifying the token works and the correct channel is linked.
- **`test-youtube.ts`** — Tests the `fetchYouTubeViews` wrapper for a specific week.
  Shows both raw API response and wrapper output. Good for debugging scorecard data.
- **`debug-deal.ts`** — Dumps all raw source data and Claude output for a deal.
  Usage: `npx tsx scripts/debug-deal.ts <dealId> [emailDays] [maxEmails]`.
  Creates `debug/<dealId>/` with .md files: raw deal, contacts, activities, emails,
  enriched context, Claude prompt, and Claude output. Used for accuracy reviews.

## Google Auth

### Google Cloud Project
- Project name: NNNPROJECT
- OAuth consent screen: **In production** (External user type)
- Client ID: `985381090989-t2ku79cg9rkoj51sgq9rcpjg6ufgj3fk.apps.googleusercontent.com`

### Auth Methods

**Service Account (GA4 + Sheets)**
- Env var: `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON or base64)
- Scopes: `analytics.readonly`, `spreadsheets`
- No token expiration issues — JWT-based

**YouTube Analytics OAuth2**
- Env var: `GOOGLE_YOUTUBE_REFRESH_TOKEN`
- Scope: `yt-analytics.readonly`
- Uses OAuth2 refresh token (requires user consent)
- **Must authenticate as Pagepro brand account** (not personal Google account) — otherwise returns 0 views
- Token refresh script: `scripts/refresh-youtube-token.ts` (run with `npx tsx`)
- Script uses manual code paste flow (redirect URI is `http://localhost` on port 80)

**Gmail OAuth2**
- Env var: `GOOGLE_GMAIL_REFRESH_TOKEN`
- Uses same OAuth2 client as YouTube (different refresh token)

### Known Gotchas
- YouTube token expired with `invalid_grant` — root cause: token was generated while consent screen was in Testing mode (7-day expiry). Fix: move consent screen to Production, then re-generate token.
- YouTube token returning 0 views — root cause: authenticated as personal account instead of Pagepro brand account. Fix: re-run OAuth flow and switch to brand account during consent.

### Env Vars (all set in Trigger.dev prod + local .env)
- `GOOGLE_SERVICE_ACCOUNT_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_GMAIL_REFRESH_TOKEN`
- `GOOGLE_YOUTUBE_REFRESH_TOKEN`
- `GA4_PROPERTY_ID`
- `GOOGLE_SHEETS_ID`
- `GOOGLE_SHEETS_TAB`
