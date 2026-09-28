# Glossary

| Term | Meaning |
|---|---|
| **Pathway** | One real AI deployment's documented journey (e.g. MahaVISTAAR, Blue Dots). Exists as a markdown document (corpus) and, for a contributor's in-progress one, a `pathways` DB row (the collaborative workspace container) |
| **Corpus** | The whole body of pathway documents the model is grounded in. Two *separate* corpora exist — see [`../integrations/ai-llm.md#two-corpora`](../integrations/ai-llm.md#two-corpora) |
| **Adoption** / **Design** | One user's conversation workspace. The UI calls it an "adoption" or "conversation"; the database table is `designs` (a legacy name predating the current terminology) |
| **Role** | One of `adopter`, `pathway_contributor`, `admin`, `general_user`. A user can hold several simultaneously (multiple rows in `user_roles`) |
| **Explorer** | A user with the `adopter` role, analysing their own AI adoption against the corpus. Entry point `/analyse` |
| **Contributor** | A user with the `pathway_contributor` role (plus an approved registration), turning their own deployment into a new corpus pathway. Entry point `/contribute` |
| **Organisation** | A shared registry row (`organisations`) — found-or-created by name at join time, deduplicated across contributors |
| **Grid** | A 4 dimensions × 4 stages matrix (16 cells) tracking how much is known about a user's adoption. Lives in `designs.grid_state` |
| **Dimension** | One of four: Persona, Solution, Institution, Ecosystem — four different questions about the same deployment, not four project phases |
| **Stage** | One of four: Explore → Define → Pilot → Scale — where a deployment is in its life |
| **Density** | How well-established a grid cell is (0–3), rendered visually as `○`/`●`/`●●`/`●●●` |
| **Sub-category** | A lettered subdivision within a dimension (4/5/7/6 respectively), each weighted Primary/Secondary/Dormant per stage |
| **Flow** | `'explorer'` or `'contributor'` — fixed on an adoption at creation (`designs.meta.flow`), decides which system prompt runs |
| **Intent** | Historical concept: was four distinct Explorer modes (browse/validate/troubleshoot/guidance); now collapses to a single `analyse` flow. Old stored values still resolve without crashing |
| **flowStep** | Which numbered step of its script the model reports being on for a given turn — persisted and re-injected every turn since the `<grid_update>` block is stripped before storage |
| **Design document** | A generated artifact stored in `design_documents`, one of three `doc_type`s: `analysis`, `plan` (Executive Summary), `draft` (pathway document) |
| **Micro-innovation** | A small practice borrowed from another adoption's lived experience — always framed as a suggested choice, never a recommendation |
| **Provenance / Source Trace appendix** | A section on each pathway document recording where its material came from — contributor-only, stripped before any adopter-facing surface |
| **Published pathway** | A `published_pathways` row — community content live in the public corpus, reachable without a redeploy |
| **Library** | `/explore` — the separate, public, no-login pathway browsing + chat surface |
| **Unit** | An individually-tagged piece of corpus knowledge (Strategic Decision, Tactical Decision, Failure and Fix, Playbook, or Toolkit Asset), each carrying a condition tag |
| **Contribution unit** | The database concept meant to represent a `unit` as a row (`contribution_units` table) — schema exists, no code writes to it (see [`technical-debt.md#td-04`](technical-debt.md#td-04)) |
| **Condition tag** | An "applies when / fails when" annotation on every corpus unit |
| **30/70 thesis** | Persona + Solution = building the right thing (30%); Institution + Ecosystem = the larger adoption work of governing, sustaining, and scaling it (70%) |
| **Assemble** | The contributor-side publish step — commits an assembled pathway document to GitHub; does not make it publicly visible on its own |
| **Publish (admin)** | The admin-side step that copies an assembled pathway's content into `published_pathways`, making it live in the corpus |

## Source files

`content/framework.md`, `lib/dimensions.ts`, `ARCHITECTURE.md` §1 (independently corroborates this glossary).
