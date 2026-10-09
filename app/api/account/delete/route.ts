import { createClient, createStatelessClient } from '@/lib/supabase/server';
import { deleteAccount } from '@/lib/account-deletion-server';

// Self-serve permanent account deletion — what gets removed and what stays
// is in deleteAccount() (lib/account-deletion-server.ts). Requires the
// account password, re-verified here. See specs/ACCOUNT_DELETION_SPEC.md.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password) return Response.json({ error: 'Enter your password.' }, { status: 400 });

  // A live session alone isn't enough to destroy the account — re-verify the
  // password, on a throwaway client so the caller's session cookies are left
  // alone. Supabase's own sign-in rate limit applies to repeated guesses.
  const { error: passwordError } = await createStatelessClient().auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (passwordError) {
    if (passwordError.code === 'invalid_credentials') {
      return Response.json({ error: 'Incorrect password.' }, { status: 403 });
    }
    if (passwordError.code === 'over_request_rate_limit') {
      return Response.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 });
    }
    console.error('[account/delete] password check', passwordError);
    return Response.json({ error: 'Could not verify your password. Please try again.' }, { status: 500 });
  }

  if (!(await deleteAccount(user.id, 'account/delete'))) {
    return Response.json({ error: 'Could not delete your account.' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
