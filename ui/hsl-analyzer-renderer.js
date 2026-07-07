/**
 * ui/hsl-analyzer-renderer.js
 *
 * Canvas: Summary bar · Coverage wheel ·
 *         8 channel cards (H/S/L bars + adjustments) ·
 *         Ranked channel list
 */

const PAD=14, GAP=10, LABEL_H=20, CARD_H=116, CONF_H=14;
const FONT='600 9.5px Inter,system-ui,sans-serif';
const FONT_MONO='600 9px "JetBrains Mono",monospace';
const FONT_SM='500 8.5px Inter,system-ui,sans-serif';

// Channel hue colours (for UI accents)
const CH_COLOR = {
  red:'#e03030', orange:'#f07320', yellow:'#d4a800',
  green:'#2a8a3a', aqua:'#1a9090', blue:'#2a50cc',
  purple:'#7030a0', magenta:'#c02880',
};

function mkT(dark){return{panel:dark?'rgba(30,20,10,.58)':'rgba(255,255,255,.65)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)',ok:'#27714a',warn:'#e5a000',err:'#c0392b'};}

export function renderHSLAnalyzer(canvas, result, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=mkT(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=canvas.offsetWidth||canvas.parentElement?.offsetWidth||560;
  const colW=Math.floor((W-PAD*2-GAP)/2);

  const BANNER_H=28, WHEEL_H=120, ROWS=4;
  const LIST_H=(CONF_H+4)*8;
  const totalH=PAD
    +LABEL_H+BANNER_H+GAP
    +LABEL_H+WHEEL_H+GAP
    +LABEL_H+ROWS*(CARD_H+GAP)
    +LABEL_H+LIST_H
    +PAD;

  canvas.width=W*dpr; canvas.height=totalH*dpr; canvas.style.height=totalH+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,totalH);
  let y=PAD;

  // 1. Summary banner
  _sec(ctx,PAD,y,'HSL Analyzer Pro — 8 Channel Analysis',T); y+=LABEL_H;
  _banner(ctx,PAD,y,W-PAD*2,BANNER_H,result,T); y+=BANNER_H+GAP;

  // 2. Coverage wheel + bar chart
  _sec(ctx,PAD,y,'Channel Coverage Distribution',T); y+=LABEL_H;
  _coverageWheel(ctx,PAD,y,W-PAD*2,WHEEL_H,result,T); y+=WHEEL_H+GAP;

  // 3. Channel cards (2-col × 4 rows)
  _sec(ctx,PAD,y,'Per-Channel HSL Measurements & Adjustments',T); y+=LABEL_H;
  result.ranked.forEach((ch,i)=>{
    const col=i%2, row=Math.floor(i/2);
    _channelCard(ctx, PAD+col*(colW+GAP), y+row*(CARD_H+GAP), colW, CARD_H, ch, T);
  });
  y+=ROWS*(CARD_H+GAP);

  // 4. Ranked list
  _sec(ctx,PAD,y,'Channel Ranking by Coverage',T); y+=LABEL_H;
  result.ranked.forEach((ch,i)=>_rankRow(ctx,PAD,y+i*(CONF_H+4),W-PAD*2,CONF_H,ch,i+1,T));
}

// ─── Summary banner ───────────────────────────────────────────────────────────
function _banner(ctx,x,y,w,h,result,T){
  ctx.save();
  const dom=result.channels[result.dominant];
  const ac=CH_COLOR[result.dominant]??'#888';
  ctx.fillStyle=ac+'22'; ctx.strokeStyle=ac; ctx.lineWidth=1.5;
  _rr(ctx,x,y,w,h,8); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.text; ctx.font='700 11px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${dom.icon}  Dominant: ${dom.label} (${dom.coveragePct}%) — ${result.category}`,x+12,y+h/2);
  ctx.fillStyle=T.sub; ctx.font=FONT_SM; ctx.textAlign='right';
  let sum=result.summary; while(sum.length>10&&ctx.measureText(sum).width>w-220) sum=sum.slice(0,-1);
  ctx.fillText(sum,x+w-10,y+h/2);
  ctx.restore();
}

// ─── Coverage wheel (donut) + bar chart ───────────────────────────────────────
function _coverageWheel(ctx,x,y,w,h,result,T){
  _card(ctx,x,y,w,h+LABEL_H,T);
  const cx_w=x+h/2+10, cy_w=y+h/2+4;
  const outerR=h/2-6, innerR=outerR*0.52;
  const CHANNELS=['red','orange','yellow','green','aqua','blue','purple','magenta'];

  // Total saturation coverage (skip near-grey)
  const covered=CHANNELS.reduce((s,k)=>s+(result.channels[k].coveragePct??0),0);

  // Draw donut segments
  let angle=-Math.PI/2;
  CHANNELS.forEach(key=>{
    const ch=result.channels[key];
    const pct=ch.coveragePct/Math.max(covered,1);
    const sweep=pct*Math.PI*2;
    if(sweep<0.01) { angle+=sweep; return; }
    ctx.save();
    ctx.fillStyle=CH_COLOR[key]+'cc';
    ctx.strokeStyle=T.panel; ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(cx_w,cy_w);
    ctx.arc(cx_w,cy_w,outerR,angle,angle+sweep);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Outer label for big segments
    if(pct>0.08){
      const mid=angle+sweep/2;
      const lx=cx_w+Math.cos(mid)*(outerR+10), ly=cy_w+Math.sin(mid)*(outerR+10);
      ctx.fillStyle=T.label; ctx.font='500 8px Inter,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(`${ch.coveragePct.toFixed(1)}%`,lx,ly);
    }
    angle+=sweep;
    ctx.restore();
  });
  // Inner circle (donut hole)
  ctx.save(); ctx.fillStyle=T.panel; ctx.beginPath(); ctx.arc(cx_w,cy_w,innerR,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=T.label; ctx.font='700 8.5px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('HSL',cx_w,cy_w-6); ctx.fillText('Coverage',cx_w,cy_w+6);
  ctx.restore();

  // Bar chart right of wheel
  const bx=x+h+20, bw=w-h-28;
  CHANNELS.forEach((key,i)=>{
    const ch=result.channels[key];
    const by2=y+4+i*(h/8);
    const bh=h/8-3;
    const color=CH_COLOR[key];
    // Track
    ctx.fillStyle=T.grid; _rr(ctx,bx,by2,bw,bh,3); ctx.fill();
    // Fill
    const fw=Math.max(2,(ch.coveragePct/Math.max(covered,1))*bw);
    ctx.fillStyle=color+'cc'; _rr(ctx,bx,by2,fw,bh,3); ctx.fill();
    // Label
    ctx.fillStyle=T.text; ctx.font=`700 8px Inter,sans-serif`;
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(`${ch.icon} ${ch.label}`,bx+4,by2+bh/2);
    ctx.fillStyle=color; ctx.textAlign='right'; ctx.font=FONT_MONO;
    ctx.fillText(`${ch.coveragePct.toFixed(1)}%`,bx+bw-3,by2+bh/2);
  });
}

// ─── Channel card ─────────────────────────────────────────────────────────────
const DOM_BADGE={primary:{bg:'#f07320',fg:'#fff'},secondary:{bg:'#8a6a4e',fg:'#fff'},accent:{bg:'#2a7a8a',fg:'#fff'},minimal:{bg:'#c0b090',fg:'#4a3828'}};

function _channelCard(ctx,x,y,w,h,ch,T){
  _card(ctx,x,y,w,h,T);
  const ac=CH_COLOR[ch.channel]??'#888';
  ctx.save();
  // Top accent stripe + icon
  ctx.fillStyle=ac; _rr(ctx,x,y,w,3,[8,8,0,0]); ctx.fill();
  ctx.font='13px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(ch.icon,x+10,y+7);
  ctx.fillStyle=T.text; ctx.font='700 10px Inter,sans-serif'; ctx.fillText(ch.label.toUpperCase(),x+28,y+9);

  // Coverage + dominance badge
  const bd=DOM_BADGE[ch.dominance]??DOM_BADGE.minimal;
  const bw=66,bh=14;
  ctx.fillStyle=bd.bg; _rr(ctx,x+w-bw-8,y+8,bw,bh,5); ctx.fill();
  ctx.fillStyle=bd.fg; ctx.font='600 7.5px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(ch.dominance.toUpperCase(),x+w-bw/2-8,y+8+bh/2);

  // Coverage %
  ctx.fillStyle=ac; ctx.font='700 16px "JetBrains Mono",monospace'; ctx.textAlign='right';
  ctx.textBaseline='top'; ctx.fillText(`${ch.coveragePct.toFixed(1)}%`,x+w-8,y+8);

  // 3 HSL measurement rows + adjustment arrows
  const rows=[
    {label:'Hue',    val:ch.avgHue,  max:360, sfx:'°', adj:ch.hueAdj,  reason:ch.hueReason},
    {label:'Sat',    val:ch.avgSat,  max:100, sfx:'%', adj:ch.satAdj,  reason:ch.satReason},
    {label:'Lum',    val:ch.avgLum,  max:100, sfx:'%', adj:ch.lumAdj,  reason:ch.lumReason},
  ];
  rows.forEach((row,i)=>{
    const ry=y+30+i*26, tx=x+10, tw=w-20, th=9;
    // Label
    ctx.fillStyle=T.label; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(row.label,tx,ry+th/2);
    const lw=28, bx2=tx+lw, bw2=tw-lw-52;
    // Gradient track
    let g;
    if(row.label==='Hue'){g=ctx.createLinearGradient(bx2,0,bx2+bw2,0);[0,30,60,90,120,150,180,210,240,270,300,330,360].forEach(d=>g.addColorStop(d/360,`hsl(${d},80%,55%)`));}
    else if(row.label==='Sat'){g=ctx.createLinearGradient(bx2,0,bx2+bw2,0);g.addColorStop(0,'#ccc');g.addColorStop(1,ac);}
    else{g=ctx.createLinearGradient(bx2,0,bx2+bw2,0);g.addColorStop(0,'#111');g.addColorStop(.5,'#888');g.addColorStop(1,'#eee');}
    ctx.fillStyle=g; ctx.strokeStyle=T.border; ctx.lineWidth=.5;
    _rr(ctx,bx2,ry,bw2,th,3); ctx.fill(); ctx.stroke();
    // Needle
    const nx=bx2+(row.val/row.max)*bw2;
    ctx.strokeStyle=T.text; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(nx,ry-1); ctx.lineTo(nx,ry+th+1); ctx.stroke();
    // Measured value
    ctx.fillStyle=T.text; ctx.font=FONT_MONO; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(`${row.val}${row.sfx}`,bx2+bw2+4,ry+th/2);
    // Adjustment pill
    const adjStr=(row.adj>=0?'+':'')+row.adj;
    const adjC=row.adj>0?T.ok:row.adj<0?T.err:T.sub;
    ctx.fillStyle=adjC+'33'; ctx.strokeStyle=adjC; ctx.lineWidth=.5;
    const aw=32, ax=tx+tw-aw;
    _rr(ctx,ax,ry,aw,th,4); ctx.fill(); ctx.stroke();
    ctx.fillStyle=adjC; ctx.font='700 8px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(adjStr,ax+aw/2,ry+th/2);
  });

  // Reason text (most important — saturation)
  ctx.fillStyle=T.sub; ctx.font='500 7px Inter,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  let r=rows[1].reason; const maxW=w-20;
  while(r.length>10&&ctx.measureText(r+'…').width>maxW) r=r.slice(0,-1);
  ctx.fillText(rows[1].reason.length>r.length?r+'…':r, x+10, y+h-13);
  ctx.restore();
}

// ─── Ranked list row ──────────────────────────────────────────────────────────
const DIR_A={'>0':'↑','<0':'↓','=0':'→'};

function _rankRow(ctx,x,y,w,h,ch,rank,T){
  ctx.save();
  const ac=CH_COLOR[ch.channel]??'#888';
  const lw=24, bx=x+lw, bw=w-lw-200;
  ctx.fillStyle=T.sub; ctx.font='700 9px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(`#${rank}`,x+10,y+h/2);
  // Bar
  ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,bx,y,bw,h,4); ctx.fill(); ctx.stroke();
  const covered=60;
  const fw=Math.max(3,(ch.coveragePct/100)*bw);
  ctx.fillStyle=ac+'bb'; _rr(ctx,bx,y,fw,h,4); ctx.fill();
  // Labels
  ctx.fillStyle=T.text; ctx.font=FONT_SM; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(`${ch.icon} ${ch.label}`,bx+4,y+h/2);
  ctx.fillStyle=ac; ctx.font=FONT_MONO; ctx.textAlign='right';
  ctx.fillText(`${ch.coveragePct.toFixed(1)}%`,x+w-140,y+h/2);
  // H/S/L values
  ctx.fillStyle=T.sub; ctx.font='500 8px "JetBrains Mono",monospace'; ctx.textAlign='right';
  ctx.fillText(`H${ch.avgHue}° S${ch.avgSat}% L${ch.avgLum}%`,x+w-50,y+h/2);
  // Adjustments
  const adjs=[ch.hueAdj,ch.satAdj,ch.lumAdj];
  const clrs=[T.ok,T.ok,T.ok];
  ctx.font='600 8px "JetBrains Mono",monospace'; ctx.textAlign='right';
  let ax=x+w;
  ['L','S','H'].forEach((lbl,i)=>{
    const adj=adjs[2-i];
    const c=adj>0?'#27714a':adj<0?'#c0392b':T.sub;
    ctx.fillStyle=c; ctx.fillText(`${lbl}:${adj>=0?'+':''}${adj}`,ax,y+h/2);
    ax-=38;
  });
  ctx.restore();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _sec(ctx,x,y,text,T){ctx.save();ctx.fillStyle=T.label;ctx.font=FONT;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),x,y+LABEL_H/2);const tw=ctx.measureText(text.toUpperCase()).width;ctx.strokeStyle=T.border;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+tw+8,y+LABEL_H/2);ctx.lineTo(x+9999,y+LABEL_H/2);ctx.stroke();ctx.restore();}
function _card(ctx,x,y,w,h,T){ctx.save();ctx.fillStyle=T.panel;ctx.strokeStyle=T.border;ctx.lineWidth=1;_rr(ctx,x,y,w,h,10);ctx.fill();ctx.stroke();ctx.restore();}
function _rr(ctx,x,y,w,h,r){const rd=Array.isArray(r)?r:[r,r,r,r];ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}}
