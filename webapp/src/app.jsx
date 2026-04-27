const { useState, useEffect, useCallback, useRef } = React;
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
  "Mar-26":{pm_ldo:-0.2,pm_acdc:-0.7,pm_dcdc:-0.1,pm_super:-0.9,pm_batt:0.2,amp_op:0.0,amp_instr:-0.7,amp_audio:-0.4,dac_adc:1.5,dac_dac:0.0,if_can:2.1,if_lin:1.7,if_eth:-0.6,iso_dig:0.1,iso_rein:1.0,mcu_msp:0.9,mcu_c2k:-0.4,mcu_m0:0.4,mcu_cc:0.4,mcu_sit:0.1,gan_342:1.1,gan_365:1.5,gan_520:0.8,dc_48v:4.9,dc_sps:1.6,dc_efuse:-0.2,dc_hswap:0.9,dc_tps:4.0},
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
  const { toasts, push, dismiss } = useToasts();
  const rateLimitToastId = useRef(null);
  const retryTimer = useRef(null);

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
        const age = json.cachedAt ? Math.round((Date.now() - new Date(json.cachedAt)) / 60000) : '?';
        push(`Showing cached data from ${age} min ago — next auto-refresh in ${Math.round((json.nextRefreshMs||0)/60000)} min`, 'info', 5000);
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
        const got = json.fetchedCount ?? '?';
        const total = json.totalCount ?? 28;
        push(`Live prices loaded — ${got}/${total} categories fetched from Mouser`, 'success', 5000);
        setRateLimitedUntil(null);
        if (retryTimer.current) clearTimeout(retryTimer.current);
      }
    } catch(e) {
      push(`Failed to load live prices: ${e.message}`, 'error', 8000);
    }
    setLoading(false);
  }, [push, dismiss]);

  useEffect(() => { fetchLive(false); return () => { if(retryTimer.current) clearTimeout(retryTimer.current); }; }, []);

  function exportCSV(){
    const rows=[['Period',...visCats.map(c=>c.l)]];
    HP.forEach(p=>rows.push([p,...visCats.map(c=>HIST[p]?.[c.id]??'')]));
    if(liveData)rows.push(['QTD Mar-26 LIVE',...visCats.map(c=>liveData[c.id]?.qoqPct??'')]);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'}));
    a.download=`ti_prices_${new Date().toISOString().slice(0,10)}.csv`;a.click();
  }

  function TT({catId}){
    const d=liveData?.[catId];if(!d)return null;
    const cat=CATS.find(c=>c.id===catId);
    return <>
      <div style={{fontSize:'0.65rem',color:'#ffd700',marginBottom:6,fontWeight:'bold'}}>{cat?.l} · Mouser qty=1 · vs 27-Feb-26 anchor</div>
      {d.parts?.length>0?d.parts.map((p,i)=>(
        <div key={i} style={{fontSize:'0.6rem',marginBottom:3,display:'flex',justifyContent:'space-between',gap:14}}>
          <span style={{color:'#c4d4e8',fontFamily:'monospace'}}>{p.part}</span>
          <span style={{color:'#00c9a7',fontFamily:'monospace'}}>${p.price?.toFixed(4)}</span>
          <span style={{color:p.availability?.includes('In Stock')?'#00c9a7':'#f05c5c',fontSize:'0.52rem'}}>{p.availability||'—'}</span>
        </div>
      )):<div style={{fontSize:'0.58rem',color:'#f05c5c'}}>{d.error||'No live data'}</div>}
      <div style={{marginTop:5,paddingTop:4,borderTop:'1px solid #1a2740',fontSize:'0.52rem',color:'#2d4a6b'}}>
        Live ${d.avgPriceUSD?.toFixed(4)} · Anchor ${d.baselinePriceUSD?.toFixed(4)} · Δ={(d.avgPriceUSD&&d.baselinePriceUSD?(((d.avgPriceUSD-d.baselinePriceUSD)/d.baselinePriceUSD)*100).toFixed(1):'—')}% · qty=1 · Mouser
      </div>
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
        <span style={{color:'#ffd700'}}>★ QTD Mar-26 = live Mouser qty=1 spot price ÷ 27-Feb-26 anchor · same SKU, same qty break · hover for detail</span>
      </div>

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
                <div style={{fontSize:'0.52rem',color:'#2d4a6b',padding:'3px 16px',letterSpacing:'0.1em',display:'flex',gap:14,alignItems:'center'}}>
                  <span>▼ LIVE DATA — MOUSER ELECTRONICS API {fetchedAt?`· fetched ${new Date(fetchedAt).toLocaleString()}`:'· click REFRESH LIVE to load'}</span>
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
                  : '★ QTD'}
              </td>
              {visCats.map((c,i)=>{
                const iF=i===0||visCats[i-1].g!==c.g;
                const d=liveData?.[c.id];
                const v=d?.qoqPct;
                const isLive=d&&!d.error&&d.parts?.length>0;
                const isRLCell = d?.error?.includes('Rate limit');
                const{txt,col,bold}=v!=null?fmt(v):{txt:loading?'…':isRLCell?'⚡':'—',col:isRLCell?'#3a2800':'#2a4060',bold:false};
                return(
                  <td key={c.id}
                    onMouseEnter={isLive?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseMove={isLive?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseLeave={isLive?()=>setTooltip(null):undefined}
                    title={isRLCell?'Rate limited — will retry automatically':undefined}
                    style={{padding:'5px 6px',textAlign:'right',borderBottom:`1px solid ${B}`,borderLeft:iF?`1px solid #0d1520`:'none',fontFamily:'monospace',fontSize:bold?'0.76rem':'0.72rem',color:d?.error?isRLCell?'#4a3010':'#2d4a6b':col,fontWeight:bold?'bold':'normal',cursor:isLive?'crosshair':'default'}}>
                    {txt}{isLive&&<sup style={{fontSize:'0.42rem',color:'#ffd700',marginLeft:1}}>L</sup>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tooltip */}
      {tooltip&&liveData?.[tooltip.catId]&&(
        <div className="tt" style={{top:tooltip.y+14,left:Math.min(tooltip.x+14,window.innerWidth-360)}}>
          <TT catId={tooltip.catId}/>
        </div>
      )}

      {/* Toast stack */}
      <div className="toast-wrap">
        {toasts.map(t => <ToastShell key={t.id} toast={t} onDismiss={dismiss}/>)}
      </div>

      <div style={{padding:'8px 16px 16px',borderTop:`1px solid #0d1520`,fontSize:'0.53rem',color:'#1a2740',display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:4,marginTop:4}}>
        <span>Historical: verified QoQ % Jun-22→Mar-26 · Live row: Mouser qty=1 spot vs 27-Feb-26 anchor · same SKU &amp; qty break guaranteed · USD · INR→USD ₹83.5/$</span>
        <span>TI Product Price Intelligence · Professional use only</span>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
