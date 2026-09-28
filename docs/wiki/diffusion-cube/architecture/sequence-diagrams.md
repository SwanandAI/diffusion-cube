# Sequence & Workflow Diagrams

> Canonical file for both interaction sequences and business-workflow flowcharts. `business/workflows.md` links here rather than duplicating these diagrams.

## W1 — Companion chat turn (`mode: 'companion'`)

Referenced by [`business/workflows.md#w1`](../business/workflows.md#w1-companion-chat-turn).

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client hook<br/>lib/adoption-conversation.ts
    participant R as app/api/chat/route.ts
    participant M as Claude (claude-sonnet-4-6)
    participant DB as Supabase

    U->>C: types a message / uploads a file
    C->>DB: create designs row if none yet (lazy, dedup'd via creatingRef)
    C->>R: POST mode=companion + grid + meta + flow
    R->>R: re-validate flow against caller's actual role (server-side)
    R->>R: inject corpus (wiki-loader.ts) + framework.md + current progress block
    R->>M: anthropic.messages.stream(...)
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

    R--)DB: fire-and-forget — adoption_queries insert + Google Sheets log (lib/logger.ts)
```

## W2 — Contributor publishes a pathway (two-step: assemble → admin publish)

Referenced by [`business/workflows.md#w2`](../business/workflows.md#w2-contributor-publish).

```mermaid
flowchart TB
    REG["Register<br/>contributor_registrations row"] --> APR["Admin approves<br/>access_status='approved' + user_roles insert (pathway_contributor)"]
    APR --> PICK["Pick or create pathway<br/>POST /api/pathways"]
    PICK --> JOIN["Join<br/>pathway_contributors row; ensureOrganisation() finds/creates organisations row"]
    JOIN --> WS["New contribution<br/>designs row, meta.flow='contributor', meta.pathwayId set"]
    WS --> UP["Upload documents"]
    UP --> EXI["extract-insights mode<br/>silent, one-shot, seeds grid before any chat"]
    EXI --> STAGE["Chat until stage is settled<br/>(contributorSystemPrompt steps 1-2)"]
    STAGE --> GEN["model sets pathwayAction: 'generate'"]
    GEN --> DRAFT["client calls pathway-draft mode<br/>design_documents row, doc_type='draft', versioned"]
    DRAFT --> REV{"Revise via chat?"}
    REV -- "yes — pathwayAction: 'revise'" --> DRAFT
    REV -- no --> PUB1["POST /api/pathways/assemble<br/>CONTRIBUTOR PUBLISH"]

    PUB1 --> GH["Commit to GitHub<br/>content/wiki/pathways/&lt;slug&gt;.md<br/>(GITHUB_REPO / GITHUB_BRANCH)"]
    PUB1 --> CC["pathways.content_cache set<br/>pathways.review_requested = true"]

    GH -.-> LOCAL["Local content/wiki/ only changes<br/>after a git pull"]
    GH -.-> DEPLOY["If GITHUB_BRANCH = main:<br/>fires the Vercel deploy workflow"]

    CC --> PUB2["POST /api/admin/pathways/publish<br/>ADMIN PUBLISH"]
    PUB2 --> PPT[("published_pathways upsert")]
    PPT --> LIVE["Live in the corpus, instantly —<br/>no redeploy, no git pull needed"]
```

**The gotcha (step `PUB1`):** the commit goes to the *remote* GitHub repo/branch, not the local working copy — `content/wiki/` on disk only changes after a `git pull`. If `GITHUB_BRANCH=main`, that commit itself fires `.github/workflows/deploy.yml`. Use a throwaway branch when testing this flow.

**Why two steps matter:** corpus loaders (`lib/wiki-loader.ts`, `lib/wiki-content.ts`) read `published_pathways`, which step `PUB1` never writes. Contributor publish alone puts nothing in front of any user — only admin publish (`PUB2`) does.

## W3 — Explorer produces an Analysis Document

Referenced by [`business/workflows.md#w3`](../business/workflows.md#w3-explorer-analysis-document).

```mermaid
flowchart TB
    A1["/analyse → StrengthenWorkspace (fixedFlow='explorer')"] --> A2["First message or first upload<br/>→ designs row created lazily, dedup'd"]
    A2 --> A3["Upload → extract-insights (silent, 1-shot)<br/>grid seeded before any chat"]
    A3 --> A4["Chat turn → companion mode<br/>full corpus + framework injected<br/>meta re-injected each turn"]
    A4 --> A5["Response streams; grid_update parsed then stripped<br/>changed cells merged into designs.grid_state"]
    A5 --> A6{"Enough substance,<br/>or upload establishes sector+problem?"}
    A6 -- yes --> A7["explorerAction: 'analysis'"]
    A7 --> A8["Client calls analysis-doc mode<br/>design_documents row, doc_type='analysis'<br/>content-hash cached: unchanged conversation = no model call"]
    A8 --> A9["Client appends its own message carrying <analysis_doc/> marker"]
    A9 --> A10["Optionally: executive-summary mode<br/>→ stored as doc_type='plan'"]
    A6 -- no --> A4
```

Only the latest row per `(design_id, doc_type)` is ever read back for `analysis`/`plan` — a regeneration supersedes rather than branching a version the user must choose between. `draft` (pathway documents) is the one `doc_type` where every version stays browsable via the version picker in `PathwayDocumentPane.tsx`.

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

Only one of `explorerAction` (Explorer/Analyse flow) or `pathwayAction` (Contributor flow) is ever present on a given contract, matching which system prompt built it (`lib/system-prompts.ts`). Full field reference: [`../integrations/ai-llm.md`](../integrations/ai-llm.md).
