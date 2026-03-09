import {
  validateCredentials,
  getOpenDeals,
  getDealById,
  getDealContacts,
  getDealActivities,
  getStagesMap,
  getOrgName,
  type DealContact,
} from "./pipedrive.js";
import { getGmailClient, validateGmailCredentials, getGmailUserEmail, searchEmails } from "./gmail.js";
import { analyzeDeals, type DealPriority } from "./claude.js";
import { getEnv } from "./env.js";
import type { gmail_v1 } from "googleapis";
import type { DealItem } from "pipedrive/v2";

const CONCURRENCY = 5;

// Pipeline stage definitions with exit criteria (matches docs/Pagepro Inbound Sales Process.md)
interface StageDefinition {
  name: string;
  trigger: string;
  exitCriteria: string;
}

const PIPELINE_STAGES: StageDefinition[] = [
  {
    name: "Lead In",
    trigger: "Inbound enquiry via website/contact form",
    exitCriteria: "Respond within 15 min. Book and complete an Intro Meeting (understand project, share case studies, provide ballpark costs). Move to next stage once Intro Meeting is done.",
  },
  {
    name: "Qualification Call Made",
    trigger: "Intro Meeting completed",
    exitCriteria: "Qualify prospect using BANT (Budget, Authority, Need, Timeline). Log call transcript, create CRM note with summary. Send follow-up email same day. Move when all four BANT conditions are confirmed.",
  },
  {
    name: "Deal Qualified",
    trigger: "All BANT criteria met (budget confirmed, decision maker identified, project fits our stack, timeline known)",
    exitCriteria: "Deep-dive into requirements. Produce a Project Concept document (current situation, desired outcome, proposed approach, precise estimate). Move when concept is ready to present.",
  },
  {
    name: "Situation Investigated",
    trigger: "Project Concept prepared",
    exitCriteria: "Present concept to client. Get explicit approval of concept and ballpark before proceeding. Do NOT proceed to proposal until concept is approved.",
  },
  {
    name: "Concept Confirmed",
    trigger: "Client explicitly approves concept and ballpark",
    exitCriteria: "Produce detailed proposal. Present live in a meeting OR record walkthrough video. Collect feedback and iterate. Move when proposal is sent.",
  },
  {
    name: "Proposal Sent",
    trigger: "Proposal sent to client",
    exitCriteria: "Collect feedback, iterate if needed. Once proposal is accepted by client, send contract/agreement. Move when agreement is sent.",
  },
  {
    name: "Agreement Sent",
    trigger: "Proposal accepted, contract sent to client",
    exitCriteria: "Negotiate terms if needed. Deal is WON when contract is signed by both parties. Mark Won in CRM, complete notes, hand off to delivery.",
  },
];

export function getStagePipelineContext(stageName: string): string {
  const stageIndex = PIPELINE_STAGES.findIndex(
    (s) => s.name.toLowerCase() === stageName.toLowerCase(),
  );

  if (stageIndex === -1) return "";

  const current = PIPELINE_STAGES[stageIndex];
  const next = PIPELINE_STAGES[stageIndex + 1];
  const totalStages = PIPELINE_STAGES.length;

  let context = `\nPipeline position: Stage ${stageIndex + 1} of ${totalStages}`;
  context += `\nCurrent stage: ${current.name}`;
  context += `\n  Trigger: ${current.trigger}`;
  context += `\n  To advance: ${current.exitCriteria}`;

  if (next) {
    context += `\nNext stage: ${next.name}`;
    context += `\n  Requires: ${next.trigger}`;
  } else {
    context += `\nThis is the final stage before Close - Won.`;
  }

  return context;
}

export interface DealAnalysisResult {
  dealsAnalyzed: number;
  analysis: DealPriority;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<string>,
): Promise<string[]> {
  const results: string[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function enrichDeal(
  deal: DealItem,
  stages: Map<number, string>,
  gmail: gmail_v1.Gmail,
  userEmail: string,
  emailDays: number,
  maxEmails: number,
): Promise<string> {
  const dealId = deal.id ?? 0;

  // Fetch contacts, activities, and org name in parallel
  const [contacts, activities, orgName] = await Promise.all([
    getDealContacts(dealId).catch((): DealContact[] => []),
    getDealActivities(dealId, 10).catch((): any[] => []),
    deal.org_id ? getOrgName(deal.org_id) : Promise.resolve(null),
  ]);

  const stageName = stages.get(deal.stage_id ?? 0) ?? `Stage ${deal.stage_id}`;
  const daysSinceUpdate = deal.update_time
    ? Math.floor((Date.now() - new Date(deal.update_time).getTime()) / 86_400_000)
    : -1;

  // Fetch emails for all contacts in parallel
  const contactsWithEmail = contacts.filter((c) => c.email);
  const emailResults = await Promise.all(
    contactsWithEmail.map(async (contact) => {
      try {
        const emails = await searchEmails(gmail, contact.email!, emailDays, maxEmails);
        return emails.map((e) => ({ ...e, contactName: contact.name }));
      } catch {
        return [];
      }
    }),
  );
  const allEmails = emailResults.flat();

  // Format email with full body (truncated to keep context manageable)
  const emailSummary =
    allEmails.length > 0
      ? allEmails
          .map((e) => {
            const body = e.body ? `\n${e.body.slice(0, 500)}` : e.snippet;
            return `[${e.date}] ${e.from} -> ${e.to} | Subject: ${e.subject} | Link: https://mail.google.com/mail/u/0/#inbox/${e.id}\n${body}`;
          })
          .join("\n---\n")
      : "No email communication found.";

  // Determine conversation status — who needs to act next?
  let conversationStatus = "";
  if (allEmails.length > 0) {
    const latest = allEmails[0]; // emails are sorted newest first
    const isOutbound = latest.from.toLowerCase().includes(userEmail.toLowerCase());
    const emailDate = new Date(latest.date);
    const daysSinceLastEmail = Math.floor((Date.now() - emailDate.getTime()) / 86_400_000);
    const dateStr = emailDate.toISOString().split("T")[0];

    if (isOutbound) {
      conversationStatus = `\nConversation status: WAITING FOR REPLY — last email was outbound (from us) on ${dateStr} (${daysSinceLastEmail === 0 ? "today" : daysSinceLastEmail + "d ago"}). Ball is in prospect's court.`;
    } else {
      conversationStatus = `\nConversation status: ACTION NEEDED — last email was inbound (from prospect) on ${dateStr} (${daysSinceLastEmail === 0 ? "today" : daysSinceLastEmail + "d ago"}). Ball is in our court.`;
    }
  }

  // Format contacts with title/org
  const contactsList =
    contacts.map((c) => {
      const parts = [c.name];
      if (c.title) parts.push(`(${c.title})`);
      if (c.orgName) parts.push(`at ${c.orgName}`);
      parts.push(`<${c.email ?? "no email"}>`);
      return parts.join(" ");
    }).join(", ") || "None";

  // Format activities with notes
  const activityList =
    activities.length > 0
      ? activities.map((a: any) => {
          const note = a.note ? ` — ${stripActivityHtml(a.note).slice(0, 200)}` : "";
          return `[${a.due_date}] ${a.type}: ${a.subject}${note}`;
        }).join("\n")
      : "None";

  const today = new Date().toISOString().split("T")[0];

  const pipelineContext = getStagePipelineContext(stageName);

  return `DEAL #${dealId}: ${deal.title}
Organization: ${orgName ?? "Unknown"}
Value: ${deal.value ?? 0} ${deal.currency ?? ""} | Stage: ${stageName} | Probability: ${deal.probability ?? "N/A"}%
Days since update: ${daysSinceUpdate} | Today: ${today}
Contacts: ${contactsList}
${pipelineContext}${conversationStatus}

Recent activities:
${activityList}

Email history (last ${emailDays} days):
${emailSummary}
---`;
}

function stripActivityHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function analyzeDealPipeline(options: {
  limit?: number;
  emailDays?: number;
  maxEmails?: number;
  pipeline?: number;
  excludeStages?: string[];
  top?: number;
}): Promise<DealAnalysisResult> {
  const limit = options.limit ?? 50;
  const emailDays = options.emailDays ?? 90;
  const maxEmails = options.maxEmails ?? 10;

  // Validate credentials in parallel
  const [, gmail] = await Promise.all([
    validateCredentials(),
    getGmailClient(),
  ]);
  await validateGmailCredentials(gmail);
  const userEmail = await getGmailUserEmail(gmail);

  // Fetch stages and deals in parallel
  const env = getEnv();
  const [stages, allDeals] = await Promise.all([
    getStagesMap(),
    getOpenDeals(env.PIPEDRIVE_USER_ID, limit, {
      pipelineId: options.pipeline,
    }),
  ]);

  // Filter out excluded stages by name
  const excludeNames = (options.excludeStages ?? ["Lead In"]).map((s) => s.toLowerCase());
  const excludeStageIds = excludeNames.length > 0
    ? [...stages.entries()]
        .filter(([, name]) => excludeNames.includes(name.toLowerCase()))
        .map(([id]) => id)
    : [];

  const deals = excludeStageIds.length > 0
    ? allDeals.filter((d) => !excludeStageIds.includes(d.stage_id ?? 0))
    : allDeals;

  if (excludeNames.length > 0) {
    console.error(`Filtered out ${allDeals.length - deals.length} deals in stages: ${excludeNames.join(", ")}`);
  }

  if (deals.length === 0) {
    return {
      dealsAnalyzed: 0,
      analysis: { deals: [] },
    };
  }

  // Enrich all deals concurrently (max CONCURRENCY at a time)
  const dealContexts = await runWithConcurrency(deals, CONCURRENCY, (deal) =>
    enrichDeal(deal, stages, gmail, userEmail, emailDays, maxEmails),
  );

  // Send to Claude for analysis
  const analysis = await analyzeDeals(dealContexts.join("\n\n"), options.top);

  return {
    dealsAnalyzed: deals.length,
    analysis,
  };
}

export async function analyzeSingleDeal(options: {
  dealId: number;
  emailDays?: number;
  maxEmails?: number;
}): Promise<DealAnalysisResult> {
  const emailDays = options.emailDays ?? 90;
  const maxEmails = options.maxEmails ?? 10;

  const [, gmail] = await Promise.all([
    validateCredentials(),
    getGmailClient(),
  ]);
  await validateGmailCredentials(gmail);
  const userEmail = await getGmailUserEmail(gmail);

  const [stages, deal] = await Promise.all([
    getStagesMap(),
    getDealById(options.dealId),
  ]);

  const dealContext = await enrichDeal(deal, stages, gmail, userEmail, emailDays, maxEmails);
  const analysis = await analyzeDeals(dealContext);

  return {
    dealsAnalyzed: 1,
    analysis,
  };
}
