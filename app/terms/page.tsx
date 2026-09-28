import LegalDocument from '@/components/LegalDocument';

export const metadata = { title: 'Terms of Use · Diffusion Cube' };

export default function TermsPage() {
  return <LegalDocument file="terms" title="Terms of Use" versionLine="Version 1.0 · Last updated: 18-Sep-26" />;
}
