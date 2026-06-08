#!/usr/bin/env node
// Pipedrive MCP server (local stdio) — exposes your Pipedrive deals/contacts/
// activities/notes to Claude Desktop as a custom connector. Single-user:
// API token + user id read from .env.
//
// Tools (read-only):
//   list_my_deals(status?, pipeline_id?, limit?)            -> open deals owned by you
//   get_deal(id_or_url)                                     -> full deal by id or pipedrive URL
//   get_deal_contacts(id_or_url)                            -> contacts attached to a deal
//   get_deal_activities(id_or_url, limit?)                  -> recent activities/notes on a deal
//   get_deal_notes(id_or_url, limit?)                       -> notes on a deal (incl. pinned TIMELINE)
//   search_deals(term, limit?)                              -> search deals by title/org
//   list_pipeline_stages()                                  -> all stages across pipelines

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

try { process.loadEnvFile(join(HERE, ".env")); } catch { /* fall through to process.env */ }

const TOKEN = process.env.PIPEDRIVE_API_TOKEN;
const USER_ID = process.env.PIPEDRIVE_USER_ID;
const BASE_URL = "https://api.pipedrive.com/v1";

if (!TOKEN) {
  console.error("pipedrive-mcp: missing PIPEDRIVE_API_TOKEN (put it in .env next to this script)");
  process.exit(1);
}

async function pd(path, params) {
  const url = new URL(BASE_URL + path);
  url.searchParams.set("api_token", TOKEN);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pipedrive ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Accepts numeric id or a full Pipedrive URL like https://x.pipedrive.com/deal/1234
function parseDealId(input) {
  const s = String(input).trim();
  const m = s.match(/\/deal\/(\d+)/) ?? s.match(/^(\d+)$/);
  if (!m) throw new Error(`Could not parse deal id from "${input}"`);
  return Number(m[1]);
}

function stripHtml(s) {
  return String(s ?? "")
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

function compactDeal(d) {
  return {
    id: d.id,
    title: d.title,
    value: d.value,
    currency: d.currency,
    status: d.status,
    stage_id: d.stage_id,
    pipeline_id: d.pipeline_id,
    probability: d.probability,
    expected_close_date: d.expected_close_date,
    owner_name: d.owner_name,
    org_name: d.org_name,
    person_name: d.person_name,
    update_time: d.update_time,
    add_time: d.add_time,
    days_in_stage: d.stage_change_time
      ? Math.floor((Date.now() - new Date(d.stage_change_time).getTime()) / 86_400_000)
      : null,
    url: `https://pagepro.pipedrive.com/deal/${d.id}`,
  };
}

const json = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

const server = new McpServer({ name: "pipedrive", version: "1.0.0" });

server.registerTool(
  "list_my_deals",
  {
    title: "List my Pipedrive deals",
    description:
      "List open deals owned by the configured user. Use this to see your active pipeline. " +
      "Returns compact records (id, title, value, stage, days in stage, urls).",
    inputSchema: {
      status: z.enum(["open", "won", "lost", "deleted", "all_not_deleted"]).optional()
        .describe("Deal status filter — defaults to 'open'."),
      pipeline_id: z.number().int().optional().describe("Filter to a specific pipeline id."),
      limit: z.number().int().min(1).max(500).optional().describe("Max deals to return (default 200)."),
    },
  },
  async ({ status, pipeline_id, limit }) => {
    if (!USER_ID) throw new Error("PIPEDRIVE_USER_ID not set in .env — needed to filter your deals.");
    const max = limit ?? 200;
    const deals = [];
    let start = 0;
    while (deals.length < max) {
      const r = await pd("/deals", {
        user_id: USER_ID,
        status: status ?? "open",
        pipeline_id,
        start,
        limit: 100,
      });
      const batch = r.data ?? [];
      deals.push(...batch.map(compactDeal));
      const more = r.additional_data?.pagination?.more_items_in_collection;
      const next = r.additional_data?.pagination?.next_start;
      if (!more || next == null) break;
      start = next;
    }
    return json({ count: deals.length, deals: deals.slice(0, max) });
  },
);

server.registerTool(
  "get_deal",
  {
    title: "Get a deal",
    description: "Fetch a single deal by id or Pipedrive URL. Returns the full deal record.",
    inputSchema: {
      id_or_url: z.string().describe("Deal id (e.g. '6929') or full Pipedrive deal URL."),
    },
  },
  async ({ id_or_url }) => {
    const id = parseDealId(id_or_url);
    const r = await pd(`/deals/${id}`);
    if (!r.data) throw new Error(`Deal ${id} not found`);
    return json(r.data);
  },
);

server.registerTool(
  "get_deal_contacts",
  {
    title: "Get deal contacts",
    description: "List people linked to a deal — name, email, phone, title, org.",
    inputSchema: { id_or_url: z.string().describe("Deal id or URL.") },
  },
  async ({ id_or_url }) => {
    const id = parseDealId(id_or_url);
    const r = await pd(`/deals/${id}/persons`);
    const contacts = (r.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.emails?.find((e) => e.primary)?.value ?? p.emails?.[0]?.value ?? null,
      phone: p.phones?.find((e) => e.primary)?.value ?? p.phones?.[0]?.value ?? null,
      title: p.job_title ?? null,
      org_name: p.org_name ?? null,
    }));
    return json({ count: contacts.length, contacts });
  },
);

server.registerTool(
  "get_deal_activities",
  {
    title: "Get deal activities",
    description:
      "Recent activities/calls/meetings logged on a deal (most recent first). " +
      "Notes attached to activities are returned as plain text.",
    inputSchema: {
      id_or_url: z.string().describe("Deal id or URL."),
      limit: z.number().int().min(1).max(100).optional().describe("Max activities (default 20)."),
    },
  },
  async ({ id_or_url, limit }) => {
    const id = parseDealId(id_or_url);
    const r = await pd(`/deals/${id}/activities`, { limit: limit ?? 20 });
    const activities = (r.data ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      due_date: a.due_date,
      due_time: a.due_time,
      done: a.done,
      note: a.note ? stripHtml(a.note) : null,
    }));
    return json({ count: activities.length, activities });
  },
);

server.registerTool(
  "get_deal_notes",
  {
    title: "Get deal notes",
    description:
      "Notes on a deal — most recent first. Includes the pinned TIMELINE note when present " +
      "(written by the local `analyze`/`build-timeline` CLIs). HTML stripped to plain text.",
    inputSchema: {
      id_or_url: z.string().describe("Deal id or URL."),
      limit: z.number().int().min(1).max(50).optional().describe("Max notes (default 20)."),
    },
  },
  async ({ id_or_url, limit }) => {
    const id = parseDealId(id_or_url);
    const r = await pd("/notes", { deal_id: id, limit: limit ?? 20, sort: "update_time DESC" });
    const notes = (r.data ?? []).map((n) => ({
      id: n.id,
      add_time: n.add_time,
      update_time: n.update_time,
      pinned_to_deal_flag: !!n.pinned_to_deal_flag,
      user_id: n.user_id,
      content: n.content ? stripHtml(n.content) : "",
    }));
    return json({ count: notes.length, notes });
  },
);

server.registerTool(
  "search_deals",
  {
    title: "Search deals",
    description: "Search deals by title, person name, or organization. Returns compact records.",
    inputSchema: {
      term: z.string().min(2).describe("Search term (min 2 chars)."),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)."),
    },
  },
  async ({ term, limit }) => {
    const r = await pd("/deals/search", {
      term,
      fields: "title,notes,custom_fields",
      limit: limit ?? 20,
    });
    const items = (r.data?.items ?? []).map((i) => {
      const d = i.item ?? {};
      return {
        id: d.id,
        title: d.title,
        value: d.value,
        currency: d.currency,
        status: d.status,
        org_name: d.organization?.name ?? null,
        person_name: d.person?.name ?? null,
        url: d.id ? `https://pagepro.pipedrive.com/deal/${d.id}` : null,
        result_score: i.result_score,
      };
    });
    return json({ count: items.length, results: items });
  },
);

server.registerTool(
  "list_pipeline_stages",
  {
    title: "List pipeline stages",
    description: "List all stages across all pipelines (id, name, pipeline_id, order).",
    inputSchema: {},
  },
  async () => {
    const r = await pd("/stages");
    const stages = (r.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      pipeline_id: s.pipeline_id,
      order_nr: s.order_nr,
      active_flag: s.active_flag,
    }));
    return json({ count: stages.length, stages });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("pipedrive-mcp: running on stdio");
