'use client';

import { useEffect } from 'react';
import ErrorScreen from '@/components/ErrorScreen';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { reportClientError } from '@/lib/client-error-report';

// Any page segment that throws while rendering, on the server or in the
// browser, lands here. Shows the customer's generic message — never the
// error's own text — and records browser-side errors in sys_errors.
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return <ErrorScreen title="Something went wrong" message={GENERIC_ERROR_MESSAGE} />;
}
