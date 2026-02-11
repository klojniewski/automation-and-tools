import { fetchDealsInRange } from "../../services/pipedrive.js";
import { findRowByWeek, updateMappedCells } from "../../services/sheets.js";
import { DEALS_COLUMN_MAP, MQL_FIELD_KEY, MQL_YES, SQL_FIELD_KEY, SQL_YES, CHANNEL_LABELS } from "../../config/marketing.js";

export interface GetPipedriveDealsOptions {
  week?: string;
  pipeline: number;
  dryRun: boolean;
  verbose: boolean;
}

const DEFAULT_PIPELINE = 22;

const TZ = "Europe/Warsaw";

/** Format a Date as YYYY-MM-DD in Poland time. */
const fmt = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** Parse YYWW format (e.g. "2601" → year 2026, week 1). */
function parseWeek(yyww: string): { year: number; weekNum: number } {
  if (!/^\d{4}$/.test(yyww)) {
    throw new Error(`Invalid week format "${yyww}". Expected YYWW, e.g. 2601`);
  }
  const year = 2000 + parseInt(yyww.slice(0, 2), 10);
  const weekNum = parseInt(yyww.slice(2), 10);
  if (weekNum < 1 || weekNum > 53) {
    throw new Error(`Week number ${weekNum} out of range (1-53)`);
  }
  return { year, weekNum };
}

/** Return Mon–Sun range for a given week number in a given year. Week 1 contains Jan 1. */
function weekRange(year: number, weekNum: number): { startDate: string; endDate: string; weekEnding: string } {
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const daysBack = (jan1Day + 6) % 7;
  const week1Monday = new Date(jan1);
  week1Monday.setDate(jan1.getDate() - daysBack);

  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    startDate: fmt(monday),
    endDate: fmt(sunday),
    weekEnding: fmt(sunday),
  };
}

/** Return Mon–Sun range for last completed week (Poland time). */
function lastWeekRange(): { startDate: string; endDate: string; weekEnding: string } {
  const nowStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = new Date(nowStr + "T00:00:00");
  const dayOfWeek = today.getDay();

  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));

  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);

  return {
    startDate: fmt(lastMonday),
    endDate: fmt(lastSunday),
    weekEnding: fmt(lastSunday),
  };
}

function weekLabel(weekNum: number): string {
  return `W${weekNum}`;
}

export async function runGetPipedriveDeals(options: GetPipedriveDealsOptions): Promise<void> {
  const pipelineId = options.pipeline ?? DEFAULT_PIPELINE;
  let startDate: string, endDate: string, weekEnding: string;
  let weekNum: number;

  if (options.week) {
    const parsed = parseWeek(options.week);
    weekNum = parsed.weekNum;
    const range = weekRange(parsed.year, parsed.weekNum);
    startDate = range.startDate;
    endDate = range.endDate;
    weekEnding = range.weekEnding;
  } else {
    const range = lastWeekRange();
    startDate = range.startDate;
    endDate = range.endDate;
    weekEnding = range.weekEnding;
    const endDateObj = new Date(range.endDate + "T00:00:00");
    const year = endDateObj.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const jan1Day = jan1.getDay();
    const daysBack = (jan1Day + 6) % 7;
    const week1Monday = new Date(jan1);
    week1Monday.setDate(jan1.getDate() - daysBack);
    weekNum = Math.floor((endDateObj.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  }

  if (options.verbose) {
    console.log(`Pipeline: ${pipelineId}`);
    console.log(`Date range: ${startDate} to ${endDate}`);
  }

  console.log(`Fetching deals created in pipeline ${pipelineId}...`);
  const deals = await fetchDealsInRange(pipelineId, startDate, endDate, [MQL_FIELD_KEY, SQL_FIELD_KEY]);

  // --- Helpers ---
  const isMql = (deal: typeof deals[0]) => Number(deal.custom_fields?.[MQL_FIELD_KEY]) === MQL_YES;
  const isSql = (deal: typeof deals[0]) => Number(deal.custom_fields?.[SQL_FIELD_KEY]) === SQL_YES;

  // --- Aggregate per channel ---
  const channels: Record<string, { all: number; mql: number; sql: number }> = {};
  let totalMql = 0;
  let totalSql = 0;

  for (const deal of deals) {
    const raw = deal.channel;
    const key = raw != null ? String(raw) : "Unknown";
    const label = CHANNEL_LABELS[key] ?? key;

    if (!channels[label]) channels[label] = { all: 0, mql: 0, sql: 0 };
    channels[label].all++;

    if (isMql(deal)) { channels[label].mql++; totalMql++; }
    if (isSql(deal)) { channels[label].sql++; totalSql++; }
  }

  // --- Print deal list ---
  console.log(`\nWeek: ${startDate} – ${weekEnding}\n`);
  console.log("  Deals:");
  console.log(`    ${"Title".padEnd(40)} ${"Channel".padEnd(22)} ${"MQL".padEnd(6)} SQL`);
  console.log(`    ${"─".repeat(40)} ${"─".repeat(22)} ${"─".repeat(6)} ${"─".repeat(6)}`);
  for (const deal of deals) {
    const ch = deal.channel;
    const chKey = ch != null ? String(ch) : "—";
    const chLabel = CHANNEL_LABELS[chKey] ?? chKey;
    const title = (deal.title ?? "Untitled").slice(0, 40);
    console.log(`    ${title.padEnd(40)} ${chLabel.padEnd(22)} ${(isMql(deal) ? "YES" : "—").padEnd(6)} ${isSql(deal) ? "YES" : "—"}`);
  }

  // --- Print summary table ---
  console.log(`\n  ${"Source Channel".padEnd(24)} ${"All".padStart(5)} ${"MQL".padStart(5)} ${"SQL".padStart(5)}`);
  console.log(`  ${"─".repeat(24)} ${"─".repeat(5)} ${"─".repeat(5)} ${"─".repeat(5)}`);
  for (const [label, c] of Object.entries(channels).sort((a, b) => b[1].all - a[1].all)) {
    console.log(`  ${label.padEnd(24)} ${String(c.all).padStart(5)} ${String(c.mql).padStart(5)} ${String(c.sql).padStart(5)}`);
  }
  console.log(`  ${"─".repeat(24)} ${"─".repeat(5)} ${"─".repeat(5)} ${"─".repeat(5)}`);
  console.log(`  ${"Total".padEnd(24)} ${String(deals.length).padStart(5)} ${String(totalMql).padStart(5)} ${String(totalSql).padStart(5)}`);
  console.log();

  if (options.dryRun) {
    console.log("[DRY RUN] Skipping Google Sheet write.");
    return;
  }

  const label = weekLabel(weekNum);
  console.log(`Looking for ${label} in spreadsheet...`);
  const rowNum = await findRowByWeek(label);

  if (!rowNum) {
    console.error(`Row for ${label} not found in column B. Cannot write.`);
    return;
  }

  // Build data record for sheet write
  const data: Record<string, number> = {
    dealsCreated: deals.length,
    mql: totalMql,
    sql: totalSql,
  };
  for (const rawKey of Object.keys(CHANNEL_LABELS)) {
    const chLabel = CHANNEL_LABELS[rawKey];
    const c = channels[chLabel] ?? { all: 0, mql: 0, sql: 0 };
    data[`channel_${rawKey}`] = c.all;
    data[`channel_${rawKey}_mql`] = c.mql;
    data[`channel_${rawKey}_sql`] = c.sql;
  }

  console.log(`Found ${label} at row ${rowNum}. Writing deals data...`);
  await updateMappedCells(rowNum, data, DEALS_COLUMN_MAP);
  console.log(`Deals data updated for ${label}.`);
}
