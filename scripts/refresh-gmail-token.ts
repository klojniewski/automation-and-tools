/**
 * Generate a new Gmail OAuth2 refresh token with read + compose scopes.
 *
 * Usage:
 *   npx tsx scripts/refresh-gmail-token.ts
 *
 * Opens a browser for Google consent, exchanges the code,
 * and prints the new refresh token to paste into .env and Trigger.dev.
 *
 * Scopes:
 *   - gmail.readonly        → search/read existing messages (used by analyze/deal/followup)
 *   - gmail.compose         → create drafts (used by followup)
 *   - gmail.settings.basic  → read default Gmail signature to append to drafts
 */

import { URL } from "node:url";
import { google } from "googleapis";
import { exec } from "node:child_process";
import readline from "node:readline";
import "dotenv/config";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

const REDIRECT_URI = "http://localhost";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("Opening browser for Google OAuth consent...");
console.log("IMPORTANT: Sign in as your work Gmail account (the one used for deal email threads).\n");
exec(`open "${authUrl}"`);

console.log("After granting access, you'll be redirected to http://localhost/?code=...");
console.log("The page will fail to load (that's expected). Copy the full URL from the address bar.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Paste the full redirect URL (or just the code): ", async (input) => {
  rl.close();

  let code = input.trim();

  if (code.startsWith("http")) {
    const url = new URL(code);
    code = url.searchParams.get("code") ?? code;
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    console.log("\n=== New Gmail Refresh Token ===\n");
    console.log(tokens.refresh_token);
    console.log("\n=== Granted scopes ===");
    console.log(tokens.scope ?? "(unknown)");
    console.log("\n=== Update these places ===");
    console.log("1. .env → GOOGLE_GMAIL_REFRESH_TOKEN=<token above>");
    console.log("2. Trigger.dev → Prod env vars → GOOGLE_GMAIL_REFRESH_TOKEN");
    console.log("");
  } catch (err) {
    console.error("Token exchange failed:", err);
  }
});
