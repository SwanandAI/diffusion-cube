# Testing

> **Updated 2026-11-06.** An automated Vitest suite landed in commit `da2c3aa` ("test: add comprehensive test suite with Vitest…"). Earlier versions of this page said the repository had no tests — that is no longer true.

## Current State (verified in repository)

| Attribute | Status |
|---|---|
| Test runner | **Yes** — Vitest 3 (`vitest ^3.2.4`), config in [`vitest.config.mts`](../../../../vitest.config.mts) |
| Test files | **105** `*.test.ts` / `*.test.tsx` files under `tests/` (matched by `include: ['tests/**/*.test.{ts,tsx}']`) |
| Test cases | **2,231** (from the last local run — see [Latest run](#latest-run)) |
| Default environment | `node` (unit + route-handler tests); component and client-hook tests opt into `jsdom` with a `// @vitest-environment jsdom` first line (42 files do) |
| Component testing | `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` (matchers registered in `tests/setup.ts`), `jsdom ^26` |
| Setup file | [`tests/setup.ts`](../../../../tests/setup.ts) — sets fake env vars (`NEXT_PUBLIC_SUPABASE_URL=http://supabase.test`, fake anon/service-role/Anthropic keys, `ADMIN_EMAILS`, `RATE_LIMIT_SALT`), silences `console.error`/`console.warn` per test, unmounts rendered components after each test |
| External services | **All mocked.** `.env.local` is never loaded; no test can reach the real Supabase project, Anthropic, the `embed` Edge Function or SMTP. `restoreMocks: true` undoes spies between tests |
| Coverage | `@vitest/coverage-v8`; `include: lib/**, app/**, components/**, proxy.ts`; reporters `text-summary` + `html`, written to `tests/coverage/` |
| npm scripts | `npm test` (`vitest run`), `npm run test:watch` (`vitest`), `npm run test:coverage` (`vitest run --coverage`) |
| E2E (`playwright.config.*`, `cypress.*`) | **Not present** |
| CI test job | **Not present** — `.github/workflows/deploy.yml` installs the Vercel CLI, pulls env and deploys; it runs no test, lint or type-check step |
| Type checking | `tsc` runs implicitly in `next build` (`strict: true`); `supabase/functions` is excluded from `tsconfig.json` (Deno code) |
| Lint | `npm run lint` (`eslint.config.mjs`, Next core-web-vitals + TypeScript presets; ignores `supabase/functions/**`) — not wired into CI |

### Test layout

| Folder | Files | What it covers |
|---|---|---|
| `tests/unit/lib/` | 22 | Pure `lib/` modules — `grid-update`, `dimensions`, `pathway-units` (markdown → unit rows), `seed` (manifest validation, chunking), `system-prompts`, `explorer-intents`, `prompt-cache`, `strip-frontmatter`, `adoption-plan-markdown`/`-pdf`, `toolkit-assets`, `slug`, `explore-guard`, etc. |
| `tests/unit/server/` | 17 | Server-side `lib/` modules with mocked I/O — `retrieval`, `embeddings` (incl. the 503/504/546 retry path), `pathway-store`, `rate-limit`, `roles`, `errors`, `ai-usage`, `email`, `wiki-content`, `wiki-loader`, `static-content`, `toolkit-assets-server`, `account-deletion-server`, … |
| `tests/api/` | 22 | Route handlers called directly with a built `Request` — `chat` (modes, `requiredRole`, 400/413 caps, rate limit), `pathways/{assemble,check-similar,join,pathways}`, `admin/{pathways-publish,pathways-delete,pathways-document,roles,contributor-registrations}`, `toolkit-assets/*`, `account/*`, `auth/send-email`, `contributions`, `organisations`, `errors-client`, `wiki-pathways`, `wiki-stats` |
| `tests/client/` | 2 | `lib/adoption-conversation.ts` — the client hook that owns every persisted write after a model turn |
| `tests/features/` | 35 | Component tests grouped by feature: `admin`, `auth-account`, `contribute`, `legal`, `shared-ui` (incl. the new `Select`), `toolkit-assets`, `workspace` (`AdoptionWorkspace`, `ChatPanel`, `HeatmapGrid`, …) |
| `tests/pages/` | 5 | Server pages (`admin`, `(app)` layout, redirect stubs, `/wiki`) and the client login page |
| `tests/proxy/` | 1 | `proxy.ts` session gate and public-path list |
| `tests/db/` | 1 | Text-level checks over `supabase/migrations/*.sql` (comments stripped first) — sequential numbering, RLS on every table, the `0039` adopter trigger, `0040` pathway RLS, `0042` view/vector/grant shape. **No database is connected** |
| `tests/helpers/` | 11 | Shared fakes: `supabase-mock.ts` (records every query-builder chain as a `QueryOp`), `anthropic-mock.ts` (fake `messages.stream` / `messages.create`, mid-stream failure option), `request.ts`, `routes-auth.ts`, `chat-session.ts`, conversation/page fixtures, `ui-dom.ts`, `ui-fork-http.ts` |

### Not covered by the suite

- `scripts/seed-pathways.ts` (the seed runner itself — only its pure helpers in `lib/seed.ts` are tested).
- `supabase/functions/embed/index.ts` (Deno; outside the Vitest config).
- The SQL behaviour of `match_pathway_units` / `match_source_chunks`, RLS policies and the `published_pathways` view — `tests/db/` only checks migration text, never runs it.
- Real model output quality (prompts are asserted on text shape, not on what Claude answers).
- Anything browser-level end to end (no Playwright/Cypress).

> **Note:** Because every external client is mocked, a green run proves the app's own logic and contracts, not that Supabase, the Edge Function or Anthropic behave as the mocks assume. Schema drift between a migration and the code is caught only where a test happens to assert on it.

## Latest run

Run on 2026-11-06 against the working tree (HEAD `0a1ca00` + uncommitted prompt-rule changes), in a clean copy of the repo after `npm ci` — the main checkout's `node_modules` did not have the dev dependencies installed, so `npx vitest run` there could not load `vitest/config`.

| Metric | Result |
|---|---|
| Test files | **104 passed, 1 failed** (105) |
| Tests | **2,230 passed, 1 failed** (2,231) |
| Duration | ~33 s |

The one failure is `tests/features/admin/AdminPathwaysPanel.test.tsx` › "delete asks for confirmation first; cancelling sends nothing". It expects the old delete-dialog wording ("does not remove the pathway document already published"); since commit `7d7eac6` the dialog says the delete also **unpublishes** the pathway from the Explore library and Analyse corpus. The test is stale, not the behaviour.

## Manual QA

`scripts/smtp-test.mjs` remains a standalone SMTP connectivity/send diagnostic (not part of the suite, not in `package.json` scripts):

```bash
node --env-file=.env.local scripts/smtp-test.mjs recipient@example.com
```

`scripts/seed-pathways.ts --dry-run` validates a seed manifest and extracts text without any Storage, database or Claude call — a safe pre-check before seeding a project (see [`repository-conventions.md`](repository-conventions.md#scripts)).

`npm run eval:answers` (`scripts/test-harness/answer-shape-eval/`) runs a 12-question live test of how Claude answers under the Analyse and Library prompts. It uses real retrieval and real model calls, grades each answer with automatic checks plus a grading model, and can compare against an older commit's prompts (`--baseline <git-ref>`). It is paid and its results vary run to run, so it is deliberately outside `npm test`. It reads Supabase but never writes to it. See [`scripts/test-harness/answer-shape-eval/answer-shape-feedback/test_set_answer_shape.md`](../../../../scripts/test-harness/answer-shape-eval/answer-shape-feedback/test_set_answer_shape.md).

`docs/features/pathway-storage/test_set_pathway_storage.md` is a hand-run retrieval test set used to tune the `LIMITS` in `lib/retrieval.ts`. `docs/audits/2026-10-22/qa-report.md` records the October audit's QA pass.

## Recommended improvements (not yet implemented)

- **Add a CI test job** — run `npm ci && npm run lint && npm test` on pull requests and before the Vercel deploy in `.github/workflows/deploy.yml` (or a separate workflow). Today nothing stops a red suite from shipping.
- **Fix the stale `AdminPathwaysPanel` assertion** so the suite is green before CI starts gating on it.
- **Database-level tests** for migration `0042` — run `match_pathway_units`, the `published_pathways` view and the `0040` pathways RLS against a local Supabase (`supabase start`), since these are now load-bearing for every grounded answer.
- **A retrieval quality check** — turn `test_set_pathway_storage.md` into a scripted eval (classifier kind + top pathways per question) so prompt or `LIMITS` changes can be compared.
- **E2E smoke tests** (Playwright) for sign-in → Analyse turn → Analysis Document, and contributor Send for Review → admin Publish.

## Related documentation

- [`architecture-overview.md`](architecture-overview.md) — alternative-approaches row **D** (automated tests), now Implemented.
- [`knowledge/technical-debt.md`](../knowledge/technical-debt.md#td-03) — TD-03 tracked the absence of tests; the remaining gap is CI wiring and DB-level coverage.
- [`coding-patterns.md`](coding-patterns.md#tests-mock-every-external-client) — how tests are written here.
