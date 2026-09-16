/**
 * PrintNUp — app.js
 * Lógica principal: carga de archivos, grilla dinámica,
 * detección de orientación automática e impresión.
 *
 * Dependencias: PDF.js (CDN en index.html)
 */

/* ============================================================
   CONFIGURAR PDF.js worker
   ============================================================ */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';


/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const state = {
  nup: 2,                   // páginas por hoja
  orientation: 'auto',      // 'auto' | 'portrait' | 'landscape'
  currentOrientation: 'portrait', // orientación actualmente activa
  showNumbers: false,
  showBorders: true,
  slots: [],                // array de { imageDataUrl, aspectRatio } | null
  pendingSlotIndex: null,   // slot que espera un archivo individual
};


/* ============================================================
   REFERENCIAS DOM
   ============================================================ */
const dom = {
  nupSelector:          document.getElementById('nupSelector'),
  orientationSelector:  document.getElementById('orientationSelector'),
  fileInput:            document.getElementById('fileInput'),
  slotFileInput:        document.getElementById('slotFileInput'),
  btnUpload:            document.getElementById('btnUpload'),
  btnClear:             document.getElementById('btnClear'),
  btnPrint:             document.getElementById('btnPrint'),
  showNumbers:          document.getElementById('showNumbers'),
  showBorders:          document.getElementById('showBorders'),
  sheet:                document.getElementById('sheet'),
  sheetGrid:            document.getElementById('sheetGrid'),
  orientBadge:          document.getElementById('orientBadge'),
  slotCount:            document.getElementById('slotCount'),
  loadingOverlay:       document.getElementById('loadingOverlay'),
  instructions:         document.getElementById('instructions'),
};


/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
function init() {
  // Inicializar slots vacíos
  resetSlots();

  // Eventos de controles
  dom.nupSelector.addEventListener('click', onNupClick);
  dom.orientationSelector.addEventListener('click', onOrientClick);
  dom.btnUpload.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', onFileInputChange);
  dom.slotFileInput.addEventListener('change', onSlotFileInputChange);
  dom.btnClear.addEventListener('click', clearAll);
  dom.btnPrint.addEventListener('click', printSheet);
  dom.showNumbers.addEventListener('change', onToggleNumbers);
  dom.showBorders.addEventListener('change', onToggleBorders);

  // Drag & drop en el body
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', onBodyDrop);

  // Renderizar estado inicial
  render();
}


/* ============================================================
   GESTIÓN DE SLOTS
   ============================================================ */

/** Reinicia el array de slots según el nup actual */
function resetSlots() {
  state.slots = Array(state.nup).fill(null);
}

/** Llena los slots con las imágenes cargadas, preservando los ya existentes */
function fillSlotsWithImages(imageObjects) {
  // Busca slots vacíos y los va llenando
  let imgIndex = 0;
  for (let i = 0; i < state.slots.length && imgIndex < imageObjects.length; i++) {
    if (state.slots[i] === null) {
      state.slots[i] = imageObjects[imgIndex++];
    }
  }
  // Si sobran imágenes, ampliar los slots (siempre mantenemos exactamente `nup` slots)
  // Las imágenes extra se ignoran (ya se distribuyen en el primer ciclo)
}

/** Cambia el número de páginas por hoja preservando imágenes ya cargadas */
function changeNup(newNup) {
  const oldSlots = [...state.slots];
  state.nup = newNup;
  state.slots = Array(newNup).fill(null);
  // Re-distribuir imágenes existentes
  const images = oldSlots.filter(s => s !== null);
  images.forEach((img, i) => {
    if (i < newNup) state.slots[i] = img;
  });
}


/* ============================================================
   CÁLCULO DE ORIENTACIÓN
   ============================================================ */

/**
 * Detecta la mejor orientación según las imágenes cargadas.
 * @returns {'portrait'|'landscape'}
 */
function detectOrientation() {
  const filledSlots = state.slots.filter(s => s !== null);
  if (filledSlots.length === 0) return 'portrait'; // default

  let portraitCount = 0;
  let landscapeCount = 0;

  filledSlots.forEach(slot => {
    if (slot.aspectRatio < 1) portraitCount++;   // alto > ancho
    else if (slot.aspectRatio > 1) landscapeCount++;
    // aspectRatio === 1 → cuadrada, no cuenta
  });

  if (portraitCount === 0 && landscapeCount === 0) return 'portrait';

  if (portraitCount >= landscapeCount) {
    // Predominan verticales → portrait minimiza espacio vacío
    return bestOrientationForLayout('portrait');
  } else {
    // Predominan horizontales → landscape
    return bestOrientationForLayout('landscape');
  }
}

/**
 * Dado un sesgo, elige la orientación que mejor se adapta al layout.
 * Para 2, 3 páginas: la orientación del contenido suele ser óptima.
 * Para 4, 6, 8: la grilla es simétrica, el contenido decide.
 */
function bestOrientationForLayout(bias) {
  // Para NUP = 2 o 3 con imágenes landscape, landscape puede ser mejor
  if (state.nup === 2 && bias === 'landscape') return 'landscape';
  if (state.nup === 3 && bias === 'landscape') return 'landscape';
  return bias;
}

/** Actualiza la orientación activa */
function updateActiveOrientation() {
  if (state.orientation === 'auto') {
    state.currentOrientation = detectOrientation();
  } else {
    state.currentOrientation = state.orientation;
  }
}


/* ============================================================
   CÁLCULO DE LAYOUT DE GRILLA
   ============================================================ */

/**
 * Devuelve { cols, rows } según nup y orientación.
 */
function getGridLayout(nup, orientation) {
  const isLandscape = orientation === 'landscape';
  switch (nup) {
    case 2:  return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    case 3:  return isLandscape ? { cols: 3, rows: 1 } : { cols: 1, rows: 3 };
    case 4:  return { cols: 2, rows: 2 }; // igual en ambas
    case 6:  return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
    case 8:  return isLandscape ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 };
    case 16: return isLandscape ? { cols: 4, rows: 4 } : { cols: 4, rows: 4 }; // 4×4 en ambas
    case 32: return isLandscape ? { cols: 8, rows: 4 } : { cols: 4, rows: 8 };
    default: return { cols: 2, rows: 2 };
  }
}


/* ============================================================
   RENDER PRINCIPAL
   ============================================================ */

function render() {
  updateActiveOrientation();
  renderSheet();
  renderGrid();
  renderIndicator();
  renderPrintCSS();
  toggleInstructions();
}

/** Aplica clases de orientación a la hoja */
function renderSheet() {
  dom.sheet.classList.toggle('landscape', state.currentOrientation === 'landscape');
  dom.sheet.classList.toggle('portrait-mode', state.currentOrientation === 'portrait');
}

/** Genera la grilla de slots */
function renderGrid() {
  const { cols, rows } = getGridLayout(state.nup, state.currentOrientation);
  dom.sheetGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  dom.sheetGrid.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;
  dom.sheetGrid.innerHTML = '';

  for (let i = 0; i < state.nup; i++) {
    const slotEl = createSlotElement(i, state.slots[i]);
    dom.sheetGrid.appendChild(slotEl);
  }
}

/** Crea el elemento DOM para un slot */
function createSlotElement(index, slotData) {
  const slotEl = document.createElement('div');
  slotEl.className = 'slot';
  if (state.showBorders) slotEl.classList.add('has-border');
  slotEl.dataset.index = index;

  if (slotData) {
    // Slot con imagen
    slotEl.classList.add('filled');

    const img = document.createElement('img');
    img.src = slotData.imageDataUrl;
    img.alt = `Página ${index + 1}`;
    img.draggable = false;
    slotEl.appendChild(img);

    // Overlay de acciones
    const actionsEl = document.createElement('div');
    actionsEl.className = 'slot-actions';
    actionsEl.innerHTML = `
      <button class="slot-action-btn replace-btn" data-index="${index}">⇄ Reemplazar</button>
      <button class="slot-action-btn delete-btn" data-index="${index}">✕ Quitar</button>
    `;
    actionsEl.querySelector('.replace-btn').addEventListener('click', () => openSlotFilePicker(index));
    actionsEl.querySelector('.delete-btn').addEventListener('click', () => removeSlotImage(index));
    slotEl.appendChild(actionsEl);

  } else {
    // Slot vacío → botón "+"
    const addBtn = document.createElement('button');
    addBtn.className = 'slot-add-btn';
    addBtn.innerHTML = `<span class="plus-icon">+</span><span>Agregar</span>`;
    addBtn.addEventListener('click', () => openSlotFilePicker(index));
    slotEl.appendChild(addBtn);

    // Drag & drop individual por slot
    slotEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      slotEl.classList.add('drag-over');
    });
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
    slotEl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      slotEl.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) processFilesForSlot([files[0]], index);
    });
  }

  // Numeración opcional
  if (state.showNumbers) {
    const numEl = document.createElement('span');
    numEl.className = 'slot-number';
    numEl.textContent = index + 1;
    slotEl.appendChild(numEl);
  }

  return slotEl;
}

/** Actualiza el indicador de orientación y conteo */
function renderIndicator() {
  const icon = state.currentOrientation === 'landscape' ? '▭' : '▯';
  const name = state.currentOrientation === 'landscape' ? 'Horizontal' : 'Vertical';
  const modeTag = state.orientation === 'auto' ? ' — Auto' : '';
  dom.orientBadge.textContent = `${icon} ${name}${modeTag}`;

  const filled = state.slots.filter(s => s !== null).length;
  dom.slotCount.textContent = `${filled} / ${state.nup} espacios usados`;
}

/** Actualiza variables CSS de impresión */
function renderPrintCSS() {
  // Controla si se muestran números en impresión
  document.documentElement.style.setProperty(
    '--print-numbers',
    state.showNumbers ? 'block' : 'none'
  );
}

/** Muestra u oculta instrucciones */
function toggleInstructions() {
  const hasContent = state.slots.some(s => s !== null);
  dom.instructions.style.display = hasContent ? 'none' : 'flex';
}


/* ============================================================
   PROCESAMIENTO DE ARCHIVOS
   ============================================================ */

/** Evento: input[type=file] general */
async function onFileInputChange(e) {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (!files.length) return;
  await processFiles(files);
}

/** Evento: input[type=file] para slot individual */
async function onSlotFileInputChange(e) {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (!files.length || state.pendingSlotIndex === null) return;
  await processFilesForSlot(files, state.pendingSlotIndex);
  state.pendingSlotIndex = null;
}

/** Drop en el body (fuera de slots) */
async function onBodyDrop(e) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  await processFiles(files);
}

/** Abre el selector de archivo para un slot específico */
function openSlotFilePicker(index) {
  state.pendingSlotIndex = index;
  dom.slotFileInput.click();
}

/**
 * Procesa archivos genéricos y los distribuye en slots vacíos.
 */
async function processFiles(files) {
  showLoading(true);
  try {
    const imageObjects = [];
    for (const file of files) {
      if (file.type === 'application/pdf') {
        const pages = await extractPdfPages(file);
        imageObjects.push(...pages);
      } else if (file.type.startsWith('image/')) {
        const imgObj = await loadImageFile(file);
        imageObjects.push(imgObj);
      }
    }
    fillSlotsWithImages(imageObjects);
    render();
  } catch (err) {
    console.error('Error procesando archivos:', err);
    alert('Hubo un error al procesar los archivos. Verificá que sean PDF o imágenes válidas.');
  } finally {
    showLoading(false);
  }
}

/**
 * Procesa archivos para un slot específico (reemplazar o agregar).
 */
async function processFilesForSlot(files, slotIndex) {
  showLoading(true);
  try {
    const imageObjects = [];
    for (const file of files) {
      if (file.type === 'application/pdf') {
        const pages = await extractPdfPages(file);
        imageObjects.push(...pages);
      } else if (file.type.startsWith('image/')) {
        const imgObj = await loadImageFile(file);
        imageObjects.push(imgObj);
      }
    }
    if (imageObjects.length > 0) {
      state.slots[slotIndex] = imageObjects[0]; // Solo la primera imagen
    }
    render();
  } catch (err) {
    console.error('Error en slot:', err);
    alert('Hubo un error al cargar el archivo.');
  } finally {
    showLoading(false);
  }
}

/**
 * Extrae todas las páginas de un PDF como imágenes.
 * @param {File} file
 * @returns {Promise<Array<{imageDataUrl, aspectRatio}>>}
 */
async function extractPdfPages(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  const scale = 2.0; // resolución para previsualización

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    pages.push({
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.92),
      aspectRatio:  viewport.width / viewport.height,
    });
  }
  return pages;
}

/**
 * Carga una imagen y devuelve { imageDataUrl, aspectRatio }.
 * @param {File} file
 * @returns {Promise<{imageDataUrl, aspectRatio}>}
 */
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const img = new Image();
      img.onload = () => {
        resolve({
          imageDataUrl: dataUrl,
          aspectRatio:  img.naturalWidth / img.naturalHeight,
        });
      };
      img.onerror = reject;
      img.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


/* ============================================================
   ACCIONES SOBRE SLOTS
   ============================================================ */

function removeSlotImage(index) {
  state.slots[index] = null;
  render();
}


/* ============================================================
   HANDLERS DE CONTROLES
   ============================================================ */

function onNupClick(e) {
  const btn = e.target.closest('.nup-btn');
  if (!btn) return;
  const newNup = parseInt(btn.dataset.nup, 10);
  if (newNup === state.nup) return;

  // Actualizar UI del selector
  dom.nupSelector.querySelectorAll('.nup-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  changeNup(newNup);
  render();
}

function onOrientClick(e) {
  const btn = e.target.closest('.orient-btn');
  if (!btn) return;
  const orient = btn.dataset.orient;
  state.orientation = orient;

  dom.orientationSelector.querySelectorAll('.orient-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  render();
}

function onToggleNumbers(e) {
  state.showNumbers = e.target.checked;
  render();
}

function onToggleBorders(e) {
  state.showBorders = e.target.checked;
  render();
}


/* ============================================================
   LIMPIAR TODO
   ============================================================ */

function clearAll() {
  if (!confirm('¿Querés limpiar todos los espacios?')) return;
  resetSlots();
  state.orientation = 'auto';

  // Resetear UI de orientación
  dom.orientationSelector.querySelectorAll('.orient-btn').forEach(b => b.classList.remove('active'));
  dom.orientationSelector.querySelector('[data-orient="auto"]').classList.add('active');

  render();
}


/* ============================================================
   IMPRESIÓN — via Canvas → imagen única → nueva pestaña
   ============================================================
   Por qué este enfoque es el más robusto en mobile:

   1. iframe oculto: en Android Chrome, los iframes con
      visibility:hidden no renderizan imágenes base64 antes
      de print() → hoja en blanco.

   2. window.open + document.write: Chrome mobile puede
      bloquear popups si no están en el mismo tick del click.

   3. SOLUCIÓN: dibujar toda la grilla en un <canvas> en
      memoria → exportar como una sola imagen JPEG → abrir
      en nueva pestaña via Blob URL (permitido en tick de click).
      Una imagen única nunca puede partirse en varias páginas.
   ============================================================ */

function printSheet() {
  const orientation = state.currentOrientation;
  const { cols, rows } = getGridLayout(state.nup, orientation);

  // Dimensiones A4 a 150 dpi para buena calidad
  const DPI   = 150;
  const MM2PX = DPI / 25.4;

  const pageW  = orientation === 'landscape' ? 297 : 210; // mm
  const pageH  = orientation === 'landscape' ? 210 : 297;
  const margin = 6;  // mm
  const gap    = 2;  // mm entre celdas

  const canvasW = Math.round(pageW  * MM2PX);
  const canvasH = Math.round(pageH  * MM2PX);
  const mPx     = Math.round(margin * MM2PX);
  const gPx     = Math.round(gap    * MM2PX);

  const innerW  = canvasW - mPx * 2;
  const innerH  = canvasH - mPx * 2;
  const cellW   = Math.floor((innerW - gPx * (cols - 1)) / cols);
  const cellH   = Math.floor((innerH - gPx * (rows - 1)) / rows);

  const canvas  = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx     = canvas.getContext('2d');

  // Fondo blanco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Dibuja todas las celdas; llama a done() cuando termina
  function drawAllCells(done) {
    let pending = 0;

    for (let i = 0; i < state.nup; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = mPx + col * (cellW + gPx);
      const y   = mPx + row * (cellH + gPx);

      // Fondo blanco de celda
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, cellW, cellH);

      // Borde opcional
      if (state.showBorders) {
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth   = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      }

      const slot = state.slots[i];
      if (!slot) {
        // Celda vacía
        ctx.fillStyle = '#f8f8f8';
        ctx.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
        continue;
      }

      pending++;
      const img = new Image();

      // IIFE para capturar variables por valor en el closure
      (function capture(imgEl, cx, cy, cw, ch, idx) {
        function onLoad() {
          // object-fit: contain manual
          const imgAR  = imgEl.naturalWidth / imgEl.naturalHeight;
          const cellAR = cw / ch;
          let dw, dh, dx, dy;
          if (imgAR > cellAR) {
            dw = cw;
            dh = cw / imgAR;
          } else {
            dh = ch;
            dw = ch * imgAR;
          }
          dx = cx + (cw - dw) / 2;
          dy = cy + (ch - dh) / 2;
          ctx.drawImage(imgEl, dx, dy, dw, dh);

          // Número opcional
          if (state.showNumbers) {
            const fontSize = Math.max(8, Math.round(7 * MM2PX / 3.78));
            ctx.font         = `${fontSize}px monospace`;
            ctx.fillStyle    = '#bbbbbb';
            ctx.textAlign    = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(String(idx + 1), cx + cw - 4, cy + ch - 4);
          }

          pending--;
          if (pending === 0) done();
        }

        imgEl.onload  = onLoad;
        imgEl.onerror = function() { pending--; if (pending === 0) done(); };
        imgEl.src     = slot.imageDataUrl;
      })(img, x, y, cellW, cellH, i);
    }

    // Sin imágenes (todos slots vacíos)
    if (pending === 0) done();
  }

  // Abrir ventana ANTES de cualquier async (mismo tick del click)
  // para que los popup blockers no la cierren
  const printWin = window.open('', '_blank');

  if (!printWin) {
    alert(
      'Tu navegador bloqueó la ventana de impresión.\n' +
      'Permitî las ventanas emergentes para este sitio e intentá de nuevo.'
    );
    return;
  }

  // Mostrar mensaje de espera mientras se procesa el canvas
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Preparando impresión…</title>
    <style>
      body { font-family: system-ui,sans-serif; display:flex;
             align-items:center; justify-content:center;
             height:100vh; margin:0; background:#e8e3d8; color:#444; }
      p { font-size:16px; }
    </style>
    </head><body><p>Preparando impresión…</p></body></html>`);
  printWin.document.close();

  // Procesar canvas de forma asíncrona
  drawAllCells(function() {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.93);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Imprimir</title>
<style>
  @page {
    size: ${pageW}mm ${pageH}mm;
    margin: 0;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width: ${pageW}mm;
    height: ${pageH}mm;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  img.sheet-img {
    display: block;
    width: ${pageW}mm;
    height: ${pageH}mm;
  }
  /* Vista en pantalla (móvil) */
  @media screen {
    html, body {
      width: 100%;
      height: auto;
      min-height: 100vh;
      background: #e8e3d8;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
      gap: 16px;
    }
    img.sheet-img {
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 75vh;
      box-shadow: 0 4px 24px rgba(0,0,0,0.22);
    }
    .info {
      font-family: system-ui, sans-serif;
      font-size: 13px;
      color: #666;
      text-align: center;
    }
    .print-btn {
      padding: 12px 36px;
      background: #d4420a;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      font-family: system-ui, sans-serif;
    }
  }
  @media print {
    .info, .print-btn { display: none !important; }
    img.sheet-img {
      width: ${pageW}mm !important;
      height: ${pageH}mm !important;
    }
  }
</style>
</head>
<body>
  <p class="info">Vista previa lista. Tocá Imprimir para continuar.</p>
  <img class="sheet-img" src="${dataUrl}" alt="Hoja A4">
  <button class="print-btn" onclick="window.print()">⎙ Imprimir</button>
  <script>
    // Desktop: abrir diálogo automáticamente
    if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      setTimeout(function() { window.print(); }, 300);
    }
  </script>
</body>
</html>`;

    // Reemplazar el contenido de la ventana ya abierta
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  });
}


/* ============================================================
   UTILIDADES
   ============================================================ */

function showLoading(visible) {
  dom.loadingOverlay.style.display = visible ? 'flex' : 'none';
}


/* ============================================================
   ARRANQUE
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);
