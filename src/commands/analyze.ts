import {
  validateCredentials,
  getOpenDeals,
  getDealContacts,
  getDealActivities,
  getStagesMap,
  type DealContact,
} from "../services/pipedrive.js";
import { getGmailClient, validateGmailCredentials, searchEmails } from "../services/gmail.js";
import { analyzeDeals } from "../services/claude.js";
import { getEnv } from "../config/env.js";

export interface AnalyzeOptions {
  limit: number;
  emailDays: number;
  maxEmails: number;
  dryRun: boolean;
  verbose: boolean;
}

export async function runAnalysis(options: AnalyzeOptions) {
  // 1. Validate all credentials upfront
  console.log("Validating credentials...");

  try {
    await validateCredentials();
    if (options.verbose) console.log("  Pipedrive: OK");
  } catch {
    console.error("Pipedrive authentication failed. Check your PIPEDRIVE_API_TOKEN.");
    process.exit(1);
  }

  const gmail = await getGmailClient();
  try {
    await validateGmailCredentials(gmail);
    if (options.verbose) console.log("  Gmail: OK");
  } catch (err: any) {
    console.error("Gmail authentication failed. Check credentials.json or re-authorize.");
    if (err?.message) console.error("  Details:", err.message);
    process.exit(1);
  }

  if (options.verbose) console.log("  Anthropic: will validate on use");
  console.log("Credentials validated.\n");

  // 2. Fetch stages for name resolution
  const stages = await getStagesMap();
  if (options.verbose) console.log(`Loaded ${stages.size} pipeline stages.`);

  // 3. Fetch open deals
  const env = getEnv();
  console.log(`Fetching open deals for user ${env.PIPEDRIVE_USER_ID}...`);
  const deals = await getOpenDeals(env.PIPEDRIVE_USER_ID, options.limit);
  console.log(`Found ${deals.length} open deals.\n`);

  if (deals.length === 0) {
    console.log("No open deals found. Nothing to analyze.");
    return;
  }

  // 4. Enrich each deal with contacts + email history
  const dealContexts: string[] = [];

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    const dealId = deal.id ?? 0;
    const progress = `[${i + 1}/${deals.length}]`;

    let contacts: DealContact[] = [];
    try {
      contacts = await getDealContacts(dealId);
    } catch {
      console.warn(`${progress} Could not fetch contacts for "${deal.title}" — skipping contacts.`);
    }

    let activities: any[] = [];
    try {
      activities = await getDealActivities(dealId, 5);
    } catch {
      // silently skip activities on error
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
        const emails = await searchEmails(
          gmail,
          contact.email,
          options.emailDays,
          options.maxEmails,
        );
        allEmails.push(
          ...emails.map((e) => ({ ...e, contactName: contact.name })),
        );
      } catch (err) {
        if (options.verbose) {
          console.warn(
            `${progress} Gmail search failed for ${contact.email}: ${err}`,
          );
        }
      }
    }

    if (allEmails.length > 0) {
      emailSummary = allEmails
        .map(
          (e) =>
            `[${e.date}] ${e.from} -> ${e.to} | Subject: ${e.subject} | ${e.snippet}`,
        )
        .join("\n");
    }

    const contactsList =
      contacts.map((c) => `${c.name} <${c.email ?? "no email"}>`).join(", ") ||
      "None";

    const activityList =
      activities.length > 0
        ? activities
            .map((a: any) => `${a.type}: ${a.subject} (${a.due_date})`)
            .join("; ")
        : "None";

    const context = `DEAL #${dealId}: ${deal.title}
Value: ${deal.value ?? 0} ${deal.currency ?? ""} | Stage: ${stageName} | Days since update: ${daysSinceUpdate}
Contacts: ${contactsList}
Recent activities: ${activityList}
Email history (last ${options.emailDays} days):
${emailSummary}
---`;

    dealContexts.push(context);

    if (options.verbose) {
      console.log(`${progress} ${deal.title} — ${contacts.length} contacts, ${allEmails.length} emails`);
    } else {
      process.stdout.write(`\r  Processing deals... ${progress}`);
    }
  }

  if (!options.verbose) console.log(); // newline after progress

  if (options.dryRun) {
    console.log("\n--- DRY RUN: Deal context that would be sent to Claude ---\n");
    console.log(dealContexts.join("\n\n"));
    console.log("\n[DRY RUN] Would send the above context to Claude for analysis.");
    return;
  }

  // 5. Send to Claude
  console.log("\nAnalyzing deals with Claude...");
  const analysis = await analyzeDeals(dealContexts.join("\n\n"));

  // 6. Output prioritized results
  const pipedriveUrl = `https://${env.PIPEDRIVE_DOMAIN}.pipedrive.com/deal`;

  console.log("\n========================================");
  console.log("         DEAL PRIORITIES");
  console.log("========================================\n");

  const sorted = analysis.deals.sort((a, b) => a.priority_rank - b.priority_rank);

  const healthIcon: Record<string, string> = {
    hot: "!!!",
    warm: "!! ",
    cold: "!  ",
    at_risk: "!!!",
  };
  const urgencyLabel: Record<string, string> = {
    immediate: "NOW",
    this_week: "THIS WEEK",
    next_week: "NEXT WEEK",
    no_rush: "LOW",
  };

  for (const deal of sorted) {
    console.log(`#${deal.priority_rank} [${healthIcon[deal.deal_health] ?? "   "}] ${deal.deal_title}`);
    console.log(`URL: ${pipedriveUrl}/${deal.deal_id}`);
    console.log(`Health: ${deal.deal_health.toUpperCase()} | Urgency: ${urgencyLabel[deal.urgency] ?? deal.urgency}`);

    console.log("\nAction:");
    for (const action of deal.recommended_actions) {
      console.log(`  - ${action}`);
    }

    console.log("\nWhy:");
    for (const reason of deal.reasoning) {
      console.log(`  - ${reason}`);
    }

    if (deal.key_signals.length > 0) {
      console.log("\nSignals:");
      for (const signal of deal.key_signals) {
        console.log(`  - ${signal}`);
      }
    }

    if (deal.deal_history.length > 0) {
      console.log("\nDeal History:");
      for (const entry of deal.deal_history) {
        console.log(`  - ${entry.date}: ${entry.summary}`);
      }
    }

    console.log("\n----------------------------------------\n");
  }
}
