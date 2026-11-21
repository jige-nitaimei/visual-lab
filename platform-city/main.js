// main.js —— 镜头、拾取、LOD、主循环
// 缩放不是放大像素，是镜头 fly-to：所有相机参数都写进 goal，每帧插值逼近它
import * as THREE from './vendor/three.module.min.js';
import { createCity, BLOCKS } from './city.js?v=20261118e';
import * as Game from './game.js?v=20261119g';

const $ = (id) => document.getElementById(id);
const canvas = $('city');
const boot = $('boot');
const scaleEl = $('scale').querySelector('i');
const crumbEl = $('crumb');
const backBtn = $('back');
const rolecard = $('rolecard');
const submitBtn = $('submit');
const logcard = $('logcard');
const rcName = $('rc-name');
const rcDesc = $('rc-desc');
const rcMeta = $('rc-meta');

// 自检：任何运行时错误都显示在页面上，而不是留一块黑屏。
const diag = document.createElement('div');
diag.style.cssText =
  'position:fixed;left:0;right:0;top:0;z-index:99;padding:8px 12px;background:#7a1020;' +
  'color:#fff;font:12px/1.6 ui-monospace,monospace;display:none;white-space:pre-wrap';
document.body.appendChild(diag);
const fail = (m) => {
  diag.style.display = 'block';
  diag.textContent += m + '\n';
};
window.addEventListener('error', (e) => fail('ERR ' + (e.message || e.type)));
window.addEventListener('unhandledrejection', (e) =>
  fail('REJ ' + ((e.reason && e.reason.message) || e.reason)));

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const scene = new THREE.Scene();
const city = createCity(scene);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);

// ---------- 相机：所有量都有 goal ----------
const VIEW = {
  overview: { radius: 82, phi: 1.0, theta: 0.68, tx: 0, ty: 4.5, tz: 0 },
  block(i) {
    const b = BLOCKS[i];
    return {
      radius: 23,
      phi: 1.13,
      theta: b.angle + 0.34,
      tx: Math.cos(b.angle) * 26,
      ty: 5.2,
      tz: Math.sin(b.angle) * 26,
    };
  },
  // 塔内四车间太小，全景看不清：点塔就把镜头推到它侧面
  tower: { radius: 30, phi: 1.1, theta: 0.85, tx: 0, ty: 12, tz: 0 },
};

const cur = { ...VIEW.overview };
const goal = { ...VIEW.overview };
let flying = false;

function setGoal(g) {
  Object.assign(goal, g);
  flying = true;
}

function placeCamera() {
  const sp = Math.sin(cur.phi);
  camera.position.set(
    cur.tx + cur.radius * sp * Math.cos(cur.theta),
    cur.ty + cur.radius * Math.cos(cur.phi),
    cur.tz + cur.radius * sp * Math.sin(cur.theta),
  );
  camera.lookAt(cur.tx, cur.ty, cur.tz);
}

// ---------- 拾取 ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let down = null;
let dragged = false;

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(city.group.children, true);
  for (const h of hits) {
    const u = h.object.userData;
    if (!u) continue;
    if (u.pick === 'queue') return { type: 'queue', i: u.queue };
    if (u.pick === 'role') return { type: 'role', i: u.role };
    if (u.pick === 'tower') return { type: 'tower' };
    if (u.pick === 'building') return { type: 'building', i: u.index };
    if (u.pick === 'block') return { type: 'block', i: u.block };
  }
  return null;
}

// ---------- 点中一条视频：看它一路怎么被筛掉 ----------
const tokcard = $('tokcard');
const tkTitle = $('tk-title');
const tkQ = $('tk-q');
const tkM = $('tk-m');
const tkSteps = $('tk-steps');
const tkEnd = $('tk-end');
let traced = null;
let tokAcc = 0;
const _pv = new THREE.Vector3();

// 视频只有 0.17 半径，射线几乎点不中；改成「屏幕空间最近点」，20 来像素内都算点中。
// 手指比鼠标粗得多，触屏设备把容差放到 46px，否则要戳好几次。
const PICK_PX = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ? 46 : 26;

function pickToken(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let best = null;
  let bestD = PICK_PX;
  for (const tk of city.tokens) {
    if (tk.state === 'idle') continue;
    _pv.copy(tk.mesh.position).project(camera);
    if (_pv.z > 1) continue;
    const sx = (_pv.x * 0.5 + 0.5) * rect.width;
    const sy = (-_pv.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - mx, sy - my);
    if (d < bestD) {
      bestD = d;
      best = tk;
    }
  }
  return best;
}

const END_TEXT = {
  passed: '一路走到底，进了爆款池 —— 它拿到了这个平台能给的最大一份曝光。',
  dropped: '半路折了。掉下去的那一步，就是它在这座城里的天花板。',
};

function renderTokenCard() {
  if (!traced) return;
  // 它已经走完：把履历冻结成快照，别让池子里下一个复用的视频把卡片覆盖掉
  if (!traced.frozen && traced.state === 'idle' && traced.end) {
    traced = { ...traced, hist: traced.hist.slice(), frozen: true };
  }
  const tk = traced;
  const b = BLOCKS[tk.bi];
  tkTitle.textContent = `${b.name} · 一条视频`;
  tkTitle.style.color = '#' + b.color.toString(16).padStart(6, '0');
  tkQ.style.width = Math.round(tk.quality * 100) + '%';
  tkM.style.width = Math.round(tk.match * 100) + '%';

  let html = '';
  for (let i = 0; i < city.LAYERS.length; i++) {
    const L = city.LAYERS[i];
    const h = tk.hist.find((x) => x.layer === i);
    if (!h) {
      const here = tk.state === 'run' && tk.layer === i;
      html += `<div class="tk-step"><i>${i + 1}</i>${L.name}<em>${here ? '正在这里' : '未到'}</em><s></s></div>`;
    } else {
      html += `<div class="tk-step ${h.pass ? 'ok' : 'no'}"><i>${i + 1}</i>${L.name}<em>${h.pass ? '通过' : '淘汰'}</em><s>p ${Math.round(h.p * 100)}%</s></div>`;
    }
  }
  tkSteps.innerHTML = html;

  if (tk.end) {
    const done = tk.state === 'idle' || tk.state === 'fall' || tk.state === 'shoot';
    tkEnd.textContent = END_TEXT[tk.end] + (done ? '（已结束）' : '');
  } else {
    tkEnd.textContent = '还在流水线上，等它走完。';
  }
}

function traceToken(tk) {
  traced = tk;
  tokAcc = 0;
  rolecard.hidden = true;
  tokcard.hidden = false;
  renderTokenCard();
  // 点一条视频 —— 它旁边立起一块屏，显示这条内容本身的样子
  city.showScreen(tk);
}

$('tk-x').addEventListener('click', () => {
  tokcard.hidden = true;
  traced = null;
  city.showScreen(null);
});

// 只有站在一栋楼前面，才有「替这个博主发布一次」这回事
let submitRec = null;
function setSubmitTarget(rec) {
  submitRec = rec || null;
  submitBtn.hidden = !submitRec;
  if (!submitRec) {
    logcard.hidden = true;
    logcard.innerHTML = '';
  }
}

const STAGE_NAME = ['召回', '粗排', '精排', '重排'];

function onSubmitStage(ev) {
  if (CAPTION[ev.type]) showCaption(CAPTION[ev.type](ev));
  const row = (html, cls) => {
    const d = document.createElement('div');
    d.className = 'lg-row' + (cls ? ' ' + cls : '');
    d.innerHTML = html;
    logcard.appendChild(d);
    logcard.scrollTop = logcard.scrollHeight;
  };
  if (ev.type === 'start') {
    row(
      `<b>发布</b> 内容质量 ${Math.round(ev.quality * 100)} · 受众匹配 ${Math.round(ev.match * 100)}`,
      'w',
    );
  } else if (ev.type === 'enter') {
    row('<b>① 召回</b> 进候选堆，按兴趣粗捞一批');
  } else if (ev.type === 'pass') {
    row(
      `<b>${ev.layer + 1} ${STAGE_NAME[ev.layer]}</b> 通过 · 这一层概率 ${Math.round(ev.p * 100)}%`,
      'ok',
    );
  } else if (ev.type === 'drop') {
    row(
      `<b>${ev.layer + 1} ${STAGE_NAME[ev.layer]}</b> 淘汰 · 这一层概率 ${Math.round(ev.p * 100)}%`,
      'no',
    );
  } else if (ev.type === 'land') {
    row(`<b>上线</b> 进了「${BLOCKS[ev.rec.block].name}」的信息流`, 'ok');
  } else if (ev.type === 'dead') {
    row('<b>结束</b> 没有进任何人的屏。', 'no');
  }
}

submitBtn.addEventListener('click', () => {
  if (!submitRec) return;
  logcard.hidden = false;
  logcard.innerHTML = '<div class="lg-h">一条作品的一生</div>';
  director.hidden = false;
  caption.hidden = false;
  demoFollow = true;
  setGoal({ radius: 17, phi: 1.24 });
  city.playSubmit(submitRec, onSubmitStage);
});

// ---------- 导演台 ----------
const director = $('director');
const caption = $('caption');
let demoFollow = false;

const CAPTION = {
  start: (ev) =>
    `替这个博主发一条：质量 <b>${Math.round(ev.quality * 100)}</b> · 匹配 <b>${Math.round(ev.match * 100)}</b>`,
  enter: () =>
    '<b>① 召回</b> 只做一件事：从千万条里按兴趣粗捞一批。谁都可能进这里',
  pass: (ev) =>
    `<b>${ev.layer + 1} ${STAGE_NAME[ev.layer]}</b> 通过 · 这一层概率 ${Math.round(ev.p * 100)}%`,
  drop: (ev) =>
    `<b>${ev.layer + 1} ${STAGE_NAME[ev.layer]}</b> 淘汰 · 这一层概率 ${Math.round(ev.p * 100)}%，到此为止`,
  land: (ev) => `<b>上线</b> 进了「${BLOCKS[ev.rec.block].name}」的信息流`,
  dead: () => '<b>结束</b> 没有进任何人的屏。',
};

function showCaption(html) {
  caption.hidden = false;
  caption.innerHTML = html;
}

function endDemo() {
  director.hidden = true;
  caption.hidden = true;
  demoFollow = false;
  city.demoStop();
}

$('d-stop').addEventListener('click', endDemo);

$('d-pause').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const on = btn.classList.toggle('on');
  btn.textContent = on ? '⏸' : '▶';
  city.setDemoPaused(on);
});

$('d-prev').addEventListener('click', () => city.demoJump(-1));
$('d-next').addEventListener('click', () => city.demoJump(1));

for (const b of document.querySelectorAll('#d-spd button')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('#d-spd button')) o.classList.remove('on');
    b.classList.add('on');
    city.setDemoSpeed(Number(b.dataset.s));
  });
}

for (const c of document.querySelectorAll('#d-only input')) {
  c.addEventListener('change', () => {
    const only = [...document.querySelectorAll('#d-only input')]
      .filter((x) => x.checked)
      .map((x) => Number(x.dataset.layer));
    city.setDemoOnly(only.length ? only : [0, 1, 2, 3]);
  });
}

$('fold').addEventListener('click', () => document.body.classList.toggle('folded'));

// 手机上一屏塞不下这么多面板：先把次要的收起来，标题条仍然可以点开。
if (matchMedia('(max-width: 820px)').matches) {
  for (const id of ['legend', 'tune', 'sim', 'feed']) {
    const el = document.getElementById(id);
    if (el) el.classList.add('collapsed');
  }
}

const rotEl = document.getElementById('rot');
const rotX = document.getElementById('rot-x');
if (rotX) rotX.addEventListener('click', () => { rotEl.style.display = 'none'; });

// 城里的流水：每半秒对一次，没新事就不动 DOM
const fdList = $('fd-list');
let fdLast = -1;
let fdAcc = 0;

function renderFeed() {
  const items = city.feed;
  if (!items.length) {
    if (fdLast !== 0) {
      fdLast = 0;
      fdList.innerHTML = '<div class="fd-e">还没有事发生，等一会儿</div>';
    }
    return;
  }
  const newest = items[items.length - 1].t;
  if (newest === fdLast) return;
  fdLast = newest;
  fdList.innerHTML = items
    .slice(-14)
    .reverse()
    .map((e) => {
      const d = new Date(e.t);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `<div class="fd-row ${e.tone}"><i>${hh}:${mm}</i><span>${e.text}</span></div>`;
    })
    .join('');
}

$('feed').querySelector('.fd-h').addEventListener('click', () => {
  $('feed').classList.toggle('collapsed');
});

// 城里的旋钮：六个参数直接接到判定公式上，拖完几秒就能看出漏斗变了
const tuneList = $('tune-list');

function buildTune() {
  const t = city.getTuning();
  tuneList.innerHTML = city.TUNING_DEFS.map(
    (d) => `<div class="tn-row">
      <div class="tn-lab"><span>${d.label}</span><b data-v="${d.key}">${t[d.key].toFixed(2)}</b></div>
      <input type="range" data-k="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${t[d.key]}">
    </div>`,
  ).join('');
}

buildTune();

tuneList.addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  const v = Number(e.target.value);
  const lab = tuneList.querySelector(`b[data-v="${k}"]`);
  if (lab) lab.textContent = v.toFixed(2);
  // MCN 覆盖率要重签全城，拖动时太贵，等松手（change）再真的重建
  if (k === 'mcnRate') return;
  city.setTuning({ [k]: v });
});

tuneList.addEventListener('change', (e) => {
  const k = e.target.dataset.k;
  if (k !== 'mcnRate') return;
  city.setTuning({ mcnRate: Number(e.target.value) });
});

$('tune-reset').addEventListener('click', () => {
  city.setTuning({
    wComplete: 1,
    freshness: 1,
    coldStart: 1,
    modThreshold: 1,
    promoPower: 1,
    mcnRate: 1,
  });
  buildTune();
});

$('tune').querySelector('.tn-h').addEventListener('click', () => {
  $('tune').classList.toggle('collapsed');
});

// 两块图例各管自己：点标题那一行收起 / 展开
for (const id of ['legend', 'legend2']) {
  const el = $(id);
  if (!el) continue;
  const head = el.querySelector('h2, .lg-h');
  if (head) head.addEventListener('click', () => el.classList.toggle('collapsed'));
}

function enterTower() {
  setSubmitTarget(null);
  city.setFocus(null);
  rolecard.hidden = true;
  setGoal(VIEW.tower);
  scaleEl.textContent = '流水线';
  backBtn.hidden = false;
}

function enterBlock(bi) {
  if (bi < 0) return backOverview();
  setSubmitTarget(null);
  rolecard.hidden = true;
  city.clearFocus();
  city.setFocus('block', bi);
  setGoal(VIEW.block(bi));
  city.setLevel(1, bi);
  scaleEl.textContent = '街区';
  const b = city.blocks[bi];
  crumbEl.innerHTML = `<span>${b.def.name}</span> 街区 · ${b.buildings.length} 个创作者`;
  backBtn.classList.add('on');
}

function enterBuilding(idx) {
  const rec = city.buildings[idx];
  if (!rec) return;
  rolecard.hidden = true;
  tokcard.hidden = true;
  traced = null;
  city.showScreen(null);
  const a = Math.atan2(rec.bz, rec.bx);
  setGoal({
    radius: Math.max(10, rec.h * 1.7),
    phi: 1.22,
    theta: a + 0.42,
    tx: rec.bx,
    ty: rec.h * 0.55,
    tz: rec.bz,
  });
  city.setLevel(1, rec.block);
  city.setFocus('building', idx);
  city.focusBuilding(rec);
  scaleEl.textContent = '一栋楼';
  crumbEl.innerHTML = `<span>${BLOCKS[rec.block].name}</span> · 一栋楼 · ${Math.round(rec.followers)} 粉`;
  backBtn.classList.add('on');
  setSubmitTarget(rec);
}

const ROLE_META = {
  mcn: () => `已签约 <b style="color:#7ef0d0">${city.signedCount}</b> 个创作者（占全城 ${Math.round((city.signedCount / city.buildings.length) * 100)}%），绿色细线就是签约关系。被签的楼出片更勤、冷启动额度更高。`,
  ads: () => '广告位按千次曝光竞价（eCPM）。出价越高牌子越亮；预算烧完就换下一家。它插在推荐结果里，挤掉一条自然流量。',
  mod: () => `此刻有 <b style="color:#ff4d6d">${city.flaggedCount}</b> 条红标在闪。红标 = 曝光高但完播低，被判成「骗点击」，限流处理。`,
  hq: () => '塔基旁边的平楼。它定规则：什么算优质、给谁补贴、违规怎么罚。所有车间的参数都从这里下发。',
};

function enterRole(ri) {
  const r = city.roles[ri];
  setSubmitTarget(null);
  rolecard.hidden = true;
  city.clearFocus();
  city.setFocus(null);
  if (!r) return;
  const a = Math.atan2(r.pos.z, r.pos.x);
  setGoal({
    radius: 19,
    phi: 1.18,
    theta: a + 0.55,
    tx: r.pos.x * 0.82,
    ty: 6.5,
    tz: r.pos.z * 0.82,
  });
  city.setLevel(2, -1);
  scaleEl.textContent = '角色';
  crumbEl.innerHTML = `<span>${r.name}</span> · 生态角色`;
  rcName.textContent = r.name;
  rcDesc.textContent = r.desc;
  const meta = ROLE_META[r.id];
  rcMeta.innerHTML = meta ? meta() : '';
  rolecard.hidden = false;
  backBtn.classList.add('on');
}

function backOverview() {
  setGoal(VIEW.overview);
  city.setLevel(0, -1);
  city.clearFocus();
  city.setFocus(null);
  city.showScreen(null);
  setSubmitTarget(null);
  scaleEl.textContent = '全景';
  crumbEl.textContent = '整座城 = 一个短视频生态';
  rolecard.hidden = true;
  backBtn.classList.remove('on');
}

// 触屏双指缩放 —— 手机上没有滚轮，捏合是唯一的远近手段。
const ptrs = new Map();
let pinchStart = 0;
let pinchRadius = 0;

canvas.addEventListener('pointerdown', (e) => {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    pinchStart = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    pinchRadius = goal.radius;
    down = null;
    dragged = true;
  } else {
    down = { x: e.clientX, y: e.clientY };
    dragged = false;
  }
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    goal.radius = Math.min(150, Math.max(9, pinchRadius * (pinchStart / dist)));
    flying = true;
    return;
  }
  if (!down) return;
  const dx = e.clientX - down.x;
  const dy = e.clientY - down.y;
  if (!dragged && Math.hypot(dx, dy) > 5) dragged = true;
  if (!dragged) return;
  const sp = 0.0052 * (0.5 + cur.radius / 82);
  goal.theta += dx * sp;
  goal.phi = Math.min(Math.PI - 0.16, Math.max(0.16, goal.phi - dy * sp * 0.9));
  cur.theta += dx * sp;
  cur.phi = Math.min(Math.PI - 0.16, Math.max(0.16, cur.phi - dy * sp * 0.9));
  goal.theta = cur.theta;
  goal.phi = cur.phi;
  down = { x: e.clientX, y: e.clientY };
  flying = false;
});

canvas.addEventListener('pointerup', (e) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinchStart = 0;
  if (down && !dragged) {
    const tk = pickToken(e);
    if (tk) {
      traceToken(tk);
    } else {
      const hit = pick(e);
      if (hit && hit.type === 'queue') city.showQueueScreen(hit.i);
      else if (hit && hit.type === 'role') enterRole(hit.i);
      else if (hit && hit.type === 'tower') enterTower();
      else if (hit && hit.type === 'building') enterBuilding(hit.i);
      else if (hit) enterBlock(hit.i);
    }
  }
  down = null;
});

canvas.addEventListener('pointercancel', (e) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinchStart = 0;
  down = null;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = Math.exp(e.deltaY * 0.0011);
  goal.radius = Math.min(150, Math.max(9, goal.radius * k));
  flying = true;
}, { passive: false });

canvas.addEventListener('dblclick', () => backOverview());
backBtn.addEventListener('click', () => backOverview());
$('rc-x').addEventListener('click', () => { rolecard.hidden = true; });

// ---------- resize ----------
// ---------- 八步导览：先给一条固定路线，走完再自己玩 ----------
// 每步做一件事：把镜头带到一个地方 + 说清那里在发生什么。
const GUIDE = [
  {
    t: '整座城 = 一个短视频生态',
    d: '中央是推荐系统，四个街区是内容垂类，越高越亮的楼是越大的创作者。先看它转一圈，别急着点。',
    run: () => backOverview(),
  },
  {
    t: '中央塔：决定谁能被看见',
    d: '塔里四道漏斗——召回、粗排、精排、重排。每条投稿从下往上走，每层都可能掉下去。越往上越窄，这就是「流量就那么多」。',
    run: () => enterTower(),
  },
  {
    t: '街区 = 内容垂类',
    d: '美食、游戏、颜值、知识各自成片。同街区的人抢同一批观众，所以抄选题（青色弧线）基本只发生在街区内。',
    run: () => enterBlock(0),
  },
  {
    t: '一栋楼 = 一个创作者',
    d: '高度是粉丝，窗户亮度是还在不在更新，楼顶灯带是完播率，天线是粉丝过九千，红锥是被限流。点进楼能看到他发布的每一条。',
    run: () => enterBuilding(Math.min(3, (city.buildings ? city.buildings.length : 1) - 1)),
  },
  {
    t: '一条视频要过四道关',
    d: '在楼里点一个方块，或者回塔上按「演示」。它会告诉你每层的通过概率、哪一层被淘汰、最后落到哪个池子。',
    run: () => enterTower(),
  },
  {
    t: '广告主：买的是「精排概率」',
    d: '金色光束打到某一层，被投的街区在精排层概率乘 1.4——不是保送，只是把胜算买高一点。看左下角「城里的流水」。',
    run: () => enterRole(1),
  },
  {
    t: 'MCN 与审核：两个机构的手',
    d: 'MCN 给签约楼套绿环，保底但不保质量；审核插红锥、压红灯带、让整栋楼暗一阵。一个是正反馈，一个是负反馈。',
    run: () => enterRole(0),
  },
  {
    t: '因果都在右下这条流水里',
    d: '谁被限流、谁拿到了钱、谁跑完了全程，按时间排。走完这八步再自己点，每个动作在讲什么就都能对上了。',
    run: () => {
      backOverview();
      document.body.classList.remove('folded');
    },
  },
];

let guideIdx = -1;

function guideGo(i) {
  if (i < 0 || i >= GUIDE.length) {
    guideStop();
    return;
  }
  guideIdx = i;
  const s = GUIDE[i];
  $('g-n').textContent = i + 1 + ' / ' + GUIDE.length;
  $('g-t').textContent = s.t;
  $('g-d').textContent = s.d;
  $('g-prev').disabled = i === 0;
  $('g-next').textContent = i === GUIDE.length - 1 ? '开始自己玩' : '下一步';
  $('guide').hidden = false;
  try {
    s.run();
  } catch (err) {
    console.warn('[guide]', err);
  }
}

function guideStart() {
  guideGo(0);
}

function guideStop() {
  guideIdx = -1;
  $('guide').hidden = true;
  backOverview();
}

$('guide-btn').addEventListener('click', () => (guideIdx >= 0 ? guideStop() : guideStart()));
$('g-next').addEventListener('click', () => guideGo(guideIdx + 1));
$('g-prev').addEventListener('click', () => guideGo(guideIdx - 1));
$('g-x').addEventListener('click', guideStop);

// ---------- B2：批量演算 ----------
// 快进只推进 token 状态机，不算位置动画 —— 得到的是统计，不是录像。
// tally 是累积的，所以按几次「+10 分钟」等于连跑这么久。
function renderBulk(st) {
  const el = $('bulk-out');
  if (!st.spawned) {
    el.innerHTML = '<div class="sm-empty">还没快进过。快进只算逻辑，不跑画面。</div>';
    return;
  }
  const row = (k, v) => '<div class="sm-row"><span>' + k + '</span><b>' + v + '</b></div>';
  el.innerHTML =
    row('投稿', st.spawned) +
    row('到顶拿到曝光', st.passedTop) +
    row('中途淘汰', st.dropped) +
    row('淘汰分布', st.dropByLayer.join(' / ')) +
    row('平均粉丝', st.avgFollowers) +
    row('集中度 Gini', st.gini) +
    row('四档账号数', st.pools.join(' / ')) +
    row('MCN / 限流', st.signed + ' / ' + st.flagged);
}

function runBulk(seconds) {
  renderBulk(city.fastForward(seconds));
}

$('bulk-10').addEventListener('click', () => runBulk(600));
$('bulk-60').addEventListener('click', () => runBulk(3600));
$('bulk-reset').addEventListener('click', () => {
  city.resetTally();
  renderBulk(city.getStats());
});

// ---------- B3：你当审核 ----------
let auditSig = '';
let auAcc = 0;

function renderAudit() {
  const list = city.audits;
  const sig = list.map((a) => a.id).join(',');
  if (sig === auditSig) return;
  auditSig = sig;
  const el = $('audit-out');
  if (!list.length) {
    el.innerHTML = '<div class="sm-empty">队列空着，等有候选进来。</div>';
    return;
  }
  el.innerHTML = list
    .map((a) => {
      const who = a.rec ? a.rec.name : '无名创作者';
      const n = a.rec ? a.rec.followers : 0;
      const fans = n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);
      return (
        '<div class="au"><div class="au-n">' + who + '</div>' +
        '<div class="au-m">' + fans + ' 粉 · 质量 ' + a.quality.toFixed(2) + ' · 匹配 ' + a.match.toFixed(2) + '</div>' +
        '<div class="au-b"><button data-ok="' + a.id + '">放行</button>' +
        '<button class="no" data-no="' + a.id + '">限流</button></div></div>'
      );
    })
    .join('');
}

$('audit-out').addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  const ok = t.getAttribute('data-ok');
  const no = t.getAttribute('data-no');
  if (ok) city.judgeAudit(ok, false);
  if (no) city.judgeAudit(no, true);
  auditSig = '';
  renderAudit();
});

$('sim').querySelector('.sm-h').addEventListener('click', (ev) => {
  ev.currentTarget.parentElement.classList.toggle('collapsed');
});

function resize() {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
  camera.aspect = w / h;
  // 竖屏时同样的 55° 垂直视角只装得下很窄一条，整座城会溢出画面。
  // 按宽高比补偿垂直 fov：横屏保持 55，竖屏放大到最多 78。
  camera.fov = w < h ? Math.min(78, 55 / Math.max(0.55, camera.aspect)) : 55;
  camera.updateProjectionMatrix();
}

// ---------- 主循环 ----------
let prev = performance.now();
let time = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  time += dt;

  resize();

  // 飞行：指数逼近，最后一帧吸附
  if (flying) {
    const k = 1 - Math.exp(-dt * 3.4);
    cur.radius += (goal.radius - cur.radius) * k;
    cur.phi += (goal.phi - cur.phi) * k;
    cur.theta += (goal.theta - cur.theta) * k;
    cur.tx += (goal.tx - cur.tx) * k;
    cur.ty += (goal.ty - cur.ty) * k;
    cur.tz += (goal.tz - cur.tz) * k;
    const near =
      Math.abs(goal.radius - cur.radius) < 0.05 &&
      Math.abs(goal.theta - cur.theta) < 0.002 &&
      Math.abs(goal.phi - cur.phi) < 0.002 &&
      Math.abs(goal.tx - cur.tx) < 0.02 &&
      Math.abs(goal.tz - cur.tz) < 0.02;
    if (near) {
      Object.assign(cur, goal);
      flying = false;
    }
  }

  // 空闲时极缓慢自转，避免画面像死图
  if (!flying && !down && city.level === 0) {
    cur.theta += dt * 0.035;
    goal.theta = cur.theta;
  }

  // 导演模式：镜头盯着那颗正在走流程的作品
  if (demoFollow) {
    const p = city.demoPos;
    if (p) {
      goal.tx = p.x;
      goal.ty = p.y;
      goal.tz = p.z;
      flying = true;
    }
  }

  placeCamera();
  city.update(dt);

  fdAcc += dt;
  if (fdAcc > 0.5) {
    fdAcc = 0;
    renderFeed();
  }

  auAcc += dt;
  if (auAcc > 0.4) {
    auAcc = 0;
    renderAudit();
  }

  // 屏幕永远正对相机，不然从侧面看就是一条线
  if (city.screen.visible) city.screen.quaternion.copy(camera.quaternion);
  for (const b of city.billboards) b.quaternion.copy(camera.quaternion);

  // 追踪中的那条视频：还没落地就每 0.3 秒刷一次卡片，走完就定格
  if (traced) {
    tokAcc += dt;
    if (tokAcc > 0.3) {
      tokAcc = 0;
      renderTokenCard();
    }
  }

  // 楼牌随风微浮（常朝相机的 sprite 不需要额外朝向处理）
  if (city.level === 1) {
    for (const b of city.blocks[city.focus].buildings) {
      if (b.label.visible) b.label.position.y = b.h + 1.5 + Math.sin(time * 1.8 + b.mesh.position.x) * 0.12;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// 首帧前先把相机摆好，避免开局从原点炸开
placeCamera();
resize();
boot.classList.add('off');
requestAnimationFrame(frame);

// 方便外部（含无头截图）确认渲染成功
window.__cityReady = true;

// ───────────────────────────────────────────────────────────
// 经营者：一回合版
// 逻辑全在 game.js（纯函数、可在 node 里跑通），这里只做两件事：
// 把状态渲染成面板，把手上这几个滑块折成一次决策。
// ───────────────────────────────────────────────────────────
const gmEl = $('game');
let gs = null;
// 决策的默认值：三项均分一半预算，两个倾向居中
const gmD = { sg: 20, sm: 20, ss: 20, algo: 50, ad: 40 };

const SPEND_DEFS = [
  { k: 'sg', nm: '投放拉新', hint: '买用户。见效最快，但会把内容池稀释' },
  { k: 'sm', nm: '审核安全', hint: '压监管风险，代价是创作者会走' },
  { k: 'ss', nm: '生态补贴', hint: '养内容质量与多样性，慢，但决定长期' },
];
const TILT_DEFS = [
  { k: 'algo', nm: '算法倾向', hint: '左 = 偏多样性，右 = 偏爆款（爆款多但同质化）' },
  { k: 'ad', nm: '广告负载', hint: '左 = 干净，右 = 塞满（收入高但用户流失、会累积疲劳）' },
];

const gmBudget = () => (gs ? Game.budgetFor(gs) + (gs.bonus || 0) : 0);
const gmSpent = () => gmD.sg + gmD.sm + gmD.ss;
const gmLeft = () => gmBudget() - gmSpent();

function gmBar(v, max, color) {
  const w = Math.max(0, Math.min(100, (v / max) * 100));
  return `<div class="gm-bar"><i style="width:${w}%;background:${color}"></i></div>`;
}

function renderGmHead() {
  if (!gs) return;
  const q = Math.min(gs.quarter + 1, Game.CONFIG.quarters);
  $('gm-q').textContent = gs.over ? '已结束' : `第 ${q} / ${Game.CONFIG.quarters} 季度`;
  $('gm-bud').textContent = gs.over ? '' : `预算 ${gmBudget()}`;
}

function renderGmStats() {
  if (!gs) return;
  const risk = Math.round(gs.risk);
  const rc = risk > 70 ? '#ff6b81' : risk > 45 ? '#ffd166' : '#7ef0d0';
  $('gm-stats').innerHTML =
    `<div class="gm-stat"><div class="lab"><span>用户</span><b>${gs.users.toFixed(1)} 万</b></div>${gmBar(gs.users, 160, '#22e7ff')}</div>` +
    `<div class="gm-stat"><div class="lab"><span>创作者</span><b>${gs.creators.toFixed(1)} 万</b></div>${gmBar(gs.creators, 24, '#7ef0d0')}</div>` +
    `<div class="gm-stat"><div class="lab"><span>内容质量</span><b>${gs.quality.toFixed(2)}</b></div>${gmBar(gs.quality * 100, 100, '#9ff4ff')}</div>` +
    `<div class="gm-stat"><div class="lab"><span>监管风险</span><b style="color:${rc}">${risk}</b></div>${gmBar(risk, 100, rc)}</div>`;
}

function renderGmLeft() {
  const left = gmLeft();
  const el = $('gm-left');
  el.className = 'gm-left' + (left < 0 ? ' over' : '');
  el.innerHTML = left < 0
    ? `超了 <b>${-left}</b> 点 —— 拿掉一些才能过完这一季`
    : `还能花 <b>${left}</b> 点（共 ${gmBudget()}）`;
  $('gm-go').disabled = left < 0 || !!gs.over;
}

function renderGmControls() {
  $('gm-spend').innerHTML = SPEND_DEFS.map((d) =>
    `<div class="gm-row"><span class="nm" title="${d.hint}">${d.nm}</span>` +
    `<input type="range" min="0" max="60" step="5" value="${gmD[d.k]}" data-k="${d.k}">` +
    `<span class="val">${gmD[d.k]}</span></div>`).join('');
  $('gm-tilt').innerHTML = TILT_DEFS.map((d) =>
    `<div class="gm-row"><span class="nm" title="${d.hint}">${d.nm}</span>` +
    `<input type="range" min="0" max="100" step="5" value="${gmD[d.k]}" data-k="${d.k}">` +
    `<span class="val">${gmD[d.k]}</span></div>`).join('');
  renderGmLeft();
}

function renderGmResult(e) {
  const el = $('gm-res');
  el.hidden = false;
  const d = e.delta;
  const cls = (v) => (v >= 0 ? 'up' : 'dn');
  const fmt = (v, u = '') => (v >= 0 ? '+' : '') + v + u;
  el.innerHTML =
    `<div class="rt">第 ${e.quarter} 季度结束 · 花了 ${e.spend} / ${e.budget} 点</div>` +
    `<div class="d"><span>用户</span><b class="${cls(d.users)}">${fmt(d.users, ' 万')}</b><span>→ ${e.after.users} 万</span></div>` +
    `<div class="d"><span>创作者</span><b class="${cls(d.creators)}">${fmt(d.creators, ' 万')}</b><span>→ ${e.after.creators} 万</span></div>` +
    `<div class="d"><span>监管风险</span><b class="${cls(-d.risk)}">${fmt(d.risk)}</b><span>→ ${e.after.risk}</span></div>` +
    `<div class="d"><span>本季收入</span><b>${e.after.revenue} 万</b><span></span></div>`;
  const ev = $('gm-ev');
  if (e.event) {
    ev.className = 'gm-ev';
    ev.innerHTML = `<b>${e.event.name}</b> — ${e.event.text}`;
  } else {
    ev.className = 'gm-ev quiet';
    ev.textContent = '这一季度没出什么大事。';
  }
}

function renderGmOver() {
  const r = Game.rating(gs);
  const over = $('gm-over');
  over.hidden = false;
  $('gm-foot').hidden = true;
  const bad = r.grade === 'F';
  over.innerHTML =
    `<div class="gm-grade${bad ? ' bad' : ''}">${r.grade}</div>` +
    `<div class="gm-score">SCORE ${r.score}</div>` +
    (bad && gs.loseReason ? `<div class="reason">${gs.loseReason}</div>` : '') +
    `<ul class="lines">${r.lines.map((l) => `<li>${l}</li>`).join('')}</ul>` +
    `<button class="gm-btn" id="gm-again">再来一局</button>`;
  $('gm-again').onclick = () => startGame();
}

function renderGmHistory() {
  if (!gs) return;
  $('gm-hist').innerHTML = gs.history.map((h) =>
    `Q${h.quarter} · 花 ${h.spend} · 用户 ${h.after.users} 万 · 创作者 ${h.after.creators} 万 · 风险 ${h.after.risk}` +
    (h.event ? ` · ${h.event.name}` : '')).join('<br>');
}

function startGame() {
  gs = Game.newGame(Date.now());
  gmD.sg = 20; gmD.sm = 20; gmD.ss = 20; gmD.algo = 50; gmD.ad = 40;
  $('gm-res').hidden = true;
  $('gm-over').hidden = true;
  $('gm-foot').hidden = false;
  $('gm-hist').innerHTML = '';
  $('gm-ev').className = 'gm-ev quiet';
  $('gm-ev').textContent = '还没开始。先决定这 60 点怎么花。';
  gmEl.classList.add('on');
  renderGmHead();
  renderGmStats();
  renderGmControls();
}

function gmSettle() {
  if (!gs || gs.over || gmLeft() < 0) return;
  const entry = Game.settleQuarter(gs, {
    spendGrowth: gmD.sg, spendMod: gmD.sm, spendSubsidy: gmD.ss,
    algoTilt: gmD.algo, adLoad: gmD.ad,
  });
  renderGmResult(entry);
  renderGmHistory();
  renderGmHead();
  if (gs.over) {
    renderGmStats();
    renderGmOver();
  } else {
    // 下一季的默认分配：按新预算的 1/3 均分，玩家再调
    const nb = gmBudget();
    gmD.sg = Math.min(20, nb); gmD.sm = Math.min(20, nb); gmD.ss = Math.min(20, nb);
    renderGmStats();
    renderGmControls();
  }
}

$('start-game').onclick = () => startGame();
$('gm-x').onclick = () => gmEl.classList.remove('on');
$('gm-go').onclick = () => gmSettle();
// 委托：拖动时只改那一个数字，不重建 DOM（否则滑块会跳回去）
gmEl.addEventListener('input', (e) => {
  const k = e.target && e.target.dataset && e.target.dataset.k;
  if (!k) return;
  gmD[k] = Number(e.target.value);
  const row = e.target.closest('.gm-row');
  if (row) {
    const val = row.querySelector('.val');
    if (val) val.textContent = gmD[k];
  }
  renderGmLeft();
});
