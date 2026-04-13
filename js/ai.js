/* ══════════════════════════════════════
   WCAM PRO V2 — ai.js
   Claude API Vision Integration
   Anthropic /v1/messages — no API key needed (handled by platform)
══════════════════════════════════════ */
'use strict';

const AI = (() => {
  let isThinking   = false;
  let autoScanTimer = null;
  let msgCount     = 0;
  const API_URL    = 'https://api.anthropic.com/v1/messages';
  const MODEL      = 'claude-sonnet-4-20250514';

  // Conversation history for multi-turn
  let history = [];

  /* ── UI helpers ── */
  const setStatus = (s) => {
    const dot = U.el('ai-status-dot');
    if (!dot) return;
    dot.className = 'ai-status-dot';
    if (s === 'ready')    dot.classList.add('ready');
    if (s === 'thinking') dot.classList.add('thinking');
    if (s === 'error')    dot.classList.add('error');
  };

  const addMessage = (role, text) => {
    const box   = U.el('ai-messages');
    if (!box) return;
    const labels = { system:'SYSTEM', user:'YOU', ai:'WCAM AI', error:'ERROR' };
    const div    = document.createElement('div');
    div.className = `ai-msg ${role}`;
    div.innerHTML = `<div class="ai-msg-label">${labels[role]||role}</div><div class="ai-msg-text">${text}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    msgCount++;
    // Keep history manageable
    if (box.children.length > 40) box.removeChild(box.children[1]);
  };

  const showOverlay = (show) => {
    const ov = U.el('ai-overlay');
    if (ov) ov.style.display = show ? 'flex' : 'none';
  };

  /* ── Build system prompt with current sensor context ── */
  const buildSystemPrompt = () => {
    const stats = collectStats();
    return `Kamu adalah AI Vision Assistant yang terintegrasi dalam aplikasi WebCam Scanner Pro V2. 
Kamu melihat melalui kamera pengguna dan memiliki akses ke data sensor real-time.

DATA SENSOR SAAT INI:
${stats}

KEMAMPUANMU:
- Menganalisis visual dari kamera (wajah, tubuh, pose, gerakan, kondisi)
- Memberikan rekomendasi berdasarkan data sensor
- Mendeteksi kondisi berbahaya atau tidak normal
- Memberikan saran ergonomi, pencahayaan, keamanan
- Menjawab pertanyaan tentang apa yang terlihat di kamera

PANDUAN RESPONS:
- Bahasa Indonesia yang natural dan informatif
- Respons singkat dan actionable (maks 150 kata kecuali diminta detail)
- Gunakan data sensor untuk mendukung analisis visual
- Jika tidak ada gambar/frame yang dikirim, gunakan data sensor sebagai basis analisis
- Jangan sebut dirimu sebagai "Claude" — kamu adalah "WCAM AI Assistant"`;
  };

  const collectStats = () => {
    const ids = [
      ['v-motion','Gerakan'],['v-speed','Kecepatan Gerakan'],['v-face','Wajah Terdeteksi'],
      ['v-body','Pose Body'],['v-bright','Kecerahan'],['v-contrast','Kontras'],
      ['v-sat','Saturasi'],['v-stable','Stabilitas Frame'],
      ['bs-face','Wajah'],['bs-dist','Estimasi Jarak'],['bs-pose','Pose'],
      ['bs-head','Orientasi Kepala'],['bs-hand','Gerakan Tangan'],
      ['bs-light','Status Cahaya'],['bs-color','Warna Dominan'],['bs-alert','Alert'],
      ['res-val','Resolusi'],['fps-val','FPS'],
    ];
    return ids.map(([id,label])=>{
      const el=U.el(id); return el?`- ${label}: ${el.textContent}`:null;
    }).filter(Boolean).join('\n');
  };

  const collectLog = () => {
    const log = U.el('event-log');
    if (!log) return '';
    return Array.from(log.children).slice(0,8).map(e=>e.textContent.trim()).join(' | ');
  };

  /* ── Capture current frame as base64 ── */
  const captureFrame = () => {
    const video = document.getElementById('video');
    if (!video || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = Math.min(video.videoWidth, 640);
    c.height = Math.round(c.width * (video.videoHeight / video.videoWidth));
    const ctx = c.getContext('2d');
    const flipped = document.getElementById('flip-cb')?.checked;
    if (flipped) { ctx.translate(c.width,0); ctx.scale(-1,1); }
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7).split(',')[1];
  };

  /* ── Core API call ── */
  const callAPI = async (userText, includeFrame=true) => {
    if (isThinking) return;
    isThinking = true;
    setStatus('thinking');
    showOverlay(true);
    U.el('ai-send').disabled = true;

    try {
      // Build message content
      const content = [];

      // Optional: frame image
      const sendFrame = includeFrame && document.getElementById('ctx-frame')?.checked;
      if (sendFrame) {
        const b64 = captureFrame();
        if (b64) {
          content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data:b64 } });
        }
      }

      // Stats context
      const sendStats = document.getElementById('ctx-stats')?.checked;
      let contextText = userText;
      if (sendStats) {
        contextText = `[DATA SENSOR]\n${collectStats()}\n\n[PERTANYAAN/PERINTAH]\n${userText}`;
      }

      // Log context
      const sendLog = document.getElementById('ctx-log')?.checked;
      if (sendLog) {
        const logData = collectLog();
        if (logData) contextText += `\n\n[EVENT LOG TERKINI]\n${logData}`;
      }

      content.push({ type:'text', text:contextText });

      // Add to history
      history.push({ role:'user', content });

      // Keep history to last 6 turns to avoid token overflow
      if (history.length > 12) history = history.slice(-12);

      const body = {
        model: MODEL,
        max_tokens: 600,
        system: buildSystemPrompt(),
        messages: history
      };

      const res  = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(()=>({error:{message:res.statusText}}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const reply = data.content?.find(b=>b.type==='text')?.text || '(tidak ada respons)';

      // Add assistant reply to history
      history.push({ role:'assistant', content:[{type:'text',text:reply}] });

      addMessage('ai', reply.replace(/\n/g,'<br/>'));
      U.log('AI membalas', 'accent');
      setStatus('ready');

    } catch (err) {
      const msg = err.message.includes('Failed to fetch')
        ? 'Tidak bisa terhubung ke API. Pastikan koneksi internet aktif.'
        : `Error: ${err.message}`;
      addMessage('error', msg);
      U.log('AI error: '+err.message, 'red');
      setStatus('error');
    } finally {
      isThinking   = false;
      showOverlay(false);
      U.el('ai-send').disabled = false;
    }
  };

  /* ── Public methods ── */

  const send = () => {
    const input = U.el('ai-input');
    const text  = input?.value?.trim();
    if (!text || isThinking) return;
    addMessage('user', text);
    input.value = '';
    callAPI(text, true);
  };

  const quick = (prompt) => {
    addMessage('user', prompt);
    callAPI(prompt, true);
  };

  const analyzeSnapshot = () => {
    if (isThinking) return;
    const prompt = 'Analisis lengkap frame kamera ini: deteksi semua yang terlihat (orang, wajah, pose tubuh, kondisi pencahayaan, lingkungan, gerakan, ekspresi, dll). Berikan laporan terstruktur.';
    addMessage('user', '📸 ' + prompt);
    callAPI(prompt, true);
    U.log('AI Scan dimulai', 'accent');
  };

  const toggleAutoScan = (enabled) => {
    if (autoScanTimer) { clearInterval(autoScanTimer); autoScanTimer = null; }
    if (enabled) {
      const interval = parseInt(U.el('scan-interval')?.value || '30000');
      autoScanTimer = setInterval(()=>{
        if (!isThinking) {
          const prompt = 'Auto-scan: berikan update singkat kondisi kamera saat ini.';
          callAPI(prompt, true);
          U.log('Auto-scan AI', 'accent');
        }
      }, interval);
      U.log(`Auto-scan aktif (${interval/1000}s)`, 'green');
    } else {
      U.log('Auto-scan dimatikan', 'gray');
    }
  };

  // Allow Enter key to send
  document.addEventListener('DOMContentLoaded', ()=>{
    const input = U.el('ai-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
    }
    setStatus('ready');
  });

  return { send, quick, analyzeSnapshot, toggleAutoScan };
})();
