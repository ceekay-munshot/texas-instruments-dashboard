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
// Phase 25.2 — TI Direct QTD baseline anchor (Mar-26 / Q1-26 close).
//
// The Prices QTD row compares the latest TI Direct catalog rollup median
// normalized unit price against a quarter-close TI Direct baseline:
//
//     QTD% = (latestTiMedian − baselineTiMedian) / baselineTiMedian × 100
//
// Today this map is INTENTIONALLY EMPTY — no Q1-26 close TI Direct
// snapshot has been captured. The `ti_catalog_rollup_history` D1 table
// only began recording in Phase 24C, so its earliest rows are well after
// Mar-26. With the map empty the row renders '—' for every cell with a
// "QTD baseline price unavailable" tooltip; it does NOT fall back to a
// latest-vs-previous-snapshot delta (that delta is too noisy for a
// customer-facing QTD value because TI catalog prices rarely move day to
// day) nor to the Mouser qty-1 BASELINES constant (those are Mouser
// prices, not TI Direct medians, and would mix sources).
//
// To enable the row, populate this map (or wire it to a dedicated
// /api/ti/universe/catalog/baselines endpoint) with one entry per
// canonical subcategory. Schema:
//
//   '<canonicalSubcategory>': {
//     baselineMedianPrice: <number, USD per normalized unit>,
//     baselineCapturedAt:  '<YYYY-MM-DD>',  // when the snapshot was taken
//     baselinePeriod:      'Q1-26 close',   // human-readable label
//   }
//
// Cells whose canonical subcategory is missing from this map continue
// to render '—'. Mixed populations are fine: filled subcategories
// compute a real QTD %, the rest stay '—'.
const TI_QTD_BASELINE_Q1_26 = {};
const TI_QTD_BASELINE_PERIOD_LABEL = 'Mar-26 / Q1-26 close';

// Phase 25.1 — bundled canonical mapping. Mirrors LEGACY_TO_CANONICAL in
// src/data/tiTaxonomy.ts so the QTD row's flash-suppression gate can
// recognise canonical-mapped cells from first paint, before the
// /api/snapshots/evidence/combined response arrives. Keep in sync with
// the .ts file — every legacy id rendered in CATS must appear here.
const STATIC_LEGACY_TO_CANONICAL = {
  pm_ldo: 'power_ldo',
  pm_acdc: 'power_acdc_switching',
  pm_dcdc: 'power_dcdc_switching',
  pm_super: 'power_supervisor_reset',
  pm_batt: 'power_battery_mgmt',
  amp_op: 'amp_opamps',
  amp_instr: 'amp_instrumentation',
  amp_audio: 'amp_audio',
  dac_adc: 'conv_adc',
  dac_dac: 'conv_dac',
  if_can: 'interface_can',
  if_lin: 'interface_lin',
  if_eth: 'interface_ethernet_phy',
  iso_dig: 'isolation_digital',
  iso_rein: 'isolation_reinforced',
  mcu_msp: 'mcu_msp430',
  mcu_c2k: 'mcu_c2000',
  mcu_m0: 'mcu_mspm0',
  mcu_cc: 'mcu_simplelink',
  mcu_sit: 'mcu_sitara',
  gan_342: 'gan_lmg342x',
  gan_365: 'gan_lmg3650',
  gan_520: 'gan_lmg5200',
  dc_48v: 'dc_48v_bus',
  dc_sps: 'dc_smart_power_stages',
  dc_efuse: 'dc_efuses',
  dc_hswap: 'dc_hotswap',
  dc_tps: 'dc_tps536xx_ai_power',
};
// All 28 canonical subcategory IDs, mirroring TI_TAXONOMY_FLAT in
// src/data/tiTaxonomy.ts. Used to seed the subcategory-visibility filter.
const ALL_CANONICAL_IDS = [
  'power_ldo','power_acdc_switching','power_dcdc_switching','power_supervisor_reset','power_battery_mgmt',
  'amp_opamps','amp_instrumentation','amp_audio',
  'conv_adc','conv_dac',
  'interface_can','interface_lin','interface_ethernet_phy',
  'isolation_digital','isolation_reinforced',
  'mcu_msp430','mcu_c2000','mcu_mspm0','mcu_simplelink','mcu_sitara',
  'gan_lmg342x','gan_lmg3650','gan_lmg5200',
  'dc_48v_bus','dc_smart_power_stages','dc_efuses','dc_hotswap','dc_tps536xx_ai_power',
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

// Persist the latest successful live snapshot so a hard reload paints from
// disk instead of going blank while /api/prices runs. Refresh always merges
// new data into the existing state — partial responses keep prior values.
const LIVE_DATA_LS_KEY = 'tip-live-data-v1';
function readPersistedLiveData() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LIVE_DATA_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function writePersistedLiveData(snapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LIVE_DATA_LS_KEY, JSON.stringify(snapshot));
  } catch {}
}

// Persist user's hidden subcategories across page reloads. We store the set
// of HIDDEN canonical ids (not visible) so the default state is "all
// visible" with an empty set, and any new subcategory added to the
// taxonomy later automatically defaults to visible without a migration.
const HIDDEN_SUB_LS_KEY = 'tip-ti-trend-hidden-sub-v1';
function readPersistedHiddenSub() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_SUB_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}
function writePersistedHiddenSub(set) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIDDEN_SUB_LS_KEY, JSON.stringify([...set]));
  } catch {}
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

// ── Supply tab — customer-facing supply pressure dashboard ─────────────────
// Built from the full TI Direct rollups so the customer sees real coverage
// instead of the legacy 64-part watched list. Click any category row to
// drill into Universe with that subcategory pre-filtered. All operator and
// internal-status sections live elsewhere; this view is customer-grade.
function SupplyPanel({ tiRollupsByCanonical, tiTrendByCanonical, combinedEvidence, setUniverseFilter, setActiveTab }) {
  const B = '#1a2740';

  // Full TI universe counts — fetched from /api/ti/universe/catalog/status.
  // The rollups only cover mapped subcategories, so summing rollup opnCounts
  // would understate coverage. The status endpoint reports the true total
  // (e.g. 72k+ OPNs) and is the right source for the headline KPIs.
  const [universeStatus, setUniverseStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ti/universe/catalog/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d && d.success !== false) setUniverseStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // canonical → first matching legacy CATS entry, used for friendly labels.
  const legacyToCanonical = combinedEvidence?.legacyToCanonical || {};
  const canonicalToLegacy = {};
  Object.entries(legacyToCanonical).forEach(([legacy, canonical]) => {
    if (!canonicalToLegacy[canonical]) canonicalToLegacy[canonical] = [];
    canonicalToLegacy[canonical].push(legacy);
  });
  function canonicalLabel(canonical) {
    const legacyIds = canonicalToLegacy[canonical] || [];
    const cat = legacyIds.length ? CATS.find(c => c.id === legacyIds[0]) : null;
    if (cat) return cat.l;
    return canonical.split('_').slice(1).map(s => s ? s[0].toUpperCase() + s.slice(1) : '').join(' ').trim() || canonical;
  }
  function canonicalGroupLabel(canonical) {
    const legacyIds = canonicalToLegacy[canonical] || [];
    const cat = legacyIds.length ? CATS.find(c => c.id === legacyIds[0]) : null;
    return cat?.g || '—';
  }

  // Build per-subcategory rows from the rollup map.
  const rollupEntries = Object.entries(tiRollupsByCanonical || {});
  const rows = rollupEntries.map(([canonical, r]) => {
    const trend = (tiTrendByCanonical || {})[canonical];
    const trendUsable = !!trend?.hasEnoughHistory;
    const stockDelta = trendUsable && Number.isFinite(trend.stockDeltaPct) ? trend.stockDeltaPct : null;
    const priceDelta = trendUsable && Number.isFinite(trend.priceDeltaPct) ? trend.priceDeltaPct : null;
    const stockedPct = Number.isFinite(r?.stockedPct) ? r.stockedPct : null;
    let status = 'Stable';
    let statusColor = '#7a96b8';
    if (stockDelta != null && stockDelta <= -5) {
      status = 'Tightening'; statusColor = '#f0a84e';
    } else if (stockDelta != null && stockDelta >= 5) {
      status = 'Easing'; statusColor = '#00c9a7';
    } else if (stockedPct != null && stockedPct < 50) {
      status = 'Watch'; statusColor = '#f0a84e';
    }
    return {
      canonical,
      group: canonicalGroupLabel(canonical),
      label: canonicalLabel(canonical),
      partsTracked: Number(r?.opnCount || 0),
      stockedCount: Number(r?.stockedOpnCount || 0),
      outOfStockCount: Number(r?.outOfStockOpnCount || 0),
      stockedPct,
      stockDelta,
      priceDelta,
      status,
      statusColor,
      rollup: r,
      trend: trend || null,
    };
  }).sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));

  // Aggregate KPIs — prefer the full TI universe status (72k+ OPNs) over the
  // subset of mapped rollup subcategories. The rollup sum understates the
  // true universe size; the status endpoint reports D1's authoritative
  // OPN counts, in-stock counts, and out-of-stock counts.
  const universeOpnCount = Number(universeStatus?.opnCount ?? 0);
  const universeStocked = Number(universeStatus?.inStockOpnCount ?? 0);
  const universeOutOfStock = Number(universeStatus?.outOfStockOpnCount ?? 0);
  const useUniverse = universeOpnCount > 0;
  const totalParts = useUniverse
    ? universeOpnCount
    : rows.reduce((s, r) => s + (r.partsTracked || 0), 0);
  const totalStocked = useUniverse
    ? universeStocked
    : rows.reduce((s, r) => s + (r.stockedCount || 0), 0);
  const totalOutOfStock = useUniverse
    ? universeOutOfStock
    : rows.reduce((s, r) => s + (r.outOfStockCount || 0), 0);
  const inStockPct = totalParts > 0 ? (totalStocked / totalParts) * 100 : null;
  const outOfStockPct = totalParts > 0 ? (totalOutOfStock / totalParts) * 100 : null;
  const pressureRows = rows.filter(r => r.status === 'Tightening' || r.status === 'Watch');
  const tighteningRows = rows.filter(r => r.status === 'Tightening')
    .sort((a, b) => (a.stockDelta ?? 0) - (b.stockDelta ?? 0));

  // Headline copy in plain English.
  let headline = 'Supply looks stable';
  if (tighteningRows.length > 0) {
    headline = `Supply tightening in ${tighteningRows[0].label}`;
  } else if (pressureRows.length > 0) {
    headline = pressureRows.length > rows.length / 3 ? 'Supply looks mixed' : 'Supply mostly stable';
  }

  // Trend-driven sections only render once at least one subcategory has
  // enough history. Otherwise we surface a clean "trend data is building"
  // message instead of a blank panel.
  const trendsAvail = rows.filter(r => r.stockDelta != null);
  const biggestDrops = [...trendsAvail].sort((a, b) => a.stockDelta - b.stockDelta).slice(0, 5).filter(r => r.stockDelta < 0);
  const biggestBuilds = [...trendsAvail].sort((a, b) => b.stockDelta - a.stockDelta).slice(0, 5).filter(r => r.stockDelta > 0);
  const importantMoves = trendsAvail.filter(r =>
    (r.priceDelta != null && r.stockDelta != null) &&
    ((r.priceDelta > 1 && r.stockDelta < -1) || (r.priceDelta < -1 && r.stockDelta > 1))
  );

  function openCategory(row) {
    setUniverseFilter({
      canonicalSubcategory: row.canonical,
      canonicalGroup: row.rollup?.canonicalGroup ?? null,
      qualityLabel: row.rollup?.qualityLabel ?? null,
      qualityWarning: row.rollup?.qualityWarning ?? null,
      displayLabel: row.label,
      sourceCellId: null,
      usable: row.rollup?.usableForPricesLiveEvidence === true,
    });
    setActiveTab('universe');
  }

  // Tiny presentational helpers (kept inside the component so this panel
  // stays self-contained and easy to delete or rebuild later).
  const sectionTitle = { fontSize: '0.58rem', color: '#6b8aa8', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: 8 };
  function KpiCard({ label, value, sub, color }) {
    return (
      <div style={{ border: `1px solid ${B}`, borderRadius: 6, padding: '12px 14px', background: '#0a0f18' }}>
        <div style={{ fontSize: '0.55rem', color: '#6b8aa8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: color || '#e0eaf8', fontFamily: 'monospace' }}>{value}</div>
        {sub && <div style={{ fontSize: '0.6rem', color: '#7a96b8', marginTop: 2 }}>{sub}</div>}
      </div>
    );
  }
  function ChangeRow({ row, deltaColor }) {
    const v = row.stockDelta;
    const sign = v > 0 ? '+' : '';
    return (
      <div onClick={() => openCategory(row)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid #0d1520', cursor: 'pointer', transition: 'background 0.12s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(61,142,240,0.08)'}
        onMouseLeave={e => e.currentTarget.style.background = ''}
        title="Click to see parts in this category"
      >
        <span style={{ color: '#e0eaf8', fontSize: '0.7rem' }}>{row.label}</span>
        <span style={{ color: deltaColor, fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 'bold' }}>{sign}{v.toFixed(2)}%</span>
      </div>
    );
  }

  // Empty / not-yet-wired state.
  if (rows.length === 0) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: '#7a96b8' }}>
        <div style={{ fontSize: '1.05rem', color: '#e0eaf8', marginBottom: 10, fontWeight: 'bold' }}>Supply dashboard is being upgraded to full TI universe coverage.</div>
        <div style={{ fontSize: '0.72rem' }}>Current full-universe pricing data is available in Prices and Universe.</div>
      </div>
    );
  }

  const headerCell = { padding: '8px 10px', textAlign: 'left', color: '#7a96b8', fontWeight: 'normal', fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase' };
  const headerCellRight = { ...headerCell, textAlign: 'right' };
  const headerCellCenter = { ...headerCell, textAlign: 'center' };
  const dataCell = { padding: '8px 10px', borderBottom: '1px solid #0d1520' };

  return (
    <div style={{ padding: '20px 16px', color: '#c4d4e8' }}>
      {/* Headline + subtitle */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#e0eaf8', letterSpacing: '-0.01em' }}>{headline}</div>
        <div style={{ fontSize: '0.7rem', color: '#7a96b8', marginTop: 4 }}>Latest TI inventory data across the product universe.</div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        <KpiCard label="Parts tracked" value={totalParts.toLocaleString()} />
        <KpiCard label="In stock" value={inStockPct != null ? `${inStockPct.toFixed(1)}%` : '—'} color="#4dffc3" />
        <KpiCard label="Out of stock" value={outOfStockPct != null ? `${outOfStockPct.toFixed(1)}%` : '—'} color="#f05c5c" />
        <KpiCard label="Categories with pressure" value={pressureRows.length} sub={`of ${rows.length}`} color={pressureRows.length > 0 ? '#f0a84e' : '#4dffc3'} />
      </div>

      {/* Category supply table */}
      <div style={sectionTitle}>Category supply</div>
      <div style={{ overflowX: 'auto', marginBottom: 24, border: `1px solid ${B}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: '0.7rem' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${B}`, background: '#0a0f18' }}>
              <th style={headerCell}>Group</th>
              <th style={headerCell}>Subcategory</th>
              <th style={headerCellRight}>Parts tracked</th>
              <th style={headerCellRight}>In stock</th>
              <th style={headerCellRight}>Out of stock</th>
              <th style={headerCellCenter}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.canonical}
                onClick={() => openCategory(r)}
                style={{ cursor: 'pointer', transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(61,142,240,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
                title="Click to see parts in this category"
              >
                <td style={{ ...dataCell, color: '#7a96b8' }}>{r.group}</td>
                <td style={{ ...dataCell, color: '#e0eaf8' }}>{r.label}</td>
                <td style={{ ...dataCell, textAlign: 'right' }}>{r.partsTracked.toLocaleString()}</td>
                <td style={{ ...dataCell, textAlign: 'right', color: '#00c9a7' }}>{r.stockedPct != null ? `${r.stockedPct.toFixed(1)}%` : '—'}</td>
                <td style={{ ...dataCell, textAlign: 'right', color: '#f05c5c' }}>{r.outOfStockCount.toLocaleString()}</td>
                <td style={{ ...dataCell, textAlign: 'center', color: r.statusColor, fontWeight: 'bold' }}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Biggest changes (trend-driven) */}
      {trendsAvail.length > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div>
              <div style={sectionTitle}>Biggest stock drops</div>
              <div style={{ border: `1px solid ${B}`, borderRadius: 6, overflow: 'hidden' }}>
                {biggestDrops.length === 0
                  ? <div style={{ padding: '10px 12px', color: '#7a96b8', fontSize: '0.7rem', fontStyle: 'italic' }}>No drops detected.</div>
                  : biggestDrops.map(r => <ChangeRow key={r.canonical} row={r} deltaColor="#f05c5c" />)}
              </div>
            </div>
            <div>
              <div style={sectionTitle}>Biggest stock builds</div>
              <div style={{ border: `1px solid ${B}`, borderRadius: 6, overflow: 'hidden' }}>
                {biggestBuilds.length === 0
                  ? <div style={{ padding: '10px 12px', color: '#7a96b8', fontSize: '0.7rem', fontStyle: 'italic' }}>No builds detected.</div>
                  : biggestBuilds.map(r => <ChangeRow key={r.canonical} row={r} deltaColor="#4dffc3" />)}
              </div>
            </div>
          </div>

          {/* Important moves — price + supply overlay */}
          {importantMoves.length > 0 && (
            <>
              <div style={sectionTitle}>Important moves</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {importantMoves.map(r => {
                  const phrase = r.priceDelta > 0 && r.stockDelta < 0
                    ? 'Prices are rising while stock is falling.'
                    : 'Stock is rising while prices are falling.';
                  return (
                    <div key={r.canonical} onClick={() => openCategory(r)}
                      style={{ padding: '10px 14px', border: `1px solid ${B}`, borderRadius: 6, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0a0f18', transition: 'background 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(61,142,240,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = '#0a0f18'}
                      title="Click to see parts in this category"
                    >
                      <div>
                        <div style={{ color: '#e0eaf8', fontSize: '0.74rem', fontWeight: 'bold' }}>{r.label}</div>
                        <div style={{ color: '#7a96b8', fontSize: '0.62rem', marginTop: 2 }}>{phrase}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 14, fontFamily: 'monospace', fontSize: '0.72rem' }}>
                        <span style={{ color: r.priceDelta > 0 ? '#4dffc3' : '#f05c5c' }}>Price {r.priceDelta > 0 ? '+' : ''}{r.priceDelta.toFixed(2)}%</span>
                        <span style={{ color: r.stockDelta > 0 ? '#4dffc3' : '#f05c5c' }}>Stock {r.stockDelta > 0 ? '+' : ''}{r.stockDelta.toFixed(2)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        <div style={{ padding: '14px 16px', border: `1px solid ${B}`, borderRadius: 6, color: '#7a96b8', fontSize: '0.72rem', fontStyle: 'italic', background: '#0a0f18' }}>
          Trend data is being collected. Stock movement and price-supply patterns will appear once enough updates are stored.
        </div>
      )}
    </div>
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

// ── UBS Evidence Lab category mapping ──────────────────────────────────────
// Used by the UBS Compare tab to reshape the /api/ti/trend/series response
// from TI's 28-subcategory taxonomy into UBS's 13-leaf format. Pure data
// transform — no UI logic, no backend change. Passed to TrendSeriesPanel via
// the optional `dataTransform` prop; the Prices tab passes nothing and stays
// identity. Aggregated buckets use a simple mean of valid source pcts; 1:1
// buckets pass the source cell through verbatim so single-source receipts
// still work. Empty-source buckets render as permanent dashes.
const UBS_GC = {
  'Amplifiers': '#3d8ef0',
  'Data Converters': '#00c9a7',
  'Power Management Chips': '#f0a84e',
  'Microcontrollers': '#6af0d4',
};

const UBS_GROUPS = [
  { groupLabel: 'Amplifiers', subs: [
    { canonicalId: 'ubs_amp_audio',       label: 'Audio',       sources: ['amp_audio'] },
    { canonicalId: 'ubs_amp_comparators', label: 'Comparators', sources: [] },
    { canonicalId: 'ubs_amp_operational', label: 'Operational', sources: ['amp_opamps'] },
  ]},
  { groupLabel: 'Data Converters', subs: [
    { canonicalId: 'ubs_conv_adc',   label: 'ADC',   sources: ['conv_adc'] },
    { canonicalId: 'ubs_conv_dac',   label: 'DAC',   sources: ['conv_dac'] },
    { canonicalId: 'ubs_conv_other', label: 'Other', sources: [] },
  ]},
  { groupLabel: 'Power Management Chips', subs: [
    { canonicalId: 'ubs_power_linear',    label: 'Linear Voltage Regulators',    sources: ['power_ldo'] },
    { canonicalId: 'ubs_power_switching', label: 'Switching Voltage Regulators', sources: ['power_acdc_switching', 'power_dcdc_switching'] },
    { canonicalId: 'ubs_power_other',     label: 'Other Power Management Circuits', sources: [
      'power_supervisor_reset',
      'power_battery_mgmt',
      'dc_48v_bus',
      'dc_smart_power_stages',
      'dc_efuses',
      'dc_hotswap',
      'dc_tps536xx_ai_power',
    ]},
  ]},
  { groupLabel: 'Microcontrollers', subs: [
    { canonicalId: 'ubs_mcu_16bit', label: '16 bit General Purpose', sources: ['mcu_msp430'] },
    { canonicalId: 'ubs_mcu_32bit', label: '32 bit General Purpose', sources: ['mcu_c2000', 'mcu_mspm0', 'mcu_simplelink'] },
    { canonicalId: 'ubs_mcu_8bit',  label: '8 bit General Purpose',  sources: [] },
    { canonicalId: 'ubs_mcu_other', label: 'Other Microcontrollers', sources: ['mcu_sitara'] },
  ]},
];

// CATS-shaped fallback used by TrendSeriesPanel's pill-count path before
// /api/ti/trend/series resolves. Once data loads, the panel prefers
// data.columns and this only affects the first paint.
const UBS_CATS = UBS_GROUPS.flatMap(g => g.subs.map(s => ({
  id: s.canonicalId, g: g.groupLabel, l: s.label,
})));

function tiSeriesToUbs(data) {
  if (!data) return data;
  const columns = UBS_GROUPS.flatMap(g => g.subs.map(s => ({
    canonicalId: s.canonicalId,
    label: s.label,
    groupId: 'ubs_' + g.groupLabel.toLowerCase().replace(/\s+/g, '_'),
    groupLabel: g.groupLabel,
  })));
  const subToSources = new Map();
  UBS_GROUPS.forEach(g => g.subs.forEach(s => subToSources.set(s.canonicalId, s.sources)));
  // canonicalId → label lookup for the composite receipt's row labels.
  const labelByCanonical = new Map(data.columns.map(c => [c.canonicalId, c.label]));
  const rows = data.rows.map(r => {
    const cells = {};
    for (const col of columns) {
      const sources = subToSources.get(col.canonicalId) || [];
      if (sources.length === 0) {
        // Empty-source UBS bucket — render as dash, not clickable. The flag
        // lets the cell renderer set a helpful hover string.
        cells[col.canonicalId] = { index: null, pct: null, noSource: true };
        continue;
      }
      if (sources.length === 1) {
        const src = r.cells[sources[0]];
        if (!src) { cells[col.canonicalId] = { index: null, pct: null }; }
        else {
          cells[col.canonicalId] = src.breakdown
            ? { index: src.index ?? null, pct: src.pct ?? null, breakdown: src.breakdown }
            : { index: src.index ?? null, pct: src.pct ?? null };
        }
        continue;
      }
      // Multi-source aggregate: simple mean of valid pcts; attach composite
      // so the click receipt can list each constituent TI source's pct.
      const items = sources.map(s => ({
        label: labelByCanonical.get(s) || s,
        pct: r.cells[s]?.pct ?? null,
      }));
      const validPcts = items.map(it => it.pct).filter(p => p != null && isFinite(p));
      const mean = validPcts.length === 0 ? null : validPcts.reduce((a, b) => a + b, 0) / validPcts.length;
      cells[col.canonicalId] = { index: null, pct: mean, composite: { items, mean } };
    }
    return { ...r, cells };
  });
  return { ...data, columns, rows };
}

// ── TrendSeriesPanel — UBS-format 28-column WoW/MoM/QoQ price-movement table ─
//
// Replaces the legacy Prices table. Three sub-tabs (WoW / MoM / QoQ) hit
// /api/ti/trend/series and render rows for every period the data covers.
// The most recent row is the live to-date row (WTD / MTD / QTD), highlighted
// in gold. Cells are colored green/red by % change vs prior period.
// Shared pct formatter/colorer used by the trend table cells and the
// composite receipt popover. Lifted from TrendSeriesPanel to module scope
// — pure functions, no behavior change.
function fmtPct(v) {
  if (v == null || !isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}
function pctColor(v) {
  if (v == null || !isFinite(v)) return '#3a4d65';
  if (v > 0.05) return '#00c9a7';
  if (v < -0.05) return '#f05c5c';
  return '#7a96b8';
}

// Arithmetic mean of currently visible pct cells in a single row. Returns
// null when no finite values exist. Used by the optional Average column.
function averageVisiblePct(row, visCanonical) {
  const pcts = visCanonical
    .map(c => row.cells[c.canonicalId]?.pct)
    .filter(p => p != null && isFinite(p));
  if (pcts.length === 0) return null;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

function TrendSeriesPanel({ vis, setVis, hiddenSub, setHiddenSub, isRateLimited, fetchedAt, GC, CATS, B, dataTransform, showAverageColumn }){
  const [view, setView] = useState('qoq');     // 'wow' | 'mom' | 'qoq'
  // Cached raw payload from /api/ti/trend/series. The downstream `data` value
  // applied to the table is derived via useMemo: identity for the Prices tab
  // (no dataTransform prop), reshaped by tiSeriesToUbs for UBS Compare.
  const [rawData, setRawData] = useState(null); // { columns, rows, liveAsOf }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Per-view cache. Keyed by 'wow' | 'mom' | 'qoq'. When the user switches
  // back to a tab they've already loaded, we render the cached payload
  // instantly and only background-refresh when the entry is older than
  // CACHE_FRESH_MS. Cache survives within the session; an explicit reload
  // resets it.
  const cacheRef = useRef({}); // { [view]: { data, fetchedAt } }
  const CACHE_FRESH_MS = 60_000;
  // Pinned receipt for click-to-explain on live-row cells.
  // Shape: { subLabel, periodLabel, viewLive, breakdown, anchorXY:{top,left} }
  const [receipt, setReceipt] = useState(null);
  const receiptRef = useRef(null);

  // Subcategory picker popover. Holds the group label of the currently-open
  // popover (or null) plus the anchor rect captured at click time.
  const [openPopover, setOpenPopover] = useState(null); // group label | null
  const [popoverAnchor, setPopoverAnchor] = useState(null); // DOMRect
  const popoverRef = useRef(null);

  // Click-outside + Escape dismissal for the subcategory popover.
  useEffect(() => {
    if (!openPopover) return;
    const onDocClick = (e) => {
      if (popoverRef.current && popoverRef.current.contains(e.target)) return;
      setOpenPopover(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpenPopover(null); };
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPopover]);

  // Click-outside dismissal for the receipt popover.
  useEffect(() => {
    if (!receipt) return;
    const onDocClick = (e) => {
      if (receiptRef.current && receiptRef.current.contains(e.target)) return;
      setReceipt(null);
    };
    // Defer attaching the listener so the click that opened the receipt
    // doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', onDocClick); };
  }, [receipt]);

  useEffect(() => {
    let alive = true;
    const cached = cacheRef.current[view];
    const now = Date.now();
    const isFresh = cached && (now - cached.fetchedAt) < CACHE_FRESH_MS;
    if (cached) {
      // Render cached data immediately — no spinner flash on tab switch.
      setRawData(cached.data);
      setError(null);
      setLoading(false);
      if (isFresh) return; // Skip refetch entirely when cache is fresh.
    } else {
      setLoading(true);
      setError(null);
    }
    fetch(`/api/ti/trend/series?view=${view}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => {
        if (!alive) return;
        cacheRef.current[view] = { data: j, fetchedAt: Date.now() };
        setRawData(j);
        setLoading(false);
      })
      .catch(e => {
        if (!alive) return;
        // If we have stale cached data, keep showing it; just surface the error.
        setError(String(e));
        if (!cached) setLoading(false);
      });
    return () => { alive = false; };
  }, [view]);

  // Apply the optional dataTransform prop (used by UBS Compare to reshape
  // TI columns/cells into UBS taxonomy). Prices passes no transform → identity.
  const data = useMemo(() => {
    if (!rawData) return null;
    return dataTransform ? dataTransform(rawData) : rawData;
  }, [rawData, dataTransform]);

  // Visible columns honoring both the parent-group toggle (vis) and the
  // per-subcategory hide set (hiddenSub). A column shows iff its group is
  // toggled on AND its canonicalId is not in hiddenSub.
  const visCanonical = useMemo(() => {
    if (!data) return [];
    const visGroupLabels = new Set([...vis]);
    return data.columns.filter(c => visGroupLabels.has(c.groupLabel) && !hiddenSub.has(c.canonicalId));
  }, [data, vis, hiddenSub]);

  // Group spans for the top header row.
  const grpSpans = useMemo(() => {
    const out = [];
    visCanonical.forEach(c => {
      const last = out[out.length - 1];
      if (last && last.g === c.groupLabel) last.n++;
      else out.push({ g: c.groupLabel, n: 1 });
    });
    return out;
  }, [visCanonical]);

  // Newest-first order so latest periods appear at the top.
  const orderedRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].reverse();
  }, [data]);

  const VIEW_TABS = [
    { id: 'wow', label: 'Week on Week', live: 'WTD' },
    { id: 'mom', label: 'Month on Month', live: 'MTD' },
    { id: 'qoq', label: 'Quarter on Quarter', live: 'QTD' },
  ];

  return (
    <>
      {/* ── View tabs ── */}
      <div style={{display:'flex',gap:0,borderBottom:`1px solid ${B}`,background:'#050810'}}>
        {VIEW_TABS.map(t => {
          const on = view === t.id;
          return (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              flex: '0 0 auto',
              padding: '8px 18px',
              border: 'none',
              borderRight: `1px solid ${B}`,
              borderBottom: on ? '2px solid #3d8ef0' : '2px solid transparent',
              background: on ? '#0a1220' : 'transparent',
              color: on ? '#3d8ef0' : '#7a96b8',
              fontSize: '0.7rem',
              fontFamily: 'monospace',
              fontWeight: on ? 'bold' : 'normal',
              letterSpacing: '0.06em',
              cursor: 'pointer',
            }}>
              {t.label} <span style={{opacity:0.6,fontSize:'0.62rem'}}>· {t.live} live</span>
            </button>
          );
        })}
      </div>

      {/* ── Group toggles with per-subcategory split-button picker ── */}
      <div style={{display:'flex',gap:5,padding:'7px 16px',borderBottom:`1px solid ${B}`,flexWrap:'wrap',alignItems:'center',background:'#050810',position:'relative'}}>
        <span style={{fontSize:'0.57rem',color:'#2d4a6b',letterSpacing:'0.1em'}}>SHOW:</span>
        {Object.keys(GC).map(g => {
          const c = GC[g];
          // Derive pill state from data.columns (NOT TI_TAXONOMY_FLAT) so
          // counts reflect what the table can actually render.
          const subsInGroup = data?.columns.filter(x => x.groupLabel === g) ?? [];
          const total = subsInGroup.length || (CATS.filter(x => x.g === g).length);
          const onCount = subsInGroup.filter(x => !hiddenSub.has(x.canonicalId)).length;
          const groupOn = vis.has(g);
          const state = !groupOn || onCount === 0 ? 'off' : onCount === total ? 'on' : 'partial';
          const bg = state === 'on' ? c + '22'
                   : state === 'partial' ? c + '11'
                   : 'none';
          const border = state === 'on' ? `1px solid ${c}`
                       : state === 'partial' ? `1px dashed ${c}`
                       : `1px solid ${B}`;
          const textColor = state === 'off' ? '#2d4a6b'
                          : state === 'partial' ? c + 'cc'
                          : c;
          const countText = state === 'partial' ? `(${onCount}/${total})` : `(${total})`;
          const popOpen = openPopover === g;
          return (
            <span key={g} style={{display:'inline-flex',alignItems:'stretch',background:bg,border,borderRadius:3,transition:'all 0.15s'}}>
              <button
                onClick={() => {
                  const subs = subsInGroup;
                  if (state === 'on') {
                    // Hide whole group: drop from vis AND mark all subs hidden.
                    setVis(prev => { const n = new Set(prev); n.delete(g); return n; });
                    setHiddenSub(prev => { const n = new Set(prev); subs.forEach(s => n.add(s.canonicalId)); return n; });
                  } else {
                    // Show all in group: add to vis AND clear all subs from hidden.
                    setVis(prev => { const n = new Set(prev); n.add(g); return n; });
                    setHiddenSub(prev => { const n = new Set(prev); subs.forEach(s => n.delete(s.canonicalId)); return n; });
                  }
                }}
                style={{background:'none',border:'none',padding:'2px 4px 2px 8px',fontSize:'0.62rem',color:textColor,cursor:'pointer',fontFamily:'inherit'}}
                title={state === 'on' ? `Hide ${g}` : `Show all of ${g}`}
              >
                {g} <span style={{opacity:.6,fontSize:'0.52rem'}}>{countText}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (popOpen) { setOpenPopover(null); return; }
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPopoverAnchor(rect);
                  setOpenPopover(g);
                }}
                style={{
                  background:'none',
                  border:'none',
                  borderLeft: popOpen ? `1px solid ${c}66` : '1px solid transparent',
                  padding:'2px 6px 2px 4px',
                  fontSize:'0.55rem',
                  color:textColor,
                  cursor:'pointer',
                  display:'inline-flex',
                  alignItems:'center',
                  transition:'border-color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderLeft = `1px solid ${c}66`; }}
                onMouseLeave={(e) => { if (!popOpen) e.currentTarget.style.borderLeft = '1px solid transparent'; }}
                aria-label={`Pick subcategories for ${g}`}
                aria-expanded={popOpen}
                title={`Choose subcategories in ${g}`}
              >▾</button>
            </span>
          );
        })}
      </div>

      {openPopover && data && (
        <SubcategoryPopover
          group={openPopover}
          color={GC[openPopover] || '#888'}
          columns={data.columns.filter(c => c.groupLabel === openPopover)}
          hiddenSub={hiddenSub}
          setHiddenSub={setHiddenSub}
          setVis={setVis}
          onClose={() => setOpenPopover(null)}
          anchorRect={popoverAnchor}
          popoverRef={popoverRef}
          B={B}
        />
      )}

      {/* ── Legend ── */}
      <div style={{display:'flex',gap:18,padding:'7px 16px',borderBottom:`1px solid #0d1520`,fontSize:'0.62rem',color:'#7a96b8',flexWrap:'wrap',background:'#050810',alignItems:'center'}}>
        <span><span style={{color:'#00c9a7'}}>■</span> Price increase</span>
        <span><span style={{color:'#f05c5c'}}>■</span> Price decrease</span>
        <span style={{color:'#4a6a8a'}}>· Closed periods show {view==='wow'?'WoW':view==='mom'?'MoM':'QoQ'} % movement</span>
        <span style={{color:'#ffd700'}}>★ Live row updates with each daily capture</span>
      </div>

      {/* ── Status / loading line ── */}
      <div style={{padding:'6px 16px',fontSize:'0.62rem',color:'#7a96b8',background:'#050810',borderBottom:`1px solid #0d1520`,display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
        {loading && <span style={{color:'#7a96b8'}}>Loading {view.toUpperCase()} series…</span>}
        {error && <span style={{color:'#f0a84e'}}>Error: {error}</span>}
        {data && !loading && <>
          <span>{data.rows.length} period{data.rows.length===1?'':'s'} · {visCanonical.length} subcategor{visCanonical.length===1?'y':'ies'} shown</span>
          <span style={{color:'#4a6a8a'}}>· live as of {data.liveAsOf}</span>
          {fetchedAt && <span style={{color:'#4a6a8a'}}>· prices updated {new Date(fetchedAt).toLocaleString()}</span>}
          {isRateLimited && <span style={{color:'#7a96b8',fontStyle:'italic'}}>· update pending</span>}
        </>}
      </div>

      {/* ── Table ── */}
      <div style={{overflowX:'auto',position:'relative',zIndex:1}}>
        <table style={{borderCollapse:'collapse',whiteSpace:'nowrap'}}>
          <thead>
            <tr style={{background:'#050810'}}>
              <th rowSpan={2} style={{padding:'6px 12px 6px 16px',textAlign:'left',borderBottom:`1px solid ${B}`,borderRight:`1px solid ${B}`,color:'#2d4a6b',fontWeight:'normal',fontSize:'0.58rem',position:'sticky',left:0,background:'#050810',zIndex:3,minWidth:140,verticalAlign:'bottom'}}>Period</th>
              {showAverageColumn && <th style={{padding:'5px 6px',textAlign:'center',borderBottom:`1px solid ${B}`,borderLeft:`1px solid ${B}`,borderRight:`2px solid ${B}`,fontWeight:'normal',fontSize:'0.62rem',letterSpacing:'0.04em',color:'#7a96b8'}}>Averages</th>}
              {grpSpans.map(({g,n})=><th key={g} colSpan={n} style={{padding:'5px 6px',textAlign:'center',borderBottom:`1px solid ${B}`,borderLeft:`1px solid ${B}`,fontWeight:'normal',fontSize:'0.62rem',letterSpacing:'0.04em',color:GC[g]||'#888'}}>{g}</th>)}
            </tr>
            <tr style={{background:'#07090f'}}>
              {showAverageColumn && <th style={{padding:'4px 6px',textAlign:'right',borderBottom:`2px solid ${B}`,borderLeft:`1px solid ${B}`,borderRight:`2px solid ${B}`,fontWeight:'normal',fontSize:'0.58rem',color:'#7a96b8',minWidth:80,maxWidth:100}}>Average</th>}
              {visCanonical.map((c,i)=>{const iF=i===0||visCanonical[i-1].groupLabel!==c.groupLabel;return(
                <th key={c.canonicalId} style={{padding:'4px 6px',textAlign:'right',borderBottom:`2px solid ${B}`,borderLeft:iF?`1px solid ${B}`:'none',fontWeight:'normal',fontSize:'0.58rem',color:(GC[c.groupLabel]||'#888')+'bb',minWidth:80,maxWidth:110,overflow:'hidden',textOverflow:'ellipsis'}}>{c.label}</th>
              );})}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((r, ri) => {
              const live = r.liveToDate;
              const bg = live ? 'rgba(255,215,0,0.05)' : ri % 2 === 0 ? '#080c14' : '#06080f';
              const stickyBg = live ? '#141102' : ri % 2 === 0 ? '#080c14' : '#06080f';
              const labelColor = live ? '#ffd700' : '#7a96b8';
              return (
                <tr key={r.periodEnd + (live?'-live':'')} style={{background: bg}}>
                  <td style={{
                    padding:'5px 12px 5px 16px',
                    borderRight:`1px solid ${B}`,
                    borderBottom:`1px solid #0d1520`,
                    fontFamily:'monospace',
                    fontSize: live ? '0.74rem' : '0.7rem',
                    position:'sticky',
                    left:0,
                    background: stickyBg,
                    zIndex:2,
                    color: r.bridgeRow ? '#3a4d65' : labelColor,
                    fontWeight: live ? 'bold' : 'normal',
                    cursor: r.bridgeRow ? 'help' : 'default',
                  }} title={r.bridgeRow ? 'Live capture begins from May 2026. Historical baseline used where available.' : undefined}>
                    {live ? '★ ' : '   '}{r.label}
                  </td>
                  {showAverageColumn && (() => {
                    const avg = r.bridgeRow ? null : averageVisiblePct(r, visCanonical);
                    const text = fmtPct(avg);
                    const color = pctColor(avg);
                    const avgClickable = !r.bridgeRow && avg != null;
                    const onAvgClick = avgClickable
                      ? (e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const items = visCanonical.map(c => ({
                            label: c.label,
                            pct: r.cells[c.canonicalId]?.pct ?? null,
                          }));
                          setReceipt({
                            subLabel: 'Average',
                            periodLabel: r.label,
                            composite: { items, mean: avg },
                            anchorXY: { x: rect.left + rect.width / 2, y: rect.bottom },
                          });
                        }
                      : undefined;
                    return (
                      <td style={{
                        padding:'4px 6px',
                        textAlign:'right',
                        borderBottom:`1px solid #0d1520`,
                        borderLeft:`1px solid #0d1520`,
                        borderRight:`2px solid ${B}`,
                        fontFamily:'monospace',
                        fontSize: live ? '0.74rem' : '0.7rem',
                        color: r.bridgeRow ? '#3a4d65' : color,
                        fontWeight: live ? 'bold' : 'normal',
                        cursor: r.bridgeRow ? 'help' : (avgClickable ? 'pointer' : 'default'),
                      }} title={r.bridgeRow ? 'Live capture begins from May 2026.' : (avgClickable ? 'Click for calculation' : `Mean of ${visCanonical.length} visible subcategor${visCanonical.length===1?'y':'ies'} for ${r.label}`)} onClick={onAvgClick}>
                        {text}
                      </td>
                    );
                  })()}
                  {visCanonical.map((c, i) => {
                    const iF = i === 0 || visCanonical[i-1].groupLabel !== c.groupLabel;
                    const cell = r.cells[c.canonicalId];
                    const pct = cell?.pct;
                    const hasBreakdown = !!cell?.breakdown;
                    const hasComposite = !!cell?.composite;
                    const isNoSource   = !!cell?.noSource;
                    const isLiveCell = live && hasBreakdown;
                    // "Blank" means the live cell has no value to show, not
                    // merely no breakdown. UBS Compare's aggregated buckets
                    // intentionally carry a pct without a breakdown — they
                    // must render the value (no click). For TI/Prices, pct
                    // and breakdown are always set/unset together on live
                    // rows, so this is a no-op there.
                    const isLiveBlank = live && (cell?.pct == null);
                    // Closed (historical) rows with a snapshotted breakdown are
                    // also clickable — they show the same receipt as the live
                    // row but with frozen values from the moment of close.
                    const isFrozenSnapshot = !live && hasBreakdown;
                    const isClickable = isLiveCell || isFrozenSnapshot || hasComposite;
                    const text = isLiveBlank ? '—' : fmtPct(pct);
                    const color = pctColor(pct);
                    let cellTitle;
                    if (r.bridgeRow) {
                      cellTitle = 'Live capture begins from May 2026. Historical baseline used where available.';
                    } else if (isNoSource) {
                      cellTitle = 'Insufficient data — no TI taxonomy mapping for this UBS bucket';
                    } else if (hasComposite) {
                      cellTitle = 'Click for calculation';
                    } else if (live) {
                      cellTitle = isLiveCell ? 'Click for calculation' : 'No valid prior-period anchor yet.';
                    } else if (isFrozenSnapshot) {
                      cellTitle = 'Click for calculation (frozen at period close)';
                    } else {
                      cellTitle = cell?.index != null ? `index ${cell.index.toFixed(2)} · ${r.label}` : 'no data';
                    }
                    const onCellClick = isClickable
                      ? (e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setReceipt({
                            subLabel: c.label,
                            periodLabel: r.label,
                            ...(hasComposite ? { composite: cell.composite } : { breakdown: cell.breakdown }),
                            anchorXY: { x: rect.left + rect.width / 2, y: rect.bottom },
                          });
                        }
                      : undefined;
                    return (
                      <td key={c.canonicalId} style={{
                        padding:'4px 6px',
                        textAlign:'right',
                        borderBottom:`1px solid #0d1520`,
                        borderLeft: iF ? `1px solid #0d1520` : 'none',
                        fontFamily:'monospace',
                        fontSize: live ? '0.74rem' : '0.7rem',
                        color: r.bridgeRow ? '#3a4d65' : (isLiveBlank ? '#3a4d65' : color),
                        fontWeight: live && !isLiveBlank ? 'bold' : 'normal',
                        cursor: r.bridgeRow ? 'help' : (isClickable ? 'pointer' : ((isLiveBlank || isNoSource) ? 'help' : 'default')),
                      }} title={cellTitle} onClick={onCellClick}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Click-to-explain receipt popover ── */}
      {receipt && <ReceiptPopover receipt={receipt} onClose={() => setReceipt(null)} popoverRef={receiptRef} B={B} />}
    </>
  );
}

// Renders the math receipt: subcategory, period, two USD lines, formula.
// Subcategory picker popover — opens when the ▾ caret on a category pill is
// clicked. Lists every subcategory in the group with a checkbox; the user
// can toggle individual subcategories, or use "Show all" / "Hide all" for
// bulk control. Updates `hiddenSub`; also keeps `vis` in sync so that when
// the last subcategory in a group is hidden, the parent pill flips off
// (and vice-versa) — this keeps the legacy CSV-export path consistent.
function SubcategoryPopover({ group, color, columns, hiddenSub, setHiddenSub, setVis, onClose, anchorRect, popoverRef, B }){
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!popoverRef.current || !anchorRect) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const EDGE = 8;
    let top = anchorRect.bottom + 6;
    if (top + rect.height > vh - EDGE) {
      // Not enough room below — flip above the pill.
      top = Math.max(EDGE, anchorRect.top - rect.height - 6);
    }
    // Horizontally align the popover's right edge with the caret's right edge
    // so it visually descends from the affordance the user just clicked.
    let left = anchorRect.right - rect.width;
    left = Math.max(EDGE, Math.min(left, vw - rect.width - EDGE));
    setPos({ top, left });
  }, [anchorRect, columns.length]);

  const total = columns.length;
  const onCount = columns.filter(c => !hiddenSub.has(c.canonicalId)).length;

  const applyHidden = (nextHiddenSub) => {
    setHiddenSub(nextHiddenSub);
    // Keep vis in lockstep: if all subs in this group are now hidden, drop
    // the group from vis; otherwise ensure it's in vis.
    const allHidden = columns.every(c => nextHiddenSub.has(c.canonicalId));
    setVis(prev => {
      const n = new Set(prev);
      if (allHidden) n.delete(group); else n.add(group);
      return n;
    });
  };

  const toggleOne = (canonicalId) => {
    const n = new Set(hiddenSub);
    if (n.has(canonicalId)) n.delete(canonicalId); else n.add(canonicalId);
    applyHidden(n);
  };
  const showAll = () => {
    const n = new Set(hiddenSub);
    columns.forEach(c => n.delete(c.canonicalId));
    applyHidden(n);
  };
  const hideAll = () => {
    const n = new Set(hiddenSub);
    columns.forEach(c => n.add(c.canonicalId));
    applyHidden(n);
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        background: '#0c1220',
        border: `1px solid ${B}`,
        borderRadius: 6,
        padding: '10px 0 6px 0',
        fontFamily: 'inherit',
        boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
        zIndex: 1000,
        minWidth: 240,
        maxWidth: 280,
        maxHeight: 360,
        overflowY: 'auto',
      }}
      role="dialog"
      aria-label={`Subcategories in ${group}`}
    >
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'0 12px 8px 12px',borderBottom:`1px solid ${B}`,gap:8}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:'0.7rem',fontWeight:'bold',color,letterSpacing:'0.02em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{group}</div>
          <div style={{fontSize:'0.55rem',color:'#7a96b8',marginTop:2}}>{onCount} of {total} shown</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:2,alignItems:'flex-end',flexShrink:0}}>
          <button
            onClick={(e) => { e.stopPropagation(); showAll(); }}
            disabled={onCount === total}
            style={{background:'none',border:'none',color: onCount === total ? '#3a4d65' : '#7a96b8',fontSize:'0.55rem',cursor: onCount === total ? 'default' : 'pointer',padding:'1px 0',fontFamily:'inherit'}}
            onMouseEnter={(e) => { if (onCount !== total) e.currentTarget.style.color = color; }}
            onMouseLeave={(e) => { if (onCount !== total) e.currentTarget.style.color = '#7a96b8'; }}
          >Show all</button>
          <button
            onClick={(e) => { e.stopPropagation(); hideAll(); }}
            disabled={onCount === 0}
            style={{background:'none',border:'none',color: onCount === 0 ? '#3a4d65' : '#7a96b8',fontSize:'0.55rem',cursor: onCount === 0 ? 'default' : 'pointer',padding:'1px 0',fontFamily:'inherit'}}
            onMouseEnter={(e) => { if (onCount !== 0) e.currentTarget.style.color = color; }}
            onMouseLeave={(e) => { if (onCount !== 0) e.currentTarget.style.color = '#7a96b8'; }}
          >Hide all</button>
        </div>
      </div>
      <div style={{padding:'4px 0'}}>
        {columns.map(c => {
          const visible = !hiddenSub.has(c.canonicalId);
          return (
            <label
              key={c.canonicalId}
              onClick={(e) => e.stopPropagation()}
              style={{display:'flex',alignItems:'center',gap:8,padding:'5px 12px',cursor:'pointer',fontSize:'0.65rem',color: visible ? '#c4d4e8' : '#7a96b8',transition:'background 0.1s'}}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#11192a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{position:'relative',display:'inline-flex',alignItems:'center',justifyContent:'center',width:12,height:12,flexShrink:0}}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => toggleOne(c.canonicalId)}
                  style={{
                    appearance:'none',
                    WebkitAppearance:'none',
                    width:12,
                    height:12,
                    border:`1px solid ${visible ? color : '#3a4d65'}`,
                    background: visible ? color : 'transparent',
                    borderRadius:2,
                    cursor:'pointer',
                    margin:0,
                  }}
                />
                {visible && <span style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.7rem',color:'#050810',fontWeight:'bold',pointerEvents:'none',lineHeight:1}}>✓</span>}
              </span>
              <span style={{flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ReceiptPopover({ receipt, onClose, popoverRef, B }){
  // Composite receipt (UBS aggregated cells + Average column) — render a
  // list of constituent subcategories with their pct, plus the average.
  // Guarded BEFORE the USD-breakdown destructure so aggregated UBS clicks
  // don't crash (those cells have no `breakdown` object).
  if (receipt.composite) {
    return <CompositeReceiptPopover receipt={receipt} onClose={onClose} popoverRef={popoverRef} B={B} />;
  }
  const { subLabel, periodLabel, breakdown, anchorXY } = receipt;
  const fmtUSD = (v) => `$${Number(v).toFixed(4)}`;
  const today = breakdown.todayUSD;
  const anchor = breakdown.anchorUSD;
  const pct = ((today - anchor) / anchor) * 100;
  const sign = pct > 0 ? '+' : '';
  const pctText = `${sign}${pct.toFixed(2)}%`;

  // Position: pinned just below the clicked cell, viewport-clamped.
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const EDGE = 8;
    let top = anchorXY.y + 8;
    if (top + rect.height > vh - EDGE) {
      top = Math.max(EDGE, anchorXY.y - rect.height - 16);
    }
    let left = anchorXY.x - rect.width / 2;
    left = Math.max(EDGE, Math.min(left, vw - rect.width - EDGE));
    setPos({ top, left });
  }, [anchorXY.x, anchorXY.y]);

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(`${iso.slice(0,10)}T00:00:00Z`);
    if (isNaN(d.getTime())) return iso;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        background: '#0c1220',
        border: `1px solid ${B}`,
        borderRadius: 6,
        padding: '12px 16px',
        fontFamily: 'monospace',
        fontSize: '0.7rem',
        color: '#c4d4e8',
        boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
        zIndex: 1000,
        minWidth: 360,
        maxWidth: 460,
      }}
    >
      <button onClick={onClose} style={{
        position: 'absolute', top: 6, right: 8,
        background: 'none', border: 'none', color: '#4a6a8a',
        cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 4,
      }} aria-label="close">×</button>

      <div style={{fontSize:'0.85rem',fontWeight:'bold',color:'#3d8ef0',marginBottom:2}}>{subLabel}</div>
      <div style={{fontSize:'0.62rem',color:'#7a96b8',marginBottom:12,letterSpacing:'0.04em'}}>{periodLabel}</div>

      <div style={{display:'grid',gridTemplateColumns:'auto auto',rowGap:6,columnGap:18,marginBottom:12}}>
        <div style={{color:'#7a96b8'}}>{breakdown.todayLabel} ({fmtDate(breakdown.todayDate)})</div>
        <div style={{textAlign:'right',color:'#c4d4e8',fontWeight:'bold'}}>{fmtUSD(today)}</div>
        <div style={{color:'#7a96b8'}}>{breakdown.anchorLabel} ({fmtDate(breakdown.anchorDate)})</div>
        <div style={{textAlign:'right',color:'#c4d4e8',fontWeight:'bold'}}>{fmtUSD(anchor)}</div>
      </div>

      <div style={{borderTop:`1px solid ${B}`,paddingTop:10,fontSize:'0.7rem'}}>
        <span style={{color:'#7a96b8'}}>
          ({fmtUSD(today)} − {fmtUSD(anchor)}) / {fmtUSD(anchor)} × 100 =
        </span>
        <span style={{
          marginLeft: 6,
          fontWeight: 'bold',
          color: pct > 0.05 ? '#00c9a7' : pct < -0.05 ? '#f05c5c' : '#c4d4e8',
        }}>{pctText}</span>
      </div>
    </div>
  );
}

// Composite receipt — used by UBS Compare aggregated cells and the Average
// column. Renders a list of constituent subcategory pcts and a footer mean.
// Shares the same popover chrome (background, border, position math,
// dismiss-on-click-outside via popoverRef) as ReceiptPopover.
function CompositeReceiptPopover({ receipt, onClose, popoverRef, B }){
  const { subLabel, periodLabel, composite, anchorXY } = receipt;
  const { items, mean } = composite;
  const validCount = items.filter(it => it.pct != null && isFinite(it.pct)).length;

  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const EDGE = 8;
    let top = anchorXY.y + 8;
    if (top + rect.height > vh - EDGE) {
      top = Math.max(EDGE, anchorXY.y - rect.height - 16);
    }
    let left = anchorXY.x - rect.width / 2;
    left = Math.max(EDGE, Math.min(left, vw - rect.width - EDGE));
    setPos({ top, left });
  }, [anchorXY.x, anchorXY.y]);

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        background: '#0c1220',
        border: `1px solid ${B}`,
        borderRadius: 6,
        padding: '12px 16px',
        fontFamily: 'monospace',
        fontSize: '0.7rem',
        color: '#c4d4e8',
        boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
        zIndex: 1000,
        minWidth: 320,
        maxWidth: 460,
      }}
    >
      <button onClick={onClose} style={{
        position: 'absolute', top: 6, right: 8,
        background: 'none', border: 'none', color: '#4a6a8a',
        cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 4,
      }} aria-label="close">×</button>

      <div style={{fontSize:'0.85rem',fontWeight:'bold',color:'#3d8ef0',marginBottom:2}}>{subLabel}</div>
      <div style={{fontSize:'0.62rem',color:'#7a96b8',marginBottom:10,letterSpacing:'0.04em'}}>{periodLabel}</div>

      <div style={{display:'grid',gridTemplateColumns:'auto auto',rowGap:4,columnGap:18,marginBottom:10}}>
        {items.map((it, i) => (
          <React.Fragment key={i}>
            <div style={{color:'#7a96b8'}}>{it.label}</div>
            <div style={{textAlign:'right',color:pctColor(it.pct),fontWeight:'normal'}}>{fmtPct(it.pct)}</div>
          </React.Fragment>
        ))}
      </div>

      <div style={{borderTop:`1px solid ${B}`,paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:14}}>
        <span style={{color:'#7a96b8'}}>
          Average of {validCount} of {items.length} source categor{items.length===1?'y':'ies'}
        </span>
        <span style={{fontWeight:'bold',color:pctColor(mean)}}>{fmtPct(mean)}</span>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App(){
  // Hydrate from the last successful snapshot first so the live row never
  // starts blank while /api/prices runs in the background.
  const persistedSnapshot = readPersistedLiveData();
  const [liveData,setLiveData]=useState(persistedSnapshot?.data || null);
  const liveDataRef = useRef(persistedSnapshot?.data || null);
  const [loading,setLoading]=useState(false);
  const [fetchedAt,setFetchedAt]=useState(persistedSnapshot?.fetchedAt || null);
  const [src,setSrc]=useState(persistedSnapshot?.src || '');
  const [fetchCount,setFetchCount]=useState(persistedSnapshot?.fetchCount || null);
  const [vis,setVis]=useState(new Set(Object.keys(GC)));
  // Per-subcategory hidden set (canonical IDs). Persisted across reloads.
  const [hiddenSub,setHiddenSub]=useState(readPersistedHiddenSub);
  useEffect(()=>{ writePersistedHiddenSub(hiddenSub); }, [hiddenSub]);
  // UBS Compare — independent filter state. Ephemeral on purpose so the
  // clone always starts with all groups + subcategories visible and never
  // inherits the Prices tab's persisted localStorage hidden set. The default
  // visible set is keyed by UBS_GC (4 UBS parents), not GC (8 TI groups).
  const [ubsVis,setUbsVis]=useState(new Set(Object.keys(UBS_GC)));
  const [ubsHiddenSub,setUbsHiddenSub]=useState(new Set());
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
  // Phase 25.1 — TI trend fetch lifecycle state. Drives the QTD row to
  // suppress the live-distributor fallback while the TI Direct response
  // is still in flight, eliminating the brief flash where the row would
  // render qoqPct values from the persisted live snapshot and then snap
  // to the (genuinely zero) TI Direct deltas a moment later.
  // 'loading' on first mount; 'loaded' on a successful response (even if
  // the map ends up empty); 'failed' on network or backend error.
  const [tiTrendLoadingState,setTiTrendLoadingState]=useState('loading');
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
  const [exporting, setExporting] = useState(false);
  const rateLimitToastId = useRef(null);
  const retryTimer = useRef(null);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  const visCats=CATS.filter(c=>vis.has(c.g));
  const grps=[];
  visCats.forEach(c=>{const last=grps[grps.length-1];if(last&&last.g===c.g)last.n++;else grps.push({g:c.g,n:1});});

  // Auto-retry after rate limit window expires (silent — no customer toast)
  function scheduleRetry(retryAt) {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const ms = Math.max(0, new Date(retryAt) - Date.now()) + 2000;
    retryTimer.current = setTimeout(() => {
      setRateLimitedUntil(null);
      writePersistedRateLimit(null);
      fetchLive(true, true);
    }, ms);
  }

  const fetchLive = useCallback(async(force=false, silent=false) => {
    // Pre-flight guard — if the channel API is in a known cooldown window,
    // skip the network call entirely. The cooldown is reflected by inline
    // button state ("Channel refresh pending"), not by a customer toast.
    if (force) {
      const persisted = readPersistedRateLimit();
      const until = rateLimitedUntil || persisted;
      if (until && new Date(until).getTime() > Date.now()) {
        console.warn('[ti-prices] channel cooldown active — skipping refresh', { until });
        return;
      }
    }
    setLoading(true);
    try {
      // No client-side timeout — let the server complete (parallel batches take ~8-10s)
      const res = await fetch(force ? '/api/prices?refresh=true' : '/api/prices');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      // Merge new categories into existing data — never blank out values
      // for categories the response omitted. Partial responses keep prior
      // values for the missing categories.
      const incoming = (json && typeof json.data === 'object' && json.data) || {};
      const incomingKeys = Object.keys(incoming);
      const newSrc = json.source;
      const merged = { ...(liveDataRef.current || {}), ...incoming };
      liveDataRef.current = merged;
      setLiveData(merged);
      // Only advance the "updated" timestamp when the response actually
      // contributed data — keeps the displayed update time honest.
      if (incomingKeys.length > 0) {
        setFetchedAt(json.fetchedAt || json.cachedAt);
        setSrc(newSrc);
        setFetchCount({ got: json.fetchedCount, total: json.totalCount });
        // Persist the latest good snapshot so a future reload paints from disk.
        writePersistedLiveData({
          data: merged,
          fetchedAt: json.fetchedAt || json.cachedAt,
          fetchCount: { got: json.fetchedCount, total: json.totalCount },
          src: newSrc,
        });
      }
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

      // Rate-limit / empty-response handling is now silent for customers.
      // Internal state (cooldown timer, persisted key) is preserved so the
      // dashboard self-heals; diagnostics go to console only.
      if (json.rateLimited) {
        const retryAt = json.retryAt || new Date(Date.now() + 65_000).toISOString();
        setRateLimitedUntil(retryAt);
        writePersistedRateLimit(retryAt);
        scheduleRetry(retryAt);
        console.warn('[ti-prices] channel cooldown', {
          retryAt,
          fetchedCount: json.fetchedCount,
          totalCount: json.totalCount,
        });
      } else if ((json.fetchedCount ?? 0) === 0 && json.source === 'live') {
        // 0/28 with no explicit rateLimited flag — treat as cooldown internally.
        const retryAt2 = new Date(Date.now() + 65_000).toISOString();
        setRateLimitedUntil(retryAt2);
        writePersistedRateLimit(retryAt2);
        scheduleRetry(retryAt2);
        console.warn('[ti-prices] channel returned no data — cooldown scheduled', { retryAt: retryAt2 });
      } else {
        // Successful fetch — clear cooldown state.
        setRateLimitedUntil(null);
        writePersistedRateLimit(null);
        if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        if (rateLimitToastId.current) { dismiss(rateLimitToastId.current); rateLimitToastId.current = null; }
      }
    } catch(e) {
      console.warn('[ti-prices] live fetch failed', e);
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
          setTiTrendLoadingState('loaded');
        } else {
          // Either rejected, or fulfilled with null / non-array shape
          // (e.g. backend returned { success:false, status:'d1_not_bound' }).
          // Either way: trend is unavailable — let the qoq fallback engage.
          setTiTrendLoadingState('failed');
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

  // Lazy-load SheetJS on first export so the page-load cost stays zero.
  // Cached on window so subsequent exports are instant.
  function loadXLSXLib(){
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.async = true;
      script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX failed to initialize'));
      script.onerror = () => reject(new Error('Failed to load XLSX library from CDN'));
      document.head.appendChild(script);
    });
  }

  // Export the WoW / MoM / QoQ trend tables as a single .xlsx workbook with
  // three named sheets (one per view), mirroring what the user sees in
  // TrendSeriesPanel. Honors both `vis` (group) and `hiddenSub`
  // (per-subcategory) filters. Cell values are raw numbers so spreadsheet
  // math works directly; missing data is left blank.
  async function exportCSV(){
    if (exporting) return;
    setExporting(true);
    try {
      const views = [
        { key: 'wow', title: 'Week on Week' },
        { key: 'mom', title: 'Month on Month' },
        { key: 'qoq', title: 'Quarter on Quarter' },
      ];
      const [XLSX, ...datasets] = await Promise.all([
        loadXLSXLib(),
        ...views.map(v => fetch(`/api/ti/trend/series?view=${v.key}`).then(r => {
          if (!r.ok) throw new Error(`${v.title}: HTTP ${r.status}`);
          return r.json();
        })),
      ]);

      const wb = XLSX.utils.book_new();
      views.forEach((v, i) => {
        const dataset = datasets[i];
        const visibleCols = dataset.columns.filter(c =>
          vis.has(c.groupLabel) && !hiddenSub.has(c.canonicalId)
        );
        const rows = [
          ['Period', ...visibleCols.map(c => c.label)],
          // Newest-first to match the table's reversed display order.
          ...[...dataset.rows].reverse().map(row => [
            row.label,
            ...visibleCols.map(c => {
              const pct = row.cells[c.canonicalId]?.pct;
              return pct == null ? null : pct;
            }),
          ]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, v.title);
      });

      XLSX.writeFile(wb, `ti_prices_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (e) {
      push(`Export failed: ${e.message || e}`, 'error');
    } finally {
      setExporting(false);
    }
  }

  function TT({catId}){
    const d=liveData?.[catId];
    const basket=basketCatFor(catId);
    const evid=evidenceCatFor(catId);
    const agree=combinedAgreementFor(catId);
    // Phase 24E — TI Direct primary, channel checks secondary.
    const tiCanonical = combinedEvidence?.legacyToCanonical?.[catId];
    const tiRollupRow = tiCanonical ? tiRollupsByCanonical[tiCanonical] : null;
    // Phase 25 — TI Direct snapshot delta (drives the QTD row). Surfaced
    // in the tooltip so users can see what the QTD cell is comparing
    // without having to inspect the native title attribute.
    const tiTrendRow = tiCanonical ? tiTrendByCanonical[tiCanonical] : null;
    // Allow rendering even when distributor data is silent — TI Direct
    // alone is enough to show the QTD evidence block.
    if(!d&&!basket&&!evid&&!agree&&!tiRollupRow&&!tiTrendRow)return null;
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

    const interp = 'Latest price move';

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

      {/* QTD vs Mar-26 baseline — primary evidence block when both a
          quarter-close baseline AND a latest TI Direct rollup price are
          available for this canonical subcategory. Mirrors the per-cell
          title in the QTD row. Today this block is hidden because no
          baseline is stored yet; once TI_QTD_BASELINE_Q1_26 is populated,
          customers can read the (latest − baseline) ÷ baseline movement
          here without leaving the tooltip. */}
      {(() => {
        const baselineEntry = tiCanonical ? TI_QTD_BASELINE_Q1_26[tiCanonical] : null;
        const latestPx = Number(tiRollupRow?.medianNormalizedUnitPrice);
        const basePx = Number(baselineEntry?.baselineMedianPrice);
        if (!Number.isFinite(latestPx) || !Number.isFinite(basePx) || basePx <= 0) return null;
        const fmtUSD = (n) => Number.isFinite(n)
          ? `$${Number(n).toLocaleString(undefined,{minimumFractionDigits:4,maximumFractionDigits:4})}`
          : '—';
        const dateOnly = (s) => (typeof s === 'string' ? s.slice(0,10) : '—');
        const qtdPct = ((latestPx - basePx) / basePx) * 100;
        const qtdColor = qtdPct > 0 ? '#4dffc3' : qtdPct < 0 ? '#f05c5c' : '#e0eaf8';
        const fmtPct = (n) => `${n > 0 ? '+' : ''}${(Math.round(n * 100) / 100).toFixed(2)}%`;
        return (
          <div style={{borderTop:'1px solid #1a2740',paddingTop:8,marginBottom:9}}>
            <div style={{fontSize:'0.55rem',color:'#ffd700',letterSpacing:'0.04em',marginBottom:5,textTransform:'uppercase',fontWeight:'bold'}}>
              QTD vs Mar-26 — TI Direct baseline
            </div>
            <div style={{display:'grid',gridTemplateColumns:'auto 1fr',rowGap:4,columnGap:14,fontSize:'0.6rem'}}>
              <span style={{color:'#7a96b8'}}>Latest TI Direct</span>
              <span style={{color:'#e0eaf8',fontFamily:'monospace'}}>{dateOnly(tiRollupRow?.latestCapturedAt)} · {fmtUSD(latestPx)}</span>
              <span style={{color:'#7a96b8'}}>Baseline period</span>
              <span style={{color:'#e0eaf8'}}>{baselineEntry?.baselinePeriod || TI_QTD_BASELINE_PERIOD_LABEL}</span>
              <span style={{color:'#7a96b8'}}>Baseline price</span>
              <span style={{color:'#e0eaf8',fontFamily:'monospace'}}>{baselineEntry?.baselineCapturedAt || '—'} · {fmtUSD(basePx)}</span>
              <span style={{color:'#7a96b8'}}>QTD price move</span>
              <span style={{color:qtdColor,fontFamily:'monospace',fontWeight:'bold'}}>{fmtPct(qtdPct)}</span>
            </div>
          </div>
        );
      })()}

      {/* Latest snapshot Δ — TI Direct catalog. Subordinate evidence:
          how the latest TI Direct snapshot moved against the previous
          one. NOT the headline QTD value (that's the baseline block
          above). Visible whenever the trend endpoint has at least two
          snapshots for this canonical subcategory; useful for stock
          movement context and for spotting day-over-day price action. */}
      {tiTrendRow && tiTrendRow.hasEnoughHistory && (() => {
        const dateOnly = (s) => (typeof s === 'string' ? s.slice(0,10) : '—');
        const fmtUSD = (n) => Number.isFinite(n)
          ? `$${Number(n).toLocaleString(undefined,{minimumFractionDigits:4,maximumFractionDigits:4})}`
          : '—';
        const dpx = Number.isFinite(tiTrendRow.priceDeltaPct) ? tiTrendRow.priceDeltaPct : null;
        const dst = Number.isFinite(tiTrendRow.stockDeltaPct) ? tiTrendRow.stockDeltaPct : null;
        const dpxColor = dpx == null ? '#7a96b8' : dpx > 0 ? '#4dffc3' : dpx < 0 ? '#f05c5c' : '#e0eaf8';
        const dstColor = dst == null ? '#7a96b8' : dst > 0 ? '#4dffc3' : dst < 0 ? '#f05c5c' : '#e0eaf8';
        const fmtPct = (n) => n == null ? '—' : `${n > 0 ? '+' : ''}${(Math.round(n * 100) / 100).toFixed(2)}%`;
        return (
          <div style={{borderTop:'1px solid #1a2740',paddingTop:8,marginBottom:9}}>
            <div style={{fontSize:'0.55rem',color:'#7a96b8',letterSpacing:'0.04em',marginBottom:5,textTransform:'uppercase'}}>
              Latest snapshot Δ — TI Direct catalog
            </div>
            <div style={{display:'grid',gridTemplateColumns:'auto 1fr',rowGap:4,columnGap:14,fontSize:'0.6rem'}}>
              <span style={{color:'#7a96b8'}}>Latest snapshot</span>
              <span style={{color:'#e0eaf8',fontFamily:'monospace'}}>{dateOnly(tiTrendRow.latestSnapshotAt)} · {fmtUSD(tiTrendRow.latestPrice)}</span>
              <span style={{color:'#7a96b8'}}>Previous snapshot</span>
              <span style={{color:'#e0eaf8',fontFamily:'monospace'}}>{dateOnly(tiTrendRow.previousSnapshotAt)} · {fmtUSD(tiTrendRow.previousPrice)}</span>
              <span style={{color:'#7a96b8'}}>Δ price</span>
              <span style={{color:dpxColor,fontFamily:'monospace',fontWeight:'bold'}}>{fmtPct(dpx)}</span>
              <span style={{color:'#7a96b8'}}>Δ stock</span>
              <span style={{color:dstColor,fontFamily:'monospace'}}>{fmtPct(dst)}</span>
            </div>
            {dpx === 0 && (
              <div style={{fontSize:'0.55rem',color:'#7a96b8',marginTop:6,fontStyle:'italic',lineHeight:1.4}}>
                No price movement detected between the two TI Direct snapshots.
              </div>
            )}
          </div>
        );
      })()}

      {/* Source detail */}
      <div style={{fontSize:'0.55rem',color:'#4a6a8a',marginBottom:9,fontStyle:'italic',lineHeight:1.45}}>
        Source: TI data · Live updates: Mouser / Nexar
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
            {isRateLimited&&<span style={{color:'#7a96b8',marginLeft:6,fontStyle:'italic'}}>· update pending</span>}
          </div>}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={exportCSV} disabled={exporting} style={{background:'none',border:`1px solid ${B}`,borderRadius:4,padding:'5px 10px',fontSize:'0.67rem',color: exporting ? '#2d4a6b' : '#4a6480',cursor: exporting ? 'default' : 'pointer'}}>{exporting ? 'Exporting…' : '↓ XLSX'}</button>
          <button
            onClick={()=>fetchLive(true)}
            disabled={loading || isRateLimited}
            title={isRateLimited ? 'Update pending — will retry automatically' : 'Click Refresh to get the latest data'}
            style={{
              background: loading ? '#1a2740' : isRateLimited ? '#0d1422' : '#1565c0',
              border: isRateLimited ? `1px solid ${B}` : 'none',
              borderRadius:4, padding:'6px 14px', fontSize:'0.72rem',
              color: loading ? '#4a6480' : isRateLimited ? '#7a96b8' : '#fff',
              cursor: loading || isRateLimited ? 'not-allowed' : 'pointer',
              display:'flex', alignItems:'center', gap:6
            }}>
            {loading && <span style={{width:7,height:7,border:'1.5px solid #4a6480',borderTopColor:'#fff',borderRadius:'50%',display:'inline-block',animation:'spin 0.7s linear infinite'}}/>}
            {loading ? 'Refreshing…' : isRateLimited ? 'Update pending' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Tab strip (Phase 19B) ── */}
      <div style={{display:'flex',gap:0,borderBottom:`1px solid ${B}`,background:'#050810',padding:'0 12px'}}>
        {[
          {id:'prices', label:'Prices'},
          {id:'inventory', label:'Supply'},
          {id:'universe', label:'Universe'},
          {id:'insights', label:'Insights'},
          {id:'ubs', label:'UBS Compare'},
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

      {activeTab==='prices'&&<TrendSeriesPanel vis={vis} setVis={setVis} hiddenSub={hiddenSub} setHiddenSub={setHiddenSub} isRateLimited={isRateLimited} fetchedAt={fetchedAt} GC={GC} CATS={CATS} B={B} />}
      {activeTab==='ubs'&&(
        <div className="ubs-compare-scope">
          <TrendSeriesPanel
            vis={ubsVis} setVis={setUbsVis}
            hiddenSub={ubsHiddenSub} setHiddenSub={setUbsHiddenSub}
            isRateLimited={isRateLimited}
            fetchedAt={fetchedAt}
            GC={UBS_GC} CATS={UBS_CATS} B={B}
            dataTransform={tiSeriesToUbs}
            showAverageColumn
          />
        </div>
      )}
      {false&&<>
      {/* ── Legacy panel (replaced by TrendSeriesPanel) ── */}
      <div style={{display:'none'}}>

      {/* ── Customer-facing legend (clean) ── */}
      <div style={{display:'flex',gap:18,padding:'7px 16px',borderBottom:`1px solid #0d1520`,fontSize:'0.62rem',color:'#7a96b8',flexWrap:'wrap',background:'#050810',alignItems:'center'}}>
        <span><span style={{color:'#00c9a7'}}>■</span> Price increase</span>
        <span><span style={{color:'#f05c5c'}}>■</span> Price decrease</span>
        <span style={{color:'#4a6a8a'}}>· Quarterly rows show QoQ price movement</span>
        <span style={{color:'#4a6a8a'}}>· QTD row shows the latest update</span>
      </div>

      {/* ── Data sources (collapsed) ── */}
      <details style={{borderBottom:`1px solid #0d1520`,background:'#050810'}}>
        <summary style={{padding:'6px 16px',fontSize:'0.6rem',color:'#4a6a8a',cursor:'pointer',letterSpacing:'0.06em',textTransform:'uppercase',userSelect:'none'}}>Data sources</summary>
        <div style={{padding:'4px 16px 10px',fontSize:'0.62rem',color:'#7a96b8',lineHeight:1.5,maxWidth:880}}>
          TI is the primary data source. Live updates come from Mouser and Nexar. Quarterly rows show price changes from one quarter to the next; the live row shows the latest update.
          {isRateLimited && <div style={{marginTop:6,color:'#4a6a8a',fontStyle:'italic'}}>Some live data is still updating. TI data is still available.</div>}
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
              const stickyBg=isLast?"#0c1523":isRecent?"#0a1019":pi%2===0?"#080c14":"#06080f";
              return(
                <tr key={p} style={{background:bg}}>
                  <td style={{padding:'4px 12px 4px 16px',borderRight:`1px solid ${B}`,borderBottom:`1px solid #0d1520`,fontFamily:'monospace',fontSize:'0.7rem',position:'sticky',left:0,background:stickyBg,zIndex:2,color:isLast?'#3d8ef0':isRecent?'#7aaee8':'#4a6a8a',fontWeight:isRecent?'600':'normal'}}>
                    {isRecent?'→ ':'   '}{p}
                  </td>
                  {visCats.map((c,i)=>{const iF=i===0||visCats[i-1].g!==c.g;const{txt,col,bold}=fmt(HIST[p]?.[c.id]);return(
                    <td key={c.id} style={{padding:'4px 6px',textAlign:'right',borderBottom:`1px solid #0d1520`,borderLeft:iF?`1px solid #0d1520`:'none',fontFamily:'monospace',fontSize:bold?'0.74rem':'0.7rem',color:col,fontWeight:bold?'bold':'normal'}}>{txt}</td>
                  );})}
                </tr>
              );
            })}

            {/* Phase 25.2 — QTD vs Mar-26 row.
                The customer-facing QTD value is:
                    (latest TI Direct median normalized unit price
                       − Mar-26 / Q1-26 close TI Direct baseline)
                    ÷ baseline × 100
                That baseline (TI_QTD_BASELINE_Q1_26) is empty today, so
                every cell renders '—' with a "baseline price unavailable"
                tooltip. We deliberately do NOT fall back to a latest-vs-
                previous-snapshot delta (too noisy day-to-day), nor to the
                Mouser qty-1 BASELINES (different source, would mix data).
                /api/ti/universe/catalog/rollups/trend's priceDeltaPct
                continues to drive Insights, stock movement, and the rich
                hover tooltip's "Latest snapshot Δ" block — it just isn't
                the value of the QTD cell anymore. */}
            {(() => {
              const baselineEntries = Object.values(TI_QTD_BASELINE_Q1_26 || {});
              const haveAnyBaseline = baselineEntries.length > 0;
              const sampleBaselineDate = haveAnyBaseline
                ? (baselineEntries.find(b => b?.baselineCapturedAt)?.baselineCapturedAt || null)
                : null;
              const sampleLatestDate = (() => {
                const entries = Object.values(tiRollupsByCanonical || {});
                const withDate = entries.find(r => r?.latestCapturedAt);
                return withDate?.latestCapturedAt?.slice(0,10) || null;
              })();
              let qtdSourceLabel;
              let labelColor = '#7a96b8';
              if (tiTrendLoadingState === 'loading') {
                qtdSourceLabel = 'QTD vs Mar-26: loading TI Direct catalog…';
              } else if (tiTrendLoadingState === 'failed') {
                qtdSourceLabel = 'QTD vs Mar-26: TI Direct unavailable';
                labelColor = '#f0a84e';
              } else if (haveAnyBaseline && sampleLatestDate) {
                qtdSourceLabel = `QTD vs Mar-26: latest TI Direct snapshot ${sampleLatestDate} vs Q1-26 close baseline (${sampleBaselineDate || '—'})`;
              } else if (haveAnyBaseline) {
                qtdSourceLabel = `QTD vs Mar-26: Q1-26 close baseline available, latest TI Direct rollup pending`;
              } else {
                qtdSourceLabel = 'QTD vs Mar-26: baseline unavailable — need stored quarter-close TI Direct prices';
                labelColor = '#f0a84e';
              }
              const qtdSourceTitle = `The bottom QTD row computes (latest TI Direct median normalized unit price − Mar-26 / Q1-26 close TI Direct baseline) ÷ baseline × 100, per canonical subcategory. The latest median comes from /api/ti/universe/catalog/rollups/latest; the baseline is loaded from a static map (TI_QTD_BASELINE_Q1_26) that's empty today because no quarter-close TI Direct snapshot is stored. While the baseline is missing the row renders — for every cell rather than fall back to a latest-vs-previous snapshot delta (too noisy day-to-day) or to Mouser qty-1 prices (different source). /api/ti/universe/catalog/rollups/trend remains in use for Insights and the rich hover tooltip's "Latest snapshot Δ" section.`;
              return (
                <tr>
                  <td colSpan={visCats.length+1} style={{padding:'0',background:'#0c1018',borderTop:`1px solid ${B}`,borderBottom:`1px solid ${B}`}}>
                    <div style={{fontSize:'0.52rem',color:'#2d4a6b',padding:'4px 16px',letterSpacing:'0.1em',display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
                      <span>▼ Latest data {fetchedAt?`· updated ${new Date(fetchedAt).toLocaleString()}`:'· Click Refresh to get latest data'}</span>
                      {isRateLimited && <span style={{color:'#7a96b8',fontStyle:'italic'}}>· update pending</span>}
                      <span title={qtdSourceTitle} style={{color:labelColor}}>· {qtdSourceLabel}</span>
                    </div>
                  </td>
                </tr>
              );
            })()}

            {/* QTD vs Mar-26 row — single, always-rendered, baseline-driven.
                Cell value: ((latestTiMedian − baselineTiMedian) / baseline)*100
                where baseline comes from TI_QTD_BASELINE_Q1_26[canonical].
                The row is always rendered (no collapsed message) so the
                customer can see what the row is meant to mean even when no
                cell can be computed; each cell carries a self-explanatory
                title attribute, and the divider line above states the row's
                source/state. */}
            <tr style={{background:'rgba(255,215,0,0.035)'}}>
              <td style={{padding:'6px 12px 6px 16px',borderRight:`1px solid ${B}`,borderBottom:`1px solid ${B}`,fontFamily:'monospace',fontSize:'0.72rem',position:'sticky',left:0,background:'#141102',zIndex:2,color:'#ffd700',fontWeight:'bold'}}>
                {tiTrendLoadingState === 'loading'
                  ? <span style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{width:6,height:6,border:'1.5px solid #4a6480',borderTopColor:'#ffd700',borderRadius:'50%',display:'inline-block',animation:'spin 0.7s linear infinite'}}/>
                      QTD vs Mar-26
                    </span>
                  : '★ QTD vs Mar-26'}
              </td>
              {visCats.map((c,i)=>{
                const iF=i===0||visCats[i-1].g!==c.g;
                const d=liveData?.[c.id];
                const isLive=d&&!d.error&&d.parts?.length>0;
                const hasBasket=!!basketCatFor(c.id);
                const canonicalForCell = combinedEvidence?.legacyToCanonical?.[c.id] ?? STATIC_LEGACY_TO_CANONICAL[c.id];
                const tiRollup = canonicalForCell ? tiRollupsByCanonical[canonicalForCell] : null;
                const tiTrend = canonicalForCell ? tiTrendByCanonical[canonicalForCell] : null;
                const baselineEntry = canonicalForCell ? TI_QTD_BASELINE_Q1_26[canonicalForCell] : null;
                const latestPx = Number(tiRollup?.medianNormalizedUnitPrice);
                const basePx = Number(baselineEntry?.baselineMedianPrice);
                const haveBoth = Number.isFinite(latestPx) && Number.isFinite(basePx) && basePx > 0;
                const v = haveBoth ? ((latestPx - basePx) / basePx) * 100 : null;
                const hasTiRollup = !!tiRollup;
                const tiQualityLabel = tiRollup?.qualityLabel || 'unknown';
                const tiUsable = tiRollup?.usableForPricesLiveEvidence === true;
                // Hover fires when ANY of: Mouser/Nexar live, Nexar basket,
                // TI rollup, TI trend present. The rich tooltip exposes the
                // QTD baseline section + the (subordinate) "Latest snapshot
                // Δ" section based on whichever data is available.
                const hasTooltip = isLive || hasBasket || hasTiRollup || !!tiTrend;
                // Phase 24D — clicking a cell with a TI rollup hops to the
                // Universe tab pre-filtered to this canonical subcategory.
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
                const{txt,col,bold}=v!=null?fmt(v):{txt:'—',col:'#2a4060',bold:false};
                const fmtSignedPct = (n) => {
                  if (!Number.isFinite(n)) return '—';
                  const r = Math.round(n * 100) / 100;
                  return `${r > 0 ? '+' : ''}${r.toFixed(2)}%`;
                };
                const fmtUSD = (n) => Number.isFinite(n)
                  ? `$${Number(n).toLocaleString(undefined,{minimumFractionDigits:4,maximumFractionDigits:4})}`
                  : '—';
                const dateOnly = (s) => (typeof s === 'string' ? s.slice(0,10) : null);
                let cellTitle;
                if (v != null) {
                  const latestAt = dateOnly(tiRollup?.latestCapturedAt) || '—';
                  const baseAt = baselineEntry?.baselineCapturedAt || '—';
                  cellTitle =
`QTD vs Mar-26 (Q1-26 close baseline)
Canonical subcategory: ${canonicalForCell || '—'}
Latest TI Direct snapshot: ${latestAt} · median ${fmtUSD(latestPx)}
Baseline (${baselineEntry?.baselinePeriod || TI_QTD_BASELINE_PERIOD_LABEL}): ${baseAt} · median ${fmtUSD(basePx)}
QTD price move: ${fmtSignedPct(v)}${hasTiRollup ? '\nClick to see the TI parts in this category.' : ''}`;
                } else if (tiTrendLoadingState === 'loading') {
                  cellTitle = `QTD vs Mar-26: loading TI Direct catalog…\nCanonical subcategory: ${canonicalForCell || '—'}`;
                } else if (!canonicalForCell) {
                  cellTitle = `QTD vs Mar-26: no comparison available\nThis legacy category id (${c.id}) is not mapped to a TI canonical subcategory.`;
                } else if (!Number.isFinite(basePx) || basePx <= 0) {
                  cellTitle =
`QTD baseline price unavailable. Need stored quarter-close TI Direct price baseline.
Canonical subcategory: ${canonicalForCell}
Period: ${TI_QTD_BASELINE_PERIOD_LABEL}
Latest TI Direct snapshot: ${dateOnly(tiRollup?.latestCapturedAt) || '—'} · median ${fmtUSD(latestPx)}
Once a Mar-26 / Q1-26 close TI Direct snapshot is captured and stored, this cell will compute (latest − baseline) ÷ baseline × 100.`;
                } else if (!Number.isFinite(latestPx)) {
                  cellTitle = `QTD vs Mar-26: latest TI Direct rollup price unavailable for this subcategory yet.\nCanonical subcategory: ${canonicalForCell}\nBaseline (${baselineEntry?.baselinePeriod || TI_QTD_BASELINE_PERIOD_LABEL}): ${baselineEntry?.baselineCapturedAt || '—'} · median ${fmtUSD(basePx)}`;
                } else {
                  cellTitle = `QTD vs Mar-26: comparison unavailable.\nCanonical subcategory: ${canonicalForCell}`;
                }
                return(
                  <td key={c.id}
                    className={handleClick?'tdc':undefined}
                    onMouseEnter={hasTooltip?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseMove={hasTooltip?e=>setTooltip({catId:c.id,x:e.clientX,y:e.clientY}):undefined}
                    onMouseLeave={hasTooltip?()=>setTooltip(null):undefined}
                    onClick={handleClick}
                    title={cellTitle}
                    style={{padding:'5px 6px',textAlign:'right',borderBottom:`1px solid ${B}`,borderLeft:iF?`1px solid #0d1520`:'none',fontFamily:'monospace',fontSize:bold?'0.76rem':'0.72rem',color:v==null&&d?.error?'#2d4a6b':col,fontWeight:bold?'bold':'normal',cursor:handleClick?'pointer':hasTooltip?'crosshair':'default'}}>
                    {txt}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      </div>
      </>}

      {activeTab==='inventory'&&<SupplyPanel
        tiRollupsByCanonical={tiRollupsByCanonical}
        tiTrendByCanonical={tiTrendByCanonical}
        combinedEvidence={combinedEvidence}
        setUniverseFilter={setUniverseFilter}
        setActiveTab={setActiveTab}
      />}

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
      {activeTab==='prices'&&tooltip&&(liveData?.[tooltip.catId]||basketCatFor(tooltip.catId)||evidenceCatFor(tooltip.catId)||tiRollupsByCanonical[combinedEvidence?.legacyToCanonical?.[tooltip.catId]]||tiTrendByCanonical[combinedEvidence?.legacyToCanonical?.[tooltip.catId]])&&(
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
        <span>USD · {HP.length} quarters of history + latest data</span>
        <span>TI Product Price Intelligence</span>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
