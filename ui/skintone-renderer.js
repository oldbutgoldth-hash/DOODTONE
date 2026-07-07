/**
 * ui/skintone-renderer.js
 * Canvas: Identity card · Model agreement · HSL metrics ·
 *         Hue histogram · Luminance histogram · Recommendation
 */

const PAD=14,GAP=10,LABEL_H=20,BAR_H=14,HIST_H=60;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

const FITZ_C={'I':{bg:'#f5d8c0',fg:'#5a3010'},'II':{bg:'#e8b899',fg:'#5a2808'},'III':{bg:'#c98a60',fg:'#fff'},'IV':{bg:'#9a5c32',fg:'#fff'},'V':{bg:'#6b3818',fg:'#fff'},'VI':{bg:'#3a1c08',fg:'#e0c0a0'}};

function T(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',panelB:dark?'rgba(40,28,14,.45)':'rgba(248,240,230,.70)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

export function renderSkinTone(canvas, result, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const th=T(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;

  const MODEL_H=(BAR_H+4)*4, HSL_H=(BAR_H+4)*3, CARD_H=90;
  const totalH=PAD+LABEL_H+CARD_H+GAP+LABEL_H+MODEL_H+GAP+LABEL_H+HSL_H+GAP+LABEL_H+HIST_H+GAP+LABEL_H+HIST_H+GAP+LABEL_H+56+PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Identity card
  _sec(ctx,PAD,y,`Skin Tone Detection  ·  Coverage ${result.coveragePct}%  ·  ${result.toneLabel}`,th); y+=LABEL_H;
  _identityCard(ctx,PAD,y,W-PAD*2,CARD_H,result,th); y+=CARD_H+GAP;

  // 2. Model agreement
  _sec(ctx,PAD,y,'Model Agreement (% of sampled pixels)',th); y+=LABEL_H;
  const ma=result.modelAgreement;
  [
    ['RGB Model (Kovac et al.)',       ma.rgb,       'rgba(220,60,60,.85)'],
    ['HSV Model (Chai & Ngan)',        ma.hsv,       'rgba(240,160,40,.85)'],
    ['YCbCr Model (BT.601)',           ma.ycbcr,     'rgba(60,110,220,.85)'],
    ['Consensus (≥2 models)',          ma.consensus, th.orange],
  ].forEach(([lbl,pct,color],i)=>_metricBar(ctx,PAD,y+i*(BAR_H+4),W-PAD*2,BAR_H,lbl,pct,100,color,th,'%'));
  y+=MODEL_H+GAP;

  // 3. HSL metrics
  _sec(ctx,PAD,y,'Average Skin HSL (consensus pixels)',th); y+=LABEL_H;
  const {h,s,l}=result.avgHSL;
  _hslBar(ctx,PAD,y,              W-PAD*2,BAR_H,'Hue',       h,360,th);
  _hslBar(ctx,PAD,y+(BAR_H+4),   W-PAD*2,BAR_H,'Saturation',s,100,th);
  _hslBar(ctx,PAD,y+(BAR_H+4)*2, W-PAD*2,BAR_H,'Luminance', l,100,th);
  y+=HSL_H+GAP;

  // 4. Hue histogram
  _sec(ctx,PAD,y,'Skin Pixel Hue Distribution (0° – 360°)',th); y+=LABEL_H;
  _bucketHist(ctx,PAD,y,W-PAD*2,HIST_H,result.hueHistogram,th,'hue'); y+=HIST_H+GAP;

  // 5. Luminance histogram
  _sec(ctx,PAD,y,'Skin Pixel Luminance Distribution',th); y+=LABEL_H;
  _bucketHist(ctx,PAD,y,W-PAD*2,HIST_H,result.luminanceHistogram,th,'lum'); y+=HIST_H+GAP;

  // 6. Recommendation
  _sec(ctx,PAD,y,'Lightroom Recommendation',th); y+=LABEL_H;
  _recCard(ctx,PAD,y,W-PAD*2,56,result.recommendation,th);
}

// ── Identity card ─────────────────────────────────────────────────────────────
function _identityCard(ctx,x,y,w,h,result,th) {
  _card(ctx,x,y,w,h,th);
  const fc=FITZ_C[result.fitzpatrickScale]??FITZ_C['III'];
  const sw=68;
  ctx.save();

  // Swatch
  ctx.fillStyle=result.hex; _rr(ctx,x+10,y+10,sw,h-20,10); ctx.fill();
  ctx.strokeStyle=th.border; ctx.lineWidth=1; ctx.stroke();

  // Fitzpatrick badge
  ctx.fillStyle=fc.bg; _rr(ctx,x+10,y+h-28,sw,18,[0,0,10,10]); ctx.fill();
  ctx.fillStyle=fc.fg; ctx.font='700 10px Inter,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Type '+result.fitzpatrickScale, x+10+sw/2, y+h-19);

  // Text block
  const tx=x+sw+22; let ty=y+12; const lh=13;
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillStyle=th.text; ctx.font='700 13px Inter,sans-serif'; ctx.fillText(result.toneLabel,tx,ty); ty+=lh+2;
  ctx.fillStyle=th.orange; ctx.font='700 10.5px "JetBrains Mono",monospace'; ctx.fillText(result.hex.toUpperCase(),tx,ty); ty+=lh;
  ctx.fillStyle=th.sub; ctx.font=FONT_MONO;
  const {r,g,b}=result.avgRGB; ctx.fillText(`rgb(${r}, ${g}, ${b})`,tx,ty); ty+=lh;
  const {h:hh,s:ss,l:ll}=result.avgHSL; ctx.fillText(`hsl(${hh}°, ${ss}%, ${ll}%)`,tx,ty); ty+=lh;
  const {y:Y,cb,cr}=result.avgYCbCr; ctx.fillText(`YCbCr(${Y}, ${cb}, ${cr})`,tx,ty);

  // Coverage badge
  const covT=result.detected?`✓ ${result.coveragePct}% skin`:'✗ Not detected';
  const covC=result.detected?(result.coveragePct>15?th.ok:th.warn):th.err;
  const bw=88,bh=17;
  ctx.fillStyle=covC+'22'; ctx.strokeStyle=covC; ctx.lineWidth=1;
  _rr(ctx,x+w-bw-10,y+10,bw,bh,6); ctx.fill(); ctx.stroke();
  ctx.fillStyle=covC; ctx.font='700 8.5px Inter,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(covT, x+w-bw/2-10, y+10+bh/2);
  ctx.restore();
}

// ── Metric bar ────────────────────────────────────────────────────────────────
function _metricBar(ctx,x,y,w,h,label,value,max,color,th,sfx='') {
  ctx.save();
  ctx.fillStyle=th.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(label,x,y+h/2);
  const lw=168,bx=x+lw,bw=w-lw-44;
  ctx.fillStyle=th.grid; ctx.strokeStyle=th.border; ctx.lineWidth=.5; _rr(ctx,bx,y,bw,h,4); ctx.fill(); ctx.stroke();
  const fw=Math.max(3,(value/max)*bw); ctx.fillStyle=color; _rr(ctx,bx,y,fw,h,4); ctx.fill();
  ctx.fillStyle=th.text; ctx.font=FONT_MONO; ctx.textAlign='right';
  ctx.fillText(`${(+value).toFixed(1)}${sfx}`,x+w,y+h/2);
  ctx.restore();
}

// ── HSL bar (coloured gradient track) ────────────────────────────────────────
function _hslBar(ctx,x,y,w,h,label,value,max,th) {
  ctx.save();
  ctx.fillStyle=th.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(label,x,y+h/2);
  const lw=80,bx=x+lw,bw=w-lw-44;
  let g;
  if(label==='Hue'){
    g=ctx.createLinearGradient(bx,0,bx+bw,0);
    [0,30,60,90,120,150,180,210,240,270,300,330,360].forEach(d=>g.addColorStop(d/360,`hsl(${d},80%,55%)`));
  } else if(label==='Saturation'){
    g=ctx.createLinearGradient(bx,0,bx+bw,0); g.addColorStop(0,'#ccc'); g.addColorStop(1,'hsl(25,90%,55%)');
  } else {
    g=ctx.createLinearGradient(bx,0,bx+bw,0); g.addColorStop(0,'#111'); g.addColorStop(.5,'#888'); g.addColorStop(1,'#fff');
  }
  ctx.fillStyle=g; ctx.strokeStyle=th.border; ctx.lineWidth=1; _rr(ctx,bx,y,bw,h,4); ctx.fill(); ctx.stroke();
  const nx=bx+(value/max)*bw; ctx.strokeStyle=th.text; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(nx,y-2); ctx.lineTo(nx,y+h+2); ctx.stroke();
  ctx.fillStyle=th.text; ctx.font=FONT_MONO; ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillText(`${Math.round(value)}${label==='Hue'?'°':'%'}`,x+w,y+h/2);
  ctx.restore();
}

// ── Bucket histogram ──────────────────────────────────────────────────────────
function _bucketHist(ctx,x,y,w,h,buckets,th,mode) {
  _card(ctx,x,y,w,h+16,th);
  const bx=x+8,by=y+4,bw=w-16,bh=h-14,n=buckets.length;
  const barW=bw/n,max=Math.max(...buckets,.01);
  ctx.save();
  buckets.forEach((val,i)=>{
    const bxI=bx+i*barW, fh=(val/max)*bh, byI=by+bh-fh;
    ctx.fillStyle=mode==='hue'?`hsl(${(i/n)*360},75%,55%)`:`hsl(30,20%,${20+(i/n)*60}%)`;
    _rr(ctx,bxI+1,byI,Math.max(1,barW-2),fh,2); ctx.fill();
  });
  ctx.fillStyle=th.sub; ctx.font='8px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
  if(mode==='hue'){
    [0,60,120,180,240,300,360].forEach(d=>ctx.fillText(d+'°',bx+(d/360)*bw,by+bh+2));
  } else {
    [['Dark',.0],['Mid',.5],['Light',1]].forEach(([l,p])=>ctx.fillText(l,bx+p*bw,by+bh+2));
  }
  ctx.restore();
}

// ── Recommendation card ───────────────────────────────────────────────────────
function _recCard(ctx,x,y,w,h,text,th) {
  ctx.save();
  ctx.fillStyle=th.panelB; ctx.strokeStyle=th.orange+'44'; ctx.lineWidth=1;
  _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.font='13px sans-serif'; ctx.textBaseline='top'; ctx.textAlign='left'; ctx.fillText('💡',x+10,y+8);
  ctx.fillStyle=th.text; ctx.font='500 9px Inter,sans-serif'; ctx.textAlign='left';
  _wrap(ctx,text,x+30,y+10,w-42,12);
  ctx.restore();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _sec(ctx,x,y,text,th){
  ctx.save(); ctx.fillStyle=th.label; ctx.font=FONT; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);
  const tw=ctx.measureText(text.toUpperCase()).width;
  ctx.strokeStyle=th.border; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(x+tw+8,y+LABEL_H/2); ctx.lineTo(x+9999,y+LABEL_H/2); ctx.stroke();
  ctx.restore();
}
function _card(ctx,x,y,w,h,th){
  ctx.save(); ctx.fillStyle=th.panel; ctx.strokeStyle=th.border; ctx.lineWidth=1;
  _rr(ctx,x,y,w,h,10); ctx.fill(); ctx.stroke(); ctx.restore();
}
function _wrap(ctx,text,x,y,maxW,lh){
  const words=text.split(' '); let line='',cy=y;
  for(const w of words){const t=line?line+' '+w:w;if(ctx.measureText(t).width>maxW&&line){ctx.fillText(line,x,cy);line=w;cy+=lh;}else line=t;}
  if(line)ctx.fillText(line,x,cy);
}
function _rr(ctx,x,y,w,h,r){
  const rd=Array.isArray(r)?r:[r,r,r,r]; ctx.beginPath();
  if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}
  else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}
}
