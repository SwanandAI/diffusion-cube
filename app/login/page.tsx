'use client';

import { FormEvent, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import OrganisationInput from '@/components/OrganisationInput';

const inputClass =
  'border border-navy/15 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-coral focus:ring-1 focus:ring-coral/20 transition-colors';
const labelClass = 'text-xs text-ink-soft';
const primaryButtonClass =
  'mt-2 bg-navy hover:bg-coral disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-medium transition-colors';
const linkButtonClass = 'text-xs text-ink-soft hover:text-coral transition-colors disabled:opacity-60';

// Must match "Email OTP Length" in Supabase → Auth → Providers → Email.
const OTP_LENGTH = 6;
// Supabase refuses a second email of the same kind to the same address within
// 60s, so the resend button is held for the same window rather than letting
// the user hit a rate-limit error.
const RESEND_COOLDOWN_SECONDS = 60;
// After this many consecutive wrong codes, nudge towards requesting a new one.
const FAILED_ATTEMPTS_BEFORE_NUDGE = 5;
const MIN_PASSWORD_LENGTH = 6;

function isRateLimited(err: { status?: number; code?: string } | null) {
  return err?.status === 429 || err?.code === 'over_email_send_rate_limit' || err?.code === 'over_request_rate_limit';
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';

  // Sign-up and password reset are both code-based and run on this page (see
  // SIGNUP_OTP_SPEC.md):
  //   signup: details → verify (code) → /explore
  //   forgot: email → code → new password → `next`
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [signupStep, setSignupStep] = useState<'details' | 'verify'>('details');
  const [forgotStep, setForgotStep] = useState<'email' | 'code' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [code, setCode] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Which code screen (if any) is showing — the two share one UI.
  const codePurpose: 'signup' | 'recovery' | null =
    mode === 'signup' && signupStep === 'verify'
      ? 'signup'
      : mode === 'forgot' && forgotStep === 'code'
        ? 'recovery'
        : null;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (codePurpose) codeInputRef.current?.focus();
  }, [codePurpose]);

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  function switchMode(nextMode: 'signin' | 'signup' | 'forgot') {
    setMode(nextMode);
    setSignupStep('details');
    setForgotStep('email');
    setCode('');
    setPassword('');
    setConfirmation('');
    resetMessages();
  }

  function startCodeEntry(message: string | null) {
    setCode('');
    setFailedAttempts(0);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setNotice(message);
  }

  function enterSignupVerifyStep(message: string | null) {
    setMode('signup');
    setSignupStep('verify');
    startCodeEntry(message);
  }

  // ── Sign in ──────────────────────────────────────────────────────────────

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    resetMessages();

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // An abandoned sign-up: the account exists but the OTP was never
      // entered. Send a fresh code and pick up where they left off.
      if (error.code === 'email_not_confirmed') {
        const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
        setLoading(false);
        enterSignupVerifyStep(
          resendError
            ? "Your email isn't verified yet. Enter the code we sent you, or request a new one."
            : "Your email isn't verified yet. We've sent you a new code."
        );
        return;
      }
      setLoading(false);
      setError(error.message);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  // ── Sign up ──────────────────────────────────────────────────────────────

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    resetMessages();

    // With "Confirm email" on, this creates an unconfirmed user (no session)
    // and Supabase emails it an OTP. The account only becomes usable once
    // that code is verified below.
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, organization } },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // Supabase's anti-enumeration response for an address that already has a
    // confirmed account: a masked "success" with no identities, and no email
    // is sent — so there's no code to wait for.
    if (data.user && data.user.identities?.length === 0) {
      switchMode('signin');
      setError('An account with this email already exists. Sign in instead.');
      return;
    }

    // "Confirm email" turned off in Supabase (e.g. rolled back): signUp hands
    // back a live session and no code is sent, so skip the verify step.
    if (data.session) {
      await completeSignup();
      return;
    }

    enterSignupVerifyStep(null);
  }

  async function completeSignup() {
    // Grant the adopter role now that there's a verified session, so the
    // account can use Analyse without an admin approval step. A failure here
    // is non-fatal — the user still ends up on /explore (which needs no
    // role), and an admin can grant it manually later; they'd just see the
    // "Ask an admin" screen on /analyse in the meantime.
    await fetch('/api/auth/grant-default-role', { method: 'POST' }).catch(() => {});

    // A fresh signup always lands on /explore — it's open with no approval
    // needed, so it's the one place a pending account has something to do
    // while waiting, rather than landing back on whatever gated page sent
    // them here (see `next`, which sign-IN above still honors).
    router.replace('/explore');
    router.refresh();
  }

  // ── Forgot password ──────────────────────────────────────────────────────

  // Sends (or re-sends) the recovery code. Supabase answers the same way
  // whether or not an account exists for the address, so the UI moves on to
  // the code step either way and never reveals which it was.
  async function sendRecoveryCode(): Promise<boolean> {
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (resetError) {
      setError(
        isRateLimited(resetError)
          ? 'Please wait a moment before requesting another code.'
          : resetError.message || 'Something went wrong. Please try again.'
      );
      if (isRateLimited(resetError)) setResendCooldown(RESEND_COOLDOWN_SECONDS);
      return false;
    }
    return true;
  }

  async function handleForgotRequest(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    resetMessages();
    const sent = await sendRecoveryCode();
    setLoading(false);
    if (!sent) return;
    setForgotStep('code');
    startCodeEntry(null);
  }

  async function handleNewPassword(e: FormEvent) {
    e.preventDefault();
    resetMessages();

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    // The recovery code already signed the user in (verifyOtp below), so this
    // is an ordinary authenticated password change.
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      setError(
        updateError.code === 'same_password'
          ? 'Choose a password different from your current one.'
          : updateError.message
      );
      return;
    }

    router.replace(next);
    router.refresh();
  }

  // ── Shared code step (sign-up verification and password recovery) ────────

  async function verifyCode(token: string) {
    if (!codePurpose) return;
    if (token.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code from your email.`);
      return;
    }
    setLoading(true);
    resetMessages();

    const supabase = createClient();
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: codePurpose === 'signup' ? 'email' : 'recovery',
    });

    if (verifyError || !data.session) {
      setLoading(false);
      setCode('');
      codeInputRef.current?.focus();
      if (isRateLimited(verifyError)) {
        setError('Too many attempts. Please wait a few minutes, then request a new code.');
        return;
      }
      // Supabase returns the same otp_expired error for a wrong code and an
      // expired one, so the message covers both.
      const attempts = failedAttempts + 1;
      setFailedAttempts(attempts);
      setError(
        'That code is incorrect or has expired. Check it and try again, or request a new code.' +
          (attempts >= FAILED_ATTEMPTS_BEFORE_NUDGE ? ' Still not working? Request a new code below.' : '')
      );
      return;
    }

    if (codePurpose === 'signup') {
      await completeSignup();
      return;
    }

    setLoading(false);
    setPassword('');
    setConfirmation('');
    setForgotStep('password');
  }

  async function handleResend() {
    setLoading(true);
    resetMessages();

    let ok: boolean;
    if (codePurpose === 'recovery') {
      ok = await sendRecoveryCode();
    } else {
      const supabase = createClient();
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
      ok = !resendError;
      if (resendError) {
        if (isRateLimited(resendError)) {
          setResendCooldown(RESEND_COOLDOWN_SECONDS);
          setError('Please wait a moment before requesting another code.');
        } else {
          setError('Something went wrong. Please try again.');
        }
      }
    }
    setLoading(false);
    if (!ok) return;

    // Supabase replaces the stored token, so any earlier code is now dead.
    startCodeEntry('New code sent. Use the latest one; earlier codes no longer work.');
    codeInputRef.current?.focus();
  }

  function handleCodeChange(value: string) {
    // Accept pasted codes with spaces/dashes; keep digits only.
    const digits = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (digits.length === OTP_LENGTH && !loading) void verifyCode(digits);
  }

  function leaveCodeStep() {
    setCode('');
    resetMessages();
    if (codePurpose === 'recovery') setForgotStep('email');
    else setSignupStep('details');
  }

  // ── Render ───────────────────────────────────────────────────────────────

  let content: ReactNode;

  if (codePurpose) {
    content = (
      <form
        onSubmit={(e) => { e.preventDefault(); void verifyCode(code); }}
        className="flex flex-col gap-4"
      >
        <h2 className="font-display text-lg font-medium text-navy">Check your email</h2>

        <p className="text-sm text-ink">
          {codePurpose === 'signup' ? (
            <>We sent a {OTP_LENGTH}-digit code to <strong className="font-medium text-navy">{email}</strong>.</>
          ) : (
            <>If an account exists for <strong className="font-medium text-navy">{email}</strong>, we&apos;ve sent it a {OTP_LENGTH}-digit code to reset your password.</>
          )}{' '}
          It expires in 10 minutes.
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="otp-code" className={labelClass}>
            {codePurpose === 'signup' ? 'Verification code' : 'Reset code'}
          </label>
          <input
            ref={codeInputRef}
            id="otp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={OTP_LENGTH + 4}
            required
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            className={`${inputClass} font-mono text-lg tracking-[0.4em] text-center`}
          />
        </div>

        {notice && <p className="text-xs text-ink-soft">{notice}</p>}
        {error && <p className="text-xs text-coral">{error}</p>}

        <button type="submit" disabled={loading || code.length !== OTP_LENGTH} className={primaryButtonClass}>
          {loading ? 'Please wait…' : codePurpose === 'signup' ? 'Verify' : 'Continue'}
        </button>

        <p className="text-xs text-ink-soft text-center">
          Can&apos;t find it? Check your spam or promotions folder.
        </p>

        <button
          type="button"
          onClick={handleResend}
          disabled={loading || resendCooldown > 0}
          className={`text-xs transition-colors disabled:opacity-60 ${
            failedAttempts >= FAILED_ATTEMPTS_BEFORE_NUDGE ? 'text-coral font-medium' : 'text-ink-soft hover:text-coral'
          }`}
        >
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
        </button>

        <button type="button" onClick={leaveCodeStep} disabled={loading} className={linkButtonClass}>
          Use a different email
        </button>
      </form>
    );
  } else if (mode === 'forgot' && forgotStep === 'password') {
    content = (
      <form onSubmit={handleNewPassword} className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-medium text-navy">Set a new password</h2>

        <p className="text-sm text-ink">
          Code confirmed for <strong className="font-medium text-navy">{email}</strong>. Choose a new password.
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="new-password" className={labelClass}>New password</label>
          <input
            id="new-password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="confirm-password" className={labelClass}>Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && <p className="text-xs text-coral">{error}</p>}

        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    );
  } else if (mode === 'forgot') {
    content = (
      <form onSubmit={handleForgotRequest} className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-medium text-navy">Reset your password</h2>

        <p className="text-sm text-ink">
          Enter your account email and we&apos;ll send you a {OTP_LENGTH}-digit code.
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="forgot-email" className={labelClass}>Email</label>
          <input
            id="forgot-email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && <p className="text-xs text-coral">{error}</p>}

        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? 'Please wait…' : 'Send code'}
        </button>

        <button type="button" onClick={() => switchMode('signin')} className={linkButtonClass}>
          Back to sign in
        </button>
      </form>
    );
  } else if (mode === 'signin') {
    content = (
      <form onSubmit={handleSignIn} className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-medium text-navy">Sign in</h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className={labelClass}>Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className={labelClass}>Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && <p className="text-xs text-coral">{error}</p>}

        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? 'Please wait…' : 'Sign in'}
        </button>

        <button type="button" onClick={() => switchMode('forgot')} disabled={loading} className={linkButtonClass}>
          Forgot password?
        </button>

        <button type="button" onClick={() => switchMode('signup')} className={linkButtonClass}>
          Don&apos;t have an account? Sign up
        </button>
      </form>
    );
  } else {
    content = (
      <form onSubmit={handleSignUp} className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-medium text-navy">Sign up</h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="name" className={labelClass}>Name</label>
          <input
            id="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="request-email" className={labelClass}>Email</label>
          <input
            id="request-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>

        <OrganisationInput value={organization} onChange={(name) => setOrganization(name)} label="Organisation" />

        <div className="flex flex-col gap-1">
          <label htmlFor="request-password" className={labelClass}>Password</label>
          <input
            id="request-password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && <p className="text-xs text-coral">{error}</p>}

        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? 'Please wait…' : 'Sign up'}
        </button>

        <button type="button" onClick={() => switchMode('signin')} className={linkButtonClass}>
          Already have an account? Sign in
        </button>
      </form>
    );
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-coral">100 Pathways</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-navy">
          Diffusion <span className="font-serif italic text-coral">Cube</span>
        </h1>
      </div>

      <div className="w-full max-w-sm bg-white border border-navy/10 rounded-2xl p-8 flex flex-col gap-4">
        {content}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
