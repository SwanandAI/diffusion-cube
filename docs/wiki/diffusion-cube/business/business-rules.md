# Business Rules

All rules below trace to `content/framework.md`, `lib/system-prompts.ts`, `lib/dimensions.ts`, or the specific route/migration named.

## Matching and presentation

| Rule | Source | Enforcement |
|---|---|---|
| "Relevant" means same sector **and** same use-case category — one test, applied everywhere | `content/framework.md`; `lib/system-prompts.ts`'s shared rules | Prompt-level instruction, not code-enforced |
| An exact match is presented directly; an adjacent match (e.g. asked "healthcare," corpus has "public health") is presented with the mismatch stated in the same breath | `lib/system-prompts.ts` | Prompt-level instruction |
| Micro-innovations are always framed as suggested choices, never recommendations | `content/framework.md` | Prompt-level instruction |
| Absence is stated plainly, never softened or backfilled with general knowledge; pathway absence and micro-innovation absence are reported as two separate absences | `content/framework.md` | Prompt-level instruction |

## Grid / density rules

| Rule | Source | Enforcement |
|---|---|---|
| `designs.meta.stage` is only ever set from the user's own statement, never assigned by the model | `ARCHITECTURE.md`, confirmed against `lib/system-prompts.ts` | Prompt-level instruction |
| Only *changed* cells are reported in `<grid_update>`; the client merges rather than replaces | `lib/adoption-conversation.ts` | Code-enforced (merge logic) |
| A generic, non-pathway-engaging turn populates nothing in the grid, however useful the reply | `lib/system-prompts.ts` | Prompt-level instruction |
| Each sub-category is weighted Primary/Secondary/Dormant **per stage**, not fixed — e.g. *Performance, Reliability and Scale* is dormant at Explore, primary at Pilot | `lib/dimensions.ts` | Data-encoded (`SubCategory.weights`) |
| Density 0 means "not yet established," never "failed" — unsettled items are framed as a question or decision, never a deficiency | `content/framework.md` | Prompt-level instruction |

## Provenance and framework-naming rules

| Rule | Source | Enforcement |
|---|---|---|
| The Provenance/Source Trace appendix is contributor-only — never surfaced in any adopter-facing response | `content/framework.md`, `lib/wiki-content.ts` (`stripProvenanceAppendix`) | Code-enforced for `/wiki` display; prompt-level for chat |
| The framework itself is never named as a process in user-facing prose (no sub-category codes, densities, unit-type labels); the four dimension and four stage names are public vocabulary | `content/framework.md` | Prompt-level instruction |

## Process control (publishing)

| Rule | Source | Enforcement |
|---|---|---|
| Contributor "assemble" (commit to GitHub) and admin "publish" (copy to `published_pathways`) are two independently-gated actions | `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts` | Code-enforced (separate routes, separate role requirements) |
| A pathway insert requires the `pathway_contributor` role, checked at the database layer via an `exists` subquery on `user_roles`, not just application code | `supabase/migrations/0020_pathways.sql` | RLS-enforced |
| An organisation's `url` is set only on first creation and never overwritten by a later contributor's registration for the same org | `lib/organisations.ts` (`ensureOrganisation`) | Code-enforced |
| `published_pathways` re-publish keeps the same slug/URL, upserted by a stable key | `app/api/admin/pathways/publish/route.ts` (`onConflict: 'slug'`) | Code-enforced |

## Data quality / de-duplication

| Rule | Source | Enforcement |
|---|---|---|
| A new pathway's title is checked against existing pathways for likely duplication via a forced-tool-use LLM call before creation is allowed to proceed as a fresh pathway | `app/api/pathways/check-similar/route.ts` | Best-effort — Anthropic call failures are swallowed to "no match found," so this is advisory, not a hard gate |
| Pathway slugs are uniqued against collisions by looping a numeric suffix | `app/api/pathways/route.ts` (`uniqueSlug`) | Code-enforced |
| `content/wiki/pathways/index.md` is the sole discovery path for the grounding corpus and the `/wiki` browse listing — a file present on disk but not linked from the index is excluded from both, even though it remains reachable directly at `/wiki/<slug>` | `lib/wiki-loader.ts`, `lib/wiki-content.ts` | Code-enforced (by omission — this is a real gap: 6 files are currently on-disk but unlinked, see [`../knowledge/technical-debt.md`](../knowledge/technical-debt.md)) |

## Monitoring rule

Every companion-mode user message is logged (fire-and-forget) to `adoption_queries`, tagged with the pathway slugs the response actually drew on — recorded for future cross-adoption insight gathering, but nothing currently reads this table back. See [`../integrations/async-processing.md`](../integrations/async-processing.md).

## Product Non-Rules (raw docs state rules the code does not enforce)

- `CLAUDE.md` states the Explorer flow "never sets an agenda outside [the chosen] flow, never switches intent without asking first" — moot today, since there is only one flow (`ANALYSE_FLOW`) and no intent choice is presented to switch away from.
- `SIGNUP_APPROVAL_OPTIONS.md` implies every signup requires manual admin sign-off before any access — not enforced; `adopter` access is automatic.

## Source files

`content/framework.md`, `lib/dimensions.ts`, `lib/system-prompts.ts`, `lib/organisations.ts`, `app/api/pathways/route.ts`, `app/api/pathways/check-similar/route.ts`, `supabase/migrations/0020_pathways.sql`.
