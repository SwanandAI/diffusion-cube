# Spec: Self-serve Account Deletion, Password Visibility, Sign-out Confirmation

Status: **App code done. Migration 0033 must be run in the Supabase SQL Editor (§7)** · Updated: 2026-09-28 · Owner: TBD

This change covers three small auth/account UX items:
1. A **Show/Hide toggle** on every password field.
2. An in-app **confirmation** before signing out.
3. **Permanent self-serve account deletion**, confirmed with the account password. It removes the user's identity and all of their conversation history. Everything they have published stays live.

## 1. Goals

- A user typing a password can check what they typed before submitting.
- An accidental click on "Sign out" does not end the session.
- A signed-in user can permanently delete their account from the app, with no admin involved, after proving it's them by entering their password. Their personal data and chat history go with it. Pathways and units they published stay live and readable, with no author attached.

## 2. What changes

| Before | After this change |
|---|---|
| Password fields are always masked | Each password field has a **Show / Hide** button inside it |
| "Sign out" signs out immediately | "Sign out" opens an in-app "Sign out?" dialog (Cancel / Sign out) first |
| Only an admin could remove an account (`/api/admin/reject`, and only for pending signups) | Any signed-in user can delete their own account from the sidebar footer, after re-entering their password |
| Deleting a contributor who had published a pathway **failed** (`pathways.{assembled,published}_design_doc_id` point at their `design_documents` with no ON DELETE rule) | Migration 0033 relaxes those FKs to `ON DELETE SET NULL` |
| Deleting an admin who had ever clicked Publish **failed** (FK on `published_pathways.published_by` had no ON DELETE rule) | Migration 0033 relaxes that FK to `ON DELETE SET NULL` |
| Deleting a contributor would **cascade-delete their published `contribution_units`** | Published units are kept, and their `user_id` becomes `null` |

## 3. User flows

### 3.1 Password visibility
[components/PasswordInput.tsx](../components/PasswordInput.tsx) is a shared component. It is used for all four password inputs on [app/login/page.tsx](../app/login/page.tsx): Sign in, Sign up, and Forgot password (both the new-password and confirm-password fields). It is also used for the password field in the delete-account dialog (§3.4).

- A text button at the right edge of the input reads **Show**. Clicking it switches the field to plain text and the label to **Hide**.
- Each field toggles on its own and starts masked every time it mounts.
- The button is `type="button"`, so it never submits the form. It carries an `aria-label` ("Show password" / "Hide password") and `aria-pressed`.
- `autoComplete` values are unchanged, so password managers keep working.

### 3.2 Sign-out confirmation
[components/SignOutButton.tsx](../components/SignOutButton.tsx) opens an in-app **ConfirmDialog** (§3.3) instead of signing out immediately:
- Title "Sign out?". Body "You'll need to sign in again to get back to your conversations."
- **Sign out** (navy): signs out as before and goes to `/login`. While it runs, the label reads "Signing out…".
- **Cancel**, a click on the backdrop, or `Esc`: closes the dialog. Nothing else happens.

This applies everywhere the button is used: the sidebar footer and the "Awaiting approval" screen.

### 3.3 ConfirmDialog (shared)
[components/ConfirmDialog.tsx](../components/ConfirmDialog.tsx) is a styled replacement for the browser's `window.confirm` / `window.prompt`. It uses the same card treatment as the pathway source popup in ChatPanel: `bg-paper` card, navy/40 blurred backdrop, and DM Sans title.
- Props: `title`, body (`children`), `confirmLabel`, `danger` (coral confirm button), `confirmDisabled`, `busy`, `error`, `onConfirm`, `onCancel`.
- `Esc` and clicks on the backdrop cancel, except while `busy`.
- `role="dialog"`, `aria-modal`, and the title is linked through `aria-labelledby`.
- It renders through a **portal to `<body>`**. The sidebar's drawer uses a CSS transform, which would otherwise trap a `position: fixed` overlay inside the 230px drawer.

### 3.4 Delete account

```
Sidebar footer → "Delete account"
      │
      ▼
ConfirmDialog (danger): "Delete your account?"
  "This permanently deletes your account and all your conversation history.
   It can't be undone. Anything you've published stays live."
  Enter your password to confirm: [ •••••••• ] [Show]   [Cancel] [Delete account]
      │
      ├── Cancel / Esc / backdrop ─► dialog closes, password cleared
      ├── password empty ──────────► "Delete account" button disabled
      └── password entered → click (or Enter)
            │
            ▼
      POST /api/account/delete  { password }
            │
            ├── 403 wrong password ─► "Incorrect password." in the dialog; account untouched
            ├── 429 rate limited ───► "Too many attempts. Please wait a few minutes and try again."
            ├── other error ────────► error shown in the dialog; buttons re-enabled
            ├── network failure ────► "Network error — your account may or may not have been
            │                          deleted. Reload the page to check."; buttons re-enabled
            └── ok ─────────────────► local signOut() → /login
```

- The link is shown only to signed-in users, under the email and Sign out row in the [Sidebar](../components/Sidebar.tsx) footer. It is deliberately small and muted.
- While the request runs, the confirm button reads "Deleting…". Both buttons and the password field are disabled, and `Esc` and backdrop clicks are ignored.
- Editing the password clears any error that is showing.
- The same email can sign up again afterwards and gets a completely fresh account.

## 4. What is deleted and what is kept

Deleting the Supabase auth user triggers the existing `ON DELETE CASCADE` foreign keys.

### 4.1 Deleted permanently

| Table | Contents | How |
|---|---|---|
| `auth.users` | Login: email, password hash, auth metadata (name, organisation) | `auth.admin.deleteUser()` |
| `user_roles` | Role grants | cascade on `user_id` |
| `contributor_registrations` | Contributor registration/profile | cascade on `user_id` |
| `designs` | Every Analyse/Contribute conversation, messages included | cascade on `user_id` |
| `design_documents` | Analysis Docs, Executive Summaries, contributor drafts | cascade on `user_id` and on `design_id` |
| `adoption_queries` | Log of every message the user sent | cascade on `user_id` and on `design_id` |
| `library_conversations` | Explore chat history | cascade on `user_id` |
| `pathway_contributors` | Links between the user and pathways they contributed to | cascade on `user_id` |
| `contribution_units` where `published_at is null` | Unpublished draft units | deleted explicitly by the route |

### 4.2 Kept

| What | What happens |
|---|---|
| `published_pathways` rows | Kept, content unchanged. `published_by` stores the **admin** who clicked Publish (`app/api/admin/pathways/publish/route.ts`), not the contributor. So a contributor's deletion never changes it. It only becomes `null` when that admin deletes their own account (migration 0033) |
| `published_pathways.contributor_org` | Unchanged, so the organisation stays credited |
| `pathways` rows | Kept. `created_by` becomes `null` (already the case since migration 0020) |
| `pathways.content_cache` | Unchanged. It holds the live assembled text |
| `pathways.assembled_design_doc_id` / `published_design_doc_id` | Become `null` when the contributor's referenced draft document is deleted (migration 0033). This loses only a pointer; the text itself is in `content_cache` / `published_pathways.content` |
| `contribution_units` where `published_at is not null` | Kept. `user_id` becomes `null` |
| GitHub `content/wiki/pathways/<slug>.md` | Untouched |
| `organisations` | Untouched (not tied to a user) |

### 4.3 Out of scope (agreed)
- **Google Sheets logs** (`lib/logger.ts`) live outside the database and are not touched.
- **Supabase Auth's own audit log** (`auth.audit_log_entries`) is managed by Supabase and is not touched.
- **`pathway_contributors`** rows are deleted, not anonymised. The user no longer appears as a contributor on those pathways, but the organisation is still credited through `published_pathways.contributor_org`.

## 5. API: `POST /api/account/delete`

File: [app/api/account/delete/route.ts](../app/api/account/delete/route.ts)

**Request:** a session cookie, and the body `{ "password": "<account password>" }`.

**Steps, in order:**
1. `supabase.auth.getUser()` from the session. With no user (or no email) it returns **401**. The route only ever deletes the caller's own account, and no user id or email is accepted from the body.
2. Read `password` from the body. If it is missing, empty, not a string, or the body isn't valid JSON (including a JSON `null`), return **400** "Enter your password.".
3. **Re-verify the password** with `signInWithPassword({ email: <session user's email>, password })`. This runs on `createStatelessClient()` ([lib/supabase/server.ts](../lib/supabase/server.ts)), an anon-key client with no cookie or storage binding, so the check never overwrites the caller's session cookies.
   - `invalid_credentials` → **403** "Incorrect password.".
   - `over_request_rate_limit` → **429** "Too many attempts…". Supabase's own sign-in rate limit caps repeated guesses.
   - Any other error → **500** "Could not verify your password…", logged.
4. Service-role client: `update contribution_units set user_id = null where user_id = <me> and published_at is not null`.
   - This runs **before any delete** on purpose. Without migration 0033, `user_id` is still `NOT NULL`, so this update fails. The route then returns **500** before anything has been deleted. Without this step, `deleteUser` would silently cascade-delete the published units.
5. `delete from contribution_units where user_id = <me> and published_at is null`.
6. `auth.admin.deleteUser(<me>)`, and the cascades in §4.1 run.
7. Return `{ ok: true }`.

**Errors:** failures in steps 4–6 return `{ error: "Could not delete your account." }` with status 500 and log the detail server-side under the `[account/delete]` prefix.

If migration 0033 has not been run, `deleteUser` (step 6) fails for:
- a contributor whose draft document backs an assembled or published pathway (`pathways_*_design_doc_id_fkey`);
- an admin who has published anything (`published_pathways_published_by_fkey`).

`deleteUser` is atomic, so the account and all its rows stay intact. The only partial deletion is step 5's unpublished draft units.

**Auth:** the route is not in `PUBLIC_PATHS` in `proxy.ts`, so the middleware already requires a session. The route checks again itself. No role is required, so a pending (not yet approved) user can delete their account too.

## 6. Security notes

- **Self only.** The target is always the session user, never a request parameter, so one user cannot delete another. Admin deletion stays at `/api/admin/reject`.
- **Password re-verification.** A live session alone is not enough. An unattended or hijacked session can't delete the account without the password. The check happens server-side against Supabase Auth, and the client's own validation (non-empty field) is UX only.
- **Brute force.** Wrong guesses hit the same Supabase Auth sign-in rate limit as `/login`. The route adds no extra limit of its own.
- **Session isolation.** The verification sign-in uses a stateless client, so it neither replaces the user's cookies nor sends the service-role client's requests under a user token. The extra session it creates is removed along with the user in step 6.
- **Service role on the server only.** `createAdminClient()` is used only inside the route handler.
- **Admins can delete themselves.** An admin who deletes their account loses the `admin` role row. An `ADMIN_EMAILS` admin who signs up again with the same email is admin again through the env fallback.
- **Irreversible.** There is no soft delete and no grace period. The only recovery path is signing up again.

## 7. Database migration

[supabase/migrations/0033_account_deletion.sql](../supabase/migrations/0033_account_deletion.sql). Run it once in the Supabase SQL Editor **before** users start deleting accounts.

| FK | Before | After |
|---|---|---|
| `published_pathways.published_by → auth.users` | no action (blocks deleting a publishing admin) | `ON DELETE SET NULL` |
| `pathways.assembled_design_doc_id → design_documents` | no action (blocks deleting a contributor) | `ON DELETE SET NULL` |
| `pathways.published_design_doc_id → design_documents` | no action (blocks deleting a contributor) | `ON DELETE SET NULL` |
| `contribution_units.user_id → auth.users` | `NOT NULL`, `ON DELETE CASCADE` (wipes published units) | nullable, `ON DELETE SET NULL` |

RLS impact: `contribution_units` rows with `user_id = null` still match the "published units" select policy. No user can update them any more, because `auth.uid() = user_id` is never true. That's intended: an orphaned published unit is read-only.

## 8. Files

| File | Change |
|---|---|
| [components/PasswordInput.tsx](../components/PasswordInput.tsx) | **New.** Shared password field with Show/Hide (§3.1) |
| [app/login/page.tsx](../app/login/page.tsx) | All four password fields use `PasswordInput` |
| [components/ConfirmDialog.tsx](../components/ConfirmDialog.tsx) | **New.** Shared in-app confirm dialog (§3.3) |
| [components/SignOutButton.tsx](../components/SignOutButton.tsx) | Opens ConfirmDialog before signing out |
| [components/DeleteAccountButton.tsx](../components/DeleteAccountButton.tsx) | **New.** ConfirmDialog with a password field, then POST, sign out, redirect; handles network failure |
| [components/Sidebar.tsx](../components/Sidebar.tsx) | Footer turned into two rows (email + Sign out, then Delete account) |
| [lib/supabase/server.ts](../lib/supabase/server.ts) | New `createStatelessClient()` for the password re-check |
| [app/api/account/delete/route.ts](../app/api/account/delete/route.ts) | **New.** Deletion route (§5) |
| [supabase/migrations/0033_account_deletion.sql](../supabase/migrations/0033_account_deletion.sql) | **New.** FK changes (§7) |

## 9. Acceptance criteria

**Password visibility**
- [ ] Each of the four password fields on `/login`, and the one in the delete dialog, shows **Show**. Clicking it reveals the text and the label changes to **Hide**. Clicking again masks it.
- [ ] Clicking Show/Hide never submits the form.
- [ ] Each field toggles independently of the others.

**Sign out**
- [ ] Clicking Sign out opens the in-app dialog, not a browser popup. **Cancel**, `Esc`, or a backdrop click keeps the session. **Sign out** signs out and lands on `/login`.
- [ ] Same behaviour on the "Awaiting approval" screen.
- [ ] On mobile, with the sidebar drawer open, the dialog covers the whole screen, not just the drawer.

**Delete account**
- [ ] The "Delete account" button in the dialog stays disabled while the password field is empty. Cancelling leaves the account untouched.
- [ ] A wrong password shows "Incorrect password." inside the dialog and deletes nothing. The user stays signed in.
- [ ] A server error or a dropped connection shows an error inside the dialog, and the dialog stays usable (buttons re-enabled, closable).
- [ ] The correct password deletes the account and lands on `/login`. Signing in with the old credentials then fails.
- [ ] After deletion, no rows remain for that user id in `user_roles`, `contributor_registrations`, `designs`, `design_documents`, `adoption_queries`, `library_conversations`, `pathway_contributors`, or in unpublished `contribution_units`.
- [ ] A pathway the deleted **contributor** published is still listed in Explore, still opens, and still grounds Analyse answers. Its `published_pathways` row is unchanged, and `pathways.assembled_design_doc_id` / `published_design_doc_id` are `null`.
- [ ] When an **admin** who published a pathway deletes their account, that pathway stays live and its `published_by` becomes `null`.
- [ ] The user's published `contribution_units` still exist, with `user_id = null`.
- [ ] `POST /api/account/delete` without a session returns 401. With a session but no password (or a `null` body) it returns 400. With a wrong password it returns 403. None of these delete anything.
- [ ] Without migration 0033, deleting a contributor with a published pathway, an admin who published, or a user with published units fails with a 500 and loses **no** published data.
- [ ] Signing up again with the same email creates a fresh account with no old history.

## 10. Rollout

1. Run `0033_account_deletion.sql` in the Supabase SQL Editor.
2. Deploy the app code.
3. Smoke-test with a throwaway account: create one conversation, try a wrong password (it should be rejected), then delete with the correct password and confirm §9.
