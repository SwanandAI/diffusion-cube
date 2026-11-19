import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Text-level checks over supabase/migrations/*.sql — nothing here connects to
// a database. SQL comments are stripped before matching so prose like
// "no insert policy" can't satisfy or trip a check.

const DIR = path.resolve(__dirname, '../../supabase/migrations');
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const sources = files.map((name) => ({
  name,
  sql: stripComments(fs.readFileSync(path.join(DIR, name), 'utf8')).toLowerCase(),
}));
const allSql = sources.map((s) => s.sql).join('\n');

function sourceOf(name: string) {
  const found = sources.find((s) => s.name === name);
  if (!found) throw new Error(`missing migration ${name}`);
  return found.sql;
}

describe('migration filenames', () => {
  it('finds migrations to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(39);
  });

  it('are all NNNN_snake_case.sql', () => {
    for (const f of files) expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('are numbered sequentially from 0001 with no gaps or duplicates', () => {
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});

describe('row level security', () => {
  const created = Array.from(
    allSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-z0-9_]+"?)(?:\s*\.\s*("?[a-z0-9_]+"?))?/g)
  )
    .filter((m) => !m[2]) // schema-qualified non-public tables (m[2] set) are skipped below
    .map((m) => m[1].replace(/"/g, ''));

  // Tables explicitly created in another schema, e.g. auth.foo — none expected.
  const otherSchema = Array.from(allSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+)\.([a-z0-9_]+)/g))
    .filter((m) => m[1] !== 'public')
    .map((m) => `${m[1]}.${m[2]}`);

  it('finds the public tables', () => {
    expect(created).toEqual(expect.arrayContaining(['user_roles', 'pathways', 'rate_limits', 'sys_errors', 'ai_usage']));
    expect(otherSchema).toEqual([]);
  });

  it('every public table created has RLS enabled somewhere', () => {
    const missing = [...new Set(created)].filter(
      (t) => !new RegExp(`alter\\s+table\\s+(?:public\\.)?${t}\\s+enable\\s+row\\s+level\\s+security`).test(allSql)
    );
    expect(missing).toEqual([]);
  });

  it('no migration disables RLS', () => {
    expect(allSql).not.toMatch(/disable\s+row\s+level\s+security/);
  });
});

describe('0039_default_adopter_role', () => {
  const sql = sourceOf('0039_default_adopter_role.sql');

  it('defines grant_default_adopter_role as security definer with an empty search_path', () => {
    const fn = sql.match(/create\s+or\s+replace\s+function\s+public\.grant_default_adopter_role\(\)[\s\S]*?\$\$;/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/returns\s+trigger/);
    expect(fn![0]).toMatch(/security\s+definer/);
    expect(fn![0]).toMatch(/set\s+search_path\s*=\s*''/);
    expect(fn![0]).toMatch(/insert\s+into\s+public\.user_roles\s*\(user_id,\s*role\)\s*values\s*\(new\.id,\s*'adopter'\)/);
    expect(fn![0]).toMatch(/on\s+conflict\s*\(user_id,\s*role\)\s+do\s+nothing/);
  });

  it('creates the on_auth_user_created_grant_adopter trigger after insert on auth.users', () => {
    expect(sql).toMatch(/drop\s+trigger\s+if\s+exists\s+on_auth_user_created_grant_adopter\s+on\s+auth\.users/);
    expect(sql).toMatch(
      /create\s+trigger\s+on_auth_user_created_grant_adopter\s+after\s+insert\s+on\s+auth\.users\s+for\s+each\s+row\s+execute\s+function\s+public\.grant_default_adopter_role\(\)/
    );
  });

  it('backfills adopter for every existing auth user idempotently', () => {
    expect(sql).toMatch(
      /insert\s+into\s+public\.user_roles\s*\(user_id,\s*role\)\s*select\s+id,\s*'adopter'\s+from\s+auth\.users\s+on\s+conflict\s*\(user_id,\s*role\)\s+do\s+nothing/
    );
  });

  it('removes general_user rows before tightening the check', () => {
    const del = sql.search(/delete\s+from\s+public\.user_roles\s+where\s+role\s*=\s*'general_user'/);
    const add = sql.search(/add\s+constraint\s+user_roles_role_check/);
    expect(del).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(del);
  });
});

describe('user_roles role check', () => {
  it('the last definition allows exactly adopter, pathway_contributor and admin', () => {
    const defs = Array.from(
      allSql.matchAll(/add\s+constraint\s+user_roles_role_check\s+check\s*\(\s*role\s+in\s*\(([^)]*)\)\s*\)/g)
    );
    expect(defs.length).toBeGreaterThan(0);
    const last = defs[defs.length - 1][1];
    const roles = Array.from(last.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort();
    expect(roles).toEqual(['admin', 'adopter', 'pathway_contributor']);
    expect(roles).not.toContain('general_user');
  });

  it('the last check is defined in 0039', () => {
    const lastFile = [...sources].reverse().find((s) => /add\s+constraint\s+user_roles_role_check/.test(s.sql));
    expect(lastFile?.name).toBe('0039_default_adopter_role.sql');
  });
});

describe('user_roles cannot be written by clients', () => {
  const policies = Array.from(
    allSql.matchAll(/create\s+policy\s+"[^"]*"\s+on\s+(?:public\.)?user_roles\b([\s\S]*?);/g)
  ).map((m) => m[1]);

  it('has a read-own-roles select policy', () => {
    expect(policies.some((p) => /for\s+select/.test(p) && /auth\.uid\(\)\s*=\s*user_id/.test(p))).toBe(true);
  });

  it('defines no insert/update/delete/all policy on user_roles', () => {
    const writable = policies.filter((p) => /for\s+(insert|update|delete|all)\b/.test(p) || !/for\s+select/.test(p));
    expect(writable).toEqual([]);
  });

  it('grants no write privilege on user_roles to anon/authenticated/public', () => {
    expect(allSql).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+(?:table\s+)?(?:public\.)?user_roles\b[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/
    );
  });
});

// pathways.content_cache is a pathway's unpublished, under-review document, so
// no policy left standing may let any signed-in user read every row.
describe('pathways select policies (0040)', () => {
  // Policies on pathways left after every migration: created ones minus those
  // a later migration drops by name.
  function effectivePolicies() {
    const live = new Map<string, string>();
    for (const { sql } of sources) {
      for (const m of sql.matchAll(
        /(create|drop)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?pathways\b([\s\S]*?);/g
      )) {
        if (m[1] === 'create') live.set(m[2], m[3]);
        else live.delete(m[2]);
      }
    }
    return live;
  }

  it('drops the 0020 "any signed-in user" select policy', () => {
    expect(effectivePolicies().has('signed-in users can view pathways')).toBe(false);
  });

  it('no remaining select policy is satisfied by being signed in alone', () => {
    const selects = [...effectivePolicies().values()].filter((p) => /for\s+select/.test(p));
    expect(selects.length).toBeGreaterThan(0);
    for (const p of selects) {
      expect(p).not.toMatch(/using\s*\(\s*auth\.uid\(\)\s+is\s+not\s+null\s*\)/);
      expect(p).not.toMatch(/using\s*\(\s*true\s*\)/);
    }
  });

  it('admits exactly members of the pathway and admin role holders', () => {
    const [policy] = [...effectivePolicies().values()].filter((p) => /for\s+select/.test(p));
    expect(policy).toMatch(/pathway_contributors\s+pc\s+where\s+pc\.pathway_id\s*=\s*pathways\.id\s+and\s+pc\.user_id\s*=\s*auth\.uid\(\)/);
    expect(policy).toMatch(/user_roles\s+ur\s+where\s+ur\.user_id\s*=\s*auth\.uid\(\)\s+and\s+ur\.role\s*=\s*'admin'/);
  });
});

// Pathway storage (docs/features/pathway-storage/, PS-01). The raw file is
// read too: the "destructive" warning lives in its leading comment.
describe('0042_pathway_storage', () => {
  const raw = fs.readFileSync(path.join(DIR, '0042_pathway_storage.sql'), 'utf8');
  const sql = sourceOf('0042_pathway_storage.sql');

  it('says up front that it is destructive', () => {
    const header = raw.split('\n').filter((l) => l.startsWith('--')).join('\n');
    expect(header).toMatch(/DESTRUCTIVE/);
    expect(header).toMatch(/published_pathways/);
  });

  it('enables pgvector and stores 384-dim gte-small embeddings', () => {
    expect(sql).toMatch(/create\s+extension\s+if\s+not\s+exists\s+vector/);
    expect((sql.match(/vector\(384\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/using\s+hnsw\s*\(\s*embedding\s+extensions\.vector_cosine_ops\s*\)/);
    expect(sql).toMatch(/using\s+gin\s*\(\s*fts\s*\)/);
  });

  it('creates the version, unit and source tables with RLS', () => {
    for (const t of ['pathway_versions', 'pathway_units', 'pathway_sources', 'pathway_source_chunks']) {
      expect(sql).toMatch(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${t}\\b`));
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`));
    }
  });

  it('gives originals and their passages no client policy at all', () => {
    expect(sql).not.toMatch(/create\s+policy[^;]*\bon\s+public\.pathway_sources\b/);
    expect(sql).not.toMatch(/create\s+policy[^;]*\bon\s+public\.pathway_source_chunks\b/);
  });

  it('lets clients read units and versions but never write them', () => {
    for (const t of ['pathway_units', 'pathway_versions']) {
      const policies = Array.from(sql.matchAll(new RegExp(`create\\s+policy[^;]*\\bon\\s+public\\.${t}\\b[^;]*;`, 'g'))).map((m) => m[0]);
      expect(policies.length).toBe(1);
      expect(policies[0]).toMatch(/for\s+select/);
    }
  });

  it('turns published_pathways into a view of published pathways only', () => {
    expect(sql).toMatch(/drop\s+table\s+if\s+exists\s+public\.published_pathways/);
    const view = sql.match(/create\s+view\s+public\.published_pathways\s+as([\s\S]*?);/)?.[1] ?? '';
    expect(view).toMatch(/where\s+p\.status\s*=\s*'published'/);
    for (const col of ['slug', 'title', 'description', 'category', 'content', 'sector', 'location', 'tags', 'stage', 'contributor_org', 'created_at']) {
      expect(view).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.published_pathways\s+to\s+anon,\s*authenticated/);
  });

  it('keeps the search functions server-only', () => {
    for (const fn of ['match_pathway_units', 'match_source_chunks']) {
      expect(sql).toMatch(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\(`));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\([^)]*\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`));
    }
  });

  it('searches published pathways only, and public passages only', () => {
    const units = sql.match(/function\s+public\.match_pathway_units\([\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? '';
    const chunks = sql.match(/function\s+public\.match_source_chunks\([\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? '';
    expect(units).toMatch(/p\.status\s*=\s*'published'/);
    expect(chunks).toMatch(/p\.status\s*=\s*'published'/);
    expect(chunks).toMatch(/and\s+s\.is_public/);
  });

  it('leaves no existing pathway published', () => {
    expect(sql).toMatch(/set\s+status\s*=\s*case\s+when\s+review_requested\s+then\s+'in_review'\s+else\s+'draft'\s+end/);
  });
});

// Thumbs up / down on Cube's replies (POST /api/feedback, shown on /admin/usage).
describe('0043_message_feedback', () => {
  const raw = fs.readFileSync(path.join(DIR, '0043_message_feedback.sql'), 'utf8');
  const sql = sourceOf('0043_message_feedback.sql');

  it('says it is additive', () => {
    const header = raw.split('\n').filter((l) => l.startsWith('--')).join('\n');
    expect(header).toMatch(/Additive only/);
    expect(header).not.toMatch(/DESTRUCTIVE/);
    expect(sql).not.toMatch(/\bdrop\s+(table|view|column|function)\b/);
  });

  it('creates message_feedback with RLS and no client policy', () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+public\.message_feedback\b/);
    expect(sql).toMatch(/alter\s+table\s+public\.message_feedback\s+enable\s+row\s+level\s+security/);
    expect(sql).not.toMatch(/create\s+policy/);
  });

  it('keeps one vote per reply per voter, and only +1 / -1', () => {
    expect(sql).toMatch(/unique\s*\(\s*message_id\s*,\s*voter_key\s*\)/);
    expect(sql).toMatch(/check\s*\(\s*vote\s+in\s*\(\s*1\s*,\s*-1\s*\)\s*\)/);
    expect(sql).toMatch(/check\s*\(\s*surface\s+in\s*\(\s*'explore'\s*,\s*'analyse'\s*,\s*'contribute'\s*\)\s*\)/);
  });

  it('removes a deleted account\'s votes with it', () => {
    expect(sql).toMatch(/user_id\s+uuid\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/);
  });

  it('makes admin_feedback_stats() a security-definer function only the server may call', () => {
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.admin_feedback_stats\(\)[\s\S]*?security\s+definer/);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.admin_feedback_stats\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.admin_feedback_stats\(\)\s+to\s+service_role/);
  });
});

// Feedback Digest for admins (docs/features/feedback-digest/, FD-01).
describe('0044_feedback_digest', () => {
  const raw = fs.readFileSync(path.join(DIR, '0044_feedback_digest.sql'), 'utf8');
  const sql = sourceOf('0044_feedback_digest.sql');
  const header = raw.split('\n').filter((l) => l.startsWith('--')).join('\n');
  const TABLES = ['feedback_digest_runs', 'feedback_digests', 'feedback_digest_lock'];
  const FUNCTIONS = [
    ['admin_digest_stats', 'int, timestamptz'],
    ['admin_digest_input', 'int'],
    ['claim_feedback_digest_run', 'int, uuid, int'],
    ['finish_feedback_digest_run', 'uuid, text, jsonb'],
  ] as const;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('names its one non-additive step in capitals', () => {
    expect(header).toMatch(/REPLACED/);
    expect(header).not.toMatch(/DESTRUCTIVE/);
    expect(sql).not.toMatch(/\bdrop\s+(table|view|column|function)\b/);
  });

  it('creates the three tables with RLS on, no client policy and no client grants', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${t}\\b`));
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+anon\\s*,\\s*authenticated`));
    }
    expect(sql).not.toMatch(/create\s+policy/);
  });

  it('keeps one digest per period (7 or 30) and a single-row lock', () => {
    expect(sql).toMatch(/period_days\s+int\s+primary\s+key\s+check\s*\(\s*period_days\s+in\s*\(\s*7\s*,\s*30\s*\)\s*\)/);
    expect(sql).toMatch(/id\s+int\s+primary\s+key\s+default\s+1\s+check\s*\(\s*id\s*=\s*1\s*\)/);
    expect(sql).toMatch(/'running'\s*,\s*'succeeded'\s*,\s*'empty'\s*,\s*'failed'\s*,\s*'superseded'/);
  });

  it("widens ai_usage's area check to allow 'admin'", () => {
    expect(sql).toMatch(/alter\s+table\s+public\.ai_usage\s+drop\s+constraint\s+if\s+exists\s+ai_usage_area_check/);
    expect(sql).toMatch(/check\s*\(\s*area\s+in\s*\(\s*'explore'\s*,\s*'analyse'\s*,\s*'contribute'\s*,\s*'admin'\s*\)\s*\)/);
  });

  it('makes every function security definer and executable by the service role only', () => {
    for (const [name, args] of FUNCTIONS) {
      expect(sql).toMatch(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\([\\s\\S]*?security\\s+definer`));
      expect(sql).toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`)
      );
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+service_role`));
    }
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.digest_message_time\(text,\s*timestamptz\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/);
  });

  it('sends the bubble text of uploads, never their extracted content, and caps the input at 400 messages', () => {
    expect(sql).toMatch(/coalesce\(\s*nullif\(\s*u\.msg->>'displaycontent'/);
    expect(sql).toMatch(/limit\s+400/);
  });

  it('counts the daily cap in India Standard Time and serialises claims', () => {
    expect(sql).toMatch(/asia\/kolkata/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
  });
});

// Gap-filling text checks for 0044 (QA pass). Text only: nothing here runs the SQL
// (see "Manual / needs a real database" in the QA report).
describe('0044_feedback_digest: function bodies', () => {
  const sql = sourceOf('0044_feedback_digest.sql');
  const fn = (name: string) => {
    const m = sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\([\\s\\S]*?\\$\\$;`));
    expect(m, `${name} is defined`).not.toBeNull();
    return m![0];
  };

  it('every security definer function pins search_path to public', () => {
    const definers = sql.match(/create\s+or\s+replace\s+function[\s\S]*?\$\$;/g)!.filter((f) => /security\s+definer/.test(f));
    expect(definers).toHaveLength(4);
    for (const f of definers) expect(f).toMatch(/set\s+search_path\s*=\s*public/);
  });

  it('the stats and input functions return null for any period other than 7 or 30', () => {
    for (const name of ['admin_digest_stats', 'admin_digest_input']) {
      expect(fn(name)).toMatch(/when\s+p_days\s+not\s+in\s*\(\s*7\s*,\s*30\s*\)\s+then\s+null/);
    }
  });

  it('claim rejects a bad period before it touches the lock, and takes a 5-minute lease', () => {
    const f = fn('claim_feedback_digest_run');
    expect(f.indexOf('bad_period')).toBeGreaterThan(-1);
    expect(f.indexOf('bad_period')).toBeLessThan(f.indexOf('pg_advisory_xact_lock'));
    expect(f).toMatch(/interval\s+'5 minutes'/);
    expect(f).toMatch(/locked_until\s*>\s*now\(\)/);
    expect(f).toMatch(/'busy'/);
    expect(f).toMatch(/'daily_limit'/);
    expect(f).toMatch(/v_count\s*>=\s*p_cap/);
  });

  it('claim checks "busy" before the daily cap and counts the cap from the start of the India day', () => {
    const f = fn('claim_feedback_digest_run');
    expect(f.indexOf("'busy'")).toBeLessThan(f.indexOf("'daily_limit'"));
    expect(f).toMatch(/date_trunc\('day',\s*now\(\)\s+at\s+time\s+zone\s+'asia\/kolkata'\)\s+at\s+time\s+zone\s+'asia\/kolkata'/);
    expect(f).toMatch(/started_at\s*>=\s*v_day_start/);
  });

  it('finish only touches feedback_digests for a succeeded or empty run that still holds the lease', () => {
    const f = fn('finish_feedback_digest_run');
    expect(f.match(/insert\s+into\s+public\.feedback_digests/g)).toHaveLength(1);
    const guard = f.indexOf("if p_status in ('succeeded', 'empty') then");
    expect(guard).toBeGreaterThan(-1);
    expect(f.indexOf('insert into public.feedback_digests')).toBeGreaterThan(guard);
    expect(f.indexOf("status = 'superseded'")).toBeGreaterThan(guard);
    expect(f.indexOf("status = 'superseded'")).toBeLessThan(f.indexOf('insert into public.feedback_digests'));
    expect(f).toMatch(/if\s+not\s+v_held\s+then[\s\S]*?return\s+false/);
    expect(f).toMatch(/delete\s+from\s+public\.feedback_digest_lock\s+where\s+id\s*=\s*1\s+and\s+run_id\s*=\s*p_run/);
  });

  it('finish refuses an unknown status, a run that is not running, and a payload that is not an object or is over 1 MB', () => {
    const f = fn('finish_feedback_digest_run');
    expect(f).toMatch(/p_status\s+not\s+in\s*\(\s*'succeeded'\s*,\s*'empty'\s*,\s*'failed'\s*\)/);
    expect(f).toMatch(/status\s*=\s*'running'/);
    expect(f).toMatch(/jsonb_typeof\(p_payload\)\s+is\s+distinct\s+from\s+'object'/);
    expect(f).toMatch(/pg_column_size\(p_payload\)\s*>\s*1048576/);
  });

  it('the model input never carries a user id, email or name, and numbers people at random', () => {
    const f = fn('admin_digest_input');
    const built = f.match(/jsonb_build_object\([\s\S]*?\)\s*order\s+by/g)!.join('\n');
    expect(built).not.toMatch(/user_id|email|name|voter/);
    expect(f).toMatch(/row_number\(\)\s+over\s*\(\s*order\s+by\s+random\(\)\s*\)/);
  });

  it('the model input skips hidden messages and reads the message time through the safe function', () => {
    const f = fn('admin_digest_input');
    expect(f).toMatch(/coalesce\(\s*(?:u\.)?msg->>'hidden'\s*,\s*''\)\s*<>\s*'true'/);
    expect(f).toMatch(/digest_message_time\(/);
    expect(sql).not.toMatch(/\(\s*(?:u\.)?msg->>'at'\s*\)::timestamptz/); // no raw cast that could raise
  });

  it('a malformed "at" falls back to the conversation time and never raises', () => {
    const f = fn('digest_message_time');
    expect(f).toMatch(/exception\s+when\s+others\s+then\s+return\s+p_fallback/);
    expect(f).toMatch(/p_at\s+is\s+null\s+or\s+p_at\s*=\s*''/);
  });

  it('only published pathways, whole-conversation counts and deleted-conversation keys feed the page', () => {
    const f = fn('admin_digest_stats');
    expect(f).toMatch(/p\.status\s*=\s*'published'/);
    expect(f).toMatch(/count\(distinct\s+mn\.key\)/);
    expect(f).toMatch(/limit\s+10/);
    expect(f).toMatch(/'live_keys'/);
    expect(f).toMatch(/'f:'\s*\|\|\s*f\.id/);
  });

  it('the input caps messages at 400 newest-first, 80 per person, and cuts text to 400 / 400 / 300 characters (trimmed after scrubbing)', () => {
    const f = fn('admin_digest_input');
    expect(f).toMatch(/order\s+by\s+at\s+desc\s+limit\s+400/);
    expect(f).toMatch(/partition\s+by\s+p\.user_id\s+order\s+by\s+p\.at\s+desc/);
    expect(f).toMatch(/rn\s*<=\s*80/);
    expect(f).toMatch(/left\([\s\S]*?,\s*400\)\s+as\s+question/);
    expect(f).toMatch(/left\(r\.msg->>'content',\s*400\)\s+as\s+reply/);
    expect(f).toMatch(/left\(f\.message_excerpt,\s*300\)\s+as\s+excerpt/);
  });

  it('an unstamped message is ordered by its conversation\'s last update; a future or infinite stamp cannot jump the queue', () => {
    expect(fn('admin_digest_input')).toMatch(/digest_message_time\(u\.msg->>'at',\s*u\.updated_at\)/);
    const t = sql.slice(sql.indexOf('function public.digest_message_time'), sql.indexOf('revoke all on function public.digest_message_time'));
    expect(t).toMatch(/isfinite\(v\)/);
    expect(t).toMatch(/least\(v,\s*now\(\)\)/);
  });

  // The text tests can't run SQL, so check the shape that once broke: every plpgsql function's
  // header (up to `as $$`) holds only declarations, never statements.
  it('every function header runs straight into its body (no stray statements before "as $$")', () => {
    const headers = [...sql.matchAll(/create or replace function[\s\S]*?\bas \$\$/g)].map((m) => m[0]);
    expect(headers.length).toBeGreaterThanOrEqual(5);
    for (const h of headers) expect(h).not.toMatch(/\b(return|exception|begin|declare)\b/i);
  });

  it('only 👎 votes whose conversation still exists are put in the input', () => {
    const f = fn('admin_digest_input');
    expect(f).toMatch(/f\.vote\s*=\s*-1/);
    expect(f).toMatch(/f\.conversation_id\s+is\s+null/);
  });

  it('adds indexes on the two conversation tables\' created_at and nothing else on existing tables', () => {
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+designs_created_at_idx\s+on\s+public\.designs\s*\(created_at\)/);
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+library_conversations_created_at_idx\s+on\s+public\.library_conversations\s*\(created_at\)/);
    expect(sql).not.toMatch(/alter\s+table\s+public\.(designs|library_conversations|message_feedback)\b/);
  });

  it('its header names the client files that write the JSON it reads', () => {
    const raw = fs.readFileSync(path.join(DIR, '0044_feedback_digest.sql'), 'utf8');
    for (const file of ['components/ChatPanel.tsx', 'lib/adoption-conversation.ts', 'app/explore/ExploreLibrary.tsx']) {
      expect(raw).toContain(file);
    }
    expect(raw).toMatch(/PERFORMANCE/);
  });

  it('counts a conversation in the period by created_at, exactly as admin_usage_stats() does for /admin/usage', () => {
    const period = /created_at\s*>=\s*now\(\)\s*-\s*make_interval\(days\s*=>\s*p_days\)/;
    expect(fn('admin_digest_stats')).toMatch(period);
    const input = fn('admin_digest_input');
    expect(input).toMatch(/d\.created_at\s*>=\s*now\(\)\s*-\s*make_interval\(days\s*=>\s*p_days\)/);
    expect(input).toMatch(/l\.created_at\s*>=\s*now\(\)\s*-\s*make_interval\(days\s*=>\s*p_days\)/);
    // No second, message-time definition of "in the period" for conversations.
    expect(input).not.toMatch(/where\s+at\s*>=/);
    expect(fn('admin_digest_stats')).not.toMatch(/updated_at/);
    // The Usage page's own definition this mirrors (0041).
    const usage = sourceOf('0041_admin_usage_stats_ist.sql');
    expect(usage).toMatch(/count\(\*\)\s+filter\s+\(where\s+created_at\s*>=\s*now\(\)\s*-\s*interval\s+'7 days'\)/);
  });

  it('keeps no cost, price or token columns in the run log', () => {
    expect(sql).not.toMatch(/cost|price|input_tokens|output_tokens/);
  });

  it('the stats function leaves totals and 👍/👎 counts to /admin/usage', () => {
    const f = fn('admin_digest_stats');
    expect(f).not.toMatch(/users_total|conversations_total|conversations_by_area|thumbs_up|thumbs_down/);
    expect(f).toMatch(/'users_period'/);
    expect(f).toMatch(/'conversations_period'/);
  });

  it('keeps digests, runs and the lock unreadable by clients: no grant to anon or authenticated anywhere', () => {
    expect(sql).not.toMatch(/grant\s+[^;]*\bto\s+(anon|authenticated|public)\b/);
  });
});

// Overall / 7 / 30-day toggle on /admin/usage's Activity table.
describe('0045_activity_periods', () => {
  const raw = fs.readFileSync(path.join(DIR, '0045_activity_periods.sql'), 'utf8');
  const sql = sourceOf('0045_activity_periods.sql');

  it('is the latest migration, additive only, and replaces functions without dropping anything', () => {
    expect(files[files.length - 1]).toBe('0045_activity_periods.sql');
    const header = raw.split('\n').filter((l) => l.startsWith('--')).join('\n');
    expect(header).toMatch(/Additive only/);
    expect(sql).not.toMatch(/\b(drop|alter|create\s+table)\b/);
  });

  it('adds last_30d to conversations, counted by created_at like last_7d', () => {
    expect(sql).toMatch(/'last_30d',\s*last_30d/);
    expect(sql).toMatch(/filter\s+\(where\s+created_at\s*>=\s*now\(\)\s*-\s*interval\s+'30 days'\)\s+as\s+last_30d/);
    expect(sql).toMatch(/filter\s+\(where\s+created_at\s*>=\s*now\(\)\s*-\s*interval\s+'7 days'\)\s+as\s+last_7d/);
  });

  it('adds up_30d / down_30d to the feedback figures and keeps every earlier key', () => {
    for (const key of ['up', 'down', 'up_7d', 'down_7d', 'up_30d', 'down_30d', 'recent_down']) {
      expect(sql).toMatch(new RegExp(`'${key}'`));
    }
    expect(sql).toMatch(/vote\s*=\s*1\s+and\s+updated_at\s*>=\s*now\(\)\s*-\s*interval\s+'30 days'\)\s+as\s+up_30d/);
    expect(sql).toMatch(/vote\s*=\s*-1\s+and\s+updated_at\s*>=\s*now\(\)\s*-\s*interval\s+'30 days'\)\s+as\s+down_30d/);
  });

  it('keeps both functions security definer and executable by the service role only', () => {
    for (const name of ['admin_usage_stats', 'admin_feedback_stats']) {
      expect(sql).toMatch(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(\\)[\\s\\S]*?security\\s+definer`));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(\\)\\s+to\\s+service_role`));
    }
    expect(sql).toMatch(/asia\/kolkata/); // keeps 0041's IST error days
  });
});
