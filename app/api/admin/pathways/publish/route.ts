import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { assetIdsInDocument } from '@/lib/toolkit-assets';
import { loadPathwayToolkitAssets } from '@/lib/toolkit-assets-server';
import { CUBE_APP_URL, sendContributionEmail } from '@/lib/email';
import { latestVersion, publishVersion } from '@/lib/pathway-store';

import { withErrorHandling } from '@/lib/errors';
// Publishes the pathway's latest version — the document its contributor last
// sent for review — so it appears in the Explore library and grounds Analyse
// conversations, on the next request (docs/features/pathway-storage/).
// lib/pathway-store.ts points the pathway at that version, copies the card
// fields from its frontmatter, and indexes its micro-innovation units for
// search. Units whose labels aren't valid are skipped and returned as
// `skippedUnits`, so the admin panel can say which; the rest of the pathway
// is published regardless.
async function handlePOST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isAdmin(supabase, user.email))) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { pathway_id } = body as { pathway_id?: string };
  if (!pathway_id) return NextResponse.json({ error: 'pathway_id required.' }, { status: 400 });

  const admin = createAdminClient();

  const { data: pathway, error } = await admin
    .from('pathways')
    .select('id, slug, title, assembled_design_doc_id')
    .eq('id', pathway_id)
    .single();

  if (error || !pathway) {
    return NextResponse.json({ error: 'Pathway not found.' }, { status: 404 });
  }

  const version = await latestVersion(pathway_id, admin);
  if (!version) {
    return NextResponse.json(
      { error: 'No assembled document found. The contributor must publish from their workspace first.' },
      { status: 400 }
    );
  }

  const published = await publishVersion({ pathwayId: pathway_id, versionId: version.id, publishedBy: user.id }, admin);
  const title = published.title;

  await admin.from('pathways').update({
    review_requested: false,
    published_design_doc_id: pathway.assembled_design_doc_id ?? null,
  }).eq('id', pathway_id);

  // Toolkit assets ride the pathway's own approval: publish exactly the
  // assets listed in the document the admin just reviewed and published
  // (their <!-- asset-id --> markers, written by assemble), and only this
  // pathway's. An asset shared after the last Send for Review isn't in the
  // document, so it waits for the next round. Idempotent on re-publish.
  let assetsPublished = true;
  const assetIds = assetIdsInDocument(version.content);
  if (assetIds.length > 0) {
    const { error: assetsErr } = await admin
      .from('contribution_units')
      .update({ published_at: new Date().toISOString() })
      .eq('pathway_id', pathway_id)
      .eq('unit_type', 'toolkit-asset')
      .is('published_at', null)
      .in('unit_internal_id', assetIds);
    if (assetsErr) {
      console.error('[admin/pathways/publish] toolkit assets:', assetsErr);
      assetsPublished = false;
    }
  }

  await notifyContributor(admin, {
    pathwayId: pathway_id,
    title,
    assembledDocId: pathway.assembled_design_doc_id,
    assetIds,
  });

  return NextResponse.json({
    ok: true,
    slug: pathway.slug,
    assetsPublished,
    skippedUnits: published.skippedUnits,
    embedded: published.embedded,
  });
}

// Tells the contributor whose draft was just approved that it's live, which
// toolkit assets went live with it, and which shared ones didn't (shared
// after they last sent it for review — they go live with the next approved
// round). Best-effort: the pathway is already published, so an email failure
// is logged, never returned.
async function notifyContributor(
  admin: ReturnType<typeof createAdminClient>,
  opts: { pathwayId: string; title: string; assembledDocId: string | null; assetIds: string[] }
) {
  try {
    if (!opts.assembledDocId) return;
    const { data: doc } = await admin
      .from('design_documents')
      .select('design_id, user_id')
      .eq('id', opts.assembledDocId)
      .maybeSingle();
    if (!doc?.user_id) return;
    const { data: contributor } = await admin.auth.admin.getUserById(doc.user_id);
    const email = contributor?.user?.email;
    if (!email) return;

    const assets = await loadPathwayToolkitAssets(opts.pathwayId);
    const live = assets.filter((a) => opts.assetIds.includes(a.unit_internal_id)).map((a) => a.asset_name);
    const waiting = assets.filter((a) => !a.published_at && !opts.assetIds.includes(a.unit_internal_id)).map((a) => a.asset_name);

    const paragraphs = [`Your pathway "${opts.title}" has been approved and is now part of 100 Pathways, where it can help future adopters.`];
    if (live.length) paragraphs.push(`Published with it, and downloadable by anyone: ${live.join(', ')}.`);
    if (waiting.length) {
      paragraphs.push(
        `Not published yet: ${waiting.join(', ')}. You shared these after you last sent the pathway for review; they go live the next time it's sent for review and approved.`
      );
    }
    await sendContributionEmail({
      to: email,
      subject: `Your pathway "${opts.title}" is published`,
      heading: 'Your pathway is published',
      paragraphs,
      // Straight into the contributor's own workspace for this pathway
      // (ContributeGrid's ?open= deep link; they sign in first if needed).
      link: { url: `${CUBE_APP_URL}/contribute?open=${doc.design_id}`, label: 'Open your contribution' },
    });
  } catch (err) {
    console.error('[admin/pathways/publish] contributor email:', err);
  }
}

export const POST = withErrorHandling('api/admin/pathways/publish', handlePOST);
