# Component Diagram

## System context

```mermaid
flowchart TB
    subgraph Client["Browser"]
        EX["/explore — Diffusion Library<br/>public, no login"]
        AN["/analyse — Explorer<br/>needs adopter role"]
        CO["/contribute — Contributor<br/>needs pathway_contributor + registration"]
        ADM["/admin<br/>needs admin role or ADMIN_EMAILS"]
    end

    PROXY["proxy.ts — Next.js middleware<br/>session gate; public: /login /explore /analyse /navigate /contribute /api/chat /api/wiki-pathways /api/auth/send-email"]
    CHAT["app/api/chat/route.ts<br/>8 modes, streamed, role re-validated server-side"]
    CLAUDE["Anthropic API<br/>claude-sonnet-4-6"]
    GH["GitHub Contents API<br/>lib/github.ts"]

    subgraph Corpus["content/ (static, in-repo)"]
        LIBF["library-wiki/pathways/<br/>8 docs — Library corpus"]
        WIKIF["wiki/pathways/<br/>12 docs + index.md — grounding corpus"]
        FW["framework.md — question bank + weights"]
    end

    subgraph DB["Supabase Postgres"]
        ROLES[("user_roles")]
        DESIGNS[("designs")]
        DOCS[("design_documents")]
        PATHW[("pathways + pathway_contributors + organisations")]
        PUB[("published_pathways — public read")]
        LIBCONV[("library_conversations")]
    end

    SMTP["SMTP server<br/>lib/email.ts"]
    SHEETS["Google Sheets<br/>lib/logger.ts"]

    EX --> PROXY
    AN --> PROXY
    CO --> PROXY
    ADM --> PROXY
    PROXY --> CHAT
    PROXY -.role check.-> ROLES

    CHAT -- "mode=library" --> LIBF
    CHAT -- "all other modes" --> WIKIF
    CHAT --> FW
    LIBF --> CLAUDE
    WIKIF --> CLAUDE
    FW --> CLAUDE
    PUB -- "merged into both corpora" --> CLAUDE

    CLAUDE -- "stream + trailing grid_update" --> CHAT
    CHAT --> DESIGNS
    CHAT --> DOCS
    CHAT -.fire-and-forget.-> SHEETS
    EX --> LIBCONV
    CO --> PATHW
    PATHW -- "contributor assemble" --> GH
    PATHW -- "admin publish" --> PUB

    ADM --> ROLES
    ADM --> PATHW

    AuthHook["Supabase Auth Hook<br/>signed HMAC POST"] --> SendEmail["app/api/auth/send-email/route.ts"]
    SendEmail --> SMTP
```

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
        WORK["AdoptionWorkspace.tsx<br/>shared chat workspace (~1020 lines)"]
        HOOK["lib/adoption-conversation.ts<br/>useAdoptionConversation hook"]
        CHATP["ChatPanel.tsx"]
        GRID["HeatmapGrid.tsx"]
        DOC["PathwayDocumentPane.tsx / AdoptionPlanModal.tsx"]
        LIBUI["ExploreLibrary.tsx<br/>independent chat UI, own markdown renderer"]
        ADMINUI["AdminDashboard.tsx / AdminPathwaysPanel.tsx / AdminContributorRegistrationsPanel.tsx"]
    end

    subgraph LibCore["lib/ core modules"]
        SP["system-prompts.ts"]
        WL["wiki-loader.ts"]
        LWL["library-wiki-loader.ts"]
        WC["wiki-content.ts"]
        DIM["dimensions.ts"]
        GU["grid-update.ts"]
        ROLES["roles.ts"]
        GH2["github.ts"]
        DD["design-documents.ts"]
    end

    P2 --> WORK
    P3 --> WORK
    P5 --> WORK
    WORK --> HOOK
    WORK --> CHATP
    WORK --> GRID
    WORK --> DOC
    HOOK --> GU
    HOOK --> DD
    P1 --> LIBUI

    P4 --> ADMINUI

    HOOK -.API call.-> CHATAPI["app/api/chat/route.ts"]
    CHATAPI --> SP
    SP --> WL
    SP --> LWL
    CHATAPI --> ROLES
    ADMINUI -.API call.-> ADMINAPI["app/api/admin/*/route.ts"]
    ADMINAPI --> GH2
    P1 --> WC
```

**Notes on this diagram:**
- `AppShell.tsx` (Sidebar + content column) is the shared chrome for `/explore`, `/analyse`, `/contribute`, and the `(app)` route group — each builds its own instance rather than there being one central authenticated layout. `SiteHeader.tsx` survives only as the header on the "awaiting approval" screen in `app/(app)/layout.tsx`.
- `ExploreLibrary.tsx` deliberately does not reuse `ChatPanel.tsx` — it has its own markdown renderer, its own textarea, its own send button. This is a real duplication, not an oversight — the Library was ported verbatim from a separate standalone app (see [`knowledge/technical-debt.md`](../knowledge/technical-debt.md)).

## Three-deep enforcement (not a diagram duplicate — this is the access-control shape, cross-linked from business pages)

```mermaid
flowchart LR
    A["proxy.ts<br/>is there a session?"] --> B["page.tsx<br/>role check — UX only"] --> C["API route<br/>REAL enforcement"]
```

See [`business/users-and-personas.md`](../business/users-and-personas.md) for the full access-tier walkthrough this diagram supports.
