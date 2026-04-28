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
  if(v==null)return{txt:"—",col:"#2a4060",bold:false};
  if(Math.abs(v)<0.05)return{txt:"—",col:"#2a4060",bold:false};
  const big=Math.abs(v)>=5,pos=v>0;
  return{txt:pos?`+${v.toFixed(1)}%`:`(${Math.abs(v).toFixed(1)}%)`,col:pos?(big?"#4dffc3":"#00c9a7"):(big?"#ff7575":"#f05c5c"),bold:big};
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

// ── App ───────────────────────────────────────────────────────────────────────
function App(){
  const [liveData,setLiveData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [fetchedAt,setFetchedAt]=useState(null);
  const [src,setSrc]=useState('');
  const [fetchCount,setFetchCount]=useState(null);
  const [vis,setVis]=useState(new Set(Object.keys(GC)));
  const [tooltip,setTooltip]=useState(null);
  const [rateLimitedUntil,setRateLimitedUntil]=useState(null);
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
      push('Rate limit cleared — auto-refreshing live prices…', 'info', 4000);
      fetchLive(true, true);
    }, ms);
  }

  const fetchLive = useCallback(async(force=false, silent=false) => {
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
        setRateLimitedUntil(new Date(Date.now() + 65_000).toISOString());
        const retryAt2 = new Date(Date.now() + 65_000).toISOString();
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
        setRateLimitedUntil(null);
        if (retryTimer.current) clearTimeout(retryTimer.current);
      }
    } catch(e) {
      push(`Failed to load live prices: ${e.message}`, 'error', 8000);
    }
    setLoading(false);
  }, [push, dismiss]);

  useEffect(() => { fetchLive(false); return () => { if(retryTimer.current) clearTimeout(retryTimer.current); }; }, []);

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
        const [latestRes, trendsRes, evidenceRes, coverageRes, combinedRes] = await Promise.allSettled([
          fetch('/api/snapshots/latest').then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/trends?days=30').then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/evidence/latest').then(r => r.ok ? r.json() : null),
          fetch('/api/nexar/basket-coverage').then(r => r.ok ? r.json() : null),
          fetch('/api/snapshots/evidence/combined').then(r => r.ok ? r.json() : null),
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
    const confColor=confidence==='multi-source'?'#00c9a7':confidence==='single-source'?'#f0a84e':'#f05c5c';
    return <>
      <div style={{fontSize:'0.65rem',color:'#ffd700',marginBottom:6,fontWeight:'bold'}}>{cat?.l}{catId==='gan_365'?<span style={{color:'#f0a84e',fontSize:'0.55rem',marginLeft:6}}>⚠ reel/2000 price — no unit break</span>:null} · Mouser qty=1 · vs latest baseline (28-Apr-26)</div>
      {d?(d.parts?.length>0?d.parts.map((p,i)=>(
        <div key={i} style={{fontSize:'0.6rem',marginBottom:3,display:'flex',justifyContent:'space-between',gap:14}}>
          <span style={{color:'#c4d4e8',fontFamily:'monospace'}}>{p.part}</span>
          <span style={{color:'#00c9a7',fontFamily:'monospace'}}>${p.price?.toFixed(4)}</span>
          <span style={{color:p.availability?.includes('In Stock')?'#00c9a7':'#f05c5c',fontSize:'0.52rem'}}>{p.availability||'—'}</span>
        </div>
      )):<div style={{fontSize:'0.58rem',color:'#f05c5c'}}>{d.error||'No live data'}</div>):<div style={{fontSize:'0.58rem',color:'#7a96b8'}}>No Mouser live data yet</div>}
      {d&&<div style={{marginTop:5,paddingTop:4,borderTop:'1px solid #1a2740',fontSize:'0.52rem',color:'#2d4a6b'}}>
        Live ${d.avgPriceUSD?.toFixed(4)} · Baseline ${d.baselinePriceUSD?.toFixed(4)} · Δ={(d.avgPriceUSD&&d.baselinePriceUSD?(((d.avgPriceUSD-d.baselinePriceUSD)/d.baselinePriceUSD)*100).toFixed(1):'—')}% · qty=1 · Mouser
      </div>}
      {basket&&<div style={{marginTop:7,paddingTop:6,borderTop:'1px solid #1a2740'}}>
        <div style={{fontSize:'0.6rem',color:'#3d8ef0',fontWeight:'bold',marginBottom:3}}>
          Nexar trusted basket check
          <span style={{color:'#f0a84e',fontWeight:'normal',marginLeft:5,fontSize:'0.52rem'}}>· tiny basket preview, not full coverage</span>
        </div>
        <div style={{fontSize:'0.55rem',color:'#c4d4e8',lineHeight:1.55,fontFamily:'monospace'}}>
          <div>Coverage: {basket.skuCount} SKUs / {basket.quotedSkuCount} quoted ({basket.sampleCoverage})</div>
          <div>Avg trusted available: <span style={{color:'#00c9a7'}}>${basket.avgBestTrustedAvailableUnitPrice?.toFixed(4) ?? '—'}</span></div>
          <div>Median trusted available: <span style={{color:'#00c9a7'}}>${basket.medianBestTrustedAvailableUnitPrice?.toFixed(4) ?? '—'}</span></div>
          <div>Trusted inventory: {(basket.totalTrustedAvailableInventory||0).toLocaleString()}</div>
          <div>Broker inventory: {(basket.totalBrokerAvailableInventory||0).toLocaleString()} <span style={{color:'#7a96b8'}}>(separate, excluded from core signal)</span></div>
          <div style={{whiteSpace:'normal'}}>Trusted distributors: {(basket.trustedDistributorCoverage||[]).join(', ')||'—'}</div>
          <div>Source coverage confidence: <span style={{color:confColor,fontWeight:'bold'}}>{confidence}</span></div>
        </div>
      </div>}
      {evid&&(()=>{
        const evColor = evid.evidenceStatus==='strong_current_evidence'?'#4dffc3'
                      : evid.evidenceStatus==='moderate_current_evidence'?'#00c9a7'
                      : evid.evidenceStatus==='weak_current_evidence'?'#f0a84e'
                      : '#f05c5c';
        const trendStr = trendMeta?.status==='ok' ? `available (${trendMeta.observationCount} obs)` : 'pending until 2 daily snapshots';
        const dupTotal = (evid.skus||[]).reduce((s,x)=>s+(x.duplicateObservationCount||0),0);
        const cov = coverageCatFor(catId);
        return (
          <div style={{marginTop:7,paddingTop:6,borderTop:'1px solid #1a2740'}}>
            <div style={{fontSize:'0.6rem',color:'#7a96b8',fontWeight:'bold',marginBottom:3}}>
              Snapshot evidence <span style={{color:'#4a6a8a',fontWeight:'normal'}}>· {evid.snapshotDate}</span>
            </div>
            <div style={{fontSize:'0.55rem',color:'#c4d4e8',lineHeight:1.55,fontFamily:'monospace'}}>
              <div>Confidence: <span style={{color:evColor,fontWeight:'bold'}}>{evid.sourceConfidenceScore}/100 · {evid.evidenceStatus.replace(/_current_evidence$/,'').replace(/_/g,' ')}</span></div>
              <div>Trusted distributors ({evid.trustedDistributorCount}): <span style={{color:'#c4d4e8'}}>{(evid.trustedDistributors||[]).join(', ')||'—'}</span></div>
              <div>Trusted inventory: {(evid.totalTrustedInventory||0).toLocaleString()}</div>
              <div>Broker inventory: {(evid.totalBrokerInventory||0).toLocaleString()} <span style={{color:'#7a96b8'}}>(excluded from core signal)</span></div>
              {evid.failedSkuCount>0&&<div style={{color:'#f0a84e'}}>Failed SKUs: {evid.failedSkuCount} of {evid.representativeSkuCount}</div>}
              {dupTotal>0&&<div style={{color:'#7a96b8'}}>Deduped observations: {dupTotal}</div>}
              {cov&&<div style={{color:'#7a96b8'}}>Representative coverage: sampled {cov.sampledSkuCount} of {cov.skuCount} monitored SKUs{cov.unsampledSkuCount>0?<span style={{color:'#f0a84e'}}> · {cov.unsampledSkuCount} watchlist pending higher quota</span>:null}</div>}
              {coverageData?.samplingPolicy==='anchor_plus_rotation'&&<div style={{color:'#7a96b8'}}>Sampling policy: anchor + rotation</div>}
              {cov&&!cov.sampledToday&&cov.nextExpectedSampleDate&&<div style={{color:'#f0a84e'}}>Watchlist category — next expected sample: {cov.nextExpectedSampleDate}</div>}
              <div style={{color:'#7a96b8',fontStyle:'italic',marginTop:2}}>Current source evidence only — trend signal {trendStr}.</div>
            </div>
          </div>
        );
      })()}
      {agree&&(combinedEvidence?.latestMouserSnapshotDate||combinedEvidence?.latestNexarSnapshotDate)&&(()=>{
        const aColor = agree.agreementStatus==='strong_agreement'?'#4dffc3'
                    : agree.agreementStatus==='moderate_agreement'?'#00c9a7'
                    : agree.agreementStatus==='divergent'?'#f0a84e'
                    : agree.agreementStatus==='single_source_only'?'#7a96b8'
                    : '#4a6a8a';
        const aLabel = agree.agreementStatus.replace(/_/g,' ');
        return (
          <div style={{marginTop:7,paddingTop:6,borderTop:'1px solid #1a2740'}}>
            <div style={{fontSize:'0.6rem',color:'#7a96b8',fontWeight:'bold',marginBottom:3}}>
              Combined source evidence
              <span style={{color:'#4a6a8a',fontWeight:'normal',marginLeft:5,fontSize:'0.52rem'}}>· Mouser backbone + Nexar rotating</span>
            </div>
            <div style={{fontSize:'0.55rem',color:'#c4d4e8',lineHeight:1.55,fontFamily:'monospace'}}>
              {combinedEvidence?.latestMouserSnapshotDate&&<div>Mouser latest: {combinedEvidence.latestMouserSnapshotDate}</div>}
              {combinedEvidence?.latestNexarSnapshotDate&&<div>Nexar latest: {combinedEvidence.latestNexarSnapshotDate}</div>}
              <div>Agreement: <span style={{color:aColor,fontWeight:'bold'}}>{aLabel}</span></div>
              {agree.mouserPrice!=null&&agree.nexarTrustedPrice!=null&&<div>Price: Mouser ${agree.mouserPrice.toFixed(4)} · Nexar ${agree.nexarTrustedPrice.toFixed(4)} · Δ {agree.priceDeltaPct!=null?`${agree.priceDeltaPct>0?'+':''}${agree.priceDeltaPct}%`:'—'}</div>}
              {agree.mouserPrice!=null&&agree.nexarTrustedPrice==null&&<div>Price: Mouser ${agree.mouserPrice.toFixed(4)} · Nexar —</div>}
              {agree.mouserPrice==null&&agree.nexarTrustedPrice!=null&&<div>Price: Mouser — · Nexar ${agree.nexarTrustedPrice.toFixed(4)}</div>}
              {(agree.mouserInventory!=null||agree.nexarTrustedInventory!=null)&&<div>Inventory: Mouser {(agree.mouserInventory||0).toLocaleString()} · Nexar {(agree.nexarTrustedInventory||0).toLocaleString()}{agree.inventoryDeltaPct!=null?` · Δ ${agree.inventoryDeltaPct>0?'+':''}${agree.inventoryDeltaPct}%`:''}</div>}
              <div style={{color:'#7a96b8',fontStyle:'italic',marginTop:2}}>Source agreement only — shortage/easing labels still gated by ≥2 dated snapshots.</div>
            </div>
          </div>
        );
      })()}
    </>;
  }

  const B='#1a2740';
  const isRateLimited = rateLimitedUntil && new Date(rateLimitedUntil) > new Date();

  return(
    <div style={{background:'#080c14',minHeight:'100vh',position:'relative'}}>
      <div style={{position:'fixed',inset:0,backgroundImage:'linear-gradient(rgba(61,142,240,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(61,142,240,0.012) 1px,transparent 1px)',backgroundSize:'36px 36px',pointerEvents:'none'}}/>

      {/* ── Header ── */}
      <div style={{position:'sticky',top:0,zIndex:10,background:'#080c14',borderBottom:`1px solid ${B}`,padding:'10px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontSize:'0.57rem',letterSpacing:'0.18em',color:'#2d4a6b',textTransform:'uppercase'}}><span style={{color:'#3d8ef0'}}>TI</span> / PRODUCT PRICE INTELLIGENCE · QoQ % CHANGE</div>
          <div style={{fontSize:'0.9rem',fontWeight:'bold',color:'#e0eaf8'}}>Semiconductor Price Monitor <span style={{fontSize:'0.57rem',color:'#2d4a6b',fontWeight:'normal',marginLeft:10}}>{CATS.length} categories · {HP.length} verified qtrs + live</span></div>
          {fetchedAt&&<div style={{fontSize:'0.56rem',color:'#2d4a6b',marginTop:1}}>
            Live row: <span style={{color:src==='live'?'#00c9a7':'#f0a84e'}}>{src==='live'?'● FRESH':'● CACHED'}</span>
            {' · '}{new Date(fetchedAt).toLocaleString()}
            {fetchCount&&` · ${fetchCount.got}/${fetchCount.total} categories live`}
            {isRateLimited&&<span style={{color:'#f0a84e',marginLeft:6}}>⚡ partial — rate limited</span>}
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

      {/* ── Group toggles ── */}
      <div style={{display:'flex',gap:5,padding:'7px 16px',borderBottom:`1px solid ${B}`,flexWrap:'wrap',alignItems:'center',background:'#050810'}}>
        <span style={{fontSize:'0.57rem',color:'#2d4a6b',letterSpacing:'0.1em'}}>SHOW:</span>
        {Object.keys(GC).map(g=>{const on=vis.has(g),c=GC[g];return(
          <button key={g} onClick={()=>setVis(prev=>{const n=new Set(prev);n.has(g)?n.delete(g):n.add(g);return n;})} style={{background:on?c+'22':'none',border:`1px solid ${on?c:B}`,borderRadius:3,padding:'2px 8px',fontSize:'0.62rem',color:on?c:'#2d4a6b',cursor:'pointer',transition:'all 0.15s'}}>
            {g} <span style={{opacity:.6,fontSize:'0.52rem'}}>({CATS.filter(x=>x.g===g).length})</span>
          </button>);
        })}
      </div>

      {/* ── Legend ── */}
      <div style={{display:'flex',gap:10,padding:'3px 16px',borderBottom:`1px solid #0d1520`,fontSize:'0.57rem',color:'#2d4a6b',flexWrap:'wrap',background:'#050810'}}>
        <span style={{color:'#00c9a7'}}>■ positive</span><span style={{color:'#f05c5c'}}>■ negative (brackets)</span>
        <span style={{color:'#4dffc3',fontWeight:'bold'}}>■ bold ≥5%</span><span>·</span>
        <span style={{color:'#ffd700'}}>Historical rows = QoQ price change vs prior quarter / captured period · ★ Live = Mouser qty=1 spot vs latest baseline · same SKU &amp; qty break · L superscript = live Mouser datapoint · early-warning monitor, not a finalized quarterly row · hover for detail</span>
        <span style={{color:'#f0a84e',marginLeft:6}}>· LMG3650 tracks reel/2000 price (no unit break on Mouser)</span>
        <span style={{color:'#3d8ef0',marginLeft:6}}>· NX marker = Nexar trusted basket preview available for that category (tiny sample only; broker inventory excluded from core signal)</span>
        <span style={{color:'#7a96b8',marginLeft:6}}>· Snapshot memory: {snapshotMeta?(snapshotMeta.configured?'configured':'not configured'):'…'}{snapshotMeta?` · latest snapshot: ${snapshotMeta.latestSnapshotDate||'none'}`:''}{evidenceData?.evidence?` · Source evidence: ${({strong_current_evidence:'strong',moderate_current_evidence:'moderate',weak_current_evidence:'weak',insufficient_current_evidence:'insufficient'})[evidenceData.evidence.overallEvidenceStatus]||'pending'} (${evidenceData.evidence.overallSourceConfidenceScore}/100)`:''}{evidenceData?.coverage?` · Basket coverage: ${evidenceData.coverage.sampledSkuCount} / ${evidenceData.coverage.basketCatalogSkuCount} sampled today${evidenceData.coverage.samplingPolicy==='anchor_plus_rotation'?' · rotating coverage':''}${evidenceData.coverage.estimatedFullCycleDays?` · full cycle ~${evidenceData.coverage.estimatedFullCycleDays} days`:''}`:''}{trendMeta?` · Trend signal: ${trendMeta.status==='ok'?'ready':trendMeta.status==='insufficient_history'?'pending until 2 daily snapshots':trendMeta.status==='no_data'?'no data':trendMeta.status==='snapshot_storage_not_configured'?'not configured':trendMeta.status}`:''}</span>
        <span style={{color:'#7a96b8',marginLeft:6}}>· Taxonomy: 28 TI subcategories · Mouser backbone · Nexar rotating corroboration{combinedEvidence?.latestMouserSnapshotDate?` · Mouser snapshot ${combinedEvidence.latestMouserSnapshotDate}`:''}{combinedEvidence?.latestNexarSnapshotDate?` · Nexar snapshot ${combinedEvidence.latestNexarSnapshotDate}`:''}</span>
      </div>

      {/* ── Signal Summary ── */}
      <SignalSummary liveData={liveData} baselineMeta={baselineMeta}/>

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

            {/* Divider */}
            <tr>
              <td colSpan={visCats.length+1} style={{padding:'0',background:'#0c1018',borderTop:`1px solid ${B}`,borderBottom:`1px solid ${B}`}}>
                <div style={{fontSize:'0.52rem',color:'#2d4a6b',padding:'3px 16px',letterSpacing:'0.1em',display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
                  <span>▼ LIVE PRICE MONITOR — MOUSER QTY=1 SPOT vs LATEST BASELINE · Q1-26 CLOSE CAPTURED 28-APR-26 {fetchedAt?`· fetched ${new Date(fetchedAt).toLocaleString()}`:'· click REFRESH LIVE to load'}</span>
                  {isRateLimited && <span style={{color:'#f0a84e'}}>⚡ RATE LIMITED — auto-retry scheduled</span>}
                  <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>
                    {basketPreviewData&&<span style={{color:'#3d8ef0'}}>NX: {(basketPreviewData.categories||[]).filter(c=>(c.quotedSkuCount||0)>0).length} cats · {basketPreviewData.cached?'cached':'fresh'} · TTL {basketPreviewData.cacheTtlHours||24}h</span>}
                    <button
                      onClick={()=>fetchBasketPreview(true)}
                      disabled={basketLoading}
                      title={basketLoading?'Refreshing…':'Manually refresh Nexar basket source check — uses Nexar eval quota'}
                      style={{background:'none',border:`1px solid ${B}`,borderRadius:3,padding:'2px 7px',fontSize:'0.5rem',color:basketLoading?'#4a6480':'#3d8ef0',cursor:basketLoading?'not-allowed':'pointer',letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'inherit'}}>
                      ⟳ {basketLoading?'REFRESHING':'REFRESH BASKET SOURCE CHECK'}
                    </button>
                  </span>
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
                // Hover fires when Mouser is live OR Nexar basket has cross-source
                // data — so a Mouser rate-limited cell still surfaces the Nexar
                // section (Phase 9: cross-source enrichment must be reachable).
                const hasTooltip = isLive || hasBasket;
                const{txt,col,bold}=v!=null?fmt(v):{txt:loading?'…':isRLCell?'⚡':'—',col:isRLCell?'#3a2800':'#2a4060',bold:false};
                return(
                  <td key={c.id}
                    onMouseEnter={hasTooltip?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseMove={hasTooltip?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseLeave={hasTooltip?()=>setTooltip(null):undefined}
                    title={isRLCell?'Rate limited — will retry automatically':undefined}
                    style={{padding:'5px 6px',textAlign:'right',borderBottom:`1px solid ${B}`,borderLeft:iF?`1px solid #0d1520`:'none',fontFamily:'monospace',fontSize:bold?'0.76rem':'0.72rem',color:d?.error?isRLCell?'#4a3010':'#2d4a6b':col,fontWeight:bold?'bold':'normal',cursor:hasTooltip?'crosshair':'default'}}>
                    {txt}{isLive&&<sup style={{fontSize:'0.42rem',color:'#ffd700',marginLeft:1}}>L</sup>}{hasBasket&&<sup style={{fontSize:'0.42rem',color:'#3d8ef0',marginLeft:1}} title="Nexar trusted basket preview available — hover for detail">NX</sup>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tooltip */}
      {tooltip&&(liveData?.[tooltip.catId]||basketCatFor(tooltip.catId)||evidenceCatFor(tooltip.catId))&&(
        <div className="tt" style={{top:tooltip.y+14,left:Math.min(tooltip.x+14,window.innerWidth-360)}}>
          <TT catId={tooltip.catId}/>
        </div>
      )}

      {/* Toast stack */}
      <div className="toast-wrap">
        {toasts.map(t => <ToastShell key={t.id} toast={t} onDismiss={dismiss}/>)}
      </div>

      <div style={{padding:'8px 16px 16px',borderTop:`1px solid #0d1520`,fontSize:'0.53rem',color:'#1a2740',display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:4,marginTop:4}}>
        <span>Historical rows: QoQ product price changes (Jun-22→Mar-26) · Live row (★): current Mouser qty=1 spot vs latest baseline · Latest baseline: Q1-26 close captured 28-Apr-26 · L = live datapoint · same SKU &amp; qty break · USD · INR→USD ₹83.5/$ · Early-warning monitor, not a finalized quarterly row</span>
        <span>TI Product Price Intelligence · Professional use only</span>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
