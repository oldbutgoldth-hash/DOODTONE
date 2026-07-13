/**
 * ui/image-analysis-renderer.js
 *
 * Canvas: Summary banner · RGB Histogram · Luminance/LAB strip ·
 *         Dynamic Range + Clip bars · White Balance card ·
 *         Saturation distribution · Dominant Hue wheel ·
 *         Scene + Skin card · Quality metrics (Sharpness/Blur/Noise/JPEG)
 */

const PAD=14, GAP=10, LABEL_H=20, MINI_H=18, HIST_H=88, QUAL_H=58;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

function mkT(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

// ─── UI FIX-F: canvas content-width resolution ─────────────────────────────
// A section's getBoundingClientRect().width is its BORDER-BOX width,
// which includes padding/border — but the canvas inside it (width:100%)
// only ever occupies the section's CONTENT box. Passing the section's
// full width as the canvas's CSS width overshoots by exactly the
// section's horizontal padding+border, causing overflow/stretching.
// This resolver only ever trusts the canvas's own measured width (or an
// explicit override already computed from the canvas itself by the
// caller) — never a parent/section rect — and never falls back to any
// hardcoded pixel value. Deliberately avoids canvas.offsetWidth, which
// can still reflect a stale inline pixel width left over from a
// PREVIOUS render (canvas.style.width used to be set to an explicit
// "Npx" value before this patch).
function resolveCanvasCssWidth(canvas, requestedWidth) {
  const candidates = [
    requestedWidth,
    canvas?.getBoundingClientRect?.().width,
    canvas?.clientWidth,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.max(1, Math.floor(n));
  }
  return 0;
}

export function renderImageAnalysis(canvas, r, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  // Resolve the canvas's own CONTENT width — never the parent section's
  // border-box width (see resolveCanvasCssWidth above for why).
  const W = resolveCanvasCssWidth(canvas, opts.cssWidth);
  // Never commit a distorted render from a zero/invalid width — this was
  // the root cause of the first-import layout bug: a stale 0px reading
  // used to silently fall back to a hardcoded 560, drawing the canvas at
  // the wrong backing-store size while CSS `width:100%` still stretched
  // it to the real (different) container width.
  if (W <= 0) return false;
  const colW=Math.floor((W-PAD*2-GAP)/2);

  const BANNER_H=28, WB_H=60, HUE_H=110, QUAL_GRID_H=QUAL_H*2+GAP;
  const totalH=PAD
    +LABEL_H+BANNER_H+GAP                              // 1. banner
    +LABEL_H+HIST_H+GAP                                // 2. RGB histogram
    +LABEL_H+MINI_H+GAP                                // 3. Luminance/LAB strip
    +LABEL_H+MINI_H+GAP                                // 4. Dynamic range
    +LABEL_H+MINI_H+GAP                                // 5/6. clip bars (combined row uses 1 label)
    +LABEL_H+WB_H+GAP                                  // 7. white balance
    +LABEL_H+MINI_H+GAP                                // 8. saturation distribution
    +LABEL_H+HUE_H+GAP                                 // 9. dominant hue + scene
    +LABEL_H+WB_H+GAP                                  // 10/11. skin card
    +LABEL_H+QUAL_GRID_H                               // 12-15. quality metrics
    +PAD;

  canvas.style.width='100%'; canvas.style.height=totalH+'px';
  canvas.width=Math.round(W*dpr); canvas.height=Math.round(totalH*dpr);
  const ctx=canvas.getContext('2d');
  // Reset transform before scaling — setting canvas.width/height above
  // already implicitly resets the drawing state per the HTML Canvas
  // spec, but this makes the DPR-scaling contract explicit and immune
  // to any future refactor that stops re-assigning width/height on
  // every redraw (which would otherwise silently accumulate scale()).
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  let y=PAD;

  // 1. Summary banner
  _sec(ctx,PAD,y,'Image Analysis Core — 15-Point Technical Report',T); y+=LABEL_H;
  _banner(ctx,PAD,y,W-PAD*2,BANNER_H,r,T); y+=BANNER_H+GAP;

  // 2. RGB Histogram
  _sec(ctx,PAD,y,'1 · RGB Histogram',T); y+=LABEL_H;
  _rgbHistogram(ctx,PAD,y,W-PAD*2,HIST_H,r,T); y+=HIST_H+GAP;

  // 3. Luminance / LAB L*
  _sec(ctx,PAD,y,'2 · Luminance & LAB L*',T); y+=LABEL_H;
  _lumLabStrip(ctx,PAD,y,W-PAD*2,MINI_H,r,T); y+=MINI_H+GAP;

  // 4. Dynamic range
  _sec(ctx,PAD,y,'3 · Dynamic Range',T); y+=LABEL_H;
  _drBar(ctx,PAD,y,W-PAD*2,MINI_H,r,T); y+=MINI_H+GAP;

  // 5/6. Highlight + Shadow clip
  _sec(ctx,PAD,y,'4-5 · Highlight & Shadow Clipping',T); y+=LABEL_H;
  _clipRow(ctx,PAD,y,colW,MINI_H,r,T,'hi');
  _clipRow(ctx,PAD+colW+GAP,y,colW,MINI_H,r,T,'lo');
  y+=MINI_H+GAP;

  // 7. White balance
  _sec(ctx,PAD,y,'6 · White Balance',T); y+=LABEL_H;
  _wbCard(ctx,PAD,y,W-PAD*2,WB_H,r,T); y+=WB_H+GAP;

  // 8. Saturation distribution
  _sec(ctx,PAD,y,'7 · Saturation Distribution',T); y+=LABEL_H;
  _satDistribution(ctx,PAD,y,W-PAD*2,MINI_H,r,T); y+=MINI_H+GAP;

  // 9. Dominant hue + Scene
  _sec(ctx,PAD,y,'8-9 · Dominant Hue & Scene Classification',T); y+=LABEL_H;
  _hueSceneRow(ctx,PAD,y,W-PAD*2,HUE_H,r,T); y+=HUE_H+GAP;

  // 10/11. Skin card
  _sec(ctx,PAD,y,'10-11 · Face / Skin Detection & Tone Analysis',T); y+=LABEL_H;
  _skinCard(ctx,PAD,y,W-PAD*2,WB_H,r,T); y+=WB_H+GAP;

  // 12-15. Quality metrics grid
  _sec(ctx,PAD,y,'12-15 · Sharpness · Blur · Noise · JPEG Artifacts',T); y+=LABEL_H;
  _qualityGrid(ctx,PAD,y,W-PAD*2,QUAL_GRID_H,colW,r,T);
  return true;
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function _banner(ctx,x,y,w,h,r,T){
  ctx.save();
  ctx.fillStyle='rgba(240,115,32,.1)'; ctx.strokeStyle=T.orange; ctx.lineWidth=1.5;
  _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.text; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`🔬  ${r.category} · ${r.dominantHueName} dominant`,x+12,y+h/2);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='right';
  let s=r.summary; while(s.length>4&&ctx.measureText(s).width>w-230) s=s.slice(0,-1);
  ctx.fillText(s,x+w-10,y+h/2);
  ctx.restore();
}

// ─── 1. RGB Histogram ─────────────────────────────────────────────────────────
function _rgbHistogram(ctx,x,y,w,h,r,T){
  _card(ctx,x,y,w,h,T);
  const cx=x+8, cy=y+4, cw=w-16, ch=h-18;
  _grid(ctx,cx,cy,cw,ch,T);
  _channel(ctx,cx,cy,cw,ch,r.histR,'rgba(220,60,60,.5)','rgba(220,60,60,.9)');
  _channel(ctx,cx,cy,cw,ch,r.histG,'rgba(50,180,70,.5)','rgba(40,160,60,.9)');
  _channel(ctx,cx,cy,cw,ch,r.histB,'rgba(60,100,220,.5)','rgba(50,90,210,.9)');
  ctx.save(); ctx.fillStyle=T.sub; ctx.font='8px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
  [0,64,128,192,255].forEach(v=>ctx.fillText(v,cx+(v/255)*cw,cy+ch+2)); ctx.restore();
  // Legend
  ctx.save(); ctx.font='600 9px Inter,sans-serif'; ctx.textBaseline='middle';
  [['R','rgba(220,60,60,.9)'],['G','rgba(40,160,60,.9)'],['B','rgba(50,90,210,.9)']].forEach(([l,c],i)=>{
    const lx=cx+cw-70+i*22; ctx.fillStyle=c; ctx.fillRect(lx,cy+4,8,8);
    ctx.fillStyle=T.label; ctx.fillText(l,lx+10,cy+8);
  });
  ctx.restore();
}
function _channel(ctx,x,y,w,h,hist,fill,stroke){
  const max=Math.max(...hist); if(!max)return;
  ctx.save(); ctx.beginPath(); ctx.moveTo(x,y+h);
  for(let i=0;i<256;i++) ctx.lineTo(x+(i/255)*w, y+h-(hist[i]/max)*h);
  ctx.lineTo(x+w,y+h); ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x,y+h);
  for(let i=0;i<256;i++) ctx.lineTo(x+(i/255)*w, y+h-(hist[i]/max)*h);
  ctx.lineTo(x+w,y+h); ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
}

// ─── 2. Luminance / LAB strip ─────────────────────────────────────────────────
function _lumLabStrip(ctx,x,y,w,h,r,T){
  _card(ctx,x,y,w,h,T);
  const half=(w-24)/2;
  ctx.save();
  ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`Luminance (BT.709): ${r.avgLum}/255`,x+10,y+h/2);
  ctx.fillStyle=T.orange; ctx.font=FONT_MONO; ctx.textAlign='right';
  ctx.fillText(`LAB L*: ${r.avgLabL}/100`,x+w-10,y+h/2);
  // mini bar in middle showing both on shared 0-100 scale
  const bx=x+10+half-40, bw=80, by=y+h/2-3, bh=6;
  ctx.fillStyle=T.grid; _rr(ctx,bx,by,bw,bh,3); ctx.fill();
  const lumPct=(r.avgLum/255), labPct=(r.avgLabL/100);
  ctx.fillStyle='rgba(150,150,150,.6)'; _rr(ctx,bx,by,bw*lumPct,bh/2,2); ctx.fill();
  ctx.fillStyle=T.orange; _rr(ctx,bx,by+bh/2,bw*labPct,bh/2,2); ctx.fill();
  ctx.restore();
}

// ─── 3. Dynamic Range bar ─────────────────────────────────────────────────────
function _drBar(ctx,x,y,w,h,r,T){
  _card(ctx,x,y,w,h,T);
  const bx=x+8,by=y+4,bw=w-16,bh=h-8;
  const g=ctx.createLinearGradient(bx,0,bx+bw,0);
  g.addColorStop(0,'#1a1610'); g.addColorStop(.5,'#6b5843'); g.addColorStop(1,'#f5ede0');
  ctx.save(); ctx.fillStyle=g; _rr(ctx,bx,by,bw,bh,4); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=1; ctx.stroke();
  const bp=(r.blackPoint/255)*bw, wp=(r.whitePoint/255)*bw;
  ctx.fillStyle='rgba(240,115,32,.3)'; _rr(ctx,bx+bp,by,wp-bp,bh,3); ctx.fill();
  ctx.fillStyle=T.text; ctx.font='700 9px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='#fff'; ctx.fillText(`${r.drStops} EV · ${r.dynamicRange} levels · 1:${r.contrastRatio}`,bx+bw/2,by+bh/2);
  ctx.restore();
}

// ─── 4/5. Clip rows ───────────────────────────────────────────────────────────
function _clipRow(ctx,x,y,w,h,r,T,mode){
  const isHi=mode==='hi';
  const pct=isHi?r.clipHiPct:r.clipLoPct;
  const color=isHi?'rgba(255,60,60,.85)':'rgba(60,100,220,.85)';
  const sev=pct<.5?{t:'Clean',c:T.ok}:pct<2?{t:'Minor',c:T.warn}:{t:'Heavy',c:T.err};
  _card(ctx,x,y,w,h,T);
  const bx=x+8,by=y+4,bw=w-16,bh=h-8;
  ctx.save();
  ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${isHi?'Highlight':'Shadow'}: ${pct}%`,bx,y+h/2);
  const trackX=bx+90, trackW=bw-90-44;
  ctx.fillStyle=T.grid; _rr(ctx,trackX,by+2,trackW,bh-4,3); ctx.fill();
  const fw=Math.min(trackW,(pct/10)*trackW);
  if(fw>0){ctx.fillStyle=color; _rr(ctx,trackX,by+2,fw,bh-4,3); ctx.fill();}
  ctx.fillStyle=sev.c; ctx.font='700 8px Inter,sans-serif'; ctx.textAlign='right';
  ctx.fillText(sev.t,x+w-8,y+h/2);
  ctx.restore();
}

// ─── 6. White Balance card ────────────────────────────────────────────────────
const CAST_CFG={warm:{bg:'rgba(240,115,32,.15)',bd:'#f07320',icon:'🌅'},cool:{bg:'rgba(60,100,220,.13)',bd:'#4060cc',icon:'❄️'},green:{bg:'rgba(40,160,80,.13)',bd:'#27714a',icon:'🌿'},magenta:{bg:'rgba(180,40,140,.13)',bd:'#b02890',icon:'🌸'},neutral:{bg:'rgba(100,160,100,.13)',bd:'#27714a',icon:'✓'}};
function _wbCard(ctx,x,y,w,h,r,T){
  const cfg=CAST_CFG[r.whiteBalanceCast]??CAST_CFG.neutral;
  ctx.save();
  ctx.fillStyle=cfg.bg; ctx.strokeStyle=cfg.bd; ctx.lineWidth=1.5; _rr(ctx,x,y,w,h,10); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.text; ctx.font='700 13px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(`${cfg.icon} ${r.whiteBalanceCast.charAt(0).toUpperCase()+r.whiteBalanceCast.slice(1)} Cast`,x+12,y+10);
  ctx.fillStyle=T.sub; ctx.font=FONT_MONO; ctx.textBaseline='top';
  ctx.fillText(`R-B diff: ${r.rbDiff>=0?'+':''}${r.rbDiff}   G bias: ${r.gDiff>=0?'+':''}${r.gDiff}`,x+12,y+30);
  ctx.fillText(`avg RGB(${r.avgR}, ${r.avgG}, ${r.avgB})`,x+12,y+44);
  // Swatch
  ctx.fillStyle=`rgb(${r.avgR},${r.avgG},${r.avgB})`;
  _rr(ctx,x+w-50,y+10,38,h-20,6); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=.5; ctx.stroke();
  ctx.restore();
}

// ─── 7. Saturation distribution ──────────────────────────────────────────────
function _satDistribution(ctx,x,y,w,h,r,T){
  _card(ctx,x,y,w,h,T);
  const bx=x+8,by=y+4,bw=w-16,bh=h-8;
  const hist=r.satHistogram||[];
  const max=Math.max(...hist,.01);
  const barW=bw/hist.length;
  ctx.save();
  hist.forEach((v,i)=>{
    const sat=(i/hist.length);
    ctx.fillStyle=`hsl(25,${Math.round(sat*100)}%,55%)`;
    const bh2=(v/max)*bh;
    ctx.fillRect(bx+i*barW+1,by+bh-bh2,barW-2,bh2);
  });
  ctx.fillStyle=T.text; ctx.font='700 9px "JetBrains Mono",monospace'; ctx.textAlign='right'; ctx.textBaseline='top';
  ctx.fillText(`Avg ${r.avgSatPct}%`,x+w-8,y+2);
  ctx.restore();
}

// ─── 8/9. Dominant hue wheel + Scene card ────────────────────────────────────
function _hueSceneRow(ctx,x,y,w,h,r,T){
  const wheelW=h+10;
  _card(ctx,x,y,wheelW,h,T);
  const cx=x+wheelW/2, cy=y+h/2, rad=h/2-12;
  // hue ring
  for(let deg=0;deg<360;deg+=3){
    const a=(deg-90)*Math.PI/180, a2=(deg+3-90)*Math.PI/180;
    ctx.save(); ctx.fillStyle=`hsl(${deg},75%,55%)`;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,rad,a,a2); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.save(); ctx.fillStyle=T.panel; ctx.beginPath(); ctx.arc(cx,cy,rad*.5,0,Math.PI*2); ctx.fill(); ctx.restore();
  // dominant marker
  const a=(r.dominantHue-90)*Math.PI/180;
  const mx=cx+Math.cos(a)*rad*.76, my=cy+Math.sin(a)*rad*.76;
  ctx.save(); ctx.fillStyle='#fff'; ctx.strokeStyle='#000'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.arc(mx,my,6,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.fillStyle=T.label; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(`${r.dominantHue}°`,cx,cy);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM;
  ctx.fillText(r.dominantHueName,cx,cy+h/2-8);

  // Scene card right of wheel
  const sx=x+wheelW+GAP, sw=w-wheelW-GAP;
  _card(ctx,sx,y,sw,h,T);
  ctx.save();
  ctx.fillStyle=T.orange; ctx.font='700 16px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(r.category,sx+12,y+12);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM;
  const lines=[
    `Avg Saturation: ${r.avgSatPct}%`,
    `Avg Luminance: ${r.avgLum}`,
    `Contrast (σ): ${r.contrast}`,
    `Skin coverage: ${r.skinPct}%`,
  ];
  lines.forEach((l,i)=>ctx.fillText(l,sx+12,y+38+i*15));
  ctx.restore();
}

// ─── 10/11. Skin card ─────────────────────────────────────────────────────────
function _skinCard(ctx,x,y,w,h,r,T){
  const detected=r.skinDetected;
  ctx.save();
  ctx.fillStyle=detected?'rgba(200,140,100,.12)':T.panel;
  ctx.strokeStyle=detected?'#c08060':T.border; ctx.lineWidth=detected?1.5:1;
  _rr(ctx,x,y,w,h,10); ctx.fill(); ctx.stroke();

  ctx.fillStyle=T.text; ctx.font='700 13px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(detected?`🧑 Skin Detected — ${r.skinPct}%`:'No skin detected',x+12,y+10);

  if (detected) {
    ctx.fillStyle=T.sub; ctx.font=FONT_MONO; ctx.textBaseline='top';
    const {h:sh,s:ss,l:sl}=r.skinTone;
    ctx.fillText(`Skin tone HSL: ${sh}°, ${ss}%, ${sl}%`,x+12,y+30);
    // Swatch from HSL
    const skinHex=_hslToHex(sh,ss,sl);
    ctx.fillStyle=skinHex; _rr(ctx,x+w-50,y+10,38,h-20,6); ctx.fill();
    ctx.strokeStyle=T.border; ctx.lineWidth=.5; ctx.stroke();
  } else {
    ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textBaseline='top';
    ctx.fillText('Likely landscape, food, or object photography.',x+12,y+30);
  }
  ctx.restore();
}
function _hslToHex(h,s,l){
  s/=100; l/=100;
  const k=n=>(n+h/30)%12;
  const a=s*Math.min(l,1-l);
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
  const toHex=v=>Math.round(255*v).toString(16).padStart(2,'0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// ─── 12-15. Quality metrics grid ─────────────────────────────────────────────
function _qualityGrid(ctx,x,y,w,h,colW,r,T){
  _qualityCard(ctx,x,           y,           colW,QUAL_H,'🔍','Sharpness',r.sharpnessScore,100,r.sharpnessLabel,_qColor(r.sharpnessScore,[40,65]),T);
  _qualityCard(ctx,x+colW+GAP,  y,           colW,QUAL_H,'〰️','Blur', r.blurConfidence*100,100,r.blurDetected?'Detected':'Not detected',r.blurDetected?T.err:T.ok,T);
  _qualityCard(ctx,x,           y+QUAL_H+GAP,colW,QUAL_H,'📡','Noise',r.noiseScore,100,r.noiseLabel,_qColorInv(r.noiseScore,[15,35,60]),T);
  _qualityCard(ctx,x+colW+GAP,  y+QUAL_H+GAP,colW,QUAL_H,'🗜️','JPEG Artifacts',r.jpegArtifactScore,100,r.jpegArtifactLabel,_qColorInv(r.jpegArtifactScore,[10,30,55]),T);
}
function _qColor(val,[lo,hi]){return val>=hi?'#27714a':val>=lo?'#e5a000':'#c0392b';}
function _qColorInv(val,[a,b,c]){return val<a?'#27714a':val<b?'#e5a000':val<c?'#e07030':'#c0392b';}

function _qualityCard(ctx,x,y,w,h,icon,label,val,max,statusLabel,color,T){
  _card(ctx,x,y,w,h,T); ctx.save();
  ctx.fillStyle=color; _rr(ctx,x,y,w,3,[8,8,0,0]); ctx.fill();
  ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(icon,x+8,y+7);
  ctx.fillStyle=T.label; ctx.font='700 9px Inter,sans-serif'; ctx.fillText(label.toUpperCase(),x+24,y+9);

  ctx.fillStyle=color; ctx.font='700 16px "JetBrains Mono",monospace'; ctx.textAlign='right'; ctx.textBaseline='top';
  ctx.fillText(Math.round(val)+'',x+w-10,y+7);

  // bar
  const bx=x+8,by=y+30,bw=w-16,bh=8;
  ctx.fillStyle=T.grid; _rr(ctx,bx,by,bw,bh,3); ctx.fill();
  const fw=Math.max(2,(val/max)*bw);
  ctx.fillStyle=color+'cc'; _rr(ctx,bx,by,fw,bh,3); ctx.fill();

  ctx.fillStyle=color; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(statusLabel,bx,by+13);
  ctx.restore();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _sec(ctx,x,y,text,T){ctx.save();ctx.fillStyle=T.label;ctx.font=FONT;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);const tw=ctx.measureText(text.toUpperCase()).width;ctx.strokeStyle=T.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+tw+8,y+LABEL_H/2);ctx.lineTo(x+9999,y+LABEL_H/2);ctx.stroke();ctx.restore();}
function _card(ctx,x,y,w,h,T){ctx.save();ctx.fillStyle=T.panel;ctx.strokeStyle=T.border;ctx.lineWidth=1;_rr(ctx,x,y,w,h,10);ctx.fill();ctx.stroke();ctx.restore();}
function _grid(ctx,x,y,w,h,T){ctx.save();ctx.strokeStyle=T.grid;ctx.lineWidth=.5;[1,2,3].forEach(i=>{const v=(w/4)*i;ctx.beginPath();ctx.moveTo(x+v,y);ctx.lineTo(x+v,y+h);ctx.stroke();});[1,2].forEach(i=>{const v=(h/3)*i;ctx.beginPath();ctx.moveTo(x,y+v);ctx.lineTo(x+w,y+v);ctx.stroke();});ctx.restore();}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
