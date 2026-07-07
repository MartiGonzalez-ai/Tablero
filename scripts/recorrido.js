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
    let trendGrouping = "day";
    let dailyGrouping = "day";
    let lastOdoData = {};
    let lastDistanceData = {};
    let selectedPeriod = "month"; // Default period
    let selectedDeviceIds = []; // Array of selected device IDs
    let customDateFrom = ""; // Custom range starting date
    let customDateTo = ""; // Custom range ending date

    // Pagination State
    let currentPage = 1;
    const itemsPerPage = 10;
    let currentTableData = [];

    // DOM Elements
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

    const renderTablePage = () => {
        const tbody = document.getElementById("daily-recorrido-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = currentTableData.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

        if (currentPage > totalPages) currentPage = totalPages;

        const startIdx = (currentPage - 1) * itemsPerPage;
        const endIdx = Math.min(startIdx + itemsPerPage, totalItems);
        const pageData = currentTableData.slice(startIdx, endIdx);

        pageData.forEach(row => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="date-td">${row.date}</td>
                <td class="device-td" style="font-weight: 500;">${row.device}</td>
                <td class="dist-td" style="text-align: right; color: var(--color-primary); font-weight: 600;">${row.dist.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</td>
                <td class="odo-td" style="text-align: right; font-weight: 700;">${row.odo.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</td>
            `;
            tbody.appendChild(tr);
        });

        // Update UI controls
        const btnPrev = document.getElementById("btn-prev-page");
        const btnNext = document.getElementById("btn-next-page");
        const pageIndicator = document.getElementById("page-indicator");
        const paginationInfo = document.getElementById("pagination-info");
        const paginationContainer = document.getElementById("pagination-controls");

        if (totalItems > 0) {
            if (paginationContainer) paginationContainer.style.display = "flex";
            if (paginationInfo) paginationInfo.textContent = `Mostrando ${startIdx + 1} - ${endIdx} de ${totalItems} registros`;
            if (pageIndicator) pageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
            if (btnPrev) btnPrev.disabled = currentPage <= 1;
            if (btnNext) btnNext.disabled = currentPage >= totalPages;
        } else {
            if (paginationContainer) paginationContainer.style.display = "none";
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

    const getWeekNumber = (d) => {
        const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    };

    const renderChart = (dailyDataByDevice) => {
        if (!window.ApexCharts) return;

        const series = [];

        // Get sorted unique dates across all devices
        const allDates = new Set();
        Object.values(dailyDataByDevice).forEach(deviceData => {
            Object.keys(deviceData).forEach(d => allDates.add(d));
        });
        const sortedDates = Array.from(allDates).sort();

        // For each selected device, construct its series
        selectedDeviceIds.forEach(deviceId => {
            const dev = units.find(u => u.id === deviceId);
            const name = dev ? dev.name : "Unidad";
            const dailyData = dailyDataByDevice[deviceId] || {};
            const grouped = {};

            if (dailyGrouping === "day") {
                sortedDates.forEach(d => {
                    grouped[d] = dailyData[d] || 0;
                });
            } else if (dailyGrouping === "week") {
                sortedDates.forEach(dateStr => {
                    const d = new Date(dateStr + "T12:00:00");
                    const day = d.getDay();
                    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                    const monday = new Date(d.setDate(diff));
                    const weekKey = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, '0') + "-" + String(monday.getDate()).padStart(2, '0');
                    if (!grouped[weekKey]) grouped[weekKey] = 0;
                    grouped[weekKey] += dailyData[dateStr] || 0;
                });
            } else if (dailyGrouping === "month") {
                sortedDates.forEach(dateStr => {
                    const monthKey = dateStr.substring(0, 7) + "-01";
                    if (!grouped[monthKey]) grouped[monthKey] = 0;
                    grouped[monthKey] += dailyData[dateStr] || 0;
                });
            } else if (dailyGrouping === "bimester") {
                sortedDates.forEach(dateStr => {
                    const month = parseInt(dateStr.substring(5, 7));
                    const year = dateStr.substring(0, 4);
                    const bimesterStartMonth = Math.floor((month - 1) / 2) * 2 + 1;
                    const bKey = year + "-" + String(bimesterStartMonth).padStart(2, '0') + "-01";
                    if (!grouped[bKey]) grouped[bKey] = 0;
                    grouped[bKey] += dailyData[dateStr] || 0;
                });
            } else if (dailyGrouping === "trimester") {
                sortedDates.forEach(dateStr => {
                    const month = parseInt(dateStr.substring(5, 7));
                    const year = dateStr.substring(0, 4);
                    const trimesterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
                    const tKey = year + "-" + String(trimesterStartMonth).padStart(2, '0') + "-01";
                    if (!grouped[tKey]) grouped[tKey] = 0;
                    grouped[tKey] += dailyData[dateStr] || 0;
                });
            } else if (dailyGrouping === "6months") {
                sortedDates.forEach(dateStr => {
                    const month = parseInt(dateStr.substring(5, 7));
                    const year = dateStr.substring(0, 4);
                    const semesterStartMonth = Math.floor((month - 1) / 6) * 6 + 1;
                    const sKey = year + "-" + String(semesterStartMonth).padStart(2, '0') + "-01";
                    if (!grouped[sKey]) grouped[sKey] = 0;
                    grouped[sKey] += dailyData[dateStr] || 0;
                });
            } else if (dailyGrouping === "year") {
                sortedDates.forEach(dateStr => {
                    const yearKey = dateStr.substring(0, 4) + "-01-01";
                    if (!grouped[yearKey]) grouped[yearKey] = 0;
                    grouped[yearKey] += dailyData[dateStr] || 0;
                });
            }

            const dataPoints = [];

            if (dailyGrouping === "day") {
                Object.keys(grouped).sort().forEach(d => {
                    dataPoints.push({ x: d, y: parseFloat(grouped[d].toFixed(1)) });
                });
            } else if (dailyGrouping === "week") {
                Object.keys(grouped).sort().forEach(weekKey => {
                    const d = new Date(weekKey + "T12:00:00");
                    const weekNum = getWeekNumber(d);
                    dataPoints.push({ x: "Semana " + weekNum, y: parseFloat(grouped[weekKey].toFixed(1)) });
                });
            } else if (dailyGrouping === "month") {
                Object.keys(grouped).sort().forEach(monthKey => {
                    const d = new Date(monthKey + "T12:00:00");
                    const label = d.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                    const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
                    dataPoints.push({ x: capitalized, y: parseFloat(grouped[monthKey].toFixed(1)) });
                });
            } else if (dailyGrouping === "bimester") {
                Object.keys(grouped).sort().forEach(key => {
                    const d1 = new Date(key + "T12:00:00");
                    const d2 = new Date(d1); d2.setMonth(d2.getMonth() + 1);
                    const l1 = d1.toLocaleDateString("es-MX", { month: "short" });
                    const l2 = d2.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                    const label = l1.charAt(0).toUpperCase() + l1.slice(1) + " - " + l2.charAt(0).toUpperCase() + l2.slice(1);
                    dataPoints.push({ x: label, y: parseFloat(grouped[key].toFixed(1)) });
                });
            } else if (dailyGrouping === "trimester") {
                Object.keys(grouped).sort().forEach(key => {
                    const d = new Date(key + "T12:00:00");
                    const q = Math.floor(d.getMonth() / 3) + 1;
                    dataPoints.push({ x: "T" + q + " " + d.getFullYear(), y: parseFloat(grouped[key].toFixed(1)) });
                });
            } else if (dailyGrouping === "6months") {
                Object.keys(grouped).sort().forEach(key => {
                    const d = new Date(key + "T12:00:00");
                    const sem = d.getMonth() < 6 ? "1er Sem" : "2do Sem";
                    dataPoints.push({ x: sem + " " + d.getFullYear(), y: parseFloat(grouped[key].toFixed(1)) });
                });
            } else if (dailyGrouping === "year") {
                Object.keys(grouped).sort().forEach(key => {
                    dataPoints.push({ x: key.substring(0, 4), y: parseFloat(grouped[key].toFixed(1)) });
                });
            }

            series.push({
                name: name,
                data: dataPoints
            });
        });

        const categories = series.length > 0 ? series[0].data.map(p => p.x) : [];

        const options = {
            series: series,
            chart: {
                type: 'bar',
                height: 260,
                width: '100%',
                stacked: selectedDeviceIds.length > 1,
                toolbar: { show: false },
                fontFamily: "'Inter', sans-serif"
            },
            colors: ['#003666', '#00b1e1', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#3b82f6'],
            plotOptions: {
                bar: {
                    borderRadius: 3,
                    columnWidth: '55%',
                }
            },
            dataLabels: {
                enabled: dailyGrouping !== "day" && selectedDeviceIds.length <= 3,
                formatter: (val) => val.toLocaleString("es-MX", { maximumFractionDigits: 1 }),
                style: { fontSize: '10px', colors: ['#fff'] }
            },
            xaxis: {
                type: 'category',
                categories: categories,
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    rotate: -45,
                    formatter: function (value) {
                        if (dailyGrouping !== 'day') return value;
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
    const renderOdoTrendChart = (odoDataByDevice, dailyDistanceDataByDevice) => {
        if (!window.ApexCharts) return;

        const series = [];

        // Get sorted unique dates across all devices
        const allDates = new Set();
        Object.values(odoDataByDevice).forEach(deviceData => {
            Object.keys(deviceData).forEach(d => allDates.add(d));
        });
        const sortedDates = Array.from(allDates).sort();

        selectedDeviceIds.forEach(deviceId => {
            const dev = units.find(u => u.id === deviceId);
            const name = dev ? dev.name : "Unidad";
            const odoData = odoDataByDevice[deviceId] || {};
            const grouped = {};

            if (trendGrouping === "day") {
                sortedDates.forEach(d => {
                    grouped[d] = odoData[d] || 0;
                });
            } else if (trendGrouping === "week") {
                sortedDates.forEach(dateStr => {
                    const d = new Date(dateStr + "T12:00:00");
                    const day = d.getDay();
                    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                    const monday = new Date(d.setDate(diff));
                    const weekKey = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, '0') + "-" + String(monday.getDate()).padStart(2, '0');

                    if (odoData[dateStr] !== undefined) {
                        if (!grouped[weekKey] || new Date(dateStr) > new Date(grouped[weekKey].lastDate)) {
                            grouped[weekKey] = { odo: odoData[dateStr], lastDate: dateStr };
                        }
                    }
                });
            } else if (trendGrouping === "month") {
                sortedDates.forEach(dateStr => {
                    const monthKey = dateStr.substring(0, 7) + "-01";
                    if (odoData[dateStr] !== undefined) {
                        if (!grouped[monthKey] || new Date(dateStr) > new Date(grouped[monthKey].lastDate)) {
                            grouped[monthKey] = { odo: odoData[dateStr], lastDate: dateStr };
                        }
                    }
                });
            } else if (trendGrouping === "bimester") {
                sortedDates.forEach(dateStr => {
                    const month = parseInt(dateStr.substring(5, 7));
                    const year = dateStr.substring(0, 4);
                    const bimesterStartMonth = Math.floor((month - 1) / 2) * 2 + 1;
                    const bKey = year + "-" + String(bimesterStartMonth).padStart(2, '0') + "-01";
                    if (odoData[dateStr] !== undefined) {
                        if (!grouped[bKey] || new Date(dateStr) > new Date(grouped[bKey].lastDate)) {
                            grouped[bKey] = { odo: odoData[dateStr], lastDate: dateStr };
                        }
                    }
                });
            } else if (trendGrouping === "trimester") {
                sortedDates.forEach(dateStr => {
                    const month = parseInt(dateStr.substring(5, 7));
                    const year = dateStr.substring(0, 4);
                    const trimesterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
                    const tKey = year + "-" + String(trimesterStartMonth).padStart(2, '0') + "-01";
                    if (odoData[dateStr] !== undefined) {
                        if (!grouped[tKey] || new Date(dateStr) > new Date(grouped[tKey].lastDate)) {
                            grouped[tKey] = { odo: odoData[dateStr], lastDate: dateStr };
                        }
                    }
                });
            } else if (trendGrouping === "6months") {
                sortedDates.forEach(dateStr => {
                    const month = parseInt(dateStr.substring(5, 7));
                    const year = dateStr.substring(0, 4);
                    const semesterStartMonth = Math.floor((month - 1) / 6) * 6 + 1;
                    const sKey = year + "-" + String(semesterStartMonth).padStart(2, '0') + "-01";
                    if (odoData[dateStr] !== undefined) {
                        if (!grouped[sKey] || new Date(dateStr) > new Date(grouped[sKey].lastDate)) {
                            grouped[sKey] = { odo: odoData[dateStr], lastDate: dateStr };
                        }
                    }
                });
            } else if (trendGrouping === "year") {
                sortedDates.forEach(dateStr => {
                    const yearKey = dateStr.substring(0, 4) + "-01-01";
                    if (odoData[dateStr] !== undefined) {
                        if (!grouped[yearKey] || new Date(dateStr) > new Date(grouped[yearKey].lastDate)) {
                            grouped[yearKey] = { odo: odoData[dateStr], lastDate: dateStr };
                        }
                    }
                });
            }

            const trendSeries = [];

            if (trendGrouping === "day") {
                Object.keys(grouped).sort().forEach(d => {
                    trendSeries.push({ x: d, y: parseFloat(grouped[d].toFixed(1)) });
                });
            } else {
                Object.keys(grouped).sort().forEach(key => {
                    let label = key;
                    if (trendGrouping === "week") {
                        const d = new Date(key + "T12:00:00");
                        label = "Semana " + getWeekNumber(d);
                    } else if (trendGrouping === "month") {
                        const d = new Date(key + "T12:00:00");
                        const rawLabel = d.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                        label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
                    } else if (trendGrouping === "bimester") {
                        const d1 = new Date(key + "T12:00:00");
                        const d2 = new Date(d1); d2.setMonth(d2.getMonth() + 1);
                        const l1 = d1.toLocaleDateString("es-MX", { month: "short" });
                        const l2 = d2.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                        label = l1.charAt(0).toUpperCase() + l1.slice(1) + " - " + l2.charAt(0).toUpperCase() + l2.slice(1);
                    } else if (trendGrouping === "trimester") {
                        const d = new Date(key + "T12:00:00");
                        const q = Math.floor(d.getMonth() / 3) + 1;
                        label = "T" + q + " " + d.getFullYear();
                    } else if (trendGrouping === "6months") {
                        const d = new Date(key + "T12:00:00");
                        const sem = d.getMonth() < 6 ? "1er Sem" : "2do Sem";
                        label = sem + " " + d.getFullYear();
                    } else if (trendGrouping === "year") {
                        label = key.substring(0, 4);
                    }
                    trendSeries.push({ x: label, y: parseFloat(grouped[key].odo.toFixed(1)) });
                });
            }

            series.push({
                name: name,
                data: trendSeries
            });
        });

        const categories = series.length > 0 ? series[0].data.map(p => p.x) : [];

        const options = {
            series: series,
            chart: {
                type: 'line',
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
            colors: ["#00b1e1", "#003666", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6"],
            dataLabels: {
                enabled: trendGrouping !== "day" && selectedDeviceIds.length <= 2,
                formatter: (val) => Math.round(val).toLocaleString("es-MX"),
                offsetY: -6,
                style: { fontSize: '10px', fontWeight: '700', colors: ["#003666"] }
            },
            markers: {
                size: trendGrouping === "day" ? 0 : 4,
                colors: ['#fff'],
                strokeWidth: 2,
                hover: { size: 7 }
            },
            xaxis: {
                type: "category",
                categories: categories,
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
    // --- Data Loaders ---
    const loadUnits = () => {
        api.call("Get", {
            typeName: "Device"
        }, (result) => {
            units = result || [];
            // Sort by name
            units.sort((a, b) => a.name.localeCompare(b.name));

            // Select the first device by default if none selected
            if (units.length > 0 && selectedDeviceIds.length === 0) {
                selectedDeviceIds.push(units[0].id);
            }

            renderUnitOptionsList();
            updateUnitSelectTriggerText();
        }, (err) => {
            console.error("Error loading devices:", err);
            showError("No se pudieron cargar las unidades.");
        });
    };

    const renderUnitOptionsList = (filterText = "") => {
        const listContainer = document.getElementById("unit-options-list");
        if (!listContainer) return;
        listContainer.innerHTML = "";

        const query = filterText.toLowerCase().trim();
        const filteredUnits = units.filter(d => d.name.toLowerCase().includes(query));

        if (filteredUnits.length === 0) {
            const empty = document.createElement("div");
            empty.className = "multiselect-empty";
            empty.textContent = "No se encontraron unidades";
            listContainer.appendChild(empty);
            return;
        }

        filteredUnits.forEach(device => {
            const optionDiv = document.createElement("div");
            optionDiv.className = "multiselect-option";
            
            const isChecked = selectedDeviceIds.includes(device.id);
            
            optionDiv.innerHTML = `
                <input type="checkbox" value="${device.id}" ${isChecked ? "checked" : ""}>
                <span>${device.name}</span>
            `;
            
            // Checkbox change or label click
            optionDiv.addEventListener("click", (e) => {
                const checkbox = optionDiv.querySelector('input[type="checkbox"]');
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                }
                toggleDeviceSelection(device.id, checkbox.checked);
            });
            
            listContainer.appendChild(optionDiv);
        });
    };

    const toggleDeviceSelection = (deviceId, isSelected) => {
        if (isSelected) {
            if (!selectedDeviceIds.includes(deviceId)) {
                selectedDeviceIds.push(deviceId);
            }
        } else {
            selectedDeviceIds = selectedDeviceIds.filter(id => id !== deviceId);
        }
        updateUnitSelectTriggerText();
    };

    const updateUnitSelectTriggerText = () => {
        const triggerLabel = document.getElementById("unit-select-label");
        if (!triggerLabel) return;
        
        if (selectedDeviceIds.length === 0) {
            triggerLabel.textContent = "Selecciona unidades...";
        } else if (selectedDeviceIds.length === 1) {
            const dev = units.find(u => u.id === selectedDeviceIds[0]);
            triggerLabel.textContent = dev ? dev.name : "1 unidad seleccionada";
        } else if (selectedDeviceIds.length === units.length) {
            triggerLabel.textContent = "Todas las unidades";
        } else {
            triggerLabel.textContent = `${selectedDeviceIds.length} unidades seleccionadas`;
        }
    };

    const getSelectedRange = () => {
        const toDate = new Date();
        const fromDate = new Date();

        if (selectedPeriod === "custom") {
            if (!customDateFrom || !customDateTo) return null;
            const fromD = new Date(customDateFrom + "T00:00:00");
            const toD = new Date(customDateTo + "T23:59:59");
            return { from: fromD, to: toD };
        }

        if (selectedPeriod === "week") {
            const day = toDate.getDay();
            const diff = toDate.getDate() - day + (day === 0 ? -6 : 1);
            fromDate.setDate(diff);
        } else if (selectedPeriod === "month") {
            fromDate.setDate(1);
        } else if (selectedPeriod === "bimester") {
            fromDate.setMonth(toDate.getMonth() - 1);
            fromDate.setDate(1);
        } else if (selectedPeriod === "trimester") {
            fromDate.setMonth(toDate.getMonth() - 2);
            fromDate.setDate(1);
        } else if (selectedPeriod === "semester") {
            fromDate.setMonth(toDate.getMonth() - 5);
            fromDate.setDate(1);
        }

        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
        return { from: fromDate, to: toDate };
    };

    const calculateDistance = () => {
        const range = getSelectedRange();

        if (selectedDeviceIds.length === 0) {
            showError("Por favor, selecciona al menos una unidad.");
            return;
        }
        if (!range) {
            showError("Por favor, selecciona un rango de fechas válido.");
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

        // Build list of API calls
        const calls = [];
        
        // 1. Odometer diagnostics query for each selected device
        selectedDeviceIds.forEach(deviceId => {
            odometerDiagnostics.forEach(diagId => {
                calls.push([
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
            });
        });

        // Query trips from fromDateHistoric to current time to have accurate backward-odo reconstruction
        const queryEndDate = new Date();
        const chunks = [];
        let chunkStart = new Date(fromDateHistoric);
        while (chunkStart < queryEndDate) {
            let chunkEnd = new Date(chunkStart);
            chunkEnd.setDate(chunkEnd.getDate() + 30);
            if (chunkEnd > queryEndDate) chunkEnd = new Date(queryEndDate);
            chunks.push({ start: chunkStart.toISOString(), end: chunkEnd.toISOString() });
            chunkStart = new Date(chunkEnd);
        }

        // 2. Trips query for each selected device in chunks
        selectedDeviceIds.forEach(deviceId => {
            chunks.forEach(chunk => {
                calls.push([
                    "Get",
                    {
                        typeName: "Trip",
                        search: {
                            deviceSearch: { id: deviceId },
                            fromDate: chunk.start,
                            toDate: chunk.end
                        }
                    }
                ]);
            });
        });

        api.multiCall(calls, (results) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            try {
                const totalOdoQueries = selectedDeviceIds.length * odometerDiagnostics.length;
                
                // A. Extract latest odometer data by device
                let odoResultsIdx = 0;
                const odoDataByDevice = {}; // deviceId -> latestOdoData
                
                selectedDeviceIds.forEach(deviceId => {
                    const deviceOdoResults = [];
                    odometerDiagnostics.forEach(() => {
                        const res = results[odoResultsIdx++];
                        if (res) {
                            deviceOdoResults.push(...res);
                        }
                    });
                    
                    const filteredOdo = deviceOdoResults.filter(r => r && r.data !== undefined);
                    if (filteredOdo.length > 0) {
                        filteredOdo.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
                        odoDataByDevice[deviceId] = filteredOdo[0];
                    }
                });

                // B. Extract trips by device
                let tripResultsIdx = totalOdoQueries;
                const tripsByDevice = {}; // deviceId -> trips list
                
                selectedDeviceIds.forEach(deviceId => {
                    tripsByDevice[deviceId] = [];
                    chunks.forEach(() => {
                        const res = results[tripResultsIdx++];
                        if (res) {
                            tripsByDevice[deviceId].push(...res);
                        }
                    });
                });

                // C. Logical reconstruction per device
                const dailyDistanceByDevice = {};
                const dailyOdoByDevice = {};
                const targetOdoKmsByDevice = {};

                selectedDeviceIds.forEach(deviceId => {
                    const latestOdo = odoDataByDevice[deviceId];
                    let currentOdoKms = latestOdo ? (latestOdo.data / 1000) : 0;
                    const odoDateTime = latestOdo ? new Date(latestOdo.dateTime) : new Date();

                    // Deduplicate and sort trips
                    const rawTrips = tripsByDevice[deviceId] || [];
                    const tripsIdSet = new Set();
                    const trips = [];
                    rawTrips.forEach(t => {
                        if (!tripsIdSet.has(t.id)) {
                            tripsIdSet.add(t.id);
                            trips.push(t);
                        }
                    });
                    trips.sort((a, b) => new Date(b.stop || b.start) - new Date(a.stop || a.start));

                    // Initialize daily distance dictionary for this device
                    const dailyDistance = {};
                    for (let i = 0; i < historyDays; i++) {
                        const d = new Date(toDateObj);
                        d.setDate(d.getDate() - i);
                        dailyDistance[getLocalDateString(d)] = 0;
                    }

                    let targetOdoKms = currentOdoKms;

                    trips.forEach(trip => {
                        const tripDist = trip.distance || 0;
                        const tripStart = new Date(trip.start);
                        const tripStop = new Date(trip.stop || trip.start);

                        // Adjust odometer back to target toDateObj
                        if (tripStop <= odoDateTime && tripStop > toDateObj) {
                            targetOdoKms -= tripDist;
                        } else if (tripStop > odoDateTime && tripStop <= toDateObj) {
                            targetOdoKms += tripDist;
                        }

                        // Populate daily distance
                        const dStr = getLocalDateString(tripStart);
                        if (dailyDistance[dStr] !== undefined) {
                            dailyDistance[dStr] += tripDist;
                        }
                    });

                    // Build odometer accumulation per day
                    const dailyOdo = {};
                    const sortedDatesAsc = Object.keys(dailyDistance).sort((a, b) => a.localeCompare(b));
                    const reversedDates = [...sortedDatesAsc].reverse();
                    let currentRunningOdo = targetOdoKms;

                    reversedDates.forEach(date => {
                        dailyOdo[date] = currentRunningOdo;
                        currentRunningOdo -= dailyDistance[date];
                    });

                    dailyDistanceByDevice[deviceId] = dailyDistance;
                    dailyOdoByDevice[deviceId] = dailyOdo;
                    targetOdoKmsByDevice[deviceId] = targetOdoKms;
                });

                // D. Aggregate KPI calculations
                // 1) Estimated Odometer: Sum of latest target odometer values
                let totalTargetOdoKms = 0;
                Object.values(targetOdoKmsByDevice).forEach(val => {
                    totalTargetOdoKms += val;
                });

                // 2) Distance in Period: Sum of daily distances of all selected devices
                let totalDistancePeriod = 0;
                Object.values(dailyDistanceByDevice).forEach(dailyDist => {
                    Object.values(dailyDist).forEach(dVal => {
                        totalDistancePeriod += dVal;
                    });
                });

                // Update UI KPI Cards
                animateCount(distanciaValue, totalTargetOdoKms);
                const distanciaPeriodoValue = document.getElementById("distancia-periodo-value");
                if (distanciaPeriodoValue) {
                    animateCount(distanciaPeriodoValue, totalDistancePeriod);
                }

                // Update date string on card footer
                const rangeDisplay = selectedPeriod === "custom" 
                    ? (formatDateReadable(customDateFrom) + " al " + formatDateReadable(customDateTo))
                    : formatDateReadable(getLocalDateString(toDateObj));
                fechaFooter.textContent = rangeDisplay;

                // E. Populate Table Data
                currentTableData = [];
                selectedDeviceIds.forEach(deviceId => {
                    const dev = units.find(u => u.id === deviceId);
                    const devName = dev ? dev.name : "Unidad";
                    const dailyOdo = dailyOdoByDevice[deviceId] || {};
                    const dailyDistance = dailyDistanceByDevice[deviceId] || {};
                    
                    Object.keys(dailyOdo).forEach(date => {
                        currentTableData.push({
                            date: date,
                            device: devName,
                            dist: dailyDistance[date] || 0,
                            odo: dailyOdo[date] || 0
                        });
                    });
                });

                // Sort table: Date Descending, then Device Name Ascending
                currentTableData.sort((a, b) => {
                    const dateComp = b.date.localeCompare(a.date);
                    if (dateComp !== 0) return dateComp;
                    return a.device.localeCompare(b.device);
                });

                currentPage = 1;
                renderTablePage();

                const labelPeriodo = document.getElementById("label-periodo");
                if (labelPeriodo) labelPeriodo.textContent = `Detalle de odómetro y distancia por día`;

                // Store references for re-grouping options
                lastOdoData = dailyOdoByDevice;
                lastDistanceData = dailyDistanceByDevice;

                // F. Render Charts
                renderChart(dailyDistanceByDevice);
                renderOdoTrendChart(dailyOdoByDevice, dailyDistanceByDevice);

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

            // 1. UNIT MULTISELECT DROPDOWN EVENTS
            const unitSelectTrigger = document.getElementById("unit-select-trigger");
            const unitSelectDropdown = document.getElementById("unit-select-dropdown");
            const unitSearchInput = document.getElementById("unit-search-input");
            const btnSelectAllUnits = document.getElementById("btn-select-all-units");
            const btnClearUnits = document.getElementById("btn-clear-units");

            if (unitSelectTrigger && unitSelectDropdown && !unitSelectTrigger.dataset.hasListener) {
                unitSelectTrigger.dataset.hasListener = "true";
                unitSelectTrigger.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const isVisible = unitSelectDropdown.style.display === "block";
                    unitSelectDropdown.style.display = isVisible ? "none" : "block";
                });
            }

            if (unitSearchInput && !unitSearchInput.dataset.hasListener) {
                unitSearchInput.dataset.hasListener = "true";
                unitSearchInput.addEventListener("input", (e) => {
                    renderUnitOptionsList(e.target.value);
                });
                // Prevent trigger close when clicking search input
                unitSearchInput.addEventListener("click", (e) => {
                    e.stopPropagation();
                });
            }

            if (btnSelectAllUnits && !btnSelectAllUnits.dataset.hasListener) {
                btnSelectAllUnits.dataset.hasListener = "true";
                btnSelectAllUnits.addEventListener("click", (e) => {
                    e.stopPropagation();
                    // Select all currently filtered units
                    const query = unitSearchInput ? unitSearchInput.value.toLowerCase().trim() : "";
                    const filtered = units.filter(d => d.name.toLowerCase().includes(query));
                    
                    filtered.forEach(device => {
                        if (!selectedDeviceIds.includes(device.id)) {
                            selectedDeviceIds.push(device.id);
                        }
                    });
                    
                    renderUnitOptionsList(query);
                    updateUnitSelectTriggerText();
                });
            }

            if (btnClearUnits && !btnClearUnits.dataset.hasListener) {
                btnClearUnits.dataset.hasListener = "true";
                btnClearUnits.addEventListener("click", (e) => {
                    e.stopPropagation();
                    // Clear only selected device IDs that are currently visible in the filter
                    const query = unitSearchInput ? unitSearchInput.value.toLowerCase().trim() : "";
                    const filtered = units.filter(d => d.name.toLowerCase().includes(query));
                    const filteredIds = filtered.map(d => d.id);
                    
                    selectedDeviceIds = selectedDeviceIds.filter(id => !filteredIds.includes(id));
                    
                    renderUnitOptionsList(query);
                    updateUnitSelectTriggerText();
                });
            }

            // 2. DATE PRESET BUTTONS EVENTS
            const presetButtons = document.querySelectorAll("#period-presets .btn-range");
            const customDateWrapper = document.getElementById("custom-date-wrapper");
            const customDateFromInput = document.getElementById("custom-date-from");
            const customDateToInput = document.getElementById("custom-date-to");

            // Set default date values
            if (customDateFromInput && customDateToInput && !customDateFromInput.dataset.hasDefault) {
                customDateFromInput.dataset.hasDefault = "true";
                const todayStr = new Date().toISOString().split('T')[0];
                customDateFromInput.value = todayStr;
                customDateToInput.value = todayStr;
            }

            presetButtons.forEach(btn => {
                if (btn.dataset.hasListener) return;
                btn.dataset.hasListener = "true";
                btn.addEventListener("click", function () {
                    presetButtons.forEach(b => b.classList.remove("active"));
                    this.classList.add("active");

                    const period = this.getAttribute("data-period");
                    if (period) {
                        selectedPeriod = period;
                        if (customDateWrapper) customDateWrapper.style.display = "none";

                        // Set automatic grouping based on the selected period preset
                        const isMultiMonth = (period === "semester" || period === "trimester" || period === "bimester");
                        const newGrouping = isMultiMonth ? "month" : "day";

                        trendGrouping = newGrouping;
                        dailyGrouping = newGrouping;

                        const selectOdo = document.getElementById("trend-timeframe-select-odo");
                        const selectDaily = document.getElementById("trend-timeframe-select-daily");
                        if (selectOdo) selectOdo.value = newGrouping;
                        if (selectDaily) selectDaily.value = newGrouping;

                        calculateDistance();
                    } else if (this.id === "btn-custom-range") {
                        selectedPeriod = "custom";
                        if (customDateWrapper) customDateWrapper.style.display = "flex";
                    }
                });
            });

            // 3. GLOBAL CLICK OUTSIDE TO CLOSE DROP-DOWNS
            if (!document.hasRecorridoClickListener) {
                document.hasRecorridoClickListener = true;
                document.addEventListener("click", (e) => {
                    // Click outside Unit Multiselect
                    const multiselectContainer = document.getElementById("unit-multiselect-container");
                    if (multiselectContainer && !multiselectContainer.contains(e.target)) {
                        if (unitSelectDropdown) {
                            unitSelectDropdown.style.display = "none";
                        }
                    }
                });
            }

            // Pagination Listeners
            const btnPrev = document.getElementById("btn-prev-page");
            const btnNext = document.getElementById("btn-next-page");
            if (btnPrev && !btnPrev.dataset.hasListener) {
                btnPrev.dataset.hasListener = "true";
                btnPrev.addEventListener("click", () => {
                    if (currentPage > 1) {
                        currentPage--;
                        renderTablePage();
                    }
                });
            }
            if (btnNext && !btnNext.dataset.hasListener) {
                btnNext.dataset.hasListener = "true";
                btnNext.addEventListener("click", () => {
                    const totalPages = Math.ceil(currentTableData.length / itemsPerPage);
                    if (currentPage < totalPages) {
                        currentPage++;
                        renderTablePage();
                    }
                });
            }

            // Consultar button click
            if (btnConsultar && !btnConsultar.dataset.hasListener) {
                btnConsultar.dataset.hasListener = "true";
                btnConsultar.addEventListener("click", calculateDistance);
            }

            const timeframeSelectOdo = document.getElementById("trend-timeframe-select-odo");
            if (timeframeSelectOdo && !timeframeSelectOdo.dataset.hasListener) {
                timeframeSelectOdo.dataset.hasListener = "true";
                timeframeSelectOdo.addEventListener("change", function (e) {
                    trendGrouping = e.target.value;
                    if (Object.keys(lastOdoData).length > 0) {
                        renderOdoTrendChart(lastOdoData, lastDistanceData);
                    }
                });
            }

            const timeframeSelectDaily = document.getElementById("trend-timeframe-select-daily");
            if (timeframeSelectDaily && !timeframeSelectDaily.dataset.hasListener) {
                timeframeSelectDaily.dataset.hasListener = "true";
                timeframeSelectDaily.addEventListener("change", function (e) {
                    dailyGrouping = e.target.value;
                    if (Object.keys(lastDistanceData).length > 0) {
                        renderChart(lastDistanceData);
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
