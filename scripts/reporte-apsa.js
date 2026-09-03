/**
 * ===================================================================
 * REPORTE-APSA.JS — Inventario de Vehículos (Geotab Add-In)
 * ===================================================================
 * Extrae y presenta en tabla:
 * 1. Nombre del vehículo (device.name)
 * 2. Placa (device.licensePlate)
 * 3. Número de serie del carro / VIN (device.vehicleIdentificationNumber / device.vin)
 * 4. IMEI / Serie del GPS (device.serialNumber)
 * ===================================================================
 */

"use strict";

(function () {
    // ── Estado Global ────────────────────────────────────────────
    let geotabApi = null;
    let rawDevices = [];
    let filteredDevices = [];
    let currentPage = 1;
    const ITEMS_PER_PAGE = 15;

    // ── Helper DOM selector ──────────────────────────────────────
    const $ = id => document.getElementById(id);

    // ── Muestras de datos Demo (Standalone mode) ─────────────────
    const MOCK_DEVICES = [
        { id: "b1", name: "Camión APSA-01", licensePlate: "TRK-9821", vehicleIdentificationNumber: "3AKJHHDR5LS982101", serialNumber: "G90123456789" },
        { id: "b2", name: "Camión APSA-02", licensePlate: "TRK-9822", vehicleIdentificationNumber: "3AKJHHDR5LS982102", serialNumber: "G90123456790" },
        { id: "b3", name: "PickUp Sup 01", licensePlate: "PKP-4410", vehicleIdentificationNumber: "1FTFW1ED4MFA44103", serialNumber: "G90123456791" },
        { id: "b4", name: "PickUp Sup 02", licensePlate: "PKP-4411", vehicleIdentificationNumber: "1FTFW1ED4MFA44104", serialNumber: "G90123456792" },
        { id: "b5", name: "Tractor APSA-10", licensePlate: "TT-7701", vehicleIdentificationNumber: "1XPDD49X5MD770105", serialNumber: "G90123456793" },
        { id: "b6", name: "Tractor APSA-11", licensePlate: "TT-7702", vehicleIdentificationNumber: "1XPDD49X5MD770106", serialNumber: "G90123456794" },
        { id: "b7", name: "Furgón Entrega 01", licensePlate: "FRG-1205", vehicleIdentificationNumber: "3FA6P0H78KR120507", serialNumber: "G90123456795" },
        { id: "b8", name: "Furgón Entrega 02", licensePlate: "FRG-1206", vehicleIdentificationNumber: "3FA6P0H78KR120508", serialNumber: "G90123456796" },
        { id: "b9", name: "Utilitario 01", licensePlate: "UTL-3390", vehicleIdentificationNumber: "NM0ER4E21LT339009", serialNumber: "G90123456797" },
        { id: "b10", name: "Utilitario 02", licensePlate: "UTL-3391", vehicleIdentificationNumber: "NM0ER4E21LT339010", serialNumber: "G90123456798" }
    ];

    // ── Notificaciones Toast ──────────────────────────────────────
    const showToast = (message, type = "success") => {
        const toast = $("apsa-toast");
        const toastMsg = $("apsa-toast-msg");
        if (!toast || !toastMsg) return;

        toastMsg.textContent = message;
        toast.className = `apsa-toast apsa-toast-${type}`;
        toast.style.display = "flex";

        setTimeout(() => {
            toast.style.display = "none";
        }, 3500);
    };

    // ── Copiar al Portapapeles ───────────────────────────────────
    window.apsaCopyText = function (text, label) {
        if (!text || text === "—") return;
        navigator.clipboard.writeText(text).then(() => {
            showToast(`${label} copiado: ${text}`);
        }).catch(err => {
            console.error("Error al copiar:", err);
            showToast("No se pudo copiar el texto", "error");
        });
    };

    // ── Mostrar / Ocultar Loading ─────────────────────────────────
    const setLoading = (isLoading, message = "Cargando vehículos de la flota...") => {
        const overlay = $("apsa-loading");
        const textEl = $("apsa-loading-text");
        if (textEl) textEl.textContent = message;
        if (overlay) overlay.style.display = isLoading ? "flex" : "none";
    };

    // ── Cargar vehículos de Geotab API ───────────────────────────
    const fetchVehicles = () => {
        setLoading(true);

        if (!geotabApi || typeof geotabApi.call !== "function") {
            // Modo de prueba Standalone / Demo
            console.warn("Geotab API no detectada. Cargando datos de prueba (Demo Mode).");
            setTimeout(() => {
                rawDevices = MOCK_DEVICES;
                filteredDevices = [...rawDevices];
                currentPage = 1;
                renderTable();
                setLoading(false);
                showToast("Modo Demo: 10 vehículos cargados");
            }, 600);
            return;
        }

        // Consulta a Geotab API para la entidad Device
        geotabApi.call("Get", {
            typeName: "Device"
        }, result => {
            setLoading(false);
            const devices = result || [];
            
            // Ordenar alfabéticamente por nombre de vehículo
            devices.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: 'base' }));

            rawDevices = devices;
            filteredDevices = [...rawDevices];
            currentPage = 1;

            renderTable();
            showToast(`${rawDevices.length} vehículos cargados correctamente`);
        }, error => {
            setLoading(false);
            console.error("Error al obtener vehículos de Geotab:", error);
            showToast("Error al obtener los vehículos de Geotab", "error");

            // Cargar datos demo de respaldo en caso de error
            rawDevices = MOCK_DEVICES;
            filteredDevices = [...rawDevices];
            currentPage = 1;
            renderTable();
        });
    };

    // ── Filtrado Local (Búsqueda rápida) ─────────────────────────
    const applySearchFilter = () => {
        const searchInput = $("apsa-search-input");
        const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

        if (!query) {
            filteredDevices = [...rawDevices];
        } else {
            filteredDevices = rawDevices.filter(dev => {
                const name = (dev.name || "").toLowerCase();
                const plate = (dev.licensePlate || "").toLowerCase();
                const vin = (dev.vehicleIdentificationNumber || dev.vin || "").toLowerCase();
                const imei = (dev.serialNumber || "").toLowerCase();

                return name.includes(query) || plate.includes(query) || vin.includes(query) || imei.includes(query);
            });
        }

        currentPage = 1;
        renderTable();
    };

    // ── Renderizar Tabla y Paginación ─────────────────────────────
    const renderTable = () => {
        const tbody = $("apsa-tbody");
        const countBadge = $("apsa-total-count");
        const pageInfo = $("apsa-page-info");
        const pageIndicator = $("apsa-page-indicator");
        const btnPrev = $("apsa-btn-prev");
        const btnNext = $("apsa-btn-next");

        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = filteredDevices.length;
        if (countBadge) countBadge.textContent = rawDevices.length;

        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);
        const pageData = filteredDevices.slice(startIndex, endIndex);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td colspan="4" class="apsa-empty-state">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;">
                        <i data-lucide="search-x" width="36" height="36" class="apsa-empty-icon"></i>
                        <span style="font-weight:600;color:var(--apsa-text);">No se encontraron vehículos</span>
                        <span style="font-size:0.8rem;">Intenta con otro término de búsqueda</span>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach(dev => {
                const name = dev.name || "Sin nombre";
                const plate = dev.licensePlate || "—";
                const vin = dev.vehicleIdentificationNumber || dev.vin || "—";
                const imei = dev.serialNumber || "—";

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>
                        <div class="apsa-td-vehicle">
                            <div class="apsa-vehicle-icon">
                                <i data-lucide="truck" width="16" height="16"></i>
                            </div>
                            <span>${escapeHtml(name)}</span>
                        </div>
                    </td>
                    <td>
                        ${plate !== "—" 
                            ? `<span class="apsa-plate-pill">${escapeHtml(plate)}</span>` 
                            : `<span style="color:var(--apsa-muted);">—</span>`}
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                            <span class="apsa-td-mono">${escapeHtml(vin)}</span>
                            ${vin !== "—" ? `<button class="apsa-copy-btn" title="Copiar VIN" onclick="apsaCopyText('${escapeHtml(vin)}', 'VIN')"><i data-lucide="copy" width="13" height="13"></i></button>` : ''}
                        </div>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                            ${imei !== "—" 
                                ? `<span class="apsa-imei-tag"><i data-lucide="cpu" width="12" height="12"></i> ${escapeHtml(imei)}</span>
                                   <button class="apsa-copy-btn" title="Copiar IMEI" onclick="apsaCopyText('${escapeHtml(imei)}', 'IMEI')"><i data-lucide="copy" width="13" height="13"></i></button>`
                                : `<span style="color:var(--apsa-muted);">—</span>`}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        // Paginación UI
        if (pageInfo) pageInfo.textContent = `Mostrando ${totalItems > 0 ? startIndex + 1 : 0}–${endIndex} de ${totalItems} vehículos`;
        if (pageIndicator) pageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled = currentPage <= 1;
        if (btnNext) btnNext.disabled = currentPage >= totalPages;

        if (window.lucide) lucide.createIcons();
    };

    // Helper sanitizado HTML
    const escapeHtml = str => {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // ── Exportación a CSV / Excel ─────────────────────────────────
    const exportToCSV = () => {
        if (filteredDevices.length === 0) {
            showToast("No hay datos para exportar", "error");
            return;
        }

        const headers = ["Nombre de Vehículo", "Placa", "Número de Serie Carro (VIN)", "IMEI del GPS"];
        const rows = filteredDevices.map(dev => [
            `"${(dev.name || "").replace(/"/g, '""')}"`,
            `"${(dev.licensePlate || "").replace(/"/g, '""')}"`,
            `"${(dev.vehicleIdentificationNumber || dev.vin || "").replace(/"/g, '""')}"`,
            `"${(dev.serialNumber || "").replace(/"/g, '""')}"`
        ]);

        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const dateStr = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.setAttribute("download", `Reporte_APSA_Vehiculos_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast("Reporte descargado en formato CSV");
    };

    // ── Event Listeners ──────────────────────────────────────────
    const initEvents = () => {
        const searchInput = $("apsa-search-input");
        const btnExport = $("apsa-btn-export");
        const btnRefresh = $("apsa-btn-refresh");
        const btnPrev = $("apsa-btn-prev");
        const btnNext = $("apsa-btn-next");

        if (searchInput) {
            searchInput.addEventListener("input", applySearchFilter);
        }

        if (btnExport) {
            btnExport.addEventListener("click", exportToCSV);
        }

        if (btnRefresh) {
            btnRefresh.addEventListener("click", () => {
                fetchVehicles();
            });
        }

        if (btnPrev) {
            btnPrev.addEventListener("click", () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderTable();
                }
            });
        }

        if (btnNext) {
            btnNext.addEventListener("click", () => {
                const totalPages = Math.ceil(filteredDevices.length / ITEMS_PER_PAGE);
                if (currentPage < totalPages) {
                    currentPage++;
                    renderTable();
                }
            });
        }
    };

    // ── Geotab Add-In Contract Lifecycle ─────────────────────────
    const createAddinHandler = () => {
        return function (api, state, callback) {
            geotabApi = api;
            initEvents();
            fetchVehicles();
            if (typeof callback === "function") callback();

            return {
                initialize: function (_api, _state, _callback) {
                    geotabApi = _api;
                    initEvents();
                    fetchVehicles();
                    if (typeof _callback === "function") _callback();
                },
                focus: function (_api, _state) {
                    geotabApi = _api;
                    fetchVehicles();
                },
                blur: function () {}
            };
        };
    };

    // Registrar en namespace geotab.addin
    if (typeof window.geotab === "undefined") window.geotab = { addin: {} };
    if (!window.geotab.addin) window.geotab.addin = {};

    window.geotab.addin["reporte-apsa"] = createAddinHandler();
    window.geotab.addin.reporteApsa = window.geotab.addin["reporte-apsa"];
    window.geotab.addin.reporte_apsa = window.geotab.addin["reporte-apsa"];

    // ── Ejecución Autónoma (si no está dentro del iframe de Geotab) ──
    document.addEventListener("DOMContentLoaded", () => {
        // Inicialización inmediata para vista aislada o desarrollo local
        initEvents();

        // Si transcurren 800ms y no hay llamada desde Geotab, cargar modo standalone
        setTimeout(() => {
            if (rawDevices.length === 0) {
                fetchVehicles();
            }
        }, 300);
    });

})();
