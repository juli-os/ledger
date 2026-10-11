// 用量账本（对应 Go internal/ledger/usage 的核心面）：prompt 级用量记录 +
// 按模型统计 + 时间线。node:sqlite，独立 db 文件（prompt_usage.db）。

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
  -- cached_tokens：z.ai 口径缓存命中（input 子集，wf_66a9b632154d）
  --（十三跑 R1 顺手修：原 JS 风格 // 注释写在 SQL 串内，SQLite 不认，
  -- db.exec(MIGRATIONS) 直接抛 near "/": syntax error，全仓 store 级测试尽红）
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
  /** 本地自然日聚合（wf_e86d52c97b51 Dashboard）：近 days 天（含今日）的
   * 输入/输出/调用数按日分组——「今日 Token」口径=自然日，非滚动 24h。 */
  byLocalDay(days?: number): readonly { readonly day: string; readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly calls: number }[];
  /** 会话×多时间窗聚合（per-workflow prompt 计数；用户批注修正：一个 tmux
   * session 会串多个 workflow——按该单各 agent 步的 [started, completed]
   * 区间并集计数，等待期/别单窗口不计）。tmux_session 归属行精确计。 */
  perSessionWindows(tmuxSession: string, windows: readonly (readonly [string, string])[]): { count: number; inputTokens: number; outputTokens: number };
  /** 行级版 perSessionWindows（wf_535149a174fe API 等效计价）：窗口内该会话
   * 的 claude_code 行逐行返回 (model, in, out, cached)——档位判定需要行级
   * input/output 长度，聚合与计价在 pricing 层做。口径同 perSessionWindows。 */
  perSessionWindowsRows(tmuxSession: string, windows: readonly (readonly [string, string])[]): readonly { model: string; inputTokens: number; outputTokens: number; cachedTokens: number }[];
  /** 该单会话×步窗口的 API 等效计价（wf_535149a174fe）：行级用量代入
   *  bigmodel 价目（pricing.ts）按 cache/input/output 三价加总。http 层经
   *  runtime 注入调用，不新增跨包依赖边。 */
  sessionWindowsPriced(sessions: readonly string[], windows: readonly (readonly [string, string])[]): UsageCost;
  /** 该会话最新一次 claude_code 回合的 input tokens（≈当前 context 量级，
   * wf_a79a6fcbf7ef context 门的 compact 阈值判据）。无记录=0。 */
  latestInputTokens(tmuxSession: string): number;
  /** 该会话最近一行 claude_code 用量的 created_at（无行返回空串）。回流
   * 执行静默判据（wf_be61c3a55842 自动收口）：CC 回合持续产生用量行，
   * 「事件链静默但行还在涨」= agent 仍在干活，不许收口。 */
  lastClaudeCodeAt(tmuxSession: string): string;
  recent(limit?: number): readonly UsageRecord[];
  /** CC transcript 登记（tmux 会话 ↔ claude session 的映射）。目录扫描兜底：
   * 只插不覆盖（同 cwd 多会话互相抢登记的覆盖 bug——wf_e8d6984ba09e 三断点）。 */
  recordClaudeSession(claudeSessionId: string, tmuxSession: string, transcriptPath: string, cwd: string): void;
  /** 精确登记（CC hook 每回合自报）：可覆盖——精确来源优先于扫描兜底。 */
  recordClaudeSessionPrecise(claudeSessionId: string, tmuxSession: string): void;
  /** 扫描 claudeProjectsDir 下各项目的 .jsonl transcript 增量摄取（offset 续传）。 */
  ingestProjectTranscripts(claudeProjectsDir: string): number;
  /** wf_9658ce9225e0：历史 claude_code 行 tmux_session 空（映射未接线时代
   * 写入）占比高且映射已建 → 该重放。十四跑 R1 加冷却（usage_meta 落
   * last_claude_replay_at）：重放不改归属分布（人用 CC 的行永远无映射，
   * 比率不会因重放改善）——无冷却时每 60s tick 恒真 → 全量 DELETE+重读
   * 循环自锁。冷却 24h：重放成本 O(全历史字节)，一日至多一次；映射增量
   * （hook 精确登记）以小时计累积，次日再判保留自愈。 */
  needsClaudeReplay(): boolean;
  /** 清掉 claude_code 行与 ingest offset——下轮 ingest 带（新接线的）映射
   * 全量重读 transcript，回填 tmux_session。cached_tokens 一并重算。
   * 同时落重放标记（needsClaudeReplay 的冷却起点）。 */
  resetClaudeIngest(): void;
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;
const n = (v: string | number | bigint | Uint8Array | null | undefined): number => typeof v === 'number' ? v : Number(v ?? 0);

/** 窗口内该会话的 claude_code 行级用量（perSessionWindowsRows 与计价的公共查询）。 */
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

/** claude_code 归属重放冷却（十四跑 R1 P1-2）：24h 内至多全量重读一次。 */
const REPLAY_COOLDOWN_MS = 24 * 3_600_000;

export const createUsageStore = (dbPath: string, now = (): Date => new Date()): UsageStore => {
  const db = new DatabaseSync(dbPath);
  db.exec(MIGRATIONS);
  // 旧库加列（wf_66a9b632154d）：CREATE IF NOT EXISTS 不会给已存在的表加列。
  try { db.exec('ALTER TABLE prompt_usage ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0'); } catch { /* 已有列 */ }
  // 会话归属（wf_2542c2c7eb13 per-workflow prompt 计数）：ingest 反查映射写入
  try { db.exec(`ALTER TABLE prompt_usage ADD COLUMN tmux_session TEXT NOT NULL DEFAULT ''`); } catch { /* 已有列 */ }
  // 会话维度查询索引（wf_be61c3a55842 lastClaudeCodeAt 等）：列在上方 ALTER
  // 补齐后才能建——放进 MIGRATIONS 会让新库在加列前炸 no such column。
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_session ON prompt_usage(tmux_session, id)`); } catch { /* 已有索引 */ }
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
      // R1 P2-2：WHERE 边界与 created_at 同格式（UTC RFC3339 'T'+'Z'，字符
      // 串序=时间序）——原 datetime('now','localtime',...) 空格格式与 'T'
      // 格式字典序跨格式比较，边界日至多偏差 tz-offset 小时（多含/漏计）。
      // 瞬时窗口语义不变（localnow-Nd ≡ UTCnow-Nd 同一时刻）；GROUP BY 保
      // 留 localtime 切本地日。口径同 usage.stats() 的 toISOString 边界。
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
      // 十四跑 R1（P1-2）：重放冷却——resetClaudeIngest 后 24h 内不再判定为真。
      // 标记不存在（存量库首判）不在冷却，行为与旧版一致。
      const mark = db.prepare(`SELECT value FROM usage_meta WHERE key='last_claude_replay_at'`).get() as Row | undefined;
      const lastAt = mark === undefined ? '' : String(mark['value'] ?? '');
      const lastMs = lastAt === '' ? NaN : Date.parse(lastAt);
      if (Number.isFinite(lastMs) && now().getTime() - lastMs < REPLAY_COOLDOWN_MS) return false;
      const r = db.prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN tmux_session != '' THEN 1 ELSE 0 END) AS filled FROM prompt_usage WHERE source='claude_code'`,
      ).get() as Row;
      const total = n(r['total']); const filled = n(r['filled']);
      const mapped = n((db.prepare('SELECT COUNT(*) AS c FROM claude_sessions').get() as Row)['c']);
      // 映射在场 + 存量空归属行过半 → 重放能实质改善。
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
      // ↑ 兜底只登记空白行（不抢已有映射——无论它来自精确 hook 还是别路扫描）
    },

    recordClaudeSessionPrecise(claudeSessionId, tmuxSession) {
      if (claudeSessionId === '' || tmuxSession === '') return;
      db.prepare(`UPDATE claude_sessions SET tmux_session=? WHERE claude_session_id=?`)
        .run(tmuxSession, claudeSessionId);
      // 未登记过的（hook 先于扫描）：插一行占位，transcript 路径由扫描补。
      db.prepare(`INSERT INTO claude_sessions (claude_session_id, tmux_session, transcript_path, cwd)
        VALUES (?, ?, '', '') ON CONFLICT(claude_session_id) DO NOTHING`).run(claudeSessionId, tmuxSession);
    },

    ingestProjectTranscripts(claudeProjectsDir) {
      // 已登记映射的 transcript 由映射路径负责（offset 按 session id 共享）。
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
            // wf_9658ce9225e0 二断点修复：原「mapped.has 跳过（由映射路径负责）」
            // 的映射路径 ingest 并不存在——映射后这些 transcript 反而无人摄取
            // （实测归属全空根因之二）。统一走 ingestFile：行内 tmuxOf 反查，
            // 映射在场即写归属，不在场留空待补。
            const stem = f.replace(/\.jsonl$/, '');
            count += ingestFile(db, stem, join(dir, f));
          }
        }
      } catch {
        return count; // 项目目录不存在 = 没有 CC 历史
      }
      return count;
    },
  };
};

// ---- CC transcript jsonl 摄取（对齐 Go usage/claude.go）---------------------------

/** claude session → tmux 会话名（未登记返回空串——下次登记后的新回合补齐归属）。 */
const tmuxOf = (db: DatabaseSync, claudeId: string): string => {
  const r = db.prepare('SELECT tmux_session FROM claude_sessions WHERE claude_session_id=?').get(claudeId) as { tmux_session?: string } | undefined;
  return r?.['tmux_session'] ?? '';
};

const ingestFile = (db: DatabaseSync, claudeId: string, transcriptPath: string): number => {
  let fd: number;
  try {
    fd = openSync(transcriptPath, 'r');
  } catch {
    return 0; // 尚未创建或已轮走
  }
  try {
    let offset = 0;
    const prev = db.prepare('SELECT byte_offset FROM claude_ingest_offset WHERE claude_session_id=?')
      .get(claudeId) as { byte_offset?: number | bigint } | undefined;
    offset = Number(prev?.['byte_offset'] ?? 0);
    const size = fstatSync(fd).size;
    if (offset > size) {
      // transcript 被轮转/截断到 offset 之前——不重置就会永远空读卡死。
      offset = 0;
    }
    const length = Math.max(0, size - offset);
    if (length === 0) return 0;
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, offset);
    // 只处理到最后一个换行——半行留给下一轮。
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

/** 只取 assistant 类型且用量非零的行；总量把 cache 桶也算进去（缓存型供应商
 * 不算 cache read 会严重低估真实用量）。 */
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
    const input = (u.input_tokens ?? 0) + cacheRead + cacheCreate; // cache 桶计入输入（Go 口径：总量含缓存）
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
