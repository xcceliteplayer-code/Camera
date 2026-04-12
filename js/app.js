/* =============================================
   WebCam Scanner Pro — app.js
   Main application controller (ES6+)
   ============================================= */

'use strict';

const App = (() => {

  /* ---- State ---- */
  const state = {
    stream:        null,
    animId:        null,
    isRecording:   false,
    mediaRecorder: null,
    recordChunks:  [],
    fpsCount:      0,
    fpsLast:       Date.now(),
    frameCount:    0,
    zoom:          1,
    panX:          0,
    panY:          0,
    activeFilter:  'none',
    isFlipped:     false,
    modes: { motion: true, face: true, pose: true, light: true, color: true, zone: true },
    lastMotionAlert: 0,
    faceRegions:   [],
  };

  /* ---- DOM refs ---- */
  const video       = document.getElementById('video');
  const overlay     = document.getElementById('overlay');
  const ctx         = overlay.getContext('2d');
  const hmc         = document.getElementById('heatmap-canvas');
  const hmCtx       = hmc.getContext('2d');
  const histCanvas  = document.getElementById('histogram-canvas');
  const histCtx     = histCanvas.getContext('2d');
  const snapCanvas  = document.getElementById('snap-canvas');
  const snapCtx     = snapCanvas.getContext('2d');

  snapCanvas.width  = 320;
  snapCanvas.height = 180;

  /* ---- Clock ---- */
  const tickClock = () => {
    document.getElementById('clock').textContent =
      new Date().toLocaleTimeString('id-ID');
  };
  setInterval(tickClock, 1000);
  tickClock();

  /* ----------------------------------------------------------
     CAMERA CONTROL
  ---------------------------------------------------------- */

  const startCam = async () => {
    try {
      const sel         = document.getElementById('cam-select').value;
      const constraints = {
        video: {
          deviceId: sel ? { exact: sel } : undefined,
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false
      };

      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = state.stream;

      document.getElementById('no-cam-msg').style.display  = 'none';
      document.getElementById('btn-start').disabled        = true;
      document.getElementById('btn-stop').style.display    = 'inline-flex';
      document.getElementById('btn-snap').disabled         = false;
      document.getElementById('btn-rec').disabled          = false;

      const badge   = document.getElementById('status-badge');
      badge.textContent = 'Live';
      badge.classList.add('live');

      const dot = document.getElementById('rec-dot');
      dot.classList.add('live');

      Utils.addEvent('Kamera berhasil diaktifkan', 'green');

      await _enumCams();

      video.addEventListener('loadedmetadata', () => {
        const W = video.videoWidth  || 640;
        const H = video.videoHeight || 480;
        overlay.width  = W;
        overlay.height = H;

        const hw = hmc.offsetWidth || 300;
        hmc.width       = hw;
        histCanvas.width = hw;

        Utils.set('s-res', `${W}×${H}`);
        _loop();
      }, { once: true });

    } catch (err) {
      Utils.addEvent('Error kamera: ' + err.message, 'red');
      alert('Tidak dapat mengakses kamera:\n' + err.message);
    }
  };

  const stopCam = () => {
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;

    if (state.animId) cancelAnimationFrame(state.animId);
    state.animId = null;

    video.srcObject = null;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    document.getElementById('no-cam-msg').style.display  = 'flex';
    document.getElementById('btn-start').disabled        = false;
    document.getElementById('btn-stop').style.display    = 'none';
    document.getElementById('btn-snap').disabled         = true;
    document.getElementById('btn-rec').disabled          = true;

    const badge = document.getElementById('status-badge');
    badge.textContent = 'Offline';
    badge.classList.remove('live');

    document.getElementById('rec-dot').classList.remove('live');

    Analyzer.reset();
    Utils.addEvent('Kamera dimatikan', 'gray');
    _resetStats();
  };

  const switchCam = async () => {
    if (!state.stream) return;
    stopCam();
    await startCam();
  };

  const toggleFlip = () => {
    state.isFlipped = document.getElementById('flip-cb').checked;
    Utils.addEvent('Flip: ' + (state.isFlipped ? 'ON' : 'OFF'), 'amber');
  };

  const _enumCams = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const sel     = document.getElementById('cam-select');
    sel.innerHTML = '';
    devices.filter(d => d.kind === 'videoinput').forEach((d, i) => {
      const op = document.createElement('option');
      op.value       = d.deviceId;
      op.textContent = d.label || `Kamera ${i + 1}`;
      sel.appendChild(op);
    });
  };

  /* ----------------------------------------------------------
     SNAPSHOT & RECORDING
  ---------------------------------------------------------- */

  const takeSnapshot = () => {
    if (!state.stream) return;
    const sc  = document.createElement('canvas');
    sc.width  = video.videoWidth  || 640;
    sc.height = video.videoHeight || 480;
    const sctx = sc.getContext('2d');
    if (state.isFlipped) { sctx.translate(sc.width, 0); sctx.scale(-1, 1); }
    sctx.drawImage(video, 0, 0);
    snapCtx.drawImage(sc, 0, 0, snapCanvas.width, snapCanvas.height);
    Utils.addEvent('Snapshot diambil', 'blue');
  };

  const downloadSnap = () => {
    Utils.downloadCanvas(snapCanvas, `webcam-snap-${Date.now()}.png`);
    Utils.addEvent('Gambar diunduh', 'blue');
  };

  const toggleRecord = () => {
    if (!state.stream) return;

    if (!state.isRecording) {
      state.recordChunks = [];
      state.mediaRecorder = new MediaRecorder(state.stream, { mimeType: 'video/webm;codecs=vp9' });
      state.mediaRecorder.ondataavailable = e => state.recordChunks.push(e.data);
      state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.recordChunks, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `rekaman-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        Utils.addEvent('Rekaman disimpan ke file', 'green');
      };
      state.mediaRecorder.start();
      state.isRecording = true;

      const btn = document.getElementById('btn-rec');
      btn.textContent = '⏹ Stop Rekam';
      btn.classList.add('btn-primary');
      Utils.addEvent('Rekaman dimulai', 'red');

    } else {
      state.mediaRecorder.stop();
      state.isRecording = false;

      const btn = document.getElementById('btn-rec');
      btn.textContent = '⏺ Rekam';
      btn.classList.remove('btn-primary');
    }
  };

  /* ----------------------------------------------------------
     FILTER & MODES
  ---------------------------------------------------------- */

  const setFilter = (el, filter) => {
    document.querySelectorAll('[data-filter]').forEach(e => e.classList.remove('on'));
    el.classList.add('on');
    state.activeFilter = filter;
    // Remove CSS filter from video (we'll apply on canvas)
    video.style.filter = '';
    Utils.addEvent('Filter aktif: ' + el.textContent.trim(), 'amber');
  };

  const toggleMode = (el) => {
    const m = el.dataset.mode;
    state.modes[m] = !state.modes[m];
    el.classList.toggle('on', state.modes[m]);
    Utils.addEvent(`Mode ${m}: ${state.modes[m] ? 'ON' : 'OFF'}`, 'gray');
  };

  /* ----------------------------------------------------------
     PTZ & ZOOM
  ---------------------------------------------------------- */

  const ptz = (dir) => {
    const step = 25;
    if      (dir === 'up')     state.panY = Utils.clamp(state.panY - step, -150, 150);
    else if (dir === 'down')   state.panY = Utils.clamp(state.panY + step, -150, 150);
    else if (dir === 'left')   state.panX = Utils.clamp(state.panX - step, -150, 150);
    else if (dir === 'right')  state.panX = Utils.clamp(state.panX + step, -150, 150);
    else {
      state.panX = 0; state.panY = 0; state.zoom = 1;
      document.getElementById('zoom-slider').value = 1;
      document.getElementById('zoom-label').textContent = '1.0×';
    }
    Utils.addEvent('PTZ: ' + dir, 'blue');
  };

  const setZoom = (val) => {
    state.zoom = parseFloat(val);
    document.getElementById('zoom-label').textContent = state.zoom.toFixed(1) + '×';
  };

  /* ----------------------------------------------------------
     MAIN RENDER LOOP
  ---------------------------------------------------------- */

  const _loop = () => {
    if (!state.stream) return;
    state.animId = requestAnimationFrame(_loop);

    state.frameCount++;
    state.fpsCount++;
    const now = Date.now();
    if (now - state.fpsLast >= 1000) {
      document.getElementById('fps-bar').textContent = state.fpsCount + ' fps';
      state.fpsCount = 0;
      state.fpsLast  = now;
    }

    // Process every 2nd frame for performance
    if (state.frameCount % 2 !== 0) return;

    const W = overlay.width;
    const H = overlay.height;
    ctx.clearRect(0, 0, W, H);

    // ---- Draw video to canvas (with flip) ----
    ctx.save();
    if (state.isFlipped) { ctx.translate(W, 0); ctx.scale(-1, 1); }

    // Apply CSS filter (non-pixel ones)
    const cssFilter = ['grayscale(1)', 'invert(1)', 'brightness(1.5)', 'sepia(1)', 'hue-rotate(180deg)', 'saturate(3)', 'blur(3px)'];
    if (cssFilter.includes(state.activeFilter)) {
      ctx.filter = state.activeFilter;
    }
    ctx.drawImage(video, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.restore();

    // ---- Get pixel data for analysis ----
    const imgData = ctx.getImageData(0, 0, W, H);

    // ---- Pixel filter (edge / thermal) ----
    const wasPixelFilter = Renderer.applyPixelFilter(imgData, state.activeFilter);
    if (wasPixelFilter) ctx.putImageData(imgData, 0, 0);

    const d = imgData.data;

    // ---- Zoom/pan crop ----
    if (state.zoom > 1) {
      const cw = W / state.zoom, ch = H / state.zoom;
      const cx2 = Utils.clamp(W / 2 - cw / 2 + state.panX, 0, W - cw);
      const cy2 = Utils.clamp(H / 2 - ch / 2 + state.panY, 0, H - ch);
      const zoomed = ctx.getImageData(cx2, cy2, cw, ch);
      const tmp   = document.createElement('canvas');
      tmp.width = cw; tmp.height = ch;
      tmp.getContext('2d').putImageData(zoomed, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(tmp, 0, 0, W, H);
    }

    // ---- LIGHT ANALYSIS ----
    if (state.modes.light) {
      const light = Analyzer.analyzeLight(d, W, H);
      Utils.set('d-bright',   light.brightness + '%');
      Utils.pct('p-bright',   light.brightness);
      Utils.set('d-contrast', light.contrast   + '%');
      Utils.pct('p-contrast', light.contrast);
      Utils.set('d-sat',      light.sat        + '%');
      Utils.pct('p-sat',      light.sat);
      Utils.set('s-light',    light.lightStatus);
      Utils.set('s-noise',    light.noise < 5 ? 'Rendah' : light.noise < 18 ? 'Sedang' : 'Tinggi');

      // Dominant color
      const cname = Utils.colorName(light.avgR, light.avgG, light.avgB);
      const cel   = document.getElementById('d-color');
      if (cel) {
        cel.textContent = cname;
        cel.style.color = `rgb(${light.avgR},${light.avgG},${light.avgB})`;
      }
    }

    // ---- MOTION ANALYSIS ----
    if (state.modes.motion) {
      const motion = Analyzer.analyzeMotion(d, W, H);
      Utils.set('d-motion',  motion.motionPct + '%');
      Utils.pct('p-motion',  motion.motionPct);
      Utils.set('d-speed',   motion.speedLabel);
      Utils.pct('p-speed',   motion.speedPct || 0);

      if (motion.motionPct > 18) {
        const t = Date.now();
        if (t - state.lastMotionAlert > 1200) {
          Utils.addEvent(`Gerakan terdeteksi (${motion.motionPct}%)`, 'red');
          state.lastMotionAlert = t;
        }
        Utils.set('s-alert', 'AKTIF ⚠');
        const sa = document.getElementById('s-alert');
        if (sa) sa.className = 'stat-val red';
      } else {
        Utils.set('s-alert', 'Aman ✓');
        const sa = document.getElementById('s-alert');
        if (sa) sa.className = 'stat-val green';
      }

      // Heatmap
      Renderer.drawHeatmap(hmc, hmCtx, Analyzer.getHeatmap());
    }

    // ---- FACE DETECTION ----
    if (state.modes.face) {
      state.faceRegions = Analyzer.detectFaces(d, W, H);
      const fc = state.faceRegions.length;
      Utils.set('d-face',      fc > 0 ? fc + (fc === 1 ? ' wajah' : ' wajah') : 'Tidak ada');
      Utils.pct('p-face',      Math.min(100, fc * 34));

      if (fc > 0) {
        const f = state.faceRegions[0];
        Utils.set('d-face-area', Math.round(f.w * f.h / 1000) + 'K px²');
        const dist = Analyzer.estimateDist(f.h, H);
        Utils.set('s-dist', dist ? `~${dist} m` : '—');
        Renderer.drawFaces(ctx, state.faceRegions);
      } else {
        Utils.set('d-face-area', '—');
        Utils.set('s-dist',      '—');
      }
    }

    // ---- POSE SKELETON ----
    if (state.modes.pose && state.faceRegions.length > 0) {
      Renderer.drawPose(ctx, state.faceRegions[0]);
    }

    // ---- ZONE OVERLAY ----
    if (state.modes.zone) {
      Renderer.drawZones(ctx, W, H, Analyzer.getHeatmap());
    }

    // ---- STABILITY ----
    Utils.set('s-stable', Analyzer.getStability() + '%');

    // ---- HISTOGRAM (every 6th frame) ----
    if (state.frameCount % 6 === 0) {
      const hist = Analyzer.computeHistogram(d);
      Renderer.drawHistogram(histCanvas, histCtx, hist);
    }
  };

  /* ----------------------------------------------------------
     HELPERS
  ---------------------------------------------------------- */

  const _resetStats = () => {
    const ids = [
      'd-motion','d-speed','d-face','d-face-area','d-bright',
      'd-contrast','d-color','d-sat','s-light','s-noise',
      's-dist','s-stable','s-alert'
    ];
    ids.forEach(id => Utils.set(id, '—'));
    ['p-motion','p-speed','p-face','p-bright','p-contrast','p-sat'].forEach(id => Utils.pct(id, 0));
    hmCtx.clearRect(0, 0, hmc.width, hmc.height);
    histCtx.clearRect(0, 0, histCanvas.width, histCanvas.height);
  };

  // Public API
  return {
    startCam, stopCam, switchCam, toggleFlip,
    takeSnapshot, downloadSnap, toggleRecord,
    setFilter, toggleMode,
    ptz, setZoom
  };
})();
