import { fetchGA4Metrics, type GA4Metrics } from "./ga4.js";
import { fetchDealsInRange } from "./pipedrive.js";
import { fetchYouTubeViewsWithCoverage } from "./youtube.js";
import { fetchGscClicks } from "./gsc.js";
import { findRowByWeek, readCell, updateMappedCells } from "./sheets.js";
import {
  SCORECARD_COLUMN_MAP,
  YOUTUBE_COLUMN_MAP,
  MQL_FIELD_KEY,
  MQL_YES,
  SQL_FIELD_KEY,
  SQL_YES,
  CHANNEL_LABELS,
} from "./marketing-config.js";
import { deriveWeekNum, resolveWeek, weekLabel } from "./week.js";
import type { DealItem } from "pipedrive/v2";

const DEFAULT_PIPELINE = 22;

/**
 * How many weeks BEFORE the target week get their YouTube views re-fetched on
 * every run. YouTube Analytics lags ~2-3 days, so the Tuesday run writes a week
 * without Sunday; the next runs overwrite it with the complete number.
 */
const DEFAULT_YOUTUBE_SETTLE_WEEKS = 3;

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
    organicActiveUsers: m.organicActiveUsers,
    referral: m.referral,
    direct: m.direct,
    aiTraffic: m.aiTraffic,
    engagementRate: `${(m.engagementRate * 100).toFixed(2)}%`,
    engagementRateOrganic: `${(m.engagementRateOrganic * 100).toFixed(2)}%`,
    qualityTraffic: m.qualityTraffic,
    blogTraffic: m.blogTraffic,
    paidTraffic: m.paidTraffic,
    aiFormSent: m.aiFormSent,
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
  /** Days of YouTube data the API had for the target week (7 = complete). */
  youtubeDays: number;
  gscClicks: number;
  /** YouTube re-fetch for the previous weeks (settle pass). */
  youtubeSettle: YouTubeSettleEntry[];
  warnings: string[];
}

export interface YouTubeSettleEntry {
  weekLabel: string;
  startDate: string;
  endDate: string;
  previous: number | null;
  current: number;
  days: number;
  written: boolean;
}

const shiftDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Settle pass: re-fetch YouTube views for the `weeks` weeks before the target
 * week and overwrite ONLY the YouTube cell where the number changed. Idempotent;
 * stops at the year boundary (each year has its own tab / week labels).
 */
async function settleYouTube(
  targetStartDate: string,
  weeks: number,
  dryRun: boolean,
  warnings: string[],
): Promise<YouTubeSettleEntry[]> {
  const entries: YouTubeSettleEntry[] = [];
  const targetYear = targetStartDate.slice(0, 4);
  for (let i = 1; i <= weeks; i++) {
    const startDate = shiftDays(targetStartDate, -7 * i);
    const endDate = shiftDays(startDate, 6);
    if (endDate.slice(0, 4) !== targetYear) break;
    const label = weekLabel(deriveWeekNum(endDate));

    const rowNum = await findRowByWeek(label);
    if (!rowNum) {
      warnings.push(`YouTube settle: row for ${label} not found, skipped`);
      continue;
    }
    const [cell, yt] = await Promise.all([
      readCell(`${YOUTUBE_COLUMN_MAP.youtubeViews}${rowNum}`),
      fetchYouTubeViewsWithCoverage(startDate, endDate),
    ]);
    const previous = cell === null || Number.isNaN(Number(cell)) ? null : Number(cell);
    if (yt.days < yt.expectedDays) {
      warnings.push(`${label} YouTube still partial: ${yt.days}/${yt.expectedDays} days`);
    }
    const changed = previous !== yt.views;
    if (changed && !dryRun) {
      await updateMappedCells(rowNum, { youtubeViews: yt.views }, YOUTUBE_COLUMN_MAP);
    }
    entries.push({ weekLabel: label, startDate, endDate, previous, current: yt.views, days: yt.days, written: changed && !dryRun });
  }
  return entries;
}

export async function updateScorecard(options: {
  week?: string;
  pipeline?: number;
  dryRun?: boolean;
  /** Weeks before the target week whose YouTube views are re-fetched (default 3, 0 = off). */
  settleWeeks?: number;
}): Promise<ScorecardResult> {
  const pipelineId = options.pipeline ?? DEFAULT_PIPELINE;
  const settleWeeks = options.settleWeeks ?? DEFAULT_YOUTUBE_SETTLE_WEEKS;
  const { weekNum, startDate, endDate } = resolveWeek(options.week);

  const [metrics, deals, yt, gscClicks] = await Promise.all([
    fetchGA4Metrics(startDate, endDate),
    fetchDealsInRange(pipelineId, startDate, endDate, [MQL_FIELD_KEY, SQL_FIELD_KEY]),
    fetchYouTubeViewsWithCoverage(startDate, endDate),
    fetchGscClicks(startDate, endDate),
  ]);
  const youtubeViews = yt.views;
  const warnings: string[] = [];
  if (yt.days < yt.expectedDays) {
    warnings.push(
      `${weekLabel(weekNum)} YouTube partial: ${yt.days}/${yt.expectedDays} days (API lags ~2-3 days; later runs settle it)`,
    );
  }

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
    youtubeDays: yt.days,
    gscClicks,
    youtubeSettle: [],
    warnings,
  };

  if (options.dryRun) {
    const youtubeSettle = await settleYouTube(startDate, settleWeeks, true, warnings);
    return { ...base, youtubeSettle };
  }

  const rowNum = await findRowByWeek(label);
  if (!rowNum) throw new Error(`Row for ${label} not found in column B`);

  const allData: Record<string, string | number> = {
    ...ga4ToRecord(metrics),
    ...dealsToRecord(deals, channels, totalMql, totalSql),
    youtubeViews,
    // gscClicks is written only once its column mapping exists in SCORECARD_COLUMN_MAP
    // (updateMappedCells silently skips keys with no mapped column)
    gscClicks,
  };

  await updateMappedCells(rowNum, allData, SCORECARD_COLUMN_MAP);
  const youtubeSettle = await settleYouTube(startDate, settleWeeks, false, warnings);
  for (const w of warnings) console.warn(`[scorecard] ${w}`);

  return { ...base, row: rowNum, written: true, youtubeSettle };
}
