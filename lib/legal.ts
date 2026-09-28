// Client-safe legal constants shared by the /terms and /privacy pages and the
// two places a user accepts them: Sign up (app/login/page.tsx) and Register
// to Contribute (components/ContributorRegistrationGate.tsx). The documents
// themselves live in content/legal/*.md.

// Stored with each sign-up acceptance (auth user_metadata.terms_version), so a
// later "re-accept updated terms" prompt can tell who agreed to which version.
// Bump when content/legal/terms.md or privacy.md change materially.
export const LEGAL_VERSION = '1.0';

// "Contact Us" address in both documents ({{SUPPORT_EMAIL}} in the markdown).
// The Grievance Officer's own email is written literally in the documents —
// that's a named, legally designated contact, not the general inbox.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'kamesh@ekstep.org';

export const TERMS_PATH = '/terms';
export const PRIVACY_PATH = '/privacy';

// Where a legal page was opened from, carried as ?from= so its Back link can
// return there instead of to 100pathways.com (components/LegalBackLink.tsx).
export const LEGAL_BACK_TARGETS = {
  signup: '/login?mode=signup',
  contribute: '/contribute',
} as const;
export type LegalFrom = keyof typeof LEGAL_BACK_TARGETS;

export function isLegalFrom(value: unknown): value is LegalFrom {
  return typeof value === 'string' && value in LEGAL_BACK_TARGETS;
}

export function legalHref(path: string, from: LegalFrom): string {
  return `${path}?from=${from}`;
}

export function withSupportEmail(markdown: string): string {
  return markdown.replaceAll('{{SUPPORT_EMAIL}}', SUPPORT_EMAIL);
}
