# Business Workflows

Workflow narrative and IDs only — diagrams live in [`../architecture/sequence-diagrams.md`](../architecture/sequence-diagrams.md); this page links to them rather than duplicating Mermaid blocks.

## W1 — Companion chat turn

**Trigger**: any message sent or file uploaded inside an `/analyse` or `/contribute` conversation.
**Endpoint**: `POST /api/chat` with `mode: 'companion'`.
**Diagram**: [`sequence-diagrams.md#w1`](../architecture/sequence-diagrams.md#w1--companion-chat-turn-mode-companion).

1. The client hook (`lib/adoption-conversation.ts`) lazily creates a `designs` row if this is the first message or first upload for the conversation (dedup'd against concurrent attempts).
2. The route re-validates the caller's role against `flow` server-side, then injects the relevant corpus + framework + the conversation's current `meta`/`grid` state.
3. Claude streams a response ending in a `<grid_update>` JSON block.
4. The client parses and strips the block, merges changed cells into `grid_state`, and persists `meta`.
5. If the block signals `explorerAction` or `pathwayAction`, a second API call is made automatically (see W2/W3) and a client-constructed message with a document card is appended.

## W2 — Contributor publish

**Trigger**: a Contributor's conversation reaches a settled stage, generates a draft, and the contributor chooses to publish.
**Endpoints**: `POST /api/pathways/assemble` (contributor step), `POST /api/admin/pathways/publish` (admin step).
**Diagram**: [`sequence-diagrams.md#w2`](../architecture/sequence-diagrams.md#w2--contributor-publishes-a-pathway-two-step-assemble--admin-publish).

Two independently-gated steps, not one:

1. **Assemble** (contributor-triggered): commits the latest `design_documents` draft verbatim to `content/wiki/pathways/<slug>.md` on the configured GitHub branch, and sets `pathways.content_cache` + `review_requested = true`. This does **not** make the pathway visible to anyone else.
2. **Publish** (admin-triggered, from `AdminPathwaysPanel`): copies `pathways.content_cache` into the `published_pathways` table, which is the only place any corpus-loading code (`lib/wiki-loader.ts`, `lib/wiki-content.ts`, `lib/library-wiki-loader.ts`) actually reads community content from. This step is what makes a pathway live, instantly, with no redeploy.

> **Note:** `CLAUDE.md` describes the Contributor's own "Publish" button as genuinely self-serve with no separate admin approval step. That description no longer matches the code: the database table it relied on (`pathway_submissions`) was dropped in migration `0018`, and the current architecture requires the separate admin publish step described above. The routes matching `CLAUDE.md`'s description (`app/api/pathway-submissions/push/route.ts` and both `app/api/admin/pathway-submissions/*` routes) still exist in the repository but reference the dropped table and would error if invoked — see [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01).

## W3 — Explorer analysis document

**Trigger**: the companion judges there is enough conversational substance (or an upload establishes sector + problem immediately).
**Endpoint**: `POST /api/chat` with `mode: 'analysis-doc'`, then optionally `mode: 'executive-summary'`.
**Diagram**: [`sequence-diagrams.md#w3`](../architecture/sequence-diagrams.md#w3--explorer-produces-an-analysis-document).

1. The companion sets `explorerAction: "analysis"` in its `<grid_update>` block.
2. The client calls `analysis-doc` mode; the result is stored in `design_documents` (`doc_type='analysis'`), content-hash cached so an unchanged conversation is served without a new model call.
3. A client-constructed chat message with an `<analysis_doc/>` card is appended, reopening the stored document.
4. The Executive Summary (`doc_type='plan'`) can be generated afterward as a smaller, explicitly distinct second document.

## W4 — Signup and access

**Trigger**: a new visitor signs up.
**Endpoints**: Supabase `auth.signUp` (client SDK) → `POST /api/auth/grant-default-role` → (admin action later) `POST /api/admin/roles` or `POST /api/admin/contributor-registrations/approve`.

1. Two-step signup form on `/login`: details, then a 6-digit email OTP (`verifyOtp`), resendable after a 60-second cooldown.
2. On successful verification, the client immediately calls `grant-default-role`, which inserts the `adopter` role (idempotent — a duplicate-insert Postgres error is treated as success).
3. `/analyse` works immediately. `/contribute` additionally requires the one-time registration form (`ContributorRegistrationGate.tsx`) and an admin's approval.

## Batch/lifecycle status

There is no batch-processing concept in this application. The closest analog — a pathway's lifecycle — moves through these states, tracked across two tables:

```
pathways.review_requested: false → true (on contributor assemble)
                                 → false (on admin publish, alongside setting published_design_doc_id)
```

Comparing `pathways.assembled_design_doc_id` to `pathways.published_design_doc_id` tells you whether the live, published copy is stale relative to the latest assembled draft.

## Planned Workflows (Roadmap — not yet implemented)

Source: `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`. Listed here as named future workflows so they aren't confused with W1–W4 above, none of which they currently extend or modify.

- **W5 — Contributor reuse/incentive loop.** A contributor would see how much their pathway has been reused and get insights from the questions other users asked about it. This is the intended consumer of `adoption_queries` (currently write-only — see [`business-rules.md#monitoring-rule`](business-rules.md#monitoring-rule)) and would need a new read/aggregation surface that doesn't exist today.
- **W6 — Pathway curation lifecycle.** Beyond the current publish path (W2), the charter's "Contribute & Curate Pathways" scope includes ongoing ingestion/curation workflows, continuous updates to existing pathway knowledge, and **removing** a published pathway when needed — none of which have an unpublish/removal mechanism in current code (see [`business-overview.md#non-scope`](business-overview.md#non-scope)).
- **W7 — Guided Adopter-to-Contributor transition.** Surfacing the option to contribute at the point an adopter's own analysis conversation shows real maturity, without a hard mode switch — contrasted with today's hard, entry-point-fixed `flow` in [`users-and-personas.md#planned-vs-current-adoptercontributor-relationship`](users-and-personas.md#planned-vs-current-adoptercontributor-relationship).

## Where raw product docs describe steps not implemented

`SIGNUP_APPROVAL_OPTIONS.md` describes an email-link-based admin approval flow for *every* new signup (Option 1), with roles set by hand in the Supabase Table Editor — this predates and was superseded by the current self-serve-OTP-plus-checkbox-dashboard flow described in W4 above. `CLAUDE.md`'s Contributor-flow description assumes single-step self-serve publish (no separate admin gate) — superseded by the two-step process in W2. The Product Charter's planned workflows above (W5–W7) describe genuinely future work, not a stale description of something already built.

## Source files

`lib/adoption-conversation.ts`, `app/api/chat/route.ts`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `app/login/page.tsx`, `app/api/auth/grant-default-role/route.ts`, `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
