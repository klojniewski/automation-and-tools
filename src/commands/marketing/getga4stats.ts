import { fetchGA4Metrics, type GA4Metrics } from "../../services/ga4.js";
import { appendRow, getColumnAValues } from "../../services/sheets.js";
import { METRIC_LABELS } from "../../config/marketing.js";

export interface GetGA4StatsOptions {
  week?: string;
  dryRun: boolean;
  verbose: boolean;
}

const TZ = "Europe/Warsaw";

/** Format a Date as YYYY-MM-DD in Poland time. */
const fmt = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA gives YYYY-MM-DD
};

/** Get "today" in Poland timezone as a Date (midnight UTC, but date components match Warsaw). */
function todayInWarsaw(): Date {
  const nowStr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(nowStr + "T00:00:00");
}

/**
 * Parse YYWW format (e.g. "2601" → year 2026, week 1).
 * Weeks run Sun–Sat. Week 1 contains Jan 1.
 * e.g. w1 2026 = 2025-12-28 (Sun) – 2026-01-03 (Sat)
 */
function parseWeek(yyww: string): { year: number; weekNum: number } {
  if (!/^\d{4}$/.test(yyww)) {
    throw new Error(`Invalid week format "${yyww}". Expected YYWW, e.g. 2601`);
  }
  const year = 2000 + parseInt(yyww.slice(0, 2), 10);
  const weekNum = parseInt(yyww.slice(2), 10);
  if (weekNum < 1 || weekNum > 53) {
    throw new Error(`Week number ${weekNum} out of range (1-53)`);
  }
  return { year, weekNum };
}

/** Return Mon–Sun range for a given week number in a given year. Week 1 contains Jan 1. */
function weekRange(year: number, weekNum: number): { startDate: string; endDate: string; weekEnding: string } {
  // Find the Monday on or before Jan 1 — that's the start of week 1.
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay(); // 0=Sun … 6=Sat
  // Days to go back to reach Monday: Sun(0)→6, Mon(1)→0, Tue(2)→1, …, Sat(6)→5
  const daysBack = (jan1Day + 6) % 7;
  const week1Monday = new Date(jan1);
  week1Monday.setDate(jan1.getDate() - daysBack);

  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    startDate: fmt(monday),
    endDate: fmt(sunday),
    weekEnding: fmt(sunday),
  };
}

/** Return Mon–Sun range for last completed week (Poland time). */
function lastWeekRange(): { startDate: string; endDate: string; weekEnding: string } {
  const today = todayInWarsaw();
  const dayOfWeek = today.getDay(); // 0=Sun … 6=Sat

  // Last Sunday: go back dayOfWeek days (if today is Sun, go back 7)
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));

  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);

  return {
    startDate: fmt(lastMonday),
    endDate: fmt(lastSunday),
    weekEnding: fmt(lastSunday),
  };
}

function metricsToRow(weekEnding: string, m: GA4Metrics): (string | number)[] {
  return [
    weekEnding,
    m.totalTraffic,
    m.trafficMinusAdsMinusBlog,
    m.totalBofu,
    m.notPaidBofu,
    m.organic,
    m.referral,
    m.direct,
    m.aiTraffic,
    `${(m.engagementRate * 100).toFixed(2)}%`,
  ];
}

function printMetrics(startDate: string, weekEnding: string, m: GA4Metrics): void {
  const values: (number | string)[] = [
    m.totalTraffic,
    m.trafficMinusAdsMinusBlog,
    m.totalBofu,
    m.notPaidBofu,
    m.organic,
    m.referral,
    m.direct,
    m.aiTraffic,
    `${(m.engagementRate * 100).toFixed(2)}%`,
  ];

  console.log(`\nWeek: ${startDate} – ${weekEnding}\n`);
  for (let i = 0; i < METRIC_LABELS.length; i++) {
    console.log(`  ${METRIC_LABELS[i].padEnd(22)} ${values[i]}`);
  }
  console.log();
}

export async function runGetGA4Stats(options: GetGA4StatsOptions): Promise<void> {
  const { startDate, endDate, weekEnding } = options.week
    ? (() => { const { year, weekNum } = parseWeek(options.week); return weekRange(year, weekNum); })()
    : lastWeekRange();

  if (options.verbose) {
    console.log(`Date range: ${startDate} to ${endDate}`);
  }

  // Fetch metrics from GA4
  console.log("Fetching GA4 metrics...");
  const metrics = await fetchGA4Metrics(startDate, endDate);
  printMetrics(startDate, weekEnding, metrics);

  if (options.dryRun) {
    console.log("[DRY RUN] Skipping Google Sheet write.");
    return;
  }

  // Check for duplicate week
  console.log("Checking for duplicate week...");
  const existing = await getColumnAValues();
  if (existing.includes(weekEnding)) {
    console.error(`Row for week ending ${weekEnding} already exists. Skipping.`);
    return;
  }

  // Append to sheet
  console.log("Writing to Google Sheet...");
  await appendRow(metricsToRow(weekEnding, metrics));
  console.log(`Row appended for week ending ${weekEnding}.`);
}
