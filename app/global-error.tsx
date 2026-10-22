'use client';

import { useEffect } from 'react';
import './globals.css';
import ErrorScreen from '@/components/ErrorScreen';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { reportClientError } from '@/lib/client-error-report';

// Replaces the root layout when the layout itself fails, so it brings its own
// <html>/<body> and styles. Same message and reporting as app/error.tsx.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <title>Diffusion Cube | 100 Pathways</title>
        <ErrorScreen title="Something went wrong" message={GENERIC_ERROR_MESSAGE} />
      </body>
    </html>
  );
}
