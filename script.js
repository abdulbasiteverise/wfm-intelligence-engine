// ═══════════════════════════════════════════════════════════════════════════
// INTRADAY REFORECAST CALCULATOR — EVERISE WFM
// Built by Abdul Basit
//
// Modules:
//   1. State & utilities
//   2. Intelligent calculation engine
//   3. Operational summary generator
//   4. Email automation (Outlook mailto, Gmail mailto, clipboard)
//   5. n8n webhook trigger
//   6. DOM rendering
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. STATE ───────────────────────────────────────────────────────────────

let state = {
  globalInputs: {
    startTime: '09:00', endTime: '23:30',
    reforecastTime: '13:00', paidHours: 7.5,
    shrinkagePct: 8, occupancyTarget: 85
  },
  queues: [
    { id: 1, name: 'Verification', forecastVolume: 500, forecastToNowVolume: 208, forecastAHT: 180, actualVolume: 220, actualAHT: 195 },
    { id: 2, name: 'Phones',       forecastVolume: 350, forecastToNowVolume: 146, forecastAHT: 240, actualVolume: 185, actualAHT: 210 }
  ],
  nextId: 3,
  selectedQueueId: 1
};

// ─── 2. UTILITIES ────────────────────────────────────────────────────────────

const toDecimal = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h + m / 60; };
const fmtHrs  = v => isNaN(v) ? '0.00' : v.toFixed(2);
const fmtPct  = v => (isNaN(v) || !isFinite(v)) ? '0.0' : v.toFixed(1);
const fmtFTE  = v => isNaN(v) ? '0.0' : v.toFixed(1);
const fmtVol  = v => isNaN(v) ? '0' : Math.round(v).toString();
const sign    = v => v > 0 ? '+' : '';

function nowStr() {
  return new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

// ─── LIVE CLOCK ──────────────────────────────────────────────────────────────

function tickClock() {
  const el = document.getElementById('liveClock');
  if (el) el.textContent = new Date().toTimeString().slice(0, 8);
}
setInterval(tickClock, 1000);
tickClock();

// ─── 3. CALCULATION ENGINE ───────────────────────────────────────────────────
//
// Intelligence beyond run-rate:
//  • Confidence score: sigmoid on elapsed fraction
//  • Blended projection: high elapsed → run-rate; low elapsed → plan
//  • Two-component workload: volume-driver + AHT-driver
//  • Occupancy-adjusted FTE (Erlang proxy)

function calculateQueue(queue, g) {
  const startDec  = toDecimal(g.startTime);
  const endDec    = toDecimal(g.endTime);
  const recastDec = toDecimal(g.reforecastTime);

  const totalOpHrs   = Math.max(endDec - startDec, 0.001);
  const elapsedHrs   = Math.max(Math.min(recastDec - startDec, totalOpHrs), 0.001);
  const remainingHrs = totalOpHrs - elapsedHrs;

  const elapsedFrac = elapsedHrs / totalOpHrs;
  const remainFrac  = remainingHrs / totalOpHrs;

  // Sigmoid confidence: rises fast after 20% elapsed, tops out ~97%
  const rawConf    = 1 / (1 + Math.exp(-10 * (elapsedFrac - 0.35)));
  const confidence = Math.min(Math.max(rawConf, 0.05), 0.97);

  const fAHThr = queue.forecastAHT / 3600;
  const aAHThr = queue.actualAHT   / 3600;

  const fcstNowWork = queue.forecastToNowVolume * fAHThr;
  const actNowWork  = queue.actualVolume         * aAHThr;

  const volDeltaNow = queue.actualVolume - queue.forecastToNowVolume;
  const volDevPct   = queue.forecastToNowVolume > 0
    ? (volDeltaNow / queue.forecastToNowVolume) * 100 : 0;

  const ahtDeltaHr = aAHThr - fAHThr;
  const ahtDevPct  = queue.forecastAHT > 0
    ? (ahtDeltaHr / fAHThr) * 100 : 0;

  const volWorkloadDelta         = volDeltaNow        * fAHThr;
  const ahtWorkloadDelta         = queue.actualVolume  * ahtDeltaHr;
  const totalIncrementalWorkload = volWorkloadDelta + ahtWorkloadDelta;

  // Blended remaining volume projection
  const runRate          = elapsedHrs > 0 ? queue.actualVolume / elapsedHrs : 0;
  const runRateProjected = runRate * remainingHrs;
  const fcstRemaining    = queue.forecastVolume * remainFrac;
  const blendedRemaining = confidence * runRateProjected + (1 - confidence) * fcstRemaining;
  const revisedFullDay   = queue.actualVolume + blendedRemaining;

  const shrinkFrac       = g.shrinkagePct / 100;
  const netProdHrsPerFTE = g.paidHours * (1 - shrinkFrac);
  const occupancyAdj     = (g.occupancyTarget / 100) || 1;

  const volFTE      = netProdHrsPerFTE > 0 ? volWorkloadDelta / netProdHrsPerFTE : 0;
  const ahtFTE      = netProdHrsPerFTE > 0 ? ahtWorkloadDelta / netProdHrsPerFTE : 0;
  const grossFTE    = netProdHrsPerFTE > 0 ? totalIncrementalWorkload / netProdHrsPerFTE : 0;
  const adjustedFTE = grossFTE / occupancyAdj;

  const absVol = Math.abs(volDevPct);
  const absAHT = Math.abs(ahtDevPct);
  let driver = 'Normal';
  if      (absVol > 5 && absAHT > 5)      driver = 'Mixed';
  else if (absVol > absAHT && absVol > 5) driver = 'Volume';
  else if (absAHT > absVol && absAHT > 5) driver = 'AHT';

  const absImpact = Math.abs(totalIncrementalWorkload);
  let risk = 'Low';
  if      (absImpact > 2.0) risk = 'High';
  else if (absImpact > 0.8) risk = 'Medium';

  return {
    confidence, elapsedFrac, remainFrac,
    forecastToNowVolume: queue.forecastToNowVolume,
    actualVolume: queue.actualVolume,
    revisedFullDay, runRate,
    volDevPct, ahtDevPct,
    fcstNowWork, actNowWork,
    volWorkloadDelta, ahtWorkloadDelta,
    totalIncrementalWorkload,
    adjustedFTE, volFTE, ahtFTE,
    driver, risk
  };
}

// ─── 4. OPERATIONAL SUMMARY GENERATOR ────────────────────────────────────────

function generateOpsSummary() {
  const g = getGlobalInputs();
  const ts = nowStr();

  let totalFTE = 0, totalWL = 0, highRisk = 0, medRisk = 0;
  const queueLines = [];

  state.queues.forEach(q => {
    const r = calculateQueue(q, g);
    totalFTE += r.adjustedFTE;
    totalWL  += r.totalIncrementalWorkload;
    if (r.risk === 'High')   highRisk++;
    if (r.risk === 'Medium') medRisk++;

    const fteStr = `${sign(r.adjustedFTE)}${fmtFTE(Math.abs(r.adjustedFTE))} FTE`;
    const wlStr  = `${sign(r.totalIncrementalWorkload)}${fmtHrs(Math.abs(r.totalIncrementalWorkload))} hrs`;
    const confStr = `${Math.round(r.confidence * 100)}%`;

    const action = r.adjustedFTE > 0.5
      ? `⚠ ACTION NEEDED: Additional ${fmtFTE(r.adjustedFTE)} FTE required. Consider OT or cross-skilling.`
      : r.adjustedFTE < -0.5
      ? `✓ CAPACITY SURPLUS: ${fmtFTE(Math.abs(r.adjustedFTE))} FTE available. Consider redeployment.`
      : `✓ ON TRACK: Within acceptable variance.`;

    queueLines.push(
`  ┌─ ${q.name.toUpperCase()} ${'─'.repeat(Math.max(0, 38 - q.name.length))}
  │  Forecast-to-Now:  ${fmtVol(r.forecastToNowVolume)} calls   │  Actual-to-Now: ${fmtVol(r.actualVolume)} calls
  │  Volume Dev:       ${sign(r.volDevPct)}${fmtPct(r.volDevPct)}%           │  AHT Dev:       ${sign(r.ahtDevPct)}${fmtPct(r.ahtDevPct)}%
  │  Net Δ Workload:   ${wlStr.padEnd(12)}   │  FTE Impact:    ${fteStr}
  │  Primary Driver:   ${r.driver.padEnd(12)}   │  Risk Level:    ${r.risk}
  │  Confidence:       ${confStr.padEnd(12)}   │  Revised Vol:   ${fmtVol(r.revisedFullDay)}
  │  ${action}
  └${'─'.repeat(44)}`
    );
  });

  const startDec  = toDecimal(g.startTime);
  const endDec    = toDecimal(g.endTime);
  const recastDec = toDecimal(g.reforecastTime);
  const pctElapsed = Math.round(((recastDec - startDec) / Math.max(endDec - startDec, 0.001)) * 100);

  const overallStatus = highRisk > 0 ? '🔴 HIGH RISK' : medRisk > 0 ? '🟡 MEDIUM RISK' : '🟢 ON TRACK';
  const overallFTEStr = `${sign(totalFTE)}${fmtFTE(Math.abs(totalFTE))} FTE`;
  const overallWLStr  = `${sign(totalWL)}${fmtHrs(Math.abs(totalWL))} hrs`;

  const summary =
`╔══════════════════════════════════════════════════════╗
║     INTRADAY REFORECAST — OPERATIONAL SUMMARY        ║
║     Everise WFM · Built by Abdul Basit               ║
╚══════════════════════════════════════════════════════╝

Generated:    ${ts}
Shift:        ${g.startTime} – ${g.endTime}
Reforecast:   ${g.reforecastTime}  (${pctElapsed}% of shift elapsed)
Shrinkage:    ${g.shrinkagePct}%    Occupancy Target: ${g.occupancyTarget}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OVERALL STATUS: ${overallStatus}
  Net Δ Workload: ${overallWLStr}     Total FTE Impact: ${overallFTEStr}
  High-Risk Queues: ${highRisk} / ${state.queues.length}    Medium-Risk: ${medRisk} / ${state.queues.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUEUE DETAIL:

${queueLines.join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
METHODOLOGY NOTE:
  Net ΔWorkload = (ΔVol × Fcst AHT) + (Actual Vol × ΔAHT)
  FTE is occ-adjusted. Projection blends run-rate vs plan
  using a sigmoid confidence score on elapsed shift fraction.
  Low <0.8 hrs | Medium 0.8–2.0 hrs | High >2.0 hrs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Dragonfly Health · Enclara Pharmacia · Everise WFM
`;

  return summary;
}

// ─── 5. EMAIL AUTOMATION ─────────────────────────────────────────────────────

function getEmailFields() {
  return {
    to:      document.getElementById('emailTo')?.value      || '',
    cc:      document.getElementById('emailCc')?.value      || '',
    subject: document.getElementById('emailSubject')?.value || 'Intraday Reforecast — Operational Summary'
  };
}

function buildMailtoUrl(clientScheme) {
  const { to, cc, subject } = getEmailFields();
  const body = generateOpsSummary();
  const params = new URLSearchParams();
  if (cc)     params.set('cc', cc);
  params.set('subject', subject);
  params.set('body', body);

  if (clientScheme === 'gmail') {
    // Gmail compose URL
    const gParams = new URLSearchParams();
    if (to) gParams.set('to', to);
    if (cc) gParams.set('cc', cc);
    gParams.set('su', subject);
    gParams.set('body', body);
    return `https://mail.google.com/mail/?view=cm&fs=1&${gParams.toString()}`;
  }

  // Outlook / default mailto
  const paramsStr = params.toString();
  return `mailto:${encodeURIComponent(to)}?${paramsStr}`;
}

function sendOutlook() {
  const url = buildMailtoUrl('outlook');
  window.location.href = url;
  showToast('Opening Outlook…', 'success');
}

function sendGmail() {
  const url = buildMailtoUrl('gmail');
  window.open(url, '_blank');
  showToast('Opening Gmail compose…', 'success');
}

function copyToClipboard() {
  const text = generateOpsSummary();
  navigator.clipboard.writeText(text).then(() => {
    showToast('✓ Summary copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('✓ Summary copied to clipboard!', 'success');
  });
}

// ─── 6. n8n WEBHOOK TRIGGER ──────────────────────────────────────────────────

async function triggerN8nWebhook() {
  const webhookUrl = document.getElementById('webhookUrl')?.value?.trim();
  const statusEl   = document.getElementById('webhookStatus');
  const btn        = document.getElementById('webhookTriggerBtn');

  if (!webhookUrl) {
    showStatus(statusEl, 'error', '✕ Please enter your n8n webhook URL');
    return;
  }

  const g = getGlobalInputs();
  const payload = {
    timestamp: new Date().toISOString(),
    generated_by: 'Everise WFM Intraday Reforecast Calculator',
    built_by: 'Abdul Basit',
    global_settings: {
      shift_start: g.startTime,
      shift_end: g.endTime,
      reforecast_at: g.reforecastTime,
      paid_hours: g.paidHours,
      shrinkage_pct: g.shrinkagePct,
      occupancy_target: g.occupancyTarget
    },
    queues: state.queues.map(q => {
      const r = calculateQueue(q, g);
      return {
        name: q.name,
        forecast_to_now: r.forecastToNowVolume,
        actual_now: r.actualVolume,
        vol_dev_pct: parseFloat(fmtPct(r.volDevPct)),
        aht_dev_pct: parseFloat(fmtPct(r.ahtDevPct)),
        workload_delta_hrs: parseFloat(fmtHrs(r.totalIncrementalWorkload)),
        fte_impact: parseFloat(fmtFTE(r.adjustedFTE)),
        driver: r.driver,
        risk: r.risk,
        confidence_pct: Math.round(r.confidence * 100),
        revised_full_day_vol: Math.round(r.revisedFullDay)
      };
    }),
    summary: {
      total_fte_impact: parseFloat(fmtFTE(state.queues.reduce((s, q) => s + calculateQueue(q, g).adjustedFTE, 0))),
      high_risk_queues: state.queues.filter(q => calculateQueue(q, g).risk === 'High').length,
      ops_summary_text: generateOpsSummary()
    }
  };

  // UI: loading state
  btn.disabled = true;
  btn.textContent = '⟳ Sending…';
  showStatus(statusEl, 'loading', '⟳ Posting to n8n workflow…');

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'no-cors'   // n8n webhooks are typically same-origin or CORS-configured
    });

    // no-cors returns opaque response — we optimistically assume success
    showStatus(statusEl, 'success', '✓ Payload sent to n8n! Check your workflow execution.');
    showToast('✓ n8n webhook triggered successfully!', 'success');
  } catch (err) {
    showStatus(statusEl, 'error', `✕ Failed: ${err.message}`);
    showToast('✕ Webhook failed. Check URL & CORS settings.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>▶</span> Trigger Workflow';
  }
}

function showStatus(el, type, msg) {
  if (!el) return;
  el.className = `webhook-status show ${type}`;
  el.textContent = msg;
}

// ─── TOAST ───────────────────────────────────────────────────────────────────

function showToast(msg, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = `toast${type ? ' ' + type : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ─── READ GLOBAL INPUTS ───────────────────────────────────────────────────────

function getGlobalInputs() {
  return {
    startTime:       document.getElementById('startTime')?.value      || '09:00',
    endTime:         document.getElementById('endTime')?.value        || '23:30',
    reforecastTime:  document.getElementById('reforecastTime')?.value || '13:00',
    paidHours:       parseFloat(document.getElementById('paidHours')?.value)       || 7.5,
    shrinkagePct:    parseFloat(document.getElementById('shrinkagePct')?.value)    || 8,
    occupancyTarget: parseFloat(document.getElementById('occupancyTarget')?.value) || 85
  };
}

// ─── RENDER: QUEUE CARDS ─────────────────────────────────────────────────────

function renderQueues() {
  const container = document.getElementById('queuesContainer');
  if (!container) return;
  const g = getGlobalInputs();
  container.innerHTML = '';

  state.queues.forEach(q => {
    const r = calculateQueue(q, g);
    const riskClass = 'risk-' + r.risk.toLowerCase();
    const fteColor  = r.adjustedFTE > 0 ? 'var(--red)' : r.adjustedFTE < 0 ? 'var(--green)' : 'var(--text-mid)';
    const isOpen    = q.id === state.selectedQueueId;

    const card = document.createElement('div');
    card.className = 'queue-card' + (isOpen ? ' active' : '');
    card.innerHTML = `
      <div class="queue-card-head" data-id="${q.id}">
        <input class="queue-name-input" value="${q.name}" data-id="${q.id}" placeholder="Queue name">
        <div class="queue-meta">
          <span class="risk-pill ${riskClass}">${r.risk}</span>
          <span style="font-size:12px;font-family:var(--font-mono);color:var(--text-mid);">
            FTE: <strong style="color:${fteColor}">${sign(r.adjustedFTE)}${fmtFTE(r.adjustedFTE)}</strong>
          </span>
          <button class="queue-remove-btn" data-remove="${q.id}">✕ Remove</button>
        </div>
      </div>
      <div class="queue-body" style="display:${isOpen ? 'block' : 'none'}">
        <div class="queue-inputs">
          ${qField('forecastVolume',      'Full-Day Fcst Vol',  q.forecastVolume,      q.id)}
          ${qField('forecastToNowVolume', 'Fcst-to-Now Vol',    q.forecastToNowVolume, q.id)}
          ${qField('forecastAHT',         'Forecast AHT (sec)', q.forecastAHT,         q.id)}
          ${qField('actualVolume',        'Actual Vol Now',     q.actualVolume,        q.id)}
          ${qField('actualAHT',           'Actual AHT (sec)',   q.actualAHT,           q.id)}
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // Toggle open/close
  container.querySelectorAll('.queue-card-head').forEach(head => {
    head.addEventListener('click', e => {
      if (e.target.classList.contains('queue-name-input')) return;
      if (e.target.dataset.remove) return;
      const id = parseInt(head.dataset.id);
      state.selectedQueueId = state.selectedQueueId === id ? null : id;
      renderAll();
    });
  });

  // Name edits
  container.querySelectorAll('.queue-name-input').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('change', e => {
      const q = state.queues.find(x => x.id === parseInt(e.target.dataset.id));
      if (q) { q.name = e.target.value; renderOutputTable(); renderSummaryTiles(); renderDetail(); refreshOpsSummary(); }
    });
  });

  // Remove
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.remove);
      state.queues = state.queues.filter(q => q.id !== id);
      if (state.selectedQueueId === id) state.selectedQueueId = state.queues[0]?.id ?? null;
      renderAll();
    });
  });

  // Field value changes
  container.querySelectorAll('input[data-qid]').forEach(inp => {
    inp.addEventListener('input', e => {
      const q = state.queues.find(x => x.id === parseInt(e.target.dataset.qid));
      if (q) {
        q[e.target.dataset.key] = parseFloat(e.target.value) || 0;
        renderOutputTable();
        renderSummaryTiles();
        renderDetail();
        renderQueues();
        refreshOpsSummary();
      }
    });
  });
}

function qField(key, label, val, qid) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="number" value="${val}" data-qid="${qid}" data-key="${key}" min="0" step="1">
    </div>`;
}

// ─── RENDER: OUTPUT TABLE ─────────────────────────────────────────────────────

function renderOutputTable() {
  const g    = getGlobalInputs();
  const body = document.getElementById('outputTableBody');
  if (!body) return;
  body.innerHTML = '';

  state.queues.forEach(q => {
    const r = calculateQueue(q, g);
    const wlClass  = r.totalIncrementalWorkload > 0 ? 'pos' : r.totalIncrementalWorkload < 0 ? 'neg' : 'neu';
    const fteClass = r.adjustedFTE > 0 ? 'pos' : r.adjustedFTE < 0 ? 'neg' : 'neu';
    const vdClass  = r.volDevPct  > 0 ? 'pos' : r.volDevPct  < 0 ? 'neg' : 'neu';
    const adClass  = r.ahtDevPct  > 0 ? 'pos' : r.ahtDevPct  < 0 ? 'neg' : 'neu';
    const confPct   = Math.round(r.confidence * 100);
    const confColor = confPct >= 70 ? 'var(--green)' : confPct >= 40 ? 'var(--amber)' : 'var(--red)';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="q-name-cell">${q.name}</td>
      <td class="num-cell neu">${fmtVol(r.forecastToNowVolume)}</td>
      <td class="num-cell neu">${fmtVol(r.actualVolume)}</td>
      <td class="num-cell ${vdClass}">${sign(r.volDevPct)}${fmtPct(r.volDevPct)}%</td>
      <td class="num-cell ${adClass}">${sign(r.ahtDevPct)}${fmtPct(r.ahtDevPct)}%</td>
      <td class="num-cell ${wlClass}">${sign(r.totalIncrementalWorkload)}${fmtHrs(Math.abs(r.totalIncrementalWorkload))} hrs</td>
      <td class="num-cell ${fteClass}">${sign(r.adjustedFTE)}${fmtFTE(Math.abs(r.adjustedFTE))} FTE</td>
      <td><span class="driver-tag driver-${r.driver}">${r.driver}</span></td>
      <td><span class="risk-pill risk-${r.risk.toLowerCase()}">${r.risk}</span></td>
      <td>
        <div class="spark-bar-wrap">
          <div class="spark-bar-bg">
            <div class="spark-bar-fill" style="width:${confPct}%;background:${confColor};"></div>
          </div>
          <span style="font-size:10px;color:${confColor};font-weight:600;min-width:30px;">${confPct}%</span>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

// ─── RENDER: SUMMARY TILES ───────────────────────────────────────────────────

function renderSummaryTiles() {
  const g    = getGlobalInputs();
  const wrap = document.getElementById('summaryTiles');
  if (!wrap) return;

  let totalWL = 0, totalFTE = 0, highRisk = 0;
  state.queues.forEach(q => {
    const r = calculateQueue(q, g);
    totalWL  += r.totalIncrementalWorkload;
    totalFTE += r.adjustedFTE;
    if (r.risk === 'High') highRisk++;
  });

  const startDec   = toDecimal(g.startTime);
  const endDec     = toDecimal(g.endTime);
  const recastDec  = toDecimal(g.reforecastTime);
  const pctElapsed = Math.round(((recastDec - startDec) / Math.max(endDec - startDec, 0.001)) * 100);

  const wlClass   = Math.abs(totalWL)  > 2   ? 'tile-red'   : Math.abs(totalWL)  > 0.8 ? 'tile-amber' : 'tile-green';
  const fteClass  = Math.abs(totalFTE) > 2   ? 'tile-red'   : Math.abs(totalFTE) > 0.5 ? 'tile-amber' : 'tile-green';
  const riskClass = highRisk > 0              ? 'tile-red'   : 'tile-green';

  const tile = (cls, val, lbl, sub) => `
    <div class="tile ${cls}">
      <div class="tile-accent-bar"></div>
      <div class="tile-val">${val}</div>
      <div class="tile-lbl">${lbl}</div>
      <div class="tile-sub">${sub}</div>
    </div>`;

  wrap.innerHTML =
    tile(wlClass,   `${sign(totalWL)}${fmtHrs(Math.abs(totalWL))}`, 'Net Δ Workload', 'hrs incremental') +
    tile(fteClass,  `${sign(totalFTE)}${fmtFTE(Math.abs(totalFTE))}`, 'FTE Impact', 'occ-adjusted') +
    tile(riskClass, `${highRisk}`, 'High-Risk Queues', `of ${state.queues.length} total`) +
    tile('tile-blue',   `${pctElapsed}%`, 'Shift Elapsed', 'confidence window') +
    tile('tile-purple', `${state.queues.length}`, 'Active Queues', 'being monitored');
}

// ─── RENDER: DETAILED BREAKDOWN ──────────────────────────────────────────────

function renderDetail() {
  const tabBar = document.getElementById('tabBar');
  const panel  = document.getElementById('detailPanel');
  if (!tabBar || !panel) return;

  tabBar.innerHTML = state.queues.map(q =>
    `<button class="tab-btn${q.id === state.selectedQueueId ? ' active' : ''}" data-tabid="${q.id}">${q.name}</button>`
  ).join('');

  tabBar.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedQueueId = parseInt(btn.dataset.tabid);
      renderDetail(); renderQueues();
    });
  });

  const selQ = state.queues.find(q => q.id === state.selectedQueueId);
  if (!selQ) { panel.innerHTML = '<p style="color:var(--text-dim);font-size:13px;padding:8px;">Select a queue tab above.</p>'; return; }

  const g = getGlobalInputs();
  const r = calculateQueue(selQ, g);
  const confPct   = Math.round(r.confidence * 100);
  const confColor = confPct >= 70 ? 'var(--green)' : confPct >= 40 ? 'var(--amber)' : 'var(--red)';
  const netProdHrs = g.paidHours * (1 - g.shrinkagePct / 100);

  panel.innerHTML = `
    <div class="detail-grid">
      <div class="detail-block">
        <div class="detail-block-title">Volume Analysis</div>
        ${dRow('Full-Day Forecast',   fmtVol(selQ.forecastVolume),         '')}
        ${dRow('Forecast-to-Now',     fmtVol(r.forecastToNowVolume),       '')}
        ${dRow('Actual-to-Now',       fmtVol(r.actualVolume),              '')}
        ${dRow('Volume Delta',        sign(r.volDevPct)+fmtPct(r.volDevPct)+'%', r.volDevPct>0?'red':r.volDevPct<0?'green':'')}
        ${dRow('Run Rate (calls/hr)', r.runRate.toFixed(1),                'blue')}
        ${dRow('Revised Full-Day Vol',fmtVol(r.revisedFullDay),            'amber')}
        ${dRow('Vol-Driven Δ Work',   sign(r.volWorkloadDelta)+fmtHrs(Math.abs(r.volWorkloadDelta))+' hrs', r.volWorkloadDelta>0?'red':r.volWorkloadDelta<0?'green':'')}
      </div>
      <div class="detail-block">
        <div class="detail-block-title">AHT Analysis</div>
        ${dRow('Forecast AHT',            selQ.forecastAHT+'s', '')}
        ${dRow('Actual AHT',              selQ.actualAHT+'s',   '')}
        ${dRow('AHT Delta',               sign(r.ahtDevPct)+fmtPct(r.ahtDevPct)+'%', r.ahtDevPct>0?'red':r.ahtDevPct<0?'green':'')}
        ${dRow('AHT-Driven Δ Work',       sign(r.ahtWorkloadDelta)+fmtHrs(Math.abs(r.ahtWorkloadDelta))+' hrs', r.ahtWorkloadDelta>0?'red':r.ahtWorkloadDelta<0?'green':'')}
        ${dRow('Fcst-to-Now Workload',    fmtHrs(r.fcstNowWork)+' hrs', '')}
        ${dRow('Actual-to-Now Workload',  fmtHrs(r.actNowWork)+' hrs', '')}
        ${dRow('Net Δ Workload',          sign(r.totalIncrementalWorkload)+fmtHrs(Math.abs(r.totalIncrementalWorkload))+' hrs', r.totalIncrementalWorkload>0?'red':r.totalIncrementalWorkload<0?'green':'')}
      </div>
      <div class="detail-block">
        <div class="detail-block-title">FTE Impact Decomposition</div>
        ${dRow('Paid Hrs / Agent',          g.paidHours+' hrs', '')}
        ${dRow('Shrinkage',                 g.shrinkagePct+'%', '')}
        ${dRow('Net Productive Hrs',        fmtHrs(netProdHrs)+' hrs', '')}
        ${dRow('Occupancy Target',          g.occupancyTarget+'%', '')}
        ${dRow('Vol-Driven FTE Δ',          sign(r.volFTE)+fmtFTE(Math.abs(r.volFTE)), r.volFTE>0?'red':r.volFTE<0?'green':'')}
        ${dRow('AHT-Driven FTE Δ',          sign(r.ahtFTE)+fmtFTE(Math.abs(r.ahtFTE)), r.ahtFTE>0?'red':r.ahtFTE<0?'green':'')}
        ${dRow('Total FTE Impact (occ-adj)',sign(r.adjustedFTE)+fmtFTE(Math.abs(r.adjustedFTE)), r.adjustedFTE>0?'red':r.adjustedFTE<0?'green':'')}
      </div>
      <div class="detail-block">
        <div class="detail-block-title">Confidence &amp; Classification</div>
        ${dRow('Shift Elapsed', Math.round(r.elapsedFrac*100)+'%', 'blue')}
        <div class="detail-row">
          <span class="detail-key">Confidence Score</span>
          <span class="detail-val" style="color:${confColor}">${confPct}%</span>
        </div>
        <div class="detail-row" style="padding-bottom:8px;">
          <div style="width:100%;">
            <div class="confidence-track" style="margin-top:5px;">
              <div class="confidence-fill" style="width:${confPct}%;"></div>
            </div>
          </div>
        </div>
        <div class="detail-row">
          <span class="detail-key">Primary Driver</span>
          <span class="driver-tag driver-${r.driver}">${r.driver}</span>
        </div>
        <div class="detail-row">
          <span class="detail-key">Risk Level</span>
          <span class="risk-pill risk-${r.risk.toLowerCase()}">${r.risk}</span>
        </div>
        ${dRow('Projection Blend', confPct+'% run-rate / '+(100-confPct)+'% plan', '')}
      </div>
    </div>
    <div class="detail-block" style="margin-top:14px;">
      <div class="detail-block-title">Workload Breakdown — Visual</div>
      <div class="workload-chart" id="wlChart"></div>
      <div class="wl-labels"     id="wlLabels"></div>
    </div>`;

  // Mini bar chart
  const bars = [
    { label: 'Fcst-Now WL', val: r.fcstNowWork,                       color: '#2563eb' },
    { label: 'Act-Now WL',  val: r.actNowWork,                         color: r.actNowWork > r.fcstNowWork ? '#dc2626' : '#059669' },
    { label: 'Vol Δ WL',    val: Math.abs(r.volWorkloadDelta),          color: r.volWorkloadDelta  > 0 ? '#dc2626' : '#059669' },
    { label: 'AHT Δ WL',   val: Math.abs(r.ahtWorkloadDelta),          color: r.ahtWorkloadDelta  > 0 ? '#d97706' : '#059669' },
    { label: 'Net Δ WL',   val: Math.abs(r.totalIncrementalWorkload),   color: r.totalIncrementalWorkload > 0 ? '#dc2626' : '#059669' }
  ];
  const maxVal  = Math.max(...bars.map(b => b.val), 0.001);
  const chartEl = document.getElementById('wlChart');
  const labEL   = document.getElementById('wlLabels');
  if (chartEl && labEL) {
    chartEl.innerHTML = bars.map(b => {
      const px = Math.max((b.val / maxVal) * 72, 2);
      return `<div class="wl-bar" style="background:${b.color};height:${px}px;opacity:0.85;" data-tip="${b.label}: ${fmtHrs(b.val)} hrs"></div>`;
    }).join('');
    labEL.innerHTML = bars.map(b => `<div class="wl-label">${b.label}</div>`).join('');
  }
}

function dRow(key, val, colorClass) {
  return `
    <div class="detail-row">
      <span class="detail-key">${key}</span>
      <span class="detail-val${colorClass ? ' ' + colorClass : ''}">${val}</span>
    </div>`;
}

// ─── REFRESH OPS SUMMARY ─────────────────────────────────────────────────────

function refreshOpsSummary() {
  const el = document.getElementById('opsSummaryBody');
  if (el) el.textContent = generateOpsSummary();
}

// ─── RENDER ALL ───────────────────────────────────────────────────────────────

function renderAll() {
  renderQueues();
  renderOutputTable();
  renderSummaryTiles();
  renderDetail();
  refreshOpsSummary();
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────

// Global settings
['startTime','endTime','reforecastTime','paidHours','shrinkagePct','occupancyTarget'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderAll);
});

// Add queue
document.getElementById('addQueueBtn')?.addEventListener('click', () => {
  const newId = state.nextId++;
  state.queues.push({
    id: newId, name: `Queue ${newId}`,
    forecastVolume: 300, forecastToNowVolume: 120,
    forecastAHT: 200, actualVolume: 130, actualAHT: 200
  });
  state.selectedQueueId = newId;
  renderAll();
});

// Email send buttons
document.getElementById('btnOutlook')?.addEventListener('click', sendOutlook);
document.getElementById('btnGmail')?.addEventListener('click', sendGmail);
document.getElementById('btnCopy')?.addEventListener('click', copyToClipboard);

// Email config → refresh subject in preview
['emailTo','emailCc','emailSubject'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', refreshOpsSummary);
});

// n8n
document.getElementById('webhookTriggerBtn')?.addEventListener('click', triggerN8nWebhook);

// n8n send via email button inside email section
document.getElementById('btnN8nEmail')?.addEventListener('click', triggerN8nWebhook);

// ─── INIT ─────────────────────────────────────────────────────────────────────

renderAll();
