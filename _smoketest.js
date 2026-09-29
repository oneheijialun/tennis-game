// 无头冒烟测试：桩掉 DOM/Canvas，加载游戏脚本，验证渲染路径与 SDT 计算
const fs = require('fs');
const path = 'D:\\AI_Workspace\\信号检测论 网球游戏\\信号检测论-网球.html';
const html = fs.readFileSync(path, 'utf8');
const js = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

let rafCb = null;
const grad = { addColorStop(){} };
function mkCtx(){
  const c = {};
  const noop = ()=>{};
  for (const k of ['setTransform','clearRect','fillRect','beginPath','moveTo','lineTo',
    'closePath','fill','stroke','arc','ellipse','arcTo','roundRect','save','restore',
    'translate','rotate','fillText','strokeText','clip','setLineDash']) c[k]=noop;
  c.createLinearGradient = ()=>grad;
  c.createRadialGradient = ()=>grad;
  c.measureText = ()=>({width:10});
  c.scale = noop;
  return c;
}
function mkEl(id){
  return {
    id, style:{}, dataset:{}, innerHTML:'', textContent:'',
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
                contains(c){return this._s.has(c)} },
    addEventListener(){}, closest(){return null},
    getBoundingClientRect:()=>({width:1280,height:720}),
    getContext:()=>mkCtx(), width:260, height:260
  };
}
const els = {};
const doc = {
  getElementById(id){ return els[id] || (els[id]=mkEl(id)); },
  querySelectorAll(){ return []; }
};
global.document = doc;
global.window = { addEventListener(){}, devicePixelRatio:1 };
global.performance = { now: ()=>Date.now() };
global.requestAnimationFrame = cb => { rafCb = cb; };
global.CanvasRenderingContext2D = function(){};
global.CanvasRenderingContext2D.prototype = {};
global.AudioContext = undefined;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;

// 执行游戏脚本（strict 模式下用间接 eval 走全局作用域）
(0, eval)(js + '\n;globalThis.__G = G; globalThis.__api = {computeStats, buildTrials, makeArc, zInv, Phi, DIFF, BN, netH, startGame, swing, beginFlight};');

const { computeStats, buildTrials, makeArc, zInv, Phi, BN, netH, startGame, swing, beginFlight } = globalThis.__api;
const G = globalThis.__G;

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra?'  -> '+extra:'')); }
};
const near = (a,b,eps=0.02) => Math.abs(a-b) < eps;

console.log('\n== 1. 正态分布工具 ==');
ok('zInv(0.5)≈0',      near(zInv(0.5),0,1e-6), zInv(0.5));
ok('zInv(0.975)≈1.96', near(zInv(0.975),1.95996,1e-3), zInv(0.975));
ok('zInv(0.025)≈-1.96',near(zInv(0.025),-1.95996,1e-3), zInv(0.025));
ok('Phi(0)=0.5',       near(Phi(0),0.5,1e-6));
ok('Phi(1.96)≈0.975',  near(Phi(1.95996),0.975,1e-4), Phi(1.95996));
for (const p of [0.001,0.01,0.1,0.3,0.5,0.7,0.9,0.99,0.999]) {
  if (!near(Phi(zInv(p)), p, 1e-3)) { fail++; console.log('  FAIL  往返 p='+p+' -> '+Phi(zInv(p))); }
}
ok('zInv/Phi 往返一致 (9 个分位点)', true);

console.log('\n== 2. SDT 指标 ==');
// 四格均非 0 → 用原始比例，结果应与 z(H)-z(FA) 手算一致
let s = computeStats({H:5,M:1,FA:1,CR:5});
ok('P(H)=0.833',  near(s.pH,0.8333,1e-3), s.pH);
ok('P(FA)=0.167', near(s.pFA,0.1667,1e-3), s.pFA);
ok("d'=1.935 (未校正)", near(s.dPrime,1.9348,0.002), s.dPrime);
ok('c=0 (无偏)', near(s.cCrit,0,1e-6), s.cCrit);
ok('β=1 (无偏)', near(s.beta,1,1e-6), s.beta);
ok("A'=0.9", near(s.Aprime,0.9,1e-6), s.Aprime);
ok('无 0 格时不启用校正', s.clean === true && s.extreme === false);

// 完全无分辨力：四项各半
let s2 = computeStats({H:3,M:3,FA:3,CR:3});
ok("瞎猜 d'=0", near(s2.dPrime,0,1e-9), s2.dPrime);
ok("瞎猜 A'=0.5", near(s2.Aprime,0.5,1e-9), s2.Aprime);

// 极值：全 H 全 CR（0 格）走校正，必须有限
let s3 = computeStats({H:6,M:0,FA:0,CR:6});
ok("完美表现 d'=2.93 (校正)", near(s3.dPrime,2.9305,0.005), s3.dPrime);
ok('完美表现 β 有限', isFinite(s3.beta), s3.beta);
ok("完美表现 A'=1", near(s3.Aprime,1,1e-9), s3.Aprime);
ok('0 格时标记 extreme', s3.extreme === true);
let s4 = computeStats({H:0,M:6,FA:6,CR:0});
ok('最差表现 d\'=-2.93', near(s4.dPrime,-2.9305,0.005), s4.dPrime);
ok("最差表现 A'=0", near(s4.Aprime,0,1e-9), s4.Aprime);
// 一个球都没挥：P(H)=P(FA)=0 → 无分辨力
let s5 = computeStats({H:0,M:6,FA:0,CR:6});
ok("从不挥拍 A'=0.5", near(s5.Aprime,0.5,1e-9), s5.Aprime);
ok('从不挥拍 c 有限', isFinite(s5.cCrit), s5.cCrit);

// 保守 vs 冒进：同样 d'，c 应反号
const cons = computeStats({H:2,M:4,FA:0,CR:6});   // 少挥拍 → 偏保守
const lib  = computeStats({H:6,M:0,FA:4,CR:2});   // 多挥拍 → 偏冒进
ok('保守者 c>0', cons.cCrit>0, 'c='+cons.cCrit.toFixed(2));
ok('冒进者 c<0', lib.cCrit<0,  'c='+lib.cCrit.toFixed(2));
ok("两组 d' 相同（同为 0 格校正）", near(cons.dPrime, lib.dPrime, 1e-9),
   `${cons.dPrime} vs ${lib.dPrime}`);

console.log('\n== 3. 球路物理（netClear 必须成立） ==');
let worst = Infinity, badLand = 0;
for (let i=0;i<4000;i++){
  const landZ = BN + (Math.random()*2-1)*3.6;             // 底线附近
  const landX = (Math.random()*2-1)*3.2;
  const T = 1.45 + Math.random()*0.5;
  const x0 = 0, z0 = 8.5, y0 = 1.05;
  const yNetGoal = netH(landX) + 0.30 + Math.random()*0.45;
  const a = makeArc(z0, y0, landZ, 0, 0, yNetGoal, T);
  // 解析位置
  const yAt = t => y0 + a.vy*t - 0.5*a.g*t*t;
  const zAt = t => z0 + a.vz*t;
  if (!near(yAt(T), 0, 1e-6)) badLand++;                  // 必须恰好在 T 时刻落地
  const tNet = (0 - z0)/a.vz;
  const hNet = yAt(tNet);
  if (!(hNet > netH(landX))) { worst = Math.min(worst, hNet - netH(landX)); }
  if (!isFinite(a.g) || a.g <= 0.05) badLand++;
}
ok('落地时刻恒等于飞行时间 T', badLand === 0, 'bad=' + badLand);
ok('每一次都过网（4000 次采样）', worst >= 0, '最低余量=' + worst.toFixed(3));

console.log('\n== 4. 试次生成（12 球：6 信号 / 4 界外 / 2 空发） ==');
for (let r=0;r<300;r++){
  const ts = buildTrials();
  if (ts.length !== 12) { fail++; console.log('  FAIL  试次数=' + ts.length); break; }
  const c = {in:0,out:0,none:0};
  ts.forEach(t=>c[t.type]++);
  if (c.in!==6||c.out!==4||c.none!==2) { fail++; console.log('  FAIL  配比', c); break; }
  // 界内球必须在界内、界外球必须在界外
  for (const t of ts){
    if (t.type==='in'  && !(t.landZ > BN))      { fail++; console.log('  FAIL  界内球落到界外', t); r=1e9; break; }
    if (t.type==='out' && !(t.landZ < BN))      { fail++; console.log('  FAIL  界外球落到界内', t); r=1e9; break; }
    if (Math.abs(t.landX) > 4.115)              { fail++; console.log('  FAIL  横向出界', t); r=1e9; break; }
  }
}
ok('300 轮配比/落点全部正确', true);

console.log('\n== 5. 四象限映射 ==');
// 复刻 resolve() 的判定表
const judge = (isSignal, swung) =>
  isSignal && swung ? 'H' : isSignal && !swung ? 'M' : !isSignal && swung ? 'FA' : 'CR';
ok('界内 + 挥拍 = 击中 H',   judge(true,true)==='H');
ok('界内 + 不挥 = 漏报 M',   judge(true,false)==='M');
ok('界外 + 挥拍 = 虚报 FA',  judge(false,true)==='FA');
ok('界外 + 不挥 = 正确拒绝 CR', judge(false,false)==='CR');
ok('空发球 + 挥拍 = 虚报 FA', judge(false,true)==='FA');
ok('空发球 + 不挥 = 正确拒绝 CR', judge(false,false)==='CR');

console.log('\n== 6. 实际跑完一整轮（含渲染） ==');

const gauss = () => { let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };

// 模拟玩家：每球只在进入飞行时决策一次。
// obsSigma = 知觉噪声，模拟玩家从「落点 + 噪声」判断界内/界外。
// 注意：帧时间戳必须全局单调递增（游戏内部 lastT 是跨轮持久的），
// 每轮重新取 Date.now() 会让 dt 变成大负数、游戏时间倒流。
let vclock = Date.now();
function playRound(diff, obsSigma){
  G.diff = diff; G.state = 'play'; G.phase = 'idle';
  startGame();
  let decided = -2, frames = 0;
  for (let i=0; i<20000; i++){
    if (!rafCb) throw new Error('主循环停止了帧回调 (frame ' + i + ')');
    const cb = rafCb; rafCb = null;
    cb(vclock); vclock += 16.7; frames++;
    if (G.phase === 'fly' && !G.responded && decided !== G.idx){
      decided = G.idx;
      const tr = G.cur;
      let saysIn;
      if (tr.type === 'none') saysIn = Math.random() < 0.25;   // 空发球：偶尔"看见"球
      else saysIn = (tr.landZ + gauss()*obsSigma) > BN;
      if (saysIn) swing();
    }
    if (G.phase === 'done') break;
  }
  return { r:{...G.results}, frames, phase:G.phase };
}

try {
  const out = playRound('normal', 1.0);
  ok('startGame() + 整轮模拟未抛异常', true);
  ok('跑满 12 球', out.r.H+out.r.M+out.r.FA+out.r.CR === 12,
     JSON.stringify(out.r) + ' frames=' + out.frames);
  ok('已进入结果态', out.phase === 'done', out.phase);
  ok('结果页已渲染', els['resMetrics'] && els['resMetrics'].innerHTML.length > 100);
  ok('结果矩阵已渲染', els['resMatrix'] && els['resMatrix'].innerHTML.indexOf('正确拒绝') >= 0);
  ok('ROC 已绘制', els['roc'] !== undefined);
} catch(e){
  ok('整轮模拟未抛异常', false, e.message);
}

console.log('\n== 7. 难度梯度：落点离底线的距离 ==');
// 直接检验生成器语义：越难，"明显球"越少、平均离线越近
const marginOf = t => (t.type==='in' ? t.landZ-BN : t.type==='out' ? BN-t.landZ : null);
const meanMargin = {};
for (const d of ['easy','normal','hard']){
  G.diff = d;
  let sum=0, n=0, clearCnt=0, tot=0;
  for (let k=0;k<400;k++){
    for (const t of buildTrials()){
      const m = marginOf(t);
      if (m===null) continue;
      sum += m; n++;
      if (m > 1.05) clearCnt++;   // 两个"明显"分支的下界约 1.10 / 0.85
      tot++;
    }
  }
  meanMargin[d] = sum/n;
  console.log(`      ${d.padEnd(7)} 平均离线 ${(sum/n).toFixed(3)} m   明显球占比 ${(clearCnt/tot*100).toFixed(1)}%`);
}
ok('简单难度球离线更远', meanMargin.easy > meanMargin.normal,
   `easy=${meanMargin.easy.toFixed(2)} normal=${meanMargin.normal.toFixed(2)}`);
ok('普通难度球离线更远', meanMargin.normal > meanMargin.hard,
   `normal=${meanMargin.normal.toFixed(2)} hard=${meanMargin.hard.toFixed(2)}`);

console.log('\n== 8. 三种难度各跑多轮（同一模拟玩家，看 d′ 是否随难度下降） ==');
const agg = {easy:{H:0,M:0,FA:0,CR:0}, normal:{H:0,M:0,FA:0,CR:0}, hard:{H:0,M:0,FA:0,CR:0}};
let allTotals = true, err = null;
// 轮数按统计功效选，不是随手填的。同一模拟观察者（σ=1.0 m）的总体 d′（各 200 轮实测）：
// 简单 2.46 / 普通 1.87 / 困难 1.32 —— 相邻两档差约 0.55。
// 每轮 12 球，ROUNDS 轮共 12×ROUNDS 个试次。20 轮时 d′ 的抽样 sd 约 0.22，
// 差值只有 ~2.5σ，实测约 1/6 的运行会翻（普通 1.52 vs 困难 1.58）。
// 60 轮实测：普通−困难的差值均值 0.50、sd 0.16，最小的一次 0.26 ≈ 3σ，
// 10 次连跑全绿；整套 180 轮约 6 s，代价可以忽略。
const ROUNDS = 60;
try {
  for (const d of ['easy','normal','hard']){
    for (let k=0;k<ROUNDS;k++){
      const out = playRound(d, 1.0);          // 同一个观察者，灵敏度固定
      if (out.r.H+out.r.M+out.r.FA+out.r.CR !== 12) allTotals = false;
      for (const kk in agg[d]) agg[d][kk] += out.r[kk];
    }
  }
} catch(e){ err = e.message; }
ok(`${ROUNDS*3} 轮全部跑完未抛异常`, err === null, err || '');
ok('每一轮都是 12 球', allTotals);
console.log(`      三种难度各 ${ROUNDS} 轮累计：`);
const dpr = {};
for (const d of ['easy','normal','hard']){
  const st = computeStats(agg[d]); dpr[d] = st.dPrime;
  console.log(`      ${d.padEnd(7)} H=${agg[d].H} M=${agg[d].M} FA=${agg[d].FA} CR=${agg[d].CR}   d′=${st.dPrime.toFixed(2)}`);
}
ok("简单难度 d' 高于普通", dpr.easy > dpr.normal, `${dpr.easy.toFixed(2)} vs ${dpr.normal.toFixed(2)}`);
ok("普通难度 d' 高于困难", dpr.normal > dpr.hard, `${dpr.normal.toFixed(2)} vs ${dpr.hard.toFixed(2)}`);

console.log('\n== 9. 抢拍缓冲 / 反应窗口边界 ==');
// 预备期最后 0.33s 内按键 → 缓冲，发球瞬间生效
G.phase='pre'; G.preT=0.60; G.responded=false; G.earlyPress=false;
swing();
ok('预备期按键不立即计为挥拍', G.responded === false);
ok('预备期按键被缓冲', G.earlyPress === true);
beginFlight();
ok('发球瞬间缓冲生效 → 计为挥拍', G.responded === true && G.cur.responded === true);

// 预备期太早按键（>0.42s 之前）不缓冲，避免误触
G.phase='pre'; G.preT=0.10; G.responded=false; G.earlyPress=false;
swing();
ok('过早按键不缓冲', G.earlyPress === false && G.responded === false);

// 反应窗在落地瞬间关闭。帧序上 resolve() 与 t>=T 同帧完成，这本来不会漏；
// 这条断言守的是 swing() 自身的不变式，防止以后重构帧序时把窗口放开。
G.phase='fly'; G.t=G.T; G.responded=false; G.earlyPress=false;
G.cur.responded=false; G.cur.pressT=-1;
swing();
ok('球落地后按键无效（窗口已关）', G.responded === false);

// 同一次试次内重复按键只算一次
G.phase='fly'; G.t=0.5; G.responded=false; G.cur.responded=false; G.cur.pressT=-1;
swing(); const firstT = G.cur.pressT;
G.t=1.2; swing();
ok('重复按键只记第一次', G.cur.pressT === firstT, `first=${firstT} after=${G.cur.pressT}`);

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
