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
    const SECTIONS = ["recorridos", "servicios"];
    let activeSection = "recorridos";
    const loadedKeys = { servicios: null, recorridos: null };
    let requestSeq = 0;

    // Paginación (Recorridos: una fila por vehículo, desplegable por día)
    let currentTripsPage = 1;
    const TRIPS_PER_PAGE = 15;
    let rawTripsList = [];
    let unitTripSummaries = [];
    let expandedUnits = new Set();
    let perfMetric = "dist";           // métrica de la gráfica "Desempeño por vehículo"

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

    // Presets idénticos al PeriodPicker de MyGeotab (showDates = subtítulo con el rango)
    const PERIOD_OPTIONS = [
        { id: "today",       label: "Hoy",              range: o => { const d = addDays(startOfDay(new Date()), o); return [d, endOfDay(d)]; } },
        { id: "yesterday",   label: "Ayer",             range: o => { const d = addDays(startOfDay(new Date()), o - 1); return [d, endOfDay(d)]; } },
        { id: "thisWeek",    label: "Esta semana",      showDates: true, range: o => { const s = addDays(startOfWeek(new Date()), o * 7); return [s, endOfDay(addDays(s, 6))]; } },
        { id: "lastWeek",    label: "Semana pasada",    range: o => { const s = addDays(startOfWeek(new Date()), (o - 1) * 7); return [s, endOfDay(addDays(s, 6))]; } },
        { id: "thisMonth",   label: "Este mes",         showDates: true, range: o => { const s = addMonths(startOfDay(new Date()), o); return [s, endOfDay(addDays(addMonths(s, 1), -1))]; } },
        { id: "lastMonth",   label: "Mes pasado",       range: o => { const s = addMonths(startOfDay(new Date()), o - 1); return [s, endOfDay(addDays(addMonths(s, 1), -1))]; } },
        { id: "last3Months", label: "Últimos 3 meses",  range: o => { const s = addMonths(startOfDay(new Date()), o * 3 - 2); return [s, endOfDay(addDays(addMonths(s, 3), -1))]; } },
        { id: "custom",      label: "Personalizado" }
    ];

    // Formato corto del subtítulo, como MyGeotab: 09/01/26 – 09/30/26
    const fmtShortDate = d =>
        `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;

    const getPeriodRange = (p = period) => {
        if (p.id === "custom") {
            // Las flechas desplazan el rango personalizado por su duración en días
            const days = Math.max(1, Math.round((p.to - p.from) / 86400000));
            return { from: addDays(p.from, p.offset * days), to: addDays(p.to, p.offset * days) };
        }
        const opt = PERIOD_OPTIONS.find(o => o.id === p.id) || PERIOD_OPTIONS.find(o => o.id === DEFAULT_PERIOD.id);
        const [from, to] = opt.range(p.offset);
        return { from, to };
    };

    const getPeriodLabel = () => {
        const opt = PERIOD_OPTIONS.find(o => o.id === period.id);
        if (period.id !== "custom" && period.offset === 0 && opt) return opt.label;
        const { from, to } = getPeriodRange();
        const fullDays = from.getHours() === 0 && from.getMinutes() === 0 && to.getHours() === 23 && to.getMinutes() === 59;
        if (!fullDays) {
            const t = d => `${fmtShortDate(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            return `${t(from)} – ${t(to)}`;
        }
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

    const renderPeriodOptions = (checkedId = period.id) => {
        const list = $("sg-period-options");
        if (!list) return;
        list.innerHTML = PERIOD_OPTIONS.map(opt => {
            const checked = opt.id === checkedId;
            let sub = "";
            if (opt.showDates) {
                const [from, to] = opt.range(0);
                sub = `<span class="sg-radio__sub">${fmtShortDate(from)} – ${fmtShortDate(to)}</span>`;
            }
            return `
                <li class="sg-radio${checked ? " sg-radio--checked" : ""}" role="radio" tabindex="${checked ? 0 : -1}"
                    data-period="${opt.id}" aria-checked="${checked}">
                    <span class="sg-radio__circle"></span>
                    <span class="sg-radio__text"><span>${opt.label}</span>${sub}</span>
                </li>`;
        }).join("");
    };

    // ── Rango personalizado: fecha + hora y calendario (Zenith DateRange) ──
    const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const sameDay = (a, b) => a && b && localDateStr(a) === localDateStr(b);
    const fmtTime = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

    // Horas cada 30 min; la de fin incluye 23:59 como en MyGeotab
    const TIME_OPTIONS = [];
    for (let m = 0; m < 24 * 60; m += 30) TIME_OPTIONS.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    TIME_OPTIONS.push("23:59");

    let calMonth = startOfDay(new Date());               // primer día del mes visible
    let draft = { from: null, to: null };                  // días elegidos en el calendario

    const parseShortDate = str => {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec((str || "").trim());
        if (!m) return null;
        const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
        const d = new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
        return d.getMonth() === parseInt(m[1], 10) - 1 ? d : null;
    };

    const fillTimeSelect = (select, value) => {
        const opts = TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [...TIME_OPTIONS, value].sort();
        select.innerHTML = opts.map(t => `<option value="${t}"${t === value ? " selected" : ""}>${t}</option>`).join("");
    };

    const syncDateInputs = () => {
        $("sg-custom-from").value = draft.from ? fmtShortDate(draft.from) : "";
        $("sg-custom-to").value = draft.to ? fmtShortDate(draft.to) : (draft.from ? fmtShortDate(draft.from) : "");
        $("sg-custom-from").classList.remove("sg-input--error");
        $("sg-custom-to").classList.remove("sg-input--error");
    };

    const renderCalendar = () => {
        const year = calMonth.getFullYear();
        const month = calMonth.getMonth();
        $("sg-cal-label").textContent = `${MONTHS_SHORT[month]} ${year}`;

        // Selector de mes: últimos 36 meses hasta el actual
        const now = new Date();
        const monthSelect = $("sg-cal-month");
        const items = [];
        for (let i = 0; i < 36; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${d.getMonth()}`;
            items.push(`<option value="${val}"${d.getFullYear() === year && d.getMonth() === month ? " selected" : ""}>${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}</option>`);
        }
        monthSelect.innerHTML = items.join("");

        const first = new Date(year, month, 1);
        const gridStart = addDays(first, -first.getDay());   // semana inicia en domingo
        const today = startOfDay(now);
        const rangeEnd = draft.to || draft.from;

        let html = "";
        for (let i = 0; i < 42; i++) {
            const d = addDays(gridStart, i);
            if (i >= 35 && d.getMonth() !== month) break;      // no mostrar una 6ª fila vacía
            const cls = ["sg-cal-day"];
            if (d.getMonth() !== month) cls.push("sg-cal-day--outside");
            if (sameDay(d, today)) cls.push("sg-cal-day--today");
            if (draft.from && sameDay(d, draft.from)) cls.push("sg-cal-day--range-start");
            if (rangeEnd && sameDay(d, rangeEnd)) cls.push("sg-cal-day--range-end");
            if (draft.from && rangeEnd && d > draft.from && d < rangeEnd) cls.push("sg-cal-day--in-range");
            html += `<button type="button" class="${cls.join(" ")}" data-date="${localDateStr(d)}" ${d > today ? "disabled" : ""}><span>${d.getDate()}</span></button>`;
        }
        $("sg-cal-grid").innerHTML = html;

        $("sg-cal-next").disabled = year === now.getFullYear() && month === now.getMonth();
    };

    const onCalendarDayClick = dateStr => {
        const d = new Date(dateStr + "T00:00:00");
        // Primer clic = inicio; segundo clic = fin (si es anterior, reinicia el inicio)
        if (!draft.from || draft.to || d < draft.from) draft = { from: d, to: null };
        else draft = { from: draft.from, to: d };
        $("sg-custom-error").hidden = true;
        syncDateInputs();
        renderCalendar();
    };

    const onDateInputChange = which => {
        const input = $(`sg-custom-${which}`);
        const d = parseShortDate(input.value);
        if (!d) { input.classList.add("sg-input--error"); return; }
        input.classList.remove("sg-input--error");
        if (which === "from") draft = { from: d, to: draft.to && draft.to >= d ? draft.to : d };
        else draft = { from: draft.from && draft.from <= d ? draft.from : d, to: d };
        calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        syncDateInputs();
        renderCalendar();
    };

    const showCustomRange = show => {
        const custom = $("sg-period-custom");
        if (custom) custom.hidden = !show;
        const applyBtn = $("sg-period-apply");
        if (applyBtn) applyBtn.hidden = !show;
        const err = $("sg-custom-error");
        if (err) err.hidden = true;
        if (!show) return;

        // Precargar con el rango actual (personalizado) o con el día de hoy
        const current = period.id === "custom" ? getPeriodRange() : { from: startOfDay(new Date()), to: endOfDay(new Date()) };
        draft = { from: startOfDay(current.from), to: startOfDay(current.to) };
        calMonth = new Date(draft.to.getFullYear(), draft.to.getMonth(), 1);
        fillTimeSelect($("sg-custom-from-time"), fmtTime(current.from));
        fillTimeSelect($("sg-custom-to-time"), fmtTime(current.to));
        syncDateInputs();
        renderCalendar();
        refreshIcons();
    };

    const onPeriodOptionSelect = id => {
        if (id === "custom") {
            renderPeriodOptions("custom");
            showCustomRange(true);
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

    // ── Agregados de viajes por vehículo y por día ──────────────
    const newTripAgg = () => ({ trips: 0, dist: 0, drive: 0, idle: 0, stop: 0, workDrive: 0, workStop: 0, engFirst: null, engLast: null, fuel: null });

    // Combustible (L): suma de los eventos FuelUsed; null = sin datos de combustible
    const addFuelToAgg = (agg, liters) => { agg.fuel = (agg.fuel || 0) + liters; };

    const addTripToAgg = (agg, t) => {
        agg.trips++;
        agg.dist += t.distance || 0;
        agg.drive += parseSeconds(t.drivingDuration);
        agg.idle += parseSeconds(t.idlingDuration);
        agg.stop += parseSeconds(t.stopDuration);
        agg.workDrive += parseSeconds(t.workDrivingDuration);
        agg.workStop += parseSeconds(t.workStopDuration);
    };

    // Las lecturas llegan ordenadas por fecha: la primera fija engFirst y la última engLast
    const addReadingToAgg = (agg, hours) => {
        if (agg.engFirst === null) agg.engFirst = hours;
        agg.engLast = hours;
    };

    // Horas de motor = última lectura − primera lectura (null si no hay lecturas)
    const engineDelta = agg => agg.engFirst === null ? null : Math.max(0, agg.engLast - agg.engFirst);

    // Lecturas del horómetro a partir de los viajes: Trip.engineHours es el acumulado
    // (en segundos) al terminar el viaje; al inicio se estima restando la conducción
    const readingsFromTrips = trips => {
        const readings = [];
        trips.forEach(t => {
            const endSec = parseSeconds(t.engineHours);
            if (!t.device || !t.device.id || !endSec || endSec <= 0) return;
            const startSec = Math.max(0, endSec - parseSeconds(t.drivingDuration));
            readings.push({ device: t.device, dateTime: t.start, data: startSec });
            readings.push({ device: t.device, dateTime: t.stop || t.start, data: endSec });
        });
        return readings;
    };

    const buildUnitTripSummaries = (trips, fuelRecords, targetUnits) => {
        const readings = readingsFromTrips(trips);
        const byUnit = new Map();
        const getUnit = id => {
            if (!byUnit.has(id)) byUnit.set(id, { total: newTripAgg(), days: new Map() });
            return byUnit.get(id);
        };
        const getDay = (u, key) => {
            if (!u.days.has(key)) u.days.set(key, newTripAgg());
            return u.days.get(key);
        };

        trips.forEach(t => {
            const id = t.device && t.device.id;
            if (!id || !t.start) return;
            const u = getUnit(id);
            addTripToAgg(u.total, t);
            addTripToAgg(getDay(u, localDateStr(new Date(t.start))), t);
        });

        readings
            .filter(r => r && r.device && r.device.id && r.dateTime && typeof r.data === "number")
            .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
            .forEach(r => {
                const u = getUnit(r.device.id);
                const hours = r.data / 3600;
                addReadingToAgg(u.total, hours);
                addReadingToAgg(getDay(u, localDateStr(new Date(r.dateTime))), hours);
            });

        fuelRecords.forEach(f => {
            const liters = Number(f && f.totalFuelUsed);
            if (!f.device || !f.device.id || !f.dateTime || !isFinite(liters) || liters < 0) return;
            const u = getUnit(f.device.id);
            addFuelToAgg(u.total, liters);
            addFuelToAgg(getDay(u, localDateStr(new Date(f.dateTime))), liters);
        });

        const targetIds = new Set(targetUnits.map(u => u.id));
        return Array.from(byUnit.entries())
            .filter(([id, u]) => targetIds.has(id) && (u.total.trips > 0 || engineDelta(u.total) > 0))
            .map(([id, u]) => ({
                unitId: id,
                unitName: (unitsById.get(id) || {}).name || id,
                total: u.total,
                days: Array.from(u.days.entries())
                    .map(([key, agg]) => ({ key, agg }))
                    .sort((a, b) => b.key.localeCompare(a.key))
            }))
            .sort((a, b) => a.unitName.localeCompare(b.unitName));
    };

    const fmtEngine = h => h === null ? `<span class="sg-muted">—</span>` : `${fmtNum(h, 1)} h`;
    const fmtDayLabel = key => {
        const d = new Date(key + "T00:00:00");
        const txt = d.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
        return txt.charAt(0).toUpperCase() + txt.slice(1);
    };

    const aggCells = agg => {
        const avgSpeed = agg.drive > 0 ? `${fmtNum(agg.dist / (agg.drive / 3600), 1)} km/h` : "—";
        return `
            <td class="sg-num">${agg.trips}</td>
            <td class="sg-num">${fmtNum(agg.dist, 1)} km</td>
            <td class="sg-num">${fmtHrs(agg.drive)}</td>
            <td class="sg-num">${fmtHrs(agg.idle)}</td>
            <td class="sg-num">${fmtHrs(agg.stop)}</td>
            <td class="sg-num">${fmtHrs(agg.workDrive)}</td>
            <td class="sg-num">${fmtHrs(agg.workStop)}</td>
            <td class="sg-num">${avgSpeed}</td>
            <td class="sg-num">${agg.fuel === null ? `<span class="sg-muted">—</span>` : `${fmtNum(agg.fuel, 1)} L`}</td>
            <td class="sg-num">${fmtEngine(engineDelta(agg))}</td>
            <td class="sg-num sg-muted">${agg.engLast === null ? "—" : `${fmtNum(agg.engLast, 1)} h`}</td>`;
    };

    const renderTripsTablePage = () => {
        const tbody = $("sg-tbody-trips");
        if (!tbody) return;

        const totalItems = unitTripSummaries.length;
        const totalPages = Math.ceil(totalItems / TRIPS_PER_PAGE) || 1;
        if (currentTripsPage > totalPages) currentTripsPage = totalPages;
        const start = (currentTripsPage - 1) * TRIPS_PER_PAGE;
        const pageData = unitTripSummaries.slice(start, start + TRIPS_PER_PAGE);

        if (!pageData.length) {
            tbody.innerHTML = `<tr class="sg-table__empty"><td colspan="12">No hay viajes registrados en el periodo seleccionado.</td></tr>`;
        } else {
            tbody.innerHTML = pageData.map(u => {
                const expanded = expandedUnits.has(u.unitId);
                const dayRows = expanded ? u.days.map(day => `
                    <tr class="sg-row--child">
                        <td>${fmtDayLabel(day.key)}</td>
                        ${aggCells(day.agg)}
                    </tr>`).join("") : "";
                return `
                    <tr class="sg-row--parent${expanded ? " sg-row--expanded" : ""}" data-unit-id="${escapeHtml(u.unitId)}">
                        <td>
                            <span class="sg-tree-cell">
                                <button type="button" class="sg-expand" aria-expanded="${expanded}" aria-label="${expanded ? "Contraer" : "Ver"} días de ${escapeHtml(u.unitName)}">
                                    <i data-lucide="chevron-right" width="16" height="16"></i>
                                </button>
                                <span class="sg-strong">${escapeHtml(u.unitName)}</span>
                                <span class="sg-muted">· ${u.days.length} ${u.days.length === 1 ? "día" : "días"}</span>
                            </span>
                        </td>
                        ${aggCells(u.total)}
                    </tr>${dayRows}`;
            }).join("");
        }

        const expandAll = $("sg-trips-expand-all");
        if (expandAll) {
            expandAll.hidden = !unitTripSummaries.length;
            expandAll.textContent = expandedUnits.size && expandedUnits.size === unitTripSummaries.length ? "Contraer todo" : "Expandir todo";
        }

        renderPagination("trips", currentTripsPage, totalItems, TRIPS_PER_PAGE, "vehículos");
        refreshIcons();
    };

    // ════════════════════════════════════════════════════════════
    // RENDER: GRÁFICAS DE RECORRIDOS
    // ════════════════════════════════════════════════════════════
    const CHART_MAX_ITEMS = 12;
    const DONUT_COLORS = ["#0069bf", "#3a86d4", "#6fa6e0", "#9fc4ec", "#c9def5", "#8da4b9"];

    // "006- TOYOTA HILUX" → "TOYOTA HILUX" para etiquetas compactas
    const shortName = name => String(name || "").replace(/^\s*\d+\s*-\s*/, "") || name;

    const PERF_METRICS = {
        dist:  { sub: "Distancia acumulada del periodo",   value: u => u.total.dist,  fmt: v => `${fmtNum(v, 1)} km` },
        trips: { sub: "Número de viajes del periodo",       value: u => u.total.trips, fmt: v => `${v.toLocaleString("es-MX")} viajes` },
        drive: { sub: "Tiempo de conducción del periodo",   value: u => u.total.drive, fmt: v => fmtHrs(v) },
        fuel:  { sub: "Litros consumidos en el periodo",    value: u => u.total.fuel,  fmt: v => `${fmtNum(v, 1)} L` }
    };

    const emptyChart = msg => `<p class="sg-chart-empty">${msg}</p>`;

    // Barras horizontales ordenadas de mayor a menor
    const hbarsHtml = (items, fmt) => {
        const max = Math.max(...items.map(i => i.value)) || 1;
        const shown = items.slice(0, CHART_MAX_ITEMS);
        const rest = items.length - shown.length;
        return shown.map(i => `
            <div class="sg-hbar" title="${escapeHtml(i.name)}: ${escapeHtml(fmt(i.value))}">
                <span class="sg-hbar__label">${escapeHtml(i.name)}</span>
                <span class="sg-hbar__track"><span class="sg-hbar__fill" style="display:block;width:${(i.value / max * 100).toFixed(1)}%"></span></span>
                <span class="sg-hbar__value">${fmt(i.value)}</span>
            </div>`).join("") + (rest > 0 ? `<span class="sg-hbars__more">+${rest} vehículos más</span>` : "");
    };

    const renderPerfChart = () => {
        const el = $("sg-chart-perf");
        if (!el) return;
        const metric = PERF_METRICS[perfMetric];
        $("sg-chart-perf-sub").textContent = metric.sub;
        document.querySelectorAll("#sg-chart-perf-metric .sg-segmented__item").forEach(btn => {
            const active = btn.getAttribute("data-metric") === perfMetric;
            btn.classList.toggle("sg-segmented__item--active", active);
            btn.setAttribute("aria-pressed", active ? "true" : "false");
        });

        const items = unitTripSummaries
            .map(u => ({ name: u.unitName, value: metric.value(u) }))
            .filter(i => i.value !== null && i.value > 0)
            .sort((a, b) => b.value - a.value);
        el.innerHTML = items.length ? hbarsHtml(items, metric.fmt) : emptyChart("Sin datos para esta métrica en el periodo.");
    };

    const renderShareChart = totalDist => {
        const el = $("sg-chart-share");
        if (!el) return;
        $("sg-chart-share-sub").textContent = `Sobre el total de ${fmtNum(totalDist, 1)} km`;

        let items = unitTripSummaries
            .filter(u => u.total.dist > 0)
            .map(u => ({ name: u.unitName, value: u.total.dist }))
            .sort((a, b) => b.value - a.value);
        if (!items.length || totalDist <= 0) { el.innerHTML = emptyChart("Sin distancia registrada en el periodo."); return; }

        // Más de 6 vehículos: los 5 principales y el resto agrupado en "Otros"
        if (items.length > DONUT_COLORS.length) {
            const others = items.slice(DONUT_COLORS.length - 1).reduce((s, i) => s + i.value, 0);
            items = [...items.slice(0, DONUT_COLORS.length - 1), { name: "Otros", value: others }];
        }

        const r = 54, c = 2 * Math.PI * r;
        let offset = 0;
        const arcs = items.map((i, idx) => {
            const len = (i.value / totalDist) * c;
            const gap = items.length > 1 && len > 3 ? 1.5 : 0;
            const arc = `<circle cx="64" cy="64" r="${r}" stroke="${DONUT_COLORS[idx]}"
                stroke-dasharray="${(len - gap).toFixed(2)} ${(c - len + gap).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}">
                <title>${escapeHtml(i.name)}: ${fmtNum(i.value, 1)} km</title></circle>`;
            offset += len;
            return arc;
        }).join("");

        el.innerHTML = `
            <div class="sg-donut">
                <svg viewBox="0 0 128 128" role="img" aria-label="Participación en distancia por vehículo">${arcs}</svg>
                <div class="sg-donut__center">
                    <span class="sg-donut__value">${fmtNum(totalDist, 0)}</span>
                    <span class="sg-donut__label">km totales</span>
                </div>
            </div>
            <ul class="sg-legend">
                ${items.map((i, idx) => `
                    <li class="sg-legend__item" title="${escapeHtml(i.name)}">
                        <span class="sg-legend__swatch" style="background:${DONUT_COLORS[idx]}"></span>
                        <span class="sg-legend__name">${escapeHtml(shortName(i.name))}</span>
                        <span class="sg-legend__value">${fmtNum(i.value / totalDist * 100, 1)}%</span>
                    </li>`).join("")}
            </ul>`;
    };

    const renderFuelChart = () => {
        const el = $("sg-chart-fuel");
        if (!el) return;
        const items = unitTripSummaries
            .filter(u => u.total.fuel > 0 && u.total.dist > 0)
            .map(u => ({ name: u.unitName, value: u.total.dist / u.total.fuel }))
            .sort((a, b) => b.value - a.value);
        el.innerHTML = items.length
            ? hbarsHtml(items, v => `${fmtNum(v, 1)} km/L`)
            : emptyChart("Ningún vehículo tiene registros de combustible en el periodo.");
    };

    const renderSpeedChart = (totalDist, totalDriveSec) => {
        const el = $("sg-chart-speed");
        if (!el) return;
        const items = unitTripSummaries
            .filter(u => u.total.drive > 0)
            .map(u => ({ name: u.unitName, value: u.total.dist / (u.total.drive / 3600) }))
            .sort((a, b) => b.value - a.value)
            .slice(0, CHART_MAX_ITEMS);
        if (!items.length) { el.innerHTML = emptyChart("Sin tiempo de conducción en el periodo."); return; }

        const fleetAvg = totalDriveSec > 0 ? totalDist / (totalDriveSec / 3600) : 0;
        // Escala con margen para la etiqueta de valor sobre la barra más alta
        const max = Math.max(fleetAvg, ...items.map(i => i.value)) * 1.2 || 1;
        const pct = v => (v / max * 100).toFixed(1);

        el.innerHTML = `
            <div class="sg-vbars__plot">
                ${items.map(i => `
                    <div class="sg-vbar" title="${escapeHtml(i.name)}: ${fmtNum(i.value, 1)} km/h">
                        <span class="sg-vbar__value">${fmtNum(i.value, 1)}</span>
                        <span class="sg-vbar__fill" style="height:${pct(i.value)}%"></span>
                        <span class="sg-vbar__label">${escapeHtml(shortName(i.name))}</span>
                    </div>`).join("")}
                <div class="sg-vbars__avg" style="bottom:${pct(fleetAvg)}%"><span>Promedio ${fmtNum(fleetAvg, 1)} km/h</span></div>
            </div>`;
    };

    const renderTripCharts = (totalDist, totalDriveSec) => {
        renderPerfChart();
        renderShareChart(totalDist);
        renderFuelChart();
        renderSpeedChart(totalDist, totalDriveSec);
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

        const finish = (trips, fuelRecords) => {
            const map = new Map();
            trips.forEach(t => { if (t && t.id) map.set(t.id, t); });
            rawTripsList = Array.from(map.values()).sort((a, b) => new Date(b.start) - new Date(a.start));
            unitTripSummaries = buildUnitTripSummaries(rawTripsList, fuelRecords || [], targetUnits);
            expandedUnits = new Set();
            onDone();
        };

        if (!hasApi()) {
            setTimeout(() => {
                const mock = [];
                const mockFuel = [];
                targetUnits.forEach((unit, idx) => {
                    let cursor = new Date(from.getTime() + idx * 3600 * 1000);
                    let engineSec = (1500 + idx * 230) * 3600;
                    for (let i = 0; i < 8 + (idx % 4); i++) {
                        const driveSec = Math.floor(Math.random() * 7200) + 1800;
                        const stopSec = Math.floor(Math.random() * 14400) + 3600;
                        const tripStop = new Date(cursor.getTime() + driveSec * 1000);
                        if (tripStop > to) break;
                        engineSec += driveSec + Math.floor(driveSec * 0.1);
                        mockFuel.push({ device: { id: unit.id }, dateTime: tripStop.toISOString(), totalFuelUsed: driveSec * 0.0045 });
                        mock.push({
                            engineHours: engineSec,
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
                            averageSpeed: Math.floor(45 + Math.random() * 30)
                        });
                        cursor = new Date(tripStop.getTime() + stopSec * 1000);
                    }
                });
                finish(mock, mockFuel);
            }, 400);
            return;
        }

        const base = { fromDate: from.toISOString(), toDate: to.toISOString() };

        // Todos los vehículos: una sola consulta; si hay selección, una por vehículo en un multiCall
        const getPerDevice = typeName => new Promise((resolve, reject) => {
            const calls = selectedUnitIds.length
                ? selectedUnitIds.map(id => ["Get", { typeName, search: { ...base, deviceSearch: { id } } }])
                : [["Get", { typeName, search: base }]];
            multiGet(calls, results => resolve([].concat(...results.map(r => r || []))), reject);
        });

        // Si falla el combustible (p. ej. sin permisos) se muestran los viajes sin esa columna
        const fuelReq = getPerDevice("FuelUsed").catch(err => {
            console.warn("No se pudo consultar el consumo de combustible (FuelUsed):", err);
            return [];
        });

        Promise.all([getPerDevice("Trip"), fuelReq])
            .then(([trips, fuel]) => finish(trips, fuel))
            .catch(err => {
                console.error("Error al consultar la tabla Trip:", err);
                onError("Error de conexión con Geotab al consultar los viajes.");
            });
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
        let totalDist = 0, totalDriveSec = 0, totalIdleSec = 0, tripCount = 0, totalEngine = 0, hasEngine = false, totalFuel = null;

        unitTripSummaries.forEach(u => {
            totalDist += u.total.dist;
            totalDriveSec += u.total.drive;
            totalIdleSec += u.total.idle;
            tripCount += u.total.trips;
            const eng = engineDelta(u.total);
            if (eng !== null) { totalEngine += eng; hasEngine = true; }
            if (u.total.fuel !== null) totalFuel = (totalFuel || 0) + u.total.fuel;
        });

        const engineSec = totalDriveSec + totalIdleSec;
        const fuelText = totalFuel === null ? "" : ` · ${fmtNum(totalFuel, 1)} L de combustible`;

        $("sg-kpi-dist").textContent = fmtNum(totalDist, 1);
        $("sg-kpi-dist-avg").textContent = `${tripCount.toLocaleString("es-MX")} viajes${fuelText}`;
        $("sg-kpi-engine").textContent = hasEngine ? fmtNum(totalEngine, 1) : "—";
        $("sg-kpi-trips-units").textContent = `${unitTripSummaries.length} vehículos con actividad`;
        $("sg-kpi-drive").textContent = fmtHrs(totalDriveSec);
        $("sg-kpi-idle").textContent = fmtHrs(totalIdleSec);
        $("sg-kpi-idle-pct").textContent = `${fmtNum(engineSec ? (totalIdleSec / engineSec) * 100 : 0, 1)}% del tiempo de motor`;

        renderTripCharts(totalDist, totalDriveSec);

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
            const li = e.target.closest(".sg-radio");
            if (li) onPeriodOptionSelect(li.getAttribute("data-period"));
        });
        $("sg-period-options").addEventListener("keydown", e => {
            const li = e.target.closest(".sg-radio");
            if (!li) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPeriodOptionSelect(li.getAttribute("data-period")); }
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const target = e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling;
                if (target) target.focus();
            }
        });

        // Borrar: regresa el periodo al valor por defecto
        $("sg-period-clear").addEventListener("click", () => {
            const wasDefault = isDefaultPeriod();
            period = { ...DEFAULT_PERIOD };
            closePopups();
            if (!wasDefault) applyFilters();
        });

        $("sg-period-prev").addEventListener("click", () => { period = { ...period, offset: period.offset - 1 }; applyFilters(); });
        $("sg-period-next").addEventListener("click", () => { period = { ...period, offset: period.offset + 1 }; applyFilters(); });

        // ── Rango personalizado ──
        $("sg-cal-grid").addEventListener("click", e => {
            const btn = e.target.closest(".sg-cal-day");
            if (btn && !btn.disabled) onCalendarDayClick(btn.getAttribute("data-date"));
        });
        $("sg-cal-prev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
        $("sg-cal-next").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
        $("sg-cal-today").addEventListener("click", () => { const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); renderCalendar(); });
        $("sg-cal-month").addEventListener("change", e => {
            const [y, m] = e.target.value.split("-").map(Number);
            calMonth = new Date(y, m, 1);
            renderCalendar();
        });
        ["from", "to"].forEach(which => {
            const input = $(`sg-custom-${which}`);
            input.addEventListener("change", () => onDateInputChange(which));
            input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); onDateInputChange(which); } });
        });

        $("sg-period-apply").addEventListener("click", () => {
            const err = $("sg-custom-error");
            const fail = msg => { err.textContent = msg; err.hidden = false; };
            const fromDay = parseShortDate($("sg-custom-from").value);
            const toDay = parseShortDate($("sg-custom-to").value);
            if (!fromDay) return fail("La fecha de inicio no puede estar vacía.");
            if (!toDay) return fail("La fecha de desactivación no puede estar vacía.");

            const withTime = (day, time) => {
                const [h, m] = time.split(":").map(Number);
                const d = new Date(day);
                d.setHours(h, m, m === 59 ? 59 : 0, m === 59 ? 999 : 0);
                return d;
            };
            const from = withTime(fromDay, $("sg-custom-from-time").value);
            const to = withTime(toDay, $("sg-custom-to-time").value);
            if (from >= to) return fail("La fecha de inicio debe ser anterior a la fecha de desactivación.");

            period = { id: "custom", offset: 0, from, to };
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
            // e.target puede quedar desconectado si el popup se redibujó durante el clic
            if (openPopupId && e.target.isConnected && !e.target.closest(".sg-filter")) closePopups();
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
            if (currentTripsPage < Math.ceil(unitTripSummaries.length / TRIPS_PER_PAGE)) { currentTripsPage++; renderTripsTablePage(); }
        });

        // Desplegar / contraer los días de un vehículo (clic en la fila o en la flecha)
        $("sg-tbody-trips").addEventListener("click", e => {
            const row = e.target.closest(".sg-row--parent");
            if (!row) return;
            const id = row.getAttribute("data-unit-id");
            if (expandedUnits.has(id)) expandedUnits.delete(id);
            else expandedUnits.add(id);
            renderTripsTablePage();
        });
        // Métrica de la gráfica de desempeño
        $("sg-chart-perf-metric").addEventListener("click", e => {
            const btn = e.target.closest(".sg-segmented__item");
            if (!btn || btn.getAttribute("data-metric") === perfMetric) return;
            perfMetric = btn.getAttribute("data-metric");
            renderPerfChart();
        });

        $("sg-trips-expand-all").addEventListener("click", () => {
            const allOpen = expandedUnits.size === unitTripSummaries.length;
            expandedUnits = allOpen ? new Set() : new Set(unitTripSummaries.map(u => u.unitId));
            renderTripsTablePage();
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
