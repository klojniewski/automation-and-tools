import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getEnv } from "../config/env.js";

export const DealPrioritySchema = z.object({
  deals: z.array(
    z.object({
      deal_id: z.number(),
      deal_title: z.string(),
      priority_rank: z.number(),
      deal_health: z.enum(["hot", "warm", "cold", "at_risk"]),
      urgency: z.enum(["immediate", "this_week", "next_week", "no_rush"]),
      recommended_action: z.string(),
      reasoning: z.string(),
      key_signals: z.array(z.string()),
    }),
  ),
});

export type DealPriority = z.infer<typeof DealPrioritySchema>;

export async function analyzeDeals(dealContexts: string): Promise<DealPriority> {
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: `You are a sales intelligence analyst. Analyze these CRM deals and their email communication history. Rank deals by priority (1 = most urgent). Consider: staleness of communication, deal value, deal stage, email sentiment, and whether the contact is responsive. For each deal, recommend a specific next action (e.g., "Send follow-up email about proposal", "Schedule demo call", "Update deal stage to negotiation").`,
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
                  recommended_action: { type: "string" },
                  reasoning: { type: "string" },
                  key_signals: { type: "array", items: { type: "string" } },
                },
                required: [
                  "deal_id",
                  "deal_title",
                  "priority_rank",
                  "deal_health",
                  "urgency",
                  "recommended_action",
                  "reasoning",
                  "key_signals",
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
  const data = input.deals ? input : { deals: Array.isArray(input) ? input : [input] };

  return DealPrioritySchema.parse(data);
}
