#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import { exec } from "node:child_process";
import { analyzeDealPipeline, analyzeSingleDeal, buildDealTimeline, enrichDeal } from "./lib/deal-analysis.js";
import type { DealAnalysisResult } from "./lib/deal-analysis.js";
import { getGA4Stats } from "./lib/ga4-stats.js";
import { getPipedriveDeals } from "./lib/pipedrive-stats.js";
import { getYouTubeStats } from "./lib/youtube-stats.js";
import { updateScorecard } from "./lib/scorecard.js";
import { getEnv } from "./lib/env.js";
import { getGmailClient, validateGmailCredentials, createDraft } from "./lib/gmail.js";
import { getDealById, getDealContacts, getStagesMap } from "./lib/pipedrive.js";
import { getGmailUserEmail } from "./lib/gmail.js";
import { generateFollowupIdeas, draftFollowup, detectLanguage, summarizeDealForReview, type FollowupDraft, type RoleContext, type DealRecap } from "./lib/claude.js";

const program = new Command();

program
  .name("deal-intel")
  .description("AI-powered Pipedrive deal prioritization with Gmail context")
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze open deals and get prioritized action list")
  .option("-l, --limit <n>", "Max deals to analyze", "50")
  .option("--email-days <n>", "Email history window in days", "90")
  .option("--max-emails <n>", "Max emails per contact", "10")
  .option("-p, --pipeline <id>", "Pipedrive pipeline ID")
  .option("--exclude-stages <stages...>", "Stage names to exclude (e.g. 'Lead In')")
  .option("-t, --top <n>", "Number of top deals to return", "20")
  .action(async (opts) => {
    try {
      const result = await analyzeDealPipeline({
        limit: parseInt(opts.limit),
        emailDays: parseInt(opts.emailDays),
        maxEmails: parseInt(opts.maxEmails),
        pipeline: opts.pipeline ? parseInt(opts.pipeline) : undefined,
        excludeStages: opts.excludeStages,
        top: parseInt(opts.top),
      });
      printDealAnalysis(result);
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("deal <id>")
  .description("Analyze a single deal by Pipedrive deal ID")
  .option("--email-days <n>", "Email history window in days", "90")
  .option("--max-emails <n>", "Max emails per contact", "10")
  .action(async (id: string, opts) => {
    try {
      const result = await analyzeSingleDeal({
        dealId: parseInt(id),
        emailDays: parseInt(opts.emailDays),
        maxEmails: parseInt(opts.maxEmails),
      });
      printDealAnalysis(result);
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("build-timeline <id>")
  .description("Build a comprehensive TIMELINE note for a deal (full history)")
  .option("--email-days <n>", "Email history window in days", "365")
  .option("--max-emails <n>", "Max emails per contact", "50")
  .action(async (id: string, opts) => {
    try {
      const timeline = await buildDealTimeline({
        dealId: parseInt(id),
        emailDays: parseInt(opts.emailDays),
        maxEmails: parseInt(opts.maxEmails),
      });
      console.log(`\n========================================`);
      console.log(`  TIMELINE: ${timeline.deal_title}`);
      console.log(`  Value: ${timeline.value} | Contact: ${timeline.contact}`);
      console.log(`  Stage: ${timeline.current_stage} → ${timeline.next_stage}`);
      console.log(`  Health: ${timeline.deal_health.toUpperCase()}`);
      console.log(`========================================`);
      console.log(`\n  Status: ${timeline.current_status}\n`);

      console.log(`  KEY MILESTONES:`);
      for (const entry of timeline.milestones) {
        const link = entry.email_link ? ` ${entry.email_link}` : "";
        console.log(`  [${entry.date}] ${entry.summary}${link}`);
      }

      console.log(`\n  DETAILED LOG:`);
      for (const entry of timeline.detailed_log) {
        const link = entry.email_link ? ` ${entry.email_link}` : "";
        console.log(`  [${entry.date}] ${entry.summary}${link}`);
      }

      const total = timeline.milestones.length + timeline.detailed_log.length;
      console.log(`\n  (${timeline.milestones.length} milestones + ${timeline.detailed_log.length} log entries = ${total} events — written to Pipedrive)\n`);
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("followup <idOrUrl>")
  .description("Interactive: brainstorm follow-up ideas for a deal, draft an email, iterate with feedback, save as Gmail draft. Accepts a deal ID or Pipedrive deal URL.")
  .option("--email-days <n>", "Email history window in days", "90")
  .option("--max-emails <n>", "Max emails per contact", "10")
  .action(async (idOrUrl: string, opts) => {
    try {
      const dealId = parseDealId(idOrUrl);
      await runFollowupCommand(dealId, parseInt(opts.emailDays), parseInt(opts.maxEmails));
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

function parseDealId(input: string): number {
  const trimmed = input.trim();
  const match = trimmed.match(/\/deal\/(\d+)/) ?? trimmed.match(/^(\d+)$/);
  if (!match) throw new Error(`Could not parse deal ID from "${input}". Pass a numeric ID or a Pipedrive URL like https://<org>.pipedrive.com/deal/1234`);
  return parseInt(match[1], 10);
}

const marketing = program
  .command("marketing")
  .description("Marketing analytics commands");

marketing
  .command("getga4stats")
  .description("Fetch weekly GA4 metrics and append to Google Sheet")
  .option("-w, --week <YYWW>", "Year+week, e.g. 2601 (default: last completed week)")
  .option("--dry-run", "Show metrics without writing to Sheet")
  .action(async (opts) => {
    try {
      const result = await getGA4Stats({
        week: opts.week,
        dryRun: opts.dryRun ?? false,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

marketing
  .command("getpipedrivedeals")
  .description("Fetch weekly Pipedrive deals created count and write to Google Sheet")
  .option("-w, --week <YYWW>", "Year+week, e.g. 2601 (default: last completed week)")
  .option("-p, --pipeline <id>", "Pipedrive pipeline ID", "22")
  .option("--dry-run", "Show count without writing to Sheet")
  .action(async (opts) => {
    try {
      const result = await getPipedriveDeals({
        week: opts.week,
        pipeline: parseInt(opts.pipeline),
        dryRun: opts.dryRun ?? false,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

marketing
  .command("getyoutubestats")
  .description("Fetch weekly YouTube channel views and write to Google Sheet")
  .option("-w, --week <YYWW>", "Year+week, e.g. 2601 (default: last completed week)")
  .option("--dry-run", "Show views without writing to Sheet")
  .action(async (opts) => {
    try {
      const result = await getYouTubeStats({
        week: opts.week,
        dryRun: opts.dryRun ?? false,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

marketing
  .command("updateScorecard")
  .description("Fetch GA4 + Pipedrive data and update weekly scorecard in Google Sheet")
  .option("-w, --week <YYWW>", "Year+week, e.g. 2606 (default: last completed week)")
  .option("-p, --pipeline <id>", "Pipedrive pipeline ID", "22")
  .option("--dry-run", "Show data without writing to Sheet")
  .action(async (opts) => {
    try {
      const result = await updateScorecard({
        week: opts.week,
        pipeline: parseInt(opts.pipeline),
        dryRun: opts.dryRun ?? false,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

function printDealAnalysis(result: DealAnalysisResult) {
  const env = getEnv();
  const pipedriveUrl = `https://${env.PIPEDRIVE_DOMAIN}.pipedrive.com/deal`;

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

  console.log("\n========================================");
  console.log("         DEAL PRIORITIES");
  console.log(`    ${result.dealsAnalyzed} deals analyzed`);
  console.log("========================================\n");

  const sorted = result.analysis.deals.sort((a, b) => a.priority_rank - b.priority_rank);

  for (const deal of sorted) {
    console.log(`#${deal.priority_rank} [${healthIcon[deal.deal_health] ?? "   "}] ${deal.deal_title}`);
    console.log(`URL: ${pipedriveUrl}/${deal.deal_id}`);
    console.log(`Health: ${deal.deal_health.toUpperCase()} | Urgency: ${urgencyLabel[deal.urgency] ?? deal.urgency}`);
    console.log(`Stage: ${deal.current_stage} → ${deal.next_stage}`);

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

    console.log(`\nDraft Email (send: ${deal.draft_email.send_date}):`);
    console.log(`Subject: ${deal.draft_email.subject}`);
    console.log(`---`);
    console.log(deal.draft_email.body);
    console.log(`---`);

    if (deal.deal_history.length > 0) {
      console.log("\nDeal History:");
      for (const entry of deal.deal_history) {
        const link = entry.email_link ? ` ${entry.email_link}` : "";
        console.log(`  - ${entry.date}: ${entry.summary}${link}`);
      }
    }

    console.log("\n----------------------------------------\n");
  }
}

async function runFollowupCommand(dealId: number, emailDays: number, maxEmails: number): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => rl.question(q);

  try {
    console.log(`\nGathering deal context for #${dealId}...`);
    const gmail = await getGmailClient();
    await validateGmailCredentials(gmail);
    const userEmail = await getGmailUserEmail(gmail);
    const [stages, deal, contacts] = await Promise.all([
      getStagesMap(),
      getDealById(dealId),
      getDealContacts(dealId),
    ]);
    const dealContext = await enrichDeal(deal, stages, gmail, userEmail, emailDays, maxEmails);
    const language = detectLanguage(dealContext);

    const primary = contacts.find((c) => c.email) ?? contacts[0] ?? null;
    const senderName = process.env.SENDER_NAME?.trim() || "Chris";
    const roles: RoleContext | undefined = primary
      ? {
          senderName,
          senderEmail: userEmail,
          recipientName: primary.name,
          recipientEmail: primary.email ?? "",
        }
      : undefined;

    console.log(`Deal: ${deal.title}`);
    console.log(`Detected language: ${language === "pl" ? "Polish" : "English"}`);
    if (roles) console.log(`Sender: ${roles.senderName} → Recipient: ${roles.recipientName}\n`);
    else console.log();

    // Recap + ideas in parallel — recap is shown first, ideas right after.
    console.log("Summarizing deal and generating 3 follow-up ideas...");
    const [recap, ideasResult] = await Promise.all([
      summarizeDealForReview(dealContext, roles),
      generateFollowupIdeas(dealContext, language, roles),
    ]);
    printDealRecap(recap);
    const { ideas } = ideasResult;
    console.log();
    console.log();
    ideas.forEach((idea, i) => {
      console.log(`  [${i + 1}] ${idea.angle}`);
      console.log(`      ${idea.headline}`);
      console.log(`      Why: ${idea.rationale}\n`);
    });
    console.log("  [4] Write my own idea\n");

    let ideaBrief = "";
    while (!ideaBrief) {
      const choice = (await ask("Pick 1-4: ")).trim();
      if (["1", "2", "3"].includes(choice)) {
        const idea = ideas[parseInt(choice) - 1];
        ideaBrief = `Angle: ${idea.angle}\nPurpose: ${idea.headline}\nWhy now: ${idea.rationale}`;
      } else if (choice === "4") {
        const custom = (await ask("Describe your follow-up idea: ")).trim();
        if (custom) ideaBrief = `Custom idea from Chris: ${custom}`;
      } else {
        console.log("  (pick 1, 2, 3, or 4)");
      }
    }

    let draft: FollowupDraft = await draftFollowup({ dealContext, ideaBrief, language, roles });
    printDraft(draft);

    while (true) {
      const answer = (await ask("\nFeedback (Enter = accept, or type changes / 'q' to quit): ")).trim();
      if (answer === "") break;
      if (answer.toLowerCase() === "q") {
        console.log("Discarded. No draft saved.");
        return;
      }
      console.log("Revising...");
      draft = await draftFollowup({ dealContext, ideaBrief, language, roles, previousDraft: draft, feedback: answer });
      printDraft(draft);
    }

    const defaultTo = primary?.email ?? "";
    const toAnswer = (await ask(`Save Gmail draft to [${defaultTo || "no contact found — enter address"}]: `)).trim();
    const to = toAnswer || defaultTo;
    if (!to) {
      console.log("No recipient — skipping Gmail draft. Copy above and send manually.");
      return;
    }

    const result = await createDraft(gmail, { to, subject: draft.subject, body: draft.body });
    console.log(`\nGmail draft saved${result.signatureAppended ? " (signature appended)" : " (no signature — check Gmail settings or token scopes)"}.`);
    if (result.url) {
      console.log(`Opening: ${result.url}`);
      openInBrowser(result.url);
    } else {
      console.log(`Open Gmail → Drafts (id: ${result.id})`);
    }
  } finally {
    rl.close();
  }
}

function printDealRecap(recap: DealRecap): void {
  console.log("\n========== DEAL RECAP ==========");
  console.log(`\nStatus:\n  ${recap.status}`);
  console.log(`\nStage goal:\n  ${recap.stage_goal}`);
  if (recap.milestones.length > 0) {
    console.log(`\nRecent milestones:`);
    for (const m of recap.milestones) {
      console.log(`  [${m.date}] ${m.summary}`);
    }
  }
  console.log(`\nSuggested approach:\n  ${recap.suggested_approach}`);
  console.log("\n================================");
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start ''" :
    "xdg-open";
  exec(`${cmd} "${url}"`, (err) => {
    if (err) console.error(`(could not auto-open: ${err.message})`);
  });
}

function printDraft(draft: FollowupDraft): void {
  console.log("\n----------------------------------------");
  console.log(`Subject: ${draft.subject}`);
  console.log("----------------------------------------");
  console.log(draft.body);
  console.log("----------------------------------------");
}

program.parse();
