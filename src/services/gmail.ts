import { google, type gmail_v1 } from "googleapis";
import { getGoogleAuth } from "./google-auth.js";

export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const auth = await getGoogleAuth();
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
