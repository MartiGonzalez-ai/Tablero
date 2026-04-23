/**
 * @file alarmas.js
 * @description Dashboard de Alarmas y Excepciones para Geotab
 */

"use strict";

geotab.addin.alarmas = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    let selectedUnitId = "all";

    // Data storage
    let exceptions = [];
    let rulesMap = {};
    let deviceMap = {};

    // Chart instances
    let chartRuleDist = null;
    let chartTrend = null;
    let chartRules = null;

    // View State
    let currentView = "main"; // "main" or "details"

    // Configuration: Alarm Grouping
    const ALARM_GROUPS = {
        "Aceleración brusca": "Aceleración Brusca",
        "Aceleración brusca (nuevo)": "Aceleración Brusca",
        "Colisión grave": "Colisión",
        "Colisión leve": "Colisión",
        "Posible colisión (heredado)": "Colisión",
        "Exceso de velocidad": "Exceso de velocidad",
        "Exceso de velocidad (nuevo)": "Exceso de velocidad",
        "Velocidad mayor a 80 km/h": "Exceso de velocidad",
        "Frenado brusco": "Frenado Brusco",
        "Frenado brusco (nuevo)": "Frenado Brusco",
        "Giro brusco": "Giro Brusco",
        "Giro brusco (nuevo)": "Giro Brusco"
    };

    const getGroupName = (ruleName) => {
        return ALARM_GROUPS[ruleName] || ruleName;
    };

    // Aggressive Behavior Rules (requested by USER)
    const AGGRESSIVE_RULES_MAP = {
        "harsh braking (new)": "Frenado Brusco",
        "harsh braking": "Frenado Brusco",
        "frenado brusco (nuevo)": "Frenado Brusco",
        "frenado brusco": "Frenado Brusco",
        "harsh acceleration (new)": "Aceleración Brusca",
        "hard acceleration": "Aceleración Brusca",
        "aceleración brusca (nuevo)": "Aceleración Brusca",
        "aceleración brusca": "Aceleración Brusca",
        "harsh cornering (new)": "Giro Brusco",
        "harsh cornering": "Giro Brusco",
        "giro brusco (nuevo)": "Giro Brusco",
        "giro brusco": "Giro Brusco"
    };

    const AGGRESSIVE_RULES = Object.keys(AGGRESSIVE_RULES_MAP);

    const SPEEDING_RULES = [
        "Velocidad mayor a 80km/h", "Exceso de velocidad", "Exceso de velocidad (nuevo)",
        "Speeding", "Speeding (New)"
    ];

    // DOM Elements
    let btnRefresh, lastUpdatedEl, loadingOverlay, errorToast, errorToastMsg;

    // ─── Helpers ─────────────────────────────────────────────────────────────

    const getDateRange = () => {
        if (isCustomRange && customFromDate && customToDate) {
            return { fromDate: customFromDate, toDate: customToDate };
        }
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - selectedDays);
        return { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() };
    };

    const showError = (msg) => {
        errorToastMsg.textContent = msg;
        errorToast.style.display = "flex";
        setTimeout(() => { errorToast.style.display = "none"; }, 5000);
    };

    // ─── Charts Initialization ──────────────────────────────────────────────

    const initCharts = () => {
        // Rule Distribution (Donut)
        const distOptions = {
            series: [],
            labels: [],
            chart: {
                type: 'donut',
                height: 450, // Increased for focus
                fontFamily: 'Inter, sans-serif'
            },
            colors: ['#e11d48', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#64748b'],
            plotOptions: {
                pie: {
                    donut: {
                        size: '72%',
                        labels: {
                            show: true,
                            name: { show: true, fontSize: '18px', fontWeight: 600, color: '#64748b', offsetY: -10 },
                            value: { show: true, fontSize: '24px', fontWeight: 800, color: '#0f172a', offsetY: 10, formatter: v => v },
                            total: {
                                show: true,
                                label: 'Total Alarmas',
                                fontSize: '14px',
                                fontWeight: 600,
                                color: '#94a3b8',
                                formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0)
                            }
                        }
                    }
                }
            },
            stroke: { show: true, width: 2, colors: ['#fff'] },
            legend: { 
                position: 'bottom', 
                fontSize: '14px', 
                fontWeight: 600,
                markers: { radius: 12 },
                itemMargin: { horizontal: 10, vertical: 5 }
            },
            dataLabels: { enabled: true, dropShadow: { enabled: false }, style: { fontSize: '12px', fontWeight: 700 } },
            noData: { text: 'Sin datos disponibles', style: { color: '#64748b' } },
            tooltip: { y: { formatter: val => `${val} alertas` } }
        };
        chartRuleDist = new ApexCharts(document.querySelector("#chart-rule-dist"), distOptions);
        chartRuleDist.render();

        // ─── Details View Charts ───
        
        // Trend Chart (Premium Area)
        const trendOptions = {
            series: [],
            chart: { type: 'area', height: 350, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
            colors: ['#3b82f6'],
            fill: { 
                type: 'gradient', 
                gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [20, 100] } 
            },
            stroke: { curve: 'smooth', width: 4 },
            xaxis: { type: 'datetime', labels: { style: { colors: '#64748b', fontWeight: 500 } } },
            yaxis: { labels: { style: { colors: '#64748b', fontWeight: 500 } } },
            dataLabels: { enabled: false },
            markers: { size: 4, colors: ['#fff'], strokeColors: '#3b82f6', strokeWidth: 2, hover: { size: 6 } },
            grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
            tooltip: { theme: 'light', x: { format: 'dd MMM yyyy' } },
            noData: { text: 'Cargando datos...', style: { color: '#94a3b8' } }
        };
        chartTrend = new ApexCharts(document.querySelector("#chart-trend"), trendOptions);
        chartTrend.render();

        // Rules Dist Chart (Premium Donut)
        const detailedRulesOptions = {
            series: [],
            chart: { type: 'donut', height: 350, fontFamily: 'Inter, sans-serif' },
            labels: ['Frenado Brusco', 'Aceleración Brusca', 'Giro Brusco'],
            colors: ['#e11d48', '#f59e0b', '#3b82f6'],
            stroke: { show: true, width: 3, colors: ['#fff'] },
            legend: { position: 'bottom', fontSize: '13px', fontWeight: 500, markers: { radius: 12 } },
            plotOptions: { 
                pie: { 
                    donut: { 
                        size: '72%',
                        labels: {
                            show: true,
                            name: { show: true, fontSize: '15px', color: '#64748b' },
                            value: { show: true, fontSize: '24px', fontWeight: 800, color: '#1e293b' },
                            total: { show: true, label: 'Alertas', formatter: w => w.globals.seriesTotals.reduce((a,b) => a+b, 0) }
                        }
                    } 
                } 
            },
            dataLabels: { enabled: false },
            noData: { text: 'Sin datos', style: { color: '#94a3b8' } }
        };
        chartRules = new ApexCharts(document.querySelector("#chart-rules"), detailedRulesOptions);
        chartRules.render();
    };

    const showView = (viewName) => {
        currentView = viewName;
        const mainView = document.getElementById("view-main");
        const detailsView = document.getElementById("view-details");
        
        if (viewName === "main") {
            mainView.style.display = "block";
            detailsView.style.display = "none";
        } else {
            mainView.style.display = "none";
            detailsView.style.display = "block";
            // Trigger chart resize for detail view
            window.dispatchEvent(new Event('resize'));
        }
    };

    // ─── Data Processing ────────────────────────────────────────────────────

    const processData = (data) => {
        // Group by Rule (Grouped)
        const ruleCounts = {};
        data.forEach(ex => {
            const rawName = rulesMap[ex.rule.id] ? rulesMap[ex.rule.id].name : "Regla Desconocida";
            const gName = getGroupName(rawName);
            ruleCounts[gName] = (ruleCounts[gName] || 0) + 1;
        });

        const sortedRules = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]);

        // Calculate Conducta Agresiva count
        const aggressiveCount = data.filter(ex => {
            const rawName = rulesMap[ex.rule.id] ? rulesMap[ex.rule.id].name : "";
            return AGGRESSIVE_RULES.some(r => r.toLowerCase() === rawName.toLowerCase());
        }).length;

        // Update UI
        const kpiAggressive = document.getElementById("kpi-aggressive-count");
        if (kpiAggressive) {
            kpiAggressive.textContent = aggressiveCount.toLocaleString();
            kpiAggressive.style.animation = "none";
            setTimeout(() => { kpiAggressive.style.animation = "shimmer 0.5s ease-out"; }, 10);
        }

        // Calculate Speeding count
        const speedingCount = data.filter(ex => {
            const rawName = rulesMap[ex.rule.id] ? rulesMap[ex.rule.id].name : "";
            return SPEEDING_RULES.some(r => r.toLowerCase() === rawName.toLowerCase());
        }).length;

        // Update UI Speeding
        const kpiSpeeding = document.getElementById("kpi-speeding-count");
        if (kpiSpeeding) {
            kpiSpeeding.textContent = speedingCount.toLocaleString();
            kpiSpeeding.style.animation = "none";
            setTimeout(() => { kpiSpeeding.style.animation = "shimmer 0.5s ease-out"; }, 10);
        }

        // Update Donut Chart (Main)
        const distSeries = sortedRules.map(r => r[1]);
        const distLabels = sortedRules.map(r => r[0]);
        chartRuleDist.updateOptions({ series: distSeries, labels: distLabels });

        // ─── Update Details View ───
        const aggressiveFiltered = data.filter(ex => {
            const rule = rulesMap[ex.rule.id];
            return rule && AGGRESSIVE_RULES_MAP[rule.name.toLowerCase()];
        });

        // 1. Summary Stats (Details)
        const totalAlerts = aggressiveFiltered.length;
        const unitsWithAlerts = new Set(aggressiveFiltered.map(ex => ex.device.id)).size;
        const avgDaily = (totalAlerts / (selectedDays || 1)).toFixed(1);

        const elTotalAlerts = document.getElementById("stat-total-alerts");
        const elCriticalUnits = document.getElementById("stat-critical-units");
        const elAvgDaily = document.getElementById("stat-avg-daily");
        
        if (elTotalAlerts) elTotalAlerts.textContent = totalAlerts.toLocaleString();
        if (elCriticalUnits) elCriticalUnits.textContent = unitsWithAlerts.toLocaleString();
        if (elAvgDaily) elAvgDaily.textContent = avgDaily;

        // 2. Trend Data (Details)
        const dayCounts = {};
        aggressiveFiltered.forEach(ex => {
            const date = ex.activeFrom.split('T')[0];
            dayCounts[date] = (dayCounts[date] || 0) + 1;
        });
        const trendSeries = Object.entries(dayCounts).map(([date, count]) => ({ x: new Date(date).getTime(), y: count })).sort((a,b) => a.x - b.x);
        chartTrend.updateSeries([{ name: 'Eventos', data: trendSeries }]);

        // 3. Rules Distribution (Details)
        const catCounts = { 'Frenado Brusco': 0, 'Aceleración Brusca': 0, 'Giro Brusco': 0 };
        aggressiveFiltered.forEach(ex => {
            const rule = rulesMap[ex.rule.id];
            const cat = AGGRESSIVE_RULES_MAP[rule.name.toLowerCase()];
            if (cat) catCounts[cat]++;
        });
        chartRules.updateSeries(Object.values(catCounts));

        // 4. Ranking Table (Details)
        const unitStats = {};
        aggressiveFiltered.forEach(ex => {
            const dId = ex.device.id;
            const dName = deviceMap[dId] || "Vehículo Desconocido";
            if (!unitStats[dId]) unitStats[dId] = { name: dName, frenado:0, giro:0, aceleracion:0, total:0 };
            
            const rule = rulesMap[ex.rule.id];
            const cat = AGGRESSIVE_RULES_MAP[rule.name.toLowerCase()];
            if (cat === 'Frenado Brusco') unitStats[dId].frenado++;
            if (cat === 'Aceleración Brusca') unitStats[dId].aceleracion++;
            if (cat === 'Giro Brusco') unitStats[dId].giro++;
            unitStats[dId].total++;
        });

        const sortedUnits = Object.values(unitStats).sort((a,b) => b.total - a.total);
        const tbody = document.getElementById("ranking-tbody");
        
        if (tbody) {
            tbody.innerHTML = "";
            const maxVal = Math.max(...sortedUnits.map(u => u.total), 1);
            
            sortedUnits.forEach((u, idx) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>
                        <div class="unit-name-cell">
                            <div class="unit-icon-box">
                                <i data-lucide="truck" width="18" height="18"></i>
                            </div>
                            <span>${u.name}</span>
                        </div>
                    </td>
                    <td>
                        <div class="score-flex">
                            <span class="val-badge badge--rose">${u.frenado}</span>
                            <div class="mini-bar-container"><div class="mini-bar-fill" style="width: ${(u.frenado/maxVal*100)}%; background: #e11d48;"></div></div>
                        </div>
                    </td>
                    <td>
                        <div class="score-flex">
                            <span class="val-badge badge--blue">${u.giro}</span>
                            <div class="mini-bar-container"><div class="mini-bar-fill" style="width: ${(u.giro/maxVal*100)}%; background: #3b82f6;"></div></div>
                        </div>
                    </td>
                    <td>
                        <div class="score-flex">
                            <span class="val-badge badge--amber">${u.aceleracion}</span>
                            <div class="mini-bar-container"><div class="mini-bar-fill" style="width: ${(u.aceleracion/maxVal*100)}%; background: #f59e0b;"></div></div>
                        </div>
                    </td>
                    <td style="text-align:center;">
                        <span class="total-score-pill">${u.total}</span>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    };

    // ─── Data Fetching ───────────────────────────────────────────────────────

    const fetchData = () => {
        if (loadingOverlay) loadingOverlay.style.display = "flex";

        const range = getDateRange();
        const calls = [];

        // 1. Search Exceptions
        const exSearch = {
            fromDate: range.fromDate,
            toDate: range.toDate
        };
        if (selectedUnitId !== "all") {
            exSearch.deviceSearch = { id: selectedUnitId };
        }

        calls.push(["Get", { typeName: "ExceptionEvent", search: exSearch }]);

        // 2. Rules (to get names)
        calls.push(["Get", { typeName: "Rule" }]);

        // 3. Devices (to get names)
        calls.push(["Get", { typeName: "Device" }]);

        api.multiCall(calls, function (results) {
            exceptions = results[0] || [];
            const rawRules = results[1] || [];
            const rawDevices = results[2] || [];

            // Build maps
            rulesMap = {};
            rawRules.forEach(r => { rulesMap[r.id] = r; });

            deviceMap = {};
            rawDevices.forEach(d => { deviceMap[d.id] = d.name; });

            // Populate unit select if empty
            const select = document.getElementById("unit-select");
            if (select && select.options.length <= 1) {
                rawDevices.sort((a, b) => a.name.localeCompare(b.name)).forEach(d => {
                    const opt = document.createElement("option");
                    opt.value = d.id;
                    opt.textContent = d.name;
                    select.appendChild(opt);
                });
            }

            processData(exceptions);

            const now = new Date();
            if (lastUpdatedEl) lastUpdatedEl.textContent = "Actualizado: " + now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

            if (loadingOverlay) loadingOverlay.style.display = "none";

        }, function (e) {
            console.error("Geotab API Error", e);
            showError("Hubo un error al consultar las alarmas de la flota.");
            if (loadingOverlay) loadingOverlay.style.display = "none";
        });
    };

    // ─── Lifecycle / Init ────────────────────────────────────────────────────

    return {
        initialize: function (geotabApi, state, callback) {
            api = geotabApi;

            // DOM References
            btnRefresh = document.getElementById("btn-refresh");
            lastUpdatedEl = document.getElementById("last-updated-time");
            loadingOverlay = document.getElementById("loading-overlay");
            errorToast = document.getElementById("error-toast");
            errorToastMsg = document.getElementById("error-toast-msg");

            // Event Listeners
            if (btnRefresh) {
                btnRefresh.addEventListener("click", () => {
                    fetchData();
                });
            }

            const rangeBtns = document.querySelectorAll(".btn-range");
            rangeBtns.forEach(btn => {
                if (btn.id === "btn-custom") return;
                btn.addEventListener("click", () => {
                    rangeBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedDays = parseInt(btn.dataset.days, 10);
                    isCustomRange = false;
                    fetchData();
                });
            });

            const unitSelect = document.getElementById("unit-select");
            if (unitSelect) {
                unitSelect.addEventListener("change", (e) => {
                    selectedUnitId = e.target.value;
                    fetchData();
                });
            }

            // Custom Date Range Logic
            const btnCustom = document.getElementById("btn-custom");
            const popover = document.getElementById("date-popover");
            const btnCancel = document.getElementById("btn-date-cancel");
            const btnApply = document.getElementById("btn-date-apply");

            if (btnCustom) {
                btnCustom.addEventListener("click", () => {
                    popover.classList.toggle("open");
                });
            }

            if (btnCancel) {
                btnCancel.addEventListener("click", () => popover.classList.remove("open"));
            }

            if (btnApply) {
                btnApply.addEventListener("click", () => {
                    const from = document.getElementById("date-from").value;
                    const to = document.getElementById("date-to").value;
                    if (from && to) {
                        customFromDate = new Date(from).toISOString();
                        customToDate = new Date(to).toISOString();
                        isCustomRange = true;
                        rangeBtns.forEach(b => b.classList.remove("active"));
                        btnCustom.classList.add("active");
                        popover.classList.remove("open");
                        fetchData();
                    } else {
                        showError("Por favor selecciona un rango válido.");
                    }
                });
            }

            // Navigation Event Listeners
            const btnGoAggressive = document.getElementById("btn-go-aggressive");
            if (btnGoAggressive) {
                btnGoAggressive.addEventListener("click", () => showView("details"));
            }

            const btnBack = document.getElementById("btn-back");
            if (btnBack) {
                btnBack.addEventListener("click", () => showView("main"));
            }

            // Initialize Viz
            initCharts();

            if (callback) callback();
        },

        focus: function (geotabApi, state) {
            api = geotabApi;
            if (typeof lucide !== "undefined") lucide.createIcons();
            fetchData();
        },

        blur: function (geotabApi, state) {
            // Cleanup if needed
        }
    };
};
