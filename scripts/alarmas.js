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
    const AGGRESSIVE_RULES = [
        "Harsh Braking (New)", "Harsh Acceleration (New)", "Harsh Cornering (New)",
        "Harsh Braking", "Harsh Cornering", "Hard Acceleration",
        "Frenado brusco (nuevo)", "Aceleración brusca (nuevo)", "Giro brusco (nuevo)",
        "Frenado brusco", "Giro brusco", "Aceleración brusca"
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
            // Optional: Animation effect
            kpiAggressive.style.animation = "none";
            setTimeout(() => { kpiAggressive.style.animation = "shimmer 0.5s ease-out"; }, 10);
        }

        // Update Donut Chart
        const distSeries = sortedRules.map(r => r[1]);
        const distLabels = sortedRules.map(r => r[0]);
        chartRuleDist.updateOptions({ series: distSeries, labels: distLabels });
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
