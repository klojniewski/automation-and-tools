---
title: Update README.md — fill gaps, keep it concise
type: docs
date: 2026-03-16
revised: true
---

# Update README.md — fill gaps, keep it concise

Fill the real gaps in the existing README without duplicating CLAUDE.md. The current README structure is good — it just has holes.

CLAUDE.md remains the deep reference for AI agents (auto-loaded into context). README stays concise: "what is this, how to use it, gotchas."

## Acceptance Criteria

- [ ] `build-timeline <id>` command added to Deal Intelligence section with options, example, and TIMELINE dependency note
- [ ] Side-effect warnings on `analyze`/`deal`: they write TIMELINE notes to Pipedrive, no `--dry-run` available
- [ ] Required env vars called out: `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_USER_ID`, `PIPEDRIVE_DOMAIN`, `ANTHROPIC_API_KEY` (with pointer to `.env.example` for full list)
- [ ] `debug-deal.ts` added to Utility Scripts section
- [ ] Known Gotchas section added with: week format (YYWW, non-ISO, Europe/Warsaw), Sheet column B requirement, pipeline stages hardcoded, YouTube brand account requirement
- [ ] `build-timeline` added to CLAUDE.md CLI section

## Scope — what NOT to do

Per reviewer feedback (DHH, Kieran, Simplicity):
- Do NOT add Library Modules table — internal detail, belongs in code/CLAUDE.md
- Do NOT add Pipeline Stages section — one-line gotcha is sufficient
- Do NOT add Authentication section — already thorough in CLAUDE.md
- Do NOT add AI Agent Quick Reference — 7 commands are trivially scannable
- Do NOT add TIMELINE Notes section — fold into `build-timeline` command docs
- Do NOT add full Environment Variables listing — `.env.example` is the source of truth
- Do NOT rewrite the README — fill gaps in the existing structure

## Changes

### 1. README.md — targeted additions

**Deal Intelligence section:** Add `build-timeline` command block:
```bash
# Build full TIMELINE note for a deal (prerequisite for timeline features)
npx tsx src/index.ts build-timeline 6827
npx tsx src/index.ts build-timeline 6827 --email-days 180 --max-emails 30
```
With note: "Run `build-timeline` once per deal to initialize its TIMELINE note. Subsequent `analyze`/`deal` runs append new entries incrementally."

**Deal Intelligence section:** Add side-effect callout after the command examples:
> Note: `analyze` and `deal` write TIMELINE notes back to Pipedrive for each analyzed deal. There is no `--dry-run` flag for deal commands.

**Setup section:** Add required env vars (the 4 that have no defaults):
```
# Required (no defaults)
PIPEDRIVE_API_TOKEN=
PIPEDRIVE_USER_ID=
PIPEDRIVE_DOMAIN=
ANTHROPIC_API_KEY=
```
Keep the existing "See `.env.example` for all required environment variables" pointer.

**Utility Scripts section:** Add `debug-deal.ts`:
```bash
# Dump all raw data + Claude analysis for a deal (creates debug/<dealId>/ directory)
npx tsx scripts/debug-deal.ts <dealId> [emailDays] [maxEmails]
```

**New section: Known Gotchas** (after Utility Scripts, before Stack):
- `--week` format is YYWW (e.g. `2610` = year 2026, week 10). Non-ISO numbering, Europe/Warsaw timezone, Monday-Sunday range.
- Google Sheet must have pre-populated week labels in column B (e.g. "W1", "W2"). Marketing commands error if the row is not found.
- Pipeline stages (7 stages: Lead In → Agreement Sent) are hardcoded in `src/lib/deal-analysis.ts`. Must match Pipedrive configuration.
- YouTube OAuth token must be generated as the Pagepro brand account (not personal). See CLAUDE.md for details.

### 2. CLAUDE.md — add build-timeline

Add to the "Deal intelligence" section under "Running Locally (CLI)":
```
- `build-timeline <id>` — build full TIMELINE note for a deal (365 days, 50 emails)
  - Options: `--email-days <n>`, `--max-emails <n>`
  - Run once per deal to initialize; `analyze`/`deal` append incrementally
```

### 3. Separate fix: scripts/debug-deal.ts line 256

Fix stale model reference: `claude-haiku-4-5-20251001` → `claude-sonnet-4-6`. This is a code fix, not a docs change — commit separately.

## References

- Existing README: `README.md` (92 lines)
- Existing CLAUDE.md: `CLAUDE.md`
- `.env.example` for env var reference
- `src/index.ts` for CLI command definitions
- `src/lib/env.ts` for env var schema
