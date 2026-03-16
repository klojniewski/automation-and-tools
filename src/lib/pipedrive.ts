import {
  Configuration,
  DealsApi,
  PersonsApi,
  ActivitiesApi,
  StagesApi,
  OrganizationsApi,
} from "pipedrive/v2";
import type { DealItem } from "pipedrive/v2";
import {
  Configuration as V1Configuration,
  NotesApi,
} from "pipedrive/v1";
import { getEnv } from "./env.js";

function createConfig() {
  return new Configuration({ apiKey: getEnv().PIPEDRIVE_API_TOKEN });
}

function createV1Config() {
  return new V1Configuration({ apiKey: getEnv().PIPEDRIVE_API_TOKEN });
}

export async function validateCredentials(): Promise<void> {
  await new DealsApi(createConfig()).getDeals({ limit: 1 });
}

export async function getDealById(dealId: number): Promise<DealItem> {
  const dealsApi = new DealsApi(createConfig());
  const response = await dealsApi.getDeal({ id: dealId });
  if (!response.data) throw new Error(`Deal ${dealId} not found`);
  return response.data;
}

export async function getOpenDeals(
  ownerId: number,
  limit = 100,
  options?: { pipelineId?: number; excludeStageIds?: number[] },
): Promise<DealItem[]> {
  const dealsApi = new DealsApi(createConfig());
  const allDeals: DealItem[] = [];
  let cursor: string | undefined;

  do {
    const response = await dealsApi.getDeals({
      status: "open",
      owner_id: ownerId,
      limit: Math.min(limit - allDeals.length, 100),
      cursor,
      sort_by: "update_time",
      sort_direction: "desc",
      ...(options?.pipelineId ? { pipeline_id: options.pipelineId } : {}),
    });
    const batch = (response.data ?? []).filter((deal) => {
      if (options?.excludeStageIds?.length && deal.stage_id != null) {
        return !options.excludeStageIds.includes(deal.stage_id);
      }
      return true;
    });
    allDeals.push(...batch);
    cursor = response.additional_data?.next_cursor ?? undefined;
    if (!cursor) break;
  } while (allDeals.length < limit);

  return allDeals.slice(0, limit);
}

export interface DealContact {
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  orgName: string | null;
}

export async function getDealContacts(
  dealId: number,
): Promise<DealContact[]> {
  const personsApi = new PersonsApi(createConfig());
  const response = await personsApi.getPersons({ deal_id: dealId });
  return (response.data ?? []).map((person) => ({
    id: person.id ?? 0,
    name: person.name ?? "Unknown",
    email:
      person.emails?.find((e) => e.primary)?.value ??
      person.emails?.[0]?.value ??
      null,
    title: (person as any).job_title ?? null,
    orgName: (person as any).org_name ?? null,
  }));
}

export async function getOrgName(orgId: number): Promise<string | null> {
  try {
    const orgsApi = new OrganizationsApi(createConfig());
    const response = await orgsApi.getOrganization({ id: orgId });
    return response.data?.name ?? null;
  } catch {
    return null;
  }
}

export async function getDealActivities(dealId: number, limit = 5) {
  const activitiesApi = new ActivitiesApi(createConfig());
  const response = await activitiesApi.getActivities({
    deal_id: dealId,
    limit,
  } as any);
  return response.data ?? [];
}

export async function fetchDealsInRange(
  pipelineId: number,
  startDate: string,
  endDate: string,
  customFieldKeys?: string[],
): Promise<DealItem[]> {
  const dealsApi = new DealsApi(createConfig());
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T23:59:59Z");
  const matched: DealItem[] = [];
  let cursor: string | undefined;

  outer:
  do {
    const response = await dealsApi.getDeals({
      pipeline_id: pipelineId,
      sort_by: "add_time",
      sort_direction: "desc",
      limit: 100,
      cursor,
      ...(customFieldKeys?.length ? { custom_fields: customFieldKeys.join(",") } : {}),
    });

    for (const deal of response.data ?? []) {
      const addTime = deal.add_time ? new Date(deal.add_time) : null;
      if (!addTime) continue;

      if (addTime < start) break outer;

      if (addTime <= end) {
        matched.push(deal);
      }
    }

    cursor = response.additional_data?.next_cursor ?? undefined;
  } while (cursor);

  return matched;
}

export async function getStagesMap(): Promise<Map<number, string>> {
  const stagesApi = new StagesApi(createConfig());
  const response = await stagesApi.getStages({} as any);
  const map = new Map<number, string>();
  for (const stage of response.data ?? []) {
    if (stage.id != null && stage.name != null) {
      map.set(stage.id, stage.name);
    }
  }
  return map;
}

// --- Timeline Notes (v1 API) ---

const TIMELINE_MARKER = "📌 TIMELINE";

export interface TimelineNote {
  id: number;
  content: string;
}

export async function getTimelineNote(dealId: number): Promise<TimelineNote | null> {
  try {
    const notesApi = new NotesApi(createV1Config());
    const response = await notesApi.getNotes({
      deal_id: dealId,
      pinned_to_deal_flag: 1,
      sort: "update_time DESC",
      limit: 50,
    });
    const notes = response.data ?? [];
    const timeline = notes.find((n: any) => n.content?.includes(TIMELINE_MARKER));
    if (!timeline) return null;
    return { id: timeline.id!, content: timeline.content ?? "" };
  } catch {
    return null;
  }
}

export async function upsertTimelineNote(
  dealId: number,
  content: string,
): Promise<void> {
  const notesApi = new NotesApi(createV1Config());
  const existing = await getTimelineNote(dealId);

  if (existing) {
    await notesApi.updateNote({
      id: existing.id,
      NoteRequest: { content },
    });
  } else {
    await notesApi.addNote({
      AddNoteRequest: {
        content,
        deal_id: dealId,
        pinned_to_deal_flag: 1,
      } as any,
    });
  }
}

interface TimelineEntry {
  date: string;
  summary: string;
  email_link?: string | null;
}

export function formatFullTimelineHtml(options: {
  dealTitle: string;
  value: string;
  contact: string;
  currentStatus: string;
  milestones: TimelineEntry[];
  detailedLog: TimelineEntry[];
  stage: string;
  nextStage: string;
  health: string;
}): string {
  const now = new Date().toISOString().split("T")[0];

  const formatEntry = (e: TimelineEntry) => {
    const link = e.email_link ? ` <a href="${e.email_link}">📧</a>` : "";
    return `<b>[${e.date}]</b> ${e.summary}${link}`;
  };

  const milestoneLines = options.milestones.map(formatEntry).join("<br>");
  const logLines = options.detailedLog.map(formatEntry).join("<br>");

  return `${TIMELINE_MARKER} — ${options.dealTitle}<br>
<b>Last AI update:</b> ${now}<br>
<b>Value:</b> ${options.value} | <b>Contact:</b> ${options.contact}<br>
<b>Stage:</b> ${options.stage} → ${options.nextStage} | <b>Health:</b> ${options.health.toUpperCase()}<br>
<br>
<b>Status:</b> ${options.currentStatus}<br>
<br>
<b>KEY MILESTONES:</b><br>
${milestoneLines}<br>
<br>
<b>DETAILED LOG:</b><br>
${logLines}`;
}

/**
 * Parse an existing TIMELINE note HTML into its sections.
 * Returns null if the note doesn't have the expected structure.
 */
export function parseTimelineHtml(html: string): {
  header: string;
  milestones: string[];
  detailedLog: string[];
} | null {
  if (!html.includes(TIMELINE_MARKER)) return null;

  const milestonesMatch = html.indexOf("<b>KEY MILESTONES:</b>");
  const logMatch = html.indexOf("<b>DETAILED LOG:</b>");

  if (milestonesMatch === -1 || logMatch === -1) return null;

  const header = html.slice(0, milestonesMatch);
  const milestonesSection = html.slice(milestonesMatch + "<b>KEY MILESTONES:</b><br>".length, logMatch);
  const logSection = html.slice(logMatch + "<b>DETAILED LOG:</b><br>".length);

  const parseEntries = (section: string) =>
    section
      .split("<br>")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("<b>["));

  return {
    header,
    milestones: parseEntries(milestonesSection),
    detailedLog: parseEntries(logSection),
  };
}

/**
 * Update the TIMELINE header and append new log entries.
 * Milestones are never touched — only build-timeline sets them.
 */
export function appendToTimelineHtml(
  existingHtml: string,
  newEntries: TimelineEntry[],
  headerUpdates: {
    stage: string;
    nextStage: string;
    health: string;
    currentStatus: string;
  },
): string {
  const parsed = parseTimelineHtml(existingHtml);
  if (!parsed) return existingHtml; // Can't parse — don't corrupt it

  const now = new Date().toISOString().split("T")[0];

  // Update header fields
  let header = parsed.header;
  header = header.replace(
    /<b>Last AI update:<\/b>[^<]*/,
    `<b>Last AI update:</b> ${now}`,
  );
  header = header.replace(
    /<b>Stage:<\/b>[^<]*/,
    `<b>Stage:</b> ${headerUpdates.stage} → ${headerUpdates.nextStage} | <b>Health:</b> ${headerUpdates.health.toUpperCase()}`,
  );
  // Update or add status line
  if (header.includes("<b>Status:</b>")) {
    header = header.replace(
      /<b>Status:<\/b>[^<]*/,
      `<b>Status:</b> ${headerUpdates.currentStatus}`,
    );
  }

  // Dedup new entries against existing log
  const existingLogText = parsed.detailedLog.join("\n");
  const formatEntry = (e: TimelineEntry) => {
    const link = e.email_link ? ` <a href="${e.email_link}">📧</a>` : "";
    return `<b>[${e.date}]</b> ${e.summary}${link}`;
  };

  const deduped = newEntries.filter((entry) => {
    // Check if a similar entry already exists (same date + similar text)
    const datePart = `[${entry.date}]`;
    const summaryWords = entry.summary.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
    return !existingLogText.includes(datePart) ||
      !existingLogText.toLowerCase().includes(summaryWords);
  });

  const newLines = deduped.map(formatEntry);

  // Prepend new entries (latest first) to existing log
  const allLogLines = [...newLines, ...parsed.detailedLog];

  return `${header}<b>KEY MILESTONES:</b><br>
${parsed.milestones.join("<br>")}<br>
<br>
<b>DETAILED LOG:</b><br>
${allLogLines.join("<br>")}`;
}
