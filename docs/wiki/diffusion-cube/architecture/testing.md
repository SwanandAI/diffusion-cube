# Testing

## Current State (verified in repository)

| Attribute | Status |
|---|---|
| Unit test files (`*.test.*`, `*.spec.*`, `__tests__/`) | **Not present** — zero matches repo-wide (excluding `node_modules`, `.next`, `.git`) |
| Test runner config (`jest.config.*`, `vitest.config.*`) | **Not present** |
| E2E config (`playwright.config.*`, `cypress.*`) | **Not present** |
| `test` script in `package.json` | **Not present** — `scripts` block is only `dev`/`build`/`start`/`lint` |
| CI test job | **Not present** — `.github/workflows/deploy.yml` only builds and deploys, it does not run any test step |
| Manual verification tooling | `scripts/smtp-test.mjs` — a standalone SMTP connectivity/send diagnostic, not a test suite |
| Type checking | `tsc` runs implicitly as part of `next build` (`strict: true` in `tsconfig.json`); not run as a separate CI step |
| Lint | `npm run lint` (`eslint.config.mjs`, `eslint-config-next` core-web-vitals + typescript presets) — runnable, not confirmed wired into CI |

> **Note:** This service ships today with no automated test coverage of any kind. Correctness is currently verified through manual use of the running app and through code review — not through an automated suite. This is a real gap, not a stylistic choice: migration `0027`'s own commit message documents a period where every Contributor draft insert silently failed a database check constraint, undetected until someone noticed drafts never reaching `pathways.assembled_design_doc_id` — exactly the kind of regression an integration test would have caught immediately.

## Manual QA

`scripts/smtp-test.mjs` (33 lines) is the one executable verification tool in the repo: it loads `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM_ADDRESS` from `.env.local`, opens a nodemailer transport, calls `.verify()`, and sends one OTP-styled test email to an address given on the command line:

```bash
node --env-file=.env.local scripts/smtp-test.mjs recipient@example.com
```

It is not wired into `package.json` scripts and is not mentioned in `README.md` — its only documentation is an implicit assumption in `SIGNUP_OTP_SPEC.md`'s implementation checklist that SMTP gets verified manually before go-live.

## Recommended Setup (not yet implemented)

The following is a suggested starting point, not a description of anything currently in the repo:

- **Unit tests** for pure `lib/` modules with no I/O — `lib/dimensions.ts` (grid shape helpers), `lib/grid-update.ts` (`parseGridUpdate`/`stripGridUpdate`), `lib/pathway-gaps.ts` (gap-list regex extraction), `lib/strip-frontmatter.ts`, `lib/adoption-plan-markdown.ts`'s parser — these are deterministic string/JSON transforms, the cheapest and highest-value place to start.
- **Integration tests** for `app/api/*/route.ts` handlers against a local/test Supabase project (or a mocked Supabase client) — would directly cover the class of bug migration `0027` fixed after the fact.
- **A CI test job** in `.github/workflows/deploy.yml` (or a new workflow) gating the Vercel deploy on `npm run lint` and any new test script passing.
- Framework choice is unconstrained by anything currently in the repo (no existing test tooling to be consistent with) — Vitest or Jest are both compatible with this Next.js/TypeScript setup.

## Related documentation

[`architecture/architecture-overview.md`](architecture-overview.md) alternative-approaches table (row **D**) ties this gap to the migration-0027 incident as its motivating evidence. [`knowledge/technical-debt.md`](../knowledge/technical-debt.md#td-03) carries this as a tracked debt item.
