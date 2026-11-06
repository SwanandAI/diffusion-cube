# Troubleshooting

## Auth / signup

| Symptom | Likely cause | Where to look |
|---|---|---|
| OTP emails never arrive | `SEND_EMAIL_HOOK_SECRET` mismatch between Supabase and this app, or SMTP credentials wrong, or "Confirm email" not enabled in the Supabase dashboard | Run `node --env-file=.env.local scripts/smtp-test.mjs recipient@example.com` to isolate SMTP-vs-hook-signature issues; check `app/api/auth/send-email/route.ts`'s signature verification path |
| A signed-in user sees "Awaiting approval" (or `/api/chat` answers 403 "Your account doesn't have access yet. Please contact an administrator.") | The account holds **no role at all**. Since migration `0039` every account gets `adopter` from a database trigger at signup, so this now only happens if an admin removed the role in `/admin`, or `0039` was never applied to that Supabase project | `user_roles` for that user; re-grant `adopter` from `/admin`, or apply `0039` (it also backfills every existing account). The old `/api/auth/grant-default-role` route no longer exists |
| `email_change` emails never send | Deliberately rejected (400) by `app/api/auth/send-email/route.ts` — nothing in the app uses `email_change` | Not a bug — by design |

## `/api/chat` refusals (4xx)

These are expected errors: the route answers with JSON `{ error }` instead of a stream, and the UI shows that message as a notice (signed-in workspaces via `chatErrorText` in `lib/adoption-conversation.ts`; Explore has its own wording, below). All are checked before any retrieval or Claude call — the rate limit first (before the body is even parsed), then body size, JSON/mode, role, message shape and total text size:

| Status | Message | Cause | What to do |
|---|---|---|---|
| 429 | "Too many requests. Please try again later." | Rate limit: anonymous callers per IP (`explore`, default 20/min, 200/day — `EXPLORE_RATE_LIMIT_PER_MIN`/`_PER_DAY`); **signed-in callers per account, every mode** (`chat-user`, default 30/min, 300/day — `CHAT_USER_RATE_LIMIT_PER_MIN`/`_PER_DAY`). Behind a shared NAT many visitors share one IP | `rate_limits` table (salted keys, no raw IP). Raise the env limits if legitimate. One real Analyse session also makes background calls (insight extraction per upload, drafts, documents), which count too. 429s are not written to `sys_errors` |
| 413 | "This request is too large." | Raw body over 32 MB (Anthropic's own request limit; attached images travel as base64 inside `messages`) | Start a new conversation or attach fewer/smaller images |
| 413 | "This conversation is too long to send in one request." | Text in `messages` + `grid` + `meta` + published doc over 800,000 chars (≈ the model's whole context window) | Start a new conversation |
| 400 | "Invalid request." / "Unknown mode." | Body is not valid JSON, unknown `mode`, or `messages` not a non-empty list (≤ 500) of user/assistant turns, or `grid`/`meta` not objects | A client bug — check the caller |
| 403 | "This needs the Contributor role." / "This needs the Adopter role." | `requiredRole(mode, flow)`: `pathway-draft`, `asset-reuse`, and `companion`/`extract-insights` with `flow: 'contributor'` need `pathway_contributor`; everything else except `library` needs `adopter` | Grant the role in `/admin` |
| 403 | "Your account doesn't have access yet. Please contact an administrator." | The account has no roles (see Auth above) | Re-grant `adopter` |
| 403 | "Please sign in to continue." | A non-library mode was called with no session | Sign in |

> **Note:** On Vercel, a request body larger than the platform's own function payload limit is rejected by Vercel before the route runs, so the app's 32 MB cap is never reached there; the client then shows the generic error message (the platform's response is not the app's JSON). A long conversation with several images is the likely trigger. This is a reasoned expectation from the code (full history incl. base64 images is resent every turn — `toApiMessages`), not something the repo tests.

**Explore (`/explore`, `library` mode)** has extra input caps checked on every request (`lib/explore-guard.ts`): visitor message > 1,000 chars, > 20 messages, or > 20,000 chars total (`EXPLORE_MAX_USER_MESSAGE_CHARS` / `EXPLORE_MAX_MESSAGES` / `EXPLORE_MAX_TOTAL_CHARS`). On a 400 or 429 the visitor's message is taken back into the input box; a 400 reads "Your message couldn't be sent. Please shorten it or start a new chat." An unknown or unpublished `pathwayId` answers 404 "Unknown pathway."

## Pathways — publish, library, missing content

| Symptom | Likely cause | Where to look |
|---|---|---|
| **`/explore`, `/wiki` and Analyse grounding show no pathways at all** | Migration `0042` dropped the old `published_pathways` table and every row in it, and left every `pathways` row unpublished — the library is empty **until the seed has run** on that Supabase project | Run `npm run seed:pathways -- --manifest …` (see [`deployment.md`](deployment.md#supabase-project-setup-per-environment)); then re-publish any contributor pathways from `/admin` |
| Explore/Analyse replies all fail with the generic error right after a deploy; `/admin/errors` shows a missing relation or function (`match_pathway_units`, `pathway_versions`) | App code is newer than the database — `0042` not applied to that project | Apply `0042` (destructive — read its header first) |
| A contributor's pathway never appears on `/explore` or in Analyse answers | Sending for review (assemble) only saves a new `pathway_versions` row and moves the pathway to `in_review`; an **admin publish** (`POST /api/admin/pathways/publish`) is what makes the latest version live | `/admin` pathways panel (status filter, draft badges); `pathways.status` / `published_version_id` |
| Admin publish succeeded but says some lessons "weren't indexed for search" | `parseUnits` skipped micro-innovation units whose labels (dimension / stage / unit type) aren't valid. The rest of the pathway is published; the skipped units are simply not searchable | The admin message lists unit numbers and reasons; ask the contributor to fix the labels and send it for review again (`lib/pathway-units.ts`) |
| Admin publish says "Search by meaning is unavailable for this pathway until it is published again", or search barely finds a new pathway | The `embed` function failed during publish, so its units were saved **without vectors** (search falls back to full text + labels for them). A `lib/pathway-store` row with `step: embed units` is in `sys_errors` | Fix the function (below), then publish the pathway again — a re-publish re-embeds its units |
| Assemble returns 400 "This pathway has an invalid slug and cannot be published." | The slug fails `isValidSlug` — only possible for rows created before `slugify` was fixed (titles with no ASCII letters now fall back to `pathway`, suffixed as needed) | `app/api/pathways/route.ts`; correct the slug in the database |
| `/wiki/<slug>` returns not found for a pathway that exists | Only **published** pathways are served there (`getWikiPathway` → `getPublishedDocument`); drafts, in-review and retired ones are not public by design | `pathways.status` |
| A deleted pathway is still visible somewhere | It shouldn't be: deleting a pathway cascades its versions, units, sources and contributors, and `published_pathways` is a view, so it leaves the library in the same statement. A stale page is per-request rendering — reload. Storage-file removal failures are logged (`lib/pathway-store`, `step: remove source files`) but never block the delete | `app/api/admin/pathways/delete/route.ts` |
| Old docs mention commits to GitHub on publish, `GITHUB_BRANCH`, or `content/wiki/pathways/index.md` | Retired — pathways live in Supabase since `0042`; there are no pathway files on disk and no GitHub writes | [`deployment.md`](deployment.md#publishing-a-pathway-no-longer-deploys-anything) |

## Search / retrieval

Every Explore overview and Analyse reply is grounded by `lib/retrieval.ts`: a **Haiku classifier** picks the query kind and filters, the question is embedded by the **`embed` Edge Function**, and `match_pathway_units` runs the hybrid (vector + full text + labels) search. Both the classifier and the embedding **fail soft** — the reply still happens, just with weaker grounding — so these problems never show as user-facing errors; look in `/admin/errors`.

| Symptom | Likely cause | Where to look |
|---|---|---|
| `sys_errors` rows from `lib/embeddings` with `embed function answered 546` | `WORKER_RESOURCE_LIMIT` — the Edge Function ran out of CPU/memory. The app sends batches of 4 texts of ≤ ~1,600 chars because 8 were measured failing on dev | `lib/embeddings.ts` (`BATCH_SIZE`); don't raise it. If it happens on single questions, check the function's logs in the Supabase dashboard |
| `embed function answered 503` / `504`, or "fetch failed" | Function busy, cold, or unreachable. These (and dropped connections) are **retried twice** (1 s, then 2 s back-off; 20 s timeout per try); a persistent failure means search ran on full text + labels only for those requests | Supabase dashboard → Edge Functions → `embed` |
| `embed function answered 401` (not retried) | The function rejected the key: `SUPABASE_SERVICE_ROLE_KEY` is not that project's service-role key | Check the env var matches the project in `NEXT_PUBLIC_SUPABASE_URL` |
| `embed function answered 404` (typically) | The function was never deployed to this Supabase project (each project needs its own deploy) | `supabase functions deploy embed --project-ref <ref>` |
| `Supabase URL or service-role key is not configured.` | `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing on the server | Environment config |
| `sys_errors` rows from `lib/retrieval` with `step: classify`, and `ai_usage` rows `mode = retrieval-classify, ok = false` | The Haiku classifier call failed (Anthropic error, bad key, model unavailable). The surface's **default classification** was used instead — answers still come, but without pathway/dimension/stage targeting | The error text in `sys_errors`; the classifier model id is hardcoded (`CLASSIFIER_MODEL` in `lib/retrieval.ts`) — see [`../knowledge/technical-debt.md#td-20`](../knowledge/technical-debt.md#td-20) |
| Answers ignore a pathway the user named, or cite several pathways loosely | Classifier fell back (row above), or the pathway isn't published | Check both; the prompt rules ask for a single best match unless the user asks to compare |
| A database error during search | Not soft — `match_pathway_units` / `match_source_chunks` errors are thrown and the request returns the generic 500 | `/admin/errors`, `source = api/chat` |

## Chat / grid

| Symptom | Likely cause | Where to look |
|---|---|---|
| The grid shows nothing changed after an otherwise useful reply | By design — a turn that stayed generic (didn't engage a specific pathway) is not supposed to populate any cell | `lib/system-prompts.ts`'s grounding rules; see [`../business/business-rules.md`](../business/business-rules.md) |
| Regenerating an Analysis Document seems to skip the model and return old content | Content-hash cache hit — the conversation/grid hasn't changed since the last generation | `lib/design-documents.ts`; see [`../integrations/caching.md`](../integrations/caching.md) |
| An edit to `content/framework.md`, `pathway-generation-prompt.md` or `resources.md` doesn't show up in production until redeploy | By design — `lib/static-content.ts` memoises committed `content/` files per instance in production | Redeploy; in `npm run dev` files are re-read every call |
| A model's malformed `<grid_update>` used to break every later turn | Fixed: `parseMeta` in `lib/grid-update.ts` now drops or coerces bad `cubeAssessment` values | — |

## "System encountered an error. Please try sometime later."

This generic message is what users see for **every** unexpected failure — any 5xx from an API route (body replaced by `withErrorHandling`), a reply that breaks off mid-stream, or a page that crashes (`app/error.tsx`/`app/global-error.tsx`). The real cause is never shown to the user; find it on **`/admin/errors`** (or query `sys_errors`, newest first, filter by `source` e.g. `api/chat`, `lib/retrieval`, `lib/embeddings`, `render:/analyse`, `client:/explore`). The row has the scrubbed message, stack, mode/flow/design/pathway IDs and user. Platform logs carry the same line via `console.error`.

On retries: the Anthropic SDK's own default (2 retries with back-off on connection errors, 408/409/429/5xx, before any reply has streamed) applies because no client sets `maxRetries`; there is no app-level retry and nothing retries a reply that fails mid-stream — see [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05).

| Symptom | Likely cause | Where to look |
|---|---|---|
| Every AI feature fails; `sys_errors` shows Anthropic authentication/permission/billing errors | `ANTHROPIC_API_KEY` invalid or its account lapsed. The Product Charter recorded the account as a free grant expiring 28-Oct-2026 | [`deployment.md`](deployment.md#operational-dependency-risk-from-the-product-charter), [`../knowledge/technical-debt.md#td-16`](../knowledge/technical-debt.md#td-16) |
| No rows ever appear in `sys_errors` / `ai_usage` | Migrations `0035`–`0038` not applied to that Supabase project (inserts fail with a `console.error` line only), or `SUPABASE_SERVICE_ROLE_KEY` wrong | Apply the migrations; check platform logs for `[errors] sys_errors insert failed` |
| No `render:` rows for a server-component crash | `instrumentation.ts` only loads at server start | Restart the server (`npm run dev`) |
| `sys_errors` rows all show `environment = dev` on the Docker/AWS deploy | `APP_ENV` not set there (only Vercel production is auto-detected as `prod`) | Set `APP_ENV=prod` |
| Old errors are not being purged | Purge is opportunistic (hourly per instance, only after an error insert); no `pg_cron` job exists | Call `purge_old_sys_errors(30)` with the service role, or wait for the next error |
| Spurious `api/chat` errors and `ai_usage ok:false` rows with no token counts | Likely a client closing the tab mid-reply: the chat stream has no `cancel` handler (open audit finding — [`../knowledge/technical-debt.md#td-19`](../knowledge/technical-debt.md#td-19)) | Correlate with user behaviour before treating as an outage |

## Seeding

| Symptom | Likely cause | Where to look |
|---|---|---|
| `seed:pathways` fails validating the manifest | A file path is wrong (paths are relative to the manifest's folder) or the type is unsupported (`pdf`, `docx`, `xlsx`, `xls`, `pptx`, `txt`, `md` only) | `lib/seed.ts` `validateManifest`; try `--dry-run` first (no Storage, database or Claude calls) |
| A re-run regenerates documents you already paid for | The source text, framework or generation prompt changed (cache key), or `--regenerate` was passed | `<manifest folder>/.seed-cache/<slug>.md` |
| A seeded pathway has no source passages | Embedding failed for its chunks — see the Search section | `sys_errors` `lib/embeddings` rows |

## Source files

`app/api/chat/route.ts`, `app/api/auth/send-email/route.ts`, `scripts/smtp-test.mjs`, `lib/errors.ts`, `lib/rate-limit.ts`, `lib/explore-guard.ts`, `app/explore/ExploreLibrary.tsx`, `lib/adoption-conversation.ts`, `lib/retrieval.ts`, `lib/embeddings.ts`, `supabase/functions/embed/index.ts`, `lib/pathway-store.ts`, `lib/pathway-units.ts`, `lib/wiki-content.ts`, `lib/grid-update.ts`, `lib/static-content.ts`, `lib/design-documents.ts`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `app/api/admin/pathways/delete/route.ts`, `scripts/seed-pathways.ts`, `lib/seed.ts`, `supabase/migrations/0039_default_adopter_role.sql`, `0042_pathway_storage.sql`.
