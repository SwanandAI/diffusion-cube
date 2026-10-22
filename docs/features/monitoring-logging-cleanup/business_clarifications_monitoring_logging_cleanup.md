# Business Clarifications: System Error Handling, Usage Monitoring and Technical Cleanup

Business clarifications (`brd-validation`). **Answered 2026-10-19.**

Source: customer document "Cube - Logging, Monitoring, Tech Cleanup" (Google Doc, received 2026-10-19). This replaces an earlier, broader version of this feature folder. That version also covered email alerts, adopter feedback, a 30-day retention rule for all activity logs and a code-review report. Those items are not part of this requirement (Q1).

## High-level summary

This file records the business questions asked about the customer document and the owner's answers (2026-10-19, with follow-ups on 2026-10-20).

- **Scope.** Only the customer document's points:
  - error handling and a `sys_errors` table
  - an admin Usage page
  - Explore security checks
  - the `x-user-email` reset
  - dead-code removal
  - prompt caching and in-memory corpus loading
  - removing Google Sheets logging

  Email alerts, adopter feedback, activity-log retention and a code-review report are out.
- **Key decisions.**
  - All errors, expected and unexpected, are recorded. Only admins see them, and they are kept for 30 days.
  - The customer's generic message is used word for word.
  - "Last week" means the last 7 days (rolling). An "active user" is someone who did something in Cube, not just someone with an account.
  - Rate-limit values can be changed without a code change.
- **One correction to the customer document.** `content/library-wiki/` did exist. Final decision (Q30–Q33):
  - The library reads the grounding corpus plus published pathways.
  - Data Dhara and CEEW were moved into the grounding corpus.
  - The folder was deleted.
- **Cleanup scope extended (Q29).** The duplicate pathway-header parser and the unused `diff` package were added. Three other items were deferred.
- **Handed on.** The last section parks 14 technical questions for the architecture plan. Nothing is blocking.

## What we found

- **Already on the roadmap.** The Product Charter's non-functional backlog lists three related items as *Not started*:
  - "Structured logging (latency, errors, per-user/per-pathway usage)"
  - "Error handling and graceful degradation (failed AI calls, malformed uploads)"
  - "Visibility into Pathway Usage & Reuse" (milestone 15-Feb-27): Explorer/Contributor counts and conversations per week.

  This requirement covers the error-recording and graceful-message parts of the first two, and the headline counts of the third. It does not cover per-pathway reuse, likes/dislikes or automatic retry.
- **Errors today.** Failures are written only to the hosting platform's raw log stream. Nothing is stored where an administrator can look at it. In some places the raw error text can reach the user's screen.
- **Usage today.** There is no usage view. The only cross-user record of activity is a Google Sheet that receives every chat turn, including the user's message, Cube's reply and the conversation history.
- **The public library chat (Explore) today** accepts any conversation sent to it, of any length and shape. Every request calls the AI service, and there is no limit per visitor.
- **The internal sign-in header (`x-user-email`)** is set by the app after sign-in and trusted by several pages. Resetting it on every request closes the gap where a request could arrive already carrying a value.
- **Dead code checked against the code on 2026-10-19.** Every item the customer listed is confirmed:
  - the two unused chat modes (`pathway-exec-summary`, `plan-document`)
  - the `<deliverable>` handling
  - the adoption plan's modal mode (its only caller uses `mode="panel"`)
  - code for the retired "pathway submissions" tables
- **One discrepancy with the customer document.** It says `content/library-wiki/` no longer exists. **It does exist today**, with 8 pathway files, and the Explore chat still reads it. Two of those pathways (Data Dhara and CEEW Climate Intelligence) exist only in that folder, and five others differ from their published versions. Decision: see Q2.
- **Chat modes vs the three product areas.** Internally Cube has 9 chat modes. The Usage page reports calls by the customer's three groups: Explore, Analyse and Contribute. The internal modes must be grouped into those three (see Assumptions in the requirement).
- **External date.** The Anthropic account behind every Cube feature expires **28-Oct-2026**. AI usage figures and the Explore checks depend on the AI service being reachable. This is a procurement action and is recorded as a risk.
- **The wiki is behind the code** (generated 2026-09-28). This doesn't affect these business questions, so we noted the drift and carried on.

## Business questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Scope | Does this requirement cover exactly the customer document's points, or also the earlier version's extras (email alerts, adopter feedback, 30-day log retention, code-review report)? | **Customer document's points only.** The earlier extras are listed under "Deliberately not included". |
| 2 | Dead code | `content/library-wiki/` still exists (8 files; 2 appear only there). What happens to it? | **Remove the folder and its static-corpus code.** Before removal, the pathways that exist only in the folder are confirmed as published, so the library loses nothing. |
| 3 | Error log | The document says "all errors" are recorded. Does that include expected errors (validation, wrong password, not found)? | **Yes, record all errors**, expected and unexpected. |
| 4 | Google Sheets | Should the existing Sheet data be exported and archived before Sheets logging is removed? | **No. Just remove the logging.** The Sheet stays where it is in Google Drive; no formal archive step is part of this release. |
| 5 | Error handling | Which errors does graceful handling cover? | **Customer document:** API routes, server components, server actions and client-side rendering. |
| 6 | Error handling | What does the user see? | **Customer document:** unexpected errors show "System encountered an error. Please try sometime later." Never the stack trace or raw message. Validation, auth and not-found errors keep their specific messages. |
| 7 | Error log | What is recorded and where? | **Customer document:** Supabase, new table such as `sys_errors`. Columns: id, timestamp, source (route or module), message, stack, context, user_id (nullable), environment (prod or dev). Context is optional JSON of relevant identifiers (user id, chat mode, pathway, request path). |
| 8 | Privacy | What must never be recorded? | **Customer document:** passwords, tokens and full chat transcripts. IDs and short metadata only. |
| 9 | Usage page | Who is it for, and what does it show? | **Customer document:** product admins. Users (total registered, new sign-ups last week, active last 7 and 30 days); Activity (total published pathways, total conversations, conversations last week); AI usage (Claude calls and input/output tokens per mode: Explore, Analyse, Contribute); Errors (counts per day and per source from `sys_errors`, with a link to the most recent errors). |
| 10 | Explore security | Which checks apply? | **Customer document:** at most 20 turns, 1,000 characters per message and 20,000 in total; every message has role "user" or "assistant" and plain-text content; a per-IP rate limit; anything else gets a 400 before Claude is called. |
| 11 | Sign-in header | What is required? | **Customer document:** explicitly reset `x-user-email` in the request header. |
| 12 | Dead code | What is removed? | **Customer document:** code for the dropped tables; the `pathway-exec-summary` and `plan-document` chat modes; the `<deliverable>` handling; AdoptionPlanModal's modal mode; the library's static-corpus branch (plus the folder itself, Q2). |
| 13 | Optimisation | What is optimised? | **Customer document:** prompt caching; load the corpus per mode and keep the static files in memory instead of reloading them on every request. Cube's answers must not change. |
| 14 | Google Sheets | Is Google Sheets logging removed? | **Customer document:** yes. |

## Follow-up decisions (answered 2026-10-19)

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 15 | Error log | Who can see error records and the recent-errors list? | **Administrators only.** |
| 16 | Error log | How long are error records kept? | **30 days**, then removed automatically. |
| 17 | Error log | If recording an error fails, must the user still get the right message without delay? | **Yes.** |
| 18 | Usage page | Who are "product admins"? | **The existing admin role.** No new role. |
| 19 | Usage page | What does "last week" mean? | **The last 7 days (rolling).** |
| 20 | Usage page | Who is an "active user"? | **A signed-in user who did something in Cube** in the period (sent a message, generated a document). Having an account isn't enough. |
| 21 | Usage page | What counts as a "conversation"? | **Saved Analyse and Contribute conversations.** Explore chats count in AI usage only. |
| 22 | Usage page | Is it acceptable that AI usage figures start on release day? | **Yes.** |
| 23 | Usage page | Figures current on page load, with no auto-refresh, charts, export or date picker? | **Yes.** |
| 24 | Explore security | Should the per-IP rate-limit values be changeable without a code change? | **Yes.** Starting values are chosen in design. |
| 25 | Explore security | What does a visitor see on hitting a limit? | **A short plain-words message.** |
| 26 | Error handling | Use the customer's generic message word for word? | **Yes, verbatim.** |
| 27 | Library folder | Who publishes Data Dhara and CEEW before the folder is removed? | **The Program Team** (David, Anupama and team, who own the pathway content lifecycle). |
| 28 | Library folder | Who confirms that the published version of each of the five diverged pathways is the one the library should show? | **The Program Team.** |
| 29 | Cleanup scope | Beyond the customer's five dead-code items, remove other duplicate or dead code found in planning? | **Partly (2026-10-19).** Added: the duplicate pathway-header parser in the admin publish step, and the unused `diff` package. Deferred to future cleanup: the library chat's separate renderer, hard-coded brand colours, and the always-off organisation filter (a product decision). |
| 30 | Library folder (2026-10-20) | Where should library chat documents come from once `content/library-wiki/` goes? | **The grounding corpus (`content/wiki/pathways/`) + published pathways.** Supersedes the "publish first" route in Q27/Q28. |
| 31 | Library folder (2026-10-20) | What happens to Data Dhara and CEEW, which existed only in the library folder? | **Move them into the grounding corpus** (with an `index.md` entry), so they also ground Analyse. |
| 32 | Library folder (2026-10-20) | Which version of the six pathways in both folders is kept? | **The grounding-corpus version.** |
| 33 | Library folder (2026-10-20) | Should the hard-coded library cards (`lib/library-pathways.ts`) change? | **No, they stay as they are.** |

## Open items

None blocking. Noted for the record:

- **Recording expected errors (Q3)** will add routine entries, such as wrong-password attempts. Accepted; noted as a trade-off.

## Technical questions for architecture-plan

Parked here, not answered:

1. How errors are classified as expected or unexpected consistently across API routes, server components, server actions, client-side rendering and streamed chat responses (including the app-wide error pages).
2. How browser-side rendering errors reach the server and are stored, without letting anonymous visitors flood the error table.
3. How stack traces, error messages and the `context` JSON are cleaned of passwords, tokens and conversation content before storage, including errors from the AI service or database that echo user input.
4. How the `environment` value (prod or dev) is determined across the Vercel and Docker/AWS deployment paths.
5. Who can read the error table (database access rules), and whether recording an error can ever block or slow the user's request.
6. How Claude calls and input/output tokens are captured per call (including streamed replies and non-chat calls such as the duplicate-pathway check), where they are stored, and how the 9 internal modes map to Explore, Analyse and Contribute.
7. How "active user", "conversation" and "published pathway" are counted from existing data, and whether figures are computed on page load or pre-aggregated.
8. Where the per-IP rate limit is enforced and stored, given there are two deployment paths and possibly several server instances, and how the visitor's IP is read reliably behind the proxy or CDN.
9. Where the Explore checks run relative to authentication and the AI call, and which status/body the 400 carries.
10. Where `x-user-email` is reset (middleware, for every request including public routes) so a client-supplied value is never trusted.
11. Which parts of each mode's instructions are stable enough for prompt caching, and how to check Cube's answers are unchanged.
12. How per-mode corpus loading and in-memory caching interact with published pathways in Supabase, which change without a redeploy.
13. What removing the static-corpus branch means for the Explore library overview and the slug/GitHub path assumptions that reference `content/library-wiki/`.
14. Removing Sheets logging: deleting `lib/logger.ts`, the `googleapis` dependency and the related environment variables, without losing the error and usage recording that replaces it.
