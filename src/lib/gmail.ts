import { google, type gmail_v1 } from "googleapis";
import { getGmailAuth } from "./google-auth.js";

export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const auth = getGmailAuth();
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
        format: "full",
      });
      const headers = detail.data.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value ?? "";
      return {
        id: msg.id!,
        from: getHeader("From"),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        snippet: detail.data.snippet ?? "",
        body: extractTextBody(detail.data.payload),
      };
    }),
  );

  return details;
}

function extractTextBody(payload: any): string {
  if (!payload) return "";

  // Direct text/plain body
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  // Multipart — find text/plain part
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
      // Nested multipart
      if (part.parts) {
        const nested = extractTextBody(part);
        if (nested) return nested;
      }
    }
    // Fallback to text/html if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return stripHtml(decodeBase64(part.body.data));
      }
    }
  }

  return "";
}

function decodeBase64(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
