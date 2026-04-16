
"use strict";

// Geotab API Initialization
geotab.addin.recorrido = function () {
    let api;
    let units = [];
    let trendGrouping = "day";
    let lastOdoData = {};
    let lastDistanceData = {};
    let selectedPeriod = "month"; // Default period

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
                name: 'Distancia Diaria (km)',
                data: seriesData
            }],
            chart: {
                type: 'bar',
                height: 260,
                width: '100%',
                toolbar: { show: false },
                fontFamily: "'Inter', sans-serif"
            },
            colors: ['#003666'], // Geotab Blue
            plotOptions: {
                bar: {
                    borderRadius: 3,
                    columnWidth: '55%',
                }
            },
            dataLabels: { enabled: false },
            xaxis: {
                categories: dates,
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    rotate: -45,
                    formatter: function(value) {
                        if (!value) return "";
                        const d = new Date(value + "T12:00:00");
                        if (isNaN(d.getTime())) return value;
                        const label = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
                        return label.charAt(0).toUpperCase() + label.slice(1);
                    }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    formatter: (val) => val.toFixed(0) + " km"
                }
            },
            grid: {
                borderColor: '#eaecf0',
                strokeDashArray: 4
            },
            tooltip: {
                theme: 'light',
                y: { formatter: (val) => val.toFixed(1) + " km" }
            }
        };

        if (chartDaily) chartDaily.destroy();
        const chartEl = document.querySelector("#chart-daily-recorrido");
        if (chartEl) {
            chartDaily = new ApexCharts(chartEl, options);
            chartDaily.render();
        }
    };

    let chartOdoTrend;
    const renderOdoTrendChart = (odoData, dailyDistanceData) => {
        if (!window.ApexCharts) return;

        const sortedDates = Object.keys(odoData).sort();
        let trendSeries = [];

        const getWeekNumber = function (d) {
            const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            const dayNum = date.getUTCDay() || 7;
            date.setUTCDate(date.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
            return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        };

        if (trendGrouping === "day") {
            trendSeries = sortedDates.map(date => ({
                x: date,
                y: parseFloat(odoData[date].toFixed(1))
            }));
        } else if (trendGrouping === "week") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const d = new Date(dateStr + "T12:00:00");
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d.setDate(diff));
                const weekKey = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, '0') + "-" + String(monday.getDate()).padStart(2, '0');

                if (!grouped[weekKey] || new Date(dateStr) > new Date(grouped[weekKey].lastDate)) {
                    grouped[weekKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(weekKey => {
                const d = new Date(weekKey + "T12:00:00");
                const weekNum = getWeekNumber(d);
                trendSeries.push({ x: "Semana " + weekNum, y: parseFloat(grouped[weekKey].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "month") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const monthKey = dateStr.substring(0, 7) + "-01";
                if (!grouped[monthKey] || new Date(dateStr) > new Date(grouped[monthKey].lastDate)) {
                    grouped[monthKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(monthKey => {
                const d = new Date(monthKey + "T12:00:00");
                const label = d.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
                trendSeries.push({ x: capitalized, y: parseFloat(grouped[monthKey].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "bimester") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const bimesterStartMonth = Math.floor((month - 1) / 2) * 2 + 1;
                const bKey = year + "-" + String(bimesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[bKey] || new Date(dateStr) > new Date(grouped[bKey].lastDate)) {
                    grouped[bKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                const d1 = new Date(key + "T12:00:00");
                const d2 = new Date(d1); d2.setMonth(d2.getMonth() + 1);
                const l1 = d1.toLocaleDateString("es-MX", { month: "short" });
                const l2 = d2.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                const label = l1.charAt(0).toUpperCase() + l1.slice(1) + " - " + l2.charAt(0).toUpperCase() + l2.slice(1);
                trendSeries.push({ x: label, y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "trimester") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const trimesterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
                const tKey = year + "-" + String(trimesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[tKey] || new Date(dateStr) > new Date(grouped[tKey].lastDate)) {
                    grouped[tKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                const d = new Date(key + "T12:00:00");
                const q = Math.floor(d.getMonth() / 3) + 1;
                trendSeries.push({ x: "T" + q + " " + d.getFullYear(), y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "6months") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const semesterStartMonth = Math.floor((month - 1) / 6) * 6 + 1;
                const sKey = year + "-" + String(semesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[sKey] || new Date(dateStr) > new Date(grouped[sKey].lastDate)) {
                    grouped[sKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                const d = new Date(key + "T12:00:00");
                const sem = d.getMonth() < 6 ? "1er Sem" : "2do Sem";
                trendSeries.push({ x: sem + " " + d.getFullYear(), y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "year") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const yearKey = dateStr.substring(0, 4) + "-01-01";
                if (!grouped[yearKey] || new Date(dateStr) > new Date(grouped[yearKey].lastDate)) {
                    grouped[yearKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                trendSeries.push({ x: key.substring(0, 4), y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        }

        const options = {
            series: [{
                name: 'Odómetro (km)',
                data: trendSeries
            }],
            chart: {
                type: 'area',
                height: 260,
                width: '100%',
                toolbar: { show: false },
                fontFamily: "'Inter', sans-serif",
                zoom: { enabled: false }
            },
            stroke: {
                curve: 'smooth',
                width: 2.5
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.35,
                    opacityTo: 0.05,
                    stops: [0, 100],
                    colorStops: [
                        { offset: 0, color: "#00b1e1", opacity: 0.35 },
                        { offset: 100, color: "#00b1e1", opacity: 0 }
                    ]
                }
            },
            colors: ["#00b1e1"],
            dataLabels: {
                enabled: trendGrouping !== "day",
                formatter: (val) => Math.round(val).toLocaleString("es-MX"),
                offsetY: -6,
                style: { fontSize: '11px', fontWeight: '700', colors: ["#003666"] },
                background: { enabled: true, foreColor: '#fff', borderRadius: 4, borderWidth: 0, opacity: 0.9 }
            },
            markers: {
                size: trendGrouping === "day" ? 0 : 4,
                colors: ['#fff'],
                strokeColors: "#00b1e1",
                strokeWidth: 2,
                hover: { size: 7 }
            },
            xaxis: {
                type: "category",
                categories: trendSeries.map(p => p.x),
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    rotate: -45,
                    formatter: (value) => {
                        if (trendGrouping !== 'day') return value;
                        if (!value) return "";
                        const d = new Date(value + "T12:00:00");
                        if (isNaN(d.getTime())) return value;
                        const label = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
                        return label.charAt(0).toUpperCase() + label.slice(1);
                    }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    formatter: (val) => Math.round(val).toLocaleString("es-MX") + " km"
                }
            },
            grid: {
                borderColor: '#eaecf0',
                strokeDashArray: 4
            },
            tooltip: {
                shared: true,
                theme: 'light',
                y: { formatter: (val) => Math.round(val).toLocaleString("es-MX") + " km" }
            }
        };

        if (chartOdoTrend) chartOdoTrend.destroy();
        const chartTrendEl = document.querySelector("#chart-odo-trend");
        if (chartTrendEl) {
            chartOdoTrend = new ApexCharts(chartTrendEl, options);
            chartOdoTrend.render();
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

    const getSelectedRange = () => {
        const toDate = new Date();
        const fromDate = new Date();

        if (selectedPeriod === "custom") {
            const customVal = document.getElementById("date-until").value;
            if (!customVal) return null;
            const toD = new Date(customVal + "T23:59:59");
            const fromD = new Date(toD);
            fromD.setDate(fromD.getDate() - 30); // Default to 30 days history
            return { from: fromD, to: toD };
        }

        if (selectedPeriod === "week") {
            const day = toDate.getDay();
            const diff = toDate.getDate() - day + (day === 0 ? -6 : 1);
            fromDate.setDate(diff);
        } else if (selectedPeriod === "month") {
            fromDate.setDate(1);
        } else if (selectedPeriod === "bimester") {
            fromDate.setMonth(Math.floor(toDate.getMonth() / 2) * 2);
            fromDate.setDate(1);
        } else if (selectedPeriod === "trimester") {
            fromDate.setMonth(Math.floor(toDate.getMonth() / 3) * 3);
            fromDate.setDate(1);
        } else if (selectedPeriod === "semester") {
            fromDate.setMonth(Math.floor(toDate.getMonth() / 6) * 6);
            fromDate.setDate(1);
        }

        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
        return { from: fromDate, to: toDate };
    };

    const calculateDistance = () => {
        const deviceId = unitSelect.value;
        const range = getSelectedRange();

        if (!deviceId) {
            showError("Por favor, selecciona una unidad.");
            return;
        }
        if (!range) {
            showError("Por favor, selecciona una fecha válida.");
            return;
        }

        // Show loading
        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        const toDateObj = range.to; 
        const fromDateHistoric = range.from;

        // Number of days in the selected range (for the daily breakdown)
        const diffTime = Math.abs(toDateObj - fromDateHistoric);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const historyDays = Math.max(diffDays, 1);

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
                // Initialize range days previos a toDate
                for (let i = 0; i < historyDays; i++) {
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
                
                // KPI: Distancia total recorrida en el periodo
                const totalDistancePeriod = Object.values(dailyDistanceData).reduce((a, b) => a + b, 0);
                const distanciaPeriodoValue = document.getElementById("distancia-periodo-value");
                if (distanciaPeriodoValue) {
                    animateCount(distanciaPeriodoValue, totalDistancePeriod);
                }

                const rangeDisplay = selectedPeriod === "custom" 
                    ? formatDateReadable(document.getElementById("date-until").value)
                    : formatDateReadable(getLocalDateString(toDateObj));
                fechaFooter.textContent = rangeDisplay;

                // Tabla
                const sortedDatesForTable = Object.keys(dailyOdoData).sort((a, b) => b.localeCompare(a));
                const tbody = document.getElementById("daily-recorrido-tbody");
                const labelPeriodo = document.getElementById("label-periodo");

                if (tbody) {
                    tbody.innerHTML = "";
                    sortedDatesForTable.forEach(date => {
                        const tr = document.createElement("tr");
                        const dist = dailyDistanceData[date];
                        const odo = dailyOdoData[date];
                        tr.innerHTML = `
                            <td class="date-td">${date}</td>
                            <td class="dist-td" style="text-align: right; color: var(--color-primary); font-weight: 600;">${dist.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</td>
                            <td class="odo-td" style="text-align: right; font-weight: 700;">${odo.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
                if (labelPeriodo) labelPeriodo.textContent = `Detalle de odómetro y distancia por día`;

                // Store results for re-grouping
                lastOdoData = dailyOdoData;
                lastDistanceData = dailyDistanceData;

                // Gráficas
                renderChart(dailyDistanceData);
                renderOdoTrendChart(dailyOdoData, dailyDistanceData);

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

            // Period Presets
            const presetButtons = document.querySelectorAll("#period-presets .btn-range");
            const customWrapper = document.getElementById("custom-date-wrapper");

            presetButtons.forEach(btn => {
                btn.addEventListener("click", function() {
                    presetButtons.forEach(b => b.classList.remove("active"));
                    this.classList.add("active");

                    const period = this.getAttribute("data-period");
                    if (period) {
                        selectedPeriod = period;
                        customWrapper.style.display = "none";
                        calculateDistance();
                    } else if (this.id === "btn-custom-range") {
                        selectedPeriod = "custom";
                        customWrapper.style.display = "block";
                    }
                });
            });

            const timeframeSelectOdo = document.getElementById("trend-timeframe-select-odo");
            if (timeframeSelectOdo) {
                timeframeSelectOdo.addEventListener("change", function(e) {
                    trendGrouping = e.target.value;
                    if (Object.keys(lastOdoData).length > 0) {
                        renderOdoTrendChart(lastOdoData, lastDistanceData);
                    }
                });
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
