# Signup Approval: Two Ways to Go

Context: the email-based approval flow is built and working end-to-end in code, but is currently blocked on external infrastructure (domain DNS ownership for Resend, then an AWS Organizations SCP blocking SES). Neither blocker is a code problem — both are organizational/access issues outside the app itself. This doc lays out that approach versus an alternative that removes the admin's dependency on email working at all.

## Option 1: Email-based flow (current, already built)

**How it works:** User submits Name/Email/Organization on `/login` → an email goes to admin addresses with a review link → admin clicks it → sees a plain page (name/email/org + Approve/Reject buttons) → approving creates the real account and emails the user a link to set their password.

**Role assignment:** Manual — an admin opens the Supabase dashboard's Table Editor and adds a row to `user_roles` directly. No in-app UI for this.

**What's needed to actually turn this on:** just a working outbound email sender (Resend with domain access, or SES with the SCP resolved, or any other SMTP provider) — the code doesn't care which. Everything else is already built and tested.

**Pros**
- Already built — this is a "finish the email setup" problem, not a "write more code" problem.
- Admin never needs to open the app or log in to approve someone — works from any device, straight from an email client.
- Smallest surface area: no new authenticated pages, no new role/permission concept for "who is an admin."
- Matches the exact flow originally specified.

**Cons**
- Fully dependent on outbound email actually working. We've now hit this twice (domain ownership, then an org-level AWS policy) — external blockers unrelated to the app, but real delays either way.
- No list/dashboard view of pending requests — each one is a standalone email. If several requests come in, there's no single place to see them all, search, or filter.
- Role assignment happens outside the app entirely, via direct Supabase dashboard access — meaning whoever manages roles needs a Supabase login, which is a bigger permission to hand out than "admin of this app."
- No visible audit trail in the app itself (status is tracked in the `pending_signups` table, but nothing surfaces it in any UI).

## Option 2: In-app admin dashboard

**How it works:** Same underlying signup-request submission and account-creation mechanics — but instead of a public emailed link, there's a new authenticated `/admin` area inside the app, gated to whoever holds an `admin` role (or a fixed allowlist of admin accounts). It shows a list of all pending/approved/rejected requests, with Approve/Reject actions right in the page. Approving still creates the real account the same way, and — this matters — **still sends the user an email** telling them they're approved and linking them to set a password, since that part isn't something an in-app dashboard can replace (the user isn't logged into anything yet).

**Role assignment:** Built into the same dashboard — a page listing users with checkboxes/toggles for `adopter`/`pathway_contributor`, writing to `user_roles` directly through the UI instead of the Supabase Table Editor.

**Important nuance:** this doesn't eliminate email from the flow. It only removes the *admin's* dependency on an email arriving and a link working — the admin now just logs into the app directly to see and act on requests. The *user* being told "you're approved, come set your password" still needs to go out somehow, and email is still the natural way to do that (nothing currently proposed replaces it — the user has no account yet to notify them any other way). So this option shrinks the blast radius of an email outage (it would only affect the user-facing notification, not the admin's ability to approve) but doesn't remove the email dependency entirely.

**Pros**
- Admin approval no longer blocked by outbound email working — admin can act the moment they see a request in the dashboard.
- A real list/queue of requests: searchable, filterable, an actual audit trail in the UI.
- Role management becomes a proper in-app feature — no need to hand out Supabase dashboard access to anyone just to assign roles.
- Scales better as the number of requests and users grows — a growing pile of individual emails becomes unwieldy; a table with filters doesn't.

**Cons**
- Meaningfully more development work: a new gated admin route, a list/table UI for requests with actions, a separate role-management UI, and a new "who counts as an admin" concept that doesn't exist yet (a new role, or a hardcoded allowlist).
- Still needs *something* to alert an admin that a new request came in — otherwise they'd have to remember to check the dashboard periodically. Simplest fix: keep a lightweight "new request" notification (email or otherwise), but it's now just an FYI ping, not the mechanism of approval itself.
- Doesn't remove the user-facing email dependency (see nuance above) — if outbound email is broken, approved users still can't get their sign-in link.

## Bottom line

Option 1 is a finish line already in sight, blocked purely on external access/policy issues that are being worked in parallel (the Harish email). Option 2 is a genuinely better long-term admin experience and removes email as a single point of failure *for the admin side only* — but it's new development, not a shortcut, and email still isn't fully out of the picture.
