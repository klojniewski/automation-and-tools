import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getEnv } from "./env.js";

export const DealPrioritySchema = z.object({
  deals: z.array(
    z.object({
      deal_id: z.number(),
      deal_title: z.string(),
      priority_rank: z.number(),
      deal_health: z.enum(["hot", "warm", "cold", "at_risk"]),
      urgency: z.enum(["immediate", "this_week", "next_week", "no_rush"]),
      recommended_actions: z.array(z.string()),
      reasoning: z.array(z.string()),
      key_signals: z.array(z.string()),
      current_stage: z.string(),
      next_stage: z.string(),
      draft_email: z.object({
        send_date: z.string(),
        subject: z.string(),
        body: z.string(),
      }),
      deal_history: z.array(
        z.object({
          date: z.string(),
          summary: z.string(),
          email_link: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
});

export type DealPriority = z.infer<typeof DealPrioritySchema>;

export async function analyzeDeals(dealContexts: string, topN?: number): Promise<DealPriority> {
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const today = new Date().toISOString().split("T")[0];
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 12000,
    system: `Today's date: ${today}

You are a sales intelligence analyst specializing in software services & consulting (web development, app builds, SLAs, replatforming, technical consulting).

Apply the Challenger Sales methodology:
- TEACH: Recommend actions that educate the prospect on insights they haven't considered — reframe their thinking about their problem
- TAILOR: Factor in the specific dynamics of each deal — who are the decision-makers, what's their technical evaluation cycle, are there committee decisions
- TAKE CONTROL: Push prospects toward decisions with constructive tension — set deadlines, propose bold next steps, don't accept stalling

Factor in typical software consulting dynamics: scope creep risk, decision-by-committee, technical evaluation cycles, budget approval processes.

Analyze these CRM deals and their email communication history.

RANKING RULES — rank by "where should I spend my time today", NOT by proximity to close:
1. ACTION NEEDED + high risk of loss (frustrated client, deal going cold, deadline today) = rank highest
2. ACTION NEEDED + time-sensitive window (prospect promised decision today, reply expected) = rank high
3. ACTION NEEDED + high value early-stage (need to maintain momentum after recent call/meeting) = rank medium
4. WAITING FOR REPLY (recently sent, <2 days ago) = rank LOW regardless of deal value or stage — nothing to do today
5. WAITING FOR REPLY (3+ days, no response) = rank medium — time to follow up

Deals where you sent an email today or yesterday and are waiting for a reply should NEVER be #1 — there is no action to take. These are "monitor" deals.

A £15K deal at final stage where contract was just sent today is LESS urgent than a £32K deal where the client is frustrated and you haven't replied in a week.

Each deal includes its current pipeline stage, what's needed to advance, and what the next stage requires. Use this to make recommended_actions specific to advancing the deal to the next stage. Focus on concrete actions that move the deal forward in the pipeline, not generic sales advice.

CRITICAL — Conversation status awareness:
- Each deal has a "Conversation status" line showing who emailed last and when.
- If status is "WAITING FOR REPLY" (ball in prospect's court): do NOT recommend re-sending what was already said. Instead recommend: when to follow up if no reply, what to prepare in the meantime, and parallel actions. Give the prospect at least 1 business day to respond before suggesting any follow-up.
- If status is "ACTION NEEDED" (ball in our court): recommend immediate response actions.
- The draft_email should match the timing of your recommended actions:
  - WAITING FOR REPLY: draft the follow-up email to send on the date you recommend following up (e.g. "Send this on Tue Mar 11 if no reply"). The email tone should assume the prospect hasn't responded yet — use phrases like "wanted to circle back", "following up on the contract I sent Monday". Do NOT write it as if sending today.
  - ACTION NEEDED: draft an immediate response email.
  - Never duplicate an email that was already sent.
- Adjust urgency accordingly — "waiting for reply sent today" should be "this_week" not "immediate".
${topN ? `\nIMPORTANT: Only return the top ${topN} highest-priority deals. Do NOT return all deals.` : ""}

IMPORTANT formatting rules:
- Return concise bullet points, NOT full sentences
- Each bullet should be a scannable phrase (e.g. "£15.6K value, strong momentum" not "The deal value is £15.6K and there is strong momentum")
- LIMIT: max 3 items per recommended_actions, reasoning, and key_signals — pick only the most impactful
- For deal_history: extract the 5 most recent actions/activities/emails from the deal context, return in reverse chronological order (latest first), each with a short date and one-line summary`,
    messages: [{ role: "user", content: dealContexts }],
    tools: [
      {
        name: "deal_priority_analysis",
        description: "Structured priority analysis of all deals",
        input_schema: {
          type: "object" as const,
          properties: {
            deals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  deal_id: { type: "number" },
                  deal_title: { type: "string" },
                  priority_rank: { type: "number" },
                  deal_health: {
                    type: "string",
                    enum: ["hot", "warm", "cold", "at_risk"],
                  },
                  urgency: {
                    type: "string",
                    enum: ["immediate", "this_week", "next_week", "no_rush"],
                  },
                  recommended_actions: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 3,
                    description: "Top 3 concise bullet points for next actions using Challenger methodology — push toward decisions, create tension, reframe thinking",
                  },
                  reasoning: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 3,
                    description: "Top 3 concise bullet points explaining why this deal is ranked here",
                  },
                  key_signals: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 3,
                    description: "Top 3 short signal phrases from emails/activities",
                  },
                  current_stage: { type: "string", description: "Current pipeline stage name (copy from deal context)" },
                  next_stage: { type: "string", description: "Next pipeline stage to push toward (copy from deal context, or 'Close - Won' if final stage)" },
                  draft_email: {
                    type: "object",
                    properties: {
                      send_date: { type: "string", description: "When to send this email. Use 'Today' if ACTION NEEDED, or a specific date like 'Tue Mar 11' if WAITING FOR REPLY. Match the follow-up timing from recommended_actions." },
                      subject: { type: "string", description: "Email subject line — use Re: if continuing an existing thread" },
                      body: { type: "string", description: "Short, direct email body (3-5 sentences max). Use the contact's first name. Reference specific details from the deal context. Push toward the next pipeline stage action. Sign off as Chris. If WAITING FOR REPLY, write this as a future follow-up (not to send today)." },
                    },
                    required: ["send_date", "subject", "body"],
                    description: "Ready-to-send follow-up email draft for this deal",
                  },
                  deal_history: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        date: { type: "string", description: "Short date like 'Feb 5' or 'Jan 30'" },
                        summary: { type: "string", description: "One short sentence summarizing the action" },
                        email_link: { type: "string", description: "Gmail link if this entry is from an email (copy the Link: URL from the email history). Omit if not from email." },
                      },
                      required: ["date", "summary"],
                    },
                    description: "Last 5 actions/activities/emails, latest first. Include email_link when available.",
                  },
                },
                required: [
                  "deal_id",
                  "deal_title",
                  "priority_rank",
                  "deal_health",
                  "urgency",
                  "recommended_actions",
                  "reasoning",
                  "key_signals",
                  "current_stage",
                  "next_stage",
                  "draft_email",
                  "deal_history",
                ],
              },
            },
          },
          required: ["deals"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "deal_priority_analysis" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");

  const input = toolBlock.input as any;

  // Handle various response shapes from Claude
  let deals: any;
  if (Array.isArray(input.deals)) {
    deals = input.deals;
  } else if (Array.isArray(input)) {
    deals = input;
  } else if (typeof input.deals === "string") {
    deals = JSON.parse(input.deals);
  } else if (typeof input === "string") {
    deals = JSON.parse(input);
  } else {
    // Possibly nested one level deeper — check for any array property
    const arrayProp = Object.values(input).find(Array.isArray);
    if (arrayProp) {
      deals = arrayProp;
    } else {
      deals = [input];
    }
  }

  // Unwrap if deals are wrapped in an extra object (e.g. [{deals: [...]}])
  if (deals.length === 1 && Array.isArray(deals[0]?.deals)) {
    deals = deals[0].deals;
  }

  // Hard limit: Claude may ignore the topN instruction, so enforce it here
  if (topN && deals.length > topN) {
    deals = deals
      .sort((a: any, b: any) => (a.priority_rank ?? 999) - (b.priority_rank ?? 999))
      .slice(0, topN);
  }

  return DealPrioritySchema.parse({ deals });
}
