// The launch radar's model: one frozen snapshot of the protocol universe in,
// one ranked board out. No name is ever special-cased: every figure the model
// uses comes from the snapshot's own records, and the same function scores
// every row.
//
// The question the board answers is what a protocol's token would be worth if
// it traded the way its category already trades. The market multiple for a
// category is the median market-cap-to-TVL ratio of the snapshot's live-token
// protocols in that category, so a lending protocol is priced like lending
// protocols trade and a DEX like DEXes trade, never at one flat multiple.
// A category with no live comparables falls back to the global median.
//
//   multiple     = median(mcap_usd / tvl_usd) over live protocols in the category,
//                  clamped to [0.05, 3.0], and only when at least three live
//                  protocols back it; a category with fewer falls back to the
//                  global median, so one outlier never prices a whole category
//   growthMult   = 1 + clamp(change_7d, -50, 150) / 100 x 0.4
//   maturityMult = 0.7 + min(age_days, 730) / 730 x 0.3   (unknown age: 365 days)
//   breadthMult  = 1 + min(chains - 1, 4) x 0.03
//   implied      = max(1, round(tvl_usd x multiple x growthMult x maturityMult
//                               x breadthMult))
//
// The board ranks every protocol the watchlist's own exclusion logic leaves
// standing: pre-token, not an exchange, not a versioned pool, not a wrapped,
// staked or bridged product. Protocols the rule sets aside are listed beside
// the board with the reason, so the reader sees what was left out and why.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
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

/** The model's constants, stated in the dashboard and adjustable in its sandbox. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comparables: number;
  breadth_step: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 3.0,
  min_comparables: 3,
  breadth_step: 0.03,
  breadth_max_chains: 4,
};

/** The model's version label, shown in the dashboard and the board's rows. */
export const MODEL_VERSION = 'launch-radar-1';

/** How many live-token protocols the comparables view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. Extra keys are allowed, so the row carries its evidence. */
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
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_raw: number;
    multiple_source: 'category' | 'global';
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js; the page rebuilds the plan from it. */
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
  on_watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  multiple_raw: number;
  multiple_source: 'category' | 'global';
  comparables: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: the market's own value, the model's evidence. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

/** A pre-token protocol the board sets aside, with the reason it was left out. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** One category's market multiple, with how many live protocols back it. */
export interface MultipleRow {
  category: string;
  multiple: number;
  comparables: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  excluded_size: number;
  global_multiple: number;
  multiples: MultipleRow[];
  rows: RadarRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted-ascending array; null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A live protocol's market-cap-to-TVL ratio, or null when either figure is missing. */
function liveMultiple(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  const r = p.mcap_usd / p.tvl_usd;
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * The market multiples: one median ratio per category over the snapshot's
 * live-token protocols, plus the global median across all of them. A category
 * multiple needs at least three live comparables; a category with fewer is
 * left out, and its protocols fall back to the global figure, so a single
 * outlier never prices a whole category.
 */
export function marketMultiples(
  protocols: SnapshotProtocol[],
  model: ModelConstants,
): { byCategory: Map<string, { multiple: number; raw: number; comparables: number }>; global: number; globalRaw: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    const r = liveMultiple(p);
    if (r === null) continue;
    all.push(r);
    const key = p.category ?? '(no category)';
    const list = ratios.get(key) ?? [];
    list.push(r);
    ratios.set(key, list);
  }
  all.sort((a, b) => a - b);
  const globalRaw = median(all) ?? 0.25;
  const global = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalRaw));
  const byCategory = new Map<string, { multiple: number; raw: number; comparables: number }>();
  for (const [key, list] of ratios) {
    if (list.length < model.min_comparables) continue;
    list.sort((a, b) => a - b);
    const m = median(list) ?? globalRaw;
    byCategory.set(key, {
      multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, m)),
      raw: m,
      comparables: list.length,
    });
  }
  return { byCategory, global, globalRaw };
}

/** The three multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Map<string, { multiple: number; raw: number; comparables: number }>; global: number; globalRaw: number },
): {
  implied: number;
  multiple: number;
  multipleRaw: number;
  multipleSource: 'category' | 'global';
  comparables: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const entry = multiples.byCategory.get(protocol.category ?? '(no category)');
  const multiple = entry?.multiple ?? multiples.global;
  const multipleRaw = entry?.raw ?? multiples.globalRaw;
  const multipleSource = entry === undefined ? 'global' : 'category';
  const comparables = entry?.comparables ?? 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains) * model.breadth_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, multipleRaw, multipleSource, comparables, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose products are wrapped, staked or bridged forms of another token. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped product's name begins with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking anywhere in a name, any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Why a pre-token protocol is set aside, or null when the board may rank it.
 * This is the watchlist's own exclusion logic, applied to the whole board.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'records a token that already trades';
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return `category ${p.category}: a wrapped, staked or bridged product, not a launch of its own`;
  if (VERSIONED.test(p.name)) return 'name ends in a version marker: a pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped, staked or staking: a product of a token that already trades';
  for (const ex of EXCHANGES) {
    if (p.name.startsWith(ex)) return `name begins with ${ex}: an exchange product, not a launch of its own`;
  }
  return null;
}

/** Whether the board may rank a protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return exclusionReason(p) === null;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** Gas for one transaction on a chain, by chain family. */
function gasFor(chain: string): { tx: string; week: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { tx: '$4–$12 of gas', week: 'about $8 of gas a week' };
  if (['arbitrum', 'optimism', 'base', 'blast', 'zksync', 'linea', 'scroll', 'mantle', 'mode', 'zora'].some((l2) => c.includes(l2))) {
    return { tx: '$0.30–$1.50 of gas', week: 'under $2 of gas a week' };
  }
  if (c === 'solana') return { tx: 'under $0.05 of fees', week: 'under $0.20 of fees a week' };
  if (['bsc', 'bnb', 'polygon', 'avalanche', 'fantom', 'gnosis', 'celo'].some((l1) => c.includes(l1))) {
    return { tx: '$0.10–$1 of gas', week: 'about $1 of gas a week' };
  }
  if (['cosmos', 'sui', 'aptos', 'sei', 'injective', 'near', 'starknet'].some((alt) => c.includes(alt))) {
    return { tx: 'under $0.50 of fees', week: 'under $1 of fees a week' };
  }
  return { tx: '$1–$3 of gas', week: 'about $2 of gas a week' };
}

/** The category's two qualifying actions, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const third = Math.max(25, Math.round(capital / 3));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
      `Borrow $${third} against the supply, hold it a week, then repay it, so both sides of the position are registered.`,
    ];
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap') || c.includes('leveraged farm')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
      `Swap $25 through the pool and, if it runs a gauge or a vote, lock a small voting position with the receipt.`,
    ];
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('aggregator')) {
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
      `Deposit $${third} into a second vault on another chain it runs on, so the activity spans two deployments.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
      `Close and reopen the hedge once a month so the account shows repeated use rather than one trade.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} and take one market position on ${name}.`,
      `Take a second position on a different market the following week, from the same wallet.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
      `Hold through one yield distribution and claim it from the protocol's own page.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
      `Renew or top up the cover once before it lapses, from the same wallet.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
      `Use the stable asset in one of its partner pools, so the position touches two of its products.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Make one more qualifying action a week later, such as a deposit, a swap or a vote, from the same wallet.`,
  ];
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Every figure derives from the protocol's own record: its category, its
 * chains, its TVL and its age. No protocol name is ever special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const [primary, secondary] = actionsFor(p, capital, chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: gas.tx,
      time: '5 minutes',
    },
    { text: primary, cost: `$${capital} of capital plus ${gas.tx}`, time: '15 minutes to set up' },
    { text: secondary, cost: gas.tx, time: '10 minutes' },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, from the same wallet.',
      cost: gas.week,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, then open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: `the $${capital} stays in the position; never pay to claim`,
      time: `${hold} days, plus 10 minutes to check`,
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log, and decide the unwind in advance: what you close first if the position moves against you.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The ranked board: every rankable protocol, strongest first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = marketMultiples(snapshot.protocols, model);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const v = impliedValue(p, snapshot.as_of, model, multiples);
      return { p, v };
    });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token',
    age_days: s.v.age,
    on_watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.v.implied,
    model: {
      multiple: round4(s.v.multiple),
      multiple_raw: round4(s.v.multipleRaw),
      multiple_source: s.v.multipleSource,
      comparables: s.v.comparables,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token comparables, by market cap, for the dashboard's evidence view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && liveMultiple(p) !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      multiple: round4(liveMultiple(p)!),
    }));
}

/** The pre-token protocols the board sets aside, with the reason each was left out. */
export function excludedRows(snapshot: Snapshot): ExcludedRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: exclusionReason(p) ?? 'not rankable',
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = marketMultiples(snapshot.protocols, model);
  const live = liveRows(snapshot);
  const excluded = excludedRows(snapshot);
  const multipleRows: MultipleRow[] = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: round4(v.multiple), comparables: v.comparables }))
    .sort((a, b) => b.comparables - a.comparables || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    excluded_size: excluded.length,
    global_multiple: round4(multiples.global),
    multiples: multipleRows,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      on_watchlist: r.on_watchlist,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      multiple_raw: r.model.multiple_raw,
      multiple_source: r.model.multiple_source,
      comparables: r.model.comparables,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
    excluded,
  };
  return { board, radar };
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
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null when it passes every row. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
