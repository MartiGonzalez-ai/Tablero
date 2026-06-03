/*
 * ═══════════════════════════════════════════════════════════════
 * PARO_MOTOR.JS — Engine Shutdown / Immobilization Add-In
 * Geotab Add-In | geotab.addin.paro_motor
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

window.geotab = window.geotab || {};
geotab.addin = geotab.addin || {};

geotab.addin.paro_motor = (function () {
    // ─── State ───────────────────────────────────────────────────
    let api = null;
    let isInitialized = false;
    let isDemoMode = false;
    let allDevices = [];
    let filteredDevices = [];
    let selectedDevice = null;
    let selectedDeviceStatus = null;  // Latest DeviceStatus
    let engineState = "unknown";      // "running" | "stopped" | "unknown"
    let pendingAction = null;         // "stop" | "start"

    // ─── Audit Log ───────────────────────────────────────────────
    const auditLog = [];

    // ─── Geotab TextMessage type for engine commands ──────────────
    // Geotab uses TextMessage with IoxOutputContent to control outputs
    // For IOX-RELAY (engine immobilizer), the standard approach is:
    //   typeName: "TextMessage" with contentType: "IoxOutput"
    // Some installations use different methods — we support both
    const ENGINE_STOP_TEXT = "1";   // Relay ON → engine off
    const ENGINE_START_TEXT = "0";  // Relay OFF → engine on

    // ─── Helpers ─────────────────────────────────────────────────
    const formatTimeShort = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    };

    const formatDatetime = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleString("es-MX", {
            day: "2-digit", month: "short",
            hour: "2-digit", minute: "2-digit"
        });
    };

    const formatOdo = (meters) => {
        if (meters === null || meters === undefined) return "—";
        return Math.round(meters / 1000).toLocaleString("es-MX") + " km";
    };

    const formatSpeed = (ms) => {
        if (ms === null || ms === undefined) return "—";
        return Math.round(ms * 3.6) + " km/h";
    };

    // ─── Toast system ────────────────────────────────────────────
    const showToast = (msg, type = "info", duration = 4500) => {
        const container = document.getElementById("toast-container");
        if (!container) return;

        const icons = {
            success: "check-circle",
            error: "x-circle",
            warning: "alert-triangle",
            info: "info"
        };

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i data-lucide="${icons[type] || "info"}" width="18" height="18" stroke-width="2.5"></i>
            <span>${msg}</span>
        `;
        container.appendChild(toast);

        if (window.lucide) lucide.createIcons();

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(60px)";
            toast.style.transition = "all 0.3s ease";
            setTimeout(() => toast.remove(), 320);
        }, duration);
    };

    // ─── Audit log ───────────────────────────────────────────────
    const addAuditEntry = (msg, type = "info", unitName = null) => {
        const entry = { msg, type, unitName, time: new Date() };
        auditLog.unshift(entry);

        const list = document.getElementById("audit-list");
        const emptyEl = document.getElementById("audit-empty");
        if (!list) return;

        if (emptyEl) emptyEl.remove();

        const li = document.createElement("li");
        li.className = "audit-item";
        li.innerHTML = `
            <div class="audit-dot ${type}"></div>
            <div class="audit-content">
                <div class="audit-msg">${msg}</div>
                <div class="audit-time">${formatDatetime(entry.time.toISOString())}</div>
            </div>
            ${unitName ? `<span class="audit-unit">${unitName}</span>` : ""}
        `;

        list.prepend(li);

        // Keep max 20 entries
        const items = list.querySelectorAll(".audit-item");
        if (items.length > 20) items[items.length - 1].remove();
    };

    // ─── Render vehicle list ──────────────────────────────────────
    const renderVehicleList = (devices) => {
        const list = document.getElementById("vehicle-list");
        const countEl = document.getElementById("vehicle-count");
        if (!list) return;

        filteredDevices = devices;
        if (countEl) countEl.textContent = devices.length;

        list.innerHTML = "";

        if (devices.length === 0) {
            list.innerHTML = `<li class="vehicle-empty">Sin vehículos disponibles</li>`;
            return;
        }

        devices.forEach(device => {
            const li = document.createElement("li");
            li.className = "vehicle-item" + (selectedDevice && selectedDevice.id === device.id ? " selected" : "");
            li.dataset.id = device.id;

            const dotClass = device._online
                ? "online"
                : (device._engineStopped ? "stopped" : "offline");

            li.innerHTML = `
                <div class="vehicle-status-dot ${dotClass}"></div>
                <div class="vehicle-info">
                    <div class="vehicle-name">${device.name || device.id}</div>
                    <div class="vehicle-meta">${device.serialNumber || device.id}</div>
                </div>
                <div class="vehicle-arrow">
                    <i data-lucide="chevron-right" width="16" height="16" stroke-width="2.5"></i>
                </div>
            `;

            li.addEventListener("click", () => selectDevice(device));
            list.appendChild(li);
        });

        if (window.lucide) lucide.createIcons();
    };

    // ─── Select device ────────────────────────────────────────────
    const selectDevice = (device) => {
        selectedDevice = device;
        engineState = "unknown";

        // Highlight in list
        document.querySelectorAll(".vehicle-item").forEach(el => {
            el.classList.toggle("selected", el.dataset.id === device.id);
        });

        // Show panels
        document.getElementById("empty-state").style.display = "none";
        document.getElementById("vehicle-detail-card").style.display = "block";
        document.getElementById("engine-control-panel").style.display = "block";
        document.getElementById("audit-panel").style.display = "block";

        // Populate basic info
        document.getElementById("vdc-name").textContent = device.name || device.id;
        document.getElementById("vdc-id").textContent = `ID: ${device.id}`;
        document.getElementById("engine-current-state").textContent = "Cargando...";

        // Reset stats
        document.getElementById("vdc-speed").textContent = "—";
        document.getElementById("vdc-odometer").textContent = "—";
        document.getElementById("vdc-last-signal").textContent = "—";

        setEngineState("unknown");
        addAuditEntry(`Unidad seleccionada: ${device.name || device.id}`, "info", device.name);

        // Load live status
        loadDeviceStatus(device);
    };

    // ─── Set engine button state ──────────────────────────────────
    const setEngineState = (state) => {
        engineState = state;

        const btnOuter = document.getElementById("engine-btn-outer");
        const btnInner = document.getElementById("engine-main-btn");
        const btnLabel = document.getElementById("engine-btn-label");
        const btnSub = document.getElementById("engine-btn-sub");
        const stateEl = document.getElementById("engine-current-state");
        const statusBadge = document.getElementById("vdc-status-badge");
        const statusText = document.getElementById("vdc-status-text");

        if (!btnOuter || !btnInner) return;

        // Remove all state classes
        btnOuter.classList.remove("btn-stop", "btn-start", "pulsing");
        btnInner.classList.remove("stop-btn", "start-btn", "loading-btn");
        btnInner.disabled = false;

        if (state === "running") {
            // Engine is ON → offer STOP
            btnOuter.classList.add("btn-stop", "pulsing");
            btnInner.classList.add("stop-btn");
            btnInner.innerHTML = `
                <i data-lucide="power" width="40" height="40" stroke="#fff" stroke-width="2"></i>
                <span class="engine-btn-label">PARO</span>
                <span class="engine-btn-sub">Activar Inmovilización</span>
            `;
            if (stateEl) { stateEl.textContent = "Motor Encendido ✓"; stateEl.style.color = "#15803d"; }
            if (statusBadge) { statusBadge.className = "vdc-status-badge active-engine"; statusText.textContent = "En marcha"; }

        } else if (state === "stopped") {
            // Engine is OFF → offer RESTART
            btnOuter.classList.add("btn-start");
            btnInner.classList.add("start-btn");
            btnInner.innerHTML = `
                <i data-lucide="power" width="40" height="40" stroke="#fff" stroke-width="2"></i>
                <span class="engine-btn-label">REANUDAR</span>
                <span class="engine-btn-sub">Desbloquear Motor</span>
            `;
            if (stateEl) { stateEl.textContent = "Motor Detenido ✗"; stateEl.style.color = "#cc0000"; }
            if (statusBadge) { statusBadge.className = "vdc-status-badge engine-off"; statusText.textContent = "Inmovilizado"; }

        } else {
            // Unknown
            btnOuter.classList.add("btn-stop");
            btnInner.classList.add("stop-btn");
            btnInner.innerHTML = `
                <i data-lucide="power" width="40" height="40" stroke="#fff" stroke-width="2"></i>
                <span class="engine-btn-label">PARO</span>
                <span class="engine-btn-sub">Activar Inmovilización</span>
            `;
            if (stateEl) { stateEl.textContent = "Estado Desconocido"; stateEl.style.color = "#64748b"; }
            if (statusBadge) { statusBadge.className = "vdc-status-badge unknown"; statusText.textContent = "Desconocido"; }
        }

        // Enable check status button
        const btnCheck = document.getElementById("btn-check-status");
        if (btnCheck) btnCheck.disabled = false;

        if (window.lucide) lucide.createIcons();
    };

    // ─── Show loading on button ───────────────────────────────────
    const setEngineButtonLoading = (isLoading) => {
        const btnOuter = document.getElementById("engine-btn-outer");
        const btnInner = document.getElementById("engine-main-btn");
        if (!btnInner) return;

        if (isLoading) {
            btnOuter.classList.add("disabled");
            btnInner.classList.remove("stop-btn", "start-btn");
            btnInner.classList.add("loading-btn");
            btnInner.disabled = true;
            btnInner.innerHTML = `
                <div class="engine-spinner"></div>
                <span class="engine-btn-label">ENVIANDO...</span>
                <span class="engine-btn-sub">Aguarda un momento</span>
            `;
        } else {
            btnOuter.classList.remove("disabled");
            setEngineState(engineState);
        }
    };

    // ─── Load device status ───────────────────────────────────────
    const loadDeviceStatus = (device) => {
        if (isDemoMode) {
            // Simulate demo data
            setTimeout(() => {
                const mockStatus = {
                    speed: 0,
                    odometer: 145823,
                    dateTime: new Date(Date.now() - 60000).toISOString(),
                    isDeviceCommunicating: true,
                    engineIsOn: true,
                };
                applyDeviceStatus(mockStatus);
            }, 400);
            return;
        }

        if (!api || !device) return;

        // Get latest DeviceStatus
        api.call("Get", {
            typeName: "DeviceStatusInfo",
            search: {
                deviceSearch: { id: device.id }
            }
        }, (results) => {
            if (results && results.length > 0) {
                const status = results[0];
                selectedDeviceStatus = status;
                applyDeviceStatus(status);
            } else {
                setEngineState("unknown");
                showToast("No se pudo obtener el estado en tiempo real.", "warning");
            }
        }, (err) => {
            console.error("Error cargando DeviceStatusInfo:", err);
            setEngineState("unknown");
            showToast("Error al consultar el estado del vehículo.", "error");
        });
    };

    // ─── Apply status data to UI ──────────────────────────────────
    const applyDeviceStatus = (status) => {
        const speedEl = document.getElementById("vdc-speed");
        const odoEl = document.getElementById("vdc-odometer");
        const signalEl = document.getElementById("vdc-last-signal");
        const signalSubEl = document.getElementById("vdc-last-signal-sub");

        if (speedEl) speedEl.textContent = formatSpeed(status.speed);
        if (odoEl) odoEl.textContent = formatOdo(status.odometer);
        if (signalEl) signalEl.textContent = formatTimeShort(status.dateTime);
        if (signalSubEl) {
            const comm = status.isDeviceCommunicating;
            signalSubEl.textContent = comm ? "Comunicando" : "Sin señal";
            signalSubEl.style.color = comm ? "#15803d" : "#cc0000";
        }

        // Determine engine state from status
        if (status.engineIsOn === true) {
            setEngineState("running");
        } else if (status.engineIsOn === false) {
            setEngineState("stopped");
        } else {
            // Fall back to speed check
            const speed = status.speed || 0;
            setEngineState(speed > 0 ? "running" : "unknown");
        }
    };

    // ─── Open confirm modal ───────────────────────────────────────
    const openConfirmModal = (action) => {
        if (!selectedDevice) return;
        pendingAction = action;

        const modal = document.getElementById("confirm-modal");
        const titleEl = document.getElementById("modal-title");
        const subtitleEl = document.getElementById("modal-subtitle");
        const labelEl = document.getElementById("modal-confirm-label");
        const hintEl = document.getElementById("modal-hint");
        const confirmBtn = document.getElementById("modal-confirm-btn");
        const input = document.getElementById("modal-confirm-input");
        const iconWrap = document.getElementById("modal-icon-wrap");

        document.getElementById("modal-vehicle-name").textContent = selectedDevice.name || selectedDevice.id;
        document.getElementById("modal-vehicle-id").textContent = `ID: ${selectedDevice.id}`;

        if (action === "stop") {
            titleEl.textContent = "Confirmar Paro de Motor";
            subtitleEl.textContent = "Esta acción detendrá el encendido del vehículo.";
            labelEl.innerHTML = `Escribe <strong>"PARO"</strong> para confirmar:`;
            hintEl.textContent = "El motor quedará inmovilizado hasta recibir la orden de reanudación.";
            confirmBtn.className = "btn-modal-confirm danger-confirm";
            confirmBtn.textContent = "Ejecutar Paro";
            iconWrap.className = "modal-header-icon danger";
            iconWrap.innerHTML = `<i data-lucide="alert-octagon" width="26" height="26" stroke="#cc0000" stroke-width="2.5"></i>`;
            input.className = "modal-confirm-input";
            input.placeholder = `Escribe PARO...`;
        } else {
            titleEl.textContent = "Confirmar Reanudación de Motor";
            subtitleEl.textContent = "Esta acción habilitará el encendido del vehículo.";
            labelEl.innerHTML = `Escribe <strong>"INICIAR"</strong> para confirmar:`;
            hintEl.textContent = "El conductor podrá encender el motor nuevamente.";
            confirmBtn.className = "btn-modal-confirm success-confirm";
            confirmBtn.textContent = "Reanudar Motor";
            iconWrap.className = "modal-header-icon success";
            iconWrap.innerHTML = `<i data-lucide="check-circle" width="26" height="26" stroke="#15803d" stroke-width="2.5"></i>`;
            input.className = "modal-confirm-input success-input";
            input.placeholder = `Escribe INICIAR...`;
        }

        input.value = "";
        confirmBtn.disabled = true;

        // Listen to input
        input.oninput = () => {
            const expected = action === "stop" ? "PARO" : "INICIAR";
            confirmBtn.disabled = input.value.trim().toUpperCase() !== expected;
        };

        modal.classList.add("open");
        if (window.lucide) lucide.createIcons();

        setTimeout(() => input.focus(), 100);
    };

    // ─── Close modal ──────────────────────────────────────────────
    const closeConfirmModal = () => {
        const modal = document.getElementById("confirm-modal");
        const input = document.getElementById("modal-confirm-input");
        if (modal) modal.classList.remove("open");
        if (input) input.value = "";
        pendingAction = null;
    };

    // ─── Execute engine command ───────────────────────────────────
    const executeEngineCommand = () => {
        if (!pendingAction || !selectedDevice) return;
        const action = pendingAction;
        closeConfirmModal();
        setEngineButtonLoading(true);

        const deviceName = selectedDevice.name || selectedDevice.id;

        if (isDemoMode) {
            // Simulate in demo mode
            setTimeout(() => {
                setEngineButtonLoading(false);
                if (action === "stop") {
                    setEngineState("stopped");
                    showToast(`✓ Paro de motor activado en ${deviceName}`, "success");
                    addAuditEntry(`Paro de motor ejecutado`, "stop", deviceName);
                } else {
                    setEngineState("running");
                    showToast(`✓ Motor reanudado en ${deviceName}`, "success");
                    addAuditEntry(`Motor reanudado (inmovilización eliminada)`, "start", deviceName);
                }
            }, 2000);
            return;
        }

        // Real Geotab API call
        // Method: Send a TextMessage with IoxOutputContent to control the relay
        const relayState = action === "stop" ? ENGINE_STOP_TEXT : ENGINE_START_TEXT;

        const textMessage = {
            device: { id: selectedDevice.id },
            messageContent: {
                contentType: "IoxOutput",
                isRawData: false,
                channel: 1,       // Channel 1 = Engine relay
                data: relayState
            },
            isDirectionToVehicle: true,
            messageContentType: "IoxOutput"
        };

        api.call("Add", {
            typeName: "TextMessage",
            entity: textMessage
        }, (result) => {
            setEngineButtonLoading(false);

            if (action === "stop") {
                setEngineState("stopped");
                showToast(`✓ Paro de motor activado en ${deviceName}`, "success", 5000);
                addAuditEntry(`Paro de motor ejecutado — ID mensaje: ${result || "OK"}`, "stop", deviceName);
            } else {
                setEngineState("running");
                showToast(`✓ Motor reanudado en ${deviceName}`, "success", 5000);
                addAuditEntry(`Motor reanudado (inmovilización eliminada) — ID: ${result || "OK"}`, "start", deviceName);
            }
        }, (err) => {
            setEngineButtonLoading(false);
            console.error("Error al enviar comando de motor:", err);

            const errMsg = (err && err.message) ? err.message : String(err);
            showToast(`Error al enviar comando: ${errMsg}`, "error", 7000);
            addAuditEntry(`Error al ejecutar comando — ${errMsg}`, "error", deviceName);

            // Try fallback method: using "Set" on DeviceShareGroup or relay
            tryFallbackCommand(action, deviceName);
        });
    };

    // ─── Fallback: TextMessage via direct approach ─────────────────
    const tryFallbackCommand = (action, deviceName) => {
        if (!selectedDevice || isDemoMode) return;

        // Some Geotab installations use different payload structures.
        // This is a secondary attempt with alternate content structure.
        const fallbackMsg = {
            device: { id: selectedDevice.id },
            messageContent: {
                contentType: "Normal",
                message: action === "stop" ? "PARO" : "INICIAR"
            },
            isDirectionToVehicle: true
        };

        api.call("Add", {
            typeName: "TextMessage",
            entity: fallbackMsg
        }, (result) => {
            showToast(`Comando enviado vía método alternativo`, "warning", 5000);
            addAuditEntry(`Comando ${action} enviado (método alternativo)`, action === "stop" ? "stop" : "start", deviceName);
        }, (err2) => {
            console.error("Fallback también falló:", err2);
            showToast(`No se pudo enviar el comando. Contacte al administrador.`, "error", 7000);
        });
    };

    // ─── Load all devices ─────────────────────────────────────────
    const loadDevices = () => {
        const list = document.getElementById("vehicle-list");
        if (list) {
            list.innerHTML = `
                <li class="vehicle-skeleton"></li>
                <li class="vehicle-skeleton"></li>
                <li class="vehicle-skeleton"></li>
                <li class="vehicle-skeleton"></li>
            `;
        }

        if (isDemoMode) {
            setTimeout(() => {
                const mockDevices = [
                    { id: "b1", name: "Unidad 01 — Dodge Ram 1500", serialNumber: "GT-230045", _online: true, _engineStopped: false },
                    { id: "b2", name: "Unidad 02 — Ford F-150", serialNumber: "GT-230046", _online: true, _engineStopped: false },
                    { id: "b3", name: "Unidad 03 — Chevrolet Silverado", serialNumber: "GT-230047", _online: false, _engineStopped: true },
                    { id: "b4", name: "Unidad 04 — Toyota Hilux", serialNumber: "GT-230048", _online: true, _engineStopped: false },
                    { id: "b5", name: "Unidad 05 — Nissan NP300", serialNumber: "GT-230049", _online: false, _engineStopped: false },
                    { id: "b6", name: "Unidad 06 — Volkswagen Transporter", serialNumber: "GT-230050", _online: true, _engineStopped: false },
                    { id: "b7", name: "Unidad 07 — Mercedes Sprinter", serialNumber: "GT-230051", _online: true, _engineStopped: false },
                ];
                allDevices = mockDevices;
                renderVehicleList(mockDevices);
                addAuditEntry("Vehículos cargados en modo demo", "info");
            }, 600);
            return;
        }

        if (!api) return;

        api.multiCall([
            ["Get", { typeName: "Device" }],
            ["Get", { typeName: "DeviceStatusInfo", search: {} }]
        ], (results) => {
            const devices = results[0] || [];
            const statuses = results[1] || [];

            // Build status map
            const statusMap = {};
            statuses.forEach(s => {
                if (s.device && s.device.id) {
                    statusMap[s.device.id] = s;
                }
            });

            // Enrich devices
            allDevices = devices.map(d => {
                const st = statusMap[d.id] || {};
                return {
                    ...d,
                    _online: st.isDeviceCommunicating || false,
                    _engineStopped: st.engineIsOn === false,
                    _status: st
                };
            });

            allDevices.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            renderVehicleList(allDevices);
            addAuditEntry(`${allDevices.length} unidades cargadas`, "info");
        }, (err) => {
            console.error("Error cargando dispositivos:", err);
            showToast("Error al cargar vehículos. Reintentando...", "error");
            if (list) {
                list.innerHTML = `<li class="vehicle-empty">Error al cargar. Presiona Actualizar.</li>`;
            }
        });
    };

    // ─── Search filter ────────────────────────────────────────────
    const applySearch = (query) => {
        if (!query || query.trim() === "") {
            renderVehicleList(allDevices);
            return;
        }
        const q = query.trim().toLowerCase();
        const filtered = allDevices.filter(d =>
            (d.name || "").toLowerCase().includes(q) ||
            (d.serialNumber || "").toLowerCase().includes(q) ||
            (d.id || "").toLowerCase().includes(q)
        );
        renderVehicleList(filtered);
    };

    // ─── Wire up static events ────────────────────────────────────
    const wireEvents = () => {
        // Search
        const searchInput = document.getElementById("vehicle-search-input");
        if (searchInput) {
            let searchTimer = null;
            searchInput.addEventListener("input", () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => applySearch(searchInput.value), 200);
            });
        }

        // Engine main button
        const engineBtn = document.getElementById("engine-main-btn");
        if (engineBtn) {
            engineBtn.addEventListener("click", () => {
                if (!selectedDevice) {
                    showToast("Selecciona una unidad primero.", "warning");
                    return;
                }
                const action = engineState === "stopped" ? "start" : "stop";
                openConfirmModal(action);
            });
        }

        // Modal cancel
        const cancelBtn = document.getElementById("modal-cancel-btn");
        if (cancelBtn) cancelBtn.addEventListener("click", closeConfirmModal);

        // Modal confirm
        const confirmBtn = document.getElementById("modal-confirm-btn");
        if (confirmBtn) confirmBtn.addEventListener("click", executeEngineCommand);

        // Close modal on overlay click
        const modal = document.getElementById("confirm-modal");
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) closeConfirmModal();
            });
        }

        // ESC key
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeConfirmModal();
        });

        // Check status button
        const btnCheck = document.getElementById("btn-check-status");
        if (btnCheck) {
            btnCheck.addEventListener("click", () => {
                if (!selectedDevice) return;
                btnCheck.disabled = true;
                setTimeout(() => { btnCheck.disabled = false; }, 3000);
                loadDeviceStatus(selectedDevice);
                addAuditEntry("Estado verificado manualmente", "info", selectedDevice.name);
                showToast("Consultando estado en tiempo real...", "info", 2000);
            });
        }

        // Locate button
        const btnLocate = document.getElementById("btn-locate");
        if (btnLocate) {
            btnLocate.addEventListener("click", () => {
                if (!selectedDeviceStatus) {
                    showToast("No hay datos de ubicación disponibles.", "warning");
                    return;
                }
                const lat = selectedDeviceStatus.latitude;
                const lng = selectedDeviceStatus.longitude;
                if (lat && lng) {
                    window.open(`https://maps.google.com/maps?q=${lat},${lng}&t=m&z=16`, "_blank");
                } else if (isDemoMode) {
                    window.open("https://maps.google.com/maps?q=20.967,-89.623&t=m&z=14", "_blank");
                } else {
                    showToast("Ubicación GPS no disponible para esta unidad.", "warning");
                }
            });
        }

        // Refresh button
        const btnRefresh = document.getElementById("btn-refresh");
        if (btnRefresh) {
            btnRefresh.addEventListener("click", () => {
                btnRefresh.classList.add("loading");
                btnRefresh.disabled = true;
                loadDevices();
                if (selectedDevice) loadDeviceStatus(selectedDevice);
                setTimeout(() => {
                    btnRefresh.classList.remove("loading");
                    btnRefresh.disabled = false;
                }, 1500);
            });
        }
    };

    // ─── Demo mode fallback ───────────────────────────────────────
    const activateDemoMode = () => {
        isDemoMode = true;
        const badge = document.getElementById("connection-badge");
        const text = document.getElementById("connection-text");
        if (badge) badge.classList.add("demo");
        if (text) text.textContent = "Modo Demo";

        addAuditEntry("Add-in iniciado en modo demo (standalone)", "info");
        loadDevices();
    };

    // ─── Initialize ───────────────────────────────────────────────
    const initialize = (geotabApi, state, callback) => {
        isInitialized = true;
        api = geotabApi;
        isDemoMode = false;

        const badge = document.getElementById("connection-badge");
        const text = document.getElementById("connection-text");
        if (badge) badge.classList.remove("demo");
        if (text) text.textContent = "Geotab Live";

        wireEvents();
        loadDevices();
        addAuditEntry("Add-in iniciado — Geotab Live", "info");

        if (callback) callback();
    };

    // ─── DOMContentLoaded — standalone fallback ────────────────────
    document.addEventListener("DOMContentLoaded", () => {
        if (window.lucide) lucide.createIcons();
        wireEvents();

        setTimeout(() => {
            if (!isInitialized) {
                activateDemoMode();
            }
        }, 700);
    });

    // ─── Expose add-in interface ──────────────────────────────────
    return function () {
        return {
            initialize: initialize,
            focus: function (geotabApi, state) {
                api = geotabApi;
                loadDevices();
            },
            blur: function () {
                // Cleanup if needed
            }
        };
    };
})();
