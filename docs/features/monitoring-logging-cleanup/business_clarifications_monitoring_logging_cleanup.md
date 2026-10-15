# Business Clarifications: Monitoring, Logging and Technical Cleanup

Business clarifications (`brd-validation`). **Answered 2026-10-14; scope revised 2026-10-15.**

## Scope revisions (2026-10-15)

Requested after the first draft of the requirement:

1. **Log retention:** the default changes from 90 days to **30 days**. It stays configurable (Q7).
2. **Admin Health page and Usage page:** moved to **future scope** (Q16). AI usage and cost are still recorded in the logs in this release. Usage and cost figures are pulled from the logs by hand until the Usage page is built.
3. **Lower AI cost without changing Cube's answers (prompt caching):** moved to **future scope** (row "—"). This release's usage and cost data becomes the baseline for measuring the savings later.
4. **Tracing a reported issue:** the logs must hold enough to trace a reported problem from the user's identity alone. The support team should never need to ask the user for more details. The "When a user reports a problem" flow chart was removed from the requirement.
5. **Code review flow chart:** removed from the requirement. The code-review report and remediation plan stay in scope.

## What we found

- **Already on the roadmap.** The Product Charter's non-functional backlog lists "Structured logging: latency, errors, per-user/per-pathway usage" as *Not started*. Two neighbouring items are also *Not started*: "Error handling and graceful degradation (failed AI calls, malformed uploads)" and "Reliability & serving architecture … defined timeout/retry policy". This requirement covers the first item in full. It covers only the *recording* side of the other two, not what users see (see Q15).
- **Monitoring today.**
  - When something fails, the app writes a line to the hosting platform's raw log stream, and nothing else.
  - There is no health check, no error alerts and no error tracking.
  - The only place anyone can see what Cube is actually doing across users is a Google Sheet. It records every chat turn: the user's message, Cube's reply and the full conversation history.
- **How AI failures show up today.** If the AI service has a hiccup, the user gets a raw error. There is no retry and no friendly message.
- **AI cost today.**
  - Cube doesn't reuse the large, unchanging parts of its instructions between calls ("prompt caching"), so every turn pays for them again. *(Fixing this is future scope; see Scope revisions.)*
  - There is no record of how many tokens each call uses or what it costs.
  - The model name is fixed in several places in the code.
- **Cleanup candidates already known** (from the wiki's technical-debt register, spot-checked against the code on 2026-10-14):
  - Retired "pathway submissions" code still points at database tables that were deleted, so it would fail if anything called it.
  - The same parsing logic exists twice.
  - Library chat has a second, separate chat renderer.
  - One AI prompt is never used.
  - Several project documents are out of date.
- **The same pathway content lives in two places** (the collection the assistant reasons over and the public library). This is known debt, but this requirement leaves it alone (see Q11).
- **External date.** The Anthropic account behind every Cube feature expires on **28-Oct-2026**. This is recorded as a risk in the requirement. Renewing it is a procurement action, not part of this build.
- **The wiki is behind the code.** It was generated on 2026-09-28, and about 36 commits have landed since, including account deletion and toolkit-asset storage. One example of the drift: the wiki says the contribution-units table is never used, but the current code reads and writes it. Decision (Q17): note the drift and carry on, rather than regenerating the wiki first.

## Business questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Goal | Which outcomes does "minimal monitoring" for the pilot include: (a) the team learns about outages and errors without a user reporting them, (b) someone can trace a single user's failed session after the fact, (c) daily/weekly usage and cost numbers? | **All three.** (c) is met in this release by recording usage and cost in the logs. A Usage page to view the figures is future scope (see Q16). |
| 2 | Success | How will we know it worked? | **Any user-reported issue can be traced to its cause, and the time to do that should be as short as possible.** No numeric target was set (see Open items). |
| 3 | Alerts | Who gets told when something breaks, and how? | **Email notifications.** |
| 4 | Alerts | What response-time expectation applies during the pilot? | **Best effort.** |
| 5 | Logs | Which questions must a log answer when triaging? Proposed: who (user and role), which flow (Explore / Analyse / Contribute), which conversation or pathway, what failed, how long it took, AI tokens and cost. | **All of these.** |
| 6 | Privacy | May logs contain what users typed or uploaded, Cube's replies, and user emails? Or identifiers only? | **Content should be included in logs.** |
| 7 | Retention | How long should logs be kept? | **Configurable, default 30 days.** (Originally answered 90 days; revised to 30 on 2026-10-15.) |
| 8 | Existing log | What happens to the existing Google Sheet conversation log? | **Keep it as it is.** |
| 9 | AI-assisted triage | Is AI-agent-assisted incident triage in this release or on the future roadmap? | **Future roadmap.** |
| 10 | AI usage and cost | Is per-call tracking of AI usage and cost (the Langfuse-style need) in this release? | **Yes, basic tracking of AI calls, token usage and cost is in this release.** A richer multi-agent tracing tool is future roadmap. |
| 11 | Cleanup scope | Does the cleanup cover the pathway content duplicated across the two collections? | **No. Pathway content is not touched.** |
| 12 | Cleanup scope | "Portions of the code that should be duplicated": did this mean deprecated? | **Yes, deprecated.** |
| 13 | Cleanup scope | Should the cleanup produce only a findings list, or also remove or fix the approved items? | **A findings list plus a plan for how each item can be removed or fixed.** The removals and fixes themselves are not part of this release. |
| 14 | Switching AI provider/model | Is being able to switch AI model or provider ("pluggable LLM") needed now? | **Future roadmap.** |
| 15 | User-visible failures | When the AI service fails or is slow, should users see a friendly message and an automatic retry? | **Out of scope.** Failures are still recorded and alerted on; what the user sees doesn't change. |
| 16 | Admin console | Should admins get anything new in the admin console? | **Moved to future scope (2026-10-15).** Originally: a simple health page and a usage page. Usage and cost are still recorded in the logs in this release. |
| 17 | Housekeeping | Refresh the wiki first, or note the drift? | **Note the drift.** |
| — | Cost | Is there a cost target for prompt caching? | **No target. The goal is to reduce token spend with no change in Cube's answers.** **Moved to future scope (2026-10-15)**: prompt caching is not built in this release. |

## Open items

- **How fast "traceable" needs to be.** Q2 gives no number. The requirement treats it as an aim, not a measured target. The Product Manager decides whether to set one.
- **Who may see logged content.** Logs will hold users' own words, uploaded material and emails (Q6). The requirement assumes only admins and the Solution Team can see them. The Product Manager should confirm.
- **Logs of a deleted account.** Users can now delete their own account. The requirement assumes their log entries are not removed early and simply expire at the end of the retention period. The Product Manager should confirm, especially alongside the Terms & Conditions / Disclaimers work that is still in progress.
- **Which events send an email, and to whom.** The requirement proposes a starting set (see its Assumptions). The Product Manager confirms the list and the recipients.

## Technical questions for architecture-plan

Parked here, not answered:

1. Where the logs are kept and with what tool (the hosting platform's own logs, the existing database, or an external logging or error-tracking service), given the pilot is under 100 users and monitoring should stay minimal.
2. How the retention period (default 30 days) is made configurable and enforced, and how old entries are removed.
3. How access to logged content is restricted to admins and the Solution Team, and whether content needs masking anywhere.
4. How email alerts are sent (reuse the existing email setup?), and how repeated alerts for the same problem are throttled so a burst of failures doesn't flood inboxes.
5. How alerting detects that a dependency is unavailable: the AI service, the database, email, and the GitHub publish connection. (The health page itself is future scope.)
6. How tokens and cost are captured for each AI call, including streamed replies and the duplicate-pathway check, and where the price per token comes from.
7. *(Future scope; not for this release's plan.)* Where prompt caching applies, which parts of Cube's instructions are stable enough to cache, and how to check that Cube's answers haven't changed.
8. How a single user's session or conversation is tied together across log entries, so it can be traced from start to failure.
9. How the findings list and remediation plan are structured. A finding is any duplicate, deprecated, dead, inefficient or hard-coded code.
10. How the new logging sits alongside the existing Google Sheet log, which stays as it is, without slowing chat replies.
