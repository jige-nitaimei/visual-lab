// game.js — 平台经营者「一回合版」的纯逻辑层
//
// 设计约束（有意为之）：
//   1. 不碰 DOM、不碰 three、不读文件 —— 可以在 node 里直接跑，方便调平衡。
//   2. 所有状态都是可 JSON 序列化的朴素对象 —— 存档问题在第一天就解决，不要留到后面。
//   3. 每回合只结算「数学」，不推进 3D 模拟。90 天的 sim 是 2.3 亿步，跑不动；
//      但结算公式的参数取自当前沙盘（见 fromStats），所以它和城里是同一个世界。
//
// 一局 = 4 个季度 = 1 年。

export const CONFIG = {
  quarters: 4,
  startUsers: 50,      // 万
  startCreators: 8,    // 万
  startQuality: 0.55,
  startDiversity: 0.50,
  startRisk: 10,       // 0-100
  baseBudget: 60,      // 每季度基础预算
  budgetCap: 120,
  budgetFromRevenue: 0.4,  // 上季度收入的多少变成下季度预算
  loseUsers: 20,       // 用户跌破 20 万 → 崩
  loseCreators: 3,     // 创作者跌破 3 万 → 生态枯
  loseRisk: 100,       // 风险满了 → 被约谈关停
  winUsers: 85,        // 4 季度后用户 ≥ 85 万算赢
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const round1 = (v) => Math.round(v * 10) / 10;

// 确定性随机：同一个 seed 出同一局，测试才能重复。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EVENTS = [
  {
    id: 'regulator',
    name: '监管约谈',
    text: '平台被约谈：内容审核与算法透明度被点名。',
    effect: (s) => { s.risk = clamp(s.risk + 16, 0, 100); },
  },
  {
    id: 'starfall',
    name: '顶流塌房',
    text: '一位千万粉博主翻车，用户跟着走了一批。',
    effect: (s) => { s.users *= 0.94; s.risk = clamp(s.risk + 4, 0, 100); },
  },
  {
    id: 'rival',
    name: '竞品砸钱',
    text: '对手平台高价挖人，中腰部创作者开始两头挂。',
    effect: (s) => { s.creators *= 0.92; },
  },
  {
    id: 'aigc',
    name: 'AI 内容泛滥',
    text: '批量生成的视频涌入，内容池的平均质量被拉低。',
    effect: (s) => { s.quality = clamp01(s.quality - 0.07); },
  },
  {
    id: 'hit',
    name: '一条视频出圈',
    text: '某个垂类出了现象级爆款，站外都在转。',
    effect: (s) => { s.users *= 1.09; },
  },
  {
    id: 'money',
    name: '资本看好',
    text: '新融资到账，下季度的预算宽了一点。',
    effect: (s) => { s.bonus = (s.bonus || 0) + 22; },
  },
  {
    id: 'protest',
    name: '创作者抗议',
    text: '一批创作者抱怨限流不透明，开始停更。',
    effect: (s) => { s.creators *= 0.90; s.risk = clamp(s.risk + 6, 0, 100); },
  },
  {
    id: 'law',
    name: '未成年人保护新规',
    text: '新规落地，短视频时段与推荐都被限制。',
    effect: (s) => { s.risk = clamp(s.risk + 9, 0, 100); s.users *= 0.97; },
  },
];

export function newGame(seed = Date.now()) {
  const rng = mulberry32(seed);
  // 4 个季度不重复抽事件，先洗牌
  const pool = EVENTS.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return {
    seed,
    quarter: 0,
    users: CONFIG.startUsers,
    creators: CONFIG.startCreators,
    quality: CONFIG.startQuality,
    diversity: CONFIG.startDiversity,
    risk: CONFIG.startRisk,
    revenueLast: 0,
    bonus: 0,
    fatigue: 0,          // 广告疲劳：连续塞广告会累积，让「一直猛投」不再是最优
    over: null,          // null | 'win' | 'lose'
    loseReason: '',
    history: [],
    _pool: pool.slice(0, CONFIG.quarters).map((e) => e.id),
  };
}

export function budgetFor(state) {
  const raw = CONFIG.baseBudget + state.revenueLast * CONFIG.budgetFromRevenue;
  return Math.round(Math.min(CONFIG.budgetCap, raw));
}

// 从 key 取事件对象
function eventById(id) {
  return EVENTS.find((e) => e.id === id) || null;
}

// 每回合的决策形状：
//   spendGrowth / spendMod / spendSubsidy : 0-60，三者之和 ≤ budget
//   algoTilt : 0-100  0 = 偏多样性，100 = 偏爆款
//   adLoad   : 0-100  0 = 干净，100 = 塞满
export function settleQuarter(state, d) {
  if (state.over) return { ...state, skipped: true };

  const budget = budgetFor(state) + (state.bonus || 0);
  let sg = clamp(Number(d.spendGrowth) || 0, 0, 60);
  let sm = clamp(Number(d.spendMod) || 0, 0, 60);
  let ss = clamp(Number(d.spendSubsidy) || 0, 0, 60);
  const wanted = sg + sm + ss;
  // 超支不允许：按比例缩到预算内，并标记出来让 UI 能提示。
  // UI 层应当先拦（滑块加起来不能超），这里是兜底，防止状态机被写坏。
  const overspent = wanted > budget;
  if (overspent) {
    const k = budget / wanted;
    sg = Math.floor(sg * k);
    sm = Math.floor(sm * k);
    ss = Math.floor(ss * k);
  }
  const spend = sg + sm + ss;
  const gN = sg / 60;
  const mN = sm / 60;
  const sN = ss / 60;
  const algo = clamp(Number(d.algoTilt) || 0, 0, 100) / 100;
  const ad = clamp(Number(d.adLoad) || 0, 0, 100) / 100;

  const before = { users: state.users, creators: state.creators, risk: state.risk };

  // 1) 内容质量：投放会稀释，算法偏爆款会降，补贴能养
  state.quality = clamp01(state.quality * 0.85 + 0.15 * (0.42 + sN * 0.28 + algo * 0.10 - ad * 0.12));

  // 2) 多样性：算法越偏爆款越少（同质化的根源）
  state.diversity = clamp01(state.diversity * 0.82 + 0.18 * (0.72 - algo * 0.34 + sN * 0.20));

  // 2b) 广告疲劳：连续塞广告，用户的耐受度会掉。这是让「一直猛投」
  //     不能成为唯一解的关键——收益递减必须存在，否则玩家没有调整的理由。
  state.fatigue = clamp01((state.fatigue || 0) * 0.75 + ad * 0.45 - 0.05);

  // 3) 用户：拉新靠投放，但拉来的人会看内容好不好
  const acq = gN * 32 * (0.55 + state.diversity * 0.6) * (0.72 + state.quality * 0.62);
  const churnRate = 0.055 + ad * 0.075 + state.fatigue * 0.05 - state.quality * 0.03;
  state.users = Math.max(5, state.users + acq - state.users * Math.max(0.01, churnRate));

  // 4) 创作者：补贴留人，审核赶人。注意这里算的是「流失率」不是「流失量」。
  const newC = sN * 1.5 - mN * 1.1 + 0.4;
  const churnCRate = 0.055 + mN * 0.075 - state.diversity * 0.03;
  state.creators = Math.max(1, state.creators + newC - state.creators * Math.max(0.01, churnCRate));

  // 5) 风险：偏爆款与塞广告抬风险，审核压风险
  state.risk = clamp(
    state.risk + algo * 9 + ad * 12 - mN * 14 - state.quality * 4 - 3 + (state.diversity < 0.35 ? 6 : 0),
    0, 100,
  );

  // 6) 收入：用户数 × 广告负载 × 质量溢价（广告主愿意为好内容付更贵的钱）
  state.revenueLast = state.users * (0.35 + ad * 0.75) * (0.55 + state.quality * 0.8);

  // 7) 本季度事件
  const evId = state._pool[state.quarter];
  const ev = eventById(evId);
  if (ev) ev.effect(state);

  state.quarter += 1;
  state.bonus = 0;

  const over = judge(state);
  state.over = over.over;
  state.loseReason = over.reason;

  const entry = {
    quarter: state.quarter,
    budget,
    spend,
    sg, sm, ss,
    algoTilt: Math.round(algo * 100),
    adLoad: Math.round(ad * 100),
    event: ev ? { id: ev.id, name: ev.name, text: ev.text } : null,
    after: {
      users: round1(state.users),
      creators: round1(state.creators),
      quality: Math.round(state.quality * 100) / 100,
      diversity: Math.round(state.diversity * 100) / 100,
      risk: Math.round(state.risk),
      revenue: round1(state.revenueLast),
    },
    delta: {
      users: round1(state.users - before.users),
      creators: round1(state.creators - before.creators),
      risk: Math.round(state.risk - before.risk),
    },
    overspent,
  };
  state.history.push(entry);
  return entry;
}

function judge(state) {
  if (state.users < CONFIG.loseUsers) return { over: 'lose', reason: '用户跑光了，平台成了空城' };
  if (state.creators < CONFIG.loseCreators) return { over: 'lose', reason: '创作者走光了，没有内容可推' };
  if (state.risk >= CONFIG.loseRisk) return { over: 'lose', reason: '监管风险爆表，被勒令停业整改' };
  // 四个季度走完：不判输赢，交给评级。经营游戏没有「通关」，
  // 只有「这一年你把它经营成什么样」。
  if (state.quarter >= CONFIG.quarters) return { over: 'done', reason: '一年跑完了' };
  return { over: null, reason: '' };
}

// 评级：用户增长、生态健康、风险三者都要看。
// 只有「长大了、生态还在、风险可控」三条同时成立才给 S/A —— 那是精心调整
// 出来的结果，不是套一条固定策略能做到的。
export function rating(state) {
  if (!state.over) return null;
  if (state.over === 'lose') {
    return { grade: 'F', score: 0, lines: [state.loseReason] };
  }
  const u = state.users / CONFIG.startUsers;
  const c = state.creators / CONFIG.startCreators;
  const health = state.diversity * 0.5 + state.quality * 0.5;
  const score = u * 0.30 + c * 0.30 + health * 0.55 - (state.risk / 100) * 0.55;
  let grade = 'D';
  if (score >= 0.98) grade = 'S';
  else if (score >= 0.88) grade = 'A';
  else if (score >= 0.78) grade = 'B';
  else if (score >= 0.68) grade = 'C';
  // 不长大不配 A：平台一年没涨用户，生态再健康也是失败
  if (u < 1.05 && (grade === 'S' || grade === 'A')) grade = 'B';
  if (state.risk > 80 && (grade === 'S' || grade === 'A')) grade = 'B';
  return {
    grade,
    score: Math.round(score * 100) / 100,
    lines: verdictLines(state, score),
  };
}

// 每一局都要有话说。中规中矩的一局恰恰最常见，如果它一句点评都没有，
// 玩家会觉得「我这一年干了什么」。所以每条都写成三档，最后再加一句总评。
function verdictLines(state, score) {
  const out = [];
  const u = state.users / CONFIG.startUsers;
  const c = state.creators / CONFIG.startCreators;

  if (u > 1.5) out.push('用户涨得很猛 —— 拉新这钱花得值');
  else if (u > 1.15) out.push('用户在涨，但还没到爆发的程度');
  else if (u < 1.05) out.push('用户几乎没动，钱花出去没听见响');
  else out.push('用户小涨，基本跟着大盘走');

  if (c < 0.75) out.push('创作者被你榨干了，长期不划算');
  else if (c > 1.3) out.push('生态很健康，创作者在进');
  else out.push('创作者基本持平：没走，也没多来');

  if (state.diversity < 0.35) out.push('内容高度同质化，池子越推越窄');
  else if (state.diversity < 0.55) out.push('内容开始趋同，靠补贴还拉得回来');
  else out.push('内容还算多样，四个区都有人在发');

  if (state.risk > 65) out.push('风险堆得太高，随时可能被约谈');
  else if (state.risk > 35) out.push('风险在往上走，还有腾挪的余地');
  else out.push('监管这块没出事，算你的分寸也算你的运气');

  if (state.quality > 0.7) out.push('内容质量在往上走，这是能卖上价的本钱');
  else if (state.quality > 0.45) out.push('内容质量原地踏步，不坏也不出彩');
  else out.push('内容质量在下滑，用户迟早会发现');

  out.push(score >= 0.88 ? '总评：既长了用户，也没把生态搞坏。'
    : score >= 0.78 ? '总评：过得去，但有一条腿是瘸的。'
      : score >= 0.68 ? '总评：勉强活着，明年得换打法。'
        : '总评：这一年基本上是在原地耗。');
  return out;
}

// 把沙盘的真实统计折成初始状态：让游戏和城里的世界对得上。
export function fromStats(stats) {
  if (!stats) return {};
  const tier = Array.isArray(stats.pools) ? stats.pools : null;
  const gini = typeof stats.gini === 'number' ? stats.gini : 0.32;
  const rates = stats.rates || {};
  return {
    diversity: clamp01(1 - gini * 1.4),
    quality: clamp01(0.35 + (rates.top || 0) * 1.6),
  };
}

export function snapshot(state) {
  return JSON.parse(JSON.stringify({
    seed: state.seed,
    quarter: state.quarter,
    users: state.users,
    creators: state.creators,
    quality: state.quality,
    diversity: state.diversity,
    risk: state.risk,
    revenueLast: state.revenueLast,
    bonus: state.bonus,
    over: state.over,
    loseReason: state.loseReason,
    history: state.history,
    _pool: state._pool,
  }));
}
