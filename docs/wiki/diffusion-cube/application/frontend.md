# Frontend

> Last verified against code: 2026-11-06 (HEAD `0a1ca00`).

The frontend is Next.js 16 App Router, React 19 and Tailwind CSS v4. There is no client-side state library (Redux, Zustand, etc.). State is local `useState` and custom hooks per page. `lib/adoption-conversation.ts`'s `useAdoptionConversation` is the one substantial shared hook.

## Routes

| Route | File | Type | Auth |
|---|---|---|---|
| `/login` | `app/login/page.tsx` | Client (`'use client'`, Suspense-wrapped) | Public |
| `/explore` | `app/explore/page.tsx` + `ExploreLibrary.tsx` | Server (data load) + Client (interactive) | Public |
| `/analyse` | `app/analyse/page.tsx` + `StrengthenWorkspace.tsx` | Server + Client | Session required; tiered by the `adopter` role |
| `/contribute` | `app/contribute/page.tsx` + `ContributeAccessGate.tsx`/`ContributeGrid.tsx` | Server + Client | Session required; tiered by registration and the `pathway_contributor` role |
| `/navigate` | `app/navigate/page.tsx` | Server | Public (redirect stub → `/analyse`) |
| `/terms`, `/privacy` | `app/terms/page.tsx`, `app/privacy/page.tsx` → `components/LegalDocument.tsx` | Server (static, reads `content/legal/*.md` at build) | Public (in `proxy.ts` `PUBLIC_PATHS`). The Terms of Use and Privacy Notice, linked from the acceptance checkboxes on Sign up and on Register to Contribute |
| `/account` | `app/account/page.tsx` + `ManageAccount.tsx` | Server + Client | Any session, no role needed (outside the `(app)` group). Three sections: Profile (name/organisation → `user_metadata`); Contact sharing (approved contributors only → `POST /api/account/contact-sharing`); Danger zone (`DeleteAccountButton`) |
| `/admin` | `app/admin/page.tsx` | Server | `isAdmin` only, else redirect to `/` |
| `/admin/usage` | `app/admin/usage/page.tsx` | Server | `isAdmin` only, else redirect to `/`. Standalone layout like `/admin` (no `AppShell`) |
| `/admin/errors` | `app/admin/errors/page.tsx` | Server | `isAdmin` only, else redirect to `/` |
| (any segment error) | `app/error.tsx`, `app/global-error.tsx` | Client | n/a |
| (unknown route) | `app/not-found.tsx` | Server | n/a (`proxy.ts` first redirects a signed-out visitor on a non-public path to login) |
| `/` (inside `(app)` group) | `app/(app)/page.tsx` | Server | Redirects to `/explore` |
| `/adoptions` | `app/(app)/adoptions/page.tsx` | Client | Any role (`hasAnyRole`) |
| `/wiki` | `app/(app)/wiki/page.tsx` | Server | Any role; deliberately left out of the nav. Lists published pathways from the store (`listWikiPathways`) |
| `/wiki/[slug]` | `app/(app)/wiki/[slug]/page.tsx` | Server | Any role. Published pathways only (`getWikiPathway`), with frontmatter and Source Trace stripped |

## Key pages, in detail

**`app/login/page.tsx`** handles sign-in, two-step signup (details → 6-digit OTP), and code-based forgot-password, all via `@/lib/supabase/client`.

- The signup details step shows the "Before you sign up" notice and two required checkboxes: Privacy Notice consent and Terms of Use agreement. The acceptance is stored in `user_metadata` as `privacy_consent_at`/`terms_accepted_at`/`terms_version` (`LEGAL_VERSION` in `lib/legal.ts`).
- Sign-in asks for nothing extra.
- **No client-side role grant any more.** The account gets `adopter` from a database trigger when it is created (migration `0039`), so the old `grant-default-role` call is gone.
- A fresh signup redirects to `/explore`. Sign-in honours `?next=`.

**`app/explore/page.tsx` / `ExploreLibrary.tsx`** is the library.

- **Data.** The page reads **every published pathway from the store**: `listPublished()` in `lib/pathway-store.ts`, which uses the service-role client over the `published_pathways` view, so anonymous visitors can browse. It maps them to `LibraryPathway` cards (`lib/library-types.ts`: `slugToAccent`, `toLibraryStage`). Nothing is hard-coded. The static `lib/library-pathways.ts` list and the static/DB merge are gone, so a newly published pathway gets its card on the next request.
- **`ExploreLibrary.tsx`** (~770 lines) is the largest single page component. It has two views: a card grid with Stage/Sector/Tags filters, and a per-pathway chat. Signed-in visitors' conversations persist to `library_conversations`.
- **Toolkit assets.** Assistant replies that carry a `<toolkit_assets>` tag render `ToolkitAssetCards`.
- **Not shared with `ChatPanel.tsx`.** The page has its own markdown renderer, textarea and send button (see [`../architecture/coding-patterns.md`](../architecture/coding-patterns.md)).

**`app/analyse/page.tsx` / `StrengthenWorkspace.tsx`** use a three-tier gate:

1. No user → login CTA.
2. A user with zero roles → redirect to `/explore`.
3. A user without `adopter` → "ask an admin" message.

Since every account holds `adopter` from signup, tiers 2 and 3 are now defensive only. `StrengthenWorkspace.tsx` owns `?open=<id>` deep-linking and refuses to open a Contributor-flow row on this page.

**`app/contribute/page.tsx` + gates + `ContributeGrid.tsx`** use this gate chain:

1. No user → explainer.
2. No role at all → redirect to `/explore`.
3. No registration row → `ContributorRegistrationGate`.
4. `access_status==='rejected'` → rejection message.
5. Registered but the role is not granted yet → "under review".
6. Otherwise → `ContributeGrid`'s state machine: `pathways` grid → `pick` (join/create via `PathwaySelector`) → `new`/`existing` workspace.

The grid shows only pathways the person has joined.

**`app/admin/page.tsx`** loads these in parallel with the service-role client:

- all Supabase Auth users
- `user_roles`
- published slugs from the `published_pathways` view
- `pathways` (`id, slug, title, sector, created_at, review_requested`)
- `contributor_registrations`
- toolkit-asset rows from `contribution_units`

It renders `AdminDashboard` + `AdminContributorRegistrationsPanel` + `AdminPathwaysPanel`, with "Usage · Recent errors" links under the heading. The subtitle reads "Manage contributor and admin roles. Every account is an Adopter from signup." There is no signup-approval step and no "pending" row highlighting any more.

**`app/admin/usage/page.tsx`** makes one service-role `rpc('admin_usage_stats')` call and gets the published-pathway count from `listWikiPathways()`, which now reads the store. It shows:

- user tiles: total / new 7d / active 7d & 30d
- conversations per area
- an AI-usage table per area: calls, failed, input tokens (uncached + cache read + cache write), output, cached input
- errors per day (IST days since migration `0041`) and per source, split by kind
- a "See the most recent errors" link, and a "No errors recorded" empty state

**`app/admin/errors/page.tsx`** shows the latest 50 `sys_errors` rows, newest first. Each row has the time (IST), source, kind badge, environment, the user's email (resolved via `getUserById` for the ids on the page only), message, context IDs, and the stack in a collapsed `<details>`. Everything renders as text, never as HTML.

**Error pages.** `app/error.tsx` and `app/global-error.tsx` show `GENERIC_ERROR_MESSAGE` and "Back to home" through `components/ErrorScreen.tsx`, never the error's own text. (`global-error.tsx` brings its own `<html>`/`<body>` + `globals.css`.) They call `lib/client-error-report.ts` to POST browser-side errors (those without a `digest`) to `/api/errors/client`. Server errors arrive with only a digest, and `instrumentation.ts` has already recorded them. `app/not-found.tsx` is Cube's own "Page not found" page.

**Chat failure notices.** `Message.notice` (`components/ChatPanel.tsx`) marks a status bubble the client made itself. Three things trigger one in `runTurn` (`lib/adoption-conversation.ts`, and `ExploreLibrary.tsx` for `/explore`): a failed fetch, a non-ok response, or a stream that breaks off. The notice shows any partial text plus the generic message, or a 4xx's own message. `/api/chat` now also returns 403 role errors and 413 size errors, which show this way. Notices are filtered out of the history sent to Claude and out of what is saved. In `/explore`, a rejected (400/429) message goes back into the input box. Draft, document and insight calls check `res.ok`, so an error body is never saved as a draft or document version.

**`app/(app)/layout.tsx`** is the layout for the narrow `(app)` group (`/adoptions`, `/wiki` and the `/` redirect). It reads the `x-user-email` header that `proxy.ts` forwards, to avoid a second `getUser()` call. It still renders `SiteHeader` alone with an "Awaiting approval" screen for a zero-role account. That screen is now effectively unreachable, because `0039` grants `adopter` at signup.

## Components

| Component | Purpose |
|---|---|
| `AppShell.tsx` | Shared nav shell (`Sidebar` + content column). `/explore`, `/analyse`, `/contribute` and the `(app)` layout each create their own, rather than sharing one central authenticated layout |
| `Sidebar.tsx` | Always shows Explore/Analyse/Contribute (each gates itself on click-through). Shows Admin only if `isAdmin`. Degrades gracefully for an anonymous caller |
| `AdoptionWorkspace.tsx` | ~1,135 lines. The shared chat workspace for the Explorer, Contributor and generic `/adoptions` flows: a resizable side panel (grid/document/analysis/summary), file drag-and-drop, three distinct welcome screens, and the contributor's "Reusable assets" popup. Fetches `/api/wiki-pathways` for source chips |
| `ChatPanel.tsx` | ~810 lines. Message list + composer with its own markdown renderer. Renders document-ready cards, a "Sources" popup, `Message.notice` status bubbles, toolkit-asset download cards, and the contributor's in-chat cards (`ToolkitAssetConsentCard`, `ResourceReviewCard`, `AssetShareCard`, `PublishConsentCard`). The old `<deliverable>` handling was removed; the `generatingDoc` *prop* remains |
| `HeatmapGrid.tsx` | Renders the 4×4 `<table>` (dimensions × stages), color-coded, with a legend. This is the current grid UI (see the reconciliation note in [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md)) |
| `AttachmentsPanel.tsx` | Drag-and-drop file staging (desktop panel / mobile sheet) |
| `PathwayDocumentPane.tsx` | Read-only preview of a Contributor's in-progress pathway document: a version picker (now the custom `Select`, right-aligned), frontmatter block, body, the contributor's `ToolkitAssetStatusList`, and "Send for Review" (which asks the publish-consent question in chat first). No in-pane editing. The download filename trims edge hyphens |
| `PathwaySelector.tsx` | Join an existing pathway or create a new one. It **offers only published pathways** to join (it filters `GET /api/pathways` on `isPublished`), because an unpublished one is someone else's private draft. Uses the custom `Select`. Runs an LLM duplicate check (`/api/pathways/check-similar`) before creating |
| `Select.tsx` | **New.** An in-DOM replacement for native `<select>`: an absolutely positioned listbox that reflows on resize and zoom, unlike the OS popup. Follows the WAI-ARIA select-only combobox pattern. Props: `value`, `onChange`, `options`, `placeholder`, `disabled`, `className`, `menuClassName`, `align`. Used by `PathwaySelector`, `PathwayDocumentPane` and `ContributorRegistrationGate` |
| `AdoptionPlanModal.tsx` | Renders the Analysis Document / Executive Summary as an **in-panel view only**, with PDF download |
| `ErrorScreen.tsx` | Full-page message behind `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` |
| `WikiMarkdown.tsx` | A richer markdown renderer with pipe-table support. Renders Section 4's File cell as a Download/Open button. Used by the pathway pane, admin pathway cards and `/wiki` pages |
| `AdminDashboard.tsx` | User/role table. Its columns are only the grantable roles (`pathway_contributor`, `admin`); `adopter` and `general_user` columns were removed. **The "Reject" signup button is gone** |
| `AdminPathwaysPanel.tsx` | Pathway publish/delete for admins. **Status filter** chips: All / Awaiting review / Published / Draft, each with a count, plus an empty state per filter. The status comes from `pathwayStatus(row)`: a pending review outranks published. After a publish, `indexWarningText()` reports lessons skipped for invalid labels, or that search by meaning is unavailable (`embedded:false`). The delete confirmation now says the pathway is **unpublished** from Explore and Analyse too |
| `AdminPathwayRowCard.tsx` | One admin pathway row. Shows a **Draft badge** for `draft` status alongside the awaiting/published states. Loads the document from **`GET /api/admin/pathways/document`**, not the browser Supabase client, so `ADMIN_EMAILS`-only admins can see it under the `0040` RLS. Shows the per-row index warning, and lists toolkit assets with their published state |
| `AdminContributorRegistrationsPanel.tsx` | Registration approve/reject |
| `ContributorRegistrationGate.tsx` | The one-time registration form: organisation, role (custom `Select`), the Terms checkbox, contact-sharing level |
| `ToolkitAssetCards.tsx` | Download cards under an assistant reply that referenced published toolkit assets. In `/analyse` the ids come from `<grid_update>.toolkitAssetsReferenced`; in `/explore` from a `<toolkit_assets>` tag. Metadata comes from public `GET /api/toolkit-assets`, so an invented id renders nothing |
| `ToolkitAssetConsentCard.tsx` | The single "OK to share this publicly?" question before a toolkit asset file or link is stored. Nothing is stored on No |
| `ResourceReviewCard.tsx` | The contributor's review of potentially reusable resources found in their material, decided one by one, then "anything else to share?" and Done, which updates the draft once |
| `AssetShareCard.tsx` | The asset card under a contributor's pathway draft. It offers an upload or link per Section 4 asset (or asks "do you have any?"), then Confirm, which counts as the consent |
| `ReusableAssetsPanel.tsx` | The "Reusable assets" popup in the contributor workspace header. Every asset on the chat's asset cards appears in one list, on the same state: download, remove, add, delete |
| `ToolkitAssetStatusList.tsx` | The contributor's view of a pathway's toolkit assets in the document pane: their own (any status) plus other contributors' published ones, through the session client's `contribution_units` RLS |
| `PublishConsentCard.tsx` | "May this pathway be published?", asked before every Send for Review. Yes sends it. No keeps it as a private draft, or deletes the contribution (`DELETE /api/contributions/[designId]`) |
| `PathwayFrontmatterBlock.tsx` | Frontmatter display shared by the document pane and admin cards |
| `Pagination.tsx` | Client-side pagination (`usePagination`) for the three admin panels |
| `ConfirmDialog.tsx` | An in-app replacement for `window.confirm` (`useConfirm`), portalled to `<body>` |
| `Toaster.tsx` | Renders `showToast()` toasts (`lib/toast.ts`); mounted once in the root layout |
| `VoiceInputButton.tsx` | Web Speech API dictation for every chat composer; renders nothing where the API is missing |
| `PasswordInput.tsx` / `DeleteAccountButton.tsx` | Password field with a Show/Hide toggle / self-serve deletion (password-confirmed) on `/account` |
| `LegalDocument.tsx` / `LegalBackLink.tsx` | The public Terms/Privacy page / its tab-aware Back link |
| `OrganisationInput.tsx` | Debounced autocomplete against `GET /api/organisations`, used by both signup and contributor registration |
| `AccessGateMessage.tsx` | Shared presentational screen: "here's what this page does, sign in to use it" |
| `SignOutButton.tsx` / `SiteHeader.tsx` | Sign-out action / legacy header (see above) |

## Theming

`app/globals.css`'s `@theme inline` block defines the 100 Pathways brand tokens:

- `--color-navy #1b1b42`
- `--color-coral #ff6543`
- `--color-yellow #feda09`
- `--color-blue #0099ff`
- `--color-paper #faf9f6` / `--background`
- `--color-ink #363538` / `--foreground`

It also defines soft and tinted derivatives, and font tokens (Inter, DM Sans, PT Serif and Geist Mono via `next/font/google`). Animation classes: `fade-in-up`, `fade-in`, `bounce-dot`, `glow-pulse` (→ `.glow-input`, paused on focus-within).

## Assets

`public/` contains only the five default `create-next-app` starter SVGs (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`), confirmed unreferenced anywhere in the codebase. The visual identity lives in the `app/globals.css` tokens and inline Tailwind classes, not in static assets.

## Source files

Full file list in [`../repository-map.md`](../repository-map.md).
