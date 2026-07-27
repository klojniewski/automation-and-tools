import { appendFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Append-only step-by-step logger for a single `followup` run.
 *
 * Writes one JSONL file per run to `logs/followup-<dealId>-<timestamp>.jsonl`.
 * Each `log()` call appends one JSON line (event) with a timestamp and the ms
 * elapsed since the run started, so a full run can be replayed and analysed
 * later (which ideas were generated, every draft version + feedback, retries,
 * threading choice, final subject, etc.).
 *
 * Logging must NEVER break the command — all writes are best-effort and swallow
 * their own errors.
 */
export class FollowupLogger {
  readonly file: string;
  private readonly startMs: number;

  constructor(dealId: number) {
    const dir = join(process.cwd(), "logs");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = join(dir, `followup-${dealId}-${ts}.jsonl`);
    this.startMs = Date.now();
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // ignore — log() will also fail silently if the dir is unavailable
    }
  }

  /** Append one event to the run log. Best-effort; never throws. */
  log(type: string, data: Record<string, unknown> = {}): void {
    try {
      const line = JSON.stringify({
        t: new Date().toISOString(),
        ms: Date.now() - this.startMs,
        type,
        ...data,
      });
      appendFileSync(this.file, line + "\n");
    } catch {
      // never let logging break the followup command
    }
  }
}

export type FollowupEvent = Record<string, unknown> & { type: string };

/** Returns all run-log paths (any deal), sorted oldest-first. */
export function listFollowupLogs(): string[] {
  const dir = join(process.cwd(), "logs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("followup-") && f.endsWith(".jsonl"))
    .sort()
    .map((f) => join(dir, f));
}

/** Returns the path of the most recent run log for a deal, or null if none. */
export function findLatestFollowupLog(dealId: number): string | null {
  const dir = join(process.cwd(), "logs");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`followup-${dealId}-`) && f.endsWith(".jsonl"))
    .sort(); // ISO timestamps in the name sort chronologically
  return files.length ? join(dir, files[files.length - 1]) : null;
}

/** Parses a JSONL run log into its events (bad lines are skipped). */
export function readFollowupLog(file: string): FollowupEvent[] {
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as FollowupEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is FollowupEvent => e !== null);
}

/** Appends a single event to an existing run log. Best-effort; never throws. */
export function appendFollowupEvent(file: string, type: string, data: Record<string, unknown> = {}): void {
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), type, ...data });
    appendFileSync(file, line + "\n");
  } catch {
    // best-effort
  }
}
