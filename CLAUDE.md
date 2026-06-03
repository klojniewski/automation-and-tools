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
- `build-timeline <id>` — build full TIMELINE note for a deal (365 days, 50 emails default)
  - Options: `--email-days <n>`, `--max-emails <n>`
  - Run once per deal to initialize; `analyze`/`deal` append incrementally
  - Writes structured pinned note to Pipedrive: header + key milestones + detailed log
- `followup <idOrUrl>` — interactive: produce a draft follow-up email for a single deal
  - Accepts a numeric deal ID or a full Pipedrive deal URL (e.g. `https://pagepro.pipedrive.com/deal/6905`)
  - Options: `--email-days <n>` (default 90), `--max-emails <n>` (default 10)
  - Flow:
    1. Pulls deal context (Pipedrive deal + contacts + activities + TIMELINE note if present + Gmail thread)
    2. Detects language (English default, Polish if ≥8 total / ≥4 distinct Polish diacritics)
    3. Prints a deal recap (status / stage goal / milestones / suggested approach) — generated in parallel with ideas
    4. Generates 3 distinct follow-up angles (Sonnet) — or `[4] Write my own idea`
    5. Drafts subject + body (Opus) with hard validation: banned-phrase regex auto-retries up to 2x
    6. Iterative feedback loop — type changes / press Enter to accept / `q` to discard
    7. Asks for recipient address (defaults to primary contact)
    8. If a prior Gmail thread with the recipient exists, asks whether to attach the draft to it (default Yes) or save as a standalone new thread
    9. Saves Gmail draft (HTML, with default Gmail signature appended, threaded via threadId + In-Reply-To/References when attaching) and auto-opens it in browser
  - Sales approach baked in: plain B2 English, no corporate-speak, short scannable paragraphs, stage-anchored next step
  - Language- and role-aware: detects sender/recipient name collision (e.g. prospect also named "Chris") and disambiguates
  - Separates "Email history with prospect" (real) from "Internal CRM activities" (private notes) to prevent referencing unsent notes

**Marketing scorecard:**
- `marketing getga4stats` — fetch weekly GA4 metrics
- `marketing getpipedrivedeals` — fetch weekly Pipedrive deals count
- `marketing getyoutubestats` — fetch weekly YouTube views
- `marketing updateScorecard` — full scorecard update (all sources → Sheet)
- All marketing commands support `--week <YYWW>` and `--dry-run`

**Scorecard metric notes:**
- All traffic columns use **GA4 `sessions`** as the metric (Total Traffic, Organic, Direct, Referral, Paid, Blog, AI, BOFU, Not-Paid BOFU, Quality Traffic). Engagement Rate uses GA4's `engagementRate`.
- BOFU page set lives in `src/lib/marketing-config.ts` `BOFU_PAGES` — matched with **CONTAINS** (so query strings, trailing slashes, sub-pages all count). Homepage `/` is added separately via `HOMEPAGE_PATH` (EXACT match) — never put `/` in `BOFU_PAGES` because CONTAINS of `/` would match every URL.

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
- `src/lib/deal-analysis.ts` — deal enrichment, pipeline stages, conversation status detection, contact log
- `src/lib/claude.ts` — all Claude LLM calls + prompts (SALES_APPROACH, language detection, role context, banned-phrase validation)
- `src/lib/pipedrive.ts` / `src/lib/pipedrive-stats.ts` — Pipedrive API wrappers
- `src/lib/gmail.ts` — Gmail search, draft creation (HTML + signature), signature fetch
- `src/lib/google-auth.ts` — all Google auth clients
- `src/lib/marketing-config.ts` — column mappings
- `docs/Pagepro Inbound Sales Process.md` — human-readable sales process (8 stages, BANT, exit criteria). The coded version lives in `src/lib/deal-analysis.ts` `PIPELINE_STAGES`.

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
- **`refresh-gmail-token.ts`** — Generates a new Gmail OAuth2 refresh token with
  read + compose + settings scopes. Run after adding new scopes (e.g. when adding
  Calendar later). Same flow as `refresh-youtube-token.ts` — browser consent, paste
  redirect URL, update `GOOGLE_GMAIL_REFRESH_TOKEN` in `.env` and Trigger.dev prod.
- **`dump-deal-context.ts`** — Prints the enriched deal context that the
  `followup`/`analyze` LLM actually sees. Useful for debugging prompt issues or
  verifying that contact log / TIMELINE notes are picked up correctly.
  Usage: `npx tsx scripts/dump-deal-context.ts <dealId>`.
- **`test-followup-lang.ts`** — Verifies language detection for the `followup`
  command on a given deal (counts Polish diacritics, prints detected language).
  Usage: `npx tsx scripts/test-followup-lang.ts <dealId>`.
- **`check-timeline-coverage.ts`** — Reports which deals have/lack a Pipedrive
  TIMELINE note. Useful before bulk-running `build-timeline`.
- **`google-sheets-scorecard-menu.js`** — Google Apps Script for the scorecard
  spreadsheet. Adds a "Scorecard" menu with: Refresh last week, Refresh this week,
  Refresh specific week. Triggers the `update-scorecard` task via Trigger.dev API.
  Install: Extensions → Apps Script → paste contents → Save → Reload spreadsheet.
  Requires `TRIGGER_API_KEY` to be set in the script.

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
- Scopes: `gmail.readonly` (search/read), `gmail.compose` (create drafts), `gmail.settings.basic` (read default signature)
- Token refresh script: `scripts/refresh-gmail-token.ts`. Re-run when scopes change.

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
- `ANTHROPIC_API_KEY`
- `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_USER_ID`
- `SENDER_NAME` (optional, defaults to "Chris" — first-name used in `followup` greetings and role context)

## Follow-up command implementation notes

The `followup` CLI is implemented across:
- `src/index.ts` — `runFollowupCommand` orchestration, interactive REPL, signature/recap printing, browser auto-open
- `src/lib/claude.ts` — `summarizeDealForReview` (Sonnet recap), `generateFollowupIdeas` (Sonnet, 3 angles), `draftFollowup` (Opus, with banned-phrase validation + auto-retry), `detectLanguage` (Polish diacritic heuristic, ≥8 total + ≥4 distinct), `buildRoleBlock` (sender/recipient with collision detection), `SALES_APPROACH` constant (tone + readability + stage anchoring + real-vs-internal rules)
- `src/lib/gmail.ts` — `createDraft` (HTML body, RFC 2047 subject encoding, signature appended), `getDefaultSignatureHtml` (cached per-process)
- `src/lib/deal-analysis.ts` — `enrichDeal` exports the deal context including a `Contact log` block (outbound/inbound email counts + `FIRST CONTACT` flag) and clearly-labelled "Internal CRM activities" vs "Email history with prospect" sections

Models used:
- Idea generation + deal recap: `claude-sonnet-4-6`
- Email drafting: `claude-opus-4-7` (highest quality for tone-sensitive writing)
