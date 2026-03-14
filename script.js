/**
 * WFM Intelligence Engine v4 — script.js
 * All analytics run entirely in the browser. No backend required.
 *
 * Modules:
 *  1.  Clock & Shift Progress
 *  2.  Erlang-C Staffing Engine
 *  3.  Intraday Performance (Run Rate, EOD Projection, Variance)
 *  4.  Service Level Projection
 *  5.  Capacity vs Workload Engine
 *  6.  Arrival Variability Analysis
 *  7.  Forecast Health (MAPE, Bias, Accuracy)
 *  8.  Intraday Reforecast Engine
 *  9.  Monte Carlo Simulation Engine
 * 10.  Operational Health Score
 * 11.  Staffing Action Recommendations
 * 12.  AI Operations Insights
 * 13.  AI Intraday Forecasting Brain
 * 14.  Alerts Ribbon
 * 15.  Intraday Intervals Table
 * 16.  Sparkline Charts
 * 17.  Email & Download Report
 * 18.  Tooltip System
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     EXAMPLE DATA
  ═══════════════════════════════════════════════════════════ */
  const EXAMPLE = {
    shiftStart:      '08:00',
    shiftEnd:        '20:00',
    currentTime:     '13:00',
    agentsScheduled: 45,
    shrinkage:       25,
    schedEfficiency: 92,
    forecastVolume:  550,
    actualVolume:    240,
    forecastAHT:     280,
    actualAHT:       305,
    callsInQueue:    8,
    occupancyTarget: 85,
    abandonRate:     5,
    targetSL:        80,
    answerTarget:    20,
    intervalMin:     30,
    historicalCV:    0.35,
    actualCV:        0.42,
    simCount:        '5000',
  };

  function loadExample() {
    Object.entries(EXAMPLE).forEach(([k, v]) => {
      const el = document.getElementById(k);
      if (el) el.value = v;
    });
    triggerAnalysis();
  }

  /* ═══════════════════════════════════════════════════════════
     HISTORY (for sparklines)
  ═══════════════════════════════════════════════════════════ */
  const H = { sl:[], agents:[], eod:[], rr:[], work:[], fte:[] };
  function pushHistory(arr, val) { arr.push(val); if (arr.length > 20) arr.shift(); }

  /* ═══════════════════════════════════════════════════════════
     MODULE 1 — CLOCK & SHIFT PROGRESS
  ═══════════════════════════════════════════════════════════ */
  function tickClock() {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const ts  = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    setText('liveClock', ts);
    setText('footerTime', 'Last tick: ' + ts);
    updateShiftBar();
  }

  function timeToMinutes(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + m;
  }

  function getShiftProgress(shiftStart, shiftEnd, currentTime) {
    const s = timeToMinutes(shiftStart);
    const e = timeToMinutes(shiftEnd);
    const c = timeToMinutes(currentTime);
    const total   = Math.max(1, e - s);
    const elapsed = Math.max(0, Math.min(c - s, total));
    return elapsed / total;
  }

  function updateShiftBar() {
    const ss = val('shiftStart') || '08:00';
    const se = val('shiftEnd')   || '20:00';
    const ct = val('currentTime') || nowHHMM();
    const pct = getShiftProgress(ss, se, ct) * 100;
    const fill = document.getElementById('shiftFillMini');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    setText('shiftPctMini', pct.toFixed(0) + '%');
  }

  function nowHHMM() {
    const n = new Date();
    return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 2 — ERLANG-C ENGINE
  ═══════════════════════════════════════════════════════════ */
  function erlangC(N, A) {
    if (N <= A) return 1.0;
    let sum = 1, factI = 1;
    for (let i = 1; i < N; i++) { factI *= i; sum += Math.pow(A, i) / factI; }
    const factN = factI * N;
    const term  = Math.pow(A, N) / factN;
    return term / (term + (1 - A / N) * sum);
  }

  function erlangSL(N, A, t, mu) {
    if (N <= A) return 0;
    const C  = erlangC(N, A);
    const sl = 1 - C * Math.exp(-(N - A) * mu * t);
    return Math.max(0, Math.min(sl, 1));
  }

  function erlangStaffingEngine({ callsPerInterval, aht, targetSL, targetTime, shrinkage, schedEfficiency }) {
    const intSec  = 1800; // 30-min default
    const lambda  = callsPerInterval / intSec; // arrival rate per second
    const A       = lambda * aht;              // traffic intensity (Erlangs)
    const mu      = 1 / aht;

    // Find minimum N agents to hit target SL
    let N = Math.max(1, Math.ceil(A) + 1);
    for (let iter = 0; iter < 300; iter++) {
      if (erlangSL(N, A, targetTime, mu) >= targetSL / 100) break;
      N++;
    }

    const C         = erlangC(N, A);
    const sl        = erlangSL(N, A, targetTime, mu) * 100;
    const asa       = N > A ? (C / ((N - A) * mu)) : 9999;
    const occ       = (A / N) * 100;
    const probDelay = C * 100;
    const shrinkF   = (1 - shrinkage / 100) * ((schedEfficiency || 92) / 100);
    const scheduled = Math.ceil(N / shrinkF);

    return { N, scheduled, A, sl, asa, occ, probDelay, lambda };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 3 — INTRADAY PERFORMANCE
  ═══════════════════════════════════════════════════════════ */
  function intradayPerformance({ shiftStart, shiftEnd, currentTime, forecastVolume, actualVolume, forecastAHT, actualAHT }) {
    const s          = timeToMinutes(shiftStart);
    const e          = timeToMinutes(shiftEnd);
    const c          = timeToMinutes(currentTime);
    const hoursElap  = Math.max(0, (c - s) / 60);
    const hoursRem   = Math.max(0, (e - c) / 60);
    const shiftHours = Math.max(1, (e - s) / 60);
    const runRate    = hoursElap > 0 ? actualVolume / hoursElap : 0;
    const eodVol     = actualVolume + runRate * hoursRem;
    const variance   = forecastVolume > 0 ? ((actualVolume - forecastVolume * (hoursElap / shiftHours)) / (forecastVolume * (hoursElap / shiftHours))) * 100 : 0;
    const ahtDrift   = forecastAHT > 0 ? ((actualAHT - forecastAHT) / forecastAHT) * 100 : 0;
    const shiftProg  = getShiftProgress(shiftStart, shiftEnd, currentTime);

    return { hoursElap, hoursRem, shiftHours, runRate, eodVol, variance, ahtDrift, shiftProg };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 4 — SERVICE LEVEL PROJECTION
  ═══════════════════════════════════════════════════════════ */
  function slProjection({ revisedVolume, actualAHT, agentsScheduled, shrinkage, schedEfficiency, targetSL, targetTime, intervalMin, shiftHours }) {
    const intSec      = intervalMin * 60;
    const intervals   = (shiftHours * 60) / intervalMin;
    const callsPerInt = revisedVolume / intervals;
    const lambda      = callsPerInt / intSec;
    const A           = lambda * actualAHT;
    const mu          = 1 / actualAHT;
    const shrinkF     = (1 - shrinkage / 100) * ((schedEfficiency || 92) / 100);
    const N           = Math.max(1, Math.round(agentsScheduled * shrinkF));
    const sl          = erlangSL(N, A, targetTime, mu) * 100;
    return { projectedSL: sl, targetSL, slGap: sl - targetSL, N };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 5 — CAPACITY vs WORKLOAD
  ═══════════════════════════════════════════════════════════ */
  function capacityWorkload({ revisedVolume, actualAHT, agentsScheduled, shrinkage, shiftHours }) {
    const reqHours = (revisedVolume * actualAHT) / 3600;
    const avail    = agentsScheduled * (1 - shrinkage / 100) * shiftHours;
    const delta    = avail - reqHours;
    const fteGap   = delta / shiftHours;
    const util     = avail > 0 ? reqHours / avail : 0;
    return { reqHours, avail, delta, fteGap, util };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 6 — ARRIVAL VARIABILITY
  ═══════════════════════════════════════════════════════════ */
  function arrivalVariability({ historicalCV, actualCV, forecastVolume, actualVolume, shiftProg, shiftHours, hoursRem }) {
    const shift      = historicalCV > 0 ? ((actualCV - historicalCV) / historicalCV) * 100 : 0;
    const burst      = (actualCV * actualCV - 1) / (actualCV * actualCV + 1);
    const conf       = actualCV < 0.3 ? 'HIGH' : actualCV < 0.5 ? 'MEDIUM' : 'LOW';
    const highVar    = actualCV > 0.5;
    const rrNow      = shiftProg > 0 ? actualVolume / (shiftProg * shiftHours) : 0;
    const peakOffset = (rrNow > forecastVolume / shiftHours * 1.1) ? 1 : 1.5;
    const now        = new Date();
    now.setMinutes(now.getMinutes() + Math.round(peakOffset * 60));
    const peak = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    return { cv: actualCV, burst, shift, conf, highVar, peak };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 7 — FORECAST HEALTH
  ═══════════════════════════════════════════════════════════ */
  function forecastHealth({ forecastVolume, actualVolume, forecastAHT, actualAHT, shiftProg }) {
    if (shiftProg <= 0.02) return { mape:0, bias:0, accuracy:100, driver:'INSUFFICIENT DATA', volDelta:0, ahtDrift:0 };
    const scaledActual = actualVolume / shiftProg;
    const mape    = Math.abs((scaledActual - forecastVolume) / forecastVolume) * 100;
    const bias    = ((scaledActual - forecastVolume) / forecastVolume) * 100;
    const accuracy = Math.max(0, 100 - mape);
    const volDelta = bias;
    const ahtDrift = ((actualAHT - forecastAHT) / forecastAHT) * 100;

    let driver = 'OPERATING WITHIN TOLERANCE';
    if (Math.abs(volDelta) > 15) driver = 'VOLUME SPIKE';
    else if (Math.abs(ahtDrift) > 10) driver = 'AHT DRIFT';
    else if (Math.abs(volDelta) > 8) driver = 'FORECAST ERROR';
    else if (accuracy < 90) driver = 'FORECAST VARIANCE';

    return { mape, bias, accuracy, driver, volDelta, ahtDrift };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 8 — INTRADAY REFORECAST ENGINE
  ═══════════════════════════════════════════════════════════ */
  function intradayReforecast({ forecastVolume, runRate, shiftProg, shiftHours }) {
    let fw, rw;
    if      (shiftProg < 0.30) { fw = 0.70; rw = 0.30; }
    else if (shiftProg < 0.60) { fw = 0.50; rw = 0.50; }
    else                        { fw = 0.30; rw = 0.70; }
    const rrFull   = runRate * shiftHours;
    const revised  = Math.round(fw * forecastVolume + rw * rrFull);
    return { fw: fw * 100, rw: rw * 100, revised, rrFull: Math.round(rrFull) };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 9 — MONTE CARLO SIMULATION
  ═══════════════════════════════════════════════════════════ */
  function monteCarlo({ revisedVolume, actualAHT, actualCV, agentsScheduled, shrinkage, schedEfficiency, targetSL, targetTime, intervalMin, shiftHours }, simCount) {
    simCount = simCount || 5000;
    const intSec    = intervalMin * 60;
    const intervals = (shiftHours * 60) / intervalMin;
    const shrinkF   = (1 - shrinkage / 100) * ((schedEfficiency || 92) / 100);
    const N         = Math.max(1, Math.round(agentsScheduled * shrinkF));
    const mu        = 1 / actualAHT;
    let slMet = 0;
    const results   = [];

    function randn() {
      let u=0, v=0;
      while (u===0) u=Math.random();
      while (v===0) v=Math.random();
      return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
    }

    for (let i=0; i<simCount; i++) {
      const vol  = Math.max(1, revisedVolume * (1 + actualCV * randn() * 0.4));
      const aht  = Math.max(60, actualAHT * (1 + 0.10 * randn()));
      const A    = (vol / intervals / intSec) * aht;
      const sl   = erlangSL(N, A, targetTime, 1/aht) * 100;
      results.push(sl);
      if (sl >= targetSL) slMet++;
    }

    results.sort((a,b) => a-b);
    return {
      probSL:    (slMet/simCount)*100,
      p10:       results[Math.floor(simCount*0.10)],
      p50:       results[Math.floor(simCount*0.50)],
      p90:       results[Math.floor(simCount*0.90)],
      simCount,
    };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 10 — OPERATIONAL HEALTH SCORE
  ═══════════════════════════════════════════════════════════ */
  function healthScore({ slProj, cap, forecast, arrival, erlang }) {
    const slScore   = Math.min(100, slProj.projectedSL);
    const capScore  = cap.delta >= 0 ? 100 : Math.max(0, 100 + (cap.delta/cap.reqHours)*50);
    const fcastScore= Math.max(0, 100 - forecast.mape*2);
    const ahtScore  = Math.max(0, 100 - Math.abs(forecast.ahtDrift||0)*3);
    const varScore  = arrival.highVar ? 50 : 85;
    const score     = Math.round(slScore*0.30 + capScore*0.25 + fcastScore*0.20 + ahtScore*0.15 + varScore*0.10);
    const s         = Math.max(0, Math.min(100, score));
    const state     = s >= 80 ? 'green' : s >= 50 ? 'amber' : 'red';
    const label     = s >= 80 ? 'OPTIMAL' : s >= 65 ? 'STABLE' : s >= 50 ? 'AT RISK' : 'CRITICAL';
    return { score: s, state, label };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 11 — STAFFING ACTIONS
  ═══════════════════════════════════════════════════════════ */
  function staffingActions({ slProj, cap, forecast, erlang }) {
    const actions = [];
    const gap = slProj.slGap;
    const fte = cap.fteGap;

    if (gap < -15) actions.push({ text:'Pull agents from offline work to active queue immediately', lvl:'urgent' });
    if (gap < -8)  actions.push({ text:'Delay scheduled lunches and breaks by 30–45 minutes', lvl:'urgent' });
    if (fte < -3)  actions.push({ text:`Authorize overtime — ${Math.abs(Math.ceil(fte))} FTE deficit detected`, lvl:'high' });
    if (cap.util > 0.95) actions.push({ text:'Move cross-skilled agents from secondary queues to inbound', lvl:'high' });
    if (forecast.ahtDrift > 10) actions.push({ text:`AHT +${forecast.ahtDrift.toFixed(0)}% above forecast — issue coaching bulletin`, lvl:'medium' });
    if (cap.util > 0.90) actions.push({ text:'Pause non-essential back-office activity', lvl:'high' });
    if (forecast.mape > 15) actions.push({ text:`Forecast deviation ${forecast.mape.toFixed(0)}% — notify planning team to recalibrate`, lvl:'medium' });
    if (actions.length === 0) {
      actions.push({ text:'Service level on target — maintain current staffing posture', lvl:'low' });
      actions.push({ text:'Continue monitoring arrival pattern for volume acceleration', lvl:'low' });
    }

    const top = actions.some(a=>a.lvl==='urgent') ? 'HIGH'
               : actions.some(a=>a.lvl==='high')  ? 'MEDIUM' : 'LOW';
    return { actions, top };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 12 — AI INSIGHTS
  ═══════════════════════════════════════════════════════════ */
  function aiInsights({ forecast, slProj, cap, arrival, erlang, idPerf, agentsScheduled }) {
    const ins = [];

    // Volume status
    if (Math.abs(forecast.volDelta||0) > 3) {
      const dir = forecast.volDelta > 0 ? 'above' : 'below';
      const mag = Math.abs(forecast.volDelta).toFixed(1);
      const lv  = Math.abs(forecast.volDelta) > 15 ? 'ai-crit' : Math.abs(forecast.volDelta) > 8 ? 'ai-warn' : 'ai-neutral';
      ins.push({ text:`Volume running ${mag}% ${dir} forecast — ${forecast.driver.toLowerCase()}.`, lv });
    }

    // AHT drift
    if (Math.abs(forecast.ahtDrift||0) > 5) {
      const dir = forecast.ahtDrift > 0 ? 'increased' : 'decreased';
      const lv  = Math.abs(forecast.ahtDrift) > 15 ? 'ai-crit' : 'ai-warn';
      ins.push({ text:`AHT ${dir} by ${Math.abs(forecast.ahtDrift).toFixed(1)}% — creating additional queue pressure.`, lv });
    }

    // SL
    if (slProj.slGap < -10) {
      ins.push({ text:`Service level projected at ${slProj.projectedSL.toFixed(1)}% — ${Math.abs(slProj.slGap).toFixed(1)}pp below target. Immediate action required.`, lv:'ai-crit' });
    } else if (slProj.slGap < 0) {
      ins.push({ text:`Service level at ${slProj.projectedSL.toFixed(1)}%, marginally below target. Monitor closely.`, lv:'ai-warn' });
    } else {
      ins.push({ text:`Service level tracking at ${slProj.projectedSL.toFixed(1)}% — ${slProj.slGap.toFixed(1)}pp above target. Operations stable.`, lv:'ai-good' });
    }

    // Capacity
    if (cap.delta < 0) {
      ins.push({ text:`Capacity deficit of ${Math.abs(cap.delta).toFixed(1)} hours. Workload exceeds available staffing — FTE gap: ${Math.abs(cap.fteGap).toFixed(1)}.`, lv:'ai-crit' });
    } else {
      ins.push({ text:`Capacity surplus of ${cap.delta.toFixed(1)} hours. Utilisation at ${(cap.util*100).toFixed(0)}%.`, lv:'ai-good' });
    }

    // Arrival variability
    if (arrival.highVar) {
      ins.push({ text:`High arrival randomness detected (CV: ${arrival.cv.toFixed(2)}) — forecast confidence reduced. Widen staffing buffer.`, lv:'ai-warn' });
    } else if (arrival.cv > arrival.historicalCV) {
      ins.push({ text:`Arrival pattern more volatile than forecast (CV ${arrival.cv.toFixed(2)} vs historical ${arrival.historicalCV?.toFixed(2)}).`, lv:'ai-warn' });
    }

    // Occupancy
    if (erlang.occ > 90) {
      ins.push({ text:`Agent occupancy at ${erlang.occ.toFixed(0)}% — above sustainable threshold. Burnout and error risk elevated.`, lv:'ai-crit' });
    }

    // Run rate
    const rrVsForecast = idPerf.runRate * idPerf.shiftHours;
    if (rrVsForecast > slProj.targetSL * 1.1) {
      ins.push({ text:`Run rate trending above forecast (${Math.round(idPerf.runRate)} calls/hr). End-of-day volume likely to exceed plan.`, lv:'ai-warn' });
    }

    return ins;
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 13 — AI BRAIN RISKS
  ═══════════════════════════════════════════════════════════ */
  function aiBrain({ forecast, arrival, slProj, cap, shiftProg }) {
    const pf = shiftProg < 0.3 ? 1.3 : shiftProg > 0.7 ? 0.8 : 1.0;
    const volRisk   = Math.min(100, Math.abs(forecast.volDelta||0) * 3.5 * pf);
    const queueRisk = Math.min(100, Math.max(0, (-slProj.slGap * 4) + cap.util * 40));
    const slRisk    = Math.min(100, Math.max(0, -slProj.slGap * 5 + (forecast.ahtDrift>0 ? forecast.ahtDrift*2:0)));
    const ahtRisk   = Math.min(100, Math.abs(forecast.ahtDrift||0) * 4);

    const alerts = [];
    if (volRisk > 60)   alerts.push({ text:'Volume spike likely within next 45 minutes.', lvl:'ah' });
    if (queueRisk > 55) alerts.push({ text:'Queue pressure predicted — intervene before next interval.', lvl:'ah' });
    if (slRisk > 50)    alerts.push({ text:'Service level at risk — staffing action recommended.', lvl:'am' });
    if (forecast.ahtDrift > 12) alerts.push({ text:`AHT trending upward (+${forecast.ahtDrift.toFixed(0)}%) — SL at risk.`, lvl:'am' });
    if (arrival.shift > 20) alerts.push({ text:`Arrival pattern shifted ${arrival.shift.toFixed(0)}% vs historical.`, lvl:'am' });
    if (slRisk < 25 && volRisk < 25) alerts.push({ text:'No immediate operational threats detected. Conditions stable.', lvl:'al' });

    return { risks:{ vol:volRisk, queue:queueRisk, sl:slRisk, aht:ahtRisk }, alerts };
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 14 — ALERTS RIBBON
  ═══════════════════════════════════════════════════════════ */
  function buildAlerts({ slProj, erlang, forecast, arrival }) {
    const chips = [];
    if (slProj.projectedSL < slProj.targetSL)        chips.push({ text:`⚠ SL ${slProj.projectedSL.toFixed(1)}% — below ${slProj.targetSL}% target`, cls:'a-red' });
    if (erlang.occ > 95)                              chips.push({ text:`⚠ Occupancy ${erlang.occ.toFixed(0)}% — critical`, cls:'a-red' });
    if (Math.abs(forecast.ahtDrift||0) > 10)          chips.push({ text:`⚠ AHT drift ${forecast.ahtDrift.toFixed(1)}%`, cls:'a-amber' });
    if (Math.abs(forecast.volDelta||0) > 15)          chips.push({ text:`⚠ Volume variance ${forecast.volDelta.toFixed(1)}%`, cls:'a-amber' });
    if (arrival.highVar)                              chips.push({ text:'⚠ High arrival variability', cls:'a-amber' });
    return chips;
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 15 — INTRADAY INTERVALS TABLE
  ═══════════════════════════════════════════════════════════ */
  function buildIntervalsTable({ shiftStart, shiftEnd, currentTime, forecastVolume, actualVolume, actualAHT, revisedVolume, agentsScheduled, shrinkage, schedEfficiency, targetSL, targetTime, intervalMin }) {
    const s    = timeToMinutes(shiftStart);
    const e    = timeToMinutes(shiftEnd);
    const cur  = timeToMinutes(currentTime);
    const rows = [];

    for (let t = s; t < e; t += intervalMin) {
      const tEnd      = Math.min(t + intervalMin, e);
      const label     = `${fmtMin(t)}–${fmtMin(tEnd)}`;
      const isPast    = tEnd <= cur;
      const isCurrent = t <= cur && cur < tEnd;
      const shiftMins = e - s;
      const sliceFrac = intervalMin / shiftMins;
      const fcVol     = Math.round(forecastVolume * sliceFrac);

      let actVol, rowAHT, rowState;
      if (isPast) {
        // Simulated actuals: bias actual toward actual volume pace
        const shiftProg = (tEnd - s) / shiftMins;
        const expActual = forecastVolume * sliceFrac;
        const drift     = (actualVolume / (forecastVolume * Math.max(.01,(cur-s)/shiftMins)));
        actVol = Math.round(expActual * drift * (0.92 + Math.random() * 0.16));
        rowAHT = Math.round(actualAHT * (0.95 + Math.random() * 0.10));
        rowState = 'past';
      } else if (isCurrent) {
        actVol = Math.round(revisedVolume * sliceFrac);
        rowAHT = actualAHT;
        rowState = 'current';
      } else {
        actVol = Math.round(revisedVolume * sliceFrac * (0.95 + Math.random() * 0.10));
        rowAHT = Math.round(actualAHT * (0.97 + Math.random() * 0.06));
        rowState = 'future';
      }

      // Erlang for this interval
      const intSec  = intervalMin * 60;
      const A       = (actVol / intSec) * rowAHT;
      const mu      = 1 / rowAHT;
      const shrinkF = (1 - shrinkage / 100) * ((schedEfficiency || 92) / 100);
      const N       = Math.max(1, Math.round(agentsScheduled * shrinkF));
      const sl      = erlangSL(N, A, targetTime, mu) * 100;

      // Min agents needed
      let minN = Math.ceil(A) + 1;
      for (let iter=0; iter<200; iter++) {
        if (erlangSL(minN, A, targetTime, mu) * 100 >= targetSL) break;
        minN++;
      }

      rows.push({ label, fcVol, actVol, rowAHT, minN, sl, rowState });
    }
    return rows;
  }

  function fmtMin(m) {
    return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 16 — SPARKLINES
  ═══════════════════════════════════════════════════════════ */
  function sparkline(id, data, color, fillColor) {
    const c = document.getElementById(id);
    if (!c || data.length < 2) return;
    const ctx = c.getContext('2d');
    const W=c.width, H=c.height;
    ctx.clearRect(0,0,W,H);
    const min=Math.min(...data), max=Math.max(...data);
    const rng = max-min || 1;
    const pts = data.map((v,i) => ({ x:(i/(data.length-1))*W, y:H-((v-min)/rng)*(H-4)-2 }));
    ctx.beginPath(); ctx.moveTo(pts[0].x,H);
    pts.forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.lineTo(pts[pts.length-1].x,H);
    ctx.closePath();
    ctx.fillStyle = fillColor || 'rgba(0,200,255,.07)';
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    pts.forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.strokeStyle=color||'#00c8ff'; ctx.lineWidth=1.5; ctx.lineJoin='round'; ctx.stroke();
    const last=pts[pts.length-1];
    ctx.beginPath(); ctx.arc(last.x,last.y,2.5,0,Math.PI*2);
    ctx.fillStyle=color||'#00c8ff'; ctx.fill();
  }

  /* ═══════════════════════════════════════════════════════════
     COLLECT INPUTS
  ═══════════════════════════════════════════════════════════ */
  function gNum(id, def) { return parseFloat(document.getElementById(id)?.value || def) || def; }
  function val(id) { return document.getElementById(id)?.value || ''; }

  function collectInputs() {
    const shiftStart      = val('shiftStart')  || '08:00';
    const shiftEnd        = val('shiftEnd')    || '20:00';
    const currentTime     = val('currentTime') || nowHHMM();
    const s = timeToMinutes(shiftStart);
    const e = timeToMinutes(shiftEnd);
    const c = timeToMinutes(currentTime);
    const shiftHours = Math.max(1, (e-s)/60);

    return {
      shiftStart, shiftEnd, currentTime, shiftHours,
      agentsScheduled: gNum('agentsScheduled', 45),
      shrinkage:       gNum('shrinkage', 25),
      schedEfficiency: gNum('schedEfficiency', 92),
      forecastVolume:  gNum('forecastVolume', 550),
      actualVolume:    gNum('actualVolume', 240),
      forecastAHT:     gNum('forecastAHT', 280),
      actualAHT:       gNum('actualAHT', 305),
      callsInQueue:    gNum('callsInQueue', 8),
      occupancyTarget: gNum('occupancyTarget', 85),
      abandonRate:     gNum('abandonRate', 5),
      targetSL:        gNum('targetSL', 80),
      targetTime:      gNum('answerTarget', 20),
      intervalMin:     gNum('intervalMin', 30),
      historicalCV:    gNum('historicalCV', 0.35),
      actualCV:        gNum('actualCV', 0.42),
    };
  }

  /* ═══════════════════════════════════════════════════════════
     MAIN ANALYSIS
  ═══════════════════════════════════════════════════════════ */
  function runAnalysis() {
    const inp = collectInputs();

    // Run all modules
    const idPerf    = intradayPerformance(inp);
    const rfcast    = intradayReforecast({ forecastVolume:inp.forecastVolume, runRate:idPerf.runRate, shiftProg:idPerf.shiftProg, shiftHours:inp.shiftHours });
    const revisedVolume = rfcast.revised;

    const intervals    = (inp.shiftHours * 60) / inp.intervalMin;
    const callsPerInt  = revisedVolume / intervals;

    const erlang    = erlangStaffingEngine({ callsPerInterval:callsPerInt, aht:inp.actualAHT, targetSL:inp.targetSL, targetTime:inp.targetTime, shrinkage:inp.shrinkage, schedEfficiency:inp.schedEfficiency });
    const slProj    = slProjection({ revisedVolume, actualAHT:inp.actualAHT, agentsScheduled:inp.agentsScheduled, shrinkage:inp.shrinkage, schedEfficiency:inp.schedEfficiency, targetSL:inp.targetSL, targetTime:inp.targetTime, intervalMin:inp.intervalMin, shiftHours:inp.shiftHours });
    const cap       = capacityWorkload({ revisedVolume, actualAHT:inp.actualAHT, agentsScheduled:inp.agentsScheduled, shrinkage:inp.shrinkage, shiftHours:inp.shiftHours });
    const arrival   = { ...arrivalVariability({ historicalCV:inp.historicalCV, actualCV:inp.actualCV, forecastVolume:inp.forecastVolume, actualVolume:inp.actualVolume, shiftProg:idPerf.shiftProg, shiftHours:inp.shiftHours, hoursRem:idPerf.hoursRem }), historicalCV:inp.historicalCV };
    const fcast     = forecastHealth({ forecastVolume:inp.forecastVolume, actualVolume:inp.actualVolume, forecastAHT:inp.forecastAHT, actualAHT:inp.actualAHT, shiftProg:idPerf.shiftProg });
    const health    = healthScore({ slProj, cap, forecast:fcast, arrival, erlang });
    const actions   = staffingActions({ slProj, cap, forecast:fcast, erlang });
    const insights  = aiInsights({ forecast:fcast, slProj, cap, arrival, erlang, idPerf, agentsScheduled:inp.agentsScheduled });
    const brain     = aiBrain({ forecast:fcast, arrival, slProj, cap, shiftProg:idPerf.shiftProg });
    const alerts    = buildAlerts({ slProj, erlang, forecast:fcast, arrival });
    const tableRows = buildIntervalsTable({ ...inp, revisedVolume });

    // Push history
    pushHistory(H.sl,     slProj.projectedSL);
    pushHistory(H.agents, erlang.N);
    pushHistory(H.eod,    idPerf.eodVol);
    pushHistory(H.rr,     idPerf.runRate);
    pushHistory(H.work,   cap.delta);
    pushHistory(H.fte,    cap.fteGap);

    // Render everything
    renderHealth(health);
    renderKPIs({ slProj, erlang, cap, idPerf, rfcast, inp });
    renderIntraday({ idPerf, inp, fcast });
    renderErlang(erlang);
    renderSL(slProj, idPerf);
    renderCapacity(cap);
    renderArrival(arrival, inp);
    renderForecast(fcast, rfcast);
    renderAIInsights(insights);
    renderAIBrain(brain);
    renderActions(actions);
    renderAlerts(alerts);
    renderTable(tableRows);
    renderSystemStatus(health);
    renderSparklines();
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER FUNCTIONS
  ═══════════════════════════════════════════════════════════ */

  function renderHealth(h) {
    const num  = document.getElementById('healthScoreNum');
    const stat = document.getElementById('healthStatus');
    const card = document.getElementById('healthCard');
    const ring = document.getElementById('healthRingFill');
    if (num)  num.textContent  = h.score;
    if (stat) stat.textContent = h.label;
    if (card) card.className   = `health-card s-${h.state}`;
    if (ring) ring.style.strokeDashoffset = 314 - (h.score/100)*314;
  }

  function renderKPIs({ slProj, erlang, cap, idPerf, rfcast, inp }) {
    const agentGap = inp.agentsScheduled - erlang.scheduled;
    setKPI('kpiSLVal', slProj.projectedSL.toFixed(1)+'%', slProj.slGap>=0?'good':slProj.slGap>-10?'warn':'crit',
      (slProj.slGap>=0?'+':'')+slProj.slGap.toFixed(1)+'pp vs target', slProj.slGap>=0?'pos':'neg', 'kpiSLCard');
    setKPI('kpiAgentsVal', String(erlang.scheduled), agentGap>=0?'good':'crit',
      (agentGap>=0?'+':'')+agentGap+' vs scheduled', agentGap>=0?'pos':'neg', 'kpiAgentsCard');
    setKPI('kpiVolumeVal', Math.round(idPerf.eodVol).toLocaleString(), 'neutral',
      'EOD projection', 'neu', 'kpiVolumeCard');
    setKPI('kpiRunRateVal', Math.round(idPerf.runRate).toLocaleString(), 'neutral',
      'calls/hr run rate', 'neu', 'kpiRunRateCard');
    setKPI('kpiWorkloadVal', (cap.delta>=0?'+':'')+cap.delta.toFixed(1)+' h', cap.delta>=0?'good':cap.delta>-5?'warn':'crit',
      cap.delta>=0?'Surplus':'Deficit', cap.delta>=0?'pos':'neg', 'kpiWorkloadCard');
    setKPI('kpiFTEVal', (cap.fteGap>=0?'+':'')+cap.fteGap.toFixed(1), cap.fteGap>=0?'good':cap.fteGap>-3?'warn':'crit',
      cap.fteGap>=0?'FTE surplus':'FTE shortfall', cap.fteGap>=0?'pos':'neg', 'kpiFTECard');
  }

  function setKPI(valId, valText, cardState, deltaText, deltaDir, cardId) {
    setText(valId, valText);
    const deltaId = valId.replace('Val','Delta');
    const deltaEl = document.getElementById(deltaId);
    if (deltaEl) { deltaEl.textContent=deltaText; deltaEl.className='kpi-delta '+(deltaDir||'neu'); }
    const card = document.getElementById(cardId);
    if (card) card.className = 'kpi-card '+(cardState!=='neutral'?cardState:'');
  }

  function renderIntraday({ idPerf, inp, fcast }) {
    setText('idHoursElapsed',  idPerf.hoursElap.toFixed(1)+'h');
    setText('idHoursRemaining',idPerf.hoursRem.toFixed(1)+'h');
    setText('idForecastVol',   inp.forecastVolume.toLocaleString());
    setText('idActualVol',     inp.actualVolume.toLocaleString());
    const varEl = document.getElementById('idVariance');
    if (varEl) {
      const v = idPerf.shiftProg > 0.02 ? fcast.volDelta : 0;
      varEl.textContent = (v>=0?'+':'')+v.toFixed(1)+'%';
      varEl.className   = 'id-value '+(Math.abs(v)<=5?'t-green':Math.abs(v)<=10?'t-amber':'t-red');
    }
    setText('idCallsQueue', inp.callsInQueue);
    setText('idAbandon',    inp.abandonRate+'%');
    const ahtEl = document.getElementById('idAHTDrift');
    if (ahtEl) {
      const d = fcast.ahtDrift;
      ahtEl.textContent = (d>=0?'+':'')+d.toFixed(1)+'%';
      ahtEl.className   = 'id-value '+(Math.abs(d)<=5?'t-green':Math.abs(d)<=10?'t-amber':'t-red');
    }

    // Variance bar
    const vb = document.getElementById('varianceBarFill');
    if (vb && idPerf.shiftProg > 0.02) {
      const v = fcast.volDelta;
      const clamp = Math.max(-20, Math.min(20, v));
      const pct   = Math.abs(clamp) / 20 * 50;
      if (v >= 0) {
        vb.style.left  = '50%';
        vb.style.width = pct+'%';
        vb.style.background = Math.abs(v)<=5 ? '#00ff88' : Math.abs(v)<=10 ? '#ffb300' : '#ff3d5a';
      } else {
        vb.style.left  = (50-pct)+'%';
        vb.style.width = pct+'%';
        vb.style.background = Math.abs(v)<=5 ? '#00ff88' : '#ff3d5a';
      }
    }
  }

  function renderErlang(e) {
    setText('eRequiredAgents', e.N);
    const occEl = document.getElementById('eOccupancy');
    if (occEl) {
      occEl.textContent = e.occ.toFixed(1)+'%';
      occEl.className   = 'em-value '+(e.occ>90?'t-red':e.occ>80?'t-amber':'t-green');
    }
    setText('eASA',           e.asa>999?'∞ sec':e.asa.toFixed(0)+' sec');
    setText('eProbDelay',     e.probDelay.toFixed(1)+'%');
    setText('eTraffic',       e.A.toFixed(2)+' Erl');
    setText('eScheduledNeeded', e.scheduled);
  }

  function renderSL(sl, idPerf) {
    setText('slProjected', sl.projectedSL.toFixed(1)+'%');
    setText('slTarget',    sl.targetSL+'%');
    const gapEl = document.getElementById('slGap');
    if (gapEl) {
      gapEl.textContent = (sl.slGap>=0?'+':'')+sl.slGap.toFixed(1)+'pp';
      gapEl.className   = 'slm-value '+(sl.slGap>=0?'t-green':sl.slGap>-10?'t-amber':'t-red');
    }
    const bar = document.getElementById('slBarFill');
    if (bar) bar.style.width = Math.min(100,sl.projectedSL)+'%';
    const marker = document.getElementById('slTargetMarker');
    if (marker) marker.style.left = Math.min(100,sl.targetSL)+'%';

    const risk = document.getElementById('slRiskBanner');
    if (risk) {
      if (sl.slGap < -15) { risk.textContent='⚠ CRITICAL — SL well below target'; risk.className='sl-risk r-crit'; }
      else if (sl.slGap < 0) { risk.textContent='⚠ WARNING — SL below target'; risk.className='sl-risk r-warn'; }
      else { risk.textContent='✓ ON TARGET — SL meeting objective'; risk.className='sl-risk r-ok'; }
    }

    // EOD box
    setText('eodVol',       Math.round(idPerf.eodVol).toLocaleString());
    setText('eodRR',        Math.round(idPerf.runRate).toLocaleString());
    setText('eodRemaining', idPerf.hoursRem.toFixed(1)+'h');
  }

  function renderCapacity(cap) {
    setText('capRequired',  cap.reqHours.toFixed(1)+' hrs');
    setText('capAvailable', cap.avail.toFixed(1)+' hrs');
    const dEl = document.getElementById('capDelta');
    if (dEl) { dEl.textContent=(cap.delta>=0?'+':'')+cap.delta.toFixed(1)+' hrs'; dEl.className='cap-value '+(cap.delta>=0?'t-green':'t-red'); }
    const fEl = document.getElementById('capFTE');
    if (fEl) { fEl.textContent=(cap.fteGap>=0?'+':'')+cap.fteGap.toFixed(1); fEl.className='cap-value '+(cap.fteGap>=0?'t-green':'t-red'); }

    const util = Math.min(150, cap.util*100);
    const bf = document.getElementById('capBarFill');
    if (bf) {
      bf.style.width = Math.min(100,util)+'%';
      bf.style.background = util>100?'linear-gradient(90deg,#ff3d5a,#ff8a00)':util>85?'linear-gradient(90deg,#ffb300,#ff8a00)':'linear-gradient(90deg,#00c8ff,#a855f7)';
    }
    setText('capBarPct', util.toFixed(0)+'%');
    const surp = document.getElementById('capSurplus');
    if (surp) {
      if (cap.delta >= 0) { surp.textContent='✓ CAPACITY SURPLUS — '+cap.delta.toFixed(1)+' hours available'; surp.className='cap-surplus surp'; }
      else { surp.textContent='⚠ CAPACITY DEFICIT — '+Math.abs(cap.delta).toFixed(1)+' hours short'; surp.className='cap-surplus defic'; }
    }
  }

  function renderArrival(arr, inp) {
    setText('arrCV',    arr.cv.toFixed(3));
    const burstEl = document.getElementById('arrBurst');
    if (burstEl) { burstEl.textContent=arr.burst.toFixed(3); burstEl.className='arr-value '+(arr.burst>0.3?'t-amber':'t-green'); }
    const shiftEl = document.getElementById('arrShift');
    if (shiftEl) { shiftEl.textContent=(arr.shift>=0?'+':'')+arr.shift.toFixed(1)+'%'; shiftEl.className='arr-value '+(Math.abs(arr.shift)>20?'t-red':Math.abs(arr.shift)>10?'t-amber':'t-green'); }
    const confEl = document.getElementById('arrConf');
    if (confEl) { confEl.textContent=arr.conf; confEl.className='arr-value '+(arr.conf==='HIGH'?'t-green':arr.conf==='MEDIUM'?'t-amber':'t-red'); }

    const cmpEl = document.getElementById('arrCVCompare');
    if (cmpEl) {
      if (arr.cv > inp.historicalCV) {
        cmpEl.textContent = `Arrival pattern more volatile than forecast (CV ${arr.cv.toFixed(2)} vs historical ${inp.historicalCV.toFixed(2)}).`;
        cmpEl.className   = 'arr-cv-compare cv-warn';
      } else {
        cmpEl.textContent = `Arrival pattern within historical range (CV ${arr.cv.toFixed(2)}).`;
        cmpEl.className   = 'arr-cv-compare cv-ok';
      }
    }
    const alertEl = document.getElementById('arrAlert');
    if (alertEl) {
      if (arr.highVar) { alertEl.textContent='High arrival randomness — forecasting confidence reduced.'; alertEl.className='arr-alert on'; }
      else { alertEl.className='arr-alert'; }
    }
    setText('arrPeakVal', arr.peak);
  }

  function renderForecast(f, rf) {
    const mEl = document.getElementById('mapeVal');
    const bEl = document.getElementById('biasVal');
    const aEl = document.getElementById('accVal');
    if (mEl) mEl.textContent = f.mape.toFixed(1)+'%';
    if (bEl) bEl.textContent = (f.bias>=0?'+':'')+f.bias.toFixed(1)+'%';
    if (aEl) aEl.textContent = f.accuracy.toFixed(1)+'%';

    const mf = document.getElementById('mapeFill');
    const af = document.getElementById('accFill');
    const bf = document.getElementById('biasFill');
    if (mf) mf.style.width = Math.min(100,f.mape*3)+'%';
    if (af) af.style.width = f.accuracy+'%';
    if (bf) {
      const p = Math.min(50, Math.abs(f.bias)*2);
      bf.style.width  = p+'%';
      bf.style.left   = f.bias>=0?'50%':(50-p)+'%';
      bf.style.background = f.bias>5?'#ffb300':f.bias<-5?'#ff3d5a':'#00ff88';
    }

    const vdEl = document.getElementById('varianceDriverText');
    if (vdEl) {
      vdEl.textContent = f.driver;
      vdEl.className   = 'vd-value '+(f.driver.includes('SPIKE')?'t-red':f.driver.includes('DRIFT')?'t-amber':f.driver.includes('TOLERANCE')?'t-green':'t-amber');
    }

    // Reforecast section
    setText('rfForeLabel', rf.fw.toFixed(0)+'%');
    setText('rfRRLabel',   rf.rw.toFixed(0)+'%');
    setText('rfRevisedVol',rf.revised.toLocaleString());
    const fw = document.getElementById('rfForeWeight');
    const rw = document.getElementById('rfRRWeight');
    if (fw) fw.style.width = rf.fw+'%';
    if (rw) rw.style.width = rf.rw+'%';
  }

  function renderAIInsights(ins) {
    const el = document.getElementById('aiInsights');
    if (!el) return;
    el.innerHTML = '';
    ins.forEach((i, idx) => {
      const div = document.createElement('div');
      div.className = 'ai-insight-item ' + i.lv;
      div.style.animationDelay = (idx*0.07)+'s';
      div.innerHTML = `<span class="ai-bullet">◈</span><span>${i.text}</span>`;
      el.appendChild(div);
    });
  }

  function renderAIBrain(brain) {
    setRisk('Vol',   brain.risks.vol);
    setRisk('Queue', brain.risks.queue);
    setRisk('SL',    brain.risks.sl);
    setRisk('AHT',   brain.risks.aht);

    const alertsEl = document.getElementById('radarAlerts');
    if (alertsEl) {
      alertsEl.innerHTML = '';
      brain.alerts.forEach(a => {
        const d = document.createElement('div');
        d.className = 'radar-alert '+a.lvl;
        d.textContent = a.text;
        alertsEl.appendChild(d);
      });
    }
  }

  function setRisk(name, val) {
    const fill = document.getElementById('risk'+name+'Fill');
    const pct  = document.getElementById('risk'+name+'Pct');
    const item = document.getElementById('ri'+name);
    if (fill) fill.style.width = Math.min(100,val).toFixed(0)+'%';
    if (pct)  pct.textContent  = Math.min(100,val).toFixed(0)+'%';
    if (item) {
      item.className = 'risk-item '+(val>60?'rh':val>35?'rm':'rl');
      const icon = item.querySelector('.risk-icon');
      if (icon) icon.textContent = val>60?'▲':val>35?'◆':'◈';
    }
  }

  function renderActions({ actions, top }) {
    const list = document.getElementById('actionsList');
    const pri  = document.getElementById('actionsPriority');
    if (!list) return;
    list.innerHTML = '';
    actions.forEach((a, i) => {
      const chip = document.createElement('div');
      chip.className = 'action-chip '+a.lvl;
      chip.innerHTML = `<span class="action-num">${i+1}</span>${a.text}`;
      list.appendChild(chip);
    });
    if (pri) {
      pri.textContent = top+' PRIORITY';
      pri.className   = 'actions-priority '+(top==='HIGH'?'ph':top==='MEDIUM'?'pm':'pl');
    }
  }

  function renderAlerts(chips) {
    const ribbon = document.getElementById('alertsRibbon');
    if (!ribbon) return;
    ribbon.innerHTML = '';
    chips.forEach(c => {
      const d = document.createElement('div');
      d.className  = 'alert-chip '+c.cls;
      d.textContent = c.text;
      ribbon.appendChild(d);
    });
    ribbon.style.display = chips.length ? 'flex' : 'none';
  }

  function renderTable(rows) {
    const tbody = document.getElementById('intradayTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    rows.forEach(r => {
      const slClass = r.sl >= 80 ? 'sl-cell-ok' : r.sl >= 65 ? 'sl-cell-warn' : 'sl-cell-crit';
      let badge, badgeCls;
      if (r.rowState === 'past')    { badge='ACTUAL';  badgeCls='sb-ok'; }
      else if (r.rowState === 'current') { badge='LIVE'; badgeCls='sb-warn'; }
      else { badge='EST'; badgeCls='sb-est'; }
      const tr = document.createElement('tr');
      if (r.rowState === 'past')    tr.className = 'row-past';
      if (r.rowState === 'current') tr.className = 'row-current';
      tr.innerHTML = `
        <td>${r.label}</td>
        <td>${r.fcVol}</td>
        <td>${r.actVol}</td>
        <td>${r.rowAHT}</td>
        <td>${r.minN}</td>
        <td class="${slClass}">${r.sl.toFixed(1)}%</td>
        <td><span class="status-badge ${badgeCls}">${badge}</span></td>`;
      tbody.appendChild(tr);
    });
  }

  function renderSystemStatus(h) {
    const pill = document.getElementById('systemStatusPill');
    const txt  = document.getElementById('systemStatusText');
    const labels = { green:'OPERATIONAL', amber:'AT RISK', red:'CRITICAL' };
    if (txt) txt.textContent = labels[h.state] || 'OPERATIONAL';
    if (pill) pill.className = 'status-pill '+(h.state==='amber'?'warn':h.state==='red'?'crit':'');
  }

  function renderSparklines() {
    sparkline('sparkSL',     H.sl,     '#00ff88','rgba(0,255,136,.06)');
    sparkline('sparkAgents', H.agents, '#ff3d5a','rgba(255,61,90,.06)');
    sparkline('sparkVol',    H.eod,    '#00c8ff','rgba(0,200,255,.06)');
    sparkline('sparkRR',     H.rr,     '#a855f7','rgba(168,85,247,.06)');
    sparkline('sparkWork',   H.work,   '#ffb300','rgba(255,179,0,.06)');
    sparkline('sparkFTE',    H.fte,    '#00c8ff','rgba(0,200,255,.04)');
  }

  /* ═══════════════════════════════════════════════════════════
     MODULE 17 — REPORT DOWNLOAD & EMAIL
  ═══════════════════════════════════════════════════════════ */
  function generateReportText() {
    const now = new Date().toLocaleString();
    const lines = [
      '══════════════════════════════════════════════',
      '  WFM INTELLIGENCE ENGINE — OPERATIONS REPORT',
      '══════════════════════════════════════════════',
      `  Generated: ${now}`,
      '',
    ];

    const fields = [
      ['forecastVolume','Forecast Volume'],
      ['actualVolume','Actual Volume (to now)'],
      ['forecastAHT','Forecast AHT (sec)'],
      ['actualAHT','Actual AHT (sec)'],
      ['agentsScheduled','Agents Scheduled'],
      ['shrinkage','Shrinkage %'],
      ['targetSL','Target Service Level %'],
      ['answerTarget','Answer Target (sec)'],
    ];
    lines.push('INPUTS');
    lines.push('──────────────────────────────────────────────');
    fields.forEach(([id,lbl]) => {
      const el = document.getElementById(id);
      if (el) lines.push(`  ${lbl}: ${el.value}`);
    });

    lines.push('','OPERATIONAL METRICS','──────────────────────────────────────────────');
    const metrics = [
      ['healthScoreNum','Operational Health Score'],
      ['kpiSLVal','Projected Service Level'],
      ['kpiAgentsVal','Agents Required'],
      ['kpiWorkloadVal','Workload Delta'],
      ['kpiFTEVal','FTE Gap'],
      ['kpiVolumeVal','EOD Volume Projection'],
      ['kpiRunRateVal','Run Rate (calls/hr)'],
      ['slProjected','Projected SL'],
      ['slTarget','Target SL'],
      ['slGap','SL Gap'],
      ['capRequired','Required Workload Hours'],
      ['capAvailable','Available Capacity Hours'],
      ['capDelta','Capacity Delta'],
      ['eodVol','End-of-Day Vol Projection'],
      ['eOccupancy','Agent Occupancy'],
      ['eASA','Avg Speed of Answer'],
      ['mapeVal','Forecast MAPE'],
      ['accVal','Forecast Accuracy'],
    ];
    metrics.forEach(([id,lbl]) => {
      const el = document.getElementById(id);
      if (el && el.textContent && el.textContent !== '--') lines.push(`  ${lbl}: ${el.textContent}`);
    });

    lines.push('','AI INSIGHTS','──────────────────────────────────────────────');
    document.querySelectorAll('#aiInsights .ai-insight-item span:last-child').forEach(el => {
      lines.push('  • '+el.textContent);
    });

    lines.push('','STAFFING ACTIONS','──────────────────────────────────────────────');
    document.querySelectorAll('#actionsList .action-chip').forEach((el,i) => {
      lines.push(`  ${i+1}. ${el.textContent.replace(/^\d+/,'').trim()}`);
    });

    lines.push('','══════════════════════════════════════════════');
    lines.push('  WFM Intelligence Engine v4.0 — client-side analytics');
    lines.push('══════════════════════════════════════════════');
    return lines.join('\n');
  }

  function downloadReport() {
    const text = generateReportText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `WFM_Operations_Report_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openEmailReport(provider) {
    const body    = encodeURIComponent(generateReportText());
    const subject = encodeURIComponent('WFM Operations Summary Report — ' + new Date().toLocaleDateString());
    if (provider === 'gmail') {
      window.open(`https://mail.google.com/mail/?view=cm&su=${subject}&body=${body}`, '_blank', 'noopener');
    } else {
      window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
    }
  }

  function showEmailMenu() {
    const existing = document.getElementById('emailMenu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'emailMenu';
    menu.style.cssText = 'position:fixed;top:58px;right:160px;z-index:500;background:#0c1118;border:1px solid rgba(0,180,255,.25);border-radius:6px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5)';
    menu.innerHTML = `
      <button onclick="window._wfmEmail('gmail')" style="display:block;width:100%;padding:9px 18px;background:none;border:none;color:#e8f4ff;font-family:var(--fu);font-size:12px;letter-spacing:.08em;cursor:pointer;text-align:left;" onmouseover="this.style.background='rgba(0,200,255,.07)'" onmouseout="this.style.background='none'">✉ Open in Gmail</button>
      <button onclick="window._wfmEmail('outlook')" style="display:block;width:100%;padding:9px 18px;background:none;border:none;color:#e8f4ff;font-family:var(--fu);font-size:12px;letter-spacing:.08em;cursor:pointer;text-align:left;" onmouseover="this.style.background='rgba(0,200,255,.07)'" onmouseout="this.style.background='none'">✉ Open in Outlook / Mail</button>`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function h(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click',h); } }), 100);
  }
  window._wfmEmail = openEmailReport;

  /* ═══════════════════════════════════════════════════════════
     MODULE 18 — TOOLTIP SYSTEM
  ═══════════════════════════════════════════════════════════ */
  function initTooltips() {
    const tip = document.getElementById('tooltipGlobal');
    if (!tip) return;

    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tip]') || e.target.closest('.tip-label[data-tip]');
      if (!el) return;
      tip.textContent = el.dataset.tip;
      tip.classList.add('visible');
      positionTip(e);
    });
    document.addEventListener('mousemove', e => {
      if (tip.classList.contains('visible')) positionTip(e);
    });
    document.addEventListener('mouseout', e => {
      const el = e.target.closest('[data-tip]') || e.target.closest('.tip-label[data-tip]');
      if (el) tip.classList.remove('visible');
    });

    function positionTip(e) {
      const x = e.clientX + 12;
      const y = e.clientY - 8;
      const tw = tip.offsetWidth || 220;
      const vw = window.innerWidth;
      tip.style.left = (x + tw > vw ? x - tw - 20 : x) + 'px';
      tip.style.top  = y + 'px';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     HELPER
  ═══════════════════════════════════════════════════════════ */
  function setText(id, v) { const el=document.getElementById(id); if(el) el.textContent=v; }

  /* ═══════════════════════════════════════════════════════════
     TRIGGER ANALYSIS (with thinking animation)
  ═══════════════════════════════════════════════════════════ */
  function triggerAnalysis() {
    const thinking = document.getElementById('aiThinking');
    if (thinking) thinking.classList.add('on');
    setTimeout(() => {
      runAnalysis();
      if (thinking) thinking.classList.remove('on');
    }, 420);
  }

  /* ═══════════════════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════════════════ */
  function boot() {
    tickClock();
    setInterval(tickClock, 1000);

    initTooltips();

    // Collapse panel
    const colBtn = document.getElementById('collapseInputs');
    const panel  = document.getElementById('inputPanel');
    if (colBtn && panel) {
      colBtn.addEventListener('click', () => {
        const c = panel.classList.toggle('collapsed');
        colBtn.textContent = c ? '▶' : '◀';
      });
    }

    // Buttons
    document.getElementById('runAnalysis')?.addEventListener('click', triggerAnalysis);
    document.getElementById('btnReforecast')?.addEventListener('click', triggerAnalysis);
    document.getElementById('btnReforecast2')?.addEventListener('click', triggerAnalysis);
    document.getElementById('btnLoadExample')?.addEventListener('click', loadExample);
    document.getElementById('btnLoadExamplePanel')?.addEventListener('click', loadExample);
    document.getElementById('btnDownloadReport')?.addEventListener('click', downloadReport);
    document.getElementById('btnSendReport')?.addEventListener('click', showEmailMenu);

    document.getElementById('runSimulation')?.addEventListener('click', () => {
      const statusEl = document.getElementById('simStatus');
      if (statusEl) { statusEl.textContent='RUNNING'; statusEl.className='sim-status run'; }
      const inp     = collectInputs();
      const idPerf  = intradayPerformance(inp);
      const rfcast  = intradayReforecast({ forecastVolume:inp.forecastVolume, runRate:idPerf.runRate, shiftProg:idPerf.shiftProg, shiftHours:inp.shiftHours });
      const simCount = parseInt(document.getElementById('simCount')?.value||'5000',10);
      setTimeout(() => {
        try {
          const result = monteCarlo({ ...inp, revisedVolume:rfcast.revised }, simCount);
          renderSimulation(result);
          if (statusEl) { statusEl.textContent='COMPLETE'; statusEl.className='sim-status done'; }
        } catch(err) {
          console.error(err);
          if (statusEl) { statusEl.textContent='ERROR'; statusEl.className='sim-status'; }
        }
      }, 80);
    });

    // Enter key triggers run
    document.querySelectorAll('.panel-scroll input, .panel-scroll select').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key==='Enter') triggerAnalysis(); });
    });

    // Auto-load example on first boot
    setTimeout(() => loadExample(), 400);
  }

  function renderSimulation(sim) {
    const el = document.getElementById('simResults');
    if (!el) return;
    el.innerHTML = `
      <div class="sim-output">
        <div class="sim-metric prob"><div class="sim-metric-lbl">PROB. MEETING SL</div><div class="sim-metric-val">${sim.probSL.toFixed(1)}%</div></div>
        <div class="sim-metric best"><div class="sim-metric-lbl">BEST CASE (P90)</div><div class="sim-metric-val">${sim.p90.toFixed(1)}%</div></div>
        <div class="sim-metric worst"><div class="sim-metric-lbl">WORST CASE (P10)</div><div class="sim-metric-val">${sim.p10.toFixed(1)}%</div></div>
        <div class="sim-metric"><div class="sim-metric-lbl">MEDIAN (P50)</div><div class="sim-metric-val">${sim.p50.toFixed(1)}%</div></div>
        <div class="sim-metric"><div class="sim-metric-lbl">SIMULATIONS</div><div class="sim-metric-val">${sim.simCount.toLocaleString()}</div></div>
        <div class="sim-metric"><div class="sim-metric-lbl">SL RANGE</div><div class="sim-metric-val">${(sim.p90-sim.p10).toFixed(1)}pp</div></div>
      </div>
      <div class="sim-prob-wrap">
        <div class="sim-prob-lbl">PROBABILITY OF MEETING SERVICE LEVEL TARGET</div>
        <div class="sim-prob-bar"><div class="sim-prob-fill" id="simProbFill" style="width:0%"></div></div>
      </div>`;
    setTimeout(() => { const f=document.getElementById('simProbFill'); if(f) f.style.width=sim.probSL+'%'; }, 100);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
