/**
 * PrintNUp — app.js
 * Carga PDFs/imágenes y los organiza en una hoja A4 para imprimir.
 * Sin frameworks, sin backend. Dependencia: PDF.js (CDN).
 */

/* ── PDF.js worker ── */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';


/* ============================================================
   TABLA DE LAYOUTS
   Para cada nup define cols×rows óptimos según orientación.

   Criterio: las celdas deben tener la misma proporción que
   una página A4 miniatura (portrait ≈ 0.707 | landscape ≈ 1.414).
   Para cada nup se elige el par (cols, rows) tal que:
     - cols × rows >= nup  (no sobran más de ~1 celda por fila)
     - el ratio cols/rows maximiza el uso del espacio de la hoja
   ============================================================ */
const LAYOUTS = {
  //  nup  portrait          landscape
   2: { p: {c:1,r:2},  l: {c:2,r:1}  },
   3: { p: {c:1,r:3},  l: {c:3,r:1}  },
   4: { p: {c:2,r:2},  l: {c:2,r:2}  },
   6: { p: {c:2,r:3},  l: {c:3,r:2}  },
   8: { p: {c:2,r:4},  l: {c:4,r:2}  },
  10: { p: {c:2,r:5},  l: {c:5,r:2}  },
  12: { p: {c:3,r:4},  l: {c:4,r:3}  },
  14: { p: {c:2,r:7},  l: {c:7,r:2}  },
  16: { p: {c:4,r:4},  l: {c:4,r:4}  },
  18: { p: {c:3,r:6},  l: {c:6,r:3}  },
  20: { p: {c:4,r:5},  l: {c:5,r:4}  },
  22: { p: {c:4,r:6},  l: {c:6,r:4}  },  // 24 celdas, 2 vacías
  24: { p: {c:4,r:6},  l: {c:6,r:4}  },
  26: { p: {c:4,r:7},  l: {c:7,r:4}  },  // 28 celdas, 2 vacías
  28: { p: {c:4,r:7},  l: {c:7,r:4}  },
  30: { p: {c:5,r:6},  l: {c:6,r:5}  },
  32: { p: {c:4,r:8},  l: {c:8,r:4}  },
};

/**
 * Devuelve {cols, rows} para el nup y orientación dados.
 * Usa la tabla si existe; calcula automáticamente si no.
 */
function getGridLayout(nup, orientation) {
  const isL = orientation === 'landscape';
  if (LAYOUTS[nup]) {
    const e = isL ? LAYOUTS[nup].l : LAYOUTS[nup].p;
    return { cols: e.c, rows: e.r };
  }
  // Fallback automático para cualquier nup fuera de tabla
  // Proporción A4: portrait w/h ≈ 0.707, landscape ≈ 1.414
  const targetRatio = isL ? (297/210) : (210/297);
  let best = null, bestScore = Infinity;
  for (let cols = 1; cols <= nup; cols++) {
    const rows = Math.ceil(nup / cols);
    if (cols === 1 && nup > 3) continue;
    if (rows === 1 && nup > 3) continue;
    const score = Math.abs((cols / rows) - targetRatio);
    if (score < bestScore) { bestScore = score; best = { cols, rows }; }
  }
  return best || { cols: Math.ceil(Math.sqrt(nup)), rows: Math.ceil(nup / Math.ceil(Math.sqrt(nup))) };
}


/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const state = {
  nup:                2,
  orientation:        'auto',     // 'auto' | 'portrait' | 'landscape'
  currentOrientation: 'portrait',
  showNumbers:        false,
  showBorders:        true,
  slots:              [],
  pendingSlotIndex:   null,
};


/* ============================================================
   REFERENCIAS DOM
   ============================================================ */
const dom = {
  nupSelect:           document.getElementById('nupSelect'),
  nupPreview:          document.getElementById('nupPreview'),
  orientationSelector: document.getElementById('orientationSelector'),
  fileInput:           document.getElementById('fileInput'),
  slotFileInput:       document.getElementById('slotFileInput'),
  btnUpload:           document.getElementById('btnUpload'),
  btnClear:            document.getElementById('btnClear'),
  btnPrint:            document.getElementById('btnPrint'),
  showNumbers:         document.getElementById('showNumbers'),
  showBorders:         document.getElementById('showBorders'),
  sheet:               document.getElementById('sheet'),
  sheetGrid:           document.getElementById('sheetGrid'),
  orientBadge:         document.getElementById('orientBadge'),
  slotCount:           document.getElementById('slotCount'),
  loadingOverlay:      document.getElementById('loadingOverlay'),
  instructions:        document.getElementById('instructions'),
};


/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
function init() {
  resetSlots();

  dom.nupSelect.addEventListener('change', onNupChange);
  dom.orientationSelector.addEventListener('click', onOrientClick);
  dom.btnUpload.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', onFileInputChange);
  dom.slotFileInput.addEventListener('change', onSlotFileInputChange);
  dom.btnClear.addEventListener('click', clearAll);
  dom.btnPrint.addEventListener('click', printSheet);
  dom.showNumbers.addEventListener('change', e => { state.showNumbers = e.target.checked; render(); });
  dom.showBorders.addEventListener('change', e => { state.showBorders = e.target.checked; render(); });

  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', onBodyDrop);

  render();
}


/* ============================================================
   GESTIÓN DE SLOTS
   ============================================================ */
function resetSlots() {
  state.slots = Array(state.nup).fill(null);
}

function fillSlotsWithImages(imageObjects) {
  let imgIdx = 0;
  for (let i = 0; i < state.slots.length && imgIdx < imageObjects.length; i++) {
    if (state.slots[i] === null) state.slots[i] = imageObjects[imgIdx++];
  }
}

function changeNup(newNup) {
  const images = state.slots.filter(s => s !== null);
  state.nup = newNup;
  state.slots = Array(newNup).fill(null);
  images.forEach((img, i) => { if (i < newNup) state.slots[i] = img; });
}


/* ============================================================
   DETECCIÓN DE ORIENTACIÓN
   ============================================================ */
function detectOrientation() {
  const filled = state.slots.filter(s => s !== null);
  if (!filled.length) return 'portrait';
  let p = 0, l = 0;
  filled.forEach(s => { if (s.aspectRatio < 1) p++; else if (s.aspectRatio > 1) l++; });
  if (p === 0 && l === 0) return 'portrait';
  // Para nup <= 3 con contenido landscape, landscape es mejor
  if (l > p && state.nup <= 3) return 'landscape';
  return p >= l ? 'portrait' : 'landscape';
}

function updateActiveOrientation() {
  state.currentOrientation = state.orientation === 'auto'
    ? detectOrientation()
    : state.orientation;
}


/* ============================================================
   RENDER PRINCIPAL
   ============================================================ */
function render() {
  updateActiveOrientation();
  renderSheet();
  renderGrid();
  drawNupPreview();
  renderIndicator();
  toggleInstructions();
}

function renderSheet() {
  dom.sheet.classList.toggle('landscape', state.currentOrientation === 'landscape');
}

function renderGrid() {
  const { cols, rows } = getGridLayout(state.nup, state.currentOrientation);

  // Gap dinámico: celdas grandes → más espacio; celdas pequeñas → menos
  const maxDim = Math.max(cols, rows);
  const gap = maxDim <= 3 ? 4 : maxDim <= 5 ? 3 : maxDim <= 8 ? 2 : 1;

  dom.sheetGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  dom.sheetGrid.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;
  dom.sheetGrid.style.gap                 = `${gap}px`;
  dom.sheetGrid.innerHTML = '';

  // Las celdas totales pueden ser más que nup (ej: 22 en grilla 4×6=24)
  const totalCells = cols * rows;
  for (let i = 0; i < totalCells; i++) {
    const isBeyond = i >= state.nup; // celda fuera del nup → vacía sin botón
    const slotEl = createSlotElement(i, state.slots[i] || null, isBeyond, cols, rows);
    dom.sheetGrid.appendChild(slotEl);
  }
}

/** Crea el div de un slot. isBeyond = celda relleno (no cuenta como slot útil) */
function createSlotElement(index, slotData, isBeyond, cols, rows) {
  const el = document.createElement('div');
  el.className = 'slot';
  if (state.showBorders) el.classList.add('has-border');
  if (isBeyond) el.classList.add('beyond');

  // Marcar como "tiny" cuando hay muchas celdas para adaptar el UI
  const maxDim = Math.max(cols, rows);
  if (maxDim >= 6) el.classList.add('tiny');

  el.dataset.index = index;

  if (isBeyond) {
    // Celda de relleno: solo fondo gris, sin interacción
    el.style.background = '#f0ece4';
    return el;
  }

  if (slotData) {
    el.classList.add('filled');
    const img = document.createElement('img');
    img.src = slotData.imageDataUrl;
    img.alt = `Página ${index + 1}`;
    img.draggable = false;
    el.appendChild(img);

    const actions = document.createElement('div');
    actions.className = 'slot-actions';
    actions.innerHTML = `
      <button class="slot-action-btn replace-btn">⇄ Reemplazar</button>
      <button class="slot-action-btn delete-btn">✕ Quitar</button>`;
    actions.querySelector('.replace-btn').addEventListener('click', () => openSlotFilePicker(index));
    actions.querySelector('.delete-btn').addEventListener('click', () => { state.slots[index] = null; render(); });
    el.appendChild(actions);

  } else {
    const addBtn = document.createElement('button');
    addBtn.className = 'slot-add-btn';
    addBtn.innerHTML = `<span class="plus-icon">+</span><span>Agregar</span>`;
    addBtn.addEventListener('click', () => openSlotFilePicker(index));
    el.appendChild(addBtn);

    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('drag-over');
      const f = e.dataTransfer.files;
      if (f.length) processFilesForSlot([f[0]], index);
    });
  }

  if (state.showNumbers) {
    const num = document.createElement('span');
    num.className = 'slot-number';
    num.textContent = index + 1;
    el.appendChild(num);
  }

  return el;
}

/**
 * Dibuja el canvas miniatura que muestra cómo quedará la grilla.
 * Usa proporciones A4 reales para que sea fiel al resultado.
 */
function drawNupPreview() {
  const canvas = dom.nupPreview;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const { cols, rows } = getGridLayout(state.nup, state.currentOrientation);

  ctx.clearRect(0, 0, W, H);

  // Fondo de la hoja (blanco con borde)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#b8b2a7';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const pad = 2, gap = 1;
  const cellW = (W - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = (H - pad * 2 - gap * (rows - 1)) / rows;
  const totalCells = cols * rows;

  for (let i = 0; i < totalCells; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cellW + gap);
    const y = pad + row * (cellH + gap);
    // Celdas de relleno (más de nup) en gris más claro
    ctx.fillStyle = i < state.nup ? '#c23a08' : '#e2ddd4';
    ctx.globalAlpha = i < state.nup ? 0.25 : 0.5;
    ctx.fillRect(x, y, cellW, cellH);
  }
  ctx.globalAlpha = 1;
}

function renderIndicator() {
  const icon = state.currentOrientation === 'landscape' ? '▭' : '▯';
  const name = state.currentOrientation === 'landscape' ? 'Horizontal' : 'Vertical';
  const tag  = state.orientation === 'auto' ? ' — Auto' : '';
  dom.orientBadge.textContent = `${icon} ${name}${tag}`;
  const filled = state.slots.filter(s => s !== null).length;
  dom.slotCount.textContent = `${filled} / ${state.nup} espacios usados`;
}

function toggleInstructions() {
  dom.instructions.style.display = state.slots.some(s => s !== null) ? 'none' : 'flex';
}


/* ============================================================
   PROCESAMIENTO DE ARCHIVOS
   ============================================================ */
async function onFileInputChange(e) {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (files.length) await processFiles(files);
}
async function onSlotFileInputChange(e) {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (files.length && state.pendingSlotIndex !== null) {
    await processFilesForSlot(files, state.pendingSlotIndex);
    state.pendingSlotIndex = null;
  }
}
async function onBodyDrop(e) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  if (files.length) await processFiles(files);
}
function openSlotFilePicker(index) {
  state.pendingSlotIndex = index;
  dom.slotFileInput.click();
}

async function processFiles(files) {
  showLoading(true);
  try {
    const imgs = [];
    for (const f of files) {
      if (f.type === 'application/pdf')       imgs.push(...await extractPdfPages(f));
      else if (f.type.startsWith('image/'))   imgs.push(await loadImageFile(f));
    }
    fillSlotsWithImages(imgs);
    render();
  } catch(e) {
    console.error(e);
    alert('Error al procesar el archivo. Verificá que sea un PDF o imagen válida.');
  } finally { showLoading(false); }
}

async function processFilesForSlot(files, slotIndex) {
  showLoading(true);
  try {
    const imgs = [];
    for (const f of files) {
      if (f.type === 'application/pdf')       imgs.push(...await extractPdfPages(f));
      else if (f.type.startsWith('image/'))   imgs.push(await loadImageFile(f));
    }
    if (imgs.length) state.slots[slotIndex] = imgs[0];
    render();
  } catch(e) {
    console.error(e);
    alert('Error al cargar el archivo.');
  } finally { showLoading(false); }
}

async function extractPdfPages(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page     = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pages.push({ imageDataUrl: canvas.toDataURL('image/jpeg', 0.92), aspectRatio: viewport.width / viewport.height });
  }
  return pages;
}

function loadImageFile(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => res({ imageDataUrl: e.target.result, aspectRatio: img.naturalWidth / img.naturalHeight });
      img.onerror = rej;
      img.src = e.target.result;
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}


/* ============================================================
   HANDLERS DE CONTROLES
   ============================================================ */
function onNupChange() {
  const n = parseInt(dom.nupSelect.value, 10);
  if (n === state.nup) return;
  changeNup(n);
  render();
}

function onOrientClick(e) {
  const btn = e.target.closest('.orient-btn');
  if (!btn) return;
  state.orientation = btn.dataset.orient;
  dom.orientationSelector.querySelectorAll('.orient-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}

function clearAll() {
  if (!confirm('¿Limpiar todos los espacios?')) return;
  resetSlots();
  state.orientation = 'auto';
  dom.orientationSelector.querySelectorAll('.orient-btn').forEach(b => b.classList.remove('active'));
  dom.orientationSelector.querySelector('[data-orient="auto"]').classList.add('active');
  render();
}


/* ============================================================
   IMPRESIÓN — Canvas → imagen única → nueva pestaña
   Funciona en desktop y mobile (Android Chrome).
   ============================================================ */
function printSheet() {
  const orientation = state.currentOrientation;
  const { cols, rows } = getGridLayout(state.nup, orientation);

  // A4 a 150 dpi
  const DPI    = 150;
  const MM2PX  = DPI / 25.4;
  const pageW  = orientation === 'landscape' ? 297 : 210; // mm
  const pageH  = orientation === 'landscape' ? 210 : 297;
  const margin = 6;  // mm
  const maxDim = Math.max(cols, rows);
  const gapMM  = maxDim <= 3 ? 2 : maxDim <= 5 ? 1.5 : maxDim <= 8 ? 1 : 0.5;

  const canvasW = Math.round(pageW  * MM2PX);
  const canvasH = Math.round(pageH  * MM2PX);
  const mPx     = Math.round(margin * MM2PX);
  const gPx     = Math.round(gapMM  * MM2PX);
  const innerW  = canvasW - mPx * 2;
  const innerH  = canvasH - mPx * 2;
  const cellW   = Math.floor((innerW - gPx * (cols - 1)) / cols);
  const cellH   = Math.floor((innerH - gPx * (rows - 1)) / rows);

  const canvas  = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx     = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Abrir la ventana en el mismo tick del click (evita popup blocker)
  const printWin = window.open('', '_blank');
  if (!printWin) {
    alert('Tu navegador bloqueó la ventana de impresión.\nPermití ventanas emergentes para este sitio e intentá de nuevo.');
    return;
  }
  printWin.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Preparando…</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#e8e3d8;color:#444;}</style>
    </head><body><p>Preparando impresión…</p></body></html>`);
  printWin.document.close();

  // Dibujar todas las celdas en el canvas
  function drawAllCells(done) {
    let pending = 0;
    const totalCells = cols * rows;

    for (let i = 0; i < totalCells; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = mPx + col * (cellW + gPx);
      const y   = mPx + row * (cellH + gPx);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, cellW, cellH);

      if (state.showBorders) {
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth   = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      }

      // Celda fuera del nup útil → fondo neutro
      if (i >= state.nup) {
        ctx.fillStyle = '#f0ece4';
        ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
        continue;
      }

      const slot = state.slots[i];
      if (!slot) {
        ctx.fillStyle = '#f8f8f8';
        ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
        continue;
      }

      pending++;
      const img = new Image();
      (function capture(imgEl, cx, cy, cw, ch, idx) {
        imgEl.onload = function() {
          const imgAR  = imgEl.naturalWidth / imgEl.naturalHeight;
          const cellAR = cw / ch;
          let dw, dh;
          if (imgAR > cellAR) { dw = cw; dh = cw / imgAR; }
          else                { dh = ch; dw = ch * imgAR;  }
          ctx.drawImage(imgEl, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);

          if (state.showNumbers) {
            const fs = Math.max(6, Math.round(5 * MM2PX / 3.78));
            ctx.font = `${fs}px monospace`;
            ctx.fillStyle = '#bbbbbb';
            ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
            ctx.fillText(String(idx + 1), cx + cw - 3, cy + ch - 3);
          }
          pending--;
          if (pending === 0) done();
        };
        imgEl.onerror = function() { pending--; if (pending === 0) done(); };
        imgEl.src = slot.imageDataUrl;
      })(img, x, y, cellW, cellH, i);
    }
    if (pending === 0) done();
  }

  drawAllCells(function() {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.93);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Imprimir — PrintNUp</title>
<style>
  @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${pageW}mm; height:${pageH}mm; background:#fff;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  img.sheet-img { display:block; width:${pageW}mm; height:${pageH}mm; }
  @media screen {
    html,body { width:100%; height:auto; min-height:100vh; background:#e8e3d8;
      display:flex; flex-direction:column; align-items:center; padding:16px; gap:16px; }
    img.sheet-img { width:auto; height:auto; max-width:100%; max-height:75vh;
      box-shadow:0 4px 24px rgba(0,0,0,0.22); }
    .info { font-family:system-ui,sans-serif; font-size:13px; color:#666; text-align:center; }
    .print-btn { padding:12px 36px; background:#c23a08; color:#fff; border:none;
      border-radius:6px; font-size:15px; font-weight:700; cursor:pointer;
      font-family:system-ui,sans-serif; }
  }
  @media print {
    .info,.print-btn { display:none!important; }
    img.sheet-img { width:${pageW}mm!important; height:${pageH}mm!important; }
  }
</style>
</head>
<body>
  <p class="info">Vista previa lista. Tocá Imprimir para continuar.</p>
  <img class="sheet-img" src="${dataUrl}" alt="Hoja A4">
  <button class="print-btn" onclick="window.print()">⎙ Imprimir</button>
  <script>
    if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      setTimeout(function(){ window.print(); }, 300);
    }
  <\/script>
</body>
</html>`;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  });
}


/* ── Utilidades ── */
function showLoading(v) { dom.loadingOverlay.style.display = v ? 'flex' : 'none'; }

/* ── Arranque ── */
document.addEventListener('DOMContentLoaded', init);
