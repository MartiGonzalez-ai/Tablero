"use strict";

geotab.addin.rendimiento = function () {
    let api;
    let selectedDays = 0;
    let customFromDate = null;
    let customToDate = null;
    let isCustomRange = false;
    // UI Elements Cache
    let UI = {};

    // Chart instances
    let chartEffByUnit, chartDailyFuel, chartSpeedDist, chartDriverEff;

    // Data containers
    let allTrips = [], filteredTrips = [];
    let filteredOdoTrips = [];
    let rawStatusData = [];    // Raw StatusData for the raw table
    let allRecords = [];       // Processed performance records (per device)
    let filteredRecords = [];
    let deviceMap = {};        // Global device map
    let driverMap = {};        // Global driver map


    // ─── Helpers ─────────────────────────────────────────────────────────────
    const getDateRange = () => {
        if (isCustomRange && customFromDate && customToDate) {
            return { fromDate: customFromDate, toDate: customToDate };
        }
        const toDate = new Date();
        const fromDate = new Date();
        if (selectedDays === 0) {
            fromDate.setHours(0, 0, 0, 0);
        } else {
            fromDate.setDate(fromDate.getDate() - selectedDays);
        }
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


    const renderSummary = (records) => {
        if (!records || records.length === 0) {
            if (UI.statRendimiento) UI.statRendimiento.textContent = "0.0";
            if (UI.statDistancia) UI.statDistancia.textContent = "0.00";
            if (UI.statCombustible) UI.statCombustible.textContent = "0.00";
            if (UI.statUnidades) UI.statUnidades.textContent = "0";
            if (UI.statTotalBadge) UI.statTotalBadge.textContent = "0 Unidades";
            return;
        }

        let totalDist = 0, totalFuel = 0;
        records.forEach(r => {
            totalDist += (r.distKm || 0);
            totalFuel += (r.fuelUsed || 0);
        });

        const avgEff = totalFuel > 0 ? (totalDist / totalFuel) : 0;

        if (UI.statRendimiento) animateCount(UI.statRendimiento, avgEff, 1);
        if (UI.statDistancia) animateCount(UI.statDistancia, totalDist, 1);
        if (UI.statCombustible) animateCount(UI.statCombustible, totalFuel, 1);
        if (UI.statUnidades) UI.statUnidades.textContent = records.length;
        if (UI.statTotalBadge) UI.statTotalBadge.textContent = `${records.length} Unidades`;
    };

    // ─── Render ranking ──────────────────────────────────────────────────────
    const renderRanking = (records) => {
        if (!UI.rankingList) return;
        
        const sorted = [...records].filter(r => r.kmPerL > 0).sort((a, b) => b.kmPerL - a.kmPerL);
        const top5 = sorted.slice(0, 5);
        const fragment = document.createDocumentFragment();

        top5.forEach((r, idx) => {
            const item = document.createElement("div");
            item.className = "ranking-item";
            item.innerHTML = `
                <div class="ranking-info">
                    <div class="ranking-rank rank-${idx + 1}">${idx + 1}</div>
                    <div class="ranking-name-group">
                        <span class="ranking-name">${r.deviceName}</span>
                        <span class="ranking-sub">${r.distKm.toFixed(1)} km</span>
                    </div>
                </div>
                <div class="ranking-value">${r.kmPerL.toFixed(1)} <small>km/l</small></div>
            `;
            fragment.appendChild(item);
        });

        UI.rankingList.innerHTML = "";
        UI.rankingList.appendChild(fragment);
        if (UI.badgeRanking) UI.badgeRanking.textContent = records.length;
    };

    const renderTable = (records) => {
        if (!UI.perfTbody) return;
        
        if (records.length === 0) {
            UI.perfTbody.innerHTML = "";
            if (UI.tableEmpty) UI.tableEmpty.style.display = "block";
            if (UI.badgeTable) UI.badgeTable.textContent = "0";
            return;
        }

        if (UI.tableEmpty) UI.tableEmpty.style.display = "none";
        const fragment = document.createDocumentFragment();

        records.forEach(r => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div class="unit-cell">
                        <div class="unit-icon"><i data-lucide="truck"></i></div>
                        <div class="unit-info">
                            <span class="unit-name">${r.deviceName}</span>
                            <span class="unit-id">${r.deviceId}</span>
                        </div>
                    </div>
                </td>
                <td><div class="stat-main">${r.distKm.toFixed(2)} <span class="stat-unit">km</span></div></td>
                <td><div class="stat-main">${r.fuelUsed.toFixed(2)} <span class="stat-unit">L</span></div></td>
                <td>
                    <div class="rendimiento-cell">
                        <span class="rendimiento-val">${r.kmPerL.toFixed(2)}</span>
                        <span class="stat-unit">km/l</span>
                    </div>
                </td>
            `;
            fragment.appendChild(tr);
        });

        UI.perfTbody.innerHTML = "";
        UI.perfTbody.appendChild(fragment);
        if (window.lucide) lucide.createIcons({ scope: UI.perfTbody });
        if (UI.badgeTable) UI.badgeTable.textContent = records.length;
    };

    const renderTripsTable = (trips) => {
        if (!UI.tripsTbody) return;
        
        if (trips.length === 0) {
            UI.tripsTbody.innerHTML = "";
            if (UI.tripsEmpty) UI.tripsEmpty.style.display = "block";
            if (UI.badgeTrips) UI.badgeTrips.textContent = "0";
            return;
        }

        if (UI.tripsEmpty) UI.tripsEmpty.style.display = "none";
        const fragment = document.createDocumentFragment();

        trips.forEach(t => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div class="unit-info">
                        <span class="unit-name">${t.deviceName || t.deviceId}</span>
                        <span class="unit-id">${t.deviceId}</span>
                    </div>
                </td>
                <td>
                    <div class="stat-main">${formatDateTime(t.start)}</div>
                </td>
                <td>
                    <div class="stat-main">${(t.distance || 0).toFixed(2)} <span class="stat-unit">km</span></div>
                </td>
                <td>
                    <div class="stat-main">${formatDuration(t.drivingDuration)}</div>
                </td>
            `;
            fragment.appendChild(tr);
        });

        UI.tripsTbody.innerHTML = "";
        UI.tripsTbody.appendChild(fragment);
        if (UI.badgeTrips) UI.badgeTrips.textContent = trips.length;
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

    // ─── Export to Excel ─────────────────────────────────────────────────────
    const exportToExcel = (tableId, filename) => {
        const table = document.getElementById(tableId);
        if (!table) return;
        
        // Use SheetJS to convert table to workbook
        const wb = XLSX.utils.table_to_book(table, { sheet: "Datos" });
        XLSX.writeFile(wb, filename + "_" + new Date().toISOString().slice(0,10) + ".xlsx");
    };



    // ─── Reset UI ─────────────────────────────────────────────────────────────
    const resetUI = () => {
        // KPIs & Labels
        ["stat-rendimiento", "stat-distancia", "stat-combustible", "stat-unidades"].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = "—"; el.classList.add("skeleton"); }
        });
        if (UI.lastUpdated) UI.lastUpdated.textContent = "Cargando...";

        // Lists/Tables
        if (UI.rankingList) UI.rankingList.innerHTML = Array(5).fill('<li class="ranking-skeleton"></li>').join("");
        if (UI.perfTbody) UI.perfTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="5"><div class="td-skel"></div></td></tr>').join("");
        
        const badges = [UI.badgeRanking, UI.badgeTable, UI.badgeDaily, UI.badgeTrips, UI.badgeOdoTrips, UI.badgeRaw, UI.badgeRawOdo];
        badges.forEach(b => { if (b) { b.textContent = "—"; b.classList.add("skeleton"); } });

        if (UI.dailyTbody) UI.dailyTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="5"><div class="td-skel"></div></td></tr>').join("");
        if (UI.tripsTbody) UI.tripsTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td colspan="13"><div class="td-skel"></div></td></tr>').join("");
        if (UI.rawTbody) UI.rawTbody.innerHTML = Array(3).fill('<tr class="tr-skeleton"><td><div class="td-skel"></div></td></tr>').join("");
    };

    const calculateDailyData = (trips) => {
        const daily = {};
        (trips || []).forEach(t => {
            if (!t.start) return;
            const date = new Date(t.start).toISOString().split('T')[0];
            if (!daily[date]) daily[date] = { dist: 0, fuel: 0 };
            daily[date].dist += (parseFloat(t.distance) || 0);
            daily[date].fuel += (parseFloat(t.fuelUsed) || 0);
        });
        return daily;
    };

    const renderDailyTable = (trips) => {
        const tbody = document.getElementById("daily-tbody");
        if (!tbody) return {};
        const dailyData = calculateDailyData(trips);
        const sortedDates = Object.keys(dailyData).sort().reverse();
        const fragment = document.createDocumentFragment();

        sortedDates.forEach(date => {
            const d = dailyData[date];
            const eff = d.fuel > 0 ? d.dist / d.fuel : 0;
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><div class="stat-main">${formatDateShort(date)}</div></td>
                <td><div class="stat-main">${d.dist.toFixed(1)} <span class="stat-unit">km</span></div></td>
                <td><div class="stat-main">${d.fuel.toFixed(2)} <span class="stat-unit">L</span></div></td>
                <td><div class="stat-main">${eff.toFixed(2)} <span class="stat-unit">km/l</span></div></td>
            `;
            fragment.appendChild(tr);
        });

        tbody.innerHTML = "";
        tbody.appendChild(fragment);
        if (UI.badgeDaily) UI.badgeDaily.textContent = sortedDates.length;
        return { dailyData, sortedDates };
    };

    // ─── Render Charts ────────────────────────────────────────────────
    const renderCharts = (records) => {
        if (!records || !window.ApexCharts) return;

        const cCyan = "#00b1e1", cOrange = "#f29300", cGreen = "#10b981", cRed = "#ef4444", cBlue = "#003666";
        const textMuted = "#64748b";

        // Top 10 Optimization
        const sortedTop = [...records].sort((a, b) => b.kmPerL - a.kmPerL).slice(0, 10);
        const unitNames = sortedTop.map(r => r.deviceName);
        const unitEffs = sortedTop.map(r => parseFloat(r.kmPerL.toFixed(2)));

        if (!chartEffByUnit) {
            chartEffByUnit = new ApexCharts(document.querySelector("#chart-eff-unit"), {
                chart: { type: 'bar', height: 260, toolbar: { show: false }, background: 'transparent' },
                series: [{ name: 'Rendimiento', data: unitEffs }],
                xaxis: { categories: unitNames, labels: { style: { colors: textMuted } } },
                colors: [cCyan],
                theme: { mode: 'light' },
                plotOptions: { bar: { borderRadius: 4, horizontal: true } }
            });
            chartEffByUnit.render();
        } else {
            chartEffByUnit.updateOptions({ xaxis: { categories: unitNames } });
            chartEffByUnit.updateSeries([{ data: unitEffs }]);
        }

        // Daily Trend logic from existing trips
        const dailyDataResult = calculateDailyData(filteredTrips);
        const sortedDates = Object.keys(dailyDataResult).sort();
        const trendValues = sortedDates.map(date => {
            const d = dailyDataResult[date];
            return parseFloat((d.fuel > 0 ? d.dist / d.fuel : 0).toFixed(2));
        });
        const dateLabels = sortedDates.map(date => formatDateShort(date));

        if (!chartDailyFuel) {
            chartDailyFuel = new ApexCharts(document.querySelector("#chart-daily-fuel"), {
                chart: { type: 'area', height: 260, toolbar: { show: false } },
                series: [{ name: 'Rendimiento Promedio', data: trendValues }],
                xaxis: { categories: dateLabels, labels: { style: { colors: textMuted } } },
                stroke: { curve: 'smooth', width: 3 },
                colors: [cGreen],
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } }
            });
            chartDailyFuel.render();
        } else {
            chartDailyFuel.updateOptions({ xaxis: { categories: dateLabels } });
            chartDailyFuel.updateSeries([{ data: trendValues }]);
        }

        const speedBuckets = { '0–40': 0, '40–80': 0, '80–100': 0, '100–120': 0, '>120': 0 };
        (filteredTrips || []).forEach(t => {
            const v = t.maxSpeed || 0;
            if (v <= 40) speedBuckets['0–40']++;
            else if (v <= 80) speedBuckets['40–80']++;
            else if (v <= 100) speedBuckets['80–100']++;
            else if (v <= 120) speedBuckets['100–120']++;
            else speedBuckets['>120']++;
        });

        if (!chartSpeedDist) {
            chartSpeedDist = new ApexCharts(document.querySelector("#chart-speed-dist"), {
                chart: { type: 'donut', height: 260 },
                series: Object.values(speedBuckets),
                labels: Object.keys(speedBuckets),
                colors: [cGreen, cCyan, cOrange, cRed, cBlue],
                plotOptions: { pie: { donut: { size: '65%' } } }
            });
            chartSpeedDist.render();
        } else {
            chartSpeedDist.updateSeries(Object.values(speedBuckets));
        }
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
        if (selectedUnitId === "all") {
            filteredRecords = [...allRecords];
            filteredTrips = [...allTrips];
        } else {
            filteredRecords = allRecords.filter(r => r.deviceId === selectedUnitId);
            filteredTrips = allTrips.filter(t => t.deviceId === selectedUnitId);
        }

        renderSummary(filteredRecords);
        renderRanking(filteredRecords);
        renderTable(filteredRecords);
        renderCharts(filteredRecords);
        renderDailyTable(filteredTrips);
        renderTripsTable(filteredTrips);
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

            renderSummary(allRecords);
            renderRanking(allRecords);
            renderTable(filteredRecords);
            renderCharts(filteredRecords);
            renderDailyTable(filteredTrips);
            renderTripsTable(filteredTrips);
            renderRawTable(rawStatusData, deviceMap);

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

            // Cache all UI references once
            UI = {
                btnRefresh: document.getElementById("btn-refresh"),
                lastUpdated: document.getElementById("last-updated-time"),
                errorToast: document.getElementById("error-toast"),
                errorToastMsg: document.getElementById("error-toast-msg"),
                searchInput: document.getElementById("search-input"),
                tripsSearchInput: document.getElementById("trips-search-input"),
                odoTripsSearchInput: document.getElementById("odo-trips-search-input"),
                unitSelect: document.getElementById("unit-select"),
                trendSelect: document.getElementById("trend-timeframe-select"),
                btnCustom: document.getElementById("btn-custom"),
                datePopover: document.getElementById("date-popover"),
                dateFromInput: document.getElementById("date-from"),
                dateToInput: document.getElementById("date-to"),
                btnApply: document.getElementById("btn-date-apply"),
                btnCancel: document.getElementById("btn-date-cancel"),
                
                // Tables & Lists
                rankingList: document.getElementById("ranking-list"),
                perfTbody: document.getElementById("perf-tbody"),
                dailyTbody: document.getElementById("daily-tbody"),
                tripsTbody: document.getElementById("trips-tbody"),
                odoTripsTbody: document.getElementById("odo-trips-tbody"),
                rawThead: document.getElementById("raw-thead"),
                rawTbody: document.getElementById("raw-tbody"),
                odoRawThead: document.getElementById("odo-raw-thead"),
                odoRawTbody: document.getElementById("odo-raw-tbody"),

                // Badges
                badgeRanking: document.getElementById("badge-ranking"),
                badgeTable: document.getElementById("badge-table"),
                badgeDaily: document.getElementById("badge-daily"),
                badgeTrips: document.getElementById("badge-trips"),
                badgeOdoTrips: document.getElementById("badge-odo-trips"),
                badgeRaw: document.getElementById("badge-raw"),
                badgeRawOdo: document.getElementById("badge-raw-odo"),

                // Empty States
                tableEmpty: document.getElementById("table-empty"),
                dailyEmpty: document.getElementById("daily-empty"),
                tripsEmpty: document.getElementById("trips-empty"),
                odoTripsEmpty: document.getElementById("odo-trips-empty"),

                // KPIs
                statRendimiento: document.getElementById("stat-rendimiento"),
                statDistancia: document.getElementById("stat-distancia"),
                statCombustible: document.getElementById("stat-combustible"),
                statUnidades: document.getElementById("stat-unidades"),
                statTotalBadge: document.getElementById("stat-total-badge")
            };

            // Legacy refs backfill
            btnRefresh = UI.btnRefresh;
            lastUpdatedEl = UI.lastUpdated;
            errorToast = UI.errorToast;
            errorToastMsg = UI.errorToastMsg;
            if (UI.odoTripsSearchInput) UI.odoTripsSearchInput.value = "";

            if (window.lucide) {
                lucide.createIcons();
            }

            // Unit Filter Event
            if (UI.unitSelect) {
                UI.unitSelect.addEventListener("change", function () {
                    selectedUnitId = UI.unitSelect.value;
                    applyUnitFilter();
                });
            }

            // Trend grouping select
            if (UI.trendSelect) {
                UI.trendSelect.addEventListener("change", function () {
                    trendGrouping = UI.trendSelect.value;
                    if (filteredRecords) {
                        renderCharts(filteredRecords);
                    }
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
                    if (UI.btnCustom) {
                        UI.btnCustom.innerHTML = '<i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i> Personalizado';
                        if (window.lucide) lucide.createIcons();
                    }
                    loadData();
                });
            });

            // Custom date setup
            var todayStr = new Date().toISOString().slice(0, 10);
            var weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            if(UI.dateFromInput) UI.dateFromInput.value = weekAgo.toISOString().slice(0, 10);
            if(UI.dateToInput) {
                UI.dateToInput.value = todayStr;
                UI.dateToInput.max = todayStr;
            }

            var closePopover = function () { UI.datePopover.classList.remove("open"); };

            if(UI.btnCustom) {
                UI.btnCustom.addEventListener("click", function (e) {
                    e.stopPropagation();
                    UI.datePopover.classList.toggle("open");
                });
            }

            if(UI.btnCancel) UI.btnCancel.addEventListener("click", closePopover);

            if(UI.btnApply) {
                UI.btnApply.addEventListener("click", function () {
                    var from = UI.dateFromInput.value;
                    var to = UI.dateToInput.value;
                    if (!from || !to) { showError("Selecciona ambas fechas."); return; }
                    if (new Date(from) > new Date(to)) { showError("'Desde' no puede ser mayor que 'Hasta'."); return; }

                    customFromDate = new Date(from + "T00:00:00").toISOString();
                    customToDate = new Date(to + "T23:59:59").toISOString();
                    isCustomRange = true;

                    var fmt = function (s) { return new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" }); };
                    UI.btnCustom.innerHTML = '<i data-lucide="calendar" width="13" height="13" stroke-width="2.5"></i> ' + fmt(from) + " – " + fmt(to);
                    if (window.lucide) lucide.createIcons();

                    document.querySelectorAll(".btn-range").forEach(function (b) { b.classList.remove("active"); });
                    UI.btnCustom.classList.add("active");
                    closePopover();
                    loadData();
                });
            }

            document.addEventListener("click", function (e) {
                if (UI.datePopover && !UI.datePopover.contains(e.target) && e.target !== UI.btnCustom) closePopover();
            });

            if(UI.dateFromInput) UI.dateFromInput.addEventListener("change", function () { UI.dateToInput.min = UI.dateFromInput.value; });

            // Search
            if (UI.searchInput) {
                var searchTimer = null;
                UI.searchInput.addEventListener("input", function () {
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(function () { applySearch(UI.searchInput.value); }, 250);
                });
            }
            if (UI.tripsSearchInput) {
                var tripsSearchTimer = null;
                UI.tripsSearchInput.addEventListener("input", function () {
                    clearTimeout(tripsSearchTimer);
                    tripsSearchTimer = setTimeout(function () { applyTripsSearch(UI.tripsSearchInput.value); }, 250);
                });
            }

            if (UI.odoTripsSearchInput) {
                var odoTripsSearchTimer = null;
                UI.odoTripsSearchInput.addEventListener("input", function () {
                    clearTimeout(odoTripsSearchTimer);
                    odoTripsSearchTimer = setTimeout(function () { applyOdoTripsSearch(UI.odoTripsSearchInput.value); }, 250);
                });
            }

            UI.btnRefresh.addEventListener("click", function () { loadData(); });

            // Export Excel Listeners
            document.querySelectorAll(".btn-export-excel").forEach(btn => {
                btn.addEventListener("click", function () {
                    const tableId = btn.dataset.table;
                    const tableName = btn.closest('.panel').querySelector('.panel-title-group span').textContent;
                    exportToExcel(tableId, tableName.replace(/\s+/g, '_'));
                });
            });

            if (window.lucide) lucide.createIcons();

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
