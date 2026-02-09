---
title: Improve deal summary output format
type: feat
date: 2026-02-08
---

# Improve Deal Summary Output Format

## Overview

Reformat the CLI deal analysis output to be scannable with bullet points, concise language, a Pipedrive URL per deal, and a new "Deal History" section showing the last 5 chronological actions.

## Current vs Desired Output

**Current** (dense paragraphs):
```
#1 [!!!] Aaron Allen - WP -> Next Replatforming
   Health: AT_RISK | Urgency: NOW
   Action: Emergency intervention call with Aaron and Guadalupe to address...
   Why: Deal shows severe communication breakdown despite $40K value. Client has...
   Signals: Escalating frustration from client, 4+ month staleness...
```

**Desired** (scannable bullets):
```
#2 [!! ] HotPod Yoga - React Native app support
URL: https://company.pipedrive.com/deal/6692
Health: WARM | Urgency: NOW

Action:
  - Send proposal follow-up TODAY with revised terms clarification
  - Shane already agreed to proceed, actively reviewing proposal
  - Move to contract negotiation stage immediately

Why:
  - Deal value £15.6K with strong positive momentum
  - Shane confirmed 'happy to proceed' on Feb 3
  - 48 hours from closing if we provide clear contract terms

Signals:
  - Client explicitly confirmed readiness to proceed
  - Clear internal approval obtained
  - Strong likelihood of signature within days

Deal History:
  - Feb 5: Shane promised to review proposal 'shortly thereafter'
  - Feb 4: Revised proposal sent with capacity adjustments
  - Feb 3: Shane confirmed happy to proceed based on terms
  - Feb 2: Initial terms discussion via email
  - Jan 30: Discovery call completed
```

## Changes Required

### 1. Update Claude tool schema & prompt — `src/services/claude.ts`

**Schema changes** (Zod schema + tool `input_schema`):
- `recommended_action`: change from `string` to `array` of strings (bullet points)
- `reasoning`: change from `string` to `array` of strings (bullet points)
- `key_signals`: already an array — no change
- Add `deal_history`: array of objects `{ date: string, summary: string }` (max 5 items, latest first)

**System prompt changes**:
- Frame analysis through **Challenger Sales methodology** — Claude should evaluate deals based on teaching, tailoring, and taking control. Recommended actions should push prospects toward decisions, reframe their thinking, and create constructive tension rather than passive follow-ups
- Context: deals are **software services & consulting** (web development, app builds, SLAs, replatforming) — Claude should factor in typical software consulting dynamics (scope creep risk, decision-by-committee, technical evaluation cycles)
- Instruct Claude to return concise bullet points, not full sentences
- Instruct Claude to extract the 5 most recent actions/activities/emails from the deal context and return them as `deal_history` in reverse chronological order
- Each history item: date + very short one-sentence summary

### 2. Update display formatter — `src/commands/analyze.ts`

**Lines ~170-202** — rewrite the output loop:
- Add blank line after header for visual breathing room
- Add `URL:` line using Pipedrive deal URL (constructed from deal_id)
- Render `Action:` as indented bullet list from array
- Render `Why:` as indented bullet list from array
- Render `Signals:` as indented bullet list (already array, just change formatting)
- Add `Deal History:` section with `date: summary` bullets
- Add separator line between deals

### 3. Add Pipedrive domain config — `src/config/env.ts`

- Add `PIPEDRIVE_DOMAIN` to env schema (e.g., `"company"` from `company.pipedrive.com`)
- Make it optional with sensible default or required
- Pass domain through to display formatter to construct deal URLs as `https://${domain}.pipedrive.com/deal/${dealId}`

### 4. Thread Pipedrive domain to display

- `analyze.ts`: read domain from `getEnv()`, use in URL construction
- No need to pass to Claude — URL is constructed locally from `deal_id`

## Acceptance Criteria

- [x] Each deal shows Pipedrive URL
- [x] Action, Why, Signals rendered as indented bullet lists
- [x] No full sentences — concise phrases
- [x] Deal History section shows last 5 actions, latest first
- [x] Separator between deals for readability
- [x] `PIPEDRIVE_DOMAIN` env var documented in `.env.example`

## Files to Modify

1. `src/services/claude.ts` — schema + prompt + tool definition
2. `src/commands/analyze.ts` — display formatter (lines 170-202)
3. `src/config/env.ts` — add `PIPEDRIVE_DOMAIN`
4. `.env.example` — add `PIPEDRIVE_DOMAIN`
