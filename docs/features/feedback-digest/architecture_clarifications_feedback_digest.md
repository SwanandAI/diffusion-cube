# Architecture Clarifications: Feedback Digest

Technical clarifications (`architecture-plan`). **Answered 2026-11-18** by Anurag Goutam: T1 and T2 approved, T6 changed (admins included), the rest waived with "go ahead" and recorded as **Waived — assumed** (the recommended default). **Revised 2026-11-19:** T3 and T5 (cost removed), T4 (rationale), T16 (stats function trimmed). Business decisions are in [`business_clarifications_feedback_digest.md`](business_clarifications_feedback_digest.md).

## Repo findings these questions are based on

- **Branch `feature/message-feedback`** already has:
  - migration `0044_message_feedback.sql` (`message_feedback` table, `admin_feedback_stats()`);
  - `POST /api/feedback` (`app/api/feedback/route.ts`);
  - `components/MessageFeedback.tsx`;
  - `id` / `feedback` fields on assistant messages (`components/ChatPanel.tsx` `Message`; `app/explore/ExploreLibrary.tsx` `ChatMessage`);
  - the reply-feedback block in `/admin/usage` (replaced 2026-11-19 by Thumbs up / Thumbs down columns in its Activity table).
- **Conversations are JSON arrays.** Analyse and Contribute live in `designs.messages` (flow in `designs.meta->>'flow'`); signed-in Explore lives in `library_conversations.messages` (+ `pathway_slug`, which holds the pathway slug). Neither has a per-message timestamp; only `created_at`/`updated_at` per row. Uploads keep the full extracted text in `content` and the bubble text in `displayContent`.
- **Pathway lists.** Companion replies carry `pathwaysReferenced` (slugs) on the stored message; Explore replies don't, but per-pathway Explore chats have `library_conversations.pathway_slug`.
- **`adoption_queries`** logs each companion user message with a timestamp (insert-only from `app/api/chat/route.ts`). It covers only Analyse/Contribute, not Explore, and stores no reply.
- **`ai_usage.area`** has a check constraint (`0036`): `explore | analyse | contribute` only. `lib/ai-usage.ts` maps modes to areas with `areaFor()`.
- **Admins** are a `user_roles` row (`role = 'admin'`) **or** an address in the `ADMIN_EMAILS` env var (`lib/roles.ts` `isAdmin`). SQL can't see the env var.
- **Admin pages** (`app/admin/page.tsx`, `app/admin/usage/page.tsx`, `app/admin/errors/page.tsx`) are standalone server pages with no `AppShell`. They check `isAdmin` and `redirect('/')`, and read via `createAdminClient()` + a `security definer` SQL function revoked from clients (`admin_usage_stats`, `0038`/`0041`).
- **`components/ConfirmDialog.tsx`** exists (tested in `tests/features/shared-ui/ConfirmDialog.test.tsx`).
- **No route sets `maxDuration`.** Anthropic clients set no `timeout`/`maxRetries` (TD-05); the model ID is hardcoded per call site (TD-20).
- **Reference implementation** (Cube 2.0 fork, `~/Desktop/cube2/diffusion-cube`):
  - `lib/companion-v2/digest.ts`: input builder, forced-tool schema, `validateDigest`, `viewDigest`;
  - `supabase/migrations/0037_cube2_digest.sql`: stats/input functions, lease, save/release;
  - `app/api/companion-v2/digest/route.ts` and `components/companion-v2/digest/*`;
  - `content/companion-v2-digest.md`.

  It is built on playbooks, jobs and a recorded "gap" signal, none of which exist here.
- **The wiki** (`docs/wiki/diffusion-cube/`, refreshed 2026-11-06) stops at migration `0042` and doesn't know `0044`, which is this branch's own work.

## Technical questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| T1 | Data (parked P1) | How is "in the last 7 days" decided without per-message timestamps? | **Answered: ok.** A message's time is its own `at` stamp when present, else its conversation's `updated_at`. Both chat UIs start stamping `at` on every new user and assistant message, so the period becomes exact for new messages; older ones stay approximate. **Revised 2026-11-19:** a conversation is in the period when its row was **created** in it (`created_at`), exactly as `admin_usage_stats()` counts `/admin/usage`'s "Last 7 days", so the digest and the Usage page show the same number. An older conversation continued in the period is no longer read. `at` (falling back to `updated_at`) is now used only to order messages newest first. |
| T2 | AI (parked P2) | How is "Cube said not covered" detected? | **Answered: ok.** The digest model reads the first 300 characters of Cube's reply after each question and decides; the app then keeps the tag only for replies that say so in plain words (a cheap wording check, added after review 2026-11-18). No change to any chat prompt or to `<grid_update>`. |
| T3 | AI (parked P3) | Model and cost? | **Waived — assumed:** `claude-sonnet-4-6` as one constant in the route (one more hardcoded ID, TD-20). List prices in a new `lib/ai-pricing.ts` ($3 / $15 per MTok in/out; cache read $0.30, cache write $3.75). Cost is computed per run and stored. Sonnet 5.5 rejected for now: it 400s on the forced `tool_choice` the digest uses. **Revised 2026-11-19:** the model choice stands, but no cost is computed or stored: `lib/ai-pricing.ts` (and its test) is deleted. The call's tokens are recorded in `ai_usage` (area `admin`) like every other Claude call. |
| T4 | Data (parked P4) | How are "one at a time" and "10 per day" enforced? | **Waived — assumed:** one `security definer` function takes a one-row lock (5-minute lease) and counts today's attempts (IST day) in the same statement, so two admins can't both pass. `check_rate_limit` is not reused: its window isn't an IST calendar day, and an attempt log is needed for cost anyway. **Revised 2026-11-19 (rationale only):** the lease, cap and attempt log are unchanged; the attempt log now exists only for the daily cap. |
| T5 | Data (parked P5) | Where are the digest and its cost stored; how are calls recorded in AI usage? | **Waived — assumed:** migration `0045` adds `feedback_digests` (latest per period), `feedback_digest_runs` (one row per attempt: admin, period, status, model, tokens, cost) and `feedback_digest_lock`. It widens `ai_usage.area` to allow `admin`; digest calls are recorded as mode `digest`, area `admin`, and `/admin/usage` gets an "Admin (digest)" row. **Revised 2026-11-19:** no cost is stored. `feedback_digest_runs` keeps only `id, period_days, admin_user_id, started_at, finished_at, status` (no `model`, tokens or `cost_usd`), and `finish_feedback_digest_run` takes `(p_run, p_status, p_payload)`. Tokens live only in `ai_usage`; the page no longer reads `feedback_digest_runs`. |
| T6 | Data (parked P6) | How are admins' own conversations excluded? | **Answered: not excluded.** Admins also use Explore, Analyse and Contribute, so their conversations count like anyone's. **This reverses business assumption 4** (business clarifications question 4). The requirement is updated to match at the final-scope step. |
| T7 | Reuse (parked P7) | How much Cube 2.0 code is reused? | **Waived — assumed:** port the reference-checking pattern (`buildDigestInput` / `validateDigest` / `viewDigest`, refs `M…` for questions, `F…` for 👎 votes), the lease/save SQL pattern, and the screen and button layout. Rewrite the prompt for Summary, Most discussed topics, Unanswered questions and Terms. Drop jobs, states, stuck, complaints and working. |
| T8 | Data (parked P8) | How do deleted conversations drop out of a saved digest? | **Waived — assumed:** every item stores the conversation keys it rests on (`d:<designs id>`, `l:<library_conversations id>`, `f:<message_feedback id>` for a 👎 with no saved conversation). The stats function returns the keys that still exist, and the page hides items left with none, recounting users (Cube 2.0's `viewDigest` pattern). |
| T9 | Permissions | Which layers enforce admin-only? | **Waived — assumed:** `proxy.ts` (signed-in only, unchanged); the page (`isAdmin` → `redirect('/')`, UX); the API route (`isAdmin` → 403, the real gate); the database (functions executable by `service_role` only; new tables RLS on with no policies). |
| T10 | AI / availability | Time limit and retries for the digest call? | **Waived — assumed:** `export const maxDuration = 300` on the new route (first in the repo). Its own Anthropic client with `timeout: 240_000, maxRetries: 0`, a deliberate exception to TD-05: a retry could double the AI usage and overrun the time limit. A failed run keeps the previous digest. |
| T11 | AI | Call shape? | **Waived — assumed:** one non-streaming `messages.create`, forced tool use (`record_digest`), `max_tokens` 6000. A `max_tokens` stop, a missing tool block or unusable output count as a failed run. |
| T12 | Data | Where is the model input built? | **Waived — assumed:** in SQL (`admin_digest_input`). It unnests the conversation arrays, takes `displayContent` over `content` (so uploaded documents' full text is never sent), pairs each question with the next assistant reply (first 300 chars after scrubbing), and returns the newest 400 questions (at most 80 per person) plus the period's 👎 rows. |
| T13 | Frontend | Page structure? | **Waived — assumed:** `app/admin/usage/digest/page.tsx` (server, standalone admin layout) renders `components/digest/DigestScreen.tsx`. Only `components/digest/GenerateButton.tsx` is a client component: it uses `ConfirmDialog` and calls `router.refresh()` after success. No shared store. |
| T14 | Copy | Error copy when the API answers 5xx? | **Waived — assumed:** `withErrorHandling` replaces 5xx bodies with the generic message, so the button maps statuses to the requirement's copy itself: 409 busy, 429 daily limit, other failures "couldn't be generated just now… previous digest unchanged". |
| T15 | Docs | Regenerate the wiki first? | **Waived — assumed:** no; continue from the code and refresh the wiki (`llm-wiki`) after this feature merges. |
| T16 | Data | How is "Most discussed pathways, till date" counted? | **Waived — assumed:** distinct conversations per slug from companion replies' `pathwaysReferenced` plus per-pathway Explore chats' `pathway_slug`, joined to the `published_pathways` view for titles (unpublished or deleted slugs drop out). Top 5 shown. **Revised 2026-11-19:** this is now the only tile on the page. `admin_digest_stats` returns only `users_period`, `conversations_period` (for the banner), `pathways`, `live_keys` and `new_since`; users, conversations and 👍/👎 counts are on `/admin/usage`. |

## Plan-review decisions

- **2026-11-18:** the plan was approved as presented ("Continue with the plan") and written to [`plan_feedback_digest.md`](plan_feedback_digest.md). The requirement was updated to the final scope, with admins' conversations included (T6).
- **2026-11-19:** after build, cost was removed (T3, T5), the digest page's Users, Conversations and Feedback tiles were dropped (T16), and `/admin/usage`'s "Reply feedback" block was folded into its Activity table as Thumbs up / Thumbs down columns (from `admin_feedback_stats().per_surface`, `0044`, unchanged). The requirement, plan and task list were updated to match.

## Open items

- **Privacy notice wording for signed-in Explore chats** (release blocker, from the requirement): the owner of legal sign-off.
- **Anthropic account status** (TD-16): the program team to confirm before release.
- ~~Requirement update for T6~~: done 2026-11-18.
