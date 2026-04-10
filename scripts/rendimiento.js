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
    let chartEffByUnit, chartDailyFuel, chartSpeedDist, chartDriverEff;

    // DOM refs
    let btnRefresh, lastUpdatedEl, errorToast, errorToastMsg, searchInput, tripsSearchInput, odoTripsSearchInput;
    let allTrips = [], filteredTrips = [];
    let filteredOdoTrips = [];

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
        const totalDist = (trips || []).reduce((s, t) => s + (parseFloat(t.distance) || 0), 0);
        const totalFuel = (records || []).reduce((s, r) => s + (parseFloat(r.fuelUsed) || 0), 0);
        const avgKmPerL = totalFuel > 0 ? totalDist / totalFuel : 0;
        const unidades  = records.length;

        const elRendimiento = document.getElementById("stat-rendimiento");
        const elDistancia   = document.getElementById("stat-distancia");
        const elCombustible = document.getElementById("stat-combustible");
        const elUnidades    = document.getElementById("stat-unidades");

        if (elRendimiento)  { elRendimiento.classList.remove("skeleton");  animateCount(elRendimiento, avgKmPerL, 1, " km/L"); }
        if (elDistancia)    { elDistancia.classList.remove("skeleton");    animateCount(elDistancia, Math.round(totalDist), 0, ""); }
        if (elCombustible)  { elCombustible.classList.remove("skeleton");  animateCount(elCombustible, Math.round(totalFuel), 0, ""); }
        if (elUnidades)     { elUnidades.classList.remove("skeleton");     animateCount(elUnidades, unidades, 0, ""); }

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

        const sorted = [...records].sort((a, b) => b.fuelUsed - a.fuelUsed);

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
                <td style="text-align:right; font-weight:600;">${r.distKm > 0 ? r.distKm.toFixed(1) + " km" : "0.0 km"}</td>
                <td style="text-align:right; font-weight:700; color:var(--c-blue);">${r.fuelUsed > 0 ? r.fuelUsed.toFixed(2) + " L" : "0.00 L"}</td>
                <td style="text-align:center;">
                    <span class="eff-badge ${effClass}">${r.kmPerL > 0 ? r.kmPerL.toFixed(1) + " km/L" : "0.0 km/L"}</span>
                </td>
                <td>
                    <div class="date-cell">
                        <span class="date-main">${formatDateShort(r.dateStart)}</span>
                        <span class="date-time">→ ${formatDateShort(r.dateEnd)}</span>
                    </div>
                </td>
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
                    <span class="eff-badge ${effClass}">${eff > 0 ? eff.toFixed(1) + " km/L" : "0.0 km/L"}</span>
                </td>
                <td style="font-size:0.7rem; color:var(--color-text-muted);">${t.stopPoint}</td>
                <td>
                    ${t.isCurrent ? '<span class="eff-badge eff-average" style="background:#e6f7fb; color:#00b1e1; border-color:#00b1e1;">En curso</span>' : '<span style="color:var(--color-text-muted); font-size:0.7rem;">Finalizado</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Render Accumulated Odometer per Trip Table ──────────────────────────
    const renderOdoTripsTable = (trips) => {
        const tbody = document.getElementById("odo-trips-tbody");
        const emptyEl = document.getElementById("odo-trips-empty");
        const badgeOdoTrips = document.getElementById("badge-odo-trips");

        if (!tbody) return;
        tbody.innerHTML = "";
        if (badgeOdoTrips) badgeOdoTrips.textContent = `${trips.length} viajes`;

        if (trips.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        // Sort trips by date (newest first)
        const sorted = [...trips].sort((a, b) => new Date(b.start) - new Date(a.start));

        sorted.forEach(t => {
            const tr = document.createElement("tr");
            tr.className = "perf-row";

            tr.innerHTML = `
                <td>
                    <div class="unit-chip">
                        <div class="unit-dot" style="background: var(--color-primary);"></div>
                        <span>${t.deviceName}</span>
                    </div>
                </td>
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
                <td style="font-weight:700; text-align:right; color:var(--color-primary);">${formatOdometer(t.stopOdometer)}</td>
                <td>
                    ${t.isCurrent ? '<span class="eff-badge eff-average" style="background:#e6f7fb; color:#00b1e1; border-color:#00b1e1;">En curso</span>' : '<span style="color:var(--color-text-muted); font-size:0.7rem;">Finalizado</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Process Trips and FuelUsed ──────────────────────────────────────────
    const processTripsData = (trips, fuelStatusData, deviceMap, driverMap) => {
        const fuelByDevice = {};
        fuelStatusData.forEach(f => {
            const devId = f.device ? f.device.id : null;
            if (!devId) return;
            if (!fuelByDevice[devId]) fuelByDevice[devId] = [];
            fuelByDevice[devId].push({
                dateTime: new Date(f.dateTime).getTime(),
                value: f.data || 0
            });
        });

        // Sort each device's fuel readings by time
        Object.keys(fuelByDevice).forEach(devId => {
            fuelByDevice[devId].sort((a, b) => a.dateTime - b.dateTime);
        });

        return trips.map(trip => {
            const devId = trip.device ? trip.device.id : null;
            const deviceName = deviceMap[devId] || devId || "Desconocido";
            const tripStart = new Date(trip.start).getTime();
            const tripStop = new Date(trip.stop).getTime();
            const driverId = (trip.driver && trip.driver.id) ? trip.driver.id : null;
            const driverName = driverMap[driverId] || driverId || "Sin Conductor";

            // Calculate fuel used during trip using StatusData increments (similar to daily table)
            let tripFuel = 0;
            if (fuelByDevice[devId]) {
                const readings = fuelByDevice[devId];
                for (let i = 1; i < readings.length; i++) {
                    // If the reading timestamp falls within the trip, add the delta
                    if (readings[i].dateTime > tripStart && readings[i].dateTime <= tripStop) {
                        const delta = readings[i].value - readings[i - 1].value;
                        if (delta > 0) tripFuel += delta;
                    }
                }
            }

            const parseDurationToHours = (ds) => {
                if (!ds || typeof ds !== "string") return 0;
                const parts = ds.split(':');
                if (parts.length < 3) return 0;
                const h = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                const s = parseFloat(parts[2]);
                return h + (m / 60) + (s / 3600);
            };

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
                isCurrent: trip.isCurrent,
                stopOdometer: trip.stopOdometer || 0
            };
        });
    };

    // ─── Render Raw StatusData Table (Fuel) ──────────────────────────────────
    const renderRawTable = (data, deviceMap) => {
        const thead = document.getElementById("raw-thead");
        const tbody = document.getElementById("raw-tbody");
        const badgeRaw = document.getElementById("badge-raw");
        if (!thead || !tbody) return;

        // Filter only fuel diagnostics
        let fuelRaw = data.filter(s => s.diagnostic && s.diagnostic.id === "DiagnosticDeviceTotalFuelId");

        if (selectedUnitId !== "all") {
            fuelRaw = fuelRaw.filter(s => s.device && s.device.id === selectedUnitId);
        }

        if (badgeRaw) badgeRaw.textContent = `${fuelRaw.length} registros`;

        if (fuelRaw.length === 0) {
            thead.innerHTML = "<tr><th>Sin datos</th></tr>";
            tbody.innerHTML = '<tr><td style="text-align:center; padding: 2rem;">No se encontraron registros de combustible en el periodo seleccionado.</td></tr>';
            return;
        }

        thead.innerHTML = "<tr><th>Dispositivo</th><th>Diagnóstico</th><th>Fecha y Hora</th><th>Valor (L)</th><th>Device ID</th></tr>";
        tbody.innerHTML = "";
        const sorted = [...fuelRaw].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        sorted.forEach(s => {
            const tr = document.createElement("tr");
            const devId = s.device ? s.device.id : "—";
            const devName = (s.device && s.device.name) ? s.device.name : (deviceMap[devId] || devId);
            const dateStr = formatDateTime(s.dateTime);
            const value = s.data !== undefined && s.data !== null ? s.data : 0;

            tr.innerHTML = `
                <td>${devName}</td>
                <td style="color:var(--c-blue);">Combustible Total</td>
                <td>${dateStr}</td>
                <td style="font-weight:700; text-align:right;">${value.toLocaleString("es-MX", { maximumFractionDigits: 2 })} L</td>
                <td style="font-family:monospace; font-size:0.7rem; color:var(--color-text-muted);">${devId}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Render Raw Odometer Table ────────────────────────────────────────────
    const renderOdoRawTable = (data, deviceMap) => {
        const thead = document.getElementById("odo-raw-thead");
        const tbody = document.getElementById("odo-raw-tbody");
        const badgeRaw = document.getElementById("badge-raw-odo");
        if (!thead || !tbody) return;

        // Filter only odometer diagnostics
        let odoRaw = data.filter(s => s.diagnostic && s.diagnostic.id === "DiagnosticOdometerId");

        if (selectedUnitId !== "all") {
            odoRaw = odoRaw.filter(s => s.device && s.device.id === selectedUnitId);
        }

        if (badgeRaw) badgeRaw.textContent = `${odoRaw.length} registros`;

        if (odoRaw.length === 0) {
            thead.innerHTML = "<tr><th>Sin datos</th></tr>";
            tbody.innerHTML = '<tr><td style="text-align:center; padding: 2rem;">No se encontraron registros de odómetro en el periodo seleccionado.</td></tr>';
            return;
        }

        thead.innerHTML = "<tr><th>Dispositivo</th><th>Diagnóstico</th><th>Fecha y Hora</th><th>Valor (km)</th><th>Device ID</th></tr>";
        tbody.innerHTML = "";
        const sorted = [...odoRaw].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

        sorted.forEach(s => {
            const tr = document.createElement("tr");
            const devId = s.device ? s.device.id : "—";
            const devName = (s.device && s.device.name) ? s.device.name : (deviceMap[devId] || devId);
            const dateStr = formatDateTime(s.dateTime);
            const value = s.data !== undefined && s.data !== null ? s.data / 1000 : 0;

            tr.innerHTML = `
                <td>${devName}</td>
                <td style="color:var(--color-primary);">Odómetro</td>
                <td>${dateStr}</td>
                <td style="font-weight:700; text-align:right;">${value.toLocaleString("es-MX", { maximumFractionDigits: 1 })} km</td>
                <td style="font-family:monospace; font-size:0.7rem; color:var(--color-text-muted);">${devId}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    // ─── Render Daily Table ───────────────────────────────────────────────────
    const renderDailyTable = () => {
        const tbody = document.getElementById("daily-tbody");
        const emptyEl = document.getElementById("daily-empty");
        const badgeDaily = document.getElementById("badge-daily");

        if (!tbody) return;
        tbody.innerHTML = "";

        // Initialize dailyData with all dates in the selected range
        const dailyData = {};
        const range = window.getDateRange ? window.getDateRange() : { fromDate: new Date().toISOString(), toDate: new Date().toISOString() };

        const startD = new Date(range.fromDate);
        const endD = new Date(range.toDate);
        startD.setHours(12, 0, 0, 0); // avoid tz boundary issues
        endD.setHours(12, 0, 0, 0);

        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
            const dStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
            dailyData[dStr] = { dist: 0, fuel: 0 };
        }

        // 1. Distance from Trips
        (filteredTrips || []).forEach(t => {
            if (!t.start) return;
            const dateObj = new Date(t.start);
            const dStr = dateObj.getFullYear() + "-" + String(dateObj.getMonth() + 1).padStart(2, '0') + "-" + String(dateObj.getDate()).padStart(2, '0');
            if (!dailyData[dStr]) dailyData[dStr] = { dist: 0, fuel: 0 };
            dailyData[dStr].dist += (parseFloat(t.distance) || 0);
        });

        // 2. Fuel from StatusData (Datos Crudos)
        let fuelDataToProcess = rawStatusData;
        if (selectedUnitId !== "all") {
            fuelDataToProcess = rawStatusData.filter(d => d.device && d.device.id === selectedUnitId);
        }
        const fuelData = fuelDataToProcess.filter(d => d.diagnostic && d.diagnostic.id === "DiagnosticDeviceTotalFuelId");

        const fuelByDev = {};
        fuelData.forEach(d => {
            const devId = d.device.id;
            if (!fuelByDev[devId]) fuelByDev[devId] = [];
            fuelByDev[devId].push(d);
        });

        const odoData = fuelDataToProcess.filter(d => d.diagnostic && d.diagnostic.id === "DiagnosticOdometerId");
        const odoByDev = {};
        odoData.forEach(d => {
            const devId = d.device.id;
            if (!odoByDev[devId]) odoByDev[devId] = [];
            odoByDev[devId].push(d);
        });
        Object.keys(odoByDev).forEach(devId => {
            odoByDev[devId].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        });

        Object.keys(fuelByDev).forEach(devId => {
            const arr = fuelByDev[devId].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
            for (let i = 1; i < arr.length; i++) {
                const deltaL = arr[i].data - arr[i - 1].data;
                if (deltaL > 0) { // Only positive increments in total fuel
                    const tzDate = new Date(arr[i].dateTime);
                    const dStr = tzDate.getFullYear() + "-" + String(tzDate.getMonth() + 1).padStart(2, '0') + "-" + String(tzDate.getDate()).padStart(2, '0');
                    if (!dailyData[dStr]) dailyData[dStr] = { dist: 0, fuel: 0 };
                    dailyData[dStr].fuel += deltaL;
                }
            }
        });

        const sortedDates = Object.keys(dailyData).sort();

        if (badgeDaily) badgeDaily.textContent = `${sortedDates.length} días`;

        if (sortedDates.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        // Sort descending so most recent is on top
        const reversedDates = [...sortedDates].reverse();

        reversedDates.forEach(dateStr => {
            const day = dailyData[dateStr];
            const eff = day.fuel > 0 ? (day.dist / day.fuel) : 0;
            const effClass = getEffClass(eff);

            const tr = document.createElement("tr");
            tr.className = "perf-row";
            tr.innerHTML = `
                <td>
                    <div class="date-cell">
                        <span class="date-main" style="font-weight:600; color:var(--color-primary);">${dateStr}</span>
                    </div>
                </td>
                <td style="text-align:right; font-weight:600;">${day.dist.toFixed(1)} km</td>
                <td style="text-align:right; font-weight:600; color:var(--text-color);" id="odo-${dateStr}">
                    <span style="opacity:0.5;">Cargando...</span>
                </td>
                <td style="text-align:right; font-weight:600; color:var(--c-blue);">${day.fuel.toFixed(2)} L</td>
                <td style="text-align:center;">
                    <span class="eff-badge ${effClass}">${eff > 0 ? eff.toFixed(1) + " km/L" : ((day.dist >= 0 || day.fuel >= 0) ? "0.0 km/L" : "---")}</span>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Reconstruccion de Odometro por dia (igual que recorrido.js)
        // Estrategia: obtener el odometro absoluto mas reciente como ancla,
        // luego reconstruir hacia atras restando la distancia recorrida cada dia.
        if (typeof api !== "undefined") {
            const odometerDiagnostics = [
                "DiagnosticOdometerAdjustmentId",
                "DiagnosticOdometerId",
                "DiagnosticOBDOdometerReaderId",
                "DiagnosticJ1939TotalVehicleDistanceId"
            ];

            const devicesToQuery = selectedUnitId !== "all"
                ? [selectedUnitId]
                : (typeof deviceMap !== "undefined" ? Object.keys(deviceMap) : []);

            if (devicesToQuery.length > 0) {
                // Llamadas para obtener la ultima lectura de odometro por dispositivo
                const anchorCalls = [];
                const anchorCallMap = [];

                devicesToQuery.forEach(devId => {
                    odometerDiagnostics.forEach(diagId => {
                        anchorCalls.push(["Get", {
                            typeName: "StatusData",
                            search: {
                                deviceSearch: { id: devId },
                                diagnosticSearch: { id: diagId },
                                resultsLimit: 1,
                                applyLatest: true
                            }
                        }]);
                        anchorCallMap.push({ devId, diagId });
                    });
                });

                api.multiCall(anchorCalls, function (anchorResults) {
                    // 1. Lectura de odometro mas reciente por dispositivo (metros -> km)
                    const latestOdoPerDev = {};

                    anchorResults.forEach((res, i) => {
                        if (!res || res.length === 0) return;
                        const reading = res[0];
                        if (reading.data === undefined) return;
                        const { devId } = anchorCallMap[i];
                        const readingDate = new Date(reading.dateTime);
                        const odoKm = reading.data / 1000;

                        if (!latestOdoPerDev[devId] || readingDate > latestOdoPerDev[devId].dateTime) {
                            latestOdoPerDev[devId] = { odoKm, dateTime: readingDate };
                        }
                    });

                    // 2. Inicializar acumuladores
                    sortedDates.forEach(dateStr => {
                        dailyData[dateStr].acumulado = 0;
                        dailyData[dateStr]._devCount = 0;
                    });

                    // 3. Para cada dispositivo, reconstruir el odometro diario hacia atras
                    devicesToQuery.forEach(devId => {
                        const anchor = latestOdoPerDev[devId];
                        if (!anchor) return;

                        // Viajes de este dispositivo ordenados del mas reciente al mas antiguo
                        const deviceTrips = (filteredTrips || [])
                            .filter(t => t.deviceId === devId)
                            .sort((a, b) => new Date(b.stop || b.start) - new Date(a.stop || a.start));

                        // Distancia recorrida por dia para este dispositivo
                        const devDailyDist = {};
                        sortedDates.forEach(d => { devDailyDist[d] = 0; });
                        deviceTrips.forEach(trip => {
                            if (!trip.start) return;
                            const dStr = trip.start.slice(0, 10);
                            if (devDailyDist[dStr] !== undefined) {
                                devDailyDist[dStr] += (parseFloat(trip.distance) || 0);
                            }
                        });

                        // Partir del ancla y ajustar viajes posteriores
                        let runningOdo = anchor.odoKm;
                        deviceTrips.forEach(trip => {
                            const tripStop = new Date(trip.stop || trip.start);
                            if (tripStop > anchor.dateTime) {
                                runningOdo -= (parseFloat(trip.distance) || 0);
                            }
                        });

                        // runningOdo = odometro al FINAL del ultimo dia del rango.
                        // Recorrer de mas reciente a mas antiguo asignando el odometro de cada dia.
                        const reversedForDev = [...sortedDates].reverse();

                        reversedForDev.forEach(dateStr => {
                            dailyData[dateStr].acumulado += runningOdo;
                            dailyData[dateStr]._devCount += 1;
                            runningOdo -= devDailyDist[dateStr];
                        });
                    });

                    // 4. Actualizar celdas del DOM
                    sortedDates.forEach(dateStr => {
                        const el = document.getElementById("odo-" + dateStr);
                        if (!el) return;
                        const day = dailyData[dateStr];
                        if (day._devCount > 0) {
                            el.textContent = day.acumulado.toLocaleString("es-MX", {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1
                            }) + " km";
                        } else {
                            el.textContent = "---";
                        }
                    });

                }, function (e) {
                    console.error("Error fetching anchor odometers:", e);
                    sortedDates.forEach(dateStr => {
                        const el = document.getElementById("odo-" + dateStr);
                        if (el) el.textContent = "---";
                    });
                });
            }
        }
                return { dailyData, sortedDates };
    };

    // ─── Reset UI ─────────────────────────────────────────────────────────────
    const resetUI = () => {
        ["stat-rendimiento", "stat-distancia", "stat-combustible", "stat-unidades"].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = "—"; el.classList.add("skeleton"); }
        });

        const ul = document.getElementById("ranking-list");
        if (ul) ul.innerHTML = Array(5).fill('<li class="ranking-skeleton"></li>').join("");

        const badgeRanking = document.getElementById("badge-ranking");
        if (badgeRanking) { badgeRanking.textContent = "—"; badgeRanking.classList.add("skeleton"); }

        const tbody = document.getElementById("perf-tbody");
        if (tbody) tbody.innerHTML = Array(5).fill('<tr class="tr-skeleton"><td colspan="5"><div class="td-skel"></div></td></tr>').join("");

        const badgeTable = document.getElementById("badge-table");
        if (badgeTable) badgeTable.textContent = "—";

        const emptyEl = document.getElementById("table-empty");
        if (emptyEl) emptyEl.style.display = "none";

        const dailyTbody = document.getElementById("daily-tbody");
        if (dailyTbody) dailyTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="5"><div class="td-skel"></div></td></tr>').join("");

        const badgeDaily = document.getElementById("badge-daily");
        if (badgeDaily) badgeDaily.textContent = "—";

        const dailyEmptyEl = document.getElementById("daily-empty");
        if (dailyEmptyEl) dailyEmptyEl.style.display = "none";

        const rawThead = document.getElementById("raw-thead");
        const rawTbody = document.getElementById("raw-tbody");
        if (rawThead) rawThead.innerHTML = `<tr><th>Cargando Combustible...</th></tr>`;
        if (rawTbody) rawTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td><div class="td-skel"></div></td></tr>').join("");

        const odoThead = document.getElementById("odo-raw-thead");
        const odoTbody = document.getElementById("odo-raw-tbody");
        if (odoThead) odoThead.innerHTML = `<tr><th>Cargando Odómetro...</th></tr>`;
        if (odoTbody) odoTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td><div class="td-skel"></div></td></tr>').join("");

        const tripsTbody = document.getElementById("trips-tbody");
        if (tripsTbody) tripsTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>').join("");

        const badgeTrips = document.getElementById("badge-trips");
        if (badgeTrips) badgeTrips.textContent = "—";

        const fuelSummaryTbody = document.getElementById("fuel-summary-tbody");
        if (fuelSummaryTbody) fuelSummaryTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="5"><div class="td-skel"></div></td></tr>').join("");

        const badgeFuelSummary = document.getElementById("badge-fuel-summary");
        if (badgeFuelSummary) badgeFuelSummary.textContent = "—";

        const odoTripsTbody = document.getElementById("odo-trips-tbody");
        if (odoTripsTbody) odoTripsTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="6"><div class="td-skel"></div></td></tr>').join("");

        const badgeOdoTrips = document.getElementById("badge-odo-trips");
        if (badgeOdoTrips) badgeOdoTrips.textContent = "—";

        if (searchInput) searchInput.value = "";
        if (tripsSearchInput) tripsSearchInput.value = "";
        if (odoTripsSearchInput) odoTripsSearchInput.value = "";
    };

    // ─── Render Charts ────────────────────────────────────────────────
    const renderCharts = (records) => {
        if (!window.ApexCharts) return;

        // ── Paleta oficial Geotab ─────────────────────────────────────────
        const cBlue     = "#003666"; // Geotab Primary Blue
        const cCyan     = "#00b1e1"; // Geotab Light Blue
        const cGreen    = "#3b753c"; // Geotab Green
        const cOrange   = "#f29300"; // Geotab Amber/Orange
        const cRed      = "#cc0000"; // Geotab Red
        const cSlate    = "#5e6c84"; // texto mútil / eje muted
        const textMuted = cSlate;
        const fontFamily = "'Inter', sans-serif";

        const commonOptions = {
            chart: { fontFamily, toolbar: { show: false } },
            dataLabels: { enabled: false },
            tooltip: { theme: 'light' }
        };

        const destroyChart = (instance) => { try { if (instance) instance.destroy(); } catch(e) {} };

        // ── 1. Tendencia Diaria de Rendimiento Flota (km/L) — Área azul Geotab ──
        const dailyResult = renderDailyTable();
        const { dailyData, sortedDates } = dailyResult || { dailyData: {}, sortedDates: [] };

        const trendSeries = sortedDates.map(date => {
            const day = dailyData[date];
            const eff = day.fuel > 0 ? (day.dist / day.fuel) : 0;
            return { x: date, y: parseFloat(eff.toFixed(1)) };
        });

        const optTrendDaily = {
            ...commonOptions,
            series: [{ name: 'Rendimiento Promedio (km/L)', data: trendSeries }],
            chart: { type: 'area', height: 260, fontFamily, toolbar: { show: false }, zoom: { enabled: false } },
            dataLabels: {
                enabled: true,
                formatter: val => val.toFixed(1),
                offsetY: -6,
                style: { fontSize: '11px', fontWeight: '700', colors: [cBlue] },
                background: { enabled: true, foreColor: '#fff', borderRadius: 4, borderWidth: 0, opacity: 0.9 }
            },
            stroke: { curve: 'smooth', width: 2.5 },
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 100],
                    colorStops: [{ offset: 0, color: cCyan, opacity: 0.35 }, { offset: 100, color: cCyan, opacity: 0 }] }
            },
            colors: [cCyan],
            xaxis: {
                type: 'datetime',
                labels: { style: { colors: textMuted, fontSize: '11px' }, format: 'dd MMM' },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: { labels: { style: { colors: textMuted }, formatter: val => val.toFixed(1) + ' km/L' } },
            grid: { borderColor: '#eaecf0', strokeDashArray: 4 },
            markers: { size: 4, colors: ['#fff'], strokeColors: cCyan, strokeWidth: 2.5, hover: { size: 7 } },
            noData: { text: 'Sin datos de tendencia', align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };
        destroyChart(chartEffByUnit);
        chartEffByUnit = new ApexCharts(document.querySelector("#chart-eff-unit"), optTrendDaily);
        chartEffByUnit.render();

        // ── 2. Consumo Diario vs Distancia — Columnas azul Geotab + línea naranja ──
        const dailyFuelSeries = sortedDates.map(d => parseFloat((dailyData[d].fuel || 0).toFixed(2)));
        const dailyDistSeries = sortedDates.map(d => parseFloat((dailyData[d].dist || 0).toFixed(1)));

        const optDailyFuel = {
            ...commonOptions,
            series: [
                { name: 'Combustible (L)', type: 'column', data: dailyFuelSeries },
                { name: 'Distancia (km)',  type: 'line',   data: dailyDistSeries }
            ],
            chart: { type: 'line', height: 240, fontFamily, toolbar: { show: false }, zoom: { enabled: false } },
            stroke: { width: [0, 2.5], curve: 'smooth' },
            plotOptions: { bar: { columnWidth: '52%', borderRadius: 3 } },
            colors: [cBlue, cOrange],
            fill: { opacity: [0.90, 1] },
            xaxis: {
                categories: sortedDates,
                labels: { style: { colors: textMuted, fontSize: '11px' }, rotate: -30, rotateAlways: true },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: [
                { seriesName: 'Combustible (L)',
                  labels: { style: { colors: cBlue, fontSize: '11px' }, formatter: v => v.toFixed(0) + ' L' } },
                { seriesName: 'Distancia (km)', opposite: true,
                  labels: { style: { colors: cOrange, fontSize: '11px' }, formatter: v => v.toFixed(0) + ' km' } }
            ],
            legend: { position: 'top', horizontalAlign: 'right', fontSize: '12px',
                      markers: { width: 10, height: 10, radius: 2 } },
            grid: { borderColor: '#eaecf0', strokeDashArray: 4 },
            tooltip: { shared: true, intersect: false, theme: 'light' },
            markers: { size: [0, 4], colors: ['#fff'], strokeColors: cOrange, strokeWidth: 2 },
            noData: { text: 'Sin datos', align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };
        destroyChart(chartDailyFuel);
        chartDailyFuel = new ApexCharts(document.querySelector("#chart-daily-fuel"), optDailyFuel);
        chartDailyFuel.render();

        // ── 3. Distribución de Velocidad Máxima — Donut paleta Geotab ──────────
        const speedBuckets = { '0–40 km/h': 0, '40–80 km/h': 0, '80–100 km/h': 0, '100–120 km/h': 0, '>120 km/h': 0 };
        (filteredTrips || []).forEach(t => {
            const v = t.maxSpeed || 0;
            if (v <= 40)       speedBuckets['0–40 km/h']++;
            else if (v <= 80)  speedBuckets['40–80 km/h']++;
            else if (v <= 100) speedBuckets['80–100 km/h']++;
            else if (v <= 120) speedBuckets['100–120 km/h']++;
            else               speedBuckets['>120 km/h']++;
        });

        const optSpeedDist = {
            ...commonOptions,
            series: Object.values(speedBuckets),
            chart: { type: 'donut', height: 240, fontFamily },
            labels: Object.keys(speedBuckets),
            // Paleta Geotab: verde → cyan → naranja → rojo → azul oscuro
            colors: [cGreen, cCyan, cOrange, cRed, cBlue],
            legend: { position: 'bottom', fontSize: '11px', fontFamily,
                      labels: { colors: textMuted },
                      markers: { width: 10, height: 10, radius: 2 } },
            plotOptions: {
                pie: {
                    donut: {
                        size: '62%',
                        labels: {
                            show: true,
                            value: { fontSize: '18px', fontWeight: '800', color: cBlue,
                                     formatter: val => Math.round(val) },
                            total: {
                                show: true,
                                label: 'Total Viajes',
                                fontSize: '11px',
                                fontWeight: '600',
                                color: textMuted,
                                formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0)
                            }
                        }
                    }
                }
            },
            dataLabels: { enabled: false },
            tooltip: { y: { formatter: val => val + ' viajes' } },
            stroke: { width: 2, colors: ['#fff'] },
            noData: { text: 'Sin datos de velocidad', align: 'center', verticalAlign: 'middle', style: { color: textMuted } }
        };
        destroyChart(chartSpeedDist);
        chartSpeedDist = new ApexCharts(document.querySelector("#chart-speed-dist"), optSpeedDist);
        chartSpeedDist.render();

        // ── 4. Eficiencia por Conductor — Barras horizontales paleta Geotab ───
        const driverEff = {};
        (filteredTrips || []).forEach(t => {
            const name = t.driverName || 'Sin Conductor';
            if (!driverEff[name]) driverEff[name] = { dist: 0, fuel: 0 };
            driverEff[name].dist += (parseFloat(t.distance) || 0);
            driverEff[name].fuel += (parseFloat(t.fuelUsed) || 0);
        });

        const driverData = Object.entries(driverEff)
            .map(([name, v]) => ({ name, kmPerL: v.fuel > 0 ? v.dist / v.fuel : 0 }))
            .filter(d => d.kmPerL > 0)
            .sort((a, b) => b.kmPerL - a.kmPerL)
            .slice(0, 14);

        // Colores Geotab por umbral de eficiencia
        const driverColors = driverData.map(d => {
            if (d.kmPerL >= 12) return cGreen;   // Excelente
            if (d.kmPerL >= 8)  return cCyan;    // Bueno
            if (d.kmPerL >= 5)  return cOrange;  // Regular
            return cRed;                          // Bajo
        });

        const optDriverEff = {
            ...commonOptions,
            series: [{ name: 'Rendimiento (km/L)', data: driverData.map(d => parseFloat(d.kmPerL.toFixed(2))) }],
            chart: { type: 'bar', height: Math.max(240, driverData.length * 34 + 60),
                     fontFamily, toolbar: { show: false } },
            plotOptions: {
                bar: { horizontal: true, distributed: true, barHeight: '55%', borderRadius: 4 }
            },
            colors: driverColors,
            dataLabels: {
                enabled: true,
                formatter: val => val.toFixed(1) + ' km/L',
                offsetX: 6,
                style: { fontSize: '11px', fontWeight: '700', colors: [cBlue] }
            },
            xaxis: {
                categories: driverData.map(d => d.name),
                labels: { style: { colors: textMuted, fontSize: '11px' }, formatter: v => v.toFixed(0) + ' km/L' }
            },
            yaxis: { labels: { style: { colors: cBlue, fontSize: '11px', fontWeight: '600' } } },
            legend: { show: false },
            grid: { borderColor: '#eaecf0', strokeDashArray: 4,
                    xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
            tooltip: { y: { formatter: val => val.toFixed(2) + ' km/L' } },
            noData: { text: 'Sin datos de conductores', align: 'center', verticalAlign: 'middle',
                      style: { color: textMuted } }
        };
        destroyChart(chartDriverEff);
        chartDriverEff = new ApexCharts(document.querySelector("#chart-driver-eff"), optDriverEff);
        chartDriverEff.render();
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

    const applyOdoTripsSearch = (query) => {
        let trips = [...allTrips];
        if (selectedUnitId !== "all") {
            trips = trips.filter(t => t.deviceId === selectedUnitId);
        }
        if (query && query.trim() !== "") {
            const q = query.trim().toLowerCase();
            trips = trips.filter(t => t.deviceName.toLowerCase().includes(q));
        }
        filteredOdoTrips = trips;
        renderOdoTripsTable(filteredOdoTrips);
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

        if (odoTripsSearchInput && odoTripsSearchInput.value) applyOdoTripsSearch(odoTripsSearchInput.value);
        else renderOdoTripsTable(filteredTrips);

        // Update Summary (KPIs) with filtered records and trips
        renderSummary(filteredRecords, filteredTrips);

        // Update Raw Tables
        renderRawTable(rawStatusData, deviceMap);
        renderOdoRawTable(rawStatusData, deviceMap);
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
                if (!s.diagnostic) s.diagnostic = { id: "DiagnosticDeviceTotalFuelId" };
                if (s.device && s.device.id && deviceMap[s.device.id]) {
                    s.device.name = deviceMap[s.device.id];
                }
            });
            odoData.forEach(function (s) {
                if (!s.diagnostic) s.diagnostic = { id: "DiagnosticOdometerId" };
                if (s.device && s.device.id && deviceMap[s.device.id]) {
                    s.device.name = deviceMap[s.device.id];
                }
            });

            // Store raw data for raw table (combine fuel + odo)
            rawStatusData = [].concat(fuelData, odoData);

            // Process into performance records per device
            allRecords = processStatusData(fuelData, odoData, deviceMap);
            filteredRecords = allRecords.slice();

            // Process Trips Performance using fuelData (StatusData) instead of FuelUsed entity
            allTrips = processTripsData(tripsRaw, fuelData, deviceMap, driverMap);
            filteredTrips = allTrips.slice();

            // ── Enrich allRecords with trip-based distance (same source as KPIs & daily table) ──
            // processStatusData calculates distKm from odometer delta which can be 0
            // when Geotab returns only one odometer reading per device in the range.
            // Using trip distances avoids that problem completely.
            const tripDistByDevice = {};
            allTrips.forEach(function (t) {
                if (!t.deviceId) return;
                if (!tripDistByDevice[t.deviceId]) tripDistByDevice[t.deviceId] = 0;
                tripDistByDevice[t.deviceId] += (parseFloat(t.distance) || 0);
            });
            allRecords.forEach(function (r) {
                const tripDist = tripDistByDevice[r.deviceId];
                if (tripDist !== undefined && tripDist > 0) {
                    r.distKm = tripDist;
                    r.kmPerL = r.fuelUsed > 0 ? r.distKm / r.fuelUsed : 0;
                }
            });
            // Also add records for devices that have trips but no StatusData fuel record
            Object.keys(tripDistByDevice).forEach(function (devId) {
                const alreadyInRecords = allRecords.some(function (r) { return r.deviceId === devId; });
                if (!alreadyInRecords && tripDistByDevice[devId] > 0) {
                    allRecords.push({
                        deviceId: devId,
                        deviceName: deviceMap[devId] || devId,
                        fuelUsed: 0,
                        distKm: tripDistByDevice[devId],
                        kmPerL: 0,
                        odoStart: 0, odoEnd: 0,
                        dateStart: null, dateEnd: null,
                        fuelReadingsCount: 0,
                        odoReadingsCount: 0
                    });
                }
            });
            filteredRecords = allRecords.slice();

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
            renderOdoTripsTable(filteredTrips);
            renderRawTable(rawStatusData, deviceMap);
            renderOdoRawTable(rawStatusData, deviceMap);

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
            odoTripsSearchInput = document.getElementById("odo-trips-search-input");
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

            if (odoTripsSearchInput) {
                var odoTripsSearchTimer = null;
                odoTripsSearchInput.addEventListener("input", function () {
                    clearTimeout(odoTripsSearchTimer);
                    odoTripsSearchTimer = setTimeout(function () { applyOdoTripsSearch(odoTripsSearchInput.value); }, 250);
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
