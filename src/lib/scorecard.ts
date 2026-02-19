import { fetchGA4Metrics, type GA4Metrics } from "./ga4.js";
import { fetchDealsInRange } from "./pipedrive.js";
import { fetchYouTubeViews } from "./youtube.js";
import { findRowByWeek, updateMappedCells } from "./sheets.js";
import {
  SCORECARD_COLUMN_MAP,
  MQL_FIELD_KEY,
  MQL_YES,
  SQL_FIELD_KEY,
  SQL_YES,
  CHANNEL_LABELS,
} from "./marketing-config.js";
import { resolveWeek, weekLabel } from "./week.js";
import type { DealItem } from "pipedrive/v2";

const DEFAULT_PIPELINE = 22;

// ── Helpers ──────────────────────────────────────────────────

const isMql = (deal: DealItem) => Number(deal.custom_fields?.[MQL_FIELD_KEY]) === MQL_YES;
const isSql = (deal: DealItem) => Number(deal.custom_fields?.[SQL_FIELD_KEY]) === SQL_YES;

interface ChannelStats { all: number; mql: number; sql: number }

function aggregateDeals(deals: DealItem[]) {
  const channels: Record<string, ChannelStats> = {};
  for (const label of Object.values(CHANNEL_LABELS)) {
    channels[label] = { all: 0, mql: 0, sql: 0 };
  }
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

// ── Public API ───────────────────────────────────────────────

export interface ScorecardResult {
  weekLabel: string;
  startDate: string;
  endDate: string;
  row: number | null;
  written: boolean;
  ga4: GA4Metrics;
  deals: { total: number; mql: number; sql: number };
  channels: Record<string, ChannelStats>;
  youtubeViews: number;
}

export async function updateScorecard(options: {
  week?: string;
  pipeline?: number;
  dryRun?: boolean;
}): Promise<ScorecardResult> {
  const pipelineId = options.pipeline ?? DEFAULT_PIPELINE;
  const { weekNum, startDate, endDate } = resolveWeek(options.week);

  const [metrics, deals, youtubeViews] = await Promise.all([
    fetchGA4Metrics(startDate, endDate),
    fetchDealsInRange(pipelineId, startDate, endDate, [MQL_FIELD_KEY, SQL_FIELD_KEY]),
    fetchYouTubeViews(startDate, endDate),
  ]);

  const { channels, totalMql, totalSql } = aggregateDeals(deals);
  const label = weekLabel(weekNum);

  const base: ScorecardResult = {
    weekLabel: label,
    startDate,
    endDate,
    row: null,
    written: false,
    ga4: metrics,
    deals: { total: deals.length, mql: totalMql, sql: totalSql },
    channels,
    youtubeViews,
  };

  if (options.dryRun) return base;

  const rowNum = await findRowByWeek(label);
  if (!rowNum) throw new Error(`Row for ${label} not found in column B`);

  const allData: Record<string, string | number> = {
    ...ga4ToRecord(metrics),
    ...dealsToRecord(deals, channels, totalMql, totalSql),
    youtubeViews,
  };

  await updateMappedCells(rowNum, allData, SCORECARD_COLUMN_MAP);

  return { ...base, row: rowNum, written: true };
}
