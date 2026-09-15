/**
 * Backfill the "AI Traffic" column (sessions from AI sources) for a range of weeks.
 * Same filter as the aiTraffic scorecard metric (AI_SOURCES, CONTAINS on
 * sessionSource) — run after changing AI_SOURCES so history matches the new
 * definition. Writes ONLY that one column.
 *
 * Usage: npx tsx scripts/backfill-ai-traffic.ts [fromWeek] [toWeek] [year]
 */
import { google } from "googleapis";
import { getGoogleAuth } from "../src/lib/google-auth.js";
import { getEnv } from "../src/lib/env.js";
import { findRowByWeek, updateMappedCells } from "../src/lib/sheets.js";
import { SCORECARD_COLUMN_MAP, AI_SOURCES } from "../src/lib/marketing-config.js";
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

  console.log(`Backfilling AI Traffic (column ${SCORECARD_COLUMN_MAP.aiTraffic}) for W${fromWeek}..W${toWeek} ${year}`);
  console.log(`AI_SOURCES: ${AI_SOURCES.join(", ")}\n`);

  for (let w = fromWeek; w <= toWeek; w++) {
    const { startDate, endDate } = weekRange(year, w);
    const label = weekLabel(w);

    const res = await analytics.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: "sessions" }],
        dimensionFilter: {
          orGroup: {
            expressions: AI_SOURCES.map((s) => ({
              filter: {
                fieldName: "sessionSource",
                stringFilter: { matchType: "CONTAINS", value: s, caseSensitive: false },
              },
            })),
          },
        },
      },
    });
    const value = parseInt(res.data.rows?.[0]?.metricValues?.[0]?.value ?? "0", 10);

    const rowNum = await findRowByWeek(label);
    if (!rowNum) {
      console.log(`${label} (${startDate}..${endDate})  aiTraffic=${value}  — row not found in sheet, SKIPPED`);
      continue;
    }

    await updateMappedCells(rowNum, { aiTraffic: value }, SCORECARD_COLUMN_MAP);
    console.log(`${label} (${startDate}..${endDate})  aiTraffic=${value}  → row ${rowNum}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
