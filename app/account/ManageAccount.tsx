'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SHARING_OPTIONS, type SharingLevel } from '@/lib/contributor-registration';
import OrganisationInput from '@/components/OrganisationInput';
import DeleteAccountButton from '@/components/DeleteAccountButton';
import { showToast } from '@/lib/toast';

const inputClass =
  'border border-navy/15 rounded-lg px-3 py-2.5 text-sm text-ink transition-colors focus:outline-none focus:border-coral focus:ring-1 focus:ring-coral/30';
const labelClass = 'font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft';
const saveButtonClass =
  'self-start rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-coral disabled:opacity-60 disabled:hover:bg-navy';

function Section({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section
      className={`flex flex-col gap-4 rounded-2xl border bg-white p-6 shadow-sm sm:p-8 ${
        danger ? 'border-coral/30' : 'border-navy/10'
      }`}
    >
      <h2 className={`font-display text-base font-medium ${danger ? 'text-coral' : 'text-navy'}`}>{title}</h2>
      {children}
    </section>
  );
}

interface Props {
  email: string;
  name: string;
  organisation: string;
  // null → not an approved contributor; the Contact sharing section is hidden.
  sharingLevel: SharingLevel | null;
}

export default function ManageAccount({ email, name: initialName, organisation: initialOrganisation, sharingLevel: initialSharing }: Props) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [organisation, setOrganisation] = useState(initialOrganisation);
  const [savedProfile, setSavedProfile] = useState({ name: initialName, organisation: initialOrganisation });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [sharing, setSharing] = useState<SharingLevel | null>(initialSharing);
  const [savedSharing, setSavedSharing] = useState<SharingLevel | null>(initialSharing);
  const [savingSharing, setSavingSharing] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);

  const profileDirty = name.trim() !== savedProfile.name || organisation.trim() !== savedProfile.organisation;

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    const nextName = name.trim();
    const nextOrganisation = organisation.trim();
    if (!nextName) {
      setProfileError('Enter your name.');
      return;
    }
    setSavingProfile(true);
    setProfileError(null);

    // Same user_metadata keys sign-up writes (app/login/page.tsx); Supabase
    // merges `data` into the existing metadata, so the T&C acceptance
    // fields stored alongside are left untouched.
    const { error } = await createClient().auth.updateUser({
      data: { name: nextName, organization: nextOrganisation },
    });
    setSavingProfile(false);
    if (error) {
      setProfileError('Could not save your details. Please try again.');
      return;
    }
    setName(nextName);
    setOrganisation(nextOrganisation);
    setSavedProfile({ name: nextName, organisation: nextOrganisation });
    showToast('Profile updated successfully.');
    router.refresh();
  }

  async function handleSaveSharing(e: FormEvent) {
    e.preventDefault();
    if (!sharing || sharing === savedSharing) return;
    setSavingSharing(true);
    setSharingError(null);

    let res: Response;
    try {
      res = await fetch('/api/account/contact-sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharingLevel: sharing }),
      });
    } catch {
      setSavingSharing(false);
      setSharingError('Network error. Please try again.');
      return;
    }
    setSavingSharing(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      setSharingError(error || 'Could not save your choice. Please try again.');
      return;
    }
    setSavedSharing(sharing);
    showToast('Contact sharing updated successfully.');
  }

  return (
    <div className="flex-1 overflow-y-auto bg-paper p-4 sm:p-8">
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-coral">100 Pathways · Account</p>
          <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-navy">
            Manage <span className="font-serif italic text-coral">account</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{email}</p>
        </div>

        {/* 1. Profile */}
        <Section title="Profile">
          <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="account-name" className={labelClass}>Name</label>
              <input
                id="account-name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </div>

            <OrganisationInput value={organisation} onChange={(n) => setOrganisation(n)} label="Organisation" />

            {profileError && <p className="text-xs text-coral">{profileError}</p>}

            <button type="submit" disabled={savingProfile || !profileDirty} className={saveButtonClass}>
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </Section>

        {/* 2. Contact sharing — approved contributors only */}
        {sharing && (
          <Section title="Contact sharing">
            <form onSubmit={handleSaveSharing} className="flex flex-col gap-4">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Whether Explorers can see who to reach out to, personally, when your pathway is cited.
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
                      checked={sharing === opt.value}
                      onChange={() => setSharing(opt.value)}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 accent-coral"
                    />
                    <span>
                      <span className="block font-medium">{opt.label}</span>
                      <span className="block text-xs text-ink-soft">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="rounded-lg bg-paper-dim p-3 text-xs leading-relaxed text-ink-soft">
                This change only applies going forward, and does not change what&apos;s already been shown for a
                Pathway published before you made the change.
              </p>

              {sharingError && <p className="text-xs text-coral">{sharingError}</p>}

              <button type="submit" disabled={savingSharing || sharing === savedSharing} className={saveButtonClass}>
                {savingSharing ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </Section>
        )}

        {/* 3. Danger zone */}
        <Section title="Danger zone" danger>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Permanently delete your account, your profile details, and all your chats. This can&apos;t be undone.
            Any Pathway already published from your contribution stays live.
          </p>
          <DeleteAccountButton variant="danger" />
        </Section>
      </div>
    </div>
  );
}
