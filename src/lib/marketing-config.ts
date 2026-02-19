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
  totalBofu:                "H",
  notPaidBofu:              "J",
  engagementRate:           "N",
  engagementRateOrganic:    "O",
  qualityTraffic:           "P",
  blogTraffic:              "R",
  referral:                 "T",
  direct:                   "V",
  paidTraffic:              "X",
  aiTraffic:                "Y",
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
 */
export const DEALS_COLUMN_MAP: Record<string, string> = {
  dealsCreated:      "AM",
  mql:               "AN",
  sql:               "AO",
  channel_390_mql:   "AA",//Website / Organic
  channel_390_sql:   "AB",//Website / Organic
  channel_389_mql:   "AE",//Referral / Network
  channel_389_sql:   "AF",//Referral / Network
  channel_387_mql:   "AC",//AI Search
  channel_387_sql:   "AD",//AI Search
  channel_323_mql:   "AK",//Outreach
  channel_323_sql:   "AL",//Outreach
  channel_388_mql:   "AG",//Paid Search
  channel_388_sql:   "AH",//Paid Search
  channel_318_mql:   "AI",//Marketplaces
  channel_318_sql:   "AJ",//Marketplaces
};

/** Maps YouTube metric keys to Google Sheet column letters. */
export const YOUTUBE_COLUMN_MAP: Record<string, string> = {
  youtubeViews: "Z",
};

/**
 * Unified column map for `updateScorecard` — GA4 + Pipedrive + YouTube combined.
 */
export const SCORECARD_COLUMN_MAP: Record<string, string> = {
  // GA4 metrics
  totalTraffic:             "C",
  totalBofu:                "H",
  notPaidBofu:              "J",
  engagementRate:           "N",
  engagementRateOrganic:    "O",
  qualityTraffic:           "P",
  blogTraffic:              "R",
  referral:                 "T",
  direct:                   "V",
  paidTraffic:              "X",
  aiTraffic:                "Y",

  // YouTube
  youtubeViews:             "Z",

  // Pipedrive deals
  channel_390_mql:          "AA", // Website / Organic
  channel_390_sql:          "AB", // Website / Organic
  channel_387_mql:          "AC", // AI Search
  channel_387_sql:          "AD", // AI Search
  channel_389_mql:          "AE", // Referral / Network
  channel_389_sql:          "AF", // Referral / Network
  channel_388_mql:          "AG", // Paid Search
  channel_388_sql:          "AH", // Paid Search
  channel_318_mql:          "AI", // Marketplaces
  channel_318_sql:          "AJ", // Marketplaces
  channel_323_mql:          "AK", // Outreach
  channel_323_sql:          "AL", // Outreach
  dealsCreated:             "AM",
  mql:                      "AN",
  sql:                      "AO",
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
