/**
 * Backfill the "GSC Clicks" column for a range of weeks.
 * Fetches Search Console total clicks (web, dataState "all") per week and
 * writes ONLY that one column — no other cells are touched.
 *
 * Prerequisite: add the column to the sheet AND map `gscClicks` to its column
 * letter in SCORECARD_COLUMN_MAP (src/lib/marketing-config.ts) first.
 *
 * Usage: npx tsx scripts/backfill-gsc-clicks.ts [fromWeek] [toWeek] [year]
 *        npx tsx scripts/backfill-gsc-clicks.ts            # W1..last completed week, 2026
 */
import { fetchGscClicks } from "../src/lib/gsc.js";
import { findRowByWeek, updateMappedCells } from "../src/lib/sheets.js";
import { SCORECARD_COLUMN_MAP } from "../src/lib/marketing-config.js";
import { weekRange, weekLabel, lastWeekRange, deriveWeekNum } from "../src/lib/week.js";

async function main() {
  if (!SCORECARD_COLUMN_MAP.gscClicks) {
    throw new Error(
      "SCORECARD_COLUMN_MAP has no `gscClicks` entry — add the sheet column and its mapping in src/lib/marketing-config.ts first.",
    );
  }

  const fromWeek = process.argv[2] ? parseInt(process.argv[2], 10) : 1;
  const toWeek = process.argv[3]
    ? parseInt(process.argv[3], 10)
    : deriveWeekNum(lastWeekRange().endDate);
  const year = process.argv[4] ? parseInt(process.argv[4], 10) : 2026;

  console.log(`Backfilling GSC Clicks (column ${SCORECARD_COLUMN_MAP.gscClicks}) for W${fromWeek}..W${toWeek} ${year}\n`);

  for (let w = fromWeek; w <= toWeek; w++) {
    const { startDate, endDate } = weekRange(year, w);
    const label = weekLabel(w);

    const clicks = await fetchGscClicks(startDate, endDate);

    const rowNum = await findRowByWeek(label);
    if (!rowNum) {
      console.log(`${label} (${startDate}..${endDate})  clicks=${clicks}  — row not found in sheet, SKIPPED`);
      continue;
    }

    await updateMappedCells(rowNum, { gscClicks: clicks }, SCORECARD_COLUMN_MAP);
    console.log(`${label} (${startDate}..${endDate})  clicks=${clicks}  → row ${rowNum}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
