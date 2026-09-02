---
name: add-lead
description: Use when Chris asks to add a lead to Pipedrive CRM from an inbound email in Gmail — e.g. "dodaj tego leada", "add this lead", "wrzuć to do CRM", giving an email subject, sender, thread, or pasted email content.
---

# Add Lead to Pipedrive

Turn an inbound lead email into a complete Pipedrive record: organization + person + deal + pinned summary note + reply activity, with all "Please fill" custom fields populated.

**Credentials:** `PIPEDRIVE_API_TOKEN` and `PIPEDRIVE_USER_ID` live in `/Users/chris/1_PROJECTS/myautomations/.env`. Pipedrive REST API v1 via plain HTTP calls (see script template below). Read the email via the Gmail MCP connector (`mcp__claude_ai_Gmail__search_threads` → `get_thread` with `PLAIN_TEXT`).

## Workflow

1. **Find the email** — search Gmail by subject/sender the user gave; read the full thread.
2. **Extract facts** — sender name, email, job title, company, what they want (scope, budget/rates, payment terms, timeline, stack, decision window), any links (brief, docs), and the hook (why they wrote).
3. **Dedupe** — `GET /persons/search?term=<email>&fields=email` and `GET /organizations/search?term=<company>`. If a match exists, update/attach instead of creating; a similarly-named but different company (check website/country) is NOT a match.
   **n8n overlap:** leads from the Pagepro website contact form are already processed by the "INBOUND Leads Processing" n8n workflow, which creates a person + deal (marked `from_automation=YES`) and a Gmail draft. If the person already has an open deal for this inquiry, do NOT create a new one — **enrich the existing deal instead**: fill the missing "Please fill" fields (MQL/SQL/Responded, LinkedIn, Company Size, Industry — n8n leaves these empty), add the pinned note, and skip drafting (n8n already drafted).
4. **Verify company data via web search** — website, LinkedIn company URL, employee count, industry. Never guess a LinkedIn slug or company size.
5. **Create records** (org → person → deal), then pinned note, then activity. Deal goes to **New Business pipeline (id 22), stage Lead In (id 114)** — never "Inbound - General". Owner = `PIPEDRIVE_USER_ID`.
6. **Fill custom fields** — see table below. These show as red/amber "Please fill" dots in the sidebar.
7. **Pinned note on the deal** — HTML summary: who/company (scale numbers), what they want, scope, stack, rates/terms, process + decision deadline, hook, links to the brief and the Gmail thread (`https://mail.google.com/mail/u/0/#inbox/<threadId>`). This feeds the `followup`/`analyze` CLI context.
8. **Reply activity** — type `task`, due today, subject like "Reply to <first name> (<company>): <what they asked for>", short note with what to send and the decision window.
9. **Report back** — deal URL (`https://pagepro.pipedrive.com/deal/<id>`), what was set, and flag every judgment call (deal value, MQL/SQL/Responded interpretation) for Chris to review.
10. **Ask about the first reply** — after reporting, ask Chris: "Przygotować draft pierwszej odpowiedzi?". Only on yes, draft it and save via the Gmail connector as a **draft reply in the prospect's original thread** (same threadId), then give the draft link (`https://mail.google.com/mail/u/0/#drafts/<id>`). Writing rules (same as `SALES_APPROACH` in `src/lib/claude.ts`):
    - plain B2 English (Polish only if the prospect wrote in Polish), no corporate-speak, no em/en dashes
    - one sentence per paragraph, short and scannable
    - answer what they actually asked for (their bullets, their questions), no long pitch
    - one concrete next step; when proposing a call, put `https://calendly.com/chris8/30min` in the body — never invent any other URL
    - sign off "Best,\nChris"

## Field reference (verified 2026-09)

| Entity | Field | Key | Value |
|---|---|---|---|
| Deal | Label (multi) | `label` | comma-sep option ids: 208=Next.js, 199=React, 202=React Native, 206=Node.JS, 201=Gatsby, 200=WordPress, 278=Sanity, 252=Strapi, 279=Storyblok, 320=Webflow, 321=Expo, 277=AWS, 276=Firebase, 386=DESIGN, 280=Out of current stack |
| Deal | MQL | `a1895ec07503153d87d3463114b2c65208b5750c` | 239=YES, 240=NO — YES for a real inbound fitting Pagepro's profile |
| Deal | SQL | `afe6d8d6ea61183f815a42c764864c2dd9413c9d` | 226=YES, 225=NO — NO at intake (no qualification call yet) |
| Deal | Responded to communication | `ad8f8babc1f43a608dd0baf431109f34a222a9b2` | 380=YES, 381=NO — YES when the prospect initiated contact |
| Deal | from_automation | `666b5287b878498ec9782940dd9356d6bfbab3a2` | 383=YES, 384=NO — always YES (records created by tooling; the n8n workflow sets it too) |
| Person | from_automation | `5a6ba48a0f14539eede1163e48043ac4e9b2fbfd` | 382=YES — always YES |
| Person | Job Title | `b7674b131c558363b4a59cb47efdefc864d19cf0` | varchar, e.g. "CTO" (the standard `job_title` API param does NOT fill this) |
| Org | Website | `website` | full URL |
| Org | LinkedIn profile | `linkedin` | verified company URL |
| Org | Company Size | `0bf563b254b0b2eed0ec9410fdfbf62c47bc2a22` | 168=Self-employed, 169=1-10, 170=11-50, 171=51-200, 172=201-500, 173=501-1000, 174=1001-5000, 175=5001-10k, 176=10k+ |
| Org | Industry | `industry` | enum, e.g. 17=Technology, information and media (full list: `GET /organizationFields`) |
| Org | Industry (legacy) | `6ba915c00a13c9d206955cab12ddc7c855d61cc9` | enum, e.g. 119=Online Media, 28=Automotive, 44=Computer Software |

Deal value: set it when the email states a number — a budget ("$80k"), or hours × rate — and flag it in the report; leave empty (and say so) when nothing is stated. Currency comes from the email ($→USD, £→GBP, zł→PLN) via the deal's `currency` field — never a hardcoded default.

If an option id is rejected or a field looks stale, re-fetch definitions: `GET /dealFields`, `/personFields`, `/organizationFields`.

## Script template

```bash
export $(grep PIPEDRIVE /Users/chris/1_PROJECTS/myautomations/.env | xargs)
python3 <<'EOF'
import json, os, urllib.request
TOKEN = os.environ["PIPEDRIVE_API_TOKEN"]; OWNER = int(os.environ["PIPEDRIVE_USER_ID"])
def call(method, path, payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"https://api.pipedrive.com/v1/{path}?api_token={TOKEN}",
        data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r: res = json.load(r)
    if not res.get("success"): raise SystemExit(f"FAILED {path}: {res}")
    return res["data"]

org = call("POST", "organizations", {"name": ORG_NAME, "owner_id": OWNER,
    "website": WEBSITE, "linkedin": LINKEDIN,
    "0bf563b254b0b2eed0ec9410fdfbf62c47bc2a22": SIZE_ID, "industry": INDUSTRY_ID})
person = call("POST", "persons", {"name": FULL_NAME, "org_id": org["id"], "owner_id": OWNER,
    "email": [{"value": EMAIL, "primary": True, "label": "work"}],
    "b7674b131c558363b4a59cb47efdefc864d19cf0": JOB_TITLE,
    "5a6ba48a0f14539eede1163e48043ac4e9b2fbfd": 382})           # from_automation = YES
deal = call("POST", "deals", {"title": f"{ORG_NAME} - {SHORT_SCOPE}",
    "person_id": person["id"], "org_id": org["id"], "user_id": OWNER,
    "pipeline_id": 22, "stage_id": 114, "label": LABEL_IDS,
    "a1895ec07503153d87d3463114b2c65208b5750c": 239,
    "afe6d8d6ea61183f815a42c764864c2dd9413c9d": 225,
    "ad8f8babc1f43a608dd0baf431109f34a222a9b2": 380,
    "666b5287b878498ec9782940dd9356d6bfbab3a2": 383})           # from_automation = YES
call("POST", "notes", {"content": NOTE_HTML, "deal_id": deal["id"], "pinned_to_deal_flag": 1})
call("POST", "activities", {"subject": ACTIVITY_SUBJECT, "type": "task", "due_date": TODAY,
    "deal_id": deal["id"], "person_id": person["id"], "user_id": OWNER, "note": ACTIVITY_NOTE})
print("https://pagepro.pipedrive.com/deal/" + str(deal["id"]))
EOF
```

## Common mistakes

- Putting the deal in "Inbound - General" (pipeline 2) — Chris moved the first one manually; it's **New Business (22)**.
- Setting `job_title` on the person via the standard API param — the sidebar reads the custom field `b7674b1...` instead.
- Guessing LinkedIn URL or company size — verify with web search first.
- Treating a fuzzy org-name match as a duplicate (e.g. "Racerfish" ≠ "RACER Media & Marketing").
- Inventing a deal value — leave empty unless the email states hours/rates.
- Creating a fresh deal for a website-form lead the n8n workflow already processed — enrich the existing deal instead (see step 3).
- Saving the reply draft without asking first — step 10 is opt-in, always ask.
