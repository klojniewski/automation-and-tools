/**
 * Dump the enriched deal context for a deal ID. Useful for inspecting what
 * the followup/analyze LLM actually sees.
 *
 * Usage: npx tsx scripts/dump-deal-context.ts <dealId>
 */

import "dotenv/config";
import { enrichDeal } from "../src/lib/deal-analysis.js";
import { getGmailClient, validateGmailCredentials, getGmailUserEmail } from "../src/lib/gmail.js";
import { getDealById, getStagesMap } from "../src/lib/pipedrive.js";

const dealId = parseInt(process.argv[2] ?? "0", 10);
if (!dealId) {
  console.error("Usage: npx tsx scripts/dump-deal-context.ts <dealId>");
  process.exit(1);
}

const gmail = await getGmailClient();
await validateGmailCredentials(gmail);
const userEmail = await getGmailUserEmail(gmail);
const [stages, deal] = await Promise.all([getStagesMap(), getDealById(dealId)]);
const ctx = await enrichDeal(deal, stages, gmail, userEmail, 90, 10);
console.log(ctx);
