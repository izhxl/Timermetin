
// Metin Timer • Villo 2 — Refactor build v1.0-refactor
const STORAGE_KEY = "metin_villo2_refactor_state_v1";
const CHANNELS = 6;
const VERSION = "v0.0 revisioned";


// === REALTIME_SYNC (Firebase Firestore) ===
// Single room: rooms/villo2 (doc)
const ROOM_ID = "villo2";
const RT_KEY = "metin_villo2_realtime_enabled";
const ROOM_PROFILE_ID = "room_shared_v1";

let rt = {
  enabled: false,
  ready: false,
  uid: null,
  app: null,
  db: null,
  auth: null,
  docRef: null,
  unsub: null,
  applyingRemote: false,
  lastLocalWriteMs: 0,
  connecting: false,
  connectToken: 0,
};

function setRtStatus(txt){
  if (!rtStatusEl) return;
  rtStatusEl.textContent = txt;
}
function rtSleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function rtErrText(e){
  if (!e) return "errore";
  const code = e.code || e.name || "";
  const msg = e.message || String(e);
  return (code ? (code + ": ") : "") + msg;
}
function setRtUid(uid){
  if (!rtUidEl || !rtUserLineEl) return;
  if (uid){
    rtUidEl.textContent = uid;
    rtUserLineEl.style.display = "";
  } else {
    rtUserLineEl.style.display = "none";
  }
}

function ensureRoomProfile(){
  if (!state.profiles[ROOM_PROFILE_ID]){
    const p = defaultProfile();
    p.name = "Stanza (realtime)";
    state.profiles[ROOM_PROFILE_ID] = p;
  }
}

function switchToRoomProfile(){
  ensureRoomProfile();
  if (state.activeProfileId !== ROOM_PROFILE_ID){
    state._lastLocalProfileId = state.activeProfileId;
    state.activeProfileId = ROOM_PROFILE_ID;
    saveState();
    populateProfilesUI();
    syncUIFromProfile();
  }
}
function switchBackFromRoomProfile(){
  const last = state._lastLocalProfileId;
  if (last && state.profiles[last]){
    state.activeProfileId = last;
    saveState();
    populateProfilesUI();
    syncUIFromProfile();
  }
}

async function ensureFirebase(){
  setRtStatus("Carico SDK...");
  if (rt.ready) return;
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg) throw new Error("firebase-config-missing");

  const [{ initializeApp }, { getAuth, signInAnonymously, onAuthStateChanged }, { getFirestore, doc, onSnapshot, setDoc, serverTimestamp }] =
    await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js"),
    ]);

  if (!rt.app){
    rt.app = initializeApp(cfg);
    rt.auth = getAuth(rt.app);
    rt.db = getFirestore(rt.app);
    rt.docRef = doc(rt.db, "rooms", ROOM_ID);

    setRtStatus("Login anonimo...");
    if (!rt.auth.currentUser){
      await signInAnonymously(rt.auth);
    }
    onAuthStateChanged(rt.auth, (user)=>{
      rt.uid = user ? user.uid : null;
      setRtUid(rt.uid);
    });
  }
  rt.ready = true;
}

function roomPayloadFromLocal(){
  const p = state.profiles[ROOM_PROFILE_ID] ? state.profiles[ROOM_PROFILE_ID] : activeProfile();
  return {
    v: 1,
    updatedAtClientMs: Date.now(),
    shared: {
      timersByCh: p.data.timersByCh,
      excluded: p.data.excluded || {},
      respawn: {
        minMin: Number(p.settings.minMin),
        modeMin: Number(p.settings.modeMin),
        maxMin: Number(p.settings.maxMin),
      }
    }
  };
}

async function writeRoomState(){
  if (!rt.enabled || !rt.ready || !rt.docRef) return;
  if (rt.applyingRemote) return;
  try{
    const { setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
    rt.lastLocalWriteMs = Date.now();
    const payload = roomPayloadFromLocal();
    payload.updatedAtServer = serverTimestamp();
    await setDoc(rt.docRef, payload, { merge: true });
    setRtStatus("ON • sync");
  }catch(e){
    console.error(e);
    setRtStatus("Write: " + rtErrText(e));
  }
}

function applyRoomToLocal(roomData){
  if (!roomData || !roomData.shared) return;
  const shared = roomData.shared;

  switchToRoomProfile();
  const p = state.profiles[ROOM_PROFILE_ID];

  rt.applyingRemote = true;
  try{
    if (shared.respawn){
      p.settings.minMin = Number(shared.respawn.minMin ?? p.settings.minMin);
      p.settings.modeMin = Number(shared.respawn.modeMin ?? p.settings.modeMin);
      p.settings.maxMin = Number(shared.respawn.maxMin ?? p.settings.maxMin);
    }
    if (shared.timersByCh){
      p.data.timersByCh = shared.timersByCh;
    }
    if (shared.excluded){
      p.data.excluded = shared.excluded;
    }
    saveState();
    syncUIFromProfile();
    renderAll();
  } finally {
    rt.applyingRemote = false;
  }
}

async function connectRealtime(){
  // Prevent parallel connects
  if (rt.connecting) return;
  rt.connecting = true;
  const token = ++rt.connectToken;

  rt.enabled = true;
  localStorage.setItem(RT_KEY, "1");
  setRtStatus("Connessione...");
  switchToRoomProfile();

  if (!navigator.onLine){
    setRtStatus("Offline (no rete)");
    rt.connecting = false;
    return;
  }

  // Longer timeout: some networks are slow
  const rtConnectTimeout = setTimeout(()=>{
    if (rt.enabled && token === rt.connectToken && rtStatusEl && rtStatusEl.textContent.startsWith("Connessione")){
      setRtStatus("Timeout: rete/Auth/Rules");
    }
  }, 20000);

  // 1) Init + auth with retries
  let okInit = false;
  for (let i=0; i<3; i++){
    if (!rt.enabled || token !== rt.connectToken) break;
    try{
      await ensureFirebase();
      okInit = true;
      break;
    }catch(e){
      console.error(e);
      setRtStatus(`Init: ${rtErrText(e)} (retry ${i+1}/3)`);
      await rtSleep(800*(i+1));
    }
  }
  if (!okInit || !rt.enabled || token !== rt.connectToken){
    clearTimeout(rtConnectTimeout);
    rt.connecting = false;
    return;
  }

  // 2) Subscribe with retries
  let okListen = false;
  for (let i=0; i<3; i++){
    if (!rt.enabled || token !== rt.connectToken) break;
    try{
      const { onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
      if (rt.unsub) rt.unsub();

      rt.unsub = onSnapshot(rt.docRef, (snap)=>{
        if (!snap.exists()){
          writeRoomState();
          return;
        }
        applyRoomToLocal(snap.data());
        setRtStatus("ON");
      }, (err)=>{
        console.error(err);
        setRtStatus("Listen: " + rtErrText(err));
      });

      await writeRoomState();
      okListen = true;
      break;
    }catch(e){
      console.error(e);
      setRtStatus(`Listen: ${rtErrText(e)} (retry ${i+1}/3)`);
      await rtSleep(900*(i+1));
    }
  }

  clearTimeout(rtConnectTimeout);
  rt.connecting = false;

  if (!okListen){
    setRtStatus("Errore listen");
    return;
  }

  setRtStatus("ON");
}

function disconnectRealtime(function disconnectRealtime(){
  rt.enabled = false;
  localStorage.removeItem(RT_KEY);
  if (rt.unsub) { rt.unsub(); rt.unsub = null; }
  setRtStatus("OFF");
  setRtUid(null);
  switchBackFromRoomProfile();
  renderAll();
}

function maybeRealtimeAfterChange(){
  if (!rt.enabled) return;
  if (state.activeProfileId !== ROOM_PROFILE_ID) return;
  writeRoomState();
}
// === /REALTIME_SYNC ===

// === DATA: clusters (percent coords) ===
// NOTE: These coords will be tuned as you/your friends test.
// Overlapping clusters are allowed; UI offsets them automatically.
const CLUSTERS = [
  // 35
  { id:"35_w_s",    level:35, name:"35 • Ovest (sud)",        x:18.0, y:58.0, slots:5, zoneR:8.0 },
  { id:"35_w_n",    level:35, name:"35 • Ovest (nord/isola)", x:13.0, y:12.0, slots:2, zoneR:7.0 },
  { id:"35_north",  level:35, name:"35 • Nord (nuova)",       x:44.0, y:10.0, slots:2, zoneR:7.0 },

  // 30
  { id:"30_se_big", level:30, name:"30 • Sud-Est (grande)", x:75.0, y:80.0, slots:3, zoneR:8.0 },
  { id:"30_e_mid",  level:30, name:"30 • Est (medio)",      x:85.0, y:33.0, slots:2, zoneR:7.0 },
  { id:"30_c_isle", level:30, name:"30 • Centro isola",     x:43.0, y:41.0, slots:2, zoneR:7.0 },
  { id:"30_ne",     level:30, name:"30 • Nord-Est",         x:70.0, y:18.0, slots:2, zoneR:7.0 },
  { id:"30_sw",     level:30, name:"30 • Sud-Ovest",        x:28.0, y:83.0, slots:2, zoneR:7.0 },
  { id:"30_s_mid",  level:30, name:"30 • Sud-Centro",       x:63.0, y:65.0, slots:2, zoneR:7.0 },
  { id:"30_w_s",    level:30, name:"30 • Ovest (sud)",      x:18.0, y:58.0, slots:2, zoneR:7.0 },
  { id:"30_w_n",    level:30, name:"30 • Ovest (nord)",     x:29.0, y:31.0, slots:1, zoneR:6.0 },
  { id:"30_north",  level:30, name:"30 • Nord (nuova)",     x:44.0, y:10.0, slots:2, zoneR:7.0 },

  // 25
  { id:"25_se_big", level:25, name:"25 • Sud-Est (grande)", x:75.0, y:80.0, slots:3, zoneR:8.0 },
  { id:"25_ne_big", level:25, name:"25 • Nord-Est (grande)",x:66.0, y:13.5, slots:3, zoneR:8.0 },
  { id:"25_e_mid",  level:25, name:"25 • Est (medio)",      x:85.0, y:33.0, slots:2, zoneR:7.0 },
  { id:"25_sw",     level:25, name:"25 • Sud-Ovest",        x:28.0, y:83.0, slots:2, zoneR:7.0 },
  { id:"25_c_band", level:25, name:"25 • Centro (fascia)",  x:56.0, y:43.0, slots:2, zoneR:7.0 },
  { id:"25_north",  level:25, name:"25 • Nord (nuova)",     x:44.0, y:10.0, slots:2, zoneR:7.0 },
  { id:"35_w_n2",   level:35, name:"35 • Ovest (nord)",      x:29.0, y:31.0, slots:2, zoneR:6.5 },
  { id:"35_ne",     level:35, name:"35 • Nord-Est",         x:70.0, y:18.0, slots:2, zoneR:7.0 },
];

// === DOM ===
const mapWrap = document.getElementById("mapWrap");
const overlay = document.getElementById("overlay");
const chSelect = document.getElementById("chSelect");
const filterSelect = document.getElementById("filterSelect");

const profileSelect = document.getElementById("profileSelect");
const profileManageBtn = document.getElementById("profileManageBtn");

const settingsBtn = document.getElementById("settingsBtn");
const resetChBtn = document.getElementById("resetChBtn");
const resetAllChBtn = document.getElementById("resetAllChBtn");
const rtEnableEl = document.getElementById("rtEnable");
const rtStatusEl = document.getElementById("rtStatus");
const rtUserLineEl = document.getElementById("rtUserLine");
const rtUidEl = document.getElementById("rtUid");

const sheetBackdrop = document.getElementById("sheetBackdrop");
const closeSheetBtn = document.getElementById("closeSheetBtn");

const minMinEl = document.getElementById("minMin");
const modeMinEl = document.getElementById("modeMin");
const maxMinEl = document.getElementById("maxMin");
const alreadyBrokenSecEl = document.getElementById("alreadyBrokenSec");
const nonFoundMinSecEl = document.getElementById("nonFoundMinSec");
const nonFoundMaxSecEl = document.getElementById("nonFoundMaxSec");

const mapStyleEl = document.getElementById("mapStyle");
const togSuggest = document.getElementById("togSuggest");
const togRoute = document.getElementById("togRoute");
const togSpawnGlow = document.getElementById("togSpawnGlow");
const autoPosLastEl = document.getElementById("autoPosLast");
const chSuggestThresholdEl = document.getElementById("chSuggestThreshold");
const togDetailed = document.getElementById("togDetailed");

const break25El = document.getElementById("break25");
const break30El = document.getElementById("break30");
const break35El = document.getElementById("break35");
const togBreakTime = document.getElementById("togBreakTime");

const secPerPctEl = document.getElementById("secPerPct");

const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");
const installHintBtn = document.getElementById("installHintBtn");

const resetSettingsBtn = document.getElementById("resetSettingsBtn");
const resetProfileBtn = document.getElementById("resetProfileBtn");

const measureLevelEl = document.getElementById("measureLevel");
const measureStartBtn = document.getElementById("measureStart");
const measureStopBtn = document.getElementById("measureStop");
const measureClearBtn = document.getElementById("measureClear");
const measureInfo = document.getElementById("measureInfo");

// === helpers ===
const nowMs = ()=> Date.now();
const pad2 = (n)=> String(n).padStart(2,"0");
function fmtTime(ts){ const d=new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function fmtCountdown(ms){
  if (ms <= 0) return "SPAWN?";
  const s=Math.floor(ms/1000);
  const m=Math.floor(s/60);
  const rs=s%60;
  const h=Math.floor(m/60);
  const rm=m%60;
  return h>0 ? `${h}:${pad2(rm)}:${pad2(rs)}` : `${rm}:${pad2(rs)}`;
}
const clamp=(n,a,b)=> Math.max(a, Math.min(b,n));
const escapeHtml=(s)=> (s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

// triangular distribution
function slotWindowState(slot){
  const s = activeProfile().settings;
  const minMs = slot.startedMs + Number(s.minMin) * 60_000;
  const maxMs = slot.startedMs + Number(s.maxMin) * 60_000;
  const likelyMs = slot.startedMs + Number(slot.rollMin ?? s.modeMin) * 60_000;
  const t = nowMs();
  return { minMs, maxMs, likelyMs, t };
}
function slotStatusText(slot){
  const {minMs, maxMs, likelyMs, t} = slotWindowState(slot);

  // Before min: show PROBABILE (likely)
  if (t < minMs){
    return { text: `~${fmtCountdown(likelyMs - t)}`, cls: "pre" };
  }

  // Within window: show countdown to likely (if not passed) else remaining window
  if (t <= maxMs){
    if (t <= likelyMs){
      return { text: `~${fmtCountdown(likelyMs - t)}`, cls: "window" };
    }
    return { text: `FINESTRA ${fmtCountdown(maxMs - t)}`, cls: "window" };
  }

  // Late
  return { text: `RITARDO +${fmtCountdown(t - maxMs)}`, cls: "late" };
}

function clusterReadiness(ch, cluster){
  const arr = timersArr(ch, cluster.id);
  if (!arr.length) return { ready: 0, nextMinMs: null, nextLikelyMs: null, conf: null, any: false };
  const t = nowMs();
  let ready=0;
  let nextMinMs=null;
  let nextLikelyMs=null;
  let conf="sure";
  for (const slot of arr){
    const {minMs, maxMs, likelyMs} = slotWindowState(slot);
    if (t >= minMs && t <= maxMs) ready++;
    if (t < minMs) nextMinMs = (nextMinMs==null) ? minMs : Math.min(nextMinMs, minMs);
    if (t < likelyMs) nextLikelyMs = (nextLikelyMs==null) ? likelyMs : Math.min(nextLikelyMs, likelyMs);
    if ((slot.conf ?? "sure") !== "sure") conf = "unsure";
  }
  return { ready, nextMinMs, nextLikelyMs, conf, any: true };
}


function randTriangular(min, mode, max){
  const u=Math.random();
  const c=(mode-min)/(max-min);
  if (u < c) return min + Math.sqrt(u*(max-min)*(mode-min));
  return max - Math.sqrt((1-u)*(max-min)*(max-mode));
}

// === state ===
function defaultProfile(){
  const timersByCh={};
  for (let ch=1; ch<=CHANNELS; ch++) timersByCh[ch]={};
  return {
    name: "Default",
    settings: {
      version: VERSION,
      filter: "all",
      mapStyle: "markers",
      minMin: 22,
      modeMin: 25,
      maxMin: 28,
      alreadyBrokenSec: 60,
      nonFoundMinSec: 60,
      nonFoundMaxSec: 240,
      suggest: true,
      route: false,
      spawnGlow: true,
      autoPosLast: true,
      chSuggestThreshold: 30,
      detailed: false,
      break25: 12,
      break30: 18,
      break35: 25,
      useBreakTime: true,
      secPerPct: 2.0,
    },
    data: {
      timersByCh,
      playerPos: { x: 50, y: 50 },
      excluded: {},
      measure: {
        "25": { count:0, avg:0, running:false, startedMs:null },
        "30": { count:0, avg:0, running:false, startedMs:null },
        "35": { count:0, avg:0, running:false, startedMs:null },
      }
    }
  };
}

function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no state");
    const s = JSON.parse(raw);
    if (!s.profiles || !s.activeProfileId) throw new Error("bad state");
    return s;
  } catch {
    const id = "p_" + Math.random().toString(16).slice(2,8);
    return { profiles: { [id]: defaultProfile() }, activeProfileId: id };
  }
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function activeProfile(){ return state.profiles[state.activeProfileId]; }
function setActiveProfile(id){
  if (!state.profiles[id]) return;
  state.activeProfileId = id;
  saveState();
  refreshProfileSelect();
  syncUIFromProfile();
  renderAll();
  startTicker();
}

// === timers model ===
// timersByCh[ch][clusterId] = array of slot objects {nextSpawnMs, startedMs, rollMin}
function timersArr(ch, clusterId){
  const t = activeProfile().data.timersByCh[ch][clusterId];
  return Array.isArray(t) ? t : [];
}
function setTimersArr(ch, clusterId, arr){ activeProfile().data.timersByCh[ch][clusterId] = arr; }
function clearTimers(ch, clusterId){ delete activeProfile().data.timersByCh[ch][clusterId]; }
function computeNextSpawnMs(ch, clusterId){
  const arr = timersArr(ch, clusterId);
  if (!arr.length) return null;
  return Math.min(...arr.map(t=>t.nextSpawnMs));
}

function breakTimeForLevel(level){
  const s = activeProfile().settings;
  if (level === 25) return Number(s.break25) || 0;
  if (level === 30) return Number(s.break30) || 0;
  return Number(s.break35) || 0;
}

function addTimer(ch, cluster, opts={}){
  const s = activeProfile().settings;
  const rollMin = (opts.forceRollMin != null) ? Number(opts.forceRollMin) : Number(s.modeMin);
  const skewMs = Math.max(0, Number(opts.skewMs || 0));
  const startedMs = nowMs() - skewMs;
  const nextSpawnMs = startedMs + (rollMin) * 60_000;

  let arr = timersArr(ch, cluster.id).slice();

  if (!s.detailed){
    // zone mode: single "zone timer"
    arr = [{ nextSpawnMs, startedMs, rollMin: Math.round(rollMin*10)/10, conf: opts.conf || 'sure' }];
  } else {
    // slot mode: each break fills one slot; cap by slots
    if (arr.length >= cluster.slots){
      // drop the oldest started (the one most likely overwritten/unknown)
      arr.sort((a,b)=>a.startedMs-b.startedMs);
      arr.shift();
    }
    arr.push({ nextSpawnMs, startedMs, rollMin: Math.round(rollMin*10)/10, conf: opts.conf || 'sure' });
  }

  setTimersArr(ch, cluster.id, arr);
  saveState();
}

// === movement ===
function distPct(a,b){ const dx=a.x-b.x; const dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }
function isExcluded(_ch, clusterId){
  const data = activeProfile().data;
  const ex = data.excluded || {};
  if (ex[clusterId] != null) return !!ex[clusterId];

  // Backward compat: older builds stored excludedByCh
  const byCh = data.excludedByCh;
  if (byCh){
    for (const k of Object.keys(byCh)){
      if (byCh[k] && byCh[k][clusterId]) return true;
    }
  }
  return false;
}
function toggleExcluded(_ch, clusterId){
  const data = activeProfile().data;
  const ex = data.excluded || (data.excluded = {});
  ex[clusterId] = !ex[clusterId];
  if (data.excludedByCh) delete data.excludedByCh;
  saveState();
  maybeRealtimeAfterChange();
}


function travelSeconds(fromPos, cluster){
  const secPerPct = Number(activeProfile().settings.secPerPct) || 0;
  return distPct(fromPos, cluster) * secPerPct; // simple for now
}

// ETA effective
function etaMsEffective(ch, cluster, fromPos, virtualNow=null){
  const next = computeNextSpawnMs(ch, cluster.id);
  if (next == null) return Infinity;

  const baseNow = virtualNow ?? nowMs();
  const remMs = next - baseNow;
  const travelMs = travelSeconds(fromPos, cluster) * 1000;
  const breakMs = (activeProfile().settings.useBreakTime ? breakTimeForLevel(cluster.level) * 1000 : 0);
  return Math.max(remMs, travelMs) + breakMs;
}

// Best recommendation across current CH
function recommendedClusterId(ch){
  if (!activeProfile().settings.suggest) return null;
  const fromPos = activeProfile().data.playerPos;
  let best=null;
  for (const c of visibleClusters()){
    if (isExcluded(ch, c.id)) continue;
    if (computeNextSpawnMs(ch, c.id) == null) continue;
    const eta=etaMsEffective(ch,c,fromPos);
    if (!best || eta < best.eta) best={id:c.id, eta};
  }
  return best ? best.id : null;
}

// Best CH suggestion (optional)
function bestEtaOnCh(ch){
  const fromPos = activeProfile().data.playerPos;
  let best=null;
  for (const c of visibleClusters()){
    if (isExcluded(ch, c.id)) continue;
    if (computeNextSpawnMs(ch, c.id) == null) continue;
    const eta=etaMsEffective(ch,c,fromPos);
    if (!best || eta < best.eta) best={ch, id:c.id, eta};
  }
  return best;
}

function recommendedCh(){
  if (!activeProfile().settings.suggest) return null;
  const fromPos = activeProfile().data.playerPos;
  let best=null;
  for (let ch=1; ch<=CHANNELS; ch++){
    for (const c of visibleClusters()){
      if (isExcluded(ch, c.id)) continue;
    if (isExcluded(ch, c.id)) continue;
      if (computeNextSpawnMs(ch, c.id) == null) continue;
      const eta=etaMsEffective(ch,c,fromPos);
      if (!best || eta < best.eta) best={ch, id:c.id, eta};
    }
  }
  return best;
}

function routeOrder(ch){
  if (!activeProfile().settings.route) return {};
  let currentPos={...activeProfile().data.playerPos};
  let virtualNow=nowMs();
  const candidates = visibleClusters().filter(c=>computeNextSpawnMs(ch,c.id)!=null && !isExcluded(ch, c.id));
  const order={};
  let step=1;

  while(candidates.length && step<=20){
    let bestIdx=-1, bestEta=Infinity;
    for (let i=0;i<candidates.length;i++){
      const c=candidates[i];
      const eta=etaMsEffective(ch,c,currentPos,virtualNow);
      if (eta < bestEta){ bestEta=eta; bestIdx=i; }
    }
    if (bestIdx<0) break;
    const chosen=candidates.splice(bestIdx,1)[0];
    order[chosen.id]=step++;

    // advance time and move
    const next = computeNextSpawnMs(ch, chosen.id);
    const travelMs = travelSeconds(currentPos, chosen)*1000;
    const remMs = next - virtualNow;
    const breakMs = (activeProfile().settings.useBreakTime ? breakTimeForLevel(chosen.level)*1000 : 0);
    virtualNow += Math.max(remMs, travelMs) + breakMs;
    currentPos={x:chosen.x,y:chosen.y};
  }
  return order;
}

// === visibility / overlap handling ===
function visibleClusters(){
  const f = activeProfile().settings.filter;
  if (f === "all") return CLUSTERS;
  if (String(f).includes("+")){
    const parts = String(f).split("+").map(x=>Number(x.trim())).filter(Boolean);
    return CLUSTERS.filter(c=>parts.includes(c.level));
  }
  const lvl = Number(f);
  return CLUSTERS.filter(c=>c.level===lvl);
}

function computeOffsetsPx(clusters){
  // group by rounded coord (0.5%) to find overlaps
  const groups=new Map();
  const keyOf=(c)=> `${Math.round(c.x*2)/2}_${Math.round(c.y*2)/2}`;
  for (const c of clusters){
    const k=keyOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const offsets=new Map();
  for (const [k, arr] of groups.entries()){
    if (arr.length===1){ offsets.set(arr[0].id, {ox:0, oy:0}); continue; }
    const r=14; // px spread
    for (let i=0;i<arr.length;i++){
      const ang=(2*Math.PI*i)/arr.length;
      offsets.set(arr[i].id, {ox: Math.round(Math.cos(ang)*r), oy: Math.round(Math.sin(ang)*r)});
    }
  }
  return offsets;
}

// === UI rendering ===
let openCardFor = null; // clusterId
let openCardIsPicker = false;

function openSheet(show){ sheetBackdrop.style.display = show ? "flex" : "none"; if (show) updateMeasureInfo(); }
function refreshProfileSelect(){
  profileSelect.innerHTML="";
  for (const [id, prof] of Object.entries(state.profiles)){
    const opt=document.createElement("option");
    opt.value=id; opt.textContent=prof.name;
    profileSelect.appendChild(opt);
  }
  profileSelect.value = state.activeProfileId;
}
function manageProfiles(){
  const p=activeProfile();
  const choice = prompt(
`Gestione profili:
1) Rinominare profilo attuale
2) Nuovo profilo (copia dall'attuale)
3) Elimina profilo (se ne hai più di uno)

Scrivi 1, 2 o 3:`
  );
  if (!choice) return;

  if (choice.trim()==="1"){
    const name=prompt("Nuovo nome profilo:", p.name);
    if (name && name.trim()){ p.name=name.trim(); saveState(); refreshProfileSelect(); }
    return;
  }
  if (choice.trim()==="2"){
    const name=prompt("Nome nuovo profilo:", "Nuovo profilo");
    const id="p_" + Math.random().toString(16).slice(2,8);
    state.profiles[id] = JSON.parse(JSON.stringify(p));
    state.profiles[id].name = (name && name.trim()) ? name.trim() : "Nuovo profilo";
    state.activeProfileId=id;
    saveState(); refreshProfileSelect(); syncUIFromProfile(); renderAll();
    return;
  }
  if (choice.trim()==="3"){
    const keys=Object.keys(state.profiles);
    if (keys.length<=1) return alert("Non puoi eliminare l'unico profilo.");
    if (!confirm(`Eliminare il profilo "${p.name}"?`)) return;
    delete state.profiles[state.activeProfileId];
    state.activeProfileId = Object.keys(state.profiles)[0];
    saveState(); refreshProfileSelect(); syncUIFromProfile(); renderAll();
    return;
  }
  alert("Scelta non valida.");
}

function syncUIFromProfile(){
  const p=activeProfile();
  filterSelect.value = p.settings.filter;
  mapStyleEl.value = p.settings.mapStyle ?? "markers";

  minMinEl.value = String(p.settings.minMin);
  modeMinEl.value = String(p.settings.modeMin);
  maxMinEl.value = String(p.settings.maxMin);
  alreadyBrokenSecEl.value = String(p.settings.alreadyBrokenSec ?? 60);
  if (nonFoundMinSecEl) nonFoundMinSecEl.value = String(p.settings.nonFoundMinSec ?? 60);
  if (nonFoundMaxSecEl) nonFoundMaxSecEl.value = String(p.settings.nonFoundMaxSec ?? 240);

  togSuggest.checked = !!p.settings.suggest;
  togRoute.checked = !!p.settings.route;
  togSpawnGlow.checked = !!p.settings.spawnGlow;
  if (autoPosLastEl) autoPosLastEl.checked = !!(p.settings.autoPosLast ?? true);
  if (chSuggestThresholdEl) chSuggestThresholdEl.value = String(p.settings.chSuggestThreshold ?? 30);
  togDetailed.checked = !!p.settings.detailed;

  break25El.value=String(p.settings.break25);
  break30El.value=String(p.settings.break30);
  break35El.value=String(p.settings.break35);
  togBreakTime.checked=!!p.settings.useBreakTime;

  secPerPctEl.value=String(p.settings.secPerPct);

  updateMeasureInfo();
}

function syncSettingsFromUI(){
  const p=activeProfile();
  // respawn
  const minV=clamp(Number(minMinEl.value), 1, 999);
  const maxV=Math.max(minV+0.5, Number(maxMinEl.value));
  const modeV=clamp(Number(modeMinEl.value), minV, maxV);
  minMinEl.value=String(minV); maxMinEl.value=String(maxV); modeMinEl.value=String(modeV);

  p.settings.filter = filterSelect.value;
  p.settings.mapStyle = mapStyleEl.value;

  p.settings.minMin=minV;
  p.settings.maxMin=maxV;
  p.settings.modeMin=modeV;
  p.settings.alreadyBrokenSec = Math.max(0, Number(alreadyBrokenSecEl.value) || 0);
  if (nonFoundMinSecEl && nonFoundMaxSecEl){
    const nfMin = Math.max(0, Number(nonFoundMinSecEl.value) || 0);
    const nfMax = Math.max(nfMin, Number(nonFoundMaxSecEl.value) || nfMin);
    nonFoundMinSecEl.value = String(nfMin);
    nonFoundMaxSecEl.value = String(nfMax);
    p.settings.nonFoundMinSec = nfMin;
    p.settings.nonFoundMaxSec = nfMax;
  }

  p.settings.suggest=!!togSuggest.checked;
  p.settings.route=!!togRoute.checked;
  p.settings.spawnGlow=!!togSpawnGlow.checked;
  p.settings.detailed=!!togDetailed.checked;

  p.settings.break25=Math.max(0, Number(break25El.value) || 0);
  p.settings.break30=Math.max(0, Number(break30El.value) || 0);
  p.settings.break35=Math.max(0, Number(break35El.value) || 0);
  p.settings.useBreakTime=!!togBreakTime.checked;

  p.settings.secPerPct=Math.max(0, Number(secPerPctEl.value) || 0);

  saveState();
  renderAll();
}

function renderZones(clusters){
  overlay.innerHTML="";
  const style = activeProfile().settings.mapStyle ?? "markers";
  if (style === "markers") return;

  const keyOf=(c)=> `${Math.round(c.x*2)/2}_${Math.round(c.y*2)/2}`;
  const groups=new Map();
  for (const c of clusters){
    const k=keyOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  for (const c of clusters){
    const z=document.createElement("div");
    z.className = "zone " + (c.level===25 ? "z25" : c.level===30 ? "z30" : "z35");
    z.dataset.id = c.id;
    z.dataset.key = keyOf(c);
    z.style.left = `${c.x}%`;
    z.style.top  = `${c.y}%`;
    const r = c.zoneR ?? 7;
    z.style.width = `${r*2}%`;
    z.style.height = `${r*2}%`;

    z.addEventListener("click",(e)=>{
      e.stopPropagation();
      const grp = groups.get(z.dataset.key);
      if (grp && grp.length>1){
        openCardFor = z.dataset.key;
        openCardIsPicker = true;
      }else{
        openCardFor = c.id;
        openCardIsPicker = false;
      }
      renderAll();
    });

    overlay.appendChild(z);
  }
}

function clampCardIntoMap(card){
  const wrapRect = mapWrap.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  let dx=0, dy=0;
  const pad=8;
  if (cardRect.left < wrapRect.left + pad) dx += (wrapRect.left + pad) - cardRect.left;
  if (cardRect.right > wrapRect.right - pad) dx -= cardRect.right - (wrapRect.right - pad);
  if (cardRect.top < wrapRect.top + pad) dy += (wrapRect.top + pad) - cardRect.top;
  if (cardRect.bottom > wrapRect.bottom - pad) dy -= cardRect.bottom - (wrapRect.bottom - pad);
  card.style.setProperty("--dx", `${Math.round(dx)}px`);
  card.style.setProperty("--dy", `${Math.round(dy)}px`);
}

function buildSlotList(ch, cluster){
  const arr = timersArr(ch, cluster.id).slice().sort((a,b)=>a.nextSpawnMs-b.nextSpawnMs);
  if (!activeProfile().settings.detailed) return "";

  let html = `<div class="slotList">`;
  if (!arr.length){
    html += `<div class="muted" style="font-size:12px;">Nessuno slot attivo.</div>`;
  } else {
    arr.forEach((t, idx)=>{
      const rem = t.nextSpawnMs - nowMs();
      html += `
        <div class="slotRow" data-slot="${idx}">
          <div>Slot ${idx+1}/${cluster.slots}</div>
          <div style="font-variant-numeric: tabular-nums;">${fmtCountdown(rem)}</div>
          <button data-act="clearSlot" data-slot="${idx}">X</button>
        </div>`;
    });
  }
  html += `</div>`;
  return html;
}

function buildClusterCard(ch, cluster, offset={ox:0,oy:0}){
  const card=document.createElement("div");
  card.className="card";
  card.style.left = `${cluster.x}%`;
  card.style.top  = `${cluster.y}%`;
  card.style.setProperty("--ox", `${offset.ox}px`);
  card.style.setProperty("--oy", `${offset.oy}px`);

  const arr = timersArr(ch, cluster.id);
  const next = computeNextSpawnMs(ch, cluster.id);
  const rem = next == null ? null : (next - nowMs());

  const firstSlot = (timersArr(ch, cluster.id).slice().sort((a,b)=>a.nextSpawnMs-b.nextSpawnMs)[0]) || null;
  const status = firstSlot ? slotStatusText(firstSlot) : null;

  const slotsInfo = activeProfile().settings.detailed
    ? `slot ${arr.length}/${cluster.slots}`
    : (arr.length ? "timer attivo" : "nessun timer");

  const eta = (next == null) ? null : etaMsEffective(ch, cluster, activeProfile().data.playerPos);
  const brokenSkew = Math.max(0, Number(activeProfile().settings.alreadyBrokenSec || 0))*1000;

  card.innerHTML = `
    <div class="row">
      <div class="title">${escapeHtml(cluster.name)}</div>
      <div class="badges">
        <span class="exdot ${isExcluded(ch, cluster.id) ? "off" : "on"}"></span>
        <span class="badge">Lv ${cluster.level}</span>
        <span class="badge">CH ${ch}</span>
      </div>
    </div>
    <div class="time">${next == null ? `<span class="muted">—</span>` : (status ? status.text : fmtCountdown(rem))}</div>
    <div class="sub">
      ${next == null ? `Nessun timer avviato • ${slotsInfo}` : `prox ~ ${fmtTime(next)} • ${slotsInfo}`}
      ${eta != null && isFinite(eta) ? `<br>ETA (viaggio+attesa+rottura): <b>${fmtCountdown(eta)}</b>` : ``}
    </div>
    ${buildSlotList(ch, cluster)}
    <div class="btns">
      <button data-act="break">Rotto</button>
      <button data-act="broken">Trovato già rotto</button>
      <button data-act="notfound">Non trovato</button>
      <button data-act="exclude">Escludi/Include giro</button>
      <button data-act="clear">Clear</button>
      <button data-act="close">Chiudi</button>
    </div>
    <div class="muted" style="margin-top:6px; font-size:11px;">
      “Già rotto” avvia il timer con una stima di ${Math.round(brokenSkew/1000)}s (modificabile in Impostazioni).
    </div>
  `;

  function maybeAutoPos(cluster){
  if (!!(activeProfile().settings.autoPosLast ?? true)){
    activeProfile().data.playerPos = {x:cluster.x, y:cluster.y};
  }
}

card.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === "break"){ addTimer(ch, cluster, {skewMs:0, conf:"sure", forceRollMin: activeProfile().settings.modeMin}); maybeAutoPos(cluster); }
    if (act === "broken"){ addTimer(ch, cluster, {skewMs: brokenSkew, conf:"unsure", forceRollMin: activeProfile().settings.modeMin}); maybeAutoPos(cluster); }
    if (act === "notfound"){
      const s = activeProfile().settings;
      const a = Math.max(0, Number(s.nonFoundMinSec ?? 60));
      const b = Math.max(a, Number(s.nonFoundMaxSec ?? 240));
      const skew = (a === b) ? a*1000 : (a + Math.random()*(b-a))*1000;
      addTimer(ch, cluster, {skewMs: skew, conf:"unsure", forceRollMin: activeProfile().settings.modeMin}); maybeAutoPos(cluster);
    }
    if (act === "exclude"){ toggleExcluded(ch, cluster.id); }
    if (act === "clear"){ clearTimers(ch, cluster.id); }
    if (act === "close"){ openCardFor=null; openCardIsPicker=false; }
    if (act === "clearSlot"){ /* handled below */ }
    saveState();
    renderAll();
    maybeRealtimeAfterChange();
  });

  // clear specific slot
  card.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-act='clearSlot']");
    if (!btn) return;
    e.stopPropagation();
    const idx = Number(btn.dataset.slot);
    const arr = timersArr(ch, cluster.id).slice().sort((a,b)=>a.nextSpawnMs-b.nextSpawnMs);
    if (idx>=0 && idx<arr.length){
      arr.splice(idx,1);
      setTimersArr(ch, cluster.id, arr);
      saveState();
      renderAll();
    }
  });

  return card;
}

function buildPickerCard(ch, clusters, basePos, offsets){
  const card=document.createElement("div");
  card.className="card";
  card.style.left = `${basePos.x}%`;
  card.style.top  = `${basePos.y}%`;
  card.innerHTML = `
    <div class="row">
      <div class="title">Scegli zona</div>
      <div class="badges"><span class="badge">CH ${ch}</span></div>
    </div>
    <div class="sub">Più puntini sovrapposti qui. Seleziona quale aprire.</div>
    <div class="slotList" style="margin-top:10px;">
      ${clusters.map(c=>`<div class="slotRow" data-id="${c.id}" style="cursor:pointer;">
          <div>${escapeHtml(c.name)}</div>
          <div>${computeNextSpawnMs(ch,c.id)==null ? "—" : fmtCountdown(computeNextSpawnMs(ch,c.id)-nowMs())}</div>
        </div>`).join("")}
    </div>
    <div class="btns">
      <button data-act="close">Chiudi</button>
    </div>
  `;
  card.addEventListener("click",(e)=>{
    const closeBtn=e.target.closest("button[data-act='close']");
    if (closeBtn){ openCardFor=null; openCardIsPicker=false; renderAll(); return; }
    const row=e.target.closest(".slotRow[data-id]");
    if (!row) return;
    openCardFor=row.dataset.id;
    openCardIsPicker=false;
    renderAll();
  });
  return card;
}

function addTimerLabel(ch, cluster, offset){
  const label=document.createElement('div');
  label.className='tlabel';
  label.dataset.id=cluster.id;
  label.style.left=`${cluster.x}%`;
  label.style.top =`${cluster.y}%`;
  label.style.setProperty('--ox', `${offset.ox||0}px`);
  label.style.setProperty('--oy', `${offset.oy||0}px`);
  mapWrap.appendChild(label);
  return label;
}

function renderAll(){
  // clear
  mapWrap.querySelectorAll(".marker, .card").forEach(n=>n.remove());

  const ch = Number(chSelect.value);
  const clusters = visibleClusters();
  const offsets = computeOffsetsPx(clusters);

  // timer labels (always)
  for (const c of clusters){
    const off = offsets.get(c.id) || {ox:0,oy:0};
    addTimerLabel(ch, c, off);
  }

  // zones
  renderZones(clusters);

  // recommendation on CH (if different)
  const bestCh = recommendedCh();
  const currentBest = bestEtaOnCh(ch);
  const thresholdS = Number(activeProfile().settings.chSuggestThreshold ?? 30) || 0;

  // player position marker (hidden in 'Zone' view)
  const pos = activeProfile().data.playerPos;
  const styleNow = activeProfile().settings.mapStyle ?? "markers";
  if (styleNow !== "zones"){
    const posEl=document.createElement("div");
    posEl.className="marker pos";
    posEl.style.left=`${pos.x}%`;
    posEl.style.top =`${pos.y}%`;
    posEl.title="Posizione (tap mappa vuota per impostare)";
    mapWrap.appendChild(posEl);
  }

  const recommendId = recommendedClusterId(ch);
  const route = routeOrder(ch);

  // markers style
  const style = activeProfile().settings.mapStyle ?? "markers";
  const drawMarkers = (style === "markers" || style === "both");

  // build overlap groups to optionally show count badge
  const keyOf=(c)=> `${Math.round(c.x*2)/2}_${Math.round(c.y*2)/2}`;
  const groups=new Map();
  for (const c of clusters){
    const k=keyOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }


  // ZONE_ONLY_CARD_RENDER: if markers are hidden, still show the selected cluster card
  if (!drawMarkers && openCardFor && !openCardIsPicker){
    const c = clusters.find(x=>x.id===openCardFor);
    if (c){
      const off = offsets.get(c.id) || {ox:0,oy:0};
      const cardEl = buildClusterCard(ch, c, off);
      mapWrap.appendChild(cardEl);
      requestAnimationFrame(()=> clampCardIntoMap(cardEl));
    }
  }

  if (drawMarkers){
    for (const c of clusters){
      const mk=document.createElement("div");
      mk.className="marker " + (c.level===25 ? "m25" : c.level===30 ? "m30" : "m35");
      mk.style.left=`${c.x}%`;
      mk.style.top =`${c.y}%`;

      const off = offsets.get(c.id) || {ox:0,oy:0};
      mk.style.setProperty("--ox", `${off.ox}px`);
      mk.style.setProperty("--oy", `${off.oy}px`);

      const next=computeNextSpawnMs(ch, c.id);
      const rem=next==null?null:(next-nowMs());

      if (activeProfile().settings.spawnGlow && next!=null && rem<=0) mk.classList.add("spawnGlow");
      if (recommendId && c.id===recommendId) mk.classList.add("recommended");
      if (isExcluded(ch, c.id)) mk.style.opacity = "0.35";

      const num=route[c.id];
      if (num){
        const n=document.createElement("div");
        n.className="routeNum";
        n.textContent=String(num);
        mk.appendChild(n);
      }

      // group count badge on first item only (to reduce clutter)
      const grp = groups.get(keyOf(c));
      if (grp && grp.length>1 && grp[0].id===c.id){
        const b=document.createElement("div");
        b.className="badgeCount";
        b.textContent=String(grp.length);
        mk.appendChild(b);
      }

      mk.addEventListener("click",(e)=>{
        e.stopPropagation();
        const grp = groups.get(keyOf(c));
        if (grp && grp.length>1){
          // open picker card at base pos
          openCardFor = keyOf(c); // pseudo id
          openCardIsPicker = true;
        } else {
          openCardFor = (openCardFor === c.id && !openCardIsPicker) ? null : c.id;
          openCardIsPicker = false;
        }
        renderAll();
      });

      mapWrap.appendChild(mk);

      // card
      if (!openCardIsPicker && openCardFor === c.id){
        const cardEl=buildClusterCard(ch, c, off);
        mapWrap.appendChild(cardEl);
        requestAnimationFrame(()=> clampCardIntoMap(cardEl));
      }
    }
  }

  // picker card
  if (openCardIsPicker && openCardFor){
    // openCardFor contains key
    const key=openCardFor;
    const grp = groups.get(key);
    if (grp && grp.length){
      const basePos={x: grp[0].x, y: grp[0].y};
      const picker=buildPickerCard(ch, grp, basePos, offsets);
      mapWrap.appendChild(picker);
      requestAnimationFrame(()=> clampCardIntoMap(picker));
    }
  }

  // CH suggestion toast (simple)
  const oldToast=document.getElementById("chToast");
  if (oldToast) oldToast.remove();
  if (bestCh && bestCh.ch !== ch && currentBest && (currentBest.eta - bestCh.eta) >= thresholdS*1000){
    const toast=document.createElement("div");
    toast.id="chToast";
    toast.style.position="fixed";
    toast.style.left="50%";
    toast.style.bottom="18px";
    toast.style.transform="translateX(-50%)";
    toast.style.background="rgba(0,0,0,.78)";
    toast.style.border="1px solid rgba(255,255,255,.14)";
    toast.style.borderRadius="14px";
    toast.style.padding="10px 10px";
    toast.style.zIndex="60";
    toast.style.boxShadow="0 10px 28px rgba(0,0,0,.35)";
    toast.style.backdropFilter="blur(6px)";
    toast.innerHTML = `
      <div style="font-size:12px; opacity:.9;">
        Suggerimento: CH <b>${bestCh.ch}</b> (ETA ~ <b>${fmtCountdown(bestCh.eta)}</b>)
      </div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button id="goChBtn" style="font-size:12px; padding:6px 9px; border-radius:12px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); color:var(--text);">Vai</button>
        <button id="hideToastBtn" style="font-size:12px; padding:6px 9px; border-radius:12px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.03); color:var(--text); opacity:.85;">Chiudi</button>
      </div>
    `;
    document.body.appendChild(toast);
    document.getElementById("goChBtn").onclick=()=>{ chSelect.value=String(bestCh.ch); toast.remove(); openCardFor=null; openCardIsPicker=false; renderAll(); };
    document.getElementById("hideToastBtn").onclick=()=> toast.remove();
  }
}

// tick updates (cards + slots)
function updateAllLabels(){
  const ch = Number(chSelect.value);
  const clusters = visibleClusters();
  const byId = new Map(clusters.map(c=>[c.id,c]));
  const styleNow = activeProfile().settings.mapStyle ?? "markers";

  document.querySelectorAll('.tlabel').forEach(lab=>{
    const id = lab.dataset.id;
    const c = byId.get(id);

    // In "zones" view show labels only for the selected zone
    if (styleNow === "zones"){
      const show = (!openCardIsPicker && openCardFor === id);
      if (!show){
        lab.textContent='';
        lab.classList.remove('sure','unsure','up','window','late');
        return;
      }
    }

    lab.classList.remove('sure','unsure','up','window','late');
    if (!c){ lab.textContent=''; return; }
    const info = clusterReadiness(ch, c);
    if (!info.any){ lab.textContent=''; return; }
    if (info.conf === 'unsure') lab.classList.add('unsure'); else lab.classList.add('sure');

    if (info.ready > 0){
      lab.textContent = `UP x${info.ready}`;
      lab.classList.add('up');
      return;
    }

    if (info.nextLikelyMs != null){
      lab.textContent = `~${fmtCountdown(info.nextLikelyMs - nowMs())}`;
      return;
    }

    const arr = timersArr(ch, c.id).slice().sort((a,b)=>a.nextSpawnMs-b.nextSpawnMs);
    const first = arr[0] || null;
    if (!first){ lab.textContent=''; return; }
    const st = slotStatusText(first);
    lab.textContent = st.text;
    if (st.cls) lab.classList.add(st.cls);
  });
}


function hasAnyTimersForCh(ch){
  const t = activeProfile().data.timersByCh?.[ch];
  if (!t) return false;
  return Object.keys(t).length > 0;
}
let tickerId = null;
function startTicker(){
  if (tickerId) clearInterval(tickerId);
  tickerId = setInterval(()=>{
    if (document.visibilityState === "hidden") return;
    const ch = Number(chSelect.value);
    const anyTimers = hasAnyTimersForCh(ch);
    const needs = anyTimers || (!!openCardFor);
    if (!needs) return;
    tick();
  }, 1000);
}

function tick(){
  const ch = Number(chSelect.value);
  if (!hasAnyTimersForCh(ch) && !openCardFor) return;
  updateAllLabels();
  // update main card countdowns
  mapWrap.querySelectorAll(".card").forEach(card=>{
    // for simplicity, rerender via animation frame is heavy; instead just update slot rows and main time if possible
    // If open card is picker, skip
    if (openCardIsPicker) return;
    const cluster = CLUSTERS.find(c=>c.id===openCardFor);
    if (!cluster) return;
    const next=computeNextSpawnMs(ch, cluster.id);
    const timeEl=card.querySelector(".time");
    const subEl=card.querySelector(".sub");
    if (!timeEl || !subEl) return;

    if (next==null){
      timeEl.innerHTML = `<span class="muted">—</span>`;
    } else {
      const firstSlot = (timersArr(ch, cluster.id).slice().sort((a,b)=>a.nextSpawnMs-b.nextSpawnMs)[0]) || null;
      timeEl.textContent = firstSlot ? slotStatusText(firstSlot).text : fmtCountdown(next - nowMs());
      const arr=timersArr(ch, cluster.id);
      const slotsInfo = activeProfile().settings.detailed
        ? `slot ${arr.length}/${cluster.slots}`
        : (arr.length ? "timer attivo" : "nessun timer");
      const eta=etaMsEffective(ch, cluster, activeProfile().data.playerPos);
      subEl.innerHTML = `prox ~ ${fmtTime(next)} • ${slotsInfo}` +
        `<br>ETA (viaggio+attesa+rottura): <b>${fmtCountdown(eta)}</b>`;
      // update slot rows
      card.querySelectorAll(".slotRow[data-slot]").forEach((row, idx)=>{
        const arrSorted=timersArr(ch, cluster.id).slice().sort((a,b)=>a.nextSpawnMs-b.nextSpawnMs);
        const t=arrSorted[idx];
        const countdownEl=row.children[1];
        if (t && countdownEl) countdownEl.textContent = fmtCountdown(t.nextSpawnMs - nowMs());
      });
    }
  });
  requestAnimationFrame(tick);
}

// === export/import ===
function doExport(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="metin-timer-villo2.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function doImport(){
  const file=importFile.files && importFile.files[0];
  if (!file) return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const s=JSON.parse(r.result);
      if (!s.profiles || !s.activeProfileId) throw new Error("Formato non valido");
      state=s;
      saveState();
      refreshProfileSelect();
      syncUIFromProfile();
      openCardFor=null; openCardIsPicker=false;
      renderAll();
      alert("Import completato.");
    } catch(e) {
      alert("Import fallito: " + e.message);
    } finally {
      importFile.value="";
    }
  };
  r.readAsText(file);
}

// === install hint ===
function showInstallHint(){
  alert(
`Installazione

PC:
1) Estrai lo zip
2) Apri index.html con doppio click

iPhone (PWA consigliata):
1) Metti i file su GitHub Pages
2) Apri l'URL in Safari
3) Condividi → Aggiungi alla schermata Home

Sync:
Impostazioni → Esporta / Importa

Versione: ${VERSION}`
  );
}

// === reset ===
function resetSettingsOnly(){
  if (!confirm("Reset impostazioni del profilo attuale?")) return;
  const p=activeProfile();
  const keepData=p.data;
  const fresh=defaultProfile();
  p.settings = fresh.settings;
  p.settings.filter = filterSelect.value; // keep current view if desired
  p.data = keepData;
  saveState();
  syncUIFromProfile();
  renderAll();
}
function resetProfileAll(){
  if (!confirm("Reset COMPLETO del profilo attuale? (timer + impostazioni)")) return;
  const name=activeProfile().name;
  const fresh=defaultProfile();
  fresh.name=name;
  state.profiles[state.activeProfileId]=fresh;
  saveState();
  syncUIFromProfile();
  renderAll();
}

// === measure ===
let measureRunning=false;
function currentMeasure(){
  const lvl=String(measureLevelEl.value);
  return activeProfile().data.measure[lvl];
}
function updateMeasureInfo(){
  const lvl=String(measureLevelEl.value);
  const m=activeProfile().data.measure[lvl];
  const text = (m.count===0) ? `Nessuna misura per Lv ${lvl}.` : `Lv ${lvl}: media ${Math.round(m.avg)}s su ${m.count} misure.`;
  measureInfo.textContent = measureRunning ? "Misurazione in corso…" : text;
}
function startMeasure(){
  if (measureRunning) return;
  measureRunning=true;
  const m=currentMeasure();
  m.running=true; m.startedMs=nowMs();
  measureStartBtn.disabled=true; measureStopBtn.disabled=false;
  updateMeasureInfo(); saveState();
}
function stopMeasure(){
  if (!measureRunning) return;
  measureRunning=false;
  const m=currentMeasure();
  if (!m.running || !m.startedMs){ measureStartBtn.disabled=false; measureStopBtn.disabled=true; updateMeasureInfo(); return; }
  const seconds=Math.max(0, Math.round((nowMs()-m.startedMs)/1000));
  const newCount=m.count+1;
  m.avg=(m.avg*m.count + seconds)/newCount;
  m.count=newCount;
  m.running=false; m.startedMs=null;

  const lvl=Number(measureLevelEl.value);
  const avg=Math.round(m.avg);
  if (lvl===25) break25El.value=String(avg);
  if (lvl===30) break30El.value=String(avg);
  if (lvl===35) break35El.value=String(avg);

  activeProfile().settings.break25=Number(break25El.value);
  activeProfile().settings.break30=Number(break30El.value);
  activeProfile().settings.break35=Number(break35El.value);

  measureStartBtn.disabled=false; measureStopBtn.disabled=true;
  updateMeasureInfo(); saveState(); renderAll();
}
function clearMeasure(){
  const lvl=String(measureLevelEl.value);
  activeProfile().data.measure[lvl]={count:0,avg:0,running:false,startedMs:null};
  saveState(); updateMeasureInfo();
}

// === init ===
(function init(){
  // CH dropdown
  for(let i=1;i<=CHANNELS;i++){ const opt=document.createElement("option"); opt.value=String(i); opt.textContent=`CH ${i}`; chSelect.appendChild(opt); }
  chSelect.value="1";

  refreshProfileSelect();
  syncUIFromProfile();

  // header controls
  profileSelect.addEventListener("change", ()=> setActiveProfile(profileSelect.value));
  profileManageBtn.addEventListener("click", manageProfiles);

  filterSelect.addEventListener("change", ()=>{ activeProfile().settings.filter=filterSelect.value; saveState(); renderAll(); });
  chSelect.addEventListener("change", ()=>{ openCardFor=null; openCardIsPicker=false; renderAll(); });

  settingsBtn.addEventListener("click", ()=> openSheet(true));
  closeSheetBtn.addEventListener("click", ()=> openSheet(false));
  sheetBackdrop.addEventListener("click",(e)=>{ if (e.target===sheetBackdrop) openSheet(false); });

  resetChBtn.addEventListener("click", ()=>{
    const ch=Number(chSelect.value);
    activeProfile().data.timersByCh[ch]={};
    saveState();
    renderAll();
    maybeRealtimeAfterChange();
  });

  resetAllChBtn.addEventListener("click", ()=>{
    if (!confirm("Reset timer su TUTTI i CH del profilo attuale?")) return;
    for (let c=1; c<=CHANNELS; c++) activeProfile().data.timersByCh[c] = {};
    saveState();
    renderAll();
  });

  // Realtime toggle
  if (rtEnableEl){
    rtEnableEl.checked = (localStorage.getItem(RT_KEY) === "1");
    rtEnableEl.addEventListener("change", ()=>{
      if (rtEnableEl.checked) connectRealtime(); else disconnectRealtime();
    });
    if (rtEnableEl.checked) connectRealtime();
  }

  // Map click: (1) close popup, (2) set position
  mapWrap.addEventListener("click",(e)=>{
    if (e.target.closest(".marker") || e.target.closest(".card") || e.target.closest("button")) return;
    if (openCardFor){
      openCardFor=null; openCardIsPicker=false;
      renderAll();
      return;
    }
    const rect=mapWrap.getBoundingClientRect();
    const x=((e.clientX-rect.left)/rect.width)*100;
    const y=((e.clientY-rect.top)/rect.height)*100;
    activeProfile().data.playerPos={x:clamp(x,0,100), y:clamp(y,0,100)};
    saveState();
    renderAll();
  });

  // Settings inputs
  [
    minMinEl, modeMinEl, maxMinEl, alreadyBrokenSecEl, nonFoundMinSecEl, nonFoundMaxSecEl,
    mapStyleEl, togSuggest, togRoute, togSpawnGlow, autoPosLastEl, chSuggestThresholdEl, togDetailed,
    break25El, break30El, break35El, togBreakTime,
    secPerPctEl
  ].forEach(el=> el.addEventListener("change", syncSettingsFromUI));

  exportBtn.addEventListener("click", doExport);
  importBtn.addEventListener("click", ()=> importFile.click());
  importFile.addEventListener("change", doImport);
  installHintBtn.addEventListener("click", showInstallHint);

  resetSettingsBtn.addEventListener("click", resetSettingsOnly);
  resetProfileBtn.addEventListener("click", resetProfileAll);

  // Measure
  measureLevelEl.addEventListener("change", updateMeasureInfo);
  measureStartBtn.addEventListener("click", startMeasure);
  measureStopBtn.addEventListener("click", stopMeasure);
  measureClearBtn.addEventListener("click", clearMeasure);

  // PWA
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});

  renderAll();
  requestAnimationFrame(tick);
})();
