#!/usr/bin/env node
import { Command } from "commander";
import { runAnalysis } from "./commands/analyze.js";
import { runGetGA4Stats } from "./commands/marketing/getga4stats.js";
import { runGetPipedriveDeals } from "./commands/marketing/getpipedrivedeals.js";
import { runUpdateScorecard } from "./commands/marketing/updatescorecard.js";

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
  .option("--dry-run", "Show data without calling Claude")
  .option("-v, --verbose", "Print detailed API data")
  .action(async (opts) => {
    try {
      await runAnalysis({
        limit: parseInt(opts.limit),
        emailDays: parseInt(opts.emailDays),
        maxEmails: parseInt(opts.maxEmails),
        dryRun: opts.dryRun ?? false,
        verbose: opts.verbose ?? false,
      });
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const marketing = program
  .command("marketing")
  .description("Marketing analytics commands");

marketing
  .command("getga4stats")
  .description("Fetch weekly GA4 metrics and append to Google Sheet")
  .option("-w, --week <YYWW>", "Year+week, e.g. 2601 (default: last completed week)")
  .option("--dry-run", "Show metrics without writing to Sheet")
  .option("-v, --verbose", "Print extra debug info")
  .action(async (opts) => {
    try {
      await runGetGA4Stats({
        week: opts.week,
        dryRun: opts.dryRun ?? false,
        verbose: opts.verbose ?? false,
      });
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
  .option("-v, --verbose", "Print extra debug info")
  .action(async (opts) => {
    try {
      await runGetPipedriveDeals({
        week: opts.week,
        pipeline: parseInt(opts.pipeline),
        dryRun: opts.dryRun ?? false,
        verbose: opts.verbose ?? false,
      });
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
  .option("-v, --verbose", "Print extra debug info")
  .action(async (opts) => {
    try {
      await runUpdateScorecard({
        week: opts.week,
        pipeline: parseInt(opts.pipeline),
        dryRun: opts.dryRun ?? false,
        verbose: opts.verbose ?? false,
      });
    } catch (err) {
      console.error("\nError:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
