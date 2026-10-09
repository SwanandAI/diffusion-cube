import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { assetIdsInDocument } from '@/lib/toolkit-assets';
import { loadPathwayToolkitAssets } from '@/lib/toolkit-assets-server';
import { CUBE_APP_URL, sendContributionEmail } from '@/lib/email';

// Parses YAML frontmatter from a pathway document's content string.
// Handles scalar values and simple inline arrays: [Tag1, Tag2].
function parseFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      result[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      result[key] = val;
    }
  }
  return result;
}

// Publishes an assembled pathway (pathways.content_cache) to published_pathways
// so it appears in the Explore library and grounds Analyse conversations.
// Card metadata (title, hook, stage, sector, location, tags) is parsed from
// the document's frontmatter — contributors add these when they write the doc.
// accent is derived deterministically from the slug so it never changes on
// re-publish and requires no contributor input.
export async function POST(req: NextRequest) {
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
    .select('id, slug, title, sector, content_cache, assembled_design_doc_id')
    .eq('id', pathway_id)
    .single();

  if (error || !pathway) {
    return NextResponse.json({ error: 'Pathway not found.' }, { status: 404 });
  }

  if (!pathway.content_cache) {
    return NextResponse.json(
      { error: 'No assembled document found. The contributor must publish from their workspace first.' },
      { status: 400 }
    );
  }

  const fm = parseFrontmatter(pathway.content_cache);
  const title = (fm.title as string) || pathway.title;
  const hook = (fm.description as string) || '';
  const stage = (fm.stage as string) || '';
  const sector = (fm.sector as string) || pathway.sector || '';
  const location = (fm.location as string) || '';
  const tags = Array.isArray(fm.tags) ? (fm.tags as string[]) : [];
  const category = tags.length > 0 ? tags.slice(0, 2).join(' · ') : 'Community';

  const { error: upsertErr } = await admin.from('published_pathways').upsert(
    {
      slug: pathway.slug,
      title,
      description: hook,
      category,
      content: pathway.content_cache,
      sector,
      location,
      tags,
      stage,
      published_by: user.id,
    },
    { onConflict: 'slug' }
  );

  if (upsertErr) {
    console.error('[admin/pathways/publish]', upsertErr);
    return NextResponse.json({ error: 'Failed to publish pathway.' }, { status: 500 });
  }

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
  const assetIds = assetIdsInDocument(pathway.content_cache);
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

  return NextResponse.json({ ok: true, slug: pathway.slug, assetsPublished });
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
