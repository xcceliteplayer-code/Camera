/* =============================================
   WebCam Scanner Pro — renderer.js
   Canvas overlay: face boxes, skeleton, zones,
   heatmap, histogram, filters
   ============================================= */

'use strict';

const Renderer = (() => {

  /* ----------------------------------------------------------
     FACE BOXES + LANDMARK HINTS
  ---------------------------------------------------------- */

  const drawFaces = (ctx, faces) => {
    const colors = ['#639922', '#ef9f27', '#378add'];

    faces.forEach((face, i) => {
      const c = colors[i] || '#888';

      // Box
      ctx.save();
      ctx.strokeStyle = c;
      ctx.lineWidth   = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(face.x, face.y, face.w, face.h);

      // Fill tint
      ctx.fillStyle = c + '18';
      ctx.fillRect(face.x, face.y, face.w, face.h);

      // Corner accents
      const cs = 12;
      ctx.lineWidth = 3;
      [[face.x, face.y], [face.x + face.w, face.y], [face.x, face.y + face.h], [face.x + face.w, face.y + face.h]].forEach(([cx, cy]) => {
        const dx = cx === face.x ? cs : -cs;
        const dy = cy === face.y ? cs : -cs;
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy);
        ctx.stroke();
      });

      // Label
      ctx.font      = 'bold 11px monospace';
      ctx.fillStyle = c;
      ctx.fillText(`Wajah ${i + 1}`, face.x + 4, face.y > 14 ? face.y - 4 : face.y + 14);

      // Landmark hints (eyes, nose, mouth)
      const { x, y, w, h } = face;
      ctx.fillStyle = 'rgba(55,138,221,0.75)';

      // Eyes
      const ew = w * 0.14, eh = h * 0.08;
      ctx.fillRect(x + w * 0.22, y + h * 0.28, ew, eh); // left eye
      ctx.fillRect(x + w * 0.62, y + h * 0.28, ew, eh); // right eye

      // Nose
      ctx.fillStyle = 'rgba(55,138,221,0.5)';
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h * 0.55, w * 0.06, 0, Math.PI * 2);
      ctx.fill();

      // Mouth
      ctx.strokeStyle = 'rgba(55,138,221,0.6)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h * 0.7, w * 0.18, 0, Math.PI);
      ctx.stroke();

      ctx.restore();
    });
  };

  /* ----------------------------------------------------------
     SKELETON / POSE OVERLAY
  ---------------------------------------------------------- */

  const drawPose = (ctx, face) => {
    if (!face) return;

    const { x, y, w, h } = face;
    const cx = x + w / 2;
    const s  = h; // scale unit

    // Joint definitions
    const J = {
      head:      [cx,       y + h * 0.5],
      neck:      [cx,       y + s * 1.05],
      lShoulder: [cx - s * 0.65, y + s * 1.4],
      rShoulder: [cx + s * 0.65, y + s * 1.4],
      lElbow:    [cx - s * 1.0,  y + s * 2.1],
      rElbow:    [cx + s * 1.0,  y + s * 2.1],
      lWrist:    [cx - s * 1.2,  y + s * 2.85],
      rWrist:    [cx + s * 1.2,  y + s * 2.85],
      spine:     [cx,       y + s * 1.9],
      lHip:      [cx - s * 0.45, y + s * 2.5],
      rHip:      [cx + s * 0.45, y + s * 2.5],
      lKnee:     [cx - s * 0.5,  y + s * 3.55],
      rKnee:     [cx + s * 0.5,  y + s * 3.55],
      lAnkle:    [cx - s * 0.55, y + s * 4.6],
      rAnkle:    [cx + s * 0.55, y + s * 4.6],
    };

    const bones = [
      ['head', 'neck'],
      ['neck', 'lShoulder'], ['neck', 'rShoulder'],
      ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'],
      ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'],
      ['neck', 'spine'],
      ['spine', 'lHip'], ['spine', 'rHip'],
      ['lHip', 'lKnee'], ['lKnee', 'lAnkle'],
      ['rHip', 'rKnee'], ['rKnee', 'rAnkle'],
    ];

    ctx.save();
    ctx.globalAlpha  = 0.75;
    ctx.strokeStyle  = '#7f77dd';
    ctx.lineWidth    = 2;

    bones.forEach(([a, b]) => {
      if (!J[a] || !J[b]) return;
      ctx.beginPath();
      ctx.moveTo(J[a][0], J[a][1]);
      ctx.lineTo(J[b][0], J[b][1]);
      ctx.stroke();
    });

    ctx.fillStyle = '#afa9ec';
    Object.values(J).forEach(([jx, jy]) => {
      ctx.beginPath();
      ctx.arc(jx, jy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  };

  /* ----------------------------------------------------------
     ZONE GRID OVERLAY (motion zones)
  ---------------------------------------------------------- */

  const drawZones = (ctx, W, H, heatmap) => {
    const COLS = 3, ROWS = 3;
    const zW = W / COLS, zH = H / ROWS;

    const labels = [
      'Kiri-Atas',   'Tengah-Atas',   'Kanan-Atas',
      'Kiri-Mid',    'Tengah',         'Kanan-Mid',
      'Kiri-Bawah', 'Tengah-Bawah', 'Kanan-Bawah'
    ];

    ctx.save();

    for (let zy = 0; zy < ROWS; zy++) {
      for (let zx = 0; zx < COLS; zx++) {
        // Map zone to heatmap region (16×12 → 3×3)
        const hCol = Math.floor(zx * 5.3);
        const hRow = Math.floor(zy * 4);
        const heat = heatmap[hRow * 16 + hCol] || 0;
        if (heat < 18) continue;

        const alpha   = Math.min(0.85, heat / 100);
        const fillA   = Math.min(0.2,  heat / 200);
        const lx = zx * zW, ly = zy * zH;

        ctx.strokeStyle = `rgba(226,75,74,${alpha})`;
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(lx + 2, ly + 2, zW - 4, zH - 4);
        ctx.setLineDash([]);

        ctx.fillStyle = `rgba(226,75,74,${fillA})`;
        ctx.fillRect(lx + 2, ly + 2, zW - 4, zH - 4);

        ctx.fillStyle = `rgba(226,75,74,${alpha})`;
        ctx.font      = 'bold 10px monospace';
        ctx.fillText(labels[zy * COLS + zx], lx + 6, ly + 16);
      }
    }

    ctx.restore();
  };

  /* ----------------------------------------------------------
     HEATMAP CANVAS
  ---------------------------------------------------------- */

  const drawHeatmap = (hmc, hmCtx, heatmap, cols = 16, rows = 12) => {
    const W = hmc.width  || hmc.offsetWidth  || 300;
    const H = hmc.height || 80;
    const cw = W / cols, ch = H / rows;

    hmCtx.clearRect(0, 0, W, H);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = heatmap[r * cols + c];
        if (v < 5) continue;
        const heat  = Math.min(1, v / 100);
        const red   = Math.min(255, heat * 510);
        const green = Math.max(0, 255 - heat * 510);
        const alpha = Math.min(0.92, heat * 1.2);
        hmCtx.fillStyle = `rgba(${Math.round(red)},${Math.round(green)},0,${alpha})`;
        hmCtx.fillRect(c * cw, r * ch, cw - 1, ch - 1);
      }
    }
  };

  /* ----------------------------------------------------------
     HISTOGRAM CANVAS (RGB)
  ---------------------------------------------------------- */

  const drawHistogram = (canvas, histCtx, hist) => {
    const W = canvas.width  || canvas.offsetWidth || 300;
    const H = canvas.height || 70;

    histCtx.clearRect(0, 0, W, H);

    const channels = [
      { data: hist.r, color: 'rgba(226,75,74,0.6)' },
      { data: hist.g, color: 'rgba(99,153,34,0.6)'  },
      { data: hist.b, color: 'rgba(55,138,221,0.6)'  },
    ];

    channels.forEach(({ data, color }) => {
      const max = Math.max(...data) || 1;
      histCtx.beginPath();
      histCtx.fillStyle = color;
      for (let i = 0; i < 256; i++) {
        const bh = (data[i] / max) * H;
        const bx = (i / 256) * W;
        const bw = W / 256;
        histCtx.fillRect(bx, H - bh, bw, bh);
      }
    });
  };

  /* ----------------------------------------------------------
     FILTER APPLICATION
  ---------------------------------------------------------- */

  /**
   * Apply a pixel-level filter to ImageData in place
   * @param {ImageData} imgData
   * @param {string} filter  'edge' | 'thermo' | 'none' | css-filter-string (ignored here)
   */
  const applyPixelFilter = (imgData, filter) => {
    const d = imgData.data;
    const len = d.length;

    if (filter === 'thermo') {
      for (let i = 0; i < len; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const t   = lum / 255;
        d[i]     = Math.min(255, t * 2 * 255);
        d[i + 1] = Math.max(0, Math.min(255, (t - 0.5) * 2 * 255));
        d[i + 2] = Math.max(0, (1 - t * 2) * 255);
      }
      return true;
    }

    return false; // CSS filter handled elsewhere
  };

  return {
    drawFaces,
    drawPose,
    drawZones,
    drawHeatmap,
    drawHistogram,
    applyPixelFilter
  };
})();
