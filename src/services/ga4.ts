import { google, type analyticsdata_v1beta } from "googleapis";
import { getGoogleAuth } from "./google-auth.js";
import { getEnv } from "../config/env.js";
import {
  BOFU_PAGES,
  HOMEPAGE_PATH,
  AI_SOURCES,
  PAID_CHANNEL_GROUPS,
  EXCLUDED_LANDING_PAGES,
} from "../config/marketing.js";

type RunReportRequest =
  analyticsdata_v1beta.Schema$RunReportRequest;
type FilterExpression =
  analyticsdata_v1beta.Schema$FilterExpression;

export interface GA4Metrics {
  totalTraffic: number;
  trafficMinusAdsMinusBlog: number;
  totalBofu: number;
  notPaidBofu: number;
  organic: number;
  referral: number;
  direct: number;
  aiTraffic: number;
  engagementRate: number;
  engagementRateOrganic: number;
  qualityTraffic: number;
  blogTraffic: number;
  paidTraffic: number;
}

// ── Filter helpers ──────────────────────────────────────────

function channelEquals(value: string): FilterExpression {
  return {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      stringFilter: { matchType: "EXACT", value },
    },
  };
}

function channelIn(values: string[]): FilterExpression {
  return {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      inListFilter: { values },
    },
  };
}

function pagePathContains(value: string): FilterExpression {
  return {
    filter: {
      fieldName: "pagePathPlusQueryString",
      stringFilter: { matchType: "CONTAINS", value },
    },
  };
}

function pagePathExact(value: string): FilterExpression {
  return {
    filter: {
      fieldName: "pagePathPlusQueryString",
      stringFilter: { matchType: "EXACT", value },
    },
  };
}

function sourceContains(value: string): FilterExpression {
  return {
    filter: {
      fieldName: "sessionSource",
      stringFilter: { matchType: "CONTAINS", value, caseSensitive: false },
    },
  };
}

/** OR together the BOFU page paths (CONTAINS) plus homepage (EXACT). */
function bofuFilter(): FilterExpression {
  return {
    orGroup: {
      expressions: [
        ...BOFU_PAGES.map(pagePathContains),
        pagePathExact(HOMEPAGE_PATH),
      ],
    },
  };
}

function paidChannelFilter(): FilterExpression {
  return channelIn(PAID_CHANNEL_GROUPS);
}

function notPaidChannel(): FilterExpression {
  return { notExpression: paidChannelFilter() };
}

function blogPageFilter(): FilterExpression {
  return pagePathContains("/blog");
}

function landingPageContains(value: string): FilterExpression {
  return {
    filter: {
      fieldName: "landingPagePlusQueryString",
      stringFilter: { matchType: "CONTAINS", value },
    },
  };
}

function landingPageExact(value: string): FilterExpression {
  return {
    filter: {
      fieldName: "landingPagePlusQueryString",
      stringFilter: { matchType: "EXACT", value },
    },
  };
}

/** Exclude sessions with landing pages matching EXCLUDED_LANDING_PAGES or "(not set)". */
function qualityTrafficFilter(): FilterExpression {
  return {
    andGroup: {
      expressions: [
        ...EXCLUDED_LANDING_PAGES.map((path) => ({
          notExpression: landingPageContains(path),
        })),
        { notExpression: landingPageExact("(not set)") },
      ],
    },
  };
}

// ── Report builders ─────────────────────────────────────────

function baseReport(
  startDate: string,
  endDate: string,
  dimensionFilter?: FilterExpression,
): RunReportRequest {
  return {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: "sessions" }],
    ...(dimensionFilter ? { dimensionFilter } : {}),
  };
}

/**
 * Fetch all 8 marketing metrics from GA4 in two batchRunReports calls.
 * Batch 1 (5 reports): Total, -ADS -Blog, Total BOFU, Not Paid BOFU, Organic
 * Batch 2 (3 reports): Referral, Direct, AI Traffic
 */
export async function fetchGA4Metrics(
  startDate: string,
  endDate: string,
): Promise<GA4Metrics> {
  const auth = await getGoogleAuth();
  const analytics = google.analyticsdata({ version: "v1beta", auth });
  const property = `properties/${getEnv().GA4_PROPERTY_ID}`;

  // ── Batch 1: 5 reports ──
  const batch1 = await analytics.properties.batchRunReports({
    property,
    requestBody: {
      requests: [
        // 0: Total Traffic (no filter)
        baseReport(startDate, endDate),

        // 1: Total BOFU Traffic
        baseReport(startDate, endDate, bofuFilter()),

        // 2: Not Paid BOFU Traffic
        baseReport(startDate, endDate, {
          andGroup: {
            expressions: [bofuFilter(), notPaidChannel()],
          },
        }),

        // 3: Organic Traffic (Search + Social)
        baseReport(startDate, endDate, channelIn(["Organic Search", "Organic Social"])),

        // 4: Quality Traffic — organic only, exclude blog, career, about, case-studies, ebook, not set
        baseReport(startDate, endDate, {
          andGroup: {
            expressions: [
              channelIn(["Organic Search", "Organic Social"]),
              ...qualityTrafficFilter().andGroup!.expressions!,
            ],
          },
        }),
      ],
    },
  });

  // ── Batch 2: 3 reports ──
  const batch2 = await analytics.properties.batchRunReports({
    property,
    requestBody: {
      requests: [
        // 0: Referral Traffic
        baseReport(startDate, endDate, channelEquals("Referral")),

        // 1: Direct Traffic
        baseReport(startDate, endDate, channelEquals("Direct")),

        // 2: AI Traffic (sessions) — source contains any AI string
        {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: "sessions" }],
          dimensionFilter: {
            orGroup: {
              expressions: AI_SOURCES.map(sourceContains),
            },
          },
        },

        // 3: Engagement Rate (overall)
        {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: "engagementRate" }],
        },

        // 4: Engagement Rate — Organic Search only
        {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: "engagementRate" }],
          dimensionFilter: channelEquals("Organic Search"),
        },
      ],
    },
  });

  // ── Batch 3 ──
  const batch3 = await analytics.properties.batchRunReports({
    property,
    requestBody: {
      requests: [
        // 0: Blog Traffic — Organic channels, landing page contains /blog/
        baseReport(startDate, endDate, {
          andGroup: {
            expressions: [
              landingPageContains("/blog/"),
              channelIn(["Organic Search", "Organic Video", "Organic Social", "Organic Shopping"]),
            ],
          },
        }),

        // 1: Paid Traffic
        baseReport(startDate, endDate, paidChannelFilter()),
      ],
    },
  });

  const r1 = batch1.data.reports ?? [];
  const r2 = batch2.data.reports ?? [];
  const r3 = batch3.data.reports ?? [];

  const val = (reports: typeof r1, idx: number): number => {
    const rows = reports[idx]?.rows;
    if (!rows || rows.length === 0) return 0;
    return parseInt(rows[0].metricValues?.[0]?.value ?? "0", 10);
  };

  const referral = val(r2, 0);
  const direct = val(r2, 1);
  const qualityTraffic = val(r1, 4);

  return {
    totalTraffic: val(r1, 0),
    trafficMinusAdsMinusBlog: qualityTraffic + referral + direct,
    totalBofu: val(r1, 1),
    notPaidBofu: val(r1, 2),
    organic: val(r1, 3),
    referral,
    direct,
    aiTraffic: val(r2, 2),
    engagementRate: parseFloat(
      r2[3]?.rows?.[0]?.metricValues?.[0]?.value ?? "0",
    ),
    engagementRateOrganic: parseFloat(
      r2[4]?.rows?.[0]?.metricValues?.[0]?.value ?? "0",
    ),
    qualityTraffic,
    blogTraffic: val(r3, 0),
    paidTraffic: val(r3, 1),
  };
}
