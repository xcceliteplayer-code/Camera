/* =============================================
   WebCam Scanner Pro — analyzer.js
   Frame analysis: motion, face, light, color
   ============================================= */

'use strict';

const Analyzer = (() => {

  // State
  let prevData      = null;
  let motionHistory = [];
  let heatmap       = new Float32Array(16 * 12);

  /** Reset all analysis state */
  const reset = () => {
    prevData      = null;
    motionHistory = [];
    heatmap.fill(0);
  };

  /* ----------------------------------------------------------
     1. BRIGHTNESS / CONTRAST / COLOR / SATURATION
  ---------------------------------------------------------- */

  /**
   * Analyze basic pixel stats from ImageData
   * @param {Uint8ClampedArray} d  pixel data
   * @param {number} W width
   * @param {number} H height
   */
  const analyzeLight = (d, W, H) => {
    let rSum = 0, gSum = 0, bSum = 0, total = 0;
    let minL = 255, maxL = 0;

    const step = 16; // sample every 16 bytes (= every 4th pixel × 4 channels)
    for (let i = 0; i < d.length; i += step) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      rSum += r; gSum += g; bSum += b;
      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;
      total++;
    }

    const avgR = rSum / total;
    const avgG = gSum / total;
    const avgB = bSum / total;
    const brightness = Math.round((0.299 * avgR + 0.587 * avgG + 0.114 * avgB) / 255 * 100);
    const contrast   = Math.round((maxL - minL) / 255 * 100);

    // Saturation (simple HSV-ish)
    const cMax = Math.max(avgR, avgG, avgB);
    const cMin = Math.min(avgR, avgG, avgB);
    const sat  = cMax > 0 ? Math.round((cMax - cMin) / cMax * 100) : 0;

    // Noise (adjacent pixel diff)
    let noiseAcc = 0, ns = 0;
    for (let i = 0; i < d.length - 4; i += 64) {
      noiseAcc += Math.abs(d[i] - d[i + 4]) + Math.abs(d[i + 1] - d[i + 5]) + Math.abs(d[i + 2] - d[i + 6]);
      ns++;
    }
    const noise = Math.round(noiseAcc / ns / 3);

    return {
      brightness, contrast, sat,
      avgR: Math.round(avgR), avgG: Math.round(avgG), avgB: Math.round(avgB),
      noise,
      lightStatus: brightness < 25 ? '🌑 Gelap' : brightness < 55 ? '🌤 Redup' : brightness < 85 ? '☀ Normal' : '💡 Sangat Terang'
    };
  };

  /* ----------------------------------------------------------
     2. MOTION DETECTION (block-diff)
  ---------------------------------------------------------- */

  /**
   * Compare current frame against previous frame
   * @param {Uint8ClampedArray} d current pixel data
   * @param {number} W
   * @param {number} H
   * @returns {{ motionPct, speedLabel, heatmap }}
   */
  const analyzeMotion = (d, W, H) => {
    if (!prevData) {
      prevData = new Uint8Array(d);
      return { motionPct: 0, speedLabel: '—', heatmap };
    }

    const cols = 16, rows = 12;
    const cW = Math.floor(W / cols);
    const cH = Math.floor(H / rows);

    let totalDiff = 0;
    const newHeat = new Float32Array(cols * rows);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let cellDiff = 0, count = 0;
        for (let py = 0; py < cH; py += 4) {
          for (let px = 0; px < cW; px += 4) {
            const x = col * cW + px;
            const y = row * cH + py;
            if (x >= W || y >= H) continue;
            const idx = (y * W + x) * 4;
            cellDiff +=
              Math.abs(d[idx]     - prevData[idx])     +
              Math.abs(d[idx + 1] - prevData[idx + 1]) +
              Math.abs(d[idx + 2] - prevData[idx + 2]);
            count++;
          }
        }
        newHeat[row * cols + col] = count > 0 ? cellDiff / count : 0;
        totalDiff += newHeat[row * cols + col];
      }
    }

    // Decay + update heatmap
    for (let i = 0; i < heatmap.length; i++) {
      heatmap[i] = heatmap[i] * 0.88 + newHeat[i] * 0.35;
    }

    const avgDiff  = totalDiff / (cols * rows);
    const motionPct = Math.min(100, Math.round(avgDiff / 2.5));

    // Speed based on delta of motion history
    const prevMotion = motionHistory.length > 0 ? motionHistory[motionHistory.length - 1] : 0;
    const delta      = Math.abs(motionPct - prevMotion);
    const speedLabel = delta < 3 ? 'Statis' : delta < 10 ? 'Lambat' : delta < 25 ? 'Sedang' : 'Cepat';
    const speedPct   = Utils.clamp(delta * 4, 0, 100);

    motionHistory.push(motionPct);
    if (motionHistory.length > 60) motionHistory.shift();

    prevData = new Uint8Array(d);

    return { motionPct, speedLabel, speedPct, heatmap };
  };

  /* ----------------------------------------------------------
     3. FACE DETECTION (skin-tone blob)
  ---------------------------------------------------------- */

  /**
   * Detect faces by skin-tone clustering (no external library)
   * @param {Uint8ClampedArray} d
   * @param {number} W
   * @param {number} H
   * @returns {Array<{x,y,w,h,area}>}
   */
  const detectFaces = (d, W, H) => {
    const SCALE = 8;
    const sw = Math.floor(W / SCALE);
    const sh = Math.floor(H / SCALE);
    const skinMap  = new Uint8Array(sw * sh);
    const visited  = new Uint8Array(sw * sh);

    // 1. Build skin map
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const ox = x * SCALE, oy = y * SCALE;
        const idx = (oy * W + ox) * 4;
        const r = d[idx], g = d[idx + 1], b = d[idx + 2];
        // Kovac skin detection rules
        const isSkin = (
          r > 95 && g > 40 && b > 20 &&
          (Math.max(r, g, b) - Math.min(r, g, b)) > 15 &&
          Math.abs(r - g) > 15 &&
          r > g && r > b
        );
        skinMap[y * sw + x] = isSkin ? 1 : 0;
      }
    }

    // 2. BFS blob finding
    const regions = [];

    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        if (!skinMap[y * sw + x] || visited[y * sw + x]) continue;

        const queue = [[x, y]];
        const cells = [];

        while (queue.length) {
          const [cx, cy] = queue.pop();
          if (cx < 0 || cy < 0 || cx >= sw || cy >= sh) continue;
          if (visited[cy * sw + cx] || !skinMap[cy * sw + cx]) continue;
          visited[cy * sw + cx] = 1;
          cells.push([cx, cy]);
          queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }

        // Minimum blob size (relative to scaled frame)
        if (cells.length < 40) continue;

        const xs  = cells.map(c => c[0]);
        const ys  = cells.map(c => c[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const bw = maxX - minX, bh = maxY - minY;

        // Must be at least 8% of frame width in scaled pixels
        const minDim = sw * 0.08;
        if (bw < minDim || bh < minDim) continue;

        // Stricter aspect ratio: real faces are roughly square-ish (0.65–1.5)
        const ar = bh / bw;
        if (ar < 0.65 || ar > 1.6) continue;

        // Density check: blob cells vs bounding box area (faces are dense)
        const boxArea = bw * bh;
        const density = cells.length / boxArea;
        if (density < 0.35) continue;

        regions.push({
          x:    minX * SCALE,
          y:    minY * SCALE,
          w:    bw   * SCALE,
          h:    bh   * SCALE,
          area: cells.length,
          density
        });
      }
    }

    // Sort largest first
    regions.sort((a, b) => b.area - a.area);

    // Non-Maximum Suppression: remove boxes that overlap >50% with a larger one
    const iou = (a, b) => {
      const ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
      const ix2 = Math.min(a.x + a.w, b.x + b.w), iy2 = Math.min(a.y + a.h, b.y + b.h);
      if (ix2 <= ix1 || iy2 <= iy1) return 0;
      const inter = (ix2 - ix1) * (iy2 - iy1);
      const uni   = a.w * a.h + b.w * b.h - inter;
      return inter / uni;
    };

    const kept = [];
    for (const r of regions) {
      if (kept.every(k => iou(k, r) < 0.4)) kept.push(r);
      if (kept.length >= 2) break; // max 2 real faces
    }

    // Final sanity: if a "face" is mostly in the lower half and smaller than 40%
    // of the largest face area → likely a hand/neck, discard it
    const largest = kept[0];
    return kept.filter((r, i) => {
      if (i === 0) return true;
      const sizeRatio = r.area / largest.area;
      return sizeRatio > 0.4; // must be at least 40% the size of main face
    });
  };

  /* ----------------------------------------------------------
     4. FRAME STABILITY
  ---------------------------------------------------------- */

  const getStability = () => {
    if (motionHistory.length < 6) return 100;
    const recent = motionHistory.slice(-6);
    const avg    = recent.reduce((a, b) => a + b, 0) / recent.length;
    return Math.max(0, Math.round(100 - avg * 0.8));
  };

  /* ----------------------------------------------------------
     5. HISTOGRAM (RGB channels)
  ---------------------------------------------------------- */

  /**
   * Compute per-channel histogram (256 bins)
   * @param {Uint8ClampedArray} d
   * @returns {{ r, g, b }}
   */
  const computeHistogram = (d) => {
    const r = new Uint32Array(256);
    const g = new Uint32Array(256);
    const b = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 8) {
      r[d[i]]++;
      g[d[i + 1]]++;
      b[d[i + 2]]++;
    }
    return { r, g, b };
  };

  /* ----------------------------------------------------------
     6. DISTANCE ESTIMATE
  ---------------------------------------------------------- */

  /** Rough distance estimate from face height (pixels) */
  const estimateDist = (faceH, videoH) => {
    if (!faceH || !videoH) return null;
    // Empirical: face ~20cm wide, at 1m = ~200px on 720p
    const ratio = faceH / videoH;
    const dist  = Math.round(0.25 / ratio * 10) / 10;
    return dist > 0 && dist < 10 ? dist : null;
  };

  return {
    reset,
    analyzeLight,
    analyzeMotion,
    detectFaces,
    getStability,
    computeHistogram,
    estimateDist,
    getHeatmap: () => heatmap,
    getMotionHistory: () => motionHistory
  };
})();
