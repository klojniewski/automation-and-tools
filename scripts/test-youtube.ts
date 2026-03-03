import "dotenv/config";
import { fetchYouTubeViews } from "../src/lib/youtube.js";
import { resolveWeek } from "../src/lib/week.js";
import { google } from "googleapis";
import { getYouTubeAuth } from "../src/lib/google-auth.js";

async function main() {
  const { startDate, endDate, weekNum } = resolveWeek("2609");
  console.log("Week", weekNum, "→", startDate, "to", endDate);

  // First, get the raw API response for debugging
  const auth = getYouTubeAuth();
  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  const res = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: "views",
  });

  console.log("\nRaw API response:");
  console.log(JSON.stringify(res.data, null, 2));

  // Then the wrapper
  const views = await fetchYouTubeViews(startDate, endDate);
  console.log("\nfetchYouTubeViews result:", views);
}

main().catch(console.error);
