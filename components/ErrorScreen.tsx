import Link from 'next/link';

// The full-page message behind app/error.tsx, app/global-error.tsx and
// app/not-found.tsx. Never shows an error's own text or stack — callers pass
// only the copy the user should see.
export default function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
        <h1 className="font-display text-xl font-medium text-navy">{title}</h1>
        <p className="mt-3 text-sm text-ink-soft">{message}</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-coral"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
