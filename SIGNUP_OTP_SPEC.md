# Spec: Email OTP Verification at Sign-up (Supabase + nodemailer)

Status: **App code done. SMTP account + Supabase setup pending (§11)** · Updated: 2026-09-24 · Owner: TBD

**Decision (2026-09-24):**
- Supabase Auth owns the OTPs: it generates, stores, expires, rate-limits and verifies every code.
- **nodemailer** delivers the emails, over SMTP, to any provider we choose.
- **No AWS SES**, and no AWS email dependency of any kind.

Supabase hands each email to our app through its **Send Email Auth Hook**, and our app sends it with nodemailer.

## 1. Goal

A new account can only be created once the person proves they own the email address. After filling in the sign-up form, the user gets a one-time code (OTP) by email and types it into the same form. A correct code completes registration and signs them in. A wrong or expired code shows a clear error and lets them try again. If the email never arrives, they can ask for a new one.

## 2. Current state (what changes)

| Before | After this change |
|---|---|
| `supabase.auth.signUp()` with **"Confirm email" disabled** in Supabase, so the account is live straight away | "Confirm email" **enabled**. `signUp()` creates an *unconfirmed* user and sends an OTP. The account only becomes usable after `verifyOtp()` |
| [app/login/page.tsx](app/login/page.tsx) calls `/api/auth/grant-default-role` right after `signUp()` | That call moves to **after a successful `verifyOtp()`**, because before that there is no session and the route would return 401 ([route.ts](app/api/auth/grant-default-role/route.ts)) |
| Sign-up is one screen | Sign-up is two steps on the same `/login` page: **Details → Verify code** |
| No outbound email in production (Supabase's built-in sender is for development only and heavily rate-limited) | Every auth email (sign-up code, password reset, …) goes out through **nodemailer**, via the Send Email hook |

## 3. User flow

```
[Details form] --submit--> signUp() --ok--> [Verify step: "We sent a 6-digit code to x@y.com"]
                               |                     |           |              |
                        error shown inline     correct code   wrong/expired   "Resend code"
                                                     |           |           (after 60s cooldown)
                                            verifyOtp() → session  error shown,      |
                                            grant adopter role     input cleared,  resend() → new code,
                                            → /explore             user retries    old code stops working
```

### 3.1 Step 1: Details
Same fields as before: Name, Email, Organisation, Password. On submit:

```ts
const { data, error } = await supabase.auth.signUp({
  email, password,
  options: { data: { name, organization } },
});
```

- `error`: show inline and stay on Details (e.g. weak password, rate limit, or the email failing to send).
- `data.user && data.user.identities?.length === 0`: the email **already belongs to a confirmed account**. With confirmation on, Supabase returns a masked success and sends no email. Show: *"An account with this email already exists. Sign in instead."* and switch to Sign in mode. (See open question Q3.)
- Otherwise: go to Step 2.

### 3.2 Step 2: Verify code
UI:
- Heading "Check your email", plus the line *"We sent a 6-digit code to **{email}**. It expires in 10 minutes."*
- A single code input: `inputMode="numeric"`, `autoComplete="one-time-code"`, `pattern="[0-9]*"`. Pasting works. Spaces and dashes are stripped. The form submits automatically once 6 digits are entered.
- A **Verify** button.
- **Resend code**, disabled with a countdown ("Resend code in 42s") for 60s after each send.
- **Use a different email**, which goes back to Step 1 with the fields still filled in.
- A hint: *"Can't find it? Check your spam or promotions folder."*

On submit:

```ts
const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
if (!error && data.session) {
  await fetch('/api/auth/grant-default-role', { method: 'POST' }).catch(() => {});
  router.replace('/explore');
  router.refresh();
}
```

### 3.3 Resend

```ts
const { error } = await supabase.auth.resend({ type: 'signup', email });
```

- Restarts the 60s countdown and shows *"New code sent. Use the latest one."*
- Supabase replaces the stored token, so **the previous code stops working**. The copy must say so.
- If Supabase returns a rate-limit error (`over_email_send_rate_limit`, 429), show *"Please wait a moment before requesting another code."* and keep the countdown running.

### 3.4 Resuming an abandoned sign-up
If someone closes the tab before verifying and later tries to **sign in**, `signInWithPassword()` returns error code `email_not_confirmed`. Handle it by:
1. Switching to the Verify step for that email.
2. Calling `resend({ type: 'signup', email })` automatically.
3. Showing *"Your email isn't verified yet. We've sent you a new code."*

If they run **sign-up** again with the same unconfirmed email, Supabase sends a fresh code, which the normal flow already handles.

### 3.5 Forgot password (code-based)
Sign in → **Forgot password?** leads to three steps on the same `/login` page:

1. **Email:** `supabase.auth.resetPasswordForEmail(email)`, with no `redirectTo` because no link is sent. Supabase answers the same whether or not the account exists, so the UI always moves on and says *"If an account exists for {email}, we've sent it a 6-digit code"*. This avoids revealing which emails have accounts.
2. **Code:** the same code screen as sign-up, with the same errors (§4), the 60s resend cooldown and "Use a different email". Checked with `verifyOtp({ email, token, type: 'recovery' })`, which signs the user in. **Resend** calls `resetPasswordForEmail` again, because `auth.resend()` doesn't support recovery.
3. **New password:** new password plus confirmation, at least 6 characters and matching, then `updateUser({ password })`. Then redirect to `next` (default `/`). Reusing the current password shows *"Choose a password different from your current one."*

Refreshing the page on step 3 leaves the user signed in (the code already proved ownership) but skips setting a new password. That's acceptable, and they can run Forgot password again.

## 4. Error messages

Supabase returns the **same error for a wrong code and an expired code** (`otp_expired`, "Token has expired or is invalid"), so the UI cannot tell them apart and should not try to.

| Situation | Supabase signal | Message shown | Behaviour |
|---|---|---|---|
| Wrong or expired code | `error.code === 'otp_expired'` (403) | "That code is incorrect or has expired. Check it and try again, or request a new code." | Clear the input, focus it, stay on Verify |
| Fewer than 6 digits | client-side check | "Enter the 6-digit code from your email." | No request sent |
| Too many verify attempts | 429 / `over_request_rate_limit` | "Too many attempts. Please wait a few minutes, then request a new code." | Stay on Verify |
| After **5** consecutive wrong codes | client-side counter | (append) "Still not working? Request a new code below." | Highlight Resend |
| Resend too soon | `over_email_send_rate_limit` (429) | "Please wait a moment before requesting another code." | Keep countdown |
| Email couldn't be sent (SMTP down or misconfigured) | hook returns 500, surfaced as the `signUp`/`resend` error | "We couldn't send the email. Please try again in a moment." | Stay on the current step |
| Network or unknown | anything else | "Something went wrong. Please try again." | Stay on the current step |

The verification is correct as soon as `verifyOtp` returns a session. If the role grant fails afterwards, that is non-fatal and handled the same way as before (see §7).

## 5. How email delivery works

```
Browser (login page)            Supabase Auth                         Our app (EC2)                     SMTP server
────────────────────            ─────────────                         ─────────────                     ───────────
signUp() / resend() ─────────▶  creates the 6-digit OTP,
                                stores it (hashed), starts expiry
                                        │
                                        │ POST (Standard Webhooks signature)
                                        └──────────────────────────▶  /api/auth/send-email
                                                                      verifies signature,
                                                                      renders template (lib/email.ts)
                                                                      nodemailer.sendMail() ──────────▶ delivers to inbox
                                ◀──────── 200 {} (or error) ─────────┘
verifyOtp(code) ─────────────▶  checks code, expiry, single use
                ◀── session ──  marks email confirmed
```

- **Supabase** does all the security-sensitive work: code generation, hashing, expiry, single use, rate limits and verification.
- **The app** only delivers. [app/api/auth/send-email/route.ts](app/api/auth/send-email/route.ts) verifies Supabase's HMAC-SHA256 signature (5-minute replay window) and then calls a sender in [lib/email.ts](lib/email.ts).
- **nodemailer** connects to whatever `SMTP_*` points at. There is no provider-specific code, so switching providers means changing environment variables only.

What the hook sends for each auth email type:

| Auth email | Hook behaviour |
|---|---|
| `signup` (sign-up + resend) | 6-digit code, no link (so a mail scanner pre-fetching links can't consume it) |
| `recovery` (Forgot password) | 6-digit code, no link (see §3.5). The old link-based `/login/reset-password` page has been removed |
| `invite`, `magiclink` | Link email (not used by the app today, but covered in case an admin sends one from the Supabase dashboard) |
| `reauthentication` | Code only |
| `email_change` | **Rejected** with an error: the app has no email-change flow, so we refuse rather than risk sending a wrong link |

Timing: Supabase waits about **5 seconds** for the hook to reply. The nodemailer transport is pooled, so it keeps a warm connection, and has 3–4 second timeouts. A slow or unreachable SMTP server therefore fails cleanly with the message in §4 instead of hanging.

## 6. Choosing the SMTP server for nodemailer

nodemailer is a library, not a mail service: it needs an SMTP account to send through. Any of these works with **zero code changes**:

| Option | Settings (typical) | Good for | Watch out for |
|---|---|---|---|
| **Google Workspace mailbox** (e.g. `no-reply@<domain>`) | `smtp.gmail.com`, port 587, user = the mailbox, pass = a **16-character app password** (the mailbox must have 2-Step Verification on) | Quickest if the domain already uses Workspace, and good deliverability | About 2,000 messages/day per mailbox. `EMAIL_FROM_ADDRESS` must be that mailbox or one of its verified aliases. Needs a dedicated mailbox, not someone's personal account |
| **Microsoft 365 mailbox** | `smtp.office365.com`, port 587 | Domains already on Microsoft 365 | "Authenticated SMTP" must be enabled for the mailbox. Microsoft is phasing out password (basic-auth) SMTP, so this may need OAuth2 (nodemailer supports XOAUTH2, which would be a small config change). Check the tenant's current policy first |
| **Zoho Mail** | `smtp.zoho.com` (or `smtp.zoho.in` for India data centres), port 465 or 587, app-specific password | Domains on Zoho | Daily sending limits depend on the plan |
| **Transactional SMTP relay** (Brevo, Mailgun, Postmark, SendGrid) | The provider's SMTP host, port 587, SMTP key as the password | The best deliverability and bounce handling as volume grows | A separate account and DNS setup for the domain. Free tiers are limited (e.g. Brevo about 300/day) |
| Self-hosted Postfix on EC2 | — | — | **Not recommended**: AWS blocks outbound port 25 by default, and a new server IP has no reputation, so mail lands in spam |

**Recommendation:** use a **dedicated `no-reply@` mailbox on whatever provider the sending domain already uses** (probably Google Workspace or Microsoft 365), with an app password. It needs no new vendor and no new DNS. If volume grows or messages start landing in spam, move to a transactional relay by swapping the `SMTP_*` values.

### 6.1 Deliverability checklist (whichever provider)

1. **SPF**: the domain's SPF TXT record must include the provider (e.g. `include:_spf.google.com` for Google Workspace).
2. **DKIM**: turn on DKIM signing in the provider's admin console and publish the TXT/CNAME record it gives you.
3. **DMARC**: a `_dmarc` TXT record, starting with `p=none` and tightening once reports look clean.
4. **From address**: `EMAIL_FROM_ADDRESS` must be an address the SMTP user is allowed to send as. Otherwise the provider rewrites it or rejects the message.
5. **Test** with real Gmail and Outlook inboxes. Check the spam folder, and check that the message headers show `spf=pass`, `dkim=pass` and `dmarc=pass`.

### 6.2 Local development

- The hook is called *by Supabase*, so it must be reachable over public HTTPS. For local testing, expose `localhost:3000` with a tunnel (`ngrok http 3000` or `cloudflared tunnel`) and point a **dev Supabase project's** hook at it. Never point the production project's hook at a laptop.
- To see emails without sending real ones, point `SMTP_*` at a local catcher such as **Mailpit** (`SMTP_HOST=localhost`, `SMTP_PORT=1025`), or at an **Ethereal** test account (nodemailer's free fake SMTP service).

### 6.3 Environment variables

```
SEND_EMAIL_HOOK_SECRET=v1,whsec_...   # from Supabase → Auth Hooks → Send Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587                          # 587 = STARTTLS, 465 = implicit TLS
SMTP_SECURE=                           # optional override; defaults to true only on port 465
SMTP_USER=no-reply@<domain>
SMTP_PASS=<app password / SMTP key>
EMAIL_FROM_ADDRESS="100 Pathways <no-reply@<domain>>"
NEXT_PUBLIC_SUPABASE_URL=...           # existing; used to build password-reset links
```

These go in the EC2 container's environment and in `.env.local` for development. None of them are needed at build time.

### 6.4 Why a hook and not Supabase's own "Custom SMTP"

Supabase can also take SMTP credentials directly (Auth → SMTP Settings) and send the emails itself, with no hook and no code of ours. We chose the hook with nodemailer so that:
- email templates and sending logic live in this repo, under version control;
- failures are logged in our own server logs.

The trade-off: **our app is now in the path of every auth email.** If the EC2 container is down, nobody can sign up or reset a password. If that becomes a problem, the same SMTP account can be pasted into Supabase's Custom SMTP and the hook switched off, without changing the login page.

## 7. Role grant hardening (recommended, small)

The `adopter` role is granted by a client-side call that is allowed to fail silently. With OTP, the natural moment to grant it is "email confirmed". Two ways to do that:

- **Minimum (done):** call `/api/auth/grant-default-role` after `verifyOtp` succeeds (§3.2).
- **Better (optional):** a migration adding a Postgres trigger on `auth.users` that inserts `(id, 'adopter')` into `user_roles` when `email_confirmed_at` changes from `NULL` to a value. The grant then can't be skipped by a closed tab or a failed request, and the client call becomes a harmless no-op (it already treats `23505` as success).

## 8. Security notes

- The OTP is single-use and expires after 10 minutes. Supabase enforces both, and our code never stores it.
- Brute force: a 6-digit code has 1,000,000 combinations. Supabase's per-IP token-verification rate limit, together with the 10-minute expiry, makes guessing impractical. Don't raise the verification rate limit.
- The hook endpoint is public, because Supabase calls it without a session. Its **only** protection is the signature check, so `SEND_EMAIL_HOOK_SECRET` must be treated like a password. Rotate it by generating a new one in Supabase: the check accepts several signatures during rotation.
- The code is never logged, never put in a URL, and never stored client-side beyond the input's own state.
- `SMTP_PASS` must be an app password or SMTP key scoped to a dedicated sending mailbox, never a person's real login password.
- The masked "already registered" response (§3.1) is Supabase's anti-enumeration behaviour. Our copy reveals that the account exists, which is what the app already did before (see Q3).

## 9. Acceptance criteria

1. Submitting valid details sends one email with a 6-digit code within about 30s, and the form moves to the Verify step showing the email address.
2. Entering the correct code signs the user in, grants `adopter`, and lands them on `/explore`.
3. Entering a wrong code shows the error from §4, clears the input, and allows another try without re-entering details.
4. A code older than 10 minutes is rejected with the same message.
5. **Resend** is disabled for 60s after each send. Afterwards it sends a new code, and the old code no longer works.
6. "Use a different email" returns to Details with the fields still filled in.
7. Signing in with an unverified account moves to the Verify step and sends a new code.
8. Signing up with an already-verified email tells the user to sign in and sends no code.
9. Emails arrive in Gmail and Outlook inboxes, not spam, with SPF, DKIM and DMARC passing.
10. **Forgot password:** entering an email sends a 6-digit reset code. The right code leads to "Set a new password". Wrong or expired codes and resend behave as in 3–5. Afterwards the new password works for sign-in and the old one doesn't.
11. With a wrong `SMTP_PASS`, sign-up shows "We couldn't send the email…" and the server log shows the SMTP error. No user is left in a broken state: fixing the config and pressing Resend recovers.

## 10. Open questions

- **Q1 SMTP provider and mailbox:** which provider hosts the sending domain (Google Workspace, Microsoft 365, Zoho, …)? Who can create a `no-reply@` mailbox and its app password?
- **Q2 Sending domain:** `100pathways.com`, a subdomain, or a company domain? Who controls its DNS, for SPF, DKIM and DMARC?
- **Q3 Existing-email behaviour:** keep "account exists, sign in" (reveals the account, same as before) or show a neutral "If this email can be registered, we've sent a code"?
- **Q4 Code length and expiry:** 6 digits and 10 minutes. Is that acceptable?
- **Q5 Role-grant trigger (§7):** include it in this change or do it separately?

## 11. Implementation plan

### Done in code
- [x] `app/login/page.tsx`: the two-step sign-up, the Verify UI, `verifyOtp` / `resend`, the resend countdown, the error mapping from §4, and `email_not_confirmed` handling on sign-in.
- [x] Role grant moved to after verification.
- [x] `app/api/auth/send-email/route.ts`: the Send Email hook, with Standard Webhooks signature check and dispatch per `email_action_type`.
- [x] `lib/email.ts`: a provider-neutral nodemailer transport (`SMTP_*`, pooled, with timeouts and a clear error when unconfigured) and branded auth emails.
- [x] `proxy.ts`: `/api/auth/send-email` made public (signature-authenticated).
- [x] All AWS SES references removed from the code; CLAUDE.md and ARCHITECTURE.md updated.

### Remaining, in this order

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | Answer Q1/Q2. Create the `no-reply@` mailbox and generate an app password / SMTP key | Mail/IT admin | The credentials are in hand |
| 2 | Set up SPF, DKIM and DMARC for the sending domain (§6.1) | DNS owner | A test send from the mailbox shows `spf=pass dkim=pass` |
| 3 | **Dev Supabase project first:** tunnel to local, create the Send Email hook, put the secret and the Mailpit/Ethereal `SMTP_*` values in `.env.local`, and walk through §9 | Dev | §9 criteria 1–8 and 11 pass locally |
| 4 | Set the §6.3 env vars (real SMTP; `SEND_EMAIL_HOOK_SECRET` can be empty for now) on EC2 and deploy | Dev | The app is running. Nothing changes for users yet, because the hook is off |
| 5 | Production Supabase → Auth → Providers → Email: OTP length **6**, expiry **600s** | Supabase admin | Saved |
| 6 | Production Supabase → Auth Hooks → Send Email: URL `https://<app-domain>/api/auth/send-email`, *Generate secret*. Put it in `SEND_EMAIL_HOOK_SECRET`, restart, **then** enable the hook. Test "Forgot password" at once | Supabase admin + Dev | The reset email arrives via nodemailer |
| 7 | Turn on **Confirm email** | Supabase admin | The first real sign-up receives a code |
| 8 | QA against §9 in production (criteria 1–10) | QA | All pass |
| 9 | Optional: the role-grant trigger migration (§7) | Dev | — |

**Rollback:** if something goes wrong after step 6 or 7, turn off **Confirm email** and the **Send Email hook** in Supabase. Sign-up goes back to instant accounts, with no code deploy needed. The page shows the code screen only when `signUp` returns no session, and with confirmation off it always returns one. The hook being off means Supabase falls back to its own built-in sender for password resets, which is rate-limited but works.
