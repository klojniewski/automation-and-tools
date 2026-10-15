import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Persistent lessons learned from Chris's feedback on `followup` drafts.
 *
 * Lives in `docs/followup-lessons.md` (versioned, human-editable). Every lesson
 * is one markdown bullet `- [class] rule _(source)_` where class is:
 *   - truth      — facts / hard constraints, always binding
 *   - voice      — Chris's style preference, binding for style
 *   - hypothesis — a guess about what earns replies, applied but open to revision
 * Injected into every draft prompt; appended to at the end of a run when Chris
 * approves lessons distilled from his in-loop feedback.
 */
export const LESSONS_FILE = join(dirname(fileURLToPath(import.meta.url)), "../../docs/followup-lessons.md");

export type LessonClass = "truth" | "voice" | "hypothesis";
export interface Lesson {
  class: LessonClass;
  rule: string;
}

/** All lesson bullets from the file (raw lines, source suffix included). Best-effort: [] if missing. */
export function loadLessonLines(): string[] {
  try {
    if (!existsSync(LESSONS_FILE)) return [];
    return readFileSync(LESSONS_FILE, "utf8")
      .split("\n")
      .filter((line) => /^- \[(truth|voice|hypothesis)\]/.test(line.trim()))
      .map((line) => line.trim());
  } catch {
    return [];
  }
}

/** Prompt block with every saved lesson, or "" when there are none. */
export function buildLessonsBlock(): string {
  const lines = loadLessonLines();
  if (lines.length === 0) return "";
  return `LESSONS FROM CHRIS'S PAST FEEDBACK — apply all of them. [truth] rules are absolute; [voice] rules bind the style; [hypothesis] rules apply unless the brief says otherwise:
${lines.join("\n")}`;
}

/** Append approved lessons to the file with their source. */
export function appendLessons(lessons: Lesson[], source: string): void {
  if (lessons.length === 0) return;
  const text = lessons.map((l) => `- [${l.class}] ${l.rule} _(${source})_`).join("\n") + "\n";
  appendFileSync(LESSONS_FILE, text);
}
