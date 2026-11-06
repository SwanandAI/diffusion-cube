# Backend

> Last verified against code: 2026-11-06 (HEAD `0a1ca00`).

There is no separate backend service. "Backend" here means the `app/api/**/route.ts` handlers and the `lib/` modules they call, all running in the same Next.js process as the frontend. One out-of-process piece exists: the **`embed` Supabase Edge Function** (`supabase/functions/embed`, Deno, gte-small). `lib/embeddings.ts` calls it over HTTP.

## Request lifecycle

1. **`proxy.ts`** (Next.js middleware) intercepts every request except static assets. It calls `supabase.auth.getUser()`, which revalidates against Supabase rather than trusting the cookie. It then either lets the request through, answers 401 for an API path, or redirects a page path to `/login` (or to `/explore` for an anonymous hit on the root). Public API prefixes: `/api/chat`, `/api/wiki-pathways`, `/api/toolkit-assets`, `/api/auth/send-email`, `/api/errors/client`.
2. **The `x-user-email` header.** `proxy.ts` deletes any client-sent `x-user-email` on **every** forwarded request (`forwardedHeaders()`). It sets the header again only on the signed-in branch, from the verified `user.email`. Downstream server components can then skip a second `getUser()` call without trusting a forged header.
3. **Role checks in each handler.** Each `route.ts` handler re-derives the caller's role itself through `lib/roles.ts` (`hasRole`/`currentRoles`/`hasAnyRole`/`isAdmin`) before doing anything sensitive. This is the real enforcement layer, not the middleware. Database RLS is a second layer (see [`database.md`](database.md)).
4. **Error handling.** Every handler is exported through `withErrorHandling()` (`lib/errors.ts`). It records errors in `sys_errors` and replaces any 5xx body with the generic message. See [Error handling posture](#error-handling-posture).

## Core service modules (`lib/`)

| Module | Responsibility |
|---|---|
| `system-prompts.ts` | Every prompt-builder function, and the definitive source of runtime model behavior |
| `adoption-conversation.ts` | A client-side hook, but central to the architecture: it owns every write to `designs`/`design_documents` that a model turn triggers |
| **`pathway-store.ts`** | **The one place pathways are saved, published and read** (service role throughout; callers authorize). `saveVersion` appends the next `pathway_versions` row and moves a pathway from `draft` to `in_review`. `latestVersion` returns the newest version. `publishVersion` sets `status='published'` and `published_version_id`, copies frontmatter card fields onto `pathways`, then replaces `pathway_units` with `parseUnits` output embedded via `embedTexts`; if embedding fails, it stores the units without vectors. `listPublished`, `getPublishedDocument(s)` and `buildOverview` read the `published_pathways` view. `adopterDocument` strips Source Trace. Also `isSlugTaken`, `removeSourceObjects`, and `SOURCES_BUCKET = 'pathway-sources'` |
| **`pathway-units.ts`** | Pure. `parseUnits(markdown, slug)` turns Section 3 micro-innovations into `pathway_units` rows (id `<slug>-uNN`, labels, conditions, adopter intents from Section 6, source ids from the Source Trace). A unit with a missing or out-of-vocabulary dimension, sub-category, stage or type is **skipped with a reason**, never guessed |
| **`retrieval.ts`** | Per-message grounding for Explore and Analyse. A `claude-haiku-5-5` classifier (`CLASSIFIER_MODEL`, forced tool use) picks a kind (`specific`\|`situation`\|`broad`\|`patterns`) plus filters. `hybridSearch` → `match_pathway_units` RPC. `buildGrounding` shapes the text per kind within `LIMITS`. `pathwayPassages` → `match_source_chunks` for seeded pathways. A classifier or embedding failure degrades (default kind / full-text-only search) and never throws. A DB error does throw. Detail: [`../integrations/ai-llm.md`](../integrations/ai-llm.md) |
| **`embeddings.ts`** | `embedTexts()` posts to the `embed` Edge Function in batches of 4, with a 20 s timeout. It **retries up to 2 times** on 503/504/546 or a dropped connection, with a linear backoff. It throws rather than return partial or zero vectors. Also `toPgVector`, `EMBEDDING_DIMENSIONS = 384` |
| **`seed.ts`** | Pure helpers for `scripts/seed-pathways.ts` (`npm run seed:pathways`): manifest validation, `src-NN` source keys, storage paths, `chunkText` (1,600 chars with 200 overlap) |
| **`provenance.ts`** | Pure `stripProvenanceAppendix()`, which removes the contributor-only Source Trace (legacy name: Provenance) appendix. Re-exported from `wiki-content.ts` |
| **`library-types.ts`** | `/explore` card types (`LibraryPathway`, `Stage`, `Accent`), `slugToAccent`, `toLibraryStage`. It replaces the deleted static `library-pathways.ts` list |
| `wiki-loader.ts` | Loads the committed operating content only: `content/framework.md`, `content/pathway-generation-prompt.md`, `content/resources.md`, plus `datedLine()`. **It no longer loads any pathways** (`loadWikiContext` is gone) |
| `wiki-content.ts` | `/wiki` browsing and the stats line, read over `listPublished()`/`getPublishedDocument()`. Strips frontmatter and Source Trace. Nothing is read from disk |
| `dimensions.ts` | Structural shape of the 4×4 grid: dimension codes, sub-categories, per-stage weights, colors, unit types (also used by `pathway-units.ts` and `retrieval.ts` as the vocabulary) |
| `grid-update.ts` | Parses and strips the `<grid_update>` block; shared marker constants |
| `design-documents.ts` | Versioned document storage helpers, content-hash caching |
| `pathway-gaps.ts` | Regex-extracts the gap list from Section 2 of a generated pathway draft |
| `pathway-section4.ts` | Section 4 ("Toolkits and playbooks") table handling: the app, never the model, links a shared asset's title and fills its File cell |
| `toolkit-assets.ts` / `toolkit-assets-server.ts` | Client-safe toolkit-asset rules (25 MB cap, extension → MIME map, id pattern, `applyToolkitAssetFiles`, `assetIdsInDocument`, prompt rendering) / server-only storage and DB helpers on the private `toolkit-assets` bucket (`authorizePathwayContributor`, signed upload URL, stream-through download, `loadPublishedToolkitAssets`, `dropAssetsFromReviewCopy`, `removeAssetObjects`) |
| `contributor-registration.ts` / `contributor-registration-server.ts` | Client-side registration form logic and enumerations / server-only `approveContributor()` and `revokeContributor()`, which move `access_status` and the `pathway_contributor` role together |
| `organisations.ts` | Organisation search (LIKE wildcards escaped) and find-or-create (`ensureOrganisation`) |
| `roles.ts` | The entire access-control primitive. `Role = 'adopter'\|'pathway_contributor'\|'admin'` (`general_user` was dropped in `0039`). `hasRole`, `currentRoles` (throws on a read error), `hasAnyRole`, `isAdminEmail`, `isAdmin` |
| `account-deletion-server.ts` | Full cleanup for self-serve deletion: unpublished asset files, then `deleteUser` |
| `email.ts` | Nodemailer/SMTP transport, every auth email template, and `sendContributionEmail` |
| `errors.ts` / `error-messages.ts` | Server-only error recording (`withErrorHandling`, `logError`, `recordServerError`, `scrub`, expected-error classes) / the client-safe `GENERIC_ERROR_MESSAGE` |
| `rate-limit.ts` / `explore-guard.ts` | Salted-hash rate limit via `check_rate_limit()` (fails open). Scopes: `explore`, `client-error`, `anon-error` (per IP) and `chat-user` (per account) / input caps for `library` mode |
| `ai-usage.ts` | `areaFor(mode, flow)` (including `retrieval-classify`) + `recordAiUsage()` → `ai_usage` (counts only, inside `after()`) |
| `prompt-cache.ts` | Anthropic prompt-cache blocks for `companion`/`library` (`systemForMode`, `messagesForMode`) |
| `explorer-intents.ts` | The Analyse flow's single unified conversation script |
| `static-content.ts` | `readStaticFile()`: in-memory memoisation of committed `content/` files, in production only |
| `slug.ts` | `isValidSlug()`. Slugs are lookup keys, unit ids and storage paths, so a malformed one is refused |
| `client-error-report.ts` | Browser-side POST of a caught render error to `/api/errors/client` |
| `extract-text.ts` | Client-side text extraction from uploaded documents and images |
| `adoptions-cache.ts` | 60-second in-memory TTL cache for the adoptions list |
| `strip-frontmatter.ts` | YAML frontmatter strip/parse for pathway documents |
| `adoption-plan-markdown.ts` / `adoption-plan-pdf.ts` | Shared markdown parser + PDF export for generated documents |
| `legal.ts` / `toast.ts` | `LEGAL_VERSION` and legal constants / app-wide toast queue |

**Removed since the last refresh:**

- **`github.ts`.** There is no GitHub Contents API publish any more, and no `GITHUB_*` env vars.
- **`library-documents.ts` and `library-pathways.ts`.** The library now reads the store.

## Domain logic highlights

- **Role enforcement is server-side per mode.** `app/api/chat/route.ts` uses `requiredRole(mode, flow)`. Contributor work (`pathway-draft`, `asset-reuse`, and `companion`/`extract-insights` with `flow==='contributor'`) needs `pathway_contributor`; everything else outside `library` needs `adopter`. A missing `flow` counts as Explorer. The UI offering a choice is not the boundary.
- **No signup approval step.** A trigger on `auth.users` (migration `0039`) grants `adopter` in the same transaction that creates the account. The old `grant-default-role` route and the admin "reject signup" route are gone. `hasAnyRole` remains as a guard on signed-in pages and routes.
- **Draft → review → publish is versioned in the database.**
  1. `assemble` appends a `pathway_versions` row (`source='contributor'`) and sets `review_requested`.
  2. The admin's `publish` makes the **latest** version live via `publishVersion`.
  3. Units are re-indexed on every publish.
  4. A live pathway stays `published` while its next version waits for review.

  The `retired` status exists in the schema, but no current code path writes it.
- **Publish is tolerant per unit.** Units with invalid labels are skipped and returned to the admin panel as `skippedUnits`. An embedding failure returns `embedded:false`. In both cases the pathway still goes live, and search falls back to full text for units without vectors.
- **Best-effort duplicate detection.** `check-similar` wraps its Anthropic call in try/catch and answers any failure with `{matchId: null}`. The failure is recorded (`logError` + an `ok:false` `ai_usage` row).
- **Deletes are hard deletes, and a delete unpublishes.** `app/api/admin/pathways/delete` removes the storage files first (asset files plus seeded source files), then deletes the `pathways` row. Everything else cascades. Because `published_pathways` is a view, the pathway leaves Explore and Analyse grounding in the same statement.
- **Service-role reads where RLS is now narrower.** Since `0040`, a session sees only the pathways it contributes to. Four places therefore read listing columns with the service role, and the route authorizes first:
  - `GET /api/pathways`
  - `check-similar`
  - the join route's existence check
  - `/api/admin/pathways/document`

## Error handling posture

**Retries.** The only explicit retry logic in the app is in `lib/embeddings.ts`: up to 2 retries on Edge Function 503/504/546 or a dropped connection. Anthropic calls have **no explicit retry policy** — no client sets `maxRetries`, so only the SDK's implicit 2 pre-response retries apply, and nothing retries mid-stream. Supabase queries are not retried (TD-05).

**Degradation.** Retrieval degrades instead of failing:

- A classifier failure falls back to the surface's default kind.
- An embedding failure falls back to full-text plus label search.

**Error recording:**

- **One error path for all routes.** `withErrorHandling(source, handler, {errorBody?})` in `lib/errors.ts` wraps all 23 `route.ts` files:
  - A returned 4xx passes through and is recorded as `expected` (429s are not recorded).
  - A returned 5xx is recorded as `unexpected` with its real text, and its body is replaced with `GENERIC_ERROR_MESSAGE`.
  - A thrown `ExpectedError` keeps its own status and message.
  - Anything else thrown becomes 500 with the generic message, and the stack is recorded.

  An anonymous caller's errors are recorded only while their IP is within the `anon-error` rate-limit allowance, so a script cannot flood `sys_errors`. Many routes still build `Response.json({error: error.message}, {status: 500})` inline on purpose: the wrapper hides that text from the browser, while `sys_errors` keeps it.
- **Recording is non-blocking and safe.** `logError()` schedules the `sys_errors` insert with `after()` (fire-and-forget outside a request scope) and never throws. It still `console.error`s for platform logs, and keeps only allow-listed context keys. It scrubs secrets: `sk-ant-…`, `Bearer …`, JWTs, and `password|token|secret|api_key=…`.
- **Mid-stream failures.** Both stream loops in `app/api/chat/route.ts` are wrapped in try/catch. `streamFailed()` records the error and an `ok:false` usage row, then errors the stream. The client shows the partial text plus the generic message and skips persistence.
- **Server render, action and proxy errors** are recorded by `onRequestError` in `instrumentation.ts`.
- **Fire-and-forget writes.** The `adoption_queries` insert still only `console.error`s on failure. Best-effort storage cleanups (`removeSourceObjects`, `removeAssetObjects`) log through `logError` and never block.

See [`../operations/monitoring.md`](../operations/monitoring.md) and [`../knowledge/technical-debt.md`](../knowledge/technical-debt.md).

## Source files

Full route/lib reference: [`api-specification.md`](api-specification.md), [`../repository-map.md`](../repository-map.md).
