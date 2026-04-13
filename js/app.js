/* ══════════════════════════════════════
   WCAM PRO V2 — app.js
   Main controller: camera, render loop, UI
══════════════════════════════════════ */
'use strict';

/* ── Global state ── */
const State = {
  stream:    null,
  animId:    null,
  isRec:     false,
  mediaRec:  null,
  recChunks: [],
  fps:       0, fpsLast: Date.now(), fpsCount: 0,
  frameN:    0,
  zoom:      1, panX:0, panY:0,
  isFlipped: false,
  lastAlert: 0,
  faces:     [],
  bodyData:  null,
  modes: { motion:true, face:true, body:true, pose:true, light:true, zone:true, hist:true, skeleton:true },
};

/* ── DOM ── */
const video     = document.getElementById('video');
const overlay   = document.getElementById('overlay');
const ctx       = overlay.getContext('2d');
const hmC       = document.getElementById('heatmap-c');
const hmX       = hmC.getContext('2d');
const histC     = document.getElementById('hist-c');
const histX     = histC.getContext('2d');
const snapC     = document.getElementById('snap-canvas');
const snapX     = snapC.getContext('2d');
snapC.width=320; snapC.height=180;

/* ── Clock ── */
setInterval(()=> U.set('clock-val', U.ts()), 1000); U.set('clock-val', U.ts());

/* ── Modes ── */
const Modes = {
  toggle(cb) {
    State.modes[cb.dataset.mode] = cb.checked;
    U.log(`Mode ${cb.dataset.mode}: ${cb.checked?'ON':'OFF'}`, 'gray');
  }
};

/* ── PTZ ── */
const PTZ = {
  move(dir) {
    const s=30;
    if(dir==='up')    State.panY=U.clamp(State.panY-s,-200,200);
    if(dir==='down')  State.panY=U.clamp(State.panY+s,-200,200);
    if(dir==='left')  State.panX=U.clamp(State.panX-s,-200,200);
    if(dir==='right') State.panX=U.clamp(State.panX+s,-200,200);
  },
  reset() {
    State.panX=0; State.panY=0; State.zoom=1;
    U.el('zoom-sl').value=1; U.set('zoom-lbl','1.0×');
  },
  zoom(v) {
    State.zoom=parseFloat(v);
    U.set('zoom-lbl',State.zoom.toFixed(1)+'×');
  }
};

/* ── Camera Control ── */
const CamCtrl = {
  async start() {
    try {
      const devId = U.el('cam-select').value;
      State.stream = await navigator.mediaDevices.getUserMedia({
        video:{ deviceId:devId?{exact:devId}:undefined, width:{ideal:1280}, height:{ideal:720} },
        audio:false
      });
      video.srcObject = State.stream;
      U.el('no-cam').classList.add('hidden');
      U.el('btn-start').disabled=true;
      U.el('btn-stop').style.display='flex';
      U.el('btn-snap').disabled=false;
      U.el('btn-rec').disabled=false;
      U.el('btn-ai-snap').disabled=false;
      U.el('status-pill').textContent='LIVE';
      U.el('status-pill').classList.add('live');
      U.el('rec-dot').classList.add('live');
      U.el('scan-bar').classList.add('active');
      U.log('Kamera aktif', 'green');
      await this._enumCams();
      video.addEventListener('loadedmetadata',()=>{
        // Size canvas to match actual video resolution for pixel-accurate analysis
        const vw = video.videoWidth  || 640;
        const vh = video.videoHeight || 480;
        overlay.width  = vw;
        overlay.height = vh;
        // Make canvas fill the container visually via CSS
        overlay.style.width  = '100%';
        overlay.style.height = '100%';
        hmC.width   = hmC.offsetWidth   || 300;
        histC.width = histC.offsetWidth || 300;
        U.set('res-val', `${vw}×${vh}`);
        this._loop();
      },{once:true});
    } catch(e) {
      U.log('Error: '+e.message,'red');
      alert('Tidak dapat membuka kamera:\n'+e.message);
    }
  },
  stop() {
    if(State.stream) State.stream.getTracks().forEach(t=>t.stop());
    State.stream=null;
    if(State.animId) cancelAnimationFrame(State.animId);
    video.srcObject=null; ctx.clearRect(0,0,overlay.width,overlay.height);
    U.el('no-cam').classList.remove('hidden');
    U.el('btn-start').disabled=false;
    U.el('btn-stop').style.display='none';
    ['btn-snap','btn-rec','btn-ai-snap'].forEach(id=>U.el(id).disabled=true);
    U.el('status-pill').textContent='OFFLINE'; U.el('status-pill').classList.remove('live');
    U.el('rec-dot').classList.remove('live');
    U.el('scan-bar').classList.remove('active');
    U.el('alert-val').textContent='OK'; U.el('alert-val').classList.remove('danger');
    Analyzer.reset(); U.log('Kamera stop','gray'); this._resetStats();
  },
  async switchCam() { if(State.stream){this.stop(); await this.start();} },
  toggleFlip() { State.isFlipped=U.el('flip-cb').checked; },
  snapshot() {
    if(!State.stream) return;
    const sc=document.createElement('canvas');
    sc.width=video.videoWidth||640; sc.height=video.videoHeight||480;
    const sctx=sc.getContext('2d');
    if(State.isFlipped){sctx.translate(sc.width,0);sctx.scale(-1,1);}
    sctx.drawImage(video,0,0);
    snapX.drawImage(sc,0,0,snapC.width,snapC.height);
    U.log('Snapshot diambil','blue');
  },
  downloadSnap() { U.downloadCanvas(snapC,'wcam-v2-'+Date.now()+'.png'); U.log('Download foto','blue'); },
  toggleRec() {
    if(!State.stream) return;
    if(!State.isRec) {
      State.recChunks=[];
      State.mediaRec=new MediaRecorder(State.stream,{mimeType:'video/webm;codecs=vp9'});
      State.mediaRec.ondataavailable=e=>State.recChunks.push(e.data);
      State.mediaRec.onstop=()=>{
        const blob=new Blob(State.recChunks,{type:'video/webm'});
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
        a.download='wcam-v2-rec-'+Date.now()+'.webm'; a.click();
        U.log('Rekaman disimpan','green');
      };
      State.mediaRec.start(); State.isRec=true;
      U.el('btn-rec').textContent='⏹ STOP'; U.el('btn-rec').classList.add('active');
      U.log('Rekaman mulai','red');
    } else {
      State.mediaRec.stop(); State.isRec=false;
      U.el('btn-rec').textContent='⏺ REC'; U.el('btn-rec').classList.remove('active');
    }
  },
  async _enumCams() {
    const devs=await navigator.mediaDevices.enumerateDevices();
    const sel=U.el('cam-select'); sel.innerHTML='';
    devs.filter(d=>d.kind==='videoinput').forEach((d,i)=>{
      const op=document.createElement('option');
      op.value=d.deviceId; op.textContent=d.label||`Kamera ${i+1}`; sel.appendChild(op);
    });
  },
  _resetStats() {
    ['v-motion','v-speed','v-face','v-body','v-bright','v-contrast','v-sat','v-stable',
     'bs-face','bs-farea','bs-dist','bs-pose','bs-head','bs-hand','bs-light','bs-color','bs-noise','bs-alert'
    ].forEach(id=>U.set(id,'—'));
    ['b-motion','b-speed','b-face','b-body','b-bright','b-contrast','b-sat','b-stable'
    ].forEach(id=>U.pct(id,0));
    hmX.clearRect(0,0,hmC.width,hmC.height);
    histX.clearRect(0,0,histC.width,histC.height);
  },

  /* ── MAIN LOOP ── */
  _loop() {
    if(!State.stream) return;
    State.animId=requestAnimationFrame(()=>CamCtrl._loop());
    State.frameN++;
    State.fpsCount++;
    const now=Date.now();
    if(now-State.fpsLast>=1000){
      U.set('fps-val',State.fpsCount+''); State.fpsCount=0; State.fpsLast=now;
    }
    if(State.frameN%2!==0) return; // every 2nd frame

    const W=overlay.width, H=overlay.height;
    ctx.clearRect(0,0,W,H);

    // Draw video with optional CSS filter
    ctx.save();
    if(State.isFlipped){ctx.translate(W,0);ctx.scale(-1,1);}
    const f=Filters.getCurrent();
    if(Filters.isCSSFilter()) ctx.filter=f;
    ctx.drawImage(video,0,0,W,H);
    ctx.filter='none';
    ctx.restore();

    // Get pixels
    let imgData=ctx.getImageData(0,0,W,H);
    const pixelFiltered=Renderer.applyPixelFilter(imgData,f);
    if(pixelFiltered) ctx.putImageData(imgData,0,0);
    imgData=ctx.getImageData(0,0,W,H);
    const d=imgData.data;

    // Zoom / pan crop
    if(State.zoom>1) {
      const cw=W/State.zoom,ch=H/State.zoom;
      const cx2=U.clamp(W/2-cw/2+State.panX,0,W-cw);
      const cy2=U.clamp(H/2-ch/2+State.panY,0,H-ch);
      const zoomed=ctx.getImageData(cx2,cy2,cw,ch);
      const tmp=document.createElement('canvas'); tmp.width=cw; tmp.height=ch;
      tmp.getContext('2d').putImageData(zoomed,0,0);
      ctx.clearRect(0,0,W,H); ctx.drawImage(tmp,0,0,W,H);
    }

    // ── LIGHT ANALYSIS ──
    if(State.modes.light) {
      const lt=Analyzer.analyzeLight(d,W,H);
      U.set('v-bright',lt.brightness+'%'); U.pct('b-bright',lt.brightness);
      U.set('v-contrast',lt.contrast+'%'); U.pct('b-contrast',lt.contrast);
      U.set('v-sat',lt.sat+'%'); U.pct('b-sat',lt.sat);
      U.set('bs-light',lt.lightStatus);
      U.set('bs-noise',lt.noise<5?'Rendah':lt.noise<18?'Sedang':'Tinggi');
      const cname=U.colorName(lt.avgR,lt.avgG,lt.avgB);
      const cel=U.el('bs-color'); if(cel){cel.textContent=cname;cel.style.color=`rgb(${lt.avgR},${lt.avgG},${lt.avgB})`;}
    }

    // ── MOTION ──
    if(State.modes.motion) {
      const mo=Analyzer.analyzeMotion(d,W,H);
      U.set('v-motion',mo.motionPct+'%'); U.pct('b-motion',mo.motionPct);
      U.set('v-speed',mo.speedLabel); U.pct('b-speed',mo.speedPct||0);
      Renderer.drawHeatmap(hmC,hmX,Analyzer.getHeatmap());
      const alertEl=U.el('alert-val');
      if(mo.motionPct>20) {
        const t=Date.now();
        if(t-State.lastAlert>1500){U.log(`Gerakan terdeteksi (${mo.motionPct}%)!`,'red');State.lastAlert=t;}
        U.set('bs-alert','AKTIF ⚠'); if(alertEl){alertEl.textContent='ALERT!';alertEl.classList.add('danger');}
        U.el('bs-alert').className='bstat-v danger';
      } else {
        U.set('bs-alert','Aman ✓'); if(alertEl){alertEl.textContent='OK';alertEl.classList.remove('danger');}
        U.el('bs-alert').className='bstat-v ok';
      }
    }

    // ── FACE DETECTION ──
    if(State.modes.face) {
      State.faces=Analyzer.detectFaces(d,W,H);
      const fc=State.faces.length;
      U.set('v-face',fc>0?fc+'':'0'); U.pct('b-face',Math.min(100,fc*50));
      U.set('bs-face',fc>0?fc+' terdeteksi':'Tidak ada');
      if(fc>0){
        U.set('bs-farea',Math.round(State.faces[0].w*State.faces[0].h/1000)+'K px²');
        State.faces.forEach((face,i)=>Renderer.drawFace(ctx,face,i));
        Renderer.drawCrosshair(ctx,State.faces[0]);
      } else {
        U.set('bs-farea','—');
      }
    }

    // ── BODY TRACKING ──
    if(State.modes.body||State.modes.pose||State.modes.skeleton) {
      State.bodyData=BodyTracker.update(d,W,H,State.faces);
      const {body,poseInfo,handInfo}=State.bodyData;

      if(State.modes.body&&body) Renderer.drawBody(ctx,body);
      if(State.modes.skeleton&&body&&State.faces[0]) Renderer.drawSkeleton(ctx,body,State.faces[0]);

      U.set('bs-pose',poseInfo.pose);
      U.set('bs-head',poseInfo.headDir);
      U.set('bs-hand',handInfo);
      U.set('v-body',poseInfo.confidence+'%'); U.pct('b-body',poseInfo.confidence);
      U.set('v-stable',Analyzer.getStability()+'%'); U.pct('b-stable',Analyzer.getStability());

      // Distance estimate
      if(State.faces[0]) {
        const dist=Analyzer.estimateDist(State.faces[0].h,H);
        U.set('bs-dist',dist?'~'+dist+' m':'—');
      }
    }

    // ── ZONE OVERLAY ──
    if(State.modes.zone) Renderer.drawZones(ctx,W,H,Analyzer.getHeatmap());

    // ── HISTOGRAM (every 5 frames) ──
    if(State.modes.hist&&State.frameN%5===0) {
      Renderer.drawHistogram(histC,histX,Analyzer.computeHistogram(d));
    }
  }
};

// Start on load
document.addEventListener('DOMContentLoaded', ()=>{
  CamCtrl._enumCams().catch(()=>{});
});
