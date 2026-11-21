// city.js —— 把短视频生态搭成一座城
// 原则：具象优先。楼高=粉丝，街区=垂类，塔=推荐，橙管=钱，粒子=观众。
// 全景层只挂街区牌（4 个），进街区才挂楼牌 —— 标签数量是「看得懂」的关键。

import * as THREE from './vendor/three.module.min.js';

const BLOCK_R = 26;
const GROUND_R = 48;

export const BLOCKS = [
  { id: 'food', name: '美食', color: 0xff6b6b, angle: 0.0 },
  { id: 'game', name: '游戏', color: 0x22e7ff, angle: Math.PI / 2 },
  { id: 'face', name: '颜值', color: 0xff2fd0, angle: Math.PI },
  { id: 'know', name: '知识', color: 0xffd166, angle: Math.PI * 1.5 },
];

const FIRST = ['阿', '小', '老', '大', '甜', '冷', '野', '软', '响', '慢'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 文字贴图：常朝相机的悬空标牌 ----------
const LABEL_FONT = (fs) => `600 ${fs}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;

function paintLabel(text, hex) {
  const PAD = 16;
  const FS = 46;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = LABEL_FONT(FS);
  const tw = Math.ceil(probe.measureText(text).width);
  const w = tw + PAD * 2;
  const h = FS + PAD * 2;

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(4,10,16,0.84)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = hex;
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, w - 3, h - 3);
  g.font = LABEL_FONT(FS);
  g.textBaseline = 'middle';
  g.fillStyle = hex;
  g.fillText(text, PAD, h / 2 + 2);
  return { cv, w, h };
}

function makeLabel(text, hex, worldHeight = 2.1) {
  const { cv, w, h } = paintLabel(text, hex);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set((w / h) * worldHeight, worldHeight, 1);
  spr.renderOrder = 20;
  return spr;
}

// 车间人数每帧都变，标签要能改字：重画 canvas、换贴图、丢掉旧图
function setLabelText(spr, text, hex, worldHeight) {
  const old = spr.material.map;
  const { cv, w, h } = paintLabel(text, hex);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  spr.material.map = tex;
  spr.material.needsUpdate = true;
  if (worldHeight) spr.scale.set((w / h) * worldHeight, worldHeight, 1);
  if (old) old.dispose();
}

const hexOf = (c) => '#' + c.toString(16).padStart(6, '0');

export function createCity(scene) {
  const rand = rng(20261116);
  const group = new THREE.Group();
  scene.add(group);

  scene.background = new THREE.Color(0x04080d);
  scene.fog = new THREE.FogExp2(0x04080d, 0.0055);

  // ---------- 灯 ----------
  scene.add(new THREE.HemisphereLight(0x2b6b86, 0x05080c, 1.15));
  const key = new THREE.DirectionalLight(0x9fd8ff, 1.05);
  key.position.set(40, 70, 30);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff2fd0, 0.55);
  rim.position.set(-50, 30, -40);
  scene.add(rim);

  // ---------- 地面 ----------
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(GROUND_R, 96),
    new THREE.MeshStandardMaterial({ color: 0x0a131b, roughness: 0.92, metalness: 0.08 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.userData.pick = 'ground';
  group.add(ground);

  const grid = new THREE.GridHelper(GROUND_R * 2, 24, 0x123344, 0x0d2230);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  group.add(grid);

  // ---------- 中央塔：推荐系统 ----------
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x0d3a48,
    emissive: 0x22e7ff,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.6,
  });
  // 中心细轴 = 输送带
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 23.5, 10, 1, false), towerMat);
  tower.position.y = 11.75;
  tower.userData.pick = 'tower';
  group.add(tower);

  // 漏斗外壳：越往上越窄，本身就是「被筛掉」的隐喻
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 6.2, 20.5, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x22e7ff,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  funnel.position.y = 11.2;
  group.add(funnel);

  // ---------- 塔内四车间：召回 → 粗排 → 精排 → 重排 ----------
  // 环半径递减 = 越往上越窄 = 人越来越少。这比任何文字都直观。
  const LAYERS = [
    { key: 'recall', name: '召回', y: 4.6, r: 5.35, keep: 1.0, color: 0x22e7ff },
    { key: 'coarse', name: '粗排', y: 9.4, r: 4.42, keep: 0.45, color: 0x5ac8fa },
    { key: 'fine', name: '精排', y: 14.2, r: 3.5, keep: 0.4, color: 0xffd166 },
    { key: 'rerank', name: '重排', y: 19.0, r: 2.6, keep: 0.58, color: 0xff2fd0 },
  ];
  const stageStats = LAYERS.map(() => ({ rate: 0.5 }));
  const stageLabels = [];

  for (const L of LAYERS) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(L.r, 0.055, 8, 64),
      new THREE.MeshBasicMaterial({ color: L.color, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = L.y;
    group.add(ring);

    const disc = new THREE.Mesh(
      new THREE.RingGeometry(L.r - 0.95, L.r + 0.06, 48),
      new THREE.MeshBasicMaterial({
        color: L.color,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = L.y;
    group.add(disc);

    const lab = makeLabel(L.name, hexOf(L.color), 1.15);
    lab.position.set(L.r + 2.1, L.y + 0.15, 0);
    group.add(lab);
    stageLabels.push(lab);
  }

  // 流水线上的「视频」：小八面体，逐层往上，掉队就坠地
  const TOKEN_N = 72;
  const tokenGeo = new THREE.OctahedronGeometry(0.17, 0);
  // ---------- 可调参数：改一个，整座城的判定逻辑都跟着变 ----------
  // 这些数字不是装饰。每一个都真的进判定公式，拖完能看见漏斗形状、爆款数量、
  // 被限流的号数量跟着动 —— 这是这座城从「看得懂」变成「能试」的那一步。
  const tuning = {
    wComplete: 1.0, // 完播权重：质量项乘数，越大越奖励「被看完」
    freshness: 1.0, // 时效：活跃的号加成，越大越照顾「刚发的」
    coldStart: 1.0, // 冷启动额度：粗排这一层对新内容的照顾力度
    modThreshold: 1.0, // 限流阈值：越小越严，更多高粉低完播的号被扫
    promoPower: 1.0, // 投放强度：广告主给被投街区的加权力度
    mcnRate: 1.0, // MCN 覆盖率：签约比例 = 30% × 这个系数
  };

  const TUNING_DEFS = [
    { key: 'wComplete', label: '完播权重', min: 0.2, max: 2, step: 0.05 },
    { key: 'freshness', label: '时效权重', min: 0, max: 2, step: 0.05 },
    { key: 'coldStart', label: '冷启动额度', min: 0.2, max: 2, step: 0.05 },
    { key: 'modThreshold', label: '限流阈值', min: 0.4, max: 2, step: 0.05 },
    { key: 'promoPower', label: '投放强度', min: 0, max: 2, step: 0.05 },
    { key: 'mcnRate', label: 'MCN 覆盖', min: 0, max: 3, step: 0.1 },
  ];

  function getTuning() {
    return { ...tuning };
  }

  function setTuning(patch) {
    if (!patch || typeof patch !== 'object') return getTuning();
    let reSign = false;
    for (const def of TUNING_DEFS) {
      const v = patch[def.key];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      tuning[def.key] = Math.min(def.max, Math.max(def.min, v));
      if (def.key === 'mcnRate') reSign = true;
    }
    if (reSign) applySigned();
    return getTuning();
  }

  // 判定概率：四层漏斗、重排、单条演示三处共用这一份，参数才有统一含义
  function odds(layer, quality, match, bi) {
    const L = LAYERS[layer];
    if (!L || layer === 0) return 1;
    const boost = bi >= 0 && bi === promo.bi ? 1 + 0.4 * tuning.promoPower : 1;
    const cold = layer === 1 ? 1 + 0.5 * (tuning.coldStart - 1) : 1;
    const fresh = 1 + 0.4 * (tuning.freshness - 1);
    return Math.min(
      0.95,
      L.keep *
        (0.3 + 0.95 * quality * tuning.wComplete) *
        (0.55 + 0.8 * match) *
        boost *
        cold *
        fresh,
    );
  }

  const tokens = [];
  for (let i = 0; i < TOKEN_N; i++) {
    const mesh = new THREE.Mesh(tokenGeo, new THREE.MeshBasicMaterial({ color: 0x22e7ff }));
    mesh.visible = false;
    group.add(mesh);
    tokens.push({
      mesh,
      state: 'idle',
      layer: 0,
      t: 0,
      a: 0,
      vy: 0,
      bi: 0,
      quality: 0,
      match: 0,
      hist: [],
      end: '',
    });
  }
  let spawnAcc = 0;
  let labelAcc = 0;

  function spawnToken() {
    const tk = tokens.find((x) => x.state === 'idle');
    if (!tk) return;
    tk.state = 'run';
    tk.layer = 0;
    tk.t = 0;
    tk.a = Math.random() * Math.PI * 2;
    tk.bi = Math.floor(Math.random() * blocks.length);
    const pool = blocks[tk.bi].buildings;
    tk.rec = pool[Math.floor(Math.random() * pool.length)];
    tk.mesh.material.color.setHex(BLOCKS[tk.bi].color);
    tk.mesh.visible = true;
    tk.mesh.scale.setScalar(1);
    // 每条视频自带两个属性：内容质量、与当前受众的匹配度。
    // 它们决定每一道车间的通过概率 —— 点开就能看见「它为什么没过」。
    tk.quality = Math.random();
    tk.match = Math.random();
    tk.hist = [];
    tk.end = '';
    // 这是新的一条，别继承上一条的审核判决；留着待判队列里的人也被作废。
    tk.auditBias = 0;
    for (let i = audits.length - 1; i >= 0; i--) {
      if (audits[i].tk === tk) audits.splice(i, 1);
    }
    return tk;
  }

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.1, 2),
    new THREE.MeshStandardMaterial({ color: 0x22e7ff, emissive: 0x22e7ff, emissiveIntensity: 2.2 }),
  );
  core.position.y = 24.5;
  group.add(core);

  const coreLight = new THREE.PointLight(0x22e7ff, 60, 60, 2);
  coreLight.position.y = 24.5;
  group.add(coreLight);

  const towerLabel = makeLabel('推荐枢纽', '#22e7ff', 2.6);
  towerLabel.position.set(0, 30.5, 0);
  group.add(towerLabel);

  // ---------- 街区 ----------
  const blocks = [];
  const buildings = [];
  const corpuscles = [];
  const moneyLines = [];

  for (let bi = 0; bi < BLOCKS.length; bi++) {
    const def = BLOCKS[bi];
    const cx = Math.cos(def.angle) * BLOCK_R;
    const cz = Math.sin(def.angle) * BLOCK_R;
    const hex = hexOf(def.color);

    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(9.4, 48),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.color).multiplyScalar(0.12),
        emissive: new THREE.Color(def.color).multiplyScalar(0.5),
        emissiveIntensity: 0.22,
        roughness: 0.85,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.04, cz);
    pad.userData.pick = 'block';
    pad.userData.block = bi;
    group.add(pad);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(9.2, 9.7, 64),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.06, cz);
    group.add(ring);

    const plate = makeLabel(def.name, hex, 3.2);
    plate.position.set(cx, 13.5, cz);
    group.add(plate);

    // 楼：粉丝越多越高
    const N = 14;
    const list = [];
    for (let i = 0; i < N; i++) {
      const a = rand() * Math.PI * 2;
      const r = 1.6 + Math.sqrt(rand()) * 6.4;
      const bx = cx + Math.cos(a) * r;
      const bz = cz + Math.sin(a) * r;
      const followers = Math.round(600 * Math.pow(18, rand() * rand()));
      const h = 1.8 + Math.log2(1 + followers) * 0.62;
      const w = 1.05 + rand() * 0.6;
      const d = 1.05 + rand() * 0.6;

      const lit = rand() > 0.12;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x101d28,
        emissive: new THREE.Color(def.color).multiplyScalar(lit ? 0.75 : 0.18),
        emissiveIntensity: lit ? 0.55 : 0.14,
        roughness: 0.55,
        metalness: 0.35,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(bx, h / 2, bz);
      mesh.userData.pick = 'building';
      mesh.userData.block = bi;
      mesh.userData.index = buildings.length;
      group.add(mesh);

      const name = FIRST[Math.floor(rand() * FIRST.length)] + [['大快朵颐', '艾草', '林间', '麦麦'], ['开黑', '菜就多练', '一命', '速通'], ['颜汐', '子衿', '南风', '白桃'], ['硬核', '三分钟', '一页', '拆解']][bi][Math.floor(rand() * 4)];

      const label = makeLabel(`${name} ${fmt(followers)}`, hex, 1.25);
      label.position.set(bx, h + 1.5, bz);
      label.visible = false;
      group.add(label);

      // 楼顶灯带 = 完播率：绿=有人看完，黄=一般，红=划走
      // 楼的外形从此有含义：高矮=粉丝，灯光=受欢迎程度
      const comp = 0.18 + rand() * 0.62;
      const bandColor = comp > 0.55 ? 0x7ef0d0 : comp > 0.36 ? 0xffd166 : 0xff4d6d;
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(w, d) * 0.56, 0.035, 6, 18),
        new THREE.MeshBasicMaterial({ color: bandColor, transparent: true, opacity: 0.92 }),
      );
      band.rotation.x = -Math.PI / 2;
      band.position.set(bx, h + 0.06, bz);
      group.add(band);

      // 头部账号：楼顶立天线。越大的号天线越高，远处一眼能挑出来
      if (followers > 9000) {
        const mast = new THREE.Mesh(
          new THREE.CylinderGeometry(0.028, 0.028, 1.1 + Math.log2(followers / 9000) * 1.4, 5),
          new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.72 }),
        );
        mast.position.set(bx, h + 0.75, bz);
        group.add(mast);
      }

      const rec = {
        mesh, label, block: bi, followers, name, h, w, d, bx, bz,
        comp, active: 0.25 + rand() * 0.75, band, bandColor,
        baseEmis: mat.emissiveIntensity,
      };
      list.push(rec);
      buildings.push(rec);
    }

    // 钱流管线：塔基 → 街区
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.2, 0),
      new THREE.Vector3(cx * 0.42, 0.5, cz * 0.42),
      new THREE.Vector3(cx * 0.75, 0.35, cz * 0.75),
      new THREE.Vector3(cx, 0.28, cz),
    ]);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 28, 0.09, 5, false),
      new THREE.MeshStandardMaterial({
        color: 0x3a1a08,
        emissive: 0xffb347,
        emissiveIntensity: 1.35,
        transparent: true,
        opacity: 0.85,
      }),
    );
    group.add(tube);
    moneyLines.push(tube);

    // 观众粒子：沿塔 → 街区的路径往返
    const COUNT = 90;
    const pos = new Float32Array(COUNT * 3);
    const parts = [];
    for (let i = 0; i < COUNT; i++) {
      parts.push({ t: rand(), speed: 0.12 + rand() * 0.2, jitter: (rand() - 0.5) * 5 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: def.color,
        size: 0.34,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    );
    group.add(pts);

    corpuscles.push({ curve, parts, geo, pos, pts });

    blocks.push({ def, cx, cz, plate, pad, buildings: list });
  }

  // ---------- 楼的微观结构：窗户 ----------
  // 一次 InstancedMesh 画全城的窗。窗亮得多 = 这个号还在更新；大片黑窗 = 半死不活。
  const winGeo = new THREE.BoxGeometry(0.13, 0.17, 0.05);
  const WIN_MAX = 2600;
  const wins = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), WIN_MAX);
  wins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();
  const _c = new THREE.Color();
  const _hex = new THREE.Color();
  let winCount = 0;

  for (const b of buildings) {
    _hex.setHex(BLOCKS[b.block].color);
    const rows = Math.max(2, Math.min(7, Math.round(b.h / 1.15)));
    for (let r = 0; r < rows; r++) {
      const y = 0.55 + ((r + 0.5) * (b.h - 1.0)) / rows;
      for (let f = 0; f < 4; f++) {
        for (let c = 0; c < 2; c++) {
          if (winCount >= WIN_MAX) break;
          const off = (c - 0.5) * 0.36;
          if (f === 0) _p.set(b.bx + off, y, b.bz + b.d / 2 + 0.032);
          else if (f === 1) _p.set(b.bx + off, y, b.bz - b.d / 2 - 0.032);
          else if (f === 2) _p.set(b.bx + b.w / 2 + 0.032, y, b.bz + off);
          else _p.set(b.bx - b.w / 2 - 0.032, y, b.bz + off);

          if (rand() < b.active) {
            _c.copy(_hex).multiplyScalar(0.5 + 0.8 * b.active);
          } else {
            _c.setHex(0x0a1620);
          }

          _m4.compose(_p, _q, _s);
          wins.setMatrixAt(winCount, _m4);
          wins.setColorAt(winCount, _c);
          winCount++;
        }
      }
    }
  }
  wins.count = winCount;
  wins.instanceMatrix.needsUpdate = true;
  if (wins.instanceColor) wins.instanceColor.needsUpdate = true;
  group.add(wins);

  // ---------- 关系 1：用户行为 → 平台 ----------
  // 唯一「高频、低亮、向心」的流：几百万次滑动，汇成一层往上涌的雾。
  const BEH_N = 320;
  const behPos = new Float32Array(BEH_N * 3);
  const beh = [];
  for (let i = 0; i < BEH_N; i++) {
    beh.push({ t: rand(), a: rand() * Math.PI * 2, r0: 12 + rand() * 26, sp: 0.16 + rand() * 0.2 });
  }
  const behGeo = new THREE.BufferGeometry();
  behGeo.setAttribute('position', new THREE.BufferAttribute(behPos, 3));
  group.add(
    new THREE.Points(
      behGeo,
      new THREE.PointsMaterial({
        color: 0x2f8fa8,
        size: 0.13,
        transparent: true,
        opacity: 0.5,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    ),
  );

  // ---------- 关系 2：平台 → 用户（曝光）----------
  // 短促、明亮、放射：一颗颗从塔上打出去的子弹。
  const EXP_N = 70;
  const expPos = new Float32Array(EXP_N * 3);
  const exp = [];
  for (let i = 0; i < EXP_N; i++) {
    exp.push({ t: rand(), sp: 0.8 + rand() * 0.7, bi: Math.floor(rand() * 4), lift: rand() * 3 });
  }
  const expGeo = new THREE.BufferGeometry();
  expGeo.setAttribute('position', new THREE.BufferAttribute(expPos, 3));
  group.add(
    new THREE.Points(
      expGeo,
      new THREE.PointsMaterial({
        color: 0x9ff4ff,
        size: 0.2,
        transparent: true,
        opacity: 0.85,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    ),
  );

  // ---------- 关系 3：创作者 → 创作者（跟风）----------
  // 同街区里，小号抄袭/模仿大号的选题。这是唯一「横向」的流，所以用弧线。
  const fanLines = [];
  for (let i = 0; i < 10; i++) {
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x7ef0d0, transparent: true, opacity: 0 }),
    );
    line.frustumCulled = false;
    group.add(line);
    fanLines.push({ line, until: 0 });
  }
  let fanTimer = 0;

  // MCN 在一个街区占得越多，这个街区越像「同一个模子刻的」
  function mcnShare(bi) {
    const pool = buildings.filter((b) => b.block === bi);
    if (!pool.length) return 0;
    return pool.filter((b) => b.signed).length / pool.length;
  }

  function spawnFanLine() {
    const idle = fanLines.find((f) => f.until <= 0);
    if (!idle) return;
    // 跟风的密度跟着 MCN 的覆盖率走：机构扎堆的地方，选题最容易撞车
    const w = blocks.map((_, i) => 1 + mcnShare(i) * 3.2);
    const total = w.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let bi = 0;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) {
        bi = i;
        break;
      }
    }
    const pool = buildings.filter((b) => b.block === bi).sort((a, b) => b.followers - a.followers);
    if (pool.length < 4) return;
    const src = pool[Math.floor(rand() * 3)];
    const dst = pool[3 + Math.floor(rand() * (pool.length - 3))];
    const s = new THREE.Vector3(src.bx, src.h + 0.1, src.bz);
    const e = new THREE.Vector3(dst.bx, dst.h * 0.6, dst.bz);
    const mid = s.clone().add(e).multiplyScalar(0.5);
    mid.y += 3.2 + rand() * 1.6;
    const curve = new THREE.QuadraticBezierCurve3(s, mid, e);
    idle.line.geometry.dispose();
    idle.line.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    idle.line.material.opacity = 0.55;
    idle.until = 1.6;
    // 被模仿的那栋楼亮一下：趋同是「抄的人变多」的结果，不只是连着一条线
    flashes.push({ rec: src, t: 0.7, color: 0x7ef0d0 });
  }

  // ---------- 反馈回路：撞击 / 限流扫描 / 街区清扫 ----------
  // 没有这些，所有流都只是「在动」；有了这些，才看得出「因为发生了什么，所以发生了什么」。
  const wavePool = [];
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    group.add(m);
    wavePool.push(m);
  }
  const waves = [];
  const flashes = [];
  const scans = [];
  const sweeps = [];
  // 被限流的楼：暗下去，再慢慢亮回来
  const dims = [];

  function popWave(x, z, color) {
    const m = wavePool.find((w) => !w.visible);
    if (!m) return;
    m.position.set(x, 0.1, z);
    m.material.color.setHex(color);
    m.material.opacity = 0.75;
    m.scale.setScalar(1);
    m.visible = true;
    waves.push({ mesh: m, t: 0 });
  }

  // 正反馈：视频真打中一栋楼 → 这栋楼亮一下 + 地面气浪。火一次，这个号就记上一笔
  let lastHitLog = 0;
  function onHit(rec) {
    flashes.push({ rec, t: 1, color: BLOCKS[rec.block].color });
    popWave(rec.bx, rec.bz, BLOCKS[rec.block].color);
    // 这条作品落地时，顺手记一笔「谁火了」。两秒内只记一条，不然流水会刷屏
    const nowMs = Date.now();
    if (nowMs - lastHitLog > 2000) {
      lastHitLog = nowMs;
      logEvent(
        `「${blocks[rec.block].def.name}」一条作品跑完全流程，落到 ${fmt(rec.followers)} 粉的号上`,
        'good',
      );
    }
  }

  // 负反馈：审核判定一条内容 → 红环从楼顶扫到楼底，灯带变红
  function scanBuilding(rec) {
    const s = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(rec.w, rec.d) * 0.82, 0.055, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.9 }),
    );
    s.rotation.x = -Math.PI / 2;
    s.position.set(rec.bx, rec.h, rec.bz);
    group.add(s);
    scans.push({ mesh: s, rec, t: 0 });
    rec.band.userData.red = true;
    rec.band.material.color.setHex(0xff2b45);
    // 被限流不只是戴个红帽子：这个号的「活性」会被压住一段时间，
    // 楼体跟着暗下去，再慢慢亮回来说明处罚结束
    dims.push({ rec, t: 1 });
  }

  // 审核对整个分区来一次：这么大的红环扫过，表示「这一片被重点关照」
  function districtSweep() {
    const bi = Math.floor(rand() * blocks.length);
    const b = blocks[bi];
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1.15, 56),
      new THREE.MeshBasicMaterial({
        color: 0xff4d6d,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(b.cx, 0.13, b.cz);
    group.add(m);
    sweeps.push({ mesh: m, bi, t: 0 });
    for (const rec of b.buildings) rec.band.material.color.setHex(0xff3a52);
    setTimeout(() => {
      for (const rec of b.buildings) {
        if (!rec.band.userData.red) rec.band.material.color.setHex(rec.bandColor);
      }
    }, 1400);
  }

  // ---------- 生态角色：MCN / 广告主 / 审核 / 平台总部 ----------
  // 这些不是装饰：MCN 真签人、广告主真竞价、审核真贴标、总部真在塔基。
  const ROLES = [
    {
      id: 'mcn', name: 'MCN 机构', color: 0x7ef0d0, angle: Math.PI * 0.25,
      desc: '批量签约创作者，代投流、代谈商单。它签下的楼会亮一条绿线，出片更勤。',
    },
    {
      id: 'ads', name: '广告主', color: 0xffb347, angle: Math.PI * 0.75,
      desc: '在街区入口竞价买曝光位。出价越高，牌子越亮；预算烧完就换下一家。',
    },
    {
      id: 'mod', name: '审核中心', color: 0xff4d6d, angle: Math.PI * 1.25,
      desc: '绕城巡逻，把「曝光高但完播低」的楼顶插上红标，等于限流。',
    },
    {
      id: 'hq', name: '平台总部', color: 0x22e7ff, angle: Math.PI * 1.75,
      desc: '紧贴塔基。调推荐参数、定规则、发流量补贴，最终决定谁能被看见。',
    },
  ];

  const ROLE_R = 40;
  const roles = [];

  // 广告牌（广告主），会转向相机一侧
  const adBoards = [];
  // 限流红标池
  const flagPool = [];
  // MCN 签约线
  const signLines = [];

  for (let ri = 0; ri < ROLES.length; ri++) {
    const r = ROLES[ri];
    const rx = Math.cos(r.angle) * ROLE_R;
    const rz = Math.sin(r.angle) * ROLE_R;
    const g = new THREE.Group();
    g.position.set(rx, 0, rz);
    g.userData.pick = 'role';
    g.userData.role = ri;
    group.add(g);

    const base = new THREE.Mesh(
      new THREE.CircleGeometry(5.4, 36),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(r.color).multiplyScalar(0.1),
        emissive: new THREE.Color(r.color).multiplyScalar(0.4),
        emissiveIntensity: 0.2,
        roughness: 0.9,
      }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.03;
    base.userData.pick = 'role';
    base.userData.role = ri;
    g.add(base);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0e1a24,
      emissive: new THREE.Color(r.color),
      emissiveIntensity: 0.3,
      roughness: 0.45,
      metalness: 0.5,
    });

    const pickable = (m) => {
      m.userData.pick = 'role';
      m.userData.role = ri;
      return m;
    };

    if (r.id === 'mcn') {
      // 三层退台写字楼 + 楼顶天线
      for (let k = 0; k < 3; k++) {
        const w = 4.6 - k * 1.1;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4.2, w), bodyMat);
        m.position.y = 2.1 + k * 4.2;
        g.add(pickable(m));
      }
      for (let k = 0; k < 4; k++) {
        const ant = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 3.2, 4),
          new THREE.MeshBasicMaterial({ color: r.color }),
        );
        ant.position.set(-1.4 + k * 0.95, 15.2, 0);
        g.add(ant);
      }
    } else if (r.id === 'ads') {
      // 广告楼 + 顶部可转的广告牌
      const m = new THREE.Mesh(new THREE.BoxGeometry(5.4, 9, 4.2), bodyMat);
      m.position.y = 4.5;
      g.add(pickable(m));
      for (let k = 0; k < 3; k++) {
        const boardMat = new THREE.MeshBasicMaterial({
          color: r.color,
          transparent: true,
          opacity: 0.2 + k * 0.24,
          side: THREE.DoubleSide,
        });
        const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.2), boardMat);
        board.position.y = 6 + k * 4.6;
        board.rotation.y = (k * Math.PI) / 3;
        g.add(board);
        adBoards.push(board);
      }
    } else if (r.id === 'mod') {
      // 低矮的暗色方楼 + 楼顶塔灯
      const m = new THREE.Mesh(new THREE.BoxGeometry(6.2, 5.2, 6.2), bodyMat);
      m.position.y = 2.6;
      g.add(pickable(m));
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 12, 12),
        new THREE.MeshBasicMaterial({ color: r.color }),
      );
      lamp.position.y = 6.2;
      lamp.name = 'modLamp';
      g.add(lamp);
      const lp = new THREE.PointLight(r.color, 18, 26, 2);
      lp.position.y = 6.4;
      g.add(lp);
    } else {
      // 平台总部：扁而宽，贴在塔基方向
      const m = new THREE.Mesh(new THREE.BoxGeometry(8.4, 5.6, 6.6), bodyMat);
      m.position.y = 2.8;
      g.add(pickable(m));
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(8.5, 1.6, 6.7),
        new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: 0.34 }),
      );
      glass.position.y = 3.6;
      g.add(glass);
    }

    const label = makeLabel(r.name, hexOf(r.color), 1.9);
    label.position.set(0, 17.5, 0);
    g.add(label);

    const pick3d = new THREE.Vector3(rx, 0, rz);
    roles.push({ ...r, group: g, label, pos: pick3d });
  }

  // ---------- MCN 真的签人：覆盖率由参数面板控制，可以重签 ----------
  const signed = [];

  function applySigned() {
    // 旧的绿线与光环先拆掉，否则拖一次滑块就多一层
    for (const line of signLines) {
      group.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    signLines.length = 0;
    for (const b of buildings) {
      if (b.halo) {
        group.remove(b.halo);
        b.halo.geometry.dispose();
        b.halo.material.dispose();
        b.halo = null;
      }
      b.signed = false;
    }
    signed.length = 0;

    const rate = Math.min(0.9, Math.max(0, 0.3 * tuning.mcnRate));
    for (const b of buildings) {
      if (rand() >= rate) continue;
      b.signed = true;
      signed.push(b);

      const from = new THREE.Vector3(roles[0].pos.x, 12, roles[0].pos.z);
      const to = b.mesh.position.clone().setY(b.h * 0.75);
      const mid = from.clone().lerp(to, 0.5).setY(from.y * 0.35 + 6);
      const curve = new THREE.CatmullRomCurve3([from, mid, to]);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)),
        new THREE.LineBasicMaterial({ color: 0x7ef0d0, transparent: true, opacity: 0.22 }),
      );
      group.add(line);
      signLines.push(line);

      // 签约 = 保底流量。楼底加一圈绿环，周期性地向上涌 —— MCN 给的资源是看得见的
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.06, 24),
        new THREE.MeshBasicMaterial({
          color: 0x7ef0d0,
          transparent: true,
          opacity: 0.32,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(b.bx, 0.1, b.bz);
      group.add(halo);
      b.halo = halo;
    }
  }

  applySigned();

  // ---------- 审核红标池 ----------
  for (let i = 0; i < 10; i++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 1.1, 4),
      new THREE.MeshBasicMaterial({ color: 0xff4d6d }),
    );
    cone.visible = false;
    group.add(cone);
    flagPool.push(cone);
  }

  // ---------- 广告主投放：钱进来，规则就歪一点 ----------
  // 金主不会平等地爱所有人。它按「哪片最近出效果」轮着投，
  // 光束从广告楼顶斜插到漏斗的精排层，落地处一圈金环。
  // 被投的街区，同样的质量与匹配会拿到更高的胜率（见 token 判定里的 boost）。
  const adsRole = roles.find((r) => r.id === 'ads') || roles[0];
  const promo = { bi: 0, timer: 0, name: '' };

  const promoRing = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.9, 44),
    new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  promoRing.rotation.x = -Math.PI / 2;
  group.add(promoRing);

  const promoMat = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const promoTube = new THREE.Mesh(new THREE.BufferGeometry(), promoMat);
  group.add(promoTube);

  function setPromo(bi) {
    promo.bi = bi;
    promo.name = BLOCKS[bi].name;
    logEvent(`广告主把预算转投「${BLOCKS[bi].name}」，这一区曝光加权 ×1.4`, 'warn');
    const b = blocks[bi];
    promoRing.position.set(b.cx, 0.14, b.cz);
    const from = new THREE.Vector3(adsRole.pos.x, 9.6, adsRole.pos.z);
    const L9 = LAYERS[2];
    const ang = Math.atan2(b.cz, b.cx);
    const to = new THREE.Vector3(
      Math.cos(ang) * L9.r * 0.8,
      L9.y,
      Math.sin(ang) * L9.r * 0.8,
    );
    const mid = from.clone().lerp(to, 0.5).setY(19);
    const curve = new THREE.CatmullRomCurve3([from, mid, to]);
    promoTube.geometry.dispose();
    promoTube.geometry = new THREE.TubeGeometry(curve, 18, 0.075, 6, false);
  }
  // ---------- 城里的流水：发生过的事要留得下 ----------
  // 画面一眨眼就过去了，可「为什么这条火了」往往要回头看三次才明白。
  // 它必须定义在 setPromo 之前 —— setPromo 初始化时就会记一笔。
  const feed = [];
  function logEvent(text, tone) {
    feed.push({ text, tone: tone || 'n', t: Date.now() });
    if (feed.length > 40) feed.shift();
  }

  setPromo(0);
  promo.pick = () => setPromo((promo.bi + 1 + Math.floor(rand() * 2)) % blocks.length);

  // ---------- 地下的通道：真正的连接在看不见的地方 ----------
  // 地上跑的是内容和人，地下跑的是数据回流、结算、内容分发。
  // 三条管线各有颜色与速度：都是「连接」，但连的不是同一件事。
  const ducts = [];
  const ductDefs = [
    { color: 0x2f8fa8, y: -0.85, speed: 0.05 },
    { color: 0xffb347, y: -0.6, speed: 0.038 },
    { color: 0x7ef0d0, y: -0.35, speed: 0.068 },
  ];
  for (const d of ductDefs) {
    const pts = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const nb = blocks[(i + 1) % blocks.length];
      pts.push(new THREE.Vector3(b.cx * 0.32, d.y - 0.45, b.cz * 0.32));
      pts.push(new THREE.Vector3(b.cx * 0.82, d.y, b.cz * 0.82));
      pts.push(
        new THREE.Vector3((b.cx + nb.cx) * 0.5, d.y - 0.22, (b.cz + nb.cz) * 0.5),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 140, 0.07, 6, true),
      new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.26 }),
    );
    group.add(tube);
    const beads = [];
    for (let k = 0; k < 14; k++) {
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 6, 6),
        new THREE.MeshBasicMaterial({ color: d.color }),
      );
      bead.userData.t = k / 14;
      group.add(bead);
      beads.push(bead);
    }
    ducts.push({ curve, beads, speed: d.speed });
  }

  // ---------- 天上的媒介：业务不只在地上跑 ----------
  // 投放飞行器（金）、监管无人机（红）、热点信使（青）绕着全城转。
  // 它们不接触任何人，但每一台都在替某个角色执行任务。
  const skyMarks = [];
  for (let i = 0; i < 10; i++) {
    const kind = i % 3;
    const color = kind === 0 ? 0xffb347 : kind === 1 ? 0xff4d6d : 0x7ef0d0;
    const geo =
      kind === 0
        ? new THREE.ConeGeometry(0.24, 0.8, 4)
        : kind === 1
          ? new THREE.BoxGeometry(0.55, 0.12, 0.55)
          : new THREE.SphereGeometry(0.15, 8, 8);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    group.add(m);
    skyMarks.push({
      mesh: m,
      a: (i / 10) * Math.PI * 2,
      r: 20 + (i % 4) * 9,
      y: 30 + (i % 3) * 4,
      sp: 0.055 + (i % 5) * 0.017,
      bob: i,
    });
  }

  // ---------- 一块屏幕：把「一条视频」画成能看见的样子 ----------
  // 塔、街区、楼都是抽象；到「一条视频」这一层，必须给出观众认得的那个东西：
  // 竖屏、封面、播放键、数字。这是城市里最小的尺度，也是用户每天真正看的那一层。
  const shotCanvas = document.createElement('canvas');
  shotCanvas.width = 180;
  shotCanvas.height = 320;
  const shotCtx = shotCanvas.getContext('2d');
  const shotTex = new THREE.CanvasTexture(shotCanvas);
  shotTex.colorSpace = THREE.SRGBColorSpace;

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 3.02),
    new THREE.MeshBasicMaterial({
      map: shotTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  screen.visible = false;
  screen.renderOrder = 15;
  group.add(screen);

  let screenTk = null;
  let screenTimer = 0;

  function drawScreen(tk) {
    const c = shotCtx;
    const hex = hexOf(BLOCKS[tk.bi].color);
    const rec = tk.rec || { followers: 0, comp: 0 };
    c.clearRect(0, 0, 180, 320);
    c.fillStyle = '#070d14';
    c.fillRect(0, 0, 180, 320);
    c.globalAlpha = 0.2;
    c.fillStyle = hex;
    c.fillRect(0, 0, 180, 112);
    c.globalAlpha = 1;
    c.fillStyle = hex;
    c.fillRect(0, 0, 180, 3);

    // 播放键
    c.globalAlpha = 0.9;
    c.fillStyle = '#e8f6ff';
    c.beginPath();
    c.moveTo(76, 40);
    c.lineTo(108, 56);
    c.lineTo(76, 72);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;

    c.fillStyle = '#cfe6f2';
    c.font = 'bold 13px sans-serif';
    c.fillText(`${BLOCKS[tk.bi].name} · 一条视频`, 10, 96);

    c.font = '11px sans-serif';
    const rows = [
      ['质量', `${Math.round(tk.quality * 100)}`],
      ['匹配', `${Math.round(tk.match * 100)}`],
      ['完播', `${Math.round((rec.comp || 0) * 100)}%`],
      ['粉丝', `${Math.round(rec.followers || 0)}`],
    ];
    rows.forEach(([k, v], i) => {
      const y = 126 + i * 22;
      c.fillStyle = '#6f8d9e';
      c.fillText(k, 10, y);
      c.fillStyle = '#9ff4ff';
      c.fillText(v, 54, y);
      // 双条
      c.fillStyle = 'rgba(34,231,255,.14)';
      c.fillRect(92, y - 8, 72, 5);
      const ratio = k === '粉丝' ? Math.min(1, (rec.followers || 0) / 20000) : Number(v) / 100;
      c.fillStyle = hex;
      c.fillRect(92, y - 8, 72 * Math.max(0.02, Math.min(1, ratio)), 5);
    });

    // 四层履历
    c.fillStyle = '#4f6b7a';
    c.font = '10px sans-serif';
    c.fillText('漏斗履历', 10, 226);
    for (let i = 0; i < 4; i++) {
      const y = 242 + i * 16;
      const h = (tk.hist || [])[i];
      c.fillStyle = '#5f7a8c';
      c.fillText(`${['召回', '粗排', '精排', '重排'][i]}`, 10, y);
      if (h) {
        c.fillStyle = h.pass ? '#7ef0d0' : '#ff4d6d';
        c.fillText(h.pass ? '过' : '淘汰', 52, y);
        c.fillStyle = 'rgba(143,182,200,.55)';
        c.fillText(`${Math.round(h.p * 100)}%`, 92, y);
      } else {
        c.fillStyle = '#33414b';
        c.fillText('—', 52, y);
      }
    }

    c.strokeStyle = 'rgba(34,231,255,.28)';
    c.strokeRect(0.5, 0.5, 179, 319);
  }

  function showScreen(tk) {
    screenTk = tk;
    screenTimer = 0;
    if (!tk) {
      screen.visible = false;
      return;
    }
    screen.position.set(tk.mesh.position.x, tk.mesh.position.y + 1.7, tk.mesh.position.z);
    drawScreen(tk);
    shotTex.needsUpdate = true;
    screen.visible = true;
  }

  // ---------- 楼内部：放大到「一栋楼」时，看它里面怎么干活 ----------
  // 一栋楼不是一个方块，是一个小作坊：有选题来源（可能是抄的）、
  // 有排队待发的东西、有一块天天盯的数据屏。到这一层，
  // 「生态」才落地成「某个人的一天」——这才是微观该有的东西。
  const focusGroup = new THREE.Group();
  focusGroup.visible = false;
  group.add(focusGroup);
  const billboards = [];
  let focused = null;

  function drawStats(c, rec) {
    c.clearRect(0, 0, 220, 150);
    c.fillStyle = 'rgba(6,14,20,.88)';
    c.fillRect(0, 0, 220, 150);
    c.strokeStyle = 'rgba(34,231,255,.35)';
    c.strokeRect(0.5, 0.5, 219, 149);
    c.fillStyle = '#9ff4ff';
    c.font = 'bold 12px sans-serif';
    c.fillText('近 7 天播放', 10, 20);
    let prev = 0.55;
    for (let i = 0; i < 7; i++) {
      const v = Math.max(0.08, Math.min(1, prev + (rand() - 0.45) * 0.34));
      prev = v;
      const bh = v * 84;
      c.fillStyle = v > 0.66 ? 'rgba(126,240,208,.85)' : 'rgba(34,231,255,.55)';
      c.fillRect(12 + i * 29, 118 - bh, 18, bh);
    }
    c.fillStyle = '#5f7a8c';
    c.font = '10px sans-serif';
    c.fillText('完播', 12, 138);
    c.fillStyle = '#7ef0d0';
    c.fillText(`${Math.round((rec.comp || 0) * 100)}%`, 44, 138);
    c.fillStyle = '#5f7a8c';
    c.fillText('粉丝', 108, 138);
    c.fillStyle = '#9ff4ff';
    c.fillText(`${Math.round(rec.followers || 0)}`, 140, 138);
  }

  function focusBuilding(rec) {
    clearFocus();
    if (!rec) return;
    focused = rec;
    rec.mesh.material.transparent = true;
    rec.mesh.material.opacity = 0.14;
    focusGroup.visible = true;
    // 进楼第一件事：把所有楼牌收起来。名字是挂在楼外面的大字号 canvas，
    // 留着会正好糊在里面那几层结构上 —— 微观层要先看得见结构，再谈名字。
    for (const b of buildings) b.label.visible = false;

    const { bx, bz, h, w, d } = rec;
    const hex = BLOCKS[rec.block].color;

    // 三层楼板：把楼分成「选题 / 制作 / 发布」
    for (let i = 0; i < 3; i++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.86, 0.05, d * 0.86),
        new THREE.MeshBasicMaterial({ color: 0x1b3d4f, transparent: true, opacity: 0.9 }),
      );
      slab.position.set(bx, h * (0.26 + i * 0.25), bz);
      focusGroup.add(slab);
    }

    // 发布队列：四个待发的方块，最上面那个马上要进漏斗
    for (let i = 0; i < 4; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.3, 0.3),
        new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.92 }),
      );
      box.position.set(bx, h * 0.3 + i * 0.4, bz);
      box.userData.queue = i;
      box.userData.pick = 'queue';
      focusGroup.add(box);
    }

    // 数据屏：浮在楼顶上方，永远朝相机 —— 放侧面会被楼自己挡住
    const dc = document.createElement('canvas');
    dc.width = 220;
    dc.height = 150;
    drawStats(dc.getContext('2d'), rec);
    const dtex = new THREE.CanvasTexture(dc);
    dtex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.78),
      new THREE.MeshBasicMaterial({ map: dtex, transparent: true, depthWrite: false }),
    );
    panel.position.set(bx, h + 1.5, bz);
    panel.renderOrder = 14;
    focusGroup.add(panel);
    billboards.push(panel);

    // 选题来源：从楼顶拉一条线到同街区另一栋楼 —— 这条是抄的
    const peers = blocks[rec.block].buildings.filter((b) => b !== rec);
    if (peers.length) {
      const src = peers[Math.floor(rand() * peers.length)];
      const a = new THREE.Vector3(bx, h * 0.92, bz);
      const mid = new THREE.Vector3(
        (bx + src.bx) / 2,
        Math.max(h, src.h) + 2.4,
        (bz + src.bz) / 2,
      );
      const b2 = new THREE.Vector3(src.bx, src.h + 0.5, src.bz);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b2);
      focusGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(20)),
          new THREE.LineBasicMaterial({ color: 0x7ef0d0, transparent: true, opacity: 0.55 }),
        ),
      );
    }
  }

  function clearFocus() {
    if (focused) {
      focused.mesh.material.opacity = 1;
      focused.mesh.material.transparent = false;
      focused = null;
    }
    focusGroup.visible = false;
    billboards.length = 0;
    applyLevel();
    for (let i = focusGroup.children.length - 1; i >= 0; i--) {
      const c = focusGroup.children[i];
      focusGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
  }

  // 点楼里排队的那一块 —— 看这条「还没发出去」的东西长什么样
  function showQueueScreen(i) {
    if (!focused) return;
    const rec = focused;
    const box = focusGroup.children.find((c) => c.userData.queue === i);
    if (!box) return;
    showScreen({
      bi: rec.block,
      quality: 0.35 + rand() * 0.55,
      match: 0.35 + rand() * 0.55,
      rec,
      hist: [],
      state: 'run',
      mesh: box,
    });
  }

  // ---------- LOD：谁看得见 ----------
  let level = 0;
  let focus = -1;

  function applyLevel() {
    for (let bi = 0; bi < blocks.length; bi++) {
      const on = level === 0 || bi === focus;
      blocks[bi].plate.visible = true;
      for (const b of blocks[bi].buildings) b.label.visible = level === 1 && bi === focus;
      // 全景时远处的楼稍暗一点，聚焦街区提亮
      for (const b of blocks[bi].buildings) {
        b.mesh.material.emissiveIntensity = level === 1
          ? (bi === focus ? 0.7 : 0.1)
          : (on ? 0.55 : 0.3);
      }
    }
  }

  function setLevel(n, focusIndex) {
    level = n;
    focus = typeof focusIndex === 'number' ? focusIndex : focus;
    applyLevel();
  }

  // ---------- 每帧 ----------
  const tmpV = new THREE.Vector3();
  let time = 0;
  let modTimer = 0;
  let sweepTimer = 0;
  const flagged = [];

  function update(dt) {
    time += dt;
    core.rotation.y += dt * 0.6;
    core.rotation.x += dt * 0.25;
    core.scale.setScalar(1 + Math.sin(time * 2.2) * 0.06);
    coreLight.intensity = 52 + Math.sin(time * 2.2) * 14;
    towerMat.emissiveIntensity = 0.7 + Math.sin(time * 1.4) * 0.18;

    for (const m of moneyLines) {
      m.material.emissiveIntensity = 1.1 + Math.sin(time * 3) * 0.35;
    }

    for (const c of corpuscles) {
      for (let i = 0; i < c.parts.length; i++) {
        const p = c.parts[i];
        // 取模而不是减一：切标签页回来 dt 会很大，减一不够会把 t 推到负数，
        // 曲线取到不存在的点就整页炸掉。
        p.t = (p.t + p.speed * dt) % 1;
        if (p.t < 0) p.t += 1;
        // 去程：塔 → 街区；回程：街区 → 塔（用 t 的一半做方向，另一半表示观众离开）
        const raw = p.t < 0.55 ? p.t / 0.55 : (1 - p.t) / 0.45;
        const tt = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        c.curve.getPoint(tt, tmpV);
        const spread = 1 - tt;
        c.pos[i * 3] = tmpV.x + Math.sin(time * 2 + i) * spread * 2.2;
        c.pos[i * 3 + 1] = tmpV.y + 0.5 + Math.abs(Math.sin(time * 1.6 + i * 0.7)) * 3.2 + p.jitter * 0.06;
        c.pos[i * 3 + 2] = tmpV.z + Math.cos(time * 1.7 + i) * spread * 2.2;
      }
      c.geo.attributes.position.needsUpdate = true;
    }

    // ---------- 流水线：召回 → 粗排 → 精排 → 重排 ----------
    spawnAcc += dt;
    if (spawnAcc > 0.18) {
      spawnAcc = 0;
      const fresh = spawnToken();
      if (fresh) pushAudit(fresh);
    }

    for (const tk of tokens) {
      if (tk.state === 'idle') continue;
      const m = tk.mesh;

      if (tk.state === 'run') {
        const L = LAYERS[tk.layer];
        tk.t += dt / 1.15;
        const ang = tk.a + tk.t * 1.25;
        m.position.set(Math.cos(ang) * L.r, L.y + Math.sin(tk.t * 12) * 0.06, Math.sin(ang) * L.r);
        m.rotation.y += dt * 4;

        if (tk.t >= 1) {
          if (tk.layer === LAYERS.length - 1) {
            const p = odds(tk.layer, tk.quality, tk.match, tk.bi);
            const pass = Math.random() < p;
            tk.hist.push({ layer: tk.layer, p, pass });
            if (pass) {
              stageStats[tk.layer].rate = stageStats[tk.layer].rate * 0.88 + 0.12;
              tk.state = 'shoot';
              tk.t = 0;
              tk.end = 'passed';
            } else {
              stageStats[tk.layer].rate = stageStats[tk.layer].rate * 0.88;
              tk.state = 'fall';
              tk.vy = 0;
              tk.end = 'dropped';
            }
          } else {
            // 召回是「全站粗捞」，理论上全收；后面三层才看质量与匹配。
            // 具体概率由 odds() 算，参数面板改的就是它。
            const p = odds(tk.layer, tk.quality, tk.match, tk.bi);
            const pass = Math.random() < p;
            tk.hist.push({ layer: tk.layer, p, pass });
            stageStats[tk.layer].rate = stageStats[tk.layer].rate * 0.88 + (pass ? 0.12 : 0);
            if (pass) {
              tk.layer++;
              tk.t = 0;
              tk.a = ang;
            } else {
              tk.state = 'fall';
              tk.vy = 0;
              tk.end = 'dropped';
            }
          }
        }
      } else if (tk.state === 'fall') {
        tk.vy -= dt * 26;
        m.position.y += tk.vy * dt;
        m.scale.multiplyScalar(0.972);
        if (m.position.y < 0.15) {
          m.visible = false;
          tk.state = 'idle';
        }
      } else if (tk.state === 'shoot') {
        // 出塔顶 → 飞向目标街区，这就是一次曝光
        tk.t += dt / 0.7;
        const tt = Math.min(1, tk.t);
        const b = blocks[tk.bi];
        m.position.x = b.cx * tt;
        m.position.z = b.cz * tt;
        m.position.y = 22 + (3 - 22) * tt + Math.sin(tt * Math.PI) * 2.4;
        m.scale.setScalar(1.35 * (1 - tt * 0.45));
        if (tk.t >= 1) {
          m.visible = false;
          tk.state = 'idle';
          if (tk.rec) onHit(tk.rec);
        }
      }
    }

    // 行为流：向心上升的雾（用户滑动 → 平台）
    // 其中约四成会在半路「放弃」，竖着飘走 —— 这就是流失
    for (let i = 0; i < BEH_N; i++) {
      const p = beh[i];
      if (p.quit && p.t > p.quitAt) {
        p.t += p.sp * dt * 2.2;
        behPos[i * 3 + 1] += dt * 7;
        if (p.t > 1) {
          p.t = 0;
          p.a = rand() * Math.PI * 2;
          p.r0 = 12 + rand() * 26;
          p.quit = rand() < 0.42;
          p.quitAt = 0.3 + rand() * 0.5;
        }
        continue;
      }
      p.t += p.sp * dt;
      if (p.t > 1) {
        p.t = 0;
        p.a = rand() * Math.PI * 2;
        p.r0 = 12 + rand() * 26;
        p.quit = rand() < 0.42;
        p.quitAt = 0.3 + rand() * 0.5;
      }
      const rr = p.r0 * (1 - p.t);
      const aa = p.a + p.t * 1.1;
      behPos[i * 3] = Math.cos(aa) * rr;
      behPos[i * 3 + 1] = 0.15 + p.t * 5.4;
      behPos[i * 3 + 2] = Math.sin(aa) * rr;
    }
    behGeo.attributes.position.needsUpdate = true;

    // 撞击闪光：火了的号亮一下，然后慢慢熄回去
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t -= dt * 1.8;
      if (f.t <= 0) {
        f.rec.mesh.material.emissiveIntensity = f.rec.baseEmis;
        flashes.splice(i, 1);
      } else {
        f.rec.mesh.material.emissiveIntensity = f.rec.baseEmis + f.t * 2.2;
        f.rec.band.material.color.setHex(f.color);
      }
    }

    // 地面气浪
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.t += dt * 1.6;
      w.mesh.scale.setScalar(1 + w.t * 5);
      w.mesh.position.y = 0.1 + w.t * 1.2;
      w.mesh.material.opacity = Math.max(0, 0.75 * (1 - w.t));
      if (w.t >= 1) {
        w.mesh.visible = false;
        waves.splice(i, 1);
      }
    }

    // 限流扫描环
    for (let i = scans.length - 1; i >= 0; i--) {
      const s = scans[i];
      s.t += dt * 0.9;
      s.mesh.position.y = s.rec.h * (1 - s.t);
      s.mesh.material.opacity = Math.max(0, 0.9 * (1 - s.t * 0.6));
      if (s.t >= 1) {
        group.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        scans.splice(i, 1);
      }
    }

    // 被限流的楼：先暗到四分之一，再花十几秒亮回来
    for (let i = dims.length - 1; i >= 0; i--) {
      const d = dims[i];
      d.t -= dt * 0.075;
      if (d.t <= 0) {
        d.rec.mesh.material.emissiveIntensity = d.rec.baseEmis;
        dims.splice(i, 1);
      } else {
        d.rec.mesh.material.emissiveIntensity = d.rec.baseEmis * (0.25 + 0.75 * (1 - d.t));
      }
    }

    // 街区清扫波
    for (let i = sweeps.length - 1; i >= 0; i--) {
      const w = sweeps[i];
      w.t += dt * 0.55;
      w.mesh.scale.setScalar(1 + w.t * 11);
      w.mesh.material.opacity = Math.max(0, 0.55 * (1 - w.t));
      if (w.t >= 1) {
        group.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.mesh.material.dispose();
        sweeps.splice(i, 1);
      }
    }

    // MCN 保底光环：慢脉冲，表示「这家有机构罩着」
    for (const b of buildings) {
      if (b.halo) b.halo.material.opacity = 0.22 + Math.sin(time * 1.8 + b.bx) * 0.14;
    }

    // 聚焦：无关的楼压到一成亮度，只留它和它的关系说话
    if (focusKind) {
      for (const b of buildings) {
        b.mesh.material.emissiveIntensity = b.baseEmis * (focusSet.has(b) ? 1 : 0.08);
      }
    }

    // 曝光流：从塔身向外打出去（平台 → 用户）
    for (let i = 0; i < EXP_N; i++) {
      const p = exp[i];
      p.t += p.sp * dt;
      if (p.t > 1) {
        p.t = 0;
        p.bi = Math.floor(rand() * 4);
        p.lift = rand() * 3;
      }
      const b = blocks[p.bi];
      expPos[i * 3] = b.cx * p.t;
      expPos[i * 3 + 1] = 20 - 16.5 * p.t + Math.sin(p.t * Math.PI) * (2 + p.lift);
      expPos[i * 3 + 2] = b.cz * p.t;
    }
    expGeo.attributes.position.needsUpdate = true;

    // 跟风线：同街区里小号抄大号
    fanTimer += dt;
    if (fanTimer > 0.8) {
      fanTimer = 0;
      spawnFanLine();
    }
    for (const f of fanLines) {
      if (f.until > 0) {
        f.until -= dt;
        f.line.material.opacity = Math.max(0, Math.min(0.55, f.until * 0.35));
      }
    }

    // 每层通过率写回标牌（半秒一次，够看又不烧 CPU）
    labelAcc += dt;
    if (labelAcc > 0.5) {
      labelAcc = 0;
      for (let i = 0; i < LAYERS.length; i++) {
        const L = LAYERS[i];
        const pct = Math.round(stageStats[i].rate * 100);
        setLabelText(stageLabels[i], `${L.name} ${pct}%`, hexOf(L.color), 1.15);
      }
    }

    // 生态角色的小动作
    for (const b of adBoards) b.rotation.y += dt * 0.32;
    const lamp = group.getObjectByName('modLamp');
    if (lamp) lamp.material.color.setHex(Math.sin(time * 4) > 0 ? 0xff4d6d : 0x5a1020);

    modTimer += dt;
    if (modTimer > 15) {
      modTimer = 0;
      flagSomeone();
    }

    // 楼内部：队列最上面那个在脉动（马上就要发出去）
    if (focused) {
      for (const c of focusGroup.children) {
        if (c.userData.queue === 3) c.scale.setScalar(1 + Math.sin(time * 5) * 0.16);
      }
    }

    // 屏幕跟着它那条视频走，每 0.4 秒刷一次数字
    if (screenTk) {
      if (screenTk.state === 'idle' || !screenTk.mesh.visible) {
        showScreen(null);
      } else {
        screen.position.set(
          screenTk.mesh.position.x,
          screenTk.mesh.position.y + 1.7,
          screenTk.mesh.position.z,
        );
        screenTimer += dt;
        if (screenTimer > 0.4) {
          screenTimer = 0;
          drawScreen(screenTk);
          shotTex.needsUpdate = true;
        }
      }
    }

    // 驾驶员 / 广告主投放
    promo.timer += dt;
    if (promo.timer > 20) {
      promo.timer = 0;
      promo.pick();
    }
    promoMat.opacity = 0.26 + Math.sin(time * 2.6) * 0.13;

    // 地下管线里的光点：连接一直在跑，只是看不见在跑什么
    for (const d of ducts) {
      for (const bd of d.beads) {
        bd.userData.t = (bd.userData.t + dt * d.speed) % 1;
        d.curve.getPoint(bd.userData.t, bd.position);
      }
    }

    // 天上的媒介绕城飞
    for (const s of skyMarks) {
      s.a += dt * s.sp;
      s.mesh.position.set(
        Math.cos(s.a) * s.r,
        s.y + Math.sin(time * 0.8 + s.bob) * 0.9,
        Math.sin(s.a) * s.r,
      );
      s.mesh.rotation.y += dt * 1.6;
      s.mesh.rotation.x += dt * 0.7;
    }

    // 投稿演示：一站一站往前走，每站报一次
    if (playing) {
      const P = playing;
      const sdt = demo.paused ? 0 : dt * demo.speed;
      P.t += sdt;
      if (P.stage === 0) {
        const f0 = firstActive();
        const target = P.stops[f0 >= LAYERS.length ? 0 : f0];
        const k = Math.min(1, P.t / P.dur);
        const e = k * k * (3 - 2 * k);
        P.mesh.position.lerpVectors(P.from, target, e);
        if (P.t >= P.dur) {
          if (f0 >= LAYERS.length) {
            P.stage = 5;
            P.dur = 1.4;
          } else {
            P.stage = f0 + 1;
            P.dur = 1.2;
          }
          P.t = 0;
          P.ev({ type: 'enter', layer: 0 });
        }
      } else if (P.stage >= 1 && P.stage <= LAYERS.length) {
        const li = P.stage - 1;
        const L = LAYERS[li];
        const k = Math.min(1, P.t / P.dur);
        const a = 0.9 + li * 1.7 + k * 1.4;
        P.mesh.position.set(
          Math.cos(a) * L.r,
          L.y + Math.sin(k * Math.PI) * 0.5,
          Math.sin(a) * L.r,
        );
        if (P.t >= P.dur) {
          const p = odds(li, P.quality, P.match, typeof P.bi === 'number' ? P.bi : -1);
          const ok = rand() < p;
          P.pass[li] = ok;
          // 召回层必过（它只是把候选人捞出来），不必单独报一步
          if (li > 0) P.ev({ type: ok ? 'pass' : 'drop', layer: li, p });
          P.from.copy(P.mesh.position);
          P.t = 0;
          if (!ok) {
            P.stage = 6;
            P.dur = 1.6;
          } else {
            let nx = li + 1;
            while (nx < LAYERS.length && demo.only.indexOf(nx) < 0) nx++;
            if (nx >= LAYERS.length) {
              P.stage = 5;
              P.dur = 1.4;
            } else {
              P.stage = nx + 1;
              P.dur = 0.85;
            }
          }
        }
      } else if (P.stage === 5) {
        const k = Math.min(1, P.t / P.dur);
        P.mesh.position.lerpVectors(
          P.from,
          new THREE.Vector3(P.rec.bx, P.rec.h + 0.5, P.rec.bz),
          k,
        );
        if (P.t >= P.dur) {
          onHit(P.rec);
          P.ev({ type: 'land', rec: P.rec });
          playing = null;
          group.remove(P.mesh);
          P.mesh.geometry.dispose();
          P.mesh.material.dispose();
        }
      } else if (P.stage === 6) {
        const k = Math.min(1, P.t / P.dur);
        P.mesh.position.copy(P.from);
        P.mesh.position.y -= k * 14;
        P.mesh.material.opacity = 1 - k;
        if (P.t >= P.dur) {
          P.ev({ type: 'dead' });
          playing = null;
          group.remove(P.mesh);
          P.mesh.geometry.dispose();
          P.mesh.material.dispose();
        }
      }
    }
    promoRing.material.opacity = 0.18 + Math.sin(time * 2.6 + 1) * 0.11;
    promoRing.scale.setScalar(1 + Math.sin(time * 1.5) * 0.05);

    // 审核对「整个街区」的动作：一场扫街，整片灯带压红一下再恢复
    sweepTimer += dt;
    if (sweepTimer > 22) {
      sweepTimer = 0;
      districtSweep();
    }
    for (let i = flagged.length - 1; i >= 0; i--) {
      const f = flagged[i];
      f.until -= dt;
      f.cone.rotation.y += dt * 2.4;
      if (f.until <= 0) {
        f.cone.visible = false;
        flagPool.push(f.cone);
        // 解除限流：灯带回到它原本的完播色
        if (f.rec.band) {
          f.rec.band.userData.red = false;
          f.rec.band.material.color.setHex(f.rec.bandColor);
        }
        flagged.splice(i, 1);
      }
    }
  }

  // 审核：把「粉丝多但没人看完」的楼顶插红标 —— 高曝光 + 低完播 = 被限流
  function flagSomeone() {
    if (!flagPool.length) return;
    const busy = new Set(flagged.map((f) => f.rec));
    // 阈值越小越严：更多大号会被扫进来
    const floor = 4200 * tuning.modThreshold;
    const pool = buildings.filter((b) => !busy.has(b) && b.followers > floor);
    if (!pool.length) return;
    const rec = pool[Math.floor(rand() * pool.length)];
    const cone = flagPool.pop();
    cone.position.set(rec.mesh.position.x, rec.h + 1.0, rec.mesh.position.z);
    cone.visible = true;
    flagged.push({ rec, cone, until: 12 });
    // 红锥只是标；真正让人看见「被处理」的是那道从楼顶扫下来的红环
    scanBuilding(rec);
    logEvent(
      `审核扫了「${blocks[rec.block].def.name}」：${fmt(rec.followers)} 粉的号被限流`,
      'bad',
    );
  }

  // ---------- 聚焦：让一个东西单独说话 ----------
  // 全城一起动的时候，眼睛不知道该看哪儿。选中任何东西后，跟它无关的部分
  // 压暗到几乎看不见，只留它和它的关系 —— 关系本身因此变得可读。
  let focusKind = null;
  let focusId = -1;
  let focusSet = new Set();

  function setFocus(kind, id) {
    focusKind = kind || null;
    focusId = id == null ? -1 : id;
    focusSet = new Set();
    if (focusKind === 'building') {
      const rec = buildings[focusId];
      if (!rec) {
        focusKind = null;
      } else {
        focusSet.add(rec);
        // 同一个 MCN 签下的同门，也算它的关系
        for (const b of buildings) {
          if (b !== rec && signed.includes(b) && signed.includes(rec)) focusSet.add(b);
        }
      }
    } else if (focusKind === 'block') {
      for (const b of buildings) if (b.block === focusId) focusSet.add(b);
    }
    // 标签：只留相关的
    for (const b of buildings) {
      if (focusKind) b.label.visible = focusSet.has(b);
    }
    if (!focusKind) {
      for (const b of buildings) b.mesh.material.emissiveIntensity = b.baseEmis;
      applyLevel();
    }
  }

  // ---------- 投稿演示：跟着一条作品走完整个流程 ----------
  // 不是随机生成一个 token 让你自己追，而是替某个博主按一次「发布」，
  // 然后把这条作品在漏斗里的每一站讲出来。走到哪说到哪，讲不完不结束。
  let playing = null;

  // 导演台：速度、暂停、只演哪些环节 —— 都由外面拨
  const demo = { paused: false, speed: 1, only: [0, 1, 2, 3] };

  function firstActive() {
    for (let i = 0; i < LAYERS.length; i++) if (demo.only.indexOf(i) >= 0) return i;
    return LAYERS.length;
  }

  function setDemoPaused(v) {
    demo.paused = !!v;
  }

  function setDemoSpeed(v) {
    const n = Number(v);
    demo.speed = Number.isFinite(n) ? Math.max(0.25, Math.min(4, n)) : 1;
  }

  function setDemoOnly(arr) {
    demo.only = Array.isArray(arr) ? arr.filter((i) => i >= 0 && i < LAYERS.length) : [0, 1, 2, 3];
  }

  function demoJump(dir) {
    const P = playing;
    if (!P) return;
    let s = P.stage + (dir < 0 ? -1 : 1);
    if (s < 1) s = 1;
    if (s > LAYERS.length) s = LAYERS.length;
    P.stage = s;
    P.t = 0;
    P.dur = 0.3;
    P.from.copy(P.mesh.position);
  }

  function demoStop() {
    if (!playing) return;
    group.remove(playing.mesh);
    playing.mesh.geometry.dispose();
    playing.mesh.material.dispose();
    playing = null;
  }

  function playSubmit(rec, onEvent) {
    if (!rec || !onEvent) return null;
    if (playing) {
      group.remove(playing.mesh);
      playing.mesh.geometry.dispose();
      playing.mesh.material.dispose();
    }
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }),
    );
    group.add(mesh);
    const quality = 0.35 + rand() * 0.6;
    const match = 0.3 + rand() * 0.65;
    const stops = LAYERS.map((L, i) => {
      const a = 0.9 + i * 1.7;
      return new THREE.Vector3(Math.cos(a) * L.r, L.y, Math.sin(a) * L.r);
    });
    mesh.position.set(rec.bx, rec.h + 0.5, rec.bz);
    playing = {
      mesh,
      rec,
      quality,
      match,
      stops,
      stage: 0,
      t: 0,
      dur: 1.15,
      from: mesh.position.clone(),
      pass: [],
      ev: onEvent,
    };
    onEvent({ type: 'start', rec, quality, match });
    return playing;
  }

  // ---------- B2：批量演算（只跑逻辑，不跑画面） ----------
  // 为什么不直接快进 update()：那要逐帧算四千个物体，跑「一小时」等于几百万次变换。
  // 这里只推进 token 状态机与计数，位置一律不算 —— 得到的是统计，不是录像。
  const tally = {
    spawned: 0,
    passedTop: 0,
    exposure: 0,
    dropByLayer: [0, 0, 0, 0],
  };

  function stepTokens(dt) {
    spawnAcc += dt;
    if (spawnAcc > 0.18) {
      spawnAcc = 0;
      const fresh = spawnToken();
      if (fresh) {
        tally.spawned++;
        pushAudit(fresh);
      }
    }
    for (const tk of tokens) {
      if (tk.state === 'idle') continue;
      if (tk.state !== 'run') {
        tk.state = 'idle';
        continue;
      }
      tk.t += dt / 1.15;
      if (tk.t < 1) continue;
      const p = odds(tk.layer, tk.quality, tk.match, tk.bi) * (1 + (tk.auditBias || 0));
      const pass = Math.random() < p;
      tk.hist.push({ layer: tk.layer, p, pass });
      stageStats[tk.layer].rate = stageStats[tk.layer].rate * 0.88 + (pass ? 0.12 : 0);
      if (!pass) {
        tally.dropByLayer[tk.layer]++;
        tk.state = 'idle';
        tk.end = 'dropped';
        continue;
      }
      if (tk.layer === LAYERS.length - 1) {
        tally.passedTop++;
        tally.exposure++;
        tk.state = 'idle';
        tk.end = 'passed';
      } else {
        tk.layer++;
        tk.t = 0;
      }
    }
  }

  function fastForward(seconds, step = 0.033) {
    const steps = Math.max(1, Math.min(120000, Math.round(seconds / step)));
    for (let i = 0; i < steps; i++) stepTokens(step);
    return getStats();
  }

  function resetTally() {
    tally.spawned = 0;
    tally.passedTop = 0;
    tally.exposure = 0;
    tally.dropByLayer = [0, 0, 0, 0];
  }

  function getStats() {
    const f = buildings.map((b) => b.followers).sort((a, b) => a - b);
    const n = f.length || 1;
    const sum = f.reduce((a, b) => a + b, 0) || 1;
    let gini = 0;
    if (f.length > 1) {
      for (let i = 0; i < f.length; i++) gini += (2 * (i + 1) - f.length - 1) * f[i];
      gini /= f.length * sum;
    }
    const pools = [0, 0, 0, 0];
    for (const b of buildings) {
      if (b.followers < 1000) pools[0]++;
      else if (b.followers < 5000) pools[1]++;
      else if (b.followers < 20000) pools[2]++;
      else pools[3]++;
    }
    const dropped = tally.dropByLayer.reduce((a, b) => a + b, 0);
    return {
      spawned: tally.spawned,
      passedTop: tally.passedTop,
      exposure: tally.exposure,
      dropped,
      dropByLayer: tally.dropByLayer.slice(),
      pools,
      avgFollowers: Math.round(sum / n),
      gini: Number(gini.toFixed(3)),
      signed: signed.length,
      flagged: flagged.length,
      rates: stageStats.map((s) => Number(s.rate.toFixed(3))),
    };
  }

  // ---------- B3：你当审核 ----------
  // 规则上审核本来就在自动跑（flagSomeone 赛后抓人）。这里改成赛前：
  // 队列里攒着还没分发出去的候选，放行 = 给一点顺风，限流 = 当场摁下去。
  const audits = [];
  let auditSeq = 0;

  function pushAudit(tk) {
    if (!tk || audits.length >= 3) return;
    if (Math.random() > 0.3) return;
    audits.push({
      id: 'a' + ++auditSeq,
      tk,
      rec: tk.rec,
      bi: tk.bi,
      quality: tk.quality,
      match: tk.match,
    });
  }

  function judgeAudit(id, limit) {
    const i = audits.findIndex((a) => a.id === id);
    if (i < 0) return false;
    const a = audits.splice(i, 1)[0];
    const who = a.rec ? a.rec.name : '一条无名内容';
    if (limit) {
      a.tk.auditBias = -1.2;
      if (a.tk.state === 'run') {
        a.tk.state = 'fall';
        a.tk.vy = 0;
        a.tk.end = 'dropped';
        a.tk.hist.push({ layer: a.tk.layer, p: 0, pass: false });
      }
      if (a.rec) scanBuilding(a.rec);
      logEvent('你判了「' + who + '」限流：这条被摁下去，楼也暗了一阵', 'bad');
    } else {
      a.tk.auditBias = 0.25;
      logEvent('你放行「' + who + '」：继续参与分发', 'good');
    }
    return true;
  }

  return {
    fastForward, getStats, resetTally,
    get audits() { return audits; },
    judgeAudit,
    playSubmit,
    setDemoPaused, setDemoSpeed, setDemoOnly, demoJump, demoStop,
    get demoStage() { return playing ? playing.stage : 0; },
    get demoPos() { return playing ? playing.mesh.position.clone() : null; },
    feed, logEvent, setFocus,
    getTuning, setTuning, TUNING_DEFS, applySigned,
    group, blocks, buildings, tower, core, roles, signLines, LAYERS, promo,
    showScreen, screen, focusBuilding, clearFocus, billboards, showQueueScreen,
    get tokens() { return tokens; },
    get level() { return level; },
    get focus() { return focus; },
    get signedCount() { return signed.length; },
    get flaggedCount() { return flagged.length; },
    setLevel, update,
    blockWorld(bi) {
      const b = blocks[bi];
      return new THREE.Vector3(b.cx, 0, b.cz);
    },
  };
}

function fmt(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}
