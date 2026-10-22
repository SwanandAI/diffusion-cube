# Frontend

Next.js 16 App Router, React 19, Tailwind CSS v4. No client-side state library (Redux/Zustand/etc.) — state is local `useState`/custom hooks per page, with `lib/adoption-conversation.ts`'s `useAdoptionConversation` as the one substantial shared hook.

## Routes

| Route | File | Type | Auth |
|---|---|---|---|
| `/login` | `app/login/page.tsx` | Client (`'use client'`, Suspense-wrapped) | Public |
| `/explore` | `app/explore/page.tsx` + `ExploreLibrary.tsx` | Server (data load) + Client (interactive) | Public |
| `/analyse` | `app/analyse/page.tsx` + `StrengthenWorkspace.tsx` | Server + Client | Session required; tiered by `adopter` role |
| `/contribute` | `app/contribute/page.tsx` + `ContributeAccessGate.tsx`/`ContributeGrid.tsx` | Server + Client | Session required; tiered by registration + `pathway_contributor` role |
| `/navigate` | `app/navigate/page.tsx` | Server | Public (redirect stub → `/analyse`) |
| `/terms`, `/privacy` | `app/terms/page.tsx`, `app/privacy/page.tsx` → `components/LegalDocument.tsx` | Server (static, reads `content/legal/*.md` at build) | Public (in `proxy.ts` `PUBLIC_PATHS`) — Terms of Use / Privacy Notice, linked from the Sign up and Register to Contribute acceptance checkboxes |
| `/account` | `app/account/page.tsx` + `ManageAccount.tsx` | Server + Client | Any session, no role needed (outside the `(app)` group). Profile (name/organisation → `user_metadata`), Contact sharing (approved contributors only → `POST /api/account/contact-sharing`), Danger zone (`DeleteAccountButton`). Linked as "Account" next to the email in the Sidebar footer |
| `/admin` | `app/admin/page.tsx` | Server | `isAdmin` only, else redirect to `/` |
| `/admin/usage` | `app/admin/usage/page.tsx` | Server | `isAdmin` only, else redirect to `/`. Standalone layout like `/admin` (no `AppShell`) |
| `/admin/errors` | `app/admin/errors/page.tsx` | Server | `isAdmin` only, else redirect to `/` |
| (any segment error) | `app/error.tsx`, `app/global-error.tsx` | Client | — |
| (unknown route) | `app/not-found.tsx` | Server | — (a signed-out visitor on a non-public path is redirected to login by `proxy.ts` first) |
| `/` (inside `(app)` group) | `app/(app)/page.tsx` | Server | Redirects to `/explore` |
| `/adoptions` | `app/(app)/adoptions/page.tsx` | Client | Any role (`hasAnyRole`) |
| `/wiki` | `app/(app)/wiki/page.tsx` | Server | Any role; deliberately unlinked from nav |
| `/wiki/[slug]` | `app/(app)/wiki/[slug]/page.tsx` | Server | Any role |

## Key pages, in detail

**`app/login/page.tsx`** — sign-in, two-step signup (details → 6-digit OTP), and code-based forgot-password, all via `@/lib/supabase/client`. The signup details step carries the "Before you sign up" notice and two required checkboxes (Privacy Notice consent, Terms of Use agreement); the acceptance is stored in `user_metadata` as `privacy_consent_at`/`terms_accepted_at`/`terms_version` (`LEGAL_VERSION` in `lib/legal.ts`). Sign-in asks for nothing. Calls `POST /api/auth/grant-default-role` right after successful signup verification, then redirects to `/explore`.

**`app/explore/page.tsx` / `ExploreLibrary.tsx`** — fetches `published_pathways` via the **admin** Supabase client (bypassing RLS/auth context) so anonymous visitors can browse. `ExploreLibrary.tsx` (~770 lines) is the largest single page component: merges DB-published pathways with the static `lib/library-pathways.ts` list (DB wins on slug collision), two views (card grid with Stage/Sector/Tags filters, and a per-pathway chat), persists signed-in-only conversations to `library_conversations`. Has its own markdown renderer, textarea, and send button — not shared with `ChatPanel.tsx` (see [`../architecture/coding-patterns.md`](../architecture/coding-patterns.md)).

**`app/analyse/page.tsx` / `StrengthenWorkspace.tsx`** — three-tier gate (no user → login CTA; user with zero roles → redirect `/explore`; user without `adopter` → "ask an admin" message). `StrengthenWorkspace.tsx` owns `?open=<id>` deep-linking and guards against opening a Contributor-flow row here.

**`app/contribute/page.tsx` + gates + `ContributeGrid.tsx`** — gate chain: no user → explainer; no role at all → redirect `/explore`; no registration row → `ContributorRegistrationGate`; `access_status==='rejected'` → rejection message; registered but role not yet granted → "under review"; else → `ContributeGrid`'s state machine (`pathways` grid → `pick` (join/create) → `new`/`existing` workspace).

**`app/admin/page.tsx`** — loads all Supabase Auth users, `user_roles`, `published_pathways`, `pathways`, and `contributor_registrations` in parallel; renders `AdminDashboard` + `AdminContributorRegistrationsPanel` + `AdminPathwaysPanel`, with "Usage · Recent errors" links under the heading. (The unused `PathwaySubmissionsPanel.tsx` was deleted — see [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01).)

**`app/admin/usage/page.tsx`** — one service-role `rpc('admin_usage_stats')` call plus the published-pathway count from `listWikiPathways()` (deduplicated by slug). Shows user tiles (total / new 7d / active 7d & 30d), conversations per area, an AI-usage table per area (calls, failed, input tokens = uncached + cache read + cache write, output, cached input), and errors per day / per source split by kind, with a "See the most recent errors" link and a "No errors recorded" empty state.

**`app/admin/errors/page.tsx`** — the latest 50 `sys_errors` rows, newest first: time (UTC), source, kind badge, environment, the user's email (resolved via `getUserById` for the ids on the page only), message, context IDs, and the stack in a collapsed `<details>`. Everything renders as text, never HTML.

**Error pages** — `app/error.tsx` and `app/global-error.tsx` (the latter brings its own `<html>`/`<body>` + `globals.css`) show `GENERIC_ERROR_MESSAGE` and "Back to home" through `components/ErrorScreen.tsx`, never the error's own text, and call `lib/client-error-report.ts` to POST browser-side errors (those without a `digest`) to `/api/errors/client`; server errors arrive with only a digest and are already recorded by `instrumentation.ts`. `app/not-found.tsx` is Cube's own "Page not found" page.

**Chat failure notices** — `Message.notice` (`components/ChatPanel.tsx`) marks a client-made status bubble. On a failed fetch, a non-ok response, or a stream that breaks off, `runTurn` in `lib/adoption-conversation.ts` (and `ExploreLibrary.tsx` for `/explore`) shows any partial text plus the generic message (or a 4xx's own message) as a notice; notices are filtered out of the history sent to Claude and out of what is saved. In `/explore` a rejected (400/429) message is put back in the input box. Draft/document/insight calls now check `res.ok`, so an error body is never saved as a draft or document version.

**`app/(app)/layout.tsx`** — the layout for the now-narrow `(app)` group (`/adoptions`, `/wiki`, `/admin` only). Reads the `x-user-email` header `proxy.ts` forwards to avoid a second `getUser()` call. Renders `SiteHeader` alone for the "awaiting approval" screen — the one surviving use of `SiteHeader.tsx` in the whole app.

## Components

| Component | Purpose |
|---|---|
| `AppShell.tsx` | Shared nav shell (`Sidebar` + content column) — instantiated separately by `/explore`, `/analyse`, `/contribute`, and the `(app)` layout, rather than one central authenticated layout |
| `Sidebar.tsx` | Always renders Explore/Analyse/Contribute (each self-gates on click-through); Admin only if `isAdmin`; degrades gracefully for an anonymous caller |
| `AdoptionWorkspace.tsx` | ~1020 lines — the shared chat workspace for Explorer, Contributor, and generic `/adoptions` flows; resizable side panel (grid/document/analysis/summary), file drag-and-drop, three distinct welcome screens |
| `ChatPanel.tsx` | ~800 lines — message list + composer, its own markdown renderer, renders document-ready cards and a "Sources" popup fed by `/api/wiki-pathways`; `Message.notice` status bubbles. The old `<deliverable>` handling (`extractDeliverable`, `DeliverableCard`, per-message "Generating your document…") was removed — the `generatingDoc` *prop* remains for Analysis Document / Executive Summary generation |
| `HeatmapGrid.tsx` | Renders the actual 4×4 `<table>` (dimensions × stages), color-coded, with a legend — the current grid UI (see reconciliation note in [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md)) |
| `AttachmentsPanel.tsx` | Drag-and-drop file staging (desktop panel / mobile sheet) |
| `PathwayDocumentPane.tsx` | Read-only preview of a Contributor's in-progress pathway doc: version picker, frontmatter block, body, "Send for Review" — no in-pane editing |
| `AdoptionPlanModal.tsx` | Renders Analysis Document / Executive Summary as an **in-panel view only** (the modal branch, `mode` prop and unused version props were removed), with PDF download |
| `ErrorScreen.tsx` | Full-page message behind `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` |
| `WikiMarkdown.tsx` | Richer markdown renderer with pipe-table support, used by the pathway pane, admin pathway cards, and `/wiki` pages |
| `AdminDashboard.tsx` / `AdminPathwaysPanel.tsx` / `AdminContributorRegistrationsPanel.tsx` | Admin console panels — role grants, pathway publish/delete, registration approve/reject |
| `ContributorRegistrationGate.tsx` | The one-time registration form (organisation, role, consents, MoU, contact-sharing level) |
| `PathwaySelector.tsx` | Join-existing or create-new pathway, with an LLM-backed duplicate check before creation |
| `OrganisationInput.tsx` | Debounced autocomplete against `GET /api/organisations`, used by both signup and contributor registration |
| `AccessGateMessage.tsx` | Shared "here's what this page does, sign in to use it" presentational screen |
| `SignOutButton.tsx` / `SiteHeader.tsx` | Sign-out action; legacy header (see above) |

## Theming

`app/globals.css`'s `@theme inline` block defines the 100 Pathways brand tokens (`--color-navy #1b1b42`, `--color-coral #ff6543`, `--color-yellow #feda09`, `--color-blue #0099ff`, `--color-paper #faf9f6`/`--background`, `--color-ink #363538`/`--foreground`), plus soft/tinted derivatives and font tokens (Inter/DM Sans/PT Serif/Geist Mono via `next/font/google`). Animation classes: `fade-in-up`, `fade-in`, `bounce-dot`, `glow-pulse` (→ `.glow-input`, paused on focus-within).

## Assets

`public/` contains only the five default `create-next-app` starter SVGs (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) — confirmed unreferenced anywhere in the codebase. All actual visual identity lives in `app/globals.css` tokens and inline Tailwind classes, not in static assets.

## Source files

Full file list in [`../repository-map.md`](../repository-map.md).
