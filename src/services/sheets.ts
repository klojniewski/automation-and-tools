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
