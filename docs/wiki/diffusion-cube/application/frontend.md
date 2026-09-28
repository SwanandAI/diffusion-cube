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
| `/admin` | `app/admin/page.tsx` | Server | `isAdmin` only, else redirect to `/` |
| `/` (inside `(app)` group) | `app/(app)/page.tsx` | Server | Redirects to `/explore` |
| `/adoptions` | `app/(app)/adoptions/page.tsx` | Client | Any role (`hasAnyRole`) |
| `/wiki` | `app/(app)/wiki/page.tsx` | Server | Any role; deliberately unlinked from nav |
| `/wiki/[slug]` | `app/(app)/wiki/[slug]/page.tsx` | Server | Any role |

## Key pages, in detail

**`app/login/page.tsx`** — sign-in, two-step signup (details → 6-digit OTP), and code-based forgot-password, all via `@/lib/supabase/client`. Calls `POST /api/auth/grant-default-role` right after successful signup verification, then redirects to `/explore`.

**`app/explore/page.tsx` / `ExploreLibrary.tsx`** — fetches `published_pathways` via the **admin** Supabase client (bypassing RLS/auth context) so anonymous visitors can browse. `ExploreLibrary.tsx` (~720 lines) is the largest single page component: merges DB-published pathways with the static `lib/library-pathways.ts` list (DB wins on slug collision), two views (card grid with Stage/Sector/Tags filters, and a per-pathway chat), persists signed-in-only conversations to `library_conversations`. Has its own markdown renderer, textarea, and send button — not shared with `ChatPanel.tsx` (see [`../architecture/coding-patterns.md`](../architecture/coding-patterns.md)).

**`app/analyse/page.tsx` / `StrengthenWorkspace.tsx`** — three-tier gate (no user → login CTA; user with zero roles → redirect `/explore`; user without `adopter` → "ask an admin" message). `StrengthenWorkspace.tsx` owns `?open=<id>` deep-linking and guards against opening a Contributor-flow row here.

**`app/contribute/page.tsx` + gates + `ContributeGrid.tsx`** — gate chain: no user → explainer; no role at all → redirect `/explore`; no registration row → `ContributorRegistrationGate`; `access_status==='rejected'` → rejection message; registered but role not yet granted → "under review"; else → `ContributeGrid`'s state machine (`pathways` grid → `pick` (join/create) → `new`/`existing` workspace).

**`app/admin/page.tsx`** — loads all Supabase Auth users, `user_roles`, `published_pathways`, `pathways`, and `contributor_registrations` in parallel; renders `AdminDashboard` + `AdminContributorRegistrationsPanel` + `AdminPathwaysPanel` (note: **not** `PathwaySubmissionsPanel` — that component is unused, see [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01)).

**`app/(app)/layout.tsx`** — the layout for the now-narrow `(app)` group (`/adoptions`, `/wiki`, `/admin` only). Reads the `x-user-email` header `proxy.ts` forwards to avoid a second `getUser()` call. Renders `SiteHeader` alone for the "awaiting approval" screen — the one surviving use of `SiteHeader.tsx` in the whole app.

## Components

| Component | Purpose |
|---|---|
| `AppShell.tsx` | Shared nav shell (`Sidebar` + content column) — instantiated separately by `/explore`, `/analyse`, `/contribute`, and the `(app)` layout, rather than one central authenticated layout |
| `Sidebar.tsx` | Always renders Explore/Analyse/Contribute (each self-gates on click-through); Admin only if `isAdmin`; degrades gracefully for an anonymous caller |
| `AdoptionWorkspace.tsx` | ~1020 lines — the shared chat workspace for Explorer, Contributor, and generic `/adoptions` flows; resizable side panel (grid/document/analysis/summary), file drag-and-drop, three distinct welcome screens |
| `ChatPanel.tsx` | ~700 lines — message list + composer, its own markdown renderer, renders document-ready cards and a "Sources" popup fed by `/api/wiki-pathways` |
| `HeatmapGrid.tsx` | Renders the actual 4×4 `<table>` (dimensions × stages), color-coded, with a legend — the current grid UI (see reconciliation note in [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md)) |
| `AttachmentsPanel.tsx` | Drag-and-drop file staging (desktop panel / mobile sheet) |
| `PathwayDocumentPane.tsx` | Read-only preview of a Contributor's in-progress pathway doc: version picker, frontmatter block, body, "Send for Review" — no in-pane editing |
| `AdoptionPlanModal.tsx` | Renders Analysis Document / Executive Summary as a modal or an in-panel view, with PDF download |
| `WikiMarkdown.tsx` | Richer markdown renderer with pipe-table support, used by the pathway pane, admin pathway cards, and `/wiki` pages |
| `AdminDashboard.tsx` / `AdminPathwaysPanel.tsx` / `AdminContributorRegistrationsPanel.tsx` | Admin console panels — role grants, pathway publish/delete, registration approve/reject |
| `ContributorRegistrationGate.tsx` | The one-time registration form (organisation, role, consents, MoU, contact-sharing level) |
| `PathwaySelector.tsx` | Join-existing or create-new pathway, with an LLM-backed duplicate check before creation |
| `OrganisationInput.tsx` | Debounced autocomplete against `GET /api/organisations`, used by both signup and contributor registration |
| `AccessGateMessage.tsx` | Shared "here's what this page does, sign in to use it" presentational screen |
| `SignOutButton.tsx` / `SiteHeader.tsx` | Sign-out action; legacy header (see above) |
| `PathwaySubmissionsPanel.tsx` | **Unused** — not rendered anywhere; built against the dropped `pathway_submissions` table |

## Theming

`app/globals.css`'s `@theme inline` block defines the 100 Pathways brand tokens (`--color-navy #1b1b42`, `--color-coral #ff6543`, `--color-yellow #feda09`, `--color-blue #0099ff`, `--color-paper #faf9f6`/`--background`, `--color-ink #363538`/`--foreground`), plus soft/tinted derivatives and font tokens (Inter/DM Sans/PT Serif/Geist Mono via `next/font/google`). Animation classes: `fade-in-up`, `fade-in`, `bounce-dot`, `glow-pulse` (→ `.glow-input`, paused on focus-within).

## Assets

`public/` contains only the five default `create-next-app` starter SVGs (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) — confirmed unreferenced anywhere in the codebase. All actual visual identity lives in `app/globals.css` tokens and inline Tailwind classes, not in static assets.

## Source files

Full file list in [`../repository-map.md`](../repository-map.md).
