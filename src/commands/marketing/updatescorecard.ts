import { fetchGA4Metrics, type GA4Metrics } from "../../services/ga4.js";
import { fetchDealsInRange } from "../../services/pipedrive.js";
import { findRowByWeek, updateMappedCells } from "../../services/sheets.js";
import {
  SCORECARD_COLUMN_MAP,
  METRIC_LABELS,
  MQL_FIELD_KEY,
  MQL_YES,
  SQL_FIELD_KEY,
  SQL_YES,
  CHANNEL_LABELS,
} from "../../config/marketing.js";
import { resolveWeek, weekLabel } from "../../utils/week.js";

export interface UpdateScorecardOptions {
  week?: string;
  pipeline: number;
  dryRun: boolean;
  verbose: boolean;
}

const DEFAULT_PIPELINE = 22;

// ── GA4 helpers ──────────────────────────────────────────────

function ga4ToRecord(m: GA4Metrics): Record<string, string | number> {
  return {
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

function printGA4(startDate: string, weekEnding: string, m: GA4Metrics): void {
  const values: (number | string)[] = [
    m.totalTraffic,
    m.trafficMinusAdsMinusBlog,
    m.totalBofu,
    m.notPaidBofu,
    m.organic,
    m.referral,
    m.direct,
    m.aiTraffic,
    `${(m.engagementRate * 100).toFixed(2)}%`,
    `${(m.engagementRateOrganic * 100).toFixed(2)}%`,
    m.qualityTraffic,
    m.blogTraffic,
    m.paidTraffic,
  ];

  console.log("  GA4 Metrics:");
  for (let i = 0; i < METRIC_LABELS.length; i++) {
    console.log(`    ${METRIC_LABELS[i].padEnd(24)} ${values[i]}`);
  }
  console.log();
}

// ── Pipedrive helpers ────────────────────────────────────────

type DealItem = Awaited<ReturnType<typeof fetchDealsInRange>>[0];

const isMql = (deal: DealItem) => Number(deal.custom_fields?.[MQL_FIELD_KEY]) === MQL_YES;
const isSql = (deal: DealItem) => Number(deal.custom_fields?.[SQL_FIELD_KEY]) === SQL_YES;

interface ChannelStats { all: number; mql: number; sql: number }

function aggregateDeals(deals: DealItem[]) {
  const channels: Record<string, ChannelStats> = {};
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

  return { channels, totalMql, totalSql };
}

function printDeals(deals: DealItem[], channels: Record<string, ChannelStats>, totalMql: number, totalSql: number): void {
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

  console.log();
  console.log(`  ${"Source Channel".padEnd(24)} ${"All".padStart(5)} ${"MQL".padStart(5)} ${"SQL".padStart(5)}`);
  console.log(`  ${"─".repeat(24)} ${"─".repeat(5)} ${"─".repeat(5)} ${"─".repeat(5)}`);
  for (const [label, c] of Object.entries(channels).sort((a, b) => b[1].all - a[1].all)) {
    console.log(`  ${label.padEnd(24)} ${String(c.all).padStart(5)} ${String(c.mql).padStart(5)} ${String(c.sql).padStart(5)}`);
  }
  console.log(`  ${"─".repeat(24)} ${"─".repeat(5)} ${"─".repeat(5)} ${"─".repeat(5)}`);
  console.log(`  ${"Total".padEnd(24)} ${String(deals.length).padStart(5)} ${String(totalMql).padStart(5)} ${String(totalSql).padStart(5)}`);
  console.log();
}

function dealsToRecord(
  deals: DealItem[],
  channels: Record<string, ChannelStats>,
  totalMql: number,
  totalSql: number,
): Record<string, string | number> {
  const data: Record<string, string | number> = {
    dealsCreated: deals.length,
    mql: totalMql,
    sql: totalSql,
  };
  for (const rawKey of Object.keys(CHANNEL_LABELS)) {
    const label = CHANNEL_LABELS[rawKey];
    const c = channels[label] ?? { all: 0, mql: 0, sql: 0 };
    data[`channel_${rawKey}`] = c.all;
    data[`channel_${rawKey}_mql`] = c.mql;
    data[`channel_${rawKey}_sql`] = c.sql;
  }
  return data;
}

// ── Main ─────────────────────────────────────────────────────

export async function runUpdateScorecard(options: UpdateScorecardOptions): Promise<void> {
  const pipelineId = options.pipeline ?? DEFAULT_PIPELINE;
  const { weekNum, startDate, endDate, weekEnding } = resolveWeek(options.week);

  if (options.verbose) {
    console.log(`Pipeline: ${pipelineId}`);
    console.log(`Date range: ${startDate} to ${endDate}`);
  }

  // Fetch GA4 and Pipedrive in parallel
  console.log("Fetching GA4 metrics and Pipedrive deals...");
  const [metrics, deals] = await Promise.all([
    fetchGA4Metrics(startDate, endDate),
    fetchDealsInRange(pipelineId, startDate, endDate, [MQL_FIELD_KEY, SQL_FIELD_KEY]),
  ]);

  const { channels, totalMql, totalSql } = aggregateDeals(deals);

  // Print combined report
  console.log(`\nWeek: ${startDate} – ${weekEnding}\n`);
  printGA4(startDate, weekEnding, metrics);
  printDeals(deals, channels, totalMql, totalSql);

  if (options.dryRun) {
    console.log("[DRY RUN] Skipping Google Sheet write.");
    return;
  }

  // Find row and write everything in one batch
  const label = weekLabel(weekNum);
  console.log(`Looking for ${label} in spreadsheet...`);
  const rowNum = await findRowByWeek(label);

  if (!rowNum) {
    console.error(`Row for ${label} not found in column B. Cannot write.`);
    return;
  }

  const allData: Record<string, string | number> = {
    ...ga4ToRecord(metrics),
    ...dealsToRecord(deals, channels, totalMql, totalSql),
  };

  console.log(`Found ${label} at row ${rowNum}. Writing scorecard...`);
  await updateMappedCells(rowNum, allData, SCORECARD_COLUMN_MAP);
  console.log(`Scorecard updated for ${label}.`);
}
