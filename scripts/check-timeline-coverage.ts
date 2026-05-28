/**
 * Check which open deals have TIMELINE notes and which don't.
 * Usage: npx tsx scripts/check-timeline-coverage.ts
 */
import "dotenv/config";
import { validateCredentials, getOpenDeals, getStagesMap, getTimelineNote } from "../src/lib/pipedrive.js";
import { getEnv } from "../src/lib/env.js";

async function main() {
  await validateCredentials();
  const env = getEnv();
  const [stages, deals] = await Promise.all([
    getStagesMap(),
    getOpenDeals(env.PIPEDRIVE_USER_ID, 100),
  ]);

  // Exclude "Lead In" (default behavior of analyze-deals)
  const excludeNames = ["lead in"];
  const excludeIds = [...stages.entries()]
    .filter(([, name]) => excludeNames.includes(name.toLowerCase()))
    .map(([id]) => id);

  const leadIn = deals.filter((d) => excludeIds.includes(d.stage_id ?? 0));
  const filtered = deals.filter((d) => !excludeIds.includes(d.stage_id ?? 0));

  console.log(`Total open deals: ${deals.length}`);
  console.log(`Excluded (Lead In): ${leadIn.length}`);
  console.log(`Analyzed by analyze-deals: ${filtered.length}\n`);

  // Check which have TIMELINE notes
  const results = await Promise.all(
    filtered.map(async (d) => {
      const id = d.id ?? 0;
      const stage = stages.get(d.stage_id ?? 0) ?? "Unknown";
      const note = await getTimelineNote(id).catch(() => null);
      return { id, title: d.title, stage, hasTimeline: !!note };
    })
  );

  const withTimeline = results.filter((r) => r.hasTimeline);
  const withoutTimeline = results.filter((r) => !r.hasTimeline);

  console.log(`WITH TIMELINE (${withTimeline.length}):`);
  for (const r of withTimeline) {
    console.log(`  ✓ #${r.id} ${r.title} [${r.stage}]`);
  }
  console.log(`\nWITHOUT TIMELINE — will be auto-created (${withoutTimeline.length}):`);
  for (const r of withoutTimeline) {
    console.log(`  ✗ #${r.id} ${r.title} [${r.stage}]`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
