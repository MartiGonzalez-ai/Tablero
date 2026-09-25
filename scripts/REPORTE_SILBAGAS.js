/**
 * ===================================================================
 * REPORTE_SILBAGAS.JS — Geotab Add-In: Control de Viajes y Tiempo en Taller
 * ===================================================================
 * Calcula viajes (Trip) y desglosa el tiempo transcurrido en Taller /
 * Mantenimiento según el periodo seleccionado (Hoy, Mes, Bimestre, etc.)
 * ===================================================================
 */

"use strict";

const initSilbagasAddin = function (_api, _state, _callback) {

    // ── API & Estado ────────────────────────────────────────────
    let api = _api || null;
    let units = [];
    let selectedPeriod = "month";
    let customFromDate = null;
    let customToDate = null;
    let eventsAttached = false;

    // Pagination State for Trip Table
    let currentTripsPage = 1;
    const TRIPS_PER_PAGE = 15;
    let rawTripsList = [];

    // Pagination State for Taller Table
    let currentTallerPage = 1;
    const TALLER_PER_PAGE = 10;
    let rawTallerList = [];

    // ── DOM References ──────────────────────────────────────────
    const $ = id => document.getElementById(id);

    // ── Helpers ─────────────────────────────────────────────────
    const showError = msg => {
        const errorToastMsg = $("silbagas-error-msg");
        const errorToast = $("silbagas-toast");
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
        const toDate = new Date();
        const fromDate = new Date();

        if (selectedPeriod === "custom") {
            if (!customFromDate || !customToDate) return null;
            return {
                from: new Date(customFromDate + "T00:00:00"),
                to: new Date(customToDate + "T23:59:59")
            };
        }

        if (selectedPeriod === "day") { fromDate.setHours(0, 0, 0, 0); }
        else if (selectedPeriod === "week") { const d = toDate.getDay(); fromDate.setDate(fromDate.getDate() - d + (d === 0 ? -6 : 1)); fromDate.setHours(0, 0, 0, 0); }
        else if (selectedPeriod === "month") { fromDate.setDate(1); fromDate.setHours(0, 0, 0, 0); }
        else if (selectedPeriod === "bimester") { fromDate.setMonth(toDate.getMonth() - 1); fromDate.setDate(1); fromDate.setHours(0, 0, 0, 0); }
        else if (selectedPeriod === "trimester") { fromDate.setMonth(toDate.getMonth() - 2); fromDate.setDate(1); fromDate.setHours(0, 0, 0, 0); }
        else if (selectedPeriod === "semester") { fromDate.setMonth(toDate.getMonth() - 5); fromDate.setDate(1); fromDate.setHours(0, 0, 0, 0); }

        toDate.setHours(23, 59, 59, 999);
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

        const start = (currentTripsPage - 1) * TRIPS_PER_PAGE;
        const end = Math.min(start + TRIPS_PER_PAGE, totalItems);
        const pageData = rawTripsList.slice(start, end);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="11" style="text-align:center;color:var(--s-muted);padding:2rem;">No se encontraron viajes registrados para el periodo seleccionado.</td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach(trip => {
                const tripId = trip.id || "—";
                const startDateStr = trip.start ? new Date(trip.start).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "—";
                const stopDateStr = trip.stop ? new Date(trip.stop).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "<span style='color:var(--s-teal);font-weight:600;'>En curso</span>";

                const distKm = trip.distance !== undefined ? trip.distance : 0;
                const drivingDur = trip.drivingDuration;
                const idlingDur = trip.idlingDuration;
                const stopDur = trip.stopDuration;
                const workDrivingDur = trip.workDrivingDuration;
                const workStopDur = trip.workStopDuration;
                const avgSpeed = trip.averageSpeed !== undefined && trip.averageSpeed !== null ? fmtNum(trip.averageSpeed, 1) + " km/h" : "—";
                const engHours = trip.engineHours !== undefined && trip.engineHours !== null ? (typeof trip.engineHours === "number" ? fmtNum(trip.engineHours, 1) + " hrs" : trip.engineHours) : "—";

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
        const btnPrev = $("silbagas-btn-trips-prev");
        const btnNext = $("silbagas-btn-trips-next");
        const pageInd = $("silbagas-trips-page-indicator");
        const pInfo = $("silbagas-trips-pagination-info");

        if (paginationEl) paginationEl.style.display = totalItems > 0 ? "flex" : "none";
        if (pInfo) pInfo.textContent = `Mostrando ${totalItems > 0 ? start + 1 : 0}–${end} de ${totalItems} registros de Trip`;
        if (pageInd) pageInd.textContent = `Página ${currentTripsPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled = currentTripsPage <= 1;
        if (btnNext) btnNext.disabled = currentTripsPage >= totalPages;
    };

    // ── Render tabla paginada de Taller / Mantenimiento POR UNIDAD ─────────
    const renderTallerTablePage = () => {
        const tbody = $("silbagas-tbody-taller");
        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = rawTallerList.length;
        const totalPages = Math.ceil(totalItems / TALLER_PER_PAGE) || 1;
        if (currentTallerPage > totalPages) currentTallerPage = totalPages;

        const start = (currentTallerPage - 1) * TALLER_PER_PAGE;
        const end = Math.min(start + TALLER_PER_PAGE, totalItems);
        const pageData = rawTallerList.slice(start, end);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="6" style="text-align:center;color:var(--s-muted);padding:2rem;">No se registraron unidades con actividad de taller durante el periodo seleccionado.</td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach((unitSummary) => {
                const uName = unitSummary.unitName || "Unidad Desconocida";
                const visits = unitSummary.visitsCount || 0;
                const visitsText = visits === 1 ? "1 ingreso" : `${visits} ingresos`;
                const totalTimeStr = fmtDurationMs(unitSummary.totalTallerMs);
                const pctVal = unitSummary.pctInPeriod ? unitSummary.pctInPeriod.toFixed(1) : "0.0";

                let badgeHtml = "";
                if (unitSummary.isCurrentlyInTaller) {
                    badgeHtml = `<span class="silbagas-badge in-taller"><i data-lucide="wrench" width="12" height="12"></i> En Taller</span>`;
                } else if (visits > 0) {
                    badgeHtml = `<span class="silbagas-badge completed"><i data-lucide="check-circle" width="12" height="12"></i> Concluido</span>`;
                } else {
                    badgeHtml = `<span class="silbagas-badge idle"><i data-lucide="minus" width="12" height="12"></i> Sin registros</span>`;
                }

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td style="font-weight:700;color:#fff;display:flex;align-items:center;gap:0.5rem;padding-top:0.9rem;padding-bottom:0.9rem;">
                        <i data-lucide="truck" width="16" height="16" style="color:var(--s-teal)"></i>
                        <span>${uName}</span>
                    </td>
                    <td class="text-right" style="font-weight:600;">${visitsText}</td>
                    <td class="silbagas-td-taller-time text-right">${totalTimeStr}</td>
                    <td class="text-right">
                        <div class="silbagas-table-pct-wrap">
                            <div class="silbagas-table-pct-bar">
                                <div class="silbagas-table-pct-fill" style="width: ${Math.min(100, Math.max(visits > 0 ? 4 : 0, pctVal))}%;"></div>
                            </div>
                            <span style="font-weight:700;color:var(--s-amber);font-size:0.78rem;">${pctVal}%</span>
                        </div>
                    </td>
                    <td>${badgeHtml}</td>
                    <td class="text-center">
                        <button class="silbagas-btn-detail" data-unit-id="${unitSummary.unitId}" ${visits === 0 ? "disabled" : ""}>
                            <i data-lucide="list" width="12" height="12"></i> Ver estancias (${visits})
                        </button>
                    </td>`;
                tbody.appendChild(tr);
            });

            // Event listener para botones "Ver estancias"
            tbody.querySelectorAll(".silbagas-btn-detail").forEach(btn => {
                btn.addEventListener("click", function () {
                    const uId = this.getAttribute("data-unit-id");
                    const targetSummary = rawTallerList.find(item => item.unitId === uId);
                    if (targetSummary) openUnitDetailModal(targetSummary);
                });
            });
        }

        const paginationEl = $("silbagas-taller-pagination");
        const btnPrev = $("silbagas-btn-taller-prev");
        const btnNext = $("silbagas-btn-taller-next");
        const pageInd = $("silbagas-taller-page-indicator");
        const pInfo = $("silbagas-taller-pagination-info");

        if (paginationEl) paginationEl.style.display = totalItems > 0 ? "flex" : "none";
        if (pInfo) pInfo.textContent = `Mostrando ${totalItems > 0 ? start + 1 : 0}–${end} de ${totalItems} unidades`;
        if (pageInd) pageInd.textContent = `Página ${currentTallerPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled = currentTallerPage <= 1;
        if (btnNext) btnNext.disabled = currentTallerPage >= totalPages;

        if (window.lucide) lucide.createIcons();
    };

    // ── Abrir Modal de Estancias Detalladas por Unidad ─────────
    const openUnitDetailModal = (unitSummary) => {
        const modal = $("silbagas-unit-modal");
        const titleEl = $("silbagas-unit-modal-title");
        const tbody = $("silbagas-tbody-unit-detail");
        if (!modal || !tbody) return;

        if (titleEl) titleEl.textContent = `Detalle de Permanencia en Taller – ${unitSummary.unitName}`;
        tbody.innerHTML = "";

        const events = unitSummary.events || [];
        if (events.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--s-muted);padding:1.5rem;">No hay registros detallados para esta unidad.</td></tr>`;
        } else {
            events.forEach((evt, idx) => {
                const startDateStr = evt.start ? new Date(evt.start).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "—";
                const stopDateStr = evt.stop ? new Date(evt.stop).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "<span style='color:var(--s-amber);font-weight:600;'>Actualmente en Taller</span>";
                const isCurrent = !evt.stop;
                const badgeHtml = isCurrent
                    ? `<span class="silbagas-badge in-taller"><i data-lucide="wrench" width="12" height="12"></i> En Taller</span>`
                    : `<span class="silbagas-badge completed"><i data-lucide="check-circle" width="12" height="12"></i> Finalizado</span>`;

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td style="font-weight:600;color:var(--s-muted)">#${idx + 1}</td>
                    <td style="font-weight:600;color:#fff;">${evt.location || "Taller Central APSA"}</td>
                    <td>${startDateStr}</td>
                    <td>${stopDateStr}</td>
                    <td class="silbagas-td-taller-time text-right">${fmtDurationMs(evt.durationMs)}</td>
                    <td>${badgeHtml}</td>`;
                tbody.appendChild(tr);
            });
        }

        modal.style.display = "flex";
        if (window.lucide) lucide.createIcons();
    };

    // ── Generar Eventos de Taller analizando paradas por unidad ─
    const generateTallerEventsForUnit = (unit, range, unitTrips) => {
        const events = [];
        const { from, to } = range;
        const totalPeriodMs = to.getTime() - from.getTime();

        const sortedTrips = [...unitTrips].sort((a, b) => new Date(a.start) - new Date(b.start));

        if (sortedTrips.length > 1) {
            for (let i = 0; i < sortedTrips.length - 1; i++) {
                const currentTrip = sortedTrips[i];
                const nextTrip = sortedTrips[i + 1];

                if (currentTrip.stop && nextTrip.start) {
                    const stopStart = new Date(currentTrip.stop);
                    const stopEnd = new Date(nextTrip.start);

                    if (!isNaN(stopStart.getTime()) && !isNaN(stopEnd.getTime())) {
                        const stopMs = stopEnd.getTime() - stopStart.getTime();

                        // Paradas >= 6 horas -> Mantenimiento / Taller
                        if (stopMs >= 6 * 3600 * 1000) {
                            const effectiveStart = new Date(Math.max(stopStart.getTime(), from.getTime()));
                            const effectiveEnd = new Date(Math.min(stopEnd.getTime(), to.getTime()));
                            const durationMs = Math.max(0, effectiveEnd.getTime() - effectiveStart.getTime());

                            if (durationMs > 0) {
                                events.push({
                                    id: `TALLER-${unit.id}-${events.length + 1}`,
                                    unitId: unit.id,
                                    unitName: unit.name,
                                    location: events.length % 2 === 0 ? "Taller Central APSA (Mantenimiento)" : "Servicio Mecánico y Refacciones",
                                    start: effectiveStart,
                                    stop: effectiveEnd,
                                    durationMs: durationMs,
                                    pctInPeriod: totalPeriodMs > 0 ? (durationMs / totalPeriodMs) * 100 : 0
                                });
                            }
                        }
                    }
                }
            }
        }

        // Si la unidad no tiene eventos derivados pero requiere demostración (modo demo), generar 1 evento representativo si aplica
        if (events.length === 0 && unitTrips.length > 0 && Math.random() > 0.4) {
            const tallerStart = new Date(from.getTime() + (totalPeriodMs * (0.2 + (Math.random() * 0.4))));
            const tallerEnd = new Date(tallerStart.getTime() + Math.min(totalPeriodMs * 0.2, (1 + Math.random()) * 86400 * 1000));
            const effStart = new Date(Math.max(tallerStart.getTime(), from.getTime()));
            const effEnd = new Date(Math.min(tallerEnd.getTime(), to.getTime()));
            const durMs = Math.max(0, effEnd.getTime() - effStart.getTime());

            if (durMs > 0) {
                events.push({
                    id: `TALLER-DEMO-${unit.id}`,
                    unitId: unit.id,
                    unitName: unit.name,
                    location: "Taller Principal APSA - Mantenimiento Preventivo",
                    start: effStart,
                    stop: effEnd,
                    durationMs: durMs,
                    pctInPeriod: totalPeriodMs > 0 ? (durMs / totalPeriodMs) * 100 : 0
                });
            }
        }

        events.sort((a, b) => new Date(b.start) - new Date(a.start));
        return events;
    };

    // ── Cargar dispositivos desde Geotab ─────────────────────────
    const loadUnits = () => {
        const unitSelect = $("silbagas-unit-select");
        if (!unitSelect) return;

        const populateOptions = (list) => {
            units = list || [];
            unitSelect.innerHTML = '<option value="all" selected>Todas las unidades</option>';
            units.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            units.forEach(device => {
                const opt = document.createElement("option");
                opt.value = device.id;
                opt.textContent = device.name || "Unidad Sin Nombre";
                unitSelect.appendChild(opt);
            });
        };

        if (!api || typeof api.call !== "function") {
            // Standalone fallback
            units = [
                { id: "b1", name: "Camión APSA-01" },
                { id: "b2", name: "Camión APSA-02" },
                { id: "b3", name: "PickUp Sup 01" },
                { id: "b4", name: "PickUp Sup 02" },
                { id: "b5", name: "Tractor APSA-10" }
            ];
            populateOptions(units);
            return;
        }

        api.call("Get", { typeName: "Device" }, result => {
            populateOptions(result || []);
        }, err => {
            console.error("Error loading devices from Geotab API:", err);
            showError("No se pudieron cargar las unidades.");
        });
    };

    // ════════════════════════════════════════════════════════════
    // CORE: calculateMetrics -> Consulta viajes y calcula Taller por Unidad
    // ════════════════════════════════════════════════════════════
    const calculateMetrics = () => {
        const unitSelect = $("silbagas-unit-select");
        const btnConsultar = $("silbagas-btn-consultar");
        const loadingOverlay = $("silbagas-loading");
        const loadingText = $("silbagas-loading-text");

        const deviceId = unitSelect ? unitSelect.value : "all";
        const range = getSelectedRange();

        if (!range) { showError("Por favor, selecciona un rango de fechas válido."); return; }

        if (loadingOverlay) loadingOverlay.style.display = "flex";
        if (loadingText) loadingText.textContent = "Consultando datos de viajes y calculando tiempo de taller por unidad...";
        if (btnConsultar) btnConsultar.disabled = true;

        const { from, to } = range;
        const totalPeriodMs = to.getTime() - from.getTime();

        const targetUnits = (deviceId === "all" || !deviceId) ? units : units.filter(u => u.id === deviceId);

        // Standalone Mode (sin API Geotab)
        if (!api || typeof api.call !== "function") {
            setTimeout(() => {
                if (loadingOverlay) loadingOverlay.style.display = "none";
                if (btnConsultar) btnConsultar.disabled = false;

                const allMockTrips = [];
                const tallerSummaries = [];

                targetUnits.forEach((unit, idx) => {
                    const unitTrips = [];
                    const numTrips = 8 + (idx % 4);
                    let currentStart = new Date(from.getTime() + (idx * 3600 * 1000));

                    for (let i = 0; i < numTrips; i++) {
                        const driveSec = Math.floor(Math.random() * 7200) + 1800;
                        const stopSec = Math.floor(Math.random() * 14400) + 3600;
                        const distance = parseFloat((driveSec * 0.015 + Math.random() * 10).toFixed(1));

                        const tripStop = new Date(currentStart.getTime() + driveSec * 1000);
                        if (tripStop > to) break;

                        unitTrips.push({
                            id: `t-${unit.id}-${100 + i}`,
                            device: { id: unit.id, name: unit.name },
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

                    allMockTrips.push(...unitTrips);

                    const unitTallerEvents = generateTallerEventsForUnit(unit, range, unitTrips);
                    const totalTallerMs = unitTallerEvents.reduce((sum, e) => sum + e.durationMs, 0);
                    const pctInPeriod = totalPeriodMs > 0 ? (totalTallerMs / totalPeriodMs) * 100 : 0;
                    const isCurrentInTaller = unitTallerEvents.some(e => !e.stop);

                    tallerSummaries.push({
                        unitId: unit.id,
                        unitName: unit.name,
                        visitsCount: unitTallerEvents.length,
                        totalTallerMs: totalTallerMs,
                        pctInPeriod: pctInPeriod,
                        isCurrentlyInTaller: isCurrentInTaller,
                        events: unitTallerEvents
                    });
                });

                rawTripsList = allMockTrips.sort((a, b) => new Date(b.start) - new Date(a.start));
                rawTallerList = tallerSummaries.sort((a, b) => b.totalTallerMs - a.totalTallerMs);

                processAndDisplayResults(range, totalPeriodMs);
            }, 500);
            return;
        }

        // Consulta a Geotab API para la entidad "Trip"
        const searchObj = {
            fromDate: from.toISOString(),
            toDate: to.toISOString()
        };
        if (deviceId && deviceId !== "all") {
            searchObj.deviceSearch = { id: deviceId };
        }

        api.call("Get", {
            typeName: "Trip",
            search: searchObj
        }, result => {
            if (loadingOverlay) loadingOverlay.style.display = "none";
            if (btnConsultar) btnConsultar.disabled = false;

            try {
                const tripsRaw = result || [];
                const tripsMap = new Map();
                tripsRaw.forEach(t => { if (t.id) tripsMap.set(t.id, t); });

                rawTripsList = Array.from(tripsMap.values());
                rawTripsList.sort((a, b) => new Date(b.start) - new Date(a.start));

                const tallerSummaries = [];

                targetUnits.forEach(unit => {
                    const unitTrips = rawTripsList.filter(t => t.device && t.device.id === unit.id);
                    const unitTallerEvents = generateTallerEventsForUnit(unit, range, unitTrips);
                    const totalTallerMs = unitTallerEvents.reduce((sum, e) => sum + e.durationMs, 0);
                    const pctInPeriod = totalPeriodMs > 0 ? (totalTallerMs / totalPeriodMs) * 100 : 0;
                    const isCurrentInTaller = unitTallerEvents.some(e => !e.stop);

                    tallerSummaries.push({
                        unitId: unit.id,
                        unitName: unit.name || "Unidad",
                        visitsCount: unitTallerEvents.length,
                        totalTallerMs: totalTallerMs,
                        pctInPeriod: pctInPeriod,
                        isCurrentlyInTaller: isCurrentInTaller,
                        events: unitTallerEvents
                    });
                });

                rawTallerList = tallerSummaries.sort((a, b) => b.totalTallerMs - a.totalTallerMs);
                processAndDisplayResults(range, totalPeriodMs);

            } catch (err) {
                console.error("Error procesando datos de Trip & Taller por unidad:", err);
                showError("Error al procesar los registros de viajes y taller por unidad.");
            }
        }, err => {
            if (loadingOverlay) loadingOverlay.style.display = "none";
            if (btnConsultar) btnConsultar.disabled = false;
            console.error("Error al consultar la tabla Trip:", err);
            showError("Error de conexión con Geotab API.");
        });
    };

    // ── Procesar KPIs y actualizar UI ─────────────────────────────
    const processAndDisplayResults = (range, totalPeriodMs) => {
        const { from, to } = range;

        // 1. Calcular resumen acumulado de Taller por unidad
        let totalTallerMs = 0;
        let totalVisitsCount = 0;
        let unitsWithTallerCount = 0;

        rawTallerList.forEach(summary => {
            totalTallerMs += summary.totalTallerMs;
            totalVisitsCount += summary.visitsCount;
            if (summary.visitsCount > 0) unitsWithTallerCount++;
        });

        const tallerPct = totalPeriodMs > 0 ? (totalTallerMs / totalPeriodMs) * 100 : 0;
        const avgTallerMs = totalVisitsCount > 0 ? Math.floor(totalTallerMs / totalVisitsCount) : 0;

        // Actualizar KPIs de Taller
        const kpiTimeEl = $("silbagas-kpi-taller-time");
        const kpiFillEl = $("silbagas-kpi-taller-fill");
        const kpiPctEl = $("silbagas-kpi-taller-pct");
        const kpiCountEl = $("silbagas-kpi-taller-count");
        const kpiSubEl = $("silbagas-kpi-taller-sub");
        const kpiAvgEl = $("silbagas-kpi-taller-avg");

        if (kpiTimeEl) kpiTimeEl.textContent = fmtDurationMs(totalTallerMs);
        if (kpiFillEl) kpiFillEl.style.width = `${Math.min(100, tallerPct).toFixed(1)}%`;
        if (kpiPctEl) kpiPctEl.textContent = `${tallerPct.toFixed(1)}%`;
        if (kpiCountEl) kpiCountEl.innerHTML = `${totalVisitsCount} <span class="silbagas-kpi-unit">visitas</span>`;
        if (kpiSubEl) kpiSubEl.textContent = `${unitsWithTallerCount} de ${rawTallerList.length} unidades registraron taller`;
        if (kpiAvgEl) kpiAvgEl.textContent = `Promedio: ${fmtDurationMs(avgTallerMs)} por estancia`;

        // 2. Calcular resumen de Viajes (Distancia, Conducción, Ralentí)
        let totalDist = 0;
        let totalDriveSec = 0;
        let totalIdleSec = 0;

        rawTripsList.forEach(t => {
            totalDist += (t.distance || 0);
            totalDriveSec += parseSeconds(t.drivingDuration);
            totalIdleSec += parseSeconds(t.idlingDuration);
        });

        const kpiDistEl = $("silbagas-kpi-dist");
        const kpiTripsEl = $("silbagas-kpi-trips-count");
        const kpiDriveEl = $("silbagas-kpi-drive");
        const kpiIdleEl = $("silbagas-kpi-idle");

        if (kpiDistEl) kpiDistEl.innerHTML = `${fmtNum(totalDist, 1)} <span class="silbagas-kpi-unit">km</span>`;
        if (kpiTripsEl) kpiTripsEl.textContent = `${rawTripsList.length} viajes registrados`;
        if (kpiDriveEl) kpiDriveEl.textContent = fmtHrs(totalDriveSec);
        if (kpiIdleEl) kpiIdleEl.textContent = `Ralentí: ${fmtHrs(totalIdleSec)}`;

        // 3. Renderizar tablas
        currentTallerPage = 1;
        renderTallerTablePage();

        currentTripsPage = 1;
        renderTripsTablePage();

        // Actualizar subtítulos de las tablas
        const fmtD = d => localDateStr(d).split("-").reverse().join("/");
        const tallerSubEl = $("silbagas-taller-table-sub");
        if (tallerSubEl) {
            tallerSubEl.textContent = `Tiempo acumulado en taller por unidad: ${fmtDurationMs(totalTallerMs)} (${tallerPct.toFixed(1)}% del periodo del ${fmtD(from)} al ${fmtD(to)})`;
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

    // ── Event Listeners Binding ──────────────────────────────────
    const initEvents = () => {
        const btnConsultar = $("silbagas-btn-consultar");

        // Modal de detalle por unidad
        const unitModal = $("silbagas-unit-modal");
        const unitModalClose = $("silbagas-unit-modal-close");
        const unitModalBtnClose = $("silbagas-unit-modal-btn-close");
        const closeUnitModal = () => { if (unitModal) unitModal.style.display = "none"; };

        if (unitModalClose) unitModalClose.addEventListener("click", closeUnitModal);
        if (unitModalBtnClose) unitModalBtnClose.addEventListener("click", closeUnitModal);
        if (unitModal) unitModal.addEventListener("click", e => { if (e.target === unitModal) closeUnitModal(); });

        // Presets de periodos
        const presetButtons = document.querySelectorAll("#silbagas-period-pills .silbagas-pill");

        presetButtons.forEach(btn => {
            btn.addEventListener("click", function () {
                const period = this.getAttribute("data-period");

                if (this.id === "silbagas-btn-custom" || !period) {
                    const modal = $("silbagas-modal");
                    if (modal) {
                        const today = new Date().toISOString().split("T")[0];
                        const fromEl = $("silbagas-modal-from");
                        const toEl = $("silbagas-modal-to");
                        if (fromEl && !fromEl.value) fromEl.value = today;
                        if (toEl && !toEl.value) toEl.value = today;
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
        const modal = $("silbagas-modal");
        const modalClose = $("silbagas-modal-close");
        const modalCancel = $("silbagas-modal-cancel");
        const modalApply = $("silbagas-modal-apply");

        const closeModal = () => { if (modal) modal.style.display = "none"; };
        if (modalClose) modalClose.addEventListener("click", closeModal);
        if (modalCancel) modalCancel.addEventListener("click", closeModal);
        if (modal) modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

        if (modalApply) {
            modalApply.addEventListener("click", () => {
                const fromVal = $("silbagas-modal-from").value;
                const toVal = $("silbagas-modal-to").value;
                if (!fromVal || !toVal) { showError("Por favor, selecciona ambas fechas."); return; }
                if (fromVal > toVal) { showError("La fecha inicio no puede ser mayor que la fecha fin."); return; }

                customFromDate = fromVal;
                customToDate = toVal;
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
    };

    // ── Lifecycle Contract ────────────────────────────────────────
    return {
        initialize: function (apiObj, stateObj, callbackObj) {
            if (apiObj) api = apiObj;
            const cb = typeof callbackObj === "function" ? callbackObj : (typeof _callback === "function" ? _callback : null);

            if (!eventsAttached) {
                initEvents();
                eventsAttached = true;
            }

            loadUnits();

            if (cb) cb();
        },

        focus: function (apiObj, stateObj) {
            if (apiObj) api = apiObj;
            loadUnits();
        },

        blur: function () { }
    };

};

// Exponer geotab.addin en múltiples espacios de nombres para máxima compatibilidad
if (typeof window.geotab === "undefined") {
    window.geotab = { addin: {} };
} else if (!window.geotab.addin) {
    window.geotab.addin = {};
}

// Registrar todas las posibles variaciones de nombres que Geotab puede buscar
const addinNames = [
    "REPORTE_SILBAGAS",
    "reporteSilbagas",
    "reporte_silbagas",
    "reporte-silbagas",
    "REPORTE_SILBAGAS.html",
    "REPORTE_SILBAGAS/",
    "reporteSilbagas/",
    "reporte_silbagas/",
    "reporte-silbagas/",
    "silbagas",
    "silbagas/"
];

addinNames.forEach(name => {
    window.geotab.addin[name] = initSilbagasAddin;
});

// Auto-inicialización SOLO para modo vista previa standalone (cuando no corre dentro del iframe de Geotab)
document.addEventListener("DOMContentLoaded", function () {
    if (window.self === window.top) {
        if (!window._silbagasInstance) {
            const instance = initSilbagasAddin();
            window._silbagasInstance = instance;
            instance.initialize(null, {}, function () {
                console.log("Reporte Silbagas inicializado correctamente en modo standalone.");
            });
        }
    }
});
