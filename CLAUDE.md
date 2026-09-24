# 100 Pathways — Adoption Companion

## What this is

A Next.js web app, the conversational companion to **100pathways.com** — themed to match it exactly and linked back to it from every page's header. A signed-in user falls into one of two roles, each with its own dedicated flow (see "Roles and flows" below): **Explorers** work through their own AI adoption against the existing corpus; **Contributors** turn their own deployment write-up into a new corpus pathway page and push it live themselves. Everything either flow says is grounded in a corpus of real deployment pathways, committed into this repo (`content/wiki/`) plus anything since community-published (`published_pathways` in Supabase). Standing is tracked on a 4 dimensions × 4 stages grid internally, surfaced as four colored status chips (not a table) under the deployment's title/sector-geography-stage/summary header. The Explorer flow can produce two persisted documents (Analysis Document, Executive Summary), stored and reopenable from Supabase.

This is the `revamp-100pathways` branch — a full revamp replacing the earlier "AI Diffusion Studio" app (Explore mode, 7 dimensions, cream/brown theme all removed).

## Roles and flows

Three kinds of signed-in user, on top of the existing `user_roles` table:

- **Explorer** (`adopter` role) — entry point `/explore` (always starts a fresh adoption; existing ones open from `/adoptions`), **intent-driven**: the welcome screen is a four-card menu, not a hero, and the intent is picked explicitly before anything else rather than inferred from free text (see "The four Explorer intents" below).
- **Contributor** (`pathway_contributor` role) — entry point `/contribute`, document-first: "+ New Contribution" opens chat directly (no hero) with a fixed request for deployment documents. `contributorSystemPrompt` drives four steps, entirely its own (this flow shares no step text with Explorer, since it forbids any judgment language about the shared material, positive or negative): (1) wait for documents; (2) once they arrive, exactly one of three outcomes — confirm an inferred stage, ask plainly which stage fits, or say there's not enough and pause (no draft attempted); (3) the moment the stage is settled, generation happens automatically — the model signals this via `pathwayAction: "generate"` on the `<grid_update>` JSON contract, which `lib/adoption-conversation.ts` picks up to call the separate `pathway-draft` mode itself (no button); (4) an open-ended loop where every later turn is either a chat-driven revision (`pathwayAction: "revise"`, whole-document regeneration, including automatically folding in any newly uploaded document), a chat-driven publish (`pathwayAction: "publish"`), or just conversation. Each generation is stored as a new version and surfaces in chat as a client-constructed message (never model-authored) with the real Section 2 gap list and a persistent `<pathway_doc/>` card (`lib/pathway-gaps.ts`, `components/ChatPanel.tsx`) that reopens the stored document in `PathwayDocumentPane.tsx` — a read-only preview + version picker + "Publish" button, no in-pane editing. Publishing (from the pane or from chat) is genuinely self-serve — no separate admin approval step (see `app/api/pathway-submissions/push/route.ts`).
- **Admin** — unchanged: `/admin` for role assignment/signup approval, plus a "Pathway Submissions" panel for oversight (list all submissions regardless of who owns them, mark reviewed, or publish on a contributor's behalf via the older `app/api/admin/pathway-submissions/publish/` route — kept alongside the contributor self-serve path, not replaced by it).

## The four Explorer intents

People arrive at the Cube with four quite different jobs to be done, and each gets its own numbered flow. `lib/explorer-intents.ts` is the single source of truth for all four — the menu copy the UI renders, the client-constructed opening line each chat starts on, and the numbered flow `explorerSystemPrompt` injects (so `totalSteps` varies by intent instead of being a constant). Plain data only, imported by both the server prompt and the client.

- `browse` (4 steps) — "See what the Cube has": what exists, what each pathway enabled. For initiative partners, funders, government officials, enabling orgs.
- `validate` (5 steps) — "Validate what I am already doing": sector/use-case/stage must be clear, then the framework surfaces questions and decisions, then a relevant pathway, else micro-innovations, else both absences.
- `troubleshoot` (5 steps) — "Get help with a specific issue": the user leads, one clarifying question at most, then a documented solution + its pathway, a partial match flagged as such, or a plain "nothing in the pathways speaks to this."
- `guidance` (8 steps) — "Explore what AI could do for me": broad-strokes intake only (sector, persona, problem, rough solution, stage), a relevant pathway, else a choice of dimensions to focus on, gaps as questions/decisions, *very* specifically relevant micro-innovations, both absences stated when neither exists, and — once the conversation has real substance — the Analysis Document, plus the optional, deliberately distinct Executive Summary. Carries a standing rule above its steps: nearly everyone here is at Explore or Define, so don't interrogate for low-level detail that doesn't exist yet — give the one or two things that most matter next. Its opening message is where the flow states what the Cube can do (fixed text, shown before the user types, so a capability claim can't drift).

Four rules are stated **once**, above whichever flow is injected, so no intent can drift to its own version of them:

1. **Matching** — relevant means *same sector AND same use-case category*. Identical test everywhere.
2. **Presentation** — an *exact match* is presented directly; an *adjacent match* (asked "healthcare," corpus has "public health") is presented with the mismatch stated plainly in the same breath.
3. **Micro-innovations** — always framed as suggested choices drawn from other adoptions' lived experience, never recommendations; the user judges fit, and the Cube helps think through contextualization.
4. **Absence and facts-only** — nothing relevant is said plainly, never softened or backfilled with general knowledge; pathways and micro-innovations are *separate* absences and both get stated. Only documented facts are shared — the explanation can be simplified or expanded, the facts never change.

The intent is stored as `AdoptionMeta.intent` and re-injected every turn via `currentProgressBlock`, exactly like `flowStep`. It can change mid-conversation, but never silently: the model flags the mismatch in prose, waits for confirmation, and only then reports the new `meta.intent` — which is the one case where `flowStep` is allowed to go backward (it resets to the new intent's step 1, handled in `sendMessage`).

The Guidance intent's two documents are generated by the client off an `explorerAction` signal on the `<grid_update>` contract (exactly the way `pathwayAction` drives `pathway-draft`) and stored in `design_documents` so they can be reopened at any time — from the header buttons or the `<analysis_doc/>` / `<exec_summary/>` chat cards. Only the latest row per `doc_type` is ever read back, so a regeneration supersedes rather than branching a version the user has to choose between.

A signed-in user with neither `adopter` nor `pathway_contributor` sees an "ask an admin" message instead of a workspace. Someone holding both roles gets both sidebar entries and can run either flow on different adoptions — the choice is made once, per adoption, by which entry point they started from, and is stored as `meta.flow` (`'explorer' | 'contributor'`) on that row from then on. `app/api/chat/route.ts` re-validates `flow` against the caller's actual roles server-side — the sidebar/route gating is UX only.

## The framework

Defined by the "AI Diffusion Pathway Framework" doc, transcribed into `content/framework.md` (injected into every prompt — edit that file to change behavior, no code change):

- **Four dimensions**: Persona, Solution, Institution, Ecosystem — each with lettered sub-categories (4/5/7/6 respectively), each sub-category weighted **Primary / Secondary / Dormant** per stage.
- **Four stages**: Explore, Define, Pilot, Scale — each with "done when…" markers.
- **Five unit types** for corpus knowledge: Strategic Decision, Tactical Decision, Failure and Fix, Playbook, Toolkit Asset — every unit carries a condition tag (applies when / fails when).
- **30/70 thesis**: Persona+Solution = building the right thing; Institution+Ecosystem = the larger adoption work.

`lib/dimensions.ts` holds only the structural shape (codes, names, sub-categories, weights, stage list, density types, brand colors) — the substantive question bank lives in `content/framework.md`. `content/pathway-generation-prompt.md` is the contributor-side prompt for generating new pathway documents from raw material (not used at runtime).

Two hard rules from the framework that bind runtime behavior: pathway documents' **Provenance appendix is contributor-only** — never surfaced in any adopter-facing response; and the framework itself is never referenced as a process ("the framework," sub-category codes, densities, unit-type labels) in user-facing prose, though the four dimension and four stage names are public 100 Pathways vocabulary and fine to use naturally.

## Tech stack

- Next.js 16 (App Router), React 19, Tailwind CSS v4
- Anthropic API via `/api/chat` route handler (`claude-sonnet-4-6`), streamed
- Supabase (Postgres + Auth) for sign-in, approval, roles, and all persistence
- Client-side document/image extraction: `pdfjs-dist`, `mammoth`, `xlsx` (SheetJS CDN build), `jszip`
- PDF export via `jspdf`; line diffing (the Contributor push view) via `diff`
- Theme: 100 Pathways brand tokens (navy `#1b1b42`, coral `#ff6543`, yellow `#feda09`, blue `#0099ff`, paper `#faf9f6`, ink `#363538`) with Inter / DM Sans / PT Serif / Geist Mono — copied verbatim from the Diffusion Library web app, which pulled them from the live site. All in `app/globals.css` as `@theme` tokens (`bg-paper`, `text-navy`, `text-coral`, `glow-input`, etc.).

## Wiki / corpus loading

The pathway corpus is committed into this repo at `content/wiki/pathways/` (`lib/wiki-loader.ts`), so it deploys on Vercel with no extra step — `WIKI_PATH` env var can still override the path (e.g. a different checkout in local dev) but nothing requires it. `loadWikiContext()` reads `pathways/index.md`, parses the relative `(slug.md)` links, and loads all pathway pages (7 currently, whole corpus ≈ 22K tokens with the framework — fine at this size; revisit with retrieval when it grows). `loadFrameworkContent()` reads `content/framework.md`, and `loadPathwayGenerationPrompt()` reads `content/pathway-generation-prompt.md` (used at runtime now too, by the `pathway-draft` mode). All reads go through one `readSource()` function so a future S3 move is a single swap.

Each of the 7 pathway docs was regenerated from the pre-revamp corpus (previously a simpler frontmatter+prose format under an old 7-category model) into the full Sections 0–6 + Provenance-appendix structure `content/pathway-generation-prompt.md` specifies — numbered, individually-tagged units (Strategic Decision / Tactical Decision / Failure and Fix / Playbook / Toolkit Asset), a Section 2 coverage grid, toolkit table, problem→solution table, and retrieval guide — reclassified into the new 4-dimension framework rather than re-derived from raw interviews (the Provenance appendix on each says so explicitly). `lib/wiki-content.ts` serves these for on-demand browsing at `/wiki` (`app/(app)/wiki/`), separately from the prompt-injection path — it strips the Provenance appendix before display (contributor-only, same rule as adopter-facing chat) and strips frontmatter. `components/WikiMarkdown.tsx` renders it (a richer markdown subset than `lib/adoption-plan-markdown.ts`'s parser — adds pipe-table support, since pathway docs lean on tables).

The old `wiki_cache`/`pathway_cache` Supabase tables and the GitHub-raw fetching path are no longer used (tables still exist in the DB, inert).

## Project structure

```
/app
  layout.tsx                ← fonts (Inter/DM Sans/PT Serif/Geist Mono), metadata
  globals.css                ← 100 Pathways theme tokens + animations (fade-in-up, bounce-dot, glow-input)
  login/page.tsx              ← sign-in / request-access (Supabase email+password, admin approval)
  admin/page.tsx               ← user approval + role management (see Auth section)
  api/chat/route.ts            ← modes: companion (flow: explorer|contributor) | analysis-doc | executive-summary | plan-document | extract-insights | pathway-draft
  api/admin/pathway-submissions/review/route.ts ← admin marks a submission reviewed
  api/admin/pathway-submissions/publish/route.ts ← admin publishes/updates a submission on a contributor's behalf
  api/pathway-submissions/push/route.ts ← CONTRIBUTOR self-serve push straight to published_pathways
  (app)/
    layout.tsx                  ← SiteHeader + approval gate (hasAnyRole) + Sidebar (now passes canExplore/canContribute)
    page.tsx                     ← redirects to /explore or /contribute by role; "ask an admin" if neither
    explore/page.tsx               ← dedicated Explorer entry point (role-gated, redirects home otherwise); its welcome screen is the four-card intent menu
    contribute/page.tsx             ← dedicated Contributor entry point (role-gated, redirects home otherwise)
    adoptions/page.tsx               ← grid of the user's saved adoptions (?open=<id> deep link); "+ Explore"/"+ Contribute" buttons instead of a generic new-adoption action
    wiki/page.tsx                     ← on-demand corpus browsing: pathway index by category
    wiki/[slug]/page.tsx                ← one pathway page, Provenance appendix stripped
proxy.ts                    ← auth middleware (public: /login only)
/content
  framework.md               ← THE framework (question bank, weights, unit types) — prompt-injected
  pathway-generation-prompt.md ← generation rules + output structure — prompt-injected by `pathway-draft` too now
  wiki/pathways/*.md            ← the corpus itself, committed into the repo (see Wiki section above)
/lib
  explorer-intents.ts        ← THE four Explorer intents: menu copy, opening lines, numbered flows, totalSteps — shared by prompt and UI
  dimensions.ts              ← structural shape: 4 dimensions, sub-categories, weights, GridState, densityToStatus/STATUS_COLORS (chip status)
  system-prompts.ts           ← explorerSystemPrompt (intent-driven), contributorSystemPrompt, analysisDocSystemPrompt, executiveSummarySystemPrompt, planDocumentSystemPrompt, documentInsightSystemPrompt, pathwayDraftSystemPrompt
  grid-update.ts                ← parseGridUpdate/stripGridUpdate — split out so app/api/chat/route.ts (server) can import it without pulling in adoption-conversation.ts's React hooks
  adoption-conversation.ts     ← useAdoptionConversation hook: AdoptionMeta.flow/.intent, lazy row creation (dedup'd via creatingRef), attachments, extractInsightsForAttachment, explorerDoc (Analysis Document / Executive Summary)
  pathway-submission-versions.ts ← upsertPathwaySubmission (one draft per design_id), version list/insert, getPublishedInfoBySubmission (live slug + content, for the pane's Draft/Published status)
  adoptions-cache.ts            ← 60s TTL cache for the adoptions list
  design-documents.ts            ← versioned Analysis Doc / Plan Document storage + content-hash caching
  wiki-loader.ts                  ← in-repo corpus reads for prompts, merged with published_pathways (see above)
  wiki-content.ts                   ← in-repo corpus reads for on-demand /wiki browsing, merged with published_pathways (Provenance-stripped)
  extract-text.ts                    ← client-side text extraction from uploads
  adoption-plan-markdown.ts           ← markdown-subset parser shared by modal + PDF (no tables)
  adoption-plan-pdf.ts                 ← jsPDF export
  roles.ts                              ← hasRole/hasAnyRole/isAdmin
  supabase/{client,server,admin}.ts      ← Supabase client factories (admin = service-role)
  logger.ts                               ← fire-and-forget Google Sheets logging
/components
  SiteHeader.tsx            ← "← Back | 100 Pathways / Adoption Companion" (matches Diffusion Library)
  Sidebar.tsx                 ← nav (Explore / Contribute — each role-gated / Your adoptions / The Wiki / Admin) + recent list; mobile drawer
  AdoptionWorkspace.tsx        ← the whole experience: welcome hero (fixedFlow-aware) → conversation header (title/sector-geo-stage/summary/chips) + docs
  DimensionChips.tsx            ← four status chips (ported from the pre-revamp DimensionList), one status per dimension at the deployment's current stage
  ChatPanel.tsx                  ← conversation panel (**bold** inline rendering)
  AttachmentsPanel.tsx            ← file staging panel (desktop side / mobile sheet)
  AdoptionPlanModal.tsx            ← generated-document modal with PDF download (Explorer's Analysis Document / Executive Summary; version picker unused there)
  PathwayDocumentPane.tsx              ← Contributor's read-only doc pane: preview, version picker, "Publish" — no in-pane editing, revisions are chat-only
  WikiMarkdown.tsx                    ← markdown renderer with pipe-table support, used by /wiki and the draft modal
  AdminDashboard.tsx                    ← role checkboxes + reject
  PathwaySubmissionsPanel.tsx            ← admin list of all submissions, expand + mark reviewed/publish
  SignOutButton.tsx
```

Deleted in the revamp: Explore (the old 7-dimension version — routes, prompts, modes, `pathway_cache`), `DimensionList` (superseded by the new `DimensionChips`, same visual idea), `CoverageGrid` (the 4×4 table UI — the grid data model itself is unchanged, just no longer rendered as a table), `Cube3D`/`CubeIcon`, `lib/pathways.ts`, the 7-dimension `cube_update` contract. `lib/email.ts`'s old admin-approval senders (`sendAdminApprovalEmail`/`sendUserApprovedEmail`) remain dormant (see SIGNUP_APPROVAL_OPTIONS.md); its transport and auth-email senders are live, used by the Send Email hook.

## The `/api/chat` route handler

Receives `{ messages, mode, grid?, meta?, versionNumber?, designId?, flow? }`. Modes:

- `companion` — the conversation. `flow` (`'explorer' | 'contributor'`) picks `explorerSystemPrompt` or `contributorSystemPrompt`, re-validated server-side against the caller's actual role (`hasRole`) regardless of what the UI sent. Every response ends with a `<grid_update>` JSON block: `{ cells: {...changed cells only}, meta: {...}, pathwaysReferenced: [...], flowStep: N }`. `meta.stage` is only ever filled from the user's own statement. `flowStep` is the model's own report of which numbered step of its flow it's on (4 for Contributor; for Explorer it depends on the chosen intent — see lib/explorer-intents.ts) — persisted as `AdoptionMeta.flowStep` and sent back in on every subsequent call as `grid`/`meta`, since the `<grid_update>` block is stripped before a message is stored and so never survives in replayed history; `currentProgressBlock()` in `lib/system-prompts.ts` re-injects it each turn as the model's one source of truth for "where am I," rather than asking it to re-infer position from prose. Client merges cells and strips the block for display. Every companion-mode call also inserts the user's last message into `adoption_queries`, tagged with `pathwaysReferenced` as `pathway_slugs` (fire-and-forget) — recorded material for future cross-adoption insight gathering, not surfaced anywhere yet.
- `analysis-doc` — full standing document: coverage-grid section in density notation, per-dimension narrative, Questions and Decisions to Consider, Related Pathway Experience, Suggested Choices from Other Adoptions, Open Threads. Descriptive, never prescriptive; anything unsettled is framed as a question or decision, never a deficiency. This is the Explorer/Guidance intent's primary deliverable, triggered by `explorerAction: "analysis"`.
- `executive-summary` — the Guidance intent's *secondary*, deliberately smaller document (`explorerAction: "executive-summary"`, stored under the existing `plan` doc_type): two sections only — the implementation in brief, plus a condensed take on the suggestions the Analysis Document already surfaced (the client passes that document in as trailing context). Always offered after, and explicitly distinguished from, the Analysis Document.
- `plan-document` — 4-section executive doc (Project Summary / Key Gaps ≤10 / Key Recommendations ≤5, each grounded in a named pathway / Next Steps ≤5, only user-surfaced actions). Title: `<name> Plan Doc v<N>`.
- `extract-insights` — silent, one-shot pass over a single uploaded document, called immediately on upload (before any conversation) from `extractInsightsForAttachment` in `lib/adoption-conversation.ts`. Returns only a `<grid_update>` block; seeds the grid the moment a file lands rather than waiting for the first chat turn.
- `pathway-draft` — drafts (or revises, given a trailing revision instruction) the current conversation as a candidate pathway document, in the exact Sections 0–6 + Provenance-appendix structure the real corpus uses (`content/pathway-generation-prompt.md` injected as the spec). Triggered automatically by `lib/adoption-conversation.ts` off the companion's `pathwayAction` signal (Contributor flow only) — no button; never publishes itself — that's the pane's "Publish" button or a chat-driven publish request, both via `/api/pathway-submissions/push`.

All modes require an approved account (`hasAnyRole`) — 403 otherwise. Max tokens: 8192 companion, 1024 extract-insights, 4096 analysis/executive-summary/plan doc, 6144 pathway-draft.

## The two flows' posture (lib/system-prompts.ts)

Both flows share the same grounding discipline — never fabricate, always trace to a named pathway with its condition tag, never surface a Provenance appendix, never dump framework jargon — but differ in how directive they are, by design:

**Explorer** (`explorerSystemPrompt`) keeps its consultant posture — think with the user, earn recommendations, calibrate confidence to evidence — but the workflow underneath it is now whichever intent the user picked from the menu (see "The four Explorer intents" above). The prompt is assembled per-intent: shared posture and the four shared rules are constant, only the numbered flow and `totalSteps` change. It never sets an agenda outside that flow, never assigns a stage the user hasn't confirmed, and never switches intent without asking first.

**Contributor** (`contributorSystemPrompt`) is more of a guided pipeline, with its own stage-confirmation step (no text shared with Explorer, whose "react to what they shared" opening would break this flow's no-judgment rule). The remap into the four-dimension framework (step 3) is deliberately invisible — no document is generated or shown at that point, it's just the prompt's own grid-tracking continuing. Step 4 (same message as step 3) pairs what's well-established with the open gaps, leading with what's working. Step 5 offers an explicit choice — skip the gaps and generate the wiki page now, or go through them one by one — and only once the user actually chooses to generate does the real `pathway-draft` document get produced and opened for conversational revision. Genuine tangents get answered before returning to the current checkpoint either way — guided, not rigid.

Style for both: simple English, 4-sentence hard cap plus at most one clarifying question, genuine energy, varied phrasing.

## Auth, approval, and roles

`proxy.ts` gates everything but `/login`; signup is a two-step form on `/login` (`supabase.auth.signUp` with name/organization metadata, then a 6-digit email OTP verified with `verifyOtp`, resendable via `auth.resend` — requires "Confirm email" **enabled** in Supabase). Supabase generates and verifies every OTP/link but sends no email itself: its **Send Email Auth Hook** POSTs each one to `app/api/auth/send-email/route.ts` (public in `proxy.ts`, authenticated by its Standard Webhooks signature against `SEND_EMAIL_HOOK_SECRET`), which delivers it via nodemailer to whatever SMTP server `SMTP_*` points at (`lib/email.ts` — provider-agnostic, no SES/AWS dependency) — sign-up codes, password-reset **codes** ("Forgot password?" on `/login` is code-based too: `resetPasswordForEmail` → `verifyOtp({ type: 'recovery' })` → `updateUser({ password })`; the old link-based `/login/reset-password` page is gone), invites, magic links; `email_change` is deliberately rejected since nothing in the app uses it. Email templates therefore live in `lib/email.ts`, not the Supabase dashboard. See SIGNUP_OTP_SPEC.md; the `adopter` role is granted via `/api/auth/grant-default-role` only after verification; zero rows in `user_roles` = pending, and `app/(app)/layout.tsx` shows an awaiting-approval screen; `/admin` (env `ADMIN_EMAILS` fallback OR the `admin` role) lists users with per-role checkboxes and destructive Reject.

**Role semantics are real again** (this is the change from the role-split rework): `adopter` gates the Explorer flow (`/explore`, and any adoption whose `meta.flow === 'explorer'`), `pathway_contributor` gates the Contributor flow (`/contribute`, self-serve push to the wiki). Any role still grants baseline access past the approval gate (`hasAnyRole`) — analysis/plan documents and `/wiki` browsing aren't flow-specific — but starting or continuing either named flow requires the matching role, checked both in the UI (`app/(app)/{explore,contribute}/page.tsx`, `Sidebar.tsx`) and re-validated server-side in `app/api/chat/route.ts`.

## Supabase tables

- **`designs`** — one row per adoption: `meta` (now includes `flow: 'explorer' | 'contributor' | ''`, fixed at creation), `grid_state` (renamed from `cube_state` in migration 0008, which also cleared pre-revamp test rows), `messages` jsonb. Lazy creation on first send **or** first uploaded document (whichever happens first — `extract-insights` needs a row to seed).
- **`design_documents`** — the Explorer flow's generated documents, content-hash cached (a regeneration with an unchanged conversation is served from the stored row, no model call). Rows are append-only for schema reasons, but only the latest per `(design_id, doc_type)` is ever read back — `analysis` is the Analysis Document, `plan` is the Executive Summary — so a regeneration supersedes rather than versioning.
- **`pathway_submissions`** (migration 0009; `design_id` made unique in migration 0013 so the app can upsert "the one draft for this adoption") — the Contributor's draft: `design_id`, `content` (denormalized pointer to the latest version), `status` (`pending_review`/`reviewed`/`published`). Owner can insert/view/update their own (the update policy is what lets the contributor's own session push, not just the service-role client).
- **`pathway_submission_versions`** (migration 0013) — append-only version history per submission: `version_number`, `content`, `commit_message`. Inserted on every draft generation and every conversational revision — this is what backs the version-picker dropdown in `PathwayDocumentPane` and the `<pathway_doc/>` chat card's "current version" (see `lib/pathway-gaps.ts` for how the gap list shown in chat is parsed straight from a version's own Section 2).
- **`adoption_queries`** (migrations 0010, 0011) — every companion-mode user message, insert-only, tagged with `pathway_slugs` (parsed from that turn's `<grid_update>.pathwaysReferenced` — which pathways the response actually drew on) for future cross-adoption insight gathering. Nothing reads this yet.
- **`published_pathways`** (migration 0012; `commit_message` column added in 0013) — publicly readable (RLS `using (true)`) so any approved user can see them at `/wiki`, and `loadWikiContext()` merges them into the companion's grounding corpus too. Two ways in: the Contributor's own "Push to Wiki" (`app/api/pathway-submissions/push/`, upserts by `source_submission_id` so re-pushing keeps the same slug/URL) or an admin publishing on their behalf (`app/api/admin/pathway-submissions/publish/`). Slugified from the adoption's name, checked for collisions against both the static files and this table. No git commit or redeploy needed — this is why the corpus is DB-backed for community content while the original 7 curated pathways stay as static files.
- **`user_roles`** — `(user_id, role)` grants: general_user | adopter | pathway_contributor | admin. `adopter`/`pathway_contributor` now have real behavioral meaning (see "Roles and flows" above), not just baseline access.
- Inert leftovers: `pathway_cache`, `wiki_cache`, `pending_signups` (nothing reads or writes them).

Migrations 0008 through 0013 must be run in the Supabase SQL Editor for the app to work post-revamp.

## Environment variables

```
ANTHROPIC_API_KEY=your_key_here
WIKI_PATH=/absolute/path/to/a/wiki/checkout   # optional; defaults to content/wiki/ in this repo
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # server-only, /admin actions
ADMIN_EMAILS=a@x.com,b@y.com         # permanent admin fallback
GOOGLE_SHEET_ID=...                  # optional logging
GOOGLE_SERVICE_ACCOUNT_JSON={...}    # optional logging
SEND_EMAIL_HOOK_SECRET=v1,whsec_...  # from Supabase → Auth Hooks → Send Email hook
SMTP_HOST=smtp.example.com          # any SMTP provider (nodemailer)
SMTP_PORT=587                        # 587 = STARTTLS, 465 = implicit TLS
SMTP_SECURE=                         # optional override; defaults to true only on port 465
SMTP_USER=...
SMTP_PASS=...                        # app password / SMTP key, never a personal login password
EMAIL_FROM_ADDRESS="100 Pathways <no-reply@your-domain>"   # must be an address SMTP_USER may send as
```

`GITHUB_WIKI_BASE_URL`/`NEXT_PUBLIC_GITHUB_WIKI_BASE_URL` and `APP_URL` are no longer read by any active code path.

## Out of scope / not yet built

- Cross-user insights UI ("what did others ask about a pathway like mine") — `adoption_queries` now records the raw material for this, but nothing reads or surfaces it yet
- Any moderation/undo on a Contributor's self-serve push — once pushed, it's live; an admin can overwrite via the admin publish route but there's no "unpublish" or approval gate in front of the contributor's own push
- A user with neither `adopter` nor `pathway_contributor` has no workspace at all (just the "ask an admin" message) — there's no read-only/general_user experience beyond `/wiki` and `/adoptions`
- Legacy binary Office formats (.doc, .ppt) for uploads
