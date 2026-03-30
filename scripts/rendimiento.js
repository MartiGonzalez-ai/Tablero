"use strict";

geotab.addin.rendimiento = function () {
    let api;
    let selectedDays = 7;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    let allRecords = [];       // Processed performance records (per device)
    let filteredRecords = [];
    let rawStatusData = [];    // Raw StatusData for the raw table
    let selectedUnitId = "all"; // "all" or specific device ID
    let deviceMap = {};        // Global device map

    // Chart instances
    let chartEffByUnit, chartTrend, chartDistribution, chartScatter;

    // DOM refs
    let btnRefresh, lastUpdatedEl, errorToast, errorToastMsg, searchInput, tripsSearchInput;
    let allTrips = [], filteredTrips = [];

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

    const formatDateTime = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleString("es-MX", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
    };

    const formatOdometer = (meters) => {
        if (!meters && meters !== 0) return "—";
        return Math.round(meters / 1000).toLocaleString("es-MX") + " km";
    };

    const formatDuration = (timeSpan) => {
        if (!timeSpan) return "0s";
        // Geotab spans are often strings like "00:30:15.0000000"
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
        const duration = 900;
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

    const getEffClass = (kmPerL) => {
        if (kmPerL >= 12) return "eff-excellent";
        if (kmPerL >= 8) return "eff-good";
        if (kmPerL >= 5) return "eff-average";
        return "eff-poor";
    };

    // ─── Process StatusData into performance records per device ───────────────
    const processStatusData = (fuelData, odoData, deviceMap) => {
        const fuelByDevice = {};
        const odoByDevice = {};

        fuelData.forEach(s => {
            const devId = s.device ? s.device.id : null;
            if (!devId) return;
            if (!fuelByDevice[devId]) fuelByDevice[devId] = [];
            fuelByDevice[devId].push({ dateTime: s.dateTime, value: s.data || 0 });
        });

        odoData.forEach(s => {
            const devId = s.device ? s.device.id : null;
            if (!devId) return;
            if (!odoByDevice[devId]) odoByDevice[devId] = [];
            odoByDevice[devId].push({ dateTime: s.dateTime, value: s.data || 0 });
        });

        const perfRecords = [];
        const allDeviceIds = new Set([...Object.keys(fuelByDevice), ...Object.keys(odoByDevice)]);

        allDeviceIds.forEach(devId => {
            const fuelReadings = (fuelByDevice[devId] || []).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
            const odoReadings = (odoByDevice[devId] || []).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
            const deviceName = deviceMap[devId] || devId;

            let fuelUsed = 0, distKm = 0, odoStart = 0, odoEnd = 0;
            let dateStart = null, dateEnd = null;

            if (odoReadings.length >= 2) {
                odoStart = odoReadings[0].value;
                odoEnd = odoReadings[odoReadings.length - 1].value;
                distKm = (odoEnd - odoStart) / 1000;
                dateStart = odoReadings[0].dateTime;
                dateEnd = odoReadings[odoReadings.length - 1].dateTime;
            }

            if (fuelReadings.length >= 2) {
                const fuelStart = fuelReadings[0].value;
                const fuelEnd = fuelReadings[fuelReadings.length - 1].value;
                fuelUsed = fuelEnd - fuelStart;
                if (!dateStart) dateStart = fuelReadings[0].dateTime;
                if (!dateEnd) dateEnd = fuelReadings[fuelReadings.length - 1].dateTime;
            }

            if (distKm > 0 || fuelUsed > 0) {
                const kmPerL = fuelUsed > 0 ? distKm / fuelUsed : 0;
                perfRecords.push({
                    deviceId: devId,
                    deviceName,
                    fuelUsed: fuelUsed > 0 ? fuelUsed : 0,
                    distKm: distKm > 0 ? distKm : 0,
                    kmPerL: kmPerL > 0 ? kmPerL : 0,
                    odoStart, odoEnd,
                    dateStart, dateEnd,
                    fuelReadingsCount: fuelReadings.length,
                    odoReadingsCount: odoReadings.length
                });
            }
        });

        return perfRecords;
    };

    // ─── Render summary KPIs ─────────────────────────────────────────────────
    const renderSummary = (records, trips) => {
        const totalDist = (trips || []).reduce((s, t) => s + (t.distance || 0), 0);
        const totalFuel = (trips || []).reduce((s, t) => s + (t.fuelUsed || 0), 0);
        const avgKmPerL = totalFuel > 0 ? totalDist / totalFuel : 0;
        const costPerKm = totalDist > 0 ? (totalFuel * 24.5) / totalDist : 0;
        const unidades = records.length;

        const elRendimiento = document.getElementById("stat-rendimiento");
        const elDistancia = document.getElementById("stat-distancia");
        const elCombustible = document.getElementById("stat-combustible");
        const elCosto = document.getElementById("stat-costo");
        const elUnidades = document.getElementById("stat-unidades");

        if (elRendimiento) { elRendimiento.classList.remove("skeleton"); animateCount(elRendimiento, avgKmPerL, 1, " km/L"); }
        if (elDistancia) { elDistancia.classList.remove("skeleton"); animateCount(elDistancia, Math.round(totalDist), 0, ""); }
        if (elCombustible) { elCombustible.classList.remove("skeleton"); animateCount(elCombustible, Math.round(totalFuel), 0, ""); }
        if (elCosto) { elCosto.classList.remove("skeleton"); elCosto.textContent = "$" + costPerKm.toFixed(2); }
        if (elUnidades) { elUnidades.classList.remove("skeleton"); animateCount(elUnidades, unidades, 0, ""); }

        const totalBadge = document.getElementById("stat-total-badge");
        if (totalBadge) totalBadge.textContent = isCustomRange ? "rango personalizado" : `últimos ${selectedDays} días`;

        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) {
            badgeRanking.classList.remove("skeleton");
            badgeRanking.textContent = `${unidades} unidades`;
        }
    };

    // ─── Render ranking ──────────────────────────────────────────────────────
    const renderRanking = (records) => {
        const sorted = [...records].filter(d => d.kmPerL > 0).sort((a, b) => b.kmPerL - a.kmPerL);
        const maxKmPerL = sorted.length > 0 ? sorted[0].kmPerL : 1;
        const ul = document.getElementById("ranking-list");
        if (!ul) return;
        ul.innerHTML = "";

        if (sorted.length === 0) {
            ul.innerHTML = `<li class="ranking-empty">Sin datos en el periodo seleccionado</li>`;
            return;
        }

        sorted.forEach((item, idx) => {
            const pct = Math.round((item.kmPerL / maxKmPerL) * 100);
            const li = document.createElement("li");
            li.className = "ranking-item";
            li.innerHTML = `
                <div class="ranking-pos">${idx + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${item.deviceName}</div>
                    <div class="ranking-bar-wrap">
                        <div class="ranking-bar" style="width:${pct}%"></div>
                    </div>
                </div>
                <div class="ranking-stats">
                    <span class="ranking-count">${item.kmPerL.toFixed(1)}</span>
                    <span class="ranking-liters">km/L</span>
                </div>
            `;
            ul.appendChild(li);
        });
    };

    // ─── Render performance table ────────────────────────────────────────────
    const renderTable = (records) => {
        const tbody = document.getElementById("perf-tbody");
        const emptyEl = document.getElementById("table-empty");
        const badgeTable = document.getElementById("badge-table");

        if (!tbody) return;
        tbody.innerHTML = "";
        if (badgeTable) badgeTable.textContent = `${records.length} registros`;

        if (records.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        const sorted = [...records].sort((a, b) => b.kmPerL - a.kmPerL);

        sorted.forEach(r => {
            const tr = document.createElement("tr");
            tr.className = "perf-row";
            const effClass = getEffClass(r.kmPerL);
            tr.innerHTML = `
                <td>
                    <div class="unit-chip">
                        <div class="unit-dot"></div>
                        <span>${r.deviceName}</span>
                    </div>
                </td>
                <td>
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(r.dateStart)}</span>
                        <span class="date-time">→ ${formatDateShort(r.dateEnd)}</span>
                    </div>
                </td>
                <td>${r.distKm.toFixed(1)} km</td>
                <td>${r.fuelUsed > 0 ? r.fuelUsed.toFixed(1) + " L" : "—"}</td>
                <td>
                    <span class="eff-badge ${effClass}">${r.kmPerL > 0 ? r.kmPerL.toFixed(1) + " km/L" : "—"}</span>
                </td>
                <td>${formatOdometer(r.odoEnd)}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Render Trips Performance Table ──────────────────────────────────────
    const renderTripsTable = (trips) => {
        const tbody = document.getElementById("trips-tbody");
        const emptyEl = document.getElementById("trips-empty");
        const badgeTrips = document.getElementById("badge-trips");

        if (!tbody) return;
        tbody.innerHTML = "";
        if (badgeTrips) badgeTrips.textContent = `${trips.length} viajes`;

        if (trips.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        trips.forEach(t => {
            const tr = document.createElement("tr");
            tr.className = "perf-row";
            const eff = t.fuelUsed > 0 ? (t.distance / t.fuelUsed) : 0;
            const effClass = getEffClass(eff);

            tr.innerHTML = `
                <td>
                    <div class="unit-chip">
                        <div class="unit-dot" style="background: var(--c-purple);"></div>
                        <span>${t.deviceName}</span>
                    </div>
                </td>
                <td style="font-size:0.75rem;">${t.driverName}</td>
                <td>
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(t.start)}</span>
                        <span class="date-time">${formatTimeShort(t.start)}</span>
                    </div>
                </td>
                <td>
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(t.stop)}</span>
                        <span class="date-time">${formatTimeShort(t.stop)}</span>
                    </div>
                </td>
                <td style="font-weight:600; text-align:right;">${t.distance.toFixed(1)} km</td>
                <td style="text-align:right;">${t.maxSpeed ? Math.round(t.maxSpeed) + " km/h" : "—"}</td>
                <td style="text-align:right;">${t.averageSpeed ? Math.round(t.averageSpeed) + " km/h" : "—"}</td>
                <td style="text-align:right;">${formatDuration(t.drivingDuration)}</td>
                <td style="text-align:right;">${formatDuration(t.stopDuration)}</td>
                <td style="color:var(--c-blue); font-weight:600; text-align:right;">${t.fuelUsed > 0 ? t.fuelUsed.toFixed(2) + " L" : "—"}</td>
                <td style="text-align:center;">
                    <span class="eff-badge ${effClass}">${eff > 0 ? eff.toFixed(1) + " km/L" : "—"}</span>
                </td>
                <td style="text-align:right;">${t.workDistance.toFixed(1)} km</td>
                <td style="text-align:right;">${formatDuration(t.workDrivingDuration)}</td>
                <td style="text-align:right;">${t.afterHoursDistance.toFixed(1)} km</td>
                <td style="text-align:right;">${formatDuration(t.afterHoursDrivingDuration)}</td>
                <td style="font-size:0.7rem; color:var(--color-text-muted);">${t.stopPoint}</td>
                <td>
                    ${t.isCurrent ? '<span class="eff-badge eff-average" style="background:#e6f7fb; color:#00b1e1; border-color:#00b1e1;">En curso</span>' : '<span style="color:var(--color-text-muted); font-size:0.7rem;">Finalizado</span>'}
                </td>
                <td style="text-align:right;">${formatDuration(t.workStopDuration)}</td>
                <td style="text-align:right;">${formatDuration(t.afterHoursStopDuration)}</td>
                <td style="text-align:right;">
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(t.nextTripStart)}</span>
                        <span class="date-time">${formatTimeShort(t.nextTripStart)}</span>
                    </div>
                </td>
                <td style="font-family:monospace; font-size:0.7rem; color:var(--color-text-muted);">${t.id}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Process Trips and FuelUsed ──────────────────────────────────────────
    const processTripsData = (trips, fuelUsedData, deviceMap, driverMap) => {
        const fuelByDevice = {};
        fuelUsedData.forEach(f => {
            const devId = f.device ? f.device.id : null;
            if (!devId) return;
            if (!fuelByDevice[devId]) fuelByDevice[devId] = [];
            fuelByDevice[devId].push(f);
        });

        // Helper to parse "00:30:15.0000000" to hours
        const parseDurationToHours = (ds) => {
            if (!ds || typeof ds !== "string") return 0;
            const parts = ds.split(':');
            if (parts.length < 3) return 0;
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const s = parseFloat(parts[2]);
            return h + (m / 60) + (s / 3600);
        };

        return trips.map(trip => {
            const devId = trip.device ? trip.device.id : null;
            const deviceName = deviceMap[devId] || devId || "Desconocido";
            const tripStart = new Date(trip.start).getTime();
            const tripStop = new Date(trip.stop).getTime();
            const driverId = (trip.driver && trip.driver.id) ? trip.driver.id : null;
            const driverName = driverMap[driverId] || driverId || "Sin Conductor";
            
            let tripFuel = 0;
            if (fuelByDevice[devId]) {
                const matchingFuel = fuelByDevice[devId].filter(f => {
                    const dt = new Date(f.dateTime).getTime();
                    return dt >= tripStart && dt <= tripStop;
                });
                tripFuel = matchingFuel.reduce((sum, f) => sum + (f.fuelUsed || 0), 0);
            }

            const drivingHours = parseDurationToHours(trip.drivingDuration);
            const avgSpeed = (drivingHours > 0) ? (trip.distance) / drivingHours : 0;

            return {
                id: trip.id,
                deviceId: devId,
                deviceName: deviceName,
                driverName: driverName,
                start: trip.start,
                stop: trip.stop,
                distance: trip.distance || 0,
                drivingDuration: trip.drivingDuration,
                stopDuration: trip.stopDuration,
                maxSpeed: trip.maximumSpeed,
                averageSpeed: avgSpeed,
                fuelUsed: tripFuel,
                workDistance: trip.workDistance || 0,
                workDrivingDuration: trip.workDrivingDuration,
                afterHoursDistance: trip.afterHoursDistance || 0,
                afterHoursDrivingDuration: trip.afterHoursDrivingDuration,
                workStopDuration: trip.workStopDuration,
                afterHoursStopDuration: trip.afterHoursStopDuration,
                nextTripStart: trip.nextTripStart,
                stopPoint: trip.stopPoint ? `${trip.stopPoint.y.toFixed(5)}, ${trip.stopPoint.x.toFixed(5)}` : "—",
                isCurrent: trip.isCurrent
            };
        });
    };

    // ─── Render Raw StatusData Table ──────────────────────────────────────────
    const renderRawTable = (data, deviceMap) => {
        const thead = document.getElementById("raw-thead");
        const tbody = document.getElementById("raw-tbody");
        const badgeRaw = document.getElementById("badge-raw");
        if (!thead || !tbody) return;

        let filteredData = data;
        if (selectedUnitId !== "all") {
            filteredData = data.filter(s => s.device && s.device.id === selectedUnitId);
        }

        if (badgeRaw) badgeRaw.textContent = `${filteredData.length} registros`;

        if (filteredData.length === 0) {
            thead.innerHTML = "<tr><th>Sin datos</th></tr>";
            tbody.innerHTML = '<tr><td style="text-align:center; padding: 2rem;">No se encontraron registros de StatusData en el periodo seleccionado.</td></tr>';
            return;
        }

        // Define columns
        thead.innerHTML = "";
        const trHead = document.createElement("tr");
        ["Dispositivo", "Diagnóstico", "Fecha y Hora", "Valor", "Device ID", "Diagnostic ID"].forEach(col => {
            const th = document.createElement("th");
            th.textContent = col;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);

        // Body
        tbody.innerHTML = "";
        const sorted = [...filteredData].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        sorted.forEach(s => {
            const tr = document.createElement("tr");
            const devId = s.device ? s.device.id : "—";
            const devName = (s.device && s.device.name) ? s.device.name : (deviceMap[devId] || devId);
            const diagId = s.diagnostic ? s.diagnostic.id : "—";
            const dateStr = formatDateTime(s.dateTime);
            const value = s.data !== undefined && s.data !== null ? s.data : "—";

            // Determine a friendly diagnostic name
            let diagName = diagId;
            if (diagId === "DiagnosticDeviceTotalFuelId") diagName = "Combustible Total (L)";
            else if (diagId === "DiagnosticOdometerId") diagName = "Odómetro (m)";
            else if (diagId === "DiagnosticDeviceTotalIdleFuelId") diagName = "Combustible Ralentí (L)";
            else if (diagId === "DiagnosticFuelLevelId") diagName = "Nivel de Combustible (%)";
            else if (diagId.toLowerCase().includes("fuel")) diagName = "Combustible: " + diagId;
            else if (diagId.toLowerCase().includes("odometer")) diagName = "Odómetro: " + diagId;

            tr.innerHTML = `
                <td>${devName}</td>
                <td>${diagName}</td>
                <td>${dateStr}</td>
                <td style="font-weight:700; text-align:right;">${typeof value === "number" ? value.toLocaleString("es-MX", { maximumFractionDigits: 2 }) : value}</td>
                <td style="font-family:monospace; font-size:0.7rem; color:var(--color-text-muted);">${devId}</td>
                <td style="font-family:monospace; font-size:0.7rem; color:var(--color-text-muted);">${diagId}</td>
            `;
            tbody.appendChild(tr);
        });
    };
 
    const renderFuelConsumptionTable = (fuelData, deviceMap) => {
        const tbody = document.getElementById("fuel-summary-tbody");
        const badge = document.getElementById("badge-fuel-summary");
        if (!tbody) return;
 
        // Group by device
        const grouped = {};
        fuelData.forEach(s => {
            const devId = s.device ? s.device.id : null;
            if (!devId) return;
            if (!grouped[devId]) grouped[devId] = [];
            grouped[devId].push(s);
        });
 
        const summaryData = [];
        for (const devId in grouped) {
            const readings = grouped[devId];
            if (readings.length === 0) continue;
            
            const values = readings.map(r => r.data || 0);
            const maxVal = Math.max(...values);
            const minVal = Math.min(...values);
            const consumed = maxVal - minVal;
            
            // Sort to get date range
            const sorted = [...readings].sort((a,b) => new Date(a.dateTime) - new Date(b.dateTime));
            const start = sorted[0].dateTime;
            const end = sorted[sorted.length - 1].dateTime;
 
            summaryData.push({
                devId,
                deviceName: deviceMap[devId] || devId,
                maxVal,
                minVal,
                consumed,
                start,
                end
            });
        }
 
        if (badge) badge.textContent = `${summaryData.length} unidades`;
 
        tbody.innerHTML = "";
        if (summaryData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">No hay datos de combustible para este periodo.</td></tr>';
            return;
        }
 
        summaryData.sort((a,b) => b.consumed - a.consumed).forEach(row => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div class="unit-chip">
                        <div class="unit-dot" style="background: var(--c-orange);"></div>
                        <span>${row.deviceName}</span>
                    </div>
                </td>
                <td style="text-align:right;">${row.maxVal.toLocaleString("es-MX", {minimumFractionDigits: 2})} L</td>
                <td style="text-align:right;">${row.minVal.toLocaleString("es-MX", {minimumFractionDigits: 2})} L</td>
                <td style="text-align:right; font-weight:700; color:var(--c-blue);">${row.consumed.toLocaleString("es-MX", {minimumFractionDigits: 2})} L</td>
                <td>
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(row.start)}</span>
                        <span class="date-time">→ ${formatDateShort(row.end)}</span>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Reset UI ─────────────────────────────────────────────────────────────
    const resetUI = () => {
        ["stat-rendimiento", "stat-distancia", "stat-combustible", "stat-costo", "stat-unidades"].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = "—"; el.classList.add("skeleton"); }
        });

        const ul = document.getElementById("ranking-list");
        if (ul) ul.innerHTML = Array(5).fill('<li class="ranking-skeleton"></li>').join("");

        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) { badgeRanking.textContent = "—"; badgeRanking.classList.add("skeleton"); }

        const tbody = document.getElementById("perf-tbody");
        if (tbody) tbody.innerHTML = Array(5).fill('<tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>').join("");

        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = "—";

        const emptyEl = document.getElementById("table-empty");
        if (emptyEl) emptyEl.style.display = "none";

        const rawThead = document.getElementById("raw-thead");
        const rawTbody = document.getElementById("raw-tbody");
        if (rawThead) rawThead.innerHTML = `<tr><th>Cargando StatusData...</th></tr>`;
        if (rawTbody) rawTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td><div class="td-skel"></div></td></tr>').join("");

        const tripsTbody = document.getElementById("trips-tbody");
        if (tripsTbody) tripsTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>').join("");

        const badgeTrips = document.getElementById("badge-trips");
        if (badgeTrips) badgeTrips.textContent = "—";

        const fuelSummaryTbody = document.getElementById("fuel-summary-tbody");
        if (fuelSummaryTbody) fuelSummaryTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="5"><div class="td-skel"></div></td></tr>').join("");

        const badgeFuelSummary = document.getElementById("badge-fuel-summary");
        if (badgeFuelSummary) badgeFuelSummary.textContent = "—";

        if (searchInput) searchInput.value = "";
        if (tripsSearchInput) tripsSearchInput.value = "";
    };

    // ─── Render Charts ────────────────────────────────────────────────────────
    const renderCharts = (records) => {
        if (!window.ApexCharts) return;

        const cCyan = "#00b1e1", cBlue = "#003666", cGreen = "#3b753c", cOrange = "#f29300", cRed = "#cc0000";
        const textMuted = "#5e6c84";
        const fontFamily = "'Inter', sans-serif";
        const commonOptions = {
            chart: { fontFamily, toolbar: { show: false } },
            dataLabels: { enabled: false },
            tooltip: { theme: 'light' }
        };

        // 1. Rendimiento por Unidad (horizontal bar)
        const sortedByEff = [...records].filter(d => d.kmPerL > 0).sort((a, b) => b.kmPerL - a.kmPerL).slice(0, 15);
        const optEffByUnit = {
            ...commonOptions,
            series: [{ name: 'km/L', data: sortedByEff.map(d => parseFloat(d.kmPerL.toFixed(1))) }],
            chart: { type: 'bar', height: 260, fontFamily, toolbar: { show: false } },
            colors: sortedByEff.map(d => d.kmPerL >= 12 ? cGreen : d.kmPerL >= 8 ? cCyan : d.kmPerL >= 5 ? cOrange : cRed),
            plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true } },
            dataLabels: {
                enabled: true, textAnchor: 'start', offsetX: 5,
                formatter: val => val + " km/L",
                style: { colors: [textMuted], fontSize: '10px', fontWeight: 600 }
            },
            xaxis: { categories: sortedByEff.map(d => d.deviceName), labels: { style: { colors: textMuted } } },
            yaxis: { labels: { style: { colors: textMuted, fontSize: '11px' } } },
            legend: { show: false },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };
        if (chartEffByUnit) chartEffByUnit.destroy();
        chartEffByUnit = new ApexCharts(document.querySelector("#chart-eff-unit"), optEffByUnit);
        chartEffByUnit.render();

        // 2. Distancia vs Combustible agrupado (bar chart)
        const withFuel = records.filter(d => d.kmPerL > 0);
        const optTrend = {
            ...commonOptions,
            series: [
                { name: 'Distancia (km)', data: withFuel.map(d => parseFloat(d.distKm.toFixed(1))) },
                { name: 'Combustible (L)', data: withFuel.map(d => parseFloat(d.fuelUsed.toFixed(1))) }
            ],
            chart: { type: 'bar', height: 260, fontFamily, toolbar: { show: false } },
            colors: [cCyan, cOrange],
            plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
            xaxis: { categories: withFuel.map(d => d.deviceName), labels: { style: { colors: textMuted, fontSize: '10px' }, rotate: -45 } },
            yaxis: { labels: { style: { colors: textMuted } } },
            legend: { position: 'top', fontSize: '11px' },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };
        if (chartTrend) chartTrend.destroy();
        chartTrend = new ApexCharts(document.querySelector("#chart-trend"), optTrend);
        chartTrend.render();

        // 3. Distribución de Eficiencia (donut)
        const effCounts = { Excelente: 0, Bueno: 0, Regular: 0, Bajo: 0 };
        records.forEach(d => {
            if (d.kmPerL <= 0) return;
            if (d.kmPerL >= 12) effCounts.Excelente++;
            else if (d.kmPerL >= 8) effCounts.Bueno++;
            else if (d.kmPerL >= 5) effCounts.Regular++;
            else effCounts.Bajo++;
        });
        const optDist = {
            ...commonOptions,
            series: Object.values(effCounts),
            chart: { type: 'donut', height: 260, fontFamily },
            labels: Object.keys(effCounts),
            colors: [cGreen, cCyan, cOrange, cRed],
            plotOptions: { pie: { donut: { size: '60%', labels: { show: true, total: { show: true, label: 'Unidades', formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0) } } } } },
            legend: { position: 'bottom', fontSize: '11px', fontWeight: 600 },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };
        if (chartDistribution) chartDistribution.destroy();
        chartDistribution = new ApexCharts(document.querySelector("#chart-distribution"), optDist);
        chartDistribution.render();

        // 4. Consumo vs Distancia (scatter)
        const scatterData = records.filter(d => d.fuelUsed > 0 && d.distKm > 0).map(d => ({
            x: parseFloat(d.distKm.toFixed(1)), y: parseFloat(d.fuelUsed.toFixed(1))
        }));
        const optScatter = {
            ...commonOptions,
            series: [{ name: 'Unidades', data: scatterData }],
            chart: { type: 'scatter', height: 260, fontFamily, toolbar: { show: false }, zoom: { enabled: true } },
            colors: [cBlue],
            xaxis: {
                title: { text: 'Distancia (km)', style: { color: textMuted, fontSize: '11px', fontWeight: 600 } },
                labels: { formatter: val => Math.round(val) + " km", style: { colors: textMuted } }
            },
            yaxis: {
                title: { text: 'Combustible (L)', style: { color: textMuted, fontSize: '11px', fontWeight: 600 } },
                labels: { formatter: val => Math.round(val) + " L", style: { colors: textMuted } }
            },
            markers: { size: 6, strokeWidth: 0, hover: { size: 9 } },
            tooltip: {
                custom: ({ seriesIndex, dataPointIndex, w }) => {
                    const point = w.config.series[seriesIndex].data[dataPointIndex];
                    const kmPerL = point.y > 0 ? (point.x / point.y).toFixed(1) : '—';
                    return `<div style="padding:8px 12px;font-size:12px;"><b>Distancia:</b> ${point.x} km<br><b>Combustible:</b> ${point.y} L<br><b>Rendimiento:</b> ${kmPerL} km/L</div>`;
                }
            },
            noData: { text: "No hay datos", align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };
        if (chartScatter) chartScatter.destroy();
        chartScatter = new ApexCharts(document.querySelector("#chart-scatter"), optScatter);
        chartScatter.render();
    };

    // ─── Filter by search ─────────────────────────────────────────────────────
    const applySearch = (query) => {
        let records = [...allRecords];
        if (selectedUnitId !== "all") {
            records = records.filter(r => r.deviceId === selectedUnitId);
        }
        if (query && query.trim() !== "") {
            const q = query.trim().toLowerCase();
            records = records.filter(r => r.deviceName.toLowerCase().includes(q));
        }
        filteredRecords = records;
        renderTable(filteredRecords);
        renderCharts(filteredRecords);
    };

    const applyTripsSearch = (query) => {
        let trips = [...allTrips];
        if (selectedUnitId !== "all") {
            trips = trips.filter(t => t.deviceId === selectedUnitId);
        }
        if (query && query.trim() !== "") {
            const q = query.trim().toLowerCase();
            trips = trips.filter(t => t.deviceName.toLowerCase().includes(q));
        }
        filteredTrips = trips;
        renderTripsTable(filteredTrips);
    };

    const populateUnitFilter = (devices) => {
        const select = document.getElementById("unit-select");
        if (!select) return;
        
        // Save current selection if possible
        const currentVal = select.value;
        
        // Clear and add "All"
        select.innerHTML = '<option value="all">Todas las Unidades</option>';
        
        // Sort devices by name
        const sortedDevices = [...devices].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        
        sortedDevices.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.textContent = d.name || d.id;
            select.appendChild(opt);
        });
        
        // Restore selection if it still exists
        if ([...select.options].some(o => o.value === currentVal)) {
            select.value = currentVal;
        } else {
            selectedUnitId = "all";
        }
    };

    const applyUnitFilter = () => {
        // Filter performance records
        if (selectedUnitId === "all") {
            filteredRecords = [...allRecords];
            filteredTrips = [...allTrips];
        } else {
            filteredRecords = allRecords.filter(r => r.deviceId === selectedUnitId);
            filteredTrips = allTrips.filter(t => t.deviceId === selectedUnitId);
        }

        // Apply any existing search terms
        if (searchInput && searchInput.value) applySearch(searchInput.value);
        else {
            renderTable(filteredRecords);
            renderCharts(filteredRecords);
        }

        if (tripsSearchInput && tripsSearchInput.value) applyTripsSearch(tripsSearchInput.value);
        else renderTripsTable(filteredTrips);

        // Update Summary (KPIs) with filtered records and trips
        renderSummary(filteredRecords, filteredTrips);

        // Update Raw Table (filtered by unit)
        renderRawTable(rawStatusData, deviceMap);
 
        // Update Fuel Summary Table
        const fuelOnly = rawStatusData.filter(s => s.diagnostic && s.diagnostic.id === "DiagnosticDeviceTotalFuelId");
        renderFuelConsumptionTable(fuelOnly, deviceMap);
    };

    // ─── MAIN DATA LOADER ─────────────────────────────────────────────────────
    const loadData = () => {
        resetUI();
        btnRefresh.disabled = true;
        btnRefresh.classList.add("loading");

        const { fromDate, toDate } = getDateRange();

        const commonSearch = { fromDate, toDate, resultsLimit: 100000 };
        if (selectedUnitId !== "all") {
            commonSearch.deviceSearch = { id: selectedUnitId };
        }

        // Query StatusData for fuel + odometer diagnostics, plus Device list
        api.multiCall([
            ["Get", {
                typeName: "StatusData",
                search: {
                    ...commonSearch,
                    diagnosticSearch: { id: "DiagnosticDeviceTotalFuelId" }
                }
            }],
            ["Get", {
                typeName: "StatusData",
                search: {
                    ...commonSearch,
                    diagnosticSearch: { id: "DiagnosticOdometerId" }
                }
            }],
            ["Get", {
                typeName: "Trip",
                search: commonSearch
            }],
            ["Get", { 
                typeName: "FuelUsed", 
                search: commonSearch 
            }],
            ["Get", { typeName: "Device" }],
            ["Get", { typeName: "User", search: { isDriver: true } }]
        ], function (results) {
            var fuelData = results[0] || [];
            var odoData = results[1] || [];
            var tripsRaw = results[2] || [];
            var fuelUsedRaw = results[3] || [];
            var devices = results[4] || [];
            var drivers = results[5] || [];

            // Build maps
            deviceMap = {};
            devices.forEach(function (d) { deviceMap[d.id] = d.name; });
            const driverMap = {};
            drivers.forEach(function (dr) { 
                driverMap[dr.id] = (dr.firstName && dr.lastName) ? (dr.firstName + " " + dr.lastName) : dr.name; 
            });

            populateUnitFilter(devices);

            // Enrich StatusData with device names
            fuelData.forEach(function (s) {
                if (s.device && s.device.id && deviceMap[s.device.id]) {
                    s.device.name = deviceMap[s.device.id];
                }
            });
            odoData.forEach(function (s) {
                if (s.device && s.device.id && deviceMap[s.device.id]) {
                    s.device.name = deviceMap[s.device.id];
                }
            });

            // Store raw data for raw table (combine fuel + odo)
            rawStatusData = [].concat(fuelData, odoData);

            // Process into performance records per device
            allRecords = processStatusData(fuelData, odoData, deviceMap);
            filteredRecords = allRecords.slice();

            // Process Trips Performance
            allTrips = processTripsData(tripsRaw, fuelUsedRaw, deviceMap, driverMap);
            filteredTrips = allTrips.slice();

            console.log("[Rendimiento] Fuel StatusData records:", fuelData.length);
            console.log("[Rendimiento] Odometer StatusData records:", odoData.length);
            console.log("[Rendimiento] Trips raw:", tripsRaw.length);
            console.log("[Rendimiento] FuelUsed raw:", fuelUsedRaw.length);
            console.log("[Rendimiento] Devices:", devices.length);
            console.log("[Rendimiento] Performance records:", allRecords.length);
            console.log("[Rendimiento] Processed Trips:", allTrips.length);

            renderSummary(allRecords, allTrips);
            renderRanking(allRecords);
            renderTable(filteredRecords);
            renderCharts(filteredRecords);
            renderTripsTable(filteredTrips);
            renderRawTable(rawStatusData, deviceMap);
            renderFuelConsumptionTable(fuelData, deviceMap);

            // Trigger filtering if unit was already selected
            if (selectedUnitId !== "all") {
                applyUnitFilter();
            }

            if (window.lucide) {
                lucide.createIcons();
            }

            var now = new Date();
            lastUpdatedEl.textContent = "Actualizado: " + now.toLocaleTimeString("es-MX", {
                hour: "2-digit", minute: "2-digit", second: "2-digit"
            });

            btnRefresh.disabled = false;
            btnRefresh.classList.remove("loading");
        }, function (err) {
            console.error("[Rendimiento] Error:", err);
            showError("Error al cargar los datos: " + (err.message || err));
            btnRefresh.disabled = false;
            btnRefresh.classList.remove("loading");
        });
    };

    // ─── ADD-IN LIFECYCLE ─────────────────────────────────────────────────────
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            if (window.lucide) {
                lucide.createIcons();
            }

            btnRefresh = document.getElementById("btn-refresh");
            lastUpdatedEl = document.getElementById("last-updated-time");
            errorToast = document.getElementById("error-toast");
            errorToastMsg = document.getElementById("error-toast-msg");
            searchInput = document.getElementById("search-input");
            tripsSearchInput = document.getElementById("trips-search-input");
            const unitSelect = document.getElementById("unit-select");

            // Unit Filter Event
            if (unitSelect) {
                unitSelect.addEventListener("change", function () {
                    selectedUnitId = unitSelect.value;
                    applyUnitFilter();
                });
            }

            // Date range buttons
            document.querySelectorAll(".btn-range[data-days]").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    document.querySelectorAll(".btn-range").forEach(function (b) { b.classList.remove("active"); });
                    btn.classList.add("active");
                    selectedDays = parseInt(btn.dataset.days, 10);
                    isCustomRange = false;
                    customFromDate = null;
                    customToDate = null;
                    var btnCustom = document.getElementById("btn-custom");
                    if (btnCustom) {
                        btnCustom.innerHTML = '<i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i> Personalizado';
                        if (window.lucide) lucide.createIcons();
                    }
                    loadData();
                });
            });

            // Custom date popover
            var btnCustom = document.getElementById("btn-custom");
            var datePopover = document.getElementById("date-popover");
            var dateFromInput = document.getElementById("date-from");
            var dateToInput = document.getElementById("date-to");
            var btnApply = document.getElementById("btn-date-apply");
            var btnCancel = document.getElementById("btn-date-cancel");

            var todayStr = new Date().toISOString().slice(0, 10);
            var weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            dateFromInput.value = weekAgo.toISOString().slice(0, 10);
            dateToInput.value = todayStr;
            dateToInput.max = todayStr;

            var closePopover = function () { datePopover.classList.remove("open"); };

            btnCustom.addEventListener("click", function (e) {
                e.stopPropagation();
                datePopover.classList.toggle("open");
            });

            btnCancel.addEventListener("click", closePopover);

            btnApply.addEventListener("click", function () {
                var from = dateFromInput.value;
                var to = dateToInput.value;
                if (!from || !to) { showError("Selecciona ambas fechas."); return; }
                if (new Date(from) > new Date(to)) { showError("'Desde' no puede ser mayor que 'Hasta'."); return; }

                customFromDate = new Date(from + "T00:00:00").toISOString();
                customToDate = new Date(to + "T23:59:59").toISOString();
                isCustomRange = true;

                var fmt = function (s) { return new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" }); };
                btnCustom.innerHTML = '<i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i> ' + fmt(from) + " – " + fmt(to);
                if (window.lucide) lucide.createIcons();

                document.querySelectorAll(".btn-range").forEach(function (b) { b.classList.remove("active"); });
                btnCustom.classList.add("active");
                closePopover();
                loadData();
            });

            document.addEventListener("click", function (e) {
                if (!datePopover.contains(e.target) && e.target !== btnCustom) closePopover();
            });

            dateFromInput.addEventListener("change", function () { dateToInput.min = dateFromInput.value; });

            // Search
            if (searchInput) {
                var searchTimer = null;
                searchInput.addEventListener("input", function () {
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(function () { applySearch(searchInput.value); }, 250);
                });
            }
            if (tripsSearchInput) {
                var tripsSearchTimer = null;
                tripsSearchInput.addEventListener("input", function () {
                    clearTimeout(tripsSearchTimer);
                    tripsSearchTimer = setTimeout(function () { applyTripsSearch(tripsSearchInput.value); }, 250);
                });
            }

            btnRefresh.addEventListener("click", function () { loadData(); });

            callback();
        },
        focus: function (_api, state) {
            api = _api;
            loadData();
        },
        blur: function () {
            // cleanup if needed
        }
    };
};
