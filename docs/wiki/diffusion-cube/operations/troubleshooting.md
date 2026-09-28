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
| `POST /api/pathway-submissions/push` or either `/api/admin/pathway-submissions/*` route errors with a Postgres "relation does not exist" | These reference `pathway_submissions`, dropped in migration `0018` — this is genuinely broken code, not a misconfiguration | See [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01); do not attempt to fix by re-creating the table — the replacement architecture (`design_documents` + GitHub commit) is what should be used |

## Chat / grid

| Symptom | Likely cause | Where to look |
|---|---|---|
| A pathway `.md` file exists in `content/wiki/pathways/` but the companion never cites it, and it doesn't appear on `/wiki` | Not linked from `content/wiki/pathways/index.md` — both `lib/wiki-loader.ts` and `lib/wiki-content.ts` discover pathways exclusively by parsing that index's `(slug.md)` links | Add a link from `index.md`; the file remains directly reachable at `/wiki/<slug>` even while unlinked |
| The grid shows nothing changed after an otherwise useful reply | By design — a turn that stayed generic (didn't engage a specific pathway) is not supposed to populate any cell | `lib/system-prompts.ts`'s grounding rules; see [`../business/business-rules.md`](../business/business-rules.md) |
| Regenerating an Analysis Document seems to skip the model and return old content | Content-hash cache hit — the conversation/grid hasn't changed since the last generation | `lib/design-documents.ts`; see [`../integrations/caching.md`](../integrations/caching.md) |

## 500s with no clear cause

Given there is no retry logic and streaming Anthropic calls have no surrounding try/catch (see [`../integrations/ai-llm.md`](../integrations/ai-llm.md)), an intermittent Anthropic API error will surface directly as an unhandled 500 on `/api/chat`. Check server logs for the raw SDK error; there is no automatic fallback or retry to investigate first.

## Source files

`app/api/auth/send-email/route.ts`, `scripts/smtp-test.mjs`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `lib/wiki-loader.ts`, `lib/design-documents.ts`.
