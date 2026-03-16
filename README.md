# Marketing Automations

Trigger.dev automation project + local CLI for marketing scorecard and AI-powered deal intelligence.

## What it does

- **Weekly Marketing Scorecard** — automatically pulls GA4 website stats, Pipedrive deals, and YouTube views into a Google Sheet
- **Deal Intelligence** — analyzes open Pipedrive deals with Gmail email context, uses Claude AI to prioritize and recommend actions

## Setup

```bash
npm install
cp .env.example .env  # fill in your credentials
```

These four environment variables are required (no defaults):

```
PIPEDRIVE_API_TOKEN=
PIPEDRIVE_USER_ID=
PIPEDRIVE_DOMAIN=
ANTHROPIC_API_KEY=
```

See `.env.example` for the full list including Google API credentials, Sheet IDs, and OAuth tokens.

## Running Locally (CLI)

```bash
npx tsx src/index.ts <command>
```

### Deal Intelligence

```bash
# Analyze deals with AI prioritization (top 20 by default, excludes "Lead In" stage)
npx tsx src/index.ts analyze
npx tsx src/index.ts analyze --top 5                          # quick top 5
npx tsx src/index.ts analyze --top 10 --limit 50              # top 10 from up to 50 deals
npx tsx src/index.ts analyze --exclude-stages "Lead In" "Contact Made"

# Analyze a single deal by ID (includes Gmail links in history)
npx tsx src/index.ts deal 6877
npx tsx src/index.ts deal 6877 --email-days 30 --max-emails 5

# Build full TIMELINE note for a deal (prerequisite for timeline features)
npx tsx src/index.ts build-timeline 6827
npx tsx src/index.ts build-timeline 6827 --email-days 180 --max-emails 30
```

Run `build-timeline` once per deal to initialize its TIMELINE note in Pipedrive (milestones + detailed log from full email history). Subsequent `analyze`/`deal` runs append new entries incrementally.

> **Side effects:** `analyze` and `deal` write TIMELINE notes back to Pipedrive for each analyzed deal. There is no `--dry-run` flag for deal commands. Marketing commands write to Google Sheets (use `--dry-run` to preview).

### Marketing Scorecard

```bash
# Individual data sources
npx tsx src/index.ts marketing getga4stats --dry-run
npx tsx src/index.ts marketing getpipedrivedeals --dry-run
npx tsx src/index.ts marketing getyoutubestats --dry-run

# Full scorecard update (all sources → Google Sheet)
npx tsx src/index.ts marketing updateScorecard

# Specify a week (YYWW format)
npx tsx src/index.ts marketing getga4stats --week 2610
```

All marketing commands support `--week <YYWW>` (default: last completed week) and `--dry-run`.

## Trigger.dev (Scheduled/Cloud)

Tasks are also deployed to Trigger.dev for scheduled and on-demand execution:

| Task | Description | Schedule |
|------|-------------|----------|
| `update-scorecard` | Full scorecard update | Weekly |
| `analyze-deals` | AI deal analysis with email context | On-demand |
| `get-pipedrive-deals` | Fetch Pipedrive deals count | On-demand |
| `get-ga4-stats` | Fetch GA4 metrics | On-demand |
| `get-youtube-stats` | Fetch YouTube views | On-demand |

Start the dev server to run tasks locally via the Trigger.dev dashboard:

```bash
npx trigger.dev dev
```

## Utility Scripts

```bash
# Re-generate YouTube OAuth2 refresh token
npx tsx scripts/refresh-youtube-token.ts

# Verify YouTube API access
npx tsx scripts/check-youtube-channel.ts

# Test YouTube views for a specific week
npx tsx scripts/test-youtube.ts

# Dump all raw data + Claude analysis for a deal (creates debug/<dealId>/ directory)
npx tsx scripts/debug-deal.ts <dealId> [emailDays] [maxEmails]
```

## Known Gotchas

- **Week format:** `--week` takes YYWW (e.g. `2610` = year 2026, week 10). Non-ISO numbering, Europe/Warsaw timezone, Monday–Sunday range.
- **Sheet structure:** Google Sheet must have pre-populated week labels in column B (e.g. "W1", "W2"). Marketing commands error if the row is not found.
- **Pipeline stages:** The 7 stages (Lead In → Agreement Sent) are hardcoded in `src/lib/deal-analysis.ts`. Must match Pipedrive configuration.
- **YouTube token:** Must be generated as the Pagepro brand account (not personal Google account), otherwise returns 0 views. Consent screen must be in Production mode (Testing mode tokens expire after 7 days). See CLAUDE.md for auth details.

## Stack

- **Runtime:** Trigger.dev v4 + Commander CLI
- **Language:** TypeScript
- **APIs:** Google Analytics (GA4), Google Sheets, YouTube Analytics, Pipedrive, Gmail, Anthropic (Claude)
