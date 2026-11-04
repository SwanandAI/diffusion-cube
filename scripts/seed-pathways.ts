/*
 * One-time seed: turns a provided document set into published pathways
 * (docs/features/pathway-storage/, PS-12). Run once per Supabase project
 * (dev first, then prod), after migration 0042 and the `embed` Edge
 * Function are in place:
 *
 *   npm run seed:pathways -- --manifest path/to/manifest.json [--dry-run] [--only slug1,slug2]
 *
 * The manifest (see scripts/seed-manifest.example.json) lists each pathway's
 * slug, title, optional sector/organisation, and its files — each
 * contributor-only unless marked "public": true (business decision Q22).
 * Paths are relative to the manifest's folder.
 *
 * Per pathway: extract each file's text → generate the pathway document
 * with Claude (the same generation prompt contributors' drafts use) → only
 * then write: the pathways row, the original files (private
 * `pathway-sources` bucket) and their text, embedded passages, a version,
 * and publish it — no admin review (business decisions Q3/Q20). Re-running
 * for a slug adds a new version and replaces its sources; nothing is
 * duplicated. --dry-run validates and extracts only: no Storage, database
 * or Claude calls. --only slug1,slug2 runs just those pathways.
 *
 * Each generated document is cached next to the manifest
 * (.seed-cache/<slug>.md), keyed by a hash of its source texts, the
 * framework and the generation prompt: a re-run after a later step failed
 * reuses it instead of paying for generation again. --regenerate ignores it.
 *
 * Reads .env.local (or the environment): NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */
import type AnthropicSDK from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const GENERATION_MODEL = 'claude-sonnet-4-6';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function extractText(file: string): Promise<string> {
  const { extensionOf } = await import('@/lib/seed');
  const ext = extensionOf(file);
  const buffer = readFileSync(file);
  switch (ext) {
    case 'txt':
    case 'md':
      return buffer.toString('utf-8');
    case 'pdf': {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
      const pages: string[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const content = await (await doc.getPage(p)).getTextContent();
        pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
      }
      return pages.join('\n\n');
    }
    case 'docx': {
      const mammoth = (await import('mammoth')).default;
      return (await mammoth.extractRawText({ buffer })).value;
    }
    case 'xlsx':
    case 'xls': {
      const XLSX = await import('xlsx');
      const book = XLSX.read(buffer, { type: 'buffer' });
      return book.SheetNames.map((n) => `## ${n}\n${XLSX.utils.sheet_to_csv(book.Sheets[n])}`).join('\n\n');
    }
    case 'pptx': {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buffer);
      const slides = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
      const out: string[] = [];
      for (const s of slides) {
        const xml = await zip.files[s].async('string');
        out.push([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' '));
      }
      return out.join('\n\n');
    }
    default:
      return '';
  }
}

interface Extracted {
  key: string;
  path: string;
  fileName: string;
  public: boolean;
  text: string;
}

async function generateDocument(
  p: { slug: string; title: string; sector: string; organisation: string },
  sources: Extracted[],
  cacheDir: string,
  regenerate: boolean
): Promise<{ document: string; cached: boolean }> {
  const { loadFrameworkContent, loadPathwayGenerationPrompt } = await import('@/lib/wiki-loader');
  const [framework, generation] = await Promise.all([loadFrameworkContent(), loadPathwayGenerationPrompt()]);

  const hash = createHash('sha256')
    .update(JSON.stringify([GENERATION_MODEL, p.title, p.sector, p.organisation, framework, generation, sources.map((s) => [s.key, s.fileName, s.text])]))
    .digest('hex');
  const cacheFile = path.join(cacheDir, `${p.slug}.md`);
  const hashFile = path.join(cacheDir, `${p.slug}.sha256`);
  if (!regenerate && existsSync(cacheFile) && existsSync(hashFile) && readFileSync(hashFile, 'utf-8').trim() === hash) {
    return { document: readFileSync(cacheFile, 'utf-8'), cached: true };
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { recordAiUsage } = await import('@/lib/ai-usage');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system = `${generation}

## Seeding notes
- Pathway: ${p.title}${p.sector ? ` (sector: ${p.sector})` : ''}${p.organisation ? `, documented by ${p.organisation}` : ''}.
- Each source file below is headed "=== <key> · <file name> ===". In the Source Trace appendix, start every row's first cell with that key and file name exactly, e.g. "src-01 · Vendor-Evaluation.pdf".
- Add \`contributor: ${p.organisation || 'Unknown'}\` and \`timestamp: <the most recent as-of date the sources state, YYYY-MM-DD, or Unknown>\` to the frontmatter.
- Your entire response is the pathway markdown document, starting with its frontmatter — nothing before or after it.

## The AI Diffusion Pathway Framework

${framework}`;

  const material = sources.map((s) => `=== ${s.key} · ${s.fileName} ===\n${s.text}`).join('\n\n');
  // A long generation can lose its connection part-way ("terminated" /
  // "fetch failed" — seen on the first dev seed, 2026-11-04): try again,
  // up to twice. Anything else (an API error, max_tokens) fails at once.
  const run = async (attempt: number): Promise<AnthropicSDK.Message> => {
    try {
      return await anthropic.messages
        .stream({
          model: GENERATION_MODEL,
          max_tokens: 32000,
          system,
          messages: [{ role: 'user', content: `Raw pathway material:\n\n${material}` }],
        })
        .finalMessage();
    } catch (err) {
      const dropped = /terminated|fetch failed|ECONNRESET|socket hang up/i.test(String((err as Error)?.message ?? err));
      if (!dropped || attempt >= 2) throw err;
      console.log(`  · connection dropped during generation — retrying (${attempt + 1}/2)`);
      return run(attempt + 1);
    }
  };
  try {
    const final = await run(0);
    recordAiUsage({ mode: 'seed-pathway', model: final.model, usage: final.usage, ok: true, userId: null });
    if (final.stop_reason === 'max_tokens') throw new Error('generation hit max_tokens — the document is incomplete');
    const text = final.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    if (!text.startsWith('---')) throw new Error('generation did not return a document with frontmatter');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, text);
    writeFileSync(hashFile, hash);
    return { document: text, cached: false };
  } catch (err) {
    recordAiUsage({ mode: 'seed-pathway', model: GENERATION_MODEL, ok: false, userId: null });
    throw err;
  }
}

async function main() {
  const manifestArg = arg('--manifest');
  const dryRun = process.argv.includes('--dry-run');
  const regenerate = process.argv.includes('--regenerate');
  if (!manifestArg) {
    console.error('Usage: npm run seed:pathways -- --manifest <file.json> [--dry-run] [--only slug1,slug2]');
    process.exit(2);
  }

  const { validateManifest, sourceKey, storagePath, chunkText, MIME_TYPES, extensionOf } = await import('@/lib/seed');
  const manifestPath = path.resolve(manifestArg);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    console.error(`Could not read ${manifestPath}: ${(err as Error).message}`);
    process.exit(2);
  }
  const { manifest, errors } = validateManifest(raw, path.dirname(manifestPath), existsSync);
  const cacheDir = path.join(path.dirname(manifestPath), '.seed-cache');
  if (!manifest) {
    console.error('The manifest has problems — nothing was written:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(2);
  }

  // --only re-runs just some pathways (e.g. the ones a previous run failed).
  const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = (only ?? []).filter((slug) => !manifest.pathways.some((p) => p.slug === slug));
  if (unknown.length) {
    console.error(`--only names slugs not in the manifest: ${unknown.join(', ')}`);
    process.exit(2);
  }
  const selected = only?.length ? manifest.pathways.filter((p) => only.includes(p.slug)) : manifest.pathways;

  const summary: string[] = [];
  let failed = 0;

  for (const p of selected) {
    console.log(`\n▶ ${p.slug} — ${p.title}`);
    // 1. Extract. A file with no readable text (e.g. a scanned PDF) is
    //    reported and skipped; the pathway carries on with the rest.
    const sources: Extracted[] = [];
    const skippedFiles: string[] = [];
    for (const f of p.files) {
      const fileName = path.basename(f.path);
      try {
        const text = (await extractText(f.path)).trim();
        if (!text) { skippedFiles.push(`${fileName} (no readable text — scanned?)`); continue; }
        sources.push({ key: sourceKey(sources.length), path: f.path, fileName, public: f.public, text });
        console.log(`  · ${fileName}: ${text.length.toLocaleString()} characters${f.public ? ' (public)' : ''}`);
      } catch (err) {
        skippedFiles.push(`${fileName} (${(err as Error).message})`);
      }
    }
    if (skippedFiles.length) console.log(`  ! skipped: ${skippedFiles.join('; ')}`);
    if (sources.length === 0) {
      failed++;
      summary.push(`✗ ${p.slug}: no readable documents`);
      continue;
    }
    if (dryRun) {
      summary.push(`✓ ${p.slug}: ${sources.length} document(s) readable (dry run — nothing written)`);
      continue;
    }

    try {
      // 2. Generate first: if Claude fails, nothing is written for this pathway.
      const { document, cached } = await generateDocument(p, sources, cacheDir, regenerate);
      console.log(`  · document ${cached ? 'reused from .seed-cache' : 'generated'} (${document.length.toLocaleString()} characters)`);

      const { createAdminClient } = await import('@/lib/supabase/admin');
      const { saveVersion, publishVersion, removeSourceObjects, SOURCES_BUCKET } = await import('@/lib/pathway-store');
      const { embedTexts, toPgVector } = await import('@/lib/embeddings');
      const admin = createAdminClient();

      // 3. The pathway row (no contributor: created_by stays null).
      const { data: existing, error: findErr } = await admin.from('pathways').select('id').eq('slug', p.slug).maybeSingle();
      if (findErr) throw findErr;
      let pathwayId = existing?.id as string | undefined;
      if (pathwayId) {
        const { error } = await admin.from('pathways').update({ is_seed: true, title: p.title, sector: p.sector }).eq('id', pathwayId);
        if (error) throw error;
      } else {
        const { data, error } = await admin
          .from('pathways')
          .insert({ slug: p.slug, title: p.title, sector: p.sector, is_seed: true })
          .select('id')
          .single();
        if (error) throw error;
        pathwayId = data.id as string;
      }

      // 4. Originals: replace any earlier run's files and rows.
      await removeSourceObjects(pathwayId, admin);
      const { error: delErr } = await admin.from('pathway_sources').delete().eq('pathway_id', pathwayId);
      if (delErr) throw delErr;
      let passages = 0;
      for (const s of sources) {
        const ext = extensionOf(s.path)!;
        const objectPath = storagePath(p.slug, s.key, s.fileName);
        const { error: upErr } = await admin.storage
          .from(SOURCES_BUCKET)
          .upload(objectPath, readFileSync(s.path), { contentType: MIME_TYPES[ext], upsert: true });
        if (upErr) throw upErr;
        const { data: row, error: srcErr } = await admin
          .from('pathway_sources')
          .insert({
            pathway_id: pathwayId,
            source_key: s.key,
            file_name: s.fileName,
            storage_path: objectPath,
            mime_type: MIME_TYPES[ext],
            extracted_text: s.text,
            is_public: s.public,
          })
          .select('id')
          .single();
        if (srcErr) throw srcErr;

        const chunks = chunkText(s.text);
        const vectors = await embedTexts(chunks);
        if (chunks.length) {
          const { error: chErr } = await admin.from('pathway_source_chunks').insert(
            chunks.map((text, i) => ({
              source_id: row.id,
              pathway_id: pathwayId,
              chunk_index: i,
              text,
              embedding: toPgVector(vectors[i]),
            }))
          );
          if (chErr) throw chErr;
        }
        passages += chunks.length;
      }

      // 5. Version + publish, exactly as an admin publish does.
      const version = await saveVersion(
        { pathwayId, content: document, source: 'seed', changeNote: `Seeded from ${sources.length} document(s)` },
        admin
      );
      const published = await publishVersion({ pathwayId, versionId: version.id, publishedBy: null }, admin);

      const notes = [
        `version ${version.version_number}`,
        `${published.indexedUnits} unit(s) indexed`,
        `${passages} passage(s)`,
        published.embedded ? '' : 'NO VECTORS (embed function failed — publish again later)',
      ].filter(Boolean);
      summary.push(`✓ ${p.slug}: ${notes.join(', ')}`);
      for (const s of published.skippedUnits) summary.push(`    skipped Unit ${s.unit} "${s.title}": ${s.reason}`);
      for (const f of skippedFiles) summary.push(`    skipped file ${f}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      summary.push(`✗ ${p.slug}: ${message}`);
    }
  }

  console.log(`\n── Summary${dryRun ? ' (dry run)' : ''} ──\n${summary.join('\n')}`);
  process.exit(failed ? 1 : 0);
}

void main();
