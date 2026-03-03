import "dotenv/config";
import { google } from "googleapis";
import { getYouTubeAuth } from "../src/lib/google-auth.js";

async function main() {
  const auth = getYouTubeAuth();
  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  // Query a known period with views (e.g. last 30 days) to see if we get any data
  const res = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: "2026-01-01",
    endDate: "2026-03-01",
    metrics: "views,estimatedMinutesWatched,subscribersGained",
    dimensions: "month",
  });

  console.log("YouTube Analytics - monthly breakdown (Jan-Mar 2026):");
  console.log(JSON.stringify(res.data, null, 2));

  // Also try fetching just total views for a wider range
  const total = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: "2025-01-01",
    endDate: "2026-03-01",
    metrics: "views",
  });

  console.log("\nTotal views 2025-01-01 to 2026-03-01:");
  console.log(JSON.stringify(total.data, null, 2));
}

main().catch(console.error);
