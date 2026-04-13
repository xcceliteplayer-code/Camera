/* ══════════════════════════════════════
   WCAM PRO V2 — analyzer.js
   Core pixel analysis engine
══════════════════════════════════════ */
'use strict';

const Analyzer = (() => {
  let prevData      = null;
  let motionHistory = [];
  let heatmap       = new Float32Array(16*12);

  const reset = () => { prevData=null; motionHistory=[]; heatmap.fill(0); };

  /* ── LIGHT / COLOR / NOISE ── */
  const analyzeLight = (d, W, H) => {
    let rS=0,gS=0,bS=0,n=0,minL=255,maxL=0;
    for(let i=0;i<d.length;i+=20) {
      const r=d[i],g=d[i+1],b=d[i+2];
      const l=0.299*r+0.587*g+0.114*b;
      rS+=r; gS+=g; bS+=b; n++;
      if(l<minL) minL=l; if(l>maxL) maxL=l;
    }
    const aR=rS/n, aG=gS/n, aB=bS/n;
    const brightness = Math.round((0.299*aR+0.587*aG+0.114*aB)/255*100);
    const contrast   = Math.round((maxL-minL)/255*100);
    const cMax=Math.max(aR,aG,aB), cMin=Math.min(aR,aG,aB);
    const sat = cMax>0 ? Math.round((cMax-cMin)/cMax*100) : 0;
    let noiseAcc=0,ns=0;
    for(let i=0;i<d.length-4;i+=80) {
      noiseAcc+=Math.abs(d[i]-d[i+4])+Math.abs(d[i+1]-d[i+5])+Math.abs(d[i+2]-d[i+6]);
      ns++;
    }
    const noise=Math.round(noiseAcc/ns/3);
    const lightStatus = brightness<25?'🌑 Gelap':brightness<50?'🌤 Redup':brightness<80?'☀ Normal':'💡 Terang';
    return {
      brightness, contrast, sat, noise, lightStatus,
      avgR:Math.round(aR), avgG:Math.round(aG), avgB:Math.round(aB)
    };
  };

  /* ── MOTION ── */
  const analyzeMotion = (d, W, H) => {
    if(!prevData) { prevData=new Uint8Array(d); return {motionPct:0,speedLabel:'—',speedPct:0,heatmap}; }
    const COLS=16, ROWS=12;
    const cW=Math.floor(W/COLS), cH=Math.floor(H/ROWS);
    let total=0;
    const newHeat=new Float32Array(COLS*ROWS);
    for(let row=0;row<ROWS;row++) for(let col=0;col<COLS;col++) {
      let diff=0,cnt=0;
      for(let py=0;py<cH;py+=4) for(let px=0;px<cW;px+=4) {
        const x=col*cW+px, y=row*cH+py;
        if(x>=W||y>=H) continue;
        const idx=(y*W+x)*4;
        diff+=Math.abs(d[idx]-prevData[idx])+Math.abs(d[idx+1]-prevData[idx+1])+Math.abs(d[idx+2]-prevData[idx+2]);
        cnt++;
      }
      newHeat[row*COLS+col]=cnt>0?diff/cnt:0;
      total+=newHeat[row*COLS+col];
    }
    for(let i=0;i<heatmap.length;i++) heatmap[i]=heatmap[i]*0.87+newHeat[i]*0.38;
    const motionPct=Math.min(100,Math.round(total/(COLS*ROWS)/2.5));
    const prev=motionHistory.length>0?motionHistory[motionHistory.length-1]:0;
    const delta=Math.abs(motionPct-prev);
    const speedLabel=delta<2?'Statis':delta<8?'Lambat':delta<20?'Sedang':'Cepat';
    const speedPct=U.clamp(delta*5,0,100);
    motionHistory.push(motionPct);
    if(motionHistory.length>90) motionHistory.shift();
    prevData=new Uint8Array(d);
    return {motionPct,speedLabel,speedPct,heatmap};
  };

  /* ── FACE DETECTION ── */
  const detectFaces = (d, W, H) => {
    const SCALE=8;
    const sw=Math.floor(W/SCALE), sh=Math.floor(H/SCALE);
    const skinMap=new Uint8Array(sw*sh);
    const visited=new Uint8Array(sw*sh);

    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++) {
      const ox=x*SCALE, oy=y*SCALE;
      const idx=(oy*W+ox)*4;
      const r=d[idx],g=d[idx+1],b=d[idx+2];
      skinMap[y*sw+x]=(
        r>95&&g>40&&b>20&&
        (Math.max(r,g,b)-Math.min(r,g,b))>15&&
        Math.abs(r-g)>15&&r>g&&r>b
      )?1:0;
    }

    const regions=[];
    for(let y=1;y<sh-1;y++) for(let x=1;x<sw-1;x++) {
      if(!skinMap[y*sw+x]||visited[y*sw+x]) continue;
      const queue=[[x,y]], cells=[];
      while(queue.length) {
        const [cx,cy]=queue.pop();
        if(cx<0||cy<0||cx>=sw||cy>=sh||visited[cy*sw+cx]||!skinMap[cy*sw+cx]) continue;
        visited[cy*sw+cx]=1; cells.push([cx,cy]);
        queue.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      }
      if(cells.length<40) continue;
      const xs=cells.map(c=>c[0]), ys=cells.map(c=>c[1]);
      const minX=Math.min(...xs),maxX=Math.max(...xs);
      const minY=Math.min(...ys),maxY=Math.max(...ys);
      const bw=maxX-minX, bh=maxY-minY;
      if(bw<sw*0.08||bh<sh*0.08) continue;
      const ar=bh/bw;
      if(ar<0.65||ar>1.6) continue;
      const density=cells.length/(bw*bh);
      if(density<0.35) continue;
      // finger column test
      let thinCols=0;
      for(let cx2=minX;cx2<=maxX;cx2++) {
        let cs=0;
        for(let cy2=minY;cy2<=maxY;cy2++) if(skinMap[cy2*sw+cx2]) cs++;
        const fill=cs/(maxY-minY+1);
        if(fill>0.05&&fill<0.28) thinCols++;
      }
      if(thinCols/(bw+1)>0.55) continue;
      // symmetry
      const mid=Math.floor((minX+maxX)/2);
      let lc=0,rc=0;
      for(let cx2=minX;cx2<mid;cx2++) { for(let cy2=minY;cy2<=maxY;cy2++) { if(skinMap[cy2*sw+cx2]){lc++;break;} } }
      for(let cx2=mid;cx2<=maxX;cx2++) { for(let cy2=minY;cy2<=maxY;cy2++) { if(skinMap[cy2*sw+cx2]){rc++;break;} } }
      if(Math.min(lc,rc)/(Math.max(lc,rc)+1)<0.4) continue;
      const centerY=(minY+maxY)/2/sh;
      if(centerY>0.72) continue;
      if(Math.max(bw,bh)/(Math.min(bw,bh)+1)>1.8) continue;
      regions.push({x:minX*SCALE,y:minY*SCALE,w:bw*SCALE,h:bh*SCALE,area:cells.length,density,centerY});
    }

    regions.sort((a,b)=>(b.area*(1-b.centerY*0.5))-(a.area*(1-a.centerY*0.5)));

    const iou=(a,b)=>{
      const ix1=Math.max(a.x,b.x),iy1=Math.max(a.y,b.y);
      const ix2=Math.min(a.x+a.w,b.x+b.w),iy2=Math.min(a.y+a.h,b.y+b.h);
      if(ix2<=ix1||iy2<=iy1) return 0;
      const inter=(ix2-ix1)*(iy2-iy1);
      return inter/(a.w*a.h+b.w*b.h-inter);
    };

    const kept=[];
    for(const r of regions) {
      if(kept.every(k=>iou(k,r)<0.35)) kept.push(r);
      if(kept.length>=1) break;
    }
    for(const r of regions) {
      if(kept.includes(r)) continue;
      if(kept.length>=2) break;
      const m=kept[0]; if(!m) break;
      if(r.area/m.area>0.45&&r.centerY<0.55&&iou(m,r)<0.35) kept.push(r);
    }
    return kept;
  };

  /* ── HISTOGRAM ── */
  const computeHistogram = (d) => {
    const r=new Uint32Array(256), g=new Uint32Array(256), b=new Uint32Array(256);
    for(let i=0;i<d.length;i+=8) { r[d[i]]++; g[d[i+1]]++; b[d[i+2]]++; }
    return {r,g,b};
  };

  const getStability = () => {
    if(motionHistory.length<5) return 100;
    const s=motionHistory.slice(-5);
    return Math.max(0,Math.round(100-s.reduce((a,b)=>a+b,0)/s.length*0.8));
  };

  const estimateDist = (faceH,H) => {
    if(!faceH||!H) return null;
    const r=faceH/H, d=Math.round(0.22/r*10)/10;
    return (d>0&&d<12)?d:null;
  };

  return {reset,analyzeLight,analyzeMotion,detectFaces,computeHistogram,getStability,estimateDist,
    getHeatmap:()=>heatmap, getMotionHistory:()=>motionHistory};
})();
