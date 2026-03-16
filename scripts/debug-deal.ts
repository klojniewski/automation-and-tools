/**
 * Debug script: dumps all raw source data and final Claude prompt for a deal.
 * Usage: npx tsx scripts/debug-deal.ts <dealId> [emailDays] [maxEmails]
 * Output: creates debug/<dealId>/ with .md files for each data source
 */
import "dotenv/config";
import * as fs from "fs";
import {
  validateCredentials,
  getDealById,
  getDealContacts,
  getDealActivities,
  getStagesMap,
  getOrgName,
  getTimelineNote,
} from "../src/lib/pipedrive.js";
import { getGmailClient, validateGmailCredentials, getGmailUserEmail, searchEmails } from "../src/lib/gmail.js";
import { analyzeDeals } from "../src/lib/claude.js";
import { getStagePipelineContext } from "../src/lib/deal-analysis.js";

const dealId = parseInt(process.argv[2]);
if (!dealId) {
  console.error("Usage: npx tsx scripts/debug-deal.ts <dealId> [emailDays] [maxEmails]");
  process.exit(1);
}
const emailDays = parseInt(process.argv[3] ?? "90");
const maxEmails = parseInt(process.argv[4] ?? "15");

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const dir = `debug/${dealId}`;
  fs.mkdirSync(dir, { recursive: true });

  // Auth
  const [, gmail] = await Promise.all([validateCredentials(), getGmailClient()]);
  await validateGmailCredentials(gmail);
  const userEmail = await getGmailUserEmail(gmail);

  // Fetch all raw data
  const [stages, deal, contacts, activities, timelineNote] = await Promise.all([
    getStagesMap(),
    getDealById(dealId),
    getDealContacts(dealId).catch(() => []),
    getDealActivities(dealId, 10).catch(() => []),
    getTimelineNote(dealId).catch(() => null),
  ]);

  const orgName = deal.org_id ? await getOrgName(deal.org_id) : null;
  const stageName = stages.get(deal.stage_id ?? 0) ?? `Stage ${deal.stage_id}`;
  const daysSinceUpdate = deal.update_time
    ? Math.floor((Date.now() - new Date(deal.update_time).getTime()) / 86_400_000)
    : -1;
  const today = new Date().toISOString().split("T")[0];

  // 1. Raw deal data
  fs.writeFileSync(`${dir}/01-deal-raw.md`, `# Raw Deal Data (Pipedrive API)

## Deal #${dealId}: ${deal.title}

| Field | Value |
|-------|-------|
| ID | ${deal.id} |
| Title | ${deal.title} |
| Organization | ${orgName ?? "Unknown"} (org_id: ${deal.org_id}) |
| Value | ${deal.value ?? 0} ${deal.currency ?? ""} |
| Stage ID | ${deal.stage_id} |
| Stage Name | ${stageName} |
| Probability | ${deal.probability ?? "N/A"}% |
| Status | ${deal.status} |
| Pipeline ID | ${deal.pipeline_id} |
| Owner ID | ${deal.owner_id} |
| Add Time | ${deal.add_time} |
| Update Time | ${deal.update_time} |
| Days Since Update | ${daysSinceUpdate} |
| Expected Close Date | ${deal.expected_close_date ?? "N/A"} |
| Lost Reason | ${deal.lost_reason ?? "N/A"} |

### Full JSON
\`\`\`json
${JSON.stringify(deal, null, 2)}
\`\`\`
`);
  console.log(`Wrote ${dir}/01-deal-raw.md`);

  // 2. Contacts (with title/org)
  fs.writeFileSync(`${dir}/02-contacts.md`, `# Contacts for Deal #${dealId}

${contacts.length === 0 ? "No contacts found." : ""}
${contacts.map((c: any, i: number) => `## Contact ${i + 1}: ${c.name}
- **Email:** ${c.email ?? "N/A"}
- **Title:** ${c.title ?? "N/A"}
- **Organization:** ${c.orgName ?? "N/A"}
- **ID:** ${c.id}
`).join("\n")}
`);
  console.log(`Wrote ${dir}/02-contacts.md — ${contacts.length} contacts`);

  // 3. Activities (with notes)
  fs.writeFileSync(`${dir}/03-activities.md`, `# Activities for Deal #${dealId}

${activities.length === 0 ? "No activities found." : ""}
${activities.map((a: any, i: number) => `## Activity ${i + 1}
- **Type:** ${a.type}
- **Subject:** ${a.subject}
- **Due Date:** ${a.due_date}
- **Done:** ${a.done}
- **Note:** ${a.note ? stripHtml(a.note) : "N/A"}

\`\`\`json
${JSON.stringify(a, null, 2)}
\`\`\`
`).join("\n")}
`);
  console.log(`Wrote ${dir}/03-activities.md — ${activities.length} activities`);

  // 4. Emails per contact (with full body)
  const contactsWithEmail = contacts.filter((c: any) => c.email);
  const allEmails: any[] = [];
  let emailMd = `# Emails for Deal #${dealId}\n\nSearch: last ${emailDays} days, max ${maxEmails} per contact\n\n`;

  for (const contact of contactsWithEmail) {
    emailMd += `## Emails with ${contact.name}${contact.title ? ` (${contact.title})` : ""} <${contact.email}>\n\n`;
    try {
      const emails = await searchEmails(gmail, contact.email!, emailDays, maxEmails);
      if (emails.length === 0) {
        emailMd += "No emails found.\n\n";
        continue;
      }
      for (const e of emails) {
        allEmails.push({ ...e, contactName: contact.name });
        emailMd += `### ${e.subject}\n`;
        emailMd += `- **Date:** ${e.date}\n`;
        emailMd += `- **From:** ${e.from}\n`;
        emailMd += `- **To:** ${e.to}\n`;
        emailMd += `- **Gmail Link:** https://mail.google.com/mail/u/0/#inbox/${e.id}\n\n`;
        emailMd += `**Body:**\n\`\`\`\n${e.body || e.snippet}\n\`\`\`\n\n`;
      }
    } catch (err) {
      emailMd += `Error fetching emails: ${err}\n\n`;
    }
  }

  fs.writeFileSync(`${dir}/04-emails.md`, emailMd);
  console.log(`Wrote ${dir}/04-emails.md — ${allEmails.length} emails total`);

  // 5. Enriched context (what gets sent as the user message to Claude)
  const emailSummary =
    allEmails.length > 0
      ? allEmails
          .map((e: any) => {
            const body = e.body ? `\n${e.body.slice(0, 500)}` : e.snippet;
            return `[${e.date}] ${e.from} -> ${e.to} | Subject: ${e.subject} | Link: https://mail.google.com/mail/u/0/#inbox/${e.id}\n${body}`;
          })
          .join("\n---\n")
      : "No email communication found.";

  const contactsList =
    contacts.map((c: any) => {
      const parts = [c.name];
      if (c.title) parts.push(`(${c.title})`);
      if (c.orgName) parts.push(`at ${c.orgName}`);
      parts.push(`<${c.email ?? "no email"}>`);
      return parts.join(" ");
    }).join(", ") || "None";

  const activityList =
    activities.length > 0
      ? activities.map((a: any) => {
          const note = a.note ? ` — ${stripHtml(a.note).slice(0, 200)}` : "";
          return `[${a.due_date}] ${a.type}: ${a.subject}${note}`;
        }).join("\n")
      : "None";

  const pipelineContext = getStagePipelineContext(stageName);

  // Conversation status
  let conversationStatus = "";
  if (allEmails.length > 0) {
    const latest = allEmails[0];
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

  const timelineSection = timelineNote
    ? `\nPrevious timeline notes:\n${stripHtml(timelineNote.content)}`
    : "";

  const enrichedContext = `DEAL #${dealId}: ${deal.title}
Organization: ${orgName ?? "Unknown"}
Value: ${deal.value ?? 0} ${deal.currency ?? ""} | Stage: ${stageName} | Probability: ${deal.probability ?? "N/A"}%
Days since update: ${daysSinceUpdate} | Today: ${today}
Contacts: ${contactsList}
${pipelineContext}${conversationStatus}${timelineSection}

Recent activities:
${activityList}

Email history (last ${emailDays} days):
${emailSummary}
---`;

  fs.writeFileSync(`${dir}/05-enriched-context.md`, `# Enriched Deal Context (User Message to Claude)

This is the exact text sent as the \`user\` message in the Claude API call.

---

\`\`\`
${enrichedContext}
\`\`\`
`);
  console.log(`Wrote ${dir}/05-enriched-context.md`);

  // 6. System prompt (matches claude.ts exactly)
  const systemPrompt = `Today's date: ${today}

You are a sales intelligence analyst specializing in software services & consulting (web development, app builds, SLAs, replatforming, technical consulting).

Apply the Challenger Sales methodology:
- TEACH: Recommend actions that educate the prospect on insights they haven't considered — reframe their thinking about their problem
- TAILOR: Factor in the specific dynamics of each deal — who are the decision-makers, what's their technical evaluation cycle, are there committee decisions
- TAKE CONTROL: Push prospects toward decisions with constructive tension — set deadlines, propose bold next steps, don't accept stalling

Factor in typical software consulting dynamics: scope creep risk, decision-by-committee, technical evaluation cycles, budget approval processes.

Analyze these CRM deals and their email communication history. Rank deals by priority (1 = most urgent). Consider: staleness of communication, deal value, deal stage, email sentiment, and whether the contact is responsive.

IMPORTANT formatting rules:
- Return concise bullet points, NOT full sentences
- Each bullet should be a scannable phrase (e.g. "£15.6K value, strong momentum" not "The deal value is £15.6K and there is strong momentum")
- LIMIT: max 3 items per recommended_actions, reasoning, and key_signals — pick only the most impactful
- For deal_history: extract the 5 most recent actions/activities/emails from the deal context, return in reverse chronological order (latest first), each with a short date and one-line summary`;

  fs.writeFileSync(`${dir}/06-claude-prompt.md`, `# Full Claude API Call

## Model
\`claude-sonnet-4-6\`

## Max Tokens
\`12000\`

## System Prompt
\`\`\`
${systemPrompt}
\`\`\`

## User Message
\`\`\`
${enrichedContext}
\`\`\`
`);
  console.log(`Wrote ${dir}/06-claude-prompt.md`);

  // 7. Actually run Claude and save the output
  console.log("\nRunning Claude analysis...");
  try {
    const analysis = await analyzeDeals(enrichedContext);
    fs.writeFileSync(`${dir}/07-claude-output.md`, `# Claude Output

\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`
`);
    console.log(`Wrote ${dir}/07-claude-output.md`);
  } catch (err) {
    fs.writeFileSync(`${dir}/07-claude-output.md`, `# Claude Output — ERROR

\`\`\`
${err}
\`\`\`
`);
    console.error(`Claude error: ${err}`);
  }

  console.log(`\nDone! All debug files in ${dir}/`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
