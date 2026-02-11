import { google, type Auth } from "googleapis";

const SA_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

let _saClient: Auth.OAuth2Client | Auth.GoogleAuth | null = null;

/**
 * Service-account auth for GA4 + Sheets.
 * Reads GOOGLE_SERVICE_ACCOUNT_KEY (JSON or base64-encoded JSON) from env.
 * Returns a GoogleAuth instance typed to work with googleapis client factories.
 */
export function getGoogleAuth(): Auth.GoogleAuth {
  if (_saClient) return _saClient as Auth.GoogleAuth;

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set");
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8"));
  }

  const auth = new google.auth.GoogleAuth({ credentials, scopes: SA_SCOPES });
  _saClient = auth;
  return auth;
}

let _gmailAuth: Auth.OAuth2Client | null = null;

/**
 * OAuth2 auth for Gmail (service accounts can't access personal Gmail).
 * Uses a stored refresh token reconstructed from env vars.
 */
export function getGmailAuth(): Auth.OAuth2Client {
  if (_gmailAuth) return _gmailAuth;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail OAuth env vars missing: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GMAIL_REFRESH_TOKEN",
    );
  }

  _gmailAuth = new google.auth.OAuth2(clientId, clientSecret);
  _gmailAuth.setCredentials({ refresh_token: refreshToken });
  return _gmailAuth;
}
