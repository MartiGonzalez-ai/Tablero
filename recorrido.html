/**
 * ═══════════════════════════════════════════════════════════════
 * RECORRIDO.JS — Lógica para la consulta de kilómetros históricos
 * Geotab Add-In | Modern ESM Logic
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

// Geotab API Initialization
geotab.addin.recorrido = function () {
    let api;
    let units = [];

    // DOM Elements
    const unitSelect = document.getElementById("unit-select-recorrido");
    const dateUntilInput = document.getElementById("date-until");
    const btnConsultar = document.getElementById("btn-consultar");
    const resultContainer = document.getElementById("result-container");
    const loadingOverlay = document.getElementById("loading-overlay");
    const distanciaValue = document.getElementById("distancia-value");
    const fechaFooter = document.getElementById("fecha-footer");
    const errorToast = document.getElementById("error-toast");
    const errorToastMsg = document.getElementById("error-toast-msg");
    const odometerDiagnostics = [
        "DiagnosticOdometerAdjustmentId",
        "DiagnosticOdometerId",
        "DiagnosticOBDOdometerReaderId",
        "DiagnosticJ1939TotalVehicleDistanceId"
    ];

    let chartDaily;

    // --- Helpers ---
    const showError = (msg) => {
        if (errorToastMsg) errorToastMsg.textContent = msg;
        if (errorToast) {
            errorToast.style.display = "flex";
            setTimeout(() => { errorToast.style.display = "none"; }, 5000);
        }
    };

    const formatDateReadable = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr + "T00:00:00"); // Forzar interpretación local
        return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
    };

    const animateCount = (el, target) => {
        const duration = 1200;
        const start = performance.now();
        const startVal = parseFloat(el.textContent.replace(/,/g, "")) || 0;
        
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4); // Quartic ease out
            const current = startVal + (target - startVal) * eased;
            
            el.textContent = Math.round(current).toLocaleString("es-MX");
            
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    const renderChart = (dailyData) => {
        if (!window.ApexCharts) return;

        const dates = Object.keys(dailyData).sort();
        const seriesData = dates.map(d => parseFloat(dailyData[d].toFixed(1)));

        const options = {
            series: [{
                name: 'Distancia (km)',
                data: seriesData
            }],
            chart: {
                type: 'bar', // Volver a barras como antes
                height: 350,
                width: '100%',
                toolbar: { show: false },
                fontFamily: "'Inter', sans-serif"
            },
            colors: ['#00b1e1'],
            plotOptions: {
                bar: {
                    borderRadius: 6,
                    columnWidth: '55%',
                }
            },
            dataLabels: { enabled: false },
            xaxis: {
                categories: dates,
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    rotate: -45
                }
            },
            yaxis: {
                labels: {
                    style: { colors: '#64748b' },
                    formatter: (val) => val.toFixed(0) + " km"
                }
            },
            grid: {
                borderColor: '#f1f5f9',
                strokeDashArray: 4,
                padding: { left: 10, right: 10 }
            },
            tooltip: {
                theme: 'light',
                y: { formatter: (val) => val.toFixed(1) + " km" }
            }
        };

        if (chartDaily) {
            chartDaily.destroy();
        }

        const chartEl = document.querySelector("#chart-daily-recorrido");
        if (chartEl) {
            chartDaily = new ApexCharts(chartEl, options);
            chartDaily.render();
        }
    };

    // --- Data Loaders ---
    const loadUnits = () => {
        api.call("Get", {
            typeName: "Device"
        }, (result) => {
            units = result || [];
            unitSelect.innerHTML = '<option value="" disabled selected>Selecciona una unidad...</option>';
            
            // Sort by name
            units.sort((a, b) => a.name.localeCompare(b.name));

            units.forEach(device => {
                const option = document.createElement("option");
                option.value = device.id;
                option.textContent = device.name;
                unitSelect.appendChild(option);
            });
        }, (err) => {
            console.error("Error loading devices:", err);
            showError("No se pudieron cargar las unidades.");
        });
    };

    const calculateDistance = () => {
        const deviceId = unitSelect.value;
        const toDateVal = dateUntilInput.value;

        if (!deviceId) {
            showError("Por favor, selecciona una unidad.");
            return;
        }
        if (!toDateVal) {
            showError("Por favor, selecciona una fecha límite.");
            return;
        }

        // Show loading
        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        // Establecemos el punto final del reporte (el día seleccionado a las 23:59:59)
        const toDateObj = new Date(toDateVal + "T23:59:59Z");
        const searchToDate = toDateObj.toISOString();

        // Establecemos el punto inicial para la gráfica (30 días antes)
        const fromDateObj = new Date(toDateObj);
        fromDateObj.setDate(fromDateObj.getDate() - 30);
        const searchFromDate = fromDateObj.toISOString();

        // 1. Obtener la lectura de odómetro más reciente HASTA la fecha seleccionada
        const calls = odometerDiagnostics.map(diagId => [
            "Get",
            {
                typeName: "StatusData",
                search: {
                    deviceSearch: { id: deviceId },
                    diagnosticSearch: { id: diagId },
                    toDate: searchToDate,
                    resultsLimit: 1,
                    applyLatest: true
                }
            }
        ]);

        // 2. Obtener viajes para el periodo de la gráfica (30 días anteriores)
        calls.push([
            "Get",
            {
                typeName: "Trip",
                search: {
                    deviceSearch: { id: deviceId },
                    fromDate: searchFromDate,
                    toDate: searchToDate
                }
            }
        ]);

        api.multiCall(calls, (results) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            try {
                // Extraer odómetro base en la fecha 'toDate'
                const odoResults = results.slice(0, odometerDiagnostics.length)
                                          .flat()
                                          .filter(r => r && r.data !== undefined);
                
                let odoAtTargetMeters = 0;
                if (odoResults.length > 0) {
                    odoResults.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
                    odoAtTargetMeters = odoResults[0].data;
                }

                // Extraer viajes
                const trips = results[results.length - 1] || [];
                
                // Agrupar por día para la tabla y la gráfica de barras
                const dailyDistanceData = {};
                
                // Inicializar los últimos 30 días con 0 por si no hay viajes
                for (let i = 0; i < 30; i++) {
                    const d = new Date(toDateObj);
                    d.setDate(d.getDate() - i);
                    const dStr = d.toISOString().split('T')[0];
                    dailyDistanceData[dStr] = 0;
                }

                trips.forEach(trip => {
                    if (trip.start && trip.distance) {
                        const tripStart = new Date(trip.start);
                        const dStr = tripStart.toISOString().split('T')[0];
                        // Solo sumar si está dentro de nuestro rango de reporte
                        if (dailyDistanceData[dStr] !== undefined) {
                            dailyDistanceData[dStr] += (trip.distance / 1000);
                        }
                    }
                });

                // --- UI Update ---
                resultContainer.style.display = "block";
                
                // KPI: Odómetro al final del periodo (convertido a KM)
                const targetOdoKm = odoAtTargetMeters / 1000;
                animateCount(distanciaValue, targetOdoKm);
                fechaFooter.textContent = formatDateReadable(toDateVal);

                // Tabla
                const sortedDates = Object.keys(dailyDistanceData).sort((a, b) => b.localeCompare(a));
                const tbody = document.getElementById("daily-recorrido-tbody");
                const labelPeriodo = document.getElementById("label-periodo");

                if (tbody) {
                    tbody.innerHTML = "";
                    sortedDates.forEach(date => {
                        const tr = document.createElement("tr");
                        const km = dailyDistanceData[date];
                        tr.innerHTML = `
                            <td class="date-td">${date}</td>
                            <td class="dist-td" style="text-align: right;">${km.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
                if (labelPeriodo) labelPeriodo.textContent = `Último periodo de 30 días`;

                // Gráfica de Barras (Distancia Diaria)
                renderChart(dailyDistanceData);

                if (window.lucide) lucide.createIcons();
                setTimeout(() => {
                    resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }, 100);

            } catch (err) {
                console.error("Error processing data:", err);
                showError("No se pudieron procesar los datos de odómetro. Verifique el vehículo.");
            }
        }, (err) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("MultiCall Error:", err);
            showError("Error de conexión con Geotab.");
        });
    };

    // --- Lifecycle ---
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            // Set default date to today
            if (dateUntilInput) {
                dateUntilInput.value = new Date().toISOString().split('T')[0];
            }

            // Event Listeners
            if (btnConsultar) {
                btnConsultar.addEventListener("click", calculateDistance);
            }

            // Initialize Lucide
            if (window.lucide) {
                lucide.createIcons();
            }

            // Load initial data
            loadUnits();

            callback();
        },
        focus: function (_api, state) {
            api = _api;
            // Refresh units list in case something changed
            loadUnits();
        },
        blur: function () {
            // Nothing needed on blur
        }
    };
};
