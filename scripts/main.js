"use strict";

window.openMapModal = function (lat, lng) {
    const modal = document.getElementById("map-modal");
    const iframe = document.getElementById("map-iframe");
    if (modal && iframe) {
        iframe.src = `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=18&output=embed`;
        modal.classList.add("open");
    }
};

window.closeMapModal = function () {
    const modal = document.getElementById("map-modal");
    const iframe = document.getElementById("map-iframe");
    if (modal) {
        modal.classList.remove("open");
        setTimeout(() => { if (iframe) iframe.src = ""; }, 300);
    }
};

geotab.addin.dashboard = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    let allFillups = [];       // All raw FillUp records
    let filteredFillups = [];  // After search filter

    // Chart instances
    let chartMonthly, chartDow, chartHistogram, chartHeatmap;

    // ─── DOM refs ────────────────────────────────────────────────────────────
    let btnRefresh, lastUpdatedEl, errorToast, errorToastMsg, searchInput;

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

    const formatDateTime = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleString("es-MX", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
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

    const formatDuration = (seconds) => {
        if (!seconds && seconds !== 0) return "—";
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    };

    const formatOdometer = (meters) => {
        if (!meters && meters !== 0) return "—";
        return `${Math.round(meters / 1000).toLocaleString("es-MX")} km`;
    };

    const formatVolume = (liters) => {
        if (!liters && liters !== 0) return "—";
        return `${(+liters).toFixed(1)} L`;
    };

    const getDeviceName = (fillup) => {
        return (fillup.device && fillup.device.name)
            ? fillup.device.name
            : (fillup.device && fillup.device.id ? fillup.device.id : "Desconocido");
    };

    const getDriverName = (fillup) => {
        return (fillup.driver && fillup.driver.name)
            ? fillup.driver.name
            : (fillup.driver && fillup.driver.id && fillup.driver.id !== "UnknownDriverId" ? fillup.driver.id : "Desconocido");
    };

    const getFuelTypeLabel = (fillup) => {
        const ft = fillup.fuelType || fillup.tankCapacity || null;
        if (!ft) return "—";
        return String(ft);
    };

    const showError = (msg) => {
        errorToastMsg.textContent = msg;
        errorToast.style.display = "flex";
        setTimeout(() => { errorToast.style.display = "none"; }, 5000);
    };

    const removeSkeleton = (...ids) => {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove("skeleton");
        });
    };

    const animateCount = (el, target, decimals = 0) => {
        const duration = 900;
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = target * eased;
            el.textContent = decimals > 0
                ? current.toFixed(decimals).toLocaleString("es-MX")
                : Math.round(current).toLocaleString("es-MX");
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    // ─── Render summary KPIs ─────────────────────────────────────────────────
    const renderSummary = (fillups) => {
        const total = fillups.length;
        const totalLitros = fillups.reduce((s, f) => s + (parseFloat(f.derivedVolume) || 0), 0);
        const promedio = total > 0 ? totalLitros / total : 0;

        const deviceSet = new Set(fillups.map(f => getDeviceName(f)));
        const unidades = deviceSet.size;

        // Most recent
        let ultimo = null;
        fillups.forEach(f => {
            if (!ultimo || new Date(f.dateTime) > new Date(ultimo.dateTime)) ultimo = f;
        });

        // Animate counters
        const totalEl = document.getElementById("stat-total");
        const litrosEl = document.getElementById("stat-litros");
        const promedioEl = document.getElementById("stat-promedio");
        const unidadesEl = document.getElementById("stat-unidades");

        if (totalEl) { totalEl.classList.remove("skeleton"); animateCount(totalEl, total); }
        if (litrosEl) { litrosEl.classList.remove("skeleton"); animateCount(litrosEl, Math.round(totalLitros)); }
        if (promedioEl) { promedioEl.classList.remove("skeleton"); promedioEl.textContent = promedio.toFixed(1) + " L"; }
        if (unidadesEl) { unidadesEl.classList.remove("skeleton"); animateCount(unidadesEl, unidades); }

        // Last fill-up
        const ultimoFechaEl = document.getElementById("stat-ultimo-fecha");
        const ultimoUnidadEl = document.getElementById("stat-ultimo-unidad");
        if (ultimoFechaEl) {
            ultimoFechaEl.classList.remove("skeleton");
            ultimoFechaEl.textContent = ultimo ? formatDateShort(ultimo.dateTime) : "Sin datos";
        }
        if (ultimoUnidadEl) {
            ultimoUnidadEl.classList.remove("skeleton");
            ultimoUnidadEl.textContent = ultimo
                ? `${getDeviceName(ultimo)} · ${formatTimeShort(ultimo.dateTime)}`
                : "—";
        }

        // Badge
        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) {
            badgeRanking.classList.remove("skeleton");
            badgeRanking.textContent = `${deviceSet.size} unidades`;
        }

        // Stat sub for total
        const totalBadge = document.getElementById("stat-total-badge");
        if (totalBadge) totalBadge.textContent = isCustomRange ? "rango personalizado" : `últimos ${selectedDays} días`;
    };

    // ─── Render ranking list ──────────────────────────────────────────────────
    const renderRanking = (fillups) => {
        const byDevice = {};
        const litrosByDevice = {};
        fillups.forEach(f => {
            const name = getDeviceName(f);
            byDevice[name] = (byDevice[name] || 0) + 1;
            litrosByDevice[name] = (litrosByDevice[name] || 0) + (parseFloat(f.derivedVolume) || 0);
        });

        const items = Object.entries(byDevice)
            .map(([name, count]) => ({ name, count, litros: litrosByDevice[name] || 0 }))
            .sort((a, b) => b.count - a.count);

        const maxCount = items.length > 0 ? items[0].count : 1;

        const ul = document.getElementById("ranking-list");
        if (!ul) return;
        ul.innerHTML = "";

        if (items.length === 0) {
            ul.innerHTML = `<li class="ranking-empty">Sin datos en el periodo seleccionado</li>`;
            return;
        }

        items.forEach((item, idx) => {
            const pct = Math.round((item.count / maxCount) * 100);
            const li = document.createElement("li");
            li.className = "ranking-item";
            li.innerHTML = `
                <div class="ranking-pos">${idx + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${item.name}</div>
                    <div class="ranking-bar-wrap">
                        <div class="ranking-bar" style="width:${pct}%"></div>
                    </div>
                </div>
                <div class="ranking-stats">
                    <span class="ranking-count">${item.count}</span>
                    <span class="ranking-liters">${item.litros.toFixed(0)} L</span>
                </div>
            `;
            ul.appendChild(li);
        });
    };

    // ─── Render table ─────────────────────────────────────────────────────────
    const renderTable = (fillups) => {
        const tbody = document.getElementById("fillup-tbody");
        const emptyEl = document.getElementById("table-empty");
        const badgeTable = document.getElementById("badge-table");

        if (!tbody) return;
        tbody.innerHTML = "";

        if (badgeTable) badgeTable.textContent = `${fillups.length} registros`;

        if (fillups.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        // Sort by most recent first
        const sorted = [...fillups].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        sorted.forEach(f => {
            const tr = document.createElement("tr");
            tr.className = "fillup-row";
            const vol = parseFloat(f.derivedVolume) || 0;
            const volClass = vol > 50 ? "vol-high" : vol > 20 ? "vol-mid" : "vol-low";

            tr.innerHTML = `
                <td class="col-unit">
                    <div class="unit-chip">
                        <div class="unit-dot"></div>
                        <span>${getDeviceName(f)}</span>
                    </div>
                </td>
                <td class="col-driver">${getDriverName(f)}</td>
                <td class="col-date">
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(f.dateTime)}</span>
                        <span class="date-time">${formatTimeShort(f.dateTime)}</span>
                    </div>
                </td>
                <td class="col-vol">
                    <span class="vol-badge ${volClass}">${formatVolume(f.derivedVolume)}</span>
                </td>
                <td class="col-odo">${formatOdometer(f.odometer)}</td>
                <td class="col-map">
                    ${f.location ? `<button class="btn-map" onclick="window.openMapModal(${f.location.y}, ${f.location.x})"><i data-lucide="map-pin" width="14" height="14"></i> Ver Mapa</button>` : "—"}
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Render raw table (all data) ──────────────────────────────────────────
    const renderRawTable = (fillups) => {
        const thead = document.getElementById("raw-thead");
        const tbody = document.getElementById("raw-tbody");
        if (!thead || !tbody) return;

        if (fillups.length === 0) {
            thead.innerHTML = "<tr><th>Sin datos</th></tr>";
            tbody.innerHTML = "<tr><td style=\"text-align:center; padding: 2rem;\">No se encontraron llenados en el periodo seleccionado.</td></tr>";
            return;
        }

        // Collect all unique keys from all objects
        const keySet = new Set();
        fillups.forEach(f => {
            Object.keys(f).forEach(k => keySet.add(k));
        });

        // Sort keys alphabetically but prioritize common ones
        const priorityKeys = ["device", "dateTime", "derivedVolume", "location", "odometer"];
        const columns = Array.from(keySet).sort((a, b) => {
            const pA = priorityKeys.indexOf(a);
            const pB = priorityKeys.indexOf(b);
            if (pA !== -1 && pB !== -1) return pA - pB;
            if (pA !== -1) return -1;
            if (pB !== -1) return 1;
            return a.localeCompare(b);
        });

        // Header
        const trHead = document.createElement("tr");
        columns.forEach(col => {
            const th = document.createElement("th");
            th.textContent = col;
            trHead.appendChild(th);
        });
        thead.innerHTML = "";
        thead.appendChild(trHead);

        // Body
        tbody.innerHTML = "";
        fillups.forEach(f => {
            const tr = document.createElement("tr");
            columns.forEach(col => {
                const td = document.createElement("td");
                let val = f[col];
                if (val !== null && typeof val === "object") {
                    val = val.name ? val.name : (val.id ? val.id : JSON.stringify(val));
                }
                td.textContent = (val !== undefined && val !== null && val !== "") ? val : "—";
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    };

    // ─── Reset UI ─────────────────────────────────────────────────────────────
    const resetUI = () => {
        // Summary stats
        ["stat-total", "stat-litros", "stat-promedio", "stat-unidades",
            "stat-ultimo-fecha", "stat-ultimo-unidad"].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.textContent = "—"; el.classList.add("skeleton"); }
            });

        // Ranking
        const ul = document.getElementById("ranking-list");
        if (ul) ul.innerHTML = `
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
            <li class="ranking-skeleton"></li>
        `;

        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) { badgeRanking.textContent = "—"; badgeRanking.classList.add("skeleton"); }

        // Table
        const tbody = document.getElementById("fillup-tbody");
        if (tbody) tbody.innerHTML = `
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
            <tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>
        `;

        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = "—";

        const emptyEl = document.getElementById("table-empty");
        if (emptyEl) emptyEl.style.display = "none";

        // Raw Table
        const rawThead = document.getElementById("raw-thead");
        const rawTbody = document.getElementById("raw-tbody");
        if (rawThead) rawThead.innerHTML = `<tr><th>Cargando...</th></tr>`;
        if (rawTbody) rawTbody.innerHTML = `<tr class="tr-skeleton"><td><div class="td-skel"></div></td></tr>`;

        if (searchInput) searchInput.value = "";
    };

    // ─── Render Charts ────────────────────────────────────────────────────────
    const renderCharts = (fillups) => {
        if (!window.ApexCharts) return;

        const cCyan = "#00b1e1";
        const cBlue = "#003666";
        const cGreen = "#3b753c";
        const textMuted = "#5e6c84";
        const fontFamily = "'Inter', sans-serif";

        const commonOptions = {
            chart: { fontFamily: fontFamily, toolbar: { show: false } },
            dataLabels: { enabled: false },
            tooltip: { theme: 'light' }
        };

        // 1. Monthly Volume (Area Chart)
        const monthlyData = {};
        fillups.forEach(f => {
            if (!f.dateTime) return;
            const d = new Date(f.dateTime);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyData[key] = (monthlyData[key] || 0) + (parseFloat(f.derivedVolume) || 0);
        });

        const sortedMonths = Object.keys(monthlyData).sort();
        const monthSeries = sortedMonths.map(k => Math.round(monthlyData[k]));

        const optMonthly = {
            ...commonOptions,
            series: [{ name: 'Litros', data: monthSeries }],
            chart: { type: 'area', height: 260, toolbar: { show: false }, zoom: { enabled: false } },
            colors: [cCyan],
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
            stroke: { curve: 'smooth', width: 2 },
            xaxis: { categories: sortedMonths, labels: { style: { colors: textMuted } } },
            yaxis: { labels: { formatter: (val) => val.toLocaleString() + " L", style: { colors: textMuted } } },
            noData: { text: "No hay datos para graficar", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartMonthly) chartMonthly.destroy();
        chartMonthly = new ApexCharts(document.querySelector("#chart-monthly"), optMonthly);
        chartMonthly.render();

        // 2. Day of Week Volume
        const dowData = [0, 0, 0, 0, 0, 0, 0];
        fillups.forEach(f => {
            if (!f.dateTime) return;
            dowData[new Date(f.dateTime).getDay()] += parseFloat(f.derivedVolume) || 0;
        });

        // Shift array to start with Lunes
        const dowLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
        const shiftedDowData = [dowData[1], dowData[2], dowData[3], dowData[4], dowData[5], dowData[6], dowData[0]];
        const dowSeries = shiftedDowData.map(v => Math.round(v));

        const optDow = {
            ...commonOptions,
            series: [{ name: 'Litros Totales', data: dowSeries }],
            chart: { type: 'bar', height: 260, toolbar: { show: false } },
            colors: [cBlue],
            plotOptions: { bar: { borderRadius: 4, dataLabels: { position: 'top' } } },
            xaxis: { categories: dowLabels, labels: { style: { colors: textMuted } } },
            yaxis: { labels: { formatter: (val) => val.toLocaleString() + " L", style: { colors: textMuted } } },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartDow) chartDow.destroy();
        chartDow = new ApexCharts(document.querySelector("#chart-dow"), optDow);
        chartDow.render();

        // 3. Volume Histogram
        const bins = { "0-50 L": 0, "51-100 L": 0, "101-150 L": 0, "151-200 L": 0, "+201 L": 0 };
        fillups.forEach(f => {
            const v = parseFloat(f.derivedVolume) || 0;
            if (v <= 50) bins["0-50 L"]++;
            else if (v <= 100) bins["51-100 L"]++;
            else if (v <= 150) bins["101-150 L"]++;
            else if (v <= 200) bins["151-200 L"]++;
            else bins["+201 L"]++;
        });

        const optHist = {
            ...commonOptions,
            series: [{ name: 'Cargas', data: Object.values(bins) }],
            chart: { type: 'bar', height: 260, toolbar: { show: false } },
            colors: [cGreen],
            plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
            dataLabels: { enabled: true, textAnchor: 'start', offsetX: 0, formatter: val => val, style: { colors: ["#fff"] } },
            xaxis: { labels: { style: { colors: textMuted } } },
            yaxis: { categories: Object.keys(bins), labels: { style: { colors: textMuted } } },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };

        if (chartHistogram) chartHistogram.destroy();
        chartHistogram = new ApexCharts(document.querySelector("#chart-histogram"), optHist);
        chartHistogram.render();

        // 4. Heatmap: Cargas por Hora y Día
        const heatmapGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
        fillups.forEach(f => {
            if (!f.dateTime) return;
            const d = new Date(f.dateTime);
            let day = d.getDay() - 1; // 0=Lun
            if (day === -1) day = 6;
            const hour = d.getHours();
            heatmapGrid[day][hour]++;
        });

        const seriesHeatmap = dowLabels.map((dayLabel, dayIdx) => {
            return {
                name: dayLabel,
                data: Array.from({ length: 24 }, (_, hourIdx) => ({
                    x: hourIdx.toString().padStart(2, '0') + 'h',
                    y: heatmapGrid[dayIdx][hourIdx]
                }))
            };
        });

        const optHeatmap = {
            ...commonOptions,
            series: seriesHeatmap,
            chart: { type: 'heatmap', height: 260, toolbar: { show: false } },
            dataLabels: { enabled: false },
            colors: [cCyan],
            plotOptions: {
                heatmap: {
                    shadeIntensity: 0.5,
                    radius: 2,
                    useFillColorAsStroke: false,
                    colorScale: {
                        ranges: [
                            { from: 0, to: 0, color: '#f8fafc', name: '0' },
                            { from: 1, to: 2, color: '#bae6fd', name: '1-2' },
                            { from: 3, to: 6, color: '#0ea5e9', name: '3-6' },
                            { from: 7, to: 1000, color: '#0369a1', name: '>6' }
                        ]
                    }
                }
            },
            xaxis: { labels: { style: { colors: textMuted, fontSize: '10px' } } },
            yaxis: { labels: { style: { colors: textMuted, fontSize: '11px', fontWeight: 600 } } }
        };

        if (chartHeatmap) chartHeatmap.destroy();
        chartHeatmap = new ApexCharts(document.querySelector("#chart-heatmap"), optHeatmap);
        chartHeatmap.render();
    };

    // ─── Filter by search ─────────────────────────────────────────────────────
    const applySearch = (query) => {
        if (!query || query.trim() === "") {
            filteredFillups = [...allFillups];
        } else {
            const q = query.trim().toLowerCase();
            filteredFillups = allFillups.filter(f => getDeviceName(f).toLowerCase().includes(q));
        }
        renderTable(filteredFillups);
        renderRawTable(filteredFillups);
        renderCharts(filteredFillups);
        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = `${filteredFillups.length} registros`;
    };

    // ─── MAIN DATA LOADER ─────────────────────────────────────────────────────
    const loadData = () => {
        resetUI();
        btnRefresh.disabled = true;
        btnRefresh.classList.add("loading");

        const { fromDate, toDate } = getDateRange();

        api.multiCall([
            ["Get", { typeName: "FillUp", search: { fromDate, toDate } }],
            ["Get", { typeName: "Device" }]
        ], (results) => {
            const result = results[0] || [];
            const devices = results[1] || [];

            // Map devices id -> name
            const deviceMap = {};
            devices.forEach(d => { deviceMap[d.id] = d.name; });

            result.forEach((f) => {
                if (f.device && f.device.id && deviceMap[f.device.id]) {
                    f.device.name = deviceMap[f.device.id];
                }
            });

            allFillups = result;
            filteredFillups = [...allFillups];

            renderSummary(allFillups);
            renderRanking(allFillups);
            renderTable(filteredFillups);
            renderRawTable(filteredFillups);
            renderCharts(filteredFillups);

            if (window.lucide) {
                lucide.createIcons();
            }

            const now = new Date();
            lastUpdatedEl.textContent = `Actualizado: ${now.toLocaleTimeString("es-MX", {
                hour: "2-digit", minute: "2-digit", second: "2-digit"
            })}`;

            btnRefresh.disabled = false;
            btnRefresh.classList.remove("loading");
        }, (err) => {
            console.error("Error fetching data:", err);
            showError("Error al cargar los datos. Verifique la conexión.");
            btnRefresh.disabled = false;
            btnRefresh.classList.remove("loading");
        });
    };

    // ─── ADD-IN LIFECYCLE ─────────────────────────────────────────────────────
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            // Initialize Lucide icons
            if (window.lucide) {
                lucide.createIcons();
            }

            btnRefresh = document.getElementById("btn-refresh");
            lastUpdatedEl = document.getElementById("last-updated-time");
            errorToast = document.getElementById("error-toast");
            errorToastMsg = document.getElementById("error-toast-msg");
            searchInput = document.getElementById("search-input");

            // ── Pre-set date range buttons ────────────────────────────────
            document.querySelectorAll(".btn-range[data-days]").forEach(btn => {
                btn.addEventListener("click", () => {
                    document.querySelectorAll(".btn-range").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectedDays = parseInt(btn.dataset.days, 10);
                    isCustomRange = false;
                    customFromDate = null;
                    customToDate = null;
                    const btnCustom = document.getElementById("btn-custom");
                    if (btnCustom) {
                        btnCustom.innerHTML = `
                            <i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i>
                            Personalizado
                        `;
                        if (window.lucide) {
                            lucide.createIcons();
                        }
                    }
                    loadData();
                });
            });

            // ── Custom date range button / popover ────────────────────────
            const btnCustom = document.getElementById("btn-custom");
            const datePopover = document.getElementById("date-popover");
            const dateFromInput = document.getElementById("date-from");
            const dateToInput = document.getElementById("date-to");
            const btnApply = document.getElementById("btn-date-apply");
            const btnCancel = document.getElementById("btn-date-cancel");

            const todayStr = new Date().toISOString().slice(0, 10);
            const weekAgoStr = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
            dateFromInput.value = weekAgoStr;
            dateToInput.value = todayStr;
            dateToInput.max = todayStr;

            const closePopover = () => datePopover.classList.remove("open");

            btnCustom.addEventListener("click", (e) => {
                e.stopPropagation();
                datePopover.classList.toggle("open");
            });

            btnCancel.addEventListener("click", closePopover);

            btnApply.addEventListener("click", () => {
                const from = dateFromInput.value;
                const to = dateToInput.value;
                if (!from || !to) { showError("Selecciona ambas fechas antes de aplicar."); return; }
                if (new Date(from) > new Date(to)) { showError("La fecha 'Desde' no puede ser mayor que 'Hasta'."); return; }

                customFromDate = new Date(from + "T00:00:00").toISOString();
                customToDate = new Date(to + "T23:59:59").toISOString();
                isCustomRange = true;

                const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
                btnCustom.innerHTML = `
                    <i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i>
                    ${fmt(from)} – ${fmt(to)}
                `;
                if (window.lucide) {
                    lucide.createIcons();
                }

                document.querySelectorAll(".btn-range").forEach(b => b.classList.remove("active"));
                btnCustom.classList.add("active");
                closePopover();
                loadData();
            });

            document.addEventListener("click", (e) => {
                if (!datePopover.contains(e.target) && e.target !== btnCustom) closePopover();
            });

            dateFromInput.addEventListener("change", () => { dateToInput.min = dateFromInput.value; });

            // ── Search box ────────────────────────────────────────────────
            if (searchInput) {
                let searchTimer = null;
                searchInput.addEventListener("input", () => {
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(() => applySearch(searchInput.value), 250);
                });
            }

            btnRefresh.addEventListener("click", () => { loadData(); });

            callback();
        },
        focus: function (_api, state) {
            api = _api;
            loadData();
        },
        blur: function (_api, state) {
            // nothing
        }
    };
};