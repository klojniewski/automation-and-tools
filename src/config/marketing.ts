/** BOFU (bottom-of-funnel) page paths — sessions on these pages indicate high-intent traffic. */
export const BOFU_PAGES = [
  "/services/nextjs-development",
  "/services/expo-development",
  "/services/reactjs-development",
  "/services/sanity-development",
  "/services/react-native-development",
];

/** Homepage is tracked separately because it uses EXACT match instead of CONTAINS. */
export const HOMEPAGE_PATH = "/";

/** Source strings that indicate AI-referred traffic. */
export const AI_SOURCES = [
  "chatgpt",
  "claude",
  "gemini",
  "perplexity",
  "copilot",
  "deepseek",
];

/** Default channel groups considered "paid". */
export const PAID_CHANNEL_GROUPS = [
  "Paid Shopping",
  "Paid Search",
  "Paid Social",
  "Paid Other",
  "Paid Video",
  "Display",
  "Cross-network",
  "Audio",
];

/** Landing page paths to exclude from the "quality traffic" metric. */
export const EXCLUDED_LANDING_PAGES = [
  "/blog/",
  "/career",
  "/about",
  "/case-studies",
  "/ebook",
];

/** Maps GA4 metric keys to Google Sheet column letters. */
export const METRIC_COLUMN_MAP: Record<string, string> = {
  totalTraffic:             "C",
  // trafficMinusAdsMinusBlog: "ZD",
  // totalBofu:                "ZE",
  // notPaidBofu:              "ZF",
  // organic:                  "ZG",
  referral:                 "N",
  direct:                   "P",
  aiTraffic:                "S",
  // engagementRate:           "ZK",
  // engagementRateOrganic:    "ZL",
  qualityTraffic:           "J",
  blogTraffic:              "L",
  paidTraffic:              "R",
};

/**
 * Pipedrive custom field keys and option IDs.
 * MQL field: a1895ec07503153d87d3463114b2c65208b5750c  (YES = 239, NO = 240)
 * SQL field: afe6d8d6ea61183f815a42c764864c2dd9413c9d  (YES = 226, NO = 225)
 */
export const MQL_FIELD_KEY = "a1895ec07503153d87d3463114b2c65208b5750c";
export const MQL_YES = 239;
export const SQL_FIELD_KEY = "afe6d8d6ea61183f815a42c764864c2dd9413c9d";
export const SQL_YES = 226;

/**
 * Pipedrive marketing channel ID → display label.
 * IDs from https://pagepro.pipedrive.com settings:
 *   390 = Website / Organic
 *   389 = Referral / Network
 *   387 = AI Search
 *   323 = Outreach
 *   388 = Paid Search
 *   318 = Marketplaces
 */
export const CHANNEL_LABELS: Record<string, string> = {
  "390": "Website / Organic",
  "389": "Referral / Network",
  "387": "AI Search",
  "323": "Outreach",
  "388": "Paid Search",
  "318": "Marketplaces",
};

/**
 * Maps Pipedrive deals metric keys to Google Sheet column letters.
 * Each channel has 3 columns: All / MQL / SQL.
 */
export const DEALS_COLUMN_MAP: Record<string, string> = {
  dealsCreated:      "AG",  // Total deals created in pipeline
  mql:               "AH",  // Total MQL
  sql:               "AI",  // Total SQL
  // ── Website / Organic (390) ──
  // channel_390:       "AF",  // All
  channel_390_mql:   "U",  // MQL
  channel_390_sql:   "V",  // SQL
  // ── Referral / Network (389) ──
  // channel_389:       "AI",  // All
  channel_389_mql:   "Y",  // MQL
  channel_389_sql:   "Z",  // SQL
  // ── AI Search (387) ──
  // channel_387:       "AL",  // All
  channel_387_mql:   "W",  // MQL
  channel_387_sql:   "X",  // SQL
  // ── Outreach (323) ──
  // channel_323:       "AO",  // All
  channel_323_mql:   "AE",  // MQL
  channel_323_sql:   "AF",  // SQL
  // ── Paid Search (388) ──
  // channel_388:       "AR",  // All
  channel_388_mql:   "AA",  // MQL
  channel_388_sql:   "AB",  // SQL
  // ── Marketplaces (318) ──
  // channel_318:       "AU",  // All
  channel_318_mql:   "AC",  // MQL
  channel_318_sql:   "AD",  // SQL
};

/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  SCORECARD_COLUMN_MAP — unified map for `updateScorecard`      │
 * │                                                                │
 * │  UPDATE THE COLUMN LETTERS BELOW to match your spreadsheet.    │
 * │  Key = data field name, Value = column letter in the sheet.    │
 * │  Set a value to "" or remove the line to skip writing it.      │
 * └─────────────────────────────────────────────────────────────────┘
 */
export const SCORECARD_COLUMN_MAP: Record<string, string> = {
  // ── GA4 metrics ──────────────────────────────────────────
  totalTraffic:             "C",   // Total sessions
  // trafficMinusAdsMinusBlog: "",  // Traffic minus Ads minus Blog
  // totalBofu:              "",    // Total BOFU sessions
  // notPaidBofu:            "",    // Not-paid BOFU sessions
  // organic:                "",    // Organic Search + Organic Social
  referral:                 "N",   // Referral channel sessions
  direct:                   "P",   // Direct channel sessions
  aiTraffic:                "S",   // AI-referred sessions (ChatGPT, Claude, etc.)
  // engagementRate:         "",    // Overall engagement rate (%)
  // engagementRateOrganic:  "",    // Organic engagement rate (%)
  qualityTraffic:           "J",   // Organic sessions excl. blog/career/about/etc.
  blogTraffic:              "L",   // Organic sessions on /blog/ pages
  paidTraffic:              "R",   // Paid channel sessions

  // ── Pipedrive deals ──────────────────────────────────────
  dealsCreated:             "AG",  // Total deals created
  mql:                      "AH",  // Total MQL
  sql:                      "AI",  // Total SQL
  // ── Website / Organic (390) ──
  // channel_390:            "",    // All (not mapped)
  channel_390_mql:          "U",   // MQL
  channel_390_sql:          "V",   // SQL
  // ── Referral / Network (389) ──
  // channel_389:            "",    // All (not mapped)
  channel_389_mql:          "Y",   // MQL
  channel_389_sql:          "Z",   // SQL
  // ── AI Search (387) ──
  // channel_387:            "",    // All (not mapped)
  channel_387_mql:          "W",   // MQL
  channel_387_sql:          "X",   // SQL
  // ── Outreach (323) ──
  // channel_323:            "",    // All (not mapped)
  channel_323_mql:          "AE",  // MQL
  channel_323_sql:          "AF",  // SQL
  // ── Paid Search (388) ──
  // channel_388:            "",    // All (not mapped)
  channel_388_mql:          "AA",  // MQL
  channel_388_sql:          "AB",  // SQL
  // ── Marketplaces (318) ──
  // channel_318:            "",    // All (not mapped)
  channel_318_mql:          "AC",  // MQL
  channel_318_sql:          "AD",  // SQL
};

/** Metric labels in the order they appear in the Google Sheet columns. */
export const METRIC_LABELS = [
  "Total Traffic",
  "Traffic (-ADS -Blog)",
  "Total BOFU",
  "Not Paid BOFU",
  "Organic",
  "Referral",
  "Direct",
  "AI Traffic",
  "Engagement Rate",
  "Eng. Rate Organic",
  "Quality Traffic",
  "Blog Traffic",
  "Paid Traffic",
] as const;
