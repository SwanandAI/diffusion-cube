import LegalDocument from '@/components/LegalDocument';

export const metadata = { title: 'Privacy Notice · Diffusion Cube' };

export default function PrivacyPage() {
  return <LegalDocument file="privacy" title="Privacy Notice" versionLine="Version 1.0 · Last updated: 18-Sep-26" />;
}
