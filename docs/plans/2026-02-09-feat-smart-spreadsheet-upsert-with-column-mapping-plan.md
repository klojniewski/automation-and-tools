---
title: Smart Spreadsheet Upsert with Column Mapping
type: feat
date: 2026-02-09
---

# Smart Spreadsheet Upsert with Column Mapping

## Overview

Enhance the `marketing getga4stats` command to find the correct row by week number (W1, W2... in column B), map metrics to specific columns via a hardcoded config, and overwrite only the mapped cells — leaving other columns in that row untouched.

## Problem Statement

Currently the script:
1. **Appends a new row** every time via `sheets.spreadsheets.values.append` — it cannot update existing rows
2. **Refuses to write** if the week already exists (duplicate detection via column A)
3. **Writes all values sequentially** starting from column A — no column mapping, so adding/reordering metrics requires changing the sheet layout
4. **Week format mismatch** — code writes `2026-01-05` (date) but the sheet uses `W1`, `W2` format in column B

## Proposed Solution

### 1. Add column mapping config to `src/config/marketing.ts`

Define a map from metric key to sheet column letter. This decouples metric order from sheet layout.

```ts
// src/config/marketing.ts

/** Maps GA4 metric keys to Google Sheet column letters. */
export const METRIC_COLUMN_MAP: Record<string, string> = {
  weekEnding:             "B",   // W1, W2, etc.
  totalTraffic:           "C",
  trafficMinusAdsMinusBlog: "D",
  totalBofu:              "E",
  notPaidBofu:            "F",
  organic:                "G",
  referral:               "H",
  direct:                 "I",
  aiTraffic:              "J",
  engagementRate:         "K",
  engagementRateOrganic:  "L",
  qualityTraffic:         "M",
  blogTraffic:            "N",
  paidTraffic:            "O",
};
```

**Note:** The actual column letters above are placeholders — user must confirm the real mapping from their spreadsheet.

### 2. Add week number formatting

Convert the YYWW input to the `W{n}` format the sheet uses.

```ts
// src/commands/marketing/getga4stats.ts

function weekLabel(weekNum: number): string {
  return `W${weekNum}`;
}
```

### 3. Replace `appendRow` with `findRowAndUpsert` in `src/services/sheets.ts`

New functions:

```ts
// src/services/sheets.ts

/**
 * Find the row number where column B matches the given week label (e.g. "W5").
 * Returns the 1-based row number, or null if not found.
 */
export async function findRowByWeek(weekLabel: string): Promise<number | null> {
  const sheets = await getSheetsClient();
  const env = getEnv();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${env.GOOGLE_SHEETS_TAB}!B:B`,
  });

  const values = (res.data.values ?? []).flat().map(String);
  const idx = values.indexOf(weekLabel);
  return idx === -1 ? null : idx + 1; // 1-based row number
}

/**
 * Write specific cells in a given row using the column mapping.
 * Only touches the columns defined in the map — other cells in the row are untouched.
 */
export async function updateMappedCells(
  rowNum: number,
  data: Record<string, string | number>,
  columnMap: Record<string, string>,
): Promise<void> {
  const sheets = await getSheetsClient();
  const env = getEnv();

  // Build individual cell updates
  const valueRanges = Object.entries(data)
    .filter(([key]) => columnMap[key])
    .map(([key, value]) => ({
      range: `${env.GOOGLE_SHEETS_TAB}!${columnMap[key]}${rowNum}`,
      values: [[value]],
    }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: valueRanges,
    },
  });
}
```

### 4. Update `runGetGA4Stats` in `src/commands/marketing/getga4stats.ts`

Replace the append-based flow with find-and-upsert:

```ts
// src/commands/marketing/getga4stats.ts — updated runGetGA4Stats

// 1. Convert metrics to a key-value record
function metricsToRecord(weekLabel: string, m: GA4Metrics): Record<string, string | number> {
  return {
    weekEnding: weekLabel,
    totalTraffic: m.totalTraffic,
    trafficMinusAdsMinusBlog: m.trafficMinusAdsMinusBlog,
    totalBofu: m.totalBofu,
    notPaidBofu: m.notPaidBofu,
    organic: m.organic,
    referral: m.referral,
    direct: m.direct,
    aiTraffic: m.aiTraffic,
    engagementRate: `${(m.engagementRate * 100).toFixed(2)}%`,
    engagementRateOrganic: `${(m.engagementRateOrganic * 100).toFixed(2)}%`,
    qualityTraffic: m.qualityTraffic,
    blogTraffic: m.blogTraffic,
    paidTraffic: m.paidTraffic,
  };
}

// 2. In runGetGA4Stats, replace the append logic:
const label = weekLabel(weekNum);
const rowNum = await findRowByWeek(label);

if (!rowNum) {
  console.error(`Row for ${label} not found in column B. Cannot write.`);
  return;
}

console.log(`Found ${label} at row ${rowNum}. Writing metrics...`);
await updateMappedCells(rowNum, metricsToRecord(label, metrics), METRIC_COLUMN_MAP);
console.log(`Metrics updated for ${label}.`);
```

### 5. Keep existing `appendRow` and `getColumnAValues`

These remain available for backward compatibility or other commands. No deletions needed.

## Acceptance Criteria

- [x] Script finds the correct row by matching `W{n}` in column B
- [x] Each metric is written to its mapped column only
- [x] Other cells in the row (outside the mapping) are not touched
- [x] Running the command twice for the same week overwrites cleanly
- [x] `--dry-run` flag still skips the write
- [x] Console output shows which row was found and updated
- [x] Error message if the week row is not found in the sheet

## Files to Modify

| File | Change |
|------|--------|
| `src/config/marketing.ts` | Add `METRIC_COLUMN_MAP` |
| `src/services/sheets.ts` | Add `findRowByWeek()` and `updateMappedCells()` |
| `src/commands/marketing/getga4stats.ts` | Replace append flow with find-and-upsert, add `weekLabel()`, add `metricsToRecord()` |

## MVP

The minimum viable change is:
1. Add column map config
2. Add `findRowByWeek` + `updateMappedCells` to sheets service
3. Update command to use upsert instead of append
