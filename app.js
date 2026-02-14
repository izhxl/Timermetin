
const STORAGE_KEY = "metin_villo2_pwa_v1";
const CHANNELS = 6;

const CLUSTERS = [
  { id:"35_west",  level:35, name:"35 • Ovest (fascia)", x:17.5, y:46.0, slots:5 },
  { id:"35_nw",    level:35, name:"35 • Nord-Ovest",     x:13.0, y:12.0, slots:2 },

  { id:"30_se_big", level:30, name:"30 • Sud-Est (grande)", x:75.0, y:80.0, slots:3 },
  { id:"30_e_mid",  level:30, name:"30 • Est (medio)",      x:85.0, y:33.0, slots:2 },
  { id:"30_c_isle", level:30, name:"30 • Centro isola",     x:43.0, y:41.0, slots:2 },
  { id:"30_ne",     level:30, name:"30 • Nord-Est",         x:70.0, y:18.0, slots:2 },
  { id:"30_sw",     level:30, name:"30 • Sud-Ovest",        x:28.0, y:83.0, slots:2 },
  { id:"30_s_mid",  level:30, name:"30 • Sud-Centro",       x:63.0, y:65.0, slots:2 },
  { id:"30_w_mid",  level:30, name:"30 • Ovest (medio)",    x:18.0, y:46.0, slots:2 },
  { id:"30_w_n",    level:30, name:"30 • Ovest (nord)",     x:29.0, y:31.0, slots:1 },

  { id:"25_se_big", level:25, name:"25 • Sud-Est (grande)", x:75.0, y:80.0, slots:3 },
  { id:"25_ne_big", level:25, name:"25 • Nord-Est (grande)",x:66.0, y:13.5, slots:3 },
  { id:"25_e_mid",  level:25, name:"25 • Est (medio)",      x:85.0, y:33.0, slots:2 },
  { id:"25_sw",     level:25, name:"25 • Sud-Ovest",        x:28.0, y:83.0, slots:2 },
  { id:"25_c_band", level:25, name:"25 • Centro (fascia)",  x:56.0, y:43.0, slots:2 },
];

const mapWrap = document.getElementById("mapWrap");
const chSelect = document.getElementById("chSelect");
const filterSelect = document.getElementById("filterSelect");

const profileSelect = document.getElementById("profileSelect");
const profileManageBtn = document.getElementById("profileManageBtn");

const settingsBtn = document.getElementById("settingsBtn");
const resetChBtn = document.getElementById("resetChBtn");

const sheetBackdrop = document.getElementById("sheetBackdrop");
const closeSheetBtn = document.getElementById("closeSheetBtn");

const minMinEl = document.getElementById("minMin");
const modeMinEl = document.getElementById("modeMin");
const maxMinEl = document.getElementById("maxMin");

const togSuggest = document.getElementById("togSuggest");
const togRoute = document.getElementById("togRoute");
const togSpawnGlow = document.getElementById("togSpawnGlow");
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

const measureLevelEl = document.getElementById("measureLevel");
const measureStartBtn = document.getElementById("measureStart");
const measureStopBtn = document.getElementById("measureStop");
const measureClearBtn = document.getElementById("measureClear");
const measureInfo = document.getElementById("measureInfo");

function nowMs(){ return Date.now(); }
function pad2(n){ return String(n).padStart(2,"0"); }
function fmtTime(ts){
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function fmtCountdown(ms){
  if (ms <= 0) return "SPAWN?";
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const rs = s % 60;
  const h = Math.floor(m/60);
  const rm = m % 60;
  return h > 0 ? `${h}:${pad2(rm)}:${pad2(rs)}` : `${rm}:${pad2(rs)}`;
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function escapeHtml(s){
  return (s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function randTriangular(min, mode, max){
  const u = Math.random();
  const c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function defaultProfile(){
  const timersByCh = {};
  for (let ch=1; ch<=CHANNELS; ch++) timersByCh[ch] = {};
  return {
    name: "Default",
    settings: {
      filter: "all",
      minMin: 10,
      modeMin: 12.5,
      maxMin: 15,
      suggest: true,
      route: false,
      spawnGlow: true,
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
      measure: {
        "25": { count: 0, avg: 0, running: false, startedMs: null },
        "30": { count: 0, avg: 0, running: false, startedMs: null },
        "35": { count: 0, avg: 0, running: false, startedMs: null },
      }
    }
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no state");
    const s = JSON.parse(raw);
    if (!s.profiles || !s.activeProfileId) throw new Error("bad state");
    return s;
  }catch{
    const id = "p_" + Math.random().toString(16).slice(2,8);
    return { profiles: { [id]: defaultProfile() }, activeProfileId: id };
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let state = loadState();

function activeProfile(){ return state.profiles[state.activeProfileId]; }
function setActiveProfile(id){
  if (!state.profiles[id]) return;
  state.activeProfileId = id;
  saveState();
  syncUIFromProfile();
  renderAll();
}

function refreshProfileSelect(){
  profileSelect.innerHTML = "";
  for (const [id, prof] of Object.entries(state.profiles)){
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = prof.name;
    profileSelect.appendChild(opt);
  }
  profileSelect.value = state.activeProfileId;
}

function manageProfiles(){
  const p = activeProfile();
  const choice = prompt(
`Gestione profili:
1) Rinominare profilo attuale
2) Nuovo profilo (copia dall'attuale)
3) Elimina profilo (se ne hai più di uno)

Scrivi 1, 2 o 3:`
  );
  if (!choice) return;

  if (choice.trim() === "1"){
    const name = prompt("Nuovo nome profilo:", p.name);
    if (name && name.trim()){
      p.name = name.trim();
      saveState();
      refreshProfileSelect();
    }
    return;
  }
  if (choice.trim() === "2"){
    const name = prompt("Nome nuovo profilo:", "Nuovo profilo");
    const id = "p_" + Math.random().toString(16).slice(2,8);
    state.profiles[id] = JSON.parse(JSON.stringify(p));
    state.profiles[id].name = (name && name.trim()) ? name.trim() : "Nuovo profilo";
    state.activeProfileId = id;
    saveState();
    refreshProfileSelect();
    syncUIFromProfile();
    renderAll();
    return;
  }
  if (choice.trim() === "3"){
    const keys = Object.keys(state.profiles);
    if (keys.length <= 1){
      alert("Non puoi eliminare l'unico profilo.");
      return;
    }
    if (!confirm(`Eliminare il profilo "${p.name}"?`)) return;
    delete state.profiles[state.activeProfileId];
    state.activeProfileId = Object.keys(state.profiles)[0];
    saveState();
    refreshProfileSelect();
    syncUIFromProfile();
    renderAll();
    return;
  }
  alert("Scelta non valida.");
}

function openSheet(show){
  sheetBackdrop.style.display = show ? "flex" : "none";
  if (show) updateMeasureInfo();
}

function syncUIFromProfile(){
  const p = activeProfile();
  filterSelect.value = p.settings.filter;
  minMinEl.value = String(p.settings.minMin);
  modeMinEl.value = String(p.settings.modeMin);
  maxMinEl.value = String(p.settings.maxMin);

  togSuggest.checked = !!p.settings.suggest;
  togRoute.checked = !!p.settings.route;
  togSpawnGlow.checked = !!p.settings.spawnGlow;
  togDetailed.checked = !!p.settings.detailed;

  break25El.value = String(p.settings.break25);
  break30El.value = String(p.settings.break30);
  break35El.value = String(p.settings.break35);
  togBreakTime.checked = !!p.settings.useBreakTime;

  secPerPctEl.value = String(p.settings.secPerPct);
  updateMeasureInfo();
}

function visibleClusters(){
  const f = activeProfile().settings.filter;
  if (f === "all") return CLUSTERS;
  const lvl = Number(f);
  return CLUSTERS.filter(c=>c.level === lvl);
}

function timersArr(ch, clusterId){
  const p = activeProfile();
  const t = p.data.timersByCh[ch][clusterId];
  return Array.isArray(t) ? t : [];
}
function setTimersArr(ch, clusterId, arr){
  activeProfile().data.timersByCh[ch][clusterId] = arr;
}

function breakTimeForLevel(level){
  const s = activeProfile().settings;
  if (level === 25) return Number(s.break25) || 0;
  if (level === 30) return Number(s.break30) || 0;
  return Number(s.break35) || 0;
}

function addTimer(ch, cluster){
  const s = activeProfile().settings;
  const rollMin = randTriangular(Number(s.minMin), Number(s.modeMin), Number(s.maxMin));
  const startedMs = nowMs();
  const nextSpawnMs = startedMs + rollMin * 60_000;

  let arr = timersArr(ch, cluster.id).slice();

  if (!s.detailed){
    arr = [{ nextSpawnMs, rollMin: Math.round(rollMin*10)/10, startedMs }];
  }else{
    if (arr.length >= cluster.slots){
      arr.sort((a,b)=>a.startedMs-b.startedMs);
      arr.shift();
    }
    arr.push({ nextSpawnMs, rollMin: Math.round(rollMin*10)/10, startedMs });
  }

  setTimersArr(ch, cluster.id, arr);
  saveState();
}

function clearTimers(ch, clusterId){
  delete activeProfile().data.timersByCh[ch][clusterId];
  saveState();
}

function computeNextSpawnMs(ch, clusterId){
  const arr = timersArr(ch, clusterId);
  if (!arr.length) return null;
  return Math.min(...arr.map(t=>t.nextSpawnMs));
}

function distPct(a,b){
  const dx = (a.x - b.x);
  const dy = (a.y - b.y);
  return Math.sqrt(dx*dx + dy*dy);
}
function travelSeconds(fromPos, cluster){
  const secPerPct = Number(activeProfile().settings.secPerPct) || 0;
  return distPct(fromPos, cluster) * secPerPct;
}
function etaMsEffective(ch, cluster, fromPos){
  const next = computeNextSpawnMs(ch, cluster.id);
  if (next == null) return Infinity;

  const remMs = next - nowMs();
  const travelMs = travelSeconds(fromPos, cluster) * 1000;
  const breakMs = (activeProfile().settings.useBreakTime ? breakTimeForLevel(cluster.level) * 1000 : 0);

  const waitMs = Math.max(remMs, travelMs);
  return waitMs + breakMs;
}
function recommendedClusterId(ch){
  const s = activeProfile().settings;
  if (!s.suggest) return null;

  const fromPos = activeProfile().data.playerPos;
  let best = null;
  for (const c of visibleClusters()){
    if (computeNextSpawnMs(ch, c.id) == null) continue;
    const eta = etaMsEffective(ch, c, fromPos);
    if (!best || eta < best.eta) best = { id: c.id, eta };
  }
  return best ? best.id : null;
}
function routeOrder(ch){
  const s = activeProfile().settings;
  if (!s.route) return {};

  let currentPos = { ...activeProfile().data.playerPos };
  let virtualNow = nowMs();

  const candidates = visibleClusters().filter(c => computeNextSpawnMs(ch, c.id) != null);
  const order = {};
  let step = 1;

  while (candidates.length && step <= 20){
    let bestIdx = -1;
    let bestEta = Infinity;

    for (let i=0;i<candidates.length;i++){
      const c = candidates[i];
      const next = computeNextSpawnMs(ch, c.id);
      const remMs = next - virtualNow;
      const travelMs = travelSeconds(currentPos, c) * 1000;
      const breakMs = (s.useBreakTime ? breakTimeForLevel(c.level) * 1000 : 0);
      const eta = Math.max(remMs, travelMs) + breakMs;
      if (eta < bestEta){ bestEta = eta; bestIdx = i; }
    }
    if (bestIdx < 0) break;

    const chosen = candidates.splice(bestIdx, 1)[0];
    order[chosen.id] = step++;

    const travelMs = travelSeconds(currentPos, chosen) * 1000;
    const next = computeNextSpawnMs(ch, chosen.id);
    const remMs = next - virtualNow;
    const breakMs = (s.useBreakTime ? breakTimeForLevel(chosen.level) * 1000 : 0);
    virtualNow += Math.max(remMs, travelMs) + breakMs;

    currentPos = { x: chosen.x, y: chosen.y };
  }
  return order;
}

let openCardFor = null;

function buildCard(ch, cluster){
  const card = document.createElement("div");
  card.className = "card";
  card.style.left = `${cluster.x}%`;
  card.style.top  = `${cluster.y}%`;

  const arr = timersArr(ch, cluster.id);
  const next = computeNextSpawnMs(ch, cluster.id);
  const rem = next == null ? null : (next - nowMs());

  const slotsInfo = activeProfile().settings.detailed
    ? `slot ${arr.length}/${cluster.slots}`
    : (arr.length ? "timer attivo" : "nessun timer");

  const eta = (next == null) ? null : etaMsEffective(ch, cluster, activeProfile().data.playerPos);

  card.innerHTML = `
    <div class="row">
      <div class="title">${escapeHtml(cluster.name)}</div>
      <div class="badges">
        <span class="badge">Lv ${cluster.level}</span>
        <span class="badge">CH ${ch}</span>
      </div>
    </div>
    <div class="time">${next == null ? `<span class="muted">—</span>` : fmtCountdown(rem)}</div>
    <div class="sub">
      ${next == null ? `Nessun timer avviato • ${slotsInfo}` : `prox ~ ${fmtTime(next)} • ${slotsInfo}`}
      ${eta != null && isFinite(eta) ? `<br>ETA consigli (viaggio+attesa+rottura): <b>${fmtCountdown(eta)}</b>` : ``}
    </div>
    <div class="btns">
      <button data-act="break">Rotto</button>
      <button data-act="clear">Clear</button>
      <button data-act="close">Chiudi</button>
    </div>
  `;
  card.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === "break") addTimer(ch, cluster);
    if (act === "clear") clearTimers(ch, cluster.id);
    if (act === "close") openCardFor = null;
    renderAll();
  });
  return card;
}

function renderAll(){
  mapWrap.querySelectorAll(".marker, .card").forEach(n=>n.remove());
  const ch = Number(chSelect.value);
  const recommendId = recommendedClusterId(ch);
  const route = routeOrder(ch);

  const pos = activeProfile().data.playerPos;
  const posEl = document.createElement("div");
  posEl.className = "marker";
  posEl.style.left = `${pos.x}%`;
  posEl.style.top  = `${pos.y}%`;
  posEl.style.width = "12px";
  posEl.style.height = "12px";
  posEl.style.border = "2px solid rgba(255,255,255,.9)";
  posEl.style.background = "rgba(180,180,180,.9)";
  posEl.title = "Posizione (tap mappa per spostare)";
  mapWrap.appendChild(posEl);

  for (const c of visibleClusters()){
    const mk = document.createElement("div");
    mk.className = "marker " + (c.level===25 ? "m25" : c.level===30 ? "m30" : "m35");
    mk.style.left = `${c.x}%`;
    mk.style.top  = `${c.y}%`;
    mk.dataset.id = c.id;

    const next = computeNextSpawnMs(ch, c.id);
    const rem = next == null ? null : (next - nowMs());

    if (activeProfile().settings.spawnGlow && next != null && rem <= 0) mk.classList.add("spawnGlow");
    if (recommendId && c.id === recommendId) mk.classList.add("recommended");

    const num = route[c.id];
    if (num){
      const n = document.createElement("div");
      n.className = "routeNum";
      n.textContent = String(num);
      mk.appendChild(n);
    }

    mk.addEventListener("click", (e)=>{
      e.stopPropagation();
      openCardFor = (openCardFor === c.id) ? null : c.id;
      renderAll();
    });

    mapWrap.appendChild(mk);

    if (openCardFor === c.id){
      mapWrap.appendChild(buildCard(ch, c));
    }
  }
}

function tick(){
  const ch = Number(chSelect.value);
  mapWrap.querySelectorAll(".card").forEach(card=>{
    const cluster = CLUSTERS.find(c=>c.id === openCardFor);
    if (!cluster) return;
    const next = computeNextSpawnMs(ch, cluster.id);
    const timeEl = card.querySelector(".time");
    const subEl = card.querySelector(".sub");
    if (!timeEl || !subEl) return;
    if (next == null){
      timeEl.innerHTML = `<span class="muted">—</span>`;
    }else{
      const rem = next - nowMs();
      timeEl.textContent = fmtCountdown(rem);
      const arr = timersArr(ch, cluster.id);
      const slotsInfo = activeProfile().settings.detailed
        ? `slot ${arr.length}/${cluster.slots}`
        : (arr.length ? "timer attivo" : "nessun timer");
      const eta = etaMsEffective(ch, cluster, activeProfile().data.playerPos);
      subEl.innerHTML = `prox ~ ${fmtTime(next)} • ${slotsInfo}` +
        `<br>ETA consigli (viaggio+attesa+rottura): <b>${fmtCountdown(eta)}</b>`;
    }
  });
  requestAnimationFrame(tick);
}

// Export/Import
function doExport(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "metin-timer-villo2.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function doImport(){
  const file = importFile.files && importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const s = JSON.parse(reader.result);
      if (!s.profiles || !s.activeProfileId) throw new Error("Formato non valido");
      state = s;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      refreshProfileSelect();
      syncUIFromProfile();
      renderAll();
      alert("Import completato.");
    }catch(e){
      alert("Import fallito: " + e.message);
    }finally{
      importFile.value = "";
    }
  };
  reader.readAsText(file);
}

// Install hint
function showInstallHint(){
  alert(
`Installazione rapida

PC:
1) Estrai lo zip in una cartella
2) Apri index.html con doppio click (offline)

iPhone:
Metodo più semplice (con PC/Mac una volta):
- metti la cartella su un sito locale/hosting (anche GitHub Pages) e apri il link in Safari
- Condividi (⬆️) → “Aggiungi alla schermata Home”

Metodo offline (senza hosting):
- apri index.html da File/iCloud in Safari (non sempre perfetto per la PWA, ma funziona per usare lo strumento)

Sincronizzazione:
- Impostazioni → Esporta (su un dispositivo)
- poi Importa sull’altro.`
  );
}

// Measure
let measureRunning = false;
function currentMeasure(){
  const lvl = String(measureLevelEl.value);
  return activeProfile().data.measure[lvl];
}
function updateMeasureInfo(){
  const lvl = String(measureLevelEl.value);
  const m = activeProfile().data.measure[lvl];
  const text = (m.count === 0)
    ? `Nessuna misura per Lv ${lvl}.`
    : `Lv ${lvl}: media ${Math.round(m.avg)}s su ${m.count} misure.`;
  measureInfo.textContent = measureRunning ? "Misurazione in corso…" : text;
}
measureLevelEl.addEventListener("change", updateMeasureInfo);

function startMeasure(){
  if (measureRunning) return;
  measureRunning = true;
  const m = currentMeasure();
  m.running = true;
  m.startedMs = nowMs();
  measureStartBtn.disabled = true;
  measureStopBtn.disabled = false;
  updateMeasureInfo();
  saveState();
}
function stopMeasure(){
  if (!measureRunning) return;
  measureRunning = false;
  const m = currentMeasure();
  if (!m.running || !m.startedMs){
    measureStartBtn.disabled = false;
    measureStopBtn.disabled = true;
    updateMeasureInfo();
    return;
  }
  const seconds = Math.max(0, Math.round((nowMs() - m.startedMs)/1000));
  const newCount = m.count + 1;
  m.avg = (m.avg * m.count + seconds) / newCount;
  m.count = newCount;
  m.running = false;
  m.startedMs = null;

  const lvl = Number(measureLevelEl.value);
  if (lvl === 25) break25El.value = String(Math.round(m.avg));
  if (lvl === 30) break30El.value = String(Math.round(m.avg));
  if (lvl === 35) break35El.value = String(Math.round(m.avg));

  activeProfile().settings.break25 = Number(break25El.value);
  activeProfile().settings.break30 = Number(break30El.value);
  activeProfile().settings.break35 = Number(break35El.value);

  measureStartBtn.disabled = false;
  measureStopBtn.disabled = true;
  updateMeasureInfo();
  saveState();
  renderAll();
}
function clearMeasure(){
  const lvl = String(measureLevelEl.value);
  activeProfile().data.measure[lvl] = { count:0, avg:0, running:false, startedMs:null };
  saveState();
  updateMeasureInfo();
}

// Init
(function init(){
  for(let i=1;i<=CHANNELS;i++){
    const opt=document.createElement("option");
    opt.value=String(i);
    opt.textContent=`CH ${i}`;
    chSelect.appendChild(opt);
  }
  chSelect.value = "1";

  refreshProfileSelect();

  profileSelect.addEventListener("change", ()=> setActiveProfile(profileSelect.value));
  profileManageBtn.addEventListener("click", manageProfiles);

  filterSelect.addEventListener("change", ()=>{
    activeProfile().settings.filter = filterSelect.value;
    saveState();
    renderAll();
  });

  settingsBtn.addEventListener("click", ()=> openSheet(true));
  closeSheetBtn.addEventListener("click", ()=> openSheet(false));
  sheetBackdrop.addEventListener("click", (e)=>{ if (e.target === sheetBackdrop) openSheet(false); });

  resetChBtn.addEventListener("click", ()=>{
    const ch = Number(chSelect.value);
    activeProfile().data.timersByCh[ch] = {};
    saveState();
    renderAll();
  });

  mapWrap.addEventListener("click", (e)=>{
    if (e.target.closest(".marker") || e.target.closest(".card")) return;
    const rect = mapWrap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    activeProfile().data.playerPos = { x: clamp(x,0,100), y: clamp(y,0,100) };
    saveState();
    renderAll();
  });

  const syncSettings = ()=>{
    const p = activeProfile();
    const minV = clamp(Number(minMinEl.value), 1, 999);
    const maxV = Math.max(minV + 0.5, Number(maxMinEl.value));
    const modeV = clamp(Number(modeMinEl.value), minV, maxV);
    minMinEl.value = String(minV); maxMinEl.value = String(maxV); modeMinEl.value = String(modeV);
    p.settings.minMin = minV; p.settings.maxMin = maxV; p.settings.modeMin = modeV;

    p.settings.suggest = !!togSuggest.checked;
    p.settings.route = !!togRoute.checked;
    p.settings.spawnGlow = !!togSpawnGlow.checked;
    p.settings.detailed = !!togDetailed.checked;

    p.settings.break25 = Math.max(0, Number(break25El.value));
    p.settings.break30 = Math.max(0, Number(break30El.value));
    p.settings.break35 = Math.max(0, Number(break35El.value));
    p.settings.useBreakTime = !!togBreakTime.checked;

    p.settings.secPerPct = Math.max(0, Number(secPerPctEl.value));

    saveState();
    renderAll();
  };

  [minMinEl, modeMinEl, maxMinEl, togSuggest, togRoute, togSpawnGlow, togDetailed,
   break25El, break30El, break35El, togBreakTime, secPerPctEl].forEach(el=>{
    el.addEventListener("change", syncSettings);
  });

  exportBtn.addEventListener("click", doExport);
  importBtn.addEventListener("click", ()=> importFile.click());
  importFile.addEventListener("change", doImport);
  installHintBtn.addEventListener("click", showInstallHint);

  measureStartBtn.addEventListener("click", startMeasure);
  measureStopBtn.addEventListener("click", stopMeasure);
  measureClearBtn.addEventListener("click", clearMeasure);

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  syncUIFromProfile();
  renderAll();
  requestAnimationFrame(tick);
})();
