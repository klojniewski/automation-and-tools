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
    9. Standalone-only: when NOT attaching to a thread, generates a fresh subject line (`generateStandaloneSubject`, Sonnet) — 3–6 words, tied to the client's need, no "Re:"/calendar echo — and lets Chris accept or override it. (Threaded drafts keep the `Re: <original>` subject.)
    10. Saves Gmail draft (HTML, with default Gmail signature appended, threaded via threadId + In-Reply-To/References when attaching) and auto-opens it in browser
    11. Asks whether to log the follow-up as a Pipedrive **activity** on the deal (default Yes) — runs the **`FL#n` lifecycle** (`recordFollowupActivity`, `src/lib/followup-activity.ts`):
        - Finds an OPEN (not-done) `FL#n` follow-up on the deal (the "next follow-up" task scheduled last round). If found, **reuses** it: retitle `FL#n: <subject>`, date → today, mark **done**. Otherwise **creates** a fresh `FL#n` done today (`n` = highest `FL#` on the deal + 1; first ever = FL#1). Type "Follow Up", note = email body, primary contact as participant.
        - Schedules the next step: `n < 5` ⇒ a planned `FL#(n+1)` (not-done) due in **2 working days**; `n >= 5` ⇒ a **task** "No answers after 5 FL, mark LOST." due in **1 week**. So exactly one open "what next" activity always sits on the deal. (If the prospect replies, Chris deletes the open follow-up manually — out of scope for the tool.)
    12. Still in the same **Yes** branch (right after the activity): auto-runs the sent-vs-draft review (`reviewSentEmail`) — prompts "Send the email in Gmail, then press Enter to record your edits (or 's' to skip)", then fetches the sent message, diffs it against the generated draft, prints the diff, and logs a `sent_review` event. The prompt loops so you can send first, then press Enter; the standalone `followup-review` command runs the same logic later.
  - Sales approach baked in: plain B2 English, no corporate-speak, short scannable paragraphs, stage-anchored next step. No em-dashes/en-dashes (banned in the prompt AND enforced by the auto-retry validation).
  - The signature already carries a sign-off, so `createDraft` strips the model's trailing "Best, Chris" when a signature is appended (avoids a duplicate sign-off).
  - Language- and role-aware: detects sender/recipient name collision (e.g. prospect also named "Chris") and disambiguates
  - Separates "Email history with prospect" (real) from "Internal CRM activities" (private notes) to prevent referencing unsent notes
  - **Run logging**: every run writes an append-only JSONL step log to `logs/followup-<dealId>-<timestamp>.jsonl` (`src/lib/followup-logger.ts`) — context, recap+ideas, idea chosen, every draft version + feedback, banned-phrase retries, threading choice, standalone subject, final save (incl. threadId/messageId). Best-effort (never breaks the command); `logs/` is git-ignored. Use it to analyse and improve prompts.
- `followup-review <idOrUrl>` — standalone version of step 12, run later if you skipped the inline prompt: reads the latest run log for the deal, fetches the sent message, strips signature + quoted thread, diffs it against the generated draft (subject + body), prints the diff, and appends a `sent_review` event to the same run log. Captures "what Chris actually changed" — the strongest signal for improving the drafting prompt.
  - Matches the sent email by threadId (from the run log) when available, else by recipient + newest sent message. If nothing is found yet, records `sent_review {found:false}` — re-run after actually sending.
  - Diff is paragraph-level: `toLines` unwraps Gmail's hard-wrapped plain-text so the diff shows real content changes, not wrapping artefacts.
- `followup-insights` — read-only meta-analysis over ALL run logs: aggregates sent-vs-draft edits, in-loop feedback, and validation retries into a digest (with per-deal **Context**: draft/send weekday + language), then asks Claude (`analyzeFollowupLogs`, Opus) to surface patterns and propose concrete prompt/agent changes. **Proposes only — never edits code.**
  - Calibration baked into the analyzer: it classifies each edit (temporal/scheduling, formatting, word-choice, deletion, tone) and tests it against the Context. **Logical/context-conditioned rules** (e.g. "this week" vs "next week" driven by the send weekday) are actionable from a single email; **taste rules** (e.g. italics/lists) need the same pattern across 3+ emails. Dedupes re-runs (latest `sent_review` per log).

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

## Pipedrive MCP server (Claude Desktop)

`pipedrive-mcp.mjs` (repo root) is a local stdio MCP server that exposes Pipedrive
read tools to Claude Desktop. Modelled on `chris-brain/amie-mcp.mjs`: single-user,
plain Node ESM, token read from `.env` next to the script (`PIPEDRIVE_API_TOKEN`,
`PIPEDRIVE_USER_ID`). Uses the Pipedrive v1 REST API directly via `fetch` — no
TypeScript build step, no shared deps with `src/lib/pipedrive.ts`.

**Tools exposed (read-only):**
- `list_my_deals(status?, pipeline_id?, limit?)` — open deals owned by you
- `get_deal(id_or_url)` — full deal by id or Pipedrive URL
- `get_deal_contacts(id_or_url)` — contacts on a deal
- `get_deal_activities(id_or_url, limit?)` — recent activities/calls/meetings
- `get_deal_notes(id_or_url, limit?)` — notes, including pinned TIMELINE
- `search_deals(term, limit?)` — search by title/person/org
- `list_pipeline_stages()` — all stages across pipelines

**Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
"pipedrive": {
  "command": "/opt/homebrew/bin/node",
  "args": ["/Users/chris/1_PROJECTS/myautomations/pipedrive-mcp.mjs"]
}
```
Restart Claude Desktop (quit + reopen) after editing the config — the server only
loads on cold start. Tools appear under the 🔌 icon in chat.

**Smoke-test from terminal:**
```bash
node pipedrive-mcp.mjs <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
```
Should print `pipedrive-mcp: running on stdio` then the initialize response.

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
- `src/lib/claude.ts` — `summarizeDealForReview` (Sonnet recap), `generateFollowupIdeas` (Sonnet, 3 angles), `draftFollowup` (Opus, with banned-phrase validation + auto-retry; accepts an `onRetry` callback for logging), `generateStandaloneSubject` (Sonnet, fresh non-`Re:` subject for standalone sends), `detectLanguage` (Polish diacritic heuristic, ≥8 total + ≥4 distinct), `buildRoleBlock` (sender/recipient with collision detection), `SALES_APPROACH` constant (tone + readability + stage anchoring + real-vs-internal rules; em/en-dashes hard-banned via the `NO AI TELLS` block + the `/[—–]/` pattern in `BANNED_PHRASE_PATTERNS`)
  - Formatting: **one sentence per paragraph** — enforced both in the prompt (`READABILITY / FORMATTING`) AND deterministically by `reflowOneSentencePerParagraph` in `src/lib/claude.ts`, which splits each paragraph on sentence boundaries and puts a blank line between every sentence (multi-line blocks like the sign-off are left intact).
  - **Scheduling horizon**: `buildSchedulingRule(new Date())` injects day-of-week-aware guidance into the draft prompt — Mon–Wed ⇒ propose "this week", Thu–Fri/weekend ⇒ "next week". Prevents the model saying "next week" on a Monday (a recurring manual edit surfaced by `followup-insights`).
  - **Booking link**: `CALENDLY_URL` (hardcoded constant in `claude.ts`, currently `https://calendly.com/chris8/30min`) + `SCHEDULING_LINK_RULE` in the draft prompt — the model must use this exact link and NEVER invent a URL; when proposing a meeting, the link goes in the email BODY (not just the signature footer). `findWrongLinks` validation auto-retries if any `calendly.com` URL other than `CALENDLY_URL` appears. (The signature's own "Schedule a meeting" link is a duplicate by design — that's Chris's standard.)
- `src/lib/gmail.ts` — `createDraft` (HTML body, RFC 2047 subject encoding, signature appended; strips the body's trailing sign-off via `stripTrailingSignoff` when a signature is appended), `getDefaultSignatureHtml` (cached per-process), `searchEmails` (excludes drafts via `-in:drafts` + a `DRAFT`-label backstop — an unsent draft, including ones this tool saves, must never count as a real email exchanged with the prospect; this drives the Contact log / conversation-status detection and the `followup-review` sent-email match)
- `src/lib/followup-logger.ts` — `FollowupLogger`: append-only JSONL step log per run (`logs/followup-<dealId>-<timestamp>.jsonl`), best-effort, for later analysis; plus `findLatestFollowupLog` / `readFollowupLog` / `appendFollowupEvent` used by `followup-review`
- `src/lib/followup-review.ts` — pure diff helpers for `followup-review`: `stripToBody` (drops signature + quoted thread), `toLines` (paragraph-level, unwraps hard-wrapped plain-text), `normalizeSubject`, `lineDiff` (LCS line diff)
- `analyzeFollowupLogs` (`claude.ts`, Opus) — meta-analysis behind `followup-insights`; classifies edits, correlates them with per-deal context (send weekday, language), separates logical rules (actionable at N=1) from taste rules (N≥3). `buildSchedulingRule` (`claude.ts`) — weekday-aware scheduling directive injected into the draft prompt.
- `src/lib/pipedrive.ts` — `createDealActivity` / `updateDealActivity` (create/patch a deal activity), `getDealActivities` (list, incl. done), `getActivityTypeKey` (resolves an activity-type label like "Follow Up" to its `key_string`, cached per-process)
- `src/lib/followup-activity.ts` — `recordFollowupActivity`: the `FL#n` lifecycle state machine (reuse-or-create the done follow-up, schedule the next `FL#(n+1)` in 2 working days, or the LOST task after FL#5)
- `src/lib/deal-analysis.ts` — `enrichDeal` exports the deal context including a `Contact log` block (outbound/inbound email counts + `FIRST CONTACT` flag) and clearly-labelled "Internal CRM activities" vs "Email history with prospect" sections

Models used:
- Idea generation + deal recap + standalone subject: `claude-sonnet-4-6`
- Email drafting: `claude-opus-4-7` (highest quality for tone-sensitive writing)
