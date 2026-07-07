/**
 * ui/style-recognition-renderer.js
 *
 * Canvas: Top style hero · Confidence bars (all 10) ·
 *         Feature radar chart · Trait chips · Feature table
 */

const PAD=14, GAP=10, LABEL_H=20, BAR_H=16, HERO_H=72, RADAR_SZ=140;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

const STYLE_ICONS={
  Wedding:'💍', Portrait:'🧑', Landscape:'🏔️', Travel:'✈️', Food:'🍽️',
  Street:'🏙️', Fashion:'👗', Documentary:'📷', Vintage:'🎞️', Luxury:'💎',
};

const STYLE_COLORS={
  Wedding:'#c07090', Portrait:'#f07320', Landscape:'#27714a', Travel:'#4060cc',
  Food:'#d4a800', Street:'#5a5a5a', Fashion:'#8a2a8a', Documentary:'#3a6080',
  Vintage:'#8a6030', Luxury:'#909090',
};

// Radar axes (subset of features for readability)
const RADAR_AXES=[
  {key:'avgLum',    label:'Exposure',  max:255},
  {key:'avgSat',    label:'Saturation',max:100},
  {key:'contrast',  label:'Contrast',  max:100},
  {key:'skinPct',   label:'Skin',      max:60 },
  {key:'hueSpread', label:'Hue Spread',max:200},
  {key:'dynamicRange',label:'D-Range', max:255},
];

function mkT(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)',bg:dark?'#1a1510':'#f8f4ee',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

export function renderStyleRecognition(canvas, result, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;

  const BARS_H=result.styles.length*(BAR_H+4);
  const TRAIT_H=34, FEAT_H=(BAR_H+3)*6;
  const RADAR_ROW=Math.max(RADAR_SZ*2+16, 180);
  const totalH=PAD
    +LABEL_H+HERO_H+GAP
    +LABEL_H+BARS_H+GAP
    +LABEL_H+RADAR_ROW+GAP
    +LABEL_H+TRAIT_H+GAP
    +LABEL_H+FEAT_H
    +PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Hero card
  _sec(ctx,PAD,y,`Style Recognition AI — ${result.summary}`,T); y+=LABEL_H;
  _hero(ctx,PAD,y,W-PAD*2,HERO_H,result,T); y+=HERO_H+GAP;

  // 2. All styles confidence bars
  _sec(ctx,PAD,y,'Confidence Scores — All Styles',T); y+=LABEL_H;
  result.styles.forEach((s,i)=>_confBar(ctx,PAD,y+i*(BAR_H+4),W-PAD*2,BAR_H,s,T));
  y+=BARS_H+GAP;

  // 3. Radar + feature table side by side
  _sec(ctx,PAD,y,'Feature Vector — Radar Analysis',T); y+=LABEL_H;
  const radarW=RADAR_SZ*2+16;
  _radarChart(ctx,PAD,y,radarW,RADAR_ROW,result.features,T);
  _featureTable(ctx,PAD+radarW+GAP,y,W-PAD*2-radarW-GAP,RADAR_ROW,result,T);
  y+=RADAR_ROW+GAP;

  // 4. Top style traits
  _sec(ctx,PAD,y,`${result.top.style} — Key Traits`,T); y+=LABEL_H;
  _traitChips(ctx,PAD,y,W-PAD*2,TRAIT_H,result.top.traits,STYLE_COLORS[result.top.style]??T.orange,T);
  y+=TRAIT_H+GAP;

  // 5. Feature detail bars
  _sec(ctx,PAD,y,'Image Feature Analysis',T); y+=LABEL_H;
  _featureBars(ctx,PAD,y,W-PAD*2,result.features,T);
}

// ─── Hero card ────────────────────────────────────────────────────────────────
function _hero(ctx,x,y,w,h,result,T){
  const top=result.top, sec=result.second;
  const ac=STYLE_COLORS[top.style]??T.orange;
  ctx.save();
  ctx.fillStyle=ac+'18'; ctx.strokeStyle=ac; ctx.lineWidth=2;
  _rr(ctx,x,y,w,h,12); ctx.fill(); ctx.stroke();

  // Icon
  ctx.font='32px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(STYLE_ICONS[top.style]??'📷',x+14,y+h/2);

  // Style name + confidence
  ctx.fillStyle=T.text; ctx.font='700 18px Inter,sans-serif'; ctx.textBaseline='top'; ctx.textAlign='left';
  ctx.fillText(top.style,x+60,y+10);
  ctx.fillStyle=ac; ctx.font='700 28px "JetBrains Mono",monospace'; ctx.textAlign='right'; ctx.textBaseline='top';
  ctx.fillText(`${top.confidence}%`,x+w-12,y+8);

  // Rank #1 badge
  ctx.fillStyle=ac+'33'; ctx.strokeStyle=ac; ctx.lineWidth=.5;
  _rr(ctx,x+60,y+32,58,16,5); ctx.fill(); ctx.stroke();
  ctx.fillStyle=ac; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('RANK #1 MATCH',x+60+29,y+40);

  // Second best
  const ac2=STYLE_COLORS[sec.style]??T.sub;
  ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='bottom';
  ctx.fillText(`Runner-up: ${STYLE_ICONS[sec.style]??''} ${sec.style} (${sec.confidence}%)`,x+130,y+h-8);

  ctx.restore();
}

// ─── Confidence bar ───────────────────────────────────────────────────────────
function _confBar(ctx,x,y,w,h,s,T){
  ctx.save();
  const ac=STYLE_COLORS[s.style]??T.sub;
  const lw=100, bx=x+lw, bw=w-lw-52;

  ctx.fillStyle=s.rank<=3?T.text:T.sub; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${STYLE_ICONS[s.style]??''} ${s.style}`,x,y+h/2);

  // Track
  ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,bx,y,bw,h,4); ctx.fill(); ctx.stroke();

  // Fill
  const fw=Math.max(2,(s.confidence/100)*bw);
  ctx.fillStyle=s.rank===1?ac:ac+'88'; _rr(ctx,bx,y,fw,h,4); ctx.fill();

  // Confidence %
  ctx.fillStyle=s.rank===1?ac:T.sub; ctx.font=s.rank===1?'700 10px "JetBrains Mono",monospace':FONT_MONO;
  ctx.textAlign='right'; ctx.fillText(`${s.confidence}%`,x+w,y+h/2);

  // Rank badge for top 3
  if(s.rank<=3){
    const bw2=18,bh=h;
    ctx.fillStyle=s.rank===1?ac:s.rank===2?T.warn:T.sub;
    ctx.fillStyle=s.rank===1?ac+'33':T.grid;
    ctx.strokeStyle=s.rank===1?ac:T.border; ctx.lineWidth=.5;
    _rr(ctx,x+w-48,y,22,bh,3); ctx.fill(); ctx.stroke();
    ctx.fillStyle=s.rank===1?ac:T.sub; ctx.font='700 8px "JetBrains Mono",monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(`#${s.rank}`,x+w-37,y+bh/2);
  }
  ctx.restore();
}

// ─── Radar chart ──────────────────────────────────────────────────────────────
function _radarChart(ctx,x,y,w,h,features,T){
  _card(ctx,x,y,w,h,T);
  const cx=x+w/2, cy=y+h/2+8, r=Math.min(w,h)/2-24;
  const N=RADAR_AXES.length;

  ctx.save();
  // Grid rings
  [0.25,0.5,0.75,1].forEach(scale=>{
    ctx.strokeStyle=T.grid; ctx.lineWidth=.5;
    ctx.beginPath();
    RADAR_AXES.forEach((_,i)=>{
      const a=(i/N)*Math.PI*2-Math.PI/2;
      const px=cx+Math.cos(a)*r*scale, py=cy+Math.sin(a)*r*scale;
      i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
    });
    ctx.closePath(); ctx.stroke();
  });

  // Axis spokes + labels
  RADAR_AXES.forEach(({label},i)=>{
    const a=(i/N)*Math.PI*2-Math.PI/2;
    const px=cx+Math.cos(a)*r, py=cy+Math.sin(a)*r;
    ctx.strokeStyle=T.grid; ctx.lineWidth=.5;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(px,py); ctx.stroke();
    ctx.fillStyle=T.label; ctx.font='500 8px Inter,sans-serif';
    ctx.textAlign=Math.abs(Math.cos(a))<0.1?'center':Math.cos(a)>0?'left':'right';
    ctx.textBaseline=Math.sin(a)<-0.5?'bottom':Math.sin(a)>0.5?'top':'middle';
    ctx.fillText(label,px+(Math.cos(a)*12),py+(Math.sin(a)*12));
  });

  // Feature polygon
  ctx.save(); ctx.strokeStyle=T.orange; ctx.fillStyle=T.orange+'33'; ctx.lineWidth=2;
  ctx.beginPath();
  RADAR_AXES.forEach(({key,max},i)=>{
    const val=clamp((features[key]??0)/max,0,1);
    const a=(i/N)*Math.PI*2-Math.PI/2;
    const px=cx+Math.cos(a)*r*val, py=cy+Math.sin(a)*r*val;
    i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
  });
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Dots on polygon vertices
  RADAR_AXES.forEach(({key,max},i)=>{
    const val=clamp((features[key]??0)/max,0,1);
    const a=(i/N)*Math.PI*2-Math.PI/2;
    const px=cx+Math.cos(a)*r*val, py=cy+Math.sin(a)*r*val;
    ctx.fillStyle=T.orange; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(px,py,3.5,0,Math.PI*2); ctx.fill(); ctx.stroke();
  });

  ctx.restore();
}

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

// ─── Feature table (right of radar) ──────────────────────────────────────────
function _featureTable(ctx,x,y,w,h,result,T){
  _card(ctx,x,y,w,h,T); ctx.save();
  const rows=[
    ['Avg Lum',  result.features.avgLum+''],
    ['Avg Sat',  result.features.avgSat+'%'],
    ['Contrast', result.features.contrast+''],
    ['Skin',     result.features.skinPct+'%'],
    ['D-Range',  result.features.dynamicRange+''],
    ['Hue Spread',result.features.hueSpread+'°'],
    ['Warmth',   (result.features.warmth>0?'+':'')+result.features.warmth],
    ['Shadow',   result.features.shadowMass+'%'],
    ['Highlight',result.features.highlightMass+'%'],
    ['Neutral',  result.features.neutralPct+'%'],
  ];
  const rh=Math.floor((h-12)/rows.length);
  rows.forEach(([lbl,val],i)=>{
    const ry=y+6+i*rh;
    ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(lbl,x+8,ry+rh/2);
    ctx.fillStyle=T.text; ctx.font=FONT_MONO; ctx.textAlign='right';
    ctx.fillText(val,x+w-8,ry+rh/2);
    if(i<rows.length-1){ctx.strokeStyle=T.border;ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(x+8,ry+rh);ctx.lineTo(x+w-8,ry+rh);ctx.stroke();}
  });
  ctx.restore();
}

// ─── Trait chips ─────────────────────────────────────────────────────────────
function _traitChips(ctx,x,y,w,h,traits,ac,T){
  ctx.save();
  let cx2=x;
  (traits??[]).forEach(trait=>{
    ctx.font='600 9px Inter,sans-serif';
    const tw=ctx.measureText(trait).width+16, ch=20;
    if(cx2+tw>x+w) return;
    ctx.fillStyle=ac+'22'; ctx.strokeStyle=ac; ctx.lineWidth=.5;
    _rr(ctx,cx2,y+7,tw,ch,5); ctx.fill(); ctx.stroke();
    ctx.fillStyle=ac; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(trait,cx2+8,y+7+ch/2);
    cx2+=tw+6;
  });
  ctx.restore();
}

// ─── Feature detail bars ──────────────────────────────────────────────────────
function _featureBars(ctx,x,y,w,feats,T){
  const items=[
    {label:'Avg Luminance',   val:feats.avgLum,      max:255, color:T.orange},
    {label:'Avg Saturation',  val:feats.avgSat,      max:100, color:'#c07030'},
    {label:'Contrast (σ)',    val:feats.contrast,    max:100, color:'#4060cc'},
    {label:'Skin Coverage',   val:feats.skinPct,     max:60,  color:'#c08060'},
    {label:'Hue Spread',      val:feats.hueSpread,   max:200, color:'#27714a'},
    {label:'Dynamic Range',   val:feats.dynamicRange,max:255, color:'#8a4a2a'},
  ];
  items.forEach((it,i)=>{
    const ry=y+i*(BAR_H+3), lw=130, bx=x+lw, bw=w-lw-52;
    ctx.save();
    ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(it.label,x,ry+BAR_H/2);
    ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5;
    _rr(ctx,bx,ry,bw,BAR_H,4); ctx.fill(); ctx.stroke();
    const fw=Math.max(3,(it.val/it.max)*bw);
    ctx.fillStyle=it.color+'cc'; _rr(ctx,bx,ry,fw,BAR_H,4); ctx.fill();
    ctx.fillStyle=it.color; ctx.font=FONT_MONO; ctx.textAlign='right'; ctx.textBaseline='middle';
    ctx.fillText(String(it.val),x+w,ry+BAR_H/2);
    ctx.restore();
  });
}

function _sec(ctx,x,y,text,T){ctx.save();ctx.fillStyle=T.label;ctx.font=FONT;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);const tw=ctx.measureText(text.toUpperCase()).width;ctx.strokeStyle=T.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+tw+8,y+LABEL_H/2);ctx.lineTo(x+9999,y+LABEL_H/2);ctx.stroke();ctx.restore();}
function _card(ctx,x,y,w,h,T){ctx.save();ctx.fillStyle=T.panel;ctx.strokeStyle=T.border;ctx.lineWidth=1;_rr(ctx,x,y,w,h,10);ctx.fill();ctx.stroke();ctx.restore();}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
