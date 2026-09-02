/**
 * ===================================================================
 * DEMO.JS — Metricas de Flota: Distancia, Motor y Uso
 * Geotab Add-In | Sigue el patron de recorrido.js
 *
 * KPIs:
 *   1. Distancia total recorrida  (suma trip.distance en km)
 *   2. Horas de motor encendido   (suma trip.drivingDuration + trip.idlingDuration)
 *   3. % de tiempo en uso         (motor / horas disponibles * 100)
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

    // Pagination
    let currentPage = 1;
    const ITEMS_PER_PAGE = 15;
    let currentTableData = [];

    // Charts
    let chartDist, chartHours;

    // ── DOM refs ────────────────────────────────────────────────
    const $  = id => document.getElementById(id);
    const unitSelect      = $("demo-unit-select");
    const btnConsultar    = $("demo-btn-consultar");
    const loadingOverlay  = $("demo-loading");
    const errorToast      = $("demo-error-toast");
    const errorToastMsg   = $("demo-error-msg");

    // KPI elements
    const kpiDist         = $("demo-kpi-dist");
    const kpiHours        = $("demo-kpi-hours");
    const kpiPct          = $("demo-kpi-pct");
    const gaugeFill       = $("demo-gauge-fill");
    const gaugeLabel      = $("demo-gauge-label");
    const kpiDistSub      = $("demo-kpi-dist-sub");
    const kpiHoursSub     = $("demo-kpi-hours-sub");
    const kpiPctSub       = $("demo-kpi-pct-sub");

    // ── Diagnosticos de odometro (igual que recorrido.js) ───────
    // No usados en el calculo de KPIs, pero disponibles si se necesita odo
    const ODOMETER_DIAGS = [
        "DiagnosticOdometerAdjustmentId",
        "DiagnosticOdometerId",
        "DiagnosticOBDOdometerReaderId",
        "DiagnosticJ1939TotalVehicleDistanceId"
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
        return `${h}h ${String(m).padStart(2,"0")}m`;
    };

    const formatDateReadable = isoStr => {
        if (!isoStr) return "—";
        const d = new Date(isoStr + "T00:00:00");
        return d.toLocaleDateString("es-MX", { day:"2-digit", month:"long", year:"numeric" });
    };

    // ── Quartic ease-out counter (identico a recorrido.js) ──────
    const animateCount = (el, target, decimals = 0) => {
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

    // ── Rango de fechas (identico a recorrido.js) ────────────────
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

    // ── Agrupacion de tabla (semana / mes / etc.) ────────────────
    const groupTableData = (rawRows, grouping) => {
        if (grouping === "day") {
            return rawRows.map(r => ({ ...r, odoFin: r.odo }));
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
            if (!grouped[key]) grouped[key] = { label, dist:0, hours:0, sortKey:key };
            grouped[key].dist  += row.dist;
            grouped[key].hours += row.hours;
        });
        return Object.keys(grouped).sort((a,b)=>b.localeCompare(a)).map(k=>({
            date:  grouped[k].label,
            dist:  grouped[k].dist,
            hours: grouped[k].hours,
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
        const availSec = days * 12 * 3600;   // 12h jornada por dia

        pageData.forEach(row => {
            const pct      = availSec > 0 ? Math.min(100, (row.hours / availSec) * 100) : 0;
            const barColor = pct >= 65 ? "#00c48c" : pct >= 35 ? "#f59e0b" : "#ef4444";
            const cls      = pct >= 65 ? "high"   : pct >= 35 ? "mid"    : "low";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="demo-td-date">${row.date}</td>
                <td class="demo-td-dist">${fmtNum(row.dist,1)} <span style="font-size:.7rem;color:var(--d-muted)">km</span></td>
                <td class="demo-td-motor">${fmtHrs(row.hours)}</td>
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

        // Pagination controls
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


    // ── Graficas ApexCharts ──────────────────────────────────────
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

        // Grafica 1: Distancia diaria (barras)
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

        // Grafica 2: Horas de motor (area)
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

    // ── Cargar unidades desde Geotab ─────────────────────────────
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
    // Consulta la API Geotab igual que calculateDistance en recorrido.js,
    // pero extrae ademas drivingDuration + idlingDuration para el motor.
    // ════════════════════════════════════════════════════════════
    const calculateMetrics = () => {
        const deviceId = unitSelect.value;
        const range    = getSelectedRange();

        if (!deviceId) { showError("Por favor, selecciona una unidad."); return; }
        if (!range)    { showError("Por favor, selecciona un rango de fechas valido."); return; }

        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        const { from, to } = range;
        const diffTime = Math.abs(to - from);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const historyDays = Math.max(diffDays, 1);

        // Chunking identico a recorrido.js (lotes de 30 dias)
        const chunks = [];
        let chunkStart = new Date(from);
        while (chunkStart < to) {
            let chunkEnd = new Date(chunkStart);
            chunkEnd.setDate(chunkEnd.getDate() + 30);
            if (chunkEnd > to) chunkEnd = new Date(to);
            chunks.push({ start: chunkStart.toISOString(), end: chunkEnd.toISOString() });
            chunkStart = new Date(chunkEnd);
        }

        const calls = chunks.map(chunk => [
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

        api.multiCall(calls, results => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            try {
                // Unir todos los lotes y eliminar duplicados (igual que recorrido.js)
                const tripsRaw = results.flat().filter(t => t);
                const tripsIdSet = new Set();
                const trips = [];
                tripsRaw.forEach(t => {
                    if (!tripsIdSet.has(t.id)) {
                        tripsIdSet.add(t.id);
                        trips.push(t);
                    }
                });

                // ── Inicializar acumuladores diarios ─────────────────────
                const dailyDist  = {};   // date -> km (identico a dailyDistanceData en recorrido.js)
                const dailyHours = {};   // date -> segundos de motor encendido

                for (let i = 0; i < historyDays; i++) {
                    const d = new Date(to); d.setDate(d.getDate() - i);
                    const k = localDateStr(d);
                    dailyDist[k]  = 0;
                    dailyHours[k] = 0;
                }

                // ── Procesar cada trip ───────────────────────────────────
                let totalDistKm    = 0;
                let totalMotorSec  = 0;

                trips.forEach(trip => {
                    const dStr  = localDateStr(new Date(trip.start));

                    // KPI 1: Distancia — trip.distance (km), igual que recorrido.js
                    const distKm = trip.distance || 0;
                    totalDistKm += distKm;

                    // KPI 2: Horas de motor — drivingDuration + idlingDuration (seg)
                    // Geotab: drivingDuration = tiempo en movimiento
                    //         idlingDuration  = motor encendido, veh detenido
                    const motorSec = (trip.drivingDuration || 0) + (trip.idlingDuration || 0);
                    totalMotorSec += motorSec;

                    if (dailyDist[dStr] !== undefined) {
                        dailyDist[dStr]  += distKm;
                        dailyHours[dStr] += motorSec;
                    }
                });

                // KPI 3: % de tiempo en uso
                // Disponible = 1 vehiculo x dias del periodo x 12h jornada laboral
                const availableSec = historyDays * 12 * 3600;
                const usagePct     = availableSec > 0
                    ? Math.min(100, (totalMotorSec / availableSec) * 100)
                    : 0;

                // ── Actualizar KPIs ──────────────────────────────────────
                // KPI 1: Distancia
                animateCount(kpiDist, totalDistKm, 1);
                kpiDistSub.textContent = historyDays + " dia" + (historyDays > 1 ? "s" : "") + " · " + trips.length + " viajes";

                // KPI 2: Horas motor
                animateCount(kpiHours, totalMotorSec / 3600, 1);
                kpiHoursSub.textContent = fmtHrs(totalMotorSec) + " acumuladas";

                // KPI 3: % uso
                animateCount(kpiPct, usagePct, 1);
                kpiPctSub.textContent = "De " + fmtNum(availableSec / 3600, 0) + " hrs disponibles";

                // Gauge animada
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

                // ── Tabla por dia ────────────────────────────────────────
                const sortedDatesDesc = Object.keys(dailyDist).sort((a,b) => b.localeCompare(a));
                currentTableData = sortedDatesDesc.map(date => ({
                    date,
                    dist:  dailyDist[date],
                    hours: dailyHours[date]
                }));
                currentPage = 1;
                renderTablePage();

                // ── Periodo label ────────────────────────────────────────
                const tableSubEl = $("demo-table-sub");
                if (tableSubEl) {
                    const fmtD = d => localDateStr(d).split("-").reverse().join("/");
                    tableSubEl.textContent = fmtD(from) + " al " + fmtD(to);
                }

                // ── Guardar para re-agrupacion ───────────────────────────
                lastDailyDist  = dailyDist;
                lastDailyHours = dailyHours;

                // ── Graficas ─────────────────────────────────────────────
                renderCharts(dailyDist, dailyHours);

                // Mostrar resultado
                const resultContainer = $("demo-result-container");
                if (resultContainer) {
                    resultContainer.style.display = "block";
                    setTimeout(() => resultContainer.scrollIntoView({ behavior:"smooth", block:"nearest" }), 100);
                }

                if (window.lucide) lucide.createIcons();

            } catch (err) {
                console.error("Error procesando datos:", err);
                showError("Error al procesar los datos de la API.");
            }

        }, err => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("MultiCall Error:", err);
            showError("Error de conexion con Geotab.");
        });
    };


    // ── Lifecycle de Geotab Add-In ────────────────────────────────
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            // ── Selector de periodo ──────────────────────────────
            const presetButtons = document.querySelectorAll("#demo-period-pills .demo-pill");

            presetButtons.forEach(btn => {
                btn.addEventListener("click", function () {
                    const period = this.getAttribute("data-period");

                    if (this.id === "demo-btn-custom" || !period) {
                        // Abrir modal rango personalizado
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

                    // Agrupacion automatica segun periodo
                    dailyGrouping = (period === "semester" || period === "trimester" || period === "bimester")
                        ? "month" : "day";

                    const selGroup = $("demo-group-select");
                    if (selGroup) selGroup.value = dailyGrouping;

                    calculateMetrics();
                });
            });

            // ── Boton consultar ──────────────────────────────────
            if (btnConsultar) btnConsultar.addEventListener("click", calculateMetrics);

            // ── Modal de rango personalizado ─────────────────────
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

            // ── Selector agrupacion tabla/grafica ────────────────
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

            // ── Paginacion ───────────────────────────────────────
            const btnPrev = $("demo-btn-prev");
            const btnNext = $("demo-btn-next");

            if (btnPrev) btnPrev.addEventListener("click", () => {
                if (currentPage > 1) { currentPage--; renderTablePage(); }
            });

            if (btnNext) btnNext.addEventListener("click", () => {
                const totalPages = Math.ceil(currentTableData.length / ITEMS_PER_PAGE);
                if (currentPage < totalPages) { currentPage++; renderTablePage(); }
            });

            // ── Inicializar Lucide ───────────────────────────────
            if (window.lucide) lucide.createIcons();

            // ── Cargar unidades ──────────────────────────────────
            loadUnits();

            callback();
        },

        focus: function (_api, state) {
            api = _api;
            loadUnits();
        },

        blur: function () {}
    };

}; // fin geotab.addin.demo
