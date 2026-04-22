/**
 * @file conducta_agresiva.js
 * @description Dashboard Detallado de Conducta Agresiva
 */

"use strict";

geotab.addin.conducta_agresiva = function () {
    let api;
    let selectedDays = 7;
    let selectedUnitId = "all";

    // Data storage
    let exceptions = [];
    let rulesMap = {};
    let deviceMap = {};

    // Chart instances
    let chartTrend = null;
    let chartRules = null;

    // Rules Definitions
    const AGGRESSIVE_RULES = {
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

    const getAggressiveCategory = (ruleName) => {
        return AGGRESSIVE_RULES[ruleName.toLowerCase()] || null;
    };

    // DOM Elements
    let btnRefresh, loadingOverlay, lastUpdatedEl;

    // ─── Helpers ─────────────────────────────────────────────────────────────

    const getDateRange = () => {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - selectedDays);
        return { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() };
    };

    const initCharts = () => {
        // Trend Chart
        const trendOptions = {
            series: [],
            chart: { type: 'area', height: 350, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
            colors: ['#f59e0b'],
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } },
            stroke: { curve: 'smooth', width: 3 },
            xaxis: { type: 'datetime', labels: { style: { colors: '#64748b' } } },
            yaxis: { labels: { style: { colors: '#64748b' } } },
            dataLabels: { enabled: false },
            tooltip: { x: { format: 'dd MMM' } },
            noData: { text: 'Cargando datos...' }
        };
        chartTrend = new ApexCharts(document.querySelector("#chart-trend"), trendOptions);
        chartTrend.render();

        // Rules Dist Chart
        const rulesOptions = {
            series: [],
            chart: { type: 'donut', height: 350, fontFamily: 'Inter, sans-serif' },
            labels: ['Frenado Brusco', 'Aceleración Brusca', 'Giro Brusco'],
            colors: ['#e11d48', '#f59e0b', '#3b82f6'],
            legend: { position: 'bottom' },
            plotOptions: { pie: { donut: { size: '65%' } } },
            noData: { text: 'Sin datos' }
        };
        chartRules = new ApexCharts(document.querySelector("#chart-rules"), rulesOptions);
        chartRules.render();
    };

    const processData = (data) => {
        const filtered = data.filter(ex => {
            const rule = rulesMap[ex.rule.id];
            return rule && getAggressiveCategory(rule.name);
        });

        // 1. Summary Stats
        const totalAlerts = filtered.length;
        const unitsWithAlerts = new Set(filtered.map(ex => ex.device.id)).size;
        const avgDaily = (totalAlerts / selectedDays).toFixed(1);

        document.getElementById("stat-total-alerts").textContent = totalAlerts.toLocaleString();
        document.getElementById("stat-critical-units").textContent = unitsWithAlerts.toLocaleString();
        document.getElementById("stat-avg-daily").textContent = avgDaily;

        // 2. Trend Data
        const dayCounts = {};
        filtered.forEach(ex => {
            const date = ex.activeFrom.split('T')[0];
            dayCounts[date] = (dayCounts[date] || 0) + 1;
        });
        const trendSeries = Object.entries(dayCounts).map(([date, count]) => ({ x: new Date(date).getTime(), y: count })).sort((a,b) => a.x - b.x);
        chartTrend.updateSeries([{ name: 'Eventos', data: trendSeries }]);

        // 3. Rules Distribution
        const catCounts = { 'Frenado Brusco': 0, 'Aceleración Brusca': 0, 'Giro Brusco': 0 };
        filtered.forEach(ex => {
            const rule = rulesMap[ex.rule.id];
            const cat = getAggressiveCategory(rule.name);
            if (cat) catCounts[cat]++;
        });
        chartRules.updateSeries(Object.values(catCounts));

        // 4. Ranking Table
        const unitStats = {};
        filtered.forEach(ex => {
            const dId = ex.device.id;
            const dName = deviceMap[dId] || "Vehículo Desconocido";
            if (!unitStats[dId]) unitStats[dId] = { name: dName, frenado:0, giro:0, aceleracion:0, total:0 };
            
            const rule = rulesMap[ex.rule.id];
            const cat = getAggressiveCategory(rule.name);
            if (cat === 'Frenado Brusco') unitStats[dId].frenado++;
            if (cat === 'Aceleración Brusca') unitStats[dId].aceleracion++;
            if (cat === 'Giro Brusco') unitStats[dId].giro++;
            unitStats[dId].total++;
        });

        const sortedUnits = Object.values(unitStats).sort((a,b) => b.total - a.total);
        const tbody = document.getElementById("ranking-tbody");
        tbody.innerHTML = "";
        sortedUnits.forEach(u => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${u.name}</td>
                <td style="text-align:right;">${u.frenado}</td>
                <td style="text-align:right;">${u.giro}</td>
                <td style="text-align:right;">${u.aceleracion}</td>
                <td style="text-align:center; font-weight: 800; color: #1e293b;">${u.total}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    const fetchData = () => {
        if (loadingOverlay) loadingOverlay.style.display = "flex";
        const range = getDateRange();
        
        const calls = [
            ["Get", { typeName: "ExceptionEvent", search: { fromDate: range.fromDate, toDate: range.toDate, ...(selectedUnitId !== "all" && { deviceSearch: { id: selectedUnitId } }) } }],
            ["Get", { typeName: "Rule" }],
            ["Get", { typeName: "Device" }]
        ];

        api.multiCall(calls, (results) => {
            const exceptionsData = results[0] || [];
            const rawRules = results[1] || [];
            const rawDevices = results[2] || [];

            rulesMap = {};
            rawRules.forEach(r => rulesMap[r.id] = r);
            deviceMap = {};
            rawDevices.forEach(d => deviceMap[d.id] = d.name);

            // Populate unit select
            const select = document.getElementById("unit-select");
            if (select && select.options.length <= 1) {
                rawDevices.sort((a,b) => a.name.localeCompare(b.name)).forEach(d => {
                    const opt = document.createElement("option");
                    opt.value = d.id;
                    opt.textContent = d.name;
                    select.appendChild(opt);
                });
            }

            processData(exceptionsData);
            if (loadingOverlay) loadingOverlay.style.display = "none";
        }, (e) => {
            console.error(e);
            if (loadingOverlay) loadingOverlay.style.display = "none";
        });
    };

    return {
        initialize: function (geotabApi, state, callback) {
            api = geotabApi;
            loadingOverlay = document.getElementById("loading-overlay");
            btnRefresh = document.getElementById("btn-refresh");

            initCharts();

            if (btnRefresh) btnRefresh.addEventListener("click", fetchData);

            const prangeBtns = document.querySelectorAll(".btn-range");
            prangeBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    prangeBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedDays = parseInt(btn.dataset.days);
                    fetchData();
                });
            });

            const uselect = document.getElementById("unit-select");
            if (uselect) {
                uselect.addEventListener("change", (e) => {
                    selectedUnitId = e.target.value;
                    fetchData();
                });
            }

            if (callback) callback();
        },
        focus: function (geotabApi, state) {
            if (typeof lucide !== 'undefined') lucide.createIcons();
            fetchData();
        }
    };
};
