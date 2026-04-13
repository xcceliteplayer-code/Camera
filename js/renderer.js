/* ══════════════════════════════════════
   WCAM PRO V2 — renderer.js
   Canvas drawing: face, body, skeleton, zones, heatmap, histogram
══════════════════════════════════════ */
'use strict';

const Renderer = (() => {

  /* ── FACE BOX ── */
  const drawFace = (ctx, face, idx=0) => {
    const colors = ['#00e5b0','#4b9fff','#ffb84b'];
    const c = colors[idx] || '#888';
    const {x,y,w,h} = face;
    ctx.save();

    // Main box
    ctx.strokeStyle = c; ctx.lineWidth = 1.5;
    ctx.strokeRect(x,y,w,h);
    ctx.fillStyle = c+'18'; ctx.fillRect(x,y,w,h);

    // Corner accents
    const cs = 10; ctx.lineWidth = 3;
    [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([cx,cy])=>{
      const dx=cx===x?cs:-cs, dy=cy===y?cs:-cs;
      ctx.beginPath(); ctx.moveTo(cx+dx,cy); ctx.lineTo(cx,cy); ctx.lineTo(cx,cy+dy); ctx.stroke();
    });

    // Label
    ctx.font = 'bold 10px "Space Mono",monospace'; ctx.fillStyle = c;
    ctx.fillText(`WAJAH ${idx+1}`, x+4, y>14?y-4:y+14);

    // Landmark dots
    const lm = [
      [x+w*0.26,y+h*0.30,4], // left eye
      [x+w*0.63,y+h*0.30,4], // right eye
      [x+w*0.50,y+h*0.52,3], // nose
      [x+w*0.38,y+h*0.72,2], // mouth L
      [x+w*0.62,y+h*0.72,2], // mouth R
    ];
    lm.forEach(([lx,ly,r])=>{
      ctx.beginPath(); ctx.arc(lx,ly,r,0,Math.PI*2);
      ctx.fillStyle = 'rgba(75,159,255,0.8)'; ctx.fill();
    });

    // Smile arc
    ctx.strokeStyle='rgba(75,159,255,0.5)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(x+w*0.5,y+h*0.68,w*0.17,0,Math.PI); ctx.stroke();

    ctx.restore();
  };

  /* ── BODY BOX ── */
  const drawBody = (ctx, body) => {
    if (!body) return;
    const {x,y,w,h} = body;
    ctx.save();
    ctx.strokeStyle = '#ffb84b'; ctx.lineWidth = 1;
    ctx.setLineDash([5,4]);
    ctx.strokeRect(x,y,w,h);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,184,75,0.04)'; ctx.fillRect(x,y,w,h);

    ctx.font = 'bold 9px "Space Mono",monospace';
    ctx.fillStyle = '#ffb84b';
    ctx.fillText('UPPER BODY', x+4, y+12);
    ctx.restore();
  };

  /* ── SKELETON ── */
  const drawSkeleton = (ctx, body, face) => {
    if (!body || !face) return;
    const J = body.joints;
    if (!J) return;

    const bones = [
      ['neck','lShoulder'],['neck','rShoulder'],
      ['lShoulder','lElbow'],['rShoulder','rElbow'],
      ['lElbow','lWrist'],['rElbow','rWrist'],
      ['neck','sternum'],
      ['sternum','lHip'],['sternum','rHip'],
      ['lShoulder','lHip'],['rShoulder','rHip'],
    ];

    ctx.save();
    ctx.strokeStyle = 'rgba(180,75,255,0.65)'; ctx.lineWidth = 1.5;
    bones.forEach(([a,b])=>{
      if(!J[a]||!J[b]) return;
      const [ax,ay]=J[a],[bx,by]=J[b];
      // Clamp to visible area
      if(ax<0||ay<0||bx<0||by<0) return;
      ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    });

    // Joints
    ctx.fillStyle='rgba(180,75,255,0.9)';
    Object.values(J).forEach(([jx,jy])=>{
      if(jx<0||jy<0) return;
      ctx.beginPath(); ctx.arc(jx,jy,3,0,Math.PI*2); ctx.fill();
    });

    ctx.restore();
  };

  /* ── ZONE GRID ── */
  const drawZones = (ctx, W, H, heatmap) => {
    const COLS=3,ROWS=3;
    const zW=W/COLS, zH=H/ROWS;
    const labels=['Kiri-Atas','Tengah-Atas','Kanan-Atas','Kiri-Mid','Tengah','Kanan-Mid','Kiri-Bawah','Tengah-Bawah','Kanan-Bawah'];
    ctx.save();
    for(let zy=0;zy<ROWS;zy++) for(let zx=0;zx<COLS;zx++) {
      const hCol=Math.floor(zx*5.3), hRow=Math.floor(zy*4);
      const heat=heatmap[hRow*16+hCol]||0;
      if(heat<16) continue;
      const alpha=Math.min(0.85,heat/100), fillA=Math.min(0.18,heat/220);
      const lx=zx*zW, ly=zy*zH;
      ctx.strokeStyle=`rgba(255,75,110,${alpha})`; ctx.lineWidth=1;
      ctx.setLineDash([4,4]); ctx.strokeRect(lx+2,ly+2,zW-4,zH-4); ctx.setLineDash([]);
      ctx.fillStyle=`rgba(255,75,110,${fillA})`; ctx.fillRect(lx+2,ly+2,zW-4,zH-4);
      ctx.fillStyle=`rgba(255,75,110,${alpha})`; ctx.font='bold 9px "Space Mono",monospace';
      ctx.fillText(labels[zy*COLS+zx],lx+5,ly+14);
    }
    ctx.restore();
  };

  /* ── HEATMAP ── */
  const drawHeatmap = (canvas, ctx2d, heatmap, cols=16, rows=12) => {
    const W=canvas.width||300, H=canvas.height||70;
    const cw=W/cols, ch=H/rows;
    ctx2d.clearRect(0,0,W,H);
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
      const v=heatmap[r*cols+c];
      if(v<5) continue;
      const heat=Math.min(1,v/100);
      const red=Math.min(255,heat*510), green=Math.max(0,255-heat*510);
      ctx2d.fillStyle=`rgba(${Math.round(red)},${Math.round(green)},0,${Math.min(0.9,heat*1.2)})`;
      ctx2d.fillRect(c*cw,r*ch,cw-1,ch-1);
    }
  };

  /* ── HISTOGRAM ── */
  const drawHistogram = (canvas, ctx2d, hist) => {
    const W=canvas.width||300, H=canvas.height||60;
    ctx2d.clearRect(0,0,W,H);
    // Dark bg
    ctx2d.fillStyle='rgba(0,0,0,0.3)'; ctx2d.fillRect(0,0,W,H);
    const channels=[
      {data:hist.r,color:'rgba(255,75,110,0.6)'},
      {data:hist.g,color:'rgba(75,255,143,0.6)'},
      {data:hist.b,color:'rgba(75,159,255,0.6)'}
    ];
    channels.forEach(({data,color})=>{
      const max=Math.max(...data)||1;
      ctx2d.fillStyle=color;
      for(let i=0;i<256;i++) {
        const bh=(data[i]/max)*H;
        ctx2d.fillRect((i/256)*W,H-bh,W/256+0.5,bh);
      }
    });
    // Grid lines
    ctx2d.strokeStyle='rgba(255,255,255,0.06)'; ctx2d.lineWidth=0.5;
    [0.25,0.5,0.75].forEach(p=>{
      ctx2d.beginPath(); ctx2d.moveTo(W*p,0); ctx2d.lineTo(W*p,H); ctx2d.stroke();
    });
  };

  /* ── PIXEL FILTERS ── */
  const applyPixelFilter = (imgData, filter) => {
    const d=imgData.data, len=d.length;
    if(filter==='thermo') {
      for(let i=0;i<len;i+=4) {
        const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2], t=l/255;
        d[i]=Math.min(255,t*2*255);
        d[i+1]=Math.max(0,Math.min(255,(t-0.5)*2*255));
        d[i+2]=Math.max(0,(1-t*2)*255);
      }
      return true;
    }
    if(filter==='edge') {
      // Simple Sobel approximation (modifies copy)
      const copy=new Uint8ClampedArray(d);
      const W=imgData.width, H=imgData.height;
      for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++) {
        const i=(y*W+x)*4;
        for(let c=0;c<3;c++) {
          const gx=-copy[(y*W+(x-1))*4+c]+copy[(y*W+(x+1))*4+c];
          const gy=-copy[((y-1)*W+x)*4+c]+copy[((y+1)*W+x)*4+c];
          d[i+c]=Math.min(255,Math.sqrt(gx*gx+gy*gy));
        }
        d[i+3]=255;
      }
      return true;
    }
    if(filter==='night') {
      // Green-tinted night vision
      for(let i=0;i<len;i+=4) {
        const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
        const nl=Math.min(255,l*1.4);
        d[i]=0; d[i+1]=Math.min(255,nl*1.2); d[i+2]=0;
      }
      return true;
    }
    return false;
  };

  /* ── CROSSHAIR ON FACE CENTER ── */
  const drawCrosshair = (ctx, face) => {
    if (!face) return;
    const cx = face.x + face.w/2, cy = face.y + face.h/2;
    ctx.save();
    ctx.strokeStyle='rgba(0,229,176,0.5)'; ctx.lineWidth=0.5;
    ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,ctx.canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(ctx.canvas.width,cy); ctx.stroke();
    ctx.setLineDash([]);
    // center dot
    ctx.fillStyle='rgba(0,229,176,0.6)';
    ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2); ctx.fill();
    ctx.restore();
  };

  return { drawFace, drawBody, drawSkeleton, drawZones, drawHeatmap, drawHistogram, applyPixelFilter, drawCrosshair };
})();
