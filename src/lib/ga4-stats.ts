import { fetchGA4Metrics, type GA4Metrics } from "./ga4.js";
import { findRowByWeek, updateMappedCells } from "./sheets.js";
import { METRIC_COLUMN_MAP } from "./marketing-config.js";
import { resolveWeek, weekLabel } from "./week.js";

function metricsToRecord(m: GA4Metrics): Record<string, string | number> {
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

export interface GA4StatsResult {
  weekLabel: string;
  startDate: string;
  endDate: string;
  row: number | null;
  written: boolean;
  metrics: GA4Metrics;
}

export async function getGA4Stats(options: {
  week?: string;
  dryRun?: boolean;
}): Promise<GA4StatsResult> {
  const { weekNum, startDate, endDate } = resolveWeek(options.week);
  const metrics = await fetchGA4Metrics(startDate, endDate);
  const label = weekLabel(weekNum);

  if (options.dryRun) {
    return { weekLabel: label, startDate, endDate, row: null, written: false, metrics };
  }

  const rowNum = await findRowByWeek(label);
  if (!rowNum) throw new Error(`Row for ${label} not found in column B`);

  await updateMappedCells(rowNum, metricsToRecord(metrics), METRIC_COLUMN_MAP);

  return { weekLabel: label, startDate, endDate, row: rowNum, written: true, metrics };
}
