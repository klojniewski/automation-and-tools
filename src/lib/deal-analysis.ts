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

export interface DealAnalysisResult {
  dealsAnalyzed: number;
  analysis: DealPriority;
}

export async function analyzeDealPipeline(options: {
  limit?: number;
  emailDays?: number;
  maxEmails?: number;
}): Promise<DealAnalysisResult> {
  const limit = options.limit ?? 50;
  const emailDays = options.emailDays ?? 90;
  const maxEmails = options.maxEmails ?? 10;

  // Validate credentials
  await validateCredentials();
  const gmail = await getGmailClient();
  await validateGmailCredentials(gmail);

  // Fetch stages and deals
  const stages = await getStagesMap();
  const env = getEnv();
  const deals = await getOpenDeals(env.PIPEDRIVE_USER_ID, limit);

  if (deals.length === 0) {
    return {
      dealsAnalyzed: 0,
      analysis: { deals: [] },
    };
  }

  // Enrich each deal with contacts + email history
  const dealContexts: string[] = [];

  for (const deal of deals) {
    const dealId = deal.id ?? 0;

    let contacts: DealContact[] = [];
    try {
      contacts = await getDealContacts(dealId);
    } catch {
      // skip contacts on error
    }

    let activities: any[] = [];
    try {
      activities = await getDealActivities(dealId, 5);
    } catch {
      // skip activities on error
    }

    const stageName = stages.get(deal.stage_id ?? 0) ?? `Stage ${deal.stage_id}`;
    const daysSinceUpdate = deal.update_time
      ? Math.floor((Date.now() - new Date(deal.update_time).getTime()) / 86_400_000)
      : -1;

    let emailSummary = "No email communication found.";
    const allEmails: Array<{
      from: string;
      to: string;
      subject: string;
      date: string;
      snippet: string;
      contactName: string;
    }> = [];

    for (const contact of contacts) {
      if (!contact.email) continue;
      try {
        const emails = await searchEmails(gmail, contact.email, emailDays, maxEmails);
        allEmails.push(
          ...emails.map((e) => ({ ...e, contactName: contact.name })),
        );
      } catch {
        // skip email search failures
      }
    }

    if (allEmails.length > 0) {
      emailSummary = allEmails
        .map((e) => `[${e.date}] ${e.from} -> ${e.to} | Subject: ${e.subject} | ${e.snippet}`)
        .join("\n");
    }

    const contactsList =
      contacts.map((c) => `${c.name} <${c.email ?? "no email"}>`).join(", ") || "None";

    const activityList =
      activities.length > 0
        ? activities.map((a: any) => `${a.type}: ${a.subject} (${a.due_date})`).join("; ")
        : "None";

    dealContexts.push(`DEAL #${dealId}: ${deal.title}
Value: ${deal.value ?? 0} ${deal.currency ?? ""} | Stage: ${stageName} | Days since update: ${daysSinceUpdate}
Contacts: ${contactsList}
Recent activities: ${activityList}
Email history (last ${emailDays} days):
${emailSummary}
---`);
  }

  // Send to Claude for analysis
  const analysis = await analyzeDeals(dealContexts.join("\n\n"));

  return {
    dealsAnalyzed: deals.length,
    analysis,
  };
}
