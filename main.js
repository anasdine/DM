/* CODE1236 — DM Surfaces SA (démo)
   Séquence d'images pilotée par le scroll sur un canvas plein écran. */
(() => {
  'use strict';

  // --- Configuration --------------------------------------------------------
  const FRAME_COUNT = 193;   // nombre d'images dans frames/
  const SOLID_FRAME = 90;    // pièce face caméra, juste avant le métal liquide
  const DIR = 'frames/';
  const LERP = 0.08;         // lissage du scroll (coupé si prefers-reduced-motion)
  const BATCH = 14;          // taille des lots de préchargement

  // Progression du scroll → progression vidéo, par segments linéaires.
  // 0-10 % : quasi immobile (noir, trait de lumière). 10-60 % : rotation.
  // 60-85 % : métal liquide. 85-100 % : liquide à l'envers, la pièce renaît.
  const B = (SOLID_FRAME - 1) / (FRAME_COUNT - 1);
  const MAP = [
    [0.00, 0.00],
    [0.10, 0.03],
    [0.60, B],
    [0.655, B],
    [0.85, 1.00],
    [1.00, B],
  ];

  const doc = document.documentElement;
  const canvas = document.getElementById('film');
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobileLayout = matchMedia('(max-width: 860px)');

  // --- Apparition des blocs de texte au passage du centre de l'écran --------
  // Sur mobile, les blocs vivent dans le bas de l'écran : bande élargie.
  // Un balayage complémentaire couvre les sauts de scroll (restauration de
  // position, PageDown), qui peuvent enjamber la bande sans la croiser.
  const blocks = Array.from(document.querySelectorAll('.block'));
  const pending = new Set(blocks);
  let io = null;

  function markIn(b) {
    b.classList.add('in');
    pending.delete(b);
    if (io) io.unobserve(b);
  }

  function initIO() {
    if (io) io.disconnect();
    io = null;
    if (!('IntersectionObserver' in window)) { blocks.forEach(markIn); return; }
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) markIn(e.target);
    }, { rootMargin: mobileLayout.matches ? '-35% 0px -18% 0px' : '-42% 0px -42% 0px' });
    pending.forEach((b) => io.observe(b));
  }

  function sweepPassedBlocks() {
    if (!pending.size) return;
    const limit = window.innerHeight * 0.5;
    for (const b of Array.from(pending)) {
      if (b.getBoundingClientRect().top < limit) markIn(b);
    }
  }

  initIO();
  setTimeout(sweepPassedBlocks, 600);

  // --- Jauge « croissance » --------------------------------------------------
  const gaugeFill = document.getElementById('gaugeFill');
  const gaugeValue = document.getElementById('gaugeValue');
  const veilEnd = document.getElementById('veilEnd');
  let gaugePct = -1;

  function scrollProgress() {
    const el = document.scrollingElement || doc;
    const max = el.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
  }

  function updateChrome(p) {
    const axis = mobileLayout.matches ? 'scaleX(' : 'scaleY(';
    gaugeFill.style.transform = axis + p.toFixed(4) + ')';
    const pct = Math.round(p * 100);
    if (pct !== gaugePct) {
      gaugePct = pct;
      gaugeValue.textContent = pct + ' %';
    }
    document.body.classList.toggle('scrolled', p > 0.03);
    if (veilEnd) {
      veilEnd.style.opacity = Math.min(1, Math.max(0, (p - 0.86) / 0.11)).toFixed(3);
    }
  }

  // --- Canvas indisponible : fond fixe (CSS) et tout le texte visible -------
  if (!ctx) {
    doc.classList.add('no-canvas');
    blocks.forEach((b) => b.classList.add('in'));
    addEventListener('scroll', () => updateChrome(scrollProgress()), { passive: true });
    updateChrome(scrollProgress());
    return;
  }

  // --- État ------------------------------------------------------------------
  const imgs = new Array(FRAME_COUNT).fill(null);
  let ext = 'webp';
  let loadedCount = 0;
  let target = scrollProgress();
  let current = target;   // pas d'effet de rattrapage au chargement
  let drawnIdx = -1;      // image de base réellement dessinée
  let drawnKey = -1;      // clé image + fraction de fondu, évite les redessins inutiles
  let fastMove = false;   // défilement rapide : un seul blit, le fondu serait invisible
  let dprCap = 2;         // abaissé automatiquement si la machine ne tient pas la cadence
  let perfAcc = 0, perfN = 0;
  let rafId = 0;
  let lastTick = 0;
  let cw = 0, ch = 0;

  const loader = document.getElementById('loader');
  const loaderPct = document.getElementById('loaderPct');

  const src = (i) => DIR + 'f_' + String(i + 1).padStart(4, '0') + '.' + ext;

  function webpSupport() {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img.width === 1);
      img.onerror = () => res(false);
      img.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
    });
  }

  // --- Correspondance scroll → image -----------------------------------------
  function mapProgress(p) {
    for (let k = 1; k < MAP.length; k++) {
      if (p <= MAP[k][0] || k === MAP.length - 1) {
        const p0 = MAP[k - 1][0], v0 = MAP[k - 1][1];
        const p1 = MAP[k][0], v1 = MAP[k][1];
        const t = p1 > p0 ? Math.min(1, Math.max(0, (p - p0) / (p1 - p0))) : 1;
        return v0 + (v1 - v0) * t;
      }
    }
    return 0;
  }

  const frameAt = (p) =>
    Math.min(FRAME_COUNT - 1, Math.max(0, Math.round(mapProgress(p) * (FRAME_COUNT - 1))));

  function nearestIdx(i) {
    if (imgs[i]) return i;
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && imgs[i - d]) return i - d;
      if (i + d < FRAME_COUNT && imgs[i + d]) return i + d;
    }
    return -1;
  }

  // --- Dessin ------------------------------------------------------------------
  // Paysage : « cover », point d'intérêt décalé à droite sur desktop pour que
  // le cadran reste dégagé du texte. Portrait : le cadran occupe une bande en
  // haut de l'écran, bords fondus au noir (le fond de la vidéo est noir).
  function drawParams(img) {
    const vw = img.naturalWidth, vh = img.naturalHeight;
    if (mobileLayout.matches && ch > cw) {
      let s = (ch * 0.45) / vh;
      if (vw * s < cw) s = cw / vw;
      const dw = vw * s, dh = vh * s;
      return { dx: (cw - dw) / 2, dy: ch * 0.07, dw, dh, band: true };
    }
    const s0 = Math.max(cw / vw, ch / vh);
    const fx = mobileLayout.matches ? 0.5 : 0.65;
    let s = s0;
    if (!mobileLayout.matches) {
      const need = (2 * Math.max(fx, 1 - fx) * cw) / vw;
      s = Math.min(Math.max(s0, need), s0 * 1.1);
    }
    const dw = vw * s, dh = vh * s;
    const dx = Math.min(0, Math.max(cw - dw, fx * cw - dw / 2));
    return { dx, dy: (ch - dh) / 2, dw, dh, band: false };
  }

  function edgeFade(dx, dy, dw, dh) {
    if (dy > -1) {
      const F = Math.max(24, dh * 0.12);
      const g = ctx.createLinearGradient(0, dy, 0, dy + F);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(dx, dy, dw, F);
    }
    const yb = dy + dh;
    if (yb < ch + 1) {
      const F = Math.max(48, dh * 0.3);
      const g = ctx.createLinearGradient(0, yb - F, 0, yb);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g;
      ctx.fillRect(dx, yb - F, dw, F);
    }
  }

  // Le pas entre deux images (~45 px de scroll) serait visible tel quel :
  // on dessine l'image inférieure puis la suivante en fondu (globalAlpha),
  // pour une progression continue entre les 193 images.
  function render(force) {
    const pos = mapProgress(current) * (FRAME_COUNT - 1);
    let i0 = Math.min(FRAME_COUNT - 1, Math.floor(pos));
    const frac = pos - i0;
    let a = imgs[i0] ? i0 : nearestIdx(Math.round(pos));
    if (a < 0) return;
    const b = (!fastMove && a === i0 && frac > 0.01 && i0 + 1 < FRAME_COUNT && imgs[i0 + 1]) ? i0 + 1 : -1;
    const key = a * 40 + (b >= 0 ? Math.round(frac * 32) : 36);
    if (!force && key === drawnKey) return;
    drawnKey = key;
    drawnIdx = a;
    const img = imgs[a];
    const { dx, dy, dw, dh, band } = drawParams(img);
    if (band || dx > 0 || dy > 0 || dx + dw < cw || dy + dh < ch) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(img, dx, dy, dw, dh);
    if (b >= 0) {
      ctx.globalAlpha = frac;
      ctx.drawImage(imgs[b], dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }
    if (band) edgeFade(dx, dy, dw, dh);
  }

  function resize() {
    // 2 max : au-delà, le surcoût de peinture se paie en fluidité alors que
    // la source (vidéo 1920 px) n'apporte plus de détail supplémentaire.
    const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
    cw = window.innerWidth;
    ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    render(true);
    updateChrome(target);
  }

  // --- Boucle : lissage par interpolation --------------------------------------
  function tick(now) {
    rafId = 0;
    const dt = Math.min(64, now - (lastTick || now));
    lastTick = now;
    if (reduceMotion.matches) {
      current = target;
    } else {
      const k = 1 - Math.pow(1 - LERP, dt / 16.67);
      current += (target - current) * k;
      if (Math.abs(target - current) < 0.0004) current = target;
    }
    fastMove = Math.abs(target - current) > 0.004;
    render(false);
    // Si la cadence s'effondre pendant le mouvement (machine faible),
    // on abaisse la résolution du canvas plutôt que de saccader.
    if (current !== target && dt < 60) {
      perfAcc += dt; perfN++;
      if (perfN >= 48) {
        if (perfAcc / perfN > 22 && dprCap > 1 && (window.devicePixelRatio || 1) > dprCap - 0.5) {
          dprCap -= 0.5;
          resize();
        }
        perfAcc = 0; perfN = 0;
      }
    }
    if (current !== target) schedule();
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  // --- Préchargement par lots ---------------------------------------------------
  function loadOrder() {
    const order = [];
    const seen = new Uint8Array(FRAME_COUNT);
    const push = (i) => {
      if (i >= 0 && i < FRAME_COUNT && !seen[i]) { seen[i] = 1; order.push(i); }
    };
    push(frameAt(target));
    push(0);
    push(SOLID_FRAME - 1);
    push(FRAME_COUNT - 1);
    for (const step of [16, 8]) {
      for (let i = 0; i < FRAME_COUNT; i += step) push(i);
    }
    for (let i = 0; i < FRAME_COUNT; i++) push(i); // puis densité complète, du début vers la fin
    return order;
  }

  function loadFrame(i) {
    return new Promise((res) => {
      const img = new Image();
      img.decoding = 'async';
      const done = (ok) => { if (ok) imgs[i] = img; res(ok); };
      img.onload = () => {
        if (img.decode) img.decode().then(() => done(true), () => done(true));
        else done(true);
      };
      img.onerror = () => done(false);
      img.src = src(i);
    }).then((ok) => {
      loadedCount++;
      loaderPct.textContent = String(Math.round((loadedCount / FRAME_COUNT) * 100));
      if (loadedCount >= FRAME_COUNT) loader.classList.add('done');
      if (ok) {
        const want = frameAt(current);
        if (drawnIdx < 0 || Math.abs(i - want) < Math.abs(drawnIdx - want)) render(true);
      }
      return ok;
    });
  }

  async function preload() {
    const order = loadOrder();
    await loadFrame(order[0]);          // la première image s'affiche tout de suite
    for (let i = 1; i < order.length; i += BATCH) {
      await Promise.all(order.slice(i, i + BATCH).map(loadFrame));
    }
  }

  // --- Événements et démarrage ---------------------------------------------------
  addEventListener('scroll', () => {
    target = scrollProgress();
    updateChrome(target);
    sweepPassedBlocks();
    schedule();
  }, { passive: true });

  addEventListener('resize', resize);
  if (mobileLayout.addEventListener) {
    mobileLayout.addEventListener('change', () => { initIO(); resize(); });
  }

  (async () => {
    ext = (await webpSupport()) ? 'webp' : 'jpg';
    resize();
    preload();
    schedule();
  })();
})();
