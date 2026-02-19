import { fetchYouTubeViews } from "./youtube.js";
import { findRowByWeek, updateMappedCells } from "./sheets.js";
import { YOUTUBE_COLUMN_MAP } from "./marketing-config.js";
import { resolveWeek, weekLabel } from "./week.js";

export interface YouTubeStatsResult {
  weekLabel: string;
  startDate: string;
  endDate: string;
  row: number | null;
  written: boolean;
  youtubeViews: number;
}

export async function getYouTubeStats(options: {
  week?: string;
  dryRun?: boolean;
}): Promise<YouTubeStatsResult> {
  const { weekNum, startDate, endDate } = resolveWeek(options.week);
  const youtubeViews = await fetchYouTubeViews(startDate, endDate);
  const label = weekLabel(weekNum);

  if (options.dryRun) {
    return { weekLabel: label, startDate, endDate, row: null, written: false, youtubeViews };
  }

  const rowNum = await findRowByWeek(label);
  if (!rowNum) throw new Error(`Row for ${label} not found in column B`);

  await updateMappedCells(rowNum, { youtubeViews }, YOUTUBE_COLUMN_MAP);

  return { weekLabel: label, startDate, endDate, row: rowNum, written: true, youtubeViews };
}
