/**
 * Generate a new YouTube OAuth2 refresh token.
 *
 * Usage:
 *   npx tsx scripts/refresh-youtube-token.ts
 *
 * Opens a browser for Google consent, exchanges the code,
 * and prints the new refresh token to paste into Trigger.dev env vars.
 */

import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";
import { exec } from "node:child_process";
import readline from "node:readline";
import "dotenv/config";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

// Use urn:ietf:wg:oauth:2.0:oob-style manual copy/paste flow
// since the registered redirect_uri is http://localhost (port 80, needs root)
const REDIRECT_URI = "http://localhost";

const SCOPES = ["https://www.googleapis.com/auth/yt-analytics.readonly"];

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("Opening browser for Google OAuth consent...");
console.log("IMPORTANT: Switch to the Pagepro brand account before granting access!\n");
exec(`open "${authUrl}"`);

console.log("After granting access, you'll be redirected to http://localhost/?code=...");
console.log("The page will fail to load (that's expected). Copy the 'code' value from the URL bar.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Paste the full redirect URL (or just the code): ", async (input) => {
  rl.close();

  let code = input.trim();

  // If they pasted the full URL, extract the code param
  if (code.startsWith("http")) {
    const url = new URL(code);
    code = url.searchParams.get("code") ?? code;
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    console.log("\n=== New YouTube Refresh Token ===\n");
    console.log(tokens.refresh_token);
    console.log("\n=== Update these places ===");
    console.log("1. .env → GOOGLE_YOUTUBE_REFRESH_TOKEN=<token above>");
    console.log("2. Trigger.dev → Prod env vars → GOOGLE_YOUTUBE_REFRESH_TOKEN");
    console.log("");
  } catch (err) {
    console.error("Token exchange failed:", err);
  }
});
