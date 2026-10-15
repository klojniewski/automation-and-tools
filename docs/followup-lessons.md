# Follow-up lessons

Rules learned from Chris's feedback on `followup` drafts. Every bullet below is injected into the
drafting prompt (`draftFollowup` in `src/lib/claude.ts`, loaded by `src/lib/followup-lessons.ts`).

- Added at the end of a `followup` run: when Chris gave in-loop feedback, the tool distills it into
  candidate lessons and asks which to save.
- Edit freely: reword, delete, or re-class a bullet. Only lines shaped `- [class] rule` are read.
- Classes: **[truth]** facts and hard constraints, always binding; **[voice]** Chris's style
  preference, binding for style but no claim it improves replies; **[hypothesis]** a guess about
  what earns replies, to be tested, not law.

## Lessons

- [truth] Chris's own brief wins over the recap's suggested approach: follow its intent and tone exactly, and add no ask (call, proposal, deadline) the brief does not request. _(deal #6982, 2026-09-28)_
- [truth] Check the prospect's location before any personal or local reference; if Chris was in their country, keep it neutral and never recommend or describe their own country to them like a tourist. _(deal #6982, 2026-09-28)_
- [truth] Never invent a bridge for writing ("it got me thinking about you", "coming back to my inbox I noticed"); reopen with a real, specific reason Chris has, or with none. _(deal #6982, 2026-09-28, from Chris's own rewrite)_
- [voice] A check-in after a long silence is light and short, not a chase: no guilt lines like "we never got the call booked", "no strings" or "helps me know where to park this". _(deal #6982, 2026-09-28)_
- [voice] Close a check-in with one plain, direct question about whether they are still interested (e.g. "Please let me know if you are still interested in working together."), not a vague offer like "happy to help" or "a second pair of eyes". _(deal #6982, 2026-09-28, from Chris's own rewrite)_
- [voice] Personal small talk is one short, plain line ("I just came back from Tuscany; it was fun and warm!"), with no flourishes like "hard to complain" or "highly recommend". _(deal #6982, 2026-09-28, from Chris's own rewrite)_
- [voice] In a friendly re-opener after silence, a simple "How are you?" right after the greeting is fine, and the whole email stays around four short sentences. Sign off "Best, Chris". _(deal #6982, 2026-09-28, from Chris's own rewrite)_
