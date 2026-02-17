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
      deal_history: z.array(
        z.object({
          date: z.string(),
          summary: z.string(),
        }),
      ),
    }),
  ),
});

export type DealPriority = z.infer<typeof DealPrioritySchema>;

export async function analyzeDeals(dealContexts: string): Promise<DealPriority> {
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16384,
    system: `You are a sales intelligence analyst specializing in software services & consulting (web development, app builds, SLAs, replatforming, technical consulting).

Apply the Challenger Sales methodology:
- TEACH: Recommend actions that educate the prospect on insights they haven't considered — reframe their thinking about their problem
- TAILOR: Factor in the specific dynamics of each deal — who are the decision-makers, what's their technical evaluation cycle, are there committee decisions
- TAKE CONTROL: Push prospects toward decisions with constructive tension — set deadlines, propose bold next steps, don't accept stalling

Factor in typical software consulting dynamics: scope creep risk, decision-by-committee, technical evaluation cycles, budget approval processes.

Analyze these CRM deals and their email communication history. Rank deals by priority (1 = most urgent). Consider: staleness of communication, deal value, deal stage, email sentiment, and whether the contact is responsive.

IMPORTANT formatting rules:
- Return concise bullet points, NOT full sentences
- Each bullet should be a scannable phrase (e.g. "£15.6K value, strong momentum" not "The deal value is £15.6K and there is strong momentum")
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
                    description: "Concise bullet points for next actions using Challenger methodology — push toward decisions, create tension, reframe thinking",
                  },
                  reasoning: {
                    type: "array",
                    items: { type: "string" },
                    description: "Concise bullet points explaining why this deal is ranked here",
                  },
                  key_signals: {
                    type: "array",
                    items: { type: "string" },
                    description: "Short signal phrases from emails/activities",
                  },
                  deal_history: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        date: { type: "string", description: "Short date like 'Feb 5' or 'Jan 30'" },
                        summary: { type: "string", description: "One short sentence summarizing the action" },
                      },
                      required: ["date", "summary"],
                    },
                    description: "Last 5 actions/activities/emails, latest first",
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
  let deals = input.deals ?? input;
  if (typeof deals === "string") {
    deals = JSON.parse(deals);
  }
  if (!Array.isArray(deals)) {
    deals = [deals];
  }

  return DealPrioritySchema.parse({ deals });
}
