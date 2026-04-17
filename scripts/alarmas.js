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
    let chartTrend = null;
    let chartRuleDist = null;
    let chartUnitRanking = null;
    
    // DOM Elements
    let btnRefresh, lastUpdatedEl, loadingOverlay, errorToast, errorToastMsg, searchInput;
    
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

    const formatDateShort = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
    };

    const formatTimeShort = (isoStr) => {
        if (!isoStr) return "";
        const d = new Date(isoStr);
        return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    };

    const formatDuration = (timeSpan) => {
        if (!timeSpan || timeSpan === "00:00:00") return "—";
        const parts = timeSpan.split(':');
        if (parts.length < 3) return timeSpan;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const s = Math.round(parseFloat(parts[2]));
        const res = [];
        if (h > 0) res.push(h + "h");
        if (m > 0) res.push(m + "m");
        if (s > 0 || res.length === 0) res.push(s + "s");
        return res.join(" ");
    };

    const showError = (msg) => {
        errorToastMsg.textContent = msg;
        errorToast.style.display = "flex";
        setTimeout(() => { errorToast.style.display = "none"; }, 5000);
    };

    const animateCount = (el, target, decimals = 0, suffix = "") => {
        if (!el) return;
        el.classList.remove("skeleton");
        const duration = 1000;
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = target * eased;
            el.textContent = (decimals > 0
                ? current.toFixed(decimals)
                : Math.round(current).toLocaleString("es-MX")) + suffix;
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    // ─── Charts Initialization ──────────────────────────────────────────────
    
    const initCharts = () => {
        // Trend Chart
        const trendOptions = {
            series: [{ name: 'Alarmas', data: [] }],
            chart: {
                type: 'area',
                height: 300,
                toolbar: { show: false },
                fontFamily: 'Inter, sans-serif'
            },
            colors: ['#e11d48'],
            stroke: { curve: 'smooth', width: 3 },
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [20, 100] }
            },
            xaxis: {
                type: 'datetime',
                labels: { style: { colors: '#64748b', fontWeight: 500 } }
            },
            yaxis: {
                labels: { style: { colors: '#64748b' } }
            },
            dataLabels: { enabled: false },
            tooltip: { x: { format: 'dd MMM yyyy' } },
            grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
            noData: { text: 'Cargando datos...', style: { color: '#64748b' } }
        };
        chartTrend = new ApexCharts(document.querySelector("#chart-alarm-trend"), trendOptions);
        chartTrend.render();

        // Rule Distribution (Donut)
        const distOptions = {
            series: [],
            labels: [],
            chart: {
                type: 'donut',
                height: 280,
                fontFamily: 'Inter, sans-serif'
            },
            colors: ['#e11d48', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#64748b'],
            plotOptions: {
                pie: {
                    donut: {
                        size: '70%',
                        labels: {
                            show: true,
                            total: {
                                show: true,
                                label: 'Total',
                                formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0)
                            }
                        }
                    }
                }
            },
            legend: { position: 'bottom' },
            dataLabels: { enabled: false },
            noData: { text: 'Sin datos' }
        };
        chartRuleDist = new ApexCharts(document.querySelector("#chart-rule-dist"), distOptions);
        chartRuleDist.render();

        // Unit Ranking (Bar)
        const rankOptions = {
            series: [{ name: 'Alertas', data: [] }],
            chart: {
                type: 'bar',
                height: 280,
                toolbar: { show: false },
                fontFamily: 'Inter, sans-serif'
            },
            plotOptions: {
                bar: {
                    borderRadius: 6,
                    horizontal: true,
                    distributed: true,
                    barHeight: '60%'
                }
            },
            colors: ['#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'],
            xaxis: {
                categories: [],
                labels: { style: { colors: '#64748b' } }
            },
            yaxis: {
                labels: { style: { colors: '#64748b', fontWeight: 600 } }
            },
            legend: { show: false },
            grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
            noData: { text: 'Sin datos' }
        };
        chartUnitRanking = new ApexCharts(document.querySelector("#chart-unit-ranking"), rankOptions);
        chartUnitRanking.render();
    };

    // ─── Data Processing ────────────────────────────────────────────────────
    
    const processData = (data) => {
        const total = data.length;
        
        // 1. Group by Rule
        const ruleCounts = {};
        data.forEach(ex => {
            const rName = rulesMap[ex.rule.id] ? rulesMap[ex.rule.id].name : "Regla Desconocida";
            ruleCounts[rName] = (ruleCounts[rName] || 0) + 1;
        });
        
        const sortedRules = Object.entries(ruleCounts).sort((a,b) => b[1] - a[1]);
        const topRule = sortedRules.length > 0 ? sortedRules[0] : ["N/A", 0];
        
        // 2. Group by Device
        const deviceCounts = {};
        data.forEach(ex => {
            const dName = deviceMap[ex.device.id] || "Vehículo Desconocido";
            deviceCounts[dName] = (deviceCounts[dName] || 0) + 1;
        });
        
        const sortedDevices = Object.entries(deviceCounts).sort((a,b) => b[1] - a[1]);
        const topDevice = sortedDevices.length > 0 ? sortedDevices[0] : ["N/A", 0];
        const affectedCount = Object.keys(deviceCounts).length;
        
        // 3. Group by Date (Trend)
        const dateCounts = {};
        data.forEach(ex => {
            const dateStr = ex.activeFrom.split('T')[0];
            dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
        });
        
        const trendSeries = Object.entries(dateCounts)
            .map(([date, count]) => ({ x: new Date(date).getTime(), y: count }))
            .sort((a,b) => a.x - b.x);
            
        // 4. Update KPIs
        animateCount(document.getElementById("stat-total-alarms"), total);
        
        const elTopRule = document.getElementById("stat-top-rule");
        if (elTopRule) {
            elTopRule.classList.remove("skeleton");
            elTopRule.textContent = topRule[0];
            elTopRule.title = topRule[0];
        }
        document.getElementById("stat-top-rule-count").textContent = `${topRule[1]} activaciones`;
        
        animateCount(document.getElementById("stat-affected-units"), affectedCount);
        
        const elTopUnit = document.getElementById("stat-top-unit");
        if (elTopUnit) {
            elTopUnit.classList.remove("skeleton");
            elTopUnit.textContent = topDevice[0];
        }
        document.getElementById("stat-top-unit-count").textContent = `${topDevice[1]} alertas`;
        
        document.getElementById("stat-period-badge").textContent = isCustomRange ? "En rango personalizado" : `Últimos ${selectedDays} días`;

        // 5. Update Charts
        chartTrend.updateSeries([{ name: 'Alarmas', data: trendSeries }]);
        
        const distSeries = sortedRules.slice(0, 6).map(r => r[1]);
        const distLabels = sortedRules.slice(0, 6).map(r => r[0]);
        chartRuleDist.updateOptions({ series: distSeries, labels: distLabels });
        
        const rankSeries = sortedDevices.slice(0, 10).map(d => d[1]);
        const rankLabels = sortedDevices.slice(0, 10).map(d => d[0]);
        chartUnitRanking.updateOptions({
            series: [{ name: 'Alertas', data: rankSeries }],
            xaxis: { categories: rankLabels }
        });
        
        // 6. Update Table
        renderTable(data);
    };

    const renderTable = (data) => {
        const tbody = document.getElementById("alarms-tbody");
        const emptyEl = document.getElementById("table-empty");
        const badgeTable = document.getElementById("badge-table");
        
        if (!tbody) return;
        tbody.innerHTML = "";
        
        if (badgeTable) badgeTable.textContent = `${data.length} alertas`;
        
        if (data.length === 0) {
            emptyEl.style.display = "flex";
            return;
        }
        emptyEl.style.display = "none";
        
        // Sort newest first
        const sorted = [...data].sort((a,b) => new Date(b.activeFrom) - new Date(a.activeFrom));
        
        sorted.forEach(ex => {
            const tr = document.createElement("tr");
            const dName = deviceMap[ex.device.id] || "Desconocido";
            const rInfo = rulesMap[ex.rule.id] || { name: "Regla Desconocida" };
            
            // Determine severity for badge (this is arbitrary logic for demonstration)
            let badgeClass = "rule-badge--info";
            const ruleName = rInfo.name.toLowerCase();
            if (ruleName.includes("velocidad") || ruleName.includes("frenado") || ruleName.includes("aceleración")) {
                badgeClass = "rule-badge--warning";
            }
            if (ruleName.includes("accidente") || ruleName.includes("pánico")) {
                badgeClass = "rule-badge--danger";
            }

            const mapLink = ex.device && ex.device.id 
                ? `<a href="#" class="location-link" onclick="console.log('Ver en mapa: ${ex.device.id}'); return false;">
                    <i data-lucide="map-pin" width="12" height="12"></i> Ver Mapa
                   </a>`
                : "—";

            tr.innerHTML = `
                <td style="padding: 1rem;">
                    <div class="unit-chip">
                        <div class="unit-dot"></div>
                        <span>${dName}</span>
                    </div>
                </td>
                <td style="padding: 1rem;">
                    <span class="rule-badge ${badgeClass}">${rInfo.name}</span>
                </td>
                <td style="padding: 1rem;">
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(ex.activeFrom)}</span>
                        <span class="date-time">${formatTimeShort(ex.activeFrom)}</span>
                    </div>
                </td>
                <td style="padding: 1rem; font-weight: 500; font-family: monospace;">${formatDuration(ex.duration)}</td>
                <td style="padding: 1rem;">${mapLink}</td>
            `;
            tbody.appendChild(tr);
        });
        
        if (typeof lucide !== "undefined") lucide.createIcons();
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
        calls.push(["Get", { typeName: "Device", search: { fromDate: new Date().toISOString() } }]);
        
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
                rawDevices.sort((a,b) => a.name.localeCompare(b.name)).forEach(d => {
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

    // ─── Export to Excel ─────────────────────────────────────────────────────
    
    const exportToExcel = () => {
        if (!exceptions || exceptions.length === 0) {
            showError("No hay datos para exportar.");
            return;
        }
        
        const dataForExcel = exceptions.map(ex => ({
            "Unidad": deviceMap[ex.device.id] || ex.device.id,
            "Regla": rulesMap[ex.rule.id] ? rulesMap[ex.rule.id].name : ex.rule.id,
            "Inicio": new Date(ex.activeFrom).toLocaleString("es-MX"),
            "Fin": ex.activeTo ? new Date(ex.activeTo).toLocaleString("es-MX") : "En curso",
            "Duración": ex.duration,
            "ID de Regla": ex.rule.id,
            "ID de Dispositivo": ex.device.id
        }));
        
        const ws = XLSX.utils.json_to_sheet(dataForExcel);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Alarmas");
        XLSX.writeFile(wb, `Reporte_Alarmas_${new Date().toISOString().split('T')[0]}.xlsx`);
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
            searchInput = document.getElementById("search-input");
            
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
            
            if (searchInput) {
                searchInput.addEventListener("input", (e) => {
                    const term = e.target.value.toLowerCase();
                    const filtered = exceptions.filter(ex => {
                        const dName = (deviceMap[ex.device.id] || "").toLowerCase();
                        const rName = (rulesMap[ex.rule.id] ? rulesMap[ex.rule.id].name : "").toLowerCase();
                        return dName.includes(term) || rName.includes(term);
                    });
                    renderTable(filtered);
                });
            }
            
            const exportBtn = document.querySelector(".btn-export-excel");
            if (exportBtn) {
                exportBtn.addEventListener("click", exportToExcel);
            }
            
            // Custom Date Range Logic (Simplificado para este ejemplo)
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
