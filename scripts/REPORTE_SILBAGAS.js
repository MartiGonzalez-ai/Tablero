/**
 * ===================================================================
 * REPORTE_SILBAGAS.JS — Geotab Add-In: Servicios de taller y Recorridos
 * ===================================================================
 * Dos secciones independientes (Servicios / Recorridos); cada una consulta
 * solo sus propios datos. Filtros con el comportamiento de MyGeotab (Zenith
 * FiltersBar): periodo con presets y flechas de paso, vehículos con
 * selección múltiple, y "Restablecer" cuando difieren de los valores por defecto.
 * ===================================================================
 */

"use strict";

const initSilbagasAddin = function (_api, _state, _callback) {

    // ── API & Estado ────────────────────────────────────────────
    let api = _api || null;
    let units = [];
    let unitsById = new Map();
    let eventsAttached = false;

    // Filtros aplicados (como en Zenith, el periodo guarda preset + desplazamiento)
    const DEFAULT_PERIOD = { id: "thisMonth", offset: 0 };
    let period = { ...DEFAULT_PERIOD };
    let selectedUnitIds = [];          // [] = todos los vehículos
    let pendingUnitIds = new Set();    // selección en edición dentro del dropdown

    // Sección activa y última consulta cargada por sección (null = sin cargar)
    const SECTIONS = ["servicios", "recorridos"];
    let activeSection = "servicios";
    const loadedKeys = { servicios: null, recorridos: null };
    let requestSeq = 0;

    // Paginación
    let currentTripsPage = 1;
    const TRIPS_PER_PAGE = 15;
    let rawTripsList = [];

    let currentTallerPage = 1;
    const TALLER_PER_PAGE = 10;
    let rawTallerList = [];

    const $ = id => document.getElementById(id);
    const refreshIcons = () => { if (window.lucide) lucide.createIcons(); };

    // ── Helpers ─────────────────────────────────────────────────
    let alertTimer = null;
    const showError = msg => {
        const alertEl = $("sg-alert");
        const msgEl = $("sg-alert-msg");
        if (msgEl) msgEl.textContent = msg;
        if (!alertEl) return;
        alertEl.hidden = false;
        clearTimeout(alertTimer);
        alertTimer = setTimeout(() => { alertEl.hidden = true; }, 6000);
    };

    const escapeHtml = str => String(str == null ? "" : str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const localDateStr = d =>
        d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");

    const fmtNum = (n, dec = 1) =>
        (n || 0).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

    const fmtDate = d => d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
    const fmtDateTime = v => v ? new Date(v).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—";

    const parseSeconds = val => {
        if (val === undefined || val === null) return 0;
        if (typeof val === "number") return val;
        if (typeof val === "string") {
            if (val.includes(":")) {
                const parts = val.split(":");
                if (parts.length === 3) {
                    let hours = 0;
                    if (parts[0].includes(".")) {
                        const dayParts = parts[0].split(".");
                        hours = parseInt(dayParts[0], 10) * 24 + parseInt(dayParts[1], 10);
                    } else {
                        hours = parseInt(parts[0], 10);
                    }
                    return (hours * 3600) + (parseInt(parts[1], 10) * 60) + parseFloat(parts[2]);
                }
            }
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    };

    const fmtHrs = val => {
        const sec = parseSeconds(val);
        if (!sec || sec <= 0) return "0h 00m";
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}h ${String(m).padStart(2, "0")}m`;
    };

    // Milisegundos a días, horas y minutos (ej. 3d 14h 25m)
    const fmtDurationMs = ms => {
        if (!ms || ms <= 0) return "0h 00m";
        const totalSec = Math.floor(ms / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m`;
        return `${hours}h ${String(mins).padStart(2, "0")}m`;
    };

    // ════════════════════════════════════════════════════════════
    // PERIODO (equivalente a Zenith FiltersBar.PeriodPicker)
    // ════════════════════════════════════════════════════════════
    const startOfDay = d => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; };
    const endOfDay = d => { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; };
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
    const addMonths = (d, n) => { const r = new Date(d); r.setDate(1); r.setMonth(r.getMonth() + n); return r; };
    const startOfWeek = d => { const r = startOfDay(d); const day = r.getDay(); return addDays(r, day === 0 ? -6 : 1 - day); };

    // Presets en el mismo orden que MyGeotab
    const PERIOD_OPTIONS = [
        { id: "today",       label: "Hoy",              range: o => { const d = addDays(startOfDay(new Date()), o); return [d, endOfDay(d)]; } },
        { id: "yesterday",   label: "Ayer",             range: o => { const d = addDays(startOfDay(new Date()), o - 1); return [d, endOfDay(d)]; } },
        { id: "thisWeek",    label: "Esta semana",      range: o => { const s = addDays(startOfWeek(new Date()), o * 7); return [s, endOfDay(addDays(s, 6))]; } },
        { id: "lastWeek",    label: "Semana pasada",    range: o => { const s = addDays(startOfWeek(new Date()), (o - 1) * 7); return [s, endOfDay(addDays(s, 6))]; } },
        { id: "thisMonth",   label: "Este mes",         range: o => { const s = addMonths(startOfDay(new Date()), o); return [s, endOfDay(addDays(addMonths(s, 1), -1))]; } },
        { id: "lastMonth",   label: "Mes pasado",       range: o => { const s = addMonths(startOfDay(new Date()), o - 1); return [s, endOfDay(addDays(addMonths(s, 1), -1))]; } },
        { id: "last7",       label: "Últimos 7 días",   range: o => { const e = addDays(new Date(), o * 7); return [addDays(startOfDay(e), -6), endOfDay(e)]; } },
        { id: "last30",      label: "Últimos 30 días",  range: o => { const e = addDays(new Date(), o * 30); return [addDays(startOfDay(e), -29), endOfDay(e)]; } },
        { id: "last3Months", label: "Últimos 3 meses",  range: o => { const s = addMonths(startOfDay(new Date()), o * 3 - 2); return [s, endOfDay(addDays(addMonths(s, 3), -1))]; } },
        { id: "last6Months", label: "Últimos 6 meses",  range: o => { const s = addMonths(startOfDay(new Date()), o * 6 - 5); return [s, endOfDay(addDays(addMonths(s, 6), -1))]; } },
        { id: "thisYear",    label: "Este año",         range: o => { const y = new Date().getFullYear() + o; return [new Date(y, 0, 1), endOfDay(new Date(y, 11, 31))]; } },
        { id: "custom",      label: "Personalizado" }
    ];

    const getPeriodRange = (p = period) => {
        if (p.id === "custom") {
            const days = Math.round((startOfDay(p.to) - startOfDay(p.from)) / 86400000) + 1;
            return { from: addDays(startOfDay(p.from), p.offset * days), to: endOfDay(addDays(p.to, p.offset * days)) };
        }
        const opt = PERIOD_OPTIONS.find(o => o.id === p.id) || PERIOD_OPTIONS[4];
        const [from, to] = opt.range(p.offset);
        return { from, to };
    };

    const getPeriodLabel = () => {
        const opt = PERIOD_OPTIONS.find(o => o.id === period.id);
        if (period.id !== "custom" && period.offset === 0 && opt) return opt.label;
        const { from, to } = getPeriodRange();
        return localDateStr(from) === localDateStr(to) ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
    };

    const isDefaultPeriod = () => period.id === DEFAULT_PERIOD.id && period.offset === 0;

    // ── Clave de la consulta: sección al día si coincide ────────
    const getQueryKey = () => {
        const { from, to } = getPeriodRange();
        const ids = selectedUnitIds.length ? [...selectedUnitIds].sort().join(",") : "all";
        return `${ids}|${from.getTime()}|${to.getTime()}`;
    };

    const getTargetUnits = () => selectedUnitIds.length
        ? units.filter(u => selectedUnitIds.includes(u.id))
        : units;

    // ════════════════════════════════════════════════════════════
    // UI DE FILTROS
    // ════════════════════════════════════════════════════════════
    let openPopupId = null;

    const closePopups = () => {
        ["sg-period", "sg-units"].forEach(prefix => {
            const popup = $(`${prefix}-popup`);
            const trigger = $(`${prefix}-trigger`);
            if (popup) popup.hidden = true;
            if (trigger) trigger.setAttribute("aria-expanded", "false");
        });
        openPopupId = null;
    };

    const openPopup = prefix => {
        closePopups();
        const popup = $(`${prefix}-popup`);
        const trigger = $(`${prefix}-trigger`);
        if (!popup) return;
        popup.hidden = false;
        if (trigger) trigger.setAttribute("aria-expanded", "true");
        openPopupId = prefix;
        refreshIcons();
    };

    const updateFiltersUI = () => {
        const periodLabel = $("sg-period-label");
        if (periodLabel) periodLabel.textContent = getPeriodLabel();

        // No permitir pasar a un periodo que empieza en el futuro
        const nextBtn = $("sg-period-next");
        if (nextBtn) {
            const nextRange = getPeriodRange({ ...period, offset: period.offset + 1 });
            nextBtn.disabled = nextRange.from > new Date();
        }

        const unitsLabel = $("sg-units-label");
        if (unitsLabel) {
            if (!selectedUnitIds.length) unitsLabel.textContent = "Todos";
            else if (selectedUnitIds.length === 1) unitsLabel.textContent = (unitsById.get(selectedUnitIds[0]) || {}).name || "1 vehículo";
            else unitsLabel.textContent = `${selectedUnitIds.length} vehículos`;
        }

        const changed = (isDefaultPeriod() ? 0 : 1) + (selectedUnitIds.length ? 1 : 0);
        const resetBtn = $("sg-filters-reset");
        const countEl = $("sg-filters-count");
        if (resetBtn) resetBtn.hidden = changed === 0;
        if (countEl) countEl.textContent = changed;

        const { from, to } = getPeriodRange();
        const subline = $("sg-header-subline");
        if (subline) subline.textContent = `Del ${fmtDate(from)} al ${fmtDate(to)} · ${getTargetUnits().length} vehículos`;
    };

    // Aplicar un cambio de filtro: actualiza la UI y consulta solo la sección activa
    const applyFilters = () => {
        updateFiltersUI();
        calculateMetrics();
    };

    const renderPeriodOptions = () => {
        const list = $("sg-period-options");
        if (!list) return;
        list.innerHTML = PERIOD_OPTIONS.map(opt => `
            <li class="sg-option${opt.id === period.id ? " sg-option--selected" : ""}${opt.id === "custom" ? " sg-option--divider" : ""}"
                role="option" tabindex="0" data-period="${opt.id}" aria-selected="${opt.id === period.id}">
                <span>${opt.label}</span>
                <i data-lucide="check" width="16" height="16" class="sg-option__check"></i>
            </li>`).join("");
    };

    const showCustomRange = show => {
        const custom = $("sg-period-custom");
        const footer = $("sg-period-footer");
        if (custom) custom.hidden = !show;
        if (footer) footer.hidden = !show;
        const err = $("sg-custom-error");
        if (err) err.hidden = true;
        if (show) {
            const { from, to } = getPeriodRange();
            $("sg-custom-from").value = localDateStr(from);
            $("sg-custom-to").value = localDateStr(to);
        }
    };

    const onPeriodOptionSelect = id => {
        if (id === "custom") {
            showCustomRange(true);
            $("sg-period-options").querySelectorAll(".sg-option").forEach(li => {
                li.classList.toggle("sg-option--selected", li.getAttribute("data-period") === "custom");
            });
            return;
        }
        period = { id, offset: 0 };
        closePopups();
        applyFilters();
    };

    const renderUnitsList = () => {
        const list = $("sg-units-list");
        if (!list) return;
        const term = ($("sg-units-search").value || "").trim().toLowerCase();
        const visible = units.filter(u => (u.name || "").toLowerCase().includes(term));

        if (!visible.length) {
            list.innerHTML = `<li class="sg-check-list__empty">Sin resultados</li>`;
        } else {
            list.innerHTML = visible.map(u => `
                <li>
                    <label class="sg-checkbox">
                        <input type="checkbox" class="sg-checkbox__input" value="${escapeHtml(u.id)}" ${pendingUnitIds.has(u.id) ? "checked" : ""}>
                        <span class="sg-checkbox__box"></span>
                        <span class="sg-checkbox__label" title="${escapeHtml(u.name)}">${escapeHtml(u.name || "Unidad sin nombre")}</span>
                    </label>
                </li>`).join("");
        }
        updateSelectAllState();
    };

    const updateSelectAllState = () => {
        const all = $("sg-units-all");
        if (!all) return;
        const count = pendingUnitIds.size;
        all.checked = count > 0 && count === units.length;
        all.indeterminate = count > 0 && count < units.length;
    };

    const openUnitsPopup = () => {
        // Como en Zenith: "Todos" se muestra con todas las casillas marcadas
        pendingUnitIds = new Set(selectedUnitIds.length ? selectedUnitIds : units.map(u => u.id));
        $("sg-units-search").value = "";
        renderUnitsList();
        openPopup("sg-units");
        $("sg-units-search").focus();
    };

    const applyUnitsSelection = () => {
        if (pendingUnitIds.size === 0) {
            showError("Selecciona al menos un vehículo.");
            return;
        }
        const next = pendingUnitIds.size === units.length ? [] : units.filter(u => pendingUnitIds.has(u.id)).map(u => u.id);
        closePopups();
        const changed = next.join(",") !== selectedUnitIds.join(",");
        selectedUnitIds = next;
        if (changed) applyFilters();
    };

    // ════════════════════════════════════════════════════════════
    // RENDER: TABLAS
    // ════════════════════════════════════════════════════════════
    const renderPagination = (prefix, currentPage, totalItems, perPage, noun) => {
        const totalPages = Math.ceil(totalItems / perPage) || 1;
        const start = (currentPage - 1) * perPage;
        const end = Math.min(start + perPage, totalItems);

        const wrap = $(`sg-${prefix}-pagination`);
        if (wrap) wrap.hidden = totalItems === 0;
        const info = $(`sg-${prefix}-pagination-info`);
        if (info) info.textContent = `${totalItems > 0 ? start + 1 : 0}–${end} de ${totalItems} ${noun}`;
        const ind = $(`sg-${prefix}-page-indicator`);
        if (ind) ind.textContent = `${currentPage} / ${totalPages}`;
        const prev = $(`sg-btn-${prefix}-prev`);
        const next = $(`sg-btn-${prefix}-next`);
        if (prev) prev.disabled = currentPage <= 1;
        if (next) next.disabled = currentPage >= totalPages;
    };

    const renderTripsTablePage = () => {
        const tbody = $("sg-tbody-trips");
        if (!tbody) return;

        const totalItems = rawTripsList.length;
        const totalPages = Math.ceil(totalItems / TRIPS_PER_PAGE) || 1;
        if (currentTripsPage > totalPages) currentTripsPage = totalPages;
        const start = (currentTripsPage - 1) * TRIPS_PER_PAGE;
        const pageData = rawTripsList.slice(start, start + TRIPS_PER_PAGE);

        if (!pageData.length) {
            tbody.innerHTML = `<tr class="sg-table__empty"><td colspan="11">No hay viajes registrados en el periodo seleccionado.</td></tr>`;
        } else {
            tbody.innerHTML = pageData.map(trip => {
                const deviceId = trip.device && trip.device.id;
                const unitName = (unitsById.get(deviceId) || {}).name || (trip.device && trip.device.name) || deviceId || "—";
                const avgSpeed = trip.averageSpeed != null ? `${fmtNum(trip.averageSpeed, 1)} km/h` : "—";
                const engHours = trip.engineHours != null
                    ? (typeof trip.engineHours === "number" ? `${fmtNum(trip.engineHours, 1)} h` : escapeHtml(trip.engineHours))
                    : "—";
                return `
                    <tr>
                        <td class="sg-strong">${escapeHtml(unitName)}</td>
                        <td>${fmtDateTime(trip.start)}</td>
                        <td>${trip.stop ? fmtDateTime(trip.stop) : `<span class="sg-pill sg-pill--info">En curso</span>`}</td>
                        <td class="sg-num">${fmtNum(trip.distance || 0, 1)} km</td>
                        <td class="sg-num">${fmtHrs(trip.drivingDuration)}</td>
                        <td class="sg-num">${fmtHrs(trip.idlingDuration)}</td>
                        <td class="sg-num">${fmtHrs(trip.stopDuration)}</td>
                        <td class="sg-num">${fmtHrs(trip.workDrivingDuration)}</td>
                        <td class="sg-num">${fmtHrs(trip.workStopDuration)}</td>
                        <td class="sg-num">${avgSpeed}</td>
                        <td class="sg-num">${engHours}</td>
                    </tr>`;
            }).join("");
        }

        renderPagination("trips", currentTripsPage, totalItems, TRIPS_PER_PAGE, "viajes");
    };

    const renderTallerTablePage = () => {
        const tbody = $("sg-tbody-taller");
        if (!tbody) return;

        const totalItems = rawTallerList.length;
        const totalPages = Math.ceil(totalItems / TALLER_PER_PAGE) || 1;
        if (currentTallerPage > totalPages) currentTallerPage = totalPages;
        const start = (currentTallerPage - 1) * TALLER_PER_PAGE;
        const pageData = rawTallerList.slice(start, start + TALLER_PER_PAGE);

        if (!pageData.length) {
            tbody.innerHTML = `<tr class="sg-table__empty"><td colspan="6">No hay vehículos con actividad de taller en el periodo seleccionado.</td></tr>`;
        } else {
            tbody.innerHTML = pageData.map(s => {
                const visits = s.visitsCount || 0;
                const pct = s.pctInPeriod || 0;
                let pill = `<span class="sg-pill sg-pill--default">Sin registros</span>`;
                if (s.isCurrentlyInTaller) pill = `<span class="sg-pill sg-pill--warning">En taller</span>`;
                else if (visits > 0) pill = `<span class="sg-pill sg-pill--success">Concluido</span>`;

                return `
                    <tr>
                        <td class="sg-strong">${escapeHtml(s.unitName || "Unidad desconocida")}</td>
                        <td class="sg-num">${visits}</td>
                        <td class="sg-num">${fmtDurationMs(s.totalTallerMs)}</td>
                        <td class="sg-num">
                            <span class="sg-table-pct">
                                <span class="sg-progress__bar"><span class="sg-progress__fill" style="display:block;width:${Math.min(100, pct).toFixed(1)}%"></span></span>
                                <span>${pct.toFixed(1)}%</span>
                            </span>
                        </td>
                        <td>${pill}</td>
                        <td class="sg-actions-col">
                            <button type="button" class="sg-button sg-button--tertiary sg-btn-detail" data-unit-id="${escapeHtml(s.unitId)}" ${visits === 0 ? "disabled" : ""}>
                                Ver estancias
                            </button>
                        </td>
                    </tr>`;
            }).join("");

            tbody.querySelectorAll(".sg-btn-detail").forEach(btn => {
                btn.addEventListener("click", function () {
                    const target = rawTallerList.find(item => item.unitId === this.getAttribute("data-unit-id"));
                    if (target) openUnitDetailModal(target);
                });
            });
        }

        renderPagination("taller", currentTallerPage, totalItems, TALLER_PER_PAGE, "vehículos");
    };

    const openUnitDetailModal = summary => {
        const modal = $("sg-unit-modal");
        const tbody = $("sg-tbody-unit-detail");
        if (!modal || !tbody) return;

        $("sg-unit-modal-title").textContent = `Estancias en taller · ${summary.unitName}`;
        const events = summary.events || [];
        tbody.innerHTML = !events.length
            ? `<tr class="sg-table__empty"><td colspan="6">No hay registros detallados para este vehículo.</td></tr>`
            : events.map((evt, idx) => `
                <tr>
                    <td class="sg-muted">${idx + 1}</td>
                    <td class="sg-strong">${escapeHtml(evt.location || "Orden de trabajo")}</td>
                    <td>${fmtDateTime(evt.start)}</td>
                    <td>${evt.stop ? fmtDateTime(evt.stop) : `<span class="sg-muted">—</span>`}</td>
                    <td class="sg-num">${fmtDurationMs(evt.durationMs)}</td>
                    <td>${evt.stop ? `<span class="sg-pill sg-pill--success">Finalizado</span>` : `<span class="sg-pill sg-pill--warning">En taller</span>`}</td>
                </tr>`).join("");

        modal.hidden = false;
        refreshIcons();
    };

    // ── Eventos de taller desde órdenes de trabajo de Geotab ────
    const generateTallerEventsForUnit = (unit, range, workOrders) => {
        const events = [];
        const { from, to } = range;
        const totalPeriodMs = to.getTime() - from.getTime();

        workOrders.forEach(orderData => {
            const order = orderData.order || {};
            const jobs = (orderData.jobs || [])
                .filter(job => job && job.dateTime)
                .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
            const firstJobDate = jobs.length ? jobs[0].dateTime : null;
            const lastClosedJob = [...jobs].reverse().find(job => job.isClosed === true);
            const startValue = order.startDate || order.startedDate || order.dateTime || firstJobDate;
            const stopValue = order.completedDate || order.closedDate || (lastClosedJob && lastClosedJob.dateTime);
            const startDate = startValue ? new Date(startValue) : null;
            const stopDate = stopValue ? new Date(stopValue) : to;

            if (!startDate || isNaN(startDate.getTime()) || isNaN(stopDate.getTime())) return;

            const effectiveStart = new Date(Math.max(startDate.getTime(), from.getTime()));
            const effectiveEnd = new Date(Math.min(stopDate.getTime(), to.getTime()));
            const durationMs = Math.max(0, effectiveEnd.getTime() - effectiveStart.getTime());
            if (durationMs <= 0) return;

            events.push({
                id: order.id || `TALLER-${unit.id}-${events.length + 1}`,
                unitId: unit.id,
                unitName: unit.name,
                location: order.reference || order.description || "Orden de trabajo Geotab",
                start: effectiveStart,
                stop: stopValue ? effectiveEnd : null,
                durationMs,
                pctInPeriod: totalPeriodMs > 0 ? (durationMs / totalPeriodMs) * 100 : 0
            });
        });

        events.sort((a, b) => new Date(b.start) - new Date(a.start));
        return events;
    };

    // ════════════════════════════════════════════════════════════
    // CARGA DE DATOS
    // ════════════════════════════════════════════════════════════
    const hasApi = () => api && typeof api.call === "function";

    // Agrupa varias llamadas Get en una sola petición HTTP (multiCall)
    const multiGet = (calls, onDone, onError, chunkSize = 100) => {
        if (!calls.length) { onDone([]); return; }
        if (calls.length === 1 || typeof api.multiCall !== "function") {
            Promise.all(calls.map(([method, params]) => new Promise((resolve, reject) => api.call(method, params, resolve, reject))))
                .then(onDone).catch(onError);
            return;
        }
        const chunks = [];
        for (let i = 0; i < calls.length; i += chunkSize) chunks.push(calls.slice(i, i + chunkSize));
        Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
            if (chunk.length === 1) api.call(chunk[0][0], chunk[0][1], r => resolve([r]), reject);
            else api.multiCall(chunk, resolve, reject);
        }))).then(results => onDone([].concat(...results))).catch(onError);
    };

    const loadUnits = onDone => {
        const setUnits = list => {
            units = (list || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            unitsById = new Map(units.map(u => [u.id, u]));
            selectedUnitIds = selectedUnitIds.filter(id => unitsById.has(id));
            updateFiltersUI();
            if (onDone) onDone();
        };

        if (!hasApi()) {
            setUnits([
                { id: "b1", name: "Camión APSA-01" },
                { id: "b2", name: "Camión APSA-02" },
                { id: "b3", name: "PickUp Sup 01" },
                { id: "b4", name: "PickUp Sup 02" },
                { id: "b5", name: "Tractor APSA-10" }
            ]);
            return;
        }

        api.call("Get", { typeName: "Device" }, setUnits, err => {
            console.error("Error al cargar dispositivos de Geotab:", err);
            showError("No se pudieron cargar los vehículos.");
        });
    };

    // ── Servicios: órdenes de trabajo de mantenimiento (taller) ──
    const loadServicios = (range, targetUnits, onDone, onError) => {
        const totalPeriodMs = range.to.getTime() - range.from.getTime();
        const targetIds = new Set(targetUnits.map(u => u.id));

        const buildSummary = (unit, unitEvents) => {
            const totalTallerMs = unitEvents.reduce((sum, e) => sum + e.durationMs, 0);
            return {
                unitId: unit.id,
                unitName: unit.name || "Unidad",
                visitsCount: unitEvents.length,
                totalTallerMs,
                pctInPeriod: totalPeriodMs > 0 ? (totalTallerMs / totalPeriodMs) * 100 : 0,
                isCurrentlyInTaller: unitEvents.some(e => !e.stop),
                events: unitEvents
            };
        };

        const finish = orderDataList => {
            rawTallerList = targetUnits.map(unit => {
                const unitOrders = orderDataList.filter(item => item.order.device && item.order.device.id === unit.id);
                return buildSummary(unit, generateTallerEventsForUnit(unit, range, unitOrders));
            }).sort((a, b) => b.totalTallerMs - a.totalTallerMs);
            onDone();
        };

        if (!hasApi()) { setTimeout(() => finish([]), 400); return; }

        const search = {};
        if (selectedUnitIds.length === 1) search.deviceSearch = { id: selectedUnitIds[0] };

        api.call("Get", { typeName: "MaintenanceWorkOrder", search, resultsLimit: 50000 }, workOrders => {
            const relevant = (workOrders || []).filter(o => o.device && targetIds.has(o.device.id));
            const jobCalls = relevant.map(o => ["Get", { typeName: "MaintenanceWorkOrderJob", search: { workOrderId: o.id }, resultsLimit: 50000 }]);

            multiGet(jobCalls, jobsList => {
                finish(relevant.map((order, i) => ({ order, jobs: jobsList[i] || [] })));
            }, err => {
                console.error("Error al consultar trabajos de mantenimiento de Geotab:", err);
                onError("No se pudieron consultar los trabajos de mantenimiento.");
            });
        }, err => {
            console.error("Error al consultar órdenes de mantenimiento de Geotab:", err);
            onError("No se pudieron consultar las órdenes de mantenimiento.");
        });
    };

    // ── Recorridos: tabla Trip de Geotab ─────────────────────────
    const loadRecorridos = (range, targetUnits, onDone, onError) => {
        const { from, to } = range;

        const finish = trips => {
            const map = new Map();
            trips.forEach(t => { if (t && t.id) map.set(t.id, t); });
            rawTripsList = Array.from(map.values()).sort((a, b) => new Date(b.start) - new Date(a.start));
            onDone();
        };

        if (!hasApi()) {
            setTimeout(() => {
                const mock = [];
                targetUnits.forEach((unit, idx) => {
                    let cursor = new Date(from.getTime() + idx * 3600 * 1000);
                    for (let i = 0; i < 8 + (idx % 4); i++) {
                        const driveSec = Math.floor(Math.random() * 7200) + 1800;
                        const stopSec = Math.floor(Math.random() * 14400) + 3600;
                        const tripStop = new Date(cursor.getTime() + driveSec * 1000);
                        if (tripStop > to) break;
                        mock.push({
                            id: `t-${unit.id}-${100 + i}`,
                            device: { id: unit.id },
                            start: cursor.toISOString(),
                            stop: tripStop.toISOString(),
                            distance: parseFloat((driveSec * 0.015 + Math.random() * 10).toFixed(1)),
                            drivingDuration: driveSec,
                            idlingDuration: Math.floor(driveSec * 0.1),
                            stopDuration: stopSec,
                            workDrivingDuration: driveSec,
                            workStopDuration: stopSec,
                            averageSpeed: Math.floor(45 + Math.random() * 30),
                            engineHours: 1500 + i * 3.5
                        });
                        cursor = new Date(tripStop.getTime() + stopSec * 1000);
                    }
                });
                finish(mock);
            }, 400);
            return;
        }

        const base = { fromDate: from.toISOString(), toDate: to.toISOString() };
        const fail = err => {
            console.error("Error al consultar la tabla Trip:", err);
            onError("Error de conexión con Geotab al consultar los viajes.");
        };

        if (!selectedUnitIds.length) {
            api.call("Get", { typeName: "Trip", search: base }, r => finish(r || []), fail);
        } else {
            // Una consulta por vehículo seleccionado, enviadas juntas en un multiCall
            const calls = selectedUnitIds.map(id => ["Get", { typeName: "Trip", search: { ...base, deviceSearch: { id } } }]);
            multiGet(calls, results => finish([].concat(...results.map(r => r || []))), fail);
        }
    };

    // ════════════════════════════════════════════════════════════
    // CORE: consulta SOLO la sección activa
    // ════════════════════════════════════════════════════════════
    const setLoading = (on, text) => {
        const el = $("sg-loading");
        if (el) el.hidden = !on;
        if (text) $("sg-loading-text").textContent = text;
        const refresh = $("sg-btn-refresh");
        if (refresh) refresh.disabled = on;
    };

    const showActiveSection = () => {
        const isLoaded = loadedKeys[activeSection] !== null;
        SECTIONS.forEach(name => {
            const el = $(`sg-section-${name}`);
            if (el) el.hidden = !(name === activeSection && isLoaded);
        });
        const empty = $("sg-empty-state");
        if (empty) empty.hidden = isLoaded;
        refreshIcons();
    };

    const calculateMetrics = () => {
        const section = activeSection;
        const range = getPeriodRange();
        const queryKey = getQueryKey();
        const seq = ++requestSeq;   // descarta respuestas de consultas anteriores

        setLoading(true, section === "servicios"
            ? "Consultando órdenes de servicio…"
            : "Consultando viajes…");

        const onDone = () => {
            if (seq !== requestSeq) return;
            setLoading(false);
            try {
                if (section === "servicios") renderServicios(range);
                else renderRecorridos(range);
                loadedKeys[section] = queryKey;
                showActiveSection();
            } catch (err) {
                console.error(`Error procesando datos de ${section}:`, err);
                showError("Error al procesar los registros consultados.");
            }
        };

        const onError = msg => {
            if (seq !== requestSeq) return;
            setLoading(false);
            showError(msg);
        };

        const targetUnits = getTargetUnits();
        if (section === "servicios") loadServicios(range, targetUnits, onDone, onError);
        else loadRecorridos(range, targetUnits, onDone, onError);
    };

    const periodText = ({ from, to }) => `Del ${fmtDate(from)} al ${fmtDate(to)}`;

    // ── KPIs y tabla de Servicios ─────────────────────────────────
    const renderServicios = range => {
        const totalPeriodMs = range.to.getTime() - range.from.getTime();
        let totalTallerMs = 0, totalVisits = 0, unitsWithTaller = 0, unitsInTallerNow = 0;

        rawTallerList.forEach(s => {
            totalTallerMs += s.totalTallerMs;
            totalVisits += s.visitsCount;
            if (s.visitsCount > 0) unitsWithTaller++;
            if (s.isCurrentlyInTaller) unitsInTallerNow++;
        });

        // % sobre el tiempo disponible de todas las unidades consultadas
        const fleetMs = totalPeriodMs * (rawTallerList.length || 1);
        const tallerPct = fleetMs > 0 ? (totalTallerMs / fleetMs) * 100 : 0;
        const avgMs = totalVisits > 0 ? Math.floor(totalTallerMs / totalVisits) : 0;

        $("sg-kpi-taller-time").textContent = fmtDurationMs(totalTallerMs);
        $("sg-kpi-taller-fill").style.width = `${Math.min(100, tallerPct).toFixed(1)}%`;
        $("sg-kpi-taller-pct").textContent = `${tallerPct.toFixed(1)}%`;
        $("sg-kpi-taller-count").textContent = totalVisits;
        $("sg-kpi-taller-units").textContent = `${unitsWithTaller} de ${rawTallerList.length} vehículos`;
        $("sg-kpi-taller-avg").textContent = fmtDurationMs(avgMs);
        $("sg-kpi-taller-now").textContent = unitsInTallerNow;

        currentTallerPage = 1;
        renderTallerTablePage();
        $("sg-taller-table-sub").textContent = periodText(range);
    };

    // ── KPIs y tabla de Recorridos ────────────────────────────────
    const renderRecorridos = range => {
        let totalDist = 0, totalDriveSec = 0, totalIdleSec = 0;
        const activeUnits = new Set();

        rawTripsList.forEach(t => {
            totalDist += (t.distance || 0);
            totalDriveSec += parseSeconds(t.drivingDuration);
            totalIdleSec += parseSeconds(t.idlingDuration);
            if (t.device && t.device.id) activeUnits.add(t.device.id);
        });

        const tripCount = rawTripsList.length;
        const engineSec = totalDriveSec + totalIdleSec;

        $("sg-kpi-dist").textContent = fmtNum(totalDist, 1);
        $("sg-kpi-dist-avg").textContent = `Promedio ${fmtNum(tripCount ? totalDist / tripCount : 0, 1)} km por viaje`;
        $("sg-kpi-trips").textContent = tripCount.toLocaleString("es-MX");
        $("sg-kpi-trips-units").textContent = `${activeUnits.size} vehículos con actividad`;
        $("sg-kpi-drive").textContent = fmtHrs(totalDriveSec);
        $("sg-kpi-idle").textContent = fmtHrs(totalIdleSec);
        $("sg-kpi-idle-pct").textContent = `${fmtNum(engineSec ? (totalIdleSec / engineSec) * 100 : 0, 1)}% del tiempo de motor`;

        currentTripsPage = 1;
        renderTripsTablePage();
        $("sg-trips-table-sub").textContent = periodText(range);
    };

    // ── Cambio de sección (pestañas) ─────────────────────────────
    const switchSection = section => {
        if (!SECTIONS.includes(section) || section === activeSection) return;
        activeSection = section;

        document.querySelectorAll("#sg-tabs .sg-tab-item").forEach(tab => {
            const isActive = tab.getAttribute("data-section") === section;
            tab.classList.toggle("sg-tab-item--active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        showActiveSection();
        // Solo se consulta si esta sección no está al día con los filtros actuales
        if (loadedKeys[section] !== getQueryKey()) calculateMetrics();
    };

    // ════════════════════════════════════════════════════════════
    // EVENTOS
    // ════════════════════════════════════════════════════════════
    const initEvents = () => {
        // Pestañas
        document.querySelectorAll("#sg-tabs .sg-tab-item").forEach(tab => {
            tab.addEventListener("click", function () { switchSection(this.getAttribute("data-section")); });
        });

        // Actualizar
        $("sg-btn-refresh").addEventListener("click", calculateMetrics);

        // ── Periodo ──
        $("sg-period-trigger").addEventListener("click", e => {
            e.stopPropagation();
            if (openPopupId === "sg-period") { closePopups(); return; }
            renderPeriodOptions();
            showCustomRange(period.id === "custom");
            openPopup("sg-period");
        });

        $("sg-period-options").addEventListener("click", e => {
            const li = e.target.closest(".sg-option");
            if (li) onPeriodOptionSelect(li.getAttribute("data-period"));
        });
        $("sg-period-options").addEventListener("keydown", e => {
            const li = e.target.closest(".sg-option");
            if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPeriodOptionSelect(li.getAttribute("data-period")); }
        });

        $("sg-period-prev").addEventListener("click", () => { period = { ...period, offset: period.offset - 1 }; applyFilters(); });
        $("sg-period-next").addEventListener("click", () => { period = { ...period, offset: period.offset + 1 }; applyFilters(); });

        $("sg-period-cancel").addEventListener("click", closePopups);
        $("sg-period-apply").addEventListener("click", () => {
            const fromVal = $("sg-custom-from").value;
            const toVal = $("sg-custom-to").value;
            const err = $("sg-custom-error");
            const fail = msg => { err.textContent = msg; err.hidden = false; };
            if (!fromVal) return fail("La fecha de inicio no puede estar vacía.");
            if (!toVal) return fail("La fecha de fin no puede estar vacía.");
            if (fromVal > toVal) return fail("La fecha de inicio no puede ser mayor que la fecha de fin.");
            period = { id: "custom", offset: 0, from: new Date(fromVal + "T00:00:00"), to: new Date(toVal + "T00:00:00") };
            closePopups();
            applyFilters();
        });

        // ── Vehículos ──
        $("sg-units-trigger").addEventListener("click", e => {
            e.stopPropagation();
            if (openPopupId === "sg-units") closePopups();
            else openUnitsPopup();
        });
        $("sg-units-search").addEventListener("input", renderUnitsList);
        $("sg-units-list").addEventListener("change", e => {
            if (!e.target.matches(".sg-checkbox__input")) return;
            if (e.target.checked) pendingUnitIds.add(e.target.value);
            else pendingUnitIds.delete(e.target.value);
            updateSelectAllState();
        });
        $("sg-units-all").addEventListener("change", e => {
            pendingUnitIds = e.target.checked ? new Set(units.map(u => u.id)) : new Set();
            renderUnitsList();
        });
        $("sg-units-clear").addEventListener("click", () => { pendingUnitIds = new Set(); renderUnitsList(); });
        $("sg-units-cancel").addEventListener("click", closePopups);
        $("sg-units-apply").addEventListener("click", applyUnitsSelection);

        // Restablecer filtros a los valores por defecto
        $("sg-filters-reset").addEventListener("click", () => {
            period = { ...DEFAULT_PERIOD };
            selectedUnitIds = [];
            applyFilters();
        });

        // Cerrar popups al hacer clic fuera o con Escape
        document.addEventListener("click", e => {
            if (openPopupId && !e.target.closest(".sg-filter")) closePopups();
        });
        document.addEventListener("keydown", e => {
            if (e.key !== "Escape") return;
            if (openPopupId) closePopups();
            else closeUnitModal();
        });

        // Modal de estancias
        const closeUnitModal = () => { $("sg-unit-modal").hidden = true; };
        $("sg-unit-modal-close").addEventListener("click", closeUnitModal);
        $("sg-unit-modal-btn-close").addEventListener("click", closeUnitModal);
        $("sg-unit-modal").addEventListener("click", e => { if (e.target.id === "sg-unit-modal") closeUnitModal(); });

        // Alerta
        $("sg-alert-close").addEventListener("click", () => { $("sg-alert").hidden = true; });

        // Paginación
        $("sg-btn-taller-prev").addEventListener("click", () => { if (currentTallerPage > 1) { currentTallerPage--; renderTallerTablePage(); } });
        $("sg-btn-taller-next").addEventListener("click", () => {
            if (currentTallerPage < Math.ceil(rawTallerList.length / TALLER_PER_PAGE)) { currentTallerPage++; renderTallerTablePage(); }
        });
        $("sg-btn-trips-prev").addEventListener("click", () => { if (currentTripsPage > 1) { currentTripsPage--; renderTripsTablePage(); } });
        $("sg-btn-trips-next").addEventListener("click", () => {
            if (currentTripsPage < Math.ceil(rawTripsList.length / TRIPS_PER_PAGE)) { currentTripsPage++; renderTripsTablePage(); }
        });

        refreshIcons();
    };

    // Al abrir la página se consulta la sección activa, como en los reportes de MyGeotab
    const loadAndQuery = () => loadUnits(() => {
        if (loadedKeys[activeSection] !== getQueryKey()) calculateMetrics();
    });

    // ── Lifecycle Contract ────────────────────────────────────────
    return {
        initialize: function (apiObj, stateObj, callbackObj) {
            if (apiObj) api = apiObj;
            const cb = typeof callbackObj === "function" ? callbackObj : (typeof _callback === "function" ? _callback : null);

            if (!eventsAttached) {
                initEvents();
                eventsAttached = true;
            }
            updateFiltersUI();

            if (cb) cb();
        },

        focus: function (apiObj, stateObj) {
            if (apiObj) api = apiObj;
            loadAndQuery();
        },

        blur: function () { closePopups(); }
    };

};

// Exponer geotab.addin en múltiples espacios de nombres para máxima compatibilidad
if (typeof window.geotab === "undefined") {
    window.geotab = { addin: {} };
} else if (!window.geotab.addin) {
    window.geotab.addin = {};
}

const addinNames = [
    "REPORTE_SILBAGAS",
    "reporteSilbagas",
    "reporte_silbagas",
    "reporte-silbagas",
    "REPORTE_SILBAGAS.html",
    "REPORTE_SILBAGAS/",
    "reporteSilbagas/",
    "reporte_silbagas/",
    "reporte-silbagas/",
    "silbagas",
    "silbagas/"
];

addinNames.forEach(name => {
    window.geotab.addin[name] = initSilbagasAddin;
});

// Auto-inicialización SOLO para vista previa standalone (fuera del iframe de Geotab)
document.addEventListener("DOMContentLoaded", function () {
    if (window.self === window.top && !window._silbagasInstance) {
        const instance = initSilbagasAddin();
        window._silbagasInstance = instance;
        instance.initialize(null, {}, function () {
            console.log("Reporte Silbagas inicializado en modo standalone.");
        });
        instance.focus(null, {});
    }
});
