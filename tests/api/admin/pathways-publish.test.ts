import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type MockResponse, type QueryOp, type SupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { assetId, routeOps, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/email', () => ({
  CUBE_APP_URL: 'https://cube.100pathways.com',
  sendContributionEmail: vi.fn(async () => undefined),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendContributionEmail } from '@/lib/email';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { POST } from '@/app/api/admin/pathways/publish/route';

const URL = 'http://localhost/api/admin/pathways/publish';
const LIVE = assetId();
const WAITING = assetId();
const ALREADY_LIVE = assetId();

const DOC = `---
title: Farmer Advisory Bot
description: How a state rolled out an AI advisory line
stage: pilot
sector: Agriculture
location: Maharashtra, India
tags: [agri, voice, extension]
---

# Farmer Advisory Bot

<!-- toolkit-assets:start -->
<!-- asset-id: ${LIVE} -->
<!-- toolkit-assets:end -->
`;

let admin: SupabaseMock;

function post(body: unknown) {
  return POST(new NextRequest(jsonRequest(URL, body)));
}

function signInAs(email: string | null, roles: string[] = []) {
  const sb = email === null ? sessionMock(null) : sessionMock({ id: 'caller', email }, roles);
  vi.mocked(createClient).mockResolvedValue(sb.client);
}

interface Setup {
  pathway?: MockResponse;
  upsert?: MockResponse;
  assetsUpdate?: MockResponse;
  doc?: MockResponse;
}

function useAdmin(setup: Setup = {}) {
  const pathway = setup.pathway ?? {
    data: {
      id: 'p1',
      slug: 'farmer-advisory-bot',
      title: 'DB title',
      sector: 'DB sector',
      content_cache: DOC,
      assembled_design_doc_id: 'doc-1',
    },
  };
  admin = createSupabaseMock({
    tables: {
      pathways: (op: QueryOp) => (op.action === 'select' ? pathway : {}),
      published_pathways: setup.upsert ?? {},
      contribution_units: (op: QueryOp) =>
        op.action === 'update'
          ? setup.assetsUpdate ?? {}
          : {
              data: [
                { unit_internal_id: LIVE, asset_name: 'Call script', published_at: null },
                { unit_internal_id: WAITING, asset_name: 'Rollout checklist', published_at: null },
                { unit_internal_id: ALREADY_LIVE, asset_name: 'Old playbook', published_at: '2026-01-01' },
              ],
            },
      design_documents: setup.doc ?? { data: { design_id: 'design-9', user_id: 'contrib-1' } },
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => useAdmin());

describe('POST /api/admin/pathways/publish — access', () => {
  it('403s an anonymous caller', async () => {
    signInAs(null);
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Admin only.' });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it.each([[[]], [['adopter']], [['adopter', 'pathway_contributor']]])(
    '403s a signed-in non-admin holding %j',
    async (roles) => {
      signInAs('contrib@example.com', roles);
      const res = await post({ pathway_id: 'p1' });
      expect(res.status).toBe(403);
      expect(routeOps(admin)).toHaveLength(0);
    }
  );

  it('lets an ADMIN_EMAILS address publish', async () => {
    signInAs('env-admin@example.com');
    expect((await post({ pathway_id: 'p1' })).status).toBe(200);
  });

  it('lets an admin role row publish', async () => {
    signInAs('db-admin@example.com', ['admin']);
    expect((await post({ pathway_id: 'p1' })).status).toBe(200);
  });
});

describe('POST /api/admin/pathways/publish — validation', () => {
  beforeEach(() => signInAs('env-admin@example.com'));

  it.each([
    ['missing pathway_id', {}],
    ['empty pathway_id', { pathway_id: '' }],
    ['null pathway_id', { pathway_id: null }],
  ])('400s %s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'pathway_id required.' });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('400s a malformed JSON body (parsed as {})', async () => {
    const res = await post('{{{');
    expect(res.status).toBe(400);
  });

  it('404s a pathway that does not exist', async () => {
    useAdmin({ pathway: { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } } });
    const res = await post({ pathway_id: 'nope' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Pathway not found.' });
    expect(admin.ops('published_pathways')).toHaveLength(0);
  });

  it('400s a pathway with no assembled document', async () => {
    useAdmin({
      pathway: { data: { id: 'p1', slug: 's', title: 't', sector: null, content_cache: null, assembled_design_doc_id: null } },
    });
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(400);
    expect(admin.ops('published_pathways')).toHaveLength(0);
    expect(sendContributionEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/pathways/publish — happy path', () => {
  beforeEach(() => signInAs('env-admin@example.com'));

  it('upserts the card from frontmatter, keyed on slug, credited to the admin', async () => {
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slug: 'farmer-advisory-bot', assetsPublished: true });

    const [select] = admin.ops('pathways', 'select');
    expect(select.filters).toEqual([['eq', 'id', 'p1']]);

    const [upsert] = admin.ops('published_pathways', 'upsert');
    expect(upsert.payload).toEqual({
      slug: 'farmer-advisory-bot',
      title: 'Farmer Advisory Bot',
      description: 'How a state rolled out an AI advisory line',
      category: 'agri · voice',
      content: DOC,
      sector: 'Agriculture',
      location: 'Maharashtra, India',
      tags: ['agri', 'voice', 'extension'],
      stage: 'pilot',
      published_by: 'caller',
    });
    expect(upsert.options).toEqual({ onConflict: 'slug' });
  });

  it('clears the review request and points published_design_doc_id at the reviewed draft', async () => {
    await post({ pathway_id: 'p1' });
    const [update] = admin.ops('pathways', 'update');
    expect(update.payload).toEqual({ review_requested: false, published_design_doc_id: 'doc-1' });
    expect(update.filters).toEqual([['eq', 'id', 'p1']]);
  });

  it('publishes exactly the assets listed in the document, only this pathway\'s, only unpublished ones', async () => {
    await post({ pathway_id: 'p1' });
    const [update] = admin.ops('contribution_units', 'update');
    expect(update.payload).toEqual({ published_at: expect.any(String) });
    expect(update.filters).toEqual([
      ['eq', 'pathway_id', 'p1'],
      ['eq', 'unit_type', 'toolkit-asset'],
      ['is', 'published_at', null],
      ['in', 'unit_internal_id', [LIVE]],
    ]);
  });

  it('emails the contributor which assets went live and which are still waiting', async () => {
    await post({ pathway_id: 'p1' });
    expect(admin.ops('design_documents', 'select')[0].filters).toEqual([['eq', 'id', 'doc-1']]);
    expect(admin.auth.admin.getUserById).toHaveBeenCalledWith('contrib-1');
    expect(sendContributionEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendContributionEmail).mock.calls[0][0];
    expect(mail.to).toBe('contrib-1@example.com');
    expect(mail.subject).toBe('Your pathway "Farmer Advisory Bot" is published');
    expect(mail.paragraphs.join('\n')).toContain('Published with it, and downloadable by anyone: Call script.');
    expect(mail.paragraphs.join('\n')).toContain('Not published yet: Rollout checklist.');
    expect(mail.paragraphs.join('\n')).not.toContain('Old playbook');
    expect(mail.link).toEqual({ url: 'https://cube.100pathways.com/contribute?open=design-9', label: 'Open your contribution' });
  });

  it('falls back to the pathway row and "Community" when the document has no frontmatter', async () => {
    useAdmin({
      pathway: {
        data: { id: 'p1', slug: 'plain', title: 'DB title', sector: 'DB sector', content_cache: '# Body only', assembled_design_doc_id: null },
      },
    });
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(200);
    const [upsert] = admin.ops('published_pathways', 'upsert');
    expect(upsert.payload).toMatchObject({
      title: 'DB title',
      description: '',
      sector: 'DB sector',
      category: 'Community',
      tags: [],
      stage: '',
      location: '',
    });
    // No assets listed → no asset update; no assembled draft → no email.
    expect(admin.ops('contribution_units', 'update')).toHaveLength(0);
    expect(admin.ops('pathways', 'update')[0].payload).toEqual({ review_requested: false, published_design_doc_id: null });
    expect(sendContributionEmail).not.toHaveBeenCalled();
  });

  it('is idempotent on re-publish: the same upsert key, assets guarded on published_at is null', async () => {
    await post({ pathway_id: 'p1' });
    await post({ pathway_id: 'p1' });
    const upserts = admin.ops('published_pathways', 'upsert');
    expect(upserts).toHaveLength(2);
    expect(upserts[1].payload).toEqual(upserts[0].payload);
    for (const op of admin.ops('contribution_units', 'update')) {
      expect(op.filters).toContainEqual(['is', 'published_at', null]);
    }
  });
});

describe('POST /api/admin/pathways/publish — downstream failures', () => {
  beforeEach(() => signInAs('env-admin@example.com'));

  it('hides an upsert failure behind the generic 500 and stops there', async () => {
    useAdmin({ upsert: { error: { message: 'permission denied for table published_pathways' } } });
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
    expect(admin.ops('contribution_units', 'update')).toHaveLength(0);
    expect(sendContributionEmail).not.toHaveBeenCalled();
  });

  it('still publishes the pathway but reports assetsPublished=false when the asset update fails', async () => {
    useAdmin({ assetsUpdate: { error: { message: 'deadlock detected' } } });
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, slug: 'farmer-advisory-bot', assetsPublished: false });
    expect(JSON.stringify(body)).not.toContain('deadlock');
  });

  it('answers 200 even when the contributor email throws', async () => {
    vi.mocked(sendContributionEmail).mockRejectedValueOnce(new Error('SMTP 535 auth failed'));
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('SMTP');
  });

  it('skips the email when the contributor account has no email', async () => {
    admin.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: { id: 'contrib-1' } }, error: null } as never);
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(200);
    expect(sendContributionEmail).not.toHaveBeenCalled();
  });

  it('skips the email when the reviewed draft has no owner (deleted account)', async () => {
    useAdmin({ doc: { data: { design_id: 'design-9', user_id: null } } });
    const res = await post({ pathway_id: 'p1' });
    expect(res.status).toBe(200);
    expect(sendContributionEmail).not.toHaveBeenCalled();
  });
});
