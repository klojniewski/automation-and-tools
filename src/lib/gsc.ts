import { google } from "googleapis";
import { getGoogleAuth } from "./google-auth.js";
import { GSC_SITE_URL } from "./marketing-config.js";

/**
 * Total clicks from Google Search Console (search type: web) for a date range.
 * Uses dataState "all" (final + fresh) so the number matches what the GSC UI
 * shows — recent days may still settle slightly once data is finalized.
 */
export async function fetchGscClicks(startDate: string, endDate: string): Promise<number> {
  const auth = await getGoogleAuth();
  const gsc = google.searchconsole({ version: "v1", auth });

  const res = await gsc.searchanalytics.query({
    siteUrl: GSC_SITE_URL,
    requestBody: { startDate, endDate, dataState: "all" },
  });

  return Math.round(Number(res.data.rows?.[0]?.clicks ?? 0));
}
