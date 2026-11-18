import type { DealItem } from "pipedrive/v2";
import { fmt } from "./week.js";

/**
 * "SQL Gen Value" — the PLN value of the deals flagged SQL in a set of deals.
 *
 * Each deal's current value is converted with the NBP mid rate (table A) that was
 * in force on the day the deal was created, so a week's number does not drift
 * with the exchange rate. It still follows the deal: a value edited in Pipedrive,
 * or an SQL flag set later, changes the number the next time that week is fetched.
 */

const NBP_URL = "https://api.nbp.pl/api/exchangerates/rates/a";

/** NBP publishes no table on weekends and holidays; look back this many days for the last one. */
const LOOKBACK_DAYS = 10;

const rateCache = new Map<string, Promise<number>>();

const shiftDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function fetchPlnRate(currency: string, isoDate: string): Promise<number> {
  const from = shiftDays(isoDate, -LOOKBACK_DAYS);
  const res = await fetch(`${NBP_URL}/${currency.toLowerCase()}/${from}/${isoDate}/?format=json`);
  if (!res.ok) {
    throw new Error(`NBP rate ${currency} for ${isoDate}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { rates?: Array<{ effectiveDate: string; mid: number }> };
  const last = body.rates?.at(-1);
  if (!last) throw new Error(`NBP rate ${currency} for ${isoDate}: empty response`);
  return last.mid;
}

/** PLN per 1 unit of `currency`, as published by NBP on `isoDate` or the last table before it. */
export function plnRate(currency: string, isoDate: string): Promise<number> {
  const code = currency.toUpperCase();
  if (code === "PLN") return Promise.resolve(1);
  const key = `${code}:${isoDate}`;
  let cached = rateCache.get(key);
  if (!cached) {
    cached = fetchPlnRate(code, isoDate);
    cached.catch(() => rateCache.delete(key));
    rateCache.set(key, cached);
  }
  return cached;
}

export interface SqlValueDeal {
  id: number | undefined;
  title: string;
  createdOn: string;
  value: number;
  currency: string;
  rate: number;
  valuePln: number;
}

export interface SqlValueResult {
  /** Rounded PLN total, or null when a rate could not be fetched (the cell is then left untouched). */
  totalPln: number | null;
  deals: SqlValueDeal[];
  warnings: string[];
}

export async function computeSqlGenValue(sqlDeals: DealItem[]): Promise<SqlValueResult> {
  const deals: SqlValueDeal[] = [];
  const warnings: string[] = [];
  let failed = false;

  for (const deal of sqlDeals) {
    const value = Number(deal.value ?? 0);
    const currency = (deal.currency ?? "PLN").toUpperCase();
    const createdOn = deal.add_time ? fmt(new Date(deal.add_time)) : "";
    const title = deal.title ?? "Untitled";
    if (!createdOn) {
      failed = true;
      warnings.push(`SQL Gen Value: deal "${title}" has no creation date`);
      continue;
    }
    try {
      const rate = value === 0 ? 1 : await plnRate(currency, createdOn);
      deals.push({ id: deal.id, title, createdOn, value, currency, rate, valuePln: value * rate });
    } catch (err) {
      failed = true;
      warnings.push(`SQL Gen Value: ${err instanceof Error ? err.message : String(err)} (deal "${title}")`);
    }
  }

  if (failed) {
    warnings.push("SQL Gen Value not written: fix the cause above and re-run the week");
    return { totalPln: null, deals, warnings };
  }
  return { totalPln: Math.round(deals.reduce((sum, d) => sum + d.valuePln, 0)), deals, warnings };
}
