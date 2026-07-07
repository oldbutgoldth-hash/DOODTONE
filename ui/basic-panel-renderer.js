/**
 * ui/basic-panel-renderer.js
 * Canvas: Summary banner · Zone map · 6 Slider cards · Confidence matrix
 */

const PAD=14,GAP=10,LABEL_H=20,SLIDE_H=58,CONF_H=14,ZONE_H=48;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

const SCFG={
  exposure:  {icon:'☀️',label:'Exposure',  min:-200,max:200, color:'#f07320'},
  contrast:  {icon:'◑', label:'Contrast',  min:-100,max:100, color:'#8a6a4e'},
  highlights:{icon:'🔆',label:'Highlights',min:-100,max:100, color:'#e5a000'},
  shadows:   {icon:'🔅',label:'Shadows',   min:-100,max:100, color:'#4060cc'},
  whites:    {icon:'⬜',label:'Whites',    min:-100,max:100, color:'#c0b090'},
  blacks:    {icon:'⬛',label:'Blacks',    min:-100,max:100, color:'#5a4030'},
};
const ORDER=['exposure','contrast','highlights','shadows','whites','blacks'];

function mkT(d){return{panel:d?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',panelB:d?'rgba(40,28,14,.45)':'rgba(248,240,230,.70)',border:d?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:d?'#b89e84':'#6b5843',sub:d?'#7a6248':'#9e8468',text:d?'#f0e6d8':'#1c160e',grid:d?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

export function renderBasicPanel(canvas, result, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;
  const colW=Math.floor((W-PAD*2-GAP)/2);

  const BANNER_H=28;
  const ROWS=Math.ceil(ORDER.length/2);
  const totalH=PAD+LABEL_H+BANNER_H+GAP+LABEL_H+ZONE_H+GAP+LABEL_H+ROWS*(SLIDE_H+GAP)+LABEL_H+ORDER.length*(CONF_H+4)+PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Banner
  _sec(ctx,PAD,y,'Basic Panel Analysis',T); y+=LABEL_H;
  _banner(ctx,PAD,y,W-PAD*2,BANNER_H,result,T); y+=BANNER_H+GAP;

  // 2. Zone map
  _sec(ctx,PAD,y,'Zone Distribution (Ansel Adams System)',T); y+=LABEL_H;
  _zoneMap(ctx,PAD,y,W-PAD*2,ZONE_H,result.zones,T); y+=ZONE_H+GAP;

  // 3. Slider cards
  _sec(ctx,PAD,y,'Generated Slider Values',T); y+=LABEL_H;
  ORDER.forEach((key,i)=>{
    const col=i%2, row=Math.floor(i/2);
    _sliderCard(ctx, PAD+col*(colW+GAP), y+row*(SLIDE_H+GAP), colW, SLIDE_H, key, result[key], SCFG[key], T);
  });
  y+=ROWS*(SLIDE_H+GAP);

  // 4. Confidence matrix
  _sec(ctx,PAD,y,'Confidence & Direction',T); y+=LABEL_H;
  ORDER.forEach((key,i)=>_confBar(ctx,PAD,y+i*(CONF_H+4),W-PAD*2,CONF_H,key,result[key],SCFG[key],T));
}

// ─── Banner ───────────────────────────────────────────────────────────────────
const EC={underexposed:{bg:'rgba(60,100,220,.15)',bd:'#4060cc',fg:'#1a2060',icon:'🌑',lbl:'Underexposed'},overexposed:{bg:'rgba(255,60,60,.15)',bd:'#c0392b',fg:'#600',icon:'☀️',lbl:'Overexposed'},slightly_under:{bg:'rgba(240,160,40,.13)',bd:'#e5a000',fg:'#604000',icon:'🌘',lbl:'Slightly Dark'},slightly_over:{bg:'rgba(240,160,40,.13)',bd:'#e5a000',fg:'#604000',icon:'🌔',lbl:'Slightly Bright'},correct:{bg:'rgba(39,113,74,.13)',bd:'#27714a',fg:'#0e3020',icon:'✓',lbl:'Well Exposed'}};

function _banner(ctx,x,y,w,h,result,T){
  const cfg=EC[result.exposureClass]??EC.correct;
  ctx.save();
  ctx.fillStyle=cfg.bg; ctx.strokeStyle=cfg.bd; ctx.lineWidth=1.5; _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.fillStyle=cfg.fg; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${cfg.icon}  ${cfg.lbl} — ${result.sceneLabel}`,x+12,y+h/2);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='right';
  // Truncate summary if needed
  let sum=result.summary;
  while(sum.length>10&&ctx.measureText(sum).width>w-200) sum=sum.slice(0,-2);
  ctx.fillText(sum,x+w-10,y+h/2);
  ctx.restore();
}

// ─── Zone map ─────────────────────────────────────────────────────────────────
const ZN=['shadows','darkTones','midtones','brightTones','highlights'];
const ZL=['Shadows','Dark Tones','Midtones','Bright Tones','Highlights'];
const ZC=['#1a1610','#3a2e20','#7a6a58','#c0a888','#f0e0c8'];

function _zoneMap(ctx,x,y,w,h,zones,T){
  _card(ctx,x,y,w,h+LABEL_H,T);
  const bx=x+8,by=y+4,bw=w-16,bh=h-22;
  const masses=ZN.map(n=>zones[n]?.massPct??0);
  const tot=masses.reduce((a,b)=>a+b,0)||100;
  let cx=bx;
  masses.forEach((m,i)=>{
    const fw=(m/tot)*bw;
    ctx.fillStyle=ZC[i];
    _rr(ctx,cx,by,Math.max(2,fw),bh,i===0?[4,0,0,4]:i===ZN.length-1?[0,4,4,0]:0);
    ctx.fill();
    if(fw>38){
      const lv=i>2?0:255;
      ctx.fillStyle=`rgba(${lv},${lv},${lv},.8)`; ctx.font='500 8px Inter,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(`${m.toFixed(1)}%`,cx+fw/2,by+bh/2);
    }
    cx+=fw;
  });
  // Zone labels
  cx=bx;
  masses.forEach((m,i)=>{
    const fw=(m/tot)*bw;
    if(fw>30){ctx.fillStyle=T.sub;ctx.font='7.5px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(ZL[i],cx+fw/2,by+bh+3);}
    cx+=fw;
  });
}

// ─── Slider card ──────────────────────────────────────────────────────────────
function _sliderCard(ctx,x,y,w,h,key,sr,cfg,T){
  _card(ctx,x,y,w,h,T); ctx.save();
  // Accent stripe
  ctx.fillStyle=cfg.color; _rr(ctx,x,y,w,3,[8,8,0,0]); ctx.fill();
  // Icon + label
  ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(cfg.icon,x+10,y+8);
  ctx.fillStyle=T.label; ctx.font='700 9px Inter,sans-serif'; ctx.fillText(cfg.label.toUpperCase(),x+26,y+10);
  // Value
  const val=sr.value;
  const dv=key==='exposure'?(val>=0?'+':'')+(val/100).toFixed(2)+' EV':(val>=0?'+':'')+val;
  ctx.fillStyle=cfg.color; ctx.font='700 19px "JetBrains Mono",monospace'; ctx.textAlign='right'; ctx.fillText(dv,x+w-10,y+7);
  // Track
  const tx=x+10,ty=y+32,tw=w-20,th=8;
  ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,tx,ty,tw,th,4); ctx.fill(); ctx.stroke();
  // Fill
  const ctr=tx+((0-cfg.min)/(cfg.max-cfg.min))*tw, ndl=tx+((val-cfg.min)/(cfg.max-cfg.min))*tw;
  const fx=Math.min(ctr,ndl), fw=Math.abs(ndl-ctr);
  if(fw>1){ctx.fillStyle=cfg.color+'cc'; _rr(ctx,fx,ty,fw,th,4); ctx.fill();}
  ctx.strokeStyle=T.text; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(ndl,ty-2); ctx.lineTo(ndl,ty+th+2); ctx.stroke();
  // Reason
  ctx.fillStyle=T.sub; ctx.font='500 7.5px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  const maxW=tw; let reason=sr.reason;
  while(reason.length>10&&ctx.measureText(reason+'…').width>maxW) reason=reason.slice(0,-1);
  ctx.fillText(sr.reason.length>reason.length?reason+'…':reason, tx, ty+th+5);
  ctx.restore();
}

// ─── Confidence bar ───────────────────────────────────────────────────────────
const DA={increase:'↑',decrease:'↓',neutral:'→'};

function _confBar(ctx,x,y,w,h,key,sr,cfg,T){
  ctx.save();
  const lw=86,bx=x+lw,bw=w-lw-62;
  ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${cfg.icon} ${cfg.label}`,x,y+h/2);
  ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,bx,y,bw,h,4); ctx.fill(); ctx.stroke();
  const cc=sr.confidence>0.75?T.ok:sr.confidence>0.45?T.warn:T.sub;
  ctx.fillStyle=cc+'99'; _rr(ctx,bx,y,bw*sr.confidence,h,4); ctx.fill();
  ctx.fillStyle=cc; ctx.font='700 8px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${Math.round(sr.confidence*100)}%`,bx+4,y+h/2);
  const dv=key==='exposure'?(sr.value>=0?'+':'')+(sr.value/100).toFixed(2):(sr.value>=0?'+':'')+sr.value;
  ctx.fillStyle=cfg.color; ctx.font='700 9px "JetBrains Mono",monospace'; ctx.textAlign='right'; ctx.fillText(dv,x+w-22,y+h/2);
  const ac=sr.direction==='increase'?T.ok:sr.direction==='decrease'?T.err:T.sub;
  ctx.fillStyle=ac; ctx.font='700 11px sans-serif'; ctx.textAlign='right'; ctx.fillText(DA[sr.direction],x+w-4,y+h/2);
  ctx.restore();
}

function _sec(ctx,x,y,text,T){
  ctx.save(); ctx.fillStyle=T.label; ctx.font=FONT; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);
  const tw=ctx.measureText(text.toUpperCase()).width;
  ctx.strokeStyle=T.border; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x+tw+8,y+LABEL_H/2); ctx.lineTo(x+9999,y+LABEL_H/2); ctx.stroke();
  ctx.restore();
}
function _card(ctx,x,y,w,h,T){ctx.save();ctx.fillStyle=T.panel;ctx.strokeStyle=T.border;ctx.lineWidth=1;_rr(ctx,x,y,w,h,10);ctx.fill();ctx.stroke();ctx.restore();}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
