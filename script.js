// ═══════════════════════════════════════════════════════════
// INTRADAY REFORECAST CALCULATOR
// Abdul Basit Everise — WFM Architect @ Everise
// Calculation engine + rendering + email automation
// ═══════════════════════════════════════════════════════════

// ── STATE ────────────────────────────────────────────────────
let queues = [
  { id: 1, name: 'Queue 1', fullDayForecast: 600, forecastToNow: 240, actualNow: 270, forecastAHT: 420, actualAHT: 420 }
];
let nextId = 2;
let openAccordions = new Set([1]);
let lastResults = null;
let lastGlobals = null;

// ── UTILITIES ────────────────────────────────────────────────
const toDecimal = t => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
};

const fmt2   = v => isNaN(v) ? '0.00' : v.toFixed(2);
const fmt1   = v => (isNaN(v) || !isFinite(v)) ? '0.0' : v.toFixed(1);
const fmtInt = v => isNaN(v) ? '0' : Math.round(v).toString();
const sign   = v => v > 0 ? '+' : '';

function getGlobals() {
  return {
    shiftStart:   toDecimal(document.getElementById('shiftStart').value  || '09:00'),
    shiftEnd:     toDecimal(document.getElementById('shiftEnd').value    || '23:00'),
    reforecastAt: toDecimal(document.getElementById('reforecastAt').value || '13:00'),
    paidHours:    parseFloat(document.getElementById('paidHours').value)  || 7.5,
    shrinkage:    parseFloat(document.getElementById('shrinkage').value)  || 30,
    occupancy:    parseFloat(document.getElementById('occupancy').value)  || 85,
  };
}

// ── CALCULATION ENGINE ───────────────────────────────────────
function calcQueue(q, g) {
  const totalHrs   = Math.max(g.shiftEnd - g.shiftStart, 0.001);
  const elapsedHrs = Math.max(Math.min(g.reforecastAt - g.shiftStart, totalHrs), 0.001);
  const remainHrs  = Math.max(totalHrs - elapsedHrs, 0);

  const elapsedFrac = elapsedHrs / totalHrs;
  const elapsedPct  = elapsedFrac * 100;

  let wForecast, wRunRate;
  if (elapsedPct < 50) {
    wForecast = 0.70; wRunRate = 0.30;
  } else if (elapsedPct <= 70) {
    wForecast = 0.50; wRunRate = 0.50;
  } else {
    wForecast = 0.30; wRunRate = 0.70;
  }

  const confidence = elapsedPct < 50 ? 'Low' : elapsedPct <= 70 ? 'Medium' : 'High';

  const runRateFullDay = elapsedFrac > 0 ? (q.actualNow / elapsedFrac) : q.fullDayForecast;
  const revisedFullDay = wForecast * q.fullDayForecast + wRunRate * runRateFullDay;

  const volDevPct = q.forecastToNow > 0
    ? ((q.actualNow - q.forecastToNow) / q.forecastToNow) * 100
    : 0;

  const ahtDevPct = q.forecastAHT > 0
    ? ((q.actualAHT - q.forecastAHT) / q.forecastAHT) * 100
    : 0;

  const absVolDev = Math.abs(volDevPct);
  let opStatus;
  if      (absVolDev <= 5)  opStatus = 'On Track';
  else if (absVolDev <= 10) opStatus = 'Monitor';
  else                      opStatus = 'Risk';

  const absAHTDev = Math.abs(ahtDevPct);
  let driver;
  if      (absVolDev > 5 && absAHTDev > 5) driver = 'Mixed';
  else if (absVolDev >= absAHTDev && absVolDev > 2) driver = 'Volume';
  else if (absAHTDev > absVolDev && absAHTDev > 2)  driver = 'AHT';
  else                                               driver = 'Normal';

  const fAHThr = q.forecastAHT / 3600;
  const aAHThr = q.actualAHT   / 3600;

  const volWorkloadDelta = (q.actualNow - q.forecastToNow) * fAHThr;
  const ahtWorkloadDelta = q.actualNow * (aAHThr - fAHThr);
  const totalWorkloadDelta = volWorkloadDelta + ahtWorkloadDelta;

  const shrinkFrac      = g.shrinkage / 100;
  const occupancyFrac   = g.occupancy / 100;
  const netProdHrs      = g.paidHours * (1 - shrinkFrac);
  const adjustedProdHrs = netProdHrs * occupancyFrac;
  const fteImpact       = adjustedProdHrs > 0 ? totalWorkloadDelta / adjustedProdHrs : 0;

  const runRatePerHr = elapsedHrs > 0 ? q.actualNow / elapsedHrs : 0;

  return {
    elapsedPct, elapsedFrac, elapsedHrs, remainHrs, totalHrs,
    wForecast, wRunRate,
    confidence, opStatus, driver,
    runRateFullDay, revisedFullDay,
    volDevPct, ahtDevPct,
    volWorkloadDelta, ahtWorkloadDelta, totalWorkloadDelta,
    fteImpact, netProdHrs, adjustedProdHrs, runRatePerHr
  };
}

function overallStatus(results) {
  if (results.some(r => r.opStatus === 'Risk'))    return 'Risk';
  if (results.some(r => r.opStatus === 'Monitor')) return 'Monitor';
  return 'On Track';
}

// ── EMAIL BODY GENERATOR ─────────────────────────────────────
function buildEmailBody(results, g) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });

  const overall = overallStatus(results);
  const totalFTE    = results.reduce((s, r) => s + r.fteImpact, 0);
  const totalWLDelta= results.reduce((s, r) => s + r.totalWorkloadDelta, 0);
  const avgVolDev   = results.reduce((s, r) => s + r.volDevPct, 0) / results.length;
  const avgAHTDev   = results.reduce((s, r) => s + r.ahtDevPct, 0) / results.length;
  const totalRevFD  = results.reduce((s, r) => s + r.revisedFullDay, 0);
  const totalFcstFD = queues.reduce((s, q) => s + q.fullDayForecast, 0);
  const r0 = results[0];

  const statusEmoji = { 'On Track': '✅', 'Monitor': '⚠️', 'Risk': '🚨' }[overall];
  const fteDir = totalFTE > 0.5 ? `+${fmt1(totalFTE)} FTE NEEDED` : totalFTE < -0.5 ? `${fmt1(totalFTE)} FTE SURPLUS` : 'FTE STABLE';

  let queueRows = '';
  results.forEach((r, i) => {
    const q = queues[i];
    const statusIcon = { 'On Track': '✅', 'Monitor': '⚠️', 'Risk': '🚨' }[r.opStatus];
    queueRows += `
  ${q.name.padEnd(20)} | Vol Dev: ${(sign(r.volDevPct)+fmt1(r.volDevPct)+'%').padStart(7)} | AHT Dev: ${(sign(r.ahtDevPct)+fmt1(r.ahtDevPct)+'%').padStart(7)} | FTE: ${(sign(r.fteImpact)+fmt1(Math.abs(r.fteImpact))).padStart(5)} | ${r.opStatus.padEnd(8)} ${statusIcon} | Driver: ${r.driver}`;
  });

  const reforecastTime = document.getElementById('reforecastAt').value || '13:00';

  return `INTRADAY REFORECAST SUMMARY — ${dateStr}
Generated: ${timeStr} | Reforecast Point: ${reforecastTime}
Prepared by: Abdul Basit Everise — WFM Architect @ Everise
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OVERALL STATUS: ${overall.toUpperCase()} ${statusEmoji}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HEADLINE METRICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Avg Volume Deviation:   ${sign(avgVolDev)}${fmt1(avgVolDev)}%
  Avg AHT Deviation:      ${sign(avgAHTDev)}${fmt1(avgAHTDev)}%
  Net Workload Delta:     ${sign(totalWLDelta)}${fmt2(Math.abs(totalWLDelta))} hrs
  FTE Impact:             ${fteDir}
  Revised Full-Day Vol:   ${fmtInt(totalRevFD)} (forecast was ${fmtInt(totalFcstFD)})
  Forecast Confidence:    ${r0.confidence} (${Math.round(r0.elapsedPct)}% of shift elapsed)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUEUE BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${queueRows}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHIFT SETTINGS USED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Shift Window:    ${document.getElementById('shiftStart').value} – ${document.getElementById('shiftEnd').value}
  Reforecast At:   ${reforecastTime}
  Paid Hrs/Agent:  ${g.paidHours}h
  Shrinkage:       ${g.shrinkage}%
  Occ Target:      ${g.occupancy}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BLENDING METHODOLOGY (${r0.elapsedPct < 50 ? 'Early Shift' : r0.elapsedPct <= 70 ? 'Mid Shift' : 'Late Shift'} Phase)
  Forecast Weight: ${Math.round(r0.wForecast * 100)}%  |  Run-Rate Weight: ${Math.round(r0.wRunRate * 100)}%
  Variance flags: ≤5% = On Track · 5–10% = Monitor · >10% = Risk

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This report was generated by the Intraday Reforecast Calculator.
All calculations run in-browser. No data is sent to any server.
WFM Tools · Abdul Basit Everise — WFM Architect @ Everise`;
}

// ── EMAIL SUBJECT GENERATOR ──────────────────────────────────
function buildEmailSubject() {
  const overall = lastResults ? overallStatus(lastResults) : 'Unknown';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  const statusTag = { 'On Track': '✅ ON TRACK', 'Monitor': '⚠️ MONITOR', 'Risk': '🚨 RISK' }[overall] || overall;
  return `[WFM Reforecast] ${statusTag} — Intraday Update @ ${timeStr}`;
}

// ── EMAIL PANEL RENDER ────────────────────────────────────────
function renderEmailPanel() {
  const existing = document.getElementById('emailPanel');
  if (existing) existing.remove();

  if (!lastResults) return;

  const emailBody = buildEmailBody(lastResults, lastGlobals);

  const panel = document.createElement('div');
  panel.id = 'emailPanel';
  panel.className = 'email-panel';
  panel.innerHTML = `
    <div class="email-panel-header">
      <div class="email-panel-title">
        <div class="email-panel-icon">✉</div>
        Send Operational Summary
      </div>
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;">Automation Ready</span>
    </div>
    <div class="email-panel-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div class="email-field-row">
          <label>To (Recipients)</label>
          <input class="email-input" id="emailTo" type="text" placeholder="manager@company.com, ops@company.com" />
        </div>
        <div class="email-field-row">
          <label>CC (Optional)</label>
          <input class="email-input" id="emailCc" type="text" placeholder="wfm-team@company.com" />
        </div>
      </div>
      <div class="email-field-row" style="margin-bottom:16px;">
        <label>Subject</label>
        <input class="email-input" id="emailSubject" type="text" value="${buildEmailSubject()}" />
      </div>
      <div class="email-field-row" style="margin-bottom:16px;">
        <label>Message Preview (auto-generated — editable)</label>
        <textarea class="email-preview" id="emailBodyField" style="width:100%;resize:vertical;font-family:var(--font-mono);font-size:11px;color:var(--text-mid);background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;outline:none;min-height:220px;">${emailBody}</textarea>
      </div>
      <div class="email-actions">
        <button class="btn btn-email" id="sendOutlookBtn">
          <span>📧</span> Open in Outlook
        </button>
        <button class="btn btn-email" id="sendGmailBtn">
          <span>✉</span> Open in Gmail
        </button>
        <button class="btn btn-email" id="sendMailtoBtn">
          <span>⚡</span> Open Default Mail
        </button>
        <button class="btn btn-ghost" id="copyEmailBtn">
          <span>⎘</span> Copy Summary
        </button>
      </div>
      <div style="margin-top:12px;padding:10px 14px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--radius);font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">
        💡 Gmail & Outlook buttons open a pre-filled compose window in your browser. Default Mail uses your system email client. Copy Summary copies the plain-text report.
      </div>
    </div>`;

  // Insert after results section
  const resultsSection = document.getElementById('resultsSection');
  resultsSection.parentNode.insertBefore(panel, resultsSection.nextSibling);

  // ── Button handlers ──
  document.getElementById('sendOutlookBtn').addEventListener('click', () => {
    const to      = encodeURIComponent(document.getElementById('emailTo').value || '');
    const cc      = encodeURIComponent(document.getElementById('emailCc').value || '');
    const subject = encodeURIComponent(document.getElementById('emailSubject').value);
    const body    = encodeURIComponent(document.getElementById('emailBodyField').value);
    const url = `https://outlook.office.com/mail/deeplink/compose?to=${to}&cc=${cc}&subject=${subject}&body=${body}`;
    window.open(url, '_blank');
    toast('Opening Outlook Web — check your new tab!', 'green');
  });

  document.getElementById('sendGmailBtn').addEventListener('click', () => {
    const to      = encodeURIComponent(document.getElementById('emailTo').value || '');
    const cc      = encodeURIComponent(document.getElementById('emailCc').value || '');
    const subject = encodeURIComponent(document.getElementById('emailSubject').value);
    const body    = encodeURIComponent(document.getElementById('emailBodyField').value);
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&cc=${cc}&su=${subject}&body=${body}`;
    window.open(url, '_blank');
    toast('Opening Gmail — check your new tab!', 'green');
  });

  document.getElementById('sendMailtoBtn').addEventListener('click', () => {
    const to      = encodeURIComponent(document.getElementById('emailTo').value || '');
    const cc      = encodeURIComponent(document.getElementById('emailCc').value || '');
    const subject = encodeURIComponent(document.getElementById('emailSubject').value);
    const body    = encodeURIComponent(document.getElementById('emailBodyField').value);
    const url = `mailto:${to}?cc=${cc}&subject=${subject}&body=${body}`;
    window.location.href = url;
    toast('Opening your default mail app!', 'green');
  });

  document.getElementById('copyEmailBtn').addEventListener('click', () => {
    const body = document.getElementById('emailBodyField').value;
    navigator.clipboard.writeText(body).then(() => {
      toast('Summary copied to clipboard!', 'green');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = body;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Summary copied!', 'green');
    });
  });
}

// ── RENDER: QUEUE INPUT ROWS ─────────────────────────────────
function renderQueues() {
  const list = document.getElementById('queueList');
  list.innerHTML = '';

  queues.forEach(q => {
    const isOpen = openAccordions.has(q.id);
    const div = document.createElement('div');
    div.className = 'queue-row';
    div.innerHTML = `
      <div class="queue-row-head" data-qid="${q.id}">
        <input class="queue-name-input" value="${q.name}" data-qid="${q.id}" placeholder="Queue name">
        <div class="queue-row-meta">
          ${queues.length > 1 ? `<button class="queue-remove-btn" data-remove="${q.id}">✕ Remove</button>` : ''}
          <span style="font-size:10px;color:var(--text-dim);font-family:var(--font-mono);">${isOpen ? '▲' : '▼'}</span>
        </div>
      </div>
      <div class="queue-row-body" style="display:${isOpen ? 'block' : 'none'}">
        <div class="input-grid">
          ${qf('fullDayForecast', 'Full-Day Forecast Volume', q.fullDayForecast, q.id)}
          ${qf('forecastToNow',   'Forecast-to-Now Volume',   q.forecastToNow,   q.id)}
          ${qf('actualNow',       'Actual Volume to Now',     q.actualNow,       q.id)}
          ${qf('forecastAHT',     'Forecast AHT (seconds)',   q.forecastAHT,     q.id, 'e.g. 420 = 7 min')}
          ${qf('actualAHT',       'Actual AHT (seconds)',     q.actualAHT,       q.id, 'e.g. 440 = 7.3 min')}
        </div>
      </div>`;
    list.appendChild(div);
  });

  // Events
  list.querySelectorAll('.queue-row-head').forEach(head => {
    head.addEventListener('click', e => {
      if (e.target.classList.contains('queue-name-input')) return;
      if (e.target.dataset.remove) return;
      const id = parseInt(head.dataset.qid);
      if (openAccordions.has(id)) openAccordions.delete(id);
      else openAccordions.add(id);
      renderQueues();
    });
  });

  list.querySelectorAll('.queue-name-input').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('input', e => {
      const q = queues.find(x => x.id === parseInt(e.target.dataset.qid));
      if (q) q.name = e.target.value;
    });
  });

  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.remove);
      queues = queues.filter(q => q.id !== id);
      openAccordions.delete(id);
      renderQueues();
      if (document.getElementById('resultsSection').style.display !== 'none') calculate();
    });
  });

  list.querySelectorAll('input[data-qid][data-key]').forEach(inp => {
    inp.addEventListener('input', e => {
      const q = queues.find(x => x.id === parseInt(e.target.dataset.qid));
      if (q) q[e.target.dataset.key] = parseFloat(e.target.value) || 0;
    });
  });
}

function qf(key, label, val, qid, hint) {
  return `
    <div class="field">
      <label class="field-label">${label}</label>
      <input class="input" type="number" value="${val}" data-qid="${qid}" data-key="${key}" min="0" step="1">
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
    </div>`;
}

// ── RENDER: RESULTS ──────────────────────────────────────────
function renderResults(results, g) {
  lastResults = results;
  lastGlobals = g;

  const section = document.getElementById('resultsSection');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const overall = overallStatus(results);
  const bannerEl = document.getElementById('statusBanner');

  const bannerCfg = {
    'On Track': {
      cls: 'status-banner-on-track', icon: '✓', label: 'On Track',
      msg: 'Performance within ±5% of forecast.',
      sub: `Across all ${results.length} queue${results.length > 1 ? 's' : ''}, volume and AHT are within acceptable tolerance.`
    },
    'Monitor': {
      cls: 'status-banner-monitor', icon: '⚠', label: 'Monitor',
      msg: 'Variance approaching operational threshold.',
      sub: 'One or more queues are between 5–10% off forecast. Watch closely and prepare contingencies.'
    },
    'Risk': {
      cls: 'status-banner-risk', icon: '✕', label: 'Risk',
      msg: 'Significant deviation from forecast detected.',
      sub: 'One or more queues exceed 10% variance. Immediate staffing review recommended.'
    }
  };

  const bc = bannerCfg[overall];
  bannerEl.innerHTML = `
    <div class="status-banner ${bc.cls}">
      <div class="status-banner-icon">${bc.icon}</div>
      <div class="status-banner-content">
        <div class="status-banner-label">${bc.label}</div>
        <div class="status-banner-msg">${bc.msg}</div>
        <div class="status-banner-sub">${bc.sub}</div>
      </div>
    </div>`;

  // ── Summary metrics grid ──
  const totalFTE     = results.reduce((s, r) => s + r.fteImpact, 0);
  const totalWLDelta = results.reduce((s, r) => s + r.totalWorkloadDelta, 0);
  const avgVolDev    = results.reduce((s, r) => s + r.volDevPct, 0) / results.length;
  const avgAHTDev    = results.reduce((s, r) => s + r.ahtDevPct, 0) / results.length;
  const totalRevFD   = results.reduce((s, r) => s + r.revisedFullDay, 0);
  const totalFcstFD  = queues.reduce((s, q) => s + q.fullDayForecast, 0);

  const r0 = results[0];
  const elPct = Math.round(r0.elapsedPct);

  const volDevClass = Math.abs(avgVolDev) <= 5 ? 'green' : Math.abs(avgVolDev) <= 10 ? 'yellow' : 'red';
  const fteClass    = totalFTE > 0.5 ? 'red' : totalFTE < -0.5 ? 'green' : 'blue';
  const confClass   = { Low: 'blue', Medium: 'yellow', High: 'green' }[r0.confidence] || 'blue';
  const statusClass = { 'On Track': 'green', 'Monitor': 'yellow', 'Risk': 'red' }[overall];

  const summaryEl = document.getElementById('summaryGrid');
  summaryEl.innerHTML = [
    metricCard('accent-neutral', 'Forecast-to-Now',  fmtInt(queues.reduce((s,q)=>s+q.forecastToNow,0)), 'planned calls so far', ''),
    metricCard('accent-neutral', 'Actual-to-Now',    fmtInt(queues.reduce((s,q)=>s+q.actualNow,0)),    'actual calls received', ''),
    metricCard(`accent-${volDevClass}`, 'Volume Dev', `${sign(avgVolDev)}${fmt1(avgVolDev)}%`, 'vs forecast-to-now', volDevClass),
    metricCard(`accent-${volDevClass}`, 'AHT Dev',    `${sign(avgAHTDev)}${fmt1(avgAHTDev)}%`, 'vs forecast AHT', Math.abs(avgAHTDev) <= 5 ? 'green' : Math.abs(avgAHTDev) <= 10 ? 'yellow' : 'red'),
    metricCard(`accent-${fteClass}`,   'FTE Impact',  `${sign(totalFTE)}${fmt1(Math.abs(totalFTE))}`, `${totalFTE > 0 ? 'additional FTE needed' : totalFTE < 0 ? 'FTE surplus' : 'no change'}`, fteClass),
    metricCard('accent-neutral', 'Revised Full-Day', fmtInt(totalRevFD), `forecast was ${fmtInt(totalFcstFD)}`, ''),
    metricCard(`accent-${confClass}`,  'Confidence',  r0.confidence, `${elPct}% of shift elapsed`, confClass),
    metricCard(`accent-${statusClass}`,'Status',      overall, 'operational classification', statusClass),
  ].join('');

  // ── Queue breakdown table ──
  const tbody = document.getElementById('resultsTableBody');
  tbody.innerHTML = '';

  results.forEach((r, i) => {
    const q = queues[i];
    const wCls = r.totalWorkloadDelta > 0 ? 'pos' : r.totalWorkloadDelta < 0 ? 'neg' : '';
    const fCls = r.fteImpact > 0 ? 'pos' : r.fteImpact < 0 ? 'neg' : '';
    const pillCls     = { 'On Track': 'pill-on-track', 'Monitor': 'pill-monitor', 'Risk': 'pill-risk' }[r.opStatus];
    const confBadgeCls= { Low: 'conf-low', Medium: 'conf-medium', High: 'conf-high' }[r.confidence];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-queue">${q.name}</td>
      <td class="td-num">${fmtInt(q.forecastToNow)}</td>
      <td class="td-num">${fmtInt(q.actualNow)}</td>
      <td class="td-num ${r.volDevPct > 0 ? 'pos' : r.volDevPct < 0 ? 'neg' : ''}">${sign(r.volDevPct)}${fmt1(r.volDevPct)}%</td>
      <td class="td-num ${r.ahtDevPct > 0 ? 'pos' : r.ahtDevPct < 0 ? 'neg' : ''}">${sign(r.ahtDevPct)}${fmt1(r.ahtDevPct)}%</td>
      <td class="td-num ${wCls}">${sign(r.totalWorkloadDelta)}${fmt2(Math.abs(r.totalWorkloadDelta))}</td>
      <td class="td-num ${fCls}">${sign(r.fteImpact)}${fmt1(Math.abs(r.fteImpact))}</td>
      <td><span class="driver-badge driver-${r.driver}">${r.driver}</span></td>
      <td><span class="status-pill ${pillCls}">${r.opStatus}</span></td>
      <td><span class="conf-badge ${confBadgeCls}"><span class="conf-dot"></span>${r.confidence}</span></td>
    `;
    tbody.appendChild(tr);
  });

  // ── Detail accordions ──
  const detailEl = document.getElementById('detailAccordions');
  detailEl.innerHTML = '';

  results.forEach((r, i) => {
    const q = queues[i];
    const phaseLabel = r.elapsedPct < 50 ? 'Early (70% Fcst / 30% Run-rate)' : r.elapsedPct <= 70 ? 'Mid (50% / 50%)' : 'Late (30% Fcst / 70% Run-rate)';

    const acc = document.createElement('div');
    acc.className = 'detail-accordion open';
    acc.innerHTML = `
      <div class="detail-accordion-head">
        <span>${q.name} — Detail</span>
        <span class="detail-accordion-arrow">▾</span>
      </div>
      <div class="detail-accordion-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div>
            <div style="font-family:var(--font-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px;">Volume</div>
            <div class="detail-row-list">
              ${dr('Full-Day Forecast',    fmtInt(q.fullDayForecast), '')}
              ${dr('Forecast-to-Now',      fmtInt(q.forecastToNow), '')}
              ${dr('Actual-to-Now',        fmtInt(q.actualNow), '')}
              ${dr('Volume Deviation',     sign(r.volDevPct)+fmt1(r.volDevPct)+'%', r.volDevPct > 0 ? 'red' : r.volDevPct < 0 ? 'green' : '')}
              ${dr('Run Rate (calls/hr)',  fmt1(r.runRatePerHr), 'blue')}
              ${dr('Run-Rate Full-Day Est.',fmtInt(r.runRateFullDay), '')}
              ${dr('Revised Full-Day Vol', fmtInt(r.revisedFullDay), r.revisedFullDay > q.fullDayForecast ? 'red' : r.revisedFullDay < q.fullDayForecast ? 'green' : '')}
            </div>
          </div>
          <div>
            <div style="font-family:var(--font-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px;">AHT &amp; Workload</div>
            <div class="detail-row-list">
              ${dr('Forecast AHT',         q.forecastAHT+'s ('+fmt1(q.forecastAHT/60)+' min)', '')}
              ${dr('Actual AHT',           q.actualAHT+'s ('+fmt1(q.actualAHT/60)+' min)', '')}
              ${dr('AHT Deviation',        sign(r.ahtDevPct)+fmt1(r.ahtDevPct)+'%', r.ahtDevPct > 0 ? 'red' : r.ahtDevPct < 0 ? 'green' : '')}
              ${dr('Vol-Driven Δ Work',    sign(r.volWorkloadDelta)+fmt2(Math.abs(r.volWorkloadDelta))+' hrs', r.volWorkloadDelta > 0 ? 'red' : r.volWorkloadDelta < 0 ? 'green' : '')}
              ${dr('AHT-Driven Δ Work',    sign(r.ahtWorkloadDelta)+fmt2(Math.abs(r.ahtWorkloadDelta))+' hrs', r.ahtWorkloadDelta > 0 ? 'red' : r.ahtWorkloadDelta < 0 ? 'green' : '')}
              ${dr('Net Workload Delta',   sign(r.totalWorkloadDelta)+fmt2(Math.abs(r.totalWorkloadDelta))+' hrs', r.totalWorkloadDelta > 0 ? 'red' : r.totalWorkloadDelta < 0 ? 'green' : '')}
              ${dr('FTE Impact',           sign(r.fteImpact)+fmt1(Math.abs(r.fteImpact)), r.fteImpact > 0 ? 'red' : r.fteImpact < 0 ? 'green' : '')}
            </div>
          </div>
        </div>
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-family:var(--font-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px;">Projection Settings</div>
          <div class="detail-row-list">
            ${dr('Shift Progress',    Math.round(r.elapsedPct)+'%', '')}
            ${dr('Projection Phase',  phaseLabel, '')}
            ${dr('Confidence',        r.confidence, { Low:'red', Medium:'yellow', High:'green' }[r.confidence])}
            ${dr('Primary Driver',    r.driver, '')}
            ${dr('Operational Status',r.opStatus, { 'On Track':'green', 'Monitor':'yellow', 'Risk':'red' }[r.opStatus])}
          </div>
          <div class="progress-wrap" style="margin-top:12px;">
            <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);white-space:nowrap;">Shift ${Math.round(r.elapsedPct)}% elapsed</span>
            <div class="progress-track">
              <div class="progress-fill" style="width:${Math.min(r.elapsedPct,100)}%;background:${r.confidence==='High'?'var(--neon-green)':r.confidence==='Medium'?'var(--neon-yellow)':'var(--neon-blue)'};"></div>
            </div>
          </div>
        </div>
      </div>`;

    acc.querySelector('.detail-accordion-head').addEventListener('click', () => {
      acc.classList.toggle('open');
    });

    detailEl.appendChild(acc);
  });

  // Show email panel
  renderEmailPanel();
}

function metricCard(accentCls, label, value, sub, colorCls) {
  return `
    <div class="metric-card">
      <div class="metric-accent ${accentCls}"></div>
      <div class="metric-label">${label}</div>
      <div class="metric-value${colorCls ? ' '+colorCls : ''}">${value}</div>
      <div class="metric-sub">${sub}</div>
    </div>`;
}

function dr(key, val, colorCls) {
  return `
    <div class="detail-row">
      <span class="detail-key">${key}</span>
      <span class="detail-val${colorCls ? ' '+colorCls : ''}">${val}</span>
    </div>`;
}

// ── CALCULATE ────────────────────────────────────────────────
function calculate() {
  const g = getGlobals();
  const results = queues.map(q => calcQueue(q, g));
  renderResults(results, g);
}

// ── EXAMPLE DATA ─────────────────────────────────────────────
function loadExample() {
  document.getElementById('shiftStart').value   = '08:00';
  document.getElementById('shiftEnd').value     = '20:00';
  document.getElementById('reforecastAt').value = '13:12';
  document.getElementById('paidHours').value    = '8';
  document.getElementById('shrinkage').value    = '30';
  document.getElementById('occupancy').value    = '85';

  queues = [{ id: 1, name: 'Example Queue', fullDayForecast: 600, forecastToNow: 240, actualNow: 270, forecastAHT: 420, actualAHT: 440 }];
  nextId = 2;
  openAccordions = new Set([1]);
  renderQueues();
  calculate();
  toast('Example data loaded!', 'green');
}

// ── RESET ────────────────────────────────────────────────────
function resetAll() {
  document.getElementById('shiftStart').value   = '09:00';
  document.getElementById('shiftEnd').value     = '23:00';
  document.getElementById('reforecastAt').value = '13:00';
  document.getElementById('paidHours').value    = '7.5';
  document.getElementById('shrinkage').value    = '30';
  document.getElementById('occupancy').value    = '85';

  queues = [{ id: 1, name: 'Queue 1', fullDayForecast: 600, forecastToNow: 240, actualNow: 270, forecastAHT: 420, actualAHT: 420 }];
  nextId = 2;
  openAccordions = new Set([1]);
  lastResults = null;
  lastGlobals = null;
  renderQueues();
  document.getElementById('resultsSection').style.display = 'none';
  const ep = document.getElementById('emailPanel');
  if (ep) ep.remove();
}

// ── TOAST ────────────────────────────────────────────────────
function toast(msg, cls) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = `toast${cls ? ' '+cls : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ── EVENT LISTENERS ──────────────────────────────────────────
document.getElementById('calcBtn').addEventListener('click', calculate);
document.getElementById('exampleBtn').addEventListener('click', loadExample);
document.getElementById('resetBtn').addEventListener('click', resetAll);

document.getElementById('addQueueBtn').addEventListener('click', () => {
  const id = nextId++;
  queues.push({ id, name: `Queue ${id}`, fullDayForecast: 400, forecastToNow: 160, actualNow: 170, forecastAHT: 360, actualAHT: 360 });
  openAccordions.add(id);
  renderQueues();
});

['shiftStart','shiftEnd','reforecastAt','paidHours','shrinkage','occupancy'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (document.getElementById('resultsSection').style.display !== 'none') calculate();
  });
});

// ── INIT ─────────────────────────────────────────────────────
renderQueues();
