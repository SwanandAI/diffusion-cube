// Stands in for lib/ai-usage.ts during an eval run so the harness never
// writes ai_usage rows (see scripts/test-harness/answer-shape-eval/vite-node.config.mts).
export type UsageArea = 'explore' | 'analyse' | 'contribute';

export function areaFor(): UsageArea {
  return 'analyse';
}

export function recordAiUsage(): void {}
