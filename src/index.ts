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
import { getGmailClient, validateGmailCredentials, createDraft, searchEmails } from "./lib/gmail.js";
import { getDealById, getDealContacts, getStagesMap } from "./lib/pipedrive.js";
import { recordFollowupActivity } from "./lib/followup-activity.js";
import { getGmailUserEmail } from "./lib/gmail.js";
import { generateFollowupIdeas, draftFollowup, detectLanguage, summarizeDealForReview, generateStandaloneSubject, analyzeFollowupLogs, type FollowupDraft, type RoleContext, type DealRecap, type FollowupInsights } from "./lib/claude.js";
import { FollowupLogger, findLatestFollowupLog, listFollowupLogs, readFollowupLog, appendFollowupEvent } from "./lib/followup-logger.js";
import { stripToBody, toLines, normalizeSubject, lineDiff } from "./lib/followup-review.js";

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

program
  .command("followup-review <idOrUrl>")
  .description("After you sent a follow-up (manually edited in Gmail): compare the sent email against the generated draft and record the diff in the run log. Accepts a deal ID or Pipedrive deal URL.")
  .action(async (idOrUrl: string) => {
    try {
      const dealId = parseDealId(idOrUrl);
      await runReviewSentCommand(dealId);
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("followup-insights")
  .description("Analyse all followup run logs (sent-vs-draft edits, in-loop feedback, validation retries) and print recommendations for improving the drafting prompt/agent. Read-only — proposes changes, never applies them.")
  .action(async () => {
    try {
      await runFollowupInsightsCommand();
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
  const logger = new FollowupLogger(dealId);
  logger.log("run_start", { dealId, emailDays, maxEmails });

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

    logger.log("context", {
      dealTitle: deal.title,
      language,
      sender: roles?.senderName,
      recipient: roles?.recipientName,
      recipientEmail: roles?.recipientEmail,
      dealContext,
    });

    // Recap + ideas in parallel — recap is shown first, ideas right after.
    console.log("Summarizing deal and generating 3 follow-up ideas...");
    const [recap, ideasResult] = await Promise.all([
      summarizeDealForReview(dealContext, roles),
      generateFollowupIdeas(dealContext, language, roles),
    ]);
    printDealRecap(recap);
    const { ideas } = ideasResult;
    logger.log("recap_and_ideas", { recap, ideas });
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
        logger.log("idea_selected", { choice, angle: idea.angle, ideaBrief });
      } else if (choice === "4") {
        const custom = (await ask("Describe your follow-up idea: ")).trim();
        if (custom) {
          ideaBrief = `Custom idea from Chris: ${custom}`;
          logger.log("idea_selected", { choice: "custom", ideaBrief });
        }
      } else {
        console.log("  (pick 1, 2, 3, or 4)");
      }
    }

    const onRetry = (attempt: number, issues: string[]) => logger.log("draft_retry", { attempt, issues });
    let draftVersion = 1;
    let draft: FollowupDraft = await draftFollowup({ dealContext, ideaBrief, language, roles, onRetry });
    printDraft(draft);
    logger.log("draft", { version: draftVersion, subject: draft.subject, body: draft.body });

    while (true) {
      const answer = (await ask("\nFeedback (Enter = accept, or type changes / 'q' to quit): ")).trim();
      if (answer === "") {
        logger.log("draft_accepted", { version: draftVersion });
        break;
      }
      if (answer.toLowerCase() === "q") {
        console.log("Discarded. No draft saved.");
        logger.log("discarded", { version: draftVersion });
        return;
      }
      console.log("Revising...");
      logger.log("draft_feedback", { version: draftVersion, feedback: answer });
      draft = await draftFollowup({ dealContext, ideaBrief, language, roles, previousDraft: draft, feedback: answer, onRetry });
      draftVersion++;
      printDraft(draft);
      logger.log("draft", { version: draftVersion, subject: draft.subject, body: draft.body });
    }

    const defaultTo = primary?.email ?? "";
    const toAnswer = (await ask(`Save Gmail draft to [${defaultTo || "no contact found — enter address"}]: `)).trim();
    const to = toAnswer || defaultTo;
    if (!to) {
      console.log("No recipient — skipping Gmail draft. Copy above and send manually.");
      logger.log("no_recipient");
      return;
    }
    logger.log("recipient", { to });

    // Look up the most recent Gmail thread with the recipient.
    let threadId: string | null = null;
    let inReplyTo: string | null = null;
    let references: string | null = null;
    let latestSubject = "";
    let latestDate = "";
    try {
      const recent = await searchEmails(gmail, to, emailDays, 5);
      const latest = recent.sort((a, b) => +new Date(b.date) - +new Date(a.date))[0];
      if (latest?.threadId) {
        threadId = latest.threadId;
        inReplyTo = latest.messageIdHeader || null;
        references = [latest.references, latest.messageIdHeader].filter(Boolean).join(" ").trim() || null;
        latestSubject = latest.subject;
        latestDate = latest.date ? new Date(latest.date).toISOString().split("T")[0] : "";
      }
    } catch {
      // ignore — no prior thread
    }
    logger.log("thread_lookup", { found: !!threadId, latestSubject, latestDate });

    // Interactive thread choice (only when a prior thread exists).
    if (threadId) {
      const threadAnswer = (
        await ask(
          `\nA prior Gmail thread exists with this recipient:\n  [${latestDate}] ${latestSubject}\nAttach the draft to this thread? [Y/n]: `,
        )
      ).trim().toLowerCase();
      if (threadAnswer === "n" || threadAnswer === "no") {
        threadId = null;
        inReplyTo = null;
        references = null;
      }
    }
    logger.log("thread_choice", { attach: !!threadId });

    // Standalone (no thread): the "Re: <original>" subject won't fit a fresh
    // thread. Generate a punchy subject tied to the client's need and let Chris
    // tweak it before saving.
    let finalSubject = draft.subject;
    if (!threadId) {
      console.log("\nStandalone email — generating a fresh subject line...");
      let suggested = draft.subject;
      try {
        suggested = await generateStandaloneSubject({ dealContext, emailBody: draft.body, language, roles });
      } catch {
        // fall back to the model's subject
      }
      const subjAnswer = (await ask(`Subject [${suggested}] (Enter = accept, or type your own): `)).trim();
      finalSubject = subjAnswer || suggested;
      logger.log("standalone_subject", { generated: suggested, final: finalSubject, edited: !!subjAnswer });
    }

    const result = await createDraft(gmail, {
      to,
      subject: finalSubject,
      body: draft.body,
      threadId,
      inReplyTo,
      references,
    });
    const sigNote = result.signatureAppended ? " (signature appended)" : " (no signature — check Gmail settings or token scopes)";
    const threadNote = result.attachedToThread ? " — attached to existing thread" : " — standalone";
    console.log(`\nGmail draft saved${sigNote}${threadNote}.`);
    logger.log("draft_saved", {
      id: result.id,
      url: result.url,
      subject: finalSubject,
      threadId: result.threadId,
      messageId: result.messageId,
      signatureAppended: result.signatureAppended,
      attachedToThread: result.attachedToThread,
    });
    if (result.url) {
      console.log(`Opening: ${result.url}`);
      openInBrowser(result.url);
    } else {
      console.log(`Open Gmail → Drafts (id: ${result.id})`);
    }

    // Offer to log the follow-up as a Pipedrive activity on the deal.
    const activityAnswer = (
      await ask("\nAdd this follow-up as a Pipedrive activity on the deal? [Y/n]: ")
    ).trim().toLowerCase();
    if (activityAnswer !== "n" && activityAnswer !== "no") {
      try {
        const activity = await recordFollowupActivity({
          dealId,
          emailSubject: finalSubject,
          note: draft.body,
          personId: primary?.id || undefined,
        });
        const verb = activity.done.mode === "updated" ? "Updated" : "Created";
        console.log(`Pipedrive: ${verb} FL#${activity.done.number} (marked done).`);
        if (activity.next.kind === "lost") {
          console.log(`Scheduled TASK "No answers after 5 FL, mark LOST." for ${activity.next.dueDate}.`);
        } else {
          console.log(`Scheduled next FL#${activity.next.number} for ${activity.next.dueDate} (2 working days).`);
        }
        logger.log("activity_added", { ...activity, dealId });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : err && typeof err === "object" && "error" in err
              ? String((err as { error: unknown }).error)
              : String(err);
        console.log(`Could not create Pipedrive activity: ${msg}`);
        logger.log("activity_error", { message: msg });
      }

      // Auto-review: capture what Chris changed vs the generated draft.
      // Loops so he can send in Gmail first, then press Enter to record edits.
      while (true) {
        const ans = (
          await ask("\nSend the email in Gmail, then press Enter to record your edits (or 's' to skip): ")
        ).trim().toLowerCase();
        if (ans === "s" || ans === "skip") {
          logger.log("review_skipped");
          break;
        }
        console.log("Looking for the sent email...");
        const found = await reviewSentEmail({
          gmail,
          userEmail,
          recipient: to,
          generatedSubject: finalSubject,
          generatedBody: draft.body,
          threadId: result.threadId ?? null,
          appendEvent: (type, data) => logger.log(type, data),
        });
        if (found) break;
      }
    } else {
      logger.log("activity_skipped");
    }

    console.log(`\nRun log: ${logger.file}`);
  } catch (err) {
    logger.log("error", { message: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    rl.close();
  }
}

/**
 * Fetches the actually-sent follow-up, diffs it against the generated draft,
 * prints the result, and records a `sent_review` event via `appendEvent`.
 * Shared by the inline auto-review (inside `followup`) and the standalone
 * `followup-review` command. Returns whether the sent email was found.
 */
async function reviewSentEmail(opts: {
  gmail: Awaited<ReturnType<typeof getGmailClient>>;
  userEmail: string;
  recipient: string;
  generatedSubject: string;
  generatedBody: string;
  threadId: string | null;
  appendEvent: (type: string, data: Record<string, unknown>) => void;
}): Promise<boolean> {
  const candidates = await searchEmails(opts.gmail, opts.recipient, 30, 20);
  const sent = candidates
    .filter((m) => m.from.toLowerCase().includes(opts.userEmail.toLowerCase()))
    .filter((m) => (opts.threadId ? m.threadId === opts.threadId : true))
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))[0];

  if (!sent) {
    console.log("No sent email found yet — is it still a draft, or not sent to this address? Run 'followup-review' after sending.");
    opts.appendEvent("sent_review", { found: false });
    return false;
  }

  const generated = stripToBody(opts.generatedBody);
  const sentBody = stripToBody(sent.body);
  const diff = lineDiff(toLines(generated), toLines(sentBody));
  const bodyChanged = diff.some((d) => d.op !== " ");
  const subjectChanged = normalizeSubject(sent.subject) !== normalizeSubject(opts.generatedSubject);

  console.log("\n============ SENT vs DRAFT ============");
  if (subjectChanged) {
    console.log(`\nSubject changed:`);
    console.log(`  - ${opts.generatedSubject}`);
    console.log(`  + ${sent.subject}`);
  } else {
    console.log(`\nSubject unchanged: ${sent.subject}`);
  }

  console.log(`\nBody:`);
  if (!bodyChanged) {
    console.log("  (sent verbatim — no edits)");
  } else {
    for (const d of diff) {
      console.log(`  ${d.op} ${d.text}`);
    }
  }
  console.log("\n======================================");

  opts.appendEvent("sent_review", {
    found: true,
    sentMessageId: sent.id,
    sentDate: sent.date,
    generatedSubject: opts.generatedSubject,
    sentSubject: sent.subject,
    subjectChanged,
    bodyChanged,
    generatedBody: generated,
    sentBody,
    diff,
  });
  return true;
}

async function runReviewSentCommand(dealId: number): Promise<void> {
  const logFile = findLatestFollowupLog(dealId);
  if (!logFile) {
    console.log(`No followup run log found for deal #${dealId}. Run 'followup ${dealId}' first.`);
    return;
  }

  const events = readFollowupLog(logFile);
  const back = [...events].reverse();
  const saved = back.find((e) => e.type === "draft_saved");
  const lastDraft = back.find((e) => e.type === "draft");
  const recipientEvent = back.find((e) => e.type === "recipient");
  if (!saved || !lastDraft || !recipientEvent) {
    console.log(`Run log ${logFile} is incomplete (no saved draft / recipient). Nothing to compare.`);
    return;
  }

  const recipient = String(recipientEvent.to ?? "");
  console.log(`\nLooking for the sent email to ${recipient}...`);
  const gmail = await getGmailClient();
  await validateGmailCredentials(gmail);
  const userEmail = await getGmailUserEmail(gmail);

  await reviewSentEmail({
    gmail,
    userEmail,
    recipient,
    generatedSubject: String(saved.subject ?? ""),
    generatedBody: String(lastDraft.body ?? ""),
    threadId: saved.threadId ? String(saved.threadId) : null,
    appendEvent: (type, data) => appendFollowupEvent(logFile, type, data),
  });
  console.log(`\nRun log: ${logFile}`);
}

function buildInsightsDigest(): { text: string; reviewedEmails: number; retries: number; feedbacks: number } {
  const files = listFollowupLogs();
  const sections: string[] = [];
  let reviewedEmails = 0;
  let retries = 0;
  let feedbacks = 0;

  const weekday = (d?: string): string => {
    if (!d) return "?";
    const dt = new Date(d);
    return Number.isNaN(+dt) ? "?" : `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()]} ${dt.toISOString().split("T")[0]}`;
  };

  for (const file of files) {
    const events = readFollowupLog(file);
    const dealId = /followup-(\d+)-/.exec(file)?.[1] ?? "?";
    const parts: string[] = [];

    const ctx = events.find((e) => e.type === "context");
    const runStart = events.find((e) => e.type === "run_start");

    // Latest sent_review per email (dedupe re-runs).
    const review = [...events].reverse().find((e) => e.type === "sent_review" && e.found === true);
    if (review) {
      reviewedEmails++;
      const edits = Array.isArray(review.diff)
        ? (review.diff as { op: string; text: string }[]).filter((d) => d.op !== " ")
        : [];
      parts.push(`SENT-vs-DRAFT edits:`);
      if (review.subjectChanged) parts.push(`  subject: "${review.generatedSubject}" -> "${review.sentSubject}"`);
      for (const e of edits) parts.push(`  ${e.op} ${e.text}`);
      if (!edits.length && !review.subjectChanged) parts.push(`  (sent verbatim)`);
    }

    const fb = events.filter((e) => e.type === "draft_feedback").map((e) => String(e.feedback));
    if (fb.length) {
      feedbacks += fb.length;
      parts.push(`In-loop feedback: ${fb.map((f) => `"${f}"`).join("; ")}`);
    }

    const retryIssues = events
      .filter((e) => e.type === "draft_retry")
      .flatMap((e) => (Array.isArray(e.issues) ? (e.issues as string[]) : []));
    if (retryIssues.length) {
      retries += retryIssues.length;
      parts.push(`Validation retries: ${retryIssues.join(" | ")}`);
    }

    const subj = [...events].reverse().find((e) => e.type === "standalone_subject");
    if (subj && subj.edited) parts.push(`Standalone subject edited: "${subj.generated}" -> "${subj.final}"`);

    if (parts.length) {
      const contextLine = `Context: drafted ${weekday(runStart?.t as string | undefined)}${
        review ? `, sent ${weekday(review.sentDate as string | undefined)}` : ""
      }${ctx?.language ? `, language ${ctx.language}` : ""}`;
      sections.push(`## Deal ${dealId}\n${contextLine}\n${parts.join("\n")}`);
    }
  }

  const header = `Followup logs analysed: ${files.length}. Emails with a sent-vs-draft review: ${reviewedEmails}.`;
  return { text: `${header}\n\n${sections.join("\n\n") || "(no actionable signal found)"}`, reviewedEmails, retries, feedbacks };
}

async function runFollowupInsightsCommand(): Promise<void> {
  const digest = buildInsightsDigest();
  console.log(`\n${digest.text}\n`);

  if (digest.reviewedEmails === 0 && digest.retries === 0 && digest.feedbacks === 0) {
    console.log("Not enough signal yet — send some follow-ups (auto-review captures your edits) and re-run.");
    return;
  }

  console.log("Analysing patterns...\n");
  const insights = await analyzeFollowupLogs(digest.text);
  printInsights(insights);
}

function printInsights(insights: FollowupInsights): void {
  console.log("============ FOLLOWUP INSIGHTS ============\n");
  console.log(`Summary:\n  ${insights.summary}\n`);
  if (!insights.recommendations.length) {
    console.log("No concrete recommendations yet.");
  } else {
    insights.recommendations.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.pattern}  (confidence: ${r.confidence.toUpperCase()})`);
      console.log(`     Evidence: ${r.evidence}`);
      console.log(`     Change:   ${r.change}`);
      console.log(`     Where:    ${r.location}\n`);
    });
  }
  console.log("==========================================");
  console.log("(Recommendations only — no code was changed.)");
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
