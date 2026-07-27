import { getActivityTypeKey, getDealActivities, createDealActivity, updateDealActivity } from "./pipedrive.js";

/**
 * Follow-up activity lifecycle on a Pipedrive deal.
 *
 * Each time a follow-up is sent we:
 *  1. Find an OPEN (not-done) follow-up activity (`FL#n`) — the "next follow-up"
 *     task scheduled last time. If found, reuse it: retitle `FL#n: <subject>`,
 *     set its date to today, mark it DONE. Otherwise create a fresh `FL#n` DONE.
 *  2. Schedule the next step:
 *     - n < 5  => a planned `FL#(n+1)` (not-done) due in 2 WORKING days.
 *     - n >= 5 => a planned TASK "No answers after 5 FL, mark LOST." due in 1 week.
 *
 * There is always exactly one open "what next" activity on the deal.
 */

export interface FollowupActivityResult {
  done: { mode: "created" | "updated"; activityId: number | null; number: number };
  next:
    | { kind: "followup"; number: number; activityId: number | null; dueDate: string }
    | { kind: "lost"; activityId: number | null; dueDate: string };
}

const LOST_TASK_SUBJECT = "No answers after 5 FL, mark LOST.";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Advances `n` working days from `from`, skipping Saturdays and Sundays. */
function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function addCalendarDays(from: Date, n: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return d;
}

function parseFollowupNumber(subject?: string | null): number | null {
  const m = /^FL#(\d+)/.exec((subject ?? "").trim());
  return m ? parseInt(m[1], 10) : null;
}

export async function recordFollowupActivity(opts: {
  dealId: number;
  emailSubject: string;
  note?: string;
  personId?: number;
}): Promise<FollowupActivityResult> {
  const { dealId, emailSubject, note, personId } = opts;
  const followUpType = (await getActivityTypeKey("Follow Up").catch(() => null)) ?? "task";
  const today = isoDate(new Date());

  const activities = await getDealActivities(dealId, 100);
  const fu: { id: number | undefined; done: boolean; num: number }[] = [];
  for (const a of activities) {
    const num = parseFollowupNumber(a.subject);
    if (num !== null) fu.push({ id: a.id, done: !!a.done, num });
  }

  // Reuse the highest-numbered OPEN follow-up (the one scheduled last time).
  const open = fu.filter((x) => !x.done && x.id != null).sort((p, q) => q.num - p.num)[0];

  let done: FollowupActivityResult["done"];
  if (open) {
    const n = open.num;
    await updateDealActivity(open.id!, {
      subject: `FL#${n}: ${emailSubject}`,
      dueDate: today,
      done: true,
      ...(note ? { note } : {}),
    });
    done = { mode: "updated", activityId: open.id ?? null, number: n };
  } else {
    const maxNum = fu.reduce((mx, x) => Math.max(mx, x.num), 0);
    const n = maxNum + 1;
    const id = await createDealActivity({
      dealId,
      subject: `FL#${n}: ${emailSubject}`,
      type: followUpType,
      note,
      dueDate: today,
      done: true,
      personId,
    });
    done = { mode: "created", activityId: id, number: n };
  }

  const n = done.number;
  let next: FollowupActivityResult["next"];
  if (n >= 5) {
    const dueDate = isoDate(addCalendarDays(new Date(), 7));
    const activityId = await createDealActivity({
      dealId,
      subject: LOST_TASK_SUBJECT,
      type: "task",
      dueDate,
      done: false,
      personId,
    });
    next = { kind: "lost", activityId, dueDate };
  } else {
    const dueDate = isoDate(addWorkingDays(new Date(), 2));
    const activityId = await createDealActivity({
      dealId,
      subject: `FL#${n + 1}`,
      type: followUpType,
      dueDate,
      done: false,
      personId,
    });
    next = { kind: "followup", number: n + 1, activityId, dueDate };
  }

  return { done, next };
}
