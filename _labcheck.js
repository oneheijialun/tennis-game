// 无头校验：桩掉 DOM，加载概念实验室的脚本，验证数学、恒等式、模拟机制与 SVG 几何
// 用法：node _labcheck.js
const fs = require('fs');
const path = 'D:\\AI_Workspace\\信号检测论 网球游戏\\信号检测论-网球-概念实验室.html';
const html = fs.readFileSync(path, 'utf8');
const m = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('未找到 <script> 块'); process.exit(1); }
const js = m[1];

// ---- 桩 DOM ----
// 实验室靠 if(document.createElementNS==='function') 判否来跳过 init，桩里不给这个方法即可；
// 游戏脚本则要一路跑到 resize()，所以 canvas 的 2d 上下文也得桩上。两套桩合成一份。
let rafCb = null;
const grad = { addColorStop(){} };
function mkCtx(){
  const c = {}; const noop = ()=>{};
  for (const k of ['setTransform','clearRect','fillRect','beginPath','moveTo','lineTo',
    'closePath','fill','stroke','arc','ellipse','arcTo','roundRect','save','restore',
    'translate','rotate','fillText','strokeText','clip','setLineDash','scale']) c[k]=noop;
  c.createLinearGradient = ()=>grad;
  c.createRadialGradient = ()=>grad;
  c.measureText = ()=>({width:10});
  return c;
}
const els = {};
function mkEl(id){
  return { id, style:{}, dataset:{}, innerHTML:'', textContent:'', value:'',
    checked:false, className:'', width:260, height:260,
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
                toggle(c,on){ on===undefined? (this._s.has(c)?this._s.delete(c):this._s.add(c)) : (on?this._s.add(c):this._s.delete(c)); },
                contains(c){return this._s.has(c)} },
    addEventListener(){}, setAttribute(){}, appendChild(){}, closest(){return null;},
    getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
    getContext:()=>mkCtx() };
}
global.document = {
  getElementById(id){ return els[id] || (els[id]=mkEl(id)); },
  querySelectorAll(){ return []; }
};
global.window = { addEventListener(){}, devicePixelRatio:1, innerWidth:1280, scrollTo(){} };
global.location = { hash:'' };
global.performance = { now: ()=>Date.now() };
global.requestAnimationFrame = cb => { rafCb = cb; };
global.CanvasRenderingContext2D = function(){}; global.CanvasRenderingContext2D.prototype = {};
global.AudioContext = undefined;

(0, eval)(js + '\n;globalThis.__ok = true;');

// 再把游戏脚本也加载进来，为的是第 12 组能对着真实的 labURL() 做端到端校验。
// 两个脚本共享同一份桩全局，互不干扰：实验室跳过 init，游戏跑到 resize() 就停在
// requestAnimationFrame(loop)，帧循环由下面的测试手动驱动。
const gamePath = 'D:\\AI_Workspace\\信号检测论 网球游戏\\信号检测论-网球.html';
const gameHtml = fs.readFileSync(gamePath,'utf8');
const gameJs = /<script>([\s\S]*?)<\/script>/.exec(gameHtml)[1];
(0, eval)(gameJs + '\n;globalThis.__game = {G, labURL, BN, startGame, swing, gauss, computeStats};');
const GAME = globalThis.__game;

const L = globalThis.__lab;
if (!L) { console.error('实验室脚本没有导出 globalThis.__lab'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra!==''?'  -> '+extra:'')); }
};
const near = (a,b,eps=1e-9) => Math.abs(a-b) < eps;
const { clamp, Phi, zInv, modelRates, critMeters, statsFromRates, statsFromCounts,
        aPrime, aucOf, optBeta, cOpt, rocCurve, runSim, runSimAvg, BLOCKS, S,
        setDPrime, vPrime, parseHash, mineStats } = L;

// erf 用的是 Abramowitz-Stegun 7.1.26（游戏也是这个），绝对误差 ~1.5e-7。
// 所以 Phi(0) 不是精确的 0.5，而是 0.5±5e-10 —— 下面所有涉及 Phi 的容差都按这个量级设。
const PHI_EPS = 1e-7;
console.log('\n== 1. 正态分布工具 ==');
ok('zInv(0.5) = 0',            near(zInv(0.5),0,1e-9), zInv(0.5));
ok('zInv(0.975) ≈ 1.95996',    near(zInv(0.975),1.95996,1e-4), zInv(0.975));
ok('zInv(0.025) ≈ −1.95996',   near(zInv(0.025),-1.95996,1e-4), zInv(0.025));
ok('Phi(0) ≈ 0.5（A&S 近似，误差 < 1e-7）', near(Phi(0),0.5,PHI_EPS), Phi(0)-0.5);
ok('Phi(1.95996) ≈ 0.975',     near(Phi(1.95996),0.975,1e-5), Phi(1.95996));
{
  let worst = 0;
  for (let i=1;i<1000;i++){
    const p=i/1000;
    worst = Math.max(worst, Math.abs(Phi(zInv(p))-p));
  }
  ok('zInv/Phi 往返一致（999 个分位点，误差 < 1e-7）', worst < 1e-7, 'worst='+worst.toExponential(2));
}

console.log('\n== 2. 模型正算 ⇄ 计数反解互逆 ==');
// 容差不是随手定的：modelRates 出的 P 值带着 erf 近似 ~1.5e-7 的误差，
// 经 zInv 反解时被 1/φ(z) 放大，尾部（|z|>3）放大到 ~1e-4。这是 A&S 近似的固有极限，
// 也是游戏结果页一直用的同一套函数，所以两边始终自洽。
const RT_EPS = 3e-4;
{
  let worstD = 0, worstC = 0, whereD = '', whereC = '';
  for (const d of [0.4,0.8,1.5,2.2,3.0,4.0]) {
    for (const c of [-1.2,-0.5,0,0.35,1.1]) {
      const r = modelRates(d,c);
      const s = statsFromRates(r.pH, r.pFA);
      if (Math.abs(s.dPrime-d) > worstD) { worstD = Math.abs(s.dPrime-d); whereD = `d=${d},c=${c}`; }
      if (Math.abs(s.cCrit-c)   > worstC) { worstC = Math.abs(s.cCrit-c);   whereC = `d=${d},c=${c}`; }
    }
  }
  ok(`反解 d′ 与原值一致（30 组，误差 < ${RT_EPS}）`, worstD < RT_EPS, 'worst='+worstD.toExponential(2)+' @ '+whereD);
  ok(`反解 c 与原值一致（30 组，误差 < ${RT_EPS}）`,  worstC < RT_EPS, 'worst='+worstC.toExponential(2)+' @ '+whereC);
}
// 大 N 下用 0.5 校正的计数反解也应该接近真值
{
  const d=1.6, c=0.4, N=200000;
  const r = modelRates(d,c);
  const r0 = statsFromCounts({H:Math.round(r.pH*N), M:Math.round((1-r.pH)*N),
                              FA:Math.round(r.pFA*N), CR:Math.round((1-r.pFA)*N)});
  ok('大 N 计数反解 d′ ≈ 真值（误差 < 0.01）', near(r0.dPrime,d,0.01), r0.dPrime);
  ok('大 N 计数反解 c ≈ 真值（误差 < 0.01）',  near(r0.cCrit,c,0.01), r0.cCrit);
}

console.log('\n== 3. 与游戏 computeStats 的一致性 ==');
// 游戏结果页的算法：零格时 0.5 对数线性校正，A′ 用原始比例
function gameStats(r){
  const nS=r.H+r.M, nN=r.FA+r.CR;
  const pH=nS?r.H/nS:NaN, pFA=nN?r.FA/nN:NaN;
  const clean=(r.H>0&&r.M>0&&r.FA>0&&r.CR>0);
  const hh=clean?pH:(r.H+0.5)/(nS+1);
  const ff=clean?pFA:(r.FA+0.5)/(nN+1);
  const zh=zInv(hh), zf=zInv(ff);
  let A;
  if(pH===pFA) A=0.5;
  else if(pH>pFA){ const d0=4*pH*(1-pFA); A=d0>1e-9?0.5+((pH-pFA)*(1+pH-pFA))/d0:1; }
  else          { const d0=4*pFA*(1-pH);  A=d0>1e-9?0.5-((pFA-pH)*(1+pFA-pH))/d0:0; }
  return {d:zh-zf, c:-0.5*(zh+zf), beta:Math.exp((zf*zf-zh*zh)/2), A:clamp(A,0,1)};
}
{
  const cases=[{H:5,M:1,FA:1,CR:5},{H:6,M:0,FA:0,CR:6},{H:0,M:6,FA:0,CR:6},
               {H:3,M:3,FA:3,CR:3},{H:4,M:2,FA:1,CR:5},{H:6,M:0,FA:3,CR:3},
               {H:2,M:4,FA:5,CR:1},{H:1,M:5,FA:2,CR:4},{H:0,M:6,FA:6,CR:0}];
  let worst=0, worstA=0;
  for (const cs of cases){
    const a=gameStats(cs), b=statsFromCounts(cs);
    worst  = Math.max(worst,  Math.abs(a.d-b.dPrime), Math.abs(a.c-b.cCrit));
    worstA = Math.max(worstA, Math.abs(a.A-b.Aprime));
  }
  ok('d′ / c 与游戏算法逐例一致（9 组，误差 < 1e-12）', worst < 1e-12, 'worst='+worst.toExponential(2));
  ok('A′ 与游戏算法逐例一致（误差 < 1e-12）',          worstA < 1e-12, 'worst='+worstA.toExponential(2));
  const ex = statsFromCounts({H:6,M:0,FA:0,CR:6});
  ok('全对时标记为已校正', ex.corrected === true);
  ok('全对时 d′ 有限（不发散）', isFinite(ex.dPrime), ex.dPrime);
  ok('全对时 d′ = 2.93（12 球设计的上限）', near(ex.dPrime, 2.9316, 0.002), ex.dPrime);
}
ok('全不挥时 d′ = 0 且 c 为正（保守）',
   (()=>{ const s=statsFromCounts({H:0,M:6,FA:0,CR:6}); return near(s.dPrime,0,1e-9) && s.cCrit>0; })());

console.log('\n== 4. 恒等式 ==');
// 页面上写的是 β = exp(d′·c)，其中 d′ 和 c 就是页面上显示的那两个数。
// 这个恒等式在代数上是精确的：d′·c = (zh−zf)·(−½)(zh+zf) = ½(zf²−zh²)，
// 所以它必须对"返回的 d′ 和 c"成立到机器精度（不只是近似成立）。
{
  let worst=0, where='';
  for (const d of [0.3,1,1.5,2.4,3.7]) for (const c of [-1.5,-0.7,0,0.6,1.4]) {
    const s=statsFromRates(modelRates(d,c).pH, modelRates(d,c).pFA);
    const e=Math.abs(s.beta - Math.exp(s.dPrime*s.cCrit));
    if (e>worst) { worst=e; where=`d=${d},c=${c}`; }
  }
  ok('β = exp(d′·c)，用返回的 d′/c（25 组，误差 < 1e-9）', worst < 1e-9,
     'worst='+worst.toExponential(2)+' @ '+where);
  // 计数路径也必须守住同一条恒等式（结果页上的 β 就是这么来的）
  let worst2=0;
  for (const r of [{H:4,M:2,FA:1,CR:5},{H:5,M:1,FA:2,CR:4},{H:6,M:0,FA:3,CR:3},{H:1,M:5,FA:2,CR:4}]) {
    const s=statsFromCounts(r);
    worst2=Math.max(worst2, Math.abs(s.beta - Math.exp(s.dPrime*s.cCrit)));
  }
  ok('计数路径上同一条恒等式也成立（误差 < 1e-9）', worst2 < 1e-9, worst2.toExponential(2));
}
{
  // 直接用闭式核对 P(H)=Φ(d′/2−c)、P(FA)=Φ(−c−d′/2)
  let w2=0;
  for (const d of [0.5,1.5,3]) for (const c of [-1,0,0.8]) {
    const r=modelRates(d,c);
    w2 = Math.max(w2, Math.abs(r.pH-Phi(d/2-c)), Math.abs(r.pFA-Phi(-c-d/2)));
  }
  ok('P(H)=Φ(d′/2−c)、P(FA)=Φ(−c−d′/2)', w2 < 1e-12, 'worst='+w2.toExponential(2));
  ok('c=0 时 P(H) = 1 − P(FA)', near(modelRates(2.0,0).pH, 1-modelRates(2.0,0).pFA, 1e-12));
  ok('c 为正 → 更保守（P(FA) 更小）',
     modelRates(1.5,0.6).pFA < modelRates(1.5,0).pFA);
  ok('判定标准落在 c·σ 米处', near(critMeters(0.5,0.3), 0.15, 1e-12), critMeters(0.5,0.3));
}

console.log('\n== 5. A′ 与 AUC ==');
ok('A′(d′=0) = 0.5', (()=>{ const s=statsFromRates(0.5,0.5); return near(aPrime(0.5,0.5),0.5,1e-12); })());
{
  let prev=-1, mono=true;
  for (const d of [0,0.5,1,1.5,2,2.5,3]) {
    const r=modelRates(d,0);
    const a=aPrime(r.pH,r.pFA);
    if (a < prev-1e-9) mono=false;
    prev=a;
  }
  ok('A′ 随 d′ 单调不减', mono);
}
{
  let inRange=true;
  for (const d of [0,1,2,3,4]) for (const c of [-1.5,0,1.5]) {
    const r=modelRates(d,c); const a=aPrime(r.pH,r.pFA);
    if (!(a>=0 && a<=1)) inRange=false;
  }
  ok('A′ 始终落在 [0,1]', inRange);
}
ok('AUC(d′=0) = 0.5', near(aucOf(0),0.5,PHI_EPS), aucOf(0));
ok('AUC(d′=1) ≈ 0.7602', near(aucOf(1),0.76025,1e-4), aucOf(1));
ok('AUC(d′=2) ≈ 0.9214', near(aucOf(2),0.92135,1e-4), aucOf(2));
ok('AUC 随 d′ 单调递增', aucOf(0.5)<aucOf(1.5) && aucOf(1.5)<aucOf(3));

console.log('\n== 6. ROC 曲线 ==');
{
  const pts=rocCurve(1.5,60);
  let mono=true;
  for (let i=1;i<pts.length;i++) if (pts[i][1] < pts[i-1][1]-1e-12) mono=false;
  ok('P(H) 随 P(FA) 单调不减', mono);
  // 采样时 P 被夹在 [1e-4, 1−1e-4] 以免 zInv 发散，所以端点落在角落的 0.02 内即可
  ok('曲线从 (0,0) 附近起步、到 (1,1) 附近收尾',
     pts[0][0]<0.01 && pts[0][1]<0.02 && pts[pts.length-1][0]>0.99 && pts[pts.length-1][1]>0.98,
     `首(${pts[0][0].toFixed(4)},${pts[0][1].toFixed(4)}) 末(${pts[pts.length-1][0].toFixed(4)},${pts[pts.length-1][1].toFixed(4)})`);
  // 等方差 ROC 对称：c=0 的点满足 P(H)=1−P(FA)
  const r=modelRates(1.5,0);
  const idx=pts.findIndex(p=>Math.abs(p[0]-r.pFA)<0.02);
  ok('曲线上的 c=0 点满足 P(H) ≈ 1 − P(FA)',
     idx>=0 && near(pts[idx][1], 1-pts[idx][0], 0.03), idx);
}

console.log('\n== 7. 最优标准（方向断言，不是数值断言）==');
{
  const sym={VH:1,CM:1,CFA:1,VCR:1};
  const ob=optBeta(0.5,sym);
  ok('对称收益 + P(S)=0.5 → β_opt = 1', near(ob.beta,1,1e-12), ob.beta);
  ok('对称收益 + P(S)=0.5 → c* = 0',   near(cOpt(ob.beta,1.5),0,1e-12));

  // 关键分：漏报代价变大 → β_opt 变小 → c* 变负（更冒进）
  const key={VH:1,CM:4,CFA:1,VCR:1};
  const obK=optBeta(0.5,key), coK=cOpt(obK.beta,1.5);
  ok('关键分：β_opt < 1',            obK.beta < 1, obK.beta);
  ok('关键分：c* < 0（更冒进）',      coK < 0, coK);

  // 体能吃紧：虚报代价变大 → β_opt 变大 → c* 变正（更保守）
  const tired={VH:1,CM:1,CFA:3,VCR:1};
  const obT=optBeta(0.5,tired), coT=cOpt(obT.beta,1.5);
  ok('体能吃紧：β_opt > 1',          obT.beta > 1, obT.beta);
  ok('体能吃紧：c* > 0（更保守）',    coT > 0, coT);

  // 先验：对手的球更多在界内 → β_opt 变小 → 更冒进
  const obP=optBeta(0.8,sym), coP=cOpt(obP.beta,1.5);
  ok('P(S)=0.8：β_opt = 0.25',        near(obP.beta,0.25,1e-12), obP.beta);
  ok('P(S)=0.8：c* < 0（更冒进）',    coP < 0, coP);

  // 方向链条：CM 越大越冒进，CFA 越大越保守，单调（起点用 ±Infinity，别预设第一项的大小）
  let monoK=true, prev=Infinity;
  for (const cm of [0.5,1,2,4,8]) { const b=optBeta(0.5,{VH:1,CM:cm,CFA:1,VCR:1}).beta;
    if (b>prev+1e-12) monoK=false; prev=b; }
  ok('C(M) 越大 → β_opt 单调不增', monoK);
  let monoT=true; prev=-Infinity;
  for (const cfa of [0.5,1,2,4,8]) { const b=optBeta(0.5,{VH:1,CM:1,CFA:cfa,VCR:1}).beta;
    if (b<prev-1e-12) monoT=false; prev=b; }
  ok('C(FA) 越大 → β_opt 单调不减', monoT);

  // d′ 的杠杆：同一个 β_opt，d′ 越小 c* 离 0 越远
  ok('d′ 越小 → |c*| 越大', Math.abs(cOpt(0.5,0.8)) > Math.abs(cOpt(0.5,3.0)));
}

console.log('\n== 8. 准确率陷阱 ==');
{
  const A={H:4,M:2,FA:1,CR:5}, B={H:5,M:1,FA:2,CR:4};
  const a=statsFromCounts(A), b=statsFromCounts(B);
  ok('两组准确率都是 0.75', near(a.accurate,0.75,1e-12) && near(b.accurate,0.75,1e-12));
  ok('两组 d′ 相等',       near(a.dPrime,b.dPrime,1e-12), a.dPrime+' vs '+b.dPrime);
  ok('两组 c 反号',         a.cCrit>0 && b.cCrit<0, a.cCrit+' vs '+b.cCrit);
  ok('谨慎型 |c| = 宽松型 |c|', near(Math.abs(a.cCrit),Math.abs(b.cCrit),1e-12));
  ok('d′ ≈ 1.3981',         near(a.dPrime,1.3981,0.002), a.dPrime);
  ok('c ≈ ±0.2684',         near(Math.abs(a.cCrit),0.2684,0.002), a.cCrit);
}

console.log('\n== 9. 耐力模拟 ==');
// 关键区分：blocks[].d / blocks[].c 是模型内部的**真值**（确定性的），
// blocks[].dEst / .cEst 是从每段 30+30 次抽样里**反解出来的估计值**（噪声很大，单段 ±0.3）。
// 单调性必须在真值上断言；估计值只能断言"整体趋势"，而且要跨种子平均。
{
  // 9a 关闭两者：d′ 与 c 应该只在抽样噪声里晃，没有系统趋势
  const base=runSimAvg({d0:1.5,c0:0,useFatigue:false,useDrift:false},60);
  ok('基准：首末段 d′ 估计接近（落差 < 0.25）', Math.abs(base.dFirst-base.dLast)<0.25,
     base.dFirst.toFixed(3)+' → '+base.dLast.toFixed(3));

  // 9b 疲劳：内部 d′(t) 单调不增（这一条是真值、确定性），且末段估计均值明显低于首段
  const fat=runSim({d0:1.5,c0:0,useFatigue:true,useDrift:false,seed:12345});
  let mono=true;
  for (let i=1;i<fat.blocks.length;i++) if (fat.blocks[i].d > fat.blocks[i-1].d+1e-12) mono=false;
  ok('疲劳：内部 d′(t) 单调不增（真值，确定性）', mono,
     fat.blocks.map(b=>b.d.toFixed(2)).join(' '));
  ok('疲劳：内部 d′ 从 d₀ 线性掉到 d₀−0.8',
     near(fat.blocks[0].d,1.5,1e-12) && near(fat.blocks[BLOCKS-1].d,0.7,1e-12),
     fat.blocks[0].d+' → '+fat.blocks[BLOCKS-1].d);
  const fatAvg=runSimAvg({d0:1.5,c0:0,useFatigue:true,useDrift:false},60);
  ok('疲劳：末段 d′ 估计均值 < 首段（60 组）', fatAvg.dLast < fatAvg.dFirst-0.3,
     fatAvg.dFirst.toFixed(2)+' → '+fatAvg.dLast.toFixed(2));

  // 9c 漂移。
  // 注意：blocks[].c 并不是逐段单调的 —— 主观 P(S) 是用**抽样出来的** H/M 更新的，
  // 所以 c 上带着抽样噪声（单段约 ±0.03）。能断言的是：(1) 有界、不失控；
  // (2) 整体趋势向上、末段落在一侧；(3) 去掉抽样噪声后（确定性迭代）有唯一不动点。
  const dr=runSim({d0:1.5,c0:0,useFatigue:false,useDrift:true,seed:12345});
  const cs=dr.blocks.map(b=>b.c);
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  ok('漂移：内部 c(t) 始终有界（无失控，全程 < 1.5）', cs.every(v=>v<1.5),
     Math.max.apply(null,cs).toFixed(3));
  ok('漂移：后半程 c 均值 > 前半程（真值趋势向上）',
     mean(cs.slice(6)) > mean(cs.slice(0,6)) + 0.05,
     mean(cs.slice(0,6)).toFixed(3)+' → '+mean(cs.slice(6)).toFixed(3));
  ok('漂移：末段 c > 0（偏保守）', cs[BLOCKS-1] > 0.05, cs[BLOCKS-1]);
  ok('漂移：从 c=0 的中性开局出发，标准被推离中性',
     cs[BLOCKS-1] > cs[0] + 0.05, cs[0].toFixed(3)+' → '+cs[BLOCKS-1].toFixed(3));

  // 不动点：把抽样换成期望值做确定性迭代，看它收敛到哪
  let pS=0.5; const hist=[];
  for (let i=0;i<200;i++){
    const c=cOpt(Math.max(0.02,(1-pS)/pS),1.5);
    const r=modelRates(1.5,c);
    const remembered=(r.pH+2.5*(1-r.pH))/3.5;   // 用期望命中率代替抽样
    pS=clamp(0.75*pS+0.25*remembered,0.05,0.95); hist.push(pS);
  }
  ok('漂移：确定性迭代收敛（末 20 步互相差 < 1e-6）',
     Math.abs(hist[199]-hist[179])<1e-6, hist[199].toFixed(6));
  ok('漂移：不动点约在 P(S)=0.415（c≈+0.23）', near(hist[199],0.415,0.02), hist[199].toFixed(4));
  ok('漂移：不动点偏保守（P(S) < 0.5，即 c > 0）', hist[199] < 0.5);

  const drAvg=runSimAvg({d0:1.5,c0:0,useFatigue:false,useDrift:true},60);
  ok('漂移：漏报率上升（60 组均值）', drAvg.miss > base.miss,
     base.miss.toFixed(3)+' → '+drAvg.miss.toFixed(3));
  ok('漂移：末段 c 估计均值高于首段（60 组）', drAvg.cLast > drAvg.cFirst+0.05,
     drAvg.cFirst.toFixed(3)+' → '+drAvg.cLast.toFixed(3));

  // 9d 开局 c 与滑块一致：漂移模式下第一段的标准应等于你设的 c0
  const dr2=runSim({d0:1.8,c0:0.6,useFatigue:false,useDrift:true,seed:7});
  ok('漂移：第 1 段的标准由滑块 c₀ 反解得到（差 < 1e-9）',
     near(dr2.blocks[0].c, 0.6, 1e-9), dr2.blocks[0].c);

  // 9e 可复现
  const a1=runSim({d0:1.5,c0:0.2,useFatigue:true,useDrift:true,seed:999});
  const a2=runSim({d0:1.5,c0:0.2,useFatigue:true,useDrift:true,seed:999});
  ok('同一 seed 结果完全可复现', a1.cum.H===a2.cum.H && a1.cum.FA===a2.cum.FA);
  ok('不同 seed 结果不同',
     runSim({d0:1.5,c0:0,useFatigue:false,useDrift:false,seed:1}).cum.H !==
     runSim({d0:1.5,c0:0,useFatigue:false,useDrift:false,seed:2}).cum.H);

  // 9f 计数守恒
  ok('每段 H+M = 30 且 FA+CR = 30',
     fat.blocks.every(b=>b.H+b.M===30 && b.FA+b.CR===30));
  ok('累计总数 = 720', fat.cum.H+fat.cum.M+fat.cum.FA+fat.cum.CR === 12*60);
}

console.log('\n== 10. 状态机：d′ 的两种拆法 ==');
{
  S.mode='noise'; S.sigma=0.30; S.delta=1.5*0.30;
  setDPrime(2.0);
  ok('改难度：σ 不动', near(S.sigma,0.30,1e-12), S.sigma);
  ok('改难度：Δ = d′·σ', near(S.delta,0.60,1e-12), S.delta);
  ok('改难度：d′ = 2.0',  near(vPrime(),2.0,1e-12));

  S.mode='task'; setDPrime(1.0);
  ok('改能力：d′ 精确等于滑块值', near(vPrime(),1.0,1e-12), vPrime());
  ok('改能力：σ = Δ/d′',        near(S.sigma,S.delta/1.0,1e-12));

  // 撞到 σ 边界也不能出现"拖了没反应"
  setDPrime(4.0);  ok('σ 上界内 d′ 仍精确',  near(vPrime(),4.0,1e-12), vPrime());
  setDPrime(0.4);  ok('σ 下界内 d′ 仍精确',  near(vPrime(),0.4,1e-12), vPrime());
  setDPrime(99);   ok('超范围被夹到 4.0',    near(vPrime(),4.0,1e-12), vPrime());
  setDPrime(-5);   ok('负值被夹到 0.4',      near(vPrime(),0.4,1e-12), vPrime());
  ok('σ 始终落在 [0.15, 0.60]', S.sigma>=0.15-1e-12 && S.sigma<=0.60+1e-12, S.sigma);

  // 复原
  S.mode='noise'; S.sigma=0.30; S.delta=1.5*0.30;
  ok('切回改难度后 d′ 保持连续', near(vPrime(),1.5,1e-12), vPrime());
}

console.log('\n== 11. SVG 几何（重放每张图的坐标生成）==');
{
  // 用与页面相同的数学复算一遍所有会写进 SVG 的坐标，确认没有 NaN/Infinity 且都在 viewBox 内
  const normPdf = L.normPdf;
  const SIGMA=0.30;
  const pdf=(x,mu,sd)=>normPdf((x-mu)/sd)/sd;
  let coords=0, bad=[], out=[];
  const chk=(v,tag)=>{ coords++;
    if (!isFinite(v)) bad.push(tag+'='+v);
  };
  const inBox=(v,lo,hi,tag)=>{ chk(v,tag); if (isFinite(v) && (v<lo-0.01||v>hi+0.01)) out.push(`${tag}=${v.toFixed(2)} 超出 [${lo},${hi}]`); };

  const X_LADDER=[0.9,1.2,1.5,1.8,2.4,3.2];
  const xhOf=(delta,sigma)=>{ const need=2.6*sigma+delta/2+0.12;
    for(const v of X_LADDER) if(need<=v) return v; return X_LADDER[X_LADDER.length-1]; };

  const cases=[];
  for (const d of [0.4,1.5,2.4,4.0]) for (const c of [-2,-0.7,0,0.7,2]) {
    for (const sigma of [0.15,0.30,0.60]) cases.push({d,c,sigma,delta:d*sigma});
  }
  for (const cs of cases){
    const {d,c,sigma,delta}=cs;
    const xh=xhOf(delta,sigma);
    const W=720,padL=48,padR=20;
    const pxW=W-padL-padR;
    const X=v=>padL+clamp((v+xh)/(2*xh),-0.02,1.02)*pxW;
    const H=330,padT=30,padB=62;
    const pxH=H-padT-padB;
    const yMax=normPdf(0)/sigma*1.16;
    const Y=v=>padT+pxH-clamp(v/yMax,-0.02,1.02)*pxH;
    const muN=-delta/2, muS=delta/2, xc=c*sigma;
    for (const [mu,col] of [[muN,1],[muS,2]]) {
      for (let i=0;i<=260;i++){
        const x=-xh+2*xh*i/260;
        inBox(X(x),0,W,'dist.X'); inBox(Y(pdf(x,mu,sigma)),0,H,'dist.Y');
      }
    }
    inBox(X(xc),0,W,'crit.X');   // 判定标准竖线
    inBox(X(0),0,W,'baseline.X');
  }
  ok(`分布图坐标全部有限（${coords} 个点）`, bad.length===0, bad.slice(0,3).join(', '));
  ok('分布图坐标全部落在 viewBox 内', out.length===0, out.slice(0,3).join(' | '));

  // ROC 坐标
  let rcoords=0, rbad=[], rout=[];
  const G={W:430,H:430,pad:{l:52,r:18,t:18,b:48}};
  const rX=v=>G.pad.l+clamp(v,-0.02,1.02)*(G.W-G.pad.l-G.pad.r);
  const rY=v=>G.pad.t+(G.H-G.pad.t-G.pad.b)-clamp(v,-0.02,1.02)*(G.H-G.pad.t-G.pad.b);
  for (const d of [0.4,1.5,3,4,6,10]) {
    const pts=L.rocCurve(d,160);
    for (const p of pts){
      rcoords+=2;
      if (!isFinite(p[0])||!isFinite(p[1])) rbad.push('nan');
      const px=rX(p[0]), py=rY(p[1]);
      if (px<0||px>G.W||py<0||py>G.H) rout.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
  }
  ok(`ROC 坐标全部有限（${rcoords} 个点）`, rbad.length===0, rbad.slice(0,3).join(','));
  ok('ROC 坐标全部落在 viewBox 内', rout.length===0, rout.slice(0,3).join(' | '));

  // z-ROC 不等方差曲线
  let zbad=0;
  for (const s of [0.5,1,2]) for (const d of [0,1.5,4]) {
    for (const p of L.rocCurveUnequal(d,s,80)) if (!isFinite(p[0])||!isFinite(p[1])) zbad++;
  }
  ok('z-ROC（不等方差）曲线无 NaN', zbad===0);

  // 极端情况：从不挥拍 / 全对，矩阵与 ROC 都不能出 NaN
  const extremes=[{H:0,M:6,FA:0,CR:6},{H:6,M:0,FA:6,CR:0},{H:6,M:0,FA:0,CR:6},{H:0,M:6,FA:6,CR:0}];
  let ebad=[];
  for (const e of extremes){
    const s=statsFromCounts(e);
    if (!isFinite(s.dPrime)||!isFinite(s.cCrit)||!isFinite(s.beta)||!isFinite(s.Aprime))
      ebad.push(JSON.stringify(e));
  }
  ok('四种极端计数都不产生 NaN/Infinity', ebad.length===0, ebad.join(' '));
}

console.log('\n== 12. 端到端：打完一轮 → 游戏的 labURL() → 实验室 parseHash() ==');
{
  // 真打一轮（观察者 σ=1.0 m，与 _smoketest 同一个模型），不手工造 hash。
  const { G, labURL, BN, startGame, swing, gauss, computeStats } = GAME;
  G.diff = 'normal'; G.state = 'play'; G.phase = 'idle';
  startGame();
  let vclock = 0, decided = -2, frames = 0, threw = null;
  try {
    for (let i=0; i<20000; i++){
      if (!rafCb) throw new Error('主循环停止在 frame ' + i);
      const cb = rafCb; rafCb = null;
      cb(vclock); vclock += 16.7; frames++;
      if (G.phase === 'fly' && !G.responded && decided !== G.idx){
        decided = G.idx;
        const tr = G.cur;
        const saysIn = (tr.type === 'none') ? (Math.random() < 0.25)
                                            : ((tr.landZ + gauss()*1.0) > BN);
        if (saysIn) swing();
      }
      if (G.phase === 'done') break;
    }
  } catch(e){ threw = e.message; }
  ok('游戏侧能跑完一整轮', threw === null && G.phase === 'done', threw || G.phase);

  const r = G.results;
  const url = labURL(true);
  const hash = url.slice(url.indexOf('#'));
  ok('labURL(true) 带上了 hash', url.indexOf('#') > 0 && hash.length > 1, url.slice(0,60));

  // 无数据的那条链接不该带 hash，parseHash 应该判空
  global.location.hash = '';
  ok('labURL(false) 不带数据，parseHash 返回 null', parseHash() === null);
  ok('labURL(false) 里确实没有 #', labURL(false).indexOf('#') < 0);

  // 把游戏写的 hash 原样喂给实验室
  global.location.hash = hash;
  const parsed = parseHash();
  ok('实验室能解析游戏写的 hash', parsed !== null, hash.slice(0, 80));

  if (parsed){
    ok('H/M/FA/CR 逐个对上结果页',
       parsed.H === r.H && parsed.M === r.M && parsed.FA === r.FA && parsed.CR === r.CR,
       `传入 ${parsed.H}/${parsed.M}/${parsed.FA}/${parsed.CR} vs 结果页 ${r.H}/${r.M}/${r.FA}/${r.CR}`);
    ok('难度标签传过来了', parsed.diff === G.diff, parsed.diff + ' vs ' + G.diff);

    const realTrials = (G.trials||[]).filter(t => t.type !== 'none' && typeof t.landZ === 'number');
    ok('落点个数 = 真发出去的球数', parsed.trials.length === realTrials.length,
       `${parsed.trials.length} vs ${realTrials.length}（共 ${(G.trials||[]).length} 球，含空发球）`);
    // 符号约定：余量 = landZ − BN，界内为正、界外为负 —— 这是和 rug 图对齐的关键
    ok('每个落点的正负号与界内/界外一致',
       parsed.trials.every(t => t.in ? t.margin > 0 : t.margin < 0),
       JSON.stringify(parsed.trials.filter(t => t.in ? t.margin <= 0 : t.margin >= 0)));

    // ⑥ 的成绩卡数字必须与结果页一字不差
    S.mine = parsed;
    const a = mineStats(), b = computeStats(r);
    ok('⑥ 成绩卡的 d′ 与结果页一致', Math.abs(a.dPrime - b.dPrime) < 1e-9,
       `${a.dPrime} vs ${b.dPrime}`);
    ok('⑥ 成绩卡的 c 与结果页一致', Math.abs(a.cCrit - b.cCrit) < 1e-9,
       `${a.cCrit} vs ${b.cCrit}`);
    ok('⑥ 成绩卡的 β 与结果页一致', Math.abs(a.beta - b.beta) < 1e-9,
       `${a.beta} vs ${b.beta}`);
    ok('⑥ 成绩卡的 A′ 与结果页一致', Math.abs(a.Aprime - b.Aprime) < 1e-9,
       `${a.Aprime} vs ${b.Aprime}`);
    // 游戏的设计是 12 球 = 6 界内（信号）+ 4 界外 + 2 空发球（后两者都算噪音试次），
    // 不是 12/12，所以对着 G.trials 的真实构成断言，别写死数字。
    const nSig = (G.trials||[]).filter(t => t.type === 'in').length;
    const nNoi = (G.trials||[]).length - nSig;
    ok('信号/噪音试次数与这一轮的真实构成一致',
       a.nS === nSig && a.nN === nNoi && a.nS + a.nN === 12,
       `实验室 ${a.nS}/${a.nN}，本轮实际 ${nSig}/${nNoi}（6 界内 + 4 界外 + 2 空发球）`);
    S.mine = null;
  }
}

console.log('\n== 13. 页面自洽（防止 HTML 里的写死值与脚本脱节）==');
{
  ok('页面里没有残留的 ${ 模板未展开', !/\$\{[^}]*\}/.test(html.replace(/<script>[\s\S]*?<\/script>/g,'')));
  ok('六个 tab 的面板与按钮一一对应', (()=>{
    const btns=[...html.matchAll(/<button data-t="(t\d)"/g)].map(x=>x[1]);
    const panels=[...html.matchAll(/<section class="panel[^"]*" id="(t\d)"/g)].map(x=>x[1]);
    return btns.length===6 && panels.length===6 && btns.every((b,i)=>b===panels[i]);
  })());
  ok('每个 panel 的标签闭合平衡', (()=>{
    const secs=html.split(/<section class="panel/).slice(1);
    return secs.every(seg=>{
      const body=seg.split('</section>')[0];
      const o=(body.match(/<div\b/g)||[]).length, c=(body.match(/<\/div>/g)||[]).length;
      return o===c;
    });
  })(), (()=>{
    const secs=html.split(/<section class="panel/).slice(1);
    return secs.map((seg,i)=>{ const b=seg.split('</section>')[0];
      return `t${i+1}:${(b.match(/<div\b/g)||[]).length}/${(b.match(/<\/div>/g)||[]).length}`; }).join(' ');
  })());
  ok('表格标签闭合平衡', (()=>{
    const o=(html.match(/<table\b/g)||[]).length, c=(html.match(/<\/table>/g)||[]).length;
    return o===c;
  })(), `${(html.match(/<table\b/g)||[]).length} 开 / ${(html.match(/<\/table>/g)||[]).length} 闭`);
  const palette=['#bf8a20','#3a86d0','#e05a78'];
  ok('三条曲线/测点用的都是校验通过的色值',
     palette.every(p=>html.includes(p)), palette.join(' '));
  ok('实验室脚本读的是 URL hash（不是 sessionStorage）',
     !/sessionStorage/.test(js) && /location\.hash/.test(js));

  // 游戏侧的接线：两个入口 + 每次渲染结果页时重新写 href。
  // 少了任何一处，学生就从游戏走不进实验室，而这是整条链最容易被重构碰掉的一环。
  ok('游戏开始页有进实验室的链接（#labLink）', /id="labLink"/.test(gameHtml));
  ok('游戏结果页有进实验室的按钮（#btnLab）', /id="btnLab"/.test(gameHtml));
  ok('两个入口都指向实验室这个文件名',
     (gameHtml.match(/概念实验室\.html/g)||[]).length >= 1
     && /LAB_FILE\s*=\s*'信号检测论-网球-概念实验室\.html'/.test(gameJs));
  ok('结果页每次渲染都重写 href（把这一轮的数据带上）',
     /wireLabLinks\s*\(\s*\)\s*;/.test(gameJs)
     && (gameJs.match(/wireLabLinks\s*\(\s*\)\s*;/g)||[]).length >= 2);
  ok('按钮带的是这一轮的数据，开始页那条不带',
     /labURL\(true\)/.test(gameJs) && /labURL\(false\)/.test(gameJs));
}

console.log(`\n${'='.repeat(52)}`);
console.log(`  ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(52) + '\n');
process.exit(fail ? 1 : 0);
