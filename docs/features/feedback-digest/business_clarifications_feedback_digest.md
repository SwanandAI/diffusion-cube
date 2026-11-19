# Business Clarifications: Feedback Digest

Business clarifications (`brd-validation`). **Asked 2026-11-18; waived the same day. Revised 2026-11-18 after first review** (D4, D4a, D6, question 3). **Revised 2026-11-19** (D4, D8, questions 12, 14, 17, 18): cost removed, the digest page's Users, Conversations and Feedback tiles removed, and the Usage page's "Reply feedback" block folded into its Activity table. The requester (Anurag Goutam) asked for the documents to be created without answering the questions, so every answer below is the suggested default, marked **"Waived — assumed"**. Decisions taken earlier in the conversation (2026-11-17/18) are marked **"Decided"**. The requirement lists every assumption in its own **Assumptions** section so each can still be changed at review.

## What we found

- **Origin.** A friend of the requester built a "Digest" tab for **Cube 2.0** (a separate fork of this product, built around *playbooks* such as "low-resource-language"). That tab gives a playbook's contributors an AI-written summary of what adopters asked: themes, unanswered questions, where people got stuck, terms, complaints and what's working. This product has no playbooks, jobs or journey states, so the idea is adapted to what this product has: conversations in Explore, Analyse and Contribute, and the 👍/👎 votes on Cube's replies added on branch `feature/message-feedback`.
- **Roadmap fit.**
  - This delivers part of the Product Charter milestone **"Visibility into Pathway Usage & Reuse"** (target 15-Feb-27: Explorer/Contributor counts, conversations per week, likes/dislikes). Admins already see counts on the Usage page; likes/dislikes arrive with the thumbs feature.
  - It does **not** meet **"Incentivize Contributors"** (target 15-Jan-27), which wants *contributors* to get insights from others' questions about their own pathways. This release is admin-only, so a contributor-facing version is recorded as future scope (question 9).
- **Privacy notice.** It already says Analyse conversations are seen by "only you and EkStep". It also says anonymised or aggregated insights, for example "what questions went unanswered", may be shared with Contributors. An admin digest fits within that. The notice does not mention admins seeing **signed-in Explore** chats, which are saved (question 7).
- **Product rules touched.**
  - Absence is stated plainly: Cube already says when no pathway covers a question, and that statement is one of the two sources of "unanswered questions".
  - The answer-shape rules (plain, neutral, no jargon) are not changed. The digest is written for admins, not adopters, but follows the same plain-words spirit.
  - Nothing here changes what adopters or contributors see.
- **External dates.** The digest depends on the AI account behind Cube. Its recorded expiry of 28-Oct-2026 has passed and whether it was renewed must be confirmed.

## Business questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| D1 | Scope | Where does the page live? | **Decided:** under the admin Usage page, at **Usage → Digest** (`/admin/usage/digest`; 30 days at `?days=30`). Linked from the Usage page and the admin home. |
| D2 | Actors | Who can open it? | **Decided:** admins only. Anyone else is sent to the home page. |
| D3 | Scope | Which periods? | **Decided:** last 7 days (default) and last 30 days, as a toggle at the top. |
| D4 | Scope | What does the page show? | **Decided (revised 2026-11-18):** number tiles (Users, Conversations, Feedback 👍/👎, Most discussed pathways till date); a "Based on…" banner; the AI digest with **Summary, Most discussed topics, Unanswered questions, Terms people asked about**; a **Cost** section. **Revised 2026-11-19:** only the **Most discussed pathways, till date** tile stays, with a note that users, conversations and 👍/👎 are on the Usage page (linked). The Users, Conversations and Feedback tiles and the Cost section are gone; the Usage page's Activity table covers those counts and now has Thumbs up / Thumbs down columns in place of its separate "Reply feedback" block. The banner and the four digest sections are unchanged. |
| D4a | Scope | Are "most discussed pathways" and "most discussed topics" the same thing? | **Decided 2026-11-18:** no, they are different. *Pathways* = which library write-ups Cube's answers drew on (a number tile, counted from the data, till date). *Topics* = what people talked about, which may span several pathways or none (an AI digest section, in the period, ranked by number of conversations). Most discussed topics replaces the earlier Themes section. |
| D5 | Scope | Complaints and What's working (from the Cube 2.0 version)? | **Decided:** removed. |
| D6 | Policy | When is the AI digest generated? | **Decided (revised 2026-11-18):** only when an admin presses **Generate** / **Regenerate**, after a plain confirm ("Regenerate the digest for the last 7 days?" with Cancel / Regenerate). The confirm does **not** mention cost (since 2026-11-19 cost isn't shown anywhere, see D8). Never generated when the page opens; the last saved digest is shown otherwise. |
| D7 | Content | Where do "unanswered questions" come from? | **Decided:** two sources, each item tagged with its source: (a) Cube's reply said the pathways don't cover the question or it couldn't answer; (b) the reply got a 👎. |
| D8 | Cost | Show the cost? | **Decided:** yes. The cost of the digest on screen (tokens and estimated $) and the total of all digest runs so far. **Revised 2026-11-19:** no cost shown. The digest's tokens are counted in AI usage on `/admin/usage` (the "Admin (digest)" row), like every other Claude call. |
| 1 | Goal | Who reads the digest and what do they do with it? | **Waived — assumed:** the program team, in its weekly review, to decide what to follow up with contributors or add to the library (feeding the charter's Feedback tab). |
| 2 | Success | How will we know it works? | **Waived — assumed:** admins open it at least weekly, and at least one unanswered question per month leads to a follow-up (e.g. a contributor asked to cover it). |
| 3 | Scope | Do Contribute conversations count? | **Decided 2026-11-18 (requester):** yes. Analyse, Contribute and signed-in Explore conversations all count; unanswered items and topics show their area. (This differs from the Cube 2.0 version, which left contributors out.) |
| 4 | Scope | Are admins' own (test) conversations left out? | **Decided 2026-11-18 (requester, during architecture planning):** no. Admins also use Explore, Analyse and Contribute, so their conversations count like anyone's. (Replaces the earlier waived assumption that they were left out; see T6 in [`architecture_clarifications_feedback_digest.md`](architecture_clarifications_feedback_digest.md).) |
| 5 | Scope | Signed-out Explore chats are never saved. Is it acceptable that they aren't in the digest? | **Waived — assumed:** yes. Only their 👍/👎 votes are counted. |
| 6 | Scope | Whole product, or filtered to one pathway? | **Waived — assumed:** the whole product. A per-pathway filter is future scope. |
| 7 | Policy | Signed-in Explore chats are saved, but the privacy notice doesn't say admins see them. Update the notice or leave them out? | **Waived — assumed:** include them, and update the privacy notice before release (whoever owns legal sign-off must approve the wording). **Release blocker.** |
| 8 | Policy | If a user deletes a conversation or their account, does it leave the saved digest? | **Waived — assumed:** yes, straight away. Items that relied only on it disappear and user counts drop. |
| 9 | Roadmap | Record a contributor-facing version (questions about their own pathway) as future scope? | **Waived — assumed:** yes, under "Incentivize Contributors". |
| 10 | Retention | Keep only the latest digest per period, or a history? | **Waived — assumed:** latest only. Regenerating replaces it. |
| 11 | Content | May the digest quote users? | **Waived — assumed:** no quotes longer than a few words; no names, places, organisations, emails, phone numbers or links; never judges an individual. |
| 12 | Edge case | Nothing happened in the period? | **Waived — assumed:** numbers show 0; Generate saves an empty digest with no AI call, and the page says "No conversations in the last 7 days." (Reworded 2026-11-19: was "at no cost".) |
| 13 | Edge case | New conversations since the digest was made? | **Waived — assumed:** the page says "N new conversations since this digest was generated", as a hint to regenerate. |
| 14 | Edge case | AI unavailable? | **Waived — assumed:** "The digest couldn't be generated just now. The previous digest is unchanged; please try again." |
| 15 | Edge case | Two admins press Regenerate at once? | **Waived — assumed:** one runs; the other sees "A digest is already being generated. Try again in a few minutes." |
| 16 | Edge case | Fewer than 3 users in the period? | **Waived — assumed:** still generated, with "Too few users to see patterns." in the banner. |
| 17 | Usage | A daily limit on Regenerate? | **Waived — assumed:** yes, **10 per day across all admins**, to keep AI usage bounded. The 11th sees "Today's digest limit is reached. It resets at midnight IST." (Unchanged 2026-11-19; theme reworded from "Cost".) |
| 18 | Cost | Currency? | **Waived — assumed:** USD only, marked as an estimate at list price. **Revised 2026-11-19:** no longer applies; no cost is shown (see D8). |
| 19 | Language | Users may write in Hindi or other Indian languages. Language of the digest? | **Waived — assumed:** always English, translating what users wrote. |
| 20 | Timing | Is a wait of 1–2 minutes acceptable? | **Waived — assumed:** yes, with "Generating… this can take a minute or two." |
| 21 | Future | Weekly email of the digest to admins? | **Waived — assumed:** future scope. |
| 22 | Future | Export the digest (PDF / copy)? | **Waived — assumed:** future scope. |

## Open items

- **Privacy notice wording for signed-in Explore chats** (question 7): owner of legal sign-off. Must be settled before release.
- **AI account status** (expiry recorded as 28-Oct-2026): the program team to confirm it is active before release.
- Every **Waived — assumed** row above can be changed at requirement review.

## Technical questions for architecture-plan

Parked, not answered here:

1. Messages have no timestamp of their own; only the conversation's last-update time exists. How is "in the last 7 days" decided, and how wrong can it be? (A per-message log exists for Analyse questions; Explore has none.)
2. How is "Cube said it couldn't answer" detected: by the AI reading the start of Cube's reply, or by a new signal Cube records when it answers?
3. Which AI model, and how is the per-run cost worked out and recorded? (Current estimate with the chat model: about $0.04 typical, $0.26 at most.) *(2026-11-19: cost is no longer worked out or recorded; see D8.)*
4. How is "one generation at a time" and the 10-per-day limit enforced across admins?
5. Where is the saved digest stored (its cost too, until D8 was revised 2026-11-19), and how are AI calls recorded in the existing AI-usage figures (which today only allow Explore, Analyse and Contribute)?
6. How are admins' own conversations recognised and excluded?
7. How much of the Cube 2.0 code (screen, validation of the AI's output, prompt) can be reused, given the different data?
8. How does the saved digest drop deleted conversations without regenerating?
