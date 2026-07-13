/**
 * ui/palette-renderer.js
 * Canvas: Named role strip · Top-8 swatches · Population bars
 */

const PAD=12, GAP=8, LABEL_H=18, ROLE_H=58, SWATCH_H=76, BAR_H=13;

function th(dark){return{panel:dark?'rgba(30,20,10,.55)':'rgba(255,255,255,.6)',border:dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)',label:dark?'#b89e84':'#6b5843',sub:dark?'#7a6248':'#9e8468',text:dark?'#f0e6d8':'#1c160e',grid:dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)'};}

const BADGE={Dominant:{bg:'#f07320',fg:'#fff'},Secondary:{bg:'#8a6a4e',fg:'#fff'},Accent:{bg:'#2a7a8a',fg:'#fff'},Shadow:{bg:'#1a1610',fg:'#e0d0c0'},Highlight:{bg:'#f5ede0',fg:'#4a3828'},Supporting:{bg:'#d0c0b0',fg:'#4a3828'}};

// ─── UI FIX-F: canvas content-width resolution ─────────────────────────────
// Same rationale as image-analysis-renderer.js's resolver — a section's
// getBoundingClientRect().width includes its padding/border, but this
// canvas (width:100%) only occupies the section's content box. Never
// trusts a parent/section rect, never falls back to a hardcoded value,
// and avoids canvas.offsetWidth (which could reflect a stale inline
// pixel width from a previous render).
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

export function renderPalette(canvas, palette, opts={}) {
  const dark=opts.dark??document.documentElement.classList.contains('dark');
  const T=th(dark);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  // Resolve the canvas's own CONTENT width — never the parent section's
  // border-box width.
  const W = resolveCanvasCssWidth(canvas, opts.cssWidth);
  if (W <= 0) return false; // never commit a distorted render from a zero/invalid width
  const roles=['Dominant','Secondary','Accent','Shadow','Highlight'];
  const roleW=Math.floor((W-PAD*2-GAP*(roles.length-1))/roles.length);
  const swatchW=Math.floor((W-PAD*2-GAP*3)/4);
  const rows=Math.ceil(palette.colors.length/4);
  const totalH=PAD+LABEL_H+ROLE_H+GAP+LABEL_H+SWATCH_H*rows+GAP*(rows-1)+GAP+LABEL_H+BAR_H*palette.colors.length+(palette.colors.length-1)*3+PAD;
  canvas.style.width='100%'; canvas.style.height=totalH+'px';
  canvas.width=Math.round(W*dpr); canvas.height=Math.round(totalH*dpr);
  const ctx=canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  let y=PAD;

  // Role strip
  _secLbl(ctx,PAD,y,'Named Colour Roles',T); y+=LABEL_H;
  roles.forEach((role,i)=>_roleSwatch(ctx,PAD+i*(roleW+GAP),y,roleW,ROLE_H,palette[role.toLowerCase()],role,T,BADGE));
  y+=ROLE_H+GAP;

  // Swatch grid
  _secLbl(ctx,PAD,y,`Top ${palette.colors.length} Colours — K-Means`,T); y+=LABEL_H;
  palette.colors.forEach((c,i)=>{
    const col=i%4,row=Math.floor(i/4);
    _swatch(ctx,PAD+col*(swatchW+GAP),y+row*(SWATCH_H+GAP),swatchW,SWATCH_H,c,T,BADGE);
  });
  y+=rows*SWATCH_H+(rows-1)*GAP+GAP;

  // Pop bars
  _secLbl(ctx,PAD,y,'Population Distribution',T); y+=LABEL_H;
  palette.colors.forEach((c,i)=>_popBar(ctx,PAD,y+i*(BAR_H+3),W-PAD*2,BAR_H,c,T));
  return true;
}

function _roleSwatch(ctx,x,y,w,h,color,role,T,BD) {
  const b=BD[role]??BD.Supporting;
  ctx.save();
  ctx.fillStyle=T.panel; ctx.strokeStyle=T.border; ctx.lineWidth=1; _rr(ctx,x,y,w,h,10); ctx.fill(); ctx.stroke();
  const fh=Math.floor(h*.58); ctx.fillStyle=color.hex; _rr(ctx,x,y,w,fh,[10,10,0,0]); ctx.fill();
  ctx.fillStyle=b.bg; ctx.strokeStyle='rgba(255,255,255,.15)'; ctx.lineWidth=.5; _rr(ctx,x+5,y+5,w-10,13,4); ctx.fill(); ctx.stroke();
  ctx.fillStyle=b.fg; ctx.font='700 7.5px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(role.toUpperCase(),x+w/2,y+11.5);
  const ty=y+fh+6;
  ctx.fillStyle=T.text; ctx.font='700 10px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(color.hex.toUpperCase(),x+w/2,ty);
  ctx.fillStyle=T.sub; ctx.font='500 8px Inter,sans-serif'; ctx.fillText(`${(color.population*100).toFixed(1)}%`,x+w/2,ty+13);
  ctx.restore();
}

function _swatch(ctx,x,y,w,h,color,T,BD) {
  const b=BD[color.role]??BD.Supporting;
  ctx.save();
  ctx.fillStyle=T.panel; ctx.strokeStyle=T.border; ctx.lineWidth=1; _rr(ctx,x,y,w,h,10); ctx.fill(); ctx.stroke();
  const bh=Math.floor(h*.42); ctx.fillStyle=color.hex; _rr(ctx,x,y,w,bh,[10,10,0,0]); ctx.fill();
  const pw=56,ph=12;
  ctx.fillStyle=b.bg; _rr(ctx,x+(w-pw)/2,y+bh-ph/2-1,pw,ph,5); ctx.fill();
  ctx.fillStyle=b.fg; ctx.font='700 7px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(color.role.toUpperCase(),x+w/2,y+bh);
  const tx=x+w/2; let ty=y+bh+9; const lh=11;
  ctx.fillStyle=T.label; ctx.font='700 9px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.fillText(`#${color.rank}  ·  ${(color.population*100).toFixed(1)}%`,tx,ty); ty+=lh;
  ctx.fillStyle=T.text; ctx.font='700 9px "JetBrains Mono",monospace'; ctx.fillText(color.hex.toUpperCase(),tx,ty); ty+=lh;
  ctx.fillStyle=T.sub; ctx.font='500 8.5px "JetBrains Mono",monospace';
  ctx.fillText(`rgb(${color.r},${color.g},${color.b})`,tx,ty); ty+=lh;
  ctx.fillText(`hsl(${color.hsl.h}°,${color.hsl.s}%,${color.hsl.l}%)`,tx,ty);
  ctx.restore();
}

function _popBar(ctx,x,y,w,h,color,T) {
  ctx.save();
  ctx.fillStyle=T.grid; ctx.strokeStyle=T.border; ctx.lineWidth=.5; _rr(ctx,x,y,w,h,4); ctx.fill(); ctx.stroke();
  const fw=Math.max(4,color.population*w); ctx.fillStyle=color.hex; _rr(ctx,x,y,fw,h,4); ctx.fill();
  const txtC=color.luminance>140?'rgba(0,0,0,.75)':'rgba(255,255,255,.9)';
  ctx.fillStyle=txtC; ctx.font='600 8px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.textBaseline='middle';
  if(fw>130)ctx.fillText(`  ${color.hex.toUpperCase()}  rgb(${color.r},${color.g},${color.b})  hsl(${color.hsl.h}°,${color.hsl.s}%,${color.hsl.l}%)`,x+4,y+h/2);
  ctx.fillStyle=T.sub; ctx.font='500 7.5px Inter,sans-serif'; ctx.textAlign='right';
  ctx.fillText(color.role,x+w-38,y+h/2);
  ctx.fillStyle=T.label; ctx.font='600 8px Inter,sans-serif';
  ctx.fillText(`${(color.population*100).toFixed(1)}%`,x+w-4,y+h/2);
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
  const rd=Array.isArray(r)?r:[r,r,r,r];
  ctx.beginPath();
  if(ctx.roundRect){ctx.roundRect(x,y,w,h,rd);}
  else{const[tl,tr,br,bl]=rd;ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();}
}
