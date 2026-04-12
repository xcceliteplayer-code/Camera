/* =============================================
   WebCam Scanner Pro — utils.js
   Helper utilities (ES6+)
   ============================================= */

'use strict';

const Utils = (() => {

  /** Set text content of element by ID */
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  /** Set width (%) of progress bar fill */
  const pct = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.round(Math.max(0, Math.min(100, val))) + '%';
  };

  /** Format timestamp HH:MM:SS */
  const timestamp = () =>
    new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  /** Clamp number between min and max */
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /** Map value from one range to another */
  const mapRange = (v, inMin, inMax, outMin, outMax) =>
    outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);

  /** Compute rolling average from array */
  const rollingAvg = (arr, last = 10) => {
    const slice = arr.slice(-last);
    return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
  };

  /**
   * Identify dominant color name from RGB
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @returns {string}
   */
  const colorName = (r, g, b) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40)  return 'Hitam';
    if (min > 200) return 'Putih';
    const diff = max - min;
    if (diff < 20) return 'Abu-abu';
    if (r >= g && r >= b) {
      if (r > 180 && g > 120 && b < 80) return 'Oranye';
      if (r > 150 && g > 100 && b > 100) return 'Merah Muda';
      return 'Merah';
    }
    if (g >= r && g >= b) {
      if (g > 150 && r > 120) return 'Kuning-Hijau';
      return 'Hijau';
    }
    if (b >= r && b >= g) {
      if (b > 150 && r > 100) return 'Ungu';
      return 'Biru';
    }
    if (r > 180 && g > 180 && b < 100) return 'Kuning';
    return 'Campuran';
  };

  /**
   * Download a canvas as a PNG file
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   */
  const downloadCanvas = (canvas, filename) => {
    const a = document.createElement('a');
    a.download = filename;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  /**
   * Add an event item to the log panel
   * @param {string} msg
   * @param {'green'|'red'|'blue'|'amber'|'gray'} color
   */
  const addEvent = (msg, color = 'gray') => {
    const log = document.getElementById('event-log');
    if (!log) return;

    const item = document.createElement('div');
    item.className = 'event-item';

    const dot = document.createElement('div');
    dot.className = `event-dot ${color}`;

    const time = document.createElement('span');
    time.style.cssText = 'opacity:0.6;margin-right:4px;flex-shrink:0;';
    time.textContent = timestamp();

    const text = document.createTextNode(msg);

    item.appendChild(dot);
    item.appendChild(time);
    item.appendChild(text);
    log.insertBefore(item, log.firstChild);

    // Keep log capped at 40 entries
    while (log.children.length > 40) log.removeChild(log.lastChild);
  };

  return { set, pct, timestamp, clamp, mapRange, rollingAvg, colorName, downloadCanvas, addEvent };
})();
