import path from 'path';
import { readStaticFile } from '@/lib/static-content';

// The app's own operating content that ships with it: the framework, the
// pathway-generation prompt and external resources. Pathways themselves no
// longer ship with the app — they live in the app's database
// (lib/pathway-store.ts, docs/features/pathway-storage/).

// The framework question bank ships inside this repo (content/framework.md)
// rather than the external wiki: it's the app's own operating framework, and
// bundling it means it survives deployment regardless of where the pathway
// corpus ends up living.
const FRAMEWORK_FILE = path.join(process.cwd(), 'content', 'framework.md');

// The contributor-side generation prompt — the exact rules for the pathway
// document's output structure (Sections 0-6 + Source Trace appendix). Also
// used at runtime for the `pathway-draft` mode, which drafts a user's own
// adoption in the same structure for their review.
const PATHWAY_GENERATION_PROMPT_FILE = path.join(process.cwd(), 'content', 'pathway-generation-prompt.md');

// External tools/repos/reference material outside the pathway corpus (e.g.
// Voicera) — citable alongside pathway units but tagged distinctly, since
// they carry no contributor attribution or condition tag. See
// content/resources.md for the citation discipline itself.
const RESOURCES_FILE = path.join(process.cwd(), 'content', 'resources.md');

// Kept in memory per server instance in production (lib/static-content.ts).
async function readSource(filePath: string): Promise<string> {
  const text = await readStaticFile(filePath);
  if (!text) console.error(`[wiki-loader] Could not read ${filePath}`);
  return text;
}

// The AI Diffusion Pathway Framework — dimensions, sub-categories, stage
// weighting, the full question bank (core questions, listening-for, insight
// forms, corpus examples), unit types, and tagging rules. Injected into
// prompts rather than hardcoded in system-prompts.ts.
export async function loadFrameworkContent(): Promise<string> {
  return readSource(FRAMEWORK_FILE);
}

export async function loadPathwayGenerationPrompt(): Promise<string> {
  return readSource(PATHWAY_GENERATION_PROMPT_FILE);
}

export async function loadResourcesContent(): Promise<string> {
  return readSource(RESOURCES_FILE);
}

// The date the explorer prompt's "How old it is" rule reads (see
// evidenceHandlingRules in lib/system-prompts.ts), placed beside "Contributed
// by" so it's found the same way. The document's own frontmatter timestamp
// wins; a pathway without one falls back to when it was first published
// (published_pathways.created_at — pathways.first_published_at, never
// rewritten), labelled as such so it isn't read as when the work happened.
export function datedLine(document: string, firstPublishedAt?: string | null): string {
  const timestamp = document.match(/^timestamp:\s*(.+)$/m)?.[1]?.trim();
  if (timestamp) return `Documented as of: ${timestamp}\n\n`;
  if (firstPublishedAt) return `First published: ${firstPublishedAt.slice(0, 10)}\n\n`;
  return '';
}
