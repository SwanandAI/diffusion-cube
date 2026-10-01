import Anthropic from '@anthropic-ai/sdk';
import { loadWikiContext, loadFrameworkContent, loadPathwayGenerationPrompt, loadResourcesContent } from '@/lib/wiki-loader';
import { readLibraryPathwayDocument, buildLibraryOverview } from '@/lib/library-wiki-loader';
import {
  explorerSystemPrompt,
  contributorSystemPrompt,
  analysisDocSystemPrompt,
  planDocumentSystemPrompt,
  documentInsightSystemPrompt,
  pathwayDraftSystemPrompt,
  executiveSummarySystemPrompt,
  pathwaySubmissionExecutiveSummarySystemPrompt,
  libraryPathwaySystemPrompt,
  libraryOverviewSystemPrompt,
  LIBRARY_KICKOFF_PROMPT,
} from '@/lib/system-prompts';
import { logConversation } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { hasAnyRole, hasRole } from '@/lib/roles';
import { EMPTY_GRID } from '@/lib/dimensions';
import { parseGridUpdate } from '@/lib/grid-update';
import { isValidSlug } from '@/lib/slug';
import { loadPublishedToolkitAssets } from '@/lib/toolkit-assets-server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODES = [
  'companion',
  'analysis-doc',
  'executive-summary',
  'plan-document',
  'extract-insights',
  'pathway-draft',
  'pathway-exec-summary',
  'library',
] as const;

function lastUserMessageText(messages: { role: string; content: unknown }[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    const textBlock = last.content.find((b): b is { type: string; text: string } => b?.type === 'text');
    return textBlock?.text ?? '';
  }
  return '';
}

export async function POST(req: Request) {
  const { messages, mode, grid, meta, versionNumber, designId, flow, existingPublishedDoc, pathwayId } = await req.json();

  if (!MODES.includes(mode)) {
    return Response.json({ error: 'Unknown mode.' }, { status: 400 });
  }

  // The whole app is the companion now — access requires an approved account
  // (any role at all; "pending" is zero roles) — except 'library' (/explore),
  // which is deliberately open with no login or registration at all. proxy.ts
  // already guarantees a session for every other mode; this is the real
  // enforcement for the model-calling surface.
  const supabase = await createClient();
  if (mode !== 'library') {
    const approved = await hasAnyRole(supabase);
    if (!approved) {
      return Response.json({ error: 'Your account is awaiting approval.' }, { status: 403 });
    }
  }

  // A companion turn's flow is fixed by the adoption's own meta.flow, chosen
  // once on the welcome screen — but the UI showing that choice is not the
  // real enforcement boundary, so re-check it against the caller's actual
  // roles here (same pattern the old `design` mode used for `adopter`).
  if (mode === 'companion') {
    if (flow === 'contributor' && !(await hasRole(supabase, 'pathway_contributor'))) {
      return Response.json({ error: 'The Contributor flow requires the Contributor role.' }, { status: 403 });
    }
    if (flow === 'explorer' && !(await hasRole(supabase, 'adopter'))) {
      return Response.json({ error: 'The Explorer flow requires the Adopter role.' }, { status: 403 });
    }
  }

  let systemPrompt: string;
  let apiMessages = messages;
  const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  // The Library (/explore) is a fully separate entity. Static pathways live in
  // content/library-wiki/pathways/; published pathways from the contributor
  // flow live in published_pathways (Supabase). Both are checked — static first,
  // DB as fallback — so cards from either source open into a grounded chat.
  if (mode === 'library') {
    if (typeof pathwayId === 'string' && pathwayId) {
      // pathwayId comes straight from an unauthenticated request and becomes
      // a file path below — only a real slug shape gets that far, never
      // "../../wiki/pathways/x" (which would read any .md on the server).
      if (!isValidSlug(pathwayId)) return Response.json({ error: 'Unknown pathway.' }, { status: 404 });
      let document = await readLibraryPathwayDocument(pathwayId);
      if (!document) {
        const { data } = await supabase
          .from('published_pathways')
          .select('content')
          .eq('slug', pathwayId)
          .maybeSingle();
        document = data?.content ?? null;
      }
      if (!document) return Response.json({ error: 'Unknown pathway.' }, { status: 404 });
      // Published toolkit assets for this pathway (only DB pathways have
      // any) — public by the contributors' consent.
      const toolkitAssets = await loadPublishedToolkitAssets({ pathwaySlug: pathwayId });
      systemPrompt = libraryPathwaySystemPrompt(document, toolkitAssets);
    } else {
      systemPrompt = libraryOverviewSystemPrompt(await buildLibraryOverview());
    }
    // Mirrors the original backend: an empty history means "just opened a
    // pathway," so the model gets a fixed kickoff turn instead — never shown
    // to the user as a chat bubble.
    if (!Array.isArray(apiMessages) || apiMessages.length === 0) {
      apiMessages = [{ role: 'user', content: LIBRARY_KICKOFF_PROMPT }];
    }

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: apiMessages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const [wikiContent, frameworkContent, resourcesContent] = await Promise.all([
    loadWikiContext(),
    loadFrameworkContent(),
    loadResourcesContent(),
  ]);

  if (mode === 'analysis-doc') {
    systemPrompt = analysisDocSystemPrompt(wikiContent, frameworkContent, grid ?? EMPTY_GRID, meta ?? {}, generatedAt);
  } else if (mode === 'executive-summary') {
    systemPrompt = executiveSummarySystemPrompt(
      wikiContent,
      frameworkContent,
      grid ?? EMPTY_GRID,
      meta ?? {},
      generatedAt
    );
  } else if (mode === 'plan-document') {
    systemPrompt = planDocumentSystemPrompt(
      wikiContent,
      frameworkContent,
      grid ?? EMPTY_GRID,
      meta ?? {},
      generatedAt,
      versionNumber ?? 1
    );
  } else if (mode === 'extract-insights') {
    systemPrompt = documentInsightSystemPrompt(frameworkContent, grid ?? EMPTY_GRID);
  } else if (mode === 'pathway-draft') {
    const generationPromptContent = await loadPathwayGenerationPrompt();
    systemPrompt = pathwayDraftSystemPrompt(
      frameworkContent,
      generationPromptContent,
      grid ?? EMPTY_GRID,
      meta ?? {},
      generatedAt,
      typeof existingPublishedDoc === 'string' ? existingPublishedDoc : null
    );
  } else if (mode === 'pathway-exec-summary') {
    systemPrompt = pathwaySubmissionExecutiveSummarySystemPrompt(meta ?? {}, generatedAt);
  } else if (flow === 'contributor') {
    systemPrompt = contributorSystemPrompt(
      wikiContent,
      frameworkContent,
      grid ?? EMPTY_GRID,
      meta ?? {},
      typeof existingPublishedDoc === 'string' ? existingPublishedDoc : null
    );
  } else {
    const toolkitAssets = mode === 'companion' ? await loadPublishedToolkitAssets() : [];
    systemPrompt = explorerSystemPrompt(
      wikiContent,
      frameworkContent,
      grid ?? EMPTY_GRID,
      meta ?? {},
      resourcesContent,
      toolkitAssets
    );
  }

  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    // companion used to be a short conversational turn every time (2048 was
    // plenty), but the Explorer flow's Step 5 now generates a full Deep Dive
    // Report / Holistic Adoption Plan inline within this same mode (wrapped
    // in <deliverable> tags — see explorerSystemPrompt) instead of a
    // separate document-generation mode. A real document plus the trailing
    // <grid_update> JSON can easily exceed 2048 tokens, silently truncating
    // mid-document — the closing </deliverable> tag never arrives, so the
    // client can't extract it and falls back to showing raw text. 8192
    // comfortably covers a full report; ordinary short replies are
    // unaffected since this is a ceiling, not a target.
    max_tokens: mode === 'companion' ? 8192 : mode === 'extract-insights' ? 1024 : mode === 'pathway-draft' ? 9000 : 4096,
    system: systemPrompt,
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullResponse = '';
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullResponse += chunk.delta.text;
          controller.enqueue(encoder.encode(chunk.delta.text));
        }
      }
      controller.close();

      // Fire-and-forget — never blocks the response
      logConversation({ mode, messages, response: fullResponse });

      // TEMPORARY dev-only diagnostic for toolkit-asset testing (see
      // specs/TOOLKIT_ASSETS_SPEC.md) — prints the contributor companion's raw
      // <grid_update> to the `npm run dev` terminal. Remove after testing.
      if (process.env.NODE_ENV !== 'production' && mode === 'companion' && flow === 'contributor') {
        const block = fullResponse.match(/<grid_update>[\s\S]*?<\/grid_update>/)?.[0];
        console.log('[chat][dev] contributor grid_update:', block ?? '(none)');
      }

      // Records every companion-mode query, tagged with the pathway slug(s)
      // the response actually drew on (see supabase/migrations/0010 and
      // 0011, and companionSystemPrompt's grid_update contract) — raw
      // material for future cross-adoption insight gathering; nothing reads
      // it yet.
      if (mode === 'companion') {
        const content = lastUserMessageText(messages);
        if (content) {
          const pathwaySlugs = parseGridUpdate(fullResponse)?.pathwaysReferenced ?? [];
          supabase
            .from('adoption_queries')
            .insert({ design_id: designId ?? null, content, pathway_slugs: pathwaySlugs })
            .then(({ error }) => {
              if (error) console.error('[adoption_queries] insert failed:', error);
            });
        }
      }
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
