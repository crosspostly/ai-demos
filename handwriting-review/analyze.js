/* Разбор почерка на клиенте: фото не покидает браузер.
   Считаем три вещи, которые видно на картинке: строки, высоту букв, наклон.
   Возвращает метрики 0..100 и рисует разметку поверх фото. */
(function (global) {
  'use strict';

  const MAX_W = 900;          // рабочая ширина
  const INK_K = 30;           // порог «чернила» над локальным фоном

  function toCanvas(img, maxW) {
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  function gray(canvas) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return { g, w, h };
  }

  // локальный фон: усреднение по блокам, потом билинейно
  function background(g, w, h, cell) {
    const bw = Math.ceil(w / cell), bh = Math.ceil(h / cell);
    const bg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let s = 0, n = 0;
        for (let y = by * cell; y < Math.min(h, (by + 1) * cell); y += 2) {
          for (let x = bx * cell; x < Math.min(w, (bx + 1) * cell); x += 2) {
            s += g[y * w + x]; n++;
          }
        }
        bg[by * bw + bx] = s / Math.max(1, n);
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(bh - 1.001, y / cell), y0 = Math.floor(fy), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(bw - 1.001, x / cell), x0 = Math.floor(fx), tx = fx - x0;
        const a = bg[y0 * bw + x0], b = bg[y0 * bw + Math.min(bw - 1, x0 + 1)];
        const c2 = bg[Math.min(bh - 1, y0 + 1) * bw + x0], d2 = bg[Math.min(bh - 1, y0 + 1) * bw + Math.min(bw - 1, x0 + 1)];
        out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d2 * tx) * ty;
      }
    }
    return out;
  }

  function inkMask(g, w, h) {
    const cell = Math.max(12, Math.round(Math.min(w, h) / 24));
    const bg = background(g, w, h, cell);
    const m = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) m[i] = (bg[i] - g[i] > INK_K) ? 1 : 0;
    // убрать линии тетради: длинные горизонтальные и вертикальные протяжки
    const minRunX = Math.round(w * 0.35), minRunY = Math.round(h * 0.35);
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x <= w; x++) {
        const on = x < w && m[y * w + x];
        if (on) run++;
        else { if (run >= minRunX) for (let k = x - run; k < x; k++) m[y * w + k] = 0; run = 0; }
      }
    }
    for (let x = 0; x < w; x++) {
      let run = 0;
      for (let y = 0; y <= h; y++) {
        const on = y < h && m[y * w + x];
        if (on) run++;
        else { if (run >= minRunY) for (let k = y - run; k < y; k++) m[k * w + x] = 0; run = 0; }
      }
    }

    // убрать одиночный шум
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        const n = m[i - 1] + m[i + 1] + m[i - w] + m[i + w];
        if (n >= 2) out[i] = 1;
      }
    }
    return out;
  }

  function components(mask, w, h) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const comps = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      let sp = 0; stack[sp++] = i; seen[i] = 1;
      let minx = w, maxx = 0, miny = h, maxy = 0, n = 0, sx = 0, sy = 0;
      while (sp) {
        const p = stack[--sp], px = p % w, py = (p - px) / w;
        n++; sx += px; sy += py;
        if (px < minx) minx = px; if (px > maxx) maxx = px;
        if (py < miny) miny = py; if (py > maxy) maxy = py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
      if (n >= 12) comps.push({ minx, maxx, miny, maxy, n, cx: sx / n, cy: sy / n,
                                w: maxx - minx + 1, h: maxy - miny + 1 });
    }
    return comps;
  }

  function rowsFrom(mask, w, h) {
    const proj = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = 0; x < w; x++) s += mask[y * w + x];
      proj[y] = s;
    }
    // сглаживаем проекцию, чтобы не рвать строку на куски
    const sm = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let s2 = 0, n = 0;
      for (let k = -2; k <= 2; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) { s2 += proj[yy]; n++; }
      }
      sm[y] = s2 / n;
    }
    const thr = Math.max(3, Math.round(w * 0.006));
    let rows = [];
    let start = -1;
    for (let y = 0; y < h; y++) {
      const on = sm[y] > thr;
      if (on && start < 0) start = y;
      if (!on && start >= 0) { rows.push({ top: start, bottom: y - 1 }); start = -1; }
    }
    if (start >= 0) rows.push({ top: start, bottom: h - 1 });
    rows = rows.filter(r => r.bottom - r.top >= 7);
    // склеиваем строки, разделённые маленьким зазором (выносные элементы)
    const med = rows.length ? rows.map(r => r.bottom - r.top).sort((a, b) => a - b)[Math.floor(rows.length / 2)] : 20;
    const merged = [];
    for (const r of rows) {
      const last = merged[merged.length - 1];
      if (last && r.top - last.bottom <= Math.max(1, med * 0.05)) last.bottom = r.bottom;
      else merged.push({ ...r });
    }
    return merged;
  }

  function rowsFromComps(comps, medH) {
    const use = comps.filter(c => c.h >= medH * 0.3 && c.h <= medH * 3.2 && c.n >= 15)
                     .sort((a, b) => a.cy - b.cy);
    if (!use.length) return [];
    const rows = [];
    let cur = { top: use[0].miny, bottom: use[0].maxy, cy: use[0].cy, items: [use[0]] };
    for (let i = 1; i < use.length; i++) {
      const c = use[i];
      if (c.cy - cur.cy > medH * 1.25) { rows.push(cur); cur = { top: c.miny, bottom: c.maxy, cy: c.cy, items: [c] }; }
      else {
        cur.items.push(c);
        cur.top = Math.min(cur.top, c.miny); cur.bottom = Math.max(cur.bottom, c.maxy);
        cur.cy = (cur.cy * (cur.items.length - 1) + c.cy) / cur.items.length;
      }
    }
    rows.push(cur);
    return rows.filter(r => r.items.length >= 5).map(r => ({ top: r.top, bottom: r.bottom }));
  }

  function fitBaseline(mask, w, row) {
    const pts = [];
    for (let x = 0; x < w; x++) {
      let yb = -1;
      for (let y = row.bottom; y >= row.top; y--) {
        if (mask[y * w + x]) { yb = y; break; }
      }
      if (yb >= 0) pts.push([x, yb]);
    }
    if (pts.length < 20) return null;
    // робастная прямая: две итерации с отбрасыванием выбросов
    let a = 0, b = 0;
    let use = pts;
    for (let it = 0; it < 2; it++) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
      for (const [x, y] of use) { sx += x; sy += y; sxx += x * x; sxy += x * y; n++; }
      const den = n * sxx - sx * sx;
      if (!den) return null;
      a = (n * sxy - sx * sy) / den; b = (sy - a * sx) / n;
      const res = use.map(([x, y]) => Math.abs(y - (a * x + b)));
      const med = res.slice().sort((p, q) => p - q)[Math.floor(res.length / 2)] || 1;
      use = pts.filter(([x, y], i) => res[i] <= Math.max(2.5, med * 2.2));
      if (use.length < 20) break;
    }
    let sse = 0;
    for (const [x, y] of use) { const d = y - (a * x + b); sse += d * d; }
    return { a, b, rmse: Math.sqrt(sse / Math.max(1, use.length)), n: use.length };
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function coefficient(arr) {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (!mean) return 0;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    return sd / mean;
  }

  function rowComponents(comps, row) {
    const pad = Math.max(2, (row.bottom - row.top) * 0.35);
    return comps.filter(c => c.cy >= row.top - pad && c.cy <= row.bottom + pad)
      .sort((a, b) => a.minx - b.minx);
  }

  function analyse(img) {
    const canvas = toCanvas(img, MAX_W);
    const { g, w, h } = gray(canvas);
    const mask = inkMask(g, w, h);
    const comps = components(mask, w, h);
    const heightsAll = comps.map(c => c.h).filter(v => v >= 6);
    const medAll = median(heightsAll);
    const rows = rowsFromComps(comps, medAll);

    // высоты строчных: берём компоненты средней высоты (не выносные, не точки)
    const heights = comps.map(c => c.h).filter(v => v >= 6);
    const medH = median(heights);
    const core = comps.filter(c => c.h >= medH * 0.45 && c.h <= medH * 1.8 && c.n >= 20);
    const coreH = core.map(c => c.h);
    const meanH = coreH.reduce((a, b) => a + b, 0) / Math.max(1, coreH.length);
    const sdH = Math.sqrt(coreH.reduce((a, b) => a + (b - meanH) ** 2, 0) / Math.max(1, coreH.length));
    const cvH = meanH ? sdH / meanH : 0;

    // наклон: PCA главной оси у вытянутых компонент
    const angles = [];
    for (const c of core) {
      if (c.h / c.w < 1.6) continue;
      // угол по диагонали рамки: устойчивее, чем PCA по пикселям
      const ang = Math.atan2(c.h - 1, (c.w - 1) * Math.sign(1)) * 180 / Math.PI;
      angles.push(90 - ang); // 0 = строго вертикально
    }
    const slant = median(angles);
    const slantDev = median(angles.map(a => Math.abs(a - slant)));

    // строки
    const lines = [];
    for (const r of rows) {
      const fit = fitBaseline(mask, w, r);
      if (!fit) continue;
      lines.push({ ...r, ...fit });
    }
    // склеиваем линии, чьи базовые линии почти совпадают
    const mergedLines = [];
    for (const l of lines.sort((a, b) => a.b - b.b)) {
      const last = mergedLines[mergedLines.length - 1];
      if (last && Math.abs(l.b - last.b) < (meanH || 20) * 0.55) {
        if (l.n > last.n) { mergedLines[mergedLines.length - 1] = l; }
        continue;
      }
      mergedLines.push(l);
    }
    lines.length = 0; lines.push(...mergedLines);

    const wobble = lines.length ? median(lines.map(l => l.rmse)) : 0;
    const wobbleXh = meanH ? wobble / meanH : 0;

    // Дополнительные метрики — геометрические эвристики по тому же снимку.
    // Они не являются распознаванием букв, клинической оценкой или измерением силы нажима.
    const rowGaps = [];
    const rowHeights = [];
    for (const row of lines) {
      const rc = rowComponents(core, row);
      rowHeights.push(row.bottom - row.top);
      for (let i = 1; i < rc.length; i++) {
        const gap = rc[i].minx - rc[i - 1].maxx;
        if (gap > Math.max(2, meanH * 0.35) && gap < meanH * 5) rowGaps.push(gap);
      }
    }
    const gapCv = coefficient(rowGaps);
    const lineGapValues = [];
    for (let i = 1; i < lines.length; i++) lineGapValues.push(lines[i].b - lines[i - 1].b);
    const lineGapCv = coefficient(lineGapValues);
    const fillValues = core.map(c => c.n / Math.max(1, c.w * c.h));
    const fillCv = coefficient(fillValues);
    const shapeValues = core.map(c => c.w / Math.max(1, c.h));
    const shapeCv = coefficient(shapeValues);

    const sParallel = Math.max(0, Math.min(100, 100 - Math.max(0, slantDev - 1.5) * 7.2));
    const sSpacing = Math.max(0, Math.min(100, 100 - Math.max(0, gapCv - 0.22) * 85));
    const sLines = Math.max(0, Math.min(100, 100 - Math.max(0, lineGapCv - 0.08) * 170));
    const sPressure = Math.max(0, Math.min(100, 100 - Math.max(0, fillCv - 0.2) * 125));
    const sGlyphs = Math.max(0, Math.min(100, 100 - Math.max(0, shapeCv - 0.3) * 110));
    const sClarity = Math.max(0, Math.min(100, sGlyphs * 0.55 + sPressure * 0.25 + (100 - Math.min(100, wobbleXh * 300)) * 0.2));

    // счёт 0..100
    const sHeight = Math.max(0, Math.min(100, 100 - Math.max(0, cvH - 0.18) * 160));
    const sSlant = Math.max(0, Math.min(100, 100 - Math.max(0, slantDev - 1.5) * 6.5));
    const sLine = Math.max(0, Math.min(100, 100 - Math.max(0, wobbleXh - 0.08) * 110));
    const score = Math.round((sHeight * 0.18 + sSlant * 0.14 + sParallel * 0.10 + sGlyphs * 0.10 + sLine * 0.16 + sSpacing * 0.10 + sLines * 0.08 + sPressure * 0.06 + sClarity * 0.08));

    // выбросы по высоте — их и обводим
    const outliers = core.filter(c => c.h < meanH * 0.6 || c.h > meanH * 1.55).slice(0, 24);

    return {
      canvas, comps, core, lines, outliers, score, rowsRaw: rows.length,
      metrics: {
        height: { score: Math.round(sHeight), cv: cvH, mean: meanH },
        slant: { score: Math.round(sSlant), deg: slant, dev: slantDev },
        parallel: { score: Math.round(sParallel), dev: slantDev },
        glyphs: { score: Math.round(sGlyphs), cv: shapeCv },
        line: { score: Math.round(sLine), rmse: wobble, xh: wobbleXh },
        spacing: { score: Math.round(sSpacing), cv: gapCv, n: rowGaps.length },
        lines: { score: Math.round(sLines), cv: lineGapCv, median: median(lineGapValues) },
        pressure: { score: Math.round(sPressure), cv: fillCv },
        clarity: { score: Math.round(sClarity), cv: shapeCv },
        rows: lines.length
      }
    };
  }

  function draw(res, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(res.canvas, 0, 0);
    const W = res.canvas.width, H = res.canvas.height;
    ctx.font = '13px -apple-system, Arial, sans-serif';
    ctx.lineWidth = 2;

    const xh = res.metrics.height.mean || 20;

    // строки: базовая линия и «коридор» высоты строчных
    for (const l of res.lines) {
      const off = 3;              // линия под буквами, а не по ним
      const y0 = l.b + off, y1 = l.a * W + l.b + off;
      // коридор
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(60,160,135,.55)';
      ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.moveTo(0, y0 - xh); ctx.lineTo(W, y1 - xh); ctx.stroke();
      ctx.setLineDash([]);
      // базовая линия: белая подложка, чтобы было видно поверх линовки тетради
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y1); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(20,105,85,.8)';
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y1); ctx.stroke();
      // точка увода
      ctx.fillStyle = 'rgba(31,111,92,.95)';
      ctx.beginPath(); ctx.arc(W - 6, y1, 3, 0, 7); ctx.fill();
    }

    // наклон: параллельные направляющие через весь текст
    if (res.lines.length) {
      const top = res.lines[0].b, bottom = res.lines[res.lines.length - 1].b;
      const mid = (top + bottom) / 2;
      const ang = (res.metrics.slant.deg || 0) * Math.PI / 180;
      const dx = Math.tan(ang);
      ctx.strokeStyle = 'rgba(40,90,180,.9)';
      ctx.setLineDash([9, 7]);
      ctx.lineWidth = 2.5;
      for (let k = -2; k <= 2; k++) {
        const x = W * 0.12 + k * W * 0.19;
        ctx.beginPath();
        ctx.moveTo(x, mid - (H * 0.33) - dx * (x - W / 2));
        ctx.lineTo(x, mid + (H * 0.33) - dx * (x - W / 2));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(40,90,180,.95)';
      ctx.fillText('наклон ' + Math.round(res.metrics.slant.deg) + '°', 8, H - 10);
    }
    return canvas;
  }

  global.HandwritingAnalyzer = { analyse, draw };
})(window);
