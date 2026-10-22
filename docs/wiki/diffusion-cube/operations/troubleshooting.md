# Troubleshooting

## Auth / signup

| Symptom | Likely cause | Where to look |
|---|---|---|
| OTP emails never arrive | `SEND_EMAIL_HOOK_SECRET` mismatch between Supabase and this app, or SMTP credentials wrong, or "Confirm email" not enabled in the Supabase dashboard | Run `node --env-file=.env.local scripts/smtp-test.mjs recipient@example.com` to isolate SMTP-vs-hook-signature issues; check `app/api/auth/send-email/route.ts`'s signature verification path |
| Signup completes but `/analyse` shows "ask an admin" | `POST /api/auth/grant-default-role` failed silently after OTP verification | Check `user_roles` for a zero-row state for that user; the call is idempotent and safe to retry manually |
| `email_change` emails never send | Deliberately rejected (400) by `app/api/auth/send-email/route.ts` — nothing in the app uses `email_change` | Not a bug — by design, per `CLAUDE.md`'s auth section |

## Contributor publish

| Symptom | Likely cause | Where to look |
|---|---|---|
| Contributor "assemble"/publish appears to succeed but nothing changes locally in `content/wiki/` | It commits to the **remote** GitHub repo/branch (`GITHUB_REPO`/`GITHUB_BRANCH`), not the local working copy | `git pull` the target branch; see [`../business/workflows.md#w2`](../business/workflows.md#w2--contributor-publish) |
| A pathway assembled by a contributor never appears on `/explore` or in companion grounding | Assemble ≠ live — a separate **admin** publish step (`POST /api/admin/pathways/publish`) is required to copy `content_cache` into `published_pathways` | `app/api/admin/pathways/publish/route.ts`; compare `pathways.assembled_design_doc_id` vs `published_design_doc_id` |
| A contributor's assemble unexpectedly triggers a production deploy | `GITHUB_BRANCH` is set to `main` in this environment | Use a throwaway branch (default `pathways-dev`) for any non-production testing |
| `POST /api/pathway-submissions/push` or either `/api/admin/pathway-submissions/*` route returns 401/404 | Those routes were deleted (MLC-12) — the table they used was dropped in `0018` | Use the replacement flow (`/api/pathways/assemble` → `/api/admin/pathways/publish`); see [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01) |

## Chat / grid

| Symptom | Likely cause | Where to look |
|---|---|---|
| A pathway `.md` file exists in `content/wiki/pathways/` but the companion never cites it, and it doesn't appear on `/wiki` | Not linked from `content/wiki/pathways/index.md` — both `lib/wiki-loader.ts` and `lib/wiki-content.ts` discover pathways exclusively by parsing that index's `(slug.md)` links | Add a link from `index.md`; the file remains directly reachable at `/wiki/<slug>` even while unlinked |
| The grid shows nothing changed after an otherwise useful reply | By design — a turn that stayed generic (didn't engage a specific pathway) is not supposed to populate any cell | `lib/system-prompts.ts`'s grounding rules; see [`../business/business-rules.md`](../business/business-rules.md) |
| Regenerating an Analysis Document seems to skip the model and return old content | Content-hash cache hit — the conversation/grid hasn't changed since the last generation | `lib/design-documents.ts`; see [`../integrations/caching.md`](../integrations/caching.md) |
| Locally, Analyse grounding and `/api/wiki-pathways` only see the DB-published pathways, none of `content/wiki/pathways/` | `WIKI_PATH=` is set to an **empty string** in `.env.local`; the code uses `??`, so `''` is kept as the corpus path | Delete the `WIKI_PATH` line (leave it unset). See [`../architecture/configuration.md`](../architecture/configuration.md) |
| An edit to a `content/` file doesn't show up in production until redeploy | By design — `lib/static-content.ts` memoises committed `content/` files per instance in production | Redeploy; in `npm run dev` files are re-read every call |
| `/explore` chat shows "Too many requests. Please try again later." | Per-IP rate limit hit (default 20/min, 200/day; `EXPLORE_RATE_LIMIT_PER_MIN`/`_PER_DAY`). Behind a shared NAT, many visitors share one IP | `rate_limits` table (salted keys, no raw IP); raise the env limits if legitimate |
| `/explore` chat shows "Invalid request." and the message returns to the input box | Explore input guard: visitor message > 1,000 chars, > 20 messages, or > 20,000 chars total (defaults; `EXPLORE_MAX_USER_MESSAGE_CHARS` / `EXPLORE_MAX_MESSAGES` / `EXPLORE_MAX_TOTAL_CHARS`) | `lib/explore-guard.ts` |

## "System encountered an error. Please try sometime later."

This generic message is what users see for **every** unexpected failure — any 5xx from an API route (body replaced by `withErrorHandling`), a reply that breaks off mid-stream, or a page that crashes (`app/error.tsx`/`app/global-error.tsx`). The real cause is never shown to the user; find it on **`/admin/errors`** (or query `sys_errors`, newest first, filter by `source` e.g. `api/chat`, `render:/analyse`, `client:/explore`). The row has the scrubbed message, stack, mode/flow/design/pathway IDs and user. There is still no retry logic, so an intermittent Anthropic error surfaces directly. Platform logs carry the same line via `console.error`.

| Symptom | Likely cause | Where to look |
|---|---|---|
| No rows ever appear in `sys_errors` / `ai_usage` | Migrations `0035`–`0038` not applied to that Supabase project (inserts fail with a `console.error` line only), or `SUPABASE_SERVICE_ROLE_KEY` wrong | Apply the migrations; check platform logs for `[errors] sys_errors insert failed` |
| No `render:` rows for a server-component crash | `instrumentation.ts` only loads at server start | Restart the server (`npm run dev`) |
| `sys_errors` rows all show `environment = dev` on the Docker/AWS deploy | `APP_ENV` not set there (only Vercel production is auto-detected as `prod`) | Set `APP_ENV=prod` |
| Old errors are not being purged | Purge is opportunistic (hourly per instance, only after an error insert); no `pg_cron` job exists | Call `purge_old_sys_errors(30)` with the service role, or wait for the next error |

## Source files

`app/api/auth/send-email/route.ts`, `scripts/smtp-test.mjs`, `lib/errors.ts`, `lib/rate-limit.ts`, `lib/explore-guard.ts`, `lib/static-content.ts`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `lib/wiki-loader.ts`, `lib/design-documents.ts`.
