"use strict";

geotab.addin.aceite = function () {
    let api;
    let selectedUnitId = "all";
    let selectedPeriod = "month";
    let deviceMap = {};
    let customFromDate = null;
    let customToDate = null;
    
    // Charts
    let chartTemp = null;
    let chartPressure = null;

    // DOM Elements
    let btnConsultar, unitSelect, loadingOverlay, errorToast, errorToastMsg;
    let lastUpdatedTime;

    // Diagnostics
    const oilTempDiagIds = [
        "DiagnosticEngineOilTemperatureId",
        "DiagnosticObdEngineOilTemperatureId",
        "DiagnosticJ1939EngineOilTemperature1Id",
        "DiagnosticJ1939EngineOilTemperatureId"
    ];
    
    const oilPresDiagIds = [
        "DiagnosticEngineOilPressureId",
        "DiagnosticObdEngineOilPressureId",
        "DiagnosticJ1939EngineOilPressureId",
        "Diagnostic1310729Id" // Legacy or specific mapped ID sometimes used for J1939 pressure
    ];

    const oilLifeDiagIds = [
        "DiagnosticEngineOilLifeRemainingId"
    ];

    const oilDiagnostics = [
        ...oilTempDiagIds, 
        ...oilPresDiagIds, 
        ...oilLifeDiagIds, 
        "DiagnosticEngineOilLevelId", 
        "DiagnosticJ1939EngineOilLevelId"
    ];

    const getDateRange = () => {
        const toDate = new Date();
        const fromDate = new Date();
        
        if (selectedPeriod === "day") {
            fromDate.setDate(fromDate.getDate() - 1);
        } else if (selectedPeriod === "week") {
            fromDate.setDate(fromDate.getDate() - 7);
        } else if (selectedPeriod === "month") {
            fromDate.setMonth(fromDate.getMonth() - 1);
        }
        
        return { 
            fromDate: fromDate.toISOString(), 
            toDate: toDate.toISOString() 
        };
    };

    const showError = (msg) => {
        errorToastMsg.textContent = msg;
        errorToast.style.display = "flex";
        setTimeout(() => { errorToast.style.display = "none"; }, 5000);
    };

    const updateLastUpdated = () => {
        const now = new Date();
        lastUpdatedTime.textContent = "Actualizado: " + now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    };

    const initCharts = () => {
        // Temperature Chart
        const tempOptions = {
            series: [{ name: 'Temperatura (°C)', data: [] }],
            chart: {
                type: 'line',
                height: 300,
                toolbar: { show: false },
                animations: { enabled: true }
            },
            colors: ['#f97316'],
            stroke: { width: 3, curve: 'smooth' },
            xaxis: {
                type: 'datetime',
                labels: { format: 'dd MMM', style: { colors: '#64748b' } }
            },
            yaxis: {
                labels: { formatter: val => val.toFixed(0) + ' °C', style: { colors: '#64748b' } }
            },
            tooltip: { x: { format: 'dd MMM HH:mm' } },
            grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
            noData: { text: "Sin datos" }
        };
        chartTemp = new ApexCharts(document.querySelector("#chart-temp-trend"), tempOptions);
        chartTemp.render();

        // Pressure Chart
        const pOptions = {
            series: [{ name: 'Presión (kPa)', data: [] }],
            chart: {
                type: 'area',
                height: 300,
                toolbar: { show: false },
                animations: { enabled: true }
            },
            colors: ['#3b82f6'],
            fill: {
                type: "gradient",
                gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.0, stops: [0, 90, 100] }
            },
            dataLabels: { enabled: false },
            stroke: { width: 3, curve: 'smooth' },
            xaxis: {
                type: 'datetime',
                labels: { format: 'dd MMM', style: { colors: '#64748b' } },
                tooltip: { enabled: false }
            },
            yaxis: {
                labels: { formatter: val => val.toFixed(0) + ' kPa', style: { colors: '#64748b' } }
            },
            tooltip: { x: { format: 'dd MMM HH:mm' } },
            grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
            noData: { text: "Sin datos" }
        };
        chartPressure = new ApexCharts(document.querySelector("#chart-pressure-trend"), pOptions);
        chartPressure.render();
    };

    const updateCharts = (tempData, presData) => {
        // Formatear datos para ApexCharts { x: timestamp, y: valor }
        const tSeries = tempData.map(d => ({ x: new Date(d.dateTime).getTime(), y: d.data }));
        const pSeries = presData.map(d => ({ x: new Date(d.dateTime).getTime(), y: d.data }));

        chartTemp.updateSeries([{ name: 'Temperatura (°C)', data: tSeries }]);
        chartPressure.updateSeries([{ name: 'Presión (kPa)', data: pSeries }]);
    };

    const renderAlarmsTable = (faults, deviceMap, diagMap) => {
        const tbody = document.getElementById("alarms-tbody");
        const emptyMsg = document.getElementById("alarms-empty");
        const countValue = document.getElementById("alarms-count-value");
        
        tbody.innerHTML = "";
        
        // Filter faults related to Oil (e.g. Engine Oil) or specific known fault IDs
        const oilFaults = faults.filter(f => {
            const diagInfo = diagMap[f.diagnostic.id];
            if (!diagInfo) return false;
            return diagInfo.name.toLowerCase().includes("oil") || diagInfo.name.toLowerCase().includes("aceite");
        });

        countValue.textContent = oilFaults.length;

        if (oilFaults.length === 0) {
            emptyMsg.style.display = "block";
            return;
        }

        emptyMsg.style.display = "none";
        
        oilFaults.sort((a,b) => new Date(b.dateTime) - new Date(a.dateTime));

        oilFaults.forEach(f => {
            const tr = document.createElement("tr");
            const dName = deviceMap[f.device.id] || f.device.id;
            const dateStr = new Date(f.dateTime).toLocaleString("es-MX");
            const desc = diagMap[f.diagnostic.id] ? diagMap[f.diagnostic.id].name : f.diagnostic.id;
            const status = f.dismissDateTime ? '<span style="color:#10b981;">Resuelto</span>' : '<span style="color:#ef4444; font-weight:600;">Activa</span>';

            tr.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <div style="width:8px; height:8px; border-radius:50%; background:var(--c-orange);"></div>
                        <strong>${dName}</strong>
                    </div>
                </td>
                <td style="color:#64748b; font-size:0.875rem;">${dateStr}</td>
                <td>${desc}</td>
                <td>${status}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    const processData = (statusData, faults, diagMap) => {
        let maxTemp = 0;
        let maxTempUnit = "--";
        let maxTempDate = null;

        let totalPres = 0;
        let presCount = 0;

        let latestLife = null;

        const tempData = [];
        const presData = [];

        statusData.forEach(d => {
            // Temperature
            if (oilTempDiagIds.includes(d.diagnostic.id)) {
                tempData.push(d);
                if (d.data > maxTemp) {
                    maxTemp = d.data;
                    maxTempUnit = deviceMap[d.device.id] || d.device.id;
                    maxTempDate = new Date(d.dateTime).toLocaleString("es-MX");
                }
            }
            // Pressure
            if (oilPresDiagIds.includes(d.diagnostic.id)) {
                presData.push(d);
                totalPres += d.data;
                presCount++;
            }
            // Oil Life
            if (oilLifeDiagIds.includes(d.diagnostic.id)) {
                if (latestLife === null || new Date(d.dateTime) > latestLife.date) {
                    latestLife = { val: d.data, date: new Date(d.dateTime) };
                }
            }
        });

        // Sort for charts
        tempData.sort((a,b) => new Date(a.dateTime) - new Date(b.dateTime));
        presData.sort((a,b) => new Date(a.dateTime) - new Date(b.dateTime));

        updateCharts(tempData, presData);

        // Update KPIs
        document.getElementById("temp-max-value").textContent = maxTemp > 0 ? maxTemp.toFixed(1) : "--";
        document.getElementById("temp-max-unit").textContent = maxTemp > 0 ? `${maxTempUnit} (${maxTempDate})` : "Sin lecturas";

        const avgPres = presCount > 0 ? (totalPres / presCount) : 0;
        document.getElementById("pressure-avg-value").textContent = avgPres > 0 ? avgPres.toFixed(0) : "--";

        document.getElementById("oil-life-value").textContent = latestLife ? latestLife.val.toFixed(1) : "--";

        // Table
        renderAlarmsTable(faults, deviceMap, diagMap);
    };

    const fetchData = () => {
        loadingOverlay.style.display = "flex";
        document.getElementById("result-container").style.display = "none";

        const range = getDateRange();

        // 1. Obtener Dispositivos para mapear nombres
        api.call("Get", {
            typeName: "Device",
            search: { fromDate: new Date().toISOString() }
        }, function (devices) {
            deviceMap = {};
            devices.forEach(d => { deviceMap[d.id] = d.name; });

            // Ensure unit dropdown has units
            if (unitSelect.options.length <= 1) {
                // sort alphabetically
                const sf = devices.map(d => ({id: d.id, name: d.name})).sort((a,b) => a.name.localeCompare(b.name));
                sf.forEach(d => {
                    const opt = document.createElement("option");
                    opt.value = d.id;
                    opt.textContent = d.name;
                    unitSelect.appendChild(opt);
                });
            }

            // 2. Obtener StatusData
            const sdSearch = {
                fromDate: range.fromDate,
                toDate: range.toDate
            };
            if (selectedUnitId !== "all") {
                sdSearch.deviceSearch = { id: selectedUnitId };
            }

            const multiCalls = [];
            // StatusData llamadas
            oilDiagnostics.forEach(diagId => {
                const s = Object.assign({}, sdSearch, { diagnosticSearch: { id: diagId } });
                multiCalls.push(["Get", { typeName: "StatusData", search: s }]);
            });

            // FaultData
            const fdSearch = {
                fromDate: range.fromDate,
                toDate: range.toDate
            };
            if (selectedUnitId !== "all") {
                fdSearch.deviceSearch = { id: selectedUnitId };
            }
            multiCalls.push(["Get", { typeName: "FaultData", search: fdSearch }]);

            // Get Diagnostics para traducir Alertas
            multiCalls.push(["Get", { typeName: "Diagnostic" }]);

            api.multiCall(multiCalls, function(results) {
                const statusData = [];
                // first 4 are StatusData
                for (let i = 0; i < oilDiagnostics.length; i++) {
                    if (results[i]) statusData.push(...results[i]);
                }
                
                const faults = results[oilDiagnostics.length] || [];
                const diagnostics = results[oilDiagnostics.length + 1] || [];

                const diagMap = {};
                diagnostics.forEach(d => { diagMap[d.id] = d; });

                processData(statusData, faults, diagMap);

                updateLastUpdated();
                loadingOverlay.style.display = "none";
                document.getElementById("result-container").style.display = "block";

            }, function(e) {
                console.error("API Error", e);
                showError("Hubo un error al consultar información de aceite.");
                loadingOverlay.style.display = "none";
            });

        }, function(e) {
            console.error("Device API Error", e);
            showError("Hubo un error al obtener unidades.");
            loadingOverlay.style.display = "none";
        });
    };

    return {
        initialize: function (geotabApi, state, callback) {
            api = geotabApi;

            // DOM Setup
            btnConsultar = document.getElementById("btn-consultar");
            unitSelect = document.getElementById("unit-select-aceite");
            loadingOverlay = document.getElementById("loading-overlay");
            errorToast = document.getElementById("error-toast");
            errorToastMsg = document.getElementById("error-toast-msg");
            lastUpdatedTime = document.getElementById("last-updated-time");

            // Eventos
            btnConsultar.addEventListener("click", () => {
                selectedUnitId = unitSelect.value;
                fetchData();
            });

            // Presets de periodo
            const periodBtns = document.querySelectorAll(".btn-range");
            periodBtns.forEach(btn => {
                btn.addEventListener("click", (e) => {
                    periodBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedPeriod = btn.dataset.period;
                });
            });

            // Icons
            if (typeof lucide !== "undefined") {
                lucide.createIcons();
            }

            // Init charts
            initCharts();

            if (callback) callback();
        },
        focus: function (geotabApi, state) {
            api = geotabApi;
            if (typeof lucide !== "undefined") {
                lucide.createIcons();
            }
            fetchData();
        },
        blur: function (geotabApi, state) {
        }
    };
};
