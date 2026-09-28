# Specs

Feature specs and design-decision docs. Put new specs here, named `<FEATURE>_SPEC.md`, and link to files in the repo with `../` paths.

| Spec | What it covers |
|---|---|
| [SIGNUP_OTP_SPEC.md](SIGNUP_OTP_SPEC.md) | Email OTP at sign-up and code-based password reset. Also covers the Supabase Send Email hook and delivery via nodemailer/SMTP. |
| [SIGNUP_APPROVAL_OPTIONS.md](SIGNUP_APPROVAL_OPTIONS.md) | Decision doc comparing email-based and in-app signup approval |
| [ACCOUNT_DELETION_SPEC.md](ACCOUNT_DELETION_SPEC.md) | Self-serve account deletion confirmed by password (migration 0033), the password Show/Hide toggle, sign-out confirmation, and the shared ConfirmDialog |
