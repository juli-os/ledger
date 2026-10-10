// Usage ledger (the core surface of the Go internal/ledger/usage): prompt-level
// usage records + per-model stats + timeline. node:sqlite, standalone db file
// (prompt_usage.db).

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { priceUsage, type UsageCost, type UsageRow } from './pricing.ts';

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS prompt_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  -- cached_tokens: z.ai-convention cache hits (subset of input, wf_66a9b632154d)
  -- (fixed in passing during run-13 R1: the original JS-style // comments inside
  -- the SQL string are not valid SQLite; db.exec(MIGRATIONS) threw near "/":
  -- syntax error and every store-level test in the repo went red)
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_time ON prompt_usage(created_at);
CREATE TABLE IF NOT EXISTS claude_sessions (
  claude_session_id TEXT PRIMARY KEY,
  tmux_session TEXT NOT NULL DEFAULT '',
  transcript_path TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS claude_ingest_offset (
  claude_session_id TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  last_ingested_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS usage_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

export interface UsageRecord {
  readonly id: number;
  readonly source: string;
  readonly note: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly durationMs: number;
  readonly error: string;
  readonly createdAt: string;
}

export interface UsageStats {
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly byModel: readonly { readonly model: string; readonly calls: number; readonly inputTokens: number; readonly outputTokens: number }[];
}

export interface TimelinePoint {
  readonly hour: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface UsageStore {
  record(r: {
    source: string; note?: string; model?: string; inputTokens?: number;
    outputTokens?: number; cachedTokens?: number; durationMs?: number; error?: string;
  }): void;
  stats(sinceHours?: number): UsageStats;
  timeline(hours?: number): readonly TimelinePoint[];
  /** Local calendar-day aggregation (wf_e86d52c97b51 Dashboard): input/output/calls
   * for the last `days` days (including today), grouped by day — the "today's
   * tokens" metric means the calendar day, not a rolling 24h window. */
  byLocalDay(days?: number): readonly { readonly day: string; readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly calls: number }[];
  /** Session × multi-window aggregation (per-workflow prompt counting; user
   * annotation correction: one tmux session interleaves several workflows —
   * counted over the union of that work order's agent-step [started,
   * completed] intervals; waiting periods and other orders' windows don't
   * count). Rows attributed via tmux_session are counted exactly. */
  perSessionWindows(tmuxSession: string, windows: readonly (readonly [string, string])[]): { count: number; inputTokens: number; outputTokens: number };
  /** Row-level variant of perSessionWindows (wf_535149a174fe API-equivalent
   * costing): returns (model, in, out, cached) for each claude_code row of the
   * session within the windows — tier matching needs per-row input/output
   * lengths; aggregation and pricing happen in the pricing layer. Same
   * convention as perSessionWindows. */
  perSessionWindowsRows(tmuxSession: string, windows: readonly (readonly [string, string])[]): readonly { model: string; inputTokens: number; outputTokens: number; cachedTokens: number }[];
  /** API-equivalent cost for this work order's session × step windows
   * (wf_535149a174fe): row-level usage against the bigmodel price list
   * (pricing.ts), summed across the cache/input/output rates. The http layer
   * calls this via runtime injection — no new cross-package dependency edge. */
  sessionWindowsPriced(sessions: readonly string[], windows: readonly (readonly [string, string])[]): UsageCost;
  /** Input tokens of the session's latest claude_code turn (≈ current context
   * size; the compact-threshold input for the context gate, wf_a79a6fcbf7ef).
   * No records = 0. */
  latestInputTokens(tmuxSession: string): number;
  /** created_at of the session's most recent claude_code usage row (empty
   * string when there is none). Silence criterion for background execution
   * (wf_be61c3a55842 auto-close): CC turns keep producing usage rows, so
   * "event chain silent but rows still growing" = the agent is still working —
   * do not close out. */
  lastClaudeCodeAt(tmuxSession: string): string;
  recent(limit?: number): readonly UsageRecord[];
  /** CC transcript registration (the tmux session ↔ claude session mapping).
   * Directory-scan fallback: insert only, never overwrite (the overwrite bug
   * where multiple sessions in the same cwd stole each other's registration —
   * wf_e8d6984ba09e, third breakpoint). */
  recordClaudeSession(claudeSessionId: string, tmuxSession: string, transcriptPath: string, cwd: string): void;
  /** Precise registration (the CC hook self-reports each turn): may overwrite — the precise source takes priority over the scan fallback. */
  recordClaudeSessionPrecise(claudeSessionId: string, tmuxSession: string): void;
  /** Incremental ingest of the .jsonl transcripts of each project under claudeProjectsDir (offset-resumable). */
  ingestProjectTranscripts(claudeProjectsDir: string): number;
  /** wf_9658ce9225e0: historical claude_code rows have an empty tmux_session
   * (written before the mapping was wired up) in high proportion while the
   * mapping now exists → a replay is warranted. Run-14 R1 added a cooldown
   * (usage_meta stores last_claude_replay_at): replaying doesn't change the
   * attribution ratio (rows from humans using CC never have a mapping, so the
   * ratio won't improve by replaying) — without a cooldown every 60s tick
   * evaluated true → a full DELETE + re-read loop that locked itself. 24h
   * cooldown: replay costs O(bytes of full history), at most once a day;
   * mapping increments (precise hook registration) accumulate on the scale of
   * hours, and re-evaluating the next day keeps it self-healing. */
  needsClaudeReplay(): boolean;
  /** Wipe the claude_code rows and ingest offsets — the next ingest re-reads
   * the full transcripts with the (newly wired) mapping and backfills
   * tmux_session. cached_tokens is recomputed as well. Also writes the replay
   * marker (the cooldown origin for needsClaudeReplay). */
  resetClaudeIngest(): void;
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;
const n = (v: string | number | bigint | Uint8Array | null | undefined): number => typeof v === 'number' ? v : Number(v ?? 0);

/** Row-level claude_code usage of a session within windows (the shared query behind perSessionWindowsRows and pricing). */
const windowUsageRows = (db: DatabaseSync, tmuxSession: string, windows: readonly (readonly [string, string])[]): UsageRow[] => {
  if (windows.length === 0) return [];
  const conds = windows.map(() => '(created_at >= ? AND created_at <= ?)').join(' OR ');
  const params = [tmuxSession];
  for (const [a, b] of windows) params.push(a, b);
  return (db.prepare(
    `SELECT model, input_tokens AS i, output_tokens AS o, cached_tokens AS k
     FROM prompt_usage WHERE source='claude_code' AND tmux_session=? AND (${conds})`,
  ).all(...params) as Row[]).map((r) => ({
    model: String(r['model']), inputTokens: n(r['i']), outputTokens: n(r['o']), cachedTokens: n(r['k']),
  }));
};

/** Cooldown for the claude_code attribution replay (run-14 R1 P1-2): at most one full re-read per 24h. */
const REPLAY_COOLDOWN_MS = 24 * 3_600_000;

export const createUsageStore = (dbPath: string, now = (): Date => new Date()): UsageStore => {
  const db = new DatabaseSync(dbPath);
  db.exec(MIGRATIONS);
  // Add columns to pre-existing DBs (wf_66a9b632154d): CREATE IF NOT EXISTS does not add columns to a table that already exists.
  try { db.exec('ALTER TABLE prompt_usage ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0'); } catch { /* column already exists */ }
  // Session attribution (wf_2542c2c7eb13 per-workflow prompt counting): ingest looks the mapping up and writes it
  try { db.exec(`ALTER TABLE prompt_usage ADD COLUMN tmux_session TEXT NOT NULL DEFAULT ''`); } catch { /* column already exists */ }
  // Session-dimension query index (wf_be61c3a55842 lastClaudeCodeAt etc.): can
  // only be created after the ALTER above adds the column — putting it in
  // MIGRATIONS would crash fresh DBs with no such column before the ALTER runs.
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_session ON prompt_usage(tmux_session, id)`); } catch { /* index already exists */ }
  return {
    record(r) {
      db.prepare(`INSERT INTO prompt_usage (source, note, model, input_tokens, output_tokens, cached_tokens, duration_ms, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        r.source, r.note ?? '', r.model ?? '', r.inputTokens ?? 0, r.outputTokens ?? 0,
        r.cachedTokens ?? 0, r.durationMs ?? 0, r.error ?? '', now().toISOString(),
      );
    },
    stats(sinceHours = 24) {
      const since = new Date(now().getTime() - sinceHours * 3600_000).toISOString();
      const total = db.prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o
         FROM prompt_usage WHERE created_at >= ?`,
      ).get(since) as Row;
      const byModel = (db.prepare(
        `SELECT model, COUNT(*) AS c, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o
         FROM prompt_usage WHERE created_at >= ? AND model != '' GROUP BY model ORDER BY i DESC`,
      ).all(since) as Row[]).map((r) => ({
        model: String(r['model']), calls: n(r['c']), inputTokens: n(r['i']), outputTokens: n(r['o']),
      }));
      return {
        totalCalls: n(total?.['c']), totalInputTokens: n(total?.['i']), totalOutputTokens: n(total?.['o']),
        byModel,
      };
    },
    timeline(hours = 24) {
      const since = new Date(now().getTime() - hours * 3600_000).toISOString();
      return (db.prepare(
        `SELECT substr(created_at,1,13) AS hour, COUNT(*) AS c, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o
         FROM prompt_usage WHERE created_at >= ? GROUP BY hour ORDER BY hour`,
      ).all(since) as Row[]).map((r) => ({
        hour: String(r['hour']), calls: n(r['c']), inputTokens: n(r['i']), outputTokens: n(r['o']),
      }));
    },
    latestInputTokens(tmuxSession) {
      const r = db.prepare(
        `SELECT input_tokens AS i FROM prompt_usage
         WHERE source='claude_code' AND tmux_session=? ORDER BY id DESC LIMIT 1`,
      ).get(tmuxSession) as Row | undefined;
      return r === undefined ? 0 : n(r['i']);
    },
    lastClaudeCodeAt(tmuxSession) {
      const r = db.prepare(
        `SELECT created_at AS t FROM prompt_usage
         WHERE source='claude_code' AND tmux_session=? ORDER BY id DESC LIMIT 1`,
      ).get(tmuxSession) as Row | undefined;
      return r === undefined ? '' : String(r['t'] ?? '');
    },
    perSessionWindows(tmuxSession, windows) {
      if (windows.length === 0) return { count: 0, inputTokens: 0, outputTokens: 0 };
      const conds = windows.map(() => '(created_at >= ? AND created_at <= ?)').join(' OR ');
      const params = [tmuxSession];
      for (const [a, b] of windows) params.push(a, b);
      const r = db.prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o
         FROM prompt_usage WHERE source='claude_code' AND tmux_session=? AND (${conds})`,
      ).get(...params) as Row;
      return { count: n(r['c']), inputTokens: n(r['i']), outputTokens: n(r['o']) };
    },
    perSessionWindowsRows(tmuxSession, windows) {
      return windowUsageRows(db, tmuxSession, windows);
    },
    sessionWindowsPriced(sessions, windows) {
      if (sessions.length === 0 || windows.length === 0) return priceUsage([]);
      return priceUsage(sessions.flatMap((s) => windowUsageRows(db, s, windows)));
    },
    byLocalDay(days = 7) {
      // R1 P2-2: the WHERE boundary uses the same format as created_at (UTC
      // RFC3339 'T'+'Z', where lexicographic order = chronological order) —
      // the original datetime('now','localtime',...) space format compared
      // across formats with the 'T' format lexicographically, skewing the
      // boundary day by up to the tz-offset hours (over/under-counting).
      // Instantaneous-window semantics unchanged (localnow-Nd ≡ UTCnow-Nd at
      // the same instant); GROUP BY keeps localtime to slice local days.
      // Same convention as the toISOString boundary of usage.stats().
      const since = new Date(now().getTime() - days * 86_400_000).toISOString();
      return (db.prepare(
        `SELECT strftime('%Y-%m-%d', created_at, 'localtime') AS day,
                COUNT(*) AS c, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
                COALESCE(SUM(cached_tokens),0) AS k
         FROM prompt_usage
         WHERE created_at >= ?
         GROUP BY day ORDER BY day`,
      ).all(since) as Row[]).map((r) => ({
        day: String(r['day']), inputTokens: n(r['i']), outputTokens: n(r['o']),
        cachedTokens: n(r['k']), calls: n(r['c']),
      }));
    },
    needsClaudeReplay() {
      // Run-14 R1 (P1-2): replay cooldown — never evaluates true within 24h
      // after resetClaudeIngest. A missing marker (first evaluation on a
      // pre-existing DB) is not in cooldown; behavior matches the old version.
      const mark = db.prepare(`SELECT value FROM usage_meta WHERE key='last_claude_replay_at'`).get() as Row | undefined;
      const lastAt = mark === undefined ? '' : String(mark['value'] ?? '');
      const lastMs = lastAt === '' ? NaN : Date.parse(lastAt);
      if (Number.isFinite(lastMs) && now().getTime() - lastMs < REPLAY_COOLDOWN_MS) return false;
      const r = db.prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN tmux_session != '' THEN 1 ELSE 0 END) AS filled FROM prompt_usage WHERE source='claude_code'`,
      ).get() as Row;
      const total = n(r['total']); const filled = n(r['filled']);
      const mapped = n((db.prepare('SELECT COUNT(*) AS c FROM claude_sessions').get() as Row)['c']);
      // Mapping present + more than half of legacy rows unattributed → a replay would materially help.
      return mapped > 0 && total > 0 && filled * 2 < total;
    },
    resetClaudeIngest() {
      db.exec('DELETE FROM prompt_usage WHERE source=\'claude_code\'');
      db.exec('DELETE FROM claude_ingest_offset');
      db.prepare(`INSERT INTO usage_meta (key, value) VALUES ('last_claude_replay_at', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(now().toISOString());
    },

    recent(limit = 100) {
      return (db.prepare('SELECT * FROM prompt_usage ORDER BY id DESC LIMIT ?').all(limit) as Row[])
        .map((r) => ({
          id: n(r['id']), source: String(r['source']), note: String(r['note']),
          model: String(r['model']), inputTokens: n(r['input_tokens']), outputTokens: n(r['output_tokens']), cachedTokens: n(r['cached_tokens']),
          durationMs: n(r['duration_ms']), error: String(r['error']), createdAt: String(r['created_at']),
        }));
    },

    recordClaudeSession(claudeSessionId, tmuxSession, transcriptPath, cwd) {
      if (claudeSessionId === '' || transcriptPath === '') return;
      db.prepare(`INSERT INTO claude_sessions (claude_session_id, tmux_session, transcript_path, cwd)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(claude_session_id) DO UPDATE SET
          tmux_session=excluded.tmux_session,
          transcript_path=excluded.transcript_path,
          cwd=excluded.cwd
        WHERE tmux_session = '' `).run(claudeSessionId, tmuxSession, transcriptPath, cwd);
      // ↑ The fallback only registers blank rows (never steals an existing mapping — whether it came from the precise hook or another scan path)
    },

    recordClaudeSessionPrecise(claudeSessionId, tmuxSession) {
      if (claudeSessionId === '' || tmuxSession === '') return;
      db.prepare(`UPDATE claude_sessions SET tmux_session=? WHERE claude_session_id=?`)
        .run(tmuxSession, claudeSessionId);
      // Not yet registered (hook ahead of the scan): insert a placeholder row; the scan fills in the transcript path.
      db.prepare(`INSERT INTO claude_sessions (claude_session_id, tmux_session, transcript_path, cwd)
        VALUES (?, ?, '', '') ON CONFLICT(claude_session_id) DO NOTHING`).run(claudeSessionId, tmuxSession);
    },

    ingestProjectTranscripts(claudeProjectsDir) {
      // Transcripts with a registered mapping are handled via the mapping path (offsets are shared per session id).
      const mapped = new Set<string>(
        (db.prepare('SELECT claude_session_id FROM claude_sessions').all() as Row[])
          .map((r) => String(r['claude_session_id'])),
      );
      let count = 0;
      try {
        const projects = readdirSync(claudeProjectsDir);
        for (const proj of projects) {
          const dir = join(claudeProjectsDir, proj);
          let files: string[] = [];
          try {
            files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
          } catch {
            continue;
          }
          for (const f of files) {
            // wf_9658ce9225e0 second-breakpoint fix: the old "skip when
            // mapped.has (the mapping path handles it)" assumed a mapping-path
            // ingest that doesn't exist — once mapped, those transcripts were
            // ingested by no one at all (the second root cause of the all-empty
            // attribution observed in practice). Everything goes through
            // ingestFile: tmuxOf looks the mapping up per row; when present the
            // attribution is written, when absent it stays empty pending
            // backfill.
            const stem = f.replace(/\.jsonl$/, '');
            count += ingestFile(db, stem, join(dir, f));
          }
        }
      } catch {
        return count; // projects dir missing = no CC history
      }
      return count;
    },
  };
};

// ---- CC transcript jsonl ingest (aligned with Go usage/claude.go) ------------------

/** claude session → tmux session name (empty string when unregistered — the next turn after registration backfills the attribution). */
const tmuxOf = (db: DatabaseSync, claudeId: string): string => {
  const r = db.prepare('SELECT tmux_session FROM claude_sessions WHERE claude_session_id=?').get(claudeId) as { tmux_session?: string } | undefined;
  return r?.['tmux_session'] ?? '';
};

const ingestFile = (db: DatabaseSync, claudeId: string, transcriptPath: string): number => {
  let fd: number;
  try {
    fd = openSync(transcriptPath, 'r');
  } catch {
    return 0; // not created yet, or already rotated away
  }
  try {
    let offset = 0;
    const prev = db.prepare('SELECT byte_offset FROM claude_ingest_offset WHERE claude_session_id=?')
      .get(claudeId) as { byte_offset?: number | bigint } | undefined;
    offset = Number(prev?.['byte_offset'] ?? 0);
    const size = fstatSync(fd).size;
    if (offset > size) {
      // transcript rotated/truncated to before the offset — without a reset it would read empty forever and stall.
      offset = 0;
    }
    const length = Math.max(0, size - offset);
    if (length === 0) return 0;
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, offset);
    // Process only up to the last newline — the partial line is left for the next round.
    const text = buf.toString('utf8');
    const lastNL = text.lastIndexOf('\n');
    if (lastNL < 0) return 0;
    const complete = text.slice(0, lastNL + 1);
    let count = 0;
    for (const line of complete.split('\n')) {
      if (line === '') continue;
      const rec = parseAssistantLine(line);
      if (!rec) continue;
      const sess = tmuxOf(db, claudeId);
      db.prepare(`INSERT INTO prompt_usage (source, note, model, input_tokens, output_tokens, cached_tokens, duration_ms, error, created_at, tmux_session)
        VALUES ('claude_code', ?, ?, ?, ?, ?, 0, '', ?, ?)`).run(
        `turn=${String(rec.callContext).slice(0, 40)}`, rec.model,
        rec.inputTokens, rec.outputTokens, rec.cacheRead, rec.timestamp, sess,
      );
      count++;
    }
    const newOffset = offset + Buffer.byteLength(complete, 'utf8');
    db.prepare(`INSERT INTO claude_ingest_offset (claude_session_id, byte_offset, last_ingested_at)
      VALUES (?, ?, ?)
      ON CONFLICT(claude_session_id) DO UPDATE SET byte_offset=excluded.byte_offset, last_ingested_at=excluded.last_ingested_at`)
      .run(claudeId, newOffset, new Date().toISOString());
    return count;
  } finally {
    closeSync(fd);
  }
};

interface AssistantTurn {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheRead: number;
  readonly timestamp: string;
  readonly callContext: string;
}

/** Keep only assistant-typed rows with nonzero usage; totals include the cache
 * buckets (cache-based providers would be badly undercounted without
 * counting cache reads). */
const parseAssistantLine = (line: string): AssistantTurn | null => {
  try {
    const v = JSON.parse(line) as {
      type?: string; uuid?: string; timestamp?: string;
      message?: { model?: string; usage?: {
        input_tokens?: number; output_tokens?: number;
        cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
      } };
    };
    if (v.type !== 'assistant') return null;
    const u = v.message?.usage;
    if (!u || (!u.input_tokens && !u.output_tokens)) return null;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheCreate = u.cache_creation_input_tokens ?? 0;
    const input = (u.input_tokens ?? 0) + cacheRead + cacheCreate; // cache buckets count as input (Go convention: totals include cache)
    const output = u.output_tokens ?? 0;
    return {
      model: v.message?.model ?? '', inputTokens: input, outputTokens: output, cacheRead,
      timestamp: typeof v.timestamp === 'string' ? v.timestamp : new Date().toISOString(),
      callContext: v.uuid ?? '',
    };
  } catch {
    return null;
  }
};
