/**
 * ui/histogram-renderer.js
 * Canvas panels: RGB Histogram · Luminance · Dynamic Range ·
 *               Highlight Clip · Shadow Clip · Contrast Ratio · Tonal Map
 */

const PAD = 14, GAP = 10, LABEL_H = 18, MINI_H = 18;

function th(dark) {
  return {
    panel:  dark ? 'rgba(30,20,10,.55)' : 'rgba(255,255,255,.6)',
    border: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)',
    label:  dark ? '#b89e84' : '#6b5843',
    grid:   dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)',
    text:   dark ? '#f0e6d8' : '#1c160e',
  };
}

export function renderHistograms(canvas, stats, opts = {}) {
  const dark = opts.dark ?? document.documentElement.classList.contains('dark');
  const T    = th(dark);
  const dpr  = Math.min(window.devicePixelRatio || 1, 2);
  const W    = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 560;
  const colW = Math.floor((W - PAD*2 - GAP) / 2);
  const histH = 100;

  const totalH = PAD
    + (LABEL_H + histH + GAP) * 2
    + (LABEL_H + MINI_H + GAP) * 3
    + LABEL_H + MINI_H + PAD;

  canvas.width  = W * dpr;
  canvas.height = totalH * dpr;
  canvas.style.height = totalH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, totalH);

  let y = PAD;

  // Row 1: RGB | Luminance
  _histPanel(ctx, PAD,           y, colW, histH, stats, 'rgb',  T);
  _histPanel(ctx, PAD+colW+GAP,  y, colW, histH, stats, 'lum',  T);
  y += LABEL_H + histH + GAP;

  // Row 2: RGB mini (2nd view) | repeat lum
  _histPanel(ctx, PAD,           y, colW, histH, stats, 'lum2', T);
  _contrastGauge(ctx, PAD+colW+GAP, y, colW, T, stats);
  y += LABEL_H + histH + GAP;

  // Row 3: Dynamic Range
  _drBar(ctx, PAD, y, W-PAD*2, T, stats);
  y += LABEL_H + MINI_H + GAP;

  // Row 4: Highlight Clip | Shadow Clip
  _clipBar(ctx, PAD,          y, colW, T, stats, 'hi');
  _clipBar(ctx, PAD+colW+GAP, y, colW, T, stats, 'lo');
  y += LABEL_H + MINI_H + GAP;

  // Row 5: Tonal Map (full width)
  _tonalMap(ctx, PAD, y, W-PAD*2, T, stats);
}

// ── Histogram panel ───────────────────────────────────────────────────────────
function _histPanel(ctx, x, y, w, h, stats, mode, T) {
  _card(ctx, x, y, w, LABEL_H + h, T);
  _lbl(ctx, x, y, mode === 'rgb' ? 'RGB Histogram'
       : mode === 'lum2' ? `Luminance  ·  med ${stats.median}  ·  avg ${stats.avgLum}`
       : `Luminance Histogram  ·  median ${stats.median}`, T);

  const cx = x+8, cy = y+LABEL_H+4, cw = w-16, ch = h-8;
  _grid(ctx, cx, cy, cw, ch, T);

  if (mode === 'rgb') {
    _channel(ctx, cx,cy,cw,ch, stats.histR, 'rgba(220,60,60,.5)',   'rgba(220,60,60,.9)');
    _channel(ctx, cx,cy,cw,ch, stats.histG, 'rgba(50,180,70,.5)',   'rgba(40,160,60,.9)');
    _channel(ctx, cx,cy,cw,ch, stats.histB, 'rgba(60,100,220,.5)',  'rgba(50,90,210,.9)');
    _legend(ctx, cx+cw-70, cy+4, T);
  } else {
    _channel(ctx, cx,cy,cw,ch, stats.histL, '#c8b89a', '#a89070');
    // Median line
    const mx = cx + (stats.median/255)*cw;
    ctx.save(); ctx.strokeStyle='#f07320'; ctx.lineWidth=1.5; ctx.setLineDash([3,2]);
    ctx.beginPath(); ctx.moveTo(mx,cy); ctx.lineTo(mx,cy+ch); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }
  // X ticks
  ctx.save(); ctx.fillStyle=T.label; ctx.font='9px Inter,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='top';
  [0,64,128,192,255].forEach(v => ctx.fillText(v, cx+(v/255)*cw, cy+ch+2));
  ctx.restore();
}

function _channel(ctx, x,y,w,h, hist, fill, stroke) {
  const max = Math.max(...hist); if(!max)return;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(x, y+h);
  for(let i=0;i<256;i++) ctx.lineTo(x+(i/255)*w, y+h-(hist[i]/max)*h);
  ctx.lineTo(x+w,y+h); ctx.closePath();
  ctx.fillStyle=fill; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x,y+h);
  for(let i=0;i<256;i++) ctx.lineTo(x+(i/255)*w, y+h-(hist[i]/max)*h);
  ctx.lineTo(x+w,y+h); ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.stroke();
  ctx.restore();
}

function _legend(ctx, x, y, T) {
  const items=[['R','rgba(220,60,60,.9)'],['G','rgba(40,160,60,.9)'],['B','rgba(50,90,210,.9)']];
  ctx.save(); ctx.font='600 9px Inter,sans-serif'; ctx.textBaseline='middle';
  items.forEach(([l,c],i)=>{
    const lx=x+i*22; ctx.fillStyle=c; ctx.fillRect(lx,y,8,8);
    ctx.fillStyle=T.label; ctx.fillText(l,lx+10,y+4);
  });
  ctx.restore();
}

// ── Dynamic Range bar ─────────────────────────────────────────────────────────
function _drBar(ctx, x, y, w, T, s) {
  _card(ctx, x, y, w, LABEL_H+MINI_H, T);
  _lbl(ctx, x, y, `Dynamic Range  ·  ${s.drStops} EV  (${s.dynamicRange} levels)  ·  BP:${s.blackPoint}  WP:${s.whitePoint}`, T);
  const bx=x+8, by=y+LABEL_H+4, bw=w-16, bh=MINI_H-8;
  const g=ctx.createLinearGradient(bx,0,bx+bw,0);
  g.addColorStop(0,'#1a1610'); g.addColorStop(.5,'#6b5843'); g.addColorStop(1,'#f5ede0');
  ctx.save(); ctx.fillStyle=g; _rr(ctx,bx,by,bw,bh,4); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=1; ctx.stroke();
  // Active range
  const bp=(s.blackPoint/255)*bw, wp=(s.whitePoint/255)*bw;
  ctx.fillStyle='rgba(240,115,32,.3)'; _rr(ctx,bx+bp,by,wp-bp,bh,3); ctx.fill();
  _tick(ctx,bx+bp,by,bh,'#fff',s.blackPoint);
  _tick(ctx,bx+wp,by,bh,'#f07320',s.whitePoint);
  ctx.restore();
}

function _tick(ctx, mx, by, bh, color, label) {
  ctx.strokeStyle=color; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(mx,by-1); ctx.lineTo(mx,by+bh+1); ctx.stroke();
  ctx.fillStyle=color; ctx.font='600 8px Inter,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillText(label,mx,by-2);
}

// ── Clipping bars ─────────────────────────────────────────────────────────────
function _clipBar(ctx, x, y, w, T, s, mode) {
  const isHi = mode==='hi';
  const pct   = isHi ? s.clipHiPct : s.clipLoPct;
  const count = isHi ? s.clipHiCount : s.clipLoCount;
  const color = isHi ? 'rgba(255,60,60,.85)' : 'rgba(60,100,220,.85)';
  const sev   = pct<.5?{t:'Clean',c:'#27714a'}:pct<2?{t:'Minor',c:'#e5a000'}:{t:'Heavy',c:'#c0392b'};
  _card(ctx, x, y, w, LABEL_H+MINI_H, T);
  _lbl(ctx, x, y, (isHi?'Highlight':'Shadow')+` Clip  ·  ${pct}%  (${(count||0).toLocaleString()} px)`, T);
  const bx=x+8, by=y+LABEL_H+4, bw=w-16, bh=MINI_H-8;
  ctx.save(); ctx.fillStyle=T.grid; _rr(ctx,bx,by,bw,bh,4); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=.5; ctx.stroke();
  const fw=Math.min(bw,(pct/100)*bw);
  if(fw>0){ctx.fillStyle=color; _rr(ctx,bx,by,fw,bh,4); ctx.fill();}
  ctx.fillStyle=sev.c; ctx.font='700 9px Inter,sans-serif';
  ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillText(sev.t, bx+bw-4, by+bh/2);
  ctx.restore();
}

// ── Contrast gauge ────────────────────────────────────────────────────────────
function _contrastGauge(ctx, x, y, w, T, s) {
  const ratio=s.contrastRatio||1;
  const logPct=Math.log10(Math.max(1,ratio))/Math.log10(1000);
  const grade=ratio<5?{t:'Flat',c:'#4060cc'}:ratio<20?{t:'Low',c:'#e5a000'}:ratio<80?{t:'Normal',c:'#27714a'}:ratio<250?{t:'High',c:'#e5a000'}:{t:'Extreme',c:'#c0392b'};
  _card(ctx, x, y, w, LABEL_H+MINI_H, T);
  _lbl(ctx, x, y, `Contrast Ratio  ·  1:${ratio}  ·  ${grade.t}`, T);
  const bx=x+8, by=y+LABEL_H+4, bw=w-16, bh=MINI_H-8;
  ctx.save(); ctx.fillStyle=T.grid; _rr(ctx,bx,by,bw,bh,4); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=.5; ctx.stroke();
  const g=ctx.createLinearGradient(bx,0,bx+bw,0);
  g.addColorStop(0,'#27714a'); g.addColorStop(.35,'#27714a'); g.addColorStop(.55,'#e5a000'); g.addColorStop(.75,'#c0392b'); g.addColorStop(1,'#800');
  ctx.fillStyle=g; _rr(ctx,bx,by,bw*Math.min(1,logPct),bh,4); ctx.fill();
  const nx=bx+bw*Math.min(1,logPct);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(nx,by-1); ctx.lineTo(nx,by+bh+1); ctx.stroke();
  ctx.restore();
}

// ── Tonal Map ─────────────────────────────────────────────────────────────────
function _tonalMap(ctx, x, y, w, T, s) {
  const h=MINI_H;
  _card(ctx, x, y, w, LABEL_H+h, T);
  _lbl(ctx, x, y, `Tonal Map  ·  BP:${s.blackPoint}  Med:${s.median}  Avg:${s.avgLum}  WP:${s.whitePoint}`, T);
  const bx=x+8, by=y+LABEL_H+4, bw=w-16, bh=h-8;
  ctx.save();
  const g=ctx.createLinearGradient(bx,0,bx+bw,0);
  g.addColorStop(0,'#111'); g.addColorStop(.5,'#888'); g.addColorStop(1,'#eee');
  ctx.fillStyle=g; _rr(ctx,bx,by,bw,bh,4); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=1; ctx.stroke();
  // Clip zones
  const cpLo=(s.blackPoint/255)*bw;
  if(cpLo>0){ctx.fillStyle='rgba(60,100,220,.6)'; _rr(ctx,bx,by,cpLo,bh,4); ctx.fill();}
  const cpHiX=bx+(s.whitePoint/255)*bw, cpHiW=bw-(s.whitePoint/255)*bw;
  if(cpHiW>0){ctx.fillStyle='rgba(255,60,60,.6)'; _rr(ctx,bx+cpHiX-bx,by,cpHiW,bh,4); ctx.fill();}
  [{v:s.blackPoint,c:'#aaa',l:'BP'},{v:s.avgLum,c:'#f07320',l:'Avg'},{v:s.median,c:'#fff',l:'Med'},{v:s.whitePoint,c:'rgba(255,60,60,.9)',l:'WP'}].forEach(({v,c,l})=>{
    const mx=bx+(v/255)*bw;
    ctx.strokeStyle=c; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(mx,by); ctx.lineTo(mx,by+bh); ctx.stroke();
    ctx.fillStyle=c; ctx.font='700 8px Inter,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(l,mx,by+bh+1);
  });
  ctx.restore();
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function _card(ctx, x, y, w, h, T) {
  ctx.save(); ctx.fillStyle=T.panel; ctx.strokeStyle=T.border; ctx.lineWidth=1;
  _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke(); ctx.restore();
}
function _lbl(ctx, x, y, text, T) {
  ctx.save(); ctx.fillStyle=T.label; ctx.font='600 9px Inter,sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(text.toUpperCase(), x+10, y+LABEL_H/2); ctx.restore();
}
function _grid(ctx, x, y, w, h, T) {
  ctx.save(); ctx.strokeStyle=T.grid; ctx.lineWidth=.5;
  [1,2,3].forEach(i=>{const gx=x+(w/4)*i; ctx.beginPath(); ctx.moveTo(gx,y); ctx.lineTo(gx,y+h); ctx.stroke();});
  [1,2].forEach(i=>{const gy=y+(h/3)*i; ctx.beginPath(); ctx.moveTo(x,gy); ctx.lineTo(x+w,gy); ctx.stroke();});
  ctx.restore();
}
function _rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if(ctx.roundRect){ctx.roundRect(x,y,w,h,r);}
  else{ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
}
