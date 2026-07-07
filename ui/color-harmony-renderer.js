/**
 * ui/color-harmony-renderer.js
 *
 * Canvas: Base colour card · Colour wheel (all schemes) ·
 *         5 scheme panels · Score matrix
 */

const PAD=14, GAP=10, LABEL_H=20, WHEEL_R=80, SCHEME_H=72, SCORE_H=14;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

const SCHEME_ORDER=['complementary','analogous','triadic','splitComplementary','tetradic'];
const SCHEME_ICONS={complementary:'⬤',analogous:'◐',triadic:'▲',splitComplementary:'⬡',tetradic:'◼'};

function mkT(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)',bg:dark?'#1a1510':'#f8f4ee',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

export function renderColorHarmony(canvas, result, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;

  const WHEEL_D=WHEEL_R*2+16;
  const BASE_H=60;
  const SCORES_H=(SCORE_H+4)*3;
  const totalH=PAD
    +LABEL_H+BASE_H+GAP
    +LABEL_H+WHEEL_D+GAP
    +LABEL_H+SCHEME_ORDER.length*(SCHEME_H+GAP)
    +LABEL_H+SCORES_H
    +PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Base colour card
  _sec(ctx,PAD,y,`Color Harmony — Base: ${result.dominantName} (${result.dominantHSL.h}°)`,T); y+=LABEL_H;
  _baseCard(ctx,PAD,y,W-PAD*2,BASE_H,result,T); y+=BASE_H+GAP;

  // 2. Colour wheel
  _sec(ctx,PAD,y,'Harmony Wheel — All Schemes Overlaid',T); y+=LABEL_H;
  _harmonyWheel(ctx,PAD,y,W-PAD*2,WHEEL_D,result,T); y+=WHEEL_D+GAP;

  // 3. Scheme panels
  _sec(ctx,PAD,y,'Harmony Schemes',T); y+=LABEL_H;
  SCHEME_ORDER.forEach((key,i)=>{
    const scheme=result[key], isRec=(scheme.name===result.recommended);
    _schemePanel(ctx,PAD,y+i*(SCHEME_H+GAP),W-PAD*2,SCHEME_H,key,scheme,isRec,T);
  });
  y+=SCHEME_ORDER.length*(SCHEME_H+GAP);

  // 4. Score matrix
  _sec(ctx,PAD,y,'Score Matrix',T); y+=LABEL_H;
  _scoreMatrix(ctx,PAD,y,W-PAD*2,result,T);
}

// ─── Base colour card ─────────────────────────────────────────────────────────
function _baseCard(ctx,x,y,w,h,result,T){
  _card(ctx,x,y,w,h,T);
  const sw=w*0.18;
  ctx.save();
  // Big swatch
  ctx.fillStyle=result.dominantHex; _rr(ctx,x+10,y+8,sw,h-16,8); ctx.fill();
  ctx.strokeStyle=T.border; ctx.lineWidth=1; ctx.stroke();
  // Info
  const tx=x+sw+20, ty=y+12, lh=13;
  ctx.fillStyle=T.text; ctx.font='700 13px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(`${result.dominantName}  —  Dominant Hue`,tx,ty);
  ctx.fillStyle=T.orange; ctx.font='700 11px "JetBrains Mono",monospace';
  ctx.fillText(result.dominantHex.toUpperCase(),tx,ty+lh+1);
  ctx.fillStyle=T.sub; ctx.font=FONT_MONO;
  const {h:dh,s:ds,l:dl}=result.dominantHSL;
  ctx.fillText(`hsl(${dh}°, ${ds}%, ${dl}%)`,tx,ty+lh*2+2);
  // Recommended badge
  const bw=136, bh=17;
  ctx.fillStyle='rgba(240,115,32,.15)'; ctx.strokeStyle=T.orange; ctx.lineWidth=1;
  _rr(ctx,x+w-bw-10,y+(h-bh)/2,bw,bh,6); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.orange; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(`★ Recommended: ${result.recommended}`,x+w-bw/2-10,y+h/2);
  ctx.restore();
}

// ─── Harmony wheel ────────────────────────────────────────────────────────────
const SCHEME_COLORS={
  complementary:'#f07320',analogous:'#27714a',triadic:'#4060cc',
  splitComplementary:'#c02880',tetradic:'#8a4a2a',
};

function _harmonyWheel(ctx,x,y,w,h,result,T){
  _card(ctx,x,y,w,h+LABEL_H,T);
  const cx=x+w/2, cy=y+h/2+4, r=WHEEL_R;

  // Hue ring background
  for(let deg=0;deg<360;deg+=2){
    const a=(deg-90)*Math.PI/180, a2=(deg+2-90)*Math.PI/180;
    ctx.save(); ctx.fillStyle=`hsl(${deg},80%,55%)`;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,a,a2); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  // Inner mask (donut)
  ctx.save(); ctx.fillStyle=T.bg; ctx.beginPath(); ctx.arc(cx,cy,r*0.52,0,Math.PI*2); ctx.fill(); ctx.restore();

  // Draw spoke lines for each scheme
  SCHEME_ORDER.forEach(key=>{
    const scheme=result[key];
    const color=SCHEME_COLORS[key]??'#888';
    const hues=scheme.colours.map(c=>c.hsl.h);
    ctx.save(); ctx.strokeStyle=color+'aa'; ctx.lineWidth=1.5; ctx.setLineDash([2,3]);
    for(let i=0;i<hues.length-1;i++){
      const a1=(hues[i]-90)*Math.PI/180, a2=(hues[i+1]-90)*Math.PI/180;
      const r1=r*0.52, r2=r*0.52;
      const x1=cx+Math.cos(a1)*r1, y1=cy+Math.sin(a1)*r1;
      const x2=cx+Math.cos(a2)*r2, y2=cy+Math.sin(a2)*r2;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    // Connect last back to first
    if(hues.length>2){
      const a1=(hues[hues.length-1]-90)*Math.PI/180, a2=(hues[0]-90)*Math.PI/180;
      const x1=cx+Math.cos(a1)*r*0.52, y1=cy+Math.sin(a1)*r*0.52;
      const x2=cx+Math.cos(a2)*r*0.52, y2=cy+Math.sin(a2)*r*0.52;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  });

  // Colour dots on ring
  SCHEME_ORDER.forEach(key=>{
    const scheme=result[key];
    scheme.colours.forEach((col,ci)=>{
      const a=(col.hsl.h-90)*Math.PI/180;
      const dr=r*0.77;
      const dx=cx+Math.cos(a)*dr, dy=cy+Math.sin(a)*dr;
      ctx.save();
      ctx.fillStyle=col.hex; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(dx,dy,ci===0?6:4,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
  });

  // Centre: dominant hue
  ctx.save();
  ctx.fillStyle=result.dominantHex; ctx.strokeStyle='#fff'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(cx,cy,16,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='700 8px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(`${result.dominantHSL.h}°`,cx,cy);
  ctx.restore();

  // Legend (right side)
  const lx=x+w/2+r+16, ly=y+h/2-SCHEME_ORDER.length*11;
  SCHEME_ORDER.forEach((key,i)=>{
    const color=SCHEME_COLORS[key]??'#888';
    ctx.save();
    ctx.fillStyle=color; ctx.fillRect(lx,ly+i*20,10,10);
    ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(result[key].name,lx+14,ly+i*20+5);
    ctx.restore();
  });
}

// ─── Scheme panel ─────────────────────────────────────────────────────────────
function _schemePanel(ctx,x,y,w,h,key,scheme,isRec,T){
  ctx.save();
  // Card
  ctx.fillStyle=isRec?'rgba(240,115,32,.08)':T.panel;
  ctx.strokeStyle=isRec?T.orange:T.border; ctx.lineWidth=isRec?2:1;
  _rr(ctx,x,y,w,h,10); ctx.fill(); ctx.stroke();

  // Icon + name
  const icon=SCHEME_ICONS[key]??'●';
  ctx.fillStyle=isRec?T.orange:T.label; ctx.font='700 10px Inter,sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(`${icon}  ${scheme.name}${isRec?' ★':''}`,x+12,y+9);

  // Colour swatches row
  const maxSwatches=scheme.colours.length;
  const swW=Math.min(48, Math.floor((w-24)/maxSwatches)-4);
  const swH=h-36, swY=y+28;
  scheme.colours.forEach((col,i)=>{
    const swX=x+12+i*(swW+4);
    // Swatch
    ctx.fillStyle=col.hex; _rr(ctx,swX,swY,swW,swH,6); ctx.fill();
    ctx.strokeStyle=T.border; ctx.lineWidth=.5; ctx.stroke();
    // Hue label inside if wide enough
    if(swW>32){
      const lum=col.hsl.l;
      ctx.fillStyle=lum>50?'rgba(0,0,0,.7)':'rgba(255,255,255,.9)';
      ctx.font='700 8px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(col.hex.toUpperCase(),swX+swW/2,swY+4);
      ctx.fillStyle=lum>50?'rgba(0,0,0,.6)':'rgba(255,255,255,.75)';
      ctx.font='500 7px Inter,sans-serif';
      ctx.fillText(col.name,swX+swW/2,swY+14);
      ctx.fillText(`${col.hsl.h}°`,swX+swW/2,swY+swH-13);
    }
  });

  // Description
  const descX=x+12+maxSwatches*(swW+4)+8;
  const descW=w-descX-10;
  if(descW>60){
    ctx.fillStyle=T.sub; ctx.font='500 8px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
    _wrap(ctx,scheme.description,descX,y+10,descW,11);
    // HSL quick summary
    ctx.fillStyle=T.label; ctx.font=FONT_MONO; ctx.textBaseline='bottom';
    const hues=scheme.colours.map(c=>`${c.hsl.h}°`).join(' · ');
    ctx.fillText(hues,descX,y+h-8);
  }

  ctx.restore();
}

// ─── Score matrix ─────────────────────────────────────────────────────────────
const SCORE_LABELS=['Balance','Tension','Harmony'];
const SCORE_COLORS=['#27714a','#c0392b','#4060cc'];

function _scoreMatrix(ctx,x,y,w,result,T){
  const colW=Math.floor((w-PAD)/SCHEME_ORDER.length);
  // Column headers
  SCHEME_ORDER.forEach((key,i)=>{
    ctx.fillStyle=T.sub; ctx.font='600 8px Inter,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='top';
    const name=result[key].name.split(' ')[0];
    ctx.fillText(name,x+i*colW+colW/2,y-2);
  });
  // Rows
  SCORE_LABELS.forEach((lbl,ri)=>{
    const ry=y+ri*(SCORE_H+4);
    ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(lbl,x,ry+SCORE_H/2);
    const scoreKey=lbl.toLowerCase();
    const lw=ctx.measureText(lbl).width+8;
    SCHEME_ORDER.forEach((key,ci)=>{
      const val=result[key].scores[scoreKey]??0;
      const bx=x+lw+ci*((w-lw)/SCHEME_ORDER.length), bw=(w-lw)/SCHEME_ORDER.length-4, bh=SCORE_H;
      ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5;
      _rr(ctx,bx,ry,bw,bh,3); ctx.fill(); ctx.stroke();
      ctx.fillStyle=SCORE_COLORS[ri]+'aa'; _rr(ctx,bx,ry,bw*val,bh,3); ctx.fill();
      ctx.fillStyle=T.text; ctx.font='600 8px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(`${Math.round(val*100)}%`,bx+bw/2,ry+bh/2);
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _sec(ctx,x,y,text,T){ctx.save();ctx.fillStyle=T.label;ctx.font=FONT;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);const tw=ctx.measureText(text.toUpperCase()).width;ctx.strokeStyle=T.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+tw+8,y+LABEL_H/2);ctx.lineTo(x+9999,y+LABEL_H/2);ctx.stroke();ctx.restore();}
function _card(ctx,x,y,w,h,T){ctx.save();ctx.fillStyle=T.panel;ctx.strokeStyle=T.border;ctx.lineWidth=1;_rr(ctx,x,y,w,h,10);ctx.fill();ctx.stroke();ctx.restore();}
function _wrap(ctx,text,x,y,maxW,lh){const words=text.split(' ');let line='',cy=y;for(const w of words){const t=line?line+' '+w:w;if(ctx.measureText(t).width>maxW&&line){ctx.fillText(line,x,cy);line=w;cy+=lh;}else line=t;}if(line)ctx.fillText(line,x,cy);}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
