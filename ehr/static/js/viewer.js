/* In-app document viewer. PDF.js (vendored) draws one page at a time on a canvas sized to its container.
   Images are shown fitted to width. Any failure leaves the text fallback with the download button. */
const root = document.getElementById("ehr-viewer");
if (root) { start(root); }

function start(root) {
  const kind = root.dataset.kind;
  const el = (id) => document.getElementById(id);
  const stage = el("ehr-v-stage"), tools = el("ehr-viewer-tools");
  const fallback = el("ehr-v-fallback"), loading = el("ehr-v-loading");
  const zoomText = el("ehr-v-zoom"), pageText = el("ehr-v-page");
  const prevBtn = el("ehr-v-prev"), nextBtn = el("ehr-v-next");
  const MIN = 0.5, MAX = 4, STEP = 0.25;
  let zoom = 1;

  function fail() {
    if (loading) { loading.hidden = true; }
    if (stage) { stage.hidden = true; }
    if (tools) { tools.hidden = true; }
    if (fallback) { fallback.hidden = false; }
  }
  function setZoom(z, after) {
    zoom = Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
    if (zoomText) { zoomText.textContent = Math.round(zoom * 100) + "%"; }
    after();
  }
  function wireZoom(after) {
    el("ehr-v-in").addEventListener("click", () => setZoom(zoom + STEP, after));
    el("ehr-v-out").addEventListener("click", () => setZoom(zoom - STEP, after));
  }
  function typing(e) {
    const t = e.target && e.target.tagName;
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || e.ctrlKey || e.metaKey || e.altKey;
  }

  if (kind === "image") {
    const img = el("ehr-v-img");
    const apply = () => { img.style.width = (zoom * 100) + "%"; };
    img.addEventListener("error", fail);
    wireZoom(apply);
    tools.hidden = false;
    document.addEventListener("keydown", (e) => {
      if (typing(e)) { return; }
      if (e.key === "+" || e.key === "=") { setZoom(zoom + STEP, apply); }
      else if (e.key === "-") { setZoom(zoom - STEP, apply); }
    });
    return;
  }
  if (kind !== "pdf") { return; }

  fallback.hidden = true;
  loading.hidden = false;
  render_pdf().catch(fail);

  async function render_pdf() {
    const pdfjs = await import(root.dataset.pdfjs);
    pdfjs.GlobalWorkerOptions.workerSrc = root.dataset.worker;
    const pdf = await pdfjs.getDocument({ url: root.dataset.src }).promise;
    const canvas = el("ehr-v-canvas");
    let page = 1, task = null, token = 0;

    async function draw() {
      const mine = ++token;
      const pg = await pdf.getPage(page);
      if (mine !== token) { return; }
      const base = pg.getViewport({ scale: 1 });
      const width = Math.max(stage.clientWidth - 2, 120);
      const scale = (width / base.width) * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale: scale * dpr });
      if (task) { task.cancel(); }
      const off = document.createElement("canvas");  // draw off screen, then swap: no flicker, no half pages
      off.width = Math.floor(vp.width);
      off.height = Math.floor(vp.height);
      task = pg.render({ canvasContext: off.getContext("2d"), viewport: vp });
      try { await task.promise; } catch (e) { return; }  // cancelled by a newer draw
      if (mine !== token) { return; }
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.style.width = Math.floor(vp.width / dpr) + "px";
      canvas.style.height = Math.floor(vp.height / dpr) + "px";
      canvas.getContext("2d").drawImage(off, 0, 0);
      label();
    }
    function label() {
      pageText.textContent = root.dataset.pageText.replace("{n}", String(page)).replace("{total}", String(pdf.numPages));
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= pdf.numPages;
    }
    function go(n) {
      const to = Math.min(pdf.numPages, Math.max(1, n));
      if (to !== page) { page = to; stage.scrollTop = 0; draw(); }
    }

    prevBtn.addEventListener("click", () => go(page - 1));
    nextBtn.addEventListener("click", () => go(page + 1));
    wireZoom(draw);
    document.addEventListener("keydown", (e) => {
      if (typing(e)) { return; }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { go(page - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight" || e.key === "PageDown") { go(page + 1); e.preventDefault(); }
      else if (e.key === "+" || e.key === "=") { setZoom(zoom + STEP, draw); }
      else if (e.key === "-") { setZoom(zoom - STEP, draw); }
    });
    // Redraw when the available width changes (rotation, window resize). Height changes are ignored.
    let lastWidth = stage.clientWidth, timer = null;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (stage.clientWidth !== lastWidth) { lastWidth = stage.clientWidth; draw(); }
      }, 150);
    });

    loading.hidden = true;
    stage.hidden = false;
    tools.hidden = false;
    await draw();
  }
}
