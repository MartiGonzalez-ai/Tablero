/* 
 * ═══════════════════════════════════════════════════════════════
 * ENTRADAS.JS — Fleet Control | Telemetry Inputs & Outputs
 * Geotab Add-In | geotab.addin.entradas
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

window.geotab = window.geotab || {};
geotab.addin = geotab.addin || {};

geotab.addin.entradas = (function () {

    // ── Estado global ────────────────────────────────────────────
    let api = null;
    let isDemoMode = false;
    let isInitialized = false;

    let allVehicles = [];      // [{ id, name, plate, type, speed, isMoving, ignition, activeInputsCount, activeOutputsCount }]
    let activeVehicleId = null;
    let telemetryTimer = null;
    let currentDiagnosticsData = {}; // Cache de datos diagnósticos del vehículo seleccionado

    const IO_DIAGNOSTICS = [
        "DiagnosticDeviceRelayStateId",
        "DiagnosticDigitalOutput1StateId",
        "DiagnosticDigitalOutput2StateId",
        "DiagnosticDigitalOutput3StateId",
        "DiagnosticDigitalOutput4StateId",
        "DiagnosticDigitalInput1StateId",
        "DiagnosticDigitalInput2StateId",
        "DiagnosticDigitalInput3StateId",
        "DiagnosticDigitalInput4StateId",
        "DiagnosticDigitalInput5StateId",
        "DiagnosticDigitalInput6StateId",
        "DiagnosticDigitalInput7StateId",
        "DiagnosticDigitalInput8StateId",
        "DiagnosticAux1Id",
        "DiagnosticAux2Id",
        "DiagnosticAux3Id",
        "DiagnosticAux4Id",
        "DiagnosticAux5Id",
        "DiagnosticAux6Id",
        "DiagnosticAux7Id",
        "DiagnosticAux8Id",
        "DiagnosticIgnitionId"
    ];

    const DIAG_LABELS = {
        "DiagnosticDeviceRelayStateId": { name: "Relay de Paro de Motor", type: "output", desc: "Estado del relevador de corte de marcha/motor" },
        "DiagnosticDigitalOutput1StateId": { name: "Salida Digital 1 (Cable Amarillo)", type: "output", desc: "Puerto de salida de control 1" },
        "DiagnosticDigitalOutput2StateId": { name: "Salida Digital 2", type: "output", desc: "Puerto de salida de control 2" },
        "DiagnosticDigitalOutput3StateId": { name: "Salida Digital 3", type: "output", desc: "Puerto de salida de control 3" },
        "DiagnosticDigitalOutput4StateId": { name: "Salida Digital 4", type: "output", desc: "Puerto de salida de control 4" },
        
        "DiagnosticDigitalInput1StateId": { name: "Entrada Digital 1", type: "input", desc: "Sensor digital estándar 1" },
        "DiagnosticDigitalInput2StateId": { name: "Entrada Digital 2", type: "input", desc: "Sensor digital estándar 2" },
        "DiagnosticDigitalInput3StateId": { name: "Entrada Digital 3", type: "input", desc: "Sensor digital estándar 3" },
        "DiagnosticDigitalInput4StateId": { name: "Entrada Digital 4", type: "input", desc: "Sensor digital estándar 4" },
        "DiagnosticDigitalInput5StateId": { name: "Entrada Digital 5", type: "input", desc: "Sensor digital estándar 5" },
        "DiagnosticDigitalInput6StateId": { name: "Entrada Digital 6", type: "input", desc: "Sensor digital estándar 6" },
        "DiagnosticDigitalInput7StateId": { name: "Entrada Digital 7", type: "input", desc: "Sensor digital estándar 7" },
        "DiagnosticDigitalInput8StateId": { name: "Entrada Digital 8", type: "input", desc: "Sensor digital estándar 8" },
        
        "DiagnosticAux1Id": { name: "Entrada Auxiliar 1 (Aux 1)", type: "aux", desc: "Entrada auxiliar configurable 1" },
        "DiagnosticAux2Id": { name: "Entrada Auxiliar 2 (Aux 2)", type: "aux", desc: "Entrada auxiliar configurable 2" },
        "DiagnosticAux3Id": { name: "Entrada Auxiliar 3 (Aux 3)", type: "aux", desc: "Entrada auxiliar configurable 3" },
        "DiagnosticAux4Id": { name: "Entrada Auxiliar 4 (Aux 4)", type: "aux", desc: "Entrada auxiliar configurable 4" },
        "DiagnosticAux5Id": { name: "Entrada Auxiliar 5 (Aux 5)", type: "aux", desc: "Entrada auxiliar configurable 5" },
        "DiagnosticAux6Id": { name: "Entrada Auxiliar 6 (Aux 6)", type: "aux", desc: "Entrada auxiliar configurable 6" },
        "DiagnosticAux7Id": { name: "Entrada Auxiliar 7 (Aux 7)", type: "aux", desc: "Entrada auxiliar configurable 7" },
        "DiagnosticAux8Id": { name: "Entrada Auxiliar 8 (Aux 8)", type: "aux", desc: "Entrada auxiliar configurable 8" },
        
        "DiagnosticIgnitionId": { name: "Estado de Ignición (Llave)", type: "ignition", desc: "Estado de corriente de accesorios (motor ON/OFF)" }
    };

    // ── Datos simulados para Demo ────────────────────────────────
    const MOCK_VEHICLES = [
        { id: "e101", name: "Volvo 01", plate: "YUC-001", type: "Camión", speed: 0, isMoving: false, ignition: false, activeInputsCount: 2, activeOutputsCount: 1 },
        { id: "e102", name: "Kenworth 02", plate: "YUC-022", type: "Tractocamión", speed: 74, isMoving: true, ignition: true, activeInputsCount: 1, activeOutputsCount: 0 },
        { id: "e103", name: "Ford 03", plate: "YUC-183", type: "Pickup", speed: 0, isMoving: false, ignition: false, activeInputsCount: 0, activeOutputsCount: 0 },
        { id: "e104", name: "Isuzu 04", plate: "YUC-214", type: "Caja seca", speed: 45, isMoving: true, ignition: true, activeInputsCount: 3, activeOutputsCount: 0 },
        { id: "e105", name: "Mercedes 05", plate: "YUC-300", type: "Camión", speed: 0, isMoving: false, ignition: false, activeInputsCount: 0, activeOutputsCount: 2 },
        { id: "e106", name: "RAM 06", plate: "YUC-411", type: "Pickup", speed: 0, isMoving: false, ignition: true, activeInputsCount: 1, activeOutputsCount: 1 },
    ];

    // ── Toast ────────────────────────────────────────────────────
    const toast = (msg, type = "info") => {
        const wrap = document.getElementById("toast-wrap");
        if (!wrap) return;
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        const icons = { success: "check-circle", error: "alert-octagon", info: "info" };
        el.innerHTML = `<i data-lucide="${icons[type] || "info"}" width="16" height="16"></i><span>${msg}</span>`;
        wrap.appendChild(el);
        if (window.lucide) lucide.createIcons();
        setTimeout(() => el.classList.add("show"), 10);
        setTimeout(() => { 
            el.classList.remove("show"); 
            setTimeout(() => el.remove(), 300); 
        }, 4500);
    };

    // ── KPIs del Header ──────────────────────────────────────────
    const updateKPIs = () => {
        let totalInputsActive = 0;
        let totalOutputsActive = 0;

        if (isDemoMode) {
            allVehicles.forEach(v => {
                totalInputsActive += v.activeInputsCount;
                totalOutputsActive += v.activeOutputsCount;
            });
        } else {
            // En modo real se calcula a partir de los datos en caché de las unidades si están cargados
            totalInputsActive = allVehicles.reduce((acc, v) => acc + (v.activeInputsCount || 0), 0);
            totalOutputsActive = allVehicles.reduce((acc, v) => acc + (v.activeOutputsCount || 0), 0);
        }

        const elInputs = document.getElementById("kpi-inputs-activos");
        const elOutputs = document.getElementById("kpi-outputs-activos");
        const elUnits = document.getElementById("kpi-unidades-total");

        if (elInputs) elInputs.textContent = `${totalInputsActive} activas`;
        if (elOutputs) elOutputs.textContent = `${totalOutputsActive} activos`;
        if (elUnits) elUnits.textContent = `${allVehicles.length} unidades`;
    };

    // ── Renderizar lista lateral de vehículos ─────────────────────
    const renderVehicleList = (filter = "") => {
        const listContainer = document.getElementById("vehicle-list-container");
        if (!listContainer) return;

        const q = filter.toLowerCase().trim();
        const filtered = q
            ? allVehicles.filter(v => v.name.toLowerCase().includes(q) || v.plate.toLowerCase().includes(q) || v.type.toLowerCase().includes(q))
            : allVehicles;

        if (filtered.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align:center; padding: 2rem 1rem; color:var(--text-3); font-size:0.85rem;">
                    No se encontraron unidades.
                </div>
            `;
            return;
        }

        listContainer.innerHTML = filtered.map(v => {
            const isSelected = v.id === activeVehicleId;
            let statusClass = "inactive";
            let statusLabel = "Inactivo";

            if (v.isMoving) {
                statusClass = "moving";
                statusLabel = `Moviéndose (${v.speed} km/h)`;
            } else if (v.ignition) {
                statusClass = "active";
                statusLabel = "Ignición ON";
            }

            return `
                <div class="vehicle-item${isSelected ? " selected" : ""}" data-id="${v.id}">
                    <div class="vehicle-item-header">
                        <span class="vehicle-item-name">${v.name}</span>
                        <span class="vehicle-item-plate">${v.plate}</span>
                    </div>
                    <div class="vehicle-item-footer">
                        <span class="vehicle-item-type">${v.type}</span>
                        <span class="vehicle-item-status ${statusClass}">
                            <span class="dot"></span>
                            ${statusLabel}
                        </span>
                    </div>
                </div>
            `;
        }).join("");

        // Agregar listeners
        listContainer.querySelectorAll(".vehicle-item").forEach(item => {
            item.addEventListener("click", () => {
                selectVehicle(item.dataset.id);
            });
        });
    };

    // ── Seleccionar un vehículo ──────────────────────────────────
    const selectVehicle = (deviceId) => {
        activeVehicleId = deviceId;
        
        // Actualizar selección visual en la lista lateral
        document.querySelectorAll(".vehicle-item").forEach(item => {
            item.classList.toggle("selected", item.dataset.id === deviceId);
        });

        const v = allVehicles.find(x => x.id === deviceId);
        if (!v) return;

        // Limpiar el panel derecho y mostrar loader
        const detailsContainer = document.getElementById("details-panel-container");
        if (detailsContainer) {
            detailsContainer.innerHTML = `
                <div class="loading-box">
                    <div class="spinner"></div>
                    <p style="font-size: 0.9rem; margin-top: 0.5rem;">Consultando telemetría en Geotab...</p>
                </div>
            `;
        }

        // Consultar los diagnósticos I/O del vehículo
        fetchVehicleDiagnostics(deviceId);
    };

    // ── Consultar diagnósticos I/O del vehículo ──────────────────
    const fetchVehicleDiagnostics = (deviceId) => {
        if (isDemoMode) {
            // Simulador de demora celular
            setTimeout(() => {
                if (activeVehicleId !== deviceId) return;

                // Generar datos aleatorios consistentes con el estado del vehículo
                const v = allVehicles.find(x => x.id === deviceId);
                const mockResults = {};
                let inputsActive = 0;
                let outputsActive = 0;

                IO_DIAGNOSTICS.forEach(diagId => {
                    const meta = DIAG_LABELS[diagId];
                    let hasData = Math.random() > 0.15; // 85% de probabilidad de tener puerto telemático
                    let value = 0;

                    // Lógica para simular valores coherentes
                    if (meta.type === "ignition") {
                        hasData = true;
                        value = v.ignition ? 1 : 0;
                    } else if (diagId === "DiagnosticDeviceRelayStateId") {
                        // El Volvo 01 y Mercedes 05 tienen relays activos en demo
                        value = (deviceId === "e101" || deviceId === "e105") ? 1 : 0;
                    } else if (meta.type === "output") {
                        value = Math.random() > 0.85 ? 1 : 0;
                    } else if (meta.type === "input" || meta.type === "aux") {
                        // Unidades en movimiento tienen más sensores activos
                        value = Math.random() > (v.isMoving ? 0.6 : 0.9) ? 1 : 0;
                    }

                    if (hasData) {
                        mockResults[diagId] = {
                            value: value,
                            dateTime: new Date(Date.now() - Math.random() * 1800000).toISOString() // Hace max 30 mins
                        };
                        if (value === 1) {
                            if (meta.type === "output") outputsActive++;
                            if (meta.type === "input" || meta.type === "aux") inputsActive++;
                        }
                    }
                });

                // Actualizar contadores de demo para KPIs dinámicos
                v.activeInputsCount = inputsActive;
                v.activeOutputsCount = outputsActive;

                currentDiagnosticsData = mockResults;
                renderDiagnosticsPanel(v, mockResults);
                updateKPIs();
            }, 500);
        } else {
            // Modo en vivo: Petición real multicall
            const calls = IO_DIAGNOSTICS.map(diagId => [
                "Get",
                {
                    typeName: "StatusData",
                    search: {
                        deviceSearch: { id: deviceId },
                        diagnosticSearch: { id: diagId }
                    },
                    resultsLimit: 1
                }
            ]);

            api.multiCall(calls, (results) => {
                if (activeVehicleId !== deviceId) return;

                const processedResults = {};
                let inputsActive = 0;
                let outputsActive = 0;

                IO_DIAGNOSTICS.forEach((diagId, idx) => {
                    const records = results[idx] || [];
                    if (records.length > 0) {
                        const record = records[0];
                        const val = record.data;
                        processedResults[diagId] = {
                            value: val,
                            dateTime: record.dateTime
                        };

                        const meta = DIAG_LABELS[diagId];
                        if (meta && val === 1) {
                            if (meta.type === "output") outputsActive++;
                            if (meta.type === "input" || meta.type === "aux") inputsActive++;
                        }
                    }
                });

                // Actualizar los KPIs dinámicos del vehículo seleccionado en la lista
                const v = allVehicles.find(x => x.id === deviceId);
                if (v) {
                    v.activeInputsCount = inputsActive;
                    v.activeOutputsCount = outputsActive;
                }

                currentDiagnosticsData = processedResults;
                renderDiagnosticsPanel(v, processedResults);
                updateKPIs();
            }, (err) => {
                console.error("Error consultando telemetría I/O:", err);
                const detailsContainer = document.getElementById("details-panel-container");
                if (detailsContainer) {
                    detailsContainer.innerHTML = `
                        <div class="glass-card" style="text-align:center; padding:3rem; border-color:rgba(239,68,68,0.25);">
                            <i data-lucide="alert-triangle" width="48" height="48" style="color:var(--c-stopped); margin-bottom:1rem;"></i>
                            <h3 style="font-size:1.1rem; font-weight:700; margin-bottom:0.5rem;">Error de Comunicación</h3>
                            <p style="font-size:0.85rem; color:var(--text-2); max-width:400px; margin:0 auto 1.5rem;">
                                No se pudo obtener la telemetría del dispositivo desde la API de Geotab.
                            </p>
                            <span style="font-family: monospace; font-size:0.75rem; background:rgba(0,0,0,0.3); padding:0.4rem 0.8rem; border-radius:4px; border:1px solid var(--border); color:var(--text-3);">
                                ${err.message || err}
                            </span>
                        </div>
                    `;
                    if (window.lucide) lucide.createIcons();
                }
            });
        }
    };

    // ── Renderizar Panel de Diagnósticos Derecho ──────────────────
    const renderDiagnosticsPanel = (vehicle, data) => {
        const detailsContainer = document.getElementById("details-panel-container");
        if (!detailsContainer) return;

        const hasKeys = Object.keys(data).length > 0;
        if (!hasKeys) {
            detailsContainer.innerHTML = `
                <div class="glass-card" style="text-align:center; padding:4rem 2rem;">
                    <i data-lucide="help-circle" width="48" height="48" style="color:var(--text-3); margin-bottom:1rem; opacity:0.5;"></i>
                    <h3 style="font-size:1.1rem; font-weight:700; margin-bottom:0.5rem; color:var(--text-2);">Sin Datos Telemáticos</h3>
                    <p style="font-size:0.85rem; color:var(--text-3); max-width:350px; margin:0 auto;">
                        Esta unidad no registra telemetría de entradas o salidas digitales en Geotab. Verifica si tiene conectado un arnés IOX o puertos auxiliares configurados.
                    </p>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        // Dividir por tipo
        const outputsList = [];
        const inputsList = [];
        const auxList = [];
        let ignitionInfo = null;

        Object.entries(data).forEach(([diagId, info]) => {
            const labelMeta = DIAG_LABELS[diagId];
            if (!labelMeta) return;

            const item = {
                id: diagId,
                name: labelMeta.name,
                desc: labelMeta.desc,
                type: labelMeta.type,
                value: info.value,
                dateTime: info.dateTime
            };

            if (labelMeta.type === "output") {
                outputsList.push(item);
            } else if (labelMeta.type === "input") {
                inputsList.push(item);
            } else if (labelMeta.type === "aux") {
                auxList.push(item);
            } else if (labelMeta.type === "ignition") {
                ignitionInfo = item;
            }
        });

        // Ordenar alfabéticamente
        outputsList.sort((a, b) => a.name.localeCompare(b.name));
        inputsList.sort((a, b) => a.name.localeCompare(b.name));
        auxList.sort((a, b) => a.name.localeCompare(b.name));

        const formatTime = (isoString) => {
            if (!isoString) return "—";
            const d = new Date(isoString);
            return d.toLocaleString("es-MX", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
        };

        const renderItem = (item) => {
            const isActive = item.value === 1 || item.value === true;
            let badgeClass = "inactive";
            let badgeText = "INACTIVO (0)";
            
            if (isActive) {
                if (item.type === "output") {
                    badgeClass = "active-red";
                    badgeText = "ACTIVO (1)";
                } else {
                    badgeClass = "active-green";
                    badgeText = "ACTIVO (1)";
                }
            }

            let iconName = "toggle-left";
            if (item.id === "DiagnosticDeviceRelayStateId") iconName = "cpu";
            else if (item.type === "output") iconName = "toggle-right";
            else if (item.type === "aux") iconName = "activity";

            return `
                <div class="io-item" title="${item.desc}">
                    <div class="io-item-info">
                        <div class="io-item-icon" style="color:${isActive ? (item.type === 'output' ? 'var(--c-stopped)' : 'var(--c-active)') : 'var(--text-3)'}">
                            <i data-lucide="${iconName}" width="16" height="16"></i>
                        </div>
                        <div class="io-item-texts">
                            <span class="io-item-name">${item.name}</span>
                            <span class="io-item-id">${item.id}</span>
                        </div>
                    </div>
                    <div class="io-item-meta">
                        <span class="io-badge ${badgeClass}">
                            <span class="io-badge-dot"></span>
                            ${badgeText}
                        </span>
                        <span class="io-item-time">${formatTime(item.dateTime)}</span>
                    </div>
                </div>
            `;
        };

        // Construir HTML del Bento Grid
        let bentoHtml = `
            <div class="details-container">
                <!-- Tarjeta de Identidad -->
                <div class="glass-card identity-card">
                    <div class="identity-main">
                        <div class="identity-avatar">
                            <i data-lucide="truck" width="22" height="22"></i>
                        </div>
                        <div class="identity-texts">
                            <h2 class="identity-name">${vehicle.name}</h2>
                            <div class="identity-meta">
                                <span>${vehicle.plate}</span>
                                <span class="separator">·</span>
                                <span>${vehicle.type}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="identity-kpis">
                        <div class="identity-kpi">
                            <span class="identity-kpi-label">Estado de Ignición</span>
                            <span class="identity-kpi-value" style="color:${vehicle.ignition ? 'var(--c-active)' : 'var(--text-3)'}">
                                <i data-lucide="key" width="14" height="14"></i>
                                ${vehicle.ignition ? "ENCENDIDO" : "APAGADO"}
                            </span>
                        </div>
                        <div class="identity-kpi">
                            <span class="identity-kpi-label">Velocidad Actual</span>
                            <span class="identity-kpi-value">
                                <i data-lucide="gauge" width="14" height="14" style="color:var(--c-info)"></i>
                                ${vehicle.speed} km/h
                            </span>
                        </div>
                        <div class="identity-kpi">
                            <span class="identity-kpi-label">ID de Dispositivo</span>
                            <span class="identity-kpi-value" style="font-family:var(--font-mono); font-size:0.85rem; color:var(--text-2)">
                                ${vehicle.id}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Grid de Diagnósticos -->
                <div class="bento-grid">
                    
                    <!-- PANEL 1: SALIDAS DIGITALES -->
                    <div class="glass-card">
                        <div class="panel-header">
                            <div class="panel-title-group">
                                <i data-lucide="toggle-right" width="15" height="15"></i>
                                <span>Salidas de Control / Relays</span>
                            </div>
                            <span class="panel-badge">${outputsList.length}</span>
                        </div>
                        <div class="io-list">
                            ${outputsList.length > 0 
                                ? outputsList.map(renderItem).join("") 
                                : '<div style="font-size:0.8rem;color:var(--text-3);text-align:center;padding:1.5rem 0;">Sin salidas configuradas.</div>'}
                        </div>
                    </div>

                    <!-- PANEL 2: ENTRADAS DIGITALES -->
                    <div class="glass-card">
                        <div class="panel-header">
                            <div class="panel-title-group">
                                <i data-lucide="toggle-left" width="15" height="15"></i>
                                <span>Entradas Digitales / Sensores</span>
                            </div>
                            <span class="panel-badge">${inputsList.length}</span>
                        </div>
                        <div class="io-list">
                            ${inputsList.length > 0 
                                ? inputsList.map(renderItem).join("") 
                                : '<div style="font-size:0.8rem;color:var(--text-3);text-align:center;padding:1.5rem 0;">Sin entradas detectadas.</div>'}
                        </div>
                    </div>

                    <!-- PANEL 3: AUXILIARES (Ancho completo) -->
                    <div class="glass-card bento-col-span-2">
                        <div class="panel-header">
                            <div class="panel-title-group">
                                <i data-lucide="activity" width="15" height="15"></i>
                                <span>Entradas Auxiliares (Arnés Aux)</span>
                            </div>
                            <span class="panel-badge">${auxList.length}</span>
                        </div>
                        <div class="io-list" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.65rem;">
                            ${auxList.length > 0 
                                ? auxList.map(renderItem).join("") 
                                : '<div style="grid-column:1/-1;font-size:0.8rem;color:var(--text-3);text-align:center;padding:1.5rem 0;">Sin entradas auxiliares telemáticas registradas.</div>'}
                        </div>
                    </div>
                </div>

                <div style="font-size:0.7rem; color:var(--text-3); text-align:center; margin-top:0.5rem;">
                    * Las lecturas reflejan el último cambio de estado reportado por el dispositivo GO.
                </div>
            </div>
        `;

        detailsContainer.innerHTML = bentoHtml;
        if (window.lucide) lucide.createIcons();
    };

    // ── Cargar dispositivos de MyGeotab (Live) ───────────────────
    const loadDevices = () => {
        const listContainer = document.getElementById("vehicle-list-container");
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="loading-box">
                    <div class="spinner"></div>
                    <p style="font-size:0.75rem; margin-top:0.5rem; text-align:center;">Cargando flota...</p>
                </div>
            `;
        }

        api.multiCall([
            ["Get", { typeName: "Device" }],
            ["Get", { typeName: "DeviceStatusInfo" }]
        ], (results) => {
            const devices = results[0] || [];
            const statuses = results[1] || [];

            const statusMap = {};
            statuses.forEach(s => { statusMap[s.device.id] = s; });

            allVehicles = devices
                .filter(d => d.id !== "b0") // Excluir dispositivo raíz de Geotab
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(d => {
                    const s = statusMap[d.id] || {};
                    const speed = Math.round(s.speed || 0);
                    return {
                        id: d.id,
                        name: d.name,
                        plate: d.licensePlate || d.serialNumber || d.id.substring(0, 6),
                        type: d.vehicleType || "Vehículo",
                        speed: speed,
                        isMoving: s.isDeviceMoving || speed > 0,
                        ignition: s.isDeviceCommunicating || speed > 0,
                        activeInputsCount: 0,
                        activeOutputsCount: 0
                    };
                });

            renderVehicleList();
            updateKPIs();
            toast(`${allVehicles.length} unidades cargadas de Geotab.`, "success");

            // Seleccionar automáticamente el primer vehículo
            if (allVehicles.length > 0) {
                selectVehicle(allVehicles[0].id);
            } else {
                const detailsContainer = document.getElementById("details-panel-container");
                if (detailsContainer) {
                    detailsContainer.innerHTML = `
                        <div class="empty-details-state">
                            <i data-lucide="truck-off" width="48" height="48"></i>
                            <h3>No hay vehículos disponibles</h3>
                            <p>Tu cuenta de Geotab no tiene dispositivos asignados o visibles.</p>
                        </div>
                    `;
                    if (window.lucide) lucide.createIcons();
                }
            }

            startPolling();

        }, (err) => {
            console.error("Error cargando flota:", err);
            toast("Error al cargar unidades: " + err, "error");
        });
    };

    // ── Cargar dispositivos en modo simulado (Demo) ──────────────
    const loadDemoDevices = () => {
        allVehicles = MOCK_VEHICLES.map(v => ({ ...v }));
        renderVehicleList();
        updateKPIs();
        toast("Flota simulada cargada (Modo Demo).", "info");

        if (allVehicles.length > 0) {
            selectVehicle(allVehicles[0].id);
        }

        startPolling();
    };

    // ── Polling / Actualizaciones en segundo plano ────────────────
    const startPolling = () => {
        if (telemetryTimer) clearInterval(telemetryTimer);

        telemetryTimer = setInterval(() => {
            if (isDemoMode) {
                // Simular fluctuaciones en el fondo
                allVehicles.forEach(v => {
                    if (Math.random() > 0.8) {
                        // Fluctúa velocidad / movimiento
                        if (v.isMoving) {
                            v.speed = Math.max(0, v.speed + Math.round((Math.random() - 0.5) * 10));
                            if (v.speed === 0) {
                                v.isMoving = false;
                                v.ignition = Math.random() > 0.4;
                            }
                        } else {
                            if (v.ignition && Math.random() > 0.7) {
                                v.isMoving = true;
                                v.speed = 15 + Math.round(Math.random() * 40);
                            } else {
                                v.ignition = Math.random() > 0.6;
                            }
                        }
                    }
                });

                renderVehicleList(document.getElementById("search-input")?.value || "");

                // Si hay un vehículo seleccionado, refrescar su diagnóstico de demo
                if (activeVehicleId) {
                    const activeV = allVehicles.find(x => x.id === activeVehicleId);
                    
                    // Pequeñas fluctuaciones aleatorias en las entradas/salidas
                    Object.entries(currentDiagnosticsData).forEach(([diagId, info]) => {
                        const meta = DIAG_LABELS[diagId];
                        if (meta.type === "ignition") {
                            info.value = activeV.ignition ? 1 : 0;
                            info.dateTime = new Date().toISOString();
                        } else if (Math.random() > 0.85) {
                            info.value = info.value === 1 ? 0 : 1;
                            info.dateTime = new Date().toISOString();
                        }
                    });

                    // Recalcular contadores del vehículo activo
                    let inputsActive = 0;
                    let outputsActive = 0;
                    Object.entries(currentDiagnosticsData).forEach(([diagId, info]) => {
                        const meta = DIAG_LABELS[diagId];
                        if (info.value === 1) {
                            if (meta.type === "output") outputsActive++;
                            if (meta.type === "input" || meta.type === "aux") inputsActive++;
                        }
                    });
                    activeV.activeInputsCount = inputsActive;
                    activeV.activeOutputsCount = outputsActive;

                    renderDiagnosticsPanel(activeV, currentDiagnosticsData);
                }
                updateKPIs();
            } else {
                // Modo en vivo: Pollear DeviceStatusInfo
                api.call("Get", { typeName: "DeviceStatusInfo" }, (statuses) => {
                    let changed = false;
                    (statuses || []).forEach(s => {
                        const v = allVehicles.find(x => x.id === s.device.id);
                        if (v) {
                            const speed = Math.round(s.speed || 0);
                            const isMoving = s.isDeviceMoving || speed > 0;
                            const ignition = s.isDeviceCommunicating || speed > 0;
                            
                            if (v.speed !== speed || v.isMoving !== isMoving || v.ignition !== ignition) {
                                v.speed = speed;
                                v.isMoving = isMoving;
                                v.ignition = ignition;
                                changed = true;
                            }
                        }
                    });

                    if (changed) {
                        renderVehicleList(document.getElementById("search-input")?.value || "");
                    }

                    // Refrescar automáticamente el vehículo seleccionado si está activo
                    if (activeVehicleId) {
                        fetchVehicleDiagnostics(activeVehicleId);
                    } else {
                        updateKPIs();
                    }
                }, () => {});
            }
        }, 10000); // Polling cada 10 segundos
    };

    // ── Vincular Eventos de Búsqueda y Refresco ───────────────────
    const bindEvents = () => {
        if (bindEvents._done) return;
        bindEvents._done = true;

        const searchInput = document.getElementById("search-input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                renderVehicleList(e.target.value);
            });
        }

        const btnRefresh = document.getElementById("btn-refresh");
        if (btnRefresh) {
            btnRefresh.addEventListener("click", () => {
                btnRefresh.disabled = true;
                
                // Animación de rotación lucide
                const icon = btnRefresh.querySelector("i");
                if (icon) icon.style.transition = "transform 0.8s ease";
                if (icon) icon.style.transform = "rotate(360deg)";

                setTimeout(() => {
                    if (icon) icon.style.transform = "none";
                    btnRefresh.disabled = false;
                }, 800);

                if (activeVehicleId) {
                    fetchVehicleDiagnostics(activeVehicleId);
                    toast("Telemetría actualizada.", "success");
                } else if (isDemoMode) {
                    loadDemoDevices();
                } else {
                    loadDevices();
                }
            });
        }
    };

    // ── Standalone Fallback (abierto fuera del portal) ───────────
    document.addEventListener("DOMContentLoaded", () => {
        if (window.lucide) lucide.createIcons();

        setTimeout(() => {
            if (!isInitialized) {
                isDemoMode = true;
                const modeBadge = document.getElementById("connection-status-badge");
                const modeText = document.getElementById("connection-status-text");
                if (modeBadge) {
                    modeBadge.dataset.mode = "demo";
                    if (modeText) modeText.textContent = "Demo (Standalone)";
                }
                bindEvents();
                loadDemoDevices();
            }
        }, 600);
    });

    // ── Retornar API del Add-In para MyGeotab ────────────────────
    return function () {
        return {
            initialize(geotabApi, state, callback) {
                isInitialized = true;
                api = geotabApi;
                isDemoMode = false;

                const modeBadge = document.getElementById("connection-status-badge");
                const modeText = document.getElementById("connection-status-text");
                if (modeBadge) {
                    modeBadge.dataset.mode = "live";
                    if (modeText) modeText.textContent = "Geotab Live";
                }

                bindEvents();
                loadDevices();
                if (callback) callback();
            },
            focus(geotabApi, state) {
                api = geotabApi;
                if (window.lucide) lucide.createIcons();
                // Refrescar al enfocar
                if (activeVehicleId) {
                    fetchVehicleDiagnostics(activeVehicleId);
                }
            },
            blur() {
                if (telemetryTimer) clearInterval(telemetryTimer);
            }
        };
    };

})();
