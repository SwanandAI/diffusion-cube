import Anthropic from '@anthropic-ai/sdk';
import { loadFrameworkContent, loadPathwayGenerationPrompt, loadResourcesContent, datedLine } from '@/lib/wiki-loader';
import { adopterDocument, buildOverview, getPublishedDocument } from '@/lib/pathway-store';
import { buildGrounding, pathwayPassages, lastUserText, type Surface } from '@/lib/retrieval';
import {
  explorerSystemPrompt,
  contributorSystemPrompt,
  analysisDocSystemPrompt,
  documentInsightSystemPrompt,
  pathwayDraftSystemPrompt,
  executiveSummarySystemPrompt,
  libraryPathwaySystemPrompt,
  libraryOverviewSystemPrompt,
  assetReuseSystemPrompt,
  LIBRARY_KICKOFF_PROMPT,
  type CompanionMeta,
} from '@/lib/system-prompts';
import { createClient } from '@/lib/supabase/server';
import { currentRoles, type Role } from '@/lib/roles';
import { EMPTY_GRID } from '@/lib/dimensions';
import { parseGridUpdate } from '@/lib/grid-update';
import { isValidSlug } from '@/lib/slug';
import { isValidExploreConversation } from '@/lib/explore-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import { recordAiUsage } from '@/lib/ai-usage';
import { messagesForMode, systemForMode } from '@/lib/prompt-cache';
import { loadPublishedToolkitAssets } from '@/lib/toolkit-assets-server';

import { logError, sessionUserId, withErrorHandling } from '@/lib/errors';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODES = [
  'companion',
  'analysis-doc',
  'executive-summary',
  'extract-insights',
  'pathway-draft',
  'library',
  'asset-reuse',
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

// A reply that fails after streaming has begun (the response is already a
// 200, so withErrorHandling can't see it): record it, then error the stream
// so the client's reader rejects and it shows GENERIC_ERROR_MESSAGE under
// whatever text already arrived, without saving the broken reply.
async function streamFailed(
  controller: ReadableStreamDefaultController,
  err: unknown,
  context: { mode: string; flow?: string; design_id?: string; pathway_slug?: string }
) {
  logError('api/chat', err, { ...context, kind: 'unexpected', path: '/api/chat', method: 'POST', user_id: await sessionUserId() });
  recordAiUsage({ mode: context.mode, flow: context.flow, model: 'claude-sonnet-4-6', ok: false });
  controller.error(err);
}

// One ai_usage row for a reply that streamed to the end, from the SDK's final
// message (input/output and cache token counts).
async function recordStreamUsage(stream: ReturnType<typeof anthropic.messages.stream>, mode: string, flow?: string) {
  try {
    const final = await stream.finalMessage();
    recordAiUsage({ mode, flow, model: final.model, usage: final.usage, ok: true });
  } catch (err) {
    console.error('[chat] could not read final usage:', err);
  }
}

// The role each non-library mode needs — enforced here, not trusted from the
// UI. Contributor work needs pathway_contributor, Explorer work adopter.
// companion and extract-insights serve both flows, so they follow the
// adoption's flow: anything other than 'contributor' (a missing flow
// included) runs the Explorer prompt, so it needs adopter.
function requiredRole(mode: string, flow: unknown): { role: Role; message: string } {
  const contributorWork =
    mode === 'pathway-draft' ||
    mode === 'asset-reuse' ||
    ((mode === 'companion' || mode === 'extract-insights') && flow === 'contributor');
  return contributorWork
    ? { role: 'pathway_contributor', message: 'This needs the Contributor role.' }
    : { role: 'adopter', message: 'This needs the Adopter role.' };
}

// A long Contributor conversation stays well under this; it caps what one
// request can send to Claude.
const MAX_MESSAGES = 500;

// The shape every non-library mode sends (the library has its own, stricter
// isValidExploreConversation): a non-empty list of user/assistant turns.
function isValidMessages(messages: unknown): boolean {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_MESSAGES &&
    messages.every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        (m.role === 'user' || m.role === 'assistant') &&
        (typeof m.content === 'string' || Array.isArray(m.content))
    )
  );
}

// Anthropic's own request-size limit — a bigger body would be refused there
// anyway. Attached images ride in the messages as base64, so this is the cap
// that bounds them.
const MAX_BODY_CHARS = 32 * 1024 * 1024;

// The text a request adds to the prompt (messages, grid, meta and the
// published doc). ~200k tokens, the model's whole context window — the system
// prompt takes part of that too, so a request past this could never succeed,
// and is refused before it costs a Claude call.
const MAX_TEXT_CHARS = 800_000;

function requestTextChars(messages: { content: unknown }[], grid: unknown, meta: unknown, doc: unknown): number {
  let chars = 0;
  for (const { content } of messages) {
    if (typeof content === 'string') {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block?.text === 'string') chars += block.text.length;
      }
    }
  }
  chars += JSON.stringify(grid ?? null).length + JSON.stringify(meta ?? null).length;
  return chars + (typeof doc === 'string' ? doc.length : 0);
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// grid and meta are optional, but when sent they must be plain objects — the
// prompt builders read fields off them.
function isOptionalObject(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value));
}

async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The rate limit runs before the body is even parsed, so a flood of
  // malformed or unauthorised requests is capped too — each rejected 4xx is
  // recorded in sys_errors, a 429 isn't. Signed-in callers are counted per
  // account (every signup is auto-approved, so this is what caps Claude spend
  // per person); anonymous ones per IP, on the allowance /explore has always
  // had.
  const allowed = user ? await checkRateLimit(req, 'chat-user', user.id) : await checkRateLimit(req, 'explore');
  if (!allowed) {
    return Response.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return Response.json({ error: 'This request is too large.' }, { status: 413 });
  }

  // A body that isn't a JSON object is the caller's mistake, not a server
  // failure.
  const body = parseJson(raw);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const { messages, mode, grid, meta, designId, flow, existingPublishedDoc, pathwayId } = body;

  if (!MODES.includes(mode)) {
    return Response.json({ error: 'Unknown mode.' }, { status: 400 });
  }

  // 'library' is the one mode open to anonymous callers, so its input is
  // checked before anything else touches the database or Claude.
  if (mode === 'library' && !isValidExploreConversation(messages)) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  // The whole app is the companion now — access requires a signed-in account
  // (every account holds 'adopter' from signup) — except 'library' (/explore),
  // which is deliberately open with no login or registration at all. proxy.ts
  // lets /api/chat through without a session for that reason; this is the
  // real enforcement for the model-calling surface. The role must also match
  // the mode and flow (requiredRole) — the UI showing a choice is not the
  // enforcement boundary.
  if (mode !== 'library') {
    // Every account holds 'adopter' from signup (migration 0039), so no roles
    // means either no session at all or a role row removed by hand.
    if (!user) {
      return Response.json({ error: 'Please sign in to continue.' }, { status: 403 });
    }
    const roles = await currentRoles(supabase);
    if (roles.size === 0) {
      return Response.json({ error: "Your account doesn't have access yet. Please contact an administrator." }, { status: 403 });
    }
    const required = requiredRole(mode, flow);
    if (!roles.has(required.role)) {
      return Response.json({ error: required.message }, { status: 403 });
    }
    if (!isValidMessages(messages) || !isOptionalObject(grid) || !isOptionalObject(meta)) {
      return Response.json({ error: 'Invalid request.' }, { status: 400 });
    }
    if (requestTextChars(messages, grid, meta, existingPublishedDoc) > MAX_TEXT_CHARS) {
      return Response.json({ error: 'This conversation is too long to send in one request.' }, { status: 413 });
    }
  }

  // One short, non-streamed call for the contributor's asset card: their
  // "What is it used for?" → the asset's purpose and Section 4 reuse
  // condition, as JSON (see assetReuseSystemPrompt).
  if (mode === 'asset-reuse') {
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: assetReuseSystemPrompt(),
        messages,
      });
    } catch (err) {
      recordAiUsage({ mode, model: 'claude-sonnet-4-6', ok: false });
      throw err;
    }
    recordAiUsage({ mode, model: response.model, usage: response.usage, ok: true });
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  let systemPrompt: string;
  let apiMessages = messages;
  const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  // The Library (/explore). Every pathway comes from the app's own store
  // (lib/pathway-store.ts — published versions only; Source Trace stripped).
  // With a pathway open, the chat is grounded in its document, plus passages
  // from its public source documents for the latest question (seeded
  // pathways only). With none open, in the library overview plus lessons
  // retrieved across every pathway for the latest question (UC2/UC3,
  // lib/retrieval.ts). Rate limiting and input checks above run first, so a
  // refused request never costs a retrieval call.
  if (mode === 'library') {
    const hasQuestion = Array.isArray(apiMessages) && apiMessages.length > 0;
    if (typeof pathwayId === 'string' && pathwayId) {
      // pathwayId comes straight from an unauthenticated request — only a
      // real slug shape gets as far as a lookup.
      if (!isValidSlug(pathwayId)) return Response.json({ error: 'Unknown pathway.' }, { status: 404 });
      const doc = await getPublishedDocument(pathwayId);
      if (!doc) return Response.json({ error: 'Unknown pathway.' }, { status: 404 });
      // Same date line the Analyse grounding carries, so the library
      // prompt's dates rule has something to read.
      const document = `${datedLine(doc.content, doc.created_at)}${adopterDocument(doc)}`;
      // Published toolkit assets for this pathway — public by the
      // contributors' consent.
      const toolkitAssets = await loadPublishedToolkitAssets({ pathwaySlug: pathwayId });
      const passages = hasQuestion ? await pathwayPassages(pathwayId, lastUserText(apiMessages)) : '';
      systemPrompt = libraryPathwaySystemPrompt(document, toolkitAssets, passages);
    } else {
      const { overview, count } = await buildOverview();
      const grounding = hasQuestion
        ? (await buildGrounding({ surface: 'explore-overview', messages: apiMessages, flow: 'explore' })).text
        : '';
      systemPrompt = libraryOverviewSystemPrompt(overview, count, grounding);
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
      system: systemForMode(mode, systemPrompt),
      messages: messagesForMode(mode, apiMessages),
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          await streamFailed(controller, err, { mode, pathway_slug: pathwayId });
          return;
        }
        await recordStreamUsage(stream, mode);
      },
    });

    return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // Load only what this mode's prompt uses: extract-insights and pathway-draft
  // never read the corpus, and only the Explorer companion reads resources.
  // The corpus is no longer sent whole: each message (or document) is
  // grounded on the pathways and lessons its question needs, retrieved from
  // the app's store (lib/retrieval.ts, docs/features/pathway-storage/).
  const needsCorpus = mode !== 'extract-insights' && mode !== 'pathway-draft';
  const needsResources = mode === 'companion' && flow !== 'contributor';
  const groundingSurface: Surface =
    mode === 'companion' ? (flow === 'contributor' ? 'contribute' : 'analyse') : 'document';
  const companionMeta = (meta ?? {}) as CompanionMeta;
  // What a document (or the contributor's chat) is about, when there's no
  // single question to search for: the adoption's own summary.
  const situationText = [companionMeta.sector, companionMeta.name, companionMeta.summary, companionMeta.hypothesis]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join('. ');
  const [grounding, frameworkContent, resourcesContent] = await Promise.all([
    needsCorpus
      ? buildGrounding({
          surface: groundingSurface,
          messages,
          sector: companionMeta.sector ?? null,
          situationText: situationText || undefined,
          flow: typeof flow === 'string' ? flow : null,
        })
      : null,
    loadFrameworkContent(),
    needsResources ? loadResourcesContent() : '',
  ]);
  const wikiContent = grounding?.text ?? '';

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
    // A long companion reply plus its trailing <grid_update> JSON can run
    // past 2048 tokens and be cut off mid-block, so companion keeps 8192.
    // Ordinary short replies are unaffected — this is a ceiling, not a target.
    max_tokens: mode === 'companion' ? 8192 : mode === 'extract-insights' ? 1024 : mode === 'pathway-draft' ? 9000 : 4096,
    system: systemForMode(mode, systemPrompt),
    messages: messagesForMode(mode, messages),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullResponse = '';
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullResponse += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        await streamFailed(controller, err, { mode, flow, design_id: designId });
        return;
      }
      await recordStreamUsage(stream, mode, flow);

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

export const POST = withErrorHandling('api/chat', handlePOST);
