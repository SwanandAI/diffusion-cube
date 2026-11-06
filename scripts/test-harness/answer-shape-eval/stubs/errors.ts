// Stands in for lib/errors.ts during an eval run: the real error classes, but
// logging goes to the console instead of sys_errors.
export * from '../../../../lib/errors';

export function logError(source: string, error: unknown, context: Record<string, unknown> = {}): void {
  console.error(`[logError] ${source}:`, error instanceof Error ? error.message : error, JSON.stringify(context));
}

export async function recordServerError(source: string, error: unknown): Promise<void> {
  console.error(`[recordServerError] ${source}:`, error instanceof Error ? error.message : error);
}
