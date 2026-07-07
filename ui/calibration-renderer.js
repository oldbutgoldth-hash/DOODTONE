/**
 * ui/calibration-renderer.js
 *
 * Canvas: Summary banner · CIE xy chromaticity diagram ·
 *         3 Primary cards (Red / Green / Blue) ·
 *         Hue & Sat sliders · Coverage bars · Reason text
 */

const PAD=14, GAP=10, LABEL_H=20, CARD_H=130, CHROM_H=180, BANNER_H=28;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

const P_CFG={
  red:  {icon:'🔴',label:'Red Primary',   color:'rgba(220,60,60,1)',   fill:'rgba(220,60,60,.12)', idealHue:0,   idealXY:{x:.640,y:.330}},
  green:{icon:'🟢',label:'Green Primary', color:'rgba(40,180,60,1)',   fill:'rgba(40,180,60,.12)', idealHue:120, idealXY:{x:.300,y:.600}},
  blue: {icon:'🔵',label:'Blue Primary',  color:'rgba(60,110,220,1)',  fill:'rgba(60,110,220,.12)',idealHue:240, idealXY:{x:.150,y:.060}},
};

function mkT(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)',bg:dark?'#1a1510':'#f8f4ee',ok:'#27714a',warn:'#e5a000',err:'#c0392b',orange:'#f07320'};}

export function renderCalibration(canvas, result, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;
  const colW=Math.floor((W-PAD*2-GAP*2)/3);

  const totalH=PAD
    +LABEL_H+BANNER_H+GAP
    +LABEL_H+CHROM_H+GAP
    +LABEL_H+CARD_H+GAP
    +LABEL_H+(14+4)*6   // reason rows
    +PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Banner
  _sec(ctx,PAD,y,'Calibration Engine — Primary Colour Analysis',T); y+=LABEL_H;
  _banner(ctx,PAD,y,W-PAD*2,BANNER_H,result,T); y+=BANNER_H+GAP;

  // 2. CIE xy chromaticity diagram
  _sec(ctx,PAD,y,'CIE xy Chromaticity — Primary Positions',T); y+=LABEL_H;
  _chromaticityDiagram(ctx,PAD,y,W-PAD*2,CHROM_H,result,T); y+=CHROM_H+GAP;

  // 3. Three primary cards
  _sec(ctx,PAD,y,'Red · Green · Blue Primary Calibration',T); y+=LABEL_H;
  ['red','green','blue'].forEach((p,i)=>
    _primaryCard(ctx, PAD+i*(colW+GAP), y, colW, CARD_H, p, result[p], T)
  );
  y+=CARD_H+GAP;

  // 4. Reason rows
  _sec(ctx,PAD,y,'Analysis & Reasoning',T); y+=LABEL_H;
  ['red','green','blue'].forEach((p,i)=>{
    const pr=result[p];
    _reasonRow(ctx,PAD,y+i*2*(14+4),      W-PAD*2,14,`${P_CFG[p].icon} ${P_CFG[p].label} — Hue`,  pr.hueReason, P_CFG[p].color,T);
    _reasonRow(ctx,PAD,y+(i*2+1)*(14+4),  W-PAD*2,14,`${P_CFG[p].icon} ${P_CFG[p].label} — Sat`,  pr.satReason,  P_CFG[p].color,T);
  });
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function _banner(ctx,x,y,w,h,result,T){
  ctx.save();
  ctx.fillStyle='rgba(240,115,32,.1)'; ctx.strokeStyle=T.orange; ctx.lineWidth=1.5;
  _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.text; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`⚙️  ${result.sceneLabel}`,x+12,y+h/2);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='right';
  let s=result.summary; while(s.length>4&&ctx.measureText(s).width>w-220) s=s.slice(0,-1);
  ctx.fillText(s,x+w-10,y+h/2);
  ctx.restore();
}

// ─── CIE xy Chromaticity diagram ─────────────────────────────────────────────
// Simplified horse-shoe outline + sRGB triangle + measured positions

const CIE_OUTLINE=[
  [.1748,.0050],[.1736,.0050],[.1721,.0050],[.1714,.0050],[.1703,.0058],
  [.1689,.0069],[.1676,.0077],[.1663,.0082],[.1649,.0089],[.1634,.0098],
  [.1608,.0116],[.1580,.0142],[.1544,.0177],[.1502,.0225],[.1454,.0280],
  [.1401,.0346],[.1338,.0430],[.1266,.0541],[.1174,.0692],[.1070,.0872],
  [.0949,.1128],[.0820,.1390],[.0686,.1693],[.0540,.2080],[.0387,.2586],
  [.0213,.3228],[.0147,.3584],[.0124,.3936],[.0141,.4242],[.0201,.4604],
  [.0257,.4934],[.0305,.5237],[.0352,.5535],[.0433,.5902],[.0520,.6245],
  [.0640,.6602],[.0784,.6962],[.0980,.7280],[.1240,.7545],[.1572,.7742],
  [.1953,.7927],[.2310,.8059],[.2650,.8148],[.3000,.8148],[.3365,.8112],
  [.3700,.8016],[.4070,.7848],[.4435,.7572],[.4790,.7230],[.5125,.6878],
  [.5460,.6502],[.5788,.6099],[.6100,.5694],[.6395,.5280],[.6640,.4855],
  [.6847,.4424],[.7010,.3986],[.7140,.3544],[.7220,.3120],[.7270,.2700],
  [.7300,.2650],[.7344,.2739],[.7514,.3260],[.7721,.3916],[.7905,.4423],
  [.8056,.4859],[.8200,.5323],[.8286,.5659],[.8346,.5890],[.8396,.6070],
  [.8414,.6130],[.8346,.6070],[.8262,.5940],[.7914,.5500],[.7218,.4772],
  [.6210,.3914],[.5000,.3000],[.3780,.2100],[.2520,.1340],[.1748,.0050],
];

function _chromaXY(cx,cy,w,h,x,y){
  // Map CIE x[0.0-0.8] y[0.0-0.9] to canvas
  return { px: cx+(x/0.82)*w, py: cy+h-(y/0.92)*h };
}

function _chromaticityDiagram(ctx,x,y,w,h,result,T){
  _card(ctx,x,y,w,h+LABEL_H,T);
  const bx=x+8, by=y+4, bw=w-16, bh=h-8;

  ctx.save();

  // Background gradient (approximate visible spectrum)
  const bg=ctx.createLinearGradient(bx,by,bx+bw,by+bh);
  bg.addColorStop(0,'rgba(0,0,60,.4)'); bg.addColorStop(.3,'rgba(0,80,0,.3)');
  bg.addColorStop(.6,'rgba(200,200,0,.3)'); bg.addColorStop(1,'rgba(200,0,0,.3)');
  ctx.fillStyle=bg; _rr(ctx,bx,by,bw,bh,6); ctx.fill();

  // Horse-shoe outline (simplified)
  ctx.save(); ctx.strokeStyle='rgba(150,150,150,.5)'; ctx.lineWidth=1;
  ctx.beginPath();
  CIE_OUTLINE.forEach(([cx2,cy2],i)=>{
    const {px,py}=_chromaXY(bx,by,bw,bh,cx2,cy2);
    i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
  });
  ctx.closePath(); ctx.stroke(); ctx.restore();

  // sRGB triangle
  const sRGB=[P_CFG.red.idealXY,P_CFG.green.idealXY,P_CFG.blue.idealXY];
  ctx.save(); ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
  ctx.beginPath();
  sRGB.forEach(({x:cx2,y:cy2},i)=>{
    const {px,py}=_chromaXY(bx,by,bw,bh,cx2,cy2);
    i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
  });
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); ctx.restore();

  // D65 white point
  const {px:wpx,py:wpy}=_chromaXY(bx,by,bw,bh,0.3127,0.3290);
  ctx.fillStyle='rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(wpx,wpy,4,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=T.sub; ctx.font='7px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText('D65',wpx,wpy-5);

  // sRGB primaries (ideal)
  ['red','green','blue'].forEach(p=>{
    const cfg=P_CFG[p], {px,py}=_chromaXY(bx,by,bw,bh,cfg.idealXY.x,cfg.idealXY.y);
    ctx.strokeStyle=cfg.color; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(px,py,5,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle=T.sub; ctx.font='7.5px Inter,sans-serif'; ctx.textAlign='center';
    ctx.textBaseline=p==='green'?'bottom':'top';
    ctx.fillText(`sRGB ${p.charAt(0).toUpperCase()+p.slice(1)}`,px,p==='green'?py-7:py+7);
  });

  // Measured positions
  ['red','green','blue'].forEach(p=>{
    const pr=result[p], cfg=P_CFG[p];
    if(pr.pixelCount===0) return;
    const {px,py}=_chromaXY(bx,by,bw,bh,pr.chromaticity.x,pr.chromaticity.y);
    // Line from ideal to measured
    const {px:ix,py:iy}=_chromaXY(bx,by,bw,bh,cfg.idealXY.x,cfg.idealXY.y);
    ctx.save(); ctx.strokeStyle=cfg.color; ctx.lineWidth=1; ctx.setLineDash([2,2]);
    ctx.beginPath(); ctx.moveTo(ix,iy); ctx.lineTo(px,py); ctx.stroke(); ctx.setLineDash([]);
    // Measured dot
    ctx.fillStyle=cfg.color; ctx.beginPath(); ctx.arc(px,py,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(px,py,2.5,0,Math.PI*2); ctx.fill();
    // Coverage label
    ctx.fillStyle=cfg.color; ctx.font='700 8px "JetBrains Mono",monospace';
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillText(`${pr.coveragePct}%`,px,py-7);
    ctx.restore();
  });

  // Legend
  ctx.fillStyle=T.sub; ctx.font='7.5px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='bottom';
  ctx.fillText('○ sRGB ideal  ● measured  ---- deviation',bx+6,by+bh-2);

  ctx.restore();
}

// ─── Primary card ─────────────────────────────────────────────────────────────
function _primaryCard(ctx,x,y,w,h,pName,pr,T){
  const cfg=P_CFG[pName];
  _card(ctx,x,y,w,h,T); ctx.save();

  // Top accent
  ctx.fillStyle=cfg.color; _rr(ctx,x,y,w,3,[8,8,0,0]); ctx.fill();
  ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(cfg.icon,x+10,y+8);
  ctx.fillStyle=T.label; ctx.font='700 9px Inter,sans-serif'; ctx.fillText(cfg.label.toUpperCase(),x+26,y+10);

  // Coverage badge
  const cov=pr.coveragePct, covC=cov>15?T.ok:cov>5?T.orange:T.sub;
  ctx.fillStyle=covC+'22'; ctx.strokeStyle=covC; ctx.lineWidth=.5;
  _rr(ctx,x+w-60,y+8,52,14,5); ctx.fill(); ctx.stroke();
  ctx.fillStyle=covC; ctx.font='700 8px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(`${cov}% px`,x+w-34,y+15);

  // LR values (large)
  ctx.fillStyle=cfg.color; ctx.font='700 17px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(`H:${pr.hue>=0?'+':''}${pr.hue}  S:${pr.sat>=0?'+':''}${pr.sat}`,x+10,y+28);

  // Hue slider
  _calSlider(ctx,x+10,y+52,w-20,10,'Hue',pr.hue,-100,100,cfg.color,T,'hue');
  // Sat slider
  _calSlider(ctx,x+10,y+68,w-20,10,'Sat',pr.sat,-100,100,cfg.color,T,'sat');

  // Measured stats
  ctx.fillStyle=T.sub; ctx.font=FONT_MONO; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(`Hue: ${pr.avgHue}°  Sat: ${pr.avgSat}%  Lum: ${pr.avgLum}%`,x+10,y+85);

  // Chromaticity
  ctx.fillText(`xy(${pr.chromaticity.x}, ${pr.chromaticity.y})  Δ:${pr.chromDist??'—'}`,x+10,y+98);

  // Drift indicator
  const drift=pr.hueDrift, driftC=Math.abs(drift)>15?T.err:Math.abs(drift)>8?T.warn:T.ok;
  ctx.fillStyle=driftC; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='right'; ctx.textBaseline='top';
  ctx.fillText(`Drift: ${drift>=0?'+':''}${drift}°`,x+w-10,y+85);

  ctx.restore();
}

function _calSlider(ctx,x,y,w,h,label,val,min,max,color,T,type){
  ctx.save();
  ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(label,x,y+h/2);
  const lw=22, bx=x+lw, bw=w-lw-36;
  // Gradient track
  let g;
  if(type==='hue'){g=ctx.createLinearGradient(bx,0,bx+bw,0);[-100,-50,0,50,100].forEach((v,i)=>g.addColorStop(i/4,`hsl(${120+v},80%,55%)`));}
  else{g=ctx.createLinearGradient(bx,0,bx+bw,0);g.addColorStop(0,'#4060cc');g.addColorStop(.5,'#888');g.addColorStop(1,color);}
  ctx.fillStyle=g; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,bx,y,bw,h,3); ctx.fill(); ctx.stroke();
  // Centre + needle
  const cx2=bx+((0-min)/(max-min))*bw, nx=bx+((val-min)/(max-min))*bw;
  const fx=Math.min(cx2,nx), fw=Math.abs(nx-cx2);
  if(fw>1){ctx.fillStyle=color+'aa'; _rr(ctx,fx,y,fw,h,3); ctx.fill();}
  ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(nx,y-1); ctx.lineTo(nx,y+h+1); ctx.stroke();
  // Value
  ctx.fillStyle=color; ctx.font=FONT_MONO; ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillText(`${val>=0?'+':''}${val}`,x+w,y+h/2);
  ctx.restore();
}

// ─── Reason row ───────────────────────────────────────────────────────────────
function _reasonRow(ctx,x,y,w,h,label,text,color,T){
  ctx.save();
  ctx.fillStyle=color; ctx.font='700 8px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(label,x,y+h/2);
  const lw=ctx.measureText(label).width+8;
  ctx.fillStyle=T.sub; ctx.font=FONT_SM;
  let t=text; while(t.length>4&&ctx.measureText(t+'…').width>w-lw) t=t.slice(0,-1);
  ctx.fillText(text.length>t.length?t+'…':text, x+lw, y+h/2);
  ctx.restore();
}

function _sec(ctx,x,y,text,T){ctx.save();ctx.fillStyle=T.label;ctx.font=FONT;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);const tw=ctx.measureText(text.toUpperCase()).width;ctx.strokeStyle=T.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+tw+8,y+LABEL_H/2);ctx.lineTo(x+9999,y+LABEL_H/2);ctx.stroke();ctx.restore();}
function _card(ctx,x,y,w,h,T){ctx.save();ctx.fillStyle=T.panel;ctx.strokeStyle=T.border;ctx.lineWidth=1;_rr(ctx,x,y,w,h,10);ctx.fill();ctx.stroke();ctx.restore();}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
