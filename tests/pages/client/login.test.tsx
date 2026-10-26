// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred, jsonResponse, stubFetch, type FetchCall } from '../../helpers/ui-fork-http';
import { createAuthClientMock } from '../../helpers/pages-client-helpers';

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
const search = { params: new URLSearchParams() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => search.params,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { showToast } from '@/lib/toast';
import LoginPage from '@/app/login/page';

let sb: ReturnType<typeof createAuthClientMock>;
let calls: FetchCall[];

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
  search.params = new URLSearchParams();
  sb = createAuthClientMock();
  vi.mocked(createClient).mockReturnValue(sb.client);
  // OrganisationInput (sign-up form) looks organisations up; nothing else on
  // this page should touch fetch.
  calls = stubFetch((call) => (call.url.startsWith('/api/organisations') ? jsonResponse([]) : undefined)).calls;
});

afterEach(() => {
  // The adopter role is granted by a DB trigger (migration 0039) — no flow on
  // this page may call the old grant route any more.
  expect(calls.some((c) => c.url.includes('/api/auth/grant-default-role'))).toBe(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderLogin(query = '') {
  search.params = new URLSearchParams(query);
  const user = userEvent.setup();
  render(<LoginPage />);
  return { user };
}

const heading = (name: string) => screen.getByRole('heading', { name });
const codeInput = () => screen.getByLabelText(/Verification code|Reset code/);
const nonOrgCalls = () => calls.filter((c) => !c.url.startsWith('/api/organisations'));

async function signIn(user: ReturnType<typeof userEvent.setup>, email = 'ada@example.org', password = 'secret123') {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function fillSignup(
  user: ReturnType<typeof userEvent.setup>,
  opts: { privacy?: boolean; terms?: boolean; email?: string } = {}
) {
  await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
  await user.type(screen.getByLabelText('Email'), opts.email ?? 'ada@example.org');
  await user.type(screen.getByPlaceholderText('Start typing…'), 'Analytical Engines Ltd');
  await user.type(screen.getByLabelText('Password'), 'secret123');
  const [privacy, terms] = screen.getAllByRole('checkbox');
  if (opts.privacy !== false) await user.click(privacy);
  if (opts.terms !== false) await user.click(terms);
}

const signUpButton = () => screen.getByRole('button', { name: /^(Sign up|Please wait…)$/ });

async function reachSignupVerify(user: ReturnType<typeof userEvent.setup>) {
  renderSignup();
  await fillSignup(user);
  await user.click(signUpButton());
  await screen.findByRole('heading', { name: 'Check your email' });
}

function renderSignup() {
  search.params = new URLSearchParams('mode=signup');
  render(<LoginPage />);
}

async function reachForgotCode(user: ReturnType<typeof userEvent.setup>, email = 'ada@example.org') {
  await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByRole('heading', { name: 'Check your email' });
}

// ---------------------------------------------------------------------------

describe('Login page — sign in', () => {
  it('opens on the sign-in form by default with a 6-char minimum password', () => {
    renderLogin();
    expect(heading('Sign in')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '6');
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('signs in, toasts, and replaces to "/" when there is no next', async () => {
    const { user } = renderLogin();
    await signIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(sb.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ada@example.org', password: 'secret123' });
    expect(showToast).toHaveBeenCalledWith('Signed in successfully.');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(nonOrgCalls()).toEqual([]);
  });

  it('honours a same-site next path, query string included', async () => {
    const { user } = renderLogin('next=%2Fadoptions%3Fopen%3Dd1');
    await signIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/adoptions?open=d1'));
  });

  it.each([
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative //host', '//evil.example'],
    ['a backslash /\\host', '/\\evil.example'],
    ['a relative path without a leading slash', 'explore'],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['an empty value', ''],
  ])('falls back to "/" for %s', async (_label, next) => {
    const { user } = renderLogin(`next=${encodeURIComponent(next)}`);
    await signIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('shows the Supabase message on a wrong password and stays put', async () => {
    sb.auth.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
    });
    const { user } = renderLogin();
    await signIn(user, 'ada@example.org', 'wrongpass');
    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(sb.auth.resend).not.toHaveBeenCalled();
  });

  it('shows "Please wait…" and disables the button while signing in', async () => {
    const gate = deferred<{ data: unknown; error: null }>();
    sb.auth.signInWithPassword.mockReturnValueOnce(gate.promise);
    const { user } = renderLogin();
    await signIn(user);
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeDisabled();
    await act(async () => gate.resolve({ data: {}, error: null }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('clears a previous error when the user tries again', async () => {
    sb.auth.signInWithPassword.mockResolvedValueOnce({ data: null, error: { message: 'Invalid login credentials' } });
    const { user } = renderLogin();
    await signIn(user);
    await screen.findByText('Invalid login credentials');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(screen.queryByText('Invalid login credentials')).not.toBeInTheDocument();
  });

  it('email_not_confirmed: resends the signup code and opens the verify step', async () => {
    sb.auth.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 },
    });
    const { user } = renderLogin();
    await signIn(user);
    await screen.findByRole('heading', { name: 'Check your email' });
    expect(sb.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'ada@example.org' });
    expect(screen.getByText("Your email isn't verified yet. We've sent you a new code.")).toBeInTheDocument();
    expect(screen.getByLabelText('Verification code')).toHaveFocus();
    expect(screen.getByText('ada@example.org')).toBeInTheDocument();
    expect(screen.queryByText('Email not confirmed')).not.toBeInTheDocument();
  });

  it('email_not_confirmed with a failed resend still opens the verify step with a softer notice', async () => {
    sb.auth.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
    });
    sb.auth.resend.mockResolvedValueOnce({ data: null, error: { message: 'rate limited', status: 429 } });
    const { user } = renderLogin();
    await signIn(user);
    expect(
      await screen.findByText("Your email isn't verified yet. Enter the code we sent you, or request a new one.")
    ).toBeInTheDocument();
  });

  it('email_not_confirmed → correct code completes like a signup (to /explore, not next)', async () => {
    sb.auth.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
    });
    const { user } = renderLogin('next=/contribute');
    await signIn(user);
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/explore'));
    expect(sb.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ada@example.org', token: '123456', type: 'email' });
  });

  it('links to the sign-up and forgot-password forms', async () => {
    const { user } = renderLogin();
    await user.click(screen.getByRole('button', { name: "Don't have an account? Sign up" }));
    expect(heading('Sign up')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Already have an account? Sign in' }));
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(heading('Reset your password')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(heading('Sign in')).toBeInTheDocument();
  });

  it('switching modes clears the typed password and any error', async () => {
    sb.auth.signInWithPassword.mockResolvedValueOnce({ data: null, error: { message: 'Invalid login credentials' } });
    const { user } = renderLogin();
    await signIn(user);
    await screen.findByText('Invalid login credentials');
    await user.click(screen.getByRole('button', { name: "Don't have an account? Sign up" }));
    expect(screen.queryByText('Invalid login credentials')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    // Email is kept across modes.
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.org');
  });
});

// ---------------------------------------------------------------------------

describe('Login page — sign up', () => {
  it('?mode=signup opens straight on the sign-up form', () => {
    renderLogin('mode=signup');
    expect(heading('Sign up')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '6');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('an unknown mode falls back to sign in', () => {
    renderLogin('mode=forgot');
    expect(heading('Sign in')).toBeInTheDocument();
  });

  it('links the Privacy Notice and Terms with ?from=signup in a new tab', () => {
    renderLogin('mode=signup');
    const privacy = screen.getAllByRole('link', { name: 'Privacy Notice' });
    expect(privacy).toHaveLength(2);
    for (const a of privacy) {
      expect(a).toHaveAttribute('href', '/privacy?from=signup');
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms?from=signup');
  });

  it.each([
    ['neither box', { privacy: false, terms: false }],
    ['only privacy', { privacy: true, terms: false }],
    ['only terms', { privacy: false, terms: true }],
  ])('keeps Sign up disabled with %s ticked', async (_label, opts) => {
    const user = userEvent.setup();
    renderSignup();
    await fillSignup(user, opts);
    expect(signUpButton()).toBeDisabled();
  });

  it('a forced form submit without both consents never calls signUp', async () => {
    const user = userEvent.setup();
    renderSignup();
    await fillSignup(user, { terms: false });
    fireEvent.submit(signUpButton().closest('form')!);
    await act(async () => {});
    expect(sb.auth.signUp).not.toHaveBeenCalled();
  });

  it('sends name, organisation and the consent record in user_metadata', async () => {
    const user = userEvent.setup();
    renderSignup();
    await fillSignup(user);
    expect(signUpButton()).toBeEnabled();
    await user.click(signUpButton());
    await screen.findByRole('heading', { name: 'Check your email' });
    expect(sb.auth.signUp).toHaveBeenCalledTimes(1);
    const args = sb.auth.signUp.mock.calls[0][0] as {
      email: string;
      password: string;
      options: { data: Record<string, string> };
    };
    expect(args.email).toBe('ada@example.org');
    expect(args.password).toBe('secret123');
    const meta = args.options.data;
    expect(meta.name).toBe('Ada Lovelace');
    expect(meta.organization).toBe('Analytical Engines Ltd');
    expect(meta.terms_version).toBe('1.0');
    expect(meta.privacy_consent_at).toBe(meta.terms_accepted_at);
    expect(new Date(meta.privacy_consent_at).toISOString()).toBe(meta.privacy_consent_at);
  });

  it('a normal sign-up (no session) moves to the code step without navigating or calling any API', async () => {
    const user = userEvent.setup();
    await reachSignupVerify(user);
    expect(screen.getByText('ada@example.org')).toBeInTheDocument();
    expect(screen.getByLabelText('Verification code')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resend code in 60s' })).toBeDisabled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(nonOrgCalls()).toEqual([]);
  });

  it('shows the signUp error and stays on the form', async () => {
    sb.auth.signUp.mockResolvedValueOnce({ data: null, error: { message: 'Password should be at least 6 characters.' } });
    const user = userEvent.setup();
    renderSignup();
    await fillSignup(user);
    await user.click(signUpButton());
    expect(await screen.findByText('Password should be at least 6 characters.')).toBeInTheDocument();
    expect(heading('Sign up')).toBeInTheDocument();
    expect(signUpButton()).toBeEnabled();
  });

  it('an already-confirmed email (identities: []) switches to sign in with a message', async () => {
    sb.auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'masked', identities: [] }, session: null }, error: null });
    const user = userEvent.setup();
    renderSignup();
    await fillSignup(user);
    await user.click(signUpButton());
    expect(await screen.findByText('An account with this email already exists. Sign in instead.')).toBeInTheDocument();
    expect(heading('Sign in')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.org');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('a user without an identities array is not treated as an existing account', async () => {
    sb.auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'u1' }, session: null }, error: null });
    const user = userEvent.setup();
    renderSignup();
    await fillSignup(user);
    await user.click(signUpButton());
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  });

  it('a session returned by signUp completes immediately to /explore (ignoring next)', async () => {
    sb.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: { access_token: 't' } },
      error: null,
    });
    const user = userEvent.setup();
    search.params = new URLSearchParams('mode=signup&next=/contribute');
    render(<LoginPage />);
    await fillSignup(user);
    await user.click(signUpButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/explore'));
    expect(showToast).toHaveBeenCalledWith('Account created successfully. Welcome to Diffusion Cube!');
    expect(router.refresh).toHaveBeenCalled();
    expect(sb.auth.verifyOtp).not.toHaveBeenCalled();
    expect(nonOrgCalls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('Login page — sign-up code verification', () => {
  it('typing the 6th digit verifies automatically and lands on /explore', async () => {
    const user = userEvent.setup();
    await reachSignupVerify(user);
    await user.type(codeInput(), '654321');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/explore'));
    expect(sb.auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(sb.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ada@example.org', token: '654321', type: 'email' });
    expect(showToast).toHaveBeenCalledWith('Account created successfully. Welcome to Diffusion Cube!');
    expect(nonOrgCalls()).toEqual([]);
  });

  it('accepts a pasted code with spaces/dashes, keeping only the first 6 digits', async () => {
    const user = userEvent.setup();
    await reachSignupVerify(user);
    codeInput().focus();
    await user.paste('12-34 56 99');
    await waitFor(() => expect(sb.auth.verifyOtp).toHaveBeenCalled());
    expect(sb.auth.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ token: '123456' }));
  });

  it('strips non-digits as you type and keeps Verify disabled under 6 digits', async () => {
    const user = userEvent.setup();
    await reachSignupVerify(user);
    await user.type(codeInput(), 'ab12c3');
    expect(codeInput()).toHaveValue('123');
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(sb.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('a forced submit with a short code asks for the full code without calling Supabase', async () => {
    const user = userEvent.setup();
    await reachSignupVerify(user);
    await user.type(codeInput(), '12');
    fireEvent.submit(codeInput().closest('form')!);
    expect(await screen.findByText('Enter the 6-digit code from your email.')).toBeInTheDocument();
    expect(sb.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('a wrong code clears the input and explains; the fifth failure nudges towards a new code', async () => {
    sb.auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'Token has expired or is invalid', code: 'otp_expired', status: 403 } });
    const user = userEvent.setup();
    await reachSignupVerify(user);
    const base = 'That code is incorrect or has expired. Check it and try again, or request a new code.';
    for (let i = 1; i <= 4; i++) {
      await user.type(codeInput(), '000000');
      await screen.findByText(base);
      expect(codeInput()).toHaveValue('');
    }
    expect(screen.queryByText(/Still not working/)).not.toBeInTheDocument();
    await user.type(codeInput(), '000000');
    expect(await screen.findByText(`${base} Still not working? Request a new code below.`)).toBeInTheDocument();
    expect(sb.auth.verifyOtp).toHaveBeenCalledTimes(5);
    expect(router.replace).not.toHaveBeenCalled();
    expect(codeInput()).toHaveFocus();
  });

  it('no error but no session is still treated as a failed code', async () => {
    sb.auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
    const user = userEvent.setup();
    await reachSignupVerify(user);
    await user.type(codeInput(), '111111');
    expect(await screen.findByText(/That code is incorrect or has expired/)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP 429', { message: 'Too many', status: 429 }],
    ['over_email_send_rate_limit', { message: 'rate', code: 'over_email_send_rate_limit' }],
    ['over_request_rate_limit', { message: 'rate', code: 'over_request_rate_limit' }],
  ])('a rate-limited verify (%s) says to wait', async (_label, error) => {
    sb.auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error });
    const user = userEvent.setup();
    await reachSignupVerify(user);
    await user.type(codeInput(), '123456');
    expect(
      await screen.findByText('Too many attempts. Please wait a few minutes, then request a new code.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/incorrect or has expired/)).not.toBeInTheDocument();
    expect(codeInput()).toHaveValue('');
  });

  it('shows "Please wait…" while verifying', async () => {
    const gate = deferred<{ data: unknown; error: null }>();
    sb.auth.verifyOtp.mockReturnValueOnce(gate.promise);
    const user = userEvent.setup();
    await reachSignupVerify(user);
    await user.type(codeInput(), '123456');
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use a different email' })).toBeDisabled();
    await act(async () => gate.resolve({ data: { session: {} }, error: null }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/explore'));
  });

  it('"Use a different email" returns to the sign-up details with the email kept', async () => {
    const user = userEvent.setup();
    await reachSignupVerify(user);
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(heading('Sign up')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.org');
  });

  it('holds Resend for 60s, then resends and announces the new code', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    renderSignup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(signUpButton());
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Resend code in 60s' })).toBeDisabled();

    await act(async () => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('button', { name: 'Resend code in 59s' })).toBeDisabled();
    for (let i = 0; i < 59; i++) await act(async () => vi.advanceTimersByTime(1000));
    const resend = screen.getByRole('button', { name: 'Resend code' });
    expect(resend).toBeEnabled();

    fireEvent.click(resend);
    await act(async () => {});
    expect(sb.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'ada@example.org' });
    expect(screen.getByText('New code sent. Use the latest one; earlier codes no longer work.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code in 60s' })).toBeDisabled();
  });

  async function reachResendReady() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    renderSignup();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.org' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(signUpButton());
    await act(async () => {});
    for (let i = 0; i < 60; i++) await act(async () => vi.advanceTimersByTime(1000));
    return screen.getByRole('button', { name: 'Resend code' });
  }

  it('a rate-limited resend says to wait and restarts the cooldown', async () => {
    sb.auth.resend.mockResolvedValueOnce({ data: null, error: { message: 'rate', status: 429 } });
    fireEvent.click(await reachResendReady());
    await act(async () => {});
    expect(screen.getByText('Please wait a moment before requesting another code.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code in 60s' })).toBeDisabled();
    expect(screen.queryByText(/New code sent/)).not.toBeInTheDocument();
  });

  it('any other resend failure shows a generic retry message and leaves Resend available', async () => {
    sb.auth.resend.mockResolvedValueOnce({ data: null, error: { message: 'boom', status: 500 } });
    fireEvent.click(await reachResendReady());
    await act(async () => {});
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------

describe('Login page — forgot password', () => {
  it('email → code → new password → signed in and sent to next', async () => {
    const { user } = renderLogin('next=/account');
    await reachForgotCode(user, 'ada@example.org');
    expect(sb.auth.resetPasswordForEmail).toHaveBeenCalledWith('ada@example.org');
    expect(screen.getByText('ada@example.org')).toBeInTheDocument();
    expect(screen.getByText(/If an account exists for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await user.type(screen.getByLabelText('Reset code'), '246810');
    await screen.findByRole('heading', { name: 'Set a new password' });
    expect(sb.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ada@example.org', token: '246810', type: 'recovery' });
    expect(screen.getByLabelText('New password')).toHaveValue('');

    await user.type(screen.getByLabelText('New password'), 'brandnew1');
    await user.type(screen.getByLabelText('Confirm new password'), 'brandnew1');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/account'));
    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'brandnew1' });
    expect(showToast).toHaveBeenCalledWith("Password updated successfully. You're signed in.");
    expect(router.refresh).toHaveBeenCalled();
    expect(nonOrgCalls()).toEqual([]);
  });

  it('sanitises next after a password reset too', async () => {
    const { user } = renderLogin('next=//evil.example');
    await reachForgotCode(user);
    await user.type(screen.getByLabelText('Reset code'), '246810');
    await user.type(await screen.findByLabelText('New password'), 'brandnew1');
    await user.type(screen.getByLabelText('Confirm new password'), 'brandnew1');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  async function reachNewPassword(user: ReturnType<typeof userEvent.setup>) {
    await reachForgotCode(user);
    await user.type(screen.getByLabelText('Reset code'), '246810');
    await screen.findByRole('heading', { name: 'Set a new password' });
  }

  it('rejects mismatched passwords without calling Supabase', async () => {
    const { user } = renderLogin();
    await reachNewPassword(user);
    await user.type(screen.getByLabelText('New password'), 'brandnew1');
    await user.type(screen.getByLabelText('Confirm new password'), 'brandnew2');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(sb.auth.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a password under 6 characters (5 chars) but accepts exactly 6', async () => {
    const { user } = renderLogin();
    await reachNewPassword(user);
    expect(screen.getByLabelText('New password')).toHaveAttribute('minLength', '6');
    await user.type(screen.getByLabelText('New password'), '12345');
    await user.type(screen.getByLabelText('Confirm new password'), '12345');
    // Bypass native constraint validation to exercise the JS guard.
    fireEvent.submit(screen.getByLabelText('New password').closest('form')!);
    expect(await screen.findByText('Your password must be at least 6 characters.')).toBeInTheDocument();
    expect(sb.auth.updateUser).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('New password'), '6');
    await user.type(screen.getByLabelText('Confirm new password'), '6');
    fireEvent.submit(screen.getByLabelText('New password').closest('form')!);
    await waitFor(() => expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: '123456' }));
  });

  it('same_password gets a friendly message', async () => {
    sb.auth.updateUser.mockResolvedValueOnce({
      data: null,
      error: { message: 'New password should be different from the old password.', code: 'same_password', status: 422 },
    });
    const { user } = renderLogin();
    await reachNewPassword(user);
    await user.type(screen.getByLabelText('New password'), 'oldpass1');
    await user.type(screen.getByLabelText('Confirm new password'), 'oldpass1');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Choose a password different from your current one.')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  });

  it('other updateUser errors show Supabase\'s message', async () => {
    sb.auth.updateUser.mockResolvedValueOnce({ data: null, error: { message: 'Password is too weak', code: 'weak_password' } });
    const { user } = renderLogin();
    await reachNewPassword(user);
    await user.type(screen.getByLabelText('New password'), 'aaaaaa');
    await user.type(screen.getByLabelText('Confirm new password'), 'aaaaaa');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Password is too weak')).toBeInTheDocument();
  });

  it('a rate-limited code request stays on the email step and says to wait', async () => {
    sb.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { message: 'rate', code: 'over_email_send_rate_limit' } });
    const { user } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Please wait a moment before requesting another code.')).toBeInTheDocument();
    expect(heading('Reset your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeEnabled();
  });

  it('other request errors show the message, or a generic one when it is empty', async () => {
    sb.auth.resetPasswordForEmail
      .mockResolvedValueOnce({ data: null, error: { message: 'Unable to validate email address', status: 400 } })
      .mockResolvedValueOnce({ data: null, error: { message: '', status: 500 } });
    const { user } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Unable to validate email address')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('a wrong recovery code shows the shared failure message', async () => {
    sb.auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: 'expired', code: 'otp_expired' } });
    const { user } = renderLogin();
    await reachForgotCode(user);
    await user.type(screen.getByLabelText('Reset code'), '999999');
    expect(await screen.findByText(/That code is incorrect or has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set a new password' })).not.toBeInTheDocument();
  });

  it('"Use a different email" from the reset code goes back to the email step', async () => {
    const { user } = renderLogin();
    await reachForgotCode(user);
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(heading('Reset your password')).toBeInTheDocument();
  });

  it('Resend on the reset code step requests another recovery email', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    for (let i = 0; i < 60; i++) await act(async () => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await act(async () => {});
    expect(sb.auth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
    expect(sb.auth.resend).not.toHaveBeenCalled();
    expect(screen.getByText(/New code sent/)).toBeInTheDocument();
  });
});
