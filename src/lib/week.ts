const TZ = "Europe/Warsaw";

/** Format a Date as YYYY-MM-DD in Poland time. */
export const fmt = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** Parse YYWW format (e.g. "2601" → year 2026, week 1). */
export function parseWeek(yyww: string): { year: number; weekNum: number } {
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
export function weekRange(year: number, weekNum: number): { startDate: string; endDate: string; weekEnding: string } {
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
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
export function lastWeekRange(): { startDate: string; endDate: string; weekEnding: string } {
  const nowStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = new Date(nowStr + "T00:00:00");
  const dayOfWeek = today.getDay();

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

/** Derive week number from a date range's end date. */
export function deriveWeekNum(endDateStr: string): number {
  const endDateObj = new Date(endDateStr + "T00:00:00");
  const year = endDateObj.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const daysBack = (jan1Day + 6) % 7;
  const week1Monday = new Date(jan1);
  week1Monday.setDate(jan1.getDate() - daysBack);
  return Math.floor((endDateObj.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
}

export function weekLabel(weekNum: number): string {
  return `W${weekNum}`;
}

/** Resolve --week option or fall back to last completed week. */
export function resolveWeek(week?: string): {
  weekNum: number;
  startDate: string;
  endDate: string;
  weekEnding: string;
} {
  if (week) {
    const parsed = parseWeek(week);
    const range = weekRange(parsed.year, parsed.weekNum);
    return { weekNum: parsed.weekNum, ...range };
  }
  const range = lastWeekRange();
  return { weekNum: deriveWeekNum(range.endDate), ...range };
}
