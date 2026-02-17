import {
  validateCredentials,
  getOpenDeals,
  getDealContacts,
  getDealActivities,
  getStagesMap,
  type DealContact,
} from "./pipedrive.js";
import { getGmailClient, validateGmailCredentials, searchEmails } from "./gmail.js";
import { analyzeDeals, type DealPriority } from "./claude.js";
import { getEnv } from "./env.js";
import type { gmail_v1 } from "googleapis";
import type { DealItem } from "pipedrive/v2";

const CONCURRENCY = 5;

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
  emailDays: number,
  maxEmails: number,
): Promise<string> {
  const dealId = deal.id ?? 0;

  // Fetch contacts and activities in parallel
  const [contacts, activities] = await Promise.all([
    getDealContacts(dealId).catch((): DealContact[] => []),
    getDealActivities(dealId, 5).catch((): any[] => []),
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

  const emailSummary =
    allEmails.length > 0
      ? allEmails
          .map((e) => `[${e.date}] ${e.from} -> ${e.to} | Subject: ${e.subject} | ${e.snippet}`)
          .join("\n")
      : "No email communication found.";

  const contactsList =
    contacts.map((c) => `${c.name} <${c.email ?? "no email"}>`).join(", ") || "None";

  const activityList =
    activities.length > 0
      ? activities.map((a: any) => `${a.type}: ${a.subject} (${a.due_date})`).join("; ")
      : "None";

  return `DEAL #${dealId}: ${deal.title}
Value: ${deal.value ?? 0} ${deal.currency ?? ""} | Stage: ${stageName} | Days since update: ${daysSinceUpdate}
Contacts: ${contactsList}
Recent activities: ${activityList}
Email history (last ${emailDays} days):
${emailSummary}
---`;
}

export async function analyzeDealPipeline(options: {
  limit?: number;
  emailDays?: number;
  maxEmails?: number;
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

  // Fetch stages and deals in parallel
  const env = getEnv();
  const [stages, deals] = await Promise.all([
    getStagesMap(),
    getOpenDeals(env.PIPEDRIVE_USER_ID, limit),
  ]);

  if (deals.length === 0) {
    return {
      dealsAnalyzed: 0,
      analysis: { deals: [] },
    };
  }

  // Enrich all deals concurrently (max CONCURRENCY at a time)
  const dealContexts = await runWithConcurrency(deals, CONCURRENCY, (deal) =>
    enrichDeal(deal, stages, gmail, emailDays, maxEmails),
  );

  // Send to Claude for analysis
  const analysis = await analyzeDeals(dealContexts.join("\n\n"));

  return {
    dealsAnalyzed: deals.length,
    analysis,
  };
}
