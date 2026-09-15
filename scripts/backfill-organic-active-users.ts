/**
 * Backfill the "Organic Active Users" column (AA) for a range of weeks.
 * Fetches GA4 activeUsers (Organic Search + Organic Social) per week and
 * writes ONLY that one column — no other cells are touched.
 *
 * Usage: npx tsx scripts/backfill-organic-active-users.ts [fromWeek] [toWeek] [year]
 *        npx tsx scripts/backfill-organic-active-users.ts            # W1..last completed week, 2026
 *        npx tsx scripts/backfill-organic-active-users.ts 1 20       # W1..W20
 */
import { google } from "googleapis";
import { getGoogleAuth } from "../src/lib/google-auth.js";
import { getEnv } from "../src/lib/env.js";
import { findRowByWeek, updateMappedCells } from "../src/lib/sheets.js";
import { METRIC_COLUMN_MAP } from "../src/lib/marketing-config.js";
import { weekRange, weekLabel, lastWeekRange, deriveWeekNum } from "../src/lib/week.js";

async function main() {
  const fromWeek = process.argv[2] ? parseInt(process.argv[2], 10) : 1;
  const toWeek = process.argv[3]
    ? parseInt(process.argv[3], 10)
    : deriveWeekNum(lastWeekRange().endDate);
  const year = process.argv[4] ? parseInt(process.argv[4], 10) : 2026;

  const auth = await getGoogleAuth();
  const analytics = google.analyticsdata({ version: "v1beta", auth });
  const property = `properties/${getEnv().GA4_PROPERTY_ID}`;

  console.log(`Backfilling Organic Active Users (column ${METRIC_COLUMN_MAP.organicActiveUsers}) for W${fromWeek}..W${toWeek} ${year}\n`);

  for (let w = fromWeek; w <= toWeek; w++) {
    const { startDate, endDate } = weekRange(year, w);
    const label = weekLabel(w);

    const res = await analytics.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: "activeUsers" }],
        dimensionFilter: {
          filter: {
            fieldName: "sessionDefaultChannelGroup",
            inListFilter: { values: ["Organic Search", "Organic Social"] },
          },
        },
      },
    });
    const value = parseInt(res.data.rows?.[0]?.metricValues?.[0]?.value ?? "0", 10);

    const rowNum = await findRowByWeek(label);
    if (!rowNum) {
      console.log(`${label} (${startDate}..${endDate})  activeUsers=${value}  — row not found in sheet, SKIPPED`);
      continue;
    }

    await updateMappedCells(rowNum, { organicActiveUsers: value }, METRIC_COLUMN_MAP);
    console.log(`${label} (${startDate}..${endDate})  activeUsers=${value}  → row ${rowNum}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
