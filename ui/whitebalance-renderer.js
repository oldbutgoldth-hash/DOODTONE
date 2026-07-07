/**
 * ui/whitebalance-renderer.js
 * Canvas: Cast banner · Algorithm cards · Consensus · Gain bars · CCT scale
 */

const PAD=14,GAP=10,LABEL_H=20,CARD_H=88,CONS_H=64,GAIN_H=13,TEMP_H=38;
const ALG_C={'Gray World':'#2a7a8a','White Patch':'#8a4a2a','Shades of Gray':'#27714a','Consensus (weighted)':'#f07320'};
const CAST_CFG={warm:{l:'🌅 Warm Cast',bg:'rgba(240,115,32,.15)',bd:'#f07320',fg:'#a04010'},cool:{l:'❄️ Cool Cast',bg:'rgba(60,100,220,.13)',bd:'#4060cc',fg:'#203080'},green:{l:'🌿 Green Cast',bg:'rgba(40,160,80,.13)',bd:'#27714a',fg:'#1a5030'},magenta:{l:'🌸 Magenta Cast',bg:'rgba(180,40,140,.13)',bd:'#b02890',fg:'#701860'},neutral:{l:'✓ Neutral White Balance',bg:'rgba(100,160,100,.13)',bd:'#27714a',fg:'#1a5030'}};

function th(dark){return{panel:dark?'rgba(30,20,10,.55)':'rgba(255,255,255,.62)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)'};}

export function renderWhiteBalance(canvas, wb, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=th(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;
  const algW=Math.floor((W-PAD*2-GAP*2)/3);
  const totalH=PAD+LABEL_H+24+GAP+LABEL_H+CARD_H+GAP+LABEL_H+CONS_H+GAP+LABEL_H+(GAIN_H+4)*3+GAP+LABEL_H+TEMP_H+PAD;
  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Cast banner
  _secLbl(ctx,PAD,y,'Scene Colour Cast',T); y+=LABEL_H;
  _castBanner(ctx,PAD,y,W-PAD*2,24,wb,T); y+=24+GAP+4;

  // 2. Algorithm cards
  _secLbl(ctx,PAD,y,'Algorithm Results',T); y+=LABEL_H;
  [wb.grayWorld,wb.whitePatch,wb.shadesOfGray].forEach((a,i)=>_algCard(ctx,PAD+i*(algW+GAP),y,algW,CARD_H,a,T));
  y+=CARD_H+GAP+4;

  // 3. Consensus
  _secLbl(ctx,PAD,y,'Consensus — GW 30% · WP 30% · SoG 40%',T); y+=LABEL_H;
  _consensus(ctx,PAD,y,W-PAD*2,CONS_H,wb.consensus,T); y+=CONS_H+GAP+4;

  // 4. Gain bars
  _secLbl(ctx,PAD,y,'Channel Gain Factors',T); y+=LABEL_H;
  const algs=[wb.grayWorld,wb.whitePatch,wb.shadesOfGray];
  [['gainR','R','rgba(220,60,60,.85)'],['gainG','G','rgba(50,180,70,.85)'],['gainB','B','rgba(60,100,220,.85)']].forEach(([k,l,c],i)=>
    _gainRow(ctx,PAD,y+i*(GAIN_H+4),W-PAD*2,GAIN_H,algs,k,l,c,T));
  y+=(GAIN_H+4)*3+GAP+4;

  // 5. CCT scale
  _secLbl(ctx,PAD,y,'CCT Scale (Kelvin)',T); y+=LABEL_H;
  _cctScale(ctx,PAD,y,W-PAD*2,TEMP_H,[wb.grayWorld,wb.whitePatch,wb.shadesOfGray,wb.consensus],T);
}

function _castBanner(ctx,x,y,w,h,wb,T) {
  const cfg=CAST_CFG[wb.cast]??CAST_CFG.neutral;
  ctx.save(); ctx.fillStyle=cfg.bg; ctx.strokeStyle=cfg.bd; ctx.lineWidth=1.5; _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.fillStyle=cfg.fg; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(cfg.l,x+12,y+h/2);
  const {r,g,b}=wb.sceneAvg; const sx=x+w-140;
  ctx.fillStyle=`rgb(${r},${g},${b})`; _rr(ctx,sx,y+4,14,h-8,3); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,.15)'; ctx.lineWidth=.5; ctx.stroke();
  ctx.fillStyle=T.sub; ctx.font='500 8.5px Inter,sans-serif'; ctx.textAlign='left';
  ctx.fillText(`Scene avg  rgb(${r}, ${g}, ${b})`,sx+18,y+h/2);
  ctx.restore();
}

function _algCard(ctx,x,y,w,h,alg,T) {
  const ac=ALG_C[alg.label]??'#888';
  ctx.save();
  ctx.fillStyle=T.panel; ctx.strokeStyle=T.border; ctx.lineWidth=1; _rr(ctx,x,y,w,h,10); ctx.fill(); ctx.stroke();
  ctx.fillStyle=ac; _rr(ctx,x,y,w,4,[10,10,0,0]); ctx.fill();
  ctx.fillStyle=ac; ctx.font='700 8px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(alg.label.toUpperCase(),x+w/2,y+10);
  ctx.fillStyle=T.text; ctx.font='700 15px "JetBrains Mono",monospace'; ctx.fillText(`${alg.kelvin.toLocaleString()} K`,x+w/2,y+22);
  _miniSl(ctx,x+8,y+42,w-16,10,alg.temperature,-100,100,ac,'Temp',T);
  _miniSl(ctx,x+8,y+58,w-16,10,alg.tint,-100,100,'#b02890','Tint',T);
  ctx.fillStyle=T.sub; ctx.font='500 7px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.fillText(`R×${alg.gainR.toFixed(3)}  G×${alg.gainG.toFixed(3)}  B×${alg.gainB.toFixed(3)}`,x+w/2,y+74);
  ctx.restore();
}

function _miniSl(ctx,x,y,w,h,val,mn,mx,color,lbl,T) {
  ctx.save(); ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,x,y,w,h,3); ctx.fill(); ctx.stroke();
  const cx2=x+((0-mn)/(mx-mn))*w, vx=x+((val-mn)/(mx-mn))*w, fx=Math.min(cx2,vx), fw=Math.abs(vx-cx2);
  if(fw>0){ctx.fillStyle=color; _rr(ctx,fx,y,fw,h,3); ctx.fill();}
  ctx.strokeStyle=T.text; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(vx,y-1); ctx.lineTo(vx,y+h+1); ctx.stroke();
  ctx.fillStyle=T.sub; ctx.font='500 7px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='bottom'; ctx.fillText(lbl,x,y-1);
  ctx.fillStyle=color; ctx.textAlign='right'; ctx.fillText((val>=0?'+':'')+val,x+w,y-1);
  ctx.restore();
}

function _consensus(ctx,x,y,w,h,cons,T) {
  const ac=ALG_C['Consensus (weighted)'];
  ctx.save(); ctx.fillStyle='rgba(240,115,32,.06)'; ctx.strokeStyle=ac; ctx.lineWidth=2; _rr(ctx,x,y,w,h,12); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.text; ctx.font='700 24px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(`${cons.kelvin.toLocaleString()} K`,x+18,y+h/2-6);
  ctx.fillStyle=T.sub; ctx.font='500 8px Inter,sans-serif'; ctx.fillText('Consensus CCT',x+18,y+h/2+12);
  const sx=x+w/2+8, sw=w-sx+x-PAD;
  _miniSl(ctx,sx,y+14,sw,12,cons.temperature,-100,100,ac,'Temperature',T);
  _miniSl(ctx,sx,y+38,sw,12,cons.tint,-100,100,'#b02890','Tint',T);
  ctx.restore();
}

function _gainRow(ctx,x,y,w,h,algs,key,lbl,color,T) {
  ctx.save(); ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,x,y,w,h,4); ctx.fill(); ctx.stroke();
  const segW=Math.floor((w-4)/algs.length);
  algs.forEach((alg,i)=>{
    const gain=alg[key]??1, fp=Math.min(1,gain/2), fx=x+2+i*(segW+1), fw=Math.max(2,fp*segW);
    const alpha=i===0?.85:i===1?.60:.45;
    ctx.fillStyle=color.replace('.85',`.${Math.round(alpha*100)}`); _rr(ctx,fx,y+1,fw,h-2,3); ctx.fill();
    ctx.fillStyle=T.sub; ctx.font='500 7px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(`${alg.label.split(' ')[0]}: ×${gain.toFixed(3)}`,fx+3,y+h/2);
  });
  ctx.fillStyle=color; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillText(lbl,x-4,y+h/2);
  // Unity dotted line
  ctx.strokeStyle='rgba(128,128,128,.4)'; ctx.lineWidth=1; ctx.setLineDash([2,2]);
  ctx.beginPath(); ctx.moveTo(x+w*.5,y); ctx.lineTo(x+w*.5,y+h); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}

const CCT_STOPS=[{k:1800,l:'Candle'},{k:2700,l:'Tungsten'},{k:4000,l:'Fluor.'},{k:5500,l:'Daylight'},{k:6500,l:'Overcast'},{k:9000,l:'Shade'}];
const LO=Math.log(1500), HI=Math.log(13000);
const _kx=(k,x,w)=>x+((Math.log(Math.max(1500,Math.min(13000,k)))-LO)/(HI-LO))*w;

function _cctScale(ctx,x,y,w,h,algs,T) {
  ctx.save();
  const barY=y+4, barH=16;
  const g=ctx.createLinearGradient(x,0,x+w,0);
  g.addColorStop(0,'#ff6a00'); g.addColorStop(.25,'#ffb347'); g.addColorStop(.45,'#fff4e0');
  g.addColorStop(.55,'#e8f4ff'); g.addColorStop(.75,'#aad4ff'); g.addColorStop(1,'#4080ff');
  ctx.fillStyle=g; ctx.strokeStyle=T.border; ctx.lineWidth=1; _rr(ctx,x,barY,w,barH,6); ctx.fill(); ctx.stroke();

  CCT_STOPS.forEach(({k,l})=>{
    const tx=_kx(k,x,w);
    ctx.strokeStyle='rgba(0,0,0,.3)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(tx,barY); ctx.lineTo(tx,barY+barH); ctx.stroke();
    ctx.fillStyle=T.sub; ctx.font='500 7.5px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(l,tx,barY+barH+1);
  });

  const names=['GW','WP','SoG','★'];
  const aColors=[ALG_C['Gray World'],ALG_C['White Patch'],ALG_C['Shades of Gray'],ALG_C['Consensus (weighted)']];
  algs.forEach((alg,i)=>{
    const mx=_kx(alg.kelvin,x,w), my=barY+(i%2===0?3:barH-7);
    ctx.fillStyle=aColors[i]; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(mx,my,4,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle=aColors[i]; ctx.font='700 7px Inter,sans-serif'; ctx.textAlign='center';
    ctx.textBaseline=i%2===0?'bottom':'top';
    ctx.fillText(`${names[i]} ${alg.kelvin.toLocaleString()}K`,mx,i%2===0?barY-1:barY+barH+13);
  });
  ctx.restore();
}

function _secLbl(ctx,x,y,text,T){
  ctx.save(); ctx.fillStyle=T.label; ctx.font='600 9.5px Inter,sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);
  const tw=ctx.measureText(text.toUpperCase()).width;
  ctx.strokeStyle=T.border; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(x+tw+8,y+LABEL_H/2); ctx.lineTo(x+9999,y+LABEL_H/2); ctx.stroke();
  ctx.restore();
}

function _rr(ctx,x,y,w,h,r){
  const rd=Array.isArray(r)?r:[r,r,r,r]; ctx.beginPath();
  if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}
  else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}
}
