#!/usr/bin/env node
import { Command } from "commander";
import { runAnalysis } from "./commands/analyze.js";

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

program.parse();
