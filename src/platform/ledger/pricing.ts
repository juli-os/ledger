// 智谱 bigmodel 官方价目 + API 等效计价（wf_535149a174fe）：
// 「如果这单走 API 要花多少钱」——按该单各回合实际模型代入价目档位，
// cache / input / output 三价分别计价加总。
//
// 数据源 https://docs.bigmodel.cn/cn/guide/start/pricing（2026-10-06 抓取），
// 单位一律 元/百万 tokens（页面口径）。增长走数据：价目变动只改本表。
//
// 计价口径（对齐 usage.ts 的 token 语义）：
// - cached_tokens 是 input_tokens 的子集（wf_66a9b632154d z.ai 口径）→
//   cache 价 × cached + input 价 × (input − cached) + output 价 × output。
// - cache: null = 该模型不支持缓存计价（价目页「不支持」）：cached 按普通
//   input 价结算（供应商侧无缓存折价，等效计价不虚构折价）。
// - 档位按行级判定：每回合用自己的 input/output 长度落档（多档单跨档
//   分行计价后加总）。阈值取页面字面十进制：32K=32000、0.2K=200。
// - 模型不在价目内（如 jev 判定模型、claude 系、已下架档）→ 不出价格
//   数字，显式列入 unpricedModels——绝不猜价。

export interface TierWhen {
  readonly inputLt?: number;
  readonly inputGte?: number;
  readonly outputLt?: number;
  readonly outputGte?: number;
}

export interface PriceTier {
  readonly when: TierWhen;
  /** 元/百万 tokens；cache=null 表示不支持缓存计价。 */
  readonly input: number;
  readonly cache: number | null;
  readonly output: number;
  readonly note: string;
}

export interface ModelPrice {
  /** 匹配键（小写；账本 model 精确或前缀匹配，见 findPrice）。 */
  readonly id: string;
  /** 展示名（价目页原名）。 */
  readonly label: string;
  readonly tiers: readonly PriceTier[];
}

export const PRICING_SOURCE = 'https://docs.bigmodel.cn/cn/guide/start/pricing';
export const PRICING_RETRIEVED_AT = '2026-10-06';

// 「入<32K」等阈值统一十进制字面量（页面口径按 K 字面读；边界回合对估价
// 量级无感，不做 1024 换算的花活）。
const K32 = 32_000;
const K200 = 200;

const flat = (input: number, cache: number | null, output: number, note = '统一价'): PriceTier =>
  ({ when: {}, input, cache, output, note });

export const BIGMODEL_PRICES: readonly ModelPrice[] = [
  // ---- 旗舰 ----
  { id: 'glm-5.3', label: 'GLM-5.3', tiers: [flat(8, 2, 28)] },
  { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', tiers: [flat(0.8, 0.23, 2.8)] },
  { id: 'glm-5.3-flashx', label: 'GLM-5.3-FlashX', tiers: [flat(2, 0.57, 7)] },
  // ---- 文本 ----
  { id: 'glm-5.2', label: 'GLM-5.2', tiers: [flat(8, 2, 28)] },
  {
    id: 'glm-5.1', label: 'GLM-5.1', tiers: [
      { when: { inputLt: K32 }, input: 6, cache: 1.3, output: 24, note: '入<32K' },
      { when: { inputGte: K32 }, input: 8, cache: 2, output: 28, note: '入≥32K' },
    ],
  },
  {
    id: 'glm-5-turbo', label: 'GLM-5-Turbo', tiers: [
      { when: { inputLt: K32 }, input: 5, cache: 1.2, output: 22, note: '入<32K' },
      { when: { inputGte: K32 }, input: 7, cache: 1.8, output: 26, note: '入≥32K' },
    ],
  },
  {
    id: 'glm-5', label: 'GLM-5', tiers: [
      { when: { inputLt: K32 }, input: 4, cache: 1, output: 18, note: '入<32K' },
      { when: { inputGte: K32 }, input: 6, cache: 1.5, output: 22, note: '入≥32K' },
    ],
  },
  {
    id: 'glm-4.7', label: 'GLM-4.7', tiers: [
      { when: { inputLt: K32, outputLt: K200 }, input: 2, cache: 0.4, output: 8, note: '入<32K·出<0.2K' },
      { when: { inputLt: K32, outputGte: K200 }, input: 3, cache: 0.6, output: 14, note: '入<32K·出≥0.2K' },
      { when: { inputGte: K32 }, input: 4, cache: 0.8, output: 16, note: '入32K–200K' },
    ],
  },
  {
    id: 'glm-4.5-air', label: 'GLM-4.5-Air', tiers: [
      { when: { inputLt: K32, outputLt: K200 }, input: 0.8, cache: 0.16, output: 2, note: '入<32K·出<0.2K' },
      { when: { inputLt: K32, outputGte: K200 }, input: 0.8, cache: 0.16, output: 6, note: '入<32K·出≥0.2K' },
      { when: { inputGte: K32 }, input: 1.2, cache: 0.24, output: 8, note: '入32K–128K' },
    ],
  },
  { id: 'glm-4.7-flashx', label: 'GLM-4.7-FlashX', tiers: [flat(0.5, 0.1, 3)] },
  { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash（免费）', tiers: [flat(0, 0, 0, '免费')] },
  { id: 'glm-4-plus', label: 'GLM-4-Plus', tiers: [flat(5, 2.5, 5)] },
  { id: 'glm-4-air-250414', label: 'GLM-4-Air-250414', tiers: [flat(0.5, 0.25, 0.5)] },
  { id: 'glm-4-air', label: 'GLM-4-Air（同 250414 版价）', tiers: [flat(0.5, 0.25, 0.5)] },
  { id: 'glm-4-airx', label: 'GLM-4-AirX', tiers: [flat(10, null, 10)] },
  { id: 'glm-4-long', label: 'GLM-4-Long', tiers: [flat(1, 0.5, 1)] },
  { id: 'glm-4-assistant', label: 'GLM-4-Assistant', tiers: [flat(5, null, 5)] },
  { id: 'glm-z1-air', label: 'GLM-Z1-Air', tiers: [flat(0.5, null, 0.5)] },
  { id: 'glm-z1-airx', label: 'GLM-Z1-AirX', tiers: [flat(5, null, 5)] },
  { id: 'glm-z1-flashx', label: 'GLM-Z1-FlashX', tiers: [flat(0.1, null, 0.1)] },
  { id: 'glm-4-flashx-250414', label: 'GLM-4-FlashX-250414', tiers: [flat(0.1, 0.05, 0.1)] },
  { id: 'glm-4-flashx', label: 'GLM-4-FlashX（同 250414 版价）', tiers: [flat(0.1, 0.05, 0.1)] },
  { id: 'glm-4-flash-250414', label: 'GLM-4-Flash-250414（免费）', tiers: [flat(0, null, 0, '免费·缓存不支持')] },
  { id: 'glm-4-flash', label: 'GLM-4-Flash（免费）', tiers: [flat(0, null, 0, '免费·缓存不支持')] },
  { id: 'glm-z1-flash', label: 'GLM-Z1-Flash（免费）', tiers: [flat(0, null, 0, '免费·缓存不支持')] },
  // ---- 视觉理解 ----
  { id: 'glm-ocr', label: 'GLM-OCR', tiers: [flat(0.2, null, 0.2)] },
  {
    id: 'glm-5v-turbo', label: 'GLM-5V-Turbo', tiers: [
      { when: { inputLt: K32 }, input: 5, cache: 1.2, output: 22, note: '入<32K' },
      { when: { inputGte: K32 }, input: 7, cache: 1.8, output: 26, note: '入≥32K' },
    ],
  },
  {
    id: 'glm-4.6v', label: 'GLM-4.6V', tiers: [
      { when: { inputLt: K32 }, input: 1, cache: 0.2, output: 3, note: '入<32K' },
      { when: { inputGte: K32 }, input: 2, cache: 0.4, output: 6, note: '入32K–128K（超上界并入高档）' },
    ],
  },
  {
    id: 'glm-4.6v-flashx', label: 'GLM-4.6V-FlashX', tiers: [
      { when: { inputLt: K32 }, input: 0.15, cache: 0.03, output: 1.5, note: '入<32K' },
      { when: { inputGte: K32 }, input: 0.3, cache: 0.03, output: 3, note: '入32K–128K（超上界并入高档）' },
    ],
  },
  { id: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash（免费）', tiers: [flat(0, 0, 0, '免费')] },
  {
    id: 'glm-4.5v', label: 'GLM-4.5V', tiers: [
      { when: { inputLt: K32 }, input: 2, cache: 0.4, output: 6, note: '入<32K' },
      { when: { inputGte: K32 }, input: 4, cache: 0.8, output: 12, note: '入32K–64K（超上界并入高档）' },
    ],
  },
  { id: 'glm-4v-plus-0111', label: 'GLM-4V-Plus-0111', tiers: [flat(4, 2, 4)] },
  { id: 'glm-4v-plus', label: 'GLM-4V-Plus（同 0111 版价）', tiers: [flat(4, 2, 4)] },
  { id: 'glm-4v-flash', label: 'GLM-4V-Flash（免费）', tiers: [flat(0, null, 0, '免费·缓存不支持')] },
  { id: 'glm-4.1v-thinking-flashx', label: 'GLM-4.1V-Thinking-FlashX', tiers: [flat(2, null, 2)] },
  { id: 'glm-4.1v-thinking-flash', label: 'GLM-4.1V-Thinking-Flash（免费）', tiers: [flat(0, null, 0, '免费·缓存不支持')] },
  // ---- 向量/其他（单值价目按 input 计，output 同价保底）----
  { id: 'embedding-3', label: 'Embedding-3', tiers: [flat(0.5, null, 0.5, '单值价目·input 计')] },
  { id: 'embedding-2', label: 'Embedding-2', tiers: [flat(0.5, null, 0.5, '单值价目·input 计')] },
  { id: 'rerank', label: 'Rerank', tiers: [flat(0.8, null, 0.8, '单值价目')] },
  { id: 'codegeex-4', label: 'CodeGeeX-4', tiers: [flat(0.1, null, 0.1, '单值价目')] },
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
  /** 账本原样 model 名（展示与对账用，未加工）。 */
  readonly model: string;
  readonly label: string;
  readonly free: boolean;
  readonly priced: boolean;
  readonly calls: number;
  /** 含缓存（与详情页 promptStats 展示口径一致）。 */
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly inputTokensChargeable: number;
  readonly outputTokens: number;
  /** 命中的档位说明（去重，人可读）。 */
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
  /** 不在价目内的模型（原样名单）——只显用量不出价格。 */
  readonly unpricedModels: readonly string[];
}

/** 账本 model → 价目条目：小写精确命中，否则最长前缀（id+'-' 边界）。
 * glm-4.7-flashx 不会误吃 glm-4.7-flash 的价（边界必须是分隔符）。 */
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

/** 行落档：when 全条件满足即中；都不中（超上界）并入最后一档（高档兜底，
 * 估价口径偏保守不偏小）。 */
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

/** API 等效计价：行级落档计价后按模型加总。tokens 为 0 的行不产生条目。 */
export const priceUsage = (rows: readonly UsageRow[]): UsageCost => {
  interface Acc {
    model: string; label: string; free: boolean; priced: boolean; calls: number;
    inputTokens: number; cachedTokens: number; outputTokens: number;
    tiersHit: Set<string>; cost: { cache: number; input: number; output: number };
  }
  const accs = new Map<string, Acc>();
  for (const r of rows) {
    if (r.inputTokens === 0 && r.outputTokens === 0) continue;
    const key = r.model === '' ? '（未记录模型）' : r.model;
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
    if (t.input === 0 && t.output === 0) { a.free = true; continue; } // 免费档：用量照记价 0
    // cached ⊆ input（账本口径）；异常行 clamp 防负价。
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
