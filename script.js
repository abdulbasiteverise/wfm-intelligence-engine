/**
 * WFM Intelligence Engine — script.js
 * Real-Time Workforce Command Center
 *
 * Modules:
 *  1. Clock & Shift Progress
 *  2. Erlang-C Staffing Engine
 *  3. Service Level Projection Engine
 *  4. Capacity vs Workload Engine
 *  5. Arrival Variability Analysis
 *  6. Forecast Health Analytics (MAPE, Bias, Accuracy)
 *  7. Automated Intraday Reforecast Engine
 *  8. Monte Carlo Simulation Engine
 *  9. Operational Health Score (0–100)
 * 10. Real-Time Staffing Action Engine
 * 11. AI Operations Explainer
 * 12. AI Intraday Forecasting Brain
 * 13. Sparkline Trend Charts
 * 14. Arrival Pattern Shift Detection
 *
 * All computations run entirely in the browser.
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════════
     STATE
  ════════════════════════════════════════════════════════════════ */
  const state = {
    history: {
      sl: [], runRate: [], vol: [], work: [], fte: [], agents: [],
    },
    lastResult: null,
    simRunning: false,
  };

  /* ════════════════════════════════════════════════════════════════
     MODULE 1 — CLOCK & SHIFT PROGRESS
  ════════════════════════════════════════════════════════════════ */
  function tickClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${h}:${m}:${s}`;

    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.textContent = timeStr;

    const footerEl = document.getElementById('footerTime');
    if (footerEl) footerEl.textContent = `Last updated: ${timeStr}`;

    updateShiftProgress();
  }

  function getShiftTimes() {
    const startVal = document.getElementById('shiftStart').value || '08:00';
    const endVal   = document.getElementById('shiftEnd').value   || '20:00';
    const [sh, sm] = startVal.split(':').map(Number);
    const [eh, em] = endVal.split(':').map(Number);
    const now      = new Date();
    const dayStart = new Date(now); dayStart.setHours(sh, sm, 0, 0);
    const dayEnd   = new Date(now); dayEnd.setHours(eh, em, 0, 0);
    return { start: dayStart, end: dayEnd, now };
  }

  function getShiftProgress() {
    const { start, end, now } = getShiftTimes();
    const total   = end - start;
    const elapsed = Math.max(0, Math.min(now - start, total));
    return total > 0 ? elapsed / total : 0;
  }

  function updateShiftProgress() {
    const pct = getShiftProgress() * 100;
    const fillEl = document.getElementById('shiftFillMini');
    const pctEl  = document.getElementById('shiftPctMini');
    if (fillEl) fillEl.style.width = pct.toFixed(1) + '%';
    if (pctEl)  pctEl.textContent  = pct.toFixed(0) + '%';
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 2 — ERLANG-C STAFFING ENGINE
  ════════════════════════════════════════════════════════════════ */

  /** Erlang-C formula: probability all agents busy */
  function erlangC(N, A) {
    // N = agents, A = traffic intensity (Erlangs)
    if (N <= A) return 1.0; // unstable
    let sum = 0;
    let factorial = 1;
    for (let i = 0; i <= N - 1; i++) {
      if (i > 0) factorial *= i;
      sum += Math.pow(A, i) / factorial;
    }
    const factN = factorial * N;
    const AN = Math.pow(A, N) / factN;
    const C = AN / (AN + (1 - A / N) * sum);
    return Math.min(Math.max(C, 0), 1);
  }

  /** Service level from Erlang-C */
  function erlangServiceLevel(N, A, t, mu) {
    // t = target answer time (sec), mu = 1/AHT (call rate per agent)
    if (N <= A) return 0;
    const C = erlangC(N, A);
    const sl = 1 - C * Math.exp(-(N - A) * mu * t);
    return Math.max(0, Math.min(sl, 1));
  }

  /** Find minimum N agents to meet service level */
  function minAgentsForSL(callsPerInterval, aht, targetSL, targetTime, shrinkagePct) {
    const intervalSec = 1800; // 30-min default
    const A = (callsPerInterval * aht) / intervalSec; // Traffic intensity in Erlangs
    const mu = 1 / aht;
    let N = Math.ceil(A) + 1;
    for (let iter = 0; iter < 200; iter++) {
      const sl = erlangServiceLevel(N, A, targetTime, mu);
      if (sl >= targetSL / 100) break;
      N++;
    }
    const shrink = 1 - shrinkagePct / 100;
    const scheduledNeeded = Math.ceil(N / shrink);
    return { N, scheduledNeeded, A };
  }

  function erlangStaffingEngine(inputs) {
    const { callsPerInterval, aht, targetSL, targetTime, shrinkage } = inputs;
    const intervalSec = 1800;
    const A   = (callsPerInterval * aht) / intervalSec;
    const mu  = 1 / aht;
    const res = minAgentsForSL(callsPerInterval, aht, targetSL, targetTime, shrinkage);
    const N   = res.N;
    const C   = erlangC(N, A);
    const sl  = erlangServiceLevel(N, A, targetTime, mu) * 100;
    const asa = N > A ? (C / (N * mu - A * mu)) : 9999;
    const occ = (A / N) * 100;
    const probDelay = C * 100;

    return {
      requiredAgents:    N,
      scheduledNeeded:   res.scheduledNeeded,
      trafficIntensity:  A,
      expectedSL:        sl,
      asa:               asa,
      occupancy:         occ,
      probDelay:         probDelay,
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 3 — SERVICE LEVEL PROJECTION ENGINE
  ════════════════════════════════════════════════════════════════ */
  function slProjectionEngine(inputs) {
    const {
      forecastVolume, actualVolume, forecastAHT, actualAHT,
      agentsScheduled, shrinkage, targetSL, targetTime, shiftProgress,
      intervalMin, revisedVolume,
    } = inputs;

    const intervalSec  = intervalMin * 60;
    const shiftHours   = 12; // from input; simplified
    const intervals    = (shiftHours * 60) / intervalMin;
    const callsPerInt  = revisedVolume / intervals;
    const A            = (callsPerInt * actualAHT) / intervalSec;
    const mu           = 1 / actualAHT;
    const availAgents  = agentsScheduled * (1 - shrinkage / 100);
    const N            = Math.max(1, Math.round(availAgents));
    const sl           = erlangServiceLevel(N, A, targetTime, mu) * 100;
    const slGap        = sl - targetSL;

    return {
      projectedSL: sl,
      targetSL,
      slGap,
      callsPerInterval: callsPerInt,
      availAgents: N,
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 4 — CAPACITY vs WORKLOAD ENGINE
  ════════════════════════════════════════════════════════════════ */
  function capacityWorkloadEngine(inputs) {
    const {
      revisedVolume, actualAHT, agentsScheduled, shrinkage, shiftHours,
    } = inputs;
    const requiredHours  = (revisedVolume * actualAHT) / 3600;
    const productiveHours = agentsScheduled * (1 - shrinkage / 100) * shiftHours;
    const delta  = productiveHours - requiredHours;
    const fteGap = delta / shiftHours;
    const utilization = requiredHours / productiveHours;

    return {
      requiredHours,
      availableHours: productiveHours,
      delta,
      fteGap,
      utilization: Math.min(utilization, 1.5),
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 5 — ARRIVAL VARIABILITY ANALYSIS
  ════════════════════════════════════════════════════════════════ */
  function arrivalVariabilityEngine(inputs) {
    const { historicalCV, actualCV, forecastVolume, actualVolume, shiftProgress } = inputs;

    const shift       = ((actualCV - historicalCV) / historicalCV) * 100;
    const burstiness  = (actualCV * actualCV - 1) / (actualCV * actualCV + 1); // normalized (B)
    const confidence  = actualCV < 0.3 ? 'HIGH' : actualCV < 0.5 ? 'MEDIUM' : 'LOW';
    const highVariability = actualCV > 0.5;

    // Estimate peak based on arrival acceleration
    const runRate     = shiftProgress > 0 ? actualVolume / shiftProgress : 0;
    const remaining   = forecastVolume - actualVolume;
    const peakOffset  = remaining > runRate * 0.3 ? 1.5 : 0.8; // hours from now
    const peakHour    = new Date();
    peakHour.setMinutes(peakHour.getMinutes() + Math.round(peakOffset * 60));

    return {
      cv: actualCV,
      burstiness,
      patternShift: shift,
      confidence,
      highVariability,
      projectedPeak: `${String(peakHour.getHours()).padStart(2,'0')}:${String(peakHour.getMinutes()).padStart(2,'0')}`,
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 6 — FORECAST HEALTH ANALYTICS
  ════════════════════════════════════════════════════════════════ */
  function forecastHealthEngine(inputs) {
    const { forecastVolume, actualVolume, forecastAHT, actualAHT, shiftProgress } = inputs;

    if (shiftProgress <= 0) {
      return { mape: 0, bias: 0, accuracy: 100, driver: 'INSUFFICIENT DATA' };
    }

    // Scale actuals to full-day to compare with forecast
    const scaledActual = actualVolume / shiftProgress;
    const mape   = Math.abs((scaledActual - forecastVolume) / forecastVolume) * 100;
    const bias   = (scaledActual - forecastVolume) / forecastVolume * 100;
    const accuracy = Math.max(0, 100 - mape);

    const ahtDrift = ((actualAHT - forecastAHT) / forecastAHT) * 100;
    const volDelta  = ((scaledActual - forecastVolume) / forecastVolume) * 100;

    let driver = 'FORECAST VARIANCE';
    if (Math.abs(volDelta) > 15) driver = 'VOLUME SPIKE';
    else if (Math.abs(ahtDrift) > 10) driver = 'AHT DRIFT';
    else if (Math.abs(volDelta) > 8) driver = 'FORECAST ERROR';
    else if (accuracy > 90) driver = 'OPERATING WITHIN TOLERANCE';

    return { mape, bias, accuracy, driver, volDelta, ahtDrift };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 7 — INTRADAY REFORECAST ENGINE
  ════════════════════════════════════════════════════════════════ */
  function intradayReforecastEngine(inputs) {
    const { forecastVolume, actualVolume, shiftProgress } = inputs;

    let forecastWeight, runRateWeight;
    if (shiftProgress < 0.30) {
      forecastWeight = 0.70; runRateWeight = 0.30;
    } else if (shiftProgress < 0.60) {
      forecastWeight = 0.50; runRateWeight = 0.50;
    } else {
      forecastWeight = 0.30; runRateWeight = 0.70;
    }

    const runRateFull = shiftProgress > 0 ? actualVolume / shiftProgress : forecastVolume;
    const revised     = forecastWeight * forecastVolume + runRateWeight * runRateFull;

    return {
      forecastWeight: forecastWeight * 100,
      runRateWeight:  runRateWeight  * 100,
      revisedVolume:  Math.round(revised),
      runRateEst:     Math.round(runRateFull),
      forecastEst:    Math.round(forecastVolume),
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 8 — MONTE CARLO SIMULATION ENGINE
  ════════════════════════════════════════════════════════════════ */
  function monteCarloSimulation(inputs, simCount) {
    const {
      forecastVolume, actualAHT, forecastAHT, agentsScheduled,
      shrinkage, targetSL, targetTime, intervalMin, shiftHours,
      actualCV, revisedVolume,
    } = inputs;

    simCount = simCount || 5000;
    const intervalSec  = intervalMin * 60;
    const intervals    = (shiftHours * 60) / intervalMin;
    const availAgents  = agentsScheduled * (1 - shrinkage / 100);
    const N            = Math.max(1, Math.round(availAgents));

    let slMet = 0;
    const slResults = [];

    // Gaussian random using Box-Muller
    function randn() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    for (let i = 0; i < simCount; i++) {
      // Simulate volume uncertainty (CV drives spread)
      const volVar  = revisedVolume * (1 + actualCV * randn() * 0.4);
      const ahtVar  = actualAHT    * (1 + 0.10 * randn());
      const vol     = Math.max(1, volVar);
      const aht     = Math.max(60, ahtVar);

      const callsPerInt = vol / intervals;
      const A           = (callsPerInt * aht) / intervalSec;
      const mu          = 1 / aht;
      const sl          = erlangServiceLevel(N, A, targetTime, mu) * 100;

      slResults.push(sl);
      if (sl >= targetSL) slMet++;
    }

    slResults.sort((a, b) => a - b);
    const p10    = slResults[Math.floor(simCount * 0.10)];
    const p50    = slResults[Math.floor(simCount * 0.50)];
    const p90    = slResults[Math.floor(simCount * 0.90)];
    const probSL = (slMet / simCount) * 100;

    return {
      probMeetingSL: probSL,
      bestCase:      p90,
      worstCase:     p10,
      median:        p50,
      simCount,
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 9 — OPERATIONAL HEALTH SCORE
  ════════════════════════════════════════════════════════════════ */
  function riskScoreEngine(inputs) {
    const { erlang, slProj, capacity, forecast, arrival } = inputs;

    // Component scores (0–100 each)
    const slScore       = Math.min(100, slProj.projectedSL);
    const capacityScore = capacity.delta >= 0 ? 100 : Math.max(0, 100 + capacity.delta / capacity.requiredHours * 50);
    const forecastScore = Math.max(0, 100 - forecast.mape * 2);
    const ahtScore      = Math.max(0, 100 - Math.abs(forecast.ahtDrift || 0) * 3);
    const varianceScore = arrival.highVariability ? 50 : 85;

    // Weighted composite
    const composite = (
      slScore       * 0.30 +
      capacityScore * 0.25 +
      forecastScore * 0.20 +
      ahtScore      * 0.15 +
      varianceScore * 0.10
    );

    const score = Math.max(0, Math.min(100, Math.round(composite)));
    const state = score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red';
    const label = score >= 80 ? 'OPTIMAL' : score >= 65 ? 'STABLE' : score >= 50 ? 'AT RISK' : 'CRITICAL';

    return { score, state, label };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 10 — STAFFING ACTION ENGINE
  ════════════════════════════════════════════════════════════════ */
  function staffingRecommendationEngine(inputs) {
    const { capacity, slProj, health, erlang, forecast } = inputs;
    const actions = [];

    const slGap    = slProj.slGap;
    const fteGap   = capacity.fteGap;
    const deficit  = capacity.delta < 0;

    if (deficit && slGap < -15) {
      actions.push({ text: 'Immediately pull agents from offline work to active queue', level: 'urgent', num: 1 });
    }
    if (slGap < -10) {
      actions.push({ text: 'Delay scheduled lunches and breaks by 30–45 min', level: 'urgent', num: actions.length + 1 });
    }
    if (fteGap < -3) {
      actions.push({ text: 'Authorize overtime for available agents — ' + Math.abs(Math.ceil(fteGap)) + ' FTE gap', level: 'high', num: actions.length + 1 });
    }
    if (capacity.utilization > 0.95) {
      actions.push({ text: 'Move cross-skilled agents from secondary queues', level: 'high', num: actions.length + 1 });
    }
    if (forecast.ahtDrift > 10) {
      actions.push({ text: 'AHT trending +' + forecast.ahtDrift.toFixed(0) + '% — issue coaching bulletin', level: 'medium', num: actions.length + 1 });
    }
    if (capacity.utilization > 0.90) {
      actions.push({ text: 'Pause non-essential back-office work immediately', level: 'high', num: actions.length + 1 });
    }
    if (forecast.mape > 15) {
      actions.push({ text: 'Notify planning team: forecast deviation ' + forecast.mape.toFixed(0) + '% — recalibrate next interval', level: 'medium', num: actions.length + 1 });
    }
    if (actions.length === 0 && slGap >= 0) {
      actions.push({ text: 'Service level tracking above target — maintain current staffing posture', level: 'low', num: 1 });
      actions.push({ text: 'Continue monitoring arrival pattern for volume acceleration', level: 'low', num: 2 });
    }

    const topLevel = actions.some(a => a.level === 'urgent') ? 'HIGH'
                   : actions.some(a => a.level === 'high')   ? 'MEDIUM'
                   : 'LOW';

    return { actions, topLevel };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 11 — AI OPERATIONS EXPLAINER
  ════════════════════════════════════════════════════════════════ */
  function aiOperationsExplainer(inputs) {
    const { forecast, slProj, capacity, arrival, health, erlang } = inputs;
    const insights = [];

    // Volume status
    const volDir = forecast.volDelta > 0 ? 'above' : 'below';
    const volMag = Math.abs(forecast.volDelta || 0).toFixed(1);
    if (Math.abs(forecast.volDelta || 0) > 3) {
      const level = Math.abs(forecast.volDelta) > 15 ? 'ai-critical' : Math.abs(forecast.volDelta) > 8 ? 'ai-warn' : 'ai-neutral';
      insights.push({ text: `Volume running ${volMag}% ${volDir} forecast — ${forecast.driver.toLowerCase()} is the primary operational driver.`, level });
    }

    // AHT drift
    if (Math.abs(forecast.ahtDrift || 0) > 5) {
      const dir  = forecast.ahtDrift > 0 ? 'increased' : 'decreased';
      const secs = Math.abs(((forecast.ahtDrift / 100) * inputs.forecastAHT)).toFixed(0);
      const lev  = Math.abs(forecast.ahtDrift) > 15 ? 'ai-critical' : 'ai-warn';
      insights.push({ text: `AHT ${dir} by ${secs} seconds (+${forecast.ahtDrift.toFixed(1)}%) — generating additional queue pressure and workload.`, level: lev });
    }

    // SL projection
    const slGap = slProj.slGap.toFixed(1);
    if (slProj.slGap < -10) {
      insights.push({ text: `Service level projected at ${slProj.projectedSL.toFixed(1)}% — ${Math.abs(slGap)}pp below target. Immediate staffing action required.`, level: 'ai-critical' });
    } else if (slProj.slGap < 0) {
      insights.push({ text: `Service level at ${slProj.projectedSL.toFixed(1)}%, marginally below ${slProj.targetSL}% target. Monitor closely.`, level: 'ai-warn' });
    } else {
      insights.push({ text: `Service level tracking at ${slProj.projectedSL.toFixed(1)}% — ${slGap}pp above target. Operations stable.`, level: 'ai-good' });
    }

    // Capacity
    if (capacity.delta < 0) {
      const hrs = Math.abs(capacity.delta).toFixed(1);
      insights.push({ text: `Capacity deficit of ${hrs} productive hours. Workload exceeds available staffing — FTE gap of ${Math.abs(capacity.fteGap).toFixed(1)}.`, level: 'ai-critical' });
    } else {
      insights.push({ text: `Capacity surplus of ${capacity.delta.toFixed(1)} hours against workload demand. Utilization at ${(capacity.utilization * 100).toFixed(0)}%.`, level: 'ai-good' });
    }

    // Arrival variability
    if (arrival.highVariability) {
      insights.push({ text: `High arrival randomness detected (CV: ${arrival.cv.toFixed(2)}) — forecasting confidence reduced. Widen staffing buffer.`, level: 'ai-warn' });
    }

    // Erlang occupancy warning
    if (erlang.occupancy > 90) {
      insights.push({ text: `Agent occupancy at ${erlang.occupancy.toFixed(0)}% — agents operating above sustainable threshold. Burnout and error risk elevated.`, level: 'ai-critical' });
    } else if (erlang.occupancy > 80) {
      insights.push({ text: `Occupancy at ${erlang.occupancy.toFixed(0)}%. Within acceptable range but approaching high-stress territory.`, level: 'ai-warn' });
    }

    return insights;
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 12 — AI INTRADAY FORECASTING BRAIN
  ════════════════════════════════════════════════════════════════ */
  function aiForecastingBrain(inputs) {
    const { forecast, arrival, slProj, capacity, shiftProgress } = inputs;

    const volDelta   = Math.abs(forecast.volDelta || 0);
    const ahtDrift   = forecast.ahtDrift || 0;
    const cv         = arrival.cv;
    const slGap      = slProj.slGap;
    const capUtil    = capacity.utilization;
    const progFactor = shiftProgress < 0.3 ? 1.3 : shiftProgress > 0.7 ? 0.8 : 1.0;

    // Risk scores (0–100)
    const volumeRisk = Math.min(100, volDelta * 3.5 * progFactor);
    const queueRisk  = Math.min(100, Math.max(0, (-slGap * 4) + capUtil * 40));
    const slRisk     = Math.min(100, Math.max(0, -slGap * 5 + (ahtDrift > 0 ? ahtDrift * 2 : 0)));
    const ahtRisk    = Math.min(100, Math.abs(ahtDrift) * 4);

    const alerts = [];
    if (volumeRisk > 60) alerts.push({ text: 'Volume spike likely within next 45 minutes.', level: 'alert-high' });
    if (queueRisk  > 55) alerts.push({ text: 'Queue pressure predicted — intervene before next interval.', level: 'alert-high' });
    if (slRisk     > 50) alerts.push({ text: 'Service level at risk — staffing action recommended now.', level: 'alert-med' });
    if (ahtDrift   > 12) alerts.push({ text: `AHT trending upward (+${ahtDrift.toFixed(0)}%) — service level at risk.`, level: 'alert-med' });
    if (arrival.patternShift > 20) alerts.push({ text: `Arrival pattern shifted by ${arrival.patternShift.toFixed(0)}% — reforecast active.`, level: 'alert-med' });
    if (slRisk < 25 && volumeRisk < 25) alerts.push({ text: 'No immediate operational threats detected. Conditions stable.', level: 'alert-low' });

    return {
      risks: { volume: volumeRisk, queue: queueRisk, sl: slRisk, aht: ahtRisk },
      alerts,
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MODULE 13 — SPARKLINE CHART ENGINE
  ════════════════════════════════════════════════════════════════ */
  function drawSparkline(canvasId, data, color, fillColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || data.length < 2) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const min  = Math.min(...data);
    const max  = Math.max(...data);
    const range = max - min || 1;

    const pts = data.map((v, i) => ({
      x: (i / (data.length - 1)) * W,
      y: H - ((v - min) / range) * (H - 4) - 2,
    }));

    // Fill area
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = fillColor || 'rgba(0,200,255,0.08)';
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color || '#00c8ff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Last dot
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color || '#00c8ff';
    ctx.fill();
  }

  /* ════════════════════════════════════════════════════════════════
     COLLECT INPUTS
  ════════════════════════════════════════════════════════════════ */
  function collectInputs() {
    const g = id => parseFloat(document.getElementById(id).value) || 0;
    const s = id => document.getElementById(id).value;

    const shiftProgress = getShiftProgress();
    const { start, end } = getShiftTimes();
    const shiftHours = Math.max(1, (end - start) / 3600000);

    const forecastVolume = g('forecastVolume');
    const actualVolume   = g('actualVolume');
    const forecastAHT    = g('forecastAHT');
    const actualAHT      = g('actualAHT');

    const reforecast = intradayReforecastEngine({ forecastVolume, actualVolume, shiftProgress });

    return {
      // Shift
      shiftStart:      s('shiftStart'),
      shiftEnd:        s('shiftEnd'),
      shiftProgress,
      shiftHours,
      // Volume
      forecastVolume,
      actualVolume,
      forecastAHT,
      actualAHT,
      // Targets
      agentsScheduled: g('agentsScheduled'),
      shrinkage:       g('shrinkage'),
      targetSL:        g('targetSL'),
      targetTime:      g('answerTarget'),
      intervalMin:     g('intervalMin') || 30,
      // Arrival
      historicalCV:    g('historicalCV'),
      actualCV:        g('actualCV'),
      // Derived
      revisedVolume:   reforecast.revisedVolume,
      reforecast,
    };
  }

  /* ════════════════════════════════════════════════════════════════
     MAIN ANALYSIS RUNNER
  ════════════════════════════════════════════════════════════════ */
  function runAnalysis() {
    const inputs = collectInputs();

    const { shiftProgress, shiftHours, intervalMin, actualAHT, forecastAHT,
            agentsScheduled, shrinkage, targetSL, targetTime, revisedVolume,
            forecastVolume, actualVolume, actualCV, historicalCV } = inputs;

    // Erlang inputs — use per-interval calls
    const intervals     = (shiftHours * 60) / intervalMin;
    const callsPerInt   = revisedVolume / intervals;

    const erlang = erlangStaffingEngine({
      callsPerInterval: callsPerInt,
      aht:      actualAHT,
      targetSL,
      targetTime,
      shrinkage,
    });

    const slProj = slProjectionEngine({
      forecastVolume, actualVolume, forecastAHT, actualAHT,
      agentsScheduled, shrinkage, targetSL, targetTime,
      shiftProgress, intervalMin, revisedVolume, shiftHours,
    });

    const capacity = capacityWorkloadEngine({
      revisedVolume, actualAHT, agentsScheduled, shrinkage, shiftHours,
    });

    const arrival = arrivalVariabilityEngine({
      historicalCV, actualCV, forecastVolume, actualVolume, shiftProgress,
    });

    const forecast = forecastHealthEngine({
      forecastVolume, actualVolume, forecastAHT, actualAHT, shiftProgress,
    });

    const reforecast = inputs.reforecast;

    const health = riskScoreEngine({ erlang, slProj, capacity, forecast, arrival });

    const staffing = staffingRecommendationEngine({ capacity, slProj, health, erlang, forecast });

    const aiExplain = aiOperationsExplainer({
      forecast, slProj, capacity, arrival, health, erlang,
      forecastAHT, actualAHT,
    });

    const aiBrain = aiForecastingBrain({
      forecast, arrival, slProj, capacity, shiftProgress,
    });

    const runRate = shiftProgress > 0 ? actualVolume / (shiftProgress * shiftHours) : 0;

    // Store history
    const H = state.history;
    const push = (arr, val) => { arr.push(val); if (arr.length > 20) arr.shift(); };
    push(H.sl,      slProj.projectedSL);
    push(H.runRate, runRate);
    push(H.vol,     revisedVolume);
    push(H.work,    capacity.delta);
    push(H.fte,     capacity.fteGap);
    push(H.agents,  erlang.requiredAgents);

    state.lastResult = {
      inputs, erlang, slProj, capacity, arrival, forecast, reforecast,
      health, staffing, aiExplain, aiBrain, runRate,
    };

    renderAll(state.lastResult);
  }

  /* ════════════════════════════════════════════════════════════════
     RENDER ALL
  ════════════════════════════════════════════════════════════════ */
  function renderAll(r) {
    renderHealth(r.health);
    renderKPIs(r);
    renderErlang(r.erlang);
    renderSLProjection(r.slProj);
    renderForecastHealth(r.forecast);
    renderCapacity(r.capacity);
    renderArrival(r.arrival);
    renderReforecast(r.reforecast, r.inputs.shiftProgress);
    renderAIExplainer(r.aiExplain);
    renderAIBrain(r.aiBrain);
    renderStaffingActions(r.staffing);
    renderSparklines();
    renderSystemStatus(r.health);
  }

  /* ── Health Score ── */
  function renderHealth(health) {
    const numEl    = document.getElementById('healthScoreNum');
    const statusEl = document.getElementById('healthStatus');
    const cardEl   = document.getElementById('healthCard');
    const ringEl   = document.getElementById('healthRingFill');

    if (numEl)    numEl.textContent = health.score;
    if (statusEl) statusEl.textContent = health.label;
    if (cardEl) {
      cardEl.className = 'health-card state-' + health.state;
    }
    if (ringEl) {
      const circumference = 314; // 2π×50
      const offset = circumference - (health.score / 100) * circumference;
      ringEl.style.strokeDashoffset = offset;
    }
  }

  /* ── KPI Strip ── */
  function renderKPIs(r) {
    const { slProj, erlang, capacity, inputs, runRate } = r;

    setKPI('kpiSLVal',       slProj.projectedSL.toFixed(1) + '%',
           slProj.slGap >= 0 ? 'good' : slProj.slGap > -10 ? 'warn' : 'critical',
           (slProj.slGap >= 0 ? '+' : '') + slProj.slGap.toFixed(1) + 'pp vs target',
           slProj.slGap >= 0 ? 'positive' : 'negative');

    const agentGap = inputs.agentsScheduled - erlang.scheduledNeeded;
    setKPI('kpiAgentsVal',   erlang.scheduledNeeded.toString(),
           agentGap >= 0 ? 'good' : 'critical',
           (agentGap >= 0 ? '+' : '') + agentGap + ' vs scheduled',
           agentGap >= 0 ? 'positive' : 'negative');

    setKPI('kpiVolumeVal',   r.inputs.revisedVolume.toLocaleString(),
           'neutral', '', 'neutral');

    const workDelta = capacity.delta;
    setKPI('kpiWorkloadVal', (workDelta >= 0 ? '+' : '') + workDelta.toFixed(1) + ' hrs',
           workDelta >= 0 ? 'good' : workDelta > -5 ? 'warn' : 'critical',
           workDelta >= 0 ? 'Surplus' : 'Deficit',
           workDelta >= 0 ? 'positive' : 'negative');

    const fteGap = capacity.fteGap;
    setKPI('kpiFTEVal',      (fteGap >= 0 ? '+' : '') + fteGap.toFixed(1),
           fteGap >= 0 ? 'good' : fteGap > -3 ? 'warn' : 'critical',
           'FTE ' + (fteGap >= 0 ? 'surplus' : 'shortfall'),
           fteGap >= 0 ? 'positive' : 'negative');

    setKPI('kpiRunRateVal',  Math.round(runRate).toLocaleString(),
           'neutral',
           'calls/hr (run rate)',
           'neutral');
  }

  function setKPI(valId, val, state, deltaText, deltaDir) {
    const card    = document.getElementById(valId)?.closest('.kpi-card');
    const valEl   = document.getElementById(valId);
    const deltaEl = valId.replace('Val', 'Delta');
    const deltaNode = document.getElementById(deltaEl);

    if (valEl) valEl.textContent = val;
    if (card) {
      card.className = 'kpi-card ' + (state !== 'neutral' ? state : '');
    }
    if (deltaNode) {
      deltaNode.textContent = deltaText;
      deltaNode.className   = 'kpi-delta ' + (deltaDir || 'neutral');
    }
  }

  /* ── Erlang ── */
  function renderErlang(e) {
    setText('eRequiredAgents', e.requiredAgents);
    setText('eExpectedSL',     e.expectedSL.toFixed(1) + '%');
    setText('eASA',            e.asa > 999 ? '∞' : e.asa.toFixed(0) + ' sec');
    setText('eOccupancy',      e.occupancy.toFixed(1) + '%');
    setText('eProbDelay',      e.probDelay.toFixed(1) + '%');
    setText('eTraffic',        e.trafficIntensity.toFixed(2) + ' Erl');

    // Color occupancy
    const occEl = document.getElementById('eOccupancy');
    if (occEl) {
      occEl.className = 'em-value ' + (e.occupancy > 90 ? 'text-red' : e.occupancy > 80 ? 'text-amber' : 'text-green');
    }
  }

  /* ── SL Projection ── */
  function renderSLProjection(slProj) {
    setText('slProjected', slProj.projectedSL.toFixed(1) + '%');
    setText('slTarget',    slProj.targetSL.toFixed(1) + '%');
    const gap = slProj.slGap;
    const gapEl = document.getElementById('slGap');
    if (gapEl) {
      gapEl.textContent = (gap >= 0 ? '+' : '') + gap.toFixed(1) + 'pp';
      gapEl.className   = 'slm-value ' + (gap >= 0 ? 'text-green' : gap > -10 ? 'text-amber' : 'text-red');
    }

    const barEl = document.getElementById('slBarFill');
    if (barEl) barEl.style.width = Math.min(100, slProj.projectedSL) + '%';

    const marker = document.getElementById('slTargetMarker');
    if (marker) marker.style.left = Math.min(100, slProj.targetSL) + '%';

    const riskBanner = document.getElementById('slRiskBanner');
    if (riskBanner) {
      if (gap < -15) {
        riskBanner.textContent = '⚠ CRITICAL — Service level well below target';
        riskBanner.className   = 'sl-risk risk-active';
      } else if (gap < 0) {
        riskBanner.textContent = '⚠ WARNING — Service level below target';
        riskBanner.className   = 'sl-risk risk-warn';
      } else {
        riskBanner.textContent = '✓ ON TARGET — Service level meeting objective';
        riskBanner.className   = 'sl-risk risk-ok';
      }
    }
  }

  /* ── Forecast Health ── */
  function renderForecastHealth(f) {
    const mapeEl  = document.getElementById('mapeVal');
    const biasEl  = document.getElementById('biasVal');
    const accEl   = document.getElementById('accVal');
    const mapeFill = document.getElementById('mapeFill');
    const biasFill = document.getElementById('biasFill');
    const accFill  = document.getElementById('accFill');

    if (mapeEl) mapeEl.textContent = f.mape.toFixed(1) + '%';
    if (biasEl) biasEl.textContent = (f.bias >= 0 ? '+' : '') + f.bias.toFixed(1) + '%';
    if (accEl)  accEl.textContent  = f.accuracy.toFixed(1) + '%';

    if (mapeFill) mapeFill.style.width = Math.min(100, f.mape * 3) + '%';
    if (accFill)  accFill.style.width  = f.accuracy + '%';

    // Bias bar: centered, moves left or right
    if (biasFill) {
      const biasPct = Math.min(50, Math.abs(f.bias) * 2);
      biasFill.style.width = biasPct + '%';
      biasFill.style.left  = f.bias >= 0 ? '50%' : (50 - biasPct) + '%';
      biasFill.style.background = f.bias > 5 ? '#ffb300' : f.bias < -5 ? '#ff3d5a' : '#00ff88';
    }

    setText('varianceDriverText', f.driver);
    const vdEl = document.getElementById('varianceDriverText');
    if (vdEl) {
      vdEl.className = 'vd-value ' + (f.driver.includes('SPIKE') ? 'text-red' : f.driver.includes('DRIFT') ? 'text-amber' : f.driver.includes('TOLERANCE') ? 'text-green' : 'text-amber');
    }
  }

  /* ── Capacity ── */
  function renderCapacity(cap) {
    setText('capRequired',  cap.requiredHours.toFixed(1) + ' hrs');
    setText('capAvailable', cap.availableHours.toFixed(1) + ' hrs');
    const deltaEl = document.getElementById('capDelta');
    if (deltaEl) {
      deltaEl.textContent = (cap.delta >= 0 ? '+' : '') + cap.delta.toFixed(1) + ' hrs';
      deltaEl.className   = 'cap-value ' + (cap.delta >= 0 ? 'text-green' : 'text-red');
    }
    const fteEl = document.getElementById('capFTE');
    if (fteEl) {
      fteEl.textContent = (cap.fteGap >= 0 ? '+' : '') + cap.fteGap.toFixed(1) + ' FTE';
      fteEl.className   = 'cap-value ' + (cap.fteGap >= 0 ? 'text-green' : 'text-red');
    }
    const barFill = document.getElementById('capBarFill');
    const barPct  = document.getElementById('capBarPct');
    const util = Math.min(150, cap.utilization * 100);
    if (barFill) {
      barFill.style.width = Math.min(100, util) + '%';
      barFill.style.background = util > 100 ? 'linear-gradient(90deg,#ff3d5a,#ff8a00)' : util > 85 ? 'linear-gradient(90deg,#ffb300,#ff8a00)' : 'linear-gradient(90deg,#00c8ff,#a855f7)';
    }
    if (barPct) barPct.textContent = util.toFixed(0) + '%';
  }

  /* ── Arrival ── */
  function renderArrival(arr) {
    setText('arrCV',    arr.cv.toFixed(3));
    const burstEl = document.getElementById('arrBurst');
    if (burstEl) {
      burstEl.textContent = arr.burstiness.toFixed(3);
      burstEl.className   = 'arr-value ' + (arr.burstiness > 0.3 ? 'text-amber' : 'text-green');
    }
    const shiftEl = document.getElementById('arrShift');
    if (shiftEl) {
      shiftEl.textContent = (arr.patternShift >= 0 ? '+' : '') + arr.patternShift.toFixed(1) + '%';
      shiftEl.className   = 'arr-value ' + (Math.abs(arr.patternShift) > 20 ? 'text-red' : Math.abs(arr.patternShift) > 10 ? 'text-amber' : 'text-green');
    }
    const confEl = document.getElementById('arrConf');
    if (confEl) {
      confEl.textContent = arr.confidence;
      confEl.className   = 'arr-value ' + (arr.confidence === 'HIGH' ? 'text-green' : arr.confidence === 'MEDIUM' ? 'text-amber' : 'text-red');
    }
    const alertEl = document.getElementById('arrAlert');
    if (alertEl) {
      if (arr.highVariability) {
        alertEl.textContent = 'High arrival randomness detected — forecasting confidence reduced.';
        alertEl.className   = 'arr-alert active-warn';
      } else {
        alertEl.className = 'arr-alert';
      }
    }
    setText('arrPeakVal', arr.projectedPeak);
  }

  /* ── Reforecast ── */
  function renderReforecast(rf, shiftProgress) {
    const fw = rf.forecastWeight;
    const rw = rf.runRateWeight;
    const foreWeightEl = document.getElementById('rfForeWeight');
    const rrWeightEl   = document.getElementById('rfRRWeight');
    if (foreWeightEl) foreWeightEl.style.width = fw + '%';
    if (rrWeightEl)   rrWeightEl.style.width   = rw + '%';
    setText('rfForeLabel', fw.toFixed(0) + '% Forecast');
    setText('rfRRLabel',   rw.toFixed(0) + '% Run-Rate');
    setText('rfRevisedVol',  rf.revisedVolume.toLocaleString());
    setText('rfRunRateEst',  rf.runRateEst.toLocaleString());
    setText('rfForecastEst', rf.forecastEst.toLocaleString());
    setText('rfShiftProg',   (shiftProgress * 100).toFixed(1) + '%');
  }

  /* ── AI Explainer ── */
  function renderAIExplainer(insights) {
    const container = document.getElementById('aiInsights');
    if (!container) return;
    container.innerHTML = '';
    insights.forEach((ins, i) => {
      const div = document.createElement('div');
      div.className = 'ai-insight-item ' + ins.level;
      div.style.animationDelay = (i * 0.08) + 's';
      div.innerHTML = `<span class="ai-bullet">◈</span><span>${ins.text}</span>`;
      container.appendChild(div);
    });
  }

  /* ── AI Brain ── */
  function renderAIBrain(brain) {
    const risks = brain.risks;

    setRiskBar('riskVolFill', 'riskVolPct', risks.volume);
    setRiskBar('riskQueueFill', 'riskQueuePct', risks.queue);
    setRiskBar('riskSLFill', 'riskSLPct', risks.sl);
    setRiskBar('riskAHTFill', 'riskAHTPct', risks.aht);

    // Update risk item classes
    ['Vol','Queue','SL','AHT'].forEach((name, i) => {
      const val = [risks.volume, risks.queue, risks.sl, risks.aht][i];
      const fill = document.getElementById('risk' + name + 'Fill');
      const item = fill?.closest('.risk-item');
      if (item) {
        item.className = 'risk-item ' + (val > 60 ? 'risk-high' : val > 35 ? 'risk-med' : 'risk-low');
        const icon = item.querySelector('.risk-icon');
        if (icon) icon.textContent = val > 60 ? '▲' : val > 35 ? '◆' : '◈';
      }
    });

    const alertsEl = document.getElementById('radarAlerts');
    if (alertsEl) {
      alertsEl.innerHTML = '';
      brain.alerts.forEach(a => {
        const div = document.createElement('div');
        div.className = 'radar-alert ' + a.level;
        div.textContent = a.text;
        alertsEl.appendChild(div);
      });
    }
  }

  function setRiskBar(fillId, pctId, value) {
    const fill = document.getElementById(fillId);
    const pct  = document.getElementById(pctId);
    if (fill) fill.style.width = Math.min(100, value).toFixed(0) + '%';
    if (pct)  pct.textContent  = Math.min(100, value).toFixed(0) + '%';
  }

  /* ── Staffing Actions ── */
  function renderStaffingActions(staffing) {
    const list = document.getElementById('actionsList');
    const pri  = document.getElementById('actionsPriority');
    if (!list) return;

    list.innerHTML = '';
    staffing.actions.forEach((action) => {
      const chip = document.createElement('div');
      chip.className = 'action-chip ' + action.level;
      chip.innerHTML = `<span class="action-num">${action.num}</span>${action.text}`;
      list.appendChild(chip);
    });

    if (pri) {
      pri.textContent  = staffing.topLevel + ' PRIORITY';
      pri.className    = 'actions-priority priority-' + staffing.topLevel.toLowerCase();
    }
  }

  /* ── Sparklines ── */
  function renderSparklines() {
    const H = state.history;
    drawSparkline('sparkSL',     H.sl,      '#00ff88', 'rgba(0,255,136,0.06)');
    drawSparkline('sparkAgents', H.agents,  '#ff3d5a', 'rgba(255,61,90,0.06)');
    drawSparkline('sparkVol',    H.vol,     '#00c8ff', 'rgba(0,200,255,0.06)');
    drawSparkline('sparkWork',   H.work,    '#ffb300', 'rgba(255,179,0,0.06)');
    drawSparkline('sparkFTE',    H.fte,     '#a855f7', 'rgba(168,85,247,0.06)');
    drawSparkline('sparkRR',     H.runRate, '#00c8ff', 'rgba(0,200,255,0.04)');
  }

  /* ── System Status Topbar ── */
  function renderSystemStatus(health) {
    const pill  = document.getElementById('systemStatusPill');
    const text  = document.getElementById('systemStatusText');
    if (!pill || !text) return;
    const labels = { green: 'OPERATIONAL', amber: 'AT RISK', red: 'CRITICAL' };
    text.textContent = labels[health.state] || 'OPERATIONAL';
    pill.className   = 'status-pill ' + (health.state === 'amber' ? 'warn' : health.state === 'red' ? 'critical' : '');
  }

  /* ════════════════════════════════════════════════════════════════
     SIMULATION RUNNER (async via setTimeout for non-blocking UI)
  ════════════════════════════════════════════════════════════════ */
  function runSimulationAsync() {
    if (state.simRunning) return;
    state.simRunning = true;

    const statusEl = document.getElementById('simStatus');
    if (statusEl) { statusEl.textContent = 'RUNNING'; statusEl.className = 'sim-status running'; }

    const inputs   = collectInputs();
    const simCount = parseInt(document.getElementById('simCount').value, 10) || 5000;

    setTimeout(function () {
      try {
        const result = monteCarloSimulation(inputs, simCount);
        renderSimulation(result);
        if (statusEl) { statusEl.textContent = 'COMPLETE'; statusEl.className = 'sim-status done'; }
      } catch (e) {
        console.error('Simulation error:', e);
        if (statusEl) { statusEl.textContent = 'ERROR'; statusEl.className = 'sim-status'; }
      }
      state.simRunning = false;
    }, 60); // tiny delay lets browser repaint "RUNNING" state
  }

  function renderSimulation(sim) {
    const container = document.getElementById('simResults');
    if (!container) return;

    container.innerHTML = `
      <div class="sim-output">
        <div class="sim-metric prob">
          <div class="sim-metric-label">PROB. MEETING SL</div>
          <div class="sim-metric-val">${sim.probMeetingSL.toFixed(1)}%</div>
        </div>
        <div class="sim-metric best">
          <div class="sim-metric-label">BEST CASE SL (P90)</div>
          <div class="sim-metric-val">${sim.bestCase.toFixed(1)}%</div>
        </div>
        <div class="sim-metric worst">
          <div class="sim-metric-label">WORST CASE SL (P10)</div>
          <div class="sim-metric-val">${sim.worstCase.toFixed(1)}%</div>
        </div>
        <div class="sim-metric">
          <div class="sim-metric-label">MEDIAN SL (P50)</div>
          <div class="sim-metric-val">${sim.median.toFixed(1)}%</div>
        </div>
        <div class="sim-metric">
          <div class="sim-metric-label">SIMULATIONS RUN</div>
          <div class="sim-metric-val">${sim.simCount.toLocaleString()}</div>
        </div>
        <div class="sim-metric">
          <div class="sim-metric-label">SL RANGE</div>
          <div class="sim-metric-val">${(sim.bestCase - sim.worstCase).toFixed(1)}pp</div>
        </div>
      </div>
      <div class="sim-prob-bar-wrap">
        <div class="sim-prob-label">PROBABILITY OF MEETING SERVICE LEVEL TARGET</div>
        <div class="sim-prob-bar">
          <div class="sim-prob-fill" id="simProbFill" style="width:0%"></div>
        </div>
      </div>`;

    // Animate bar
    setTimeout(() => {
      const fill = document.getElementById('simProbFill');
      if (fill) fill.style.width = sim.probMeetingSL + '%';
    }, 100);
  }

  /* ════════════════════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════════════════════ */
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ════════════════════════════════════════════════════════════════
     INPUT PANEL COLLAPSE
  ════════════════════════════════════════════════════════════════ */
  function initCollapseToggle() {
    const btn   = document.getElementById('collapseInputs');
    const panel = document.getElementById('inputPanel');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      btn.textContent = collapsed ? '▶' : '◀';
    });
  }

  /* ════════════════════════════════════════════════════════════════
     AI THINKING ANIMATION
  ════════════════════════════════════════════════════════════════ */
  function showThinking(show) {
    const el = document.getElementById('aiThinking');
    if (el) el.classList.toggle('active', show);
  }

  /* ════════════════════════════════════════════════════════════════
     EVENT LISTENERS
  ════════════════════════════════════════════════════════════════ */
  function initEventListeners() {
    document.getElementById('runAnalysis').addEventListener('click', function () {
      showThinking(true);
      setTimeout(function () {
        runAnalysis();
        showThinking(false);
      }, 400);
    });

    document.getElementById('runSimulation').addEventListener('click', function () {
      runSimulationAsync();
    });

    // Auto-run on Enter key in any input
    document.querySelectorAll('.panel-left input, .panel-left select').forEach(el => {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('runAnalysis').click();
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════
     BOOT
  ════════════════════════════════════════════════════════════════ */
  function boot() {
    // Clock
    tickClock();
    setInterval(tickClock, 1000);

    // UI init
    initCollapseToggle();
    initEventListeners();

    // Auto-run initial analysis
    setTimeout(function () {
      showThinking(true);
      setTimeout(function () {
        runAnalysis();
        showThinking(false);
      }, 600);
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
