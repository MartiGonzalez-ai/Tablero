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
        // Mostrar solo los últimos 60 días en la gráfica para legibilidad, o todos si son menos
        const recentDates = dates.slice(-60);
        const seriesData = recentDates.map(d => parseFloat(dailyData[d].toFixed(1)));

        const options = {
            series: [{
                name: 'Kilómetros',
                data: seriesData
            }],
            chart: {
                type: 'bar',
                height: 350,
                toolbar: { show: false },
                fontFamily: "'Inter', sans-serif"
            },
            colors: ['#00b1e1'],
            plotOptions: {
                bar: {
                    borderRadius: 6,
                    columnWidth: '60%',
                }
            },
            dataLabels: { enabled: false },
            xaxis: {
                categories: recentDates,
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    rotate: -45,
                    rotateAlways: false
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
                strokeDashArray: 4
            },
            tooltip: {
                theme: 'light',
                y: { formatter: (val) => val.toFixed(1) + " km" }
            }
        };

        if (chartDaily) {
            chartDaily.destroy();
        }

        chartDaily = new ApexCharts(document.querySelector("#chart-daily-recorrido"), options);
        chartDaily.render();
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
        const toDate = dateUntilInput.value;

        if (!deviceId) {
            showError("Por favor, selecciona una unidad.");
            return;
        }
        if (!toDate) {
            showError("Por favor, selecciona una fecha límite.");
            return;
        }

        // Show loading
        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        // Prepare Search
        // Usar final del día local para incluir el último día filtrado
        const searchToDate = new Date(toDate + "T23:59:59").toISOString();

        api.call("Get", {
            typeName: "Trip",
            search: {
                deviceSearch: { id: deviceId },
                fromDate: "2015-01-01T00:00:00",
                toDate: searchToDate,
                resultsLimit: 100000
            }
        }, (trips) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            if (!trips || trips.length === 0) {
                distanciaValue.textContent = "0";
                fechaFooter.textContent = formatDateReadable(toDate);
                resultContainer.style.display = "block";
                showError("No se encontraron viajes para esta unidad hasta la fecha seleccionada.");
                return;
            }

            // 1. Sumar distancia total (Ya vienen en KM)
            let totalKm = 0;
            trips.forEach(trip => {
                if (trip.distance) totalKm += trip.distance;
            });

            // 2. Agrupar por día
            const dailyData = {};
            trips.forEach(trip => {
                if (trip.start && trip.distance) {
                    const dateObj = new Date(trip.start);
                    // Usar fecha local para agrupación
                    const dStr = dateObj.getFullYear() + "-" + String(dateObj.getMonth() + 1).padStart(2, '0') + "-" + String(dateObj.getDate()).padStart(2, '0');
                    if (!dailyData[dStr]) dailyData[dStr] = 0;
                    dailyData[dStr] += trip.distance;
                }
            });

            const sortedDates = Object.keys(dailyData).sort((a, b) => b.localeCompare(a));
            const tbody = document.getElementById("daily-recorrido-tbody");
            const labelPeriodo = document.getElementById("label-periodo");
            
            if (tbody) {
                tbody.innerHTML = "";
                sortedDates.forEach(date => {
                    const tr = document.createElement("tr");
                    const km = dailyData[date];
                    tr.innerHTML = `
                        <td class="date-td">${date}</td>
                        <td class="dist-td" style="text-align: right;">${km.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</td>
                    `;
                    tbody.appendChild(tr);
                });
            }

            if (labelPeriodo && sortedDates.length > 0) {
                labelPeriodo.textContent = `${sortedDates.length} días con registros`;
            }

            // Renderizar Gráfica
            renderChart(dailyData);

            // Refrescar UI (KPI)
            resultContainer.style.display = "block";
            animateCount(distanciaValue, totalKm);
            fechaFooter.textContent = formatDateReadable(toDate);

            if (window.lucide) lucide.createIcons();

            setTimeout(() => {
                resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }, 100);

        }, (err) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("Error fetching trips:", err);
            showError("Error al consultar los datos. Intente con un rango más pequeño si persiste.");
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
