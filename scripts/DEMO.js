/**
 * ===================================================================
 * DEMO.JS — Geotab Add-In: Consulta de Datos del Objeto Trip
 * ===================================================================
 */

"use strict";

geotab.addin.demo = function () {

    // ── API & Estado ────────────────────────────────────────────
    let api;
    let units = [];
    let selectedPeriod = "month";
    let customFromDate = null;
    let customToDate   = null;

    // Pagination State for Trip Table
    let currentTripsPage = 1;
    const TRIPS_PER_PAGE = 15;
    let rawTripsList     = [];

    // ── DOM References ──────────────────────────────────────────
    const $              = id => document.getElementById(id);
    const unitSelect     = $("demo-unit-select");
    const btnConsultar   = $("demo-btn-consultar");
    const loadingOverlay = $("demo-loading");
    const errorToast     = $("demo-error-toast");
    const errorToastMsg  = $("demo-error-msg");

    // ── Helpers ─────────────────────────────────────────────────
    const showError = msg => {
        if (errorToastMsg) errorToastMsg.textContent = msg;
        if (errorToast) {
            errorToast.style.display = "flex";
            setTimeout(() => { errorToast.style.display = "none"; }, 5000);
        }
    };

    const localDateStr = d => {
        return d.getFullYear() + "-" +
            String(d.getMonth() + 1).padStart(2, "0") + "-" +
            String(d.getDate()).padStart(2, "0");
    };

    const fmtNum = (n, dec = 1) =>
        n.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

    const fmtHrs = sec => {
        if (!sec || sec <= 0) return "0h 00m";
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}h ${String(m).padStart(2, "0")}m`;
    };

    // ── Rango de fechas seleccionado ────────────────────────────
    const getSelectedRange = () => {
        const toDate   = new Date();
        const fromDate = new Date();

        if (selectedPeriod === "custom") {
            if (!customFromDate || !customToDate) return null;
            return {
                from: new Date(customFromDate + "T00:00:00"),
                to:   new Date(customToDate   + "T23:59:59")
            };
        }

        if      (selectedPeriod === "day")       { fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "week")      { const d=toDate.getDay(); fromDate.setDate(fromDate.getDate()-d+(d===0?-6:1)); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "month")     { fromDate.setDate(1); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "bimester")  { fromDate.setMonth(toDate.getMonth()-1); fromDate.setDate(1); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "trimester") { fromDate.setMonth(toDate.getMonth()-2); fromDate.setDate(1); fromDate.setHours(0,0,0,0); }
        else if (selectedPeriod === "semester")  { fromDate.setMonth(toDate.getMonth()-5); fromDate.setDate(1); fromDate.setHours(0,0,0,0); }

        toDate.setHours(23,59,59,999);
        return { from: fromDate, to: toDate };
    };

    // ── Render tabla paginada de viajes de la tabla Trip ────────
    const renderTripsTablePage = () => {
        const tbody = $("demo-tbody-trips");
        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = rawTripsList.length;
        const totalPages = Math.ceil(totalItems / TRIPS_PER_PAGE) || 1;
        if (currentTripsPage > totalPages) currentTripsPage = totalPages;

        const start    = (currentTripsPage - 1) * TRIPS_PER_PAGE;
        const end      = Math.min(start + TRIPS_PER_PAGE, totalItems);
        const pageData = rawTripsList.slice(start, end);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td colspan="8" style="text-align:center;color:var(--d-muted);padding:2rem;">No se encontraron viajes registrados para el periodo seleccionado.</td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach(trip => {
                const tripId       = trip.id || "—";
                const startDateStr = trip.start ? new Date(trip.start).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "—";
                const stopDateStr  = trip.stop  ? new Date(trip.stop).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" }) : "<span style='color:var(--d-teal);font-weight:600;'>En curso</span>";
                const distKm       = trip.distance !== undefined ? trip.distance : 0;
                const drivingSec   = trip.drivingDuration || 0;
                const idlingSec    = trip.idlingDuration  || 0;
                const stopSec      = trip.stopDuration    || 0;
                const maxSpeed     = trip.maximumSpeed    ? Math.round(trip.maximumSpeed) + " km/h" : "—";

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td style="font-family:monospace;font-size:0.78rem;color:var(--d-muted);">${tripId}</td>
                    <td class="demo-td-date">${startDateStr}</td>
                    <td class="demo-td-date">${stopDateStr}</td>
                    <td class="demo-td-dist" style="text-align:right;">${fmtNum(distKm, 1)} <span style="font-size:.7rem;color:var(--d-muted)">km</span></td>
                    <td class="demo-td-motor" style="text-align:right;">${fmtHrs(drivingSec)}</td>
                    <td class="demo-td-motor" style="text-align:right;color:#a855f7;">${fmtHrs(idlingSec)}</td>
                    <td class="demo-td-motor" style="text-align:right;color:var(--d-muted);">${fmtHrs(stopSec)}</td>
                    <td style="text-align:right;font-weight:500;">${maxSpeed}</td>`;
                tbody.appendChild(tr);
            });
        }

        const paginationEl = $("demo-trips-pagination");
        const btnPrev  = $("demo-btn-trips-prev");
        const btnNext  = $("demo-btn-trips-next");
        const pageInd  = $("demo-trips-page-indicator");
        const pInfo    = $("demo-trips-pagination-info");

        if (paginationEl) paginationEl.style.display = totalItems > 0 ? "flex" : "none";
        if (pInfo)   pInfo.textContent   = `Mostrando ${totalItems > 0 ? start + 1 : 0}–${end} de ${totalItems} registros de Trip`;
        if (pageInd) pageInd.textContent = `Página ${currentTripsPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled    = currentTripsPage <= 1;
        if (btnNext) btnNext.disabled    = currentTripsPage >= totalPages;
    };

    // ── Cargar dispositivos desde Geotab ─────────────────────────
    const loadUnits = () => {
        api.call("Get", { typeName: "Device" }, result => {
            units = result || [];
            unitSelect.innerHTML = '<option value="" disabled selected>Selecciona una unidad...</option>';
            units.sort((a,b) => a.name.localeCompare(b.name));
            units.forEach(device => {
                const opt = document.createElement("option");
                opt.value = device.id;
                opt.textContent = device.name;
                unitSelect.appendChild(opt);
            });
        }, err => {
            console.error("Error loading devices:", err);
            showError("No se pudieron cargar las unidades.");
        });
    };

    // ════════════════════════════════════════════════════════════
    // CORE: calculateMetrics -> Consulta directa a la tabla Trip
    // ════════════════════════════════════════════════════════════
    const calculateMetrics = () => {
        const deviceId = unitSelect.value;
        const range    = getSelectedRange();

        if (!deviceId) { showError("Por favor, selecciona una unidad."); return; }
        if (!range)    { showError("Por favor, selecciona un rango de fechas válido."); return; }

        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        const { from, to } = range;

        // Consulta a Geotab API para la entidad "Trip"
        api.call("Get", {
            typeName: "Trip",
            search: {
                deviceSearch: { id: deviceId },
                fromDate:     from.toISOString(),
                toDate:       to.toISOString()
            }
        }, result => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            try {
                const tripsRaw = result || [];
                
                // Eliminar duplicados si existen y ordenar por fecha de inicio descendente
                const tripsMap = new Map();
                tripsRaw.forEach(t => { if (t.id) tripsMap.set(t.id, t); });
                
                rawTripsList = Array.from(tripsMap.values());
                rawTripsList.sort((a, b) => new Date(b.start) - new Date(a.start));

                currentTripsPage = 1;
                renderTripsTablePage();

                // Actualizar subtítulo de la tabla
                const tripsTableSubEl = $("demo-trips-table-sub");
                if (tripsTableSubEl) {
                    const fmtD = d => localDateStr(d).split("-").reverse().join("/");
                    tripsTableSubEl.textContent = `${rawTripsList.length} registros de viajes encontrados del ${fmtD(from)} al ${fmtD(to)}`;
                }

                // Mostrar contenedor de resultados
                const resultContainer = $("demo-result-container");
                if (resultContainer) {
                    resultContainer.style.display = "block";
                    setTimeout(() => resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
                }

                if (window.lucide) lucide.createIcons();

            } catch (err) {
                console.error("Error procesando datos de la tabla Trip:", err);
                showError("Error al procesar los registros de viajes.");
            }
        }, err => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("Error al consultar la tabla Trip:", err);
            showError("Error de conexión con Geotab API.");
        });
    };

    // ── Lifecycle Add-In ──────────────────────────────────────────
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            // Presets de periodos
            const presetButtons = document.querySelectorAll("#demo-period-pills .demo-pill");

            presetButtons.forEach(btn => {
                btn.addEventListener("click", function () {
                    const period = this.getAttribute("data-period");

                    if (this.id === "demo-btn-custom" || !period) {
                        const modal = $("demo-modal");
                        if (modal) {
                            const today  = new Date().toISOString().split("T")[0];
                            const fromEl = $("demo-modal-from");
                            const toEl   = $("demo-modal-to");
                            if (fromEl && !fromEl.value) fromEl.value = today;
                            if (toEl   && !toEl.value)   toEl.value   = today;
                            modal.style.display = "flex";
                            if (window.lucide) lucide.createIcons();
                        }
                        return;
                    }

                    presetButtons.forEach(b => b.classList.remove("active"));
                    this.classList.add("active");
                    selectedPeriod = period;

                    calculateMetrics();
                });
            });

            if (btnConsultar) btnConsultar.addEventListener("click", calculateMetrics);

            // Modal Rango Personalizado
            const modal       = $("demo-modal");
            const modalClose  = $("demo-modal-close");
            const modalCancel = $("demo-modal-cancel");
            const modalApply  = $("demo-modal-apply");

            const closeModal = () => { if (modal) modal.style.display = "none"; };
            if (modalClose)  modalClose.addEventListener("click",  closeModal);
            if (modalCancel) modalCancel.addEventListener("click", closeModal);
            if (modal) modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

            if (modalApply) {
                modalApply.addEventListener("click", () => {
                    const fromVal = $("demo-modal-from").value;
                    const toVal   = $("demo-modal-to").value;
                    if (!fromVal || !toVal) { showError("Por favor, selecciona ambas fechas."); return; }
                    if (fromVal > toVal)    { showError("La fecha inicio no puede ser mayor que la fecha fin."); return; }

                    customFromDate = fromVal;
                    customToDate   = toVal;
                    selectedPeriod = "custom";

                    presetButtons.forEach(b => b.classList.remove("active"));
                    const btnCustom = $("demo-btn-custom");
                    if (btnCustom) btnCustom.classList.add("active");

                    closeModal();
                    calculateMetrics();
                });
            }

            // Paginación de viajes (Trip)
            const btnTripsPrev = $("demo-btn-trips-prev");
            const btnTripsNext = $("demo-btn-trips-next");

            if (btnTripsPrev) btnTripsPrev.addEventListener("click", () => {
                if (currentTripsPage > 1) { currentTripsPage--; renderTripsTablePage(); }
            });

            if (btnTripsNext) btnTripsNext.addEventListener("click", () => {
                const totalPages = Math.ceil(rawTripsList.length / TRIPS_PER_PAGE);
                if (currentTripsPage < totalPages) { currentTripsPage++; renderTripsTablePage(); }
            });

            if (window.lucide) lucide.createIcons();

            loadUnits();

            callback();
        },

        focus: function (_api, state) {
            api = _api;
            loadUnits();
        },

        blur: function () {}
    };

};
