# Component Diagram

> **Updated 2026-11-06.** Pathways now live only in Supabase (migration `0042`); `content/` holds just the framework, the generation prompt, resources and legal text. GitHub is no longer a runtime dependency (`lib/github.ts` removed). Grounding is retrieved per message through a Haiku classifier, the `embed` Edge Function and `match_pathway_units`.

## System context

```mermaid
flowchart TB
    subgraph Client["Browser"]
        EX["/explore — Diffusion Library<br/>public, no login"]
        AN["/analyse — Explorer<br/>needs adopter role (every account has it)"]
        CO["/contribute — Contributor<br/>needs pathway_contributor + registration"]
        ADM["/admin<br/>needs admin role or ADMIN_EMAILS"]
    end

    PROXY["proxy.ts — Next.js middleware<br/>session gate; public: /login /explore /analyse /navigate /contribute /terms /privacy<br/>/api/chat /api/wiki-pathways /api/toolkit-assets /api/auth/send-email /api/errors/client"]
    CHAT["app/api/chat/route.ts<br/>7 modes; rate limit, size caps,<br/>requiredRole(mode, flow) enforced server-side"]
    RET["lib/retrieval.ts<br/>classify → hybrid search → shape"]
    SONNET["Anthropic API<br/>claude-sonnet-4-6 (answers, documents,<br/>check-similar, seeding)"]
    HAIKU["Anthropic API<br/>claude-haiku-5-5 (query classifier)"]
    EMBED["Supabase Edge Function embed<br/>gte-small, 384-dim, service role only"]

    subgraph Static["content/ (static, in-repo)"]
        FW["framework.md — question bank + weights"]
        GP["pathway-generation-prompt.md"]
        RES["resources.md"]
    end

    subgraph DB["Supabase Postgres"]
        ROLES[("user_roles<br/>+ trigger: adopter at signup")]
        DESIGNS[("designs")]
        DOCS[("design_documents")]
        PATHW[("pathways (status, published_version_id)<br/>+ pathway_contributors + organisations")]
        VERS[("pathway_versions")]
        UNITS[("pathway_units<br/>fts + vector(384), HNSW")]
        SRC[("pathway_sources + pathway_source_chunks<br/>seeded pathways only")]
        PUB[("published_pathways — VIEW, public read")]
        CU[("contribution_units<br/>toolkit assets")]
        LIBCONV[("library_conversations")]
        RPC["match_pathway_units / match_source_chunks<br/>service_role only"]
    end

    subgraph Storage["Supabase Storage (private)"]
        BTA["toolkit-assets bucket"]
        BPS["pathway-sources bucket"]
    end

    SMTP["SMTP server<br/>lib/email.ts"]
    MON["sys_errors + ai_usage + rate_limits<br/>lib/errors.ts, lib/ai-usage.ts, lib/rate-limit.ts"]
    SEED["scripts/seed-pathways.ts<br/>(operator, one-time per project)"]

    EX --> PROXY
    AN --> PROXY
    CO --> PROXY
    ADM --> PROXY
    PROXY --> CHAT

    CHAT --> FW
    CHAT --> GP
    CHAT --> RES
    CHAT --> RET
    RET --> HAIKU
    RET --> EMBED
    RET --> RPC
    RPC --> UNITS
    RPC --> SRC
    RET --> PUB
    CHAT -- "library: one document / overview" --> PUB
    PUB -.view over.-> PATHW
    PUB -.view over.-> VERS
    CHAT --> SONNET
    SONNET -- "stream + trailing grid_update" --> CHAT
    CHAT --> DESIGNS
    CHAT -.after().-> MON

    EX --> LIBCONV
    CO --> PATHW
    CO -- "Send for Review (assemble)" --> VERS
    CO --> CU
    CU --> BTA
    ADM -- "publish: publishVersion()" --> PATHW
    ADM -- "re-index units" --> UNITS
    UNITS -. "embed on publish" .-> EMBED
    ADM --> ROLES

    SEED --> SONNET
    SEED --> EMBED
    SEED --> BPS
    SEED --> SRC
    SEED --> VERS

    AuthHook["Supabase Auth Hook<br/>signed HMAC POST"] --> SendEmail["app/api/auth/send-email/route.ts"]
    SendEmail --> SMTP
```

`DESIGNS`/`DOCS` writes after a model turn are made by the browser's client hook, not by the route — see [`coding-patterns.md`](coding-patterns.md#the-model-never-writes-to-the-database). The chat route itself writes only `adoption_queries`, `ai_usage` and `sys_errors`.

## Internal components (application layer)

```mermaid
flowchart TB
    subgraph Pages["Server components (data-loading pages)"]
        P1["app/explore/page.tsx"]
        P2["app/analyse/page.tsx"]
        P3["app/contribute/page.tsx"]
        P4["app/admin/page.tsx"]
        P5["app/(app)/layout.tsx + adoptions, wiki pages"]
    end

    subgraph ClientComponents["Client components"]
        WORK["AdoptionWorkspace.tsx<br/>shared chat workspace"]
        HOOK["lib/adoption-conversation.ts<br/>useAdoptionConversation hook"]
        CHATP["ChatPanel.tsx"]
        GRID["HeatmapGrid.tsx"]
        DOC["PathwayDocumentPane.tsx / AdoptionPlanModal.tsx"]
        TAUI["ToolkitAsset* / ResourceReviewCard /<br/>AssetShareCard / ReusableAssetsPanel"]
        LIBUI["ExploreLibrary.tsx<br/>independent chat UI, own markdown renderer"]
        ADMINUI["AdminDashboard.tsx / AdminPathwaysPanel.tsx (status filter, draft badges)<br/>AdminPathwayRowCard.tsx / AdminContributorRegistrationsPanel.tsx / Select.tsx"]
    end

    subgraph LibCore["lib/ core modules"]
        SP["system-prompts.ts"]
        RT["retrieval.ts"]
        EM["embeddings.ts"]
        PST["pathway-store.ts"]
        PU["pathway-units.ts"]
        PROV["provenance.ts"]
        WL["wiki-loader.ts<br/>(framework / prompt / resources only)"]
        WC["wiki-content.ts"]
        DIM["dimensions.ts"]
        GU["grid-update.ts"]
        ROLESL["roles.ts"]
        RL["rate-limit.ts"]
        DD["design-documents.ts"]
        TA["toolkit-assets.ts / toolkit-assets-server.ts"]
        SEEDL["seed.ts (pure helpers)"]
    end

    P2 --> WORK
    P3 --> WORK
    P5 --> WORK
    WORK --> HOOK
    WORK --> CHATP
    WORK --> GRID
    WORK --> DOC
    WORK --> TAUI
    HOOK --> GU
    HOOK --> DD
    P1 --> LIBUI
    P1 --> PST
    P4 --> ADMINUI

    HOOK -.API call.-> CHATAPI["app/api/chat/route.ts"]
    CHATAPI --> SP
    CHATAPI --> WL
    CHATAPI --> RT
    CHATAPI --> PST
    CHATAPI --> ROLESL
    CHATAPI --> RL
    RT --> EM
    RT --> PST
    PST --> PU
    PST --> EM
    PST --> PROV
    WC --> PST
    TAUI -.API call.-> TAAPI["app/api/toolkit-assets/*"]
    TAAPI --> TA
    ADMINUI -.API call.-> ADMINAPI["app/api/admin/pathways/{publish,delete,document}"]
    ADMINAPI --> PST
    ASSEMBLE["app/api/pathways/assemble"] --> PST
    ASSEMBLE --> TA
    SEEDS["scripts/seed-pathways.ts"] --> SEEDL
    SEEDS --> PST
```

**Notes on this diagram:**
- `lib/pathway-store.ts` is the single place pathways are saved (`saveVersion`), published (`publishVersion`) and read (`listPublished`, `getPublishedDocument(s)`, `buildOverview`, `adopterDocument`). It runs with the service role; callers check who may call. `lib/library-documents.ts`, `lib/library-pathways.ts` and `lib/github.ts` were removed.
- `AppShell.tsx` (Sidebar + content column) is the shared chrome for `/explore`, `/analyse`, `/contribute`, and the `(app)` route group — each builds its own instance rather than there being one central authenticated layout. `SiteHeader.tsx` survives only as the header on the zero-roles guard screen in `app/(app)/layout.tsx` (no longer reachable in normal use, since every account gets `adopter` at signup).
- `ExploreLibrary.tsx` deliberately does not reuse `ChatPanel.tsx` — it has its own markdown renderer, its own textarea, its own send button (the Library was ported from a separate standalone app; see [`knowledge/technical-debt.md`](../knowledge/technical-debt.md)).

## Three-deep enforcement (not a diagram duplicate — this is the access-control shape, cross-linked from business pages)

```mermaid
flowchart LR
    A["proxy.ts<br/>is there a session?"] --> B["page.tsx<br/>role check — UX only"] --> C["API route<br/>REAL enforcement<br/>(chat: requiredRole(mode, flow))"] --> D["Postgres RLS<br/>e.g. 0040: pathways visible only to<br/>their contributors + admins"]
```

See [`business/users-and-personas.md`](../business/users-and-personas.md) for the full access-tier walkthrough this diagram supports.
