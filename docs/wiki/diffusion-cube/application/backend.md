# Backend

There is no separate backend service — "backend" here means the `app/api/**/route.ts` handlers and the `lib/` modules they call, all running inside the same Next.js process as the frontend.

## Request lifecycle

1. `proxy.ts` (Next.js middleware) intercepts every request except static assets. It calls `supabase.auth.getUser()` (revalidated against Supabase, not just cookie-trusted) and either allows through, 401s an API path, or redirects a page path to `/login` (or `/explore` for anonymous root hits).
2. On success, `proxy.ts` forwards an `x-user-email` header so downstream server components can skip a second `getUser()` call.
3. Each `route.ts` handler independently re-derives the caller's role via `lib/roles.ts` (`hasRole`/`hasAnyRole`/`isAdmin`) before doing anything sensitive — this is the real enforcement layer, not the middleware.

## Core service modules (`lib/`)

| Module | Responsibility |
|---|---|
| `system-prompts.ts` | Every prompt-builder function; the definitive source of runtime model behavior |
| `adoption-conversation.ts` | Client-side hook — but architecturally central: owns every write to `designs`/`design_documents` triggered by a model turn |
| `wiki-loader.ts` | Loads the grounding corpus (`content/wiki/pathways/`) + framework + resources + generation prompt for prompt injection |
| `library-wiki-loader.ts` | Loads the separate Library corpus (`content/library-wiki/pathways/`) |
| `wiki-content.ts` | Loads the grounding corpus for on-demand `/wiki` browsing, stripping Provenance appendix + frontmatter |
| `dimensions.ts` | Structural shape of the 4×4 grid — dimension codes, sub-categories, per-stage weights, colors |
| `grid-update.ts` | Parses/strips the `<grid_update>` block; shared marker constants |
| `design-documents.ts` | Versioned document storage helpers, content-hash caching |
| `pathway-gaps.ts` | Regex-extracts the gap list from a generated pathway draft's Section 2 |
| `contributor-registration.ts` | Registration form submission logic, fixed role/sharing-level enumerations |
| `organisations.ts` | Organisation search + find-or-create |
| `github.ts` | Real GitHub Contents API read/write for contributor "assemble" publish |
| `roles.ts` | The entire access-control primitive |
| `email.ts` | Nodemailer/SMTP transport + every auth email template |
| `logger.ts` | Fire-and-forget Google Sheets conversation logging |
| `extract-text.ts` | Client-side document/image text extraction for uploads |
| `adoptions-cache.ts` | 60-second in-memory TTL cache for the adoptions list |
| `strip-frontmatter.ts` | YAML frontmatter strip/parse for pathway documents |
| `adoption-plan-markdown.ts` / `adoption-plan-pdf.ts` | Shared markdown parser + PDF export for generated documents |

## Domain logic highlights

- **Role re-validation is duplicated by design, not by accident.** `app/api/chat/route.ts` checks `flow === 'contributor'` against `hasRole(..., 'pathway_contributor')` and `flow === 'explorer'` against `hasRole(..., 'adopter')` independently of whatever the client UI already prevented — this is the one server-side re-enforcement point for the whole companion conversation.
- **Idempotent role grant.** `app/api/auth/grant-default-role/route.ts` treats a Postgres unique-violation (`23505`) on the `adopter` insert as success, making a retried call safe.
- **Best-effort duplicate detection.** `app/api/pathways/check-similar/route.ts` wraps its Anthropic call in try/catch and swallows any failure to `{matchId: null}` — a real pathway can still be created even if this check errors.
- **Destructive admin actions are direct, not soft-deleted.** `app/api/admin/reject/route.ts` calls `admin.auth.admin.deleteUser(user_id)` outright; `app/api/admin/pathways/delete/route.ts` deletes a `pathways` row and relies on FK cascade/set-null behavior rather than an app-level cleanup step.

## Error handling posture

No retry logic exists anywhere in the backend for the Anthropic API or Supabase calls. Streaming Anthropic calls in `app/api/chat/route.ts` have no surrounding try/catch — an SDK-level failure surfaces as an unhandled Next.js 500. Fire-and-forget writes (`adoption_queries` insert, Sheets logging) catch and `console.error` failures without ever affecting the response already sent to the client. See [`../knowledge/technical-debt.md`](../knowledge/technical-debt.md).

## Source files

Full route/lib reference: [`api-specification.md`](api-specification.md), [`../repository-map.md`](../repository-map.md).
