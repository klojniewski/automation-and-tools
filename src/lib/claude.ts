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

export const TimelineEntrySchema = z.object({
  date: z.string(),
  summary: z.string(),
  email_link: z.string().nullable().optional(),
});

export const TimelineSchema = z.object({
  deal_id: z.number(),
  deal_title: z.string(),
  value: z.string(),
  contact: z.string(),
  current_status: z.string(),
  milestones: z.array(TimelineEntrySchema),
  detailed_log: z.array(TimelineEntrySchema),
  current_stage: z.string(),
  next_stage: z.string(),
  deal_health: z.enum(["hot", "warm", "cold", "at_risk"]),
});

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type Timeline = z.infer<typeof TimelineSchema>;

function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    // Fix common malformed JSON from LLMs: single quotes, trailing commas, unquoted keys
    const cleaned = str
      .replace(/'/g, '"')
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
    return JSON.parse(cleaned);
  }
}

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
- For deal_history: extract the 5 most recent actions/activities/emails from the deal context, return in reverse chronological order (latest first), each with an ISO date (YYYY-MM-DD) and one-line summary`,
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
                        date: { type: "string", description: "ISO date like '2026-03-13'" },
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
    deals = tryParseJSON(input.deals);
  } else if (typeof input === "string") {
    deals = tryParseJSON(input);
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

export async function buildTimeline(dealContext: string): Promise<Timeline> {
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const today = new Date().toISOString().split("T")[0];

  const timelineEntrySchema = {
    type: "object" as const,
    properties: {
      date: { type: "string" as const, description: "ISO date like '2026-03-13'" },
      summary: { type: "string" as const, description: "One-line summary of the event" },
      email_link: { type: "string" as const, description: "Gmail link if from email. Omit if not." },
    },
    required: ["date", "summary"],
  };

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 10000,
    system: `Today's date: ${today}

You are a sales intelligence analyst. Build a comprehensive timeline for this deal.

OUTPUT TWO SEPARATE LISTS:

1. MILESTONES (10-15 max) — only stage-advancing, deal-changing events:
   - First contact, discovery calls, proposals sent/accepted, contracts sent/signed
   - Key decisions, pricing agreements, scope changes
   - Latest first. Include email_link when available.
   - These are the "permanent record" — the events a new person needs to understand the deal.

2. DETAILED LOG — all other meaningful events, FILTERED:
   - Include: follow-ups, status updates, scheduling, introductions, negotiation points
   - EXCLUDE: acknowledgement replies ("no problem", "thanks", "sounds good"), calendar invite accepts, CRM "Follow Up deadline logged" reminders, trivial confirmations
   - Latest first. Include email_link when available.

Also provide:
- value: deal value as shown (e.g. "£15,600")
- contact: primary contact name and company (e.g. "Shane (Codeforge)")
- current_status: 1-2 sentence summary of where the deal stands RIGHT NOW and what's blocking progress`,
    messages: [{ role: "user", content: dealContext }],
    tools: [
      {
        name: "deal_timeline",
        description: "Structured timeline with milestones and detailed log",
        input_schema: {
          type: "object" as const,
          properties: {
            deal_id: { type: "number" },
            deal_title: { type: "string" },
            value: { type: "string", description: "Deal value e.g. '£15,600'" },
            contact: { type: "string", description: "Primary contact e.g. 'Shane (Codeforge)'" },
            current_status: { type: "string", description: "1-2 sentences: where the deal stands now and what's blocking" },
            milestones: {
              type: "array",
              items: timelineEntrySchema,
              description: "10-15 key stage-advancing events, latest first",
            },
            detailed_log: {
              type: "array",
              items: timelineEntrySchema,
              description: "All other meaningful events (filtered), latest first",
            },
            current_stage: { type: "string" },
            next_stage: { type: "string" },
            deal_health: {
              type: "string",
              enum: ["hot", "warm", "cold", "at_risk"],
            },
          },
          required: ["deal_id", "deal_title", "value", "contact", "current_status", "milestones", "detailed_log", "current_stage", "next_stage", "deal_health"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "deal_timeline" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");

  return TimelineSchema.parse(toolBlock.input);
}

export type Language = "en" | "pl";

export function detectLanguage(dealContext: string): Language {
  // Polish-specific characters that don't appear in English.
  // Note: a single repeating char (e.g. "Łojniewski" in Chris's signature) is NOT a signal.
  // Real Polish text contains a diverse mix of these diacritics.
  const matches = dealContext.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) ?? [];
  const total = matches.length;
  const distinct = new Set(matches.map((c) => c.toLowerCase())).size;
  if (total >= 8 && distinct >= 4) return "pl";
  return "en";
}

function languageDirective(lang: Language): string {
  if (lang === "pl") {
    return `OUTPUT LANGUAGE: POLISH.
ALL of your output MUST be in natural, native-level Polish:
- The 3 idea angles, headlines, and rationales — in Polish.
- The final email subject and body — in Polish.
- Professional B2B Polish. Use informal "Cześć [imię]" greeting unless the thread is clearly formal.
- Sign off "Pozdrawiam, Chris" or "Pozdrawiam serdecznie, Chris".
- Use Polish diacritics (ą, ć, ę, ł, ń, ó, ś, ź, ż) correctly — do not strip them.
- Never translate names. Never mix Polish and English in one email.`;
  }
  return `OUTPUT LANGUAGE: ENGLISH.
All angles, headlines, rationales, subject, and body in English. Sign off "Best, Chris" or "Cheers, Chris".`;
}

const SALES_APPROACH = `Sales approach for the follow-up:
- Help the prospect: lead with value, insight, or a useful question — never an empty "checking in".
- Challenge constructively: be honest, surface risks or trade-offs they may not have considered.
- Lead the conversation: always propose a concrete next step (a call slot, a decision, a deliverable).
- Don't push too hard: respectful tension, never desperate. One ask per email.
- Keep deals progressing: every email should move the deal closer to the next pipeline stage.

REAL vs INTERNAL communication — non-negotiable:
- The deal context has TWO separate sections: "Internal CRM activities" (private notes — the prospect has NEVER seen these) and "Email history with prospect" (real messages the prospect actually received).
- NEVER reference an internal CRM activity / note / call log as if the prospect saw it. Phrases like "following up on my note", "as I mentioned last week", "my message" are LIES unless there is a matching email in the Email history section.
- NEVER use the word "note" for something you sent the prospect. Banned outright: "my note", "my last note", "my previous note", "my earlier note" — a note is an internal record the prospect never saw. This is a hard ban (the draft is rejected if it appears).
- When you reference a prior email to the prospect, name its actual subject or topic instead — e.g. "my email about the React/AWS audit" or "the proposal I sent on Monday". If you can't point to a specific real email, open fresh and don't reference any prior message.
- Check the "Contact log" block. If it says "FIRST CONTACT": this is your first message to this prospect ever — open as a first introduction responding to their inbound website enquiry. Never write "following up", "checking in", "circling back" — there is nothing to follow up on.
- If outbound emails to prospect = 0 but inbound emails > 0: respond to their inbound message. Reference its specific content, not a CRM note.
- If both outbound and inbound emails exist: you may reference prior emails, but only the ones in the Email history section.

STAGE ANCHORING — non-negotiable:
- The deal context contains a "Pipeline position" block with the current stage, the exit criteria ("To advance: ..."), and the next stage trigger ("Requires: ...").
- Every idea you generate and every email you write MUST be aimed at satisfying the current stage's exit criteria — that's the concrete next step.
- If the deal is at "Lead In": the goal is to book an Intro Meeting. Propose a slot.
- If "Qualification Call Made": the goal is to complete BANT. Surface the missing BANT items (budget / authority / need / timeline) and ask the right question.
- If "Deal Qualified" / "Situation Investigated": the goal is to land the Project Concept doc — propose a discovery call or request the input needed to write it.
- If "Concept Confirmed": the goal is to get the proposal in front of them — propose the meeting/walkthrough.
- If "Proposal Sent": the goal is to get explicit accept/reject — ask for the decision or the blocker.
- If "Agreement Sent": the goal is to get the contract signed — surface and resolve open contract terms.
- Never propose a generic "let me know if you have questions". Always tie the ask to the specific exit criterion for this stage.

TONE — non-negotiable, Chris writes in plain B2-level English:
- Short, simple words. Common everyday vocabulary. No jargon, no buzzwords, no corporate-speak.
- Short sentences. Two short sentences beat one long one. No long subordinate clauses.
- Sound like a real person on a Slack message, not a sales rep on a webinar.

NO AI TELLS — non-negotiable (the em-dash is the #1 giveaway):
- NEVER use an em-dash (—) or en-dash (–). Not once. Use a full stop, a comma, or split into two sentences instead. This is a hard rule — a single dash means the draft is rejected.
- No curly/smart quotes — use plain straight quotes ' and ".
- No rule-of-three lists ("fast, clean, and reliable"), no "not just X, but Y" parallelisms, no synonym-stacking.
- No throat-clearing or signposting ("Quick question", "Just to be clear", "Here's the thing").
- No manufactured drama or aphorisms. Plain, direct, slightly informal — like a quick note to a peer.
- BANNED phrases and patterns: "I wanted to check in", "circle back", "touch base", "leverage", "synergy", "constructive tension", "fear-of-loss", "low-friction", "sounding board", "meaningful efficiency angle", "worth a conversation", "happy to be a sounding board", "given X's scale", "the reason I ask", "one thing worth a conversation", "I'd suggest", "walk you through what that looks like in practice".
- BANNED words that signal AI/corporate writing: "leverage", "utilize", "optimize", "robust", "seamless", "strategic", "holistic", "ecosystem", "stakeholder", "alignment", "synergy", "drive value".
- Use contractions: "I'm", "you're", "we've", "it's".
- Length: 3–6 short sentences. Sign off "Best, Chris" or "Cheers, Chris".

READABILITY / FORMATTING — non-negotiable:
- ONE SENTENCE PER PARAGRAPH. Every single sentence stands on its own line with a BLANK LINE before and after it. Never put two sentences in the same paragraph, even short ones.
- A blank line = "\\n\\n" in the body string. So between every sentence there must be a "\\n\\n".
- This applies to standalone remarks too: "Either answer is fine." is its own line. Each "If X, then Y." conditional is its own line.
- Greeting on its own line, then blank line. Sign-off ("Best," then "Chris") at the end, after a blank line.
- The email should scan in 5 seconds on a phone screen — lots of whitespace, no walls of text.
- Example shape (note: EVERY sentence separated by a blank line):

Hey Lucas,

[Short reason for writing. One sentence.]

[The question. One sentence.]

[A standalone remark. One sentence.]

[The ask. One sentence.]

[Optional context or the alternative. One sentence.]

Best,
Chris`;

/**
 * Day-of-week-aware scheduling guidance. The right horizon for "when should we
 * talk" depends on the send day: early in the week there's still room THIS week;
 * late in the week you should point to NEXT week. Prevents the model proposing
 * "next week" on a Monday (a real edit Chris kept making). Boundary: Mon–Wed =>
 * this week, Thu–Fri => next week, weekend => next week.
 */
export function buildSchedulingRule(now: Date): string {
  const dow = now.getDay(); // 0 Sun ... 6 Sat
  const name = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow];
  let horizon: string;
  if (dow >= 1 && dow <= 3) {
    horizon = `It is early in the week (Mon–Wed), so propose THIS week — there are still enough working days left to plan. Prefer concrete days, e.g. "later this week (Thu or Fri)". Do NOT say "next week".`;
  } else if (dow === 4 || dow === 5) {
    horizon = `It is late in the week (Thu–Fri), so propose EARLY NEXT week, e.g. "Monday or Tuesday next week". Do NOT say "this week".`;
  } else {
    horizon = `It is the weekend, so propose NEXT week.`;
  }
  return `SCHEDULING HORIZON — today is ${name}:
- When you propose a call/meeting time, match the horizon to the send day (above), not a generic default.
- ${horizon}`;
}

/** Chris's real Calendly booking link. The model must never invent or alter it. */
const CALENDLY_URL = "https://calendly.com/chris8/30min";

const SCHEDULING_LINK_RULE = `BOOKING LINK — non-negotiable:
- Chris's booking link is EXACTLY: ${CALENDLY_URL}
- NEVER invent, guess, shorten, or alter a URL. If you include a booking link, it must be ${CALENDLY_URL} character for character. A made-up link is worse than none.
- When the email proposes a call/meeting, put this link in the BODY of the email (recipients don't read the signature footer, so don't rely on it).
- If the email is not about booking a meeting, don't include the link.`;

export const FollowupIdeasSchema = z.object({
  ideas: z
    .array(
      z.object({
        angle: z.string(),
        headline: z.string(),
        rationale: z.string(),
      }),
    )
    .length(3),
});
export type FollowupIdeas = z.infer<typeof FollowupIdeasSchema>;

export interface RoleContext {
  senderName: string;
  senderEmail: string;
  recipientName: string;
  recipientEmail: string;
}

function buildRoleBlock(roles: RoleContext): string {
  const senderFirst = roles.senderName.split(/\s+/)[0].toLowerCase();
  const recipientFirst = roles.recipientName.split(/\s+/)[0].toLowerCase();
  const collision = senderFirst === recipientFirst;
  const recipientLast = roles.recipientName.split(/\s+/).slice(1).join(" ").trim();

  let block = `ROLE CLARITY — non-negotiable:
- YOU are writing AS: ${roles.senderName} <${roles.senderEmail}> (the SENDER, the sales rep). Sign off as ${roles.senderName.split(/\s+/)[0]}.
- The recipient is: ${roles.recipientName} <${roles.recipientEmail}> (the PROSPECT, who has NOT replied yet).
- The follow-up is FROM the sender TO the prospect. Never write the email as if the prospect is replying. The prospect is the one being asked, not answering.
- If the deal context shows "Conversation status: WAITING FOR REPLY", the LAST outbound was from the sender — the new email continues that thread by following up, never by pretending to be the prospect's reply.`;

  if (collision && recipientLast) {
    block += `

NAME COLLISION WARNING: the sender and the prospect share the first name "${roles.senderName.split(/\s+/)[0]}". To eliminate any ambiguity in the greeting, address the prospect by their LAST NAME or full name (e.g. "Hey ${recipientLast}," or "Hi ${roles.recipientName},"). Do NOT use "Hey Chris," — it's confusing because the sender is also Chris.`;
  } else if (collision) {
    block += `

NAME COLLISION WARNING: the sender and the prospect share the first name. Use the prospect's full name in the greeting to disambiguate.`;
  }

  return block;
}

export async function generateFollowupIdeas(
  dealContext: string,
  language: Language = "en",
  roles?: RoleContext,
): Promise<FollowupIdeas> {
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const today = new Date().toISOString().split("T")[0];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: `Today's date: ${today}

You generate follow-up email ideas for a sales rep at a software consulting agency.

${roles ? buildRoleBlock(roles) + "\n\n" : ""}${languageDirective(language)}

${SALES_APPROACH}

Read the deal context and produce EXACTLY 3 distinct follow-up angles. Each angle must be meaningfully different (different purpose, not 3 wordings of the same idea). Consider angles like:
- Value-add insight (share a relevant observation, resource, or teach moment)
- Concrete next-step proposal (book the call, send the SOW, set a decision deadline)
- Honest check / challenge (surface a concern, ask a hard question, reframe)
- Progress nudge (reference a specific past commitment or open thread)
- Multi-threading (loop in another stakeholder, escalate)

For each idea:
- angle: 2–4 word label (e.g. "Decision deadline nudge")
- headline: one sentence describing the email's purpose
- rationale: one sentence on why this is the right move for THIS deal right now`,
    messages: [{ role: "user", content: dealContext }],
    tools: [
      {
        name: "followup_ideas",
        description: "3 distinct follow-up angle ideas",
        input_schema: {
          type: "object" as const,
          properties: {
            ideas: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  angle: { type: "string" },
                  headline: { type: "string" },
                  rationale: { type: "string" },
                },
                required: ["angle", "headline", "rationale"],
              },
            },
          },
          required: ["ideas"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "followup_ideas" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");
  return FollowupIdeasSchema.parse(toolBlock.input);
}

export const FollowupDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});
export type FollowupDraft = z.infer<typeof FollowupDraftSchema>;

export const DealRecapSchema = z.object({
  status: z.string(),
  stage_goal: z.string(),
  milestones: z
    .array(z.object({ date: z.string(), summary: z.string() }))
    .max(5),
  suggested_approach: z.string(),
});
export type DealRecap = z.infer<typeof DealRecapSchema>;

export const FollowupInsightsSchema = z.object({
  summary: z.string(),
  recommendations: z.array(
    z.object({
      pattern: z.string(),
      evidence: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      change: z.string(),
      location: z.string(),
    }),
  ),
});
export type FollowupInsights = z.infer<typeof FollowupInsightsSchema>;

/**
 * Meta-analysis over followup run logs: reads a digest of edits (generated draft
 * vs actually-sent), in-loop feedback, and validation retries, and proposes
 * concrete prompt/agent improvements. It ONLY recommends — it never edits code.
 * Honest about sample size: patterns backed by a single email must be "low".
 */
export async function analyzeFollowupLogs(digest: string): Promise<FollowupInsights> {
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2500,
    system: `You improve an AI that drafts B2B sales follow-up emails. You are given a digest of real usage logs. Each deal block starts with a "Context:" line (day the email was drafted/sent, language) followed by:
- SENT-vs-DRAFT edits: lines the model wrote ("-") vs what the human actually sent ("+"). These are the human's corrections — the strongest signal.
- In-loop feedback: revision instructions the human typed during drafting.
- Validation retries: banned phrases/patterns the model kept producing.
- Idea/subject stats.

Your job: find patterns and propose concrete changes to the drafting system.

HOW TO READ AN EDIT — first classify each edit, then judge it:
- Classify the change type: temporal/scheduling (days, "this/next week", times), formatting (lists, italics, line breaks), word-choice, deletion, tone, structure.
- CRITICAL: check the edit against the Context line. Some edits are only explained by context. Example: "next week" -> "this week" is NOT random taste — correlate it with the send weekday (early week => "this week" makes sense; late week => "next week"). Always test temporal/scheduling edits against the send day, greetings against language, etc.

TWO KINDS OF RULE — judge sample size differently:
- LOGICAL / context-conditioned rule (derivable from calendar, language, deal stage, seniority): if the edit is explained by context, it is a real rule even from ONE email. You may propose it with "medium" (or "high" if the logic is airtight). State the rule as a function of the context (e.g. "if sent Mon–Wed, propose this week; if Thu–Fri, next week").
- STATISTICAL / taste rule (recurring stylistic preference with no contextual driver, e.g. "prefers italics"): needs the SAME pattern across 3+ distinct emails before it is actionable. A single-email taste edit is "low" — "watch, don't change yet".

RULES:
- Only surface a pattern that actually appears in the data. Quote the evidence, including the relevant Context (e.g. "sent on a Monday").
- Prioritise: put the most important learnable rule first. Don't bury a clear logical rule under low-confidence noise.
- For each recommendation give: the pattern, the evidence (context + how many emails + short example), a confidence, the concrete change, and WHERE. Valid locations: "SALES_APPROACH (claude.ts)", "buildSchedulingRule (claude.ts)", "BANNED_PHRASE_PATTERNS (claude.ts)", "reflow (claude.ts)", "generateStandaloneSubject (claude.ts)", "validation", or "none — watch".
- If the data is too thin for any change, say so in the summary.`,
    messages: [{ role: "user", content: digest }],
    tools: [
      {
        name: "followup_insights",
        description: "Recurring-pattern findings and proposed prompt/agent changes",
        input_schema: {
          type: "object" as const,
          properties: {
            summary: { type: "string", description: "Overall read of the data incl. honest sample-size caveat" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pattern: { type: "string" },
                  evidence: { type: "string", description: "How many distinct emails + short example" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  change: { type: "string", description: "Concrete change to make (or 'watch, don't change yet')" },
                  location: { type: "string" },
                },
                required: ["pattern", "evidence", "confidence", "change", "location"],
              },
            },
          },
          required: ["summary", "recommendations"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "followup_insights" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");
  return FollowupInsightsSchema.parse(toolBlock.input);
}

export async function summarizeDealForReview(
  dealContext: string,
  roles?: RoleContext,
): Promise<DealRecap> {
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const today = new Date().toISOString().split("T")[0];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: `Today's date: ${today}

You produce a tight deal recap for a sales rep about to send a follow-up. The recap must be in ENGLISH (it's internal terminal output for Chris).

${roles ? buildRoleBlock(roles) + "\n\n" : ""}

OUTPUT 4 fields:
1. status — 1-2 short sentences: where the deal stands right now, who needs to do what, what's blocking. Plain B2 English, no fluff.
2. stage_goal — 1 sentence restating the EXIT CRITERIA of the current pipeline stage in plain language ("To move to next stage, we need to: ...").
3. milestones — UP TO 5 of the most important events for understanding this deal, latest first. Each: ISO date + one-line summary. Combine activities + emails; skip trivial acknowledgements/calendar accepts. If the contact log says FIRST CONTACT, the only milestone may be "[date] inbound form enquiry".
4. suggested_approach — 1 sentence: based on the deal state (stage, last contact, conversation status), what kind of follow-up is most likely to work right now. Be concrete.

Be ruthless about brevity. The point is to refresh Chris's memory in 10 seconds.`,
    messages: [{ role: "user", content: dealContext }],
    tools: [
      {
        name: "deal_recap",
        description: "Tight deal recap to help Chris pick a follow-up angle",
        input_schema: {
          type: "object" as const,
          properties: {
            status: { type: "string" },
            stage_goal: { type: "string" },
            milestones: {
              type: "array",
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  date: { type: "string", description: "ISO date YYYY-MM-DD" },
                  summary: { type: "string", description: "One-line event summary" },
                },
                required: ["date", "summary"],
              },
            },
            suggested_approach: { type: "string" },
          },
          required: ["status", "stage_goal", "milestones", "suggested_approach"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "deal_recap" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");
  return DealRecapSchema.parse(toolBlock.input);
}

const BANNED_PHRASE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /[—–]/, reason: `Em-dashes (—) and en-dashes (–) are banned — they are the #1 AI-writing tell. Rewrite using a full stop, a comma, or two separate sentences. Zero dashes allowed.` },
  { pattern: /\bmy (last |previous |earlier )?note\b/i, reason: `Don't say "my note" — a "note" implies an internal CRM record, not a real email. Reference the actual prior email's content (subject or specific topic) or open fresh.` },
  { pattern: /\bmy (last |previous )?message\b/i, reason: `Don't say "my message" — too vague. Reference the actual email's content specifically.` },
  { pattern: /\b(haven't|have not) heard back\b/i, reason: `Don't open with "haven't heard back" — it's a tired, weak sales opener. Lead with substance.` },
  { pattern: /\bjust (checking|circling|touching) (in|back|base)\b/i, reason: `"Just checking in / circling back / touching base" is banned — it's an empty opener.` },
  { pattern: /\bas (i|we) mentioned\b/i, reason: `"As I/we mentioned" is risky — only valid if you can point to a specific prior email's content, otherwise it sounds like you're inventing prior contact.` },
  { pattern: /\bfollowing up on (my|our) (note|message|email)\b/i, reason: `"Following up on my note/message/email" is banned. Reference the actual content, e.g. "On the React/AWS audit you asked about..."`},
];

/**
 * Enforces one-sentence-per-paragraph formatting. The prompt asks for this, but
 * the model still bundles sentences together, so we reflow deterministically:
 * split each paragraph on sentence boundaries (. ? !) and put a blank line
 * between every sentence. Multi-line blocks (e.g. the "Best,\nChris" sign-off)
 * are left intact.
 */
function reflowOneSentencePerParagraph(body: string): string {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const para of paragraphs) {
    // Preserve intentional multi-line blocks (sign-off, address, lists).
    if (para.includes("\n")) {
      out.push(para);
      continue;
    }
    const sentences = para
      .split(/(?<=[.?!])\s+(?=["'A-ZÀ-Ż])/)
      .map((s) => s.trim())
      .filter(Boolean);
    out.push(...sentences);
  }
  return out.join("\n\n");
}

function findBannedPhrases(text: string): string[] {
  const issues: string[] = [];
  for (const { pattern, reason } of BANNED_PHRASE_PATTERNS) {
    const m = text.match(pattern);
    if (m) issues.push(`Found "${m[0]}" — ${reason}`);
  }
  return issues;
}

/** Catches hallucinated booking links — any calendly.com URL that isn't the real one. */
function findWrongLinks(text: string): string[] {
  const issues: string[] = [];
  const urls = text.match(/https?:\/\/[^\s)>\]}"']+/gi) ?? [];
  for (const raw of urls) {
    const url = raw.replace(/[.,;:!?]+$/, ""); // strip trailing punctuation
    if (/calendly\.com/i.test(url) && url !== CALENDLY_URL) {
      issues.push(`Found wrong booking link "${url}" — the ONLY valid Calendly link is ${CALENDLY_URL}. Use it exactly; never invent or alter a URL.`);
    }
  }
  return issues;
}

export async function draftFollowup(opts: {
  dealContext: string;
  ideaBrief: string;
  language?: Language;
  roles?: RoleContext;
  previousDraft?: FollowupDraft;
  feedback?: string;
  /** Called when a banned-phrase retry fires, with the attempt number and the issues found. */
  onRetry?: (attempt: number, issues: string[]) => void;
  _retry?: number;
}): Promise<FollowupDraft> {
  const language = opts.language ?? "en";
  const retry = opts._retry ?? 0;
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const today = new Date().toISOString().split("T")[0];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `DEAL CONTEXT:\n${opts.dealContext}\n\nFOLLOW-UP BRIEF:\n${opts.ideaBrief}` },
  ];

  if (opts.previousDraft && opts.feedback) {
    messages.push({
      role: "assistant",
      content: `Subject: ${opts.previousDraft.subject}\n\n${opts.previousDraft.body}`,
    });
    messages.push({
      role: "user",
      content: `Revise the email based on this feedback:\n${opts.feedback}`,
    });
  }

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1500,
    system: `Today's date: ${today}

You write follow-up emails AS the sender (a software consulting agency sales rep). Write in their voice, not a template.

${opts.roles ? buildRoleBlock(opts.roles) + "\n\n" : ""}${languageDirective(language)}

${SALES_APPROACH}

${buildSchedulingRule(new Date())}

${SCHEDULING_LINK_RULE}

Use the contact's first name. Reference specific details from the deal context — never generic filler. Match the existing email thread style if there is one. If continuing a thread, use "Re: <original subject>".

Before finalising: re-read your draft. If it sounds like a sales email or a LinkedIn post, rewrite it. If you used any banned phrase, rewrite it. If a sentence is longer than 20 words, split it.`,
    messages,
    tools: [
      {
        name: "followup_email",
        description: "Subject + body for the follow-up email",
        input_schema: {
          type: "object" as const,
          properties: {
            subject: { type: "string", description: "Subject line — use Re: if continuing a thread" },
            body: { type: "string", description: "Plain-text email body, 3-6 sentences, signed off as Chris" },
          },
          required: ["subject", "body"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "followup_email" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");
  const draft = FollowupDraftSchema.parse(toolBlock.input);

  // Hard validation — check for banned phrases. Auto-retry with explicit feedback if found.
  const validationText = `${draft.subject}\n${draft.body}`;
  const issues = [...findBannedPhrases(validationText), ...findWrongLinks(validationText)];
  if (issues.length > 0 && retry < 2) {
    opts.onRetry?.(retry + 1, issues);
    const retryFeedback = `Your draft contained banned phrases. Fix ALL of these and rewrite:\n${issues.map((i) => `- ${i}`).join("\n")}`;
    return draftFollowup({
      dealContext: opts.dealContext,
      ideaBrief: opts.ideaBrief,
      language: opts.language,
      roles: opts.roles,
      previousDraft: draft,
      feedback: retryFeedback,
      onRetry: opts.onRetry,
      _retry: retry + 1,
    });
  }
  return { ...draft, body: reflowOneSentencePerParagraph(draft.body) };
}

/**
 * Generates a fresh, standalone subject line for a follow-up that is NOT being
 * attached to an existing Gmail thread. Unlike the threaded "Re: <original>"
 * subject, this one must earn the open on its own: short, concrete, and tied to
 * the client's actual need — no "Re:", no calendar-invite echo, no filler.
 */
export async function generateStandaloneSubject(opts: {
  dealContext: string;
  emailBody: string;
  language?: Language;
  roles?: RoleContext;
}): Promise<string> {
  const language = opts.language ?? "en";
  const anthropic = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    system: `You write the SUBJECT LINE for a standalone follow-up email (a brand-new thread, not a reply).

${opts.roles ? buildRoleBlock(opts.roles) + "\n\n" : ""}${languageDirective(language)}

The subject must earn the open on its own. Rules:
- Anchor it to the client's actual need / project (use the concrete topic from the deal context — e.g. the product, the platform, the goal), not to us.
- 3–6 words. Short enough to read fully on a phone. No trailing period.
- Plain, human, lowercase-ish sentence case. Sound like a real person, not a marketing campaign.
- NO "Re:", NO "Following up", NO "Checking in", NO "Quick question", NO calendar/event wording, NO em-dashes, NO clickbait, NO emojis.
- It must fit the email body you are given — reference the same specific thing the email is about.

Return only the subject via the tool.`,
    messages: [
      {
        role: "user",
        content: `DEAL CONTEXT:\n${opts.dealContext}\n\nEMAIL BODY (the subject must fit this):\n${opts.emailBody}`,
      },
    ],
    tools: [
      {
        name: "subject_line",
        description: "A short, standalone follow-up subject line",
        input_schema: {
          type: "object" as const,
          properties: {
            subject: { type: "string", description: "3-6 word subject, no Re:, tied to the client's need" },
          },
          required: ["subject"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "subject_line" },
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolBlock) throw new Error("No structured response from Claude");
  const { subject } = z.object({ subject: z.string() }).parse(toolBlock.input);
  return subject.replace(/^re:\s*/i, "").trim();
}
