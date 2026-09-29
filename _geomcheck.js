// 校验：把实际试次的落点投影到屏幕，看是否与「近端底线在 80% 屏高」自洽
// 路径相对本文件，别写绝对路径：目录名和文件名都不该出现在代码里
const fs=require('fs'), nodePath=require('path');
const html=fs.readFileSync(nodePath.join(__dirname,'index.html'),'utf8');
const js=/<script>([\s\S]*?)<\/script>/.exec(html)[1];
const grad={addColorStop(){}};
function mkCtx(){const c={};for(const k of ['setTransform','clearRect','fillRect','beginPath','moveTo','lineTo','closePath','fill','stroke','arc','ellipse','arcTo','roundRect','save','restore','translate','rotate','fillText','strokeText','clip','setLineDash'])c[k]=()=>{};c.createLinearGradient=()=>grad;c.createRadialGradient=()=>grad;c.measureText=()=>({width:10});return c;}
function mkEl(){return{style:{},dataset:{},innerHTML:'',textContent:'',classList:{add(){},remove(){},contains(){return false}},addEventListener(){},closest(){return null},getBoundingClientRect:()=>({width:1280,height:720}),getContext:()=>mkCtx(),width:260,height:260};}
global.document={getElementById:mkEl,querySelectorAll:()=>[]};
global.window={addEventListener(){},devicePixelRatio:1};
global.performance={now:()=>Date.now()};
global.requestAnimationFrame=()=>{};
global.CanvasRenderingContext2D=function(){}; global.CanvasRenderingContext2D.prototype={};
(0,eval)(js+'\n;globalThis.__a={proj,BN,BF,HLW_D,buildTrials,DIFF,G,W,H,FOC,CX,CY,CAM_Y,CAM_Z,PITCH};');
const {proj,BN,BF,HLW_D,buildTrials,DIFF,G,W,H,FOC,CX,CY}=globalThis.__a;

console.log(`画布 ${W}x${H}  焦距 f=${FOC.toFixed(1)}  画心 y=${CY}`);
const at=(z,label)=>{const p=proj(0,0,z);console.log(`  ${label.padEnd(22)} z=${String(z.toFixed(2)).padStart(8)}  ->  y=${p.y.toFixed(0)}  (${(p.y/H*100).toFixed(1)}%)`);};
console.log('\n场地基准线：');
at(BF,'远端底线 (z=+11.885)');
at(6.40,'远发球线 (z=+6.40)');
at(0,'球网 (z=0)');
at(-6.40,'近发球线 (z=-6.40)');
at(BN,'近端底线 (z=-11.885)');

console.log('\n实际试次落点（各 300 次采样，看 y 的分布）：');
for(const d of ['easy','normal','hard']){
  G.diff=d;
  const ys={in:[],out:[]};
  for(let k=0;k<300;k++) for(const t of buildTrials()){
    if(t.type==='in'||t.type==='out'){ const p=proj(t.landX,0,t.landZ); ys[t.type].push(p.y); }
  }
  const rng=a=>`${Math.min(...a).toFixed(0)}..${Math.max(...a).toFixed(0)}`;
  console.log(`  ${d.padEnd(7)} 界内球 y=${rng(ys.in)}   界外球 y=${rng(ys.out)}   (底线在 y=${proj(0,0,BN).y.toFixed(0)})`);
}
console.log('\n结论：界内球的 y 必须全部 < 底线 y，界外球必须全部 > 底线 y');
G.diff='normal';
let bad=0, n=0;
for(let k=0;k<2000;k++) for(const t of buildTrials()){
  if(t.type!=='in'&&t.type!=='out') continue;
  const y=proj(t.landX,0,t.landZ).y, yb=proj(0,0,BN).y;
  n++;
  if(t.type==='in' && !(y<yb)) bad++;
  if(t.type==='out'&& !(y>yb)) bad++;
}
console.log(`  检查 ${n} 个落点，屏幕位置与界内/界外不符的：${bad}`);
