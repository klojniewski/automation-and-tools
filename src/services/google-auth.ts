import fs from "node:fs/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { getEnv } from "../config/env.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

let _authClient: any = null;

export async function getGoogleAuth() {
  if (_authClient) return _authClient;

  const env = getEnv();
  try {
    const tokenContent = await fs.readFile(env.GMAIL_TOKEN_PATH, "utf-8");
    _authClient = google.auth.fromJSON(JSON.parse(tokenContent));
  } catch {
    console.log("No Google token found. Opening browser for OAuth consent...");
    _authClient = await authenticate({
      scopes: SCOPES,
      keyfilePath: env.GMAIL_CREDENTIALS_PATH,
    });
    const keys = JSON.parse(
      await fs.readFile(env.GMAIL_CREDENTIALS_PATH, "utf-8"),
    );
    const key = keys.installed || keys.web;
    await fs.writeFile(
      env.GMAIL_TOKEN_PATH,
      JSON.stringify({
        type: "authorized_user",
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: _authClient.credentials.refresh_token,
      }),
    );
    console.log("Google token saved.");
  }

  return _authClient;
}
