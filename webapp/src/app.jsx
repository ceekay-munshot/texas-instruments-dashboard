const { useState, useEffect, useCallback, useRef, useMemo } = React;
const GC = {"Power Management":"#f0a84e","Amplifiers":"#3d8ef0","Data Converters":"#00c9a7","Interface ICs":"#ab6af0","Isolation":"#f05c5c","Microcontrollers":"#6af0d4","GaN Power":"#f06090","Data Center Power":"#ffd700"};
const CATS = [
  {id:"pm_ldo",g:"Power Management",l:"LDO Regulators"},{id:"pm_acdc",g:"Power Management",l:"AC/DC Switching"},
  {id:"pm_dcdc",g:"Power Management",l:"DC/DC Switching"},{id:"pm_super",g:"Power Management",l:"Supervisor & Reset"},
  {id:"pm_batt",g:"Power Management",l:"Battery Mgmt"},{id:"amp_op",g:"Amplifiers",l:"Op-Amps"},
  {id:"amp_instr",g:"Amplifiers",l:"Instrumentation"},{id:"amp_audio",g:"Amplifiers",l:"Audio Amps"},
  {id:"dac_adc",g:"Data Converters",l:"ADC"},{id:"dac_dac",g:"Data Converters",l:"DAC"},
  {id:"if_can",g:"Interface ICs",l:"CAN Transceivers"},{id:"if_lin",g:"Interface ICs",l:"LIN Transceivers"},
  {id:"if_eth",g:"Interface ICs",l:"Ethernet PHYs"},{id:"iso_dig",g:"Isolation",l:"Digital Isolators"},
  {id:"iso_rein",g:"Isolation",l:"Reinforced Isolators"},{id:"mcu_msp",g:"Microcontrollers",l:"MSP430"},
  {id:"mcu_c2k",g:"Microcontrollers",l:"C2000 Real-Time"},{id:"mcu_m0",g:"Microcontrollers",l:"MSPM0"},
  {id:"mcu_cc",g:"Microcontrollers",l:"SimpleLink"},{id:"mcu_sit",g:"Microcontrollers",l:"Sitara MPU"},
  {id:"gan_342",g:"GaN Power",l:"LMG342x (600V)"},{id:"gan_365",g:"GaN Power",l:"LMG3650 (TOLL)"},
  {id:"gan_520",g:"GaN Power",l:"LMG5200 (80V)"},{id:"dc_48v",g:"Data Center Power",l:"48V Bus Converters"},
  {id:"dc_sps",g:"Data Center Power",l:"Smart Power Stages"},{id:"dc_efuse",g:"Data Center Power",l:"eFuses"},
  {id:"dc_hswap",g:"Data Center Power",l:"Hot-Swap Controllers"},{id:"dc_tps",g:"Data Center Power",l:"TPS536xx (AI Power)"},
];
const HIST = {
  "Jun-22":{pm_ldo:1.3,pm_acdc:0.5,pm_dcdc:0.5,pm_super:1.6,pm_batt:-1.4,amp_op:0.4,amp_instr:0.8,amp_audio:-0.1,dac_adc:0.0,dac_dac:0.1,if_can:0.8,if_lin:-0.4,if_eth:1.1,iso_dig:1.0,iso_rein:2.2,mcu_msp:1.3,mcu_c2k:2.7,mcu_m0:2.4,mcu_cc:1.7,mcu_sit:0.2,gan_342:3.0,gan_365:0.7,gan_520:-0.5,dc_48v:1.1,dc_sps:2.6,dc_efuse:1.7,dc_hswap:1.6,dc_tps:3.1},
  "Sep-22":{pm_ldo:-0.2,pm_acdc:-0.4,pm_dcdc:-0.4,pm_super:0.8,pm_batt:-0.9,amp_op:-0.4,amp_instr:-1.0,amp_audio:-1.0,dac_adc:-0.6,dac_dac:-0.6,if_can:-1.5,if_lin:-0.8,if_eth:-0.7,iso_dig:-0.1,iso_rein:-0.7,mcu_msp:1.4,mcu_c2k:1.4,mcu_m0:1.4,mcu_cc:3.5,mcu_sit:2.8,gan_342:0.1,gan_365:0.6,gan_520:-2.8,dc_48v:0.1,dc_sps:-2.4,dc_efuse:1.5,dc_hswap:-0.3,dc_tps:-0.3},
  "Dec-22":{pm_ldo:-0.3,pm_acdc:-0.1,pm_dcdc:-0.1,pm_super:-0.1,pm_batt:-1.3,amp_op:-0.3,amp_instr:-1.2,amp_audio:-0.7,dac_adc:-0.3,dac_dac:-0.6,if_can:-0.2,if_lin:-1.4,if_eth:1.1,iso_dig:1.0,iso_rein:-0.2,mcu_msp:-1.2,mcu_c2k:0.2,mcu_m0:-1.2,mcu_cc:-2.0,mcu_sit:0.1,gan_342:-1.5,gan_365:-2.1,gan_520:2.1,dc_48v:-0.3,dc_sps:1.3,dc_efuse:-0.9,dc_hswap:0.1,dc_tps:-1.0},
  "Mar-23":{pm_ldo:-0.5,pm_acdc:0.2,pm_dcdc:-0.4,pm_super:-0.4,pm_batt:0.3,amp_op:-0.7,amp_instr:-0.4,amp_audio:-0.3,dac_adc:-0.3,dac_dac:-0.6,if_can:0.0,if_lin:-0.9,if_eth:-1.0,iso_dig:-1.1,iso_rein:-0.1,mcu_msp:-0.1,mcu_c2k:1.9,mcu_m0:0.4,mcu_cc:0.9,mcu_sit:1.7,gan_342:-0.2,gan_365:1.4,gan_520:0.1,dc_48v:1.8,dc_sps:-2.1,dc_efuse:-0.2,dc_hswap:-0.6,dc_tps:-0.6},
  "Jun-23":{pm_ldo:-6.6,pm_acdc:-5.7,pm_dcdc:-5.7,pm_super:-6.1,pm_batt:-6.0,amp_op:-5.0,amp_instr:-4.8,amp_audio:-5.2,dac_adc:-2.6,dac_dac:-2.8,if_can:-2.7,if_lin:-2.9,if_eth:-1.5,iso_dig:-6.8,iso_rein:-5.5,mcu_msp:-3.1,mcu_c2k:-3.3,mcu_m0:-3.8,mcu_cc:-3.7,mcu_sit:-4.0,gan_342:-1.3,gan_365:-1.2,gan_520:-2.2,dc_48v:-1.4,dc_sps:-0.4,dc_efuse:-6.3,dc_hswap:-6.1,dc_tps:-2.1},
  "Sep-23":{pm_ldo:-4.9,pm_acdc:-5.5,pm_dcdc:-4.6,pm_super:-5.6,pm_batt:-6.2,amp_op:-4.4,amp_instr:-4.3,amp_audio:-2.5,dac_adc:-3.5,dac_dac:-3.4,if_can:-2.9,if_lin:-3.3,if_eth:-3.4,iso_dig:-3.8,iso_rein:-5.5,mcu_msp:-3.5,mcu_c2k:-4.7,mcu_m0:-6.0,mcu_cc:-4.4,mcu_sit:-3.9,gan_342:0.1,gan_365:-1.7,gan_520:-2.1,dc_48v:-3.9,dc_sps:-1.7,dc_efuse:-5.4,dc_hswap:-5.0,dc_tps:-3.5},
  "Dec-23":{pm_ldo:-0.5,pm_acdc:1.1,pm_dcdc:0.8,pm_super:-0.5,pm_batt:0.2,amp_op:-0.1,amp_instr:2.0,amp_audio:-0.8,dac_adc:-0.9,dac_dac:-0.7,if_can:-0.4,if_lin:-0.2,if_eth:-1.3,iso_dig:-0.7,iso_rein:0.2,mcu_msp:0.5,mcu_c2k:-0.8,mcu_m0:-0.5,mcu_cc:1.3,mcu_sit:1.9,gan_342:1.2,gan_365:0.4,gan_520:0.2,dc_48v:0.9,dc_sps:-0.8,dc_efuse:0.2,dc_hswap:0.1,dc_tps:0.0},
  "Mar-24":{pm_ldo:-1.7,pm_acdc:-1.0,pm_dcdc:-0.9,pm_super:-1.2,pm_batt:-2.8,amp_op:1.4,amp_instr:-0.4,amp_audio:0.5,dac_adc:0.9,dac_dac:0.7,if_can:2.6,if_lin:0.9,if_eth:-0.4,iso_dig:-1.9,iso_rein:-1.2,mcu_msp:-2.6,mcu_c2k:-1.5,mcu_m0:-2.9,mcu_cc:-2.7,mcu_sit:-3.2,gan_342:-0.6,gan_365:0.6,gan_520:-0.3,dc_48v:-1.2,dc_sps:1.2,dc_efuse:-1.5,dc_hswap:-1.2,dc_tps:-0.5},
  "Jun-24":{pm_ldo:-1.0,pm_acdc:-1.6,pm_dcdc:-1.5,pm_super:-0.3,pm_batt:-1.2,amp_op:-1.9,amp_instr:-0.8,amp_audio:-1.3,dac_adc:-1.1,dac_dac:0.5,if_can:-0.6,if_lin:-0.9,if_eth:0.3,iso_dig:-0.8,iso_rein:0.0,mcu_msp:-2.6,mcu_c2k:-1.8,mcu_m0:-2.7,mcu_cc:0.7,mcu_sit:-2.8,gan_342:-2.3,gan_365:-0.6,gan_520:-1.2,dc_48v:-0.5,dc_sps:0.1,dc_efuse:-1.7,dc_hswap:-1.1,dc_tps:-1.0},
  "Sep-24":{pm_ldo:-0.6,pm_acdc:-0.5,pm_dcdc:-0.7,pm_super:-0.5,pm_batt:-1.0,amp_op:-1.0,amp_instr:-0.8,amp_audio:0.1,dac_adc:-0.1,dac_dac:-1.0,if_can:-0.4,if_lin:0.0,if_eth:0.2,iso_dig:-1.4,iso_rein:0.0,mcu_msp:-0.1,mcu_c2k:-0.2,mcu_m0:-0.3,mcu_cc:-1.1,mcu_sit:-0.8,gan_342:-1.3,gan_365:-2.2,gan_520:-1.2,dc_48v:0.3,dc_sps:-2.1,dc_efuse:1.1,dc_hswap:-1.2,dc_tps:-1.0},
  "Dec-24":{pm_ldo:-1.2,pm_acdc:-0.3,pm_dcdc:-0.6,pm_super:-0.8,pm_batt:-1.2,amp_op:-0.3,amp_instr:-0.7,amp_audio:0.1,dac_adc:-0.4,dac_dac:-1.5,if_can:-0.7,if_lin:0.3,if_eth:-0.9,iso_dig:-0.9,iso_rein:-1.0,mcu_msp:-0.1,mcu_c2k:0.4,mcu_m0:-0.3,mcu_cc:-0.2,mcu_sit:0.0,gan_342:-0.9,gan_365:-3.5,gan_520:-0.6,dc_48v:-0.4,dc_sps:-0.5,dc_efuse:-0.4,dc_hswap:-1.9,dc_tps:-1.6},
  "Mar-25":{pm_ldo:-0.2,pm_acdc:0.7,pm_dcdc:-0.2,pm_super:0.1,pm_batt:0.5,amp_op:0.2,amp_instr:2.1,amp_audio:0.9,dac_adc:-0.1,dac_dac:0.8,if_can:-0.6,if_lin:0.4,if_eth:1.3,iso_dig:-0.9,iso_rein:-0.3,mcu_msp:0.2,mcu_c2k:-0.9,mcu_m0:-1.1,mcu_cc:-0.8,mcu_sit:0.5,gan_342:1.1,gan_365:0.9,gan_520:0.3,dc_48v:-1.0,dc_sps:0.3,dc_efuse:-0.3,dc_hswap:-0.7,dc_tps:2.8},
  "Jun-25":{pm_ldo:0.6,pm_acdc:0.8,pm_dcdc:0.2,pm_super:1.3,pm_batt:1.1,amp_op:0.1,amp_instr:0.3,amp_audio:1.2,dac_adc:-0.5,dac_dac:-0.3,if_can:0.3,if_lin:-0.3,if_eth:-2.5,iso_dig:1.3,iso_rein:0.2,mcu_msp:-1.2,mcu_c2k:-2.4,mcu_m0:-0.5,mcu_cc:-1.5,mcu_sit:0.5,gan_342:1.9,gan_365:2.4,gan_520:-0.9,dc_48v:1.3,dc_sps:2.6,dc_efuse:0.1,dc_hswap:-0.1,dc_tps:2.3},
  "Sep-25":{pm_ldo:2.3,pm_acdc:3.1,pm_dcdc:2.9,pm_super:1.8,pm_batt:2.5,amp_op:2.9,amp_instr:2.5,amp_audio:2.8,dac_adc:5.5,dac_dac:2.5,if_can:5.2,if_lin:4.9,if_eth:3.0,iso_dig:2.4,iso_rein:2.6,mcu_msp:2.7,mcu_c2k:1.9,mcu_m0:2.5,mcu_cc:1.8,mcu_sit:1.7,gan_342:3.9,gan_365:5.1,gan_520:4.2,dc_48v:6.8,dc_sps:5.5,dc_efuse:1.7,dc_hswap:2.9,dc_tps:5.2},
  "Dec-25":{pm_ldo:7.9,pm_acdc:8.6,pm_dcdc:9.0,pm_super:8.4,pm_batt:8.4,amp_op:9.8,amp_instr:8.5,amp_audio:8.7,dac_adc:13.7,dac_dac:10.9,if_can:12.0,if_lin:12.0,if_eth:11.3,iso_dig:9.6,iso_rein:8.0,mcu_msp:8.9,mcu_c2k:8.8,mcu_m0:7.8,mcu_cc:8.4,mcu_sit:7.6,gan_342:10.6,gan_365:12.0,gan_520:12.0,dc_48v:12.0,dc_sps:12.0,dc_efuse:9.1,dc_hswap:7.9,dc_tps:12.0},
  "Mar-26":{pm_ldo:2.9,pm_acdc:1.9,pm_dcdc:3.0,pm_super:5.5,pm_batt:3.9,amp_op:3.2,amp_instr:2.7,amp_audio:-0.7,dac_adc:5.3,dac_dac:3.9,if_can:5.9,if_lin:8.9,if_eth:2.8,iso_dig:3.8,iso_rein:4.8,mcu_msp:4.9,mcu_c2k:3.3,mcu_m0:8.5,mcu_cc:38.6,mcu_sit:-15.6,gan_342:4.9,gan_365:0.4,gan_520:4.5,dc_48v:8.8,dc_sps:5.4,dc_efuse:3.5,dc_hswap:4.4,dc_tps:7.9},
};
const HP=["Jun-22","Sep-22","Dec-22","Mar-23","Jun-23","Sep-23","Dec-23","Mar-24","Jun-24","Sep-24","Dec-24","Mar-25","Jun-25","Sep-25","Dec-25","Mar-26"];

function fmt(v){
  // Phase 23C.4 — show the actual numeric value to 2 decimal places for
  // every non-null reading, including 0% movement. Null still '—'. Tiny
  // movements (|v| < 0.05) get a muted color so the visual "no
  // meaningful movement" cue is preserved without hiding the digits.
  if(v==null)return{txt:"—",col:"#2a4060",bold:false};
  const abs=Math.abs(v);
  const big=abs>=5,pos=v>=0;
  const tiny=abs<0.05;
  const txt=pos?`+${v.toFixed(2)}%`:`(${abs.toFixed(2)}%)`;
  const col=tiny?"#5a7a98":(pos?(big?"#4dffc3":"#00c9a7"):(big?"#ff7575":"#f05c5c"));
  return{txt,col,bold:big};
}

// ── Toast system ──────────────────────────────────────────────────────────────
let _toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type='info', duration=5000) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, msg, type, duration, exiting: false }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts(t => t.map(x => x.id === id ? {...x, exiting: true} : x));
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 220);
      }, duration);
    }
    return id;
  }, []);
  const dismiss = useCallback((id) => {
    setToasts(t => t.map(x => x.id === id ? {...x, exiting: true} : x));
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 220);
  }, []);
  return { toasts, push, dismiss };
}

// Phase 23C.5 — persist Mouser rate-limit cooldown across page reloads so
// hard-refreshing during a known cooldown does not re-pop the persistent
// rate-limit toast (the page would call /api/prices, hit the still-active
// Mouser quota, and surface the warn toast on every load).
const RATE_LIMIT_LS_KEY = 'tip-mouser-rate-limit-until';
function readPersistedRateLimit() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RATE_LIMIT_LS_KEY);
    if (!raw) return null;
    if (new Date(raw).getTime() <= Date.now()) {
      window.localStorage.removeItem(RATE_LIMIT_LS_KEY);
      return null;
    }
    return raw;
  } catch { return null; }
}
function writePersistedRateLimit(retryAt) {
  if (typeof window === 'undefined') return;
  try {
    if (retryAt) window.localStorage.setItem(RATE_LIMIT_LS_KEY, retryAt);
    else window.localStorage.removeItem(RATE_LIMIT_LS_KEY);
  } catch {}
}

// Countdown toast component for rate limiting
function RateLimitToast({ retryAt, onDismiss }) {
  const [secsLeft, setSecsLeft] = useState(null);
  useEffect(() => {
    function tick() {
      const diff = Math.max(0, Math.ceil((new Date(retryAt) - Date.now()) / 1000));
      setSecsLeft(diff);
      if (diff <= 0) onDismiss && onDismiss();
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [retryAt]);

  const totalSecs = Math.ceil((new Date(retryAt) - Date.now()) / 1000 + (secsLeft||0));
  const pct = secsLeft != null && totalSecs > 0 ? Math.max(0, (secsLeft / Math.max(totalSecs, 60)) * 100) : 100;
  const mins = secsLeft != null ? Math.floor(secsLeft / 60) : '—';
  const secs = secsLeft != null ? String(secsLeft % 60).padStart(2,'0') : '—';

  return (
    <div style={{color:'#f0a84e'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
        <span style={{fontSize:'0.9rem'}}>⚡</span>
        <span style={{fontWeight:'bold',fontSize:'0.7rem',letterSpacing:'0.05em'}}>MOUSER API RATE LIMIT</span>
      </div>
      <div style={{fontSize:'0.62rem',color:'#c4d4e8',lineHeight:1.5}}>
        The API's hourly quota was reached mid-fetch. Historical data is unaffected.<br/>
        Live prices will auto-refresh when the limit resets.
      </div>
      <div style={{marginTop:10,display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:'0.58rem',color:'#2d4a6b'}}>RETRY IN</span>
        <span style={{fontSize:'1.1rem',fontFamily:'monospace',color:'#ffd700',letterSpacing:'0.1em',fontWeight:'bold'}}>
          {mins}:{secs}
        </span>
      </div>
      <div className="progress-bar-outer" style={{marginTop:6}}>
        <div className="progress-bar-inner" style={{width:`${pct}%`,background:'linear-gradient(90deg,#7a3f00,#f0a84e)'}}/>
      </div>
    </div>
  );
}

function ToastShell({ toast, onDismiss }) {
  const border = toast.type==='error' ? '#4a1010' : toast.type==='warn' ? '#3a2800' : toast.type==='success' ? '#0a2a1a' : '#1a2740';
  const icon = toast.type==='error' ? '✗' : toast.type==='warn' ? '⚠' : toast.type==='success' ? '✓' : 'ℹ';
  const col = toast.type==='error' ? '#f05c5c' : toast.type==='warn' ? '#f0a84e' : toast.type==='success' ? '#00c9a7' : '#3d8ef0';
  return (
    <div className={`toast${toast.exiting?' exit':''}`} style={{borderColor:border}}>
      {typeof toast.msg === 'string' ? (
        <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
          <span style={{color:col,fontSize:'0.85rem',lineHeight:1.2}}>{icon}</span>
          <span style={{color:'#c4d4e8',fontSize:'0.65rem',lineHeight:1.5}}>{toast.msg}</span>
        </div>
      ) : toast.msg}
      <button onClick={()=>onDismiss(toast.id)} style={{position:'absolute',top:8,right:10,background:'none',border:'none',color:'#2d4a6b',cursor:'pointer',fontSize:'0.8rem',lineHeight:1}}>×</button>
      {toast.duration > 0 && (
        <div className="toast-bar" style={{
          background:col,
          animation:`countdown ${toast.duration}ms linear forwards`
        }}/>
      )}
    </div>
  );
}

// ── Signal Summary — derived metrics from liveData ────────────────────────────
// Pure function; safe for any subset of live categories. Returns a state token
// so the UI can render Waiting / No-live / Ready uniformly.
function computeSignal(liveData) {
  if (!liveData) return { state: 'waiting' };
  const live = CATS
    .map(c => ({ ...c, ...(liveData[c.id] || {}) }))
    .filter(d => d.live && d.qoqPct != null && Number.isFinite(d.qoqPct));
  const total = CATS.length;
  if (live.length === 0) return { state: 'no-live', total };

  const values = live.map(d => d.qoqPct);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const upCount = values.filter(v => v > 0).length;
  const downCount = values.filter(v => v < 0).length;
  const breadthUp = upCount / values.length;
  const breadthDown = downCount / values.length;

  const groups = {};
  live.forEach(c => { (groups[c.g] = groups[c.g] || []).push(c.qoqPct); });
  const groupAvgs = Object.entries(groups)
    .map(([g, vs]) => ({ g, avg: vs.reduce((s, v) => s + v, 0) / vs.length, n: vs.length }))
    .sort((a, b) => b.avg - a.avg);
  const strongestGroup = groupAvgs[0];
  const weakestGroup = groupAvgs[groupAvgs.length - 1];

  const topUp = [...live].filter(d => d.qoqPct > 0).sort((a, b) => b.qoqPct - a.qoqPct).slice(0, 5);
  const topDown = [...live].filter(d => d.qoqPct < 0).sort((a, b) => a.qoqPct - b.qoqPct).slice(0, 5);

  const inflationFlags = live.filter(d => d.qoqPct >= 5);
  const deflationFlags = live.filter(d => d.qoqPct <= -5);
  const outliers = live.filter(d => Math.abs(d.qoqPct) >= 10);

  const partial = live.length < total * 0.5;
  let tone, toneColor;
  if (partial) { tone = 'Insufficient live data'; toneColor = '#f0a84e'; }
  else if (breadthUp >= 0.75 && median >= 2) { tone = 'Broad inflation'; toneColor = '#4dffc3'; }
  else if (breadthUp >= 0.50 && median > 0) { tone = 'Selective inflation'; toneColor = '#00c9a7'; }
  else if (breadthDown >= 0.75 && median <= -2) { tone = 'Broad deflation'; toneColor = '#ff7575'; }
  else { tone = 'Mixed'; toneColor = '#f0a84e'; }

  const fmtSigned = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  let interp;
  if (partial) {
    interp = `partial live coverage (${live.length}/${total}) — interpretation pending broader fetch.`;
  } else if (tone === 'Broad inflation') {
    interp = `price pressure is broadening across ${strongestGroup.g} and adjacent groups (median ${fmtSigned(median)}, ${(breadthUp*100).toFixed(0)}% of basket positive).`;
  } else if (tone === 'Selective inflation') {
    if (inflationFlags.length === 0) {
      interp = `mild upward bias; no category currently above the +5% inflation flag (median ${fmtSigned(median)}).`;
    } else {
      const lead = inflationFlags.slice(0, 2).map(d => d.l).join(', ');
      interp = `inflation concentrated in ${inflationFlags.length} ${inflationFlags.length === 1 ? 'category' : 'categories'} (${lead}${inflationFlags.length > 2 ? ', …' : ''}); broad basket remains modest.`;
    }
  } else if (tone === 'Broad deflation') {
    interp = `prices softening broadly, led by ${weakestGroup.g} (group avg ${fmtSigned(weakestGroup.avg)}).`;
  } else {
    interp = `live spot pricing is mixed; no clean broad-cycle signal yet (median ${fmtSigned(median)}, ${(breadthUp*100).toFixed(0)}% positive).`;
  }

  return {
    state: 'ready', partial, total, liveCount: live.length,
    tone, toneColor, median, mean,
    upCount, downCount, breadthUp,
    topUp, topDown, strongestGroup, weakestGroup,
    inflationFlags, deflationFlags, outliers, interp
  };
}

function SignalSummary({ liveData, baselineMeta }) {
  const sig = useMemo(() => computeSignal(liveData), [liveData]);
  const fmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const wrap = { padding: '14px 16px', borderBottom: '1px solid #1a2740', background: '#050810' };
  const label = { fontSize: '0.6rem', color: '#6b8aa8', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 'bold' };
  const headerLabel = '▼ Live signal — spot vs latest baseline';

  if (sig.state === 'waiting') {
    return (
      <div style={{ ...wrap, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={label}>{headerLabel}</span>
        <span style={{ fontSize: '0.7rem', color: '#7a96b8' }}>· Waiting for live Mouser data…</span>
      </div>
    );
  }
  if (sig.state === 'no-live') {
    return (
      <div style={{ ...wrap, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={label}>{headerLabel}</span>
        <span style={{ fontSize: '0.7rem', color: '#f0a84e' }}>· No live categories available — waiting for live Mouser data.</span>
      </div>
    );
  }

  const Tile = ({ name, value, sub, color }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
      <div style={label}>{name}</div>
      <div style={{ fontSize: '0.92rem', fontFamily: 'monospace', color: color || '#e0eaf8', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.65rem', color: '#7a96b8', fontFamily: 'monospace' }}>{sub}</div>}
    </div>
  );

  const moverColor = (v, up) => up
    ? (Math.abs(v) >= 5 ? '#4dffc3' : '#00c9a7')
    : (Math.abs(v) >= 5 ? '#ff7575' : '#f05c5c');
  const moverWeight = v => Math.abs(v) >= 5 ? 'bold' : 'normal';

  const MoverList = ({ rows, up }) => (
    rows.length === 0
      ? <div style={{ fontSize: '0.72rem', color: '#7a96b8', fontFamily: 'monospace', marginTop: 6 }}>none</div>
      : <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, fontFamily: 'monospace', fontSize: '0.74rem' }}>
          {rows.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, maxWidth: 340 }}>
              <span style={{ color: '#c4d4e8' }}>{d.l}</span>
              <span style={{ color: moverColor(d.qoqPct, up), fontWeight: moverWeight(d.qoqPct) }}>{fmt(d.qoqPct)}</span>
            </div>
          ))}
        </div>
  );

  const FlagRow = ({ icon, name, count, items, activeColor }) => {
    const active = count > 0;
    const dim = '#7a96b8';
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontFamily: 'monospace', fontSize: '0.72rem', flexWrap: 'wrap' }}>
        <span style={{ width: 18, color: active ? activeColor : dim, fontSize: '0.85rem' }}>{icon}</span>
        <span style={{ minWidth: 170, color: active ? '#c4d4e8' : dim }}>{name}</span>
        <span style={{ minWidth: 28, color: active ? activeColor : dim, fontWeight: 'bold', fontSize: '0.85rem' }}>{count}</span>
        {active && <span style={{ color: '#a0b8d0', flex: 1 }}>{items.map(d => d.l).join(' · ')}</span>}
      </div>
    );
  };

  return (
    <div style={wrap}>
      {/* Headline: tone + signal sentence + baseline freshness */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={label}>
            {headerLabel}{sig.partial && <span style={{ color: '#f0a84e', marginLeft: 6 }}>· partial coverage</span>}
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: sig.toneColor, fontFamily: 'monospace', marginTop: 5, lineHeight: 1.1 }}>
            {sig.tone}
          </div>
          <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#c4d4e8', lineHeight: 1.5, maxWidth: 880 }}>
            <span style={{ color: '#ffd700', fontWeight: 'bold' }}>Signal:</span> {sig.interp}
          </div>
          <div style={{ marginTop: 4, fontSize: '0.66rem', color: '#7a96b8', fontStyle: 'italic' }}>
            Early-warning live monitor; not a finalized quarterly row.
          </div>
        </div>
        <div style={{ fontSize: '0.66rem', color: '#7a96b8', fontFamily: 'monospace', textAlign: 'right', minWidth: 220 }}>
          <div style={{ ...label, color: '#6b8aa8', textAlign: 'right' }}>Latest baseline</div>
          <div style={{ marginTop: 3, color: '#c4d4e8', fontSize: '0.74rem' }}>
            {baselineMeta?.baselinePeriodLabel || 'Q1-26 snapshot'}
          </div>
          <div style={{ marginTop: 1 }}>
            captured {baselineMeta?.baselineDate || '2026-02-27'}
            {baselineMeta?.baselineAgeDays != null && <span> · {baselineMeta.baselineAgeDays}d ago</span>}
          </div>
          <div style={{ marginTop: 1 }}>
            {sig.liveCount}/{sig.total} categories live · CF cache 6h
          </div>
          {baselineMeta?.baselineIsStale && (
            <div style={{ marginTop: 4, color: '#f0a84e' }}>
              Baseline review due — capture next quarterly baseline.
            </div>
          )}
        </div>
      </div>

      {/* Metric tiles */}
      <div style={{ marginTop: 14, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start', paddingTop: 12, borderTop: '1px solid #0d1520' }}>
        <Tile name="Breadth" value={`${sig.upCount} / ${sig.liveCount}`} sub={`${(sig.breadthUp * 100).toFixed(0)}% positive`} />
        <Tile name="Median" value={fmt(sig.median)} color={sig.median >= 0 ? '#00c9a7' : '#f05c5c'} />
        <Tile name="Average" value={fmt(sig.mean)} color={sig.mean >= 0 ? '#00c9a7' : '#f05c5c'} />
        <Tile name="Strongest group" value={sig.strongestGroup.g} sub={fmt(sig.strongestGroup.avg)} color={GC[sig.strongestGroup.g]} />
        <Tile name="Weakest group" value={sig.weakestGroup.g} sub={fmt(sig.weakestGroup.avg)} color={GC[sig.weakestGroup.g]} />
      </div>

      {/* Top movers — two clean columns */}
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 32, paddingTop: 12, borderTop: '1px solid #0d1520' }}>
        <div>
          <div style={label}>▲ Top up</div>
          <MoverList rows={sig.topUp} up={true} />
        </div>
        <div>
          <div style={label}>▼ Top down</div>
          <MoverList rows={sig.topDown} up={false} />
        </div>
      </div>

      {/* Anomaly flags — one per row, aligned columns */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #0d1520' }}>
        <div style={{ ...label, marginBottom: 6 }}>Anomaly flags</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FlagRow icon="⚡" name="Inflation ≥ +5%" count={sig.inflationFlags.length} items={sig.inflationFlags} activeColor="#4dffc3" />
          <FlagRow icon="⬇" name="Deflation ≤ −5%" count={sig.deflationFlags.length} items={sig.deflationFlags} activeColor="#ff7575" />
          <FlagRow icon="◆" name="Major outlier |Δ| ≥ 10%" count={sig.outliers.length} items={sig.outliers} activeColor="#f0a84e" />
        </div>
      </div>
    </div>
  );
}

// ── Source Agreement Table (Phase 16B) ───────────────────────────────────────
// Customer-facing readable table over /api/snapshots/evidence/combined.
// Read-only; consumes the already-fetched `combinedEvidence` payload.
// No new endpoints, no extra page-load fetches.
const AGREEMENT_ORDER = {
  divergent: 0,
  moderate_agreement: 1,
  strong_agreement: 2,
  single_source_only: 3,
  insufficient_data: 4,
};
const AGREEMENT_LABEL = {
  divergent: 'Divergent',
  moderate_agreement: 'Moderate',
  strong_agreement: 'Strong',
  single_source_only: 'Single source',
  insufficient_data: 'Insufficient',
};
const AGREEMENT_COLOR = {
  strong_agreement: '#4dffc3',
  moderate_agreement: '#00c9a7',
  divergent: '#f0a84e',
  single_source_only: '#7a96b8',
  insufficient_data: '#4a6a8a',
};

function sourceStateFor(row) {
  const m = row.mouserPrice != null;
  const n = row.nexarTrustedPrice != null;
  if (m && n) return { label: 'Both sources', color: '#4dffc3' };
  if (m) return { label: 'Mouser only', color: '#7a96b8' };
  if (n) return { label: 'Nexar only', color: '#7a96b8' };
  return { label: 'No data', color: '#4a6a8a' };
}

// Phase 17A: trend label + color mapping. Order matters for the legend.
const TREND_LABEL = {
  possible_shortage: 'Possible shortage',
  easing_supply: 'Easing supply',
  tight_but_unpriced: 'Tight inventory',
  price_pressure_without_stock_signal: 'Price pressure',
  mixed: 'Mixed',
  insufficient_history: 'Pending',
};
const TREND_COLOR = {
  possible_shortage: '#f0a84e',
  easing_supply: '#4dffc3',
  tight_but_unpriced: '#f0a84e',
  price_pressure_without_stock_signal: '#f0a84e',
  mixed: '#7a96b8',
  insufficient_history: '#4a6a8a',
};
function trendCellFor(row) {
  const t = row?.trend;
  if (!t) return { label: 'Pending', color: '#4a6a8a', tooltip: 'Needs 2 dated snapshots.', source: null, confidence: 'pending', confidenceLabel: 'Pending' };
  const label = TREND_LABEL[t.signal] || 'Pending';
  const color = TREND_COLOR[t.signal] || '#4a6a8a';
  const confidence = t.trendConfidence || 'pending';
  const confidenceLabel = CONFIDENCE_LABEL[confidence] || 'Pending';
  let tooltip = 'Trend uses dated snapshots, not same-day source comparison.';
  tooltip += ` Confidence: ${confidence}.`;
  if (t.trendConfidenceReason) tooltip += ` Reason: ${t.trendConfidenceReason}`;
  return { label, color, tooltip, source: t.source, confidence, confidenceLabel };
}

// Phase 17B: confidence badge labels and colors.
const CONFIDENCE_LABEL = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  pending: 'Pending',
};
const CONFIDENCE_COLOR = {
  high: '#4dffc3',
  medium: '#00c9a7',
  low: '#f0a84e',
  pending: '#4a6a8a',
};

function fmtPrice(v) { return v == null ? '—' : `$${Number(v).toFixed(4)}`; }
function fmtInv(v) { return v == null ? '—' : Number(v).toLocaleString(); }
function fmtDeltaPct(v) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v}%`;
}

function SourceAgreementTable({ combined, trendMeta }) {
  const [filter, setFilter] = useState('all');
  const wrap = { padding: '14px 16px', borderBottom: '1px solid #1a2740', background: '#050810' };
  const label = { fontSize: '0.6rem', color: '#6b8aa8', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 'bold' };

  // No useful cross-source data → render nothing. The customer doesn't need
  // a "Waiting for snapshots" placeholder; they get useful content from the
  // Live signal panel above. A slim status appears in the Insights footer.
  if (!combined) return null;
  if (combined.status === 'snapshot_storage_not_configured') return null;
  if (combined.status === 'no_snapshots') return null;
  if (combined.status === 'mouser_only') return null;

  const rows = combined.sourceAgreement || [];
  const total = rows.length;
  const counts = {
    bothSources: rows.filter(r => r.mouserPrice != null && r.nexarTrustedPrice != null).length,
    strongOrModerate: rows.filter(r => r.agreementStatus === 'strong_agreement' || r.agreementStatus === 'moderate_agreement').length,
    divergent: rows.filter(r => r.agreementStatus === 'divergent').length,
    singleSource: rows.filter(r => r.agreementStatus === 'single_source_only').length,
    insufficient: rows.filter(r => r.agreementStatus === 'insufficient_data').length,
  };

  // Filter chips
  const visibleRows = rows.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'divergent') return r.agreementStatus === 'divergent';
    if (filter === 'agreement') return r.agreementStatus === 'strong_agreement' || r.agreementStatus === 'moderate_agreement';
    if (filter === 'single') return r.agreementStatus === 'single_source_only';
    return true;
  });

  // Sort: divergent → moderate → strong → single_source → insufficient.
  // Stable: ties by canonicalCategoryId.
  const sortedRows = visibleRows.slice().sort((a, b) => {
    const oa = AGREEMENT_ORDER[a.agreementStatus] ?? 99;
    const ob = AGREEMENT_ORDER[b.agreementStatus] ?? 99;
    if (oa !== ob) return oa - ob;
    return (a.canonicalCategoryId || '').localeCompare(b.canonicalCategoryId || '');
  });

  const headerLabel = '▼ Source agreement — Mouser backbone + Nexar rotating corroboration';

  const Card = ({ name, value, color }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
      <div style={label}>{name}</div>
      <div style={{ fontSize: '1rem', fontFamily: 'monospace', color: color || '#e0eaf8', lineHeight: 1.1, fontWeight: 'bold' }}>{value}</div>
    </div>
  );

  const Chip = ({ value, name, count }) => {
    const on = filter === value;
    return (
      <button
        onClick={() => setFilter(value)}
        style={{
          background: on ? '#1565c0' : 'none',
          border: `1px solid ${on ? '#3d8ef0' : '#1a2740'}`,
          borderRadius: 3,
          padding: '3px 9px',
          fontSize: '0.66rem',
          color: on ? '#fff' : '#7a96b8',
          fontFamily: 'monospace',
          cursor: 'pointer',
          letterSpacing: '0.04em',
        }}>
        {name}{typeof count === 'number' ? ` (${count})` : ''}
      </button>
    );
  };

  const cellTH = { padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #1a2740', color: '#6b8aa8', fontWeight: 'normal', fontSize: '0.6rem', letterSpacing: '0.06em', textTransform: 'uppercase' };
  const cellTD = { padding: '5px 10px', borderBottom: '1px solid #0d1520', fontFamily: 'monospace', fontSize: '0.7rem', color: '#c4d4e8', whiteSpace: 'nowrap' };
  const cellNum = { ...cellTD, textAlign: 'right' };

  const trendReady = trendMeta?.status === 'ok';

  return (
    <div style={wrap}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={label}>{headerLabel}</div>
          <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#c4d4e8', lineHeight: 1.5, maxWidth: 880 }}>
            Mouser is the full free backbone. Nexar is rotating corroboration under a 4-call daily cap.
            Agreement is <span style={{ color: '#ffd700' }}>source agreement</span>, not a shortage/easing signal.
            {!trendReady && <span style={{ color: '#7a96b8', fontStyle: 'italic' }}> Shortage/easing labels remain gated until ≥2 dated snapshots.</span>}
          </div>
        </div>
        <div style={{ fontSize: '0.66rem', color: '#7a96b8', fontFamily: 'monospace', textAlign: 'right', minWidth: 220 }}>
          <div style={{ ...label, color: '#6b8aa8', textAlign: 'right' }}>Latest snapshots</div>
          <div style={{ marginTop: 3, color: '#c4d4e8', fontSize: '0.74rem' }}>
            Mouser {combined.latestMouserSnapshotDate || '—'}
          </div>
          <div style={{ marginTop: 1, color: '#c4d4e8', fontSize: '0.74rem' }}>
            Nexar {combined.latestNexarSnapshotDate || '—'}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ marginTop: 14, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start', paddingTop: 12, borderTop: '1px solid #0d1520' }}>
        <Card name="Total categories" value={total} />
        <Card name="Both sources" value={counts.bothSources} color="#4dffc3" />
        <Card name="Strong / moderate" value={counts.strongOrModerate} color="#00c9a7" />
        <Card name="Divergent" value={counts.divergent} color={counts.divergent > 0 ? '#f0a84e' : '#7a96b8'} />
        <Card name="Single-source only" value={counts.singleSource} color="#7a96b8" />
      </div>

      {/* Trend readiness line (Phase 17A) — read-only summary, no extra fetches */}
      <div style={{ marginTop: 10, fontSize: '0.7rem', color: '#7a96b8', fontFamily: 'monospace' }}>
        <span style={{ color: '#6b8aa8', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.6rem', fontWeight: 'bold', marginRight: 6 }}>Trend readiness:</span>
        <span>
          Mouser: {(combined.trendReadiness?.mouser?.observationCount ?? 0)} {(combined.trendReadiness?.mouser?.observationCount === 1) ? 'snapshot' : 'snapshots'}
          {combined.trendReadiness?.mouser?.status === 'ok' ? <span style={{ color: '#4dffc3' }}> · ready</span> : <span style={{ color: '#7a96b8' }}> · pending until 2 dated snapshots</span>}
          {' · '}
          Nexar: {(combined.trendReadiness?.nexar?.observationCount ?? 0)} {(combined.trendReadiness?.nexar?.observationCount === 1) ? 'snapshot' : 'snapshots'}
          {combined.trendReadiness?.nexar?.status === 'ok' ? <span style={{ color: '#4dffc3' }}> · ready</span> : <span style={{ color: '#7a96b8' }}> · pending until 2 dated snapshots</span>}
        </span>
        <span style={{ marginLeft: 10, fontStyle: 'italic', color: '#7a96b8' }}>Trend uses dated snapshots, not same-day source comparison.</span>
      </div>

      {/* Trend confidence histogram (Phase 17B) */}
      <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#7a96b8', fontFamily: 'monospace' }}>
        <span style={{ color: '#6b8aa8', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.6rem', fontWeight: 'bold', marginRight: 6 }}>Trend confidence:</span>
        <span style={{ color: CONFIDENCE_COLOR.high }}>High: {combined.trendConfidenceCounts?.high ?? 0}</span>
        <span> · </span>
        <span style={{ color: CONFIDENCE_COLOR.medium }}>Medium: {combined.trendConfidenceCounts?.medium ?? 0}</span>
        <span> · </span>
        <span style={{ color: CONFIDENCE_COLOR.low }}>Low: {combined.trendConfidenceCounts?.low ?? 0}</span>
        <span> · </span>
        <span style={{ color: CONFIDENCE_COLOR.pending }}>Pending: {combined.trendConfidenceCounts?.pending ?? 0}</span>
      </div>

      {/* Filter chips */}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #0d1520', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...label, marginRight: 4 }}>Show:</span>
        <Chip value="all" name="All" count={total} />
        <Chip value="divergent" name="Divergent" count={counts.divergent} />
        <Chip value="agreement" name="Agreement" count={counts.strongOrModerate} />
        <Chip value="single" name="Single-source only" count={counts.singleSource} />
        <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: '#7a96b8', fontFamily: 'monospace' }}>
          {sortedRows.length} of {total} shown
        </span>
      </div>

      {/* Table */}
      <div style={{ marginTop: 10, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
          <thead>
            <tr style={{ background: '#07090f' }}>
              <th style={cellTH}>Group</th>
              <th style={cellTH}>Subcategory</th>
              <th style={{ ...cellTH, textAlign: 'right' }}>Mouser price</th>
              <th style={{ ...cellTH, textAlign: 'right' }}>Nexar price</th>
              <th style={{ ...cellTH, textAlign: 'right' }}>Price Δ %</th>
              <th style={{ ...cellTH, textAlign: 'right' }}>Mouser inventory</th>
              <th style={{ ...cellTH, textAlign: 'right' }}>Nexar inventory</th>
              <th style={cellTH}>Agreement</th>
              <th style={cellTH}>Source state</th>
              <th style={cellTH}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...cellTD, color: '#7a96b8', textAlign: 'center', padding: '14px 10px' }}>
                  No rows match this filter.
                </td>
              </tr>
            )}
            {sortedRows.map(r => {
              const ss = sourceStateFor(r);
              const aColor = AGREEMENT_COLOR[r.agreementStatus] || '#4a6a8a';
              const aLabel = AGREEMENT_LABEL[r.agreementStatus] || r.agreementStatus;
              const deltaColor = r.priceDeltaPct == null
                ? '#7a96b8'
                : Math.abs(r.priceDeltaPct) > 15
                  ? '#f0a84e'
                  : Math.abs(r.priceDeltaPct) > 5
                    ? '#00c9a7'
                    : '#4dffc3';
              const tc = trendCellFor(r);
              return (
                <tr key={r.canonicalCategoryId} style={{ background: '#080c14' }}>
                  <td style={{ ...cellTD, color: GC[r.groupLabel] || '#a0b8d0' }}>{r.groupLabel}</td>
                  <td style={cellTD}>{r.categoryLabel}</td>
                  <td style={cellNum}>{fmtPrice(r.mouserPrice)}</td>
                  <td style={cellNum}>{fmtPrice(r.nexarTrustedPrice)}</td>
                  <td style={{ ...cellNum, color: deltaColor, fontWeight: r.priceDeltaPct != null && Math.abs(r.priceDeltaPct) > 15 ? 'bold' : 'normal' }}>
                    {fmtDeltaPct(r.priceDeltaPct)}
                  </td>
                  <td style={cellNum}>{fmtInv(r.mouserInventory)}</td>
                  <td style={cellNum}>{fmtInv(r.nexarTrustedInventory)}</td>
                  <td style={{ ...cellTD, color: aColor, fontWeight: r.agreementStatus === 'divergent' ? 'bold' : 'normal' }}>{aLabel}</td>
                  <td style={{ ...cellTD, color: ss.color }}>
                    {ss.label}
                    {Array.isArray(r?.manualEvidence) && r.manualEvidence.length > 0 && (() => {
                      const sources = r.manualEvidence.map(e => e.source.replace(/_manual$/,''));
                      const tooltip = r.manualEvidence.map(e => {
                        const dp = e.priceDeltaVsMouserPct == null ? '—' : `${e.priceDeltaVsMouserPct > 0 ? '+' : ''}${e.priceDeltaVsMouserPct}%`;
                        return `${e.source.replace(/_manual$/,'')}: ${e.unitPrice == null ? '—' : '$' + Number(e.unitPrice).toFixed(4)} (Δ ${dp})`;
                      }).join(' · ');
                      return (
                        <div style={{ color: '#7a96b8', fontSize: '0.58rem', marginTop: 2 }} title={tooltip}>
                          Manual evidence: {r.manualEvidence.length} source{r.manualEvidence.length === 1 ? '' : 's'} ({sources.join(', ')})
                          {r?.agreementCorroboration?.warning === 'manual_source_divergence' && (
                            <span style={{ color: '#f0a84e', marginLeft: 4 }}>· manual divergence</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ ...cellTD, color: tc.color }} title={tc.tooltip}>
                    {tc.label}
                    {tc.source && tc.label !== 'Pending' && <span style={{ color: '#4a6a8a', marginLeft: 4, fontSize: '0.58rem' }}>· {tc.source}</span>}
                    {r?.trend?.sourcesDisagree && <span style={{ color: '#f0a84e', marginLeft: 4, fontSize: '0.58rem' }}>· sources disagree</span>}
                    <span style={{ color: CONFIDENCE_COLOR[tc.confidence] || '#4a6a8a', marginLeft: 4, fontSize: '0.58rem' }}>· {tc.confidenceLabel}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: '0.62rem', color: '#7a96b8', fontStyle: 'italic' }}>
        Single-source rows are not errors — they reflect Nexar's permanent 4-call/day rotating cap. Mouser is the full free backbone covering all 28 canonical subcategories.
      </div>
    </div>
  );
}

// ── TI Watched Parts Universe (Phase 20B) ───────────────────────────────────
// Public surface shows the static watched-parts catalog (basket / generic part /
// orderable part / display name / priority / thesis). The live Product
// Information API fields (description, lifecycle, package, lead time, etc.)
// require an X-Capture-Secret round trip; the secret is held only in
// component memory — never persisted, never written to localStorage, never
// sent on GET query strings, and never shipped in the static bundle.
function TiWatchedPartsUniverse() {
  const [catalog, setCatalog] = useState(null);
  const [livePayload, setLivePayload] = useState(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ti/watched-parts/catalog')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j) setCatalog(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function fetchLive() {
    if (!secret.trim()) {
      setError('Capture secret required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ti/watched-parts/product-info', {
        headers: { 'X-Capture-Secret': secret.trim() },
      });
      const json = await res.json().catch(() => null);
      if (!json) {
        setError(`Server returned ${res.status} (no JSON).`);
      } else if (json.status === 'unauthorized') {
        setError('Unauthorized — check the capture secret.');
      } else if (json.status === 'capture_secret_not_configured') {
        setError('Capture secret is not configured on the server.');
      } else if (!json.configured) {
        setError(json.notConfiguredReason || 'TI adapter not configured.');
        setLivePayload(json);
      } else {
        setLivePayload(json);
      }
    } catch (e) {
      setError(e?.message || 'Failed to reach server.');
    }
    setBusy(false);
  }

  const liveByGenericPart = useMemo(() => {
    const m = new Map();
    if (livePayload && Array.isArray(livePayload.parts)) {
      for (const p of livePayload.parts) m.set(p.genericPartNumber, p);
    }
    return m;
  }, [livePayload]);

  const sectionWrap = { padding: '18px 16px', borderBottom: '1px solid #1a2740', background: '#050810' };
  const sectionTitle = { fontSize: '0.58rem', color: '#6b8aa8', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 4 };
  const tinyLabel = { fontSize: '0.58rem', color: '#6b8aa8', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 'bold' };

  // Summary cards — show static values from the catalog when no live payload
  // is available yet. The brief calls for five cards (total, active, longest
  // lead time, okay to order, baskets covered).
  const totalParts = catalog?.totalParts ?? '—';
  const basketsCovered = livePayload?.summary?.basketsCovered ?? catalog?.baskets?.length ?? '—';
  const activeParts = livePayload?.summary?.activeParts ?? null;
  const okayToOrder = livePayload?.summary?.partsOkayToOrder ?? null;
  const longestLeadWeeks = livePayload?.summary?.longestLeadTimeWeeks ?? null;
  const longestLeadLabel = livePayload?.summary?.longestLeadTimePart ?? null;
  const generatedAt = livePayload?.generatedAt
    ? new Date(livePayload.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const SummaryCard = ({ label, value, sub }) => (
    <div style={{ minWidth: 150, padding: '10px 14px', background: '#080c14', border: '1px solid #1a2740', borderRadius: 4 }}>
      <div style={tinyLabel}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontFamily: 'monospace', color: '#e0eaf8', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.62rem', color: '#7a96b8', fontFamily: 'monospace', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const cellTH = { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #1a2740', color: '#6b8aa8', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 'bold', whiteSpace: 'nowrap' };
  const cellTD = { padding: '5px 8px', borderBottom: '1px solid #0d1520', fontSize: '0.7rem', color: '#c4d4e8', verticalAlign: 'top' };
  const cellMono = { ...cellTD, fontFamily: 'monospace' };

  const lifecycleColor = lc => {
    if (!lc) return '#7a96b8';
    const u = String(lc).toUpperCase();
    if (u.startsWith('ACTIVE') || u === 'PRODUCTION' || u === 'PRODUCT' || u === 'AVAILABLE') return '#4dffc3';
    if (u.includes('NRND') || u.includes('NOT RECOMMENDED')) return '#f0a84e';
    if (u.includes('OBSOLETE') || u.includes('DISCONTIN')) return '#f05c5c';
    return '#c4d4e8';
  };
  const okayColor = v => v === true ? '#4dffc3' : v === false ? '#f0a84e' : '#7a96b8';

  // Derive the list of rows to render — always from the static catalog so
  // the table is populated even before the operator runs a live fetch.
  const rows = useMemo(() => {
    if (!catalog || !Array.isArray(catalog.parts)) return [];
    return catalog.parts.map(c => ({ catalog: c, live: liveByGenericPart.get(c.genericPartNumber) || null }));
  }, [catalog, liveByGenericPart]);

  return (
    <div style={sectionWrap}>
      <div style={{ ...sectionTitle, marginBottom: 2 }}>TI Watched Parts Universe</div>
      <div style={{ fontSize: '0.72rem', color: '#a0b8d0', marginBottom: 14, lineHeight: 1.5, maxWidth: 920 }}>
        Product metadata live via Texas Instruments Product Information API. Inventory and pricing signal pending TI Store API approval.
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <SummaryCard label="Total watched parts" value={totalParts} />
        <SummaryCard label="Active parts" value={activeParts == null ? '—' : activeParts} sub={livePayload ? 'lifecycle = active' : 'pending fetch'} />
        <SummaryCard
          label="Longest lead time"
          value={longestLeadWeeks == null ? '—' : `${longestLeadWeeks} wk`}
          sub={longestLeadLabel || (livePayload ? 'no lead time reported' : 'pending fetch')}
        />
        <SummaryCard label="Parts okay to order" value={okayToOrder == null ? '—' : okayToOrder} sub={livePayload ? 'TI flag' : 'pending fetch'} />
        <SummaryCard label="Baskets covered" value={basketsCovered} sub={`of ${catalog?.baskets?.length ?? '—'}`} />
      </div>

      {/* Operator fetch control — secret never touches the bundle */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: '0.7rem', color: '#7a96b8' }}>
          {livePayload
            ? <span>Live data fetched <span style={{ color: '#c4d4e8' }}>{generatedAt}</span>{livePayload.summary?.failedFetches > 0 ? <span style={{ color: '#f0a84e' }}> · {livePayload.summary.failedFetches} failed</span> : null}</span>
            : 'Operator: enter X-Capture-Secret to populate live Product Information API fields.'}
        </div>
        <input
          type={showSecret ? 'text' : 'password'}
          value={secret}
          onChange={e => setSecret(e.target.value)}
          placeholder="X-Capture-Secret"
          autoComplete="off"
          style={{ background: '#080c14', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', borderRadius: 3, minWidth: 220 }}
        />
        <button
          type="button"
          onClick={() => setShowSecret(s => !s)}
          style={{ background: 'transparent', border: '1px solid #1a2740', color: '#7a96b8', padding: '5px 8px', fontSize: '0.66rem', borderRadius: 3, cursor: 'pointer' }}
        >
          {showSecret ? 'hide' : 'show'}
        </button>
        <button
          type="button"
          onClick={fetchLive}
          disabled={busy || !secret.trim()}
          style={{ background: busy ? '#1a2740' : '#0f2540', border: '1px solid #2c4a70', color: '#e0eaf8', padding: '5px 12px', fontSize: '0.72rem', borderRadius: 3, cursor: busy || !secret.trim() ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Fetching…' : livePayload ? 'Refresh live data' : 'Fetch live data'}
        </button>
        {error && <span style={{ fontSize: '0.7rem', color: '#f05c5c' }}>{error}</span>}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div style={{ fontSize: '0.74rem', color: '#7a96b8' }}>Loading watched-parts catalog…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 1100, width: '100%' }}>
            <thead>
              <tr>
                <th style={cellTH}>Basket</th>
                <th style={cellTH}>Generic Part</th>
                <th style={cellTH}>Orderable Part</th>
                <th style={cellTH}>Description</th>
                <th style={cellTH}>Lifecycle</th>
                <th style={cellTH}>Package</th>
                <th style={cellTH}>Lead Time</th>
                <th style={cellTH}>Inventory Status</th>
                <th style={cellTH}>Okay to Order</th>
                <th style={cellTH}>Source</th>
                <th style={cellTH}>Last Fetched</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ catalog: c, live }) => {
                const desc = live?.description || '—';
                const lc = live?.lifecycleStatus || '—';
                const pkg = live?.package || '—';
                const lead = (live && typeof live.leadTimeWeeks === 'number') ? `${live.leadTimeWeeks} wk` : '—';
                const inv = live?.inventoryStatus || '—';
                const ok = live?.okayToOrder == null ? '—' : (live.okayToOrder ? 'yes' : 'no');
                const source = live?.source || (live ? '—' : '');
                const fetched = live?.fetchedAt
                  ? new Date(live.fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : '—';
                const basketLabel = catalog?.baskets?.find(b => b.basket === c.basket)?.basketLabel || c.basket;
                return (
                  <tr key={c.genericPartNumber}>
                    <td style={{ ...cellTD, color: '#a0b8d0' }} title={c.thesisReason}>{basketLabel}</td>
                    <td style={cellMono}>{c.genericPartNumber}</td>
                    <td style={cellMono}>{c.preferredOrderablePartNumber}</td>
                    <td style={{ ...cellTD, maxWidth: 280 }}>{desc}</td>
                    <td style={{ ...cellMono, color: lifecycleColor(live?.lifecycleStatus) }}>{lc}</td>
                    <td style={cellMono}>{pkg}</td>
                    <td style={cellMono}>{lead}</td>
                    <td style={cellMono}>{inv}</td>
                    <td style={{ ...cellMono, color: okayColor(live?.okayToOrder) }}>{ok}</td>
                    <td style={{ ...cellTD, color: '#7a96b8', fontSize: '0.62rem' }}>{source ? 'TI Product Info API' : '—'}</td>
                    <td style={{ ...cellMono, color: '#7a96b8', fontSize: '0.62rem' }}>{fetched}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: '0.62rem', color: '#7a96b8', fontStyle: 'italic' }}>
        Inventory and pricing depth — including price breaks and forecasted availability — are part of the TI Store API suite, which is currently pending TI approval. Once approved, those fields will populate alongside the metadata above.
      </div>
    </div>
  );
}

// ── Inventory tab — TI Direct Supply Signal (Phase 20C.2) ───────────────────
// Surfaces live TI Product Information API metadata + Store Inventory &
// Pricing API quantity / pricing / future-supply signals for one or more
// watched part numbers. Designed to start with a single verified row
// (AFE7799IABJ) and accept additional rows as the operator types them; the
// table structure is ready for the full watched-parts universe but does NOT
// auto-fan-out today (per spec). Never persists or echoes the X-Capture-Secret
// — it lives only in component memory for the lifetime of the tab.
const INVENTORY_SEED_PART = {
  basket: 'Wireless Infra / RF',
  genericPartNumber: 'AFE7799',
  preferredOrderablePartNumber: 'AFE7799IABJ',
};

const INV_FLAG_COLOR = {
  // supplyStatus
  in_stock: '#4dffc3',
  limited: '#f0a84e',
  out_of_stock: '#f05c5c',
  pending_approval: '#f0a84e',
  // inventorySignal
  healthy: '#4dffc3',
  thin: '#f0a84e',
  critical: '#f05c5c',
  out: '#f05c5c',
  // pricingSignal
  available: '#4dffc3',
  unavailable: '#f0a84e',
  // leadTimeSignal
  normal: '#4dffc3',
  extended: '#f0a84e',
  // sourceConfidence
  high: '#4dffc3',
  medium: '#f0a84e',
  low: '#f05c5c',
  none: '#7a96b8',
  unknown: '#7a96b8',
};

function fmtSignalLabel(s) {
  if (!s) return '—';
  return String(s).replace(/_/g, ' ');
}

function fmtPriceUSD(n, currency) {
  if (n == null || !Number.isFinite(n)) return '—';
  const cur = currency || 'USD';
  return cur === 'USD' ? `$${Number(n).toFixed(4)}` : `${Number(n).toFixed(4)} ${cur}`;
}

function InventoryPanel() {
  // ── Public snapshot (customer-facing default) ─────────────────────────
  // Loaded from /api/ti/inventory/latest on mount. Contains sanitized
  // TiPartSignalPublic records — never any secrets, never raw pricing breaks.
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState(null);
  // Phase 21G — shortage / oversupply signal feed.
  const [signalsResp, setSignalsResp] = useState(null);
  // Phase 21H — per-part history expansion (lazy-loaded on click).
  const [historyByPart, setHistoryByPart] = useState({});
  const [expandedPart, setExpandedPart] = useState(null);
  // Phase 21A — Inventory tab now has internal sub-tabs:
  //   'snapshot' = Latest Snapshot (default)
  //   'trends'   = Trends (per-part inventory + price history)
  //   'signals'  = Shortage / Oversupply Signals
  const [inventorySubTab, setInventorySubTab] = useState('snapshot');
  // Trends tab — selected part for trend deep-dive.
  const [trendPart, setTrendPart] = useState(null);
  const [historySummary, setHistorySummary] = useState(null);
  // Phase 21C — schedule/status feeds the customer-facing automation health
  // strip at the top of the Inventory tab. Sanitized public response; no
  // secrets ever flow through this channel.
  const [scheduleStatus, setScheduleStatus] = useState(null);
  // Phase 22.5 — watched-parts catalog gives us subcategory per OPN, which
  // /inventory/latest doesn't surface. Used by the Category Heatmap so each
  // basket can be split into the finer-grained sub-buckets.
  const [watchedCatalog, setWatchedCatalog] = useState(null);
  // Phase 22.5 — Signal Leaderboard active sub-tab.
  const [leaderboardTab, setLeaderboardTab] = useState('shortage_pressure');
  // Phase 23A — Trends sub-tab now supports four scopes. The existing
  // part-scope picker (`trendPart`) keeps working untouched when scope ===
  // 'part'; the aggregate scopes hit the new /api/ti/inventory/trends
  // endpoint and cache by composite key so flipping back-and-forth doesn't
  // re-fetch the same slice.
  const [trendsScope, setTrendsScope] = useState('part');
  const [trendsBasket, setTrendsBasket] = useState('');
  const [trendsSubcategory, setTrendsSubcategory] = useState('');
  const [trendsWindow, setTrendsWindow] = useState('30d');
  const [trendsAggData, setTrendsAggData] = useState({}); // key → response

  // ── Operator-tools state (collapsed by default) ───────────────────────
  // Lets an operator paste the X-Capture-Secret to run a fresh capture or
  // an ad-hoc part-signal lookup. Customers never need to interact with
  // these controls.
  const [opsOpen, setOpsOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adhocSignals, setAdhocSignals] = useState({}); // OPN -> TiPartSignal
  const [adhocOrder, setAdhocOrder] = useState([]); // ordered OPNs added by operator
  const [partInput, setPartInput] = useState('');
  const [captureNote, setCaptureNote] = useState(null);

  // Fetch the public snapshot + signals feed on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetch('/api/ti/inventory/latest').then(r => r.ok ? r.json() : null),
      // Phase 21A — prefer the persisted-signal endpoint; fall through to
      // the on-the-fly /signals endpoint if signals/latest isn't deployed
      // yet (e.g. during the brief gap between push and Cloudflare build).
      fetch('/api/ti/inventory/signals/latest').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ti/inventory/signals').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ti/inventory/history/summary').then(r => r.ok ? r.json() : null).catch(() => null),
      // Phase 21C — automation-health card on the Inventory tab.
      fetch('/api/ti/inventory/schedule/status').then(r => r.ok ? r.json() : null).catch(() => null),
      // Phase 22.5 — sanitized watched-parts catalog (subcategory per OPN).
      fetch('/api/ti/watched-parts/catalog').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([snapRes, sigLatestRes, sigOnFlyRes, summaryRes, scheduleRes, catalogRes]) => {
      if (cancelled) return;
      setSnapshotLoading(false);
      const j = snapRes.status === 'fulfilled' ? snapRes.value : null;
      if (!j) {
        setSnapshotError('Inventory snapshot endpoint did not respond.');
      } else {
        setSnapshot(j);
        if (j.status === 'no_snapshot') setSnapshotError('No inventory snapshot has been captured yet.');
        else if (j.status === 'snapshot_storage_not_configured') setSnapshotError('Snapshot storage is not configured on this deployment.');
      }
      const persisted = sigLatestRes.status === 'fulfilled' ? sigLatestRes.value : null;
      const onFly = sigOnFlyRes.status === 'fulfilled' ? sigOnFlyRes.value : null;
      setSignalsResp(persisted ?? onFly ?? null);
      if (summaryRes.status === 'fulfilled' && summaryRes.value) setHistorySummary(summaryRes.value);
      if (scheduleRes.status === 'fulfilled' && scheduleRes.value) setScheduleStatus(scheduleRes.value);
      if (catalogRes.status === 'fulfilled' && catalogRes.value) setWatchedCatalog(catalogRes.value);
    });
    return () => { cancelled = true; };
  }, []);

  // Phase 23A — fetch + cache aggregate trends responses for non-part scopes.
  // key = `${scope}|${basket}|${subcategory}|${window}` so the cache survives
  // tab flips. We never auto-refresh after the initial fetch; the customer
  // can change window/scope to re-trigger.
  async function fetchTrendsAggregate(scope, basket, subcategory, window) {
    if (scope === 'part') return;
    const params = new URLSearchParams({ scope, window });
    if (basket) params.set('basket', basket);
    if (subcategory) params.set('subcategory', subcategory);
    const key = `${scope}|${basket || ''}|${subcategory || ''}|${window}`;
    if (trendsAggData[key]) return;
    try {
      const res = await fetch(`/api/ti/inventory/trends?${params.toString()}`);
      const j = res.ok ? await res.json().catch(() => null) : null;
      if (j && j.success !== false) {
        setTrendsAggData(prev => ({ ...prev, [key]: j }));
      } else {
        setTrendsAggData(prev => ({ ...prev, [key]: { _error: j?.message || `Server returned ${res.status}` } }));
      }
    } catch (e) {
      setTrendsAggData(prev => ({ ...prev, [key]: { _error: e?.message || 'Fetch failed' } }));
    }
  }

  async function fetchPartHistory(partNumber) {
    if (!partNumber) return;
    if (historyByPart[partNumber]) return; // cached
    try {
      const res = await fetch(`/api/ti/inventory/history?partNumber=${encodeURIComponent(partNumber)}&days=30`);
      const j = res.ok ? await res.json().catch(() => null) : null;
      if (j && j.success) {
        setHistoryByPart(prev => ({ ...prev, [partNumber]: j }));
      } else {
        setHistoryByPart(prev => ({ ...prev, [partNumber]: { rows: [], error: j?.message || `Server returned ${res.status}` } }));
      }
    } catch (e) {
      setHistoryByPart(prev => ({ ...prev, [partNumber]: { rows: [], error: e?.message || 'Fetch failed' } }));
    }
  }

  async function fetchOne(orderablePartNumber) {
    if (!secret.trim()) {
      setError('Capture secret required.');
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const url = `/api/ti/part-signal?partNumber=${encodeURIComponent(orderablePartNumber)}`;
      const res = await fetch(url, { headers: { 'X-Capture-Secret': secret.trim() } });
      const json = await res.json().catch(() => null);
      if (!json) {
        setError(`Server returned ${res.status} (no JSON).`);
      } else if (json.status === 'unauthorized') {
        setError('Unauthorized — check the capture secret.');
      } else if (json.status === 'capture_secret_not_configured') {
        setError('Capture secret is not configured on the server.');
      }
      return json;
    } catch (e) {
      setError(e?.message || 'Failed to reach server.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  // ── Universe capture (Phase 20D.1) ─────────────────────────────────────
  // The Cloudflare Worker can't reliably do all 32 parts in one invocation
  // (subrequest cap), so the operator UI loops the batched endpoint with
  // offset=0,8,16,24 and surfaces progress per batch. The server already
  // merges each batch into the persistent snapshot, so a partial run is
  // never lost.
  const [captureProgress, setCaptureProgress] = useState(null);

  async function captureUniverse() {
    if (!secret.trim()) {
      setError('Capture secret required.');
      return;
    }
    setBusy(true);
    setError(null);
    setCaptureNote(null);
    setCaptureProgress({ done: 0, total: 32, totalCaptured: 0, totalFailed: 0, totalStale: 0 });
    let offset = 0;
    const limit = 8;
    let total = 32;
    let totalCaptured = 0;
    let totalFailed = 0;
    let totalStale = 0;
    let lastCapturedAt = null;
    try {
      while (offset < total) {
        const url = `/api/ti/inventory/capture?offset=${offset}&limit=${limit}`;
        const res = await fetch(url, { method: 'POST', headers: { 'X-Capture-Secret': secret.trim() } });
        const json = await res.json().catch(() => null);
        if (!json) {
          setError(`Server returned ${res.status} (no JSON).`);
          break;
        }
        if (json.status === 'unauthorized') {
          setError('Unauthorized — check the capture secret.');
          break;
        }
        if (json.status === 'capture_secret_not_configured') {
          setError('Capture secret is not configured on the server.');
          break;
        }
        if (!json.success) {
          setError(`Batch failed at offset ${offset}: ${json.status || 'unknown'}`);
          break;
        }
        total = typeof json.totalParts === 'number' ? json.totalParts : total;
        totalCaptured += json.capturedThisBatch || 0;
        totalFailed += json.failedThisBatch || 0;
        totalStale += json.staleThisBatch || 0;
        lastCapturedAt = json.capturedAt || lastCapturedAt;
        const advanced = (json.offset ?? offset) + (json.attemptedThisBatch ?? limit);
        offset = json.nextOffset == null ? total : json.nextOffset;
        setCaptureProgress({
          done: Math.min(advanced, total),
          total,
          totalCaptured,
          totalFailed,
          totalStale,
        });
        if (json.done) break;
      }
      // Re-pull the public snapshot so the table reflects the merged state.
      const fresh = await fetch('/api/ti/inventory/latest').then(r => r.ok ? r.json() : null).catch(() => null);
      if (fresh) setSnapshot(fresh);
      setCaptureNote(
        `Captured ${totalCaptured}/${total} parts${totalFailed > 0 ? ` · ${totalFailed} failed` : ''}${totalStale > 0 ? ` · ${totalStale} stale (kept last good)` : ''}${lastCapturedAt ? ` · ${new Date(lastCapturedAt).toLocaleString()}` : ''}`
      );
    } catch (e) {
      setError(e?.message || 'Failed to reach server.');
    } finally {
      setBusy(false);
    }
  }

  async function addPart() {
    const opn = partInput.trim();
    if (!opn) return;
    if (adhocSignals[opn.toUpperCase()] || (snapshot?.parts || []).some(p => (p.partNumber || '').toUpperCase() === opn.toUpperCase())) {
      setError(`${opn} is already in the table.`);
      return;
    }
    const json = await fetchOne(opn);
    if (json && (json.requestedPartNumber || json.success)) {
      const upper = opn.toUpperCase();
      setAdhocSignals(prev => ({ ...prev, [upper]: json }));
      setAdhocOrder(prev => [...prev, upper]);
      setPartInput('');
    }
  }

  // ── Build display rows ────────────────────────────────────────────────
  // Snapshot rows are the customer-facing source of truth for the universe
  // KPI summary cards. Operator-added ad-hoc rows (full TiPartSignal shape)
  // are appended to the table beneath the snapshot rows but do not influence
  // the summary cards — those always describe the latest verified snapshot.
  const snapshotParts = snapshot?.parts || [];
  const adhocRows = adhocOrder.map(upper => adhocSignals[upper]).filter(Boolean);
  const summary = snapshot?.summary || null;

  // ── Filter / search / sort state (Phase 20D) ───────────────────────────
  const [basketFilter, setBasketFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('basket'); // basket | quantityAvailable | leadTimeWeeks | lifecycleStatus
  const [sortDir, setSortDir] = useState('asc'); // asc | desc

  const distinctBaskets = useMemo(() => {
    const set = new Set();
    for (const p of snapshotParts) if (p.basket) set.add(p.basket);
    return Array.from(set).sort();
  }, [snapshotParts]);

  const filteredSnapshotParts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = snapshotParts;
    if (basketFilter && basketFilter !== 'all') {
      rows = rows.filter(p => p.basket === basketFilter);
    }
    if (q) {
      rows = rows.filter(p => {
        const gen = (p.genericPartNumber || '').toLowerCase();
        const ord = (p.partNumber || '').toLowerCase();
        const dn = (p.displayName || '').toLowerCase();
        return gen.includes(q) || ord.includes(q) || dn.includes(q);
      });
    }
    const dir = sortDir === 'desc' ? -1 : 1;
    const cmp = (a, b) => {
      switch (sortBy) {
        case 'quantityAvailable': {
          const av = a.quantityAvailable == null ? -Infinity : a.quantityAvailable;
          const bv = b.quantityAvailable == null ? -Infinity : b.quantityAvailable;
          return (av - bv) * dir;
        }
        case 'leadTimeWeeks': {
          const av = a.leadTimeWeeks == null ? Infinity : a.leadTimeWeeks;
          const bv = b.leadTimeWeeks == null ? Infinity : b.leadTimeWeeks;
          return (av - bv) * dir;
        }
        case 'lifecycleStatus': {
          const av = (a.lifecycleStatus || '').toUpperCase();
          const bv = (b.lifecycleStatus || '').toUpperCase();
          return av.localeCompare(bv) * dir;
        }
        case 'basket':
        default: {
          const av = (a.basket || '').toLowerCase();
          const bv = (b.basket || '').toLowerCase();
          if (av !== bv) return av.localeCompare(bv) * dir;
          // Stable secondary sort by orderable PN.
          return (a.partNumber || '').localeCompare(b.partNumber || '');
        }
      }
    };
    return rows.slice().sort(cmp);
  }, [snapshotParts, basketFilter, searchQuery, sortBy, sortDir]);

  const sectionWrap = { padding: '18px 16px', borderBottom: '1px solid #1a2740', background: '#050810' };
  const sectionTitle = { fontSize: '0.58rem', color: '#6b8aa8', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 4 };
  const tinyLabel = { fontSize: '0.58rem', color: '#6b8aa8', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 'bold' };

  const KpiCard = ({ label, value, sub, color }) => (
    <div style={{ minWidth: 180, padding: '12px 16px', background: '#080c14', border: '1px solid #1a2740', borderRadius: 4 }}>
      <div style={tinyLabel}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontFamily: 'monospace', color: color || '#e0eaf8', marginTop: 4, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.62rem', color: '#7a96b8', fontFamily: 'monospace', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  // Phase 21C — multi-row info cards for the always-visible Inventory
  // status strip. KpiCard is great for one big number; this is for
  // structured key/value lines (Automation Health, History Depth, Pricing
  // Source Status). Same dark surface so the strip reads as a coherent
  // block above the sub-tab navigation.
  const InfoCard = ({ title, accent, children }) => (
    <div style={{ minWidth: 260, flex: '1 1 280px', maxWidth: 380, padding: '12px 16px', background: '#080c14', border: '1px solid #1a2740', borderRadius: 4 }}>
      <div style={{ ...tinyLabel, color: accent || tinyLabel.color, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
  const InfoRow = ({ label, value, valueColor }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', fontSize: '0.66rem', fontFamily: 'monospace' }}>
      <span style={{ color: '#7a96b8' }}>{label}</span>
      <span style={{ color: valueColor || '#e0eaf8', textAlign: 'right' }}>{value}</span>
    </div>
  );

  const cellTH = { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #1a2740', color: '#6b8aa8', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 'bold', whiteSpace: 'nowrap' };
  const cellTD = { padding: '6px 8px', borderBottom: '1px solid #0d1520', fontSize: '0.7rem', color: '#c4d4e8', verticalAlign: 'top' };
  const cellMono = { ...cellTD, fontFamily: 'monospace' };

  // ── Summary card values (Phase 20D — universe-level) ───────────────────
  // Sourced from the API summary if present; otherwise computed from the
  // local snapshot rows so the cards still populate when a stale or
  // partial snapshot is on disk.
  const total = summary?.totalParts ?? snapshotParts.length;
  const inStock = summary?.inStockParts ?? snapshotParts.filter(p => p.signals?.supplyStatus === 'in_stock').length;
  const outOfStock = summary?.outOfStockParts ?? snapshotParts.filter(p => p.signals?.supplyStatus === 'out_of_stock').length;
  const activeCount = summary?.activeParts ?? null;
  const longestLead = summary?.longestLeadTimePart;
  const longestLabel = longestLead && longestLead.leadTimeWeeks != null
    ? `${longestLead.leadTimeWeeks} wk`
    : '—';
  const longestSub = longestLead?.partNumber || (snapshotParts.length === 0 ? 'pending capture' : 'no lead time reported');
  const basketsCovered = summary?.basketsCovered ?? distinctBaskets.length;
  const medianLead = summary?.medianLeadTimeWeeks;
  const medianLabel = typeof medianLead === 'number' && Number.isFinite(medianLead) ? `${medianLead} wk` : '—';

  // Snapshot freshness label for the header.
  const snapshotCapturedAt = snapshot?.capturedAt
    ? new Date(snapshot.capturedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <>
      {/* ── Header ── */}
      <div style={{ ...sectionWrap, paddingTop: 22, paddingBottom: 18 }}>
        <div style={{ ...sectionTitle, marginBottom: 6 }}>TI Direct Supply Signal</div>
        <div style={{ fontSize: '0.78rem', color: '#a0b8d0', lineHeight: 1.55, maxWidth: 920 }}>
          Live TI direct inventory, pricing and future availability signals from Texas Instruments Store Inventory & Pricing API.
        </div>
        <div style={{ marginTop: 10, fontSize: '0.7rem', color: '#7a96b8', maxWidth: 920, lineHeight: 1.5 }}>
          Inventory data is refreshed from Texas Instruments Store Inventory & Pricing API and shown from the latest verified snapshot.
          {snapshotCapturedAt && (
            <span style={{ color: '#a0b8d0' }}> Latest snapshot captured {snapshotCapturedAt}.</span>
          )}
        </div>
      </div>

      {/* ── Phase 22.6 — Live conclusion banner + What changed since last
              capture + signal-classification methodology. The four pieces
              the customer reads top-to-bottom before they ever click a
              sub-tab:
                1. Headline (color-coded by current pressure state)
                2. Subtext explaining the headline
                3. Data-reliability sentence (captured / failed / stale /
                   priced — derived from the same /inventory/latest +
                   /signals/latest data the rest of the page uses, so
                   numbers always match what's below)
                4. Collapsed methodology rules so a curious customer can
                   verify how the headline was reached without scrolling
                   to the Signals sub-tab.

              Followed by a separate "What changed since last capture?"
              section that surfaces the single biggest mover per
              category (inventory drop / build / price up / down) or a
              clean "No material movement" empty state. Different from
              the Signal Leaderboard on the Signals sub-tab — the
              leaderboard is a ranked top-15 per category; this section
              is a one-line answer per category.
      */}
      {(() => {
        const sigSummary = signalsResp?.summary;
        const sigList = signalsResp?.signals || [];
        const totalParts = (summary?.totalParts ?? sigList.length) || 0;
        const captured = summary?.capturedParts ?? snapshotParts.length;
        const failedParts = summary?.failedParts ?? 0;
        const staleParts = summary?.staleParts ?? 0;
        const pricedParts = sigList.filter(s => s.latestNormalizedUnitPrice != null).length
          || (snapshot?.parts || []).filter(p => p.normalizedUnitPrice != null).length;
        const sp = sigSummary?.shortagePressure ?? 0;
        const op = sigSummary?.oversupplyPressure ?? 0;
        const it = sigSummary?.inventoryTightening ?? 0;
        const se = sigSummary?.supplyEasing ?? 0;
        const ip = sigSummary?.priceOnlyPressure ?? 0;
        const totalPressure = sp + op + it + se + ip;
        // Color-coded headline. Severity ordering: shortage > oversupply >
        // tightening > easing > price-only > stable. Ties: highest count wins.
        let headline, accent, headlineHint = null;
        if (sp > 0) {
          accent = '#f05c5c';
          headline = `${sp} part${sp === 1 ? '' : 's'} under shortage pressure across the ${totalParts}-part TI watched universe.`;
          headlineHint = 'Inventory is falling and price is rising for these parts — typical shortage signature.';
        } else if (op > 0) {
          accent = '#3d8ef0';
          headline = `${op} part${op === 1 ? '' : 's'} under oversupply pressure across the ${totalParts}-part TI watched universe.`;
          headlineHint = 'Inventory is rising and price is falling for these parts — typical oversupply signature.';
        } else if (it > 0) {
          accent = '#f0a84e';
          headline = `${it} part${it === 1 ? '' : 's'} showing inventory tightening across the ${totalParts}-part TI watched universe.`;
          headlineHint = 'Inventory falling but price has not yet moved.';
        } else if (se > 0) {
          accent = '#00c9a7';
          headline = `${se} part${se === 1 ? '' : 's'} showing supply easing across the ${totalParts}-part TI watched universe.`;
          headlineHint = 'Inventory rising but price has not yet moved.';
        } else if (ip > 0) {
          accent = '#ab6af0';
          headline = `${ip} part${ip === 1 ? '' : 's'} showing price-only pressure across the ${totalParts}-part TI watched universe.`;
          headlineHint = 'Price is rising while inventory has not moved.';
        } else {
          accent = '#4dffc3';
          headline = `No supply pressure detected across the ${totalParts}-part TI watched universe.`;
        }
        const subtext = totalPressure === 0
          ? `All ${captured}${totalParts ? `/${totalParts}` : ''} parts were captured successfully with direct TI Store pricing. Inventory and pricing are stable versus previous observations.`
          : (headlineHint || 'See the Signal Leaderboard for the full ranked list.');
        const reliability = `Latest run captured ${captured}/${totalParts} parts, ${failedParts} failed, ${staleParts} stale, and ${pricedParts}/${totalParts} direct TI prices.`;
        // What-changed: top 1 per direction. inventoryPctDelta and
        // pricePctDelta come from the persisted-signal latest-vs-previous
        // pair (Phase 21A.3) so the answer is "what moved between the
        // most-recent two captures" — exactly what the section title asks.
        const invDrop  = sigList.filter(s => s.inventoryPctDelta != null && s.inventoryPctDelta < 0).sort((a, b) => a.inventoryPctDelta - b.inventoryPctDelta)[0] || null;
        const invBuild = sigList.filter(s => s.inventoryPctDelta != null && s.inventoryPctDelta > 0).sort((a, b) => b.inventoryPctDelta - a.inventoryPctDelta)[0] || null;
        const priceUp   = sigList.filter(s => s.pricePctDelta != null && s.pricePctDelta > 0).sort((a, b) => b.pricePctDelta - a.pricePctDelta)[0] || null;
        const priceDown = sigList.filter(s => s.pricePctDelta != null && s.pricePctDelta < 0).sort((a, b) => a.pricePctDelta - b.pricePctDelta)[0] || null;
        const noMovement = !invDrop && !invBuild && !priceUp && !priceDown;
        const fmtPct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
        const fmtPrice = v => v == null ? '—' : `$${Number(v).toFixed(4)}`;
        const fmtQty = v => v == null ? '—' : Number(v).toLocaleString();
        const ChangeTile = ({ title, sub, row, valueColor, deltaSide }) => (
          <div style={{ padding: '10px 14px', background: '#080c14', border: '1px solid #1a2740', borderRadius: 4 }}>
            <div style={{ ...tinyLabel, marginBottom: 4 }}>{title}</div>
            {row ? (
              <>
                <div style={{ fontSize: '0.78rem', color: '#e0eaf8', fontFamily: 'monospace' }}>
                  {row.partNumber || row.orderablePartNumber}
                </div>
                {row.displayName && (
                  <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontFamily: 'monospace', marginTop: 2 }}>
                    {row.displayName}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: '0.85rem', color: valueColor, fontFamily: 'monospace' }}>
                  {deltaSide === 'inventory'
                    ? `${fmtPct(row.inventoryPctDelta)} (${fmtQty(row.previousQuantityAvailable)} → ${fmtQty(row.latestQuantityAvailable)})`
                    : `${fmtPct(row.pricePctDelta)} (${fmtPrice(row.previousNormalizedUnitPrice)} → ${fmtPrice(row.latestNormalizedUnitPrice)})`}
                </div>
                {row.basket && (
                  <div style={{ fontSize: '0.6rem', color: '#7a96b8', marginTop: 2 }}>{row.basket}</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '0.7rem', color: '#7a96b8', fontStyle: 'italic', fontFamily: 'monospace' }}>
                {sub || 'No movement in this direction.'}
              </div>
            )}
          </div>
        );
        return (
          <>
            {/* Conclusion banner */}
            <div style={{
              ...sectionWrap, paddingTop: 18, paddingBottom: 16,
              borderLeft: `4px solid ${accent}`,
            }}>
              <div style={{ ...sectionTitle, marginBottom: 6, color: accent }}>Live conclusion</div>
              <div style={{
                fontSize: '0.95rem', color: '#e0eaf8', fontWeight: 'bold',
                lineHeight: 1.4, maxWidth: 920, fontFamily: 'monospace',
              }}>
                {headline}
              </div>
              <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#a0b8d0', maxWidth: 920, lineHeight: 1.5 }}>
                {subtext}
              </div>
              <div style={{ marginTop: 6, fontSize: '0.66rem', color: '#7a96b8', fontFamily: 'monospace', maxWidth: 920 }}>
                {reliability}
              </div>
              <details style={{ marginTop: 10 }}>
                <summary style={{
                  cursor: 'pointer', fontSize: '0.6rem', color: '#7a96b8',
                  letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 'bold',
                }}>
                  How signals are classified
                </summary>
                <div style={{
                  marginTop: 6, padding: '8px 12px', background: '#080c14',
                  border: '1px solid #1a2740', borderRadius: 4,
                  fontSize: '0.66rem', color: '#a0b8d0', lineHeight: 1.7,
                  fontFamily: 'monospace', maxWidth: 920,
                }}>
                  <div>• Inventory down + price up &nbsp;→&nbsp; <span style={{ color: '#f05c5c', fontWeight: 'bold' }}>shortage pressure</span></div>
                  <div>• Inventory up + price down &nbsp;→&nbsp; <span style={{ color: '#3d8ef0', fontWeight: 'bold' }}>oversupply pressure</span></div>
                  <div>• Inventory down + price flat/unavailable &nbsp;→&nbsp; <span style={{ color: '#f0a84e', fontWeight: 'bold' }}>inventory tightening</span></div>
                  <div>• Inventory up + price flat/unavailable &nbsp;→&nbsp; <span style={{ color: '#00c9a7', fontWeight: 'bold' }}>supply easing</span></div>
                  <div>• Price up + inventory flat &nbsp;→&nbsp; <span style={{ color: '#ab6af0', fontWeight: 'bold' }}>price-only pressure</span></div>
                </div>
              </details>
            </div>

            {/* What changed since last capture? */}
            <div style={sectionWrap}>
              <div style={{ ...sectionTitle, marginBottom: 8 }}>What changed since last capture?</div>
              {noMovement ? (
                <div style={{
                  fontSize: '0.7rem', color: '#7a96b8', fontStyle: 'italic',
                  padding: '8px 12px', background: '#080c14',
                  border: '1px solid #1a2740', borderRadius: 4,
                  fontFamily: 'monospace', maxWidth: 920,
                }}>
                  No material inventory or pricing movement since the last capture.
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 10,
                }}>
                  <ChangeTile title="Largest inventory drop" row={invDrop} deltaSide="inventory" valueColor={'#f0a84e'} />
                  <ChangeTile title="Largest inventory build" row={invBuild} deltaSide="inventory" valueColor={'#4dffc3'} />
                  <ChangeTile title="Largest price increase" row={priceUp} deltaSide="price" valueColor={'#f05c5c'} />
                  <ChangeTile title="Largest price decrease" row={priceDown} deltaSide="price" valueColor={'#4dffc3'} />
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* ── Phase 21C — Always-visible status strip: Automation Health,
              History Depth, Pricing Source Status. Pulled from
              /schedule/status, /history/summary and /signals/latest
              respectively. The customer sees the operational picture at a
              glance regardless of which Inventory sub-tab they're on. ── */}
      {(() => {
        const sched = scheduleStatus;
        const summary = historySummary;
        const sigSummary = signalsResp?.summary;
        const fmtTime = iso => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
        const captureStatus = sched?.lastExternalCaptureStatus || '—';
        const captureStatusColor = captureStatus === 'ok' ? '#4dffc3'
          : captureStatus === 'partial' ? '#f0a84e'
          : captureStatus === 'error' || captureStatus === 'failed' ? '#f05c5c'
          : captureStatus === 'in_progress' ? '#3d8ef0'
          : '#7a96b8';
        // Phase 22.6 — derive expected from the actual watched universe.
        // Pre-22.4 this was offsetsConfigured*8 (the in-Cloudflare cron
        // count × batch size), which only matched reality when the
        // universe was 32 parts. With dynamic batching live we prefer
        // /history/summary.totalTrackedParts → /inventory/latest.totalParts
        // → schedule.capturedParts in that order, falling back to the
        // cron-derived guess only when none of those exist yet.
        const expectedParts =
          (historySummary?.totalTrackedParts && historySummary.totalTrackedParts > 0
            ? historySummary.totalTrackedParts
            : (snapshot?.summary?.totalParts && snapshot.summary.totalParts > 0
                ? snapshot.summary.totalParts
                : (sched?.capturedParts && sched.capturedParts > 0
                    ? sched.capturedParts
                    : (sched?.offsetsConfigured && sched.offsetsConfigured > 0
                        ? sched.offsetsConfigured * 8
                        : 32))));
        const expectedSignals = expectedParts;
        const captured = sched?.capturedParts ?? null;
        const persisted = sched?.signalsPersisted ?? null;
        const sourceLabel = sched?.lastExternalCaptureSource === 'github_actions_daily' ? 'GitHub Actions daily'
          : sched?.lastExternalCaptureSource === 'operator_ui' ? 'Operator UI (manual)'
          : sched?.lastExternalCaptureSource ? sched.lastExternalCaptureSource
          : '—';
        // Pricing source breakdown — derive from /signals/latest summary
        // (priceUnavailableCount is set by Phase 21A.3 onwards). Fall back
        // to counting parts whose latestNormalizedUnitPrice is null.
        // Phase 21D.2 — count direct-TI vs other vs unavailable using the
        // pricingSource field on the snapshot (not the persisted-signal
        // row, which doesn't carry pricingSource yet); falls back to the
        // signals shape when snapshot.parts isn't loaded.
        const sigList = signalsResp?.signals || [];
        const snapshotParts21D2 = snapshot?.parts || [];
        const directTiCount = snapshotParts21D2.length > 0
          ? snapshotParts21D2.filter(p => p.pricingSource === 'direct_ti_store_price' && p.normalizedUnitPrice != null).length
          : sigList.filter(s => s.latestNormalizedUnitPrice != null).length;
        const priceUnavailableCount = snapshotParts21D2.length > 0
          ? snapshotParts21D2.filter(p => p.pricingSource !== 'direct_ti_store_price' || p.normalizedUnitPrice == null).length
          : (sigSummary?.priceUnavailableCount
              ?? sigList.filter(s => s.latestNormalizedUnitPrice == null && s.pricePctDelta == null).length);
        const dashboardPriceCount = 0; // Mouser blending intentionally not wired yet (Phase 21D.2 hard restriction).
        const pricedCount = directTiCount + dashboardPriceCount;
        // Sample a few normalized prices for the operator-friendly subtitle.
        const samplePriced = snapshotParts21D2
          .filter(p => p.pricingSource === 'direct_ti_store_price' && p.normalizedUnitPrice != null)
          .slice(0, 3)
          .map(p => `${p.partNumber} $${Number(p.normalizedUnitPrice).toFixed(4)}`)
          .join(' · ');
        return (
          <div style={{ ...sectionWrap, paddingTop: 14, paddingBottom: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <InfoCard title="Automation health · Data quality" accent={captureStatusColor}>
                <InfoRow label="Status" value={captureStatus.toUpperCase()} valueColor={captureStatusColor} />
                <InfoRow label="Source" value={sourceLabel} />
                <InfoRow
                  label="Parts captured"
                  value={captured == null ? '—' : `${captured}/${expectedParts}`}
                  valueColor={captured === expectedParts ? '#4dffc3' : captured == null ? '#7a96b8' : '#f0a84e'}
                />
                <InfoRow
                  label="Signals persisted"
                  value={persisted == null ? '—' : `${persisted}/${expectedSignals}`}
                  valueColor={persisted === expectedSignals ? '#4dffc3' : persisted == null ? '#7a96b8' : '#f0a84e'}
                />
                {/* Phase 22.5 — Data Quality additions: failed/stale + 2+ obs.
                    Phase 22.6 — read failed/stale from snapshot.summary
                    (the /inventory/latest payload), not the local
                    `summary` variable above which is /history/summary
                    (which doesn't carry failedParts/staleParts). */}
                <InfoRow
                  label="Failed parts"
                  value={snapshot?.summary?.failedParts != null ? String(snapshot.summary.failedParts) : '—'}
                  valueColor={(snapshot?.summary?.failedParts ?? 0) > 0 ? '#f05c5c' : '#4dffc3'}
                />
                <InfoRow
                  label="Stale parts"
                  value={snapshot?.summary?.staleParts != null ? String(snapshot.summary.staleParts) : '—'}
                  valueColor={(snapshot?.summary?.staleParts ?? 0) > 0 ? '#f0a84e' : '#7a96b8'}
                />
                <InfoRow
                  label="Parts with 2+ obs"
                  value={historySummary ? `${historySummary.partsWith2PlusObservations}/${historySummary.totalTrackedParts}` : '—'}
                  valueColor={historySummary && historySummary.partsWith2PlusObservations === historySummary.totalTrackedParts ? '#4dffc3' : '#a0b8d0'}
                />
                <InfoRow label="Backend" value={(sched?.backend || '—').toUpperCase()} valueColor={sched?.backend === 'd1' ? '#4dffc3' : '#7a96b8'} />
                <InfoRow label="Last capture" value={fmtTime(sched?.lastExternalCaptureAt || sched?.lastCaptureAt)} />
                {/* Phase 22.5 — Task 3: scheduler-clarity. Uses the new
                    activeSchedulerLabel from /schedule/status when available;
                    falls back to the static "Daily 07:15 UTC" hint otherwise.
                    The cron-list confusion is resolved at the source. */}
                <InfoRow
                  label="Schedule"
                  value={sched?.activeScheduler === 'github_actions_dynamic'
                    ? 'GitHub Actions · dynamic batching'
                    : sched?.activeScheduler === 'cloudflare_cron'
                      ? 'Cloudflare cron'
                      : 'Daily 07:15 UTC'}
                  valueColor={sched?.dynamicBatching ? '#4dffc3' : '#a0b8d0'}
                />
              </InfoCard>

              <InfoCard title="History depth">
                <InfoRow
                  label="Total snapshots"
                  value={summary?.totalSnapshots != null ? Number(summary.totalSnapshots).toLocaleString() : '—'}
                  valueColor="#e0eaf8"
                />
                <InfoRow
                  label="Parts with history"
                  value={summary ? `${summary.partsWithHistory}/${summary.totalTrackedParts}` : '—'}
                  valueColor={summary && summary.partsWithHistory === summary.totalTrackedParts ? '#4dffc3' : '#e0eaf8'}
                />
                <InfoRow
                  label="With ≥3 observations"
                  value={summary?.partsWith3PlusObservations != null ? `${summary.partsWith3PlusObservations}/${summary.totalTrackedParts}` : '—'}
                />
                <InfoRow label="Latest captured" value={fmtTime(summary?.latestCapturedAt)} />
                <div style={{ marginTop: 6, fontSize: '0.6rem', color: '#7a96b8', fontStyle: 'italic', lineHeight: 1.45 }}>
                  Signals become more useful as daily observations accumulate.
                </div>
              </InfoCard>

              <InfoCard title="Pricing source status" accent={directTiCount > 0 ? '#4dffc3' : undefined}>
                <InfoRow
                  label="Direct TI Store price"
                  value={`${directTiCount} parts`}
                  valueColor={directTiCount > 0 ? '#4dffc3' : '#7a96b8'}
                />
                <InfoRow
                  label="Existing dashboard / Mouser"
                  value={`${dashboardPriceCount} parts`}
                  valueColor="#7a96b8"
                />
                <InfoRow
                  label="Price unavailable"
                  value={`${priceUnavailableCount} parts`}
                  valueColor={priceUnavailableCount > 0 ? '#f0a84e' : '#7a96b8'}
                />
                <InfoRow label="Source" value="Texas Instruments Store API" />
                <InfoRow
                  label="Confidence"
                  value={directTiCount > 0 ? 'High (TI direct)' : '—'}
                  valueColor={directTiCount > 0 ? '#4dffc3' : '#7a96b8'}
                />
                {samplePriced && (
                  <div style={{ marginTop: 6, fontSize: '0.58rem', color: '#7a96b8', fontFamily: 'monospace' }}>
                    {samplePriced}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: '0.6rem', color: '#7a96b8', fontStyle: 'italic', lineHeight: 1.45 }}>
                  Pricing series only renders when TI Store returns price breaks. We never fabricate a price line.
                </div>
              </InfoCard>
            </div>
          </div>
        );
      })()}

      {/* ── Sub-tab strip (Phase 21A): Latest Snapshot / Trends / Signals ── */}
      <div style={{ display: 'flex', gap: 0, padding: '0 16px', background: '#080c14', borderBottom: '1px solid #1a2740' }}>
        {[
          { id: 'snapshot', label: 'Latest Snapshot' },
          { id: 'trends', label: 'Trends' },
          { id: 'signals', label: 'Shortage / Oversupply Signals' },
        ].map(t => {
          const on = inventorySubTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setInventorySubTab(t.id)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: on ? '2px solid #3d8ef0' : '2px solid transparent',
                padding: '10px 14px',
                fontSize: '0.62rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: on ? '#e0eaf8' : '#6b8aa8',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontWeight: on ? 'bold' : 'normal',
              }}
            >{t.label}</button>
          );
        })}
        {historySummary && (
          <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '0.62rem', color: '#7a96b8', fontFamily: 'monospace', paddingRight: 4 }}>
            {historySummary.partsWithHistory}/{historySummary.totalTrackedParts} with history · {historySummary.totalSnapshots} snapshots · {historySummary.partsWith3PlusObservations} with ≥3 obs
          </span>
        )}
      </div>

      {inventorySubTab === 'snapshot' && (<>

      {/* ── Phase 22.5 — Executive Summary ──────────────────────────────
           One-glance answer to "Is TI supply pressured? How does the
           universe look right now?". Sits ABOVE the existing universe
           cards and pulls signal counts from /signals/latest so the
           customer sees the supply-side answer first. */}
      {(() => {
        const sigSummary = signalsResp?.summary;
        const sigList = signalsResp?.signals || [];
        const totalParts = summary?.totalParts ?? snapshotParts.length;
        const capturedParts = summary?.capturedParts ?? snapshotParts.length;
        const failedParts = summary?.failedParts ?? 0;
        const inStockParts = inStock;
        const outOfStockParts = outOfStock;
        const pricedParts = sigList.filter(s => s.latestNormalizedUnitPrice != null).length
          || (snapshot?.parts || []).filter(p => p.normalizedUnitPrice != null).length;
        const shortagePressure = sigSummary?.shortagePressure ?? 0;
        const oversupplyPressure = sigSummary?.oversupplyPressure ?? 0;
        const inventoryTightening = sigSummary?.inventoryTightening ?? 0;
        const supplyEasing = sigSummary?.supplyEasing ?? 0;
        const meaningful = shortagePressure + oversupplyPressure + inventoryTightening + supplyEasing;
        const headlineColor = shortagePressure > 0 ? '#f05c5c'
          : oversupplyPressure > 0 ? '#3d8ef0'
          : inventoryTightening > 0 ? '#f0a84e'
          : supplyEasing > 0 ? '#00c9a7'
          : '#7a96b8';
        const headlineText = shortagePressure > 0
          ? `${shortagePressure} part${shortagePressure === 1 ? '' : 's'} under shortage pressure`
          : oversupplyPressure > 0
            ? `${oversupplyPressure} part${oversupplyPressure === 1 ? '' : 's'} under oversupply pressure`
            : meaningful > 0
              ? `${meaningful} part${meaningful === 1 ? '' : 's'} with directional signal`
              : 'No supply pressure detected';
        const lastCapTxt = scheduleStatus?.lastExternalCaptureAt
          ? new Date(scheduleStatus.lastExternalCaptureAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : (snapshot?.capturedAt
              ? new Date(snapshot.capturedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : '—');
        return (
          <div style={{ ...sectionWrap, paddingTop: 14, paddingBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ ...sectionTitle, marginBottom: 0 }}>Executive summary</div>
              <div style={{ fontSize: '0.78rem', color: headlineColor, fontWeight: 'bold', fontFamily: 'monospace' }}>
                {headlineText}
              </div>
              <div style={{ marginLeft: 'auto', fontSize: '0.62rem', color: '#7a96b8', fontFamily: 'monospace' }}>
                Last capture: {lastCapTxt}
              </div>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
              fontFamily: 'monospace',
            }}>
              {[
                { label: 'Tracked parts',        value: totalParts,                  sub: 'watched universe',                                color: '#e0eaf8' },
                { label: 'Captured',             value: `${capturedParts}/${totalParts}`, sub: failedParts > 0 ? `${failedParts} failed` : 'last run', color: capturedParts === totalParts ? '#4dffc3' : '#f0a84e' },
                { label: 'Direct TI priced',     value: `${pricedParts}/${totalParts}`,    sub: 'TI Store API',                                color: pricedParts === totalParts ? '#4dffc3' : '#f0a84e' },
                { label: 'In stock',             value: inStockParts,                sub: totalParts ? `${Math.round(inStockParts/Math.max(1,totalParts)*100)}%` : '',         color: '#4dffc3' },
                { label: 'Out of stock',         value: outOfStockParts,             sub: totalParts ? `${Math.round(outOfStockParts/Math.max(1,totalParts)*100)}%` : '',      color: '#f0a84e' },
                { label: 'Shortage pressure',    value: shortagePressure,            sub: 'inv ↓ + price ↑',                                 color: shortagePressure > 0 ? '#f05c5c' : '#7a96b8' },
                { label: 'Oversupply pressure',  value: oversupplyPressure,          sub: 'inv ↑ + price ↓',                                 color: oversupplyPressure > 0 ? '#3d8ef0' : '#7a96b8' },
                { label: 'Inventory tightening', value: inventoryTightening,         sub: 'inv ↓ price flat',                                color: inventoryTightening > 0 ? '#f0a84e' : '#7a96b8' },
                { label: 'Supply easing',        value: supplyEasing,                sub: 'inv ↑ price flat',                                color: supplyEasing > 0 ? '#00c9a7' : '#7a96b8' },
              ].map(k => (
                <div key={k.label} style={{ padding: '10px 12px', background: '#080c14', border: '1px solid #1a2740', borderRadius: 4 }}>
                  <div style={{ ...tinyLabel, marginBottom: 2 }}>{k.label}</div>
                  <div style={{ color: k.color, fontSize: '1.1rem', lineHeight: 1.1 }}>{k.value}</div>
                  {k.sub && <div style={{ color: '#7a96b8', fontSize: '0.58rem', marginTop: 2 }}>{k.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Universe summary cards (Phase 20D) ── */}
      <div style={sectionWrap}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiCard
            label="Total watched parts"
            value={total ?? '—'}
            sub={summary && summary.capturedParts !== summary.totalParts
              ? `${summary.capturedParts}/${summary.totalParts} captured${summary.failedParts > 0 ? ` · ${summary.failedParts} failed` : ''}`
              : (snapshotParts.length > 0 ? `${snapshotParts.length} captured` : (snapshotLoading ? 'loading…' : 'pending capture'))}
            color="#e0eaf8"
          />
          <KpiCard
            label="In-stock parts"
            value={inStock}
            sub={total ? `${Math.round((inStock / Math.max(1, total)) * 100)}% of universe` : 'pending capture'}
            color={inStock > 0 ? '#4dffc3' : '#c4d4e8'}
          />
          <KpiCard
            label="Out-of-stock parts"
            value={outOfStock}
            sub={total ? `${Math.round((outOfStock / Math.max(1, total)) * 100)}% of universe` : 'pending capture'}
            color={outOfStock > 0 ? '#f0a84e' : '#c4d4e8'}
          />
          <KpiCard
            label="Longest lead time"
            value={longestLabel}
            sub={longestSub}
            color={longestLead ? '#f0a84e' : '#c4d4e8'}
          />
          <KpiCard
            label="Baskets covered"
            value={basketsCovered}
            sub={`median lead ${medianLabel}${activeCount != null ? ` · ${activeCount} active` : ''}`}
            color="#c4d4e8"
          />
        </div>
        {snapshotError && snapshotParts.length === 0 && (
          <div style={{ marginTop: 10, fontSize: '0.7rem', color: '#f0a84e' }}>
            {snapshotError} The watched-parts inventory snapshot will appear here once an operator runs a capture.
          </div>
        )}
      </div>

      {/* ── Phase 22.5 — Category Heatmap ────────────────────────────────
           Answers "Which TI category is tightening or easing?". Groups
           the captured parts by basket × subcategory and rolls up
           captured % / priced % / in-stock % / out-of-stock % / median
           lead time / per-signal counts. Subcategory comes from
           /watched-parts/catalog (joined by partNumber). Rendered as a
           compact table because heatmap colour blocks added without
           clear axes have hurt readability in past phases. */}
      {(() => {
        const parts = snapshot?.parts || [];
        if (parts.length === 0) return null;
        // Subcategory map from watched-parts catalog (Phase 22.5).
        const subcatByOpn = new Map();
        if (watchedCatalog?.parts) {
          for (const p of watchedCatalog.parts) {
            subcatByOpn.set(p.preferredOrderablePartNumber, p.subcategory ?? null);
          }
        }
        // Signal type per part — used to count shortage/oversupply etc.
        const sigByOpn = new Map();
        for (const s of (signalsResp?.signals || [])) {
          if (s.partNumber) sigByOpn.set(s.partNumber, s);
        }
        // Group by (basket, subcategory).
        const groups = new Map();
        for (const p of parts) {
          const basket = p.basket || '—';
          const subcat = subcatByOpn.get(p.partNumber) || '—';
          const key = `${basket}${subcat}`;
          if (!groups.has(key)) {
            groups.set(key, {
              basket, subcategory: subcat,
              tracked: 0, captured: 0, priced: 0,
              inStock: 0, outOfStock: 0,
              leadTimes: [],
              shortagePressure: 0, oversupplyPressure: 0,
              inventoryTightening: 0, supplyEasing: 0,
            });
          }
          const g = groups.get(key);
          g.tracked += 1;
          // Treat any row served by /inventory/latest as "captured" (the
          // endpoint only returns captured parts).
          g.captured += 1;
          if (p.normalizedUnitPrice != null) g.priced += 1;
          const supply = p.signals?.supplyStatus;
          if (supply === 'in_stock') g.inStock += 1;
          else if (supply === 'out_of_stock') g.outOfStock += 1;
          if (p.leadTimeWeeks != null && Number.isFinite(p.leadTimeWeeks)) g.leadTimes.push(p.leadTimeWeeks);
          const sig = sigByOpn.get(p.partNumber);
          if (sig) {
            switch (sig.signalType) {
              case 'shortage_pressure':    g.shortagePressure += 1; break;
              case 'oversupply_pressure':  g.oversupplyPressure += 1; break;
              case 'inventory_tightening': g.inventoryTightening += 1; break;
              case 'supply_easing':        g.supplyEasing += 1; break;
            }
          }
        }
        const rows = Array.from(groups.values()).map(g => {
          const median = g.leadTimes.length === 0 ? null
            : (() => {
                const sorted = g.leadTimes.slice().sort((a,b)=>a-b);
                const m = Math.floor(sorted.length/2);
                return sorted.length % 2 === 1 ? sorted[m] : (sorted[m-1]+sorted[m])/2;
              })();
          return { ...g, medianLeadTime: median, pressureScore: g.shortagePressure*4 + g.inventoryTightening*2 + g.oversupplyPressure*1 };
        });
        // Sort: pressure first (descending shortage/tightening), then largest tracked.
        rows.sort((a, b) => b.pressureScore - a.pressureScore || b.tracked - a.tracked || a.basket.localeCompare(b.basket) || a.subcategory.localeCompare(b.subcategory));
        const pct = (n, d) => d > 0 ? `${Math.round(n/d*100)}%` : '—';
        const colorPct = (p, hot, neutral) => p >= 0.5 ? hot : p > 0 ? neutral : '#7a96b8';
        const totalPressure = rows.reduce((s, r) => s + r.shortagePressure + r.oversupplyPressure + r.inventoryTightening + r.supplyEasing, 0);
        return (
          <div style={sectionWrap}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
              <div style={sectionTitle}>Category heatmap</div>
              <div style={{ fontSize: '0.66rem', color: '#7a96b8', fontStyle: 'italic' }}>
                {totalPressure > 0
                  ? `Sorted by pressure score · ${rows.length} categories`
                  : `${rows.length} categories — no pressure detected yet, sort follows tracked-parts size`}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 1100, width: '100%', fontFamily: 'monospace', fontSize: '0.66rem' }}>
                <thead>
                  <tr>
                    <th style={cellTH}>Basket</th>
                    <th style={cellTH}>Subcategory</th>
                    <th style={{ ...cellTH, textAlign: 'right' }}>Tracked</th>
                    <th style={{ ...cellTH, textAlign: 'right' }}>Captured</th>
                    <th style={{ ...cellTH, textAlign: 'right' }}>Priced</th>
                    <th style={{ ...cellTH, textAlign: 'right' }}>In stock</th>
                    <th style={{ ...cellTH, textAlign: 'right' }}>OoS</th>
                    <th style={{ ...cellTH, textAlign: 'right' }}>Median lead</th>
                    <th style={{ ...cellTH, textAlign: 'right', color: '#f05c5c' }}>Shortage</th>
                    <th style={{ ...cellTH, textAlign: 'right', color: '#3d8ef0' }}>Oversupply</th>
                    <th style={{ ...cellTH, textAlign: 'right', color: '#f0a84e' }}>Tightening</th>
                    <th style={{ ...cellTH, textAlign: 'right', color: '#00c9a7' }}>Easing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...cellTD, color: '#a0b8d0' }}>{r.basket}</td>
                      <td style={{ ...cellTD, color: r.subcategory === '—' ? '#7a96b8' : '#c4d4e8' }}>{r.subcategory}</td>
                      <td style={{ ...cellMono, textAlign: 'right' }}>{r.tracked}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: r.captured === r.tracked ? '#4dffc3' : '#f0a84e' }}>{pct(r.captured, r.tracked)}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: r.priced === r.tracked ? '#4dffc3' : r.priced > 0 ? '#f0a84e' : '#7a96b8' }}>{pct(r.priced, r.tracked)}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: colorPct(r.inStock/Math.max(1,r.tracked), '#4dffc3', '#a0b8d0') }}>{pct(r.inStock, r.tracked)}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: colorPct(r.outOfStock/Math.max(1,r.tracked), '#f0a84e', '#a0b8d0') }}>{pct(r.outOfStock, r.tracked)}</td>
                      <td style={{ ...cellMono, textAlign: 'right' }}>{r.medianLeadTime == null ? '—' : `${r.medianLeadTime} wk`}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: r.shortagePressure > 0 ? '#f05c5c' : '#7a96b8', fontWeight: r.shortagePressure > 0 ? 'bold' : 'normal' }}>{r.shortagePressure || '—'}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: r.oversupplyPressure > 0 ? '#3d8ef0' : '#7a96b8', fontWeight: r.oversupplyPressure > 0 ? 'bold' : 'normal' }}>{r.oversupplyPressure || '—'}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: r.inventoryTightening > 0 ? '#f0a84e' : '#7a96b8' }}>{r.inventoryTightening || '—'}</td>
                      <td style={{ ...cellMono, textAlign: 'right', color: r.supplyEasing > 0 ? '#00c9a7' : '#7a96b8' }}>{r.supplyEasing || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      </>)}

      {inventorySubTab === 'signals' && (<>
      {/* ── Shortage / Oversupply Signals (Phase 21G / 21K) ── */}
      {(() => {
        const sigSummary = signalsResp?.summary;
        const sigList = signalsResp?.signals || [];
        const meaningful = sigList.filter(s => s.signalType !== 'insufficient_history' && s.signalType !== 'normal');
        const insufficient = sigList.filter(s => s.signalType === 'insufficient_history').length;
        // Phase 21K — history depth read-out so customers can see how close
        // we are to having enough observations to leave insufficient_history.
        // Phase 21A — both /signals (singular) and /signals/latest (plural)
        // can drive this feed; tolerate either name.
        const obsCounts = sigList.map(s => s.observationCount ?? s.observationsCount ?? 0);
        const minObs = obsCounts.length > 0 ? Math.min(...obsCounts) : 0;
        const maxObs = obsCounts.length > 0 ? Math.max(...obsCounts) : 0;
        const sortedObs = [...obsCounts].sort((a, b) => a - b);
        const medianObs = sortedObs.length > 0
          ? (sortedObs.length % 2 === 0
              ? (sortedObs[sortedObs.length / 2 - 1] + sortedObs[sortedObs.length / 2]) / 2
              : sortedObs[(sortedObs.length - 1) / 2])
          : 0;
        const sigColor = t => t === 'shortage_pressure' ? '#f05c5c'
          : t === 'oversupply_pressure' ? '#3d8ef0'
          : t === 'inventory_tightening' ? '#f0a84e'
          : t === 'supply_easing' ? '#00c9a7'
          : t === 'price_only_pressure' ? '#ab6af0'
          : t === 'normal' ? '#7a96b8'
          : '#4a6a8a';
        const sigLabel = t => t === 'shortage_pressure' ? 'Shortage pressure'
          : t === 'oversupply_pressure' ? 'Oversupply pressure'
          : t === 'inventory_tightening' ? 'Inventory tightening'
          : t === 'supply_easing' ? 'Supply easing'
          : t === 'price_only_pressure' ? 'Price-only pressure'
          : t === 'normal' ? 'Normal'
          : 'Insufficient history';
        return (
          <div style={sectionWrap}>
            <div style={{ ...sectionTitle, marginBottom: 8 }}>Shortage / Oversupply Signals</div>
            {/* Phase 21E — Signal Readiness card. Compact panel above the
                KPIs that confirms the engine is wired and shows what
                inputs it has. Numbers come from the same data sources
                the rest of the strip uses; no new fetches. */}
            {(() => {
              const totalParts = sigList.length || (signalsResp?.summary?.total ?? 0);
              const partsWithInvHistory = historySummary?.partsWithHistory ?? 0;
              const partsWithDirectPrice = sigList.filter(s => s.latestNormalizedUnitPrice != null).length;
              const partsWith2PlusPriced = sigList.filter(s =>
                s.latestNormalizedUnitPrice != null && s.previousNormalizedUnitPrice != null,
              ).length;
              const meaningfulCount = (sigSummary?.shortagePressure ?? 0)
                + (sigSummary?.oversupplyPressure ?? 0)
                + (sigSummary?.inventoryTightening ?? 0)
                + (sigSummary?.supplyEasing ?? 0)
                + (sigSummary?.priceOnlyPressure ?? 0);
              const engineActive = partsWithInvHistory > 0;
              return (
                <div style={{
                  marginBottom: 12, padding: '10px 14px',
                  background: '#080c14', border: '1px solid #1a2740', borderRadius: 4,
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '4px 18px',
                  fontFamily: 'monospace', fontSize: '0.66rem',
                }}>
                  <div>
                    <div style={{ ...tinyLabel, marginBottom: 2 }}>Signal readiness</div>
                    <div style={{ color: engineActive ? '#4dffc3' : '#7a96b8', fontSize: '0.78rem' }}>
                      {engineActive ? 'Engine active' : 'Engine inactive'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Inventory history</div>
                    <div style={{ color: '#e0eaf8', marginTop: 2 }}>{partsWithInvHistory}/{totalParts}</div>
                  </div>
                  <div>
                    <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Direct TI price history</div>
                    <div style={{ color: partsWithDirectPrice > 0 ? '#4dffc3' : '#a0b8d0', marginTop: 2 }}>
                      {partsWithDirectPrice}/{totalParts}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>2+ priced observations</div>
                    <div style={{ color: partsWith2PlusPriced > 0 ? '#4dffc3' : '#f0a84e', marginTop: 2 }}>
                      {partsWith2PlusPriced}/{totalParts}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Current result</div>
                    <div style={{ color: meaningfulCount > 0 ? '#f0a84e' : '#a0b8d0', marginTop: 2 }}>
                      {meaningfulCount > 0 ? `${meaningfulCount} active` : 'No pressure detected'}
                    </div>
                  </div>
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <KpiCard
                label="Shortage pressure"
                value={sigSummary?.shortagePressure ?? 0}
                sub={sigSummary?.shortagePressure ? 'inv falling, price rising' : 'none detected'}
                color={sigSummary?.shortagePressure ? '#f05c5c' : '#c4d4e8'}
              />
              <KpiCard
                label="Oversupply pressure"
                value={sigSummary?.oversupplyPressure ?? 0}
                sub={sigSummary?.oversupplyPressure ? 'inv rising, price falling' : 'none detected'}
                color={sigSummary?.oversupplyPressure ? '#3d8ef0' : '#c4d4e8'}
              />
              <KpiCard
                label="Inventory tightening"
                value={sigSummary?.inventoryTightening ?? 0}
                sub="inv falling, price flat"
                color={sigSummary?.inventoryTightening ? '#f0a84e' : '#c4d4e8'}
              />
              <KpiCard
                label="Supply easing"
                value={sigSummary?.supplyEasing ?? 0}
                sub="inv rising, price flat"
                color={sigSummary?.supplyEasing ? '#00c9a7' : '#c4d4e8'}
              />
              <KpiCard
                label="Insufficient history"
                value={insufficient}
                sub="<3 captures recorded"
                color="#7a96b8"
              />
            </div>
            {/* Phase 22.5 — Signal Leaderboard. 9 ranked tabs over the
                same /signals/latest payload. Five filter by signalType
                (shortage_pressure / oversupply_pressure / inventory_
                tightening / supply_easing / price_only_pressure); four
                sort by largest |delta| (inventory drops/builds, price
                increases/decreases). Empty-state per tab is honest:
                "No N detected." */}
            {(() => {
              const TABS = [
                { id: 'shortage_pressure',    label: 'Shortage pressure',     color: '#f05c5c', kind: 'type' },
                { id: 'oversupply_pressure',  label: 'Oversupply pressure',   color: '#3d8ef0', kind: 'type' },
                { id: 'inventory_tightening', label: 'Inventory tightening',  color: '#f0a84e', kind: 'type' },
                { id: 'supply_easing',        label: 'Supply easing',         color: '#00c9a7', kind: 'type' },
                { id: 'price_only_pressure',  label: 'Price-only pressure',   color: '#ab6af0', kind: 'type' },
                { id: 'inventory_drops',      label: 'Largest inventory drops',     color: '#f0a84e', kind: 'rank', sort: 'invDesc' },
                { id: 'inventory_builds',     label: 'Largest inventory builds',    color: '#4dffc3', kind: 'rank', sort: 'invAsc' },
                { id: 'price_increases',      label: 'Largest price increases',     color: '#f05c5c', kind: 'rank', sort: 'priceAsc' },
                { id: 'price_decreases',      label: 'Largest price decreases',     color: '#4dffc3', kind: 'rank', sort: 'priceDesc' },
              ];
              const active = TABS.find(t => t.id === leaderboardTab) || TABS[0];
              const fmtPct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
              const fmtPrice = v => v == null ? '—' : `$${Number(v).toFixed(4)}`;
              let rows = [];
              if (active.kind === 'type') {
                rows = sigList.filter(s => s.signalType === active.id);
              } else {
                // Rank tabs: sort all rows by abs delta direction. We take
                // the per-row priceDelta / inventoryPctDelta from the
                // persisted signal (latest-vs-previous; Phase 21A.3).
                rows = sigList.slice();
                if (active.sort === 'invDesc') {
                  rows = rows.filter(s => s.inventoryPctDelta != null && s.inventoryPctDelta < 0)
                    .sort((a, b) => a.inventoryPctDelta - b.inventoryPctDelta);
                } else if (active.sort === 'invAsc') {
                  rows = rows.filter(s => s.inventoryPctDelta != null && s.inventoryPctDelta > 0)
                    .sort((a, b) => b.inventoryPctDelta - a.inventoryPctDelta);
                } else if (active.sort === 'priceAsc') {
                  rows = rows.filter(s => s.pricePctDelta != null && s.pricePctDelta > 0)
                    .sort((a, b) => b.pricePctDelta - a.pricePctDelta);
                } else if (active.sort === 'priceDesc') {
                  rows = rows.filter(s => s.pricePctDelta != null && s.pricePctDelta < 0)
                    .sort((a, b) => a.pricePctDelta - b.pricePctDelta);
                }
              }
              const top = rows.slice(0, 15);
              const totalUniverse = sigList.length;
              const meaningfulTotal = sigList.filter(s => ['shortage_pressure','oversupply_pressure','inventory_tightening','supply_easing','price_only_pressure'].includes(s.signalType)).length;
              return (
                <div>
                  {/* Tab strip */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #1a2740' }}>
                    {TABS.map(t => {
                      const on = t.id === active.id;
                      const count = t.kind === 'type'
                        ? sigList.filter(s => s.signalType === t.id).length
                        : null;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setLeaderboardTab(t.id)}
                          style={{
                            background: on ? '#0d1830' : 'none',
                            border: '1px solid ' + (on ? t.color : '#1a2740'),
                            borderRadius: 3,
                            padding: '5px 10px',
                            fontSize: '0.6rem',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: on ? t.color : '#7a96b8',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontWeight: on ? 'bold' : 'normal',
                          }}
                        >{t.label}{count != null ? ` (${count})` : ''}</button>
                      );
                    })}
                  </div>

                  {top.length === 0 ? (
                    <div style={{ fontSize: '0.7rem', color: '#7a96b8', fontStyle: 'italic', lineHeight: 1.5, padding: '8px 0' }}>
                      {meaningfulTotal === 0
                        ? 'No pressure detected yet. Inventory and direct TI pricing are currently stable across the watched universe.'
                        : `No ${active.label.toLowerCase()} in the current snapshot.`}
                      {(() => {
                        const priceUnavail = sigSummary?.priceUnavailableCount ?? 0;
                        const firstPriced = sigList.filter(s => /Direct TI Store price captured; waiting for a second pricing observation/i.test(s.explanation || '')).length;
                        if (totalUniverse > 0 && priceUnavail === totalUniverse) {
                          return (
                            <div style={{ marginTop: 8, color: '#a0b8d0', fontStyle: 'normal' }}>
                              Current TI Store API responses are returning inventory units but no normalized
                              price breaks for this watched set. The dashboard therefore shows
                              inventory-only monitoring until a pricing source is available.
                            </div>
                          );
                        }
                        if (firstPriced > 0) {
                          return (
                            <div style={{ marginTop: 8, color: '#a0b8d0', fontStyle: 'normal' }}>
                              Direct TI Store prices are now captured for the watched universe.
                              Price-trend classifications require two pricing-bearing captures.
                              Currently {firstPriced} of {totalUniverse} rows are waiting for the next
                              capture before shortage / oversupply pressure can be calculated.
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900, fontFamily: 'monospace', fontSize: '0.66rem' }}>
                        <thead>
                          <tr>
                            <th style={cellTH}>Part</th>
                            <th style={cellTH}>Basket</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Inv now</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Inv prev</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Inv Δ%</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Price now</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Price prev</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Price Δ%</th>
                            <th style={cellTH}>Signal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {top.map((s, idx) => (
                            <tr key={`lb-${active.id}-${s.partNumber || idx}`}>
                              <td style={cellMono}>
                                {s.partNumber || s.orderablePartNumber}
                                {s.displayName && <span style={{ color: '#7a96b8', marginLeft: 6, fontSize: '0.6rem' }}>· {s.displayName}</span>}
                              </td>
                              <td style={{ ...cellTD, color: '#a0b8d0' }}>{s.basket || '—'}</td>
                              <td style={{ ...cellMono, textAlign: 'right' }}>{s.latestQuantityAvailable != null ? Number(s.latestQuantityAvailable).toLocaleString() : '—'}</td>
                              <td style={{ ...cellMono, textAlign: 'right', color: '#a0b8d0' }}>{s.previousQuantityAvailable != null ? Number(s.previousQuantityAvailable).toLocaleString() : '—'}</td>
                              <td style={{ ...cellMono, textAlign: 'right', color: s.inventoryPctDelta == null ? '#7a96b8' : s.inventoryPctDelta < 0 ? '#f0a84e' : s.inventoryPctDelta > 0 ? '#4dffc3' : '#a0b8d0' }}>
                                {fmtPct(s.inventoryPctDelta)}
                              </td>
                              <td style={{ ...cellMono, textAlign: 'right' }}>{fmtPrice(s.latestNormalizedUnitPrice)}</td>
                              <td style={{ ...cellMono, textAlign: 'right', color: '#a0b8d0' }}>{fmtPrice(s.previousNormalizedUnitPrice)}</td>
                              <td style={{ ...cellMono, textAlign: 'right', color: s.pricePctDelta == null ? '#7a96b8' : s.pricePctDelta > 0 ? '#f05c5c' : s.pricePctDelta < 0 ? '#4dffc3' : '#a0b8d0' }}>
                                {fmtPct(s.pricePctDelta)}
                              </td>
                              <td style={{ ...cellTD, color: sigColor(s.signalType), fontWeight: active.kind === 'type' ? 'bold' : 'normal' }}>
                                {sigLabel(s.signalType)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ marginTop: 10, fontSize: '0.7rem', color: '#a0b8d0', lineHeight: 1.5 }}>
              Shortage / oversupply signals require at least 3 observations. Current history depth: {medianObs} observation{medianObs === 1 ? '' : 's'} per part
              {minObs !== maxObs && (
                <span style={{ color: '#7a96b8' }}> (range {minObs}–{maxObs})</span>
              )}
              {medianObs < 3 && (
                <span style={{ color: '#7a96b8' }}> · {3 - Math.ceil(medianObs)} more daily capture{3 - Math.ceil(medianObs) === 1 ? '' : 's'} until classifications can fire</span>
              )}.
            </div>
            <div style={{ marginTop: 4, fontSize: '0.6rem', color: '#7a96b8', fontStyle: 'italic' }}>
              A daily scheduled capture runs at 04:00–04:45 UTC across four batches; manual captures from Operator tools also append to history. Capture failures are not counted as out-of-stock.
            </div>
            {/* Phase 21E — collapsed "Example signal logic" explainer.
                Static rules table; explicitly labelled as illustrative
                so the customer never confuses these examples with the
                live signal table above. */}
            <details style={{ marginTop: 14, padding: '8px 12px', background: '#0d1422', border: '1px solid #1a2740', borderRadius: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.62rem', color: '#a0b8d0', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 'bold' }}>
                Example signal logic
              </summary>
              <div style={{ marginTop: 10, fontSize: '0.66rem', color: '#c4d4e8', lineHeight: 1.6 }}>
                <div style={{ marginBottom: 8, color: '#7a96b8', fontStyle: 'italic' }}>
                  These examples are illustrative. The live signal table above uses direct TI captured data only.
                </div>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'monospace', fontSize: '0.64rem' }}>
                  <thead>
                    <tr>
                      <th style={cellTH}>Inventory</th>
                      <th style={cellTH}>Price</th>
                      <th style={cellTH}>Classification</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ ...cellMono, color: '#f0a84e' }}>down ≥25% (7d)</td>
                      <td style={{ ...cellMono, color: '#f05c5c' }}>up ≥5% (7d)</td>
                      <td style={{ ...cellMono, color: '#f05c5c', fontWeight: 'bold' }}>shortage_pressure</td>
                    </tr>
                    <tr>
                      <td style={{ ...cellMono, color: '#4dffc3' }}>up ≥50% (7d)</td>
                      <td style={{ ...cellMono, color: '#4dffc3' }}>down ≥5% (7d)</td>
                      <td style={{ ...cellMono, color: '#3d8ef0', fontWeight: 'bold' }}>oversupply_pressure</td>
                    </tr>
                    <tr>
                      <td style={{ ...cellMono, color: '#f0a84e' }}>down ≥25% (7d)</td>
                      <td style={{ ...cellMono, color: '#7a96b8' }}>flat or unavailable</td>
                      <td style={{ ...cellMono, color: '#f0a84e', fontWeight: 'bold' }}>inventory_tightening</td>
                    </tr>
                    <tr>
                      <td style={{ ...cellMono, color: '#4dffc3' }}>up ≥50% (7d)</td>
                      <td style={{ ...cellMono, color: '#7a96b8' }}>flat or unavailable</td>
                      <td style={{ ...cellMono, color: '#00c9a7', fontWeight: 'bold' }}>supply_easing</td>
                    </tr>
                    <tr>
                      <td style={{ ...cellMono, color: '#7a96b8' }}>flat / up</td>
                      <td style={{ ...cellMono, color: '#f05c5c' }}>up ≥5% (7d)</td>
                      <td style={{ ...cellMono, color: '#ab6af0', fontWeight: 'bold' }}>price_only_pressure</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ marginTop: 10, fontSize: '0.6rem', color: '#7a96b8', lineHeight: 1.5 }}>
                  Operators can verify these rules end-to-end against the production engine via
                  <code style={{ marginLeft: 4, padding: '1px 4px', background: '#080c14', border: '1px solid #1a2740', borderRadius: 2, color: '#a0b8d0' }}>
                    GET /api/ti/inventory/signal-simulator
                  </code>
                  (auth-gated, read-only, no D1 write).
                </div>
              </div>
            </details>
          </div>
        );
      })()}
      </>)}

      {inventorySubTab === 'trends' && (
        <div style={sectionWrap}>
          <div style={{ ...sectionTitle, marginBottom: 8 }}>Trends</div>
          <div style={{ fontSize: '0.7rem', color: '#a0b8d0', maxWidth: 920, marginBottom: 12 }}>
            Drill into the watched universe at four scopes: the whole universe, a single basket,
            a subcategory inside a basket, or one part. Inventory and direct TI Store price are
            sourced from the captured D1 history. Pricing series only renders when the TI Store
            API has returned price breaks — otherwise we say so explicitly rather than fabricating
            a price line.
          </div>

          {/* Phase 23A — scope + window controls. The existing part picker
              stays visible only when scope === 'part'; basket/subcategory
              dropdowns appear when their scope is selected. Trigger fetch
              for aggregate scopes on change. */}
          {(() => {
            const partsAll = (snapshot?.parts || []);
            const catalogParts = (watchedCatalog?.parts || []);
            const subcatByOpn = new Map(catalogParts.map(p => [p.preferredOrderablePartNumber, p.subcategory ?? null]));
            const basketsAvailable = Array.from(new Set(partsAll.map(p => p.basket).filter(Boolean))).sort();
            const subcategoriesAvailable = trendsBasket
              ? Array.from(new Set(
                  partsAll
                    .filter(p => p.basket === trendsBasket)
                    .map(p => subcatByOpn.get(p.partNumber))
                    .filter(s => s != null && s !== ''),
                )).sort()
              : [];
            const windowOptions = ['7d', '30d', '90d', 'all'];
            const scopes = [
              { id: 'universe', label: 'Universe' },
              { id: 'basket', label: 'Basket' },
              { id: 'subcategory', label: 'Subcategory' },
              { id: 'part', label: 'Part' },
            ];
            // Auto-trigger aggregate fetch when scope/basket/subcategory/window
            // resolves to a complete query. Defensive: subcategory needs basket.
            if (trendsScope !== 'part') {
              const ok =
                (trendsScope === 'universe') ||
                (trendsScope === 'basket' && trendsBasket) ||
                (trendsScope === 'subcategory' && trendsBasket && trendsSubcategory);
              if (ok) {
                fetchTrendsAggregate(trendsScope, trendsBasket, trendsSubcategory, trendsWindow);
              }
            }
            return (
              <div style={{
                marginBottom: 14, padding: '10px 12px',
                background: '#0d1422', border: '1px solid #1a2740', borderRadius: 4,
                display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {scopes.map(s => {
                    const on = trendsScope === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setTrendsScope(s.id);
                          // Reset narrower selectors when widening scope so
                          // the dropdowns don't carry stale state.
                          if (s.id === 'universe') { setTrendsBasket(''); setTrendsSubcategory(''); }
                          if (s.id === 'basket') { setTrendsSubcategory(''); }
                        }}
                        style={{
                          background: on ? '#0d1830' : 'none',
                          border: '1px solid ' + (on ? '#3d8ef0' : '#1a2740'),
                          borderRadius: 3,
                          padding: '5px 12px',
                          fontSize: '0.62rem',
                          letterSpacing: '0.10em',
                          textTransform: 'uppercase',
                          color: on ? '#e0eaf8' : '#7a96b8',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontWeight: on ? 'bold' : 'normal',
                        }}
                      >{s.label}</button>
                    );
                  })}
                </div>
                {(trendsScope === 'basket' || trendsScope === 'subcategory') && (
                  <select
                    value={trendsBasket}
                    onChange={e => { setTrendsBasket(e.target.value); setTrendsSubcategory(''); }}
                    style={{ background: '#080c14', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.7rem', borderRadius: 3, minWidth: 200 }}
                  >
                    <option value="">— pick basket —</option>
                    {basketsAvailable.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}
                {trendsScope === 'subcategory' && (
                  <select
                    value={trendsSubcategory}
                    onChange={e => setTrendsSubcategory(e.target.value)}
                    disabled={!trendsBasket}
                    style={{ background: '#080c14', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.7rem', borderRadius: 3, minWidth: 200, opacity: trendsBasket ? 1 : 0.4 }}
                  >
                    <option value="">— pick subcategory —</option>
                    {subcategoriesAvailable.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {windowOptions.map(w => {
                    const on = trendsWindow === w;
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setTrendsWindow(w)}
                        style={{
                          background: on ? '#0d1830' : 'none',
                          border: '1px solid ' + (on ? '#3d8ef0' : '#1a2740'),
                          borderRadius: 3,
                          padding: '4px 10px',
                          fontSize: '0.6rem',
                          letterSpacing: '0.10em',
                          textTransform: 'uppercase',
                          color: on ? '#e0eaf8' : '#7a96b8',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontWeight: on ? 'bold' : 'normal',
                        }}
                      >{w}</button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Phase 23A — aggregate scope renderer. Bypassed when scope === 'part';
              the original part-detail block below renders unchanged in that case. */}
          {trendsScope !== 'part' && (() => {
            const ok =
              (trendsScope === 'universe') ||
              (trendsScope === 'basket' && trendsBasket) ||
              (trendsScope === 'subcategory' && trendsBasket && trendsSubcategory);
            if (!ok) {
              return (
                <div style={{ fontSize: '0.7rem', color: '#7a96b8', fontStyle: 'italic' }}>
                  {trendsScope === 'basket'
                    ? 'Pick a basket to see its trend.'
                    : 'Pick a basket and subcategory to see the subcategory trend.'}
                </div>
              );
            }
            const key = `${trendsScope}|${trendsBasket || ''}|${trendsSubcategory || ''}|${trendsWindow}`;
            const data = trendsAggData[key];
            if (!data) {
              return <div style={{ fontSize: '0.7rem', color: '#7a96b8' }}>Loading {trendsScope} trend…</div>;
            }
            if (data._error) {
              return <div style={{ fontSize: '0.7rem', color: '#f0a84e' }}>{data._error}</div>;
            }
            const fmtPct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
            const fmtPrice = v => v == null ? '—' : `$${Number(v).toFixed(4)}`;
            const fmtQty = v => v == null ? '—' : Number(v).toLocaleString();
            const fmtTime = iso => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
            const meaningful = (data.shortagePressureCount || 0) + (data.oversupplyPressureCount || 0)
              + (data.inventoryTighteningCount || 0) + (data.supplyEasingCount || 0);
            const scopeLabel = data.scope === 'universe' ? 'The 64-part TI watched universe'
              : data.scope === 'basket' ? `${data.basket}`
              : `${data.basket} · ${data.subcategory}`;
            const conclusion = meaningful === 0
              ? `${scopeLabel} is stable: no shortage or oversupply pressure detected.`
              : data.shortagePressureCount > 0
                ? `${scopeLabel} shows ${data.shortagePressureCount} part${data.shortagePressureCount === 1 ? '' : 's'} under shortage pressure.`
                : data.oversupplyPressureCount > 0
                  ? `${scopeLabel} shows ${data.oversupplyPressureCount} part${data.oversupplyPressureCount === 1 ? '' : 's'} under oversupply pressure.`
                  : `${scopeLabel} shows ${meaningful} part${meaningful === 1 ? '' : 's'} with directional signal.`;
            const conclusionColor = data.shortagePressureCount > 0 ? '#f05c5c'
              : data.oversupplyPressureCount > 0 ? '#3d8ef0'
              : data.inventoryTighteningCount > 0 ? '#f0a84e'
              : data.supplyEasingCount > 0 ? '#00c9a7'
              : '#4dffc3';
            const stockoutPct = data.stockoutRate == null ? null : Math.round(data.stockoutRate * 100);
            const inStockPct = (data.capturedParts > 0 && data.inStockParts != null)
              ? Math.round(data.inStockParts / data.capturedParts * 100) : null;
            const KpiTile = ({ label, value, sub, color }) => (
              <div style={{ padding: '10px 12px', background: '#080c14', border: '1px solid #1a2740', borderRadius: 4 }}>
                <div style={{ ...tinyLabel, marginBottom: 2 }}>{label}</div>
                <div style={{ color: color || '#e0eaf8', fontSize: '1.05rem', fontFamily: 'monospace', lineHeight: 1.1 }}>{value}</div>
                {sub && <div style={{ color: '#7a96b8', fontSize: '0.58rem', marginTop: 2, fontFamily: 'monospace' }}>{sub}</div>}
              </div>
            );
            const MoverList = ({ title, rows, deltaSide, accent }) => (
              <div>
                <div style={{ ...tinyLabel, color: accent, marginBottom: 6 }}>{title}</div>
                {(!rows || rows.length === 0) ? (
                  <div style={{ fontSize: '0.66rem', color: '#7a96b8', fontStyle: 'italic', fontFamily: 'monospace', padding: '6px 0' }}>
                    No movement in this direction within {trendsWindow}.
                  </div>
                ) : (
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'monospace', fontSize: '0.62rem' }}>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.partNumber + '-' + i}>
                          <td style={{ ...cellTD, padding: '3px 6px' }}>
                            {r.partNumber}
                            {r.displayName && <span style={{ color: '#7a96b8', marginLeft: 6, fontSize: '0.58rem' }}>· {r.displayName}</span>}
                          </td>
                          <td style={{ ...cellMono, padding: '3px 6px', textAlign: 'right', color: deltaSide === 'inventory'
                              ? (r.inventoryPctDelta < 0 ? '#f0a84e' : '#4dffc3')
                              : (r.pricePctDelta > 0 ? '#f05c5c' : '#4dffc3') }}>
                            {deltaSide === 'inventory'
                              ? `${fmtPct(r.inventoryPctDelta)} (${fmtQty(r.previousQuantityAvailable)} → ${fmtQty(r.latestQuantityAvailable)})`
                              : `${fmtPct(r.pricePctDelta)} (${fmtPrice(r.previousNormalizedUnitPrice)} → ${fmtPrice(r.latestNormalizedUnitPrice)})`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
            return (
              <div>
                {/* Conclusion */}
                <div style={{
                  padding: '10px 14px', marginBottom: 12,
                  background: '#080c14', border: '1px solid #1a2740', borderRadius: 4,
                  borderLeft: `3px solid ${conclusionColor}`,
                }}>
                  <div style={{ fontSize: '0.78rem', color: '#e0eaf8', fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1.4 }}>
                    {conclusion}
                  </div>
                  <div style={{ marginTop: 6, fontSize: '0.62rem', color: '#7a96b8', fontFamily: 'monospace' }}>
                    Window: {data.window} ({data.windowDays}d) · backend: {data.backend}
                  </div>
                </div>

                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
                  <KpiTile label="Tracked parts" value={data.trackedParts} sub={`captured ${data.capturedParts}/${data.trackedParts}`} />
                  <KpiTile label="Direct TI priced" value={`${data.pricedParts}/${data.trackedParts}`} sub="TI Store API" color={data.pricedParts === data.trackedParts ? '#4dffc3' : '#f0a84e'} />
                  <KpiTile label="In stock" value={data.inStockParts ?? '—'} sub={inStockPct == null ? '' : `${inStockPct}% of captured`} color="#4dffc3" />
                  <KpiTile label="Stockout" value={data.outOfStockParts ?? '—'} sub={stockoutPct == null ? '' : `${stockoutPct}% of captured`} color={data.outOfStockParts > 0 ? '#f0a84e' : '#7a96b8'} />
                  <KpiTile label="Median lead" value={data.medianLeadTimeWeeks == null ? '—' : `${data.medianLeadTimeWeeks} wk`} sub="latest per part" />
                  <KpiTile label={`Median Δ inv (${data.window})`}
                          value={fmtPct(data.medianInventoryPctChange)}
                          sub="window first → latest"
                          color={data.medianInventoryPctChange == null ? '#7a96b8' : data.medianInventoryPctChange < 0 ? '#f0a84e' : '#4dffc3'} />
                  <KpiTile label={`Median Δ price (${data.window})`}
                          value={fmtPct(data.medianPricePctChange)}
                          sub="window first → latest"
                          color={data.medianPricePctChange == null ? '#7a96b8' : data.medianPricePctChange > 0 ? '#f05c5c' : '#4dffc3'} />
                  <KpiTile label="Shortage" value={data.shortagePressureCount} sub="inv ↓ + price ↑" color={data.shortagePressureCount > 0 ? '#f05c5c' : '#7a96b8'} />
                  <KpiTile label="Oversupply" value={data.oversupplyPressureCount} sub="inv ↑ + price ↓" color={data.oversupplyPressureCount > 0 ? '#3d8ef0' : '#7a96b8'} />
                </div>

                {/* Time series — median qty + median price per 5-min bucket */}
                <div style={{ marginBottom: 16 }}>
                  <div style={tinyLabel}>Inventory & price trend · {data.timeSeries?.length || 0} capture buckets</div>
                  {(!data.timeSeries || data.timeSeries.length === 0) ? (
                    <div style={{ fontSize: '0.66rem', color: '#7a96b8', fontStyle: 'italic', fontFamily: 'monospace', padding: '6px 0' }}>
                      No history rows in the selected window.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', marginTop: 6, fontFamily: 'monospace', fontSize: '0.66rem', width: '100%', minWidth: 500 }}>
                        <thead>
                          <tr>
                            <th style={cellTH}>Capture bucket</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Parts captured</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Median qty</th>
                            <th style={{ ...cellTH, textAlign: 'right' }}>Median TI price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.timeSeries.slice().reverse().map((b, i) => (
                            <tr key={b.bucketAt + '-' + i}>
                              <td style={{ ...cellTD, padding: '3px 6px' }}>{fmtTime(b.bucketAt)}</td>
                              <td style={{ ...cellMono, padding: '3px 6px', textAlign: 'right' }}>{b.partsCaptured}</td>
                              <td style={{ ...cellMono, padding: '3px 6px', textAlign: 'right' }}>{fmtQty(b.medianQuantity)}</td>
                              <td style={{ ...cellMono, padding: '3px 6px', textAlign: 'right' }}>{fmtPrice(b.medianNormalizedPrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Top movers inside scope */}
                <div style={tinyLabel}>Top movers in {trendsScope === 'universe' ? 'the universe' : trendsScope === 'basket' ? trendsBasket : `${trendsBasket} · ${trendsSubcategory}`}</div>
                <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                  <MoverList title="Largest inventory drops"   rows={data.topMovers?.inventoryDrops}    deltaSide="inventory" accent="#f0a84e" />
                  <MoverList title="Largest inventory builds"  rows={data.topMovers?.inventoryBuilds}   deltaSide="inventory" accent="#4dffc3" />
                  <MoverList title="Largest price increases"   rows={data.topMovers?.priceIncreases}    deltaSide="price"     accent="#f05c5c" />
                  <MoverList title="Largest price decreases"   rows={data.topMovers?.priceDecreases}    deltaSide="price"     accent="#4dffc3" />
                </div>
              </div>
            );
          })()}

          {/* Phase 23A — original Part scope renderer (existing behaviour
              preserved verbatim — runs only when trendsScope === 'part'). */}
          {trendsScope === 'part' && (() => {
            const partOptions = (snapshot?.parts || []).map(p => ({ partNumber: p.partNumber, basket: p.basket, displayName: p.displayName }));
            const selected = trendPart || partOptions[0]?.partNumber || null;
            const histResp = selected ? historyByPart[selected] : null;
            // Lazy-load history when a part is selected.
            if (selected && !histResp) {
              fetchPartHistory(selected);
            }
            return (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={tinyLabel}>Part</div>
                  <select
                    value={selected || ''}
                    onChange={e => setTrendPart(e.target.value)}
                    style={{ background: '#080c14', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', borderRadius: 3, minWidth: 280 }}
                  >
                    {partOptions.map(p => (
                      <option key={p.partNumber} value={p.partNumber}>
                        {p.partNumber}{p.displayName ? ` — ${p.displayName}` : ''}{p.basket ? ` (${p.basket})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {!selected ? (
                  <div style={{ fontSize: '0.7rem', color: '#7a96b8', fontStyle: 'italic' }}>No watched parts loaded yet.</div>
                ) : !histResp ? (
                  <div style={{ fontSize: '0.7rem', color: '#7a96b8' }}>Loading history for {selected}…</div>
                ) : histResp.error ? (
                  <div style={{ fontSize: '0.7rem', color: '#f0a84e' }}>{histResp.error}</div>
                ) : (histResp.rows || []).length === 0 ? (
                  <div style={{ fontSize: '0.7rem', color: '#7a96b8', fontStyle: 'italic' }}>
                    No history rows yet for {selected}. Run captures over multiple days to populate the trend.
                  </div>
                ) : (() => {
                  const rows = histResp.rows || [];
                  const anyPrice = rows.some(r => r.priceAvailable);
                  // Phase 21C — Part Detail mini-trend. Latest vs immediately
                  // previous capture, plus observation count and a clear
                  // pricing-status badge. Compact summary above the existing
                  // 30-day table; no chart yet.
                  const latest = rows[rows.length - 1] ?? null;
                  const previous = rows.length >= 2 ? rows[rows.length - 2] : null;
                  const latestQty = latest?.quantityAvailable;
                  const previousQty = previous?.quantityAvailable;
                  const invDelta = (latestQty != null && previousQty != null) ? (latestQty - previousQty) : null;
                  const invPctDelta = (latestQty != null && previousQty != null && previousQty !== 0)
                    ? ((latestQty - previousQty) / Math.abs(previousQty)) * 100
                    : (latestQty === 0 && previousQty === 0 ? 0 : null);
                  const fmtQty = q => q == null ? '—' : Number(q).toLocaleString();
                  const fmtDelta = d => d == null ? '—' : (d > 0 ? `+${Number(d).toLocaleString()}` : Number(d).toLocaleString());
                  const fmtPct = p => p == null ? '' : ` (${p > 0 ? '+' : ''}${p.toFixed(1)}%)`;
                  const deltaColor = invDelta == null ? '#7a96b8' : invDelta > 0 ? '#4dffc3' : invDelta < 0 ? '#f0a84e' : '#a0b8d0';
                  // Phase 21D.2 — TI Store price latest vs previous. Either
                  // can be null; if previous is null but latest is non-null
                  // we show a "first priced capture" hint.
                  const latestPrice = latest?.normalizedUnitPrice ?? null;
                  const previousPrice = previous?.normalizedUnitPrice ?? null;
                  const priceDelta = (latestPrice != null && previousPrice != null) ? (latestPrice - previousPrice) : null;
                  const pricePctDelta = (latestPrice != null && previousPrice != null && previousPrice !== 0)
                    ? ((latestPrice - previousPrice) / Math.abs(previousPrice)) * 100
                    : (latestPrice === 0 && previousPrice === 0 ? 0 : null);
                  const priceDeltaColor = priceDelta == null ? '#7a96b8' : priceDelta > 0 ? '#f05c5c' : priceDelta < 0 ? '#4dffc3' : '#a0b8d0';
                  const fmtPriceVal = (p, cur) => p == null ? '—' : `${cur || latest?.currency || 'USD'} ${Number(p).toFixed(4)}`;
                  const fmtPriceDelta = d => d == null ? '—' : (d > 0 ? `+${Number(d).toFixed(4)}` : Number(d).toFixed(4));
                  const firstPricedHere = latestPrice != null && previousPrice == null;
                  return (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 360, flex: 1 }}>
                        <div style={tinyLabel}>Part detail · {selected}</div>
                        <div style={{
                          marginTop: 6, marginBottom: 14, padding: '10px 14px',
                          background: '#080c14', border: '1px solid #1a2740', borderRadius: 4,
                          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '6px 14px',
                          fontFamily: 'monospace', fontSize: '0.66rem',
                        }}>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Latest inventory</div>
                            <div style={{ color: '#e0eaf8', fontSize: '0.85rem', marginTop: 2 }}>{fmtQty(latestQty)}</div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Previous inventory</div>
                            <div style={{ color: '#a0b8d0', fontSize: '0.85rem', marginTop: 2 }}>{fmtQty(previousQty)}</div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Inventory Δ</div>
                            <div style={{ color: deltaColor, fontSize: '0.85rem', marginTop: 2 }}>
                              {fmtDelta(invDelta)}<span style={{ fontSize: '0.62rem', color: '#7a96b8' }}>{fmtPct(invPctDelta)}</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Latest TI price</div>
                            <div style={{ color: '#e0eaf8', fontSize: '0.85rem', marginTop: 2 }}>
                              {fmtPriceVal(latestPrice, latest?.currency)}
                              {latestPrice != null && (
                                <span style={{ color: '#7a96b8', fontSize: '0.6rem', marginLeft: 4 }}>
                                  @ {Number(latest?.normalizedPriceQty || 1).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Previous TI price</div>
                            <div style={{ color: '#a0b8d0', fontSize: '0.85rem', marginTop: 2 }}>
                              {fmtPriceVal(previousPrice, previous?.currency)}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Price Δ</div>
                            <div style={{ color: priceDeltaColor, fontSize: '0.85rem', marginTop: 2 }}>
                              {fmtPriceDelta(priceDelta)}<span style={{ fontSize: '0.62rem', color: '#7a96b8' }}>{fmtPct(pricePctDelta)}</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Observations</div>
                            <div style={{ color: '#e0eaf8', fontSize: '0.85rem', marginTop: 2 }}>{rows.length}</div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Latest captured</div>
                            <div style={{ color: '#a0b8d0', fontSize: '0.7rem', marginTop: 2 }}>
                              {latest?.capturedAt ? new Date(latest.capturedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: '#7a96b8', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Pricing source</div>
                            <div style={{ color: latestPrice != null ? '#4dffc3' : '#f0a84e', fontSize: '0.7rem', marginTop: 2 }}>
                              {latestPrice != null ? 'TI Direct (high)' : 'unavailable'}
                            </div>
                          </div>
                        </div>
                        {firstPricedHere && (
                          <div style={{ marginTop: -8, marginBottom: 14, padding: '8px 12px', background: '#0d1422', border: '1px solid #1a2740', borderRadius: 4, fontSize: '0.66rem', color: '#a0b8d0', lineHeight: 1.5 }}>
                            First direct TI price captured. Price-trend classification starts after the next priced capture.
                          </div>
                        )}
                        <div style={tinyLabel}>30d inventory & price history · {rows.length} captures</div>
                        <table style={{ borderCollapse: 'collapse', marginTop: 6, fontFamily: 'monospace', fontSize: '0.66rem', width: '100%' }}>
                          <thead>
                            <tr>
                              <th style={cellTH}>Captured</th>
                              <th style={cellTH}>Quantity</th>
                              <th style={cellTH}>Price</th>
                              <th style={cellTH}>Lead</th>
                              <th style={cellTH}>Lifecycle</th>
                              <th style={cellTH}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.slice().reverse().map((r, hi) => {
                              const priceTxt = r.priceAvailable && r.normalizedUnitPrice != null
                                ? `$${Number(r.normalizedUnitPrice).toFixed(4)}`
                                : 'unavailable';
                              return (
                                <tr key={hi}>
                                  <td style={{ ...cellTD, fontSize: '0.62rem', padding: '3px 6px' }}>
                                    {new Date(r.capturedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </td>
                                  <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px' }}>
                                    {r.quantityAvailable == null ? '—' : Number(r.quantityAvailable).toLocaleString()}
                                  </td>
                                  <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px', color: r.priceAvailable ? '#c4d4e8' : '#7a96b8' }}>
                                    {priceTxt}
                                  </td>
                                  <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px' }}>
                                    {r.leadTimeWeeks == null ? '—' : `${r.leadTimeWeeks}w`}
                                  </td>
                                  <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px' }}>
                                    {r.lifecycleStatus || '—'}
                                  </td>
                                  <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px', color: r.captureStatus === 'failed' ? '#f05c5c' : '#a0b8d0' }}>
                                    {r.captureStatus}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {!anyPrice && (
                          <div style={{ marginTop: 8, fontSize: '0.66rem', color: '#f0a84e', fontStyle: 'italic' }}>
                            Pricing unavailable from current TI Store API response for this part — inventory series only.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>
            );
          })()}
        </div>
      )}

      {inventorySubTab === 'snapshot' && (<>
      {/* ── Filter / search / sort (Phase 20D) ── */}
      <div style={sectionWrap}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={tinyLabel}>Filter</div>
          <select
            value={basketFilter}
            onChange={e => setBasketFilter(e.target.value)}
            style={{ background: '#080c14', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', borderRadius: 3 }}
          >
            <option value="all">All baskets ({distinctBaskets.length})</option>
            {distinctBaskets.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search generic / orderable part"
            style={{ background: '#080c14', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', borderRadius: 3, minWidth: 240 }}
          />
          <span style={{ width: 10 }} />
          <div style={tinyLabel}>Sort</div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ background: '#080c14', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', borderRadius: 3 }}
          >
            <option value="basket">Basket</option>
            <option value="quantityAvailable">Quantity available</option>
            <option value="leadTimeWeeks">Lead time</option>
            <option value="lifecycleStatus">Lifecycle</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            style={{ background: 'transparent', border: '1px solid #1a2740', color: '#a0b8d0', padding: '5px 12px', fontSize: '0.72rem', borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace' }}
          >
            {sortDir === 'asc' ? '▲ asc' : '▼ desc'}
          </button>
          <span style={{ marginLeft: 'auto', fontSize: '0.66rem', color: '#7a96b8', fontFamily: 'monospace' }}>
            {filteredSnapshotParts.length} of {snapshotParts.length} watched parts shown
          </span>
        </div>
      </div>

      {/* ── Live inventory table ── */}
      <div style={sectionWrap}>
        <div style={{ ...sectionTitle, marginBottom: 8 }}>Live Inventory Table</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 1200, width: '100%' }}>
            <thead>
              <tr>
                <th style={cellTH}>Basket</th>
                <th style={cellTH}>Generic Part</th>
                <th style={cellTH}>Orderable Part</th>
                <th style={cellTH}>Description</th>
                <th style={cellTH}>Quantity Available</th>
                <th style={cellTH}>Pricing</th>
                <th style={cellTH}>Order Limit</th>
                <th style={cellTH}>Future Inventory</th>
                <th style={cellTH}>Lead Time</th>
                <th style={cellTH}>Lifecycle</th>
                <th style={cellTH}>Okay to Order</th>
                <th style={cellTH}>Last Fetched</th>
                <th style={cellTH}>Source</th>
              </tr>
            </thead>
            <tbody>
              {snapshotParts.length === 0 && adhocRows.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ ...cellTD, color: '#7a96b8', fontStyle: 'italic', textAlign: 'center', padding: '14px 8px' }}>
                    {snapshotLoading ? 'Loading inventory snapshot…' : 'No verified snapshot yet — operator can run a capture below.'}
                  </td>
                </tr>
              )}
              {snapshotParts.length > 0 && filteredSnapshotParts.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ ...cellTD, color: '#7a96b8', fontStyle: 'italic', textAlign: 'center', padding: '14px 8px' }}>
                    No watched parts match the current filter.
                  </td>
                </tr>
              )}
              {filteredSnapshotParts.map((p, idx) => {
                const fiCount = p.futureInventoryVisibility?.forecastCount || 0;
                const fiTxt = fiCount > 0 && p.futureInventoryVisibility?.nextForecastDate
                  ? `${Number(p.futureInventoryVisibility.nextForecastQuantity ?? 0).toLocaleString()} on ${p.futureInventoryVisibility.nextForecastDate}`
                  : '—';
                const qtyTxt = p.quantityAvailable == null ? '—' : Number(p.quantityAvailable).toLocaleString();
                const ol = p.orderLimit == null ? '—' : Number(p.orderLimit).toLocaleString();
                const lt = p.leadTimeWeeks == null ? '—' : `${p.leadTimeWeeks} wk`;
                const ok = p.okayToOrder == null ? '—' : p.okayToOrder ? 'yes' : 'no';
                // Phase 20D.1 — failed-now / stale classification.
                const latest = p.latestCaptureStatus ?? p.captureStatus;
                const isFailed = latest === 'failed';
                const isStale = !!p.stale;
                const lastGood = p.lastGoodFetchedAt
                  ? new Date(p.lastGoodFetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : null;
                const fetchedRaw = p.fetchedAt ? new Date(p.fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
                const fetched = isStale && lastGood ? `${lastGood} (stale)` : fetchedRaw;
                const conf = p.signals?.sourceConfidence;
                // Phase 21D.2 — when TI Store returned a price break, show
                // the normalized unit price + qty + a "TI Direct" tag so
                // the customer can see what's behind "Available" without
                // expanding the per-part history. Falls back to the prior
                // Available/Not posted/Pending labels when no break.
                const pricingTxt = (p.pricingAvailability === 'available' && p.normalizedUnitPrice != null)
                  ? (
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ color: '#e0eaf8', fontWeight: 'bold' }}>
                          {`${p.currency || 'USD'} ${Number(p.normalizedUnitPrice).toFixed(4)}`}
                        </span>
                        <span style={{ color: '#7a96b8', fontSize: '0.6rem' }}>
                          {`@ ${Number(p.normalizedPriceQty || 1).toLocaleString()}`}
                        </span>
                        <span style={{ color: '#4dffc3', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          TI Direct
                        </span>
                      </span>
                    )
                  : p.pricingAvailability === 'available' ? 'Available'
                  : p.pricingAvailability === 'unavailable' ? 'Not posted'
                  : p.pricingAvailability === 'pending_approval' ? 'Pending approval'
                  : '—';
                // When the latest capture failed and we have NO prior good
                // values, every numeric cell renders as a single "Capture
                // failed — retry" indicator anchored on the quantity column;
                // other numeric cells stay '—'. When the row is stale we
                // keep the prior values but tag the source column.
                const sourceLabel = isFailed && !isStale
                  ? <span style={{ color: '#f05c5c' }}>Capture failed — retry{p.failureStage ? ` · ${p.failureStage}` : ''}{p.httpStatus != null ? ` · HTTP ${p.httpStatus}` : ''}</span>
                  : isStale
                    ? <span style={{ color: '#f0a84e' }}>Capture failed — retry · showing last good{p.failureStage ? ` · ${p.failureStage}` : ''}</span>
                    : <span>TI Product Info + Store I&P · {fmtSignalLabel(conf)}</span>;
                const rowBg = isFailed && !isStale ? '#1a0d10' : isStale ? '#1a1408' : undefined;
                const isExpanded = expandedPart === p.partNumber;
                const histResp = isExpanded ? historyByPart[p.partNumber] : null;
                const onToggleHistory = () => {
                  if (isExpanded) { setExpandedPart(null); return; }
                  setExpandedPart(p.partNumber);
                  if (!historyByPart[p.partNumber]) fetchPartHistory(p.partNumber);
                };
                return (
                  <React.Fragment key={`snap-${p.partNumber || ''}-${idx}`}>
                  <tr style={rowBg ? { background: rowBg } : undefined}>
                    <td style={{ ...cellTD, color: '#a0b8d0' }}>{p.basket || '—'}</td>
                    <td style={cellMono}>{p.genericPartNumber || '—'}</td>
                    <td style={cellMono}>
                      <span
                        onClick={onToggleHistory}
                        style={{ cursor: 'pointer', borderBottom: '1px dotted #2c4a70' }}
                        title="Click to view inventory history"
                      >{p.partNumber || '—'}</span>
                      {isStale && <sup style={{ color: '#f0a84e', marginLeft: 4, fontSize: '0.55rem' }}>stale</sup>}
                      {isFailed && !isStale && <sup style={{ color: '#f05c5c', marginLeft: 4, fontSize: '0.55rem' }}>failed</sup>}
                    </td>
                    <td style={{ ...cellTD, maxWidth: 280 }}>{p.description || '—'}</td>
                    <td style={{ ...cellMono, color: INV_FLAG_COLOR[p.signals?.inventorySignal] || '#c4d4e8' }}>{qtyTxt}</td>
                    <td style={cellMono}>{pricingTxt}</td>
                    <td style={cellMono}>{ol}</td>
                    <td style={cellMono}>{fiTxt}</td>
                    <td style={{ ...cellMono, color: INV_FLAG_COLOR[p.signals?.leadTimeSignal] || '#c4d4e8' }}>{lt}</td>
                    <td style={cellMono}>{p.lifecycleStatus || '—'}</td>
                    <td style={cellMono}>{ok}</td>
                    <td style={{ ...cellMono, color: isStale ? '#f0a84e' : '#7a96b8', fontSize: '0.62rem' }}>{fetched}</td>
                    <td style={{ ...cellTD, color: isFailed ? '#f05c5c' : INV_FLAG_COLOR[conf] || '#7a96b8', fontSize: '0.62rem' }}>
                      {sourceLabel}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ background: '#040711' }}>
                      <td colSpan={13} style={{ padding: '10px 12px', borderBottom: '1px solid #1a2740' }}>
                        {!histResp ? (
                          <span style={{ fontSize: '0.7rem', color: '#7a96b8' }}>Loading history…</span>
                        ) : histResp.error ? (
                          <span style={{ fontSize: '0.7rem', color: '#f0a84e' }}>{histResp.error}</span>
                        ) : (histResp.rows || []).length === 0 ? (
                          <span style={{ fontSize: '0.7rem', color: '#7a96b8', fontStyle: 'italic' }}>
                            No history rows yet for {p.partNumber}. Run captures over multiple days to populate the trend.
                          </span>
                        ) : (
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <div style={{ minWidth: 260 }}>
                              <div style={tinyLabel}>30d inventory history · {histResp.rows.length} captures</div>
                              <table style={{ borderCollapse: 'collapse', marginTop: 6, fontFamily: 'monospace', fontSize: '0.66rem' }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...cellTH, fontSize: '0.55rem' }}>Captured</th>
                                    <th style={{ ...cellTH, fontSize: '0.55rem' }}>Qty</th>
                                    <th style={{ ...cellTH, fontSize: '0.55rem' }}>Lead</th>
                                    <th style={{ ...cellTH, fontSize: '0.55rem' }}>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {histResp.rows.slice(-15).reverse().map((r, hi) => (
                                    <tr key={hi}>
                                      <td style={{ ...cellTD, fontSize: '0.62rem', padding: '3px 6px' }}>
                                        {new Date(r.capturedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                      </td>
                                      <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px' }}>
                                        {r.quantityAvailable == null ? '—' : Number(r.quantityAvailable).toLocaleString()}
                                      </td>
                                      <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px' }}>
                                        {r.leadTimeWeeks == null ? '—' : `${r.leadTimeWeeks}w`}
                                      </td>
                                      <td style={{ ...cellMono, fontSize: '0.62rem', padding: '3px 6px', color: r.captureStatus === 'failed' ? '#f05c5c' : '#a0b8d0' }}>
                                        {r.captureStatus}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div style={{ minWidth: 260 }}>
                              <div style={tinyLabel}>Source</div>
                              <div style={{ fontSize: '0.7rem', color: '#a0b8d0', fontFamily: 'monospace', marginTop: 4 }}>
                                Backend: {histResp.backend}<br/>
                                Inventory: TI Store I&P API<br/>
                                Pricing: {(histResp.rows || []).some(r => r.priceAvailable) ? 'TI Store API' : 'unavailable'}
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {adhocRows.map((s, idx) => {
                const desc = s?.description || '—';
                const qtyAvail = s?.quantityAvailable;
                const qtyTxt = qtyAvail == null ? '—' : Number(qtyAvail).toLocaleString();
                const pr = s?.pricing && s.pricing.length > 0 ? s.pricing.slice().sort((a, b) => a.unitPrice - b.unitPrice)[0] : null;
                const prTxt = pr ? `${fmtPriceUSD(pr.unitPrice, pr.currency)} @ ${pr.breakQuantity}+` : '—';
                const ol = s?.orderLimit == null ? '—' : Number(s.orderLimit).toLocaleString();
                const fi = s?.futureInventory && s.futureInventory.length > 0
                  ? `${Number(s.forecastQuantity).toLocaleString()} on ${s.forecastDate}`
                  : '—';
                const lt = s?.leadTimeWeeks == null ? '—' : `${s.leadTimeWeeks} wk`;
                const lc = s?.lifecycleStatus || '—';
                const ok = s?.okayToOrder == null ? '—' : s.okayToOrder ? 'yes' : 'no';
                const fetched = s?.fetchedAt ? new Date(s.fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
                const conf = s?.signals?.sourceConfidence;
                return (
                  <tr key={`adhoc-${s?.requestedPartNumber || ''}-${idx}`}>
                    <td style={{ ...cellTD, color: '#a0b8d0', fontStyle: 'italic' }}>operator</td>
                    <td style={cellMono}>{s?.genericPartNumber || s?.requestedPartNumber || '—'}</td>
                    <td style={cellMono}>{s?.resolvedPartNumber || s?.requestedPartNumber || '—'}</td>
                    <td style={{ ...cellTD, maxWidth: 280 }}>{desc}</td>
                    <td style={{ ...cellMono, color: INV_FLAG_COLOR[s?.signals?.inventorySignal] || '#c4d4e8' }}>{qtyTxt}</td>
                    <td style={cellMono}>{prTxt}</td>
                    <td style={cellMono}>{ol}</td>
                    <td style={cellMono}>{fi}</td>
                    <td style={{ ...cellMono, color: INV_FLAG_COLOR[s?.signals?.leadTimeSignal] || '#c4d4e8' }}>{lt}</td>
                    <td style={cellMono}>{lc}</td>
                    <td style={cellMono}>{ok}</td>
                    <td style={{ ...cellMono, color: '#7a96b8', fontSize: '0.62rem' }}>{fetched}</td>
                    <td style={{ ...cellTD, color: INV_FLAG_COLOR[conf] || '#7a96b8', fontSize: '0.62rem' }}>
                      TI Product Info + Store I&P · {fmtSignalLabel(conf)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: '0.62rem', color: '#7a96b8', fontStyle: 'italic', maxWidth: 920 }}>
          Inventory and future availability are retrieved from the Texas Instruments Store Inventory & Pricing API. Future inventory is forecasted and not committed supply.
        </div>
      </div>
      </>)}

      {/* ── Operator tools (collapsed by default) — always visible across sub-tabs ── */}
      <div style={sectionWrap}>
        <button
          type="button"
          onClick={() => setOpsOpen(o => !o)}
          style={{ background: 'transparent', border: 'none', color: '#7a96b8', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 'bold', cursor: 'pointer', padding: 0 }}
        >
          {opsOpen ? '▾ Operator tools' : '▸ Operator tools'}
        </button>
        {opsOpen && (
          <div style={{ marginTop: 10, padding: 12, background: '#080c14', border: '1px solid #1a2740', borderRadius: 4 }}>
            <div style={{ fontSize: '0.66rem', color: '#7a96b8', marginBottom: 8, lineHeight: 1.5 }}>
              For TI operations only. The X-Capture-Secret never leaves this browser tab and is never persisted.
              Customers do not need to interact with these controls.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type={showSecret ? 'text' : 'password'}
                value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder="X-Capture-Secret"
                autoComplete="off"
                style={{ background: '#050810', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', borderRadius: 3, minWidth: 220 }}
              />
              <button
                type="button"
                onClick={() => setShowSecret(s => !s)}
                style={{ background: 'transparent', border: '1px solid #1a2740', color: '#7a96b8', padding: '5px 8px', fontSize: '0.66rem', borderRadius: 3, cursor: 'pointer' }}
              >{showSecret ? 'hide' : 'show'}</button>
              <button
                type="button"
                onClick={captureUniverse}
                disabled={busy || !secret.trim()}
                style={{ background: busy ? '#1a2740' : '#0f2540', border: '1px solid #2c4a70', color: '#e0eaf8', padding: '5px 12px', fontSize: '0.72rem', borderRadius: 3, cursor: busy || !secret.trim() ? 'not-allowed' : 'pointer' }}
              >{busy ? 'Capturing…' : 'Capture watched universe'}</button>
              {captureProgress && (
                <span style={{ fontSize: '0.7rem', color: '#a0b8d0', fontFamily: 'monospace' }}>
                  {captureProgress.done}/{captureProgress.total}
                  {captureProgress.totalFailed > 0 && (
                    <span style={{ color: '#f0a84e' }}> · {captureProgress.totalFailed} failed</span>
                  )}
                  {captureProgress.totalStale > 0 && (
                    <span style={{ color: '#7a96b8' }}> · {captureProgress.totalStale} stale</span>
                  )}
                </span>
              )}
              <span style={{ width: 12 }} />
              <input
                type="text"
                value={partInput}
                onChange={e => setPartInput(e.target.value)}
                placeholder="Ad-hoc OPN (e.g. INA226AIDGSR)"
                style={{ background: '#050810', border: '1px solid #1a2740', color: '#e0eaf8', padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.72rem', borderRadius: 3, minWidth: 220 }}
              />
              <button
                type="button"
                onClick={addPart}
                disabled={busy || !secret.trim() || !partInput.trim()}
                style={{ background: 'transparent', border: '1px solid #1a2740', color: '#a0b8d0', padding: '5px 12px', fontSize: '0.72rem', borderRadius: 3, cursor: busy || !secret.trim() || !partInput.trim() ? 'not-allowed' : 'pointer' }}
              >Fetch live data</button>
            </div>
            {(error || captureNote) && (
              <div style={{ marginTop: 8, fontSize: '0.7rem', color: error ? '#f05c5c' : '#4dffc3' }}>
                {error || captureNote}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Insights tab — compact, customer-facing (Phase 19B+) ─────────────────────
// Shows only what answers the customer's question: are prices moving, by how
// much, where, and any outliers. Hides empty sections. No operator chrome.
function InsightsPanel({ liveData, baselineMeta, combinedEvidence, trendMeta, tiStatus, tiRollupsByCanonical, tiTrendByCanonical }) {
  // Phase 24F — customer-focused Insights tab. The previous panel had an
  // operator/admin slant (TI Direct API token status, X-Capture-Secret-
  // gated controls, raw watched-parts table, source agreement matrix).
  // The buy-side customer asked for one thing: detect shortage vs
  // oversupply by correlating price moves with stock moves. This panel
  // is built around that question and nothing else.
  //
  // Trend semantics: stock-trend classification (shortage / oversupply /
  // mixed) requires ≥2 stored TI Direct snapshots so we can compute
  // stockDeltaPct. Until that history exists we honestly show
  // "Insufficient history" rather than fabricating a trend from a
  // single snapshot.
  const sig = useMemo(() => computeSignal(liveData), [liveData]);
  const fmtPct = v => (v == null || !Number.isFinite(v)) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const fmtN = n => (n == null ? '—' : Number(n).toLocaleString());
  const fmtPrice = n => (n == null ? '—' : `$${Number(n).toFixed(4)}`);
  const fmtDate = iso => { if (!iso) return '—'; try { return new Date(iso).toISOString().slice(0,10); } catch { return iso; } };

  const sectionWrap = { padding: '18px 16px', borderBottom: '1px solid #1a2740', background: '#050810' };
  const sectionTitle = { fontSize: '0.58rem', color: '#6b8aa8', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 10 };
  const card = { background: '#0c1426', border: '1px solid #1a2740', borderRadius: 6, padding: '14px 16px' };

  // ── Phase 26 — evidence drawer state ──────────────────────────────────
  // openId is the legacy CAT id (e.g. 'pm_ldo'); we resolve canonical via
  // combinedEvidence.legacyToCanonical to call /rollups/trend/:c/detail.
  const [openId, setOpenId] = useState(null);
  const [evidenceDetail, setEvidenceDetail] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(null);
  const openCanonical = openId ? (combinedEvidence?.legacyToCanonical?.[openId] || null) : null;
  useEffect(() => {
    if (!openCanonical) { setEvidenceDetail(null); setEvidenceError(null); return; }
    let cancelled = false;
    (async () => {
      setEvidenceLoading(true); setEvidenceError(null);
      try {
        const res = await fetch(`/api/ti/universe/catalog/rollups/trend/${encodeURIComponent(openCanonical)}/detail`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setEvidenceDetail(null);
          setEvidenceError(json?.message || `HTTP ${res.status}`);
        } else {
          setEvidenceDetail(json);
        }
      } catch (e) {
        if (!cancelled) setEvidenceError(e?.message || String(e));
      }
      if (!cancelled) setEvidenceLoading(false);
    })();
    return () => { cancelled = true; };
  }, [openCanonical]);

  // ── Per-cell trend classification ──────────────────────────────────────
  // For each visible Mouser-live category, we already have a price delta
  // (qoqPct vs latest baseline). Stock delta requires multiple TI Direct
  // snapshots — until those land we report stockDeltaPct=null and the
  // classifier defaults to insufficient_history.
  const SHORTAGE_THRESHOLDS = {
    SHORTAGE_PRICE: 2, SHORTAGE_STOCK: -20,
    EARLY_PRICE_LO: -1, EARLY_PRICE_HI: 2, EARLY_STOCK: -30,
    OVERSUPPLY_PRICE: -2, OVERSUPPLY_STOCK: 30,
    PRICING_POWER_PRICE: 2, PRICING_POWER_STOCK: 10,
    WEAK_PRICE: -2, WEAK_STOCK: -10,
  };
  function classify(priceDeltaPct, stockDeltaPct) {
    if (priceDeltaPct == null || stockDeltaPct == null) return 'insufficient_history';
    const t = SHORTAGE_THRESHOLDS;
    if (priceDeltaPct >= t.SHORTAGE_PRICE && stockDeltaPct <= t.SHORTAGE_STOCK) return 'shortage_risk';
    if (priceDeltaPct > t.EARLY_PRICE_LO && priceDeltaPct < t.EARLY_PRICE_HI && stockDeltaPct <= t.EARLY_STOCK) return 'early_shortage_watch';
    if (priceDeltaPct <= t.OVERSUPPLY_PRICE && stockDeltaPct >= t.OVERSUPPLY_STOCK) return 'oversupply_easing';
    if (priceDeltaPct >= t.PRICING_POWER_PRICE && stockDeltaPct >= t.PRICING_POWER_STOCK) return 'pricing_power_mixed';
    if (priceDeltaPct <= t.WEAK_PRICE && stockDeltaPct <= t.WEAK_STOCK) return 'weak_unclear';
    return 'stable';
  }

  // Build per-cell rows: every visible CAT mapped to its canonical
  // subcategory. Phase 25 — when a TI Direct snapshot trend is available
  // for the canonical subcategory we use the TI-only deltas (price &
  // stock) as the source of truth for shortage classification. Mouser
  // channel-tick price delta is kept as a fallback row-level signal so
  // the watch list still surfaces something pre-history. Distributor
  // data is never blended into TI Direct truth — once a TI delta is
  // present the classifier uses it exclusively.
  const cellRows = useMemo(() => {
    return CATS.map(c => {
      const live = liveData?.[c.id];
      const channelPriceDeltaPct = (live && Number.isFinite(live.qoqPct)) ? Number(live.qoqPct) : null;
      const canonical = combinedEvidence?.legacyToCanonical?.[c.id] || null;
      const tiRollup = canonical ? tiRollupsByCanonical?.[canonical] : null;
      const tiUsable = tiRollup?.usableForPricesLiveEvidence === true;
      const trend = canonical ? tiTrendByCanonical?.[canonical] : null;
      // Prefer TI-only deltas when ≥2 snapshots stored. Otherwise the
      // row is "insufficient_history" and we surface the channel price
      // tick purely so the watch list can still rank loudest movers
      // honestly (badge copy says "stock trend pending").
      const tiPriceDeltaPct = trend?.hasEnoughHistory ? (trend.priceDeltaPct ?? null) : null;
      const tiStockDeltaPct = trend?.hasEnoughHistory ? (trend.stockDeltaPct ?? null) : null;
      const priceDeltaPct = tiPriceDeltaPct != null ? tiPriceDeltaPct : channelPriceDeltaPct;
      const stockDeltaPct = tiStockDeltaPct;
      const signal = trend?.hasEnoughHistory
        ? classify(tiPriceDeltaPct, tiStockDeltaPct)
        : 'insufficient_history';
      return {
        id: c.id,
        group: c.g,
        subcategory: c.l,
        priceDeltaPct,
        stockDeltaPct,
        latestStock: tiRollup ? Number(tiRollup.totalQuantity || 0) : null,
        tiUsable,
        snapshotCount: trend?.snapshotCount ?? 0,
        trendConfidence: trend?.trendConfidence ?? 'insufficient',
        priceSourceLabel: tiPriceDeltaPct != null ? 'TI Direct' : (channelPriceDeltaPct != null ? 'Mouser channel' : null),
        signal,
      };
    });
  }, [liveData, combinedEvidence, tiRollupsByCanonical, tiTrendByCanonical]);

  // ── 1. Shortage / Oversupply readout ──────────────────────────────────
  const counts = cellRows.reduce((acc, r) => {
    if (r.signal === 'shortage_risk' || r.signal === 'early_shortage_watch') acc.shortage += 1;
    else if (r.signal === 'oversupply_easing') acc.oversupply += 1;
    else if (r.signal === 'pricing_power_mixed' || r.signal === 'weak_unclear') acc.mixed += 1;
    else if (r.signal === 'insufficient_history') acc.insufficient += 1;
    else acc.stable += 1;
    return acc;
  }, { shortage: 0, oversupply: 0, mixed: 0, stable: 0, insufficient: 0 });
  const trendHistoryReady = counts.insufficient < cellRows.length;
  // Phase 25 — confidence ladder: weekly (≥7 snapshots on the maxed-out
  // subcategory) → daily (≥2) → insufficient. Take the strongest
  // available across the canonical set so the headline reflects the
  // best signal, not the weakest.
  const maxSnapshotCount = cellRows.reduce((m, r) => Math.max(m, r.snapshotCount || 0), 0);
  const overallTrendConfidence = maxSnapshotCount >= 7 ? 'weekly' : maxSnapshotCount >= 2 ? 'daily' : 'insufficient';
  const headlineSentence = trendHistoryReady
    ? `Latest TI Direct snapshots show ${counts.shortage} shortage-risk basket${counts.shortage===1?'':'s'} and ${counts.oversupply} oversupply/easing basket${counts.oversupply===1?'':'s'} across ${cellRows.length} monitored categories.`
    : `Latest source snapshot shows ${sig?.tone ? sig.tone.toLowerCase() : 'mixed'} price action. Stock-price trend detection will start after multiple TI Direct snapshots are stored.`;

  // ── 2. Price + Stock Matrix (educational) ──────────────────────────────
  const matrixCells = [
    { row: 'Price rising',  col: 'Stock falling', label: 'Shortage risk',         color: '#ff7575', accent: '#3a1010' },
    { row: 'Price rising',  col: 'Stock rising',  label: 'Pricing power / mixed', color: '#f0a84e', accent: '#2a1f00' },
    { row: 'Price falling', col: 'Stock falling', label: 'Weak / unclear',        color: '#7a96b8', accent: '#0d1422' },
    { row: 'Price falling', col: 'Stock rising',  label: 'Oversupply / easing',   color: '#4dffc3', accent: '#0a1a14' },
  ];

  // ── 3. Most Important Baskets to Watch ─────────────────────────────────
  // Until stock-trend history exists, "most important" reduces to the
  // sharpest absolute price moves (which is what computeSignal already
  // surfaces). Cap at 5 rows per spec.
  const top5 = useMemo(() => {
    return cellRows
      .filter(r => r.priceDeltaPct != null)
      .sort((a, b) => Math.abs(b.priceDeltaPct) - Math.abs(a.priceDeltaPct))
      .slice(0, 5);
  }, [cellRows]);
  function whyItMatters(r) {
    if (r.signal === 'insufficient_history') {
      const dirText = r.priceDeltaPct >= 2 ? 'price up strongly'
                    : r.priceDeltaPct <= -2 ? 'price lower'
                    : 'price roughly flat';
      return `${r.subcategory}: ${dirText}; stock trend pending — watch for shortage/oversupply confirmation after the next TI Direct snapshot.`;
    }
    // Phase 25 — snapshot-backed rows quote the actual TI deltas so the
    // copy is auditable. fmtPct already adds the sign.
    const pStr = fmtPct(r.priceDeltaPct);
    const sStr = fmtPct(r.stockDeltaPct);
    if (r.signal === 'shortage_risk') return `${r.subcategory}: TI price ${pStr} while TI stock ${sStr} — clean shortage signal.`;
    if (r.signal === 'early_shortage_watch') return `${r.subcategory}: TI stock ${sStr} with prices still ${pStr} — early shortage watch.`;
    if (r.signal === 'oversupply_easing') return `${r.subcategory}: TI price ${pStr} while TI stock ${sStr} — supply unwinding.`;
    if (r.signal === 'pricing_power_mixed') return `${r.subcategory}: TI price ${pStr} and TI stock ${sStr} both rising — pricing power, demand absorbing supply.`;
    if (r.signal === 'weak_unclear') return `${r.subcategory}: TI price ${pStr} and TI stock ${sStr} both weak — demand softening.`;
    return `${r.subcategory}: stable (TI price ${pStr} · TI stock ${sStr}).`;
  }
  function signalBadge(s) {
    switch (s) {
      case 'shortage_risk':         return { label: 'Shortage risk',         color: '#ff7575' };
      case 'early_shortage_watch':  return { label: 'Early shortage watch',  color: '#f0a84e' };
      case 'oversupply_easing':     return { label: 'Oversupply / easing',   color: '#4dffc3' };
      case 'pricing_power_mixed':   return { label: 'Pricing power / mixed', color: '#f0a84e' };
      case 'weak_unclear':          return { label: 'Weak / unclear',        color: '#7a96b8' };
      case 'stable':                return { label: 'Stable',                color: '#7a96b8' };
      default:                      return { label: 'Insufficient history', color: '#7a96b8' };
    }
  }

  // ── 4. Data Center Power watch ─────────────────────────────────────────
  const dcpRows = cellRows.filter(r => r.group === 'Data Center Power' && r.priceDeltaPct != null);
  const dcpAvg = dcpRows.length > 0 ? dcpRows.reduce((s, r) => s + r.priceDeltaPct, 0) / dcpRows.length : null;
  const dcpTop = dcpRows.slice().sort((a, b) => Math.abs(b.priceDeltaPct) - Math.abs(a.priceDeltaPct))[0] || null;

  // ── Loading guards ─────────────────────────────────────────────────────
  if (sig.state === 'waiting') {
    return <div style={sectionWrap}><div style={{ fontSize: '0.8rem', color: '#7a96b8' }}>Loading live prices…</div></div>;
  }
  if (sig.state === 'no-live') {
    return <div style={sectionWrap}><div style={{ fontSize: '0.8rem', color: '#f0a84e' }}>Live prices unavailable. Try Refresh on the Prices tab.</div></div>;
  }

  return (
    <>
      {/* ── 1. Shortage / Oversupply Readout ──────────────────────── */}
      <div style={sectionWrap}>
        <div style={sectionTitle}>Shortage / Oversupply Readout</div>
        <div style={{ ...card, marginBottom: 10 }}>
          <div style={{ fontSize: '0.95rem', color: '#e0eaf8', lineHeight: 1.45, marginBottom: 10 }}>
            {headlineSentence}
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontFamily: 'monospace', fontSize: '0.75rem' }}>
            <div><span style={{ color: '#ff7575', fontWeight: 'bold' }}>{counts.shortage}</span> <span style={{ color: '#7a96b8' }}>shortage-risk</span></div>
            <div><span style={{ color: '#4dffc3', fontWeight: 'bold' }}>{counts.oversupply}</span> <span style={{ color: '#7a96b8' }}>oversupply / easing</span></div>
            <div><span style={{ color: '#f0a84e', fontWeight: 'bold' }}>{counts.mixed}</span> <span style={{ color: '#7a96b8' }}>mixed / unclear</span></div>
            <div><span style={{ color: '#7a96b8', fontWeight: 'bold' }}>{counts.insufficient}</span> <span style={{ color: '#7a96b8' }}>insufficient history</span></div>
            <div><span style={{ color: '#c4d4e8', fontWeight: 'bold' }}>{cellRows.length}</span> <span style={{ color: '#7a96b8' }}>monitored categories</span></div>
          </div>
        </div>
      </div>

      {/* ── 2. Price + Stock Matrix ─────────────────────────────────── */}
      <div style={sectionWrap}>
        <div style={sectionTitle}>Price + Stock Matrix</div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 0, fontSize: '0.74rem', maxWidth: 720 }}>
          <div></div>
          <div style={{ padding: '6px 10px', textAlign: 'center', color: '#7a96b8', fontWeight: 'bold', borderBottom: '1px solid #1a2740' }}>Stock falling</div>
          <div style={{ padding: '6px 10px', textAlign: 'center', color: '#7a96b8', fontWeight: 'bold', borderBottom: '1px solid #1a2740' }}>Stock rising</div>
          {['Price rising', 'Price falling'].map(rowLabel => (
            <React.Fragment key={rowLabel}>
              <div style={{ padding: '14px 10px', color: '#7a96b8', fontWeight: 'bold', display: 'flex', alignItems: 'center', borderRight: '1px solid #1a2740' }}>{rowLabel}</div>
              {['Stock falling', 'Stock rising'].map(colLabel => {
                const cell = matrixCells.find(c => c.row === rowLabel && c.col === colLabel);
                return (
                  <div key={colLabel} style={{ background: cell.accent, border: '1px solid #1a2740', padding: '14px 10px', textAlign: 'center', color: cell.color, fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {cell.label}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: '0.66rem', color: '#7a96b8', fontStyle: 'italic', maxWidth: 720 }}>
          Read the matrix to interpret each subcategory&rsquo;s shortage / oversupply state once stock trend data is available.
        </div>
      </div>

      {/* ── 3. Most Important Baskets to Watch ──────────────────────── */}
      <div style={sectionWrap}>
        <div style={sectionTitle}>Most Important Baskets to Watch</div>
        <div style={{ background: '#0c1426', border: '1px solid #1a2740', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            <thead>
              <tr style={{ background: '#080c14' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#7a96b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', borderBottom: '1px solid #1a2740' }}>Basket</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', color: '#7a96b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', borderBottom: '1px solid #1a2740' }}>Price move</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', color: '#7a96b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', borderBottom: '1px solid #1a2740' }}>Stock move</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#7a96b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', borderBottom: '1px solid #1a2740' }}>Signal</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#7a96b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', borderBottom: '1px solid #1a2740' }}>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {top5.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '14px 12px', color: '#7a96b8', textAlign: 'center' }}>No live price moves yet.</td></tr>
              )}
              {top5.map(r => {
                const badge = signalBadge(r.signal);
                const priceColor = r.priceDeltaPct >= 0 ? '#00c9a7' : '#f05c5c';
                const isOpen = openId === r.id;
                return (
                  <tr key={r.id}
                      onClick={() => setOpenId(isOpen ? null : r.id)}
                      style={{ borderBottom: '1px solid #0d1520', cursor: 'pointer', background: isOpen ? '#0c1426' : 'transparent' }}>
                    <td style={{ padding: '8px 12px', color: '#e0eaf8' }}>
                      <span style={{ color: '#3d8ef0', marginRight: 6, fontFamily: 'monospace', fontSize: '0.7rem' }}>{isOpen ? '▼' : '▶'}</span>
                      {r.subcategory}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: priceColor, fontWeight: Math.abs(r.priceDeltaPct) >= 5 ? 'bold' : 'normal' }}>{fmtPct(r.priceDeltaPct)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: r.stockDeltaPct == null ? '#7a96b8' : (r.stockDeltaPct >= 0 ? '#4dffc3' : '#ff7575'), fontWeight: r.stockDeltaPct != null && Math.abs(r.stockDeltaPct) >= 10 ? 'bold' : 'normal' }}>{r.stockDeltaPct == null ? 'pending' : fmtPct(r.stockDeltaPct)}</td>
                    <td style={{ padding: '8px 12px', color: badge.color }}>{badge.label}</td>
                    <td style={{ padding: '8px 12px', color: '#a0b8d0' }}>{whyItMatters(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Phase 26 — evidence drawer. Shown beneath the watch table when
            a row is clicked. Resolves the legacy id to its canonical
            subcategory and fetches /rollups/trend/:c/detail. Each section
            stays compact: basket summary · why-flagged sentence · top
            OPNs context (with honest note that per-OPN history isn't
            stored yet). */}
        {openId && (() => {
          const watchRow = top5.find(r => r.id === openId);
          if (!watchRow) return null;
          const detail = evidenceDetail;
          const badge = signalBadge(watchRow.signal);
          const reason = (() => {
            const p = detail?.priceDeltaPct ?? watchRow.priceDeltaPct;
            const s = detail?.stockDeltaPct ?? watchRow.stockDeltaPct;
            const sigKey = detail?.signal ?? watchRow.signal;
            const fmtAbs = v => (v == null ? '—' : `${Math.abs(v).toFixed(1)}%`);
            switch (sigKey) {
              case 'shortage_risk':
                return `TI price rose by ${fmtAbs(p)} while TI stock fell by ${fmtAbs(s)}, which suggests tightening supply.`;
              case 'early_shortage_watch':
                return `TI stock fell sharply by ${fmtAbs(s)} while price stayed near flat at ${fmtPct(p)} — early shortage watch.`;
              case 'oversupply_easing':
                return `TI price fell by ${fmtAbs(p)} while TI stock rose by ${fmtAbs(s)}, which suggests supply is easing.`;
              case 'pricing_power_mixed':
                return 'Both TI price and stock rose; this may indicate demand is absorbing supply.';
              case 'weak_unclear':
                return 'Both TI price and stock fell; this may reflect weaker demand or part-specific cleanup.';
              case 'stable':
                return `TI price moved ${fmtPct(p)} and TI stock moved ${fmtPct(s)} — within stable thresholds.`;
              default:
                return 'Needs at least 2 TI Direct snapshots before trend can be confirmed.';
            }
          })();
          return (
            <div style={{ ...card, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Evidence · {watchRow.subcategory} <span style={{ color: badge.color, marginLeft: 6 }}>{badge.label}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setOpenId(null); }} style={{ background: 'none', border: '1px solid #1a2740', color: '#7a96b8', cursor: 'pointer', fontFamily: 'monospace', padding: '3px 8px', fontSize: '0.6rem', borderRadius: 4 }}>close</button>
              </div>
              {evidenceLoading && <div style={{ color: '#7a96b8', fontSize: '0.7rem' }}>Loading evidence…</div>}
              {evidenceError && <div style={{ color: '#ffb0b0', fontSize: '0.7rem' }}>Detail unavailable: {evidenceError}</div>}
              {detail && (
                <>
                  {/* 1. Basket summary */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, fontSize: '0.7rem', fontFamily: 'monospace', marginBottom: 10 }}>
                    <div><span style={{ color: '#7a96b8' }}>Basket: </span><span style={{ color: '#e0eaf8' }}>{detail.canonicalGroup ? `${detail.canonicalGroup} / ` : ''}{detail.canonicalSubcategory}</span></div>
                    <div><span style={{ color: '#7a96b8' }}>Latest snapshot: </span>{fmtDate(detail.latestSnapshotAt)}</div>
                    <div><span style={{ color: '#7a96b8' }}>Previous snapshot: </span>{fmtDate(detail.previousSnapshotAt)}</div>
                    <div><span style={{ color: '#7a96b8' }}>TI price move: </span><span style={{ color: detail.priceDeltaPct == null ? '#7a96b8' : (detail.priceDeltaPct >= 0 ? '#00c9a7' : '#f05c5c'), fontWeight: 'bold' }}>{fmtPct(detail.priceDeltaPct)}</span></div>
                    <div><span style={{ color: '#7a96b8' }}>TI stock move: </span><span style={{ color: detail.stockDeltaPct == null ? '#7a96b8' : (detail.stockDeltaPct >= 0 ? '#4dffc3' : '#ff7575'), fontWeight: 'bold' }}>{detail.stockDeltaPct == null ? 'pending' : fmtPct(detail.stockDeltaPct)}</span></div>
                    <div><span style={{ color: '#7a96b8' }}>Snapshots stored: </span>{detail.snapshotCount}</div>
                    <div><span style={{ color: '#7a96b8' }}>Trend confidence: </span><span style={{ color: detail.trendConfidence === 'weekly' ? '#4dffc3' : detail.trendConfidence === 'daily' ? '#00c9a7' : '#7a96b8' }}>{detail.trendConfidence}</span></div>
                  </div>
                  {/* tiny 2-point sparkline-as-text — keeps it honest, no chart lib */}
                  {detail.previousPrice != null && detail.latestPrice != null && (
                    <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: '#7a96b8', marginBottom: 10 }}>
                      Price: {fmtPrice(detail.previousPrice)} → {fmtPrice(detail.latestPrice)}
                      {' · '}
                      Stock: {fmtN(detail.previousStock)} → {fmtN(detail.latestStock)}
                    </div>
                  )}

                  {/* 2. Why this was flagged */}
                  <div style={{ background: '#080c14', border: '1px solid #1a2740', borderRadius: 4, padding: '10px 12px', marginBottom: 10, fontSize: '0.74rem', color: '#c4d4e8', lineHeight: 1.5 }}>
                    <span style={{ color: '#7a96b8', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', marginRight: 6 }}>Why flagged</span>
                    {reason}
                  </div>

                  {/* 3. Part-level evidence — honestly unavailable today */}
                  <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Top OPNs in this basket {detail.contributors?.length > 0 ? `(${detail.contributors.length}, latest snapshot)` : ''}
                  </div>
                  {detail.partLevelHistoryAvailable === false && (
                    <div style={{ fontSize: '0.65rem', color: '#7a96b8', fontStyle: 'italic', marginBottom: 8 }}>
                      Part-level history is not yet stored. Current signal is based on TI Direct subcategory rollup history.
                    </div>
                  )}
                  {Array.isArray(detail.contributors) && detail.contributors.length > 0 ? (
                    <div style={{ background: '#080c14', border: '1px solid #1a2740', borderRadius: 4, overflow: 'auto', maxHeight: 240 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem', fontFamily: 'monospace' }}>
                        <thead>
                          <tr style={{ background: '#0c1426' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left',  color: '#7a96b8', borderBottom: '1px solid #1a2740' }}>OPN</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left',  color: '#7a96b8', borderBottom: '1px solid #1a2740' }}>GPN</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: '#7a96b8', borderBottom: '1px solid #1a2740' }}>Latest qty</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: '#7a96b8', borderBottom: '1px solid #1a2740' }}>Latest price</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left',  color: '#7a96b8', borderBottom: '1px solid #1a2740' }}>Lifecycle</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left',  color: '#7a96b8', borderBottom: '1px solid #1a2740' }}>Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.contributors.map(c => (
                            <tr key={c.tiPartNumber} style={{ borderBottom: '1px solid #0d1520' }}>
                              <td style={{ padding: '6px 10px', color: '#e0eaf8' }}>{c.tiPartNumber}</td>
                              <td style={{ padding: '6px 10px', color: '#7a96b8' }}>{c.genericPartNumber || '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', color: c.latestQuantity > 0 ? '#4dffc3' : '#f0a84e' }}>{fmtN(c.latestQuantity)}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtPrice(c.latestNormalizedUnitPrice)}</td>
                              <td style={{ padding: '6px 10px', color: '#a0b8d0' }}>{c.lifeCycle || '—'}</td>
                              <td style={{ padding: '6px 10px', color: '#7a96b8' }}>{c.source}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.65rem', color: '#7a96b8', fontStyle: 'italic' }}>No OPNs are mapped to this canonical subcategory yet.</div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── 4. Data Center Power Watch ──────────────────────────────── */}
      {(() => {
        // Phase 25 — surface real avg stock move when ≥1 DCP subcategory
        // has stock-delta data; otherwise keep "pending".
        const dcpStockRows = dcpRows.filter(r => r.stockDeltaPct != null);
        const dcpStockAvg = dcpStockRows.length > 0
          ? dcpStockRows.reduce((s, r) => s + r.stockDeltaPct, 0) / dcpStockRows.length
          : null;
        return (
          <div style={sectionWrap}>
            <div style={sectionTitle}>Data Center Power Watch</div>
            <div style={card}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '0.74rem', fontFamily: 'monospace', marginBottom: 8 }}>
                <div><span style={{ color: '#7a96b8' }}>Average price move: </span><span style={{ color: dcpAvg != null && dcpAvg >= 0 ? '#00c9a7' : '#f05c5c', fontWeight: 'bold' }}>{fmtPct(dcpAvg)}</span></div>
                <div><span style={{ color: '#7a96b8' }}>Average stock move: </span><span style={{ color: dcpStockAvg == null ? '#7a96b8' : (dcpStockAvg >= 0 ? '#4dffc3' : '#ff7575'), fontWeight: dcpStockAvg != null ? 'bold' : 'normal' }}>{dcpStockAvg == null ? 'pending' : fmtPct(dcpStockAvg)}</span></div>
                <div><span style={{ color: '#7a96b8' }}>Top affected: </span><span style={{ color: '#e0eaf8' }}>{dcpTop ? dcpTop.subcategory : '—'}</span></div>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#c4d4e8', lineHeight: 1.5 }}>
                {dcpRows.length === 0
                  ? 'No live Data Center Power data yet — waiting for Mouser channel tick.'
                  : dcpStockAvg != null && dcpTop
                    ? `Data Center Power is showing a ${fmtPct(dcpAvg)} average price move and ${fmtPct(dcpStockAvg)} average stock move, led by ${dcpTop.subcategory} (price ${fmtPct(dcpTop.priceDeltaPct)}${dcpTop.stockDeltaPct != null ? ` · stock ${fmtPct(dcpTop.stockDeltaPct)}` : ''}).`
                    : dcpAvg != null && dcpAvg >= 0.5 && dcpTop
                      ? `Data Center Power is showing a ${fmtPct(dcpAvg)} average price move, led by ${dcpTop.subcategory} at ${fmtPct(dcpTop.priceDeltaPct)}. Stock-trend confirmation requires another TI Direct snapshot.`
                      : `Data Center Power price action is muted (${fmtPct(dcpAvg)} avg). Stock-trend confirmation requires another TI Direct snapshot.`}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 5. Source Confidence ────────────────────────────────────── */}
      <div style={sectionWrap}>
        <div style={sectionTitle}>Source Confidence</div>
        <div style={{ fontSize: '0.74rem', color: '#c4d4e8', lineHeight: 1.55, maxWidth: 760 }}>
          Primary source: <span style={{ color: '#4dffc3', fontWeight: 'bold' }}>TI Direct full catalog</span>. Distributor APIs are used only for channel corroboration or fallback. Trend conclusions require multiple stored TI Direct snapshots.
        </div>
      </div>

      {/* ── Slim footer ────────────────────────────────────────────── */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #0d1520', background: '#050810', fontSize: '0.62rem', color: '#7a96b8', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span>Baseline: {baselineMeta?.baselinePeriodLabel || 'Q1-26 close'} captured {baselineMeta?.baselineDate || '2026-04-28'}</span>
        <span>Stock trend status: <span style={{ color: overallTrendConfidence === 'weekly' ? '#4dffc3' : overallTrendConfidence === 'daily' ? '#00c9a7' : '#7a96b8' }}>{overallTrendConfidence === 'weekly' ? `weekly confidence (${maxSnapshotCount} snapshots stored)` : overallTrendConfidence === 'daily' ? `daily confidence (${maxSnapshotCount} snapshots stored)` : 'pending — needs ≥2 TI Direct snapshots'}</span></span>
      </div>
    </>
  );
}

// ── Phase 24B — TI Universe (Full Catalog) panel ────────────────────────────
// Customer-facing browser over the Phase 24A read-only D1 endpoints.
// Never calls TI directly. Never mutates anything. Hides itself behind the
// new "Universe" tab so the existing 64-part Inventory dashboard, Mouser,
// and Nexar flows keep their current shape unchanged.
function UniversePanel({ initialFilter, onClearFilter }) {
  const [overview, setOverview]                  = useState(null);
  const [overviewError, setOverviewError]        = useState(null);
  const [sort, setSort]                          = useState('inventory_desc');
  const [leaderboard, setLeaderboard]            = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [searchQ, setSearchQ]                    = useState('');
  const [searchResults, setSearchResults]        = useState([]);
  const [searchLoading, setSearchLoading]        = useState(false);
  const [searchNote, setSearchNote]              = useState(null);
  const [selectedPart, setSelectedPart]          = useState(null);
  const [selectedFamily, setSelectedFamily]      = useState(null);
  const [drillLoading, setDrillLoading]          = useState(false);
  const [drillError, setDrillError]              = useState(null);
  // Phase 24D — subcategory filter that's set whenever the user
  // clicks a Prices Live cell with a TI rollup. Drives the
  // "Filtered by Prices cell" banner + the rollup-detail panel
  // (rollup summary, GPN families table, OPN rows table).
  const [filter, setFilter]                      = useState(initialFilter || null);
  const [detail, setDetail]                      = useState(null);
  const [detailLoading, setDetailLoading]        = useState(false);
  const [detailError, setDetailError]            = useState(null);
  // When the parent App swaps in a new filter (e.g. user clicks a
  // different Prices cell), mirror it locally and re-fetch detail.
  useEffect(() => { setFilter(initialFilter || null); }, [initialFilter?.canonicalSubcategory]);
  useEffect(() => {
    if (!filter?.canonicalSubcategory) {
      setDetail(null); setDetailError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch(`/api/ti/universe/catalog/rollups/detail?subcategory=${encodeURIComponent(filter.canonicalSubcategory)}&gpnLimit=50&opnLimit=100`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setDetail(null);
          setDetailError(json?.message || `HTTP ${res.status}`);
        } else {
          setDetail(json);
        }
      } catch (e) {
        if (!cancelled) setDetailError(e?.message || String(e));
      }
      if (!cancelled) setDetailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [filter?.canonicalSubcategory]);
  const clearFilter = useCallback(() => {
    setFilter(null);
    setDetail(null);
    setDetailError(null);
    if (typeof onClearFilter === 'function') onClearFilter();
  }, [onClearFilter]);
  // Phase 24B.1 — second-by-second tick for the locked-refresh card so the
  // countdown stays accurate without refetching /overview every second.
  // Only ticks while the cooldown window is active; the effect tears the
  // interval down once safeToRun flips back to true.
  const [tickNow, setTickNow]                    = useState(() => Date.now());

  // ── Fetchers ────────────────────────────────────────────────────────────
  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/ti/universe/catalog/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setOverview(json);
      setOverviewError(null);
    } catch (e) {
      setOverviewError(e?.message || String(e));
    }
  }, []);

  const fetchLeaderboard = useCallback(async (s) => {
    setLeaderboardLoading(true);
    try {
      const res = await fetch(`/api/ti/universe/catalog/gpn-leaderboard?sort=${encodeURIComponent(s)}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLeaderboard(Array.isArray(json?.rows) ? json.rows : []);
    } catch {
      setLeaderboard([]);
    }
    setLeaderboardLoading(false);
  }, []);

  const runSearch = useCallback(async (q) => {
    const trimmed = (q || '').trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchNote(trimmed.length === 0 ? null : 'Type at least 2 characters');
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/ti/universe/catalog/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json?.rows) ? json.rows : [];
      setSearchResults(rows);
      setSearchNote(json?.note ?? (rows.length === 0 ? 'No matches' : null));
    } catch (e) {
      setSearchResults([]);
      setSearchNote(`Search failed: ${e?.message || e}`);
    }
    setSearchLoading(false);
  }, []);

  const openPart = useCallback(async (opn) => {
    if (!opn) return;
    setSelectedFamily(null);
    setDrillLoading(true);
    setDrillError(null);
    try {
      const res = await fetch(`/api/ti/universe/catalog/part/${encodeURIComponent(opn)}`);
      const json = await res.json();
      if (!res.ok) {
        setSelectedPart(null);
        setDrillError(json?.message || `HTTP ${res.status}`);
      } else {
        setSelectedPart(json?.part || null);
      }
    } catch (e) {
      setDrillError(e?.message || String(e));
    }
    setDrillLoading(false);
  }, []);

  const openFamily = useCallback(async (gpn) => {
    if (!gpn) return;
    setSelectedPart(null);
    setDrillLoading(true);
    setDrillError(null);
    try {
      const res = await fetch(`/api/ti/universe/catalog/family/${encodeURIComponent(gpn)}`);
      const json = await res.json();
      if (!res.ok) {
        setSelectedFamily(null);
        setDrillError(json?.message || `HTTP ${res.status}`);
      } else {
        setSelectedFamily(json || null);
      }
    } catch (e) {
      setDrillError(e?.message || String(e));
    }
    setDrillLoading(false);
  }, []);

  // ── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { fetchLeaderboard(sort); }, [sort, fetchLeaderboard]);
  // Debounced search-on-type. 300ms is comfortably below "feels laggy" but
  // far enough above keystroke speed that we don't burst the Worker.
  useEffect(() => {
    const handle = setTimeout(() => runSearch(searchQ), 300);
    return () => clearTimeout(handle);
  }, [searchQ, runSearch]);

  // Phase 24B.1 — tick once a second WHILE the catalog is in cooldown so the
  // locked-refresh banner counts down live. Once the cooldown clears, refetch
  // /overview once and stop ticking until the next cooldown begins.
  const nextSafeAtMs = overview?.nextSafeCatalogRunAt ? new Date(overview.nextSafeCatalogRunAt).getTime() : 0;
  const refreshLocked = nextSafeAtMs > tickNow;
  useEffect(() => {
    if (!refreshLocked) return undefined;
    const handle = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [refreshLocked]);
  useEffect(() => {
    // Cooldown just cleared — pull fresh /overview so the new safe state is
    // reflected (lastSuccessfulFetchAt etc. won't move without a real run,
    // but the lock visual flips immediately).
    if (!nextSafeAtMs) return;
    if (tickNow >= nextSafeAtMs) fetchOverview();
  }, [nextSafeAtMs, tickNow, fetchOverview]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString());
  const fmtPrice = (n) => (n == null ? '—' : `$${Number(n).toFixed(4)}`);
  const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(2)}%`);
  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return iso; }
  };
  const fmtLifecycle = (obj) => {
    if (!obj || typeof obj !== 'object') return '—';
    const entries = Object.entries(obj);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}:${v}`).join(' · ');
  };

  // ── Card grid ───────────────────────────────────────────────────────────
  // Phase 24B.1 — "Next safe refresh" no longer lives in the card grid; it
  // gets its own banner above with a live countdown so the locked state is
  // unambiguous.
  const cards = overview ? [
    { label: 'Total OPNs',        value: fmtN(overview.opnCount) },
    { label: 'GPN families',      value: fmtN(overview.gpnCount) },
    { label: 'Priced OPNs',       value: fmtN(overview.pricedOpnCount) },
    { label: 'In stock',          value: `${fmtN(overview.inStockOpnCount)} (${fmtPct(overview.inStockPct)})`, accent: '#4dffc3' },
    { label: 'Out of stock',      value: `${fmtN(overview.outOfStockOpnCount)} (${fmtPct(overview.outOfStockPct)})`, accent: '#f0a84e' },
    { label: 'Total quantity',    value: fmtN(overview.totalQuantity) },
    { label: 'Median price',      value: fmtPrice(overview.medianNormalizedUnitPrice) },
    { label: 'Min / Max price',   value: `${fmtPrice(overview.minNormalizedUnitPrice)} / ${fmtPrice(overview.maxNormalizedUnitPrice)}` },
    { label: 'Latest capture',    value: fmtDate(overview.latestCapturedAt) },
  ] : [];

  // Phase 24B.1 — live countdown formatter. Always shows mm:ss; prefixes
  // hours when the cooldown is ≥ 1 hour. Returns 'now' when ms <= 0.
  const fmtCountdown = (ms) => {
    if (ms <= 0) return 'now';
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
  };
  const refreshRemainingMs = Math.max(0, nextSafeAtMs - tickNow);

  const SORT_OPTIONS = [
    { id: 'inventory_desc', label: 'Total inventory ↓' },
    { id: 'variants_desc',  label: 'Variant count ↓' },
    { id: 'price_asc',      label: 'Min price ↑' },
    { id: 'max_price_desc', label: 'Max price ↓' },
    { id: 'out_of_stock',   label: 'Out of stock ↓' },
  ];

  const B = '#1a2740';
  const cellPad = { padding: '6px 10px', borderBottom: `1px solid ${B}`, fontFamily: 'monospace' };
  const headPad = { ...cellPad, color: '#7a96b8', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', position: 'sticky', top: 0, background: '#080c14' };

  return (
    <div style={{ padding: '14px 16px', color: '#c4d4e8', fontFamily: 'monospace', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.85rem', color: '#e0eaf8', fontWeight: 'bold', letterSpacing: '-0.01em' }}>TI Universe — full catalog</div>
        <div style={{ fontSize: '0.62rem', color: '#7a96b8', marginTop: 3 }}>
          Read-only browser over the latest TI catalog snapshot in D1. Never calls TI; never mutates anything.
        </div>
      </div>

      {overviewError && (
        <div style={{ background: '#2a1010', border: '1px solid #5a2020', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: '0.65rem', color: '#ffb0b0' }}>
          Overview unavailable: {overviewError}
        </div>
      )}

      {/* Phase 24D — filter banner + detail panel. Shown only when the
          user arrived from a Prices Live cell click. The regular cards
          / search / leaderboard remain rendered below so the operator
          can drop the filter and continue exploring. */}
      {filter && (() => {
        const ql = filter.qualityLabel || 'unknown';
        const banner = ql === 'high'   ? { bg:'#0a1a14', bd:'#1f4a36', fg:'#4dffc3', icon:'✅' }
                     : ql === 'medium' ? { bg:'#0a1a14', bd:'#1f4a36', fg:'#00c9a7', icon:'✅' }
                     : ql === 'low'    ? { bg:'#1a1000', bd:'#5a3a00', fg:'#f0a84e', icon:'⚠' }
                     : ql === 'mixed'  ? { bg:'#1a1000', bd:'#5a3a00', fg:'#f0a84e', icon:'⚠' }
                     :                   { bg:'#0c1426', bd:'#1a2740', fg:'#7a96b8', icon:'·' };
        const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString());
        const fmtPrice = (n) => (n == null ? '—' : `$${Number(n).toFixed(4)}`);
        const fmtDate = (iso) => { if (!iso) return '—'; try { return new Date(iso).toISOString().slice(0,10); } catch { return iso; } };
        const fmtLifecycle = (obj) => {
          if (!obj || typeof obj !== 'object') return '—';
          const entries = Object.entries(obj);
          if (entries.length === 0) return '—';
          return entries.map(([k, v]) => `${k}:${v}`).join(' · ');
        };
        const r = detail?.rollup;
        const cellPad = { padding: '6px 10px', borderBottom: '1px solid #1a2740', fontFamily: 'monospace' };
        const headPad = { ...cellPad, color: '#7a96b8', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.55rem', position: 'sticky', top: 0, background: '#080c14' };
        return (
          <>
            <div style={{ background: banner.bg, border: `1px solid ${banner.bd}`, borderRadius: 6, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.7rem' }}>
              <span style={{ fontSize: '1.05rem' }} aria-hidden>{banner.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: banner.fg, fontWeight: 'bold', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.6rem', marginBottom: 2 }}>
                  Filtered by Prices cell
                </div>
                <div style={{ color: '#c4d4e8' }}>
                  Viewing TI Direct evidence for{' '}
                  <span style={{ color: '#e0eaf8', fontWeight: 'bold' }}>{filter.displayLabel || filter.canonicalSubcategory}</span>{' '}
                  <span style={{ color: '#7a96b8' }}>· quality </span>
                  <span style={{ color: banner.fg, fontWeight: 'bold' }}>{ql}</span>
                </div>
                {ql === 'low' || ql === 'mixed' ? (
                  <div style={{ color: banner.fg, fontStyle: 'italic', marginTop: 3, fontSize: '0.62rem' }}>
                    This rollup is exploratory. Use as context, not signal.
                  </div>
                ) : null}
              </div>
              <button onClick={clearFilter} style={{ background: 'none', border: `1px solid ${banner.bd}`, color: banner.fg, cursor: 'pointer', fontFamily: 'monospace', padding: '4px 10px', fontSize: '0.6rem', borderRadius: 4 }}>
                clear filter
              </button>
            </div>

            {detailLoading && (
              <div style={{ padding: 12, color: '#7a96b8', fontSize: '0.65rem' }}>Loading subcategory detail…</div>
            )}
            {detailError && (
              <div style={{ background: '#2a1010', border: '1px solid #5a2020', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: '0.65rem', color: '#ffb0b0' }}>
                Detail unavailable: {detailError}
              </div>
            )}

            {r && (
              <div style={{ background: '#0c1426', border: '1px solid #1a2740', borderRadius: 6, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Rollup summary · {r.canonicalGroup} · {r.canonicalSubcategory}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, fontSize: '0.62rem', lineHeight: 1.55 }}>
                  <div><span style={{ color: '#7a96b8' }}>OPNs: </span>{fmtN(r.opnCount)}</div>
                  <div><span style={{ color: '#7a96b8' }}>GPNs: </span>{fmtN(r.gpnCount)}</div>
                  <div><span style={{ color: '#7a96b8' }}>Stocked: </span><span style={{ color: '#4dffc3' }}>{fmtN(r.stockedOpnCount)}</span> ({r.stockedPct == null ? '—' : `${r.stockedPct}%`})</div>
                  <div><span style={{ color: '#7a96b8' }}>Out of stock: </span><span style={{ color: '#f0a84e' }}>{fmtN(r.outOfStockOpnCount)}</span></div>
                  <div><span style={{ color: '#7a96b8' }}>Total qty: </span>{fmtN(r.totalQuantity)}</div>
                  <div><span style={{ color: '#7a96b8' }}>Median price: </span>{fmtPrice(r.medianNormalizedUnitPrice)}</div>
                  <div><span style={{ color: '#7a96b8' }}>Min / Max: </span>{fmtPrice(r.minNormalizedUnitPrice)} / {fmtPrice(r.maxNormalizedUnitPrice)}</div>
                  <div><span style={{ color: '#7a96b8' }}>Cheapest OPN: </span>{r.cheapestOpn ? <button onClick={() => openPart(r.cheapestOpn)} style={{ background:'none', border:'none', color:'#3d8ef0', cursor:'pointer', fontFamily:'monospace', padding:0, fontWeight:'bold' }}>{r.cheapestOpn}</button> : '—'}</div>
                  <div><span style={{ color: '#7a96b8' }}>Highest-inv OPN: </span>{r.highestInventoryOpn ? <button onClick={() => openPart(r.highestInventoryOpn)} style={{ background:'none', border:'none', color:'#3d8ef0', cursor:'pointer', fontFamily:'monospace', padding:0, fontWeight:'bold' }}>{r.highestInventoryOpn}</button> : '—'}</div>
                  <div><span style={{ color: '#7a96b8' }}>Quality: </span><span style={{ color: banner.fg, fontWeight:'bold' }}>{r.qualityLabel}</span> ({r.highConfidencePct}% high-conf)</div>
                  <div><span style={{ color: '#7a96b8' }}>Snapshot: </span>{fmtDate(r.latestCapturedAt)}</div>
                </div>
                <div style={{ marginTop: 6, fontSize: '0.62rem', color: '#7a96b8' }}>
                  Mapping: <span style={{ color: '#4dffc3' }}>{Number(r.highConfidenceOpnCount||0)} high</span>
                  {' · '}<span style={{ color: '#00c9a7' }}>{Number(r.mediumConfidenceOpnCount||0)} medium</span>
                  {' · '}<span style={{ color: '#f0a84e' }}>{Number(r.lowConfidenceOpnCount||0)} low</span>
                  {' · lifecycle '}<span style={{ color: '#c4d4e8' }}>{fmtLifecycle(r.lifecycleSummary)}</span>
                </div>
                {r.qualityWarning && (
                  <div style={{ color: banner.fg, fontStyle: 'italic', marginTop: 4, fontSize: '0.62rem' }}>⚠ {r.qualityWarning}</div>
                )}
                <div style={{ color: '#7a96b8', fontStyle: 'italic', marginTop: 4, fontSize: '0.6rem' }}>
                  Current TI Direct evidence is latest snapshot only. Trend requires at least two TI catalog snapshots.
                </div>
              </div>
            )}

            {detail?.topGpns?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  GPN families in this subcategory ({detail.topGpns.length})
                </div>
                <div style={{ background: '#0c1426', border: '1px solid #1a2740', borderRadius: 6, overflow: 'auto', maxHeight: 360 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.62rem' }}>
                    <thead>
                      <tr>
                        <th style={{ ...headPad, textAlign: 'left' }}>GPN</th>
                        <th style={{ ...headPad, textAlign: 'right' }}>OPNs</th>
                        <th style={{ ...headPad, textAlign: 'right' }}>Stocked</th>
                        <th style={{ ...headPad, textAlign: 'right' }}>Total qty</th>
                        <th style={{ ...headPad, textAlign: 'right' }}>Min price</th>
                        <th style={{ ...headPad, textAlign: 'left' }}>Lifecycle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.topGpns.map(g => (
                        <tr key={g.genericPartNumber}>
                          <td style={cellPad}>
                            <button onClick={() => openFamily(g.genericPartNumber)} style={{ background:'none', border:'none', color:'#3d8ef0', cursor:'pointer', fontFamily:'monospace', padding:0, fontWeight:'bold' }}>{g.genericPartNumber}</button>
                          </td>
                          <td style={{ ...cellPad, textAlign: 'right' }}>{fmtN(g.opnCount)}</td>
                          <td style={{ ...cellPad, textAlign: 'right', color: g.stockedOpnCount > 0 ? '#4dffc3' : '#f0a84e' }}>{fmtN(g.stockedOpnCount)}</td>
                          <td style={{ ...cellPad, textAlign: 'right' }}>{fmtN(g.totalQuantity)}</td>
                          <td style={{ ...cellPad, textAlign: 'right' }}>{fmtPrice(g.minNormalizedUnitPrice)}</td>
                          <td style={{ ...cellPad, color: '#7a96b8' }}>{fmtLifecycle(g.lifecycleSummary)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {detail?.topOpns?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  OPNs in this subcategory ({detail.topOpns.length})
                </div>
                <div style={{ background: '#0c1426', border: '1px solid #1a2740', borderRadius: 6, overflow: 'auto', maxHeight: 360 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem' }}>
                    <thead>
                      <tr>
                        <th style={{ ...headPad, textAlign: 'left' }}>OPN</th>
                        <th style={{ ...headPad, textAlign: 'left' }}>GPN</th>
                        <th style={{ ...headPad, textAlign: 'left' }}>Description</th>
                        <th style={{ ...headPad, textAlign: 'right' }}>Quantity</th>
                        <th style={{ ...headPad, textAlign: 'right' }}>Unit price</th>
                        <th style={{ ...headPad, textAlign: 'left' }}>Lifecycle</th>
                        <th style={{ ...headPad, textAlign: 'left' }}>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.topOpns.map(o => {
                        const conf = o.mappingConfidence || 'unknown';
                        const confColor = conf === 'high' ? '#4dffc3' : conf === 'medium' ? '#00c9a7' : conf === 'low' ? '#f0a84e' : '#7a96b8';
                        return (
                          <tr key={o.tiPartNumber}>
                            <td style={cellPad}>
                              <button onClick={() => openPart(o.tiPartNumber)} style={{ background:'none', border:'none', color:'#3d8ef0', cursor:'pointer', fontFamily:'monospace', padding:0 }}>{o.tiPartNumber}</button>
                            </td>
                            <td style={cellPad}>
                              {o.genericPartNumber ? <button onClick={() => openFamily(o.genericPartNumber)} style={{ background:'none', border:'none', color:'#3d8ef0', cursor:'pointer', fontFamily:'monospace', padding:0 }}>{o.genericPartNumber}</button> : '—'}
                            </td>
                            <td style={{ ...cellPad, color: '#7a96b8', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.description || ''}</td>
                            <td style={{ ...cellPad, textAlign: 'right', color: o.quantity > 0 ? '#4dffc3' : '#f0a84e' }}>{fmtN(o.quantity)}</td>
                            <td style={{ ...cellPad, textAlign: 'right' }}>{fmtPrice(o.normalizedUnitPrice)}</td>
                            <td style={cellPad}>{o.lifeCycle || '—'}</td>
                            <td style={{ ...cellPad, color: confColor, fontWeight: 'bold' }}>{conf}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Phase 24B.1 — catalog refresh state banner. Locked + amber while in
          cooldown; green + 'safe now' once the window opens. The actual
          refresh is operator-only via GitHub Actions; this surface is purely
          informational so customers know exactly when the next safe window
          starts. */}
      {overview && (
        refreshLocked ? (
          <div style={{
            background: '#1a1000',
            border: '1px solid #5a3a00',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: '0.7rem',
          }}>
            <span style={{ fontSize: '1.1rem' }} aria-hidden>🔒</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#f0a84e', fontWeight: 'bold', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.6rem', marginBottom: 2 }}>
                Catalog refresh locked
              </div>
              <div style={{ color: '#c4d4e8' }}>
                TI catalog quota cooling down — next safe refresh in
                {' '}
                <span style={{ color: '#f0a84e', fontWeight: 'bold', fontFamily: 'monospace' }}>{fmtCountdown(refreshRemainingMs)}</span>
                {' '}
                <span style={{ color: '#7a96b8' }}>(at {fmtDate(overview.nextSafeCatalogRunAt)})</span>
              </div>
            </div>
            <span style={{ color: '#8a6020', fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', border: '1px solid #5a3a00', padding: '4px 8px', borderRadius: 4 }}>operator only</span>
          </div>
        ) : (
          <div style={{
            background: '#0a1a14',
            border: '1px solid #1f4a36',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: '0.7rem',
          }}>
            <span style={{ fontSize: '1.1rem' }} aria-hidden>✅</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#4dffc3', fontWeight: 'bold', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.6rem', marginBottom: 2 }}>
                Catalog refresh window open
              </div>
              <div style={{ color: '#c4d4e8' }}>
                TI catalog quota is in its safe window. Operator may dispatch
                {' '}
                <code style={{ color: '#7a96b8' }}>ti-catalog-universe-ingest</code>
                {' '}
                via GitHub Actions.
              </div>
            </div>
            <span style={{ color: '#4a6a8a', fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', border: `1px solid ${B}`, padding: '4px 8px', borderRadius: 4 }}>operator only</span>
          </div>
        )
      )}

      {/* ── Cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 16 }}>
        {cards.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: 16, color: '#4a6a8a', fontSize: '0.65rem' }}>Loading overview…</div>
        )}
        {cards.map(c => (
          <div key={c.label} style={{ background: '#0c1426', border: `1px solid ${B}`, borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.55rem', color: '#7a96b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: '0.95rem', color: c.accent || '#e0eaf8', fontWeight: 'bold' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* ── Search ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Search</div>
        <input
          type="text"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Search OPN, GPN, or description"
          style={{ width: '100%', maxWidth: 480, background: '#0c1426', border: `1px solid ${B}`, color: '#e0eaf8', padding: '8px 12px', borderRadius: 6, fontFamily: 'monospace', fontSize: '0.7rem', outline: 'none' }}
        />
        {(searchLoading || searchResults.length > 0 || searchNote) && (
          <div style={{ marginTop: 8, background: '#0c1426', border: `1px solid ${B}`, borderRadius: 6, maxHeight: 260, overflowY: 'auto' }}>
            {searchLoading && <div style={{ padding: '8px 12px', color: '#4a6a8a', fontSize: '0.65rem' }}>Searching…</div>}
            {!searchLoading && searchResults.length === 0 && searchNote && (
              <div style={{ padding: '8px 12px', color: '#7a96b8', fontSize: '0.65rem' }}>{searchNote}</div>
            )}
            {!searchLoading && searchResults.map(r => (
              <div key={r.tiPartNumber} style={{ padding: '7px 12px', borderBottom: `1px solid ${B}`, fontSize: '0.65rem', display: 'flex', gap: 12, alignItems: 'center' }}>
                <button onClick={() => openPart(r.tiPartNumber)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0, fontWeight: 'bold' }}>{r.tiPartNumber}</button>
                {r.genericPartNumber && (
                  <button onClick={() => openFamily(r.genericPartNumber)} style={{ background: 'none', border: `1px solid ${B}`, color: '#7a96b8', cursor: 'pointer', fontFamily: 'monospace', padding: '2px 6px', fontSize: '0.55rem', borderRadius: 3 }}>family: {r.genericPartNumber}</button>
                )}
                <span style={{ color: '#7a96b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description || ''}</span>
                <span style={{ color: r.quantity > 0 ? '#4dffc3' : '#f0a84e' }}>{fmtN(r.quantity)} qty</span>
                <span style={{ color: '#c4d4e8' }}>{fmtPrice(r.normalizedUnitPrice)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Leaderboard ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>GPN leaderboard (top 50)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.55rem', color: '#7a96b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              style={{ background: '#0c1426', border: `1px solid ${B}`, color: '#e0eaf8', padding: '5px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.65rem' }}
            >
              {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ background: '#0c1426', border: `1px solid ${B}`, borderRadius: 6, overflow: 'auto', maxHeight: 480 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.62rem' }}>
            <thead>
              <tr>
                <th style={{ ...headPad, textAlign: 'left' }}>GPN</th>
                <th style={{ ...headPad, textAlign: 'right' }}>Variants</th>
                <th style={{ ...headPad, textAlign: 'right' }}>Stocked</th>
                <th style={{ ...headPad, textAlign: 'right' }}>Out of stock</th>
                <th style={{ ...headPad, textAlign: 'right' }}>Total qty</th>
                <th style={{ ...headPad, textAlign: 'right' }}>Min price</th>
                <th style={{ ...headPad, textAlign: 'right' }}>Median</th>
                <th style={{ ...headPad, textAlign: 'right' }}>Max price</th>
                <th style={{ ...headPad, textAlign: 'left' }}>Cheapest OPN</th>
                <th style={{ ...headPad, textAlign: 'left' }}>Highest-inv OPN</th>
                <th style={{ ...headPad, textAlign: 'left' }}>Lifecycle</th>
              </tr>
            </thead>
            <tbody>
              {leaderboardLoading && (
                <tr><td colSpan={11} style={{ ...cellPad, color: '#4a6a8a', textAlign: 'center' }}>Loading…</td></tr>
              )}
              {!leaderboardLoading && leaderboard.length === 0 && (
                <tr><td colSpan={11} style={{ ...cellPad, color: '#7a96b8', textAlign: 'center' }}>No rows</td></tr>
              )}
              {!leaderboardLoading && leaderboard.map(r => {
                // Phase 24E.2 — derive out-of-stock count + ratio so the new
                // column shows e.g. "71 (77%)". opnCount can be 0 for
                // empty subcategories; guard NaN.
                const oos = Math.max(0, (r.opnCount ?? 0) - (r.stockedOpnCount ?? 0));
                const oosPct = r.opnCount > 0 ? Math.round((oos / r.opnCount) * 100) : null;
                const oosLabel = r.opnCount > 0 ? `${fmtN(oos)} (${oosPct}%)` : '—';
                const oosColor = oosPct === 100 ? '#f05c5c' : oos > 0 ? '#f0a84e' : '#4a6a8a';
                return (
                <tr key={r.genericPartNumber}>
                  <td style={cellPad}>
                    <button onClick={() => openFamily(r.genericPartNumber)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0, fontWeight: 'bold' }}>{r.genericPartNumber}</button>
                  </td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{fmtN(r.opnCount)}</td>
                  <td style={{ ...cellPad, textAlign: 'right', color: r.stockedOpnCount > 0 ? '#4dffc3' : '#f0a84e' }}>{fmtN(r.stockedOpnCount)}</td>
                  <td style={{ ...cellPad, textAlign: 'right', color: oosColor }}>{oosLabel}</td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{fmtN(r.totalQuantity)}</td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{fmtPrice(r.minNormalizedUnitPrice)}</td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{fmtPrice(r.medianNormalizedUnitPrice)}</td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{fmtPrice(r.maxNormalizedUnitPrice)}</td>
                  <td style={cellPad}>
                    {r.cheapestOpn ? (
                      <button onClick={() => openPart(r.cheapestOpn)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0 }}>{r.cheapestOpn}</button>
                    ) : '—'}
                  </td>
                  <td style={cellPad}>
                    {r.highestInventoryOpn ? (
                      <button onClick={() => openPart(r.highestInventoryOpn)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0 }}>{r.highestInventoryOpn}</button>
                    ) : '—'}
                  </td>
                  <td style={{ ...cellPad, color: '#7a96b8' }}>{fmtLifecycle(r.lifecycleSummary)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Drill-down ────────────────────────────────────────────────── */}
      {(selectedPart || selectedFamily || drillLoading || drillError) && (
        <div style={{ background: '#0c1426', border: `1px solid ${B}`, borderRadius: 6, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: '0.6rem', color: '#7a96b8', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {selectedPart ? `Part detail · ${selectedPart.tiPartNumber}` :
               selectedFamily ? `Family detail · ${selectedFamily.family?.genericPartNumber}` :
               drillLoading ? 'Loading…' : 'Drill-down'}
            </div>
            <button onClick={() => { setSelectedPart(null); setSelectedFamily(null); setDrillError(null); }} style={{ background: 'none', border: `1px solid ${B}`, color: '#7a96b8', cursor: 'pointer', fontFamily: 'monospace', padding: '3px 8px', fontSize: '0.6rem', borderRadius: 4 }}>close</button>
          </div>

          {drillError && <div style={{ color: '#ffb0b0', fontSize: '0.65rem' }}>{drillError}</div>}
          {drillLoading && !drillError && <div style={{ color: '#4a6a8a', fontSize: '0.65rem' }}>Fetching…</div>}

          {selectedPart && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: '0.65rem', lineHeight: 1.55 }}>
              <div>
                <div><span style={{ color: '#7a96b8' }}>OPN: </span><span style={{ color: '#e0eaf8', fontWeight: 'bold' }}>{selectedPart.tiPartNumber}</span></div>
                <div><span style={{ color: '#7a96b8' }}>GPN: </span>
                  {selectedPart.genericPartNumber ? (
                    <button onClick={() => openFamily(selectedPart.genericPartNumber)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0 }}>{selectedPart.genericPartNumber}</button>
                  ) : '—'}
                </div>
                <div><span style={{ color: '#7a96b8' }}>Description: </span>{selectedPart.description || '—'}</div>
                <div><span style={{ color: '#7a96b8' }}>Quantity: </span><span style={{ color: selectedPart.quantity > 0 ? '#4dffc3' : '#f0a84e' }}>{fmtN(selectedPart.quantity)}</span></div>
                <div><span style={{ color: '#7a96b8' }}>Normalized unit price: </span>{fmtPrice(selectedPart.normalizedUnitPrice)} ({selectedPart.currency || '—'} @ qty={fmtN(selectedPart.normalizedPriceQty)})</div>
                <div><span style={{ color: '#7a96b8' }}>Lifecycle: </span>{selectedPart.lifeCycle || '—'}</div>
                <div><span style={{ color: '#7a96b8' }}>Min order qty: </span>{fmtN(selectedPart.minimumOrderQuantity)}</div>
                <div><span style={{ color: '#7a96b8' }}>Pack qty: </span>{fmtN(selectedPart.standardPackQuantity)}</div>
                <div><span style={{ color: '#7a96b8' }}>Order limit: </span>{fmtN(selectedPart.limit)}</div>
                <div><span style={{ color: '#7a96b8' }}>Buy now: </span>
                  {selectedPart.buyNowUrl ? (
                    <a href={selectedPart.buyNowUrl} target="_blank" rel="noreferrer" style={{ color: '#3d8ef0' }}>open ↗</a>
                  ) : '—'}
                </div>
                <div><span style={{ color: '#7a96b8' }}>Snapshot: </span>{fmtDate(selectedPart.latestCapturedAt)}</div>
              </div>
              <div>
                <div style={{ color: '#7a96b8', fontWeight: 'bold', marginBottom: 4 }}>Price breaks</div>
                {Array.isArray(selectedPart.pricing) && selectedPart.pricing.length > 0 ? (
                  <div style={{ background: '#080c14', border: `1px solid ${B}`, borderRadius: 4, padding: '6px 8px', maxHeight: 140, overflowY: 'auto' }}>
                    {selectedPart.pricing.flatMap((p, pi) =>
                      (p?.priceBreaks || []).map((b, bi) => (
                        <div key={`${pi}-${bi}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#7a96b8' }}>qty ≥ {fmtN(b.priceBreakQuantity ?? b.quantity)}</span>
                          <span>{fmtPrice(b.price ?? b.unitPrice)} {b.currency || ''}</span>
                        </div>
                      )),
                    )}
                  </div>
                ) : <div style={{ color: '#4a6a8a' }}>No breaks parsed.</div>}

                <div style={{ color: '#7a96b8', fontWeight: 'bold', margin: '10px 0 4px' }}>Future inventory</div>
                {Array.isArray(selectedPart.futureInventory) && selectedPart.futureInventory.length > 0 ? (
                  <div style={{ background: '#080c14', border: `1px solid ${B}`, borderRadius: 4, padding: '6px 8px', maxHeight: 100, overflowY: 'auto' }}>
                    {selectedPart.futureInventory.map((f, fi) => (
                      <div key={fi} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#7a96b8' }}>{f?.dateAvailable || f?.date || `entry ${fi + 1}`}</span>
                        <span>{fmtN(f?.quantity)}</span>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ color: '#4a6a8a' }}>No future inventory.</div>}
              </div>
            </div>
          )}

          {selectedFamily && selectedFamily.family && (
            <div style={{ fontSize: '0.65rem', lineHeight: 1.55 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
                <div><span style={{ color: '#7a96b8' }}>Variants: </span>{fmtN(selectedFamily.variantCount)}</div>
                <div><span style={{ color: '#7a96b8' }}>Stocked: </span><span style={{ color: '#4dffc3' }}>{fmtN(selectedFamily.stockedVariantCount)}</span></div>
                <div><span style={{ color: '#7a96b8' }}>Out of stock: </span><span style={{ color: '#f0a84e' }}>{fmtN(selectedFamily.outOfStockVariantCount)}</span></div>
                <div><span style={{ color: '#7a96b8' }}>Total qty: </span>{fmtN(selectedFamily.family.totalQuantity)}</div>
                <div><span style={{ color: '#7a96b8' }}>Min price: </span>{fmtPrice(selectedFamily.family.minNormalizedUnitPrice)}</div>
                <div><span style={{ color: '#7a96b8' }}>Median price: </span>{fmtPrice(selectedFamily.family.medianNormalizedUnitPrice)}</div>
                <div><span style={{ color: '#7a96b8' }}>Lifecycle: </span>{fmtLifecycle(selectedFamily.family.lifecycleSummary)}</div>
                <div><span style={{ color: '#7a96b8' }}>Snapshot: </span>{fmtDate(selectedFamily.family.latestCapturedAt)}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>
                <div style={{ background: '#080c14', border: `1px solid ${B}`, borderRadius: 4, padding: '8px 10px' }}>
                  <div style={{ color: '#7a96b8', fontWeight: 'bold', marginBottom: 4 }}>Cheapest variant</div>
                  {selectedFamily.cheapestVariant ? (
                    <>
                      <div><button onClick={() => openPart(selectedFamily.cheapestVariant.tiPartNumber)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0, fontWeight: 'bold' }}>{selectedFamily.cheapestVariant.tiPartNumber}</button></div>
                      <div>{fmtPrice(selectedFamily.cheapestVariant.normalizedUnitPrice)} · qty {fmtN(selectedFamily.cheapestVariant.quantity)}</div>
                    </>
                  ) : '—'}
                </div>
                <div style={{ background: '#080c14', border: `1px solid ${B}`, borderRadius: 4, padding: '8px 10px' }}>
                  <div style={{ color: '#7a96b8', fontWeight: 'bold', marginBottom: 4 }}>Highest-inventory variant</div>
                  {selectedFamily.highestInventoryVariant ? (
                    <>
                      <div><button onClick={() => openPart(selectedFamily.highestInventoryVariant.tiPartNumber)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0, fontWeight: 'bold' }}>{selectedFamily.highestInventoryVariant.tiPartNumber}</button></div>
                      <div>{fmtPrice(selectedFamily.highestInventoryVariant.normalizedUnitPrice)} · qty {fmtN(selectedFamily.highestInventoryVariant.quantity)}</div>
                    </>
                  ) : '—'}
                </div>
              </div>

              <div style={{ color: '#7a96b8', fontWeight: 'bold', marginBottom: 4 }}>All variants ({selectedFamily.variants?.length || 0})</div>
              <div style={{ background: '#080c14', border: `1px solid ${B}`, borderRadius: 4, maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem' }}>
                  <thead>
                    <tr>
                      <th style={{ ...headPad, textAlign: 'left', background: '#080c14' }}>OPN</th>
                      <th style={{ ...headPad, textAlign: 'right', background: '#080c14' }}>Quantity</th>
                      <th style={{ ...headPad, textAlign: 'right', background: '#080c14' }}>Unit price</th>
                      <th style={{ ...headPad, textAlign: 'left', background: '#080c14' }}>Lifecycle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedFamily.variants || []).map(v => (
                      <tr key={v.tiPartNumber}>
                        <td style={cellPad}>
                          <button onClick={() => openPart(v.tiPartNumber)} style={{ background: 'none', border: 'none', color: '#3d8ef0', cursor: 'pointer', fontFamily: 'monospace', padding: 0 }}>{v.tiPartNumber}</button>
                        </td>
                        <td style={{ ...cellPad, textAlign: 'right', color: v.quantity > 0 ? '#4dffc3' : '#f0a84e' }}>{fmtN(v.quantity)}</td>
                        <td style={{ ...cellPad, textAlign: 'right' }}>{fmtPrice(v.normalizedUnitPrice)}</td>
                        <td style={cellPad}>{v.lifeCycle || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <div style={{ fontSize: '0.6rem', color: '#7a96b8', lineHeight: 1.55, paddingTop: 4, borderTop: `1px solid ${B}` }}>
        <div>· Full catalog is refreshed manually due to TI catalog quota (1 call / 4h, 6 / day).</div>
        <div>· Trend signals require at least two catalog snapshots — single-snapshot rows show current state only.</div>
        <div>· Numbers come from <code style={{ color: '#c4d4e8' }}>/api/ti/universe/catalog/*</code>; no TI calls are made from this view.</div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App(){
  const [liveData,setLiveData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [fetchedAt,setFetchedAt]=useState(null);
  const [src,setSrc]=useState('');
  const [fetchCount,setFetchCount]=useState(null);
  const [vis,setVis]=useState(new Set(Object.keys(GC)));
  const [tooltip,setTooltip]=useState(null);
  // Phase 24C.4 — tooltip position state (initially "below cursor", flipped
  // above when it would clip past the viewport bottom). Measured via a ref
  // after render so the flip is exact regardless of how tall the tooltip
  // grew (TI Direct + quality blocks make it variable).
  const tooltipRef = useRef(null);
  const [tooltipPos,setTooltipPos]=useState(null);
  useEffect(() => {
    if (!tooltip || !tooltipRef.current) { setTooltipPos(null); return; }
    const rect = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const GAP = 14, EDGE = 8;
    let top = tooltip.y + GAP;
    if (top + rect.height > vh - EDGE) {
      // Not enough room below — flip above. Clamp to top edge so very
      // tall tooltips at least start visible.
      top = Math.max(EDGE, tooltip.y - GAP - rect.height);
    }
    const left = Math.max(EDGE, Math.min(tooltip.x + GAP, vw - rect.width - EDGE));
    setTooltipPos({ top, left });
  }, [tooltip?.x, tooltip?.y, tooltip?.catId]);
  // Phase 23C.5 — lazy init from localStorage so a hard-refresh during an
  // active Mouser cooldown keeps the refresh button disabled and prevents
  // a fresh /api/prices call from re-triggering the warn toast.
  const [rateLimitedUntil,setRateLimitedUntil]=useState(()=>readPersistedRateLimit());
  const [baselineMeta,setBaselineMeta]=useState(null);
  const [basketPreviewData,setBasketPreviewData]=useState(null);
  const [basketLoading,setBasketLoading]=useState(false);
  // Phase 10: source-memory status (read-only, no capture trigger from UI).
  const [snapshotMeta,setSnapshotMeta]=useState(null);
  const [trendMeta,setTrendMeta]=useState(null);
  // Phase 14A: derived evidence from the latest snapshot (read-only).
  const [evidenceData,setEvidenceData]=useState(null);
  // Phase 15A: full basket-coverage catalog (read-only, no Nexar calls).
  const [coverageData,setCoverageData]=useState(null);
  // Phase 16A: combined Mouser + Nexar evidence (read-only, no Nexar calls).
  const [combinedEvidence,setCombinedEvidence]=useState(null);
  // Phase 24C: TI Direct full-catalog rollups indexed by canonical
  // subcategory id. Populated once on mount; never causes a TI call.
  const [tiRollupsByCanonical,setTiRollupsByCanonical]=useState({});
  // Phase 25 — TI Direct stock+price trend per canonical subcategory.
  // Empty {} until ≥1 history row exists per subcategory. Rich row carries
  // priceDeltaPct + stockDeltaPct + snapshotCount + hasEnoughHistory +
  // trendConfidence ('insufficient' | 'daily' | 'weekly'). Drives the
  // Insights tab's shortage/oversupply classifier.
  const [tiTrendByCanonical,setTiTrendByCanonical]=useState({});
  // Phase 19B — two-tab UI. 'prices' is the customer-facing default;
  // 'insights' holds source agreement, signal summary, and operator status.
  const [activeTab,setActiveTab]=useState('prices');
  // Phase 24D — TI Universe filter set when the user clicks a Prices Live
  // cell that has a TI Direct rollup. Switches the tab to 'universe' and
  // pre-fills the panel with a subcategory-scoped detail view (rollup
  // summary + GPN families + OPN rows). Cleared either via the in-panel
  // "Clear filter" button or by navigating away from Universe tab.
  const [universeFilter,setUniverseFilter]=useState(null);
  // Phase 20A — TI direct API status (Product Info active, Store pending).
  const [tiStatus,setTiStatus]=useState(null);
  const { toasts, push, dismiss } = useToasts();
  const rateLimitToastId = useRef(null);
  const retryTimer = useRef(null);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  const visCats=CATS.filter(c=>vis.has(c.g));
  const grps=[];
  visCats.forEach(c=>{const last=grps[grps.length-1];if(last&&last.g===c.g)last.n++;else grps.push({g:c.g,n:1});});

  // Auto-retry after rate limit window expires
  function scheduleRetry(retryAt) {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const ms = Math.max(0, new Date(retryAt) - Date.now()) + 2000;
    retryTimer.current = setTimeout(() => {
      setRateLimitedUntil(null);
      writePersistedRateLimit(null);
      push('Rate limit cleared — auto-refreshing live prices…', 'info', 4000);
      fetchLive(true, true);
    }, ms);
  }

  const fetchLive = useCallback(async(force=false, silent=false) => {
    // Phase 23C.5 — pre-flight guard. If a manual refresh fires while we
    // already know the Mouser quota is cooling down, skip the network call
    // entirely and surface a calm one-line info toast. Prevents the loud
    // RateLimitToast countdown from re-popping every time the user clicks.
    if (force) {
      const persisted = readPersistedRateLimit();
      const until = rateLimitedUntil || persisted;
      if (until && new Date(until).getTime() > Date.now()) {
        const secsLeft = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
        if (!silent) push(`Live refresh available in ~${secsLeft}s — Mouser quota cooling down.`, 'info', 4000);
        return;
      }
    }
    setLoading(true);
    if (!silent) push('Querying Mouser Electronics API — fetching 28 categories in parallel…', 'info', 15000);
    try {
      // No client-side timeout — let the server complete (parallel batches take ~8-10s)
      const res = await fetch(force ? '/api/prices?refresh=true' : '/api/prices');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      setLiveData(json.data);
      setFetchedAt(json.fetchedAt || json.cachedAt);
      setSrc(json.source);
      setFetchCount({ got: json.fetchedCount, total: json.totalCount });
      if (json.baselineDate) {
        setBaselineMeta({
          baselineDate: json.baselineDate,
          baselinePeriodLabel: json.baselinePeriodLabel,
          baselineLabel: json.baselineLabel,
          baselineDisplay: json.baselineDisplay,
          baselineDescription: json.baselineDescription,
          baselineAgeDays: json.baselineAgeDays,
          baselineReviewAfterDays: json.baselineReviewAfterDays,
          baselineIsStale: json.baselineIsStale,
          baselineRolloverPolicy: json.baselineRolloverPolicy,
          comparisonMode: json.comparisonMode,
        });
      }

      if (json.rateLimited) {
        // Rate limited — may be 0/28 (hit on first call) or partial
        // retryAt from server; if missing, default to 60s from now
        const retryAt = json.retryAt || new Date(Date.now() + 65_000).toISOString();
        setRateLimitedUntil(retryAt);
        writePersistedRateLimit(retryAt);
        if (rateLimitToastId.current) dismiss(rateLimitToastId.current);
        const id = push(
          <RateLimitToast retryAt={retryAt} onDismiss={()=>dismiss(id)} />,
          'warn', 0
        );
        rateLimitToastId.current = id;
        scheduleRetry(retryAt);
        const got = json.fetchedCount ?? 0;
        const msg = got === 0
          ? 'Mouser API rate limit hit — historical data shown. Live row will auto-refresh when limit clears.'
          : `Got ${got}/${json.totalCount} categories before rate limit. Partial data shown.`;
        push(msg, 'warn', 9000);
      } else if (json.source === 'cache') {
        if (!silent) {
          const age = json.cachedAt ? Math.round((Date.now() - new Date(json.cachedAt)) / 60000) : '?';
          push(`Showing cached data from ${age} min ago — next auto-refresh in ${Math.round((json.nextRefreshMs||0)/60000)} min`, 'info', 5000);
        }
      } else if ((json.fetchedCount ?? 0) === 0 && json.source === 'live') {
        // Fetched 0 categories but no rateLimited flag — likely all parts returned no pricing
        const retryAt2 = new Date(Date.now() + 65_000).toISOString();
        setRateLimitedUntil(retryAt2);
        writePersistedRateLimit(retryAt2);
        if (rateLimitToastId.current) dismiss(rateLimitToastId.current);
        const id2 = push(
          <RateLimitToast retryAt={retryAt2} onDismiss={()=>dismiss(id2)} />,
          'warn', 0
        );
        rateLimitToastId.current = id2;
        scheduleRetry(retryAt2);
        push('Mouser API returned no pricing data — possibly rate limited. Auto-retry in ~1 min.', 'warn', 9000);
      } else {
        if (!silent) {
          const got = json.fetchedCount ?? '?';
          const total = json.totalCount ?? 28;
          push(`Live prices loaded — ${got}/${total} categories fetched from Mouser`, 'success', 5000);
        }
        // Phase 23C.5 — clear cooldown state, persisted key, retry timer,
        // and the persistent RateLimitToast so a successful refresh leaves
        // no stale UI behind.
        setRateLimitedUntil(null);
        writePersistedRateLimit(null);
        if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        if (rateLimitToastId.current) { dismiss(rateLimitToastId.current); rateLimitToastId.current = null; }
      }
    } catch(e) {
      push(`Failed to load live prices: ${e.message}`, 'error', 8000);
    }
    setLoading(false);
  }, [push, dismiss]);

  useEffect(() => {
    // Phase 23C.5 — if a previous tab/session left a Mouser cooldown
    // window in localStorage, honor it on mount: load cached data
    // silently and schedule the same auto-retry timer that the live
    // path would have set. No fresh /api/prices call, no warn toast.
    const persisted = readPersistedRateLimit();
    if (persisted) {
      scheduleRetry(persisted);
      fetchLive(false, true);
    } else {
      fetchLive(false);
    }
    return () => { if(retryTimer.current) clearTimeout(retryTimer.current); };
  }, []);

  // Phase 9: fetch the Nexar basket preview to enrich preview-covered cells.
  // Initial mount uses the cached path only — never sends ?refresh=true. The
  // worker keeps a 24h CF cache so page loads do not burn Nexar evaluation
  // quota. Manual refresh button is the only path that sends ?refresh=true.
  const fetchBasketPreview = useCallback(async (force = false) => {
    setBasketLoading(true);
    try {
      const res = await fetch(force ? '/api/nexar/basket-preview?refresh=true' : '/api/nexar/basket-preview');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setBasketPreviewData(json);
      if (force) {
        const got = json.quotedSkuCount ?? 0;
        const total = json.skuCount ?? 0;
        if (json.status === 'ok' || json.status === 'partial') {
          push(`Nexar basket refreshed — ${got}/${total} SKUs quoted across ${json.categoryCount} categories`, 'success', 4000);
        } else if (json.status === 'not_configured') {
          push('Nexar not configured — basket source check unavailable', 'warn', 5000);
        } else {
          push(`Nexar basket refresh: ${json.status}`, 'warn', 5000);
        }
      }
    } catch (e) {
      // Don't break the table — just no NX markers.
      if (force) push(`Basket source check failed: ${e.message}`, 'error', 6000);
    }
    setBasketLoading(false);
  }, [push]);

  useEffect(() => { fetchBasketPreview(false); }, []);

  // Phase 10: pull snapshot-memory status on mount. Read-only, never triggers
  // a capture. Failures are silent — they only suppress the small status line.
  // Phase 14A adds /api/snapshots/evidence/latest to the same mount-time batch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [latestRes, trendsRes, evidenceRes, coverageRes, combinedRes, tiStatusRes, tiRollupsRes, tiTrendRes] = await Promise.allSettled([
          fetch('/api/snapshots/latest').then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/trends?days=30').then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/evidence/latest').then(r => r.ok ? r.json() : null),
          fetch('/api/nexar/basket-coverage').then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/evidence/combined').then(r => r.ok ? r.json() : null),
          fetch('/api/ti/status').then(r => r.ok ? r.json() : null),
          // Phase 24C — TI Direct rollups for the Live row tooltip badge.
          // ?limit=200 covers all 28 canonical subcategories with headroom.
          fetch('/api/ti/universe/catalog/rollups/latest?limit=200').then(r => r.ok ? r.json() : null),
          // Phase 25 — TI Direct stock+price trend per canonical subcategory.
          // Drives the Insights tab's shortage/oversupply classifier once
          // ≥2 history snapshots exist.
          fetch('/api/ti/universe/catalog/rollups/trend').then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        if (latestRes.status === 'fulfilled' && latestRes.value) {
          setSnapshotMeta({
            configured: !!latestRes.value.configured,
            status: latestRes.value.status,
            latestSnapshotDate: latestRes.value.latestSnapshotDate || null,
            schemaVersion: latestRes.value.schemaVersion,
          });
        }
        if (trendsRes.status === 'fulfilled' && trendsRes.value) {
          setTrendMeta({
            status: trendsRes.value.status,
            observationCount: trendsRes.value.observationCount,
            firstDate: trendsRes.value.firstDate,
            latestDate: trendsRes.value.latestDate,
          });
        }
        if (evidenceRes.status === 'fulfilled' && evidenceRes.value) {
          setEvidenceData(evidenceRes.value);
        }
        if (coverageRes.status === 'fulfilled' && coverageRes.value) {
          setCoverageData(coverageRes.value);
        }
        if (combinedRes.status === 'fulfilled' && combinedRes.value) {
          setCombinedEvidence(combinedRes.value);
        }
        if (tiStatusRes.status === 'fulfilled' && tiStatusRes.value) {
          setTiStatus(tiStatusRes.value);
        }
        if (tiRollupsRes.status === 'fulfilled' && tiRollupsRes.value && Array.isArray(tiRollupsRes.value.rows)) {
          const map = {};
          for (const r of tiRollupsRes.value.rows) {
            if (r?.canonicalSubcategory) map[r.canonicalSubcategory] = r;
          }
          setTiRollupsByCanonical(map);
        }
        if (tiTrendRes.status === 'fulfilled' && tiTrendRes.value && Array.isArray(tiTrendRes.value.subcategories)) {
          const map = {};
          for (const s of tiTrendRes.value.subcategories) {
            if (s?.canonicalSubcategory) map[s.canonicalSubcategory] = s;
          }
          setTiTrendByCanonical(map);
        }
      } catch (_) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Lookup helper: resolve a category id to its evidence record from the
  // latest snapshot, or null if not present (e.g. cell isn't in the basket).
  function evidenceCatFor(catId) {
    const cats = evidenceData?.evidence?.categories;
    if (!cats) return null;
    return cats.find(c => c.categoryId === catId) || null;
  }

  // Phase 15A: per-category basket-coverage record (sampled vs unsampled SKUs).
  function coverageCatFor(catId) {
    const cats = coverageData?.categories;
    if (!cats) return null;
    return cats.find(c => c.categoryId === catId) || null;
  }

  // Phase 16A: per-canonical-subcategory combined-evidence row (Mouser + Nexar).
  // Cell IDs are Mouser PART_MAP legacy ids; resolve to canonical via the
  // legacyToCanonical map embedded in the combined-evidence response.
  function combinedAgreementFor(catId) {
    const rows = combinedEvidence?.sourceAgreement;
    if (!rows) return null;
    const map = combinedEvidence?.legacyToCanonical || {};
    const canonicalId = map[catId] || catId;
    return rows.find(r => r.canonicalCategoryId === canonicalId) || null;
  }

  // Quick lookup: returns the basket category record only when it has at
  // least one quoted SKU. Used to gate the NX marker and tooltip section.
  function basketCatFor(catId) {
    const cat = basketPreviewData?.categories?.find(c => c.categoryId === catId);
    if (!cat) return null;
    if ((cat.quotedSkuCount ?? 0) <= 0) return null;
    return cat;
  }

  // 30-min auto-check while tab is visible. Cached path only (no refresh=true) —
  // respects the CF edge cache and never burns Mouser quota. Skipped when the
  // tab is hidden, and skipped when a fetch is already in flight. On
  // visibilitychange→visible we trigger one safe cached check if not loading.
  useEffect(() => {
    const AUTO_CHECK_MS = 30 * 60 * 1000;
    const safeCachedCheck = () => {
      if (document.visibilityState === 'visible' && !loadingRef.current) {
        fetchLive(false, true);
      }
    };
    const timer = setInterval(safeCachedCheck, AUTO_CHECK_MS);
    const onVis = () => { if (document.visibilityState === 'visible') safeCachedCheck(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchLive]);

  function exportCSV(){
    const rows=[['Period',...visCats.map(c=>c.l)]];
    HP.forEach(p=>rows.push([p,...visCats.map(c=>HIST[p]?.[c.id]??'')]));
    if(liveData)rows.push(['Live vs latest baseline (Q1-26 close 28-Apr-26)',...visCats.map(c=>liveData[c.id]?.qoqPct??'')]);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'}));
    a.download=`ti_prices_${new Date().toISOString().slice(0,10)}.csv`;a.click();
  }

  function TT({catId}){
    const d=liveData?.[catId];
    const basket=basketCatFor(catId);
    const evid=evidenceCatFor(catId);
    const agree=combinedAgreementFor(catId);
    if(!d&&!basket&&!evid&&!agree)return null; // nothing to show
    const cat=CATS.find(c=>c.id===catId);
    // Source confidence (coverage, not direction confirmation):
    //   multi-source → ≥2 trusted distributors with quoted available offers
    //   single-source → exactly 1 trusted distributor
    //   insufficient → no trusted available price
    let confidence='insufficient';
    if(basket){
      const dist=basket.trustedDistributorCoverage?.length||0;
      if(basket.avgBestTrustedAvailableUnitPrice==null) confidence='insufficient';
      else if(dist>=2) confidence='multi-source';
      else if(dist===1) confidence='single-source';
    }
    // Phase 24E — TI Direct primary, channel checks secondary.
    const tiCanonical = combinedEvidence?.legacyToCanonical?.[catId];
    const tiRollupRow = tiCanonical ? tiRollupsByCanonical[tiCanonical] : null;

    // Compact summary inputs
    const lastP = HP[HP.length - 1];
    const histQoQ = HIST[lastP]?.[catId];
    const liveQoQ = d?.qoqPct;
    const fmtPct = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
    const priceParts = [];
    if (histQoQ != null) priceParts.push(`${fmtPct(histQoQ)} QoQ`);
    if (liveQoQ != null) priceParts.push(`Live ${fmtPct(liveQoQ)}`);
    const priceSignalText = priceParts.length ? priceParts.join(' / ') : '—';
    const priceSignalColor = (liveQoQ ?? histQoQ) > 0 ? '#4dffc3' : (liveQoQ ?? histQoQ) < 0 ? '#f05c5c' : '#e0eaf8';

    let confLabel = '—';
    let confColor2 = '#7a96b8';
    const tiQ = tiRollupRow?.qualityLabel;
    if (tiQ === 'high') { confLabel = 'High'; confColor2 = '#4dffc3'; }
    else if (tiQ === 'medium' || confidence === 'multi-source') { confLabel = 'Medium'; confColor2 = '#00c9a7'; }
    else if (tiQ === 'low' || tiQ === 'mixed' || confidence === 'single-source') { confLabel = 'Low'; confColor2 = '#f0a84e'; }

    const basketText = tiRollupRow?.opnCount != null
      ? `${Number(tiRollupRow.opnCount).toLocaleString()} mapped TI parts`
      : (basket?.skuCount ? `${basket.skuCount} representative SKUs` : '—');

    const sourceList = [];
    if (d?.parts?.length > 0) sourceList.push('Mouser');
    if (basket || evid) sourceList.push('Nexar');
    if (tiRollupRow) sourceList.push('TI Direct');
    const sourcesText = sourceList.length ? sourceList.join(' / ') : '—';

    const normDate = (v) => {
      if (!v) return null;
      const s = typeof v === 'string' ? v : new Date(v).toISOString();
      return s.slice(0, 10);
    };
    const dateCands = [
      normDate(combinedEvidence?.latestMouserSnapshotDate),
      normDate(combinedEvidence?.latestNexarSnapshotDate),
      normDate(combinedEvidence?.latestTiDirectSnapshotDate || tiRollupRow?.latestCapturedAt),
    ].filter(Boolean).sort();
    const latestDate = dateCands.length ? dateCands[dateCands.length - 1] : null;
    const latestCheckText = latestDate ? `${sourcesText} · ${latestDate}` : sourcesText;

    let interp;
    if (tiRollupRow && d?.parts?.length > 0) {
      interp = 'Latest live channel check supports the current price signal.';
    } else if (tiRollupRow) {
      interp = 'Price movement is based on TI catalog history.';
    } else if (d?.parts?.length > 0 || basket || evid) {
      interp = 'Latest signal from live distributor channel data.';
    } else {
      interp = 'Latest signal from TI price history.';
    }

    return <>
      {/* Header */}
      <div style={{fontSize:'0.78rem',color:'#ffd700',marginBottom:6,fontWeight:'bold',letterSpacing:'-0.01em'}}>
        {cat?.l}
        {catId==='gan_365'?<span style={{color:'#f0a84e',fontSize:'0.52rem',marginLeft:6,fontWeight:'normal'}}>⚠ reel/2000 price</span>:null}
      </div>

      {/* Interpretation */}
      <div style={{fontSize:'0.62rem',color:'#7a96b8',marginBottom:9,lineHeight:1.45}}>
        {interp}
      </div>

      {/* Compact 4-row summary */}
      <div style={{display:'grid',gridTemplateColumns:'auto 1fr',rowGap:5,columnGap:14,fontSize:'0.62rem',marginBottom:9}}>
        <span style={{color:'#7a96b8'}}>Price signal</span>
        <span style={{color:priceSignalColor,fontFamily:'monospace',fontWeight:'bold'}}>{priceSignalText}</span>

        <span style={{color:'#7a96b8'}}>Confidence</span>
        <span style={{color:confColor2,fontWeight:'bold'}}>{confLabel}</span>

        <span style={{color:'#7a96b8'}}>Basket</span>
        <span style={{color:'#e0eaf8'}}>{basketText}</span>

        <span style={{color:'#7a96b8'}}>Latest check</span>
        <span style={{color:'#e0eaf8'}}>{latestCheckText}</span>
      </div>

      {/* Source detail */}
      <div style={{fontSize:'0.55rem',color:'#4a6a8a',marginBottom:9,fontStyle:'italic',lineHeight:1.45}}>
        Primary source: TI Direct · Channel checks: Mouser / Nexar
      </div>

      {/* CTA footer */}
      <div style={{
        background:'rgba(61,142,240,0.14)',
        border:'1px solid #2a4a7a',
        borderRadius:4,
        padding:'7px 10px',
        fontSize:'0.6rem',
        color:'#7aaee8',
        textAlign:'center',
        fontWeight:'bold',
        letterSpacing:'0.02em',
      }}>
        Click cell to inspect mapped TI parts and full source evidence →
      </div>
    </>;
  }

  const B='#1a2740';
  const isRateLimited = rateLimitedUntil && new Date(rateLimitedUntil) > new Date();

  return(
    <div style={{background:'#080c14',minHeight:'100vh',position:'relative'}}>
      <div style={{position:'fixed',inset:0,backgroundImage:'linear-gradient(rgba(61,142,240,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(61,142,240,0.012) 1px,transparent 1px)',backgroundSize:'36px 36px',pointerEvents:'none'}}/>

      {/* ── Header (Phase 19B+) ── */}
      <div style={{position:'sticky',top:0,zIndex:10,background:'#080c14',borderBottom:`1px solid ${B}`,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontSize:'1rem',fontWeight:'bold',color:'#e0eaf8',letterSpacing:'-0.01em'}}>TI Semiconductor Prices</div>
          {fetchedAt&&<div style={{fontSize:'0.65rem',color:'#7a96b8',marginTop:3}}>
            Updated {new Date(fetchedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
            {fetchCount&&` · ${fetchCount.got}/${fetchCount.total} categories live`}
            {isRateLimited&&<span style={{color:'#f0a84e',marginLeft:6}}>· rate limited (auto-retry)</span>}
          </div>}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={exportCSV} style={{background:'none',border:`1px solid ${B}`,borderRadius:4,padding:'5px 10px',fontSize:'0.67rem',color:'#4a6480',cursor:'pointer'}}>↓ CSV</button>
          <button
            onClick={()=>fetchLive(true)}
            disabled={loading || isRateLimited}
            title={isRateLimited ? `Rate limited — retrying automatically` : 'Refresh live prices from Mouser API'}
            style={{
              background: loading ? '#1a2740' : isRateLimited ? '#1a1000' : '#1565c0',
              border: isRateLimited ? '1px solid #3a2800' : 'none',
              borderRadius:4, padding:'6px 14px', fontSize:'0.72rem',
              color: loading ? '#4a6480' : isRateLimited ? '#8a6020' : '#fff',
              cursor: loading || isRateLimited ? 'not-allowed' : 'pointer',
              display:'flex', alignItems:'center', gap:6
            }}>
            {loading && <span style={{width:7,height:7,border:'1.5px solid #4a6480',borderTopColor:'#fff',borderRadius:'50%',display:'inline-block',animation:'spin 0.7s linear infinite'}}/>}
            {loading ? 'FETCHING…' : isRateLimited ? '⚡ RATE LIMITED' : '⟳ REFRESH LIVE'}
          </button>
        </div>
      </div>

      {/* ── Tab strip (Phase 19B) ── */}
      <div style={{display:'flex',gap:0,borderBottom:`1px solid ${B}`,background:'#050810',padding:'0 12px'}}>
        {[
          {id:'prices', label:'Prices'},
          {id:'inventory', label:'Inventory'},
          {id:'universe', label:'Universe'},
          {id:'insights', label:'Insights'},
        ].map(t=>{
          const on=activeTab===t.id;
          return(
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              style={{
                background:'none',
                border:'none',
                borderBottom: on?'2px solid #3d8ef0':'2px solid transparent',
                padding:'9px 18px',
                fontSize:'0.66rem',
                letterSpacing:'0.16em',
                textTransform:'uppercase',
                color: on?'#e0eaf8':'#4a6a8a',
                cursor:'pointer',
                fontFamily:'monospace',
                fontWeight: on?'bold':'normal',
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab==='prices'&&<>
      {/* ── Group toggles ── */}
      <div style={{display:'flex',gap:5,padding:'7px 16px',borderBottom:`1px solid ${B}`,flexWrap:'wrap',alignItems:'center',background:'#050810'}}>
        <span style={{fontSize:'0.57rem',color:'#2d4a6b',letterSpacing:'0.1em'}}>SHOW:</span>
        {Object.keys(GC).map(g=>{const on=vis.has(g),c=GC[g];return(
          <button key={g} onClick={()=>setVis(prev=>{const n=new Set(prev);n.has(g)?n.delete(g):n.add(g);return n;})} style={{background:on?c+'22':'none',border:`1px solid ${on?c:B}`,borderRadius:3,padding:'2px 8px',fontSize:'0.62rem',color:on?c:'#2d4a6b',cursor:'pointer',transition:'all 0.15s'}}>
            {g} <span style={{opacity:.6,fontSize:'0.52rem'}}>({CATS.filter(x=>x.g===g).length})</span>
          </button>);
        })}
      </div>

      {/* ── Customer-facing legend (clean) ── */}
      <div style={{display:'flex',gap:18,padding:'7px 16px',borderBottom:`1px solid #0d1520`,fontSize:'0.62rem',color:'#7a96b8',flexWrap:'wrap',background:'#050810',alignItems:'center'}}>
        <span><span style={{color:'#00c9a7'}}>■</span> Price increase</span>
        <span><span style={{color:'#f05c5c'}}>■</span> Price decrease</span>
        <span style={{color:'#4a6a8a'}}>· Quarterly rows show QoQ price movement</span>
        <span style={{color:'#4a6a8a'}}>· Live row shows latest available channel check</span>
      </div>

      {/* ── Sources & methodology (collapsed) ── */}
      <details style={{borderBottom:`1px solid #0d1520`,background:'#050810'}}>
        <summary style={{padding:'6px 16px',fontSize:'0.6rem',color:'#4a6a8a',cursor:'pointer',letterSpacing:'0.06em',textTransform:'uppercase',userSelect:'none'}}>Sources &amp; methodology</summary>
        <div style={{padding:'4px 16px 10px',fontSize:'0.62rem',color:'#7a96b8',lineHeight:1.5,maxWidth:880}}>
          TI Direct is treated as the primary catalog source. Distributor APIs are used for channel checks and fallback validation. Historical rows are quarterly price movements; the live row reflects the latest available channel check.
        </div>
      </details>

      {/* ── Table ── */}
      <div style={{overflowX:'auto',position:'relative',zIndex:1}}>
        <table style={{borderCollapse:'collapse',whiteSpace:'nowrap'}}>
          <thead>
            <tr style={{background:'#050810'}}>
              <th rowSpan={2} style={{padding:'6px 12px 6px 16px',textAlign:'left',borderBottom:`1px solid ${B}`,borderRight:`1px solid ${B}`,color:'#2d4a6b',fontWeight:'normal',fontSize:'0.58rem',position:'sticky',left:0,background:'#050810',zIndex:3,minWidth:82,verticalAlign:'bottom'}}>Period</th>
              {grps.map(({g,n})=><th key={g} colSpan={n} style={{padding:'5px 6px',textAlign:'center',borderBottom:`1px solid ${B}`,borderLeft:`1px solid ${B}`,fontWeight:'normal',fontSize:'0.62rem',letterSpacing:'0.04em',color:GC[g]||'#888'}}>{g}</th>)}
            </tr>
            <tr style={{background:'#07090f'}}>
              {visCats.map((c,i)=>{const iF=i===0||visCats[i-1].g!==c.g;return(
                <th key={c.id} style={{padding:'4px 6px',textAlign:'right',borderBottom:`2px solid ${B}`,borderLeft:iF?`1px solid ${B}`:'none',fontWeight:'normal',fontSize:'0.58rem',color:(GC[c.g]||'#888')+'bb',minWidth:80,maxWidth:100,overflow:'hidden',textOverflow:'ellipsis'}}>{c.l}</th>
              );})}
            </tr>
          </thead>
          <tbody>
            {HP.map((p,pi)=>{
              const isLast=p==="Mar-26",isRecent=["Dec-25","Mar-26"].includes(p);
              const bg=isLast?"rgba(61,142,240,0.07)":isRecent?"rgba(61,142,240,0.03)":pi%2===0?"#080c14":"#06080f";
              return(
                <tr key={p} style={{background:bg}}>
                  <td style={{padding:'4px 12px 4px 16px',borderRight:`1px solid ${B}`,borderBottom:`1px solid #0d1520`,fontFamily:'monospace',fontSize:'0.7rem',position:'sticky',left:0,background:bg,zIndex:2,color:isLast?'#3d8ef0':isRecent?'#7aaee8':'#4a6a8a',fontWeight:isRecent?'600':'normal'}}>
                    {isRecent?'→ ':'   '}{p}
                  </td>
                  {visCats.map((c,i)=>{const iF=i===0||visCats[i-1].g!==c.g;const{txt,col,bold}=fmt(HIST[p]?.[c.id]);return(
                    <td key={c.id} style={{padding:'4px 6px',textAlign:'right',borderBottom:`1px solid #0d1520`,borderLeft:iF?`1px solid #0d1520`:'none',fontFamily:'monospace',fontSize:bold?'0.74rem':'0.7rem',color:col,fontWeight:bold?'bold':'normal'}}>{txt}</td>
                  );})}
                </tr>
              );
            })}

            {/* Divider — slim, customer-facing copy only */}
            <tr>
              <td colSpan={visCats.length+1} style={{padding:'0',background:'#0c1018',borderTop:`1px solid ${B}`,borderBottom:`1px solid ${B}`}}>
                <div style={{fontSize:'0.52rem',color:'#2d4a6b',padding:'4px 16px',letterSpacing:'0.1em',display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
                  <span>▼ LIVE {fetchedAt?`· checked ${new Date(fetchedAt).toLocaleString()}`:'· click REFRESH LIVE to load'}</span>
                  {isRateLimited && <span style={{color:'#f0a84e'}}>⚡ RATE LIMITED — auto-retry scheduled</span>}
                </div>
              </td>
            </tr>

            {/* Live row */}
            <tr style={{background:'rgba(255,215,0,0.035)'}}>
              <td style={{padding:'6px 12px 6px 16px',borderRight:`1px solid ${B}`,borderBottom:`1px solid ${B}`,fontFamily:'monospace',fontSize:'0.72rem',position:'sticky',left:0,background:'rgba(20,17,2,0.97)',zIndex:2,color:'#ffd700',fontWeight:'bold'}}>
                {loading
                  ? <span style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{width:6,height:6,border:'1.5px solid #4a6480',borderTopColor:'#ffd700',borderRadius:'50%',display:'inline-block',animation:'spin 0.7s linear infinite'}}/>
                      Loading…
                    </span>
                  : '★ Live'}
              </td>
              {visCats.map((c,i)=>{
                const iF=i===0||visCats[i-1].g!==c.g;
                const d=liveData?.[c.id];
                const v=d?.qoqPct;
                const isLive=d&&!d.error&&d.parts?.length>0;
                const isRLCell = d?.error?.includes('Rate limit');
                const hasBasket=!!basketCatFor(c.id);
                // Phase 24C / 24C.2 — TI Direct full-catalog rollup availability
                // for this canonical subcategory. Drives the small "TI"
                // marker AND lets us reach hover even when Mouser/Nexar
                // are silent (rate-limited or out-of-basket). Phase 24C.2
                // gates the marker color + warning on the server-supplied
                // qualityLabel (high|medium|low|mixed) so contaminated
                // rollups appear as caution rather than clean signal.
                const canonicalForCell = combinedEvidence?.legacyToCanonical?.[c.id];
                const tiRollup = canonicalForCell ? tiRollupsByCanonical[canonicalForCell] : null;
                const hasTiRollup = !!tiRollup;
                const tiQualityLabel = tiRollup?.qualityLabel || 'unknown';
                const tiUsable = tiRollup?.usableForPricesLiveEvidence === true;
                const tiBadgeColor = tiQualityLabel === 'high'   ? '#4dffc3'
                                   : tiQualityLabel === 'medium' ? '#00c9a7'
                                   : tiQualityLabel === 'low'    ? '#f0a84e'
                                   : tiQualityLabel === 'mixed'  ? '#f0a84e'
                                   : '#7a96b8';
                const tiBadgeOpacity = tiUsable ? 1 : 0.55;
                const tiBadgeTitle = !hasTiRollup
                  ? undefined
                  : tiUsable
                    ? `TI Direct full-catalog rollup available (${tiQualityLabel} mapping quality) — hover for detail`
                    : `TI Direct rollup is broad/experimental for this category (${tiQualityLabel}); use as context, not signal.`;
                // Hover fires when Mouser is live OR Nexar basket has cross-source
                // data — so a Mouser rate-limited cell still surfaces the Nexar
                // section (Phase 9: cross-source enrichment must be reachable).
                // Phase 24C: TI Direct rollup also opens the tooltip so the
                // 72k-OPN evidence is reachable from any mapped cell.
                const hasTooltip = isLive || hasBasket || hasTiRollup;
                // Phase 24D — when a TI rollup exists, clicking the cell
                // hops to the Universe tab pre-filtered to this canonical
                // subcategory's drilldown. Carries qualityLabel +
                // qualityWarning + a human-readable display label so the
                // panel banner makes sense at a glance.
                const handleClick = hasTiRollup ? () => {
                  setUniverseFilter({
                    canonicalSubcategory: canonicalForCell,
                    canonicalGroup: tiRollup?.canonicalGroup ?? null,
                    qualityLabel: tiQualityLabel,
                    qualityWarning: tiRollup?.qualityWarning ?? null,
                    displayLabel: c.l,
                    sourceCellId: c.id,
                    usable: tiUsable,
                  });
                  setActiveTab('universe');
                } : undefined;
                const{txt,col,bold}=v!=null?fmt(v):{txt:loading?'…':isRLCell?'⚡':'—',col:isRLCell?'#3a2800':'#2a4060',bold:false};
                return(
                  <td key={c.id}
                    className={handleClick?'tdc':undefined}
                    onMouseEnter={hasTooltip?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseMove={hasTooltip?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseLeave={hasTooltip?()=>setTooltip(null):undefined}
                    onClick={handleClick}
                    title={isRLCell?'Rate limited — will retry automatically':hasTiRollup?'Click to inspect mapped TI parts in Universe tab':undefined}
                    style={{padding:'5px 6px',textAlign:'right',borderBottom:`1px solid ${B}`,borderLeft:iF?`1px solid #0d1520`:'none',fontFamily:'monospace',fontSize:bold?'0.76rem':'0.72rem',color:d?.error?isRLCell?'#4a3010':'#2d4a6b':col,fontWeight:bold?'bold':'normal',cursor:handleClick?'pointer':hasTooltip?'crosshair':'default'}}>
                    {txt}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      </>}

      {activeTab==='inventory'&&<InventoryPanel/>}

      {activeTab==='universe'&&<UniversePanel
        initialFilter={universeFilter}
        onClearFilter={()=>setUniverseFilter(null)}
      />}

      {activeTab==='insights'&&<InsightsPanel
        liveData={liveData}
        baselineMeta={baselineMeta}
        combinedEvidence={combinedEvidence}
        trendMeta={trendMeta}
        tiStatus={tiStatus}
        tiRollupsByCanonical={tiRollupsByCanonical}
        tiTrendByCanonical={tiTrendByCanonical}
      />}

      {/* Tooltip — applies on prices tab when hovering live cells.
          Phase 24C.4 — first render uses the cursor-anchored fallback
          position (so the tooltip doesn't flicker on first frame); the
          useEffect measures the rendered tooltip height + flips above
          the cursor when it would clip the viewport bottom, then
          re-renders with the corrected top. */}
      {activeTab==='prices'&&tooltip&&(liveData?.[tooltip.catId]||basketCatFor(tooltip.catId)||evidenceCatFor(tooltip.catId)||tiRollupsByCanonical[combinedEvidence?.legacyToCanonical?.[tooltip.catId]])&&(
        <div
          ref={tooltipRef}
          className="tt"
          style={tooltipPos ? { top: tooltipPos.top, left: tooltipPos.left } : { top: tooltip.y+14, left: Math.min(tooltip.x+14, window.innerWidth-360), visibility: 'hidden' }}
        >
          <TT catId={tooltip.catId}/>
        </div>
      )}

      {/* Toast stack */}
      <div className="toast-wrap">
        {toasts.map(t => <ToastShell key={t.id} toast={t} onDismiss={dismiss}/>)}
      </div>

      {/* Slim global footer */}
      <div style={{padding:'8px 16px 14px',borderTop:`1px solid #0d1520`,fontSize:'0.53rem',color:'#1a2740',display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:4,marginTop:4}}>
        <span>USD · {HP.length} quarters of history + live</span>
        <span>TI Product Price Intelligence</span>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
