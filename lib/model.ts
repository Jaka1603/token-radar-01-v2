// LaunchScope 2's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EVERY protocol that records no token yet: all 342 of them on this snapshot,
// the snapshot's 40-protocol watchlist included. Wrapped, staked and bridged products of a
// token that trades, versioned pools and exchange records are not dropped to make the board
// look cleaner: they are ranked by the same model and carry a flag that says what they are.
//
// The implied value comes from a comps model FITTED to the snapshot's own live tokens, not
// from a constant anyone picked:
//
//   witnesses   The protocols whose tokens already trade and report a market cap are the only
//               evidence of what a token is worth against TVL (119 of them here). Exchange
//               records are left out of the fit: an exchange's TVL is customer balances, not
//               a product the market prices per dollar of it.
//   response    log(market cap / TVL), winsorized to [log 0.01, log 10]. Fifteen of the 119
//               witnesses sit outside x0.01..x10; a handful of memecoin outliers must not
//               bend the curve that prices ordinary launches.
//   features    size (log10 TVL, centred on the witnesses' mean), seven-day growth (clamped
//               to [-50, +100] per cent, as a fraction), maturity (1 - exp(-age_days / 540)),
//               breadth (extra chains past the first, capped at 8), and a per-category
//               offset shrunk toward zero by its live sample size.
//   selection   Five candidate specifications are fitted on the witnesses and scored by
//               leave-one-out cross-validation with exact refits; the winner on median
//               absolute leave-one-out error is refitted on all 119 and its coefficients
//               are the ones the board uses. The same harness scores walk-forward (fit the
//               oldest 60 per cent by tracking date, test the newest 40) and a blind
//               holdout (every fifth witness by slug, never in its own fit), so the page
//               prints what the model earned out of sample, not in sample.
//   implied     = TVL x clamp(round4(exp(base + size + growth + age + category + breadth)))
//               Each term is rounded to 6 decimals before it is summed, and the dashboard
//               sums the same rounded terms in the same order, so the page's recomputation
//               of a row is exact to the dollar.
//
// Age is the days since DefiLlama first tracked the protocol: how long it has run with no
// token. An unrecorded age uses the witnesses' median age. No protocol name is ever
// special-cased: one fitted function scores every row, flagged or not.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's fixed constants. Everything else is fitted from the snapshot at run time. */
export interface ModelConstants {
  /** The response log(market cap / TVL) is winsorized into this band before any fit. */
  winsor_lo: number;
  winsor_hi: number;
  /** Seven-day growth is clamped into this band of per cent before it becomes a fraction. */
  growth_floor_pct: number;
  growth_cap_pct: number;
  /** The maturity feature's time constant: 1 - exp(-age_days / tau). */
  maturity_tau_days: number;
  /** Breadth counts extra chains past the first, up to this many. */
  breadth_max_extra_chains: number;
  /** A category offset is shrunk toward zero as if it had this many extra zero samples. */
  category_shrink_k: number;
  /** The used multiple is kept inside this band however the fit comes out. */
  multiple_floor: number;
  multiple_cap: number;
  /** The blind holdout takes every nth witness by slug order. */
  holdout_stride: number;
}

export const MODEL: ModelConstants = {
  winsor_lo: Math.log(0.01),
  winsor_hi: Math.log(10),
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  maturity_tau_days: 540,
  breadth_max_extra_chains: 8,
  category_shrink_k: 20,
  multiple_floor: 0.01,
  multiple_cap: 3,
  holdout_stride: 5,
};

/** The model's version label: the dashboard names it and every board row carries it. */
export const MODEL_VERSION = 'launchscope-3';

/** How many live-token protocols the Already trading view carries, by market cap. */
export const LIVE_ROWS = 36;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of another protocol, or an exchange. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name: the product of an exchange, not a launch of its own. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is a wrapped, staked or bridged product of one whose token already trades. */
export function isProductOfAnother(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix));
}

/** What a pre-token row is, when it is not an independent protocol awaiting its own launch. */
export type RowFlag = 'exchange' | 'product' | 'versioned' | null;

/**
 * A row's flag: an exchange record (its TVL is customer balances), a wrapped, staked or
 * bridged product of a token that trades, or a versioned pool of another protocol.
 * Independent protocols carry no flag. The flag never changes the row's price: the same
 * fitted model scores flagged and unflagged rows alike, and the flag is printed beside it.
 */
export function flagOf(p: SnapshotProtocol): RowFlag {
  if (p.category === 'CEX') return 'exchange';
  if (isProductOfAnother(p)) return 'product';
  if (VERSIONED.test(p.name)) return 'versioned';
  return null;
}

// ------------------------------------------------------------------ the fitted comps model

/** The features one protocol presents to the fit, all derived from its own record. */
export interface Features {
  /** log10 of TVL in dollars. */
  size: number;
  /** Seven-day TVL change, clamped, as a fraction (0.12 is +12 per cent). */
  growth: number;
  /** Maturity: 1 - exp(-age_days / tau), from 0 at listing toward 1. */
  ageF: number;
  /** Extra chains past the first, capped. */
  breadth: number;
  /** The category the offset table is keyed by. */
  cat: string;
}

/** One protocol's features under `model`; an unrecorded age uses `fallbackAgeDays`. */
export function featuresOf(p: SnapshotProtocol, asOf: string, fallbackAgeDays: number, model: ModelConstants): Features {
  const age = ageDays(asOf, p.listed_at) ?? fallbackAgeDays;
  return {
    size: Math.log10(Math.max(p.tvl_usd, 1)),
    growth: Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, finite(p.change_7d, 0))) / 100,
    ageF: 1 - Math.exp(-Math.max(age, 0) / model.maturity_tau_days),
    breadth: Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra_chains),
    cat: p.category ?? 'Uncategorised',
  };
}

/** One live-token witness: its record, its features, and its (winsorized) log ratio. */
export interface Witness {
  p: SnapshotProtocol;
  feats: Features;
  /** log(market cap / TVL), winsorized into the model's band. */
  y: number;
  /** The same ratio before winsorizing, for the record. */
  yRaw: number;
  /** Whether winsorizing moved this witness. */
  winsorized: boolean;
}

/**
 * The witnesses: protocols whose token already trades and reports a market cap, exchange
 * records excluded. Their median age is the fit's fallback for unrecorded ages.
 */
export function collectWitnesses(snapshot: Snapshot, model: ModelConstants): { witnesses: Witness[]; fallbackAgeDays: number } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ages = live.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const fallbackAgeDays = ages.length > 0 ? Math.round(median(ages)) : 365;
  const witnesses = live.map((p) => {
    const yRaw = Math.log(p.mcap_usd! / p.tvl_usd);
    const y = Math.min(model.winsor_hi, Math.max(model.winsor_lo, yRaw));
    return { p, feats: featuresOf(p, snapshot.as_of, fallbackAgeDays, model), y, yRaw, winsorized: y !== yRaw };
  });
  return { witnesses, fallbackAgeDays };
}

/** A candidate specification: which fitted terms it carries, and whether it pools category offsets. */
export interface Spec {
  id: string;
  label: string;
  cols: Array<'size' | 'growth' | 'age' | 'breadth'>;
  category_offsets: boolean;
}

/** The tournament's candidates, plainest first. The flat median is the house's own baseline. */
export const SPECS: Spec[] = [
  { id: 'flat', label: 'Flat market median, no fit', cols: [], category_offsets: false },
  { id: 'size', label: 'Size curve only', cols: ['size'], category_offsets: false },
  { id: 'full', label: 'Size + growth + maturity', cols: ['size', 'growth', 'age'], category_offsets: false },
  { id: 'full-cat', label: 'Size + growth + maturity + category offsets', cols: ['size', 'growth', 'age'], category_offsets: true },
  { id: 'full-cat-breadth', label: 'Full + category offsets + breadth', cols: ['size', 'growth', 'age', 'breadth'], category_offsets: true },
];

/** A fitted specification: rounded coefficients and shrunk category offsets, ready to ship. */
export interface Fit {
  spec: Spec;
  /** The intercept, at the witnesses' mean size. */
  base: number;
  size: number;
  growth: number;
  age: number;
  breadth: number;
  /** Category offsets by category name, each rounded to 6 decimals. */
  offsets: Map<string, number>;
  /** The witnesses' mean size the intercept is centred on. */
  meanSize: number;
}

/** Ordinary least squares through the normal equations, with a whisper of ridge for stability. */
function ols(rows: Witness[], cols: Spec['cols'], meanSize: number): number[] {
  const design = (w: Witness): number[] => [
    1,
    ...cols.map((c) => (c === 'size' ? w.feats.size - meanSize : c === 'growth' ? w.feats.growth : c === 'age' ? w.feats.ageF : w.feats.breadth)),
  ];
  const k = cols.length + 1;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (const w of rows) {
    const x = design(w);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) a[i]![j]! += x[i]! * x[j]!;
      b[i]! += x[i]! * w.y;
    }
  }
  for (let i = 0; i < k; i++) a[i]![i]! += 1e-8;
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[piv]![i]!)) piv = r;
    const tmpRow = a[i]!; a[i] = a[piv]!; a[piv] = tmpRow;
    const tmpB = b[i]!; b[i] = b[piv]!; b[piv] = tmpB;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = a[r]![i]! / a[i]![i]!;
      for (let c = i; c < k; c++) a[r]![c]! -= f * a[i]![c]!;
      b[r]! -= f * b[i]!;
    }
  }
  return b.map((v, i) => v / a[i]![i]!);
}

/**
 * Fit one specification on `rows`. The flat spec is the median of the response; the others
 * are least squares plus, when the spec pools them, per-category offsets: each category's
 * mean residual, shrunk toward zero by the model's shrink constant. Coefficients and
 * offsets are rounded to 6 decimals here, so the numbers the page prints are the numbers
 * that price the board, in the tournament and in the final fit alike.
 */
export function fitSpec(rows: Witness[], spec: Spec, model: ModelConstants, meanSize: number): Fit {
  const fit: Fit = { spec, base: 0, size: 0, growth: 0, age: 0, breadth: 0, offsets: new Map(), meanSize };
  if (spec.id === 'flat') {
    fit.base = round6(median(rows.map((w) => w.y)));
    return fit;
  }
  const beta = ols(rows, spec.cols, meanSize);
  fit.base = round6(beta[0]!);
  spec.cols.forEach((c, i) => {
    fit[c] = round6(beta[i + 1]!);
  });
  if (spec.category_offsets) {
    const residuals = new Map<string, number[]>();
    for (const w of rows) {
      const list = residuals.get(w.feats.cat) ?? [];
      list.push(w.y - predict(fit, w.feats));
      residuals.set(w.feats.cat, list);
    }
    for (const [cat, list] of residuals) {
      const mean = list.reduce((s, v) => s + v, 0) / list.length;
      fit.offsets.set(cat, round6((list.length * mean) / (list.length + model.category_shrink_k)));
    }
  }
  return fit;
}

/** The fitted log multiple one feature set earns under `fit`, before exponentiating. */
export function predict(fit: Fit, feats: Features): number {
  return (
    fit.base +
    fit.size * (feats.size - fit.meanSize) +
    fit.growth * feats.growth +
    fit.age * feats.ageF +
    fit.breadth * feats.breadth +
    (fit.offsets.get(feats.cat) ?? 0)
  );
}

/** Out-of-sample scores for one specification, all in log-ratio points. */
export interface Validation {
  loo_mae: number;
  loo_rmse: number;
  /** Walk-forward: fit the oldest 60 per cent by tracking date, score the newest 40. */
  wf_mae: number;
  wf_rmse: number;
  wf_test_n: number;
  /** Blind holdout: every nth witness by slug, scored by a fit that never saw it. */
  ho_mae: number;
  ho_rmse: number;
  ho_n: number;
}

const maeOf = (errs: number[]): number => median(errs.map((e) => Math.abs(e)));
const rmseOf = (errs: number[]): number => Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / Math.max(errs.length, 1));

/**
 * Score one specification out of sample: leave-one-out by exact refits, walk-forward on
 * tracking date, and the blind holdout. Deterministic: the splits depend only on the
 * witnesses' own dates and slugs, so two runs write the same numbers.
 */
export function validate(witnesses: Witness[], spec: Spec, model: ModelConstants, meanSize: number): Validation {
  const loo: number[] = [];
  for (let i = 0; i < witnesses.length; i++) {
    const train = witnesses.filter((_, j) => j !== i);
    loo.push(witnesses[i]!.y - predict(fitSpec(train, spec, model, meanSize), witnesses[i]!.feats));
  }
  const byDate = [...witnesses].sort((a, b) => {
    const da = a.p.listed_at ?? '9999';
    const db = b.p.listed_at ?? '9999';
    return da < db ? -1 : da > db ? 1 : a.p.slug < b.p.slug ? -1 : 1;
  });
  const cut = Math.floor(byDate.length * 0.6);
  const wfFit = fitSpec(byDate.slice(0, cut), spec, model, meanSize);
  const wf = byDate.slice(cut).map((w) => w.y - predict(wfFit, w.feats));
  const bySlug = [...witnesses].sort((a, b) => (a.p.slug < b.p.slug ? -1 : 1));
  const holdout = bySlug.filter((_, i) => i % model.holdout_stride === model.holdout_stride - 1);
  const hoFit = fitSpec(bySlug.filter((_, i) => i % model.holdout_stride !== model.holdout_stride - 1), spec, model, meanSize);
  const ho = holdout.map((w) => w.y - predict(hoFit, w.feats));
  return {
    loo_mae: round4(maeOf(loo)),
    loo_rmse: round4(rmseOf(loo)),
    wf_mae: round4(maeOf(wf)),
    wf_rmse: round4(rmseOf(wf)),
    wf_test_n: wf.length,
    ho_mae: round4(maeOf(ho)),
    ho_rmse: round4(rmseOf(ho)),
    ho_n: holdout.length,
  };
}

/** One candidate's tournament line: its specification and its leave-one-out scores. */
export interface CandidateScore {
  id: string;
  label: string;
  loo_mae: number;
  loo_rmse: number;
}

/** One category's fitted offset, with the live sample behind it. */
export interface CategoryOffset {
  category: string;
  samples: number;
  offset: number;
}

/** The fitted model the board ships: the winning fit, its tournament, and its out-of-sample record. */
export interface FitReport {
  spec_id: string;
  spec_label: string;
  base: number;
  size: number;
  growth: number;
  age: number;
  breadth: number;
  mean_size: number;
  fallback_age_days: number;
  witnesses: number;
  winsorized: number;
  candidates: CandidateScore[];
  validation: Validation;
  flat_validation: Validation;
  offsets: CategoryOffset[];
}

/**
 * Run the tournament and fit the shipped model: every candidate is validated, the winner
 * on leave-one-out median absolute error (ties on RMSE) is refitted on all witnesses, and
 * the flat baseline's validation is kept beside the winner's for the printed comparison.
 */
export function fitModel(witnesses: Witness[], fallbackAgeDays: number, model: ModelConstants): { fit: Fit; report: FitReport } {
  const meanSize = witnesses.reduce((s, w) => s + w.feats.size, 0) / Math.max(witnesses.length, 1);
  const scored = SPECS.map((spec) => ({ spec, validation: validate(witnesses, spec, model, meanSize) }));
  const winner = [...scored].sort(
    (a, b) => a.validation.loo_mae - b.validation.loo_mae || a.validation.loo_rmse - b.validation.loo_rmse,
  )[0]!;
  const fit = fitSpec(witnesses, winner.spec, model, meanSize);
  const flat = scored.find((s) => s.spec.id === 'flat')!;
  const counts = new Map<string, number>();
  for (const w of witnesses) counts.set(w.feats.cat, (counts.get(w.feats.cat) ?? 0) + 1);
  const offsets: CategoryOffset[] = [...fit.offsets.entries()]
    .map(([category, offset]) => ({ category, samples: counts.get(category) ?? 0, offset }))
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  const report: FitReport = {
    spec_id: winner.spec.id,
    spec_label: winner.spec.label,
    base: fit.base,
    size: fit.size,
    growth: fit.growth,
    age: fit.age,
    breadth: fit.breadth,
    mean_size: round4(meanSize),
    fallback_age_days: fallbackAgeDays,
    witnesses: witnesses.length,
    winsorized: witnesses.filter((w) => w.winsorized).length,
    candidates: scored.map((s) => ({ id: s.spec.id, label: s.spec.label, loo_mae: s.validation.loo_mae, loo_rmse: s.validation.loo_rmse })),
    validation: winner.validation,
    flat_validation: flat.validation,
    offsets,
  };
  return { fit, report };
}

// ------------------------------------------------------------------ implied value and the board

/** The six additive terms of one row's fitted log multiple, each rounded to 6 decimals. */
export interface Terms {
  base: number;
  size: number;
  growth: number;
  age: number;
  category: number;
  breadth: number;
}

/** The multiple one protocol is priced with, clamped into the model's band. */
function clampMultiple(n: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
}

/**
 * One protocol's implied value under the fitted model, with the term decomposition the
 * dashboard re-sums. Each term is rounded to 6 decimals before the sum, the sum is
 * exponentiated and rounded to 4, and the multiple is clamped: the page repeats exactly
 * these operations on the shipped terms and lands on the same dollar.
 */
export function impliedValue(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  model: ModelConstants,
  fit: Fit,
  fallbackAgeDays: number,
): { implied: number; multiple: number; terms: Terms; feats: Features } {
  const feats = featuresOf(p, snapshot.as_of, fallbackAgeDays, model);
  const terms: Terms = {
    base: round6(fit.base),
    size: round6(fit.size * (feats.size - fit.meanSize)),
    growth: round6(fit.growth * feats.growth),
    age: round6(fit.age * feats.ageF),
    category: round6(fit.offsets.get(feats.cat) ?? 0),
    breadth: round6(fit.breadth * feats.breadth),
  };
  const logMultiple = terms.base + terms.size + terms.growth + terms.age + terms.category + terms.breadth;
  const multiple = clampMultiple(round4(Math.exp(logMultiple)), model);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  return { implied, multiple, terms, feats };
}

/**
 * A display signal from the same figures: how much of a launch case the record makes on
 * its own. It never touches the implied value; it tells the reader where to look first.
 */
export function signalFor(p: SnapshotProtocol, age: number | null, floorUsd: number): string {
  let points = 0;
  if (p.tvl_usd >= floorUsd) points += 1;
  if (p.change_7d !== null && p.change_7d > 2) points += 1;
  if (age !== null && age >= 365) points += 1;
  if (p.chains.length >= 3) points += 1;
  if (points >= 3) return 'Strong';
  if (points === 2) return 'Building';
  return 'Early';
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  flag: RowFlag;
  age_days: number | null;
  implied_value_usd: number;
  signal: string;
  model: {
    version: string;
    multiple: number;
    terms: Terms;
  };
  plan_cost_usd: number;
  farm_steps: string[];
}

/** The dashboard's view of one ranked row: everything the page needs to recompute and explain it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  flag: RowFlag;
  signal: string;
  implied_value_usd: number;
  multiple: number;
  terms: Terms;
  plan_cost_usd: number;
}

/** A live-token witness as the dashboard shows it: the comps every row's price was fitted from. */
export interface WitnessRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  /** Its market cap / TVL, the raw ratio the fit learned from. */
  ratio: number;
  change_7d: number | null;
  age_days: number | null;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the witnesses, the live set, and the fit it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitReport;
  protocols_size: number;
  watchlist_size: number;
  board_size: number;
  flagged_size: number;
  live_size: number;
  live_total: number;
  rows: RadarRow[];
  witnesses: WitnessRow[];
  live: LiveRow[];
}

/**
 * The board: every pre-token protocol in the snapshot, ranked by the fitted model.
 * The watchlist is a floor the coverage check leans on, never a filter: nothing that
 * records no token is left out, and flagged rows are priced by the same function.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; fit: Fit; report: FitReport; fallbackAgeDays: number } {
  const { witnesses, fallbackAgeDays } = collectWitnesses(snapshot, model);
  const { fit, report } = fitModel(witnesses, fallbackAgeDays, model);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isPreToken)
    .map((p) => ({ p, age: ageDays(snapshot.as_of, p.listed_at), ...impliedValue(p, snapshot, model, fit, fallbackAgeDays) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => {
    const plan = farmPlan(s.p, s.age, snapshot.floor_usd, watchlist.has(s.p.slug));
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      watchlist: watchlist.has(s.p.slug),
      flag: flagOf(s.p),
      age_days: s.age,
      implied_value_usd: s.implied,
      signal: signalFor(s.p, s.age, snapshot.floor_usd),
      model: { version: MODEL_VERSION, multiple: s.multiple, terms: s.terms },
      plan_cost_usd: plan.total_cost_usd,
      farm_steps: plan.steps.map(stepText),
    };
  });
  return { board, fit, report, fallbackAgeDays };
}

// ------------------------------------------------------------------ farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs in gas on a chain, in dollars: mainnet is dear, rollups are not. */
function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 7;
  if (c === 'solana') return 0.1;
  if (c === 'bsc' || c === 'binance') return 0.35;
  if (c.includes('arbitrum') || c.includes('base') || c.includes('optimism') || c.includes('zksync') || c.includes('linea') || c.includes('scroll') || c.includes('blast') || c.includes('mantle') || c.includes('mode')) return 0.4;
  if (c.includes('polygon') || c.includes('avalanche') || c.includes('fantom') || c.includes('sonic') || c.includes('gnosis') || c.includes('celo') || c.includes('moonbeam')) return 0.6;
  return 1.5;
}

/** A gas figure as words, cents and all. */
function gasText(dollars: number): string {
  return dollars < 1 ? `about ${Math.round(dollars * 100)} cents` : `about $${dollars.toFixed(dollars % 1 === 0 ? 0 : 2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: a younger protocol needs a longer qualifying runway. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's primary position, in words a farmer can follow. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC or ETH to ${name} on ${chain} as collateral and leave it supplied.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest USDC pair on ${chain} and keep the LP position open.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Allocate $${capital} to a ${name} curated vault on ${chain} and keep the vault shares in the wallet.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name} and hold the bridged funds there.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small position hedged against the market.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in ${name}'s most liquid market.`;
  if (c.includes('staking') || c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('rwa')) return `Subscribe $${capital} to ${name}'s yield asset on ${chain} and hold it through one distribution cycle.`;
  if (c.includes('insurance')) return `Buy $${capital} of protocol cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name} and hold it in the wallet as the chain's native asset.`;
  if (c.includes('launchpad')) return `Commit $${capital} toward one ${name} launch on ${chain} and complete its participation steps.`;
  if (c.includes('stable') || c.includes('algo')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the balance.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${name}'s core product on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: the one that makes an account look like a user, not a deposit. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow about $${Math.round(capital * 0.4)} of a second asset against the supply, hold it a week, then repay: borrowing is the action points programs weight most.`;
  if (c.includes('dex')) return `Route two swaps a week of about $${Math.max(25, Math.round(capital * 0.2))} each through ${name} so the wallet builds real trading volume, not just liquidity.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Split a second $${Math.round(capital * 0.5)} into a different ${name} vault on a second chain it curates, so the account is active in more than one market.`;
  if (c.includes('bridge')) return `Bridge a smaller $${Math.max(25, Math.round(capital * 0.3))} back the other way once a month: round trips are what bridge activity programs count.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Trade about $${capital * 2} of total volume across the hold in small hedged orders, the metric derivatives programs publish for their seasons.`;
  if (c.includes('prediction')) return `Take one position a week in a different market each time; breadth of markets is what prediction programs record.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake or delegate a second $${Math.round(capital * 0.5)} with a different operator or vault so the stake is not a single passive deposit.`;
  if (c.includes('rwa')) return `Hold the asset past one full distribution and reinvest the payout once, so the account shows a complete cycle.`;
  if (c.includes('chain')) return `Make one native transfer and one contract interaction a week on ${name}: raw transaction count is the first metric a new chain publishes.`;
  if (c.includes('yield') || c.includes('farm')) return `Compound the yield back into the vault once a week instead of withdrawing it, so the position grows on the record.`;
  return `Use a second feature of ${name} once a week, such as a swap, a vote or a smaller second deposit, so the account reads as a user rather than one deposit.`;
}

/** A whole-dollar figure for prose: about $51, never $51.20. */
function aboutUsd(n: number): string {
  return `about $${Math.round(n)}`;
}

/** A protocol's whole plan, costed: the steps, and the totals they add up to. */
export interface FarmPlan {
  steps: FarmStep[];
  capital_usd: number;
  gas_total_usd: number;
  total_cost_usd: number;
  hold_days: number;
}

/**
 * A protocol's farm plan, derived from its own record (category, chains, TVL, age) and
 * never from a hand-written list. Every row gets the seven-step skeleton and a closing
 * total-cost step: the capital plus every gas event the plan names, summed. Watchlist
 * rows — the forty the house itself floors — get the deepened plan: a second-chain step
 * naming the protocol's actual second chain when it has one, and a step that works from
 * its recorded seven-day growth figure.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, floorUsd: number, deep: boolean): FarmPlan {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const sizeNote = p.tvl_usd >= floorUsd ? 'above the watchlist floor' : 'below the watchlist floor';
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet for ${p.name} alone, fund it from an exchange, and keep its seed phrase offline; one wallet per protocol keeps every farm separable.`,
      cost: `${gasText(gas)} of gas for the first transaction on ${chain}`,
      time: '10 minutes',
    },
    {
      text: primaryAction(p, capital, chain),
      cost: `$${capital} of capital and ${gasText(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: `${gasText(gas * 2)} of gas across the two actions`,
      time: '20 minutes',
    },
  ];
  let extraGas = 0;
  if (deep && p.chains.length > 1) {
    const second = p.chains[1]!;
    const gas2 = gasFor(second);
    extraGas += gas2 * 2;
    steps.push({
      text: `Repeat the primary position on ${second}, where ${p.name} also counts TVL: the snapshot records ${p.chains.length} chains for it, and activity on a second chain is what separates a user of the protocol from a single deposit on its first.`,
      cost: `${gasText(gas2 * 2)} of gas for the two transactions on ${second}`,
      time: '20 minutes',
    });
  }
  steps.push({
    text: `Repeat one qualifying action every week without missing a week: protocols of this size (${sizeNote}) usually score seasons or points on weekly streaks, and a gap resets them.`,
    cost: `${gasText(gas)} of gas a week, about $${Math.max(1, Math.round(gas * 4))} a month`,
    time: '10 minutes a week',
  });
  if (deep && p.change_7d !== null) {
    const move = p.change_7d;
    const pct = `${move > 0 ? '+' : ''}${move.toFixed(2)}%`;
    steps.push({
      text:
        move >= 0
          ? `The snapshot's own last seven days moved ${p.name}'s TVL ${pct}: growth windows are when activity programs open their scoring, so start the weekly cadence now rather than after an announcement, while the record still shows the growth.`
          : `The snapshot's own last seven days moved ${p.name}'s TVL ${pct}: size into the position across two weeks instead of one session, so the account's average balance, not a single day's, is what a snapshot of a shrinking protocol records.`,
      cost: `${gasText(gas)} of gas for the extra entry`,
      time: '10 minutes',
    });
    extraGas += gas;
  }
  steps.push(
    {
      text: `Hold the position at least ${hold} days, spanning two monthly snapshots of the protocol's TVL, before judging it: shorter holds are the ones activity filters discard.`,
      cost: `the $${capital} stays in the position and cannot be spent elsewhere`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s official announcements and points page once a week for a token or season announcement; claim only from a link the protocol itself publishes, and never pay a fee to claim.`,
      cost: 'nothing to check; a claim that asks for payment is a scam',
      time: '5 minutes a week',
    },
  );
  // The gas the plan names, summed: funding 1, primary 1, second action 2, one a week
  // across the hold, the deepened steps' own events, and 2 to unwind.
  const gasEvents = 1 + 1 + 2 + weeks + 2;
  const gasTotal = gas * gasEvents + extraGas;
  const total = capital + gasTotal;
  steps.push(
    {
      text: `Total plan cost for ${p.name}: $${capital} of capital plus ${aboutUsd(gasTotal)} of gas across the ${hold}-day hold (${gasEvents + (extraGas > 0 ? ' or more' : '')} transactions at ${gasText(gas)} each on ${chain}${deep ? ', the deepened steps included' : ''}) — ${aboutUsd(total)} all in, spent before any token exists.`,
      cost: `${aboutUsd(total)} in total, $${capital} of it recoverable capital`,
      time: `${hold} days end to end`,
    },
    {
      text: `Log the wallet, every date, amount and transaction hash in a farm log; when a token launches or the ${hold} days pass with no announcement, unwind in one session and record the result.`,
      cost: `${gasText(gas * 2)} of gas to unwind`,
      time: '15 minutes to exit',
    },
  );
  return { steps, capital_usd: capital, gas_total_usd: Math.round(gasTotal * 100) / 100, total_cost_usd: Math.round(total * 100) / 100, hold_days: hold };
}

// ------------------------------------------------------------------ the live set and the radar

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    flag: row.flag,
    signal: row.signal,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    terms: row.model.terms,
    plan_cost_usd: row.plan_cost_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, report } = buildBoard(snapshot, model);
  const { witnesses } = collectWitnesses(snapshot, model);
  const live = liveRows(snapshot);
  const liveTotal = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: report,
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    flagged_size: board.filter((r) => r.flag !== null).length,
    live_size: live.length,
    live_total: liveTotal,
    rows: board.map(radarRow),
    witnesses: witnesses.map((w) => ({
      slug: w.p.slug,
      name: w.p.name,
      category: w.p.category,
      tvl_usd: w.p.tvl_usd,
      mcap_usd: w.p.mcap_usd!,
      ratio: round4(w.p.mcap_usd! / w.p.tvl_usd),
      change_7d: w.p.change_7d,
      age_days: ageDays(snapshot.as_of, w.p.listed_at),
    })),
    live,
  };
  return { board, radar };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: full pre-token coverage, watchlist, ranks, order, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board carries a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const preToken = snapshot.protocols.filter(isPreToken);
  if (board.length !== preToken.length) return `the board ranks ${board.length} rows but the snapshot holds ${preToken.length} pre-token protocols`;
  for (const p of preToken) if (!slugs.has(p.slug)) return `the board leaves out the pre-token protocol ${p.slug}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
