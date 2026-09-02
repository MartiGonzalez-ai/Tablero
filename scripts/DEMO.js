/**
 * ===================================================================
 * DEMO.JS — Métricas de Flota: Distancia, Horas de Motor y Uso
 * Geotab Add-In | ESM Logic
 *
 * Fuentes de datos de Geotab API:
 *   1. Objeto Trip (fromDate, toDate):
 *      - distance: distancia recorrida en el viaje (km)
 *      - drivingDuration: tiempo en conducción (segundos)
 *      - idlingDuration: ralentí al final del viaje (segundos)
 *      - stopDuration: tiempo detenido (segundos)
 *      - odometer: lectura de odómetro al cierre del viaje
 *      - engineHours: horas de motor registradas al cierre del viaje
 *
 *   2. Objeto StatusData (DiagnosticOdometerId, DiagnosticEngineHoursId):
 *      - Lecturas en tiempo real de odómetro y horas de motor para vehículos
 *        que no han completado un viaje o como anclaje base.
 * ===================================================================
 */

"use strict";

geotab.addin.demo = function () {

    // ── API & Estado ────────────────────────────────────────────
    let api;
    let units = [];
    let selectedPeriod = "month";
    let customFromDate = null;
    let customToDate   = null;
    let lastDailyDist  = {};
    let lastDailyHours = {};
    let dailyGrouping  = "day";

    // Pagination State
    let currentPage = 1;
    const ITEMS_PER_PAGE = 15;
    let currentTableData = [];

    // Trips Table Pagination State
    let currentTripsPage = 1;
    const TRIPS_PER_PAGE = 10;
    let rawTripsList = [];

    // Charts State
    let chartDist, chartHours;

    // ── DOM References ──────────────────────────────────────────
    const $  = id => document.getElementById(id);
    const unitSelect      = $("demo-unit-select");
    const btnConsultar    = $("demo-btn-consultar");
    const loadingOverlay  = $("demo-loading");
    const errorToast      = $("demo-error-toast");
    const errorToastMsg   = $("demo-error-msg");

    // KPI Elements
    const kpiDist         = $("demo-kpi-dist");
    const kpiHours        = $("demo-kpi-hours");
    const kpiIdling       = $("demo-kpi-idling");
    const kpiPct          = $("demo-kpi-pct");
    const gaugeFill       = $("demo-gauge-fill");
    const gaugeLabel      = $("demo-gauge-label");
    const kpiDistSub      = $("demo-kpi-dist-sub");
    const kpiHoursSub     = $("demo-kpi-hours-sub");
    const kpiIdlingSub    = $("demo-kpi-idling-sub");
    const kpiPctSub       = $("demo-kpi-pct-sub");

    // ── Diagnostic IDs de Geotab para StatusData ────────────────
    const ODOMETER_DIAGNOSTICS = [
        "DiagnosticOdometerAdjustmentId",
        "DiagnosticOdometerId",
        "DiagnosticOBDOdometerReaderId",
        "DiagnosticJ1939TotalVehicleDistanceId"
    ];

    const ENGINE_HOURS_DIAGNOSTICS = [
        "DiagnosticEngineHoursId",
        "DiagnosticEngineHoursAdjustmentId"
    ];

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
        n.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

    const fmtHrs = sec => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}h ${String(m).padStart(2, "0")}m`;
    };

    const formatDateReadable = isoStr => {
        if (!isoStr) return "—";
        const d = new Date(isoStr + "T00:00:00");
        return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
    };

    // ── Quartic ease-out counter ────────────────────────────────
    const animateCount = (el, target, decimals = 0) => {
        if (!el) return;
        const duration = 1200;
        const start    = performance.now();
        const startVal = parseFloat(el.textContent.replace(/[^\d.-]/g, "")) || 0;

        const step = now => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            const current = startVal + (target - startVal) * eased;
            el.textContent = decimals > 0
                ? fmtNum(current, decimals)
                : Math.round(current).toLocaleString("es-MX");
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
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

    // ── Agrupación para la tabla (Día, Semana, Mes) ─────────────
    const groupTableData = (rawRows, grouping) => {
        if (grouping === "day") {
            return rawRows.map(r => ({ ...r }));
        }
        const grouped = {};
        rawRows.forEach(row => {
            const d = new Date(row.date + "T12:00:00");
            let key, label;
            if (grouping === "week") {
                const day  = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const mon  = new Date(d); mon.setDate(diff);
                key   = mon.getFullYear()+"-"+String(mon.getMonth()+1).padStart(2,"0")+"-"+String(mon.getDate()).padStart(2,"0");
                label = "Semana "+key;
            } else if (grouping === "month") {
                key   = row.date.substring(0,7);
                const lbl = d.toLocaleDateString("es-MX",{month:"long",year:"numeric"});
                label = lbl.charAt(0).toUpperCase()+lbl.slice(1);
            } else {
                key = row.date; label = row.date;
            }
            if (!grouped[key]) grouped[key] = { label, dist:0, hours:0, idlingSec:0, stopSec:0, sortKey:key };
            grouped[key].dist      += row.dist;
            grouped[key].hours     += row.hours;
            grouped[key].idlingSec += row.idlingSec || 0;
            grouped[key].stopSec   += row.stopSec   || 0;
        });
        return Object.keys(grouped).sort((a,b)=>b.localeCompare(a)).map(k=>({
            date:      grouped[k].label,
            dist:      grouped[k].dist,
            hours:     grouped[k].hours,
            idlingSec: grouped[k].idlingSec,
            stopSec:   grouped[k].stopSec
        }));
    };

    // ── Render tabla paginada ────────────────────────────────────
    const renderTablePage = () => {
        const tbody = $("demo-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";

        const displayData = groupTableData(currentTableData, dailyGrouping);
        const totalItems  = displayData.length;
        const totalPages  = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const start   = (currentPage - 1) * ITEMS_PER_PAGE;
        const end     = Math.min(start + ITEMS_PER_PAGE, totalItems);
        const pageData = displayData.slice(start, end);

        const range = getSelectedRange();
        const days  = range ? Math.max(1, Math.ceil((range.to - range.from) / 86400000)) : 1;
        const availSec = days * 12 * 3600;   // 12h jornada por día

        pageData.forEach(row => {
            const pct      = availSec > 0 ? Math.min(100, (row.hours / availSec) * 100) : 0;
            const barColor = pct >= 65 ? "#00c48c" : pct >= 35 ? "#f59e0b" : "#ef4444";
            const cls      = pct >= 65 ? "high"   : pct >= 35 ? "mid"    : "low";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="demo-td-date">${row.date}</td>
                <td class="demo-td-dist" style="text-align:right;">${fmtNum(row.dist,1)} <span style="font-size:.7rem;color:var(--d-muted)">km</span></td>
                <td class="demo-td-motor" style="text-align:right;">${fmtHrs(row.hours)}</td>
                <td class="demo-td-motor" style="text-align:right;color:#a855f7;">${fmtHrs(row.idlingSec || 0)}</td>
                <td>
                    <div class="demo-spark-wrap">
                        <div class="demo-spark-bg">
                            <div class="demo-spark-fill" style="width:${pct}%;background:${barColor}"></div>
                        </div>
                        <span class="demo-badge ${cls}">${fmtNum(pct,1)}%</span>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });

        // Controles de paginación
        const paginationEl = $("demo-pagination");
        const btnPrev  = $("demo-btn-prev");
        const btnNext  = $("demo-btn-next");
        const pageInd  = $("demo-page-indicator");
        const pInfo    = $("demo-pagination-info");

        if (paginationEl) paginationEl.style.display = totalItems > 0 ? "flex" : "none";
        if (pInfo)    pInfo.textContent    = `Mostrando ${start+1}–${end} de ${totalItems} registros`;
        if (pageInd)  pageInd.textContent  = `Página ${currentPage} de ${totalPages}`;
        if (btnPrev)  btnPrev.disabled     = currentPage <= 1;
        if (btnNext)  btnNext.disabled     = currentPage >= totalPages;
    };

    // ── Render tabla paginada de viajes detallados ────────────────
    const renderTripsTablePage = () => {
        const tbody = $("demo-tbody-trips");
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
            tr.innerHTML = `<td colspan="6" style="text-align:center;color:var(--d-muted);padding:1.5rem;">No hay viajes registrados en el periodo seleccionado.</td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach(trip => {
                const startDateStr = new Date(trip.start).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
                const stopDateStr  = trip.stop ? new Date(trip.stop).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "En curso";
                const distKm       = trip.distance || 0;
                const drivingSec   = trip.drivingDuration || 0;
                const idlingSec    = trip.idlingDuration  || 0;
                const stopSec      = trip.stopDuration    || 0;
                const motorSec     = drivingSec + idlingSec;

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td class="demo-td-date">${startDateStr}</td>
                    <td class="demo-td-date">${stopDateStr}</td>
                    <td class="demo-td-dist" style="text-align:right;">${fmtNum(distKm, 1)} <span style="font-size:.7rem;color:var(--d-muted)">km</span></td>
                    <td class="demo-td-motor" style="text-align:right;">${fmtHrs(motorSec)}</td>
                    <td class="demo-td-motor" style="text-align:right;color:#a855f7;">${fmtHrs(idlingSec)}</td>
                    <td class="demo-td-motor" style="text-align:right;color:var(--d-muted);">${fmtHrs(stopSec)}</td>`;
                tbody.appendChild(tr);
            });
        }

        const paginationEl = $("demo-trips-pagination");
        const btnPrev  = $("demo-btn-trips-prev");
        const btnNext  = $("demo-btn-trips-next");
        const pageInd  = $("demo-trips-page-indicator");
        const pInfo    = $("demo-trips-pagination-info");

        if (paginationEl) paginationEl.style.display = totalItems > 0 ? "flex" : "none";
        if (pInfo)   pInfo.textContent   = `Mostrando ${totalItems > 0 ? start+1 : 0}–${end} de ${totalItems} viajes`;
        if (pageInd) pageInd.textContent = `Página ${currentTripsPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled    = currentTripsPage <= 1;
        if (btnNext) btnNext.disabled    = currentTripsPage >= totalPages;
    };

    // ── Gráficas ApexCharts ──────────────────────────────────────
    const renderCharts = (dailyDist, dailyHours) => {
        if (!window.ApexCharts) return;

        const sortedDates = Object.keys(dailyDist).sort();
        const cats = sortedDates.map(d => {
            const dt = new Date(d + "T12:00:00");
            if (dailyGrouping === "day") {
                const lbl = dt.toLocaleDateString("es-MX", { day:"2-digit", month:"short" });
                return lbl.charAt(0).toUpperCase() + lbl.slice(1);
            }
            return d;
        });

        const distData  = sortedDates.map(d => parseFloat(dailyDist[d].toFixed(1)));
        const hoursData = sortedDates.map(d => parseFloat((dailyHours[d] / 3600).toFixed(2)));

        const commonChart = {
            toolbar: { show: false },
            fontFamily: "'Inter', sans-serif",
            foreColor:  "#94a3b8",
            background: "transparent",
            animations: { enabled: true, easing: "easeinout", speed: 700 }
        };
        const commonXaxis = {
            categories: cats,
            labels: { style:{ colors:"#64748b", fontSize:"10px" }, rotate: -35 },
            axisBorder: { show: false },
            axisTicks:  { show: false }
        };
        const commonGrid = { borderColor:"rgba(255,255,255,0.05)", strokeDashArray: 4 };

        // Gráfica 1: Distancia diaria (barras)
        if (chartDist) chartDist.destroy();
        const elDist = document.querySelector("#demo-chart-dist");
        if (elDist) {
            chartDist = new ApexCharts(elDist, {
                chart:  { ...commonChart, type:"bar", height:220 },
                series: [{ name:"Distancia (km)", data: distData }],
                colors: ["#00b1e1"],
                plotOptions: { bar:{ borderRadius:4, columnWidth:"55%" } },
                dataLabels: {
                    enabled: dailyGrouping !== "day",
                    formatter: v => fmtNum(v,1),
                    style: { fontSize:"10px", colors:["#fff"] }
                },
                xaxis: commonXaxis,
                yaxis: { labels:{ style:{ colors:"#64748b", fontSize:"10px" }, formatter: v => v.toFixed(0)+" km" } },
                grid: commonGrid,
                fill: { type:"gradient", gradient:{ shade:"dark", type:"vertical", gradientToColors:["#003480"], stops:[0,100] } },
                tooltip: { theme:"dark", y:{ formatter: v => fmtNum(v,1)+" km" } }
            });
            chartDist.render();
        }

        // Gráfica 2: Horas de motor (área)
        if (chartHours) chartHours.destroy();
        const elHours = document.querySelector("#demo-chart-hours");
        if (elHours) {
            chartHours = new ApexCharts(elHours, {
                chart:  { ...commonChart, type:"area", height:220, zoom:{ enabled:false } },
                series: [{ name:"Motor encendido (hrs)", data: hoursData }],
                colors: ["#00c48c"],
                stroke: { curve:"smooth", width:2.5 },
                fill:   { type:"gradient", gradient:{ opacityFrom:0.30, opacityTo:0.02 } },
                dataLabels: {
                    enabled: dailyGrouping !== "day",
                    formatter: v => v.toFixed(1)+"h",
                    style: { fontSize:"10px", colors:["#00c48c"] },
                    background: { enabled:true, foreColor:"#fff", borderRadius:4, borderWidth:0, opacity:0.85 }
                },
                markers: { size: dailyGrouping === "day" ? 0 : 4, colors:["#fff"], strokeColors:"#00c48c", strokeWidth:2 },
                xaxis: commonXaxis,
                yaxis: { labels:{ style:{ colors:"#64748b", fontSize:"10px" }, formatter: v => v.toFixed(1)+"h" } },
                grid: commonGrid,
                tooltip: { theme:"dark", y:{ formatter: v => fmtHrs(v * 3600) } }
            });
            chartHours.render();
        }
    };

    // ── Cargar dispositivos desde Geotab ─────────────────────────
    const loadUnits = () => {
        api.call("Get", { typeName: "Device" }, result => {
            units = result || [];
            unitSelect.innerHTML = '<option value="" disabled selected>Selecciona una unidad...</option>';
            units.sort((a,b) => a.name.localeCompare(b.name));
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
    // CORE: calculateMetrics
    // Realiza llamadas a StatusData (para obtener odómetro y horas de motor actuales)
    // y llamadas a Trip (para extraer distance, drivingDuration, idlingDuration,
    // stopDuration, odometer y engineHours).
    // ════════════════════════════════════════════════════════════
    const calculateMetrics = () => {
        const deviceId = unitSelect.value;
        const range    = getSelectedRange();

        if (!deviceId) { showError("Por favor, selecciona una unidad."); return; }
        if (!range)    { showError("Por favor, selecciona un rango de fechas válido."); return; }

        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        const { from, to } = range;
        const diffTime = Math.abs(to - from);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const historyDays = Math.max(diffDays, 1);

        const searchToDateToken   = to.toISOString();
        const searchFromDateToken = from.toISOString();

        // Call A: StatusData para Odómetro actual (DiagnosticOdometerId)
        const calls = ODOMETER_DIAGNOSTICS.map(diagId => [
            "Get",
            {
                typeName: "StatusData",
                search: {
                    deviceSearch:     { id: deviceId },
                    diagnosticSearch: { id: diagId },
                    toDate:           searchToDateToken,
                    resultsLimit:     1,
                    applyLatest:      true
                }
            }
        ]);

        // Call B: StatusData para Horas de Motor actuales (DiagnosticEngineHoursId)
        ENGINE_HOURS_DIAGNOSTICS.forEach(diagId => {
            calls.push([
                "Get",
                {
                    typeName: "StatusData",
                    search: {
                        deviceSearch:     { id: deviceId },
                        diagnosticSearch: { id: diagId },
                        toDate:           searchToDateToken,
                        resultsLimit:     1,
                        applyLatest:      true
                    }
                }
            ]);
        });

        // Call C: Objeto Trip por lotes (30 días)
        const chunks = [];
        let chunkStart = new Date(from);
        while (chunkStart < to) {
            let chunkEnd = new Date(chunkStart);
            chunkEnd.setDate(chunkEnd.getDate() + 30);
            if (chunkEnd > to) chunkEnd = new Date(to);
            chunks.push({ start: chunkStart.toISOString(), end: chunkEnd.toISOString() });
            chunkStart = new Date(chunkEnd);
        }

        chunks.forEach(chunk => {
            calls.push([
                "Get",
                {
                    typeName: "Trip",
                    search: {
                        deviceSearch: { id: deviceId },
                        fromDate:     chunk.start,
                        toDate:       chunk.end
                    }
                }
            ]);
        });

        api.multiCall(calls, results => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            try {
                const numStatusCalls = ODOMETER_DIAGNOSTICS.length + ENGINE_HOURS_DIAGNOSTICS.length;

                // 1. Extraer StatusData de Odómetro y Horas de Motor
                const statusResults = results.slice(0, numStatusCalls).flat().filter(r => r && r.data !== undefined);
                
                let latestOdoData = null;
                let latestEngineHoursData = null;

                statusResults.forEach(sr => {
                    const diagId = sr.diagnostic ? sr.diagnostic.id : "";
                    if (ODOMETER_DIAGNOSTICS.includes(diagId) || diagId.toLowerCase().includes("odometer")) {
                        if (!latestOdoData || new Date(sr.dateTime) > new Date(latestOdoData.dateTime)) {
                            latestOdoData = sr;
                        }
                    }
                    if (ENGINE_HOURS_DIAGNOSTICS.includes(diagId) || diagId.toLowerCase().includes("enginehours")) {
                        if (!latestEngineHoursData || new Date(sr.dateTime) > new Date(latestEngineHoursData.dateTime)) {
                            latestEngineHoursData = sr;
                        }
                    }
                });

                // 2. Extraer Objeto Trip
                const tripsRaw = results.slice(numStatusCalls).flat().filter(t => t);
                const tripsIdSet = new Set();
                const trips = [];
                tripsRaw.forEach(t => {
                    if (!tripsIdSet.has(t.id)) {
                        tripsIdSet.add(t.id);
                        trips.push(t);
                    }
                });

                // Ordenar del más reciente al más antiguo
                trips.sort((a, b) => new Date(b.stop || b.start) - new Date(a.stop || a.start));

                // ── Inicializar acumuladores diarios ─────────────────────
                const dailyDist      = {};   // date -> km
                const dailyHours     = {};   // date -> segundos de motor encendido
                const dailyIdling    = {};   // date -> ralentí (idlingDuration)
                const dailyStop      = {};   // date -> tiempo detenido (stopDuration)

                for (let i = 0; i < historyDays; i++) {
                    const d = new Date(to); d.setDate(d.getDate() - i);
                    const k = localDateStr(d);
                    dailyDist[k]   = 0;
                    dailyHours[k]  = 0;
                    dailyIdling[k] = 0;
                    dailyStop[k]   = 0;
                }

                // ── Procesar Objeto Trip ─────────────────────────────────
                let totalDistKm   = 0;
                let totalMotorSec = 0;
                let totalIdlingSec = 0;
                let totalStopSec   = 0;

                trips.forEach(trip => {
                    const dStr = localDateStr(new Date(trip.start));

                    // Distancia (trip.distance en km)
                    const distKm = trip.distance || 0;
                    totalDistKm += distKm;

                    // Duraciones según especificación del objeto Trip:
                    // drivingDuration: tiempo en movimiento
                    // idlingDuration: ralentí al final del viaje
                    // stopDuration: tiempo detenido
                    const drivingSec = trip.drivingDuration || 0;
                    const idlingSec  = trip.idlingDuration  || 0;
                    const stopSec    = trip.stopDuration    || 0;

                    // Tiempo de motor encendido = conducción + ralentí
                    const motorSec   = drivingSec + idlingSec;

                    totalMotorSec  += motorSec;
                    totalIdlingSec += idlingSec;
                    totalStopSec   += stopSec;

                    if (dailyDist[dStr] !== undefined) {
                        dailyDist[dStr]   += distKm;
                        dailyHours[dStr]  += motorSec;
                        dailyIdling[dStr] += idlingSec;
                        dailyStop[dStr]   += stopSec;
                    }
                });

                // KPI 4: % de tiempo en uso
                // Ventana disponible = 1 vehículo x días x 12h de jornada
                const availableSec = historyDays * 12 * 3600;
                const usagePct     = availableSec > 0
                    ? Math.min(100, (totalMotorSec / availableSec) * 100)
                    : 0;

                // ── Actualizar KPIs ──────────────────────────────────────
                // KPI 1: Distancia total
                animateCount(kpiDist, totalDistKm, 1);
                kpiDistSub.textContent = historyDays + " día" + (historyDays > 1 ? "s" : "") + " · " + trips.length + " viajes registrados";

                // KPI 2: Horas de motor encendido
                animateCount(kpiHours, totalMotorSec / 3600, 1);
                kpiHoursSub.textContent = fmtHrs(totalMotorSec) + " acumuladas (" + fmtHrs(totalIdlingSec) + " ralentí)";

                // KPI 3: Tiempo en Ralentí
                animateCount(kpiIdling, totalIdlingSec / 3600, 1);
                if (kpiIdlingSub) kpiIdlingSub.textContent = fmtHrs(totalIdlingSec) + " en " + trips.length + " viajes";

                // KPI 4: % de tiempo en uso
                animateCount(kpiPct, usagePct, 1);
                kpiPctSub.textContent = "De " + fmtNum(availableSec / 3600, 0) + " hrs disponibles";

                // Gauge animado
                setTimeout(() => {
                    if (gaugeFill) {
                        gaugeFill.style.width = usagePct + "%";
                        gaugeFill.style.background = usagePct >= 65
                            ? "linear-gradient(90deg,#00c48c,#00a070)"
                            : usagePct >= 35
                                ? "linear-gradient(90deg,#f59e0b,#e08800)"
                                : "linear-gradient(90deg,#ef4444,#c0392b)";
                    }
                    if (gaugeLabel) gaugeLabel.textContent = fmtNum(usagePct, 1) + "%";
                }, 60);

                // ── Tabla por día ────────────────────────────────────────
                const sortedDatesDesc = Object.keys(dailyDist).sort((a,b) => b.localeCompare(a));
                currentTableData = sortedDatesDesc.map(date => ({
                    date,
                    dist:      dailyDist[date],
                    hours:     dailyHours[date],
                    idlingSec: dailyIdling[date],
                    stopSec:   dailyStop[date]
                }));
                currentPage = 1;
                renderTablePage();

                // ── Tabla de Viajes Detallados ───────────────────────────
                rawTripsList = trips;
                currentTripsPage = 1;
                renderTripsTablePage();

                // ── Etiqueta del periodo ──────────────────────────────────
                const tableSubEl = $("demo-table-sub");
                if (tableSubEl) {
                    const fmtD = d => localDateStr(d).split("-").reverse().join("/");
                    tableSubEl.textContent = fmtD(from) + " al " + fmtD(to);
                }

                const tripsTableSubEl = $("demo-trips-table-sub");
                if (tripsTableSubEl) {
                    const fmtD = d => localDateStr(d).split("-").reverse().join("/");
                    tripsTableSubEl.textContent = trips.length + " viajes registrados del " + fmtD(from) + " al " + fmtD(to);
                }

                // ── Guardar datos para reagrupar ─────────────────────────
                lastDailyDist  = dailyDist;
                lastDailyHours = dailyHours;

                // ── Renderizar gráficas ──────────────────────────────────
                renderCharts(dailyDist, dailyHours);

                // Mostrar contenedor de resultados
                const resultContainer = $("demo-result-container");
                if (resultContainer) {
                    resultContainer.style.display = "block";
                    setTimeout(() => resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
                }

                if (window.lucide) lucide.createIcons();

            } catch (err) {
                console.error("Error procesando datos de Geotab:", err);
                showError("Error al procesar los viajes y diagnósticos de la API.");
            }

        }, err => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("MultiCall Error:", err);
            showError("Error de conexión con Geotab.");
        });
    };

    // ── Lifecycle Add-In ──────────────────────────────────────────
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            // Presets de periodos
            const presetButtons = document.querySelectorAll("#demo-period-pills .demo-pill");

            presetButtons.forEach(btn => {
                btn.addEventListener("click", function () {
                    const period = this.getAttribute("data-period");

                    if (this.id === "demo-btn-custom" || !period) {
                        const modal = $("demo-modal");
                        if (modal) {
                            const today  = new Date().toISOString().split("T")[0];
                            const fromEl = $("demo-modal-from");
                            const toEl   = $("demo-modal-to");
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

                    dailyGrouping = (period === "semester" || period === "trimester" || period === "bimester")
                        ? "month" : "day";

                    const selGroup = $("demo-group-select");
                    if (selGroup) selGroup.value = dailyGrouping;

                    calculateMetrics();
                });
            });

            if (btnConsultar) btnConsultar.addEventListener("click", calculateMetrics);

            // Modal Rango Personalizado
            const modal       = $("demo-modal");
            const modalClose  = $("demo-modal-close");
            const modalCancel = $("demo-modal-cancel");
            const modalApply  = $("demo-modal-apply");

            const closeModal = () => { if (modal) modal.style.display = "none"; };
            if (modalClose)  modalClose.addEventListener("click",  closeModal);
            if (modalCancel) modalCancel.addEventListener("click", closeModal);
            if (modal) modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

            if (modalApply) {
                modalApply.addEventListener("click", () => {
                    const fromVal = $("demo-modal-from").value;
                    const toVal   = $("demo-modal-to").value;
                    if (!fromVal || !toVal) { showError("Por favor, selecciona ambas fechas."); return; }
                    if (fromVal > toVal)    { showError("La fecha inicio no puede ser mayor que la fecha fin."); return; }

                    customFromDate = fromVal;
                    customToDate   = toVal;
                    selectedPeriod = "custom";

                    presetButtons.forEach(b => b.classList.remove("active"));
                    const btnCustom = $("demo-btn-custom");
                    if (btnCustom) btnCustom.classList.add("active");

                    closeModal();
                    calculateMetrics();
                });
            }

            // Agrupación de tabla / gráficas
            const groupSelect = $("demo-group-select");
            if (groupSelect) {
                groupSelect.addEventListener("change", function () {
                    dailyGrouping = this.value;
                    currentPage   = 1;
                    if (Object.keys(lastDailyDist).length > 0) {
                        renderCharts(lastDailyDist, lastDailyHours);
                        renderTablePage();
                    }
                });
            }

            // Paginación resumen diario
            const btnPrev = $("demo-btn-prev");
            const btnNext = $("demo-btn-next");

            if (btnPrev) btnPrev.addEventListener("click", () => {
                if (currentPage > 1) { currentPage--; renderTablePage(); }
            });

            if (btnNext) btnNext.addEventListener("click", () => {
                const totalPages = Math.ceil(currentTableData.length / ITEMS_PER_PAGE);
                if (currentPage < totalPages) { currentPage++; renderTablePage(); }
            });

            // Paginación viajes detallados
            const btnTripsPrev = $("demo-btn-trips-prev");
            const btnTripsNext = $("demo-btn-trips-next");

            if (btnTripsPrev) btnTripsPrev.addEventListener("click", () => {
                if (currentTripsPage > 1) { currentTripsPage--; renderTripsTablePage(); }
            });

            if (btnTripsNext) btnTripsNext.addEventListener("click", () => {
                const totalPages = Math.ceil(rawTripsList.length / TRIPS_PER_PAGE);
                if (currentTripsPage < totalPages) { currentTripsPage++; renderTripsTablePage(); }
            });

            if (window.lucide) lucide.createIcons();

            loadUnits();

            callback();
        },

        focus: function (_api, state) {
            api = _api;
            loadUnits();
        },

        blur: function () {}
    };

};
