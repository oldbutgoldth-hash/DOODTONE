/**
 * ui/colorgrading-renderer.js
 *
 * Canvas: Look selector row · Zone analysis cards · Color wheel per zone ·
 *         Hue/Sat/Balance sliders · Blending bar · Summary
 */

const PAD=14,GAP=10,LABEL_H=20,ZONE_CARD_H=148,WHEEL_R=36,BLEND_H=16;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

const ZONE_CFG={
  shadows:   {icon:'🌑',label:'Shadows',   bg:'rgba(20,15,8,.85)',   accent:'#4060cc'},
  midtones:  {icon:'🌗',label:'Midtones',  bg:'rgba(90,70,45,.85)',  accent:'#8a6a4e'},
  highlights:{icon:'🌕',label:'Highlights',bg:'rgba(240,220,190,.85)',accent:'#e5a000'},
};

function mkT(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',panelB:dark?'rgba(40,28,14,.45)':'rgba(248,240,230,.7)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

export function renderColorGrading(canvas, result, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;

  const BANNER_H=28, LOOK_H=40, colW=Math.floor((W-PAD*2-GAP*2)/3);
  const totalH=PAD
    +LABEL_H+BANNER_H+GAP
    +LABEL_H+LOOK_H+GAP
    +LABEL_H+ZONE_CARD_H+GAP
    +LABEL_H+BLEND_H+GAP
    +LABEL_H+52          // analysis detail
    +PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Summary banner
  _sec(ctx,PAD,y,'Color Grading AI — Zone Analysis',T); y+=LABEL_H;
  _banner(ctx,PAD,y,W-PAD*2,BANNER_H,result,T); y+=BANNER_H+GAP;

  // 2. Look selector row
  _sec(ctx,PAD,y,'Applied Creative Look',T); y+=LABEL_H;
  _lookRow(ctx,PAD,y,W-PAD*2,LOOK_H,result,T); y+=LOOK_H+GAP;

  // 3. Three zone cards (side-by-side)
  _sec(ctx,PAD,y,'Shadow · Midtone · Highlight Grade',T); y+=LABEL_H;
  ['shadows','midtones','highlights'].forEach((zone,i)=>{
    _zoneCard(ctx, PAD+i*(colW+GAP), y, colW, ZONE_CARD_H, zone, result[zone], T);
  });
  y+=ZONE_CARD_H+GAP;

  // 4. Blending bar
  _sec(ctx,PAD,y,'Zone Blending',T); y+=LABEL_H;
  _blendBar(ctx,PAD,y,W-PAD*2,BLEND_H,result,T); y+=BLEND_H+GAP;

  // 5. Analysis detail
  _sec(ctx,PAD,y,'Zone Cast Analysis',T); y+=LABEL_H;
  _castDetail(ctx,PAD,y,W-PAD*2,result,T);
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function _banner(ctx,x,y,w,h,result,T){
  ctx.save();
  ctx.fillStyle='rgba(240,115,32,.1)'; ctx.strokeStyle=T.orange; ctx.lineWidth=1.5;
  _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.text; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`🎨  ${result.lookLabel} — ${result.category}`,x+12,y+h/2);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='right';
  let s=result.summary; while(s.length>4&&ctx.measureText(s).width>w-230) s=s.slice(0,-1);
  ctx.fillText(s,x+w-10,y+h/2);
  ctx.restore();
}

// ─── Look selector ────────────────────────────────────────────────────────────
const LOOK_COLORS={Cinematic:'#1a3a5a',Portrait:'#c88860',Landscape:'#2a6a3a',Moody:'#1a1a3a',WarmFilm:'#c07030',CoolFilm:'#3060a0',Neutral:'#6a6a6a'};
const ALL_LOOKS=['Cinematic','Portrait','Landscape','Moody','WarmFilm','CoolFilm','Neutral'];

function _lookRow(ctx,x,y,w,h,result,T){
  _card(ctx,x,y,w,h,T);
  const bw=Math.floor((w-16)/ALL_LOOKS.length)-3;
  ALL_LOOKS.forEach((name,i)=>{
    const bx=x+8+i*(bw+3), isActive=name===result.look;
    const ac=LOOK_COLORS[name]??'#888';
    ctx.save();
    ctx.fillStyle=isActive?ac:T.grid; ctx.strokeStyle=isActive?ac:T.border; ctx.lineWidth=isActive?2:.5;
    _rr(ctx,bx,y+6,bw,h-12,6); ctx.fill(); ctx.stroke();
    ctx.fillStyle=isActive?'#fff':T.sub; ctx.font=`${isActive?'700':'500'} 8px Inter,sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(name.replace('Film',' Film'),bx+bw/2,y+h/2);
    ctx.restore();
  });
}

// ─── Zone card ────────────────────────────────────────────────────────────────
function _zoneCard(ctx,x,y,w,h,zoneName,zone,T){
  const cfg=ZONE_CFG[zoneName];
  _card(ctx,x,y,w,h,T); ctx.save();

  // Top accent
  ctx.fillStyle=cfg.accent; _rr(ctx,x,y,w,4,[8,8,0,0]); ctx.fill();

  // Icon + label
  ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(cfg.icon,x+10,y+8);
  ctx.fillStyle=T.label; ctx.font='700 9px Inter,sans-serif'; ctx.fillText(cfg.label.toUpperCase(),x+26,y+10);

  // ── Mini colour wheel showing hue ──
  const wR=WHEEL_R, wx=x+w-wR-10, wy=y+h/2-4;
  _colourWheel(ctx,wx,wy,wR,zone.hue,zone.sat);

  // ── Hue/Sat/Balance sliders ──
  const sliders=[
    {label:'Hue', val:zone.hue,     min:0,    max:360, sfx:'°', color:cfg.accent},
    {label:'Sat', val:zone.sat,     min:0,    max:100, sfx:'',  color:'#c07030'},
    {label:'Bal', val:zone.balance, min:-100, max:100, sfx:'',  color:'#2a7a8a'},
  ];
  sliders.forEach((sl,i)=>{
    const ry=y+28+i*26, tx=x+8, tw=w-wR*2-22, th=9;
    ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(sl.label,tx,ry+th/2);
    const lw=24,bx=tx+lw,bw=tw-lw;
    // Track
    let g;
    if(sl.label==='Hue'){g=ctx.createLinearGradient(bx,0,bx+bw,0);[0,60,120,180,240,300,360].forEach(d=>g.addColorStop(d/360,`hsl(${d},80%,55%)`));}
    else if(sl.label==='Sat'){g=ctx.createLinearGradient(bx,0,bx+bw,0);g.addColorStop(0,'#ccc');g.addColorStop(1,cfg.accent);}
    else{g=ctx.createLinearGradient(bx,0,bx+bw,0);g.addColorStop(0,'#4060cc');g.addColorStop(.5,'#888');g.addColorStop(1,'#e5a000');}
    ctx.fillStyle=g; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,bx,ry,bw,th,3); ctx.fill(); ctx.stroke();
    // Needle
    const nx=bx+((sl.val-sl.min)/(sl.max-sl.min))*bw;
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(nx,ry-1); ctx.lineTo(nx,ry+th+1); ctx.stroke();
    // Value
    ctx.fillStyle=sl.color; ctx.font=FONT_MONO; ctx.textAlign='right'; ctx.textBaseline='middle';
    ctx.fillText(`${sl.val}${sl.sfx}`,tx+tw+14,ry+th/2);
  });

  // Analysis snippet
  const an=zone.analysis;
  ctx.fillStyle=T.sub; ctx.font='500 7px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(`${an.castLabel} · ${an.coveragePct}% pixels · avg L ${an.avgL}%`,x+8,y+h-13);
  ctx.restore();
}

// ─── Mini colour wheel ────────────────────────────────────────────────────────
function _colourWheel(ctx,cx,cy,r,hue,sat){
  // Draw hue ring
  for(let deg=0;deg<360;deg+=4){
    const a=((deg-90)*Math.PI)/180;
    const a2=(((deg+4)-90)*Math.PI)/180;
    ctx.save();
    ctx.fillStyle=`hsl(${deg},80%,55%)`;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,a,a2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Inner white circle
  ctx.save(); ctx.fillStyle='rgba(255,255,255,.15)'; ctx.beginPath(); ctx.arc(cx,cy,r*.5,0,Math.PI*2); ctx.fill();
  // Selected hue dot on ring
  const ha=((hue-90)*Math.PI/180);
  const dr=r*0.76;
  const dx=cx+Math.cos(ha)*dr, dy=cy+Math.sin(ha)*dr;
  const satR=Math.max(3,sat/10);
  ctx.fillStyle='#fff'; ctx.strokeStyle='rgba(0,0,0,.5)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(dx,dy,satR+1,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle=`hsl(${hue},80%,55%)`;
  ctx.beginPath(); ctx.arc(dx,dy,satR,0,Math.PI*2); ctx.fill();
  // Hue text in centre
  ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font='700 8px "JetBrains Mono",monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(`${hue}°`,cx,cy);
  ctx.restore();
}

// ─── Blending bar ─────────────────────────────────────────────────────────────
function _blendBar(ctx,x,y,w,h,result,T){
  _card(ctx,x,y,w,h+24,T);
  const bx=x+10,bw=w-20,by=y+4,bh=h;
  // Gradient: shadow blue → mid grey → highlight gold
  const g=ctx.createLinearGradient(bx,0,bx+bw,0);
  g.addColorStop(0,'#4060cc'); g.addColorStop(.5,'#888'); g.addColorStop(1,'#e5a000');
  ctx.fillStyle=g; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,bx,by,bw,bh,6); ctx.fill(); ctx.stroke();
  // Blending needle
  const nx=bx+(result.blending/100)*bw;
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(nx,by-2); ctx.lineTo(nx,by+bh+2); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='700 9px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.fillText(`Blending: ${result.blending}`,nx,by+bh+4);
  // Zone labels
  ctx.fillStyle='rgba(255,255,255,.8)'; ctx.font='500 8px Inter,sans-serif';
  ctx.textAlign='left';   ctx.fillText('Shadows',    bx+4,   by+bh/2);
  ctx.textAlign='center'; ctx.fillText('Midtones',   bx+bw/2,by+bh/2);
  ctx.textAlign='right';  ctx.fillText('Highlights', bx+bw-4,by+bh/2);
}

// ─── Cast detail ──────────────────────────────────────────────────────────────
function _castDetail(ctx,x,y,w,result,T){
  _card(ctx,x,y,w,52,T); ctx.save();
  const cols=3, colW=Math.floor((w-16)/cols);
  ['shadows','midtones','highlights'].forEach((z,i)=>{
    const an=result[z].analysis, cfg=ZONE_CFG[z];
    const cx=x+8+i*colW, cy=y+8;
    ctx.fillStyle=cfg.accent; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(`${cfg.icon} ${cfg.label}`,cx,cy);
    ctx.fillStyle=T.sub; ctx.font=FONT_SM;
    ctx.fillText(`Cast: ${an.castLabel}`,cx,cy+13);
    ctx.fillText(`R${an.avgR} G${an.avgG} B${an.avgB} · ${an.coveragePct}%`,cx,cy+25);
    // Warmth indicator
    const warmW=70, warmX=cx, warmY=cy+38;
    const wg=ctx.createLinearGradient(warmX,0,warmX+warmW,0);
    wg.addColorStop(0,'#4060cc'); wg.addColorStop(.5,'#888'); wg.addColorStop(1,'#e08030');
    ctx.fillStyle=wg; _rr(ctx,warmX,warmY,warmW,6,3); ctx.fill();
    const wn=warmX+((an.warmth+1)/2)*warmW;
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(wn,warmY-1); ctx.lineTo(wn,warmY+7); ctx.stroke();
  });
  ctx.restore();
}

function _sec(ctx,x,y,text,T){ctx.save();ctx.fillStyle=T.label;ctx.font=FONT;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);const tw=ctx.measureText(text.toUpperCase()).width;ctx.strokeStyle=T.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+tw+8,y+LABEL_H/2);ctx.lineTo(x+9999,y+LABEL_H/2);ctx.stroke();ctx.restore();}
function _card(ctx,x,y,w,h,T){ctx.save();ctx.fillStyle=T.panel;ctx.strokeStyle=T.border;ctx.lineWidth=1;_rr(ctx,x,y,w,h,10);ctx.fill();ctx.stroke();ctx.restore();}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
