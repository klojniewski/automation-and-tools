import fs from "node:fs/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google, type gmail_v1 } from "googleapis";
import { getEnv } from "../config/env.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  let auth: any;
  try {
    const tokenContent = await fs.readFile(getEnv().GMAIL_TOKEN_PATH, "utf-8");
    auth = google.auth.fromJSON(JSON.parse(tokenContent));
  } catch {
    console.log("No Gmail token found. Opening browser for OAuth consent...");
    auth = await authenticate({ scopes: SCOPES, keyfilePath: getEnv().GMAIL_CREDENTIALS_PATH });
    const keys = JSON.parse(await fs.readFile(getEnv().GMAIL_CREDENTIALS_PATH, "utf-8"));
    const key = keys.installed || keys.web;
    await fs.writeFile(
      getEnv().GMAIL_TOKEN_PATH,
      JSON.stringify({
        type: "authorized_user",
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: auth.credentials.refresh_token,
      }),
    );
    console.log("Gmail token saved.");
  }
  return google.gmail({ version: "v1", auth });
}

export async function validateGmailCredentials(gmail: gmail_v1.Gmail): Promise<void> {
  await gmail.users.getProfile({ userId: "me" });
}

export async function searchEmails(
  gmail: gmail_v1.Gmail,
  contactEmail: string,
  daysBack: number = 90,
  maxResults: number = 10,
) {
  const afterDate = new Date(Date.now() - daysBack * 86_400_000);
  const after = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, "0")}/${String(afterDate.getDate()).padStart(2, "0")}`;

  const response = await gmail.users.messages.list({
    userId: "me",
    q: `(from:${contactEmail} OR to:${contactEmail}) after:${after}`,
    maxResults,
  });

  const messages = response.data.messages ?? [];
  const details = await Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      const headers = detail.data.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value ?? "";
      return {
        from: getHeader("From"),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        snippet: detail.data.snippet ?? "",
      };
    }),
  );

  return details;
}
