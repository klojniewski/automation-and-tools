import { google, type gmail_v1 } from "googleapis";
import { getGmailAuth } from "./google-auth.js";

export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const auth = getGmailAuth();
  return google.gmail({ version: "v1", auth });
}

export async function validateGmailCredentials(gmail: gmail_v1.Gmail): Promise<void> {
  await gmail.users.getProfile({ userId: "me" });
}

export async function getGmailUserEmail(gmail: gmail_v1.Gmail): Promise<string> {
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress ?? "";
}

let _cachedSignature: string | null | undefined;

export async function getDefaultSignatureHtml(gmail: gmail_v1.Gmail): Promise<string | null> {
  if (_cachedSignature !== undefined) return _cachedSignature;
  try {
    const res = await gmail.users.settings.sendAs.list({ userId: "me" });
    const sendAs = res.data.sendAs ?? [];
    const primary = sendAs.find((s) => s.isPrimary) ?? sendAs[0];
    _cachedSignature = primary?.signature ?? null;
  } catch {
    _cachedSignature = null;
  }
  return _cachedSignature;
}

function plainTextToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Removes a trailing sign-off block ("Best,\nChris", "Cheers,\nChris", etc.)
 * from the end of an email body. Used when a Gmail signature — which already
 * contains its own sign-off — is appended, to avoid a duplicate valediction.
 */
function stripTrailingSignoff(body: string): string {
  return body
    .replace(
      /\n+\s*(best|best regards|kind regards|warm regards|regards|cheers|thanks|thank you|all the best|talk soon|speak soon)[,.!]?\s*(\n+[^\n]{0,40})?\s*$/i,
      "",
    )
    .trimEnd();
}

export async function createDraft(
  gmail: gmail_v1.Gmail,
  opts: {
    to: string;
    subject: string;
    body: string;
    appendSignature?: boolean;
    threadId?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
  },
): Promise<{ id: string; messageId: string | null; threadId: string | null; url: string | null; signatureAppended: boolean; attachedToThread: boolean }> {
  const appendSig = opts.appendSignature !== false;
  const signatureHtml = appendSig ? await getDefaultSignatureHtml(gmail) : null;

  // The signature carries its own sign-off ("Best, Chris ...") — strip the
  // model's trailing sign-off so it doesn't appear twice.
  const body = signatureHtml ? stripTrailingSignoff(opts.body) : opts.body;

  const bodyHtml = signatureHtml
    ? `${plainTextToHtml(body)}\n<br>\n${signatureHtml}`
    : plainTextToHtml(body);

  const headers = [
    `To: ${opts.to}`,
    `Subject: ${encodeSubject(opts.subject)}`,
    "Content-Type: text/html; charset=UTF-8",
    "MIME-Version: 1.0",
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${bodyHtml}`)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const message: gmail_v1.Schema$Message = { raw };
  if (opts.threadId) message.threadId = opts.threadId;

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message },
  });
  const messageId = res.data.message?.id ?? null;
  return {
    id: res.data.id ?? "",
    messageId,
    threadId: res.data.message?.threadId ?? null,
    url: messageId ? `https://mail.google.com/mail/u/0/#drafts/${messageId}` : null,
    signatureAppended: !!signatureHtml,
    attachedToThread: !!opts.threadId,
  };
}

function encodeSubject(subject: string): string {
  // RFC 2047 encode if subject contains non-ASCII; otherwise leave as-is.
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

export async function searchEmails(
  gmail: gmail_v1.Gmail,
  contactEmail: string,
  daysBack: number = 90,
  maxResults: number = 10,
) {
  const afterDate = new Date(Date.now() - daysBack * 86_400_000);
  const after = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, "0")}/${String(afterDate.getDate()).padStart(2, "0")}`;

  // Exclude drafts (and trash/spam): an unsent draft — including ones this tool
  // saves — must NOT count as a real email exchanged with the prospect.
  const response = await gmail.users.messages.list({
    userId: "me",
    q: `(from:${contactEmail} OR to:${contactEmail}) after:${after} -in:drafts -in:trash -in:spam`,
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
      const labelIds = detail.data.labelIds ?? [];
      return {
        id: msg.id!,
        threadId: detail.data.threadId ?? null,
        labelIds,
        messageIdHeader: getHeader("Message-ID") || getHeader("Message-Id"),
        references: getHeader("References"),
        from: getHeader("From"),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        snippet: detail.data.snippet ?? "",
        body: extractTextBody(detail.data.payload),
      };
    }),
  );

  // Defensive backstop: drop anything still carrying the DRAFT label.
  return details.filter((m) => !m.labelIds.includes("DRAFT"));
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
