import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  sendAuthLinkEmail,
  sendPasswordResetCodeEmail,
  sendReauthenticationCodeEmail,
  sendSignupCodeEmail,
} from '@/lib/email';

// Supabase Auth "Send Email" hook (Dashboard → Authentication → Auth Hooks).
// With the hook enabled Supabase sends no auth email itself: it still
// generates, stores, expires and verifies every OTP and link, then POSTs them
// here and we deliver them through nodemailer (lib/email.ts → SMTP_* server).
// Public in proxy.ts — Supabase calls it with no session; the signature check
// below is the only authentication. See specs/SIGNUP_OTP_SPEC.md.

// Must match "Email OTP Expiration" in Supabase → Auth → Providers → Email
// (set to 600s). Only used for the "expires in N minutes" line in the email.
const OTP_EXPIRY_MINUTES = 10;

// Standard Webhooks allows up to 5 minutes of clock skew / replay window.
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

type EmailActionType =
  | 'signup'
  | 'recovery'
  | 'invite'
  | 'magiclink'
  | 'email'
  | 'email_change'
  | 'reauthentication';

interface SendEmailHookPayload {
  user: { email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: EmailActionType;
    site_url: string;
  };
}

// Verifies the Standard Webhooks signature Supabase attaches: HMAC-SHA256
// over `${id}.${timestamp}.${body}` with the base64 secret after "v1,whsec_".
function verifySignature(body: string, headers: Headers, secret: string): boolean {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatureHeader = headers.get('webhook-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();

  // The header is a space-separated list of "v1,<base64>" entries (more than
  // one during secret rotation); any match is enough.
  return signatureHeader.split(' ').some((entry) => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Same link Supabase's {{ .ConfirmationURL }} would produce: its /verify
// endpoint consumes the token and redirects to redirect_to with the session.
function verifyUrl(tokenHash: string, type: EmailActionType, redirectTo: string): string {
  const url = new URL('/auth/v1/verify', process.env.NEXT_PUBLIC_SUPABASE_URL);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', type);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

// Supabase surfaces this message back to the caller of signUp/resend/etc.
function hookError(httpCode: number, message: string) {
  return Response.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) {
    console.error('send-email hook: SEND_EMAIL_HOOK_SECRET is not configured');
    return hookError(500, 'Email sending is not configured.');
  }

  const body = await request.text();
  if (!verifySignature(body, request.headers, secret)) {
    return hookError(401, 'Invalid signature.');
  }

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return hookError(400, 'Invalid payload.');
  }

  const { user, email_data: data } = payload;
  const to = user?.email;
  if (!to || !data) return hookError(400, 'Invalid payload.');

  try {
    switch (data.email_action_type) {
      case 'signup':
        await sendSignupCodeEmail({ to, code: data.token, expiresInMinutes: OTP_EXPIRY_MINUTES });
        break;
      case 'recovery':
        // Code-based reset: entered on /login's "Forgot password?" flow.
        await sendPasswordResetCodeEmail({ to, code: data.token, expiresInMinutes: OTP_EXPIRY_MINUTES });
        break;
      case 'reauthentication':
        await sendReauthenticationCodeEmail({ to, code: data.token, expiresInMinutes: OTP_EXPIRY_MINUTES });
        break;
      case 'invite':
        await sendAuthLinkEmail({
          to,
          kind: data.email_action_type,
          url: verifyUrl(data.token_hash, data.email_action_type, data.redirect_to),
        });
        break;
      case 'magiclink':
      case 'email':
        await sendAuthLinkEmail({
          to,
          kind: 'magiclink',
          url: verifyUrl(data.token_hash, 'magiclink', data.redirect_to),
          code: data.token,
        });
        break;
      default:
        // email_change isn't used anywhere in the app (users can only change
        // their password). Fail loudly rather than send a wrong link.
        console.error(`send-email hook: unsupported email_action_type "${data.email_action_type}"`);
        return hookError(400, 'This type of email is not supported.');
    }
  } catch (err) {
    console.error(`send-email hook: failed to send ${data.email_action_type} email`, err);
    return hookError(500, 'We couldn’t send the email. Please try again in a moment.');
  }

  return Response.json({});
}
