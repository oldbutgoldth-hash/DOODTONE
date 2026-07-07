/**
 * ui/tone-curve-renderer.js
 *
 * Canvas: Summary banner · 4 curve panels (Master/R/G/B) ·
 *         Overlay view · Stats table · XMP export buttons
 *
 * Each panel shows:
 *   - Luminance histogram as background
 *   - Spline curve with fill
 *   - Control points
 *   - BP / WP / gamma annotations
 */

const PAD=14, GAP=10, LABEL_H=20, CURVE_SZ=130, STATS_H=14, BANNER_H=28;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

const CH_CFG={
  master:{label:'Master (RGB)', color:'#f07320',         fill:'rgba(240,115,32,.12)', icon:'◐'},
  red:   {label:'Red Channel',  color:'rgba(220,60,60,1)',fill:'rgba(220,60,60,.10)', icon:'🔴'},
  green: {label:'Green Channel',color:'rgba(40,180,60,1)',fill:'rgba(40,180,60,.10)', icon:'🟢'},
  blue:  {label:'Blue Channel', color:'rgba(60,110,220,1)',fill:'rgba(60,110,220,.10)',icon:'🔵'},
};
const CH_ORDER=['master','red','green','blue'];

function mkT(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)',bg:dark?'#1e1710':'#fdfaf5',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

export function renderToneCurves(canvas, result, histStats, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;

  const colW=Math.floor((W-PAD*2-GAP)/2);
  const ROW1_H=CURVE_SZ+LABEL_H+10;  // top 2 curves
  const ROW2_H=CURVE_SZ+LABEL_H+10;  // bottom 2 curves
  const STAT_ROWS=4;
  const totalH=PAD
    +LABEL_H+BANNER_H+GAP
    +LABEL_H+ROW1_H+GAP+ROW2_H+GAP
    +LABEL_H+STAT_ROWS*(STATS_H+4)
    +PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Banner
  _sec(ctx,PAD,y,'Tone Curve AI — RGB · Red · Green · Blue',T); y+=LABEL_H;
  _banner(ctx,PAD,y,W-PAD*2,BANNER_H,result,T); y+=BANNER_H+GAP;

  // 2. 4 curve panels (2×2)
  _sec(ctx,PAD,y,'Generated Curves',T); y+=LABEL_H;

  ['master','red'].forEach((ch,i)=>{
    _curvePanel(ctx, PAD+i*(colW+GAP), y, colW, CURVE_SZ, ch, result[ch], histStats, T);
  });
  y+=ROW1_H+GAP;
  ['green','blue'].forEach((ch,i)=>{
    _curvePanel(ctx, PAD+i*(colW+GAP), y, colW, CURVE_SZ, ch, result[ch], histStats, T);
  });
  y+=ROW2_H+GAP;

  // 3. Stats table
  _sec(ctx,PAD,y,'Channel Statistics & Reasoning',T); y+=LABEL_H;
  CH_ORDER.forEach((ch,i)=>{
    _statRow(ctx,PAD,y+i*(STATS_H+4),W-PAD*2,STATS_H,ch,result[ch],T);
  });
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function _banner(ctx,x,y,w,h,result,T){
  ctx.save();
  ctx.fillStyle='rgba(240,115,32,.1)'; ctx.strokeStyle=T.orange; ctx.lineWidth=1.5;
  _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.text; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`〰️  Tone Curve — ${result.category}`,x+12,y+h/2);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='right';
  let s=result.summary; while(s.length>4&&ctx.measureText(s).width>w-200) s=s.slice(0,-1);
  ctx.fillText(s,x+w-10,y+h/2);
  ctx.restore();
}

// ─── Single curve panel ───────────────────────────────────────────────────────
function _curvePanel(ctx,x,y,w,h,ch,curveResult,histStats,T){
  const cfg=CH_CFG[ch];
  const inner=h-LABEL_H-10, ip=16;  // inner padding
  const cx=x+ip, cy=y+LABEL_H+4, cw=w-ip*2, ch2=inner;

  // Card background
  ctx.save();
  ctx.fillStyle=T.panel; ctx.strokeStyle=T.border; ctx.lineWidth=1;
  _rr(ctx,x,y,w,h+LABEL_H+6,10); ctx.fill(); ctx.stroke();

  // Top label bar
  ctx.fillStyle=cfg.color; _rr(ctx,x,y,w,3,[8,8,0,0]); ctx.fill();
  ctx.fillStyle=T.label; ctx.font='700 8.5px Inter,sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(`${cfg.icon} ${cfg.label}`.toUpperCase(),x+10,y+6);

  // BP / WP / gamma inline
  ctx.fillStyle=T.sub; ctx.font=FONT_MONO; ctx.textAlign='right'; ctx.textBaseline='top';
  ctx.fillText(`BP:${curveResult.blackPoint} WP:${curveResult.whitePoint} γ:${curveResult.gamma}`,x+w-8,y+6);

  // Curve canvas area
  ctx.fillStyle=T.bg; _rr(ctx,cx,cy,cw,ch2,4); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=.5; ctx.stroke();

  // Histogram overlay (luminance)
  if (histStats?.histL) {
    const hist = ch==='red'   ? histStats.histR??histStats.histL
               : ch==='green' ? histStats.histG??histStats.histL
               : ch==='blue'  ? histStats.histB??histStats.histL
               : histStats.histL;
    _drawHistOverlay(ctx,cx,cy,cw,ch2,hist,T);
  }

  // Grid
  _drawGrid(ctx,cx,cy,cw,ch2,T);

  // Diagonal reference
  ctx.save(); ctx.strokeStyle=T.grid; ctx.lineWidth=.75; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(cx,cy+ch2); ctx.lineTo(cx+cw,cy); ctx.stroke(); ctx.setLineDash([]); ctx.restore();

  // Curve fill + line
  const pts=curveResult.points;
  _drawCurveFill(ctx,cx,cy,cw,ch2,pts,cfg.fill);
  _drawCurveLine(ctx,cx,cy,cw,ch2,pts,cfg.color);

  // Control points
  _drawPoints(ctx,cx,cy,cw,ch2,pts,cfg.color,T);

  // X-axis ticks
  ctx.fillStyle=T.sub; ctx.font='7.5px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
  [0,64,128,192,255].forEach(v=>ctx.fillText(v,cx+(v/255)*cw,cy+ch2+2));

  ctx.restore();
}

// ─── Histogram overlay ────────────────────────────────────────────────────────
function _drawHistOverlay(ctx,x,y,w,h,hist,T){
  const max=Math.max(...hist)||1;
  ctx.save(); ctx.fillStyle=T.grid;
  ctx.beginPath(); ctx.moveTo(x,y+h);
  for(let i=0;i<256;i++) ctx.lineTo(x+(i/255)*w, y+h-(hist[i]/max)*h*0.9);
  ctx.lineTo(x+w,y+h); ctx.closePath(); ctx.fill(); ctx.restore();
}

// ─── Grid ─────────────────────────────────────────────────────────────────────
function _drawGrid(ctx,x,y,w,h,T){
  ctx.save(); ctx.strokeStyle=T.grid; ctx.lineWidth=.5;
  [1,2,3].forEach(i=>{
    const v=(w/4)*i; ctx.beginPath(); ctx.moveTo(x+v,y); ctx.lineTo(x+v,y+h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x,y+(h/4)*i); ctx.lineTo(x+w,y+(h/4)*i); ctx.stroke();
  });
  ctx.restore();
}

// ─── Curve fill ───────────────────────────────────────────────────────────────
function _drawCurveFill(ctx,x,y,w,h,pts,fill){
  const {evaluateCurve:ev}=_getCurveEval();
  ctx.save(); ctx.fillStyle=fill;
  ctx.beginPath(); ctx.moveTo(x,y+h);
  for(let i=0;i<=255;i++) ctx.lineTo(x+(i/255)*w, y+h-(ev(pts,i)/255)*h);
  ctx.lineTo(x+w,y+h); ctx.closePath(); ctx.fill(); ctx.restore();
}

// ─── Curve line ───────────────────────────────────────────────────────────────
function _drawCurveLine(ctx,x,y,w,h,pts,color){
  const {evaluateCurve:ev}=_getCurveEval();
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineJoin='round';
  ctx.beginPath(); ctx.moveTo(x,y+h-(ev(pts,0)/255)*h);
  for(let i=1;i<=255;i++) ctx.lineTo(x+(i/255)*w, y+h-(ev(pts,i)/255)*h);
  ctx.stroke(); ctx.restore();
}

// ─── Control points ───────────────────────────────────────────────────────────
function _drawPoints(ctx,x,y,w,h,pts,color,T){
  ctx.save();
  pts.forEach(pt=>{
    const px=x+(pt.x/255)*w, py=y+h-(pt.y/255)*h;
    ctx.fillStyle=color; ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(px,py,2,0,Math.PI*2); ctx.fill();
  });
  ctx.restore();
}

// ─── Stat row ─────────────────────────────────────────────────────────────────
function _statRow(ctx,x,y,w,h,ch,curveResult,T){
  ctx.save();
  const cfg=CH_CFG[ch];
  const lw=100, bx=x+lw, bw=w-lw-120;
  ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${cfg.icon} ${cfg.label}`,x,y+h/2);
  // Mini curve preview bar (gamma indicator)
  ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,bx,y,bw,h,3); ctx.fill(); ctx.stroke();
  const gx=bx+(curveResult.gamma/2)*Math.min(bw,bw); // gamma 0-2 → 0-bw
  const gcol=curveResult.gamma>1.05?T.ok:curveResult.gamma<0.95?T.err:T.sub;
  ctx.fillStyle=gcol+'88'; _rr(ctx,bx,y,Math.min(gx-bx,bw),h,3); ctx.fill();
  ctx.strokeStyle=gcol; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(gx,y-1); ctx.lineTo(gx,y+h+1); ctx.stroke();
  // Stats
  ctx.fillStyle=cfg.color; ctx.font=FONT_MONO; ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillText(`γ:${curveResult.gamma}  BP:${curveResult.blackPoint}  WP:${curveResult.whitePoint}`,x+w,y+h/2);
  ctx.restore();
}

// ─── Curve evaluator (self-contained Catmull-Rom) ─────────────────────────────
function _getCurveEval(){
  const ev=(pts,x)=>{
    if(pts.length<2)return x;
    if(x<=pts[0].x)return pts[0].y;
    if(x>=pts[pts.length-1].x)return pts[pts.length-1].y;
    let i=1;while(i<pts.length-1&&pts[i].x<x)i++;
    const p0=pts[Math.max(0,i-2)],p1=pts[i-1],p2=pts[i],p3=pts[Math.min(pts.length-1,i+1)];
    const t=(x-p1.x)/(p2.x-p1.x||1);
    const t2=t*t,t3=t2*t;
    const y2=0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3);
    return Math.max(0,Math.min(255,Math.round(y2)));
  };
  return {evaluateCurve:ev};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _sec(ctx,x,y,text,T){ctx.save();ctx.fillStyle=T.label;ctx.font=FONT;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);const tw=ctx.measureText(text.toUpperCase()).width;ctx.strokeStyle=T.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+tw+8,y+LABEL_H/2);ctx.lineTo(x+9999,y+LABEL_H/2);ctx.stroke();ctx.restore();}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
