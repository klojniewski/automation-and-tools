import { google } from "googleapis";
import { getYouTubeAuth } from "./google-auth.js";

/**
 * Fetch total YouTube channel views for a date range via YouTube Analytics API v2.
 */
export async function fetchYouTubeViews(
  startDate: string,
  endDate: string,
): Promise<number> {
  const auth = getYouTubeAuth();
  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  const res = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: "views",
  });

  const rows = res.data.rows;
  if (!rows || rows.length === 0) return 0;
  return Number(rows[0][0]) || 0;
}
