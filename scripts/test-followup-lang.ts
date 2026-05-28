/**
 * One-off verification: gathers deal context, prints detected language and a sample of
 * the email body characters seen. No Claude calls, no Gmail draft.
 *
 * Usage: npx tsx scripts/test-followup-lang.ts <dealId>
 */

import "dotenv/config";
import { enrichDeal } from "../src/lib/deal-analysis.js";
import { detectLanguage } from "../src/lib/claude.js";
import { getGmailClient, validateGmailCredentials, getGmailUserEmail } from "../src/lib/gmail.js";
import { getDealById, getStagesMap } from "../src/lib/pipedrive.js";

const dealId = parseInt(process.argv[2] ?? "0", 10);
if (!dealId) {
  console.error("Usage: npx tsx scripts/test-followup-lang.ts <dealId>");
  process.exit(1);
}

const gmail = await getGmailClient();
await validateGmailCredentials(gmail);
const userEmail = await getGmailUserEmail(gmail);
const [stages, deal] = await Promise.all([getStagesMap(), getDealById(dealId)]);

const ctx = await enrichDeal(deal, stages, gmail, userEmail, 90, 10);
const lang = detectLanguage(ctx);

const matches = ctx.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) ?? [];
const distinct = new Set(matches.map((c) => c.toLowerCase())).size;

console.log(`Deal: ${deal.title}`);
console.log(`Detected language: ${lang === "pl" ? "Polish" : "English"}`);
console.log(`Polish chars: ${matches.length} total / ${distinct} distinct`);
console.log(`Sample: ${matches.slice(0, 30).join("") || "(none)"}`);
console.log(`Context length: ${ctx.length} chars`);
