# Business Clarifications: Monitoring, Logging and Technical Cleanup

Business clarifications (`brd-validation`). **Answered 2026-10-14; scope revised 2026-10-15 and 2026-10-16.**

## Scope revisions (2026-10-15 and 2026-10-16)

Requested after the first draft of the requirement:

1. **Log retention:** the default changes from 90 days to **30 days**. It stays configurable (Q7).
2. **Admin Health page and Usage page:** moved to **future scope** (Q16). AI usage and cost are still recorded in the logs in this release. Usage and cost figures are pulled from the logs by hand until the Usage page is built.
3. **Lower AI cost without changing Cube's answers (prompt caching):** moved to **future scope** (row "—"). This release's usage and cost data becomes the baseline for measuring the savings later.
4. **Tracing a reported issue:** the logs must hold enough to trace a reported problem from the user's identity alone. The support team should never need to ask the user for more details. The "When a user reports a problem" flow chart was removed from the requirement.
5. **Code review flow chart:** removed from the requirement. The code-review report and remediation plan stay in scope.
6. **No content in logs (privacy):** logs must not include conversation or document content, meaning what users write or upload and Cube's replies (Q6). The requirement now also assumes users are identified in logs by an internal account reference rather than name or email.
7. **Adopter feedback added (2026-10-16):** in the Analyse flow, adopters get a thumbs-up / thumbs-down on whether they found what they were looking for, plus optional "What worked well" and "What can be improved" comments. Administrators get a simple feedback list (Q18–Q21). This is a first step towards the charter milestones "Incentivize Contributors" (15-Jan-27, users can give feedback) and "Visibility into Pathway Usage & Reuse" (15-Feb-27, likes and dislikes). It does not cover the per-pathway and contributor-facing parts of those milestones.
8. **System error handling added (2026-10-16, specified by the customer):**
   - **Scope:** errors from API routes, server components, server actions and client-side rendering.
   - **Unexpected errors** show the generic message "System encountered an error. Please try sometime later." The stack trace and raw message never reach the browser.
   - **Expected errors** (validation, sign-in and permission, not found) keep their specific messages.
   - **Recording:** all errors are stored in Supabase with the full stack trace, in a system error table (for example `sys_errors`). Its columns are id, timestamp, source (route or module), message, stack, context (optional JSON of IDs and short metadata such as user id, chat mode, pathway and request path), user_id (can be empty) and environment (prod or dev).
   - **Context rules:** no passwords, tokens or full chat transcripts.
   - **Audience:** the system administrator.
   - **What this reverses:** Q15, which had kept what users see out of scope.
9. **Minimal Usage page brought back into this release (2026-10-16, figures specified by the customer):** a read-only page for product administrators with four sections.
   - **Users:** total registered, new sign-ups in the last week, active over the last 7 and 30 days.
   - **Activity:** total published pathways, total conversations, conversations in the last week.
   - **AI usage:** Claude calls per mode (Explore, Analyse, Contribute), and total input and output tokens per mode.
   - **Errors:** counts per day and per source from `sys_errors`, with a link to the most recent errors.

   This partly reverses scope revision 2 and Q16. The Health page's service-status view stays future scope.
10. **Named fixes brought into this release (2026-10-16, specified by the customer):**
    - **Explore security:** limits of 20 turns, 1,000 characters per message and 20,000 in total; every message must have role "user" or "assistant" and plain-string content; a per-IP rate limit; a 400 response before Claude is called; and an explicit reset of `x-user-email`. These apply to Explore only.
    - **Dead code removed:** the dropped-table code, the `pathway-exec-summary` and `plan-document` modes, the `<deliverable>` handling, the adoption plan's modal mode, and the library's static-corpus branch. The `content/library-wiki/` folder itself is deprecated and removed (confirmed 2026-10-16).
    - **Optimisation:** prompt caching, loading content per mode, and keeping static files in memory at module level.
    - **Google Sheets logging removed**, after its data is exported and archived.

    This reverses Q8, the prompt-caching row and scope revision 3, and narrows Q13.

## What we found

- **Already on the roadmap.** The Product Charter's non-functional backlog lists "Structured logging: latency, errors, per-user/per-pathway usage" as *Not started*. Two neighbouring items are also *Not started*: "Error handling and graceful degradation (failed AI calls, malformed uploads)" and "Reliability & serving architecture … defined timeout/retry policy". This requirement covers the first item in full. It covers only the *recording* side of the other two, not what users see (see Q15).
- **Monitoring today.**
  - When something fails, the app writes a line to the hosting platform's raw log stream, and nothing else.
  - There is no health check, no error alerts and no error tracking.
  - The only place anyone can see what Cube is actually doing across users is a Google Sheet. It records every chat turn: the user's message, Cube's reply and the full conversation history.
- **How AI failures show up today.** If the AI service has a hiccup, the user gets a raw error. There is no retry and no friendly message.
- **AI cost today.**
  - Cube doesn't reuse the large, unchanging parts of its instructions between calls ("prompt caching"), so every turn pays for them again. *(Fixed in this release; see scope revision 10.)*
  - There is no record of how many tokens each call uses or what it costs.
  - The model name is fixed in several places in the code.
- **Cleanup candidates already known** (from the wiki's technical-debt register, spot-checked against the code on 2026-10-14):
  - Retired "pathway submissions" code still points at database tables that were deleted, so it would fail if anything called it.
  - The same parsing logic exists twice.
  - Library chat has a second, separate chat renderer.
  - One AI prompt is never used.
  - Several project documents are out of date.
  - **Superseded 2026-10-15:** a full architecture review of the current code produced 39 verified findings plus content observations. They are recorded in the requirement's Appendix A. The review also corrected the wiki: 11 pathway files are unlinked, not 6, and the 'unused prompt' is in fact reachable through an AI mode that has no caller.
- **The same pathway content lives in two places** (the collection the assistant reasons over and the public library). This is known debt, but this requirement leaves it alone (see Q11).
- **External date.** The Anthropic account behind every Cube feature expires on **28-Oct-2026**. This is recorded as a risk in the requirement. Renewing it is a procurement action, not part of this build.
- **The wiki is behind the code.** It was generated on 2026-09-28, and about 36 commits have landed since, including account deletion and toolkit-asset storage. One example of the drift: the wiki says the contribution-units table is never used, but the current code reads and writes it. Decision (Q17): note the drift and carry on, rather than regenerating the wiki first.

## Business questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Goal | Which outcomes does "minimal monitoring" for the pilot include: (a) the team learns about outages and errors without a user reporting them, (b) someone can trace a single user's failed session after the fact, (c) daily/weekly usage and cost numbers? | **All three.** (c) is met in this release by recording usage and cost in the logs and by the minimal Usage page (Q16, Q26–Q29). |
| 2 | Success | How will we know it worked? | **Any user-reported issue can be traced to its cause, and the time to do that should be as short as possible.** No numeric target was set (see Open items). |
| 3 | Alerts | Who gets told when something breaks, and how? | **Email notifications.** |
| 4 | Alerts | What response-time expectation applies during the pilot? | **Best effort.** |
| 5 | Logs | Which questions must a log answer when triaging? Proposed: who (user and role), which flow (Explore / Analyse / Contribute), which conversation or pathway, what failed, how long it took, AI tokens and cost. | **All of these.** |
| 6 | Privacy | May logs contain what users typed or uploaded, Cube's replies, and user emails? Or identifiers only? | **Content must not be included in logs, for privacy** (revised 2026-10-15; originally "content should be included"). Logs record facts about the activity, not what users write or upload or Cube's replies. |
| 7 | Retention | How long should logs be kept? | **Configurable, default 30 days.** (Originally answered 90 days; revised to 30 on 2026-10-15.) |
| 8 | Existing log | What happens to the existing Google Sheet conversation log? | **Revised 2026-10-16: remove Google Sheets logging** (customer specification). The existing Sheet data is exported and archived before removal. (Originally: keep it as it is.) |
| 9 | AI-assisted triage | Is AI-agent-assisted incident triage in this release or on the future roadmap? | **Future roadmap.** |
| 10 | AI usage and cost | Is per-call tracking of AI usage and cost (the Langfuse-style need) in this release? | **Yes, basic tracking of AI calls, token usage and cost is in this release.** A richer multi-agent tracing tool is future roadmap. |
| 11 | Cleanup scope | Does the cleanup cover the pathway content duplicated across the two collections? | **No. Pathway content is not touched.** One exception (2026-10-16): the duplicate `content/library-wiki/` folder is deprecated (Q31). No pathway text is rewritten. |
| 12 | Cleanup scope | "Portions of the code that should be duplicated": did this mean deprecated? | **Yes, deprecated.** |
| 13 | Cleanup scope | Should the cleanup produce only a findings list, or also remove or fix the approved items? | **Revised 2026-10-16:** a findings list and a remediation plan, **plus the customer's named fixes in this release** (Q30–Q33). All other findings stay plan-only. (Originally: a findings list and plan only.) |
| 14 | Switching AI provider/model | Is being able to switch AI model or provider ("pluggable LLM") needed now? | **Future roadmap.** |
| 15 | User-visible failures | When the AI service fails or is slow, should users see a friendly message and an automatic retry? | **Revised 2026-10-16 (customer specification):** unexpected system errors show the generic message "System encountered an error. Please try sometime later." Expected errors keep their specific messages. Automatic retry stays out of scope. (Originally: out of scope.) |
| 16 | Admin console | Should admins get anything new in the admin console? | **Revised again 2026-10-16:** a **minimal Usage page for product administrators is in this release**, with the customer's figures (Q26–Q29), including a link to the most recent errors. The Health page's service-status view stays future scope. (History: originally both pages; moved to future scope 2026-10-15.) |
| 17 | Housekeeping | Refresh the wiki first, or note the drift? | **Note the drift.** |
| 18 | Feedback | Where in the Analyse flow should the thumbs-up / thumbs-down appear? | **Once per conversation.** The adopter can answer at any time, and the prompt is gently highlighted after the Analysis Document or Executive Summary is generated. |
| 19 | Feedback | When can the adopter write "what worked well" and "what can be improved"? | **Optional, after either thumbs answer.** Two short text boxes, both skippable. |
| 20 | Feedback | How does the team see the feedback in this release, given the admin pages are future scope? | **A simple, read-only feedback list in the admin console, for administrators only.** |
| 21 | Feedback | Is feedback tied to the adopter's account? | **Yes, linked to the adopter and the conversation**, so the team can understand the context and follow up. It is removed if the adopter deletes their account. |
| 22 | Error handling | Which errors does graceful handling cover? | **Customer specification:** API routes, server components, server actions and client-side rendering. |
| 23 | Error handling | What does the user see? | **Customer specification:** unexpected errors show "System encountered an error. Please try sometime later." Stack traces and raw messages are never sent to the client. Validation, auth and not-found errors keep their specific messages. |
| 24 | Error handling | Where and how are errors recorded? | **Customer specification:** all errors are recorded in Supabase with the full stack trace, in a new table such as `sys_errors`. Columns: id, timestamp, source (route or module), message, stack, context, user_id (nullable), environment (prod or dev). |
| 25 | Error handling | What may the context hold? | **Customer specification:** optional JSON of relevant identifiers, such as user id, chat mode, pathway and request path. No passwords, tokens or full chat transcripts; IDs and short metadata only. |
| 26 | Usage page | Which user figures? | **Customer specification:** total registered users; new sign-ups in the last week; active users over the last 7 and 30 days. |
| 27 | Usage page | Which activity figures? | **Customer specification:** total published pathways; total conversations; conversations in the last week. |
| 28 | Usage page | Which AI usage figures? | **Customer specification:** Claude calls per mode (explore, analyse, contribute); total input and output tokens per mode. |
| 29 | Usage page | Which error figures? | **Customer specification:** error counts per day and per source, read from `sys_errors`, with a link to the most recent errors. Audience: product admins. |
| 30 | Explore security | Which checks apply to Explore conversations? | **Customer specification:** cap turns at 20, characters per message at 1K and in total at 20K. Every item must have role "user" or "assistant" and plain-string content. Add a per-IP rate limit. Anything else gets a 400 before Claude is called. Explicitly reset `x-user-email` in the request header. **Explore only** (not the Analyse or Contribute chats). |
| 31 | Dead code | Which redundant or dead code is removed in this release? | **Customer specification:** code for the dropped tables; the `pathway-exec-summary` and `plan-document` chat modes; the unused `<deliverable>` handling; AdoptionPlanModal's unused modal mode; the library's static-corpus branch. **Confirmed 2026-10-16:** `content/library-wiki/` exists today and is deprecated and removed as part of technical cleanup, along with its static-corpus code. |
| 32 | Optimisation | Which optimisations are made in this release? | **Customer specification:** implement prompt caching; load the corpus per mode, and keep static files in memory at module level. |
| 33 | Existing log | Remove Google Sheets logging? Is historical Sheet data needed first? | **Yes, remove it. Yes, export and archive the existing Sheet data first.** |
| — | Cost | Is there a cost target for prompt caching? | **No target. The goal is to reduce token spend with no change in Cube's answers.** **Back in this release (2026-10-16, customer specification).** (It had been moved to future scope on 2026-10-15.) |

## Open items

- **How fast "traceable" needs to be.** Q2 gives no number. The requirement treats it as an aim, not a measured target. The Product Manager decides whether to set one.
- **Who may see logs.** Logs no longer hold content (Q6), but they still record who did what and when. The requirement assumes only admins and the Solution Team can see them. The Product Manager should confirm.
- **Diagnosing answer-quality problems.** Without content in the logs, a problem in what Cube *said* (rather than a recorded failure) can't be diagnosed from the logs alone. Should the support team be allowed to open the saved conversation in those cases? The Product Manager decides.
- **Deprecating `content/library-wiki/` (confirmed 2026-10-16).** The folder exists today, with 8 pathway files, and is deprecated as part of technical cleanup. Before it is removed:
  - The two folder-only pathways (Data Dhara and CEEW Climate Intelligence) must be published.
  - The Program Team must confirm that the published version of each of the five diverged duplicates is the one the library should show.

  This is a narrow exception to Q11: it removes a duplicate copy but rewrites no pathway text. The Program Team decides on the five diverged pathways.
- **Explore security and Sheet archive details assumed in the requirement (Assumptions 24–27).** The rate-limit values are a configurable setting chosen in design. Visitors who hit a limit get a plain-words message. The Sheet archive is kept privately by the support team. The library pathways are confirmed as published before the static-corpus code is removed. The Product Manager should confirm.
- **Logs of a deleted account.** Users can now delete their own account. The requirement assumes their log entries are not removed early and simply expire at the end of the retention period. The Product Manager should confirm, especially alongside the Terms & Conditions / Disclaimers work that is still in progress.
- **Which events send an email, and to whom.** The requirement proposes a starting set (see its Assumptions). The Product Manager confirms the list and the recipients.

- **Feedback details assumed in the requirement (Assumptions 8–11).** Feedback is kept apart from the logs and has no 30-day expiry. It is deleted with the account or the conversation, and is not shown to contributors. Comments are capped at about 1,000 characters. The Product Manager should confirm.

- **Error-handling details assumed in the requirement (Assumptions 12–16).** The error table follows the 30-day retention. Stack traces are cleaned of user content before storage. Browser errors are sent to the same table. Only administrators and the support team can view it. The generic message is used verbatim everywhere. The Product Manager and the customer should confirm.
- **Recording expected errors.** The customer asked for *all* errors to be recorded, so expected errors (validation, sign-in, not found) are stored too. That may add a lot of routine entries, such as wrong-password attempts. Confirm this is intended, or limit recording to unexpected errors.

- **Usage page details assumed in the requirement (Assumptions 17–23).**
  - Product admins are the existing admin role.
  - Internal AI modes are grouped into Explore, Analyse and Contribute.
  - Each figure has a defined meaning ("last week" = last 7 days; what counts as an active user and as a conversation).
  - The 30-day active-user figure depends on log retention staying at 30 days or more.
  - Figures are current when the page is opened.
  - Estimated cost is not shown on the page.
  - The recent-errors list hides the stack trace on screen.

  The Product Manager and the customer should confirm.

## Technical questions for architecture-plan

Parked here, not answered:

1. *(Partly answered by the customer: errors go to a Supabase `sys_errors` table.)* Where the general activity logs are kept, and with what tool (the hosting platform's own logs, the existing database, or an external logging or error-tracking service), given the pilot is under 100 users and monitoring should stay minimal.
2. How the retention period (default 30 days) is made configurable and enforced, and how old entries are removed.
3. How access to logs is restricted to admins and the Solution Team, and how conversation and document content is reliably kept out of log entries, including error messages from the AI service or database that might echo user input.
4. How email alerts are sent (reuse the existing email setup?), and how repeated alerts for the same problem are throttled so a burst of failures doesn't flood inboxes.
5. How alerting detects that a dependency is unavailable: the AI service, the database, email, and the GitHub publish connection. (The health page itself is future scope.)
6. How tokens and cost are captured for each AI call, including streamed replies and the duplicate-pathway check, and where the price per token comes from.
7. Where prompt caching applies (now in this release), which parts of Cube's instructions are stable enough to cache, and how to check that Cube's answers haven't changed.
8. How a single user's session or conversation is tied together across log entries, so it can be traced from start to failure.
9. How the findings list and remediation plan are structured. A finding is any duplicate, deprecated, dead, inefficient or hard-coded code.
10. How the Google Sheet log is exported and archived, and its code and credentials removed, without a gap in logging (the new logs must be live first). The new logging must not slow chat replies.
11. Where feedback is stored and how it is linked to the adopter and the Analyse conversation (one answer per conversation, updatable), including deletion with the account or the conversation.
12. How the client knows an Analysis Document or Executive Summary has just been generated, so it can highlight the feedback prompt once.
13. How the admin feedback list is access-controlled, filtered and paginated. Does it need to read the conversation it references, or only show the reference?
14. How errors are classified as expected (validation, auth, not found) or unexpected consistently across API routes, server components, server actions and client-side rendering. This includes the Next.js error boundaries (`error.tsx` / `global-error.tsx`) and streamed chat responses.
15. How browser (client-side rendering) errors are sent to the server and stored safely, without letting anonymous visitors flood the table.
16. How stack traces and error messages are cleaned of user content, passwords and tokens before storage, and how the `context` JSON is kept to IDs and short metadata.
17. What happens when Supabase itself is unavailable and an error can't be written to `sys_errors`, for example falling back to the platform logs.
18. How the `environment` value (prod or dev) is set for each deployment path (Vercel and Docker/AWS).
19. How each Usage page figure is computed (live queries or pre-calculated counts), and from which source: account records, saved conversations, published pathways, activity logs or `sys_errors`.
20. How each internal AI mode is tagged with its area (Explore, Analyse or Contribute) in the logs, and where input and output token counts come from for streamed and non-streamed calls.
21. How "active user" is derived (from activity logs or sign-in records), and how the 30-day figure behaves if log retention is configured below 30 days.
22. How the "most recent errors" link and list are built over `sys_errors` (how many are shown, ordering, access control), and whether the full record is viewable in the app or only in the database.
23. Where the per-IP rate limit state is kept on serverless hosting (and on the Docker/AWS path), what the limit values are, and how the visitor's IP is read reliably behind the hosting proxy.
24. How the Explore checks (turns, characters, roles, plain-string content) are enforced on the server for the library mode before the Claude call, and how the library chat shows the specific rejection messages.
25. How `x-user-email` is reset in `proxy.ts` for every request, including public paths and anonymous visitors, and whether pages should stop trusting the header altogether.
26. The order of removing the dead code (dropped-table routes, unused modes and prompts, `<deliverable>` handling, the modal mode, the library static-corpus branch), and how each removal is verified by hand without automated tests.
27. Prompt-caching layout: which parts of each prompt are stable enough to cache, how per-mode loading and module-level caching of static files keep the cached part identical between calls, and how the published-pathways cache is refreshed when an admin publishes or deletes a pathway.
