import { fetchDealsInRange } from "./pipedrive.js";
import { findRowByWeek, updateMappedCells } from "./sheets.js";
import {
  DEALS_COLUMN_MAP,
  MQL_FIELD_KEY,
  MQL_YES,
  SQL_FIELD_KEY,
  SQL_YES,
  CHANNEL_LABELS,
} from "./marketing-config.js";
import { resolveWeek, weekLabel } from "./week.js";
import type { DealItem } from "pipedrive/v2";

const DEFAULT_PIPELINE = 22;

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

export interface PipedriveDealsResult {
  weekLabel: string;
  startDate: string;
  endDate: string;
  row: number | null;
  written: boolean;
  dealsCreated: number;
  totalMql: number;
  totalSql: number;
  channels: Record<string, ChannelStats>;
  deals: Array<{
    title: string;
    channel: string;
    isMql: boolean;
    isSql: boolean;
  }>;
}

export async function getPipedriveDeals(options: {
  week?: string;
  pipeline?: number;
  dryRun?: boolean;
}): Promise<PipedriveDealsResult> {
  const pipelineId = options.pipeline ?? DEFAULT_PIPELINE;
  const { weekNum, startDate, endDate } = resolveWeek(options.week);

  const rawDeals = await fetchDealsInRange(pipelineId, startDate, endDate, [MQL_FIELD_KEY, SQL_FIELD_KEY]);
  const { channels, totalMql, totalSql } = aggregateDeals(rawDeals);
  const label = weekLabel(weekNum);

  const deals = rawDeals.map((deal) => {
    const ch = deal.channel;
    const chKey = ch != null ? String(ch) : "Unknown";
    return {
      title: deal.title ?? "Untitled",
      channel: CHANNEL_LABELS[chKey] ?? chKey,
      isMql: isMql(deal),
      isSql: isSql(deal),
    };
  });

  const base: PipedriveDealsResult = {
    weekLabel: label,
    startDate,
    endDate,
    row: null,
    written: false,
    dealsCreated: rawDeals.length,
    totalMql,
    totalSql,
    channels,
    deals,
  };

  if (options.dryRun) return base;

  const rowNum = await findRowByWeek(label);
  if (!rowNum) throw new Error(`Row for ${label} not found in column B`);

  const data: Record<string, number> = {
    dealsCreated: rawDeals.length,
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

  await updateMappedCells(rowNum, data, DEALS_COLUMN_MAP);

  return { ...base, row: rowNum, written: true };
}
