import { google } from "googleapis";
import { getYouTubeAuth } from "./google-auth.js";

/**
 * Fetch total YouTube channel views for a date range via YouTube Analytics API v2.
 */
export async function fetchYouTubeViews(
  startDate: string,
  endDate: string,
): Promise<number> {
  return (await fetchYouTubeViewsWithCoverage(startDate, endDate)).views;
}

/**
 * Views for a date range plus how many days the API actually has data for.
 * YouTube Analytics lags ~2-3 days behind YouTube Studio, so a week fetched on
 * Tuesday usually lacks Sunday: `days < expectedDays` means the total is partial
 * and will grow once the missing days land (see the scorecard settle pass).
 */
export async function fetchYouTubeViewsWithCoverage(
  startDate: string,
  endDate: string,
): Promise<{ views: number; days: number; expectedDays: number }> {
  const auth = getYouTubeAuth();
  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  const res = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: "views",
    dimensions: "day",
  });

  const rows = res.data.rows ?? [];
  const views = rows.reduce((sum, row) => sum + (Number(row[1]) || 0), 0);
  const expectedDays =
    Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
  return { views, days: rows.length, expectedDays };
}
