import Link from 'next/link';

// Mirrors the Diffusion Library's header exactly — the back-link to the main
// 100 Pathways site plus the "100 Pathways / <tool>" lockup is what makes
// this app read as part of the same family rather than a separate product.
// `back` replaces the default Back link (the legal pages use a smarter one).
export default function SiteHeader({ children, back }: { children?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-navy/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-lg font-medium tracking-tight text-navy">100 Pathways</span>
          <span className="hidden text-sm text-ink-soft sm:inline">/ Diffusion Cube</span>
        </Link>
        <span className="text-navy/15">|</span>
        {back ?? (
          <a
            href="https://100pathways.com/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-navy transition hover:text-coral"
          >
            <span aria-hidden>←</span> Back
          </a>
        )}
        {children && <div className="ml-auto flex items-center gap-3">{children}</div>}
      </div>
    </header>
  );
}
