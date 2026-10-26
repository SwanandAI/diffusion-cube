import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs/promises', () => ({ readFile: vi.fn() }));

import { readFile } from 'fs/promises';

const readFileMock = vi.mocked(readFile as unknown as (p: string, enc: string) => Promise<string>);

// lib/static-content.ts decides at import time whether to memoise
// (NODE_ENV === 'production') and holds its cache at module level, so each
// test imports a fresh copy.
async function load(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  return import('@/lib/static-content');
}

beforeEach(() => {
  readFileMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readStaticFile in development/test', () => {
  it('reads the file as utf-8', async () => {
    readFileMock.mockResolvedValue('hello');
    const { readStaticFile } = await load('development');
    expect(await readStaticFile('/x/a.md')).toBe('hello');
    expect(readFileMock).toHaveBeenCalledWith('/x/a.md', 'utf-8');
  });

  it('re-reads on every call so edits show immediately', async () => {
    readFileMock.mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    const { readStaticFile } = await load('development');
    expect(await readStaticFile('/x/a.md')).toBe('v1');
    expect(await readStaticFile('/x/a.md')).toBe('v2');
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it('returns "" for a missing file instead of throwing', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { readStaticFile } = await load('test');
    await expect(readStaticFile('/missing.md')).resolves.toBe('');
  });
});

describe('readStaticFile in production', () => {
  it('reads each file from disk once and serves it from memory after', async () => {
    readFileMock.mockResolvedValue('cached body');
    const { readStaticFile } = await load('production');
    expect(await readStaticFile('/x/a.md')).toBe('cached body');
    expect(await readStaticFile('/x/a.md')).toBe('cached body');
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight read between concurrent callers', async () => {
    readFileMock.mockResolvedValue('body');
    const { readStaticFile } = await load('production');
    const [a, b] = await Promise.all([readStaticFile('/x/a.md'), readStaticFile('/x/a.md')]);
    expect(a).toBe('body');
    expect(b).toBe('body');
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it('caches per path', async () => {
    readFileMock.mockImplementation(async (p: string) => `body of ${p}`);
    const { readStaticFile } = await load('production');
    expect(await readStaticFile('/a.md')).toBe('body of /a.md');
    expect(await readStaticFile('/b.md')).toBe('body of /b.md');
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read, so a missing file is retried', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce('now present');
    const { readStaticFile } = await load('production');
    expect(await readStaticFile('/x/a.md')).toBe('');
    expect(await readStaticFile('/x/a.md')).toBe('now present');
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it('does not keep an empty file either', async () => {
    readFileMock.mockResolvedValueOnce('').mockResolvedValueOnce('filled');
    const { readStaticFile } = await load('production');
    expect(await readStaticFile('/x/a.md')).toBe('');
    expect(await readStaticFile('/x/a.md')).toBe('filled');
  });
});
