// CaseFile：持久案卷文档——工作流行上的一个 JSON 列，每步只追加自己的
// section，任何步可读全文。本模块只提供纯函数：每次"追加"返回新文档，
// 不变性由类型保证（对应 Go lifecycle.CaseFile 的 Set/Append 家族）。

import type { JsonRecord, JsonValue } from '../shared/json.ts';
import { asRecord, safeParse } from '../shared/json.ts';
import { rfc3339 } from '../shared/clock.ts';

export interface CaseDecision {
  readonly seq: number;
  readonly action: string; // approved | denied | resolved | zombie_failed（看门狗）
  readonly by: string;
  readonly note: string;
  readonly at: string;
}

export interface ArtifactRef {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly key: string;
  readonly seq: number;
  readonly sha8: string;
  readonly bytes: number;
}

export interface CaseFileDoc {
  readonly original: Readonly<Record<string, string>>; // from/subject/body/message_id
  readonly extract: JsonValue | null;
  readonly executions: readonly JsonValue[];
  readonly draft: JsonValue | null;
  readonly decisions: readonly CaseDecision[];
  readonly references: readonly string[];
  readonly artifacts: readonly ArtifactRef[];
  readonly updatedAt: string;
}

export const emptyCaseFile = (now: Date): CaseFileDoc => ({
  original: {},
  extract: null,
  executions: [],
  draft: null,
  decisions: [],
  references: [],
  artifacts: [],
  updatedAt: rfc3339(now),
});

/** JSON 数组 → 类型化数组的收敛守卫（经 unknown 中转，保住不变性类型）。 */
const pick = <T>(vals: readonly JsonValue[], guard: (v: object) => boolean): readonly T[] => {
  const out: T[] = [];
  for (const v of vals) {
    if (typeof v === 'object' && v !== null && guard(v)) out.push(v as T);
  }
  return out;
};

/** 解析库里的 JSON 列；空/坏值 → 空白案卷（容忍历史数据）。 */
export const parseCaseFile = (raw: string | null, now: Date): CaseFileDoc => {
  const base = emptyCaseFile(now);
  const v = safeParse(raw);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return base;
  const r = v as JsonRecord;
  const str = (k: string): string => {
    const x = r[k];
    return typeof x === 'string' ? x : '';
  };
  const arr = (k: string): readonly JsonValue[] => {
    const x = r[k];
    return Array.isArray(x) ? x : [];
  };
  return {
    original: Object.fromEntries(
      Object.entries(asRecord(r.original)).filter(([, x]) => typeof x === 'string'),
    ) as Readonly<Record<string, string>>,
    extract: r.extract ?? null,
    executions: arr('executions'),
    draft: r.draft ?? null,
    decisions: pick<CaseDecision>(arr('decisions'), (d) => 'action' in d),
    references: arr('references').filter((x): x is string => typeof x === 'string'),
    artifacts: pick<ArtifactRef>(arr('artifacts'), (a) => 'id' in a),
    updatedAt: str('updated_at') || base.updatedAt,
  };
};

export const serializeCaseFile = (cf: CaseFileDoc): string => JSON.stringify(cf);

// ---- 纯变换（每个都返回新文档）------------------------------------------------

export const withOriginal = (
  cf: CaseFileDoc,
  o: { from: string; fromName?: string; subject: string; body: string; messageId: string },
  now: Date,
): CaseFileDoc => ({
  ...cf,
  original: {
    from: o.from,
    // 发件人显示名（RFC2047 已解码）——2026-10-01 陈莉君幻觉事故后随原档
    // 落卷：回信称呼的合法来源，agent 不再被逼对着地址起名。
    ...(o.fromName !== undefined && o.fromName !== '' ? { from_name: o.fromName } : {}),
    subject: o.subject, body: o.body, message_id: o.messageId,
  },
  updatedAt: rfc3339(now),
});

export const appendSection = (
  cf: CaseFileDoc,
  section: 'extract' | 'draft',
  value: JsonValue,
  now: Date,
): CaseFileDoc => ({
  ...cf,
  ...(section === 'extract' ? { extract: value } : { draft: value }),
  updatedAt: rfc3339(now),
});

export const appendExecution = (cf: CaseFileDoc, execution: JsonValue, now: Date): CaseFileDoc => ({
  ...cf,
  executions: [...cf.executions, execution],
  updatedAt: rfc3339(now),
});

export const appendDecision = (
  cf: CaseFileDoc,
  d: Omit<CaseDecision, 'at'>,
  now: Date,
): CaseFileDoc => ({
  ...cf,
  decisions: [...cf.decisions, { ...d, at: rfc3339(now) }],
  updatedAt: rfc3339(now),
});

export const appendReference = (cf: CaseFileDoc, messageId: string, now: Date): CaseFileDoc => ({
  ...cf,
  references: [...cf.references, messageId],
  updatedAt: rfc3339(now),
});

/** 原始邮件三元组的读取视图。 */
export const originalEmail = (cf: CaseFileDoc): { from: string; subject: string; body: string; messageId: string } => ({
  from: cf.original['from'] ?? '',
  subject: cf.original['subject'] ?? '',
  body: cf.original['body'] ?? '',
  messageId: cf.original['message_id'] ?? '',
});
