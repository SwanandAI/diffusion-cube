'use client';

import { InputHTMLAttributes, useState } from 'react';

// A password field with a Show/Hide toggle — takes the same props as the
// plain <input> it replaces (type and styling are managed here). Used by the
// /login forms and the delete-account dialog.
export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className="w-full rounded-lg border border-navy/15 bg-white px-3 py-2 pr-14 text-sm text-ink transition-colors focus:border-coral focus:outline-none focus:ring-1 focus:ring-coral/20 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 px-3 text-xs text-ink-soft transition-colors hover:text-coral"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
