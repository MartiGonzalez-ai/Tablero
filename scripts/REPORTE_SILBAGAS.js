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
    // Nombre del reporte según la sección (encabezado, pestaña del navegador y descargas)
    const REPORT_TITLES = { recorridos: "Reporte de Utilización", servicios: "Reporte de Mantenimientos" };
    const updatePageTitle = () => {
        const title = $("sg-page-title");
        if (title) title.textContent = REPORT_TITLES[activeSection];
        document.title = REPORT_TITLES[activeSection];
    };
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

    // Enteros con separador de miles (1,234), igual que el resto de las cifras
    const fmtInt = n => Math.round(n || 0).toLocaleString("es-MX");

    const fmtHrs = val => {
        const sec = parseSeconds(val);
        if (!sec || sec <= 0) return "0h 00m";
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${fmtInt(h)}h ${String(m).padStart(2, "0")}m`;
    };

    // Milisegundos a días, horas y minutos (ej. 3d 14h 25m)
    const fmtDurationMs = ms => {
        if (!ms || ms <= 0) return "0h 00m";
        const totalSec = Math.floor(ms / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        if (days > 0) return `${fmtInt(days)}d ${String(hours).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m`;
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
        ["sg-period", "sg-units", "sg-export"].forEach(prefix => {
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
        if (info) info.textContent = `${fmtInt(totalItems > 0 ? start + 1 : 0)}–${fmtInt(end)} de ${fmtInt(totalItems)} ${noun}`;
        const ind = $(`sg-${prefix}-page-indicator`);
        if (ind) ind.textContent = `${currentPage} / ${totalPages}`;
        const prev = $(`sg-btn-${prefix}-prev`);
        const next = $(`sg-btn-${prefix}-next`);
        if (prev) prev.disabled = currentPage <= 1;
        if (next) next.disabled = currentPage >= totalPages;
    };

    // ── Agregados de viajes por vehículo y por día ──────────────
    const newTripAgg = () => ({ trips: 0, dist: 0, drive: 0, idle: 0, stop: 0, workDrive: 0, workStop: 0, engFirst: null, engLast: null, fuel: null });

    // Combustible (L): incrementos del totalizador de combustible; null = sin datos de combustible
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

    const buildUnitTripSummaries = (trips, fuelReadings, targetUnits) => {
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

        // Combustible desde StatusData (DiagnosticDeviceTotalFuelId, litros acumulados), igual que
        // rendimiento.js: se suman los incrementos positivos entre lecturas consecutivas y cada
        // incremento se asigna al día de la lectura posterior
        const fuelByDevice = new Map();
        fuelReadings.forEach(r => {
            if (!r || !r.device || !r.device.id || !r.dateTime || typeof r.data !== "number") return;
            if (!fuelByDevice.has(r.device.id)) fuelByDevice.set(r.device.id, []);
            fuelByDevice.get(r.device.id).push(r);
        });
        fuelByDevice.forEach((list, id) => {
            if (list.length < 2) return;
            list.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
            const u = getUnit(id);
            addFuelToAgg(u.total, 0);
            for (let i = 1; i < list.length; i++) {
                const delta = list[i].data - list[i - 1].data;
                if (delta <= 0) continue;
                addFuelToAgg(u.total, delta);
                addFuelToAgg(getDay(u, localDateStr(new Date(list[i].dateTime))), delta);
            }
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
            <td class="sg-num">${fmtInt(agg.trips)}</td>
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

    // "Ver todos" abre la gráfica en pantalla completa
    const moreButton = (key, text) => `<button type="button" class="sg-hbars__more" data-chart-expand="${key}">${text}</button>`;

    // Barras horizontales ordenadas de mayor a menor; full = todos los vehículos (pantalla completa)
    const hbarsHtml = (items, fmt, key, full) => {
        const max = Math.max(...items.map(i => i.value)) || 1;
        const shown = full ? items : items.slice(0, CHART_MAX_ITEMS);
        const rest = items.length - shown.length;
        return shown.map(i => `
            <div class="sg-hbar" title="${escapeHtml(i.name)}: ${escapeHtml(fmt(i.value))}">
                <span class="sg-hbar__label">${escapeHtml(i.name)}</span>
                <span class="sg-hbar__track"><span class="sg-hbar__fill" style="display:block;width:${(i.value / max * 100).toFixed(1)}%"></span></span>
                <span class="sg-hbar__value">${fmt(i.value)}</span>
            </div>`).join("") + (rest > 0 ? moreButton(key, `+${rest} vehículos más · Ver todos`) : "");
    };

    const fleetTotals = () => unitTripSummaries.reduce(
        (t, u) => ({ dist: t.dist + u.total.dist, drive: t.drive + u.total.drive }), { dist: 0, drive: 0 });

    // Datos de cada gráfica, ordenados de mayor a menor (los usan la pantalla y las descargas)
    const perfItems = () => unitTripSummaries
        .map(u => ({ name: u.unitName, value: PERF_METRICS[perfMetric].value(u) }))
        .filter(i => i.value !== null && i.value > 0)
        .sort((a, b) => b.value - a.value);
    const shareItems = () => unitTripSummaries
        .filter(u => u.total.dist > 0)
        .map(u => ({ name: u.unitName, value: u.total.dist }))
        .sort((a, b) => b.value - a.value);
    const fuelItems = () => unitTripSummaries
        .filter(u => u.total.fuel > 0 && u.total.dist > 0)
        .map(u => ({ name: u.unitName, value: u.total.dist / u.total.fuel }))
        .sort((a, b) => b.value - a.value);
    const speedItems = () => unitTripSummaries
        .filter(u => u.total.drive > 0)
        .map(u => ({ name: u.unitName, value: u.total.dist / (u.total.drive / 3600) }))
        .sort((a, b) => b.value - a.value);
    const fleetAvgSpeed = () => { const { dist, drive } = fleetTotals(); return drive > 0 ? dist / (drive / 3600) : 0; };

    // Más de 6 vehículos en la dona: los 5 principales y el resto agrupado en "Otros"
    const groupShare = all => all.length > DONUT_COLORS.length
        ? [...all.slice(0, DONUT_COLORS.length - 1), { name: "Otros", value: all.slice(DONUT_COLORS.length - 1).reduce((s, i) => s + i.value, 0) }]
        : all;

    const EMPTY_MSG = {
        perf: "Sin datos para esta métrica en el periodo.",
        share: "Sin distancia registrada en el periodo.",
        fuel: "Ningún vehículo tiene registros de combustible en el periodo.",
        speed: "Sin tiempo de conducción en el periodo."
    };

    const perfHtml = full => {
        const items = perfItems();
        return items.length ? hbarsHtml(items, PERF_METRICS[perfMetric].fmt, "perf", full) : emptyChart(EMPTY_MSG.perf);
    };

    const renderPerfChart = () => {
        const el = $("sg-chart-perf");
        if (!el) return;
        $("sg-chart-perf-sub").textContent = PERF_METRICS[perfMetric].sub;
        document.querySelectorAll(".sg-perf-metric .sg-segmented__item").forEach(btn => {
            const active = btn.getAttribute("data-metric") === perfMetric;
            btn.classList.toggle("sg-segmented__item--active", active);
            btn.setAttribute("aria-pressed", active ? "true" : "false");
        });
        el.innerHTML = perfHtml(false);
        renderChartModal();
    };

    const shareHtml = full => {
        const totalDist = fleetTotals().dist;
        const all = shareItems();
        if (!all.length || totalDist <= 0) return emptyChart(EMPTY_MSG.share);
        const items = groupShare(all);
        const grouped = items.length < all.length;

        // En pantalla completa la leyenda lista todos los vehículos (los de "Otros" con su color)
        const legend = full
            ? all.map((i, idx) => ({ ...i, color: DONUT_COLORS[Math.min(idx, DONUT_COLORS.length - 1)] }))
            : items.map((i, idx) => ({ ...i, color: DONUT_COLORS[idx] }));

        const r = 54, c = 2 * Math.PI * r;
        let offset = 0;
        const arcs = items.map((i, idx) => {
            const len = (i.value / totalDist) * c;
            const gap = items.length > 1 && len > 3 ? 1.5 : 0;
            const arc = `<circle cx="64" cy="64" r="${r}" fill="none" stroke-width="20" stroke="${DONUT_COLORS[idx]}"
                stroke-dasharray="${(len - gap).toFixed(2)} ${(c - len + gap).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}">
                <title>${escapeHtml(i.name)}: ${fmtNum(i.value, 1)} km</title></circle>`;
            offset += len;
            return arc;
        }).join("");

        return `
            <div class="sg-donut">
                <svg viewBox="0 0 128 128" role="img" aria-label="Participación en distancia por vehículo"><g transform="rotate(-90 64 64)">${arcs}</g></svg>
                <div class="sg-donut__center">
                    <span class="sg-donut__value">${fmtNum(totalDist, 0)}</span>
                    <span class="sg-donut__label">km totales</span>
                </div>
            </div>
            <ul class="sg-legend">
                ${legend.map(i => `
                    <li class="sg-legend__item" title="${escapeHtml(i.name)}: ${fmtNum(i.value, 1)} km">
                        <span class="sg-legend__swatch" style="background:${i.color}"></span>
                        <span class="sg-legend__name">${escapeHtml(full ? i.name : shortName(i.name))}</span>
                        <span class="sg-legend__value">${full ? `${fmtNum(i.value, 1)} km · ` : ""}${fmtNum(i.value / totalDist * 100, 1)}%</span>
                    </li>`).join("")}
                ${!full && grouped ? `<li>${moreButton("share", `Ver los ${all.length} vehículos`)}</li>` : ""}
            </ul>`;
    };

    const fuelHtml = full => {
        const items = fuelItems();
        return items.length ? hbarsHtml(items, v => `${fmtNum(v, 1)} km/L`, "fuel", full) : emptyChart(EMPTY_MSG.fuel);
    };

    const speedHtml = full => {
        const all = speedItems();
        if (!all.length) return emptyChart(EMPTY_MSG.speed);
        const items = full ? all : all.slice(0, CHART_MAX_ITEMS);
        const fleetAvg = fleetAvgSpeed();
        // Escala con margen para la etiqueta de valor sobre la barra más alta
        const max = Math.max(fleetAvg, ...items.map(i => i.value)) * 1.2 || 1;
        const pct = v => (v / max * 100).toFixed(1);
        // En pantalla completa cada barra tiene un ancho mínimo; si no caben, hay scroll horizontal
        const plotStyle = full ? ` style="min-width:${items.length * 4.5}rem"` : "";

        return `
            <div class="sg-vbars__plot"${plotStyle}>
                ${items.map(i => `
                    <div class="sg-vbar" title="${escapeHtml(i.name)}: ${fmtNum(i.value, 1)} km/h">
                        <span class="sg-vbar__value">${fmtNum(i.value, 1)}</span>
                        <span class="sg-vbar__fill" style="height:${pct(i.value)}%"></span>
                        <span class="sg-vbar__label">${escapeHtml(shortName(i.name))}</span>
                    </div>`).join("")}
                <div class="sg-vbars__avg" style="bottom:${pct(fleetAvg)}%"><span>Promedio ${fmtNum(fleetAvg, 1)} km/h</span></div>
            </div>`;
    };

    // Gráficas: contenedor en la tarjeta, clase del contenedor y generador de contenido
    const CHARTS = {
        perf:  { el: "sg-chart-perf",  cls: "sg-hbars",      html: perfHtml },
        share: { el: "sg-chart-share", cls: "sg-donut-wrap", html: shareHtml },
        fuel:  { el: "sg-chart-fuel",  cls: "sg-hbars",      html: fuelHtml },
        speed: { el: "sg-chart-speed", cls: "sg-vbars",      html: speedHtml }
    };

    // ── Gráfica en pantalla completa (todos los vehículos) ──────
    let chartModalKey = null;

    const renderChartModal = () => {
        if (!chartModalKey) return;
        const chart = CHARTS[chartModalKey];
        const card = $(chart.el).closest(".sg-chart-card");
        $("sg-chart-modal-title").textContent = card.querySelector(".sg-chart-card__title").textContent;
        $("sg-chart-modal-sub").textContent = card.querySelector(".sg-chart-card__sub").textContent;
        $("sg-chart-modal-metric").hidden = chartModalKey !== "perf";
        $("sg-chart-modal-body").innerHTML = `<div class="${chart.cls}">${chart.html(true)}</div>`;
    };

    const openChartModal = key => {
        if (!CHARTS[key]) return;
        chartModalKey = key;
        renderChartModal();
        $("sg-chart-modal").hidden = false;
        $("sg-chart-modal-body").scrollTop = 0;
        refreshIcons();
    };

    const closeChartModal = () => {
        chartModalKey = null;
        $("sg-chart-modal").hidden = true;
    };

    const renderTripCharts = () => {
        $("sg-chart-share-sub").textContent = `Sobre el total de ${fmtNum(fleetTotals().dist, 1)} km`;
        renderPerfChart();
        ["share", "fuel", "speed"].forEach(key => {
            const el = $(CHARTS[key].el);
            if (el) el.innerHTML = CHARTS[key].html(false);
        });
        renderChartModal();
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
                        <td class="sg-num">${fmtInt(visits)}</td>
                        <td class="sg-num">${fmtDurationMs(s.totalTallerMs)}</td>
                        <td class="sg-num">
                            <span class="sg-table-pct">
                                <span class="sg-progress__bar"><span class="sg-progress__fill" style="display:block;width:${Math.min(100, pct).toFixed(1)}%"></span></span>
                                <span>${fmtNum(pct, 1)}%</span>
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

        if (!hasApi()) {
            // Vista previa: una orden cerrada por vehículo y una abierta en el primero
            const day = n => new Date(range.from.getTime() + n * 86400000);
            const mockOrders = [];
            targetUnits.forEach((unit, idx) => {
                mockOrders.push({ order: { id: `wo-${unit.id}`, device: { id: unit.id }, reference: `Servicio preventivo ${idx + 1}`, startDate: day(2 + idx * 3), completedDate: day(3 + idx * 3) }, jobs: [] });
                if (idx === 0) mockOrders.push({ order: { id: `wo-${unit.id}-b`, device: { id: unit.id }, reference: "Reparación de frenos", startDate: day(12) }, jobs: [] });
            });
            setTimeout(() => finish(mockOrders), 400);
            return;
        }

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

        const finish = (trips, fuelReadings) => {
            const map = new Map();
            trips.forEach(t => { if (t && t.id) map.set(t.id, t); });
            rawTripsList = Array.from(map.values()).sort((a, b) => new Date(b.start) - new Date(a.start));
            unitTripSummaries = buildUnitTripSummaries(rawTripsList, fuelReadings || [], targetUnits);
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
                    let totalFuel = 20000 + idx * 1500;
                    mockFuel.push({ device: { id: unit.id }, dateTime: cursor.toISOString(), data: totalFuel });
                    for (let i = 0; i < 8 + (idx % 4); i++) {
                        const driveSec = Math.floor(Math.random() * 7200) + 1800;
                        const stopSec = Math.floor(Math.random() * 14400) + 3600;
                        const tripStop = new Date(cursor.getTime() + driveSec * 1000);
                        if (tripStop > to) break;
                        engineSec += driveSec + Math.floor(driveSec * 0.1);
                        totalFuel += driveSec * 0.0045;
                        mockFuel.push({ device: { id: unit.id }, dateTime: tripStop.toISOString(), data: totalFuel });
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
        const getPerDevice = (typeName, extraSearch = {}) => new Promise((resolve, reject) => {
            const search = { ...base, ...extraSearch };
            const calls = selectedUnitIds.length
                ? selectedUnitIds.map(id => ["Get", { typeName, search: { ...search, deviceSearch: { id } }, resultsLimit: 100000 }])
                : [["Get", { typeName, search, resultsLimit: 100000 }]];
            multiGet(calls, results => resolve([].concat(...results.map(r => r || []))), reject);
        });

        // Combustible: totalizador del dispositivo (misma fuente que rendimiento.js).
        // Si falla (p. ej. sin permisos) se muestran los viajes sin esa columna
        const fuelReq = getPerDevice("StatusData", { diagnosticSearch: { id: "DiagnosticDeviceTotalFuelId" } }).catch(err => {
            console.warn("No se pudo consultar el combustible total (DiagnosticDeviceTotalFuelId):", err);
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
        $("sg-kpi-taller-pct").textContent = `${fmtNum(tallerPct, 1)}%`;
        $("sg-kpi-taller-count").textContent = fmtInt(totalVisits);
        $("sg-kpi-taller-units").textContent = `${fmtInt(unitsWithTaller)} de ${fmtInt(rawTallerList.length)} vehículos`;
        $("sg-kpi-taller-avg").textContent = fmtDurationMs(avgMs);
        $("sg-kpi-taller-now").textContent = fmtInt(unitsInTallerNow);

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

        renderTripCharts();

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

        updatePageTitle();
        showActiveSection();
        // Solo se consulta si esta sección no está al día con los filtros actuales
        if (loadedKeys[section] !== getQueryKey()) calculateMetrics();
    };

    // ════════════════════════════════════════════════════════════
    // DESCARGAS: Vista general / Vista extendida / Datos · Excel o PDF
    // ════════════════════════════════════════════════════════════
    // Las librerías se cargan solo la primera vez que se descarga algo
    const EXPORT_LIBS = {
        excel:   ["https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js"],
        pdf:     ["https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
                  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"]
    };
    const scriptLoads = new Map();
    const loadScript = src => {
        if (!scriptLoads.has(src)) scriptLoads.set(src, new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = resolve;
            s.onerror = () => { scriptLoads.delete(src); reject(new Error(`No se pudo cargar ${src}`)); };
            document.head.appendChild(s);
        }));
        return scriptLoads.get(src);
    };
    // En orden: jspdf-autotable necesita que jsPDF ya esté cargado
    const loadLibs = groups => [].concat(...groups.map(g => EXPORT_LIBS[g]))
        .reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());

    const EXPORT_VIEWS = { general: "Vista general", extended: "Vista extendida", data: "Datos" };
    const SECTION_TITLES = { recorridos: "Recorridos", servicios: "Servicios de taller" };
    const EXPORT_DESC = {
        recorridos: {
            general: "Indicadores, gráficas y tabla por vehículo, como se ve en pantalla",
            extended: "Igual que la vista general, con los días de cada vehículo desplegados",
            data: "Solo la tabla de datos por día de cada vehículo"
        },
        servicios: {
            general: "Indicadores y tabla por vehículo, como se ve en pantalla",
            extended: "Igual que la vista general, con las estancias de cada vehículo desplegadas",
            data: "Solo la tabla de estancias en taller"
        }
    };

    // Excel guarda fechas sin zona horaria: se escribe la hora local tal cual
    const excelDate = v => {
        const d = new Date(v);
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
    };

    // Tipos de columna: formato numérico de Excel y texto para el PDF
    const COL_TYPES = {
        text:   { pdf: v => String(v) },
        int:    { xl: "#,##0",              pdf: v => v.toLocaleString("es-MX") },
        km:     { xl: '#,##0.0 "km"',       pdf: v => `${fmtNum(v, 1)} km` },
        durS:   { xl: '[h]"h" mm"m"',       pdf: v => fmtHrs(v),         toXl: v => v / 86400 },
        durMs:  { xl: '[h]"h" mm"m"',       pdf: v => fmtDurationMs(v),  toXl: v => v / 86400000 },
        speed:  { xl: '#,##0.0 "km/h"',     pdf: v => `${fmtNum(v, 1)} km/h` },
        liters: { xl: '#,##0.0 "L"',        pdf: v => `${fmtNum(v, 1)} L` },
        hours:  { xl: '#,##0.0 "h"',        pdf: v => `${fmtNum(v, 1)} h` },
        pct:    { xl: '#,##0.0"%"',         pdf: v => `${fmtNum(v, 1)}%` },
        date:   { xl: "dd/mm/yyyy hh:mm",   pdf: v => fmtDateTime(v),    toXl: excelDate },
        day:    { xl: "dd/mm/yyyy",         pdf: v => fmtDayLabel(v),    toXl: v => excelDate(new Date(v + "T00:00:00")) }
    };
    const LEFT_TYPES = new Set(["text", "date", "day"]);

    // En los valores: undefined = celda vacía (no aplica), null = sin dato ("—")
    const pdfCell = (col, v) => v === undefined ? "" : v === null ? "—" : COL_TYPES[col.type].pdf(v);

    // ── Tablas a exportar ──
    const TRIP_COLS = [
        { header: "Viajes",             type: "int",    width: 9 },
        { header: "Distancia",          type: "km",     width: 13 },
        { header: "Conducción",         type: "durS",   width: 12 },
        { header: "Ralentí",            type: "durS",   width: 11 },
        { header: "Detenido",           type: "durS",   width: 12 },
        { header: "Conducción laboral", type: "durS",   width: 12 },
        { header: "Detenido laboral",   type: "durS",   width: 12 },
        { header: "Vel. promedio",      type: "speed",  width: 12 },
        { header: "Combustible",        type: "liters", width: 12 },
        { header: "Horas de motor",     type: "hours",  width: 12 },
        { header: "Horómetro",          type: "hours",  width: 12 }
    ];
    const aggValues = agg => [
        agg.trips, agg.dist, agg.drive, agg.idle, agg.stop, agg.workDrive, agg.workStop,
        agg.drive > 0 ? agg.dist / (agg.drive / 3600) : null, agg.fuel, engineDelta(agg), agg.engLast
    ];

    const buildRecorridosTable = view => {
        if (view === "data") {
            return {
                tableTitle: "Datos por día",
                columns: [{ header: "Vehículo", type: "text", width: 28 }, { header: "Fecha", type: "day", width: 13 }, ...TRIP_COLS],
                rows: [].concat(...unitTripSummaries.map(u => u.days.slice().reverse()
                    .map(d => ({ level: 0, values: [u.unitName, d.key, ...aggValues(d.agg)] }))))
            };
        }
        const rows = [];
        unitTripSummaries.forEach(u => {
            rows.push({ level: 0, values: [u.unitName, ...aggValues(u.total)] });
            if (view === "extended") u.days.forEach(d => rows.push({ level: 1, values: [fmtDayLabel(d.key), ...aggValues(d.agg)] }));
        });
        return {
            tableTitle: "Recorridos por vehículo",
            columns: [{ header: view === "extended" ? "Vehículo / Día" : "Vehículo", type: "text", width: 30 }, ...TRIP_COLS],
            rows
        };
    };

    const tallerStatus = s => s.isCurrentlyInTaller ? "En taller" : s.visitsCount > 0 ? "Concluido" : "Sin registros";
    const stayStatus = e => e.stop ? "Finalizado" : "En taller";

    const buildServiciosTable = view => {
        if (view === "data") {
            return {
                tableTitle: "Estancias en taller",
                columns: [
                    { header: "Vehículo", type: "text", width: 28 }, { header: "Orden / Taller", type: "text", width: 30 },
                    { header: "Entrada", type: "date", width: 17 }, { header: "Salida", type: "date", width: 17 },
                    { header: "Duración", type: "durMs", width: 13 }, { header: "% del periodo", type: "pct", width: 13 },
                    { header: "Estado", type: "text", width: 12 }
                ],
                rows: [].concat(...rawTallerList.map(s => (s.events || []).slice().reverse().map(e => ({
                    level: 0,
                    values: [s.unitName, e.location || "Orden de trabajo", e.start, e.stop, e.durationMs, e.pctInPeriod, stayStatus(e)]
                }))))
            };
        }
        if (view === "extended") {
            const rows = [];
            rawTallerList.forEach(s => {
                rows.push({ level: 0, values: [s.unitName, s.visitsCount, undefined, undefined, s.totalTallerMs, s.pctInPeriod, tallerStatus(s)] });
                (s.events || []).forEach((e, idx) => rows.push({
                    level: 1,
                    values: [`${idx + 1}. ${e.location || "Orden de trabajo"}`, undefined, e.start, e.stop, e.durationMs, e.pctInPeriod, stayStatus(e)]
                }));
            });
            return {
                tableTitle: "Tiempo en taller por unidad",
                columns: [
                    { header: "Vehículo / Orden", type: "text", width: 34 }, { header: "Ingresos", type: "int", width: 10 },
                    { header: "Entrada", type: "date", width: 17 }, { header: "Salida", type: "date", width: 17 },
                    { header: "Tiempo en taller", type: "durMs", width: 16 }, { header: "% del periodo", type: "pct", width: 13 },
                    { header: "Estado", type: "text", width: 13 }
                ],
                rows
            };
        }
        return {
            tableTitle: "Tiempo en taller por unidad",
            columns: [
                { header: "Vehículo", type: "text", width: 30 }, { header: "Ingresos", type: "int", width: 10 },
                { header: "Tiempo en taller", type: "durMs", width: 16 }, { header: "% del periodo", type: "pct", width: 13 },
                { header: "Estado", type: "text", width: 14 }
            ],
            rows: rawTallerList.map(s => ({ level: 0, values: [s.unitName, s.visitsCount, s.totalTallerMs, s.pctInPeriod, tallerStatus(s)] }))
        };
    };

    // Indicadores tal como se muestran en las tarjetas de la sección
    const readKpis = section => Array.from(document.querySelectorAll(`#sg-section-${section} .sg-summary-tile`)).map(tile => {
        const txt = sel => { const el = tile.querySelector(sel); return el ? el.textContent.trim() : ""; };
        const unit = txt(".sg-summary-tile__unit");
        const pct = txt(".sg-progress__text");
        return {
            title: txt(".sg-summary-tile__title"),
            value: unit ? `${txt(".sg-summary-tile__value")} ${unit}` : txt(".sg-summary-tile__value"),
            sub: txt(".sg-summary-tile__sub") || (pct ? `${pct} del periodo` : "")
        };
    });

    const buildExportModel = view => {
        const section = activeSection;
        const { from, to } = getPeriodRange();
        const table = section === "recorridos" ? buildRecorridosTable(view) : buildServiciosTable(view);
        return {
            section,
            viewLabel: EXPORT_VIEWS[view],
            title: REPORT_TITLES[section],
            filters: `Periodo: ${getPeriodLabel()} (${fmtDate(from)} – ${fmtDate(to)}) · Vehículos: ${$("sg-units-label").textContent}`,
            generated: `Generado el ${new Date().toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" })}`,
            kpis: view === "data" ? [] : readKpis(section),
            hasLevels: view === "extended",
            isData: view === "data",
            fileBase: `${REPORT_TITLES[section].replace(/\s+/g, "_")}_${EXPORT_VIEWS[view].replace(/\s+/g, "-")}_${localDateStr(from)}_${localDateStr(to)}`,
            ...table
        };
    };

    // ── Gráficas e indicadores dibujados en canvas ──
    // Dentro de MyGeotab no se puede capturar la página (html2canvas falla en su iframe),
    // así que las imágenes se dibujan directamente desde los datos, con el mismo aspecto
    const CV = {
        font: "Roboto, Arial, sans-serif",
        text: "#1f2833", muted: "#4e677e", border: "#c0ccd8", track: "#f2f5f7",
        bar: "#4a90d9", barSoft: "#a9cbee", line: "#748faa"
    };
    const CARD_PAD = 18, CARD_HEAD = 60, CANVAS_SCALE = 2, EXPORT_W = 1100, CARD_GAP = 16;

    const roundRect = (ctx, x, y, w, h, r) => {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    };
    const setFont = (ctx, size, color, weight = 400) => { ctx.font = `${weight} ${size}px ${CV.font}`; ctx.fillStyle = color; };
    // Recorta el texto con "…" si no cabe en el ancho
    const fitText = (ctx, text, maxW) => {
        let t = String(text == null ? "" : text);
        if (ctx.measureText(t).width <= maxW) return t;
        while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
        return t + "…";
    };

    const makeCanvas = (w, h, draw) => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * CANVAS_SCALE);
        canvas.height = Math.round(h * CANVAS_SCALE);
        const ctx = canvas.getContext("2d");
        ctx.scale(CANVAS_SCALE, CANVAS_SCALE);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.textBaseline = "middle";
        draw(ctx);
        return { canvas, w, h };
    };

    // Cada gráfica: alto de su contenido (según el ancho) y cómo dibujarlo
    const emptySpec = msg => ({
        height: () => 80,
        draw: (ctx, x, y, w, h) => { setFont(ctx, 13, CV.muted); ctx.textAlign = "center"; ctx.fillText(msg, x + w / 2, y + h / 2); }
    });

    const HBAR_ROW = 26;
    const hbarsSpec = (items, fmt) => {
        const shown = items.slice(0, CHART_MAX_ITEMS);
        const rest = items.length - shown.length;
        return {
            height: () => shown.length * HBAR_ROW + (rest > 0 ? 22 : 0),
            draw: (ctx, x0, y0, w) => {
                const max = Math.max(...shown.map(i => i.value)) || 1;
                const labelW = Math.min(150, w * 0.3), valueW = 90, gap = 16;
                const trackX = x0 + labelW + gap, trackW = w - labelW - valueW - 2 * gap;
                shown.forEach((i, idx) => {
                    const cy = y0 + idx * HBAR_ROW + HBAR_ROW / 2;
                    setFont(ctx, 12, CV.text);
                    ctx.textAlign = "left";
                    ctx.fillText(fitText(ctx, i.name, labelW), x0, cy);
                    roundRect(ctx, trackX, cy - 4, trackW, 8, 2);
                    ctx.fillStyle = CV.track;
                    ctx.fill();
                    roundRect(ctx, trackX, cy - 4, Math.max(2, trackW * i.value / max), 8, 2);
                    ctx.fillStyle = CV.bar;
                    ctx.fill();
                    setFont(ctx, 12, CV.text);
                    ctx.textAlign = "right";
                    ctx.fillText(fmt(i.value), x0 + w, cy);
                });
                if (rest > 0) {
                    setFont(ctx, 12, CV.muted);
                    ctx.textAlign = "left";
                    ctx.fillText(`+${rest} vehículos más`, x0, y0 + shown.length * HBAR_ROW + 11);
                }
            }
        };
    };

    const donutSpec = () => {
        const all = shareItems();
        const total = fleetTotals().dist;
        if (!all.length || total <= 0) return emptySpec(EMPTY_MSG.share);
        const items = groupShare(all);
        const grouped = items.length < all.length;
        const R = 64, ROW = 22;
        const legendH = items.length * ROW + (grouped ? ROW : 0);
        return {
            height: () => Math.max(2 * R, legendH),
            draw: (ctx, x0, y0, w, h) => {
                const legendW = 210, gap = 32;
                const bx = x0 + Math.max(0, (w - (2 * R + gap + legendW)) / 2);
                const cx = bx + R, cy = y0 + h / 2;
                let angle = -Math.PI / 2;
                ctx.lineWidth = 20;
                items.forEach((i, idx) => {
                    const sweep = i.value / total * Math.PI * 2;
                    const g = items.length > 1 && sweep > 0.05 ? 0.025 : 0;
                    ctx.beginPath();
                    ctx.arc(cx, cy, R - 10, angle, angle + sweep - g);
                    ctx.strokeStyle = DONUT_COLORS[idx];
                    ctx.stroke();
                    angle += sweep;
                });
                ctx.textAlign = "center";
                setFont(ctx, 18, CV.text);
                ctx.fillText(fmtNum(total, 0), cx, cy - 7);
                setFont(ctx, 11, CV.muted);
                ctx.fillText("km totales", cx, cy + 12);

                const lx = bx + 2 * R + gap;
                let ly = cy - legendH / 2 + ROW / 2;
                items.forEach((i, idx) => {
                    ctx.fillStyle = DONUT_COLORS[idx];
                    roundRect(ctx, lx, ly - 4, 8, 8, 2);
                    ctx.fill();
                    setFont(ctx, 12, CV.text);
                    ctx.textAlign = "left";
                    ctx.fillText(fitText(ctx, shortName(i.name), legendW - 70), lx + 18, ly);
                    setFont(ctx, 12, CV.muted);
                    ctx.textAlign = "right";
                    ctx.fillText(`${fmtNum(i.value / total * 100, 1)}%`, lx + legendW, ly);
                    ly += ROW;
                });
                if (grouped) {
                    setFont(ctx, 12, CV.muted);
                    ctx.textAlign = "left";
                    ctx.fillText(`${all.length} vehículos en total`, lx, ly);
                }
            }
        };
    };

    const vbarsSpec = () => {
        const items = speedItems().slice(0, CHART_MAX_ITEMS);
        if (!items.length) return emptySpec(EMPTY_MSG.speed);
        const avg = fleetAvgSpeed();
        const PLOT_H = 208;
        return {
            height: () => PLOT_H + 26,
            draw: (ctx, x0, y0, w) => {
                const baseY = y0 + PLOT_H;
                const max = Math.max(avg, ...items.map(i => i.value)) * 1.2 || 1;
                const slot = w / items.length;
                items.forEach((i, idx) => {
                    const bw = Math.min(slot * 0.6, 52);
                    const bx = x0 + idx * slot + (slot - bw) / 2;
                    const bh = PLOT_H * i.value / max;
                    roundRect(ctx, bx, baseY - bh, bw, bh, 2);
                    ctx.fillStyle = CV.barSoft;
                    ctx.fill();
                    ctx.textAlign = "center";
                    setFont(ctx, 11, CV.text);
                    ctx.fillText(fmtNum(i.value, 1), bx + bw / 2, baseY - bh - 10);
                    setFont(ctx, 11, CV.muted);
                    ctx.fillText(fitText(ctx, shortName(i.name), slot - 8), x0 + idx * slot + slot / 2, baseY + 16);
                });
                ctx.strokeStyle = CV.border;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x0, baseY + 0.5);
                ctx.lineTo(x0 + w, baseY + 0.5);
                ctx.stroke();

                // Línea punteada del promedio de la flota
                const ay = Math.round(baseY - PLOT_H * avg / max) + 0.5;
                ctx.setLineDash([4, 3]);
                ctx.strokeStyle = CV.line;
                ctx.beginPath();
                ctx.moveTo(x0, ay);
                ctx.lineTo(x0 + w, ay);
                ctx.stroke();
                ctx.setLineDash([]);
                // Leyenda del promedio arriba a la derecha (no tapa los valores de las barras)
                const label = `Promedio ${fmtNum(avg, 1)} km/h`;
                setFont(ctx, 11, CV.muted);
                ctx.textAlign = "right";
                ctx.fillText(label, x0 + w, y0 + 6);
                const sx = x0 + w - ctx.measureText(label).width - 30;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(sx, y0 + 6.5);
                ctx.lineTo(sx + 22, y0 + 6.5);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        };
    };

    const chartSpec = key => {
        if (key === "perf") { const items = perfItems(); return items.length ? hbarsSpec(items, PERF_METRICS[perfMetric].fmt) : emptySpec(EMPTY_MSG.perf); }
        if (key === "fuel") { const items = fuelItems(); return items.length ? hbarsSpec(items, v => `${fmtNum(v, 1)} km/L`) : emptySpec(EMPTY_MSG.fuel); }
        if (key === "share") return donutSpec();
        return vbarsSpec();
    };

    // Tarjetas de gráficas en el orden y tamaño de la pantalla; las que van en par comparten alto
    const buildChartImages = () => {
        const cards = Object.keys(CHARTS).map(key => {
            const card = $(CHARTS[key].el).closest(".sg-chart-card");
            const full = card.classList.contains("sg-chart-card--full");
            const w = full ? EXPORT_W : (EXPORT_W - CARD_GAP) / 2;
            const spec = chartSpec(key);
            return {
                full, w, spec,
                title: card.querySelector(".sg-chart-card__title").textContent,
                sub: card.querySelector(".sg-chart-card__sub").textContent,
                h: CARD_HEAD + spec.height(w - 2 * CARD_PAD) + CARD_PAD
            };
        });
        chartRows(cards).forEach(row => {
            const h = Math.max(...row.map(c => c.h));
            row.forEach(c => { c.h = h; });
        });
        return cards.map(c => ({
            full: c.full,
            ...makeCanvas(c.w, c.h, ctx => {
                roundRect(ctx, 0.5, 0.5, c.w - 1, c.h - 1, 8);
                ctx.strokeStyle = CV.border;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.textAlign = "left";
                setFont(ctx, 15, CV.text, 500);
                ctx.fillText(fitText(ctx, c.title, c.w - 2 * CARD_PAD), CARD_PAD, CARD_PAD + 10);
                setFont(ctx, 12, CV.muted);
                ctx.fillText(fitText(ctx, c.sub, c.w - 2 * CARD_PAD), CARD_PAD, CARD_PAD + 30);
                // Contenido centrado en el alto disponible (como en pantalla)
                const innerW = c.w - 2 * CARD_PAD;
                const avail = c.h - CARD_HEAD - CARD_PAD;
                const contentH = c.spec.height(innerW);
                c.spec.draw(ctx, CARD_PAD, CARD_HEAD + (avail - contentH) / 2, innerW, contentH);
            })
        }));
    };

    // Tarjetas de indicadores (para el PDF)
    const buildKpiImage = kpis => {
        const H = 84;
        const tw = (EXPORT_W - CARD_GAP * (kpis.length - 1)) / kpis.length;
        return makeCanvas(EXPORT_W, H, ctx => kpis.forEach((k, i) => {
            const x = i * (tw + CARD_GAP);
            roundRect(ctx, x + 0.5, 0.5, tw - 1, H - 1, 8);
            ctx.strokeStyle = CV.border;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.textAlign = "left";
            setFont(ctx, 12, CV.muted);
            ctx.fillText(fitText(ctx, k.title, tw - 28), x + 14, 20);
            setFont(ctx, 22, CV.text);
            ctx.fillText(fitText(ctx, k.value, tw - 28), x + 14, 46);
            setFont(ctx, 11, CV.muted);
            ctx.fillText(fitText(ctx, k.sub, tw - 28), x + 14, 70);
        }));
    };

    // Excel: PNG (nítido); PDF: JPEG, para que el archivo pese poco
    const imgPng = img => img.canvas.toDataURL("image/png");
    const imgJpeg = img => img.canvas.toDataURL("image/jpeg", 0.92);

    // Acomoda las gráficas como en pantalla: las anchas solas, las demás de dos en dos
    const chartRows = charts => {
        const rows = [];
        let pending = null;
        charts.forEach(c => {
            if (c.full) {
                if (pending) { rows.push([pending]); pending = null; }
                rows.push([c]);
            } else if (pending) {
                rows.push([pending, c]);
                pending = null;
            } else pending = c;
        });
        if (pending) rows.push([pending]);
        return rows;
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // ── Excel ──
    const XL = { text: "FF1F2833", muted: "FF4E677E", border: "FFC0CCD8", line: "FFE6EBF0", head: "FFF2F5F7", soft: "FFF9FAFB" };
    const xlFill = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

    // Reparte n columnas entre k tarjetas de indicadores
    const splitCols = (n, k) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));

    const exportExcel = (model, charts) => {
        const wb = new ExcelJS.Workbook();
        wb.creator = model.title;
        const ws = wb.addWorksheet(model.viewLabel, {
            views: [{ showGridLines: false }],
            pageSetup: { orientation: "landscape", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
            properties: { outlineProperties: { summaryBelow: false } }
        });
        const n = model.columns.length;
        ws.columns = model.columns.map(c => ({ width: c.width }));
        const thin = { style: "thin", color: { argb: XL.border } };
        let rowNo = 1;

        const textRow = (text, font, height) => {
            const row = ws.getRow(rowNo++);
            ws.mergeCells(row.number, 1, row.number, n);
            row.getCell(1).value = text;
            row.getCell(1).style = { font, alignment: { vertical: "middle" } };
            if (height) row.height = height;
        };
        textRow(model.title, { size: 16, bold: true, color: { argb: XL.text } }, 26);
        textRow(`${model.viewLabel} · ${model.filters}`, { size: 10, color: { argb: XL.muted } });
        textRow(model.generated, { size: 9, color: { argb: XL.muted } });
        rowNo++;

        // Indicadores: una tarjeta por KPI (título, valor y detalle), como en pantalla
        if (model.kpis.length) {
            const spans = splitCols(n, model.kpis.length);
            const lines = [
                { key: "title", font: { size: 9, color: { argb: XL.muted } }, height: 18 },
                { key: "value", font: { size: 16, color: { argb: XL.text } }, height: 26 },
                { key: "sub",   font: { size: 9, color: { argb: XL.muted } }, height: 18 }
            ];
            lines.forEach((line, li) => {
                const row = ws.getRow(rowNo++);
                row.height = line.height;
                let col = 1;
                model.kpis.forEach((k, ki) => {
                    const end = col + spans[ki] - 1;
                    if (end > col) ws.mergeCells(row.number, col, row.number, end);
                    for (let c = col; c <= end; c++) {
                        const border = {};
                        if (li === 0) border.top = thin;
                        if (li === lines.length - 1) border.bottom = thin;
                        if (c === col) border.left = thin;
                        if (c === end) border.right = thin;
                        row.getCell(c).style = { font: line.font, fill: xlFill(XL.soft), border, alignment: { vertical: "middle", indent: 1 } };
                    }
                    row.getCell(col).value = k[line.key];
                    col = end + 1;
                });
            });
            rowNo++;
        }

        // Gráficas como imágenes, acomodadas como en pantalla. Se anclan a columnas y filas
        // (no a píxeles) para que nunca rebasen el ancho de la tabla
        if (charts.length) {
            const colPx = model.columns.map(c => c.width * 7 + 5);
            const totalW = colPx.reduce((a, b) => a + b, 0);
            const xToCol = x => {
                let acc = 0;
                for (let i = 0; i < colPx.length; i++) {
                    if (x < acc + colPx[i]) return i + (x - acc) / colPx[i];
                    acc += colPx[i];
                }
                return colPx.length;
            };
            const ROW_PX = 20, GAP = 12;
            chartRows(charts).forEach(group => {
                const w = group.length === 2 || !group[0].full ? (totalW - GAP) / 2 : totalW;
                let maxRows = 0;
                group.forEach((img, i) => {
                    const rows = img.h * (w / img.w) / ROW_PX;
                    maxRows = Math.max(maxRows, rows);
                    const x = i * (w + GAP);
                    const id = wb.addImage({ base64: imgPng(img), extension: "png" });
                    ws.addImage(id, {
                        tl: { col: xToCol(x), row: rowNo - 1 },
                        br: { col: Math.min(n, xToCol(x + w)), row: rowNo - 1 + rows },
                        editAs: "oneCell"
                    });
                });
                rowNo += Math.ceil(maxRows + GAP / ROW_PX);
            });
            rowNo++;
        }

        // Tabla
        if (!model.isData) textRow(model.tableTitle, { size: 12, bold: true, color: { argb: XL.text } }, 22);
        const head = ws.getRow(rowNo++);
        head.height = 30;
        model.columns.forEach((c, i) => {
            const cell = head.getCell(i + 1);
            cell.value = c.header;
            cell.style = {
                font: { size: 9, bold: true, color: { argb: XL.muted } },
                fill: xlFill(XL.head),
                border: { top: thin, bottom: thin },
                alignment: { vertical: "middle", wrapText: true, horizontal: LEFT_TYPES.has(c.type) ? "left" : "right" }
            };
        });

        model.rows.forEach(r => {
            const row = ws.getRow(rowNo++);
            model.columns.forEach((c, i) => {
                const t = COL_TYPES[c.type];
                const v = r.values[i];
                const cell = row.getCell(i + 1);
                if (v === undefined) cell.value = null;
                else if (v === null) cell.value = "—";
                else cell.value = t.toXl ? t.toXl(v) : v;
                const style = {
                    font: { size: 10, bold: model.hasLevels && r.level === 0, color: { argb: r.level ? XL.muted : XL.text } },
                    border: { bottom: { style: "thin", color: { argb: XL.line } } },
                    alignment: { vertical: "middle", horizontal: LEFT_TYPES.has(c.type) ? "left" : "right", indent: i === 0 && r.level ? 2 : 0 }
                };
                if (t.xl && v !== null && v !== undefined) style.numFmt = t.xl;
                if (r.level) style.fill = xlFill(XL.soft);
                cell.style = style;
            });
            // Filas de detalle agrupadas (se pueden contraer con el botón "−" de Excel)
            if (r.level) row.outlineLevel = 1;
        });

        // Al imprimir: solo el ancho de la tabla, ajustado a una hoja de ancho
        ws.pageSetup.printArea = `A1:${ws.getColumn(n).letter}${rowNo - 1}`;

        if (model.isData) {
            ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: n } };
            ws.views = [{ state: "frozen", ySplit: head.number, showGridLines: false }];
        }

        return wb.xlsx.writeBuffer().then(buf => downloadBlob(
            new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
            `${model.fileBase}.xlsx`));
    };

    // ── PDF ──
    const exportPdf = (model, kpiImg, charts) => {
        const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const M = 32, CW = W - 2 * M, GAP = 10, BOTTOM = H - M - 12;
        let y = M;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(31, 40, 51);
        doc.text(model.title, M, y + 12);
        y += 24;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(78, 103, 126);
        doc.text(`${model.viewLabel} · ${model.filters}`, M, y + 8);
        y += 13;
        doc.text(model.generated, M, y + 8);
        y += 20;

        const ensure = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };

        // Indicadores y gráficas: capturas de lo que se ve en pantalla
        const imageRow = (group, w) => {
            let h = Math.max(...group.map(img => img.h * (w / img.w)));
            const scale = h > BOTTOM - M ? (BOTTOM - M) / h : 1;   // una imagen más alta que la hoja se reduce
            ensure(h * scale);
            group.forEach((img, i) => doc.addImage(imgJpeg(img), "JPEG", M + i * (w + GAP), y, w * scale, img.h * (w / img.w) * scale));
            y += h * scale + GAP;
        };
        if (kpiImg) imageRow([kpiImg], CW);
        chartRows(charts).forEach(group => imageRow(group, group.length === 2 || !group[0].full ? (CW - GAP) / 2 : CW));

        if (!model.isData) {
            ensure(60);
            y += 4;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(31, 40, 51);
            doc.text(model.tableTitle, M, y + 10);
            y += 18;
        }

        const align = c => LEFT_TYPES.has(c.type) ? "left" : "right";
        doc.autoTable({
            theme: "plain",
            startY: y,
            margin: { left: M, right: M, bottom: M + 12 },
            head: [model.columns.map(c => c.header)],
            body: model.rows.map(r => model.columns.map((c, i) => pdfCell(c, r.values[i]))),
            styles: {
                font: "helvetica",
                fontSize: model.columns.length > 10 ? 7 : 8.5,
                cellPadding: 4,
                textColor: [31, 40, 51],
                lineColor: [230, 235, 240],
                lineWidth: { bottom: 0.5 },
                valign: "middle"
            },
            headStyles: { fillColor: [242, 245, 247], textColor: [78, 103, 126], fontStyle: "bold" },
            didParseCell: data => {
                data.cell.styles.halign = align(model.columns[data.column.index]);
                if (data.section !== "body") return;
                const r = model.rows[data.row.index];
                if (model.hasLevels && r.level === 0) data.cell.styles.fontStyle = "bold";
                if (r.level) {
                    data.cell.styles.fillColor = [249, 250, 251];
                    data.cell.styles.textColor = [78, 103, 126];
                    if (data.column.index === 0) data.cell.styles.cellPadding = { top: 4, right: 4, bottom: 4, left: 16 };
                }
            }
        });

        const pages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= pages; p++) {
            doc.setPage(p);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(141, 164, 185);
            doc.text(`${model.title} · ${model.viewLabel}`, M, H - 16);
            doc.text(`Página ${p} de ${pages}`, W - M, H - 16, { align: "right" });
        }
        doc.save(`${model.fileBase}.pdf`);
    };

    // ── Menú y ejecución ──
    let exporting = false;

    const renderExportMenu = () => {
        $("sg-export-title").textContent = `Descargar · ${SECTION_TITLES[activeSection]}`;
        document.querySelectorAll("[data-export-desc]").forEach(el => {
            el.textContent = EXPORT_DESC[activeSection][el.getAttribute("data-export-desc")];
        });
    };

    const setExportBusy = busy => {
        exporting = busy;
        $("sg-export-trigger").disabled = busy;
        $("sg-export-label").textContent = busy ? "Generando…" : "Descargar";
    };

    const runExport = (view, format) => {
        if (exporting) return;
        closePopups();
        const loading = $("sg-loading");
        if (loadedKeys[activeSection] === null || (loading && !loading.hidden)) {
            showError("Espera a que termine de cargar la información para descargar.");
            return;
        }

        const model = buildExportModel(view);
        const visuals = view !== "data";
        const isPdf = format === "pdf";
        setExportBusy(true);

        loadLibs([isPdf ? "pdf" : "excel"])
            .then(() => {
                // En Excel los indicadores van como celdas; en PDF, como imagen de las tarjetas
                const kpiImg = isPdf && model.kpis.length ? buildKpiImage(model.kpis) : null;
                const charts = visuals && model.section === "recorridos" ? buildChartImages() : [];
                return isPdf ? exportPdf(model, kpiImg, charts) : exportExcel(model, charts);
            })
            .catch(err => {
                console.error("Error al generar la descarga:", err);
                showError(`No se pudo generar el archivo${err && err.message ? ` (${err.message})` : ""}. Intenta de nuevo.`);
            })
            .then(() => setExportBusy(false));
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

        // Descargar (Excel / PDF) de la sección activa
        $("sg-export-trigger").addEventListener("click", e => {
            e.stopPropagation();
            if (openPopupId === "sg-export") { closePopups(); return; }
            renderExportMenu();
            openPopup("sg-export");
        });
        $("sg-export-popup").addEventListener("click", e => {
            const btn = e.target.closest("[data-export-view]");
            if (btn) runExport(btn.getAttribute("data-export-view"), btn.getAttribute("data-export-format"));
        });

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
            else if (chartModalKey) closeChartModal();
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
        // Métrica de la gráfica de desempeño (en la tarjeta y en pantalla completa)
        document.querySelectorAll(".sg-perf-metric").forEach(group => group.addEventListener("click", e => {
            const btn = e.target.closest(".sg-segmented__item");
            if (!btn || btn.getAttribute("data-metric") === perfMetric) return;
            perfMetric = btn.getAttribute("data-metric");
            renderPerfChart();
        }));

        // Gráficas en pantalla completa: botón de la tarjeta o enlace "Ver todos"
        $("sg-section-recorridos").addEventListener("click", e => {
            const btn = e.target.closest("[data-chart-expand]");
            if (btn) openChartModal(btn.getAttribute("data-chart-expand"));
        });
        $("sg-chart-modal-close").addEventListener("click", closeChartModal);
        $("sg-chart-modal").addEventListener("click", e => { if (e.target.id === "sg-chart-modal") closeChartModal(); });

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
            updatePageTitle();

            if (cb) cb();
        },

        focus: function (apiObj, stateObj) {
            if (apiObj) api = apiObj;
            loadAndQuery();
        },

        blur: function () { closePopups(); closeChartModal(); }
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
