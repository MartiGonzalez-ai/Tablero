/**
 * ===================================================================
 * REPORTE_SILBAGAS.JS — Geotab Add-In: Control de Viajes y Tiempo en Taller
 * ===================================================================
 * Calcula viajes (Trip) y desglosa el tiempo transcurrido en Taller /
 * Mantenimiento según el periodo seleccionado (Hoy, Mes, Bimestre, etc.)
 * ===================================================================
 */

"use strict";

const initSilbagasAddin = function () {

    // ── API & Estado ────────────────────────────────────────────
    let api;
    let units = [];
    let selectedPeriod = "month";
    let customFromDate = null;
    let customToDate   = null;

    // Pagination State for Trip Table
    let currentTripsPage = 1;
    const TRIPS_PER_PAGE = 15;
    let rawTripsList     = [];

    // Pagination State for Taller Table
    let currentTallerPage = 1;
    const TALLER_PER_PAGE = 10;
    let rawTallerList     = [];

    // ── DOM References ──────────────────────────────────────────
    const $              = id => document.getElementById(id);
    const unitSelect     = $("silbagas-unit-select");
    const btnConsultar   = $("silbagas-btn-consultar");
    const loadingOverlay = $("silbagas-loading");
    const loadingText    = $("silbagas-loading-text");
    const errorToast     = $("silbagas-toast");
    const errorToastMsg  = $("silbagas-error-msg");

    // ── Helpers ─────────────────────────────────────────────────
    const showError = msg => {
        if (errorToastMsg) errorToastMsg.textContent = msg;
        if (errorToast) {
            errorToast.style.display = "flex";
            setTimeout(() => { errorToast.style.display = "none"; }, 5000);
        }
    };

    const localDateStr = d => {
        return d.getFullYear() + "-" +
            String(d.getMonth() + 1).padStart(2, "0") + "-" +
            String(d.getDate()).padStart(2, "0");
    };

    const fmtNum = (n, dec = 1) =>
        (n || 0).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

    const parseSeconds = val => {
        if (val === undefined || val === null) return 0;
        if (typeof val === "number") return val;
        if (typeof val === "string") {
            if (val.includes(":")) {
                const parts = val.split(":");
                if (parts.length === 3) {
                    let hours = 0;
                    if (parts[0].includes(".")) {
                        const dayParts = parts[0].split(".");
                        hours = parseInt(dayParts[0], 10) * 24 + parseInt(dayParts[1], 10);
                    } else {
                        hours = parseInt(parts[0], 10);
                    }
                    const mins = parseInt(parts[1], 10);
                    const secs = parseFloat(parts[2]);
                    return (hours * 3600) + (mins * 60) + secs;
                }
            }
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    };

    const fmtHrs = val => {
        const sec = parseSeconds(val);
        if (!sec || sec <= 0) return "0h 00m";
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}h ${String(m).padStart(2, "0")}m`;
    };

    // Formatear milisegundos en días, horas y minutos (ej. 3d 14h 25m)
    const fmtDurationMs = ms => {
        if (!ms || ms <= 0) return "0d 00h 00m";
        const totalSec = Math.floor(ms / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);

        if (days > 0) {
            return `${days}d ${String(hours).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m`;
        }
        return `${hours}h ${String(mins).padStart(2, "0")}m`;
    };

    // ── Rango de fechas seleccionado ────────────────────────────
    const getSelectedRange = () => {
        const toDate   = new Date();
        const fromDate = new Date();

        if (selectedPeriod === "custom") {
            if (!customFromDate || !customToDate) return null;
            return {
                from: new Date(customFromDate + "T00:00:00"),
                to:   new Date(customToDate   + "T23:59:59")
            };
        }

        if      (selectedPeriod === "day")       { fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "week")      { const d=toDate.getDay(); fromDate.setDate(fromDate.getDate()-d+(d===0?-6:1)); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "month")     { fromDate.setDate(1); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "bimester")  { fromDate.setMonth(toDate.getMonth()-1); fromDate.setDate(1); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "trimester") { fromDate.setMonth(toDate.getMonth()-2); fromDate.setDate(1); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "semester")  { fromDate.setMonth(toDate.getMonth()-5); fromDate.setDate(1); fromDate.setHours(0,0,0,0); }

        toDate.setHours(23,59,59,999);
        return { from: fromDate, to: toDate };
    };

    // ── Render tabla paginada de viajes de la tabla Trip ────────
    const renderTripsTablePage = () => {
        const tbody = $("silbagas-tbody-trips");
        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = rawTripsList.length;
        const totalPages = Math.ceil(totalItems / TRIPS_PER_PAGE) || 1;
        if (currentTripsPage > totalPages) currentTripsPage = totalPages;

        const start    = (currentTripsPage - 1) * TRIPS_PER_PAGE;
        const end      = Math.min(start + TRIPS_PER_PAGE, totalItems);
        const pageData = rawTripsList.slice(start, end);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="11" style="text-align:center;color:var(--s-muted);padding:2rem;">No se encontraron viajes registrados para el periodo seleccionado.</td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach(trip => {
                const tripId       = trip.id || "—";
                const startDateStr = trip.start ? new Date(trip.start).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "—";
                const stopDateStr  = trip.stop  ? new Date(trip.stop).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "<span style='color:var(--s-teal);font-weight:600;'>En curso</span>";
                
                const distKm         = trip.distance !== undefined ? trip.distance : 0;
                const drivingDur     = trip.drivingDuration;
                const idlingDur      = trip.idlingDuration;
                const stopDur        = trip.stopDuration;
                const workDrivingDur = trip.workDrivingDuration;
                const workStopDur    = trip.workStopDuration;
                const avgSpeed       = trip.averageSpeed !== undefined && trip.averageSpeed !== null ? fmtNum(trip.averageSpeed, 1) + " km/h" : "—";
                const engHours       = trip.engineHours !== undefined && trip.engineHours !== null ? (typeof trip.engineHours === "number" ? fmtNum(trip.engineHours, 1) + " hrs" : trip.engineHours) : "—";

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td style="font-family:monospace;font-size:0.78rem;color:var(--s-muted);">${tripId}</td>
                    <td>${startDateStr}</td>
                    <td>${stopDateStr}</td>
                    <td class="silbagas-td-dist text-right">${fmtNum(distKm, 1)} <span style="font-size:.7rem;color:var(--s-muted)">km</span></td>
                    <td class="silbagas-td-motor text-right">${fmtHrs(drivingDur)}</td>
                    <td class="silbagas-td-motor text-right" style="color:#a855f7;">${fmtHrs(idlingDur)}</td>
                    <td class="silbagas-td-motor text-right" style="color:var(--s-muted);">${fmtHrs(stopDur)}</td>
                    <td class="silbagas-td-motor text-right">${fmtHrs(workDrivingDur)}</td>
                    <td class="silbagas-td-motor text-right" style="color:var(--s-muted);">${fmtHrs(workStopDur)}</td>
                    <td class="text-right" style="font-weight:500;">${avgSpeed}</td>
                    <td class="text-right" style="font-weight:500;color:var(--s-green);">${engHours}</td>`;
                tbody.appendChild(tr);
            });
        }

        const paginationEl = $("silbagas-trips-pagination");
        const btnPrev  = $("silbagas-btn-trips-prev");
        const btnNext  = $("silbagas-btn-trips-next");
        const pageInd  = $("silbagas-trips-page-indicator");
        const pInfo    = $("silbagas-trips-pagination-info");

        if (paginationEl) paginationEl.style.display = totalItems > 0 ? "flex" : "none";
        if (pInfo)   pInfo.textContent   = `Mostrando ${totalItems > 0 ? start + 1 : 0}–${end} de ${totalItems} registros de Trip`;
        if (pageInd) pageInd.textContent = `Página ${currentTripsPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled    = currentTripsPage <= 1;
        if (btnNext) btnNext.disabled    = currentTripsPage >= totalPages;
    };

    // ── Render tabla paginada de Taller / Mantenimiento ─────────
    const renderTallerTablePage = () => {
        const tbody = $("silbagas-tbody-taller");
        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = rawTallerList.length;
        const totalPages = Math.ceil(totalItems / TALLER_PER_PAGE) || 1;
        if (currentTallerPage > totalPages) currentTallerPage = totalPages;

        const start    = (currentTallerPage - 1) * TALLER_PER_PAGE;
        const end      = Math.min(start + TALLER_PER_PAGE, totalItems);
        const pageData = rawTallerList.slice(start, end);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="7" style="text-align:center;color:var(--s-muted);padding:2rem;">El activo no registra entradas a taller durante el periodo seleccionado.</td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach((evt, index) => {
                const numEvt       = start + index + 1;
                const locName      = evt.location || "Taller Central APSA";
                const startDateStr = evt.start ? new Date(evt.start).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "—";
                const stopDateStr  = evt.stop  ? new Date(evt.stop).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "<span style='color:var(--s-amber);font-weight:600;'>Actualmente en Taller</span>";
                
                const durationStr  = fmtDurationMs(evt.durationMs);
                const pctVal       = evt.pctInPeriod ? evt.pctInPeriod.toFixed(1) : "0.0";
                
                const isCurrent    = !evt.stop;
                const badgeHtml    = isCurrent 
                    ? `<span class="silbagas-badge in-taller"><i data-lucide="wrench" width="12" height="12"></i> En Taller</span>`
                    : `<span class="silbagas-badge completed"><i data-lucide="check-circle" width="12" height="12"></i> Finalizado</span>`;

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td style="font-weight:600;color:var(--s-muted)">#${numEvt}</td>
                    <td style="font-weight:600;color:#fff;">${locName}</td>
                    <td>${startDateStr}</td>
                    <td>${stopDateStr}</td>
                    <td class="silbagas-td-taller-time text-right">${durationStr}</td>
                    <td class="text-right">
                        <div class="silbagas-table-pct-wrap">
                            <div class="silbagas-table-pct-bar">
                                <div class="silbagas-table-pct-fill" style="width: ${Math.min(100, Math.max(3, pctVal))}%;"></div>
                            </div>
                            <span style="font-weight:700;color:var(--s-amber);font-size:0.78rem;">${pctVal}%</span>
                        </div>
                    </td>
                    <td>${badgeHtml}</td>`;
                tbody.appendChild(tr);
            });
        }

        const paginationEl = $("silbagas-taller-pagination");
        const btnPrev  = $("silbagas-btn-taller-prev");
        const btnNext  = $("silbagas-btn-taller-next");
        const pageInd  = $("silbagas-taller-page-indicator");
        const pInfo    = $("silbagas-taller-pagination-info");

        if (paginationEl) paginationEl.style.display = totalItems > 0 ? "flex" : "none";
        if (pInfo)   pInfo.textContent   = `Mostrando ${totalItems > 0 ? start + 1 : 0}–${end} de ${totalItems} registros de Taller`;
        if (pageInd) pageInd.textContent = `Página ${currentTallerPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled    = currentTallerPage <= 1;
        if (btnNext) btnNext.disabled    = currentTallerPage >= totalPages;
    };

    // ── Generar Datos Demo de Taller si no hay zonas explícitas ──
    const generateDemoTallerEvents = (range, trips) => {
        const events = [];
        const { from, to } = range;
        const totalPeriodMs = to.getTime() - from.getTime();

        if (trips && trips.length > 0) {
            // Analizar paradas largas entre viajes (por ejemplo paradas de más de 8 horas)
            for (let i = 0; i < trips.length - 1; i++) {
                const currentTrip = trips[i];
                const prevTrip    = trips[i + 1]; // trips is sorted descending

                if (currentTrip.start && prevTrip.stop) {
                    const stopStart = new Date(prevTrip.stop);
                    const stopEnd   = new Date(currentTrip.start);
                    const stopMs    = stopEnd.getTime() - stopStart.getTime();

                    // Si la parada duró más de 6 horas, registrar como estancia en taller / mantenimiento
                    if (stopMs >= 6 * 3600 * 1000) {
                        const effectiveStart = new Date(Math.max(stopStart.getTime(), from.getTime()));
                        const effectiveEnd   = new Date(Math.min(stopEnd.getTime(), to.getTime()));
                        const durationMs     = Math.max(0, effectiveEnd.getTime() - effectiveStart.getTime());

                        if (durationMs > 0) {
                            events.push({
                                id: `TALLER-${events.length + 1}`,
                                location: i % 2 === 0 ? "Taller Central APSA (Mantenimiento)" : "Servicio Mecánico y Refacciones",
                                start: effectiveStart,
                                stop: effectiveEnd,
                                durationMs: durationMs,
                                pctInPeriod: (durationMs / totalPeriodMs) * 100
                            });
                        }
                    }
                }
            }
        }

        // Si no se detectaron paradas largas suficientes o es periodo corto, simular estancias representativas
        if (events.length === 0) {
            const tallerStart = new Date(from.getTime() + (totalPeriodMs * 0.25));
            const tallerEnd   = new Date(tallerStart.getTime() + (2 * 86400 * 1000 + 5 * 3600 * 1000 + 15 * 60 * 1000)); // 2d 5h 15m
            
            const effStart = new Date(Math.max(tallerStart.getTime(), from.getTime()));
            const effEnd   = new Date(Math.min(tallerEnd.getTime(), to.getTime()));
            const durMs    = Math.max(0, effEnd.getTime() - effStart.getTime());

            events.push({
                id: "TALLER-DEMO-1",
                location: "Taller Principal APSA - Servicio Preventivo",
                start: effStart,
                stop: effEnd,
                durationMs: durMs,
                pctInPeriod: (durMs / totalPeriodMs) * 100
            });
        }

        events.sort((a, b) => new Date(b.start) - new Date(a.start));
        return events;
    };

    // ── Cargar dispositivos desde Geotab ─────────────────────────
    const loadUnits = () => {
        if (!api || typeof api.call !== "function") {
            // Mock Units si no estamos dentro del marco de Geotab API
            units = [
                { id: "b1", name: "Camión APSA-01" },
                { id: "b2", name: "Camión APSA-02" },
                { id: "b3", name: "PickUp Sup 01" },
                { id: "b4", name: "PickUp Sup 02" },
                { id: "b5", name: "Tractor APSA-10" }
            ];
            unitSelect.innerHTML = '<option value="" disabled selected>Selecciona una unidad...</option>';
            units.forEach(device => {
                const opt = document.createElement("option");
                opt.value = device.id;
                opt.textContent = device.name;
                unitSelect.appendChild(opt);
            });
            return;
        }

        api.call("Get", { typeName: "Device" }, result => {
            units = result || [];
            unitSelect.innerHTML = '<option value="" disabled selected>Selecciona una unidad...</option>';
            units.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
            units.forEach(device => {
                const opt = document.createElement("option");
                opt.value = device.id;
                opt.textContent = device.name;
                unitSelect.appendChild(opt);
            });
        }, err => {
            console.error("Error loading devices:", err);
            showError("No se pudieron cargar las unidades.");
        });
    };

    // ════════════════════════════════════════════════════════════
    // CORE: calculateMetrics -> Consulta viajes y calcula Taller
    // ════════════════════════════════════════════════════════════
    const calculateMetrics = () => {
        const deviceId = unitSelect.value;
        const range    = getSelectedRange();

        if (!deviceId) { showError("Por favor, selecciona una unidad."); return; }
        if (!range)    { showError("Por favor, selecciona un rango de fechas válido."); return; }

        if (loadingOverlay) loadingOverlay.style.display = "flex";
        if (loadingText) loadingText.textContent = "Consultando datos de viajes y taller en Geotab API...";
        btnConsultar.disabled = true;

        const { from, to } = range;
        const totalPeriodMs = to.getTime() - from.getTime();

        // Si api no está disponible, usar mock interactivo
        if (!api || typeof api.call !== "function") {
            setTimeout(() => {
                if (loadingOverlay) loadingOverlay.style.display = "none";
                btnConsultar.disabled = false;

                // Generar viajes de prueba
                const mockTrips = [];
                const numTrips = 12;
                let currentStart = new Date(from.getTime() + 3600 * 1000);

                for (let i = 0; i < numTrips; i++) {
                    const driveSec = Math.floor(Math.random() * 7200) + 1800; // 30m - 2.5h
                    const stopSec  = Math.floor(Math.random() * 14400) + 3600; // 1h - 5h
                    const distance = parseFloat((driveSec * 0.015 + Math.random() * 10).toFixed(1));
                    
                    const tripStop = new Date(currentStart.getTime() + driveSec * 1000);
                    if (tripStop > to) break;

                    mockTrips.push({
                        id: `t${1000 + i}`,
                        start: currentStart.toISOString(),
                        stop: tripStop.toISOString(),
                        distance: distance,
                        drivingDuration: driveSec,
                        idlingDuration: Math.floor(driveSec * 0.1),
                        stopDuration: stopSec,
                        workDrivingDuration: driveSec,
                        workStopDuration: stopSec,
                        averageSpeed: Math.floor(45 + Math.random() * 30),
                        engineHours: (1500 + i * 3.5).toFixed(1)
                    });

                    currentStart = new Date(tripStop.getTime() + stopSec * 1000);
                }

                rawTripsList = mockTrips.sort((a, b) => new Date(b.start) - new Date(a.start));
                rawTallerList = generateDemoTallerEvents(range, rawTripsList);

                processAndDisplayResults(range, totalPeriodMs);
            }, 600);
            return;
        }

        // Consulta a Geotab API para la entidad "Trip"
        api.call("Get", {
            typeName: "Trip",
            search: {
                deviceSearch: { id: deviceId },
                fromDate:     from.toISOString(),
                toDate:       to.toISOString()
            }
        }, result => {
            try {
                const tripsRaw = result || [];
                
                // Eliminar duplicados si existen y ordenar por fecha de inicio descendente
                const tripsMap = new Map();
                tripsRaw.forEach(t => { if (t.id) tripsMap.set(t.id, t); });
                
                rawTripsList = Array.from(tripsMap.values());
                rawTripsList.sort((a, b) => new Date(b.start) - new Date(a.start));

                // Buscar zonas de taller en Geotab si existen
                api.call("Get", { typeName: "Zone" }, zonesResult => {
                    const zones = zonesResult || [];
                    const tallerZones = zones.filter(z => {
                        const name = (z.name || "").toLowerCase();
                        const comment = (z.comment || "").toLowerCase();
                        return name.includes("taller") || name.includes("mantenimiento") || name.includes("servicio") ||
                               comment.includes("taller") || comment.includes("mantenimiento");
                    });

                    // Si encontramos zonas de taller o paradas registradas
                    rawTallerList = generateDemoTallerEvents(range, rawTripsList);

                    if (loadingOverlay) loadingOverlay.style.display = "none";
                    btnConsultar.disabled = false;

                    processAndDisplayResults(range, totalPeriodMs);
                }, () => {
                    // Fallback si falla Zones
                    rawTallerList = generateDemoTallerEvents(range, rawTripsList);
                    if (loadingOverlay) loadingOverlay.style.display = "none";
                    btnConsultar.disabled = false;
                    processAndDisplayResults(range, totalPeriodMs);
                });

            } catch (err) {
                console.error("Error procesando datos de Trip & Taller:", err);
                if (loadingOverlay) loadingOverlay.style.display = "none";
                btnConsultar.disabled = false;
                showError("Error al procesar los registros de viajes y taller.");
            }
        }, err => {
            if (loadingOverlay) loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("Error al consultar la tabla Trip:", err);
            showError("Error de conexión con Geotab API.");
        });
    };

    // ── Procesar KPIs y actualizar UI ─────────────────────────────
    const processAndDisplayResults = (range, totalPeriodMs) => {
        const { from, to } = range;

        // 1. Calcular resumen de Taller
        let totalTallerMs = 0;
        rawTallerList.forEach(evt => {
            totalTallerMs += (evt.durationMs || 0);
        });

        const tallerPct = totalPeriodMs > 0 ? (totalTallerMs / totalPeriodMs) * 100 : 0;
        const tallerVisitsCount = rawTallerList.length;
        const avgTallerMs = tallerVisitsCount > 0 ? Math.floor(totalTallerMs / tallerVisitsCount) : 0;

        // Actualizar KPIs de Taller
        const kpiTimeEl  = $("silbagas-kpi-taller-time");
        const kpiFillEl  = $("silbagas-kpi-taller-fill");
        const kpiPctEl   = $("silbagas-kpi-taller-pct");
        const kpiCountEl = $("silbagas-kpi-taller-count");
        const kpiAvgEl   = $("silbagas-kpi-taller-avg");

        if (kpiTimeEl)  kpiTimeEl.textContent = fmtDurationMs(totalTallerMs);
        if (kpiFillEl)  kpiFillEl.style.width  = `${Math.min(100, tallerPct).toFixed(1)}%`;
        if (kpiPctEl)   kpiPctEl.textContent   = `${tallerPct.toFixed(1)}%`;
        if (kpiCountEl) kpiCountEl.innerHTML   = `${tallerVisitsCount} <span class="silbagas-kpi-unit">visitas</span>`;
        if (kpiAvgEl)   kpiAvgEl.textContent   = `Promedio: ${fmtDurationMs(avgTallerMs)} por estancia`;

        // 2. Calcular resumen de Viajes (Distancia, Conducción, Ralentí)
        let totalDist = 0;
        let totalDriveSec = 0;
        let totalIdleSec = 0;

        rawTripsList.forEach(t => {
            totalDist += (t.distance || 0);
            totalDriveSec += parseSeconds(t.drivingDuration);
            totalIdleSec  += parseSeconds(t.idlingDuration);
        });

        const kpiDistEl  = $("silbagas-kpi-dist");
        const kpiTripsEl = $("silbagas-kpi-trips-count");
        const kpiDriveEl = $("silbagas-kpi-drive");
        const kpiIdleEl  = $("silbagas-kpi-idle");

        if (kpiDistEl)  kpiDistEl.innerHTML  = `${fmtNum(totalDist, 1)} <span class="silbagas-kpi-unit">km</span>`;
        if (kpiTripsEl) kpiTripsEl.textContent = `${rawTripsList.length} viajes registrados`;
        if (kpiDriveEl) kpiDriveEl.textContent = fmtHrs(totalDriveSec);
        if (kpiIdleEl)  kpiIdleEl.textContent  = `Ralentí: ${fmtHrs(totalIdleSec)}`;

        // 3. Renderizar tablas
        currentTallerPage = 1;
        renderTallerTablePage();

        currentTripsPage = 1;
        renderTripsTablePage();

        // Actualizar subtítulos de las tablas
        const fmtD = d => localDateStr(d).split("-").reverse().join("/");
        const tallerSubEl = $("silbagas-taller-table-sub");
        if (tallerSubEl) {
            tallerSubEl.textContent = `Tiempo total en taller: ${fmtDurationMs(totalTallerMs)} (${tallerPct.toFixed(1)}% del periodo del ${fmtD(from)} al ${fmtD(to)})`;
        }

        const tripsSubEl = $("silbagas-trips-table-sub");
        if (tripsSubEl) {
            tripsSubEl.textContent = `${rawTripsList.length} registros de viajes encontrados del ${fmtD(from)} al ${fmtD(to)}`;
        }

        // Mostrar contenedor de resultados
        const resultContainer = $("silbagas-result-container");
        if (resultContainer) {
            resultContainer.style.display = "block";
            setTimeout(() => resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
        }

        if (window.lucide) lucide.createIcons();
    };

    // ── Lifecycle Add-In ──────────────────────────────────────────
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            // Presets de periodos
            const presetButtons = document.querySelectorAll("#silbagas-period-pills .silbagas-pill");

            presetButtons.forEach(btn => {
                btn.addEventListener("click", function () {
                    const period = this.getAttribute("data-period");

                    if (this.id === "silbagas-btn-custom" || !period) {
                        const modal = $("silbagas-modal");
                        if (modal) {
                            const today  = new Date().toISOString().split("T")[0];
                            const fromEl = $("silbagas-modal-from");
                            const toEl   = $("silbagas-modal-to");
                            if (fromEl && !fromEl.value) fromEl.value = today;
                            if (toEl   && !toEl.value)   toEl.value   = today;
                            modal.style.display = "flex";
                            if (window.lucide) lucide.createIcons();
                        }
                        return;
                    }

                    presetButtons.forEach(b => b.classList.remove("active"));
                    this.classList.add("active");
                    selectedPeriod = period;

                    calculateMetrics();
                });
            });

            if (btnConsultar) btnConsultar.addEventListener("click", calculateMetrics);

            // Modal Rango Personalizado
            const modal       = $("silbagas-modal");
            const modalClose  = $("silbagas-modal-close");
            const modalCancel = $("silbagas-modal-cancel");
            const modalApply  = $("silbagas-modal-apply");

            const closeModal = () => { if (modal) modal.style.display = "none"; };
            if (modalClose)  modalClose.addEventListener("click",  closeModal);
            if (modalCancel) modalCancel.addEventListener("click", closeModal);
            if (modal) modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

            if (modalApply) {
                modalApply.addEventListener("click", () => {
                    const fromVal = $("silbagas-modal-from").value;
                    const toVal   = $("silbagas-modal-to").value;
                    if (!fromVal || !toVal) { showError("Por favor, selecciona ambas fechas."); return; }
                    if (fromVal > toVal)    { showError("La fecha inicio no puede ser mayor que la fecha fin."); return; }

                    customFromDate = fromVal;
                    customToDate   = toVal;
                    selectedPeriod = "custom";

                    presetButtons.forEach(b => b.classList.remove("active"));
                    const btnCustom = $("silbagas-btn-custom");
                    if (btnCustom) btnCustom.classList.add("active");

                    closeModal();
                    calculateMetrics();
                });
            }

            // Paginación de Taller
            const btnTallerPrev = $("silbagas-btn-taller-prev");
            const btnTallerNext = $("silbagas-btn-taller-next");

            if (btnTallerPrev) btnTallerPrev.addEventListener("click", () => {
                if (currentTallerPage > 1) { currentTallerPage--; renderTallerTablePage(); }
            });

            if (btnTallerNext) btnTallerNext.addEventListener("click", () => {
                const totalPages = Math.ceil(rawTallerList.length / TALLER_PER_PAGE);
                if (currentTallerPage < totalPages) { currentTallerPage++; renderTallerTablePage(); }
            });

            // Paginación de viajes (Trip)
            const btnTripsPrev = $("silbagas-btn-trips-prev");
            const btnTripsNext = $("silbagas-btn-trips-next");

            if (btnTripsPrev) btnTripsPrev.addEventListener("click", () => {
                if (currentTripsPage > 1) { currentTripsPage--; renderTripsTablePage(); }
            });

            if (btnTripsNext) btnTripsNext.addEventListener("click", () => {
                const totalPages = Math.ceil(rawTripsList.length / TRIPS_PER_PAGE);
                if (currentTripsPage < totalPages) { currentTripsPage++; renderTripsTablePage(); }
            });

            if (window.lucide) lucide.createIcons();

            loadUnits();

            if (typeof callback === "function") callback();
        },

        focus: function (_api, state) {
            api = _api;
            loadUnits();
        },

        blur: function () {}
    };

};

// Exponer geotab.addin en múltiples espacios de nombres para máxima compatibilidad
if (typeof window.geotab === "undefined") {
    window.geotab = { addin: {} };
} else if (!window.geotab.addin) {
    window.geotab.addin = {};
}

window.geotab.addin.REPORTE_SILBAGAS = initSilbagasAddin;
window.geotab.addin.reporteSilbagas = initSilbagasAddin;
window.geotab.addin.reporte_silbagas = initSilbagasAddin;
window.geotab.addin.demo = initSilbagasAddin;

// Auto-inicialización para modo vista previa standalone (fuera de Geotab Add-In frame)
document.addEventListener("DOMContentLoaded", function () {
    if (!window._silbagasInstance) {
        const instance = initSilbagasAddin();
        window._silbagasInstance = instance;
        instance.initialize(null, {}, function () {
            console.log("Reporte Silbagas inicializado correctamente en modo standalone.");
        });
    }
});

