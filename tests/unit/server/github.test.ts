import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ghListFiles, ghReadFile, ghWriteFile } from '@/lib/github';

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ghReadFile', () => {
  it('reads and base64-decodes a file on the configured repo/branch', async () => {
    fetchMock.mockResolvedValue(json({ content: b64('# Hello ✓ ünïcode\n'), sha: 'abc123' }));
    const file = await ghReadFile('content/wiki/pathways/x.md');
    expect(file).toEqual({ content: '# Hello ✓ ünïcode\n', sha: 'abc123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/example/repo/contents/content/wiki/pathways/x.md?ref=main');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-github-token');
    expect((init?.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('decodes GitHub-style base64 with embedded newlines', async () => {
    const encoded = b64('a'.repeat(100)).replace(/(.{60})/g, '$1\n');
    fetchMock.mockResolvedValue(json({ content: encoded, sha: 's' }));
    expect((await ghReadFile('f.md'))?.content).toBe('a'.repeat(100));
  });

  it('percent-encodes each path segment but keeps the slashes', async () => {
    fetchMock.mockResolvedValue(json({ content: b64('x'), sha: 's' }));
    await ghReadFile('docs/my file#1?.md');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/example/repo/contents/docs/my%20file%231%3F.md?ref=main'
    );
  });

  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    expect(await ghReadFile('missing.md')).toBeNull();
  });

  it.each([401, 403, 500])('throws with status and body on %i', async (status) => {
    fetchMock.mockResolvedValue(new Response('Bad credentials', { status }));
    await expect(ghReadFile('f.md')).rejects.toThrow(`GitHub readFile "f.md": ${status} Bad credentials`);
  });

  it('throws when the path is a directory', async () => {
    fetchMock.mockResolvedValue(json([{ type: 'file', name: 'a.md' }]));
    await expect(ghReadFile('content')).rejects.toThrow(/is a directory/);
  });

  it('propagates a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(ghReadFile('f.md')).rejects.toThrow('fetch failed');
  });
});

describe('ghWriteFile', () => {
  it('PUTs base64 content to the branch and returns the commit sha', async () => {
    fetchMock.mockResolvedValue(json({ commit: { sha: 'commit-1' } }, 201));
    const out = await ghWriteFile('content/wiki/pathways/new.md', '# Ünïcode ✓', 'Add pathway');
    expect(out).toEqual({ commitSha: 'commit-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/example/repo/contents/content/wiki/pathways/new.md');
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-github-token');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ message: 'Add pathway', content: b64('# Ünïcode ✓'), branch: 'main' });
    expect(Buffer.from(body.content, 'base64').toString('utf-8')).toBe('# Ünïcode ✓');
  });

  it('passes the sha through when updating an existing file', async () => {
    fetchMock.mockResolvedValue(json({ commit: { sha: 'c2' } }));
    await ghWriteFile('f.md', 'x', 'Update', 'old-sha');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).sha).toBe('old-sha');
  });

  it('omits sha for a new file (and for an empty sha)', async () => {
    fetchMock.mockImplementation(async () => json({ commit: { sha: 'c' } }));
    await ghWriteFile('f.md', 'x', 'New');
    await ghWriteFile('f.md', 'x', 'New', '');
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(call[1]?.body as string)).not.toHaveProperty('sha');
    }
  });

  it('encodes empty content', async () => {
    fetchMock.mockResolvedValue(json({ commit: { sha: 'c' } }));
    await ghWriteFile('f.md', '', 'Empty');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).content).toBe('');
  });

  it.each([409, 422, 500])('throws with status and body on %i', async (status) => {
    fetchMock.mockResolvedValue(new Response('sha does not match', { status }));
    await expect(ghWriteFile('f.md', 'x', 'm', 'stale')).rejects.toThrow(
      `GitHub writeFile "f.md": ${status} sha does not match`
    );
  });

  it('throws on 404 (unlike reads, a write to a missing repo/branch is an error)', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(ghWriteFile('f.md', 'x', 'm')).rejects.toThrow(/404/);
  });

  it('propagates a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(ghWriteFile('f.md', 'x', 'm')).rejects.toThrow('ECONNRESET');
  });
});

describe('ghListFiles', () => {
  it('lists only files, not subdirectories', async () => {
    fetchMock.mockResolvedValue(
      json([
        { type: 'file', name: 'a.md', path: 'd/a.md', sha: '1', size: 3 },
        { type: 'dir', name: 'sub', path: 'd/sub', sha: '2' },
        { type: 'file', name: 'b.md', path: 'd/b.md', sha: '3' },
      ])
    );
    expect(await ghListFiles('d')).toEqual([
      { name: 'a.md', path: 'd/a.md', sha: '1' },
      { name: 'b.md', path: 'd/b.md', sha: '3' },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example/repo/contents/d?ref=main');
  });

  it('returns [] on 404', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    expect(await ghListFiles('missing')).toEqual([]);
  });

  it('returns [] when the path is a file rather than a directory', async () => {
    fetchMock.mockResolvedValue(json({ type: 'file', content: '', sha: 's' }));
    expect(await ghListFiles('a.md')).toEqual([]);
  });

  it('throws on other errors', async () => {
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 403 }));
    await expect(ghListFiles('d')).rejects.toThrow('GitHub listFiles "d": 403 rate limited');
  });
});

describe('module-level configuration', () => {
  it('defaults the branch to pathways-dev when GITHUB_BRANCH is unset', async () => {
    vi.resetModules();
    vi.stubEnv('GITHUB_BRANCH', undefined);
    const fresh = await import('@/lib/github');
    fetchMock.mockResolvedValue(json({ content: '', sha: 's' }));
    await fresh.ghReadFile('f.md');
    expect(fetchMock.mock.calls[0][0]).toContain('?ref=pathways-dev');
  });

  it('reads GITHUB_TOKEN at call time', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'rotated-token');
    fetchMock.mockResolvedValue(json({ content: '', sha: 's' }));
    await ghReadFile('f.md');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer rotated-token');
  });
});
