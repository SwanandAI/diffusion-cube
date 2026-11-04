import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasRole } from '@/lib/roles'

import { logError, withErrorHandling } from '@/lib/errors'
import { recordAiUsage } from '@/lib/ai-usage'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Forced tool-use rather than free text — the only thing this call needs to
// produce is one id (or null), same idiom as EXTRACT_TOOL in
// app/api/pathways/assemble/route.ts.
const MATCH_TOOL: Anthropic.Tool = {
  name: 'report_match',
  description: 'Report whether the candidate pathway is the same underlying pathway as an existing one.',
  input_schema: {
    type: 'object',
    properties: {
      matchId: {
        type: ['string', 'null'],
        description:
          "id of the existing pathway that is genuinely the same underlying deployment/pathway as the candidate, or null if none of them are.",
      },
    },
    required: ['matchId'],
  },
}

/**
 * Checks a candidate pathway (title/sector/description) against every
 * published pathway for a genuine duplicate, via an LLM rather than a
 * keyword/token heuristic — catches paraphrased titles and descriptions that
 * describe the same underlying deployment in different words. A deliberate,
 * best-effort first line of defense; the admin's own offline review remains
 * the fallback for anything this misses. Unpublished pathways are skipped:
 * they're other contributors' private drafts, and PathwaySelector only offers
 * published ones to join, so a match against a draft couldn't be acted on.
 */
async function handlePOST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasRole(supabase, 'pathway_contributor'))) {
    return NextResponse.json({ error: 'Contributor role required' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { title, sector, description } = body as { title?: unknown; sector?: unknown; description?: unknown }
  if (
    typeof title !== 'string' ||
    typeof description !== 'string' ||
    (sector != null && typeof sector !== 'string') ||
    !title.trim() ||
    !description.trim()
  ) {
    return NextResponse.json({ error: 'title and description required' }, { status: 400 })
  }

  const { data: live, error: liveError } = await supabase.from('published_pathways').select('slug')
  if (liveError) return NextResponse.json({ error: liveError.message }, { status: 500 })
  const liveSlugs = (live ?? []).map((r) => r.slug as string)

  // Every published pathway, not just the caller's own — the pathways RLS
  // (migration 0040) limits a session to the pathways it contributes to.
  // Listing columns only.
  const { data: pathways, error } = liveSlugs.length
    ? await createAdminClient()
        .from('pathways')
        .select('id, title, sector, description')
        .in('slug', liveSlugs)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Every published pathway is a pathways row now (seeded ones included —
  // docs/features/pathway-storage/), so every match is joinable.
  const candidates = (pathways ?? []).map((p) => ({
    id: p.id as string,
    title: p.title,
    sector: p.sector,
    description: p.description,
  }))
  if (candidates.length === 0) return NextResponse.json({ matchId: null })

  const list = candidates
    .map(
      (p) =>
        `- id: ${p.id}\n  title: ${p.title}\n  sector: ${p.sector || '(none)'}\n  description: ${p.description || '(none)'}`
    )
    .join('\n')

  const prompt = `A contributor wants to start a new pathway page:
title: ${title.trim()}
sector: ${sector?.trim() || '(none)'}
description: ${description.trim()}

Here are the existing published pathways:
${list}

A "match" means the candidate is genuinely the same underlying deployment or adoption pathway as an existing one — the same solution, for the same kind of user, solving the same problem — even if the wording, sector label, or level of detail differs. It is NOT a match just because the sector matches or a few words overlap; different deployments in the same sector are not matches. Call report_match with the id of the one genuine match, or null if none of the existing pathways are the same underlying pathway.`

  try {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      tools: [MATCH_TOOL],
      tool_choice: { type: 'tool', name: 'report_match' },
      messages: [{ role: 'user', content: prompt }],
    })
    recordAiUsage({ mode: 'check-similar', model: result.model, usage: result.usage, ok: true })
    const toolUse = result.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') return NextResponse.json({ matchId: null })
    const reported = (toolUse.input as { matchId?: unknown }).matchId
    // Only an id we actually offered counts — anything else is no match.
    const match = candidates.find((c) => c.id === reported)
    if (!match) return NextResponse.json({ matchId: null })
    return NextResponse.json({ matchId: match.id })
  } catch (err) {
    // Still answers "no match" so pathway creation isn't blocked, but the
    // failure is recorded like any other.
    recordAiUsage({ mode: 'check-similar', model: 'claude-sonnet-4-6', ok: false })
    logError('api/pathways/check-similar', err, { kind: 'unexpected', path: '/api/pathways/check-similar', method: 'POST' })
    return NextResponse.json({ matchId: null })
  }
}

export const POST = withErrorHandling('api/pathways/check-similar', handlePOST)
