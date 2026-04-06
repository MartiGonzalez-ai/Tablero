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

    const getLocalDateString = (date) => {
        const d = new Date(date);
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
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

        // Establecemos el punto final del reporte (el día seleccionado a las 23:59:59 tiempo local)
        const toDateObj = new Date(toDateVal + "T23:59:59"); 
        
        // Punto inicial para historial (30 días antes de toDate)
        const fromDateHistoric = new Date(toDateObj);
        fromDateHistoric.setDate(fromDateHistoric.getDate() - 30);

        // --- Estrategia de Reconstrucción ---
        // 1. Obtener odómetro ABSOLUTO actual (AHORA)
        // 2. Obtener TODOS los viajes desde 'fromDateHistoric' hasta 'AHORA'
        // 3. Restar todos los viajes posteriores a 'toDateObj' del odómetro actual para hallar el odómetro en 'toDate'
        
        const now = new Date();
        const searchToDateToken = now.toISOString();
        const searchFromDateToken = fromDateHistoric.toISOString();

        const calls = odometerDiagnostics.map(diagId => [
            "Get",
            {
                typeName: "StatusData",
                search: {
                    deviceSearch: { id: deviceId },
                    diagnosticSearch: { id: diagId },
                    toDate: searchToDateToken,
                    resultsLimit: 1,
                    applyLatest: true
                }
            }
        ]);

        // Obtener todos los viajes desde el inicio del historial hasta ahora
        calls.push([
            "Get",
            {
                typeName: "Trip",
                search: {
                    deviceSearch: { id: deviceId },
                    fromDate: searchFromDateToken,
                    toDate: searchToDateToken
                }
            }
        ]);

        api.multiCall(calls, (results) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            try {
                // A. Extraer lectura base de odómetro (la absoluta actual)
                const odoResults = results.slice(0, odometerDiagnostics.length)
                                          .flat()
                                          .filter(r => r && r.data !== undefined);
                
                if (odoResults.length === 0) {
                    showError("No se encontraron lecturas de odómetro recientes para este vehículo.");
                    return;
                }

                odoResults.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
                const latestOdoData = odoResults[0];
                let currentOdoKms = latestOdoData.data / 1000;
                const odoDateTime = new Date(latestOdoData.dateTime);

                // B. Extraer viajes
                const trips = results[results.length - 1] || [];
                // Ordenar del más reciente al más antiguo
                trips.sort((a, b) => new Date(b.stop || b.start) - new Date(a.stop || a.start));

                // C. Reconstrucción lógica
                // Usamos el odómetro base (en KM) y ajustamos según los viajes ocurridos
                // entre la lectura de anclaje (odoDateTime) y la fecha de interés (toDateObj).

                const dailyDistanceData = {};
                // Inicializar 30 días previos a toDate
                for (let i = 0; i < 30; i++) {
                    const d = new Date(toDateObj);
                    d.setDate(d.getDate() - i);
                    dailyDistanceData[getLocalDateString(d)] = 0;
                }

                let targetOdoKms = currentOdoKms;

                trips.forEach(trip => {
                    const tripDist = trip.distance || 0; // Se asume KM basándose en historial rendimiento.js
                    const tripStart = new Date(trip.start);
                    const tripStop = new Date(trip.stop || trip.start);

                    // 1. Ajustar el Odómetro al final de la 'fechaObjetivo' (toDateObj)
                    // Si el viaje terminó ANTES del anclaje pero DESPUÉS del objetivo -> restamos para ir al pasado.
                    if (tripStop <= odoDateTime && tripStop > toDateObj) {
                        targetOdoKms -= tripDist;
                    } 
                    // Si el viaje terminó DESPUÉS del anclaje pero ANTES del objetivo -> sumamos para ir al futuro.
                    else if (tripStop > odoDateTime && tripStop <= toDateObj) {
                        targetOdoKms += tripDist;
                    }

                    // 2. Poblar desglose diario (usando fecha local para evitar desfases de zona horaria)
                    const dStr = getLocalDateString(tripStart);
                    if (dailyDistanceData[dStr] !== undefined) {
                        dailyDistanceData[dStr] += tripDist;
                    }
                });

                // D. Reconstrucción de Odómetro Acumulado por día (Historial para la tabla)
                const dailyOdoData = {};
                const sortedDatesAsc = Object.keys(dailyDistanceData).sort((a, b) => a.localeCompare(b));
                const reversedDates = [...sortedDatesAsc].reverse(); // Recientes primero (el seleccionado es el primero)

                let currentRunningOdo = targetOdoKms;

                reversedDates.forEach((date) => {
                    dailyOdoData[date] = currentRunningOdo;
                    // El odómetro del día anterior es el actual menos lo que se recorrió hoy
                    currentRunningOdo -= dailyDistanceData[date];
                });

                // --- UI Update ---
                resultContainer.style.display = "block";
                
                // KPI: Odómetro al final del día seleccionado (en KM)
                animateCount(distanciaValue, targetOdoKms);
                fechaFooter.textContent = formatDateReadable(toDateVal);

                // Tabla
                const sortedDatesForTable = Object.keys(dailyOdoData).sort((a, b) => b.localeCompare(a));
                const tbody = document.getElementById("daily-recorrido-tbody");
                const labelPeriodo = document.getElementById("label-periodo");

                if (tbody) {
                    tbody.innerHTML = "";
                    sortedDatesForTable.forEach(date => {
                        const tr = document.createElement("tr");
                        const km = dailyOdoData[date];
                        tr.innerHTML = `
                            <td class="date-td">${date}</td>
                            <td class="dist-td" style="text-align: right;">${km.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
                if (labelPeriodo) labelPeriodo.textContent = `Último periodo de 30 días`;

                // Gráfica (Mantenemos visualización de distancia diaria en la gráfica para mayor claridad del esfuerzo diario)
                renderChart(dailyDistanceData);

                if (window.lucide) lucide.createIcons();
                setTimeout(() => {
                    resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }, 100);

            } catch (err) {
                console.error("Error processing data:", err);
                showError("No se pudieron reconstruir los datos de odómetro satisfactoriamente.");
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
