# Sequence & Workflow Diagrams

> Canonical file for both interaction sequences and business-workflow flowcharts. `business/workflows.md` links here rather than duplicating these diagrams.
>
> **Updated 2026-11-06** for the pathway-storage feature (`docs/features/pathway-storage/`, migration `0042`): pathways now live only in Supabase, every answer is grounded by per-message retrieval instead of the whole corpus, and contributor "assemble" no longer commits to GitHub.

<a id="w1"></a>

## W1 — Companion chat turn (`mode: 'companion'`)

Referenced by [`business/workflows.md#w1`](../business/workflows.md#w1-companion-chat-turn).

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client hook<br/>lib/adoption-conversation.ts
    participant R as app/api/chat/route.ts
    participant G as lib/retrieval.ts<br/>buildGrounding
    participant M as Claude (claude-sonnet-4-6)
    participant DB as Supabase

    U->>C: types a message / uploads a file
    C->>DB: create designs row if none yet (lazy, dedup'd via creatingRef)
    C->>R: POST mode=companion + messages + grid + meta + flow
    R->>R: rate limit (chat-user per account) → 413 body cap → JSON/shape checks (400)
    R->>DB: currentRoles() — 403 unless requiredRole(mode, flow) is held
    R->>G: buildGrounding(surface='analyse' | 'contribute')
    Note over G: see W4 — classifier + hybrid search,<br/>returns only the pathways/lessons this message needs
    G-->>R: grounding text
    R->>R: + framework.md (+ resources.md + published toolkit assets for Explorer) + current progress block
    R->>M: anthropic.messages.stream(...) (max_tokens 8192)
    M-->>C: prose text + trailing <grid_update> JSON, streamed
    C->>C: parse the block live, strip it from displayed text
    C->>DB: merge changed cells into designs.grid_state
    C->>DB: persist meta (flowStep, hypothesis, persona, cubeAssessment...)

    alt block carries explorerAction or pathwayAction
        C->>R: SECOND call — analysis-doc / pathway-draft / executive-summary
        R->>M: anthropic.messages.stream(...)
        M-->>C: the full document, streamed
        C->>DB: insert design_documents row, versioned
        C->>U: client-constructed message carrying a card marker
        Note over U,C: card reopens the stored doc from design_documents — never stored twice
    else no action
        C->>U: just the prose reply
    end

    R--)DB: adoption_queries insert (fire-and-forget) + ai_usage row via after() (sys_errors row on failure)
```

<a id="w2"></a>

## W2 — Contributor publishes a pathway (two-step: Send for Review → admin Publish)

Referenced by [`business/workflows.md#w2`](../business/workflows.md#w2-contributor-publish).

```mermaid
flowchart TB
    REG["Register<br/>contributor_registrations row"] --> APR["Admin approves<br/>access_status='approved' + user_roles insert (pathway_contributor)"]
    APR --> PICK["Pick or create pathway<br/>POST /api/pathways (check-similar first)<br/>new pathways row, status='draft'"]
    PICK --> JOIN["Join<br/>pathway_contributors row; ensureOrganisation() finds/creates organisations row"]
    JOIN --> WS["New contribution<br/>designs row, meta.flow='contributor', meta.pathwayId set"]
    WS --> UP["Upload documents"]
    UP --> EXI["extract-insights mode<br/>silent, one-shot, seeds grid before any chat"]
    EXI --> STAGE["Chat until stage is settled<br/>(contributorSystemPrompt steps 1-2)"]
    STAGE --> GEN["model sets pathwayAction: 'generate'"]
    GEN --> DRAFT["client calls pathway-draft mode<br/>design_documents row, doc_type='draft', versioned"]
    DRAFT --> REV{"Revise via chat?"}
    REV -- "yes — pathwayAction: 'revise'" --> DRAFT
    REV -- no --> PUB1["POST /api/pathways/assemble<br/>SEND FOR REVIEW"]

    PUB1 --> CHK["checks: pathway_contributor role, member of pathway,<br/>own design for this pathway, valid slug, latest draft exists"]
    CHK --> ASM["applyToolkitAssetFiles()<br/>adds shared files to Section 4"]
    ASM --> SV["saveVersion() → pathway_versions<br/>next version_number, source='contributor'<br/>status draft → in_review (a live pathway stays published)"]
    SV --> CC["pathways.content_cache, review_requested=true,<br/>assembled_design_doc_id"]

    CC --> ADMV["Admin opens review card<br/>GET /api/admin/pathways/document<br/>(latest version, service role)"]
    ADMV --> PUB2["POST /api/admin/pathways/publish<br/>ADMIN PUBLISH"]
    PUB2 --> PV["publishVersion()<br/>pathways.status='published', published_version_id,<br/>card fields from frontmatter"]
    PV --> UNITS["parseUnits() → embedTexts() (embed Edge Function)<br/>replace pathway_units rows<br/>(saved without vectors if embedding fails)"]
    UNITS --> VIEW[("published_pathways VIEW<br/>reflects it on the next request")]
    PUB2 --> TA["publish toolkit assets named in the document<br/>(contribution_units.published_at)"]
    PUB2 --> MAIL["email contributor (best effort)"]
    VIEW --> LIVE["Live in Explore + Analyse grounding —<br/>no commit, no redeploy"]
```

**What changed:** step `PUB1` used to commit the document to GitHub through `lib/github.ts` (and could fire a Vercel deploy on `main`). That module and the `GITHUB_*` env vars are gone; Send for Review now only appends a `pathway_versions` row. Nothing a contributor does is visible to any adopter until an admin publishes (`PUB2`). Skipped units (invalid labels) are returned to the admin panel as `skippedUnits`; the rest of the pathway still publishes.

**Delete = unpublish.** `POST /api/admin/pathways/delete` removes toolkit-asset files and seeded source files from storage, then deletes the `pathways` row; versions, units, sources, contributors and contribution units cascade, and the view drops the pathway in the same statement.

<a id="w3"></a>

## W3 — Explorer produces an Analysis Document

Referenced by [`business/workflows.md#w3`](../business/workflows.md#w3-explorer-analysis-document).

```mermaid
flowchart TB
    A1["/analyse → StrengthenWorkspace (fixedFlow='explorer')"] --> A2["First message or first upload<br/>→ designs row created lazily, dedup'd"]
    A2 --> A3["Upload → extract-insights (silent, 1-shot)<br/>grid seeded before any chat — no corpus"]
    A3 --> A4["Chat turn → companion mode<br/>retrieval grounding for this message (W4)<br/>+ framework, meta re-injected each turn"]
    A4 --> A5["Response streams; grid_update parsed then stripped<br/>changed cells merged into designs.grid_state"]
    A5 --> A6{"Enough substance,<br/>or upload establishes sector+problem?"}
    A6 -- yes --> A7["explorerAction: 'analysis'"]
    A7 --> A8["Client calls analysis-doc mode<br/>grounding surface='document': situation search on<br/>sector + name + summary + hypothesis (no classifier)<br/>design_documents row, doc_type='analysis'<br/>content-hash cached: unchanged conversation = no model call"]
    A8 --> A9["Client appends its own message carrying <analysis_doc/> marker"]
    A9 --> A10["Optionally: executive-summary mode (same grounding)<br/>→ stored as doc_type='plan'"]
    A6 -- no --> A4
```

Only the latest row per `(design_id, doc_type)` is ever read back for `analysis`/`plan` — a regeneration supersedes rather than branching a version the user must choose between. `draft` (pathway documents) is the one `doc_type` where every version stays browsable via the version picker in `PathwayDocumentPane.tsx`.

<a id="w4"></a>

## W4 — Retrieval grounding (per message / per document)

Used by W1, W3 and the Library chat (W5). Source: [`lib/retrieval.ts`](../../../../lib/retrieval.ts), [`lib/embeddings.ts`](../../../../lib/embeddings.ts), `supabase/functions/embed/index.ts`, `match_pathway_units` in `supabase/migrations/0042_pathway_storage.sql`.

```mermaid
sequenceDiagram
    autonumber
    participant R as chat route
    participant G as buildGrounding
    participant PS as lib/pathway-store.ts
    participant H as Claude Haiku<br/>(CLASSIFIER_MODEL)
    participant E as embed Edge Function<br/>(gte-small, 384-dim)
    participant DB as Supabase (service role)

    R->>G: surface, messages, sector, situationText, flow
    G->>PS: listPublished() — published_pathways view
    alt nothing published
        G-->>R: "No pathways are published yet…"
    end
    alt surface = analyse | explore-overview (and there is a question)
        G->>H: messages.create, forced tool route_question,<br/>thinking off, effort low, last 6 turns + published list
        H-->>G: kind (specific|situation|broad|patterns), slugs,<br/>dimension / stage / unit-type filters, search_text
        Note over G,H: any failure → default kind for the surface<br/>(analyse: situation, explore-overview: broad), logged to ai_usage as retrieval-classify
    else surface = contribute | document | explore-pathway
        G->>G: default kind, no classifier call<br/>(situation, or specific for an open pathway)
    end
    G->>E: embedTexts([searchText]) — batches of 4, 20 s timeout,<br/>up to 2 retries on 503/504/546 or dropped connection
    E-->>G: vector (or failure → null, search by text + labels only)
    G->>DB: rpc match_pathway_units(vector, text, slugs, dimension, stage, types, count)
    Note over DB: published units only, narrowed by label filters<br/>vector rank + full-text rank merged by reciprocal rank fusion (k=50)<br/>(neither available → browse by slug / unit order)
    DB-->>G: unit hits
    G->>PS: getPublishedDocuments(top slugs) where the kind needs full documents
    opt specific kind, one pathway with public sources
        G->>DB: rpc match_source_chunks (public passages only, re-checked in code)
    end
    G-->>R: text shaped per kind (documents · further lessons · lessons across pathways · pattern groups with exact counts)
```

`LIMITS` (in `lib/retrieval.ts`) cap what each kind sends: `specific` 2 documents / 5 passages; `situation` 3 pathways, 2 full documents, 30 units; `broad` 8 pathways, 30 units; `patterns` 40 units. Pattern counts are computed in code (`groupPatterns`) and stated as exact, never left to the model. A database error throws (answered by `withErrorHandling`); classifier and embedding failures degrade silently.

<a id="w5"></a>

## W5 — Library chat (`mode: 'library'`, `/explore`, no login)

```mermaid
sequenceDiagram
    autonumber
    actor V as Visitor (anonymous allowed)
    participant L as ExploreLibrary.tsx
    participant R as app/api/chat/route.ts
    participant PS as lib/pathway-store.ts
    participant G as lib/retrieval.ts
    participant M as Claude (claude-sonnet-4-6)

    V->>L: opens a pathway card, or asks a general question
    L->>R: POST mode=library, messages, pathwayId?
    R->>R: rate limit (per IP 'explore', or per account 'chat-user') → isValidExploreConversation (400)
    alt pathway open
        R->>PS: getPublishedDocument(slug) — 404 if not published
        R->>R: adopterDocument() strips Source Trace, adds published toolkit assets
        R->>G: pathwayPassages(slug, last question) — public seeded sources only
        R->>R: libraryPathwaySystemPrompt(document, assets, passages)
    else no pathway open
        R->>PS: buildOverview() — card fields + exact count
        R->>G: buildGrounding(surface='explore-overview') (W4)
        R->>R: libraryOverviewSystemPrompt(overview, count, grounding)
    end
    R->>M: messages.stream (max_tokens 1024, empty history → fixed kickoff turn)
    M-->>L: streamed prose (no grid_update — nothing persisted mid-chat)
```

<a id="w6"></a>

## W6 — Seeding the pathway store (one-time, per Supabase project)

```mermaid
flowchart TB
    S0["npm run seed:pathways -- --manifest m.json [--dry-run] [--only a,b] [--regenerate]<br/>scripts/seed-pathways.ts via vite-node"] --> S1["validateManifest() (lib/seed.ts)"]
    S1 --> S2["extract text per file (pdf/docx/xlsx/xls/pptx/txt/md)"]
    S2 --> DRY{"--dry-run?"}
    DRY -- yes --> STOP["stop — no Storage, DB or Claude calls"]
    DRY -- no --> S3["generate pathway document with Claude (claude-sonnet-4-6)<br/>same generation prompt as contributor drafts<br/>cached in .seed-cache/&lt;slug&gt;.md by source+prompt hash"]
    S3 --> S4["upsert pathways row (is_seed=true)"]
    S4 --> S5["replace pathway_sources: upload originals to private<br/>pathway-sources bucket; chunkText → embedTexts → pathway_source_chunks"]
    S5 --> S6["saveVersion(source='seed') → publishVersion()<br/>no admin review for seeded pathways"]
```

Re-running for a slug adds a new version and replaces its sources; nothing is duplicated. Only files marked `"public": true` in the manifest can ever reach an adopter as passages.

<a id="w7"></a>

## W7 — Default adopter role at signup

```mermaid
sequenceDiagram
    autonumber
    actor U as New user
    participant A as Supabase Auth
    participant T as trigger on_auth_user_created_grant_adopter<br/>(migration 0039)
    participant UR as user_roles

    U->>A: sign up (OTP via send-email hook)
    A->>A: insert auth.users row
    A->>T: AFTER INSERT (same transaction)
    T->>UR: insert (user_id, 'adopter') on conflict do nothing — security definer
    Note over U,UR: no pending / awaiting-approval state, pathway_contributor and admin are still granted by an admin
```

The old client call to `/api/auth/grant-default-role` and the admin "reject signup" route were removed. `hasAnyRole()` survives only as a guard on signed-in pages (`app/(app)/layout.tsx`) and some routes.

## The `<grid_update>` JSON contract (referenced by W1 and W3)

```json
{
  "cells": { "persona:Explore": { "density": 2, "note": "..." } },
  "meta":  { "name": "...", "sector": "...", "flowStep": 3, "hypothesis": "...", "persona": {"...": "..."}, "cubeAssessment": {"...": "..."} },
  "pathwaysReferenced": ["mahavistaar"],
  "flowStep": 3,
  "explorerAction": { "type": "analysis" },
  "pathwayAction":  { "type": "generate" }
}
```

Only one of `explorerAction` (Explorer/Analyse flow) or `pathwayAction` (Contributor flow) is ever present on a given contract, matching which system prompt built it (`lib/system-prompts.ts`). `pathwaysReferenced` is recorded into `adoption_queries.pathway_slugs` by the route. Full field reference: [`../integrations/ai-llm.md`](../integrations/ai-llm.md).
