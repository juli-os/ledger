// Zhipu bigmodel official price list + API-equivalent costing (wf_535149a174fe):
// "what would this work order have cost over the API" — each round's actual
// model is matched to a price tier, and cache / input / output are priced
// separately and summed.
//
// Source https://docs.bigmodel.cn/cn/guide/start/pricing (fetched 2026-10-06);
// units are CNY per million tokens throughout (the page's convention). Growth
// goes through data: price changes only touch this table.
//
// Costing rules (aligned with the token semantics of usage.ts):
// - cached_tokens is a subset of input_tokens (per wf_66a9b632154d, z.ai
//   convention) → cache price × cached + input price × (input − cached) +
//   output price × output.
// - cache: null = the model has no cache pricing (page says "not supported"):
//   cached tokens are billed at the regular input price (no cache discount
//   exists on the provider side, so the equivalent cost doesn't invent one).
// - Tiers are decided per row: each round falls into a tier by its own
//   input/output lengths (multi-tier work orders are priced row by row
//   across tiers, then summed). Thresholds are the page's literal decimal
//   values: 32K=32000, 0.2K=200.
// - Models absent from the price list (e.g. the jev judgment models, the
//   claude family, delisted tiers) → no price number is produced; they are
//   listed explicitly in unpricedModels — never guess a price.

export interface TierWhen {
  readonly inputLt?: number;
  readonly inputGte?: number;
  readonly outputLt?: number;
  readonly outputGte?: number;
}

export interface PriceTier {
  readonly when: TierWhen;
  /** CNY per million tokens; cache=null means cache pricing is not supported. */
  readonly input: number;
  readonly cache: number | null;
  readonly output: number;
  readonly note: string;
}

export interface ModelPrice {
  /** Match key (lowercase; ledger model matched exactly or by prefix, see findPrice). */
  readonly id: string;
  /** Display name (as on the pricing page). */
  readonly label: string;
  readonly tiers: readonly PriceTier[];
}

export const PRICING_SOURCE = 'https://docs.bigmodel.cn/cn/guide/start/pricing';
export const PRICING_RETRIEVED_AT = '2026-10-06';

// Thresholds like "in<32K" are uniform decimal literals (the page reads K
// literally; boundary rounds don't move the order of magnitude of the
// estimate, so no fancy 1024 conversion).
const K32 = 32_000;
const K200 = 200;

const flat = (input: number, cache: number | null, output: number, note = 'flat rate'): PriceTier =>
  ({ when: {}, input, cache, output, note });

export const BIGMODEL_PRICES: readonly ModelPrice[] = [
  // ---- Flagship ----
  { id: 'glm-5.3', label: 'GLM-5.3', tiers: [flat(8, 2, 28)] },
  { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', tiers: [flat(0.8, 0.23, 2.8)] },
  { id: 'glm-5.3-flashx', label: 'GLM-5.3-FlashX', tiers: [flat(2, 0.57, 7)] },
  // ---- Text ----
  { id: 'glm-5.2', label: 'GLM-5.2', tiers: [flat(8, 2, 28)] },
  {
    id: 'glm-5.1', label: 'GLM-5.1', tiers: [
      { when: { inputLt: K32 }, input: 6, cache: 1.3, output: 24, note: 'in<32K' },
      { when: { inputGte: K32 }, input: 8, cache: 2, output: 28, note: 'in>=32K' },
    ],
  },
  {
    id: 'glm-5-turbo', label: 'GLM-5-Turbo', tiers: [
      { when: { inputLt: K32 }, input: 5, cache: 1.2, output: 22, note: 'in<32K' },
      { when: { inputGte: K32 }, input: 7, cache: 1.8, output: 26, note: 'in>=32K' },
    ],
  },
  {
    id: 'glm-5', label: 'GLM-5', tiers: [
      { when: { inputLt: K32 }, input: 4, cache: 1, output: 18, note: 'in<32K' },
      { when: { inputGte: K32 }, input: 6, cache: 1.5, output: 22, note: 'in>=32K' },
    ],
  },
  {
    id: 'glm-4.7', label: 'GLM-4.7', tiers: [
      { when: { inputLt: K32, outputLt: K200 }, input: 2, cache: 0.4, output: 8, note: 'in<32K·out<0.2K' },
      { when: { inputLt: K32, outputGte: K200 }, input: 3, cache: 0.6, output: 14, note: 'in<32K·out>=0.2K' },
      { when: { inputGte: K32 }, input: 4, cache: 0.8, output: 16, note: 'in 32K–200K' },
    ],
  },
  {
    id: 'glm-4.5-air', label: 'GLM-4.5-Air', tiers: [
      { when: { inputLt: K32, outputLt: K200 }, input: 0.8, cache: 0.16, output: 2, note: 'in<32K·out<0.2K' },
      { when: { inputLt: K32, outputGte: K200 }, input: 0.8, cache: 0.16, output: 6, note: 'in<32K·out>=0.2K' },
      { when: { inputGte: K32 }, input: 1.2, cache: 0.24, output: 8, note: 'in 32K–128K' },
    ],
  },
  { id: 'glm-4.7-flashx', label: 'GLM-4.7-FlashX', tiers: [flat(0.5, 0.1, 3)] },
  { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash (free)', tiers: [flat(0, 0, 0, 'free')] },
  { id: 'glm-4-plus', label: 'GLM-4-Plus', tiers: [flat(5, 2.5, 5)] },
  { id: 'glm-4-air-250414', label: 'GLM-4-Air-250414', tiers: [flat(0.5, 0.25, 0.5)] },
  { id: 'glm-4-air', label: 'GLM-4-Air (same price as 250414)', tiers: [flat(0.5, 0.25, 0.5)] },
  { id: 'glm-4-airx', label: 'GLM-4-AirX', tiers: [flat(10, null, 10)] },
  { id: 'glm-4-long', label: 'GLM-4-Long', tiers: [flat(1, 0.5, 1)] },
  { id: 'glm-4-assistant', label: 'GLM-4-Assistant', tiers: [flat(5, null, 5)] },
  { id: 'glm-z1-air', label: 'GLM-Z1-Air', tiers: [flat(0.5, null, 0.5)] },
  { id: 'glm-z1-airx', label: 'GLM-Z1-AirX', tiers: [flat(5, null, 5)] },
  { id: 'glm-z1-flashx', label: 'GLM-Z1-FlashX', tiers: [flat(0.1, null, 0.1)] },
  { id: 'glm-4-flashx-250414', label: 'GLM-4-FlashX-250414', tiers: [flat(0.1, 0.05, 0.1)] },
  { id: 'glm-4-flashx', label: 'GLM-4-FlashX (same price as 250414)', tiers: [flat(0.1, 0.05, 0.1)] },
  { id: 'glm-4-flash-250414', label: 'GLM-4-Flash-250414 (free)', tiers: [flat(0, null, 0, 'free · cache unsupported')] },
  { id: 'glm-4-flash', label: 'GLM-4-Flash (free)', tiers: [flat(0, null, 0, 'free · cache unsupported')] },
  { id: 'glm-z1-flash', label: 'GLM-Z1-Flash (free)', tiers: [flat(0, null, 0, 'free · cache unsupported')] },
  // ---- Vision ----
  { id: 'glm-ocr', label: 'GLM-OCR', tiers: [flat(0.2, null, 0.2)] },
  {
    id: 'glm-5v-turbo', label: 'GLM-5V-Turbo', tiers: [
      { when: { inputLt: K32 }, input: 5, cache: 1.2, output: 22, note: 'in<32K' },
      { when: { inputGte: K32 }, input: 7, cache: 1.8, output: 26, note: 'in>=32K' },
    ],
  },
  {
    id: 'glm-4.6v', label: 'GLM-4.6V', tiers: [
      { when: { inputLt: K32 }, input: 1, cache: 0.2, output: 3, note: 'in<32K' },
      { when: { inputGte: K32 }, input: 2, cache: 0.4, output: 6, note: 'in 32K–128K (above the upper bound folds into the top tier)' },
    ],
  },
  {
    id: 'glm-4.6v-flashx', label: 'GLM-4.6V-FlashX', tiers: [
      { when: { inputLt: K32 }, input: 0.15, cache: 0.03, output: 1.5, note: 'in<32K' },
      { when: { inputGte: K32 }, input: 0.3, cache: 0.03, output: 3, note: 'in 32K–128K (above the upper bound folds into the top tier)' },
    ],
  },
  { id: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash (free)', tiers: [flat(0, 0, 0, 'free')] },
  {
    id: 'glm-4.5v', label: 'GLM-4.5V', tiers: [
      { when: { inputLt: K32 }, input: 2, cache: 0.4, output: 6, note: 'in<32K' },
      { when: { inputGte: K32 }, input: 4, cache: 0.8, output: 12, note: 'in 32K–64K (above the upper bound folds into the top tier)' },
    ],
  },
  { id: 'glm-4v-plus-0111', label: 'GLM-4V-Plus-0111', tiers: [flat(4, 2, 4)] },
  { id: 'glm-4v-plus', label: 'GLM-4V-Plus (same price as 0111)', tiers: [flat(4, 2, 4)] },
  { id: 'glm-4v-flash', label: 'GLM-4V-Flash (free)', tiers: [flat(0, null, 0, 'free · cache unsupported')] },
  { id: 'glm-4.1v-thinking-flashx', label: 'GLM-4.1V-Thinking-FlashX', tiers: [flat(2, null, 2)] },
  { id: 'glm-4.1v-thinking-flash', label: 'GLM-4.1V-Thinking-Flash (free)', tiers: [flat(0, null, 0, 'free · cache unsupported')] },
  // ---- Embeddings / other (single-value prices are input-based; output billed at the same rate as a floor) ----
  { id: 'embedding-3', label: 'Embedding-3', tiers: [flat(0.5, null, 0.5, 'single-value · billed on input')] },
  { id: 'embedding-2', label: 'Embedding-2', tiers: [flat(0.5, null, 0.5, 'single-value · billed on input')] },
  { id: 'rerank', label: 'Rerank', tiers: [flat(0.8, null, 0.8, 'single-value')] },
  { id: 'codegeex-4', label: 'CodeGeeX-4', tiers: [flat(0.1, null, 0.1, 'single-value')] },
];

export interface UsageRow {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
}

export interface CostBreakdown {
  readonly cache: number;
  readonly input: number;
  readonly output: number;
  readonly total: number;
}

export interface ModelUsageCost {
  /** The model name verbatim from the ledger (for display and reconciliation, unprocessed). */
  readonly model: string;
  readonly label: string;
  readonly free: boolean;
  readonly priced: boolean;
  readonly calls: number;
  /** Includes cache (matching the detail page's promptStats display convention). */
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly inputTokensChargeable: number;
  readonly outputTokens: number;
  /** Notes of the tiers hit (deduplicated, human-readable). */
  readonly tiersHit: readonly string[];
  readonly costCny: CostBreakdown;
}

export interface UsageCost {
  readonly currency: 'CNY';
  readonly unit: 'per_1m_tokens';
  readonly pricingSource: string;
  readonly pricingRetrievedAt: string;
  readonly byModel: readonly ModelUsageCost[];
  readonly totalCny: CostBreakdown;
  /** Models absent from the price list (verbatim) — usage shown, no price produced. */
  readonly unpricedModels: readonly string[];
}

/** Ledger model → price entry: exact lowercase match, else longest prefix
 * (bounded by id+'-'). glm-4.7-flashx must not pick up glm-4.7-flash's
 * price (the boundary must be a separator). */
export const findPrice = (model: string): ModelPrice | null => {
  const m = model.trim().toLowerCase();
  if (m === '') return null;
  let hit: ModelPrice | null = null;
  for (const p of BIGMODEL_PRICES) {
    if (m === p.id || (m.startsWith(p.id + '-') && (hit === null || p.id.length > hit.id.length))) hit = p;
  }
  return hit;
};

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Row → tier: hits when all `when` conditions hold; if none does (above the
 * upper bound) it folds into the last tier (top-tier fallback, so estimates
 * err on the conservative side, never low). */
const tierOf = (price: ModelPrice, r: UsageRow): PriceTier => {
  const input = r.inputTokens;
  const output = r.outputTokens;
  for (const t of price.tiers) {
    const w = t.when;
    if (w.inputLt !== undefined && !(input < w.inputLt)) continue;
    if (w.inputGte !== undefined && !(input >= w.inputGte)) continue;
    if (w.outputLt !== undefined && !(output < w.outputLt)) continue;
    if (w.outputGte !== undefined && !(output >= w.outputGte)) continue;
    return t;
  }
  return price.tiers[price.tiers.length - 1]!;
};

/** API-equivalent costing: rows are tiered and priced individually, then summed per model. Rows with zero tokens produce no entry. */
export const priceUsage = (rows: readonly UsageRow[]): UsageCost => {
  interface Acc {
    model: string; label: string; free: boolean; priced: boolean; calls: number;
    inputTokens: number; cachedTokens: number; outputTokens: number;
    tiersHit: Set<string>; cost: { cache: number; input: number; output: number };
  }
  const accs = new Map<string, Acc>();
  for (const r of rows) {
    if (r.inputTokens === 0 && r.outputTokens === 0) continue;
    const key = r.model === '' ? '(no model recorded)' : r.model;
    let a = accs.get(key);
    if (a === undefined) {
      const p = findPrice(key);
      a = {
        model: key, label: p?.label ?? key, free: false, priced: p !== null, calls: 0,
        inputTokens: 0, cachedTokens: 0, outputTokens: 0, tiersHit: new Set(),
        cost: { cache: 0, input: 0, output: 0 },
      };
      accs.set(key, a);
    }
    a.calls++;
    a.inputTokens += r.inputTokens;
    a.cachedTokens += r.cachedTokens;
    a.outputTokens += r.outputTokens;
    if (!a.priced) continue;
    const t = tierOf(findPrice(key)!, r);
    a.tiersHit.add(t.note);
    if (t.input === 0 && t.output === 0) { a.free = true; continue; } // free tier: usage still recorded, price is 0
    // cached ⊆ input (ledger convention); clamp anomalous rows to prevent negative prices.
    const cached = Math.min(Math.max(r.cachedTokens, 0), r.inputTokens);
    const cachePrice = t.cache ?? t.input;
    a.cost.cache += (cached / 1e6) * cachePrice;
    a.cost.input += ((r.inputTokens - cached) / 1e6) * t.input;
    a.cost.output += (r.outputTokens / 1e6) * t.output;
  }
  const byModel = [...accs.values()].map((a) => ({
    model: a.model, label: a.label, free: a.free, priced: a.priced, calls: a.calls,
    inputTokens: a.inputTokens, cachedTokens: a.cachedTokens,
    inputTokensChargeable: a.inputTokens - Math.min(a.cachedTokens, a.inputTokens),
    outputTokens: a.outputTokens, tiersHit: [...a.tiersHit],
    costCny: {
      cache: round4(a.cost.cache), input: round4(a.cost.input),
      output: round4(a.cost.output), total: round4(a.cost.cache + a.cost.input + a.cost.output),
    },
  })).sort((x, y) => y.costCny.total - x.costCny.total);
  const total = byModel.reduce(
    (s, m) => ({ cache: s.cache + m.costCny.cache, input: s.input + m.costCny.input, output: s.output + m.costCny.output }),
    { cache: 0, input: 0, output: 0 },
  );
  return {
    currency: 'CNY', unit: 'per_1m_tokens',
    pricingSource: PRICING_SOURCE, pricingRetrievedAt: PRICING_RETRIEVED_AT,
    byModel,
    totalCny: { cache: round4(total.cache), input: round4(total.input), output: round4(total.output), total: round4(total.cache + total.input + total.output) },
    unpricedModels: byModel.filter((m) => !m.priced).map((m) => m.model),
  };
};
