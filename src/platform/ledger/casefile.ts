// CaseFile: the persistent case document — a JSON column on the workflow row.
// Each step appends only its own section, and any step can read the whole
// document. This module provides pure functions only: every "append" returns a
// new document; immutability is enforced by the types (counterpart of the Go
// lifecycle.CaseFile Set/Append family).

import type { JsonRecord, JsonValue } from '../shared/json.ts';
import { asRecord, safeParse } from '../shared/json.ts';
import { rfc3339 } from '../shared/clock.ts';

export interface CaseDecision {
  readonly seq: number;
  readonly action: string; // approved | denied | resolved | zombie_failed (set by the watchdog)
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

/** Convergence guard from a JSON array to a typed array (via an unknown intermediate, preserving immutability types). */
const pick = <T>(vals: readonly JsonValue[], guard: (v: object) => boolean): readonly T[] => {
  const out: T[] = [];
  for (const v of vals) {
    if (typeof v === 'object' && v !== null && guard(v)) out.push(v as T);
  }
  return out;
};

/** Parse the JSON column stored in the DB; empty/invalid values yield a blank case file (tolerates historical data). */
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

// ---- Pure transforms (each returns a new document) --------------------------

export const withOriginal = (
  cf: CaseFileDoc,
  o: { from: string; fromName?: string; subject: string; body: string; messageId: string },
  now: Date,
): CaseFileDoc => ({
  ...cf,
  original: {
    from: o.from,
    // Sender display name (RFC2047-decoded) — recorded into the case file with
    // the original message after the 2026-10-01 Chen Lijun hallucination
    // incident: the legitimate source for reply salutations, so the agent is no
    // longer forced to invent a name from the address.
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

/** Read view over the original email triple. */
export const originalEmail = (cf: CaseFileDoc): { from: string; subject: string; body: string; messageId: string } => ({
  from: cf.original['from'] ?? '',
  subject: cf.original['subject'] ?? '',
  body: cf.original['body'] ?? '',
  messageId: cf.original['message_id'] ?? '',
});
