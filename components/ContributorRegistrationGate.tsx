'use client';

import { FormEvent, useState } from 'react';
import {
  PATHWAY_ROLES,
  SHARING_OPTIONS,
  submitContributorRegistration,
  type SharingLevel,
} from '@/lib/contributor-registration';
import OrganisationInput from '@/components/OrganisationInput';
import { TERMS_PATH, legalHref } from '@/lib/legal';

// "Before you contribute to the Cube: Declaration and Terms" — T&C doc, Tab 4.
// A plain-language summary of Terms of Use §5; the full Terms govern.
const DECLARATION_POINTS = [
  "I confirm I'm authorised to represent my organisation, and that the information I provide is true and current to my knowledge.",
  "I confirm that what I share doesn't include another person's personal data without their knowledge and consent, and doesn't infringe anyone else's intellectual property or other legal rights.",
  'I grant EkStep a broad licence, worldwide, royalty-free, and including the right to sub-license, to host, process, share, and publish what I submit as part of the Cube.',
];

const SUBMISSION_TERMS = [
  {
    label: "How it's used",
    text: "What you share is processed by AI to help create a structured written account of your adoption, and reviewed by EkStep for structure and completeness before it's published. This isn't a check on accuracy, so please review it yourself before submitting.",
  },
  {
    label: 'Attribution',
    text: "Your organisation will be named wherever this account, or a learning from it, is referenced. This happens automatically and isn't something you can opt out of, since it's what gives the account its value to others.",
  },
  {
    label: 'If others contribute to it too',
    text: "Some accounts are built up by more than one organisation over time. You're only responsible for what you contributed, not for anyone else's part.",
  },
  {
    label: 'Content takedown',
    text: 'Once published, we cannot commit to fully removing it, even at your own request, since it may already be relied on elsewhere on the Cube by that point. Separately, EkStep can choose not to publish your submission, or remove it later, at its own discretion, if it turns out to be unlawful or in breach of these terms.',
  },
  {
    label: 'Your responsibility',
    text: "If anything in your declaration above turns out to be false or unauthorised, you're responsible for what follows from that, including any claim it leads to against EkStep.",
  },
];

function TermsLink({ children }: { children: React.ReactNode }) {
  // New tab, so the half-filled registration form isn't lost.
  return (
    <a
      href={legalHref(TERMS_PATH, 'contribute')}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium not-italic text-navy underline decoration-navy/30 underline-offset-2 hover:text-coral"
    >
      {children}
    </a>
  );
}

const inputClass =
  'border border-navy/15 rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:outline-none focus:border-coral focus:ring-1 focus:ring-coral/30';
const labelClass = 'font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft';
const checkboxClass = 'mt-0.5 h-4 w-4 flex-shrink-0 accent-coral';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.2em] text-coral">{children}</p>;
}

function SectionHeading({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-navy font-mono text-[11px] text-white">
        {step}
      </span>
      <h2 className="font-display text-base font-medium text-navy">{title}</h2>
    </div>
  );
}

interface Props {
  userId: string;
  userName: string;
  userEmail: string;
  userOrganisation: string;
  onRegistered: () => void;
}

export default function ContributorRegistrationGate({
  userId,
  userName,
  userEmail,
  userOrganisation,
  onRegistered,
}: Props) {
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [organisationName, setOrganisationName] = useState(userOrganisation);
  const [organisationUrl, setOrganisationUrl] = useState('');
  const [pathwayRole, setPathwayRole] = useState<string>(PATHWAY_ROLES[0]);
  const [pathwayDescription, setPathwayDescription] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [sharingLevel, setSharingLevel] = useState<SharingLevel>('none');

  function handleOrgChange(name: string, canonicalRole?: string, url?: string) {
    setOrganisationName(name);
    if (canonicalRole) setPathwayRole(canonicalRole);
    if (url) setOrganisationUrl(url);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!termsAccepted) return;
    setLoading(true);
    setError(null);

    const result = await submitContributorRegistration(userId, {
      organisationName,
      organisationUrl,
      pathwayRole,
      pocName: userName,
      pocEmail: userEmail,
      pathwayDescription,
      termsAccepted,
      sharingLevel,
    });

    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }

    onRegistered();
  }

  if (!started) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
        <Eyebrow>100 Pathways · Contribute</Eyebrow>
        <h1 className="font-display text-3xl font-medium tracking-tight text-navy">
          Register to <span className="font-serif italic text-coral">contribute</span>
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-ink-soft">
          Before you can turn a deployment into a pathway page, we need a few details about your deployment
          and your agreement to how the information you share gets used. This is one-time — you
          won&apos;t see this again after today.
        </p>
        <button
          onClick={() => setStarted(true)}
          className="mt-2 rounded-lg bg-navy px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-coral"
        >
          Click here to register
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-xl">
        <Eyebrow>100 Pathways · Contribute</Eyebrow>
        <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-navy">
          Register to <span className="font-serif italic text-coral">contribute</span>
        </h1>
        <p className="mt-1 mb-6 text-sm text-ink-soft">A one-time step before your first contribution.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-7 rounded-2xl border border-navy/10 bg-white p-6 shadow-sm sm:p-8">

          {/* Step 1: Organisation + pathway details */}
          <div className="flex flex-col gap-4">
            <SectionHeading step={1} title="Your organisation and pathway" />

            <OrganisationInput value={organisationName} onChange={handleOrgChange} label="Organisation" />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="organisationUrl" className={labelClass}>
                Organisation website — optional
              </label>
              <input
                id="organisationUrl"
                type="url"
                value={organisationUrl}
                onChange={(e) => setOrganisationUrl(e.target.value)}
                placeholder="https://…"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="pathwayRole" className={labelClass}>
                Organisation&apos;s role in this pathway
              </label>
              <select
                id="pathwayRole"
                value={pathwayRole}
                onChange={(e) => setPathwayRole(e.target.value)}
                className={inputClass}
              >
                {PATHWAY_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="pathwayDescription" className={labelClass}>
                Pathway description
              </label>
              <textarea
                id="pathwayDescription"
                required
                rows={4}
                value={pathwayDescription}
                onChange={(e) => setPathwayDescription(e.target.value)}
                placeholder="Brief description of the AI deployment you want to contribute as a pathway"
                className={inputClass + ' resize-none'}
              />
            </div>
          </div>

          {/* Step 2: Declaration and Terms — T&C doc, Tab 4 */}
          <div className="flex flex-col gap-3 border-t border-navy/10 pt-6">
            <SectionHeading step={2} title="Declaration and Terms" />
            <p className="text-[13px] leading-relaxed text-ink-soft">
              The points below summarise the relevant sections of our <TermsLink>Terms of Use</TermsLink>, which
              govern contributions in full. Please read the full Terms before contributing.
            </p>

            <div className="flex flex-col gap-2 rounded-lg bg-paper-dim p-3.5">
              <p className="font-display text-sm font-medium text-navy">Declaration</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink-soft">
                {DECLARATION_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2 rounded-lg bg-paper-dim p-3.5">
              <p className="font-display text-sm font-medium text-navy">Terms of submission</p>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] leading-relaxed text-ink-soft">
                {SUBMISSION_TERMS.map((t) => (
                  <li key={t.label}>
                    <span className="font-medium text-ink">{t.label}:</span> {t.text}
                  </li>
                ))}
              </ul>
            </div>

            <label className="flex items-start gap-2.5 text-sm italic leading-relaxed text-ink">
              <input
                type="checkbox"
                required
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className={checkboxClass}
              />
              <span>
                I&apos;ve read and agree to the <TermsLink>Terms of Use</TermsLink>.
              </span>
            </label>
          </div>

          {/* Step 3: Personal sharing preference — also editable later from /account */}
          <div className="flex flex-col gap-3 border-t border-navy/10 pt-6">
            <SectionHeading step={3} title="Sharing your contact details" />
            <p className="text-[13px] italic leading-relaxed text-ink-soft">
              Separate from your organisation&apos;s attribution above — this is about whether Explorers can see who
              to reach out to, personally, when your pathway is cited.
            </p>
            <div className="flex flex-col gap-2.5">
              {SHARING_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-start gap-2.5 rounded-lg border border-navy/10 px-3 py-2.5 text-sm text-ink transition-colors hover:border-coral/30"
                >
                  <input
                    type="radio"
                    name="sharingLevel"
                    checked={sharingLevel === opt.value}
                    onChange={() => setSharingLevel(opt.value)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-coral"
                  />
                  <span>
                    <span className="block font-medium">{opt.label}</span>
                    <span className="block text-xs text-ink-soft">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-coral">{error}</p>}

          <button
            type="submit"
            disabled={loading || !termsAccepted}
            className="rounded-xl bg-navy py-3 text-sm font-medium text-white transition-colors hover:bg-coral disabled:opacity-60"
          >
            {loading ? 'Submitting…' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
}
