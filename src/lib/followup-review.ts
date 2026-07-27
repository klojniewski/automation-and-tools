/**
 * Pure helpers for comparing the AI-generated follow-up draft against the
 * version actually sent (after Chris manually edited it in Gmail). Used by the
 * `followup-review` command to capture "what did I change" into the run log.
 */

export type DiffLine = { op: " " | "-" | "+"; text: string };

/**
 * Reduces a sent email's plain-text body to just the message Chris wrote:
 * drops the signature block and any quoted reply thread, keeping the body and
 * its sign-off. Applied to BOTH the generated and sent text so they compare
 * symmetrically.
 */
export function stripToBody(raw: string): string {
  const text = raw.replace(/\r/g, "").trim();

  // Prefer cutting right after the sign-off ("Best,\nChris") — everything after
  // it (signature, quoted thread) is noise.
  const signoff = text.match(
    /\n\s*(best|best regards|kind regards|warm regards|regards|cheers|thanks|thank you|all the best)[,.!]?\s*\n[^\n]{1,40}/i,
  );
  if (signoff && signoff.index !== undefined) {
    return text.slice(0, signoff.index + signoff[0].length).trim();
  }

  // Fallback: cut at the first reply/signature marker.
  const markers = [
    text.search(/\n\s*On .+wrote:/),
    text.search(/\n\s*-----\s*Original Message\s*-----/i),
    text.search(/\n\s*CEO & CGO\b/),
    text.search(/\n\s*\+\d[\d ]{6,}/), // phone number line
    text.search(/\n\s*Schedule a meeting\b/i),
    text.search(/\n\s*>/), // quoted lines
  ].filter((i) => i >= 0);
  return markers.length ? text.slice(0, Math.min(...markers)).trim() : text;
}

/**
 * Splits body text into one line per PARAGRAPH for diffing. Soft/hard line
 * wraps inside a paragraph (Gmail wraps sent plain-text at ~78 cols) are joined
 * back into a single line, so the diff reflects real content changes rather than
 * wrapping artefacts. Paragraphs are separated by blank lines.
 */
export function toLines(s: string): string[] {
  return s
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** Normalises a subject for comparison: strips leading "Re:" chains, lowercases. */
export function normalizeSubject(s: string): string {
  return s.replace(/^(\s*re:\s*)+/i, "").trim().toLowerCase();
}

/** Line-level diff (LCS). Returns context (" "), removed ("-", from a), added ("+", from b). */
export function lineDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "-", text: a[i] });
      i++;
    } else {
      out.push({ op: "+", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "-", text: a[i++] });
  while (j < m) out.push({ op: "+", text: b[j++] });
  return out;
}
