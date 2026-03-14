/**
 * ═══════════════════════════════════════════════════════════
 * INTRADAY INTELLIGENCE DASHBOARD  —  script.js  v3
 * Author: Abdul Basit | Workforce Intelligence Suite
 *
 * Features:
 *   §1  61 intervals  8:00 – 23:00
 *   §2  Week −1 to −5 historical inputs
 *   §3  Bulk vertical paste per column
 *   §4  Excel Ctrl+V tab-separated paste
 *   §5  Arrival Pattern % calculation
 *   §6  Historical Projection  (Daily Forecast × Arrival %)
 *   §7  Run-Rate Projection    (CumActual ÷ HistCompletion %)
 *   §8  Blended Forecast       (weighted early / mid / late)
 *   §9  Deviation % with green / yellow / red badges
 *   §10 Confidence Score       (High / Medium / Low)
 *   §11 Backlog Risk           (Safe / Risk / Critical)
 *   §12 Advanced Spike Detection with acceleration signal
 *   §13 Forecast Accuracy (MAPE-based, end-of-day)
 *   §14 Operational Insights panel (auto-generated)
 *   §15 Executive Narrative + Period Breakdown
 *   §16 Three interactive Chart.js charts
 *   §17 Tooltip system (hover on desktop, tap on mobile)
 *   §18 Debounced recalculation pipeline
 *   §19 Export: Outlook / Gmail / Copy / Download
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────
   §1  INTERVALS
───────────────────────────────────────────────────────── */
function genIntervals(startH, endH) {
  const out = [];
  for (let h = startH; h <= endH; h++) {
    const mins = (h === endH) ? [0] : [0, 15, 30, 45];
    mins.forEach(m => out.push(`${h}:${String(m).padStart(2, '0')}`));
  }
  return out;
}
const INTERVALS = genIntervals(8, 23); // 61 intervals: 8:00 → 23:00
const N = INTERVALS.length;            // 61

/* ─────────────────────────────────────────────────────────
   §2  APPLICATION STATE
───────────────────────────────────────────────────────── */
const state = {
  rows: [],            // [{ days:[n|null ×5], today:n|null }]
  analysis: null,
  dailyForecast: null,
  availableCapacity: null,
};

/* ─────────────────────────────────────────────────────────
   §3  BUILD TABLE (run once on DOMContentLoaded)
───────────────────────────────────────────────────────── */
function buildTable() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  state.rows = [];

  INTERVALS.forEach((interval, i) => {
    const row = { days: [null, null, null, null, null], today: null };
    state.rows.push(row);

    const tr = document.createElement('tr');
    tr.id = `row-${i}`;
    tr.dataset.i = i;

    // ── Interval label (sticky) ──
    const tdLabel = document.createElement('td');
    tdLabel.className = 'td-sticky';
    tdLabel.textContent = interval;
    tr.appendChild(tdLabel);

    // ── Week −1 … −5 inputs ──
    for (let d = 0; d < 5; d++) {
      const td = document.createElement('td');
      td.className = 'td-week';
      const inp = makeNumInput(`w${d}-${i}`, `Week -${d + 1} calls at ${interval}`);
      inp.addEventListener('input', () => {
        row.days[d] = parseFloat(inp.value) || null;
        scheduleRecalc();
      });
      td.appendChild(inp);
      tr.appendChild(td);
    }

    // ── Computed columns ──
    addTd(tr, `ha-${i}`,   'td-hist');    // Hist Avg
    addTd(tr, `arr-${i}`,  'td-arrival'); // Arrival %
    // Today actual input
    const tdToday = document.createElement('td');
    tdToday.className = 'td-today';
    const todayInp = makeNumInput(`t-${i}`, `Today actual at ${interval}`);
    todayInp.addEventListener('input', () => {
      row.today = parseFloat(todayInp.value) || null;
      scheduleRecalc();
    });
    tdToday.appendChild(todayInp);
    tr.appendChild(tdToday);

    addTd(tr, `dev-${i}`,  '');           // Deviation %
    addTd(tr, `cmpl-${i}`, 'td-cmpl');    // Completion %
    addTd(tr, `hp-${i}`,   'td-histp');   // Hist Projection
    addTd(tr, `rr-${i}`,   'td-rr');      // Run-Rate
    addTd(tr, `bl-${i}`,   'td-blended'); // Blended
    addTd(tr, `cf-${i}`,   '');           // Confidence
    addTd(tr, `rem-${i}`,  'td-rem');     // Remaining
    addTd(tr, `blg-${i}`,  '');           // Backlog

    tbody.appendChild(tr);
  });
}

function makeNumInput(id, label) {
  const inp = document.createElement('input');
  inp.type = 'number'; inp.id = id; inp.min = '0'; inp.step = '1';
  inp.setAttribute('aria-label', label);
  return inp;
}
function addTd(tr, id, cls) {
  const td = document.createElement('td');
  td.id = id; if (cls) td.className = cls; td.textContent = '—';
  tr.appendChild(td); return td;
}

/* ─────────────────────────────────────────────────────────
   §4  CORE CALCULATIONS
───────────────────────────────────────────────────────── */

/* Historical average per interval */
function calcHistAvg() {
  return state.rows.map(row => {
    const vals = row.days.filter(v => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
}

/* Arrival Pattern %: each interval's histAvg / total histAvg */
function calcArrivalPattern(histAvgs) {
  const total = histAvgs.reduce((s, v) => s + (v || 0), 0);
  if (!total) return new Array(N).fill(null);
  return histAvgs.map(v => (v !== null ? v / total : null));
}

/* Cumulative historical completion % */
function calcHistCompletion(histAvgs) {
  const total = histAvgs.reduce((s, v) => s + (v || 0), 0);
  if (!total) return new Array(N).fill(null);
  let cum = 0;
  return histAvgs.map(v => { cum += (v || 0); return cum / total; });
}

/* Interval deviation % vs hist avg */
function calcDeviation(histAvgs) {
  return state.rows.map((row, i) => {
    const h = histAvgs[i], t = row.today;
    if (h === null || t === null || h === 0) return null;
    return ((t - h) / h) * 100;
  });
}

/* Cumulative actuals (only up to last entered interval) */
function calcCumActual() {
  let cum = 0;
  return state.rows.map(row => {
    if (row.today !== null) cum += row.today;
    return row.today !== null ? cum : null;
  });
}

/* Cumulative historical */
function calcCumHist(histAvgs) {
  let cum = 0;
  return histAvgs.map(v => { cum += (v || 0); return v !== null ? cum : null; });
}

/* Historical Projection: daily forecast × arrival pattern % */
function calcHistProj(arrivalPct, dailyForecast) {
  if (!dailyForecast) return new Array(N).fill(null);
  return arrivalPct.map(a => (a !== null ? dailyForecast * a : null));
}

/* Run-Rate: cumActual / histCompletion → EOD estimate */
function calcRunRate(cumActual, histCompletion) {
  return cumActual.map((cum, i) => {
    const comp = histCompletion[i];
    if (cum === null || !comp) return null;
    return cum / comp;
  });
}

/* Blended Forecast (dynamic weights by day completion) */
function calcBlended(runRate, histCompletion, dailyForecast) {
  return runRate.map((rr, i) => {
    if (rr === null) return null;
    const comp = histCompletion[i] || 0;
    let wH, wR;
    if      (comp < 0.25) { wH = 0.7; wR = 0.3; }
    else if (comp < 0.60) { wH = 0.5; wR = 0.5; }
    else                  { wH = 0.3; wR = 0.7; }
    return dailyForecast ? (wH * dailyForecast + wR * rr) : rr;
  });
}

/* Remaining = blended EOD − cumActual */
function calcRemaining(blended, cumActual) {
  return blended.map((b, i) => {
    if (b === null || cumActual[i] === null) return null;
    return Math.max(0, Math.round(b - cumActual[i]));
  });
}

/* Confidence Score */
function calcConfidence(devs, histCompletion, blended, dailyForecast) {
  return devs.map((dev, i) => {
    if (dev === null) return null;
    let score = 100;
    const absD = Math.abs(dev);
    if (absD > 10) score -= 40;
    else if (absD > 5) score -= 20;
    const comp = histCompletion[i] || 0;
    if (comp < 0.25) score -= 20;
    else if (comp < 0.50) score -= 10;
    const b = blended[i];
    if (b !== null && dailyForecast) {
      const diff = Math.abs((b - dailyForecast) / dailyForecast) * 100;
      if (diff > 10) score -= 15;
      else if (diff > 5) score -= 8;
    }
    if (score >= 70) return { level: 'high', label: 'High' };
    if (score >= 45) return { level: 'med',  label: 'Medium' };
    return               { level: 'low',  label: 'Low' };
  });
}

/* Backlog Risk */
function calcBacklog(remaining, histCompletion, availCap) {
  return remaining.map((rem, i) => {
    if (rem === null) return null;
    if (!availCap) return { status: 'safe', label: 'Safe' };
    const comp = histCompletion[i] || 0;
    const remCap = availCap * (1 - comp);
    if (remCap <= 0) return { status: 'safe', label: 'Safe' };
    const diff = rem - remCap;
    if (diff <= 0) return { status: 'safe', label: 'Safe' };
    if (diff / remCap <= 0.10) return { status: 'risk', label: 'Risk' };
    return { status: 'crit', label: 'Critical' };
  });
}

/* ─────────────────────────────────────────────────────────
   §12  ADVANCED SPIKE DETECTION
   Uses two signals:
     1. Deviation from historical average  (% diff)
     2. Traffic acceleration  (current actual − previous actual)
───────────────────────────────────────────────────────── */
function calcSpikeStatus(histAvgs) {
  /*
   * Returns an array of spike objects per interval:
   *   { level: 'none' | 'warn' | 'detect', accel: number }
   *
   * Logic:
   *   Normal      — deviation within ±5%
   *   Early Warn  — deviation 5–10% AND positive acceleration for ≥2 consecutive intervals
   *   Spike       — deviation > 10% AND positive acceleration
   */
  const result = new Array(N).fill(null).map(() => ({ level: 'none', accel: 0 }));
  let consecutivePositiveAccel = 0;

  for (let i = 0; i < N; i++) {
    const today   = state.rows[i].today;
    const hist    = histAvgs[i];
    if (today === null || hist === null || hist === 0) {
      consecutivePositiveAccel = 0;
      continue;
    }

    const dev   = ((today - hist) / hist) * 100;
    const prev  = i > 0 ? state.rows[i - 1].today : null;
    const accel = (prev !== null) ? today - prev : 0;

    if (accel > 0) consecutivePositiveAccel++;
    else           consecutivePositiveAccel = 0;

    let level = 'none';
    const absD = Math.abs(dev);

    if (dev > 10 && accel > 0) {
      level = 'detect';
    } else if (dev > 5 && dev <= 10 && consecutivePositiveAccel >= 2) {
      level = 'warn';
    }

    result[i] = { level, accel, dev };
  }
  return result;
}

/* Summarise overall spike state (worst seen in last 4 intervals of data) */
function summariseSpike(spikeArr) {
  let lastDataIdx = -1;
  for (let i = N - 1; i >= 0; i--) {
    if (state.rows[i].today !== null) { lastDataIdx = i; break; }
  }
  if (lastDataIdx < 0) return { level: 'none', idx: -1 };

  // Look at a window of up to 4 intervals ending at last data point
  const windowStart = Math.max(0, lastDataIdx - 3);
  let worst = 'none', worstIdx = -1;
  for (let i = windowStart; i <= lastDataIdx; i++) {
    const sp = spikeArr[i];
    if (!sp) continue;
    if (sp.level === 'detect')                      { worst = 'detect'; worstIdx = i; break; }
    if (sp.level === 'warn' && worst !== 'detect')  { worst = 'warn';   worstIdx = i; }
  }
  return { level: worst, idx: worstIdx };
}

/* ─────────────────────────────────────────────────────────
   §13  FORECAST ACCURACY  (MAPE-based)
───────────────────────────────────────────────────────── */
function calcForecastAccuracy(blended) {
  /*
   * Accuracy = 100 − MAPE
   * where MAPE = |ActualTotal − BlendedForecastTotal| / ActualTotal × 100
   *
   * Uses last blended value as EOD forecast estimate.
   * Actual total = sum of all entered today values.
   */
  const actualTotal = state.rows.reduce((s, r) => s + (r.today || 0), 0);
  if (!actualTotal) return null;

  let latestBlended = null;
  for (let i = N - 1; i >= 0; i--) {
    if (blended[i] !== null) { latestBlended = blended[i]; break; }
  }
  if (latestBlended === null) return null;

  const errorPct = Math.abs(actualTotal - latestBlended) / actualTotal * 100;
  const accuracy = Math.max(0, 100 - errorPct);

  let cls, label;
  if      (accuracy >= 95) { cls = 'acc-excellent';  label = 'Excellent'; }
  else if (accuracy >= 90) { cls = 'acc-good';        label = 'Good'; }
  else if (accuracy >= 85) { cls = 'acc-acceptable';  label = 'Acceptable'; }
  else                     { cls = 'acc-poor';         label = 'Needs improvement'; }

  return { accuracy, errorPct, cls, label };
}

/* ─────────────────────────────────────────────────────────
   §5  SUMMARY HELPERS
───────────────────────────────────────────────────────── */
function calcOverallVariance(devs) {
  const v = devs.filter(d => d !== null);
  return v.length ? v.reduce((s, d) => s + d, 0) / v.length : null;
}
function findSpike(devs) {
  let max = -Infinity, idx = -1;
  devs.forEach((d, i) => { if (d !== null && d > max) { max = d; idx = i; } });
  return idx === -1 ? null : { interval: INTERVALS[idx], deviation: max };
}
function findDip(devs) {
  let min = Infinity, idx = -1;
  devs.forEach((d, i) => { if (d !== null && d < min) { min = d; idx = i; } });
  return idx === -1 ? null : { interval: INTERVALS[idx], deviation: min };
}
function calcPeriods(devs) {
  const defs = {
    morning:   { label: 'Morning   (8:00–10:45)',    r: [0,  11] },
    midday:    { label: 'Midday    (11:00–13:45)',   r: [12, 23] },
    afternoon: { label: 'Afternoon (14:00–17:45)',   r: [24, 39] },
    evening:   { label: 'Evening   (18:00–23:00)',   r: [40, 60] },
  };
  const out = {};
  Object.entries(defs).forEach(([k, { label, r }]) => {
    const slice = devs.slice(r[0], r[1] + 1).filter(d => d !== null);
    out[k] = { label, avg: slice.length ? slice.reduce((s, d) => s + d, 0) / slice.length : null };
  });
  return out;
}
function detectPattern(periods) {
  const m = periods.morning.avg, a = periods.afternoon.avg, e = periods.evening?.avg;
  if (m === null && a === null) return { label: '—', cls: '' };
  if (m !== null && a !== null) {
    if (m >  5 && a < -2) return { label: 'Front-Loaded',   cls: 'tp-front' };
    if (m < -5 && a >  2) return { label: 'Delayed Peak',   cls: 'tp-delayed' };
  }
  if (e !== null && e > 8) return { label: 'Evening Surge', cls: 'tp-surge' };
  return { label: 'Normal Pattern', cls: 'tp-normal' };
}
function detectStatus(ov) {
  if (ov === null) return { label: '—', cls: '' };
  const a = Math.abs(ov);
  if (a <= 5)  return { label: 'NORMAL',           cls: 'card-normal' };
  if (a <= 10) return { label: 'DRIFTING',          cls: 'card-drifting' };
  return              { label: 'MAJOR DEVIATION',   cls: 'card-major' };
}
function detectRisk(ov) {
  if (ov === null) return { label: '—', cls: '', msg: '' };
  const a = Math.abs(ov);
  if (a <= 5)  return { label: 'LOW',      cls: 'risk-low',      msg: 'Staffing alignment within acceptable tolerance.' };
  if (a <= 10) return { label: 'MODERATE', cls: 'risk-moderate', msg: 'Monitor before adjusting staffing.' };
  return              { label: 'HIGH',     cls: 'risk-high',      msg: 'Pattern deviation may impact staffing alignment.' };
}

/* ─────────────────────────────────────────────────────────
   §6  UPDATE TABLE CELLS (batch DOM writes)
───────────────────────────────────────────────────────── */
function updateCells(histAvgs, arrivalPct, histCompletion, devs, histProj,
                     runRate, blended, confidence, remaining, backlog, spikeArr) {
  const fmtN  = v => v !== null ? v.toFixed(1) : '—';
  const fmtI  = v => v !== null ? Math.round(v).toLocaleString() : '—';
  const fmtP  = v => v !== null ? (v * 100).toFixed(1) + '%' : '—';

  for (let i = 0; i < N; i++) {
    // Spike row highlight
    const tr = document.getElementById(`row-${i}`);
    if (tr) {
      tr.classList.remove('row-spike-warn', 'row-spike-detect');
      const sp = spikeArr[i];
      if (sp && sp.level === 'warn')   tr.classList.add('row-spike-warn');
      if (sp && sp.level === 'detect') tr.classList.add('row-spike-detect');
    }

    set(`ha-${i}`,   fmtN(histAvgs[i]));
    set(`arr-${i}`,  fmtP(arrivalPct[i]));
    set(`cmpl-${i}`, fmtP(histCompletion[i]));
    set(`hp-${i}`,   fmtI(histProj[i]));
    set(`rr-${i}`,   fmtI(runRate[i]));
    set(`bl-${i}`,   fmtI(blended[i]));
    set(`rem-${i}`,  remaining[i] !== null ? remaining[i].toLocaleString() : '—');

    // Deviation badge
    const devEl = document.getElementById(`dev-${i}`);
    if (devEl) {
      const d = devs[i];
      if (d === null) { devEl.innerHTML = '<span class="dev-nil">—</span>'; }
      else {
        const a = Math.abs(d);
        const cls = a <= 5 ? 'dev-green' : a <= 10 ? 'dev-yellow' : 'dev-red';
        devEl.innerHTML = `<span class="dev-badge ${cls}">${d > 0 ? '+' : ''}${d.toFixed(1)}%</span>`;
      }
    }

    // Confidence badge
    const cfEl = document.getElementById(`cf-${i}`);
    if (cfEl) {
      const c = confidence[i];
      cfEl.innerHTML = c
        ? `<span class="conf-badge conf-${c.level}"><span class="conf-dot"></span>${c.label}</span>`
        : '—';
    }

    // Backlog badge
    const blgEl = document.getElementById(`blg-${i}`);
    if (blgEl) {
      const b = backlog[i];
      if (!b) { blgEl.textContent = '—'; }
      else {
        const cls = b.status === 'safe' ? 'bl-safe' : b.status === 'risk' ? 'bl-risk' : 'bl-crit';
        blgEl.innerHTML = `<span class="bl-badge ${cls}">${b.label}</span>`;
      }
    }
  }
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ─────────────────────────────────────────────────────────
   §7  KPI STRIP + METRIC CARDS
───────────────────────────────────────────────────────── */
function updateKPIs(a) {
  const fmt    = v => v !== null ? Math.round(v).toLocaleString() : '—';
  const fmtPct = v => v !== null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '—';

  // Last data index
  let lastI = -1;
  for (let i = N - 1; i >= 0; i--) { if (a.cumActual[i] !== null) { lastI = i; break; } }

  // Traffic pattern
  const tpEl = document.getElementById('trafficPattern');
  if (tpEl) tpEl.innerHTML = a.trafficPattern.label !== '—'
    ? `<span class="${a.trafficPattern.cls}">${a.trafficPattern.label}</span>` : '—';

  set('siCumActual',   lastI >= 0 ? fmt(a.cumActual[lastI]) : '—');
  const expNow = lastI >= 0 ? a.cumHist[lastI] : null;
  set('siCumExpected', fmt(expNow));

  // Variance %
  const vPct = (expNow && expNow > 0 && lastI >= 0 && a.cumActual[lastI] !== null)
    ? ((a.cumActual[lastI] - expNow) / expNow) * 100 : null;
  const varEl = document.getElementById('siVariancePct');
  if (varEl) {
    varEl.textContent = fmtPct(vPct);
    varEl.style.color = vPct === null ? '' :
      Math.abs(vPct) <= 5 ? 'var(--green-600)' :
      Math.abs(vPct) <= 10 ? 'var(--yellow-600)' : 'var(--red-600)';
  }

  // Latest run-rate
  let latRR = null;
  for (let i = N - 1; i >= 0; i--) { if (a.runRate[i] !== null) { latRR = a.runRate[i]; break; } }
  set('siHistProj', fmt(latRR));
  set('siRunRate',  fmt(latRR));

  // Latest blended
  let latBl = null;
  for (let i = N - 1; i >= 0; i--) { if (a.blended[i] !== null) { latBl = a.blended[i]; break; } }
  set('siBlended', fmt(latBl));

  // Confidence
  let latCf = null;
  for (let i = N - 1; i >= 0; i--) { if (a.confidence[i] !== null) { latCf = a.confidence[i]; break; } }
  const cfEl = document.getElementById('siConfidence');
  if (cfEl) {
    if (latCf) {
      cfEl.textContent = latCf.label;
      cfEl.style.color = latCf.level === 'high' ? 'var(--green-600)' :
                         latCf.level === 'med'  ? 'var(--yellow-600)' : 'var(--red-600)';
    } else { cfEl.textContent = '—'; cfEl.style.color = ''; }
  }

  // Backlog
  let latBg = null;
  for (let i = N - 1; i >= 0; i--) { if (a.backlog[i] !== null) { latBg = a.backlog[i]; break; } }
  const bgEl = document.getElementById('siBacklog');
  if (bgEl) {
    if (latBg) {
      bgEl.textContent = latBg.label;
      bgEl.style.color = latBg.status === 'safe' ? 'var(--green-600)' :
                         latBg.status === 'risk' ? 'var(--yellow-600)' : 'var(--red-600)';
    } else { bgEl.textContent = '—'; bgEl.style.color = ''; }
  }

  // Forecast accuracy
  const fcEl = document.getElementById('siFcstAccuracy');
  if (fcEl) {
    if (a.accuracy) {
      fcEl.textContent = a.accuracy.accuracy.toFixed(1) + '%';
      fcEl.style.color = a.accuracy.cls.includes('excellent') ? 'var(--green-600)' :
                         a.accuracy.cls.includes('good')       ? 'var(--teal-600)' :
                         a.accuracy.cls.includes('acceptable') ? 'var(--yellow-600)' : 'var(--red-600)';
    } else { fcEl.textContent = '—'; fcEl.style.color = ''; }
  }

  // ── METRIC CARDS ──

  // Status card
  const sCd = document.getElementById('card-status');
  sCd.classList.remove('card-normal', 'card-drifting', 'card-major');
  if (a.status.cls) sCd.classList.add(a.status.cls);
  anim('statusValue', a.status.label);
  set('statusTag', a.overallVariance !== null ? `Avg: ${fmtPct(a.overallVariance)}` : 'Awaiting data');

  // Avg deviation card
  anim('cumulativeValue', fmtPct(a.overallVariance));

  // Blended card
  anim('blendedValue', fmt(latBl));
  set('blendedTag', latBl ? 'EOD estimate (blended model)' : 'Enter today actual data');

  // Spike card
  const spkCd = document.getElementById('card-spike');
  spkCd.classList.remove('spike-clear', 'spike-warn', 'spike-detect');
  if (a.spikeSummary.level === 'detect') {
    spkCd.classList.add('spike-detect');
    anim('spikeStatus', 'SPIKE DETECTED');
    set('spikeDetail', `Interval ${INTERVALS[a.spikeSummary.idx]} — volume accelerating`);
  } else if (a.spikeSummary.level === 'warn') {
    spkCd.classList.add('spike-warn');
    anim('spikeStatus', 'EARLY WARNING');
    set('spikeDetail', `Interval ${INTERVALS[a.spikeSummary.idx]} — trending above expected`);
  } else {
    spkCd.classList.add('spike-clear');
    anim('spikeStatus', 'Clear');
    set('spikeDetail', 'No spike detected');
  }

  // Accuracy card
  const accCd = document.getElementById('card-accuracy');
  accCd.classList.remove('acc-excellent', 'acc-good', 'acc-acceptable', 'acc-poor');
  if (a.accuracy) {
    accCd.classList.add(a.accuracy.cls);
    anim('accuracyValue', a.accuracy.accuracy.toFixed(1) + '%');
    set('accuracyTag', `${a.accuracy.label} · Error: ${a.accuracy.errorPct.toFixed(1)}%`);
  } else {
    anim('accuracyValue', '—');
    set('accuracyTag', 'Needs day-end data');
  }
}

function anim(id, txt) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.opacity = '.35';
  el.style.transform = 'scale(.93)';
  requestAnimationFrame(() => {
    el.textContent = txt;
    el.style.transition = 'opacity .18s ease, transform .18s ease';
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
  });
}

/* ─────────────────────────────────────────────────────────
   §14  OPERATIONAL INSIGHTS
───────────────────────────────────────────────────────── */
function buildInsights(a) {
  const { overallVariance, trafficPattern, runRate, blended, periods,
          spike, dip, backlog, dailyForecast, spikeSummary, spikeArr } = a;

  if (overallVariance === null) {
    return [{ cls: 'ins-blue', icon: 'ℹ️', msg: 'Enter historical and today\'s data to generate live operational insights.' }];
  }

  const items = [];
  const lastRR = runRate.reduce((v, x, i) => x !== null ? i : v, -1);
  const latRR  = lastRR >= 0 ? runRate[lastRR] : null;

  // ── Spike detection insight (highest priority) ──
  if (spikeSummary.level === 'detect') {
    items.push({ cls: 'ins-red', icon: '🚨', msg: `Traffic spike detected at ${INTERVALS[spikeSummary.idx]}. Volume running significantly above historical pattern. Consider immediate intraday reforecast.` });
  } else if (spikeSummary.level === 'warn') {
    items.push({ cls: 'ins-orange', icon: '⚠️', msg: `Early traffic spike warning at ${INTERVALS[spikeSummary.idx]}. Call arrivals trending above expected levels with positive acceleration. Monitor closely.` });
  }

  // ── Volume level ──
  if (overallVariance > 10)
    items.push({ cls: 'ins-red',    icon: '🔴', msg: `Volume running ${overallVariance.toFixed(1)}% above historical expectation. Staffing pressure is high.` });
  else if (overallVariance > 5)
    items.push({ cls: 'ins-yellow', icon: '⚠️', msg: `Traffic moderately above forecast (+${overallVariance.toFixed(1)}%). Monitor upcoming intervals before adjusting.` });
  else if (overallVariance < -10)
    items.push({ cls: 'ins-blue',   icon: '📉', msg: `Volume ${Math.abs(overallVariance).toFixed(1)}% below historical — staffing surplus likely. Consider shift adjustments.` });
  else if (overallVariance < -5)
    items.push({ cls: 'ins-blue',   icon: '📊', msg: `Traffic slightly below forecast (${overallVariance.toFixed(1)}%). Within manageable range.` });
  else
    items.push({ cls: 'ins-green',  icon: '✅', msg: `Volume tracking within normal range (${overallVariance.toFixed(1)}%). No staffing action required.` });

  // ── Run-rate vs daily forecast ──
  if (latRR !== null && dailyForecast) {
    const diff = ((latRR - dailyForecast) / dailyForecast) * 100;
    if (diff > 5)
      items.push({ cls: 'ins-red',  icon: '📈', msg: `Run-rate projection (${Math.round(latRR).toLocaleString()}) suggests EOD volume may exceed daily forecast by ${diff.toFixed(1)}%.` });
    else if (diff < -5)
      items.push({ cls: 'ins-blue', icon: '📉', msg: `Run-rate projection (${Math.round(latRR).toLocaleString()}) tracking ${Math.abs(diff).toFixed(1)}% below daily forecast.` });
  }

  // ── Traffic pattern ──
  if (trafficPattern.label === 'Front-Loaded')
    items.push({ cls: 'ins-yellow', icon: '🕗', msg: 'Front-loaded traffic detected. Expect lower volumes in the afternoon and evening.' });
  else if (trafficPattern.label === 'Delayed Peak')
    items.push({ cls: 'ins-blue',   icon: '🕑', msg: 'Delayed peak pattern — traffic building. Ensure adequate afternoon staffing is in place.' });
  else if (trafficPattern.label === 'Evening Surge')
    items.push({ cls: 'ins-red',    icon: '🌙', msg: 'Unusual evening surge detected. Late-day staffing alignment is recommended.' });

  // ── Backlog ──
  const lastBg = backlog.reduce((v, x, i) => x !== null ? i : v, -1);
  if (lastBg >= 0) {
    const b = backlog[lastBg];
    if (b.status === 'crit')
      items.push({ cls: 'ins-red',    icon: '🚨', msg: 'Backlog risk: CRITICAL — remaining calls significantly exceed available capacity.' });
    else if (b.status === 'risk')
      items.push({ cls: 'ins-yellow', icon: '⚠️', msg: 'Backlog risk: remaining call volume approaching staffing capacity limits.' });
    else
      items.push({ cls: 'ins-green',  icon: '✅', msg: 'Backlog risk: Safe — capacity is sufficient for remaining projected volume.' });
  }

  // ── Period warnings ──
  if (periods.morning.avg !== null && Math.abs(periods.morning.avg) > 8)
    items.push({ cls: 'ins-yellow', icon: '🌅', msg: `Morning period running ${periods.morning.avg > 0 ? '+' : ''}${periods.morning.avg.toFixed(1)}% vs historical baseline.` });

  return items.slice(0, 6); // cap at 6
}

function renderInsights(items) {
  const el = document.getElementById('operationalInsight');
  el.innerHTML = items.map(it =>
    `<div class="ins-item ${it.cls}">
       <span class="ins-icon">${it.icon}</span>
       <span>${it.msg}</span>
     </div>`
  ).join('');
}

/* ─────────────────────────────────────────────────────────
   §15  EXECUTIVE NARRATIVE + PERIOD BREAKDOWN
───────────────────────────────────────────────────────── */
function buildNarrative(a) {
  const { periods, spike, dip, overallVariance, status, risk, trafficPattern, blended, dailyForecast } = a;
  if (overallVariance === null) return null;

  const fmt = v => v !== null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : 'N/A';
  const lines = [];

  Object.values(periods).forEach(p => {
    if (p.avg !== null) lines.push(`${p.label.trim()}: ${descDev(p.avg)} (${fmt(p.avg)})`);
  });
  if (spike) lines.push(`Largest spike: ${spike.interval} (${fmt(spike.deviation)})`);
  if (dip)   lines.push(`Largest dip: ${dip.interval} (${fmt(dip.deviation)})`);
  if (overallVariance !== null) lines.push(`Overall avg deviation: ${fmt(overallVariance)}`);

  let interp = '';
  if      (trafficPattern.label === 'Front-Loaded') interp = 'Front-loaded pattern — higher early volumes tapering off through the afternoon.';
  else if (trafficPattern.label === 'Delayed Peak')  interp = 'Delayed peak detected — traffic building later in the day. Afternoon capacity critical.';
  else if (Math.abs(overallVariance) <= 3)           interp = 'Arrival pattern closely tracking historical norms. No material deviation.';
  else if (overallVariance > 5)                      interp = 'Overall volumes elevated above historical — sustained demand pressure observed.';
  else if (overallVariance < -5)                     interp = 'Overall volumes running below historical — softer than expected demand.';
  else                                               interp = 'Minor deviations from historical norms. Continued monitoring recommended.';

  let rec = '';
  switch (status.cls) {
    case 'card-normal':   rec = 'No immediate staffing action required. Continue standard intraday cadence.'; break;
    case 'card-drifting': rec = 'Monitor upcoming intervals before adjusting staffing. Consider a soft reforecast.'; break;
    case 'card-major':    rec = 'Initiate intraday reforecast. Staffing alignment review is recommended immediately.'; break;
    default:              rec = 'Enter data to generate recommendation.';
  }

  return { lines, interp, rec };
}

function descDev(pct) {
  const a = Math.abs(pct), d = pct > 0 ? 'above' : 'below';
  if (a <= 2)  return 'Tracking at expected levels';
  if (a <= 5)  return `Slightly ${d} historical`;
  if (a <= 10) return `Moderately ${d} historical`;
  return `Significantly ${d} historical`;
}

function renderNarrative(summary) {
  const el = document.getElementById('executiveNarrative');
  if (!summary) { el.innerHTML = '<p class="ph">Load data to generate executive summary.</p>'; return; }
  const lines = summary.lines.map(l =>
    `<div class="n-line"><span class="n-dot"></span><span>${l}</span></div>`
  ).join('');
  el.innerHTML = `${lines}
    <div class="n-section">Interpretation</div>
    <div class="n-line"><span class="n-dot" style="background:var(--purple);box-shadow:0 0 4px var(--purple-glow)"></span><span>${summary.interp}</span></div>
    <div class="n-section">Recommendation</div>
    <div class="n-line"><span class="n-dot" style="background:var(--green);box-shadow:0 0 4px var(--green-glow)"></span><span>${summary.rec}</span></div>`;
}

function renderPeriods(periods) {
  const el = document.getElementById('periodBreakdown');
  if (!periods) { el.innerHTML = '<p class="ph">Period analysis will appear here.</p>'; return; }
  el.innerHTML = Object.values(periods).map(p => {
    const val = p.avg !== null ? `${p.avg > 0 ? '+' : ''}${p.avg.toFixed(1)}%` : '—';
    const cls = p.avg === null ? 'pv-neutral' : Math.abs(p.avg) <= 5 ? 'pv-green' : Math.abs(p.avg) <= 10 ? 'pv-yellow' : 'pv-red';
    return `<div class="period-row"><span class="period-label">${p.label}</span><span class="period-val ${cls}">${val}</span></div>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────
   §16  CHARTS
───────────────────────────────────────────────────────── */
const CH = {
  blue:    '#4d9fff', blueA:   'rgba(77,159,255,.1)',
  teal:    '#00bfa5', tealA:   'rgba(0,191,165,.08)',
  green:   '#00e676', greenA:  'rgba(0,230,118,.08)',
  amber:   '#ffab00', amberA:  'rgba(255,171,0,.1)',
  purple:  '#c47dff', purpleA: 'rgba(196,125,255,.08)',
  cyan:    '#00d4ff', cyanA:   'rgba(0,212,255,.08)',
  grid:    'rgba(255,255,255,.045)',
  axis:    'rgba(255,255,255,.06)',
  text:    '#3d5068',
};

let cForecast = null, cArrival = null, cDeviation = null;

function initCharts() {
  Chart.defaults.color = CH.text;
  Chart.defaults.font.family = "'IBM Plex Mono', 'JetBrains Mono', monospace";
  Chart.defaults.font.size = 10;

  cForecast = new Chart(document.getElementById('forecastChart'), {
    type: 'line',
    data: { labels: INTERVALS, datasets: [
      { label: 'Today Actual',    data: new Array(N).fill(null), borderColor: CH.purple, backgroundColor: CH.purpleA, borderWidth: 2.5, pointRadius: 1.5, tension: .35, fill: true },
      { label: 'Hist. Avg',      data: new Array(N).fill(null), borderColor: CH.blue,   backgroundColor: CH.blueA,   borderWidth: 2,   pointRadius: 1.5, tension: .35, fill: false, borderDash: [4,3] },
      { label: 'Run-Rate Proj.', data: new Array(N).fill(null), borderColor: CH.amber,  backgroundColor: CH.amberA,  borderWidth: 2,   pointRadius: 1.5, tension: .4,  fill: false, borderDash: [6,3] },
      { label: 'Blended Fcst',   data: new Array(N).fill(null), borderColor: CH.green,  backgroundColor: CH.greenA,  borderWidth: 2.5, pointRadius: 1.5, tension: .4,  fill: false },
    ]},
    options: lineOpts(false),
  });

  cArrival = new Chart(document.getElementById('arrivalChart'), {
    type: 'line',
    data: { labels: INTERVALS, datasets: [
      { label: 'Arrival %', data: new Array(N).fill(null), borderColor: CH.cyan, backgroundColor: CH.cyanA, borderWidth: 2, pointRadius: 1.5, tension: .4, fill: true },
    ]},
    options: lineOpts(true),
  });

  cDeviation = new Chart(document.getElementById('deviationChart'), {
    type: 'bar',
    data: { labels: INTERVALS, datasets: [
      { label: 'Deviation %', data: new Array(N).fill(null),
        backgroundColor: new Array(N).fill('rgba(77,159,255,.3)'),
        borderColor: new Array(N).fill(CH.blue), borderWidth: 1, borderRadius: 2 },
    ]},
    options: barOpts(),
  });
}

function updateCharts(histAvgs, arrivalPct, devs, runRate, blended) {
  cForecast.data.datasets[0].data = state.rows.map(r => r.today);
  cForecast.data.datasets[1].data = histAvgs.map(v => v !== null ? +v.toFixed(1) : null);
  cForecast.data.datasets[2].data = runRate.map(v  => v !== null ? +v.toFixed(0) : null);
  cForecast.data.datasets[3].data = blended.map(v  => v !== null ? +v.toFixed(0) : null);
  cForecast.update('none');

  cArrival.data.datasets[0].data = arrivalPct.map(v => v !== null ? +(v * 100).toFixed(2) : null);
  cArrival.update('none');

  const dd = devs.map(d => d !== null ? +d.toFixed(2) : null);
  cDeviation.data.datasets[0].data = dd;
  cDeviation.data.datasets[0].backgroundColor = dd.map(d => {
    if (d === null) return 'rgba(255,255,255,.08)';
    const a = Math.abs(d);
    if (a <= 5)  return d > 0 ? 'rgba(255,61,87,.3)' : 'rgba(0,230,118,.3)';
    if (a <= 10) return 'rgba(255,171,0,.38)';
    return 'rgba(255,61,87,.5)';
  });
  cDeviation.data.datasets[0].borderColor = dd.map(d => {
    if (d === null) return 'rgba(255,255,255,.12)';
    const a = Math.abs(d);
    if (a <= 5)  return d > 0 ? '#ff3d57' : '#00e676';
    if (a <= 10) return '#ffab00';
    return '#ff3d57';
  });
  cDeviation.update('none');
}

function lineOpts(compact = false) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 9, padding: 12, color: '#6a7f98', font: { size: 10, family: "'IBM Plex Mono', monospace" } } },
      tooltip: chartTooltip(),
    },
    scales: {
      x: { ticks: { color: CH.text, maxRotation: 45, autoSkip: true, maxTicksLimit: compact ? 8 : 10, font: { size: 9 } }, grid: { color: CH.grid }, border: { color: CH.axis } },
      y: { ticks: { color: CH.text, font: { size: 9 } }, grid: { color: CH.grid }, border: { color: CH.axis } },
    },
    animation: { duration: 0 },
  };
}
function barOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: chartTooltip() },
    scales: {
      x: { ticks: { color: CH.text, maxRotation: 45, autoSkip: true, maxTicksLimit: 10, font: { size: 9 } }, grid: { color: CH.grid }, border: { color: CH.axis } },
      y: { title: { display: true, text: 'Deviation %', color: CH.text, font: { size: 9 } }, ticks: { color: CH.text, font: { size: 9 } }, grid: { color: CH.grid }, border: { color: CH.axis } },
    },
    animation: { duration: 0 },
  };
}
function chartTooltip() {
  return { backgroundColor: 'rgba(13,24,36,.96)', borderColor: 'rgba(0,212,255,.22)', borderWidth: 1, titleColor: '#e8edf5', bodyColor: '#6a7f98', padding: 10, cornerRadius: 6 };
}

/* ─────────────────────────────────────────────────────────
   §17  TOOLTIP SYSTEM
   Supports: data-tip on any element, .info-btn with data-tip
   Works on desktop (mouseover) and mobile (touchstart).
───────────────────────────────────────────────────────── */
function initTooltips() {
  const tip = document.getElementById('globalTooltip');
  if (!tip) return;

  let hideTimer = null;

  function showTip(el, e) {
    const text = el.dataset.tip || el.closest('[data-tip]')?.dataset.tip;
    if (!text) return;
    clearTimeout(hideTimer);
    tip.textContent = text;
    tip.classList.add('tt-show');
    positionTip(e || el);
  }

  function hideTip() {
    hideTimer = setTimeout(() => tip.classList.remove('tt-show'), 120);
  }

  function positionTip(e) {
    const PAD = 14;
    const tw = tip.offsetWidth || 272;
    const th = tip.offsetHeight || 80;
    let x, y;

    if (e && e.clientX !== undefined) {
      x = e.clientX + PAD;
      y = e.clientY - th / 2;
    } else {
      // Element-based position (for keyboard / tap)
      const rect = e.getBoundingClientRect ? e.getBoundingClientRect() : { right: 120, top: 120, width: 0, height: 0 };
      x = rect.right + PAD;
      y = rect.top - th / 2 + rect.height / 2;
    }

    // Clamp to viewport
    x = Math.min(x, window.innerWidth  - tw  - 8);
    y = Math.max(8, Math.min(y, window.innerHeight - th - 8));
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  }

  // Desktop
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el, e);
    else hideTip();
  });
  document.addEventListener('mousemove', e => {
    if (tip.classList.contains('tt-show')) positionTip(e);
  });
  document.addEventListener('mouseout', e => {
    if (!e.relatedTarget?.closest('[data-tip]')) hideTip();
  });

  // Mobile tap
  document.addEventListener('touchstart', e => {
    const el = e.target.closest('[data-tip]');
    if (el) { showTip(el); setTimeout(hideTip, 2800); }
    else hideTip();
  }, { passive: true });
}

/* ─────────────────────────────────────────────────────────
   §19  EXPORT
───────────────────────────────────────────────────────── */
function buildExportText(a) {
  if (!a) return 'No analysis data. Please enter data first.';
  const fmt  = v => v !== null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : 'N/A';
  const fmtI = v => v !== null ? Math.round(v).toLocaleString() : 'N/A';
  const now  = new Date().toLocaleString();
  let t = `INTRADAY INTELLIGENCE DASHBOARD\nGenerated: ${now}\n${'─'.repeat(52)}\n\n`;
  t += `PATTERN STATUS:    ${a.status.label}\n`;
  t += `AVG DEVIATION:     ${fmt(a.overallVariance)}\n`;
  t += `SERVICE RISK:      ${a.risk.label}\n`;
  t += `TRAFFIC PATTERN:   ${a.trafficPattern.label}\n`;
  t += `SPIKE STATUS:      ${a.spikeSummary.level === 'detect' ? 'SPIKE DETECTED' : a.spikeSummary.level === 'warn' ? 'EARLY WARNING' : 'Clear'}\n`;

  let latBl = null; for (let i = N - 1; i >= 0; i--) { if (a.blended[i] !== null) { latBl = a.blended[i]; break; } }
  let latRR = null; for (let i = N - 1; i >= 0; i--) { if (a.runRate[i] !== null) { latRR = a.runRate[i]; break; } }
  t += `BLENDED FORECAST:  ${fmtI(latBl)}\n`;
  t += `RUN-RATE PROJ.:    ${fmtI(latRR)}\n`;
  if (a.dailyForecast) t += `DAILY FORECAST:    ${fmtI(a.dailyForecast)}\n`;
  if (a.accuracy) t += `FORECAST ACCURACY: ${a.accuracy.accuracy.toFixed(1)}% (${a.accuracy.label}) | MAPE Error: ${a.accuracy.errorPct.toFixed(1)}%\n`;

  t += `\nPERIOD SUMMARY\n${'─'.repeat(32)}\n`;
  Object.values(a.periods).forEach(p => { t += `${p.label.trim()}: ${fmt(p.avg)}\n`; });
  if (a.spike) t += `\nLargest Spike:  ${a.spike.interval} (${fmt(a.spike.deviation)})\n`;
  if (a.dip)   t += `Largest Dip:    ${a.dip.interval} (${fmt(a.dip.deviation)})\n`;

  if (a.narrative) {
    t += `\nNARRATIVE\n${'─'.repeat(32)}\n`;
    a.narrative.lines.forEach(l => { t += `• ${l}\n`; });
    t += `\nInterpretation:\n${a.narrative.interp}\n\nRecommendation:\n${a.narrative.rec}\n`;
  }
  t += `\n${'─'.repeat(52)}\nIntraday Intelligence Dashboard v3 | Workforce Intelligence Suite\nBuilt by Abdul Basit\n`;
  return t;
}

function updateExportPreview(a) {
  document.getElementById('exportPreview').textContent = buildExportText(a);
}

/* ─────────────────────────────────────────────────────────
   §18  MAIN RECALCULATION PIPELINE  (debounced 60ms)
───────────────────────────────────────────────────────── */
let _rt = null;
function scheduleRecalc() { clearTimeout(_rt); _rt = setTimeout(runRecalc, 60); }

function runRecalc() {
  const histAvgs       = calcHistAvg();
  const arrivalPct     = calcArrivalPattern(histAvgs);
  const histCompletion = calcHistCompletion(histAvgs);
  const devs           = calcDeviation(histAvgs);
  const cumActual      = calcCumActual();
  const cumHist        = calcCumHist(histAvgs);
  const dailyForecast  = state.dailyForecast;
  const availCap       = state.availableCapacity;

  const histProj   = calcHistProj(arrivalPct, dailyForecast);
  const runRate    = calcRunRate(cumActual, histCompletion);
  const blended    = calcBlended(runRate, histCompletion, dailyForecast);
  const remaining  = calcRemaining(blended, cumActual);
  const confidence = calcConfidence(devs, histCompletion, blended, dailyForecast);
  const backlog    = calcBacklog(remaining, histCompletion, availCap);

  // §12 Spike detection
  const spikeArr     = calcSpikeStatus(histAvgs);
  const spikeSummary = summariseSpike(spikeArr);

  // §13 Forecast accuracy
  const accuracy = calcForecastAccuracy(blended);

  const overallVariance = calcOverallVariance(devs);
  const spike           = findSpike(devs);
  const dip             = findDip(devs);
  const periods         = calcPeriods(devs);
  const status          = detectStatus(overallVariance);
  const risk            = detectRisk(overallVariance);
  const trafficPattern  = detectPattern(periods);
  const narrative       = buildNarrative({ periods, spike, dip, overallVariance, status, risk, trafficPattern, blended, dailyForecast });

  const analysis = {
    histAvgs, arrivalPct, histCompletion, devs, cumActual, cumHist,
    histProj, runRate, blended, remaining, confidence, backlog,
    spikeArr, spikeSummary, accuracy,
    overallVariance, spike, dip, periods, status, risk, trafficPattern, narrative,
    dailyForecast, availCap,
  };
  state.analysis = analysis;

  // Batch DOM updates
  updateCells(histAvgs, arrivalPct, histCompletion, devs, histProj, runRate, blended, confidence, remaining, backlog, spikeArr);
  updateKPIs(analysis);
  renderInsights(buildInsights(analysis));
  renderNarrative(narrative);
  renderPeriods(periods);
  updateCharts(histAvgs, arrivalPct, devs, runRate, blended);
  updateExportPreview(analysis);
}

/* ─────────────────────────────────────────────────────────
   §3  BULK PASTE
───────────────────────────────────────────────────────── */
function applyColumnPaste(colIndex, rawText) {
  const vals = rawText.split('\n')
    .map(l => l.trim()).filter(l => l !== '')
    .map(l => parseFloat(l.replace(/,/g, '')));

  let applied = 0;
  for (let i = 0; i < N && i < vals.length; i++) {
    const v = vals[i];
    if (isNaN(v)) continue;
    if (colIndex === 'today') {
      state.rows[i].today = v;
      const inp = document.getElementById(`t-${i}`);
      if (inp) inp.value = v;
    } else {
      const d = parseInt(colIndex);
      state.rows[i].days[d] = v;
      const inp = document.getElementById(`w${d}-${i}`);
      if (inp) inp.value = v;
    }
    applied++;
  }
  scheduleRecalc();
  return applied;
}

/* ─────────────────────────────────────────────────────────
   §4  EXCEL Ctrl+V PASTE
───────────────────────────────────────────────────────── */
function handleTablePaste(e) {
  const text = e.clipboardData.getData('text/plain');
  if (!text.includes('\t')) return; // not tab-separated — let browser handle it
  e.preventDefault();

  const lines  = text.trim().split('\n');
  const matrix = lines.map(l => l.split('\t').map(c => c.trim()));

  const active = document.activeElement;
  let startRow = 0, startCol = 0;
  if (active && active.id) {
    const mRow = active.id.match(/-(\d+)$/);
    if (mRow) startRow = parseInt(mRow[1]);
    if (active.id.startsWith('t-')) startCol = 'today';
    else {
      const mCol = active.id.match(/^w(\d)-/);
      if (mCol) startCol = parseInt(mCol[1]);
    }
  }

  let applied = 0;
  matrix.forEach((row, ri) => {
    const rowIdx = startRow + ri;
    if (rowIdx >= N) return;
    row.forEach((cell, ci) => {
      const v = parseFloat(cell.replace(/,/g, ''));
      if (isNaN(v)) return;
      if (startCol === 'today') {
        state.rows[rowIdx].today = v;
        const inp = document.getElementById(`t-${rowIdx}`);
        if (inp) inp.value = v;
        applied++;
      } else {
        const colD = (typeof startCol === 'number' ? startCol : 0) + ci;
        if (colD < 5) {
          state.rows[rowIdx].days[colD] = v;
          const inp = document.getElementById(`w${colD}-${rowIdx}`);
          if (inp) inp.value = v;
          applied++;
        } else if (colD === 5) {
          state.rows[rowIdx].today = v;
          const inp = document.getElementById(`t-${rowIdx}`);
          if (inp) inp.value = v;
          applied++;
        }
      }
    });
  });

  if (applied > 0) { scheduleRecalc(); showToast(`Pasted ${applied} values from clipboard`); }
}

/* ─────────────────────────────────────────────────────────
   EXAMPLE DATA
───────────────────────────────────────────────────────── */
function loadExample() {
  const base = [
    18,24,30,38,52,65,78,88,96,102,108,114,
    118,122,125,122,112,105,98,92,88,85,82,80,
    84,89,94,98,102,104,106,102,94,84,72,60,
    48,36,26,18,14,12,11,10,9,9,8,8,
    7,7,6,6,5,5,4,4,3,3,3,2,2,
  ];
  // today shift — including an artificial spike at 10:30–11:00 to demo spike detection
  const todayShift = [
    -.12,-.10,-.09,-.08,-.07,-.06,-.05,-.04,
    -.02,-.01,.08,.15,.18,.15,.10,.08,   // spike window at ~10:30
    -.02,-.03,-.02,-.01,.01,.02,.03,.04,
    .05,.07,.09,.10,.11,.12,.10,.09,
    .08,.07,.06,.05,.04,.03,.02,.01,
    .01,.00,-.01,-.01,.00,.00,.00,.00,
    .00,.00,.00,.00,.00,.00,.00,.00,
    .00,.00,.00,.00,.00,
  ];
  const rng = s => { const x = Math.sin(s) * 10000; return .93 + (x - Math.floor(x)) * .14; };

  INTERVALS.forEach((_, i) => {
    const b = base[i] || 2;
    for (let d = 0; d < 5; d++) {
      const v = Math.max(0, Math.round(b * rng(i * 7 + d * 13 + 42)));
      state.rows[i].days[d] = v;
      const inp = document.getElementById(`w${d}-${i}`);
      if (inp) inp.value = v;
    }
    const tv = Math.max(0, Math.round(b * (1 + (todayShift[i] || 0))));
    state.rows[i].today = tv;
    const inp = document.getElementById(`t-${i}`);
    if (inp) inp.value = tv;
  });

  document.getElementById('dailyForecastInput').value = 2500;
  state.dailyForecast = 2500;
  document.getElementById('availableCapacityInput').value = 2400;
  state.availableCapacity = 2400;

  scheduleRecalc();
  showToast('Example data loaded — spike detection demo included');
}

function clearAll() {
  state.rows.forEach((_, i) => {
    state.rows[i] = { days: [null, null, null, null, null], today: null };
    for (let d = 0; d < 5; d++) {
      const inp = document.getElementById(`w${d}-${i}`);
      if (inp) inp.value = '';
    }
    const inp = document.getElementById(`t-${i}`);
    if (inp) inp.value = '';
  });
  ['pasteW1','pasteW2','pasteW3','pasteW4','pasteW5','pasteToday'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('dailyForecastInput').value = '';
  document.getElementById('availableCapacityInput').value = '';
  state.dailyForecast = null;
  state.availableCapacity = null;
  state.analysis = null;
  scheduleRecalc();
  showToast('All data cleared');
}

/* ─────────────────────────────────────────────────────────
   TOAST
───────────────────────────────────────────────────────── */
function showToast(msg) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast'; t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('toast--on');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('toast--on'), 2800);
}

/* ─────────────────────────────────────────────────────────
   EXPORT HELPERS
───────────────────────────────────────────────────────── */
function exportOutlook() {
  const b = buildExportText(state.analysis);
  window.location.href = `mailto:?subject=${encodeURIComponent('Intraday Intelligence Report')}&body=${encodeURIComponent(b)}`;
}
function exportGmail() {
  const b = buildExportText(state.analysis);
  window.open(`https://mail.google.com/mail/?view=cm&su=${encodeURIComponent('Intraday Intelligence Report')}&body=${encodeURIComponent(b)}`, '_blank');
}
async function copySummary() {
  const t = buildExportText(state.analysis);
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
  showToast('Summary copied to clipboard');
}
function downloadReport() {
  const t = buildExportText(state.analysis);
  const blob = new Blob([t], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `intraday-analysis-${new Date().toISOString().slice(0,10)}.txt`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Report downloaded');
}

/* ─────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  buildTable();
  initCharts();
  initTooltips();   // §17
  runRecalc();

  // Header actions
  document.getElementById('loadExampleBtn').addEventListener('click', loadExample);
  document.getElementById('clearDataBtn').addEventListener('click', clearAll);

  // Bulk paste apply buttons
  document.querySelectorAll('.btn--apply').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.col;
      const taId = col === 'today' ? 'pasteToday' : `pasteW${parseInt(col) + 1}`;
      const ta = document.getElementById(taId);
      if (!ta || !ta.value.trim()) { showToast('Nothing to paste'); return; }
      const n = applyColumnPaste(col === 'today' ? 'today' : col, ta.value);
      showToast(`Applied ${n} values to ${col === 'today' ? 'Today Actual' : 'Week −' + (parseInt(col) + 1)}`);
    });
  });

  // Excel paste on table
  document.getElementById('tableWrapper').addEventListener('paste', handleTablePaste);
  document.getElementById('dataTable').addEventListener('paste', handleTablePaste);

  // Config inputs
  document.getElementById('dailyForecastInput').addEventListener('input', e => {
    state.dailyForecast = parseFloat(e.target.value) || null; scheduleRecalc();
  });
  document.getElementById('availableCapacityInput').addEventListener('input', e => {
    state.availableCapacity = parseFloat(e.target.value) || null; scheduleRecalc();
  });

  // Export buttons
  document.getElementById('outlookBtn').addEventListener('click', exportOutlook);
  document.getElementById('gmailBtn').addEventListener('click',   exportGmail);
  document.getElementById('copyBtn').addEventListener('click',    copySummary);
  document.getElementById('downloadBtn').addEventListener('click', downloadReport);

  // Mobile nav toggle
  const toggle = document.getElementById('menuToggle');
  const nav    = document.querySelector('.nav-links');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
  }
});
