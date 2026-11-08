// ============================================================================
// CONFIGURAZIONE COMUNE DI SENIGALLIA (AN)
// ============================================================================
const SENIGALLIA_CENTER = [43.7131, 13.2183];
const SENIGALLIA_VIEWBOX = "13.1200,43.7700,13.3100,43.6500"; // Bounding Box per Nominatim
const OFFICE_PIN_DEFAULT = "1234";

// Colori e tipologie provvedimento
const TYPE_CONFIG = {
  transito: { label: "Divieto di Transito / Chiusura", color: "#ef4444" },
  sosta: { label: "Divieto di Sosta con Rimozione", color: "#f97316" },
  cantiere: { label: "Cantiere Stradale / OSP", color: "#eab308" },
  manifestazione: { label: "Manifestazione / Area Pedonale", color: "#3b82f6" }
};

// Configurazione PDF.js worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// ============================================================================
// GESTIONE DATA E ORA LOCALE REALE (CALENDARIO AUTOMATICO)
// ============================================================================
function getLocalDateTimeISO(dateObj) {
  const d = dateObj || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function setFilterToToday() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  document.getElementById("filterFrom").value = getLocalDateTimeISO(startOfDay);
  document.getElementById("filterTo").value = getLocalDateTimeISO(endOfDay);
}

function initDefaultFilters() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59);

  document.getElementById("filterFrom").value = getLocalDateTimeISO(startOfDay);
  document.getElementById("filterTo").value = getLocalDateTimeISO(nextWeek);
}

function getRelativeDate(offsetDays, hours, minutes) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, minutes, 0, 0);
  return getLocalDateTimeISO(d);
}

// ============================================================================
// ORDINANZE DIMOSTRATIVE DI PROVA (SENIGALLIA)
// ============================================================================
const INITIAL_ORDINANZE = [
  {
    id: "ord-sen-1",
    numero: "412/2026",
    tipo: "transito",
    via: "Corso 2 Giugno",
    tratto: "Da Piazza Garibaldi a Via Cavallotti",
    inizio: getRelativeDate(-1, 8, 0),
    fine: getRelativeDate(3, 20, 0),
    note: "Chiusura totale al transito per rifacimento pavimentazione. Transito consentito ai soli mezzi di soccorso.",
    geometryType: "line",
    coords: [
      [43.7145, 13.2159],
      [43.7155, 13.2173],
      [43.7164, 13.2185]
    ]
  },
  {
    id: "ord-sen-2",
    numero: "418/2026",
    tipo: "sosta",
    via: "Lungomare Goffredo Mameli",
    tratto: "Dal civico 44 al civico 78 (lato mare)",
    inizio: getRelativeDate(0, 7, 0),
    fine: getRelativeDate(1, 19, 0),
    note: "Divieto di sosta con rimozione coatta ambo i lati per lavori di potatura e manutenzione verde pubblico.",
    geometryType: "line",
    coords: [
      [43.7235, 13.2118],
      [43.7212, 13.2151]
    ]
  },
  {
    id: "ord-sen-3",
    numero: "425/2026",
    tipo: "manifestazione",
    via: "Piazza Garibaldi",
    tratto: "Intera area perimetrale della piazza",
    inizio: getRelativeDate(2, 6, 0),
    fine: getRelativeDate(2, 23, 0),
    note: "Occupazione suolo pubblico per manifestazione culturale cittadina. Divieto di sosta e transito.",
    geometryType: "polygon",
    coords: [
      [43.7144, 13.2149],
      [43.7149, 13.2157],
      [43.7142, 13.2163],
      [43.7137, 13.2155]
    ]
  },
  {
    id: "ord-sen-4",
    numero: "389/2026",
    tipo: "cantiere",
    via: "Via Giosuè Carducci",
    tratto: "Civici 14 - 22",
    inizio: getRelativeDate(-10, 7, 30),
    fine: getRelativeDate(-2, 18, 0),
    note: "Occupazione suolo pubblico con ponteggio edile (Atto scaduto per test verbali retroattivi).",
    geometryType: "line",
    coords: [
      [43.7172, 13.2194],
      [43.7161, 13.2206]
    ]
  }
];

// ============================================================================
// STATO GLOBALE
// ============================================================================
let ordinanze = [];
let map, streetLayer, satLayer, featuresGroup, tempDrawGroup;
let drawingMode = null; // 'line' | 'polygon' | null
let drawnPoints = [];
let pendingGeometry = null;
let supabaseClient = null;

// ============================================================================
// AVVIO
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initDefaultFilters();
  initCloudConnection();
  loadOrdinanze();
  bindEvents();
});

function initMap() {
  map = L.map("map", {
    center: SENIGALLIA_CENTER,
    zoom: 15,
    zoomControl: true
  });

  streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors • Senigallia"
  }).addTo(map);

  satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "© Esri World Imagery"
  });

  featuresGroup = L.featureGroup().addTo(map);
  tempDrawGroup = L.featureGroup().addTo(map);

  map.on("click", onMapClickForDrawing);
}

// ============================================================================
// CARICAMENTO E SINCRONIZZAZIONE DATI
// ============================================================================
function initCloudConnection() {
  const savedUrl = localStorage.getItem("pl_supa_url");
  const savedKey = localStorage.getItem("pl_supa_key");
  if (savedUrl && savedKey && window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(savedUrl, savedKey);
      document.getElementById("supaUrl").value = savedUrl;
      document.getElementById("supaKey").value = savedKey;

      supabaseClient
        .channel("public:ordinanze")
        .on("postgres_changes", { event: "*", schema: "public", table: "ordinanze" }, () => {
          loadOrdinanze();
        })
        .subscribe();
    } catch (e) {
      console.warn("Supabase connection error:", e);
    }
  }
}

async function loadOrdinanze() {
  updateSyncBadge("Sincronizzazione...");

  if (supabaseClient) {
    const { data, error } = await supabaseClient.from("ordinanze").select("*").order("inizio", { ascending: false });
    if (!error && data && data.length > 0) {
      ordinanze = data;
      localStorage.setItem("pl_senigallia_ordinanze", JSON.stringify(ordinanze));
      renderAll();
      updateSyncBadge("Live Cloud Attivo");
      return;
    }
  }

  const stored = localStorage.getItem("pl_senigallia_ordinanze");
  if (stored) {
    ordinanze = JSON.parse(stored);
  } else {
    ordinanze = INITIAL_ORDINANZE;
    localStorage.setItem("pl_senigallia_ordinanze", JSON.stringify(ordinanze));
  }

  renderAll();
  const nowStr = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  updateSyncBadge(`Aggiornato ${nowStr}`);
}

function updateSyncBadge(text) {
  document.getElementById("syncStatus").textContent = text;
}

// ============================================================================
// CALCOLO STATO E RENDERING
// ============================================================================
function computeOrdinanzaStatus(ord, filterFromDate, filterToDate) {
  const now = new Date();
  const start = new Date(ord.inizio);
  const end = new Date(ord.fine);
  const refEnd = filterToDate || now;

  if (end < now && end <= refEnd) {
    return "scaduta";
  }
  if (start > now) {
    return "futura";
  }
  return "vigente";
}

function renderAll() {
  featuresGroup.clearLayers();
  const listEl = document.getElementById("ordinanzeList");
  listEl.innerHTML = "";

  const fromVal = document.getElementById("filterFrom").value;
  const toVal = document.getElementById("filterTo").value;
  const showExpired = document.getElementById("showExpired").checked;
  const searchQuery = document.getElementById("streetSearch").value.trim().toLowerCase();

  const fromDate = fromVal ? new Date(fromVal) : new Date("2000-01-01");
  const toDate = toVal ? new Date(toVal) : new Date("2099-12-31");

  let countVigenti = 0, countFuture = 0, countScadute = 0, totalShown = 0;

  ordinanze.forEach((ord) => {
    const start = new Date(ord.inizio);
    const end = new Date(ord.fine);

    const intersectsRange = start <= toDate && end >= fromDate;
    if (!intersectsRange) return;

    if (searchQuery && !ord.via.toLowerCase().includes(searchQuery) && !(ord.tratto || "").toLowerCase().includes(searchQuery)) {
      return;
    }

    const status = computeOrdinanzaStatus(ord, fromDate, toDate);
    if (status === "scaduta" && !showExpired) return;

    if (status === "vigente") countVigenti++;
    if (status === "futura") countFuture++;
    if (status === "scaduta") countScadute++;
    totalShown++;

    const cfg = TYPE_CONFIG[ord.tipo] || TYPE_CONFIG.sosta;
    const drawColor = status === "scaduta" ? "#64748b" : cfg.color;

    let layer;
    if (ord.geometryType === "polygon" && ord.coords.length >= 3) {
      layer = L.polygon(ord.coords, {
        color: drawColor,
        fillColor: drawColor,
        fillOpacity: status === "scaduta" ? 0.15 : 0.35,
        weight: 4,
        dashArray: status === "scaduta" ? "6, 6" : null
      });
    } else {
      layer = L.polyline(ord.coords, {
        color: drawColor,
        weight: 7,
        opacity: status === "scaduta" ? 0.65 : 0.92,
        dashArray: status === "scaduta" ? "8, 8" : null
      });
    }

    const popupHtml = `
      <div style="min-width:230px;font-family:'Inter',sans-serif;">
        <div style="font-size:11px;font-weight:700;color:${drawColor};text-transform:uppercase;margin-bottom:3px;">
          ${cfg.label} • ${status.toUpperCase()}
        </div>
        <div style="font-size:14px;font-weight:700;margin-bottom:2px;">Ord. N° ${ord.numero} - ${ord.via}</div>
        <div style="font-size:12px;color:#475569;margin-bottom:6px;">${ord.tratto || "Intero tratto"}</div>
        <div style="font-size:11.5px;background:#f1f5f9;padding:6px;border-radius:5px;margin-bottom:6px;">
          <b>Dal:</b> ${formatDateTimeIT(ord.inizio)}<br/>
          <b>Al:</b> ${formatDateTimeIT(ord.fine)}
        </div>
        <div style="font-size:12px;color:#1e293b;"><b>Note Pattuglia:</b> ${ord.note || "Nessuna deroga specifica"}</div>
      </div>
    `;

    layer.bindPopup(popupHtml);
    featuresGroup.addLayer(layer);

    const card = document.createElement("div");
    card.className = `ord-card type-${ord.tipo} status-${status}`;
    card.innerHTML = `
      <div class="ord-card-top">
        <span class="ord-number">Ord. N° ${ord.numero} • ${cfg.label.split("/")[0]}</span>
        <span class="status-badge badge-${status}">${status}</span>
      </div>
      <div class="ord-street">${ord.via}</div>
      <div class="ord-tratto">${ord.tratto || "Tratto stradale evidenziato"}</div>
      <div class="ord-dates">
        <i class="fa-regular fa-clock"></i> ${formatDateTimeIT(ord.inizio)} → ${formatDateTimeIT(ord.fine)}
      </div>
      <div class="ord-notes">${ord.note || ""}</div>
      <div class="ord-card-actions">
        <span style="font-size:11px;color:#2563eb;font-weight:600;"><i class="fa-solid fa-location-crosshairs"></i> Centra sulla via</span>
        <button class="btn-delete-ord" data-id="${ord.id}" title="Elimina ordinanza"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".btn-delete-ord")) return;
      map.fitBounds(layer.getBounds(), { maxZoom: 17, padding: [40, 40] });
      layer.openPopup();
    });

    card.querySelector(".btn-delete-ord").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteOrdinanza(ord.id);
    });

    listEl.appendChild(card);
  });

  document.getElementById("countOrdinanze").textContent = totalShown;
  document.getElementById("statVigenti").textContent = countVigenti;
  document.getElementById("statFuture").textContent = countFuture;
  document.getElementById("statScadute").textContent = countScadute;
}

function formatDateTimeIT(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ============================================================================
// RICERCA VIA SENIGALLIA
// ============================================================================
async function searchStreetSenigallia(query) {
  if (!query || query.length < 2) return;
  const dropdown = document.getElementById("searchResults");
  dropdown.innerHTML = `<div class="search-item">Ricerca a Senigallia in corso...</div>`;
  dropdown.classList.remove("hidden");

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Senigallia")}&viewbox=${SENIGALLIA_VIEWBOX}&bounded=1&limit=5`;

  try {
    const res = await fetch(url, { headers: { "Accept-Language": "it" } });
    const results = await res.json();
    dropdown.innerHTML = "";

    if (results.length === 0) {
      dropdown.innerHTML = `<div class="search-item">Nessuna via trovata a Senigallia.</div>`;
      return;
    }

    results.forEach((item) => {
      const div = document.createElement("div");
      div.className = "search-item";
      div.textContent = item.display_name.split(",")[0] + " — Senigallia";
      div.addEventListener("click", () => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        map.setView([lat, lon], 17);
        document.getElementById("streetSearch").value = item.display_name.split(",")[0];
        dropdown.classList.add("hidden");
        renderAll();
      });
      dropdown.appendChild(div);
    });
  } catch (err) {
    dropdown.classList.add("hidden");
  }
}

// ============================================================================
// TRACCIAMENTO STRADALE E SNAPPING (OSRM)
// ============================================================================
function startDrawing(mode) {
  drawingMode = mode;
  drawnPoints = [];
  tempDrawGroup.clearLayers();

  document.getElementById("uploadModal").classList.add("hidden");
  const banner = document.getElementById("drawingBanner");
  banner.classList.remove("hidden");

  if (mode === "line") {
    document.getElementById("drawingStepText").innerHTML =
      `Clicca sulla mappa il <b>PUNTO DI INIZIO</b> e poi il <b>PUNTO DI FINE</b> della via (il percorso stradale si aggancerà da solo)`;
    document.getElementById("btnFinishDrawing").classList.add("hidden");
  } else {
    document.getElementById("drawingStepText").innerHTML =
      `Clicca i vertici dell'area/piazza e poi premi <b>Conferma Tracciato</b>`;
    document.getElementById("btnFinishDrawing").classList.remove("hidden");
  }
}

async function onMapClickForDrawing(e) {
  if (!drawingMode) return;
  const pt = [e.latlng.lat, e.latlng.lng];
  drawnPoints.push(pt);

  L.circleMarker(pt, { radius: 6, color: "#2563eb", fillOpacity: 1 }).addTo(tempDrawGroup);

  if (drawingMode === "line" && drawnPoints.length === 2) {
    const start = drawnPoints[0];
    const end = drawnPoints[1];
    let roadCoords = [start, end];

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl);
      const data = await res.json();
      if (data.routes && data.routes[0]) {
        roadCoords = data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
      }
    } catch (_) {}

    pendingGeometry = { type: "line", coords: roadCoords };
    L.polyline(roadCoords, { color: "#2563eb", weight: 6 }).addTo(tempDrawGroup);
    finishDrawingSession("Tratto stradale agganciato (" + roadCoords.length + " punti)");
  } else if (drawingMode === "polygon" && drawnPoints.length >= 2) {
    L.polygon(drawnPoints, { color: "#2563eb" }).addTo(tempDrawGroup);
  }
}

function finishDrawingSession(statusLabel) {
  drawingMode = null;
  document.getElementById("drawingBanner").classList.add("hidden");
  document.getElementById("uploadModal").classList.remove("hidden");
  document.getElementById("geoStatusBadge").textContent = "✅ " + statusLabel;
  document.getElementById("geoStatusBadge").style.color = "#15803d";
}

// ============================================================================
// PARSING AUTOMATICO ATTI (PDF / OCR)
// ============================================================================
async function handleFileUpload(file) {
  if (!file) return;
  const statusEl = document.getElementById("parseStatus");
  statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Lettura automatica in corso...`;

  let extractedText = "";

  try {
    if (file.type === "application/pdf" && window.pdfjsLib) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      for (let i = 1; i <= Math.min(pdf.numPages, 4); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        extractedText += content.items.map((item) => item.str).join(" ") + "\n";
      }
    } else if (file.type.startsWith("image/") && window.Tesseract) {
      statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> OCR scansione in corso...`;
      const result = await Tesseract.recognize(file, "ita");
      extractedText = result.data.text;
    } else {
      extractedText = await file.text();
    }

    autoFillFormFromText(extractedText, file.name);
    statusEl.innerHTML = `<b style="color:#15803d;">✅ Dati estratti da "${file.name}"! Verifica e salva.</b>`;
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#b45309;">File caricato. Verifica i campi sottostanti.</span>`;
  }
}

function autoFillFormFromText(text, filename) {
  const clean = text.replace(/\s+/g, " ");

  const numMatch =
    clean.match(/ordinanza\s*(?:dirigenziale\s*)?(?:n\.?|num\.?|numero)?\s*(\d{1,5}(?:\/\d{4})?)/i) ||
    filename.match(/(\d{1,4}[\/\-]\d{4})/);
  if (numMatch) {
    const year = new Date().getFullYear();
    const rawNum = numMatch[1].replace("-", "/");
    document.getElementById("ordNumero").value = rawNum.includes("/") ? rawNum : `${rawNum}/${year}`;
  }

  const lower = clean.toLowerCase();
  if (lower.includes("divieto di transito") || lower.includes("chiusura al transito") || lower.includes("interdizione")) {
    document.getElementById("ordTipo").value = "transito";
  } else if (lower.includes("manifestazione") || lower.includes("mercato") || lower.includes("evento")) {
    document.getElementById("ordTipo").value = "manifestazione";
  } else if (lower.includes("cantiere") || lower.includes("ponteggio") || lower.includes("occupazione suolo")) {
    document.getElementById("ordTipo").value = "cantiere";
  } else {
    document.getElementById("ordTipo").value = "sosta";
  }

  const viaMatch = clean.match(/\b(Via|Corso|Piazza|Viale|Lungomare|Vicolo|Largo|Strada)\s+([A-ZÀ-Ú0-9][a-zà-ú0-9]+(?:\s+[A-ZÀ-Ú0-9a-zà-ú]+){0,3})/);
  if (viaMatch) {
    document.getElementById("ordVia").value = `${viaMatch[1]} ${viaMatch[2].trim()}`;
  }

  const dateRegex = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/g;
  const datesFound = [...clean.matchAll(dateRegex)];

  const timeRegex = /(?:ore|dalle|alle)\s*(\d{1,2})[:\.](\d{2})/gi;
  const timesFound = [...clean.matchAll(timeRegex)];

  const startHour = timesFound[0] ? `${timesFound[0][1].padStart(2, "0")}:${timesFound[0][2]}` : "08:00";
  const endHour = timesFound[1] ? `${timesFound[1][1].padStart(2, "0")}:${timesFound[1][2]}` : "19:00";

  if (datesFound.length >= 1) {
    const d1 = datesFound[0];
    const iso1 = `${d1[3]}-${d1[2].padStart(2, "0")}-${d1[1].padStart(2, "0")}T${startHour}`;
    document.getElementById("ordInizio").value = iso1;

    const d2 = datesFound.length >= 2 ? datesFound[1] : d1;
    const iso2 = `${d2[3]}-${d2[2].padStart(2, "0")}-${d2[1].padStart(2, "0")}T${endHour}`;
    document.getElementById("ordFine").value = iso2;
  }

  checkConflicts();
}

function checkConflicts() {
  const via = document.getElementById("ordVia").value.trim().toLowerCase();
  const inizio = document.getElementById("ordInizio").value;
  const fine = document.getElementById("ordFine").value;
  const alertBox = document.getElementById("conflictAlert");

  if (!via || !inizio || !fine) {
    alertBox.classList.add("hidden");
    return;
  }

  const s1 = new Date(inizio);
  const e1 = new Date(fine);

  const conflict = ordinanze.find((o) => {
    const sameStreet = o.via.toLowerCase().includes(via) || via.includes(o.via.toLowerCase());
    const s2 = new Date(o.inizio);
    const e2 = new Date(o.fine);
    return sameStreet && s1 <= e2 && e1 >= s2;
  });

  if (conflict) {
    document.getElementById("conflictText").innerHTML =
      `<b>Attenzione Conflitto:</b> Su <b>${conflict.via}</b> è già attiva l'Ordinanza <b>N° ${conflict.numero}</b> nello stesso periodo.`;
    alertBox.classList.remove("hidden");
  } else {
    alertBox.classList.add("hidden");
  }
}

// ============================================================================
// SALVATAGGIO ED ELIMINAZIONE
// ============================================================================
async function saveNewOrdinanza(e) {
  e.preventDefault();

  const pin = document.getElementById("officePin").value;
  if (pin !== OFFICE_PIN_DEFAULT) {
    alert("PIN Ufficio Verbali non valido (Default: 1234)");
    return;
  }

  const via = document.getElementById("ordVia").value.trim();
  let coords = pendingGeometry ? pendingGeometry.coords : null;
  let geoType = pendingGeometry ? pendingGeometry.type : "line";

  if (!coords) {
    coords = await autoGeocodeStreet(via);
  }

  const newOrd = {
    id: "ord-" + Date.now(),
    numero: document.getElementById("ordNumero").value.trim(),
    tipo: document.getElementById("ordTipo").value,
    via: via,
    tratto: document.getElementById("ordTratto").value.trim(),
    inizio: document.getElementById("ordInizio").value,
    fine: document.getElementById("ordFine").value,
    note: document.getElementById("ordNote").value.trim(),
    geometryType: geoType,
    coords: coords
  };

  ordinanze.unshift(newOrd);
  localStorage.setItem("pl_senigallia_ordinanze", JSON.stringify(ordinanze));

  if (supabaseClient) {
    await supabaseClient.from("ordinanze").insert([newOrd]);
  }

  tempDrawGroup.clearLayers();
  pendingGeometry = null;
  document.getElementById("ordinanzaForm").reset();
  document.getElementById("uploadModal").classList.add("hidden");

  renderAll();
  map.fitBounds(L.polyline(coords).getBounds(), { maxZoom: 17 });
}

async function autoGeocodeStreet(viaName) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(viaName + ", Senigallia")}&viewbox=${SENIGALLIA_VIEWBOX}&bounded=1&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data[0]) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      return [
        [lat - 0.0006, lon - 0.0006],
        [lat + 0.0006, lon + 0.0006]
      ];
    }
  } catch (_) {}
  return [
    [43.7131, 13.2175],
    [43.7140, 13.2192]
  ];
}

async function deleteOrdinanza(id) {
  const pin = prompt("Inserisci il PIN Ufficio Verbali per eliminare l'ordinanza (Default: 1234):", "1234");
  if (pin !== OFFICE_PIN_DEFAULT) return;

  ordinanze = ordinanze.filter((o) => o.id !== id);
  localStorage.setItem("pl_senigallia_ordinanze", JSON.stringify(ordinanze));

  if (supabaseClient) {
    await supabaseClient.from("ordinanze").delete().eq("id", id);
  }
  renderAll();
}

// ============================================================================
// EVENT LISTENERS INTERFACCIA
// ============================================================================
function bindEvents() {
  document.getElementById("filterFrom").addEventListener("change", renderAll);
  document.getElementById("filterTo").addEventListener("change", renderAll);
  document.getElementById("showExpired").addEventListener("change", renderAll);

  // Tasto OGGI: imposta giorno corrente reale dalle 00:00 alle 23:59
  document.getElementById("btnResetToday").addEventListener("click", () => {
    setFilterToToday();
    document.getElementById("streetSearch").value = "";
    map.setView(SENIGALLIA_CENTER, 15);
    renderAll();
  });

  const searchInput = document.getElementById("streetSearch");
  searchInput.addEventListener("input", () => {
    renderAll();
  });
  document.getElementById("btnSearchStreet").addEventListener("click", () => {
    searchStreetSenigallia(searchInput.value);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchStreetSenigallia(searchInput.value);
  });

  document.getElementById("btnLayerStreet").addEventListener("click", (e) => {
    map.removeLayer(satLayer);
    streetLayer.addTo(map);
    e.target.classList.add("active");
    document.getElementById("btnLayerSat").classList.remove("active");
  });
  document.getElementById("btnLayerSat").addEventListener("click", (e) => {
    map.removeLayer(streetLayer);
    satLayer.addTo(map);
    e.target.classList.add("active");
    document.getElementById("btnLayerStreet").classList.remove("active");
  });

  document.getElementById("btnRefresh").addEventListener("click", loadOrdinanze);

  document.getElementById("btnOpenModal").addEventListener("click", () => {
    document.getElementById("ordInizio").value = getRelativeDate(0, 8, 0);
    document.getElementById("ordFine").value = getRelativeDate(1, 19, 0);
    document.getElementById("uploadModal").classList.remove("hidden");
  });
  document.getElementById("btnCloseModal").addEventListener("click", () => {
    document.getElementById("uploadModal").classList.add("hidden");
  });

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => handleFileUpload(e.target.files[0]));
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.background = "#dbeafe";
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.style.background = "#eff6ff";
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.background = "#eff6ff";
    if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
  });

  ["ordVia", "ordInizio", "ordFine"].forEach((id) => {
    document.getElementById(id).addEventListener("input", checkConflicts);
  });

  document.getElementById("btnStartLineDraw").addEventListener("click", () => startDrawing("line"));
  document.getElementById("btnStartAreaDraw").addEventListener("click", () => startDrawing("polygon"));
  document.getElementById("btnFinishDrawing").addEventListener("click", () => {
    if (drawnPoints.length >= 3) {
      pendingGeometry = { type: "polygon", coords: drawnPoints };
      finishDrawingSession("Area/Piazza tracciata (" + drawnPoints.length + " vertici)");
    }
  });
  document.getElementById("btnCancelDrawing").addEventListener("click", () => {
    drawingMode = null;
    tempDrawGroup.clearLayers();
    document.getElementById("drawingBanner").classList.add("hidden");
    document.getElementById("uploadModal").classList.remove("hidden");
  });

  document.getElementById("ordinanzaForm").addEventListener("submit", saveNewOrdinanza);

  document.getElementById("btnConfigCloud").addEventListener("click", () => {
    document.getElementById("cloudModal").classList.remove("hidden");
  });
  document.getElementById("btnCloseCloud").addEventListener("click", () => {
    document.getElementById("cloudModal").classList.add("hidden");
  });
  document.getElementById("btnSaveCloud").addEventListener("click", () => {
    localStorage.setItem("pl_supa_url", document.getElementById("supaUrl").value.trim());
    localStorage.setItem("pl_supa_key", document.getElementById("supaKey").value.trim());
    document.getElementById("cloudModal").classList.add("hidden");
    initCloudConnection();
    loadOrdinanze();
  });
}
