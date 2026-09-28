import { readFile } from 'fs/promises';
import path from 'path';
import { Suspense } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import LegalBackLink from '@/components/LegalBackLink';
import WikiMarkdown from '@/components/WikiMarkdown';
import { PRIVACY_PATH, TERMS_PATH, withSupportEmail } from '@/lib/legal';

interface Props {
  // Basename under content/legal/ (terms | privacy).
  file: 'terms' | 'privacy';
  title: string;
  versionLine: string;
}

// Public, no-login page for the Terms of Use and Privacy Notice (both listed
// in proxy.ts's PUBLIC_PATHS) — linked from the Sign up and Register to
// Contribute acceptance checkboxes, so it has to render for an anonymous
// visitor mid-sign-up. Standalone rather than inside AppShell for the same
// reason as /login.
export default async function LegalDocument({ file, title, versionLine }: Props) {
  const markdown = await readFile(path.join(process.cwd(), 'content', 'legal', `${file}.md`), 'utf-8');

  return (
    <div className="min-h-screen bg-paper">
      {/* Suspense: LegalBackLink reads ?from=, and this page is prerendered static. */}
      <SiteHeader
        back={
          <Suspense fallback={null}>
            <LegalBackLink />
          </Suspense>
        }
      />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-coral">100 Pathways · Diffusion Cube</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-navy">{title}</h1>
        <p className="mt-1 font-serif text-sm italic text-ink-soft">{versionLine}</p>

        <article className="mt-6 rounded-2xl border border-navy/10 bg-white p-6 sm:p-8">
          <WikiMarkdown markdown={withSupportEmail(markdown)} links />
        </article>

        <nav className="mt-6 flex gap-4 text-xs text-ink-soft">
          <Link href={TERMS_PATH} className="transition hover:text-coral">Terms of Use</Link>
          <Link href={PRIVACY_PATH} className="transition hover:text-coral">Privacy Notice</Link>
        </nav>
      </main>
    </div>
  );
}
