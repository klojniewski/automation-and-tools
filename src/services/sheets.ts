import { google } from "googleapis";
import { getGoogleAuth } from "./google-auth.js";
import { getEnv } from "../config/env.js";

async function getSheetsClient() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: "v4", auth });
}

/** Append a single row of values to the configured sheet. */
export async function appendRow(values: (string | number)[]): Promise<void> {
  const sheets = await getSheetsClient();
  const env = getEnv();

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${env.GOOGLE_SHEETS_TAB}!A:A`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

/** Read all values from column A (used for duplicate-week detection). */
export async function getColumnAValues(): Promise<string[]> {
  const sheets = await getSheetsClient();
  const env = getEnv();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${env.GOOGLE_SHEETS_TAB}!A:A`,
  });

  return (res.data.values ?? []).flat().map(String);
}

/**
 * Find the row number where column B matches the given week label (e.g. "W5").
 * Returns the 1-based row number, or null if not found.
 */
export async function findRowByWeek(weekLabel: string): Promise<number | null> {
  const sheets = await getSheetsClient();
  const env = getEnv();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${env.GOOGLE_SHEETS_TAB}!B1:B200`,
    valueRenderOption: "FORMATTED_VALUE",
    majorDimension: "COLUMNS",
  });

  // majorDimension=COLUMNS returns a single array including empty cells as ""
  const values = (res.data.values?.[0] ?? []).map(String);
  const idx = values.indexOf(weekLabel);
  return idx === -1 ? null : idx + 1; // 1-based row number
}

/**
 * Write specific cells in a given row using the column mapping.
 * Only touches the columns defined in the map — other cells in the row are untouched.
 */
export async function updateMappedCells(
  rowNum: number,
  data: Record<string, string | number>,
  columnMap: Record<string, string>,
): Promise<void> {
  const sheets = await getSheetsClient();
  const env = getEnv();

  const valueRanges = Object.entries(data)
    .filter(([key]) => columnMap[key])
    .map(([key, value]) => ({
      range: `${env.GOOGLE_SHEETS_TAB}!${columnMap[key]}${rowNum}`,
      values: [[value]],
    }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: valueRanges,
    },
  });
}
