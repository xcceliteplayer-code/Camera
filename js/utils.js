/* ══════════════════════════════════════
   WCAM PRO V2 — utils.js
══════════════════════════════════════ */
'use strict';

const U = (() => {
  const set   = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const pct   = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = Math.round(Math.min(100,Math.max(0,v))) + '%'; };
  const el    = (id)    => document.getElementById(id);
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const lerp  = (a,b,t) => a + (b-a)*t;
  const ts    = ()      => new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const rand  = (a,b)   => Math.random()*(b-a)+a;

  const colorName = (r,g,b) => {
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    if(max<40) return 'Hitam';
    if(min>215) return 'Putih';
    if(max-min<20) return 'Abu-abu';
    if(r>=g&&r>=b) return (r>160&&g>120&&b<80)?'Oranye':(r>150&&g>100&&b>80)?'Merah Muda':'Merah';
    if(g>=r&&g>=b) return (g>150&&r>120)?'Kuning-Hijau':'Hijau';
    if(b>=r&&b>=g) return (b>150&&r>100)?'Ungu':'Biru';
    if(r>180&&g>180&&b<100) return 'Kuning';
    return 'Campuran';
  };

  const log = (msg, color='gray') => {
    const lg = el('event-log'); if(!lg) return;
    const item = document.createElement('div');
    item.className = 'ev-item';
    item.innerHTML = `<span class="ev-dot ${color}"></span><span class="ev-time">${ts()}</span>${msg}`;
    lg.insertBefore(item, lg.firstChild);
    while(lg.children.length > 50) lg.removeChild(lg.lastChild);
  };

  const downloadCanvas = (canvas, name) => {
    const a = document.createElement('a');
    a.download = name; a.href = canvas.toDataURL('image/png'); a.click();
  };

  // Canvas to base64 JPEG for AI (compressed)
  const canvasToBase64 = (canvas, quality=0.7) => {
    // Resize to max 640px wide for API efficiency
    const MAX = 640;
    const ratio = Math.min(1, MAX / canvas.width);
    const tmp = document.createElement('canvas');
    tmp.width  = Math.round(canvas.width  * ratio);
    tmp.height = Math.round(canvas.height * ratio);
    tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
    const dataUrl = tmp.toDataURL('image/jpeg', quality);
    return dataUrl.split(',')[1]; // base64 only
  };

  return { set, pct, el, clamp, lerp, ts, rand, colorName, log, downloadCanvas, canvasToBase64 };
})();
