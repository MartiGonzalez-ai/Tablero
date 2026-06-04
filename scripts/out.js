/* 
 * ═══════════════════════════════════════════════════════════════
 * OUT.JS — Fleet Control | IOX Output Command Sender
 * Geotab Add-In | geotab.addin.out
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

window.geotab = window.geotab || {};
geotab.addin = geotab.addin || {};

geotab.addin.out = (function () {

    // ── Estado global ────────────────────────────────────────────
    let api = null;
    let isDemoMode = false;
    let isInitialized = false;

    let allVehicles = [];      // [{ id, name, plate, type, speed, isMoving, ignition }]
    let activeVehicleId = null;
    let telemetryTimer = null;

    // Parámetros del Comando Activo
    const commandState = {
        moutput: 1,
        state: 1, // 1 = ON, 0 = OFF
        duration: 0 // 0 = Permanente
    };

    // ── Datos simulados para Demo ────────────────────────────────
    const MOCK_VEHICLES = [
        { id: "b101", name: "Volvo 01", plate: "YUC-001", type: "Camión", speed: 0, isMoving: false, ignition: false },
        { id: "b102", name: "Kenworth 02", plate: "YUC-022", type: "Tractocamión", speed: 62, isMoving: true, ignition: true },
        { id: "b103", name: "Ford 03", plate: "YUC-183", type: "Pickup", speed: 0, isMoving: false, ignition: false },
        { id: "b104", name: "Isuzu 04", plate: "YUC-214", type: "Caja seca", speed: 0, isMoving: false, ignition: true },
        { id: "b105", name: "Mercedes 05", plate: "YUC-300", type: "Camión", speed: 0, isMoving: false, ignition: false },
        { id: "b106", name: "RAM 06", plate: "YUC-411", type: "Pickup", speed: 0, isMoving: false, ignition: false },
    ];

    // ── Toast System ─────────────────────────────────────────────
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

        // Agregar listeners de clic a cada vehículo de la lista
        listContainer.querySelectorAll(".vehicle-item").forEach(item => {
            item.addEventListener("click", () => {
                selectVehicle(item.dataset.id);
            });
        });
    };

    // ── Seleccionar un vehículo ──────────────────────────────────
    const selectVehicle = (deviceId) => {
        activeVehicleId = deviceId;
        
        // Actualizar estado activo en sidebar
        document.querySelectorAll(".vehicle-item").forEach(item => {
            item.classList.toggle("selected", item.dataset.id === deviceId);
        });

        const v = allVehicles.find(x => x.id === deviceId);
        if (!v) return;

        renderControlPanel(v);
        updateCommandPreview();
    };

    // ── Renderizar Panel de Control Derecho ────────────────────────
    const renderControlPanel = (vehicle) => {
        const detailsContainer = document.getElementById("details-panel-container");
        if (!detailsContainer) return;

        detailsContainer.innerHTML = `
            <div class="details-container">
                
                <!-- 1. Tarjeta de Identidad del Vehículo Seleccionado -->
                <div class="glass-card identity-card">
                    <div class="identity-main">
                        <div class="identity-avatar" style="background: rgba(168, 85, 247, 0.1); border-color: rgba(168, 85, 247, 0.2); color: #a855f7;">
                            <i data-lucide="cpu" width="22" height="22"></i>
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
                            <span class="identity-kpi-label">Ignición</span>
                            <span class="identity-kpi-value" style="color:${vehicle.ignition ? 'var(--c-active)' : 'var(--text-3)'}">
                                <i data-lucide="key" width="14" height="14"></i>
                                ${vehicle.ignition ? "ENCENDIDO" : "APAGADO"}
                            </span>
                        </div>
                        <div class="identity-kpi">
                            <span class="identity-kpi-label">Velocidad</span>
                            <span class="identity-kpi-value" style="color:${vehicle.isMoving ? 'var(--c-moving)' : 'var(--text-2)'}">
                                <i data-lucide="gauge" width="14" height="14"></i>
                                ${vehicle.speed} km/h
                            </span>
                        </div>
                        <div class="identity-kpi">
                            <span class="identity-kpi-label">ID Geotab</span>
                            <span class="identity-kpi-value" style="font-family:var(--font-mono); font-size:0.85rem; color:var(--text-2)">
                                ${vehicle.id}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- 2. Grid de dos columnas: Configuración y Previsualización -->
                <div class="bento-grid">
                    
                    <!-- Tarjeta de Configuración de Comando -->
                    <div class="glass-card control-grid-wrapper">
                        <div class="panel-header" style="margin-bottom: 0.5rem;">
                            <div class="panel-title-group">
                                <i data-lucide="sliders" width="15" height="15" style="color:#a855f7;"></i>
                                <span>Configuración del Comando</span>
                            </div>
                        </div>

                        <!-- Selector de Canal Auxiliar (moutput) -->
                        <div class="form-group">
                            <label class="form-label">
                                <i data-lucide="layers" width="12" height="12"></i>
                                Canal de Salida (moutput)
                                <span class="desc">Mapeado en el módulo IOX</span>
                            </label>
                            <div class="channel-selector" id="cmd-channel-selector">
                                ${[1, 2, 3, 4, 5, 6, 7, 8].map(ch => `
                                    <button type="button" class="channel-btn${ch === commandState.moutput ? ' active' : ''}" data-channel="${ch}">
                                        ${ch}
                                    </button>
                                `).join("")}
                            </div>
                        </div>

                        <!-- Selector de Estado de Relevador (state) -->
                        <div class="form-group">
                            <label class="form-label">
                                <i data-lucide="power" width="12" height="12"></i>
                                Estado del Relevador
                            </label>
                            <div class="state-segment-control">
                                <button type="button" class="state-btn state-off${commandState.state === 0 ? ' active' : ''}" data-state="0">
                                    <i data-lucide="unlock" width="14" height="14"></i>
                                    Desactivar (OFF)
                                </button>
                                <button type="button" class="state-btn state-on${commandState.state === 1 ? ' active' : ''}" data-state="1">
                                    <i data-lucide="lock" width="14" height="14"></i>
                                    Activar (ON)
                                </button>
                            </div>
                        </div>

                        <!-- Selector de Duración (duration) -->
                        <div class="form-group">
                            <label class="form-label">
                                <i data-lucide="clock" width="12" height="12"></i>
                                Duración
                                <span class="desc">Segundos (0 = permanente)</span>
                            </label>
                            <div class="slider-container">
                                <input type="range" class="duration-slider" id="cmd-duration-slider" min="0" max="300" step="5" value="${commandState.duration}">
                                <div class="duration-value-box" id="cmd-duration-value">
                                    ${commandState.duration === 0 ? 'Permanente' : commandState.duration + ' s'}
                                </div>
                            </div>
                            <div class="preset-row">
                                <button type="button" class="preset-btn${commandState.duration === 0 ? ' active' : ''}" data-preset="0">Permanente</button>
                                <button type="button" class="preset-btn${commandState.duration === 30 ? ' active' : ''}" data-preset="30">30 seg</button>
                                <button type="button" class="preset-btn${commandState.duration === 60 ? ' active' : ''}" data-preset="60">1 min</button>
                                <button type="button" class="preset-btn${commandState.duration === 300 ? ' active' : ''}" data-preset="300">5 min</button>
                            </div>
                        </div>

                        <!-- Nota de instalación -->
                        <div class="command-notice">
                            <strong>Nota física:</strong> Comprueba con los instaladores si <code>state=1</code> activa el corte de corriente (Bloqueo) o si actúa en lógica inversa.
                        </div>
                    </div>

                    <!-- Tarjeta de Previsualización Técnica del SDK -->
                    <div class="glass-card terminal-card" style="display:flex; flex-direction:column;">
                        <div class="terminal-header">
                            <div class="terminal-dots">
                                <span class="terminal-dot red"></span>
                                <span class="terminal-dot yellow"></span>
                                <span class="terminal-dot green"></span>
                            </div>
                            <span class="terminal-label">Payload de Geotab API</span>
                        </div>
                        <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
                            <pre class="payload-preview" id="sdk-payload-preview">Cargando preview...</pre>
                        </div>
                    </div>

                    <!-- Tarjeta de Seguridad y Envío -->
                    <div class="glass-card safety-card bento-col-span-2">
                        <div class="safety-checkbox-wrap" id="safety-check-container">
                            <input type="checkbox" id="safety-confirm-checkbox">
                            <div class="safety-checkbox-label">
                                <strong>Confirmar Envío de Comando Auxiliar</strong>
                                <span>Entiendo que al enviar este comando se transmitirá una señal celular al vehículo y se alterará el circuito eléctrico del dispositivo GO (IOX-OUTPUTM) de manera inmediata.</span>
                            </div>
                        </div>

                        <button type="button" class="btn-submit-command" id="btn-submit-command" disabled>
                            <i data-lucide="send" width="16" height="16"></i>
                            <span id="submit-btn-text">Bloqueado - Confirme Casilla</span>
                        </button>
                    </div>

                    <!-- Tarjeta de Historial / Cola de Entrega (Queue Logger) -->
                    <div class="glass-card logger-card bento-col-span-2" id="logger-panel" style="display:none;">
                        <div class="panel-header" style="margin-bottom:0.75rem;">
                            <div class="panel-title-group">
                                <i data-lucide="radio" width="15" height="15" style="color:var(--c-info);"></i>
                                <span>Monitoreo de Entrega en Red Geotab</span>
                            </div>
                        </div>
                        
                        <div class="log-steps">
                            <!-- Paso 1 -->
                            <div class="log-step" id="log-step-1">
                                <div class="log-step-circle">1</div>
                                <div class="log-step-texts">
                                    <span class="log-step-name">Generando Comando local</span>
                                    <span class="log-step-desc" id="log-step-1-desc">Codificando sintaxis del comando #setmoutput...</span>
                                </div>
                            </div>
                            <!-- Paso 2 -->
                            <div class="log-step" id="log-step-2">
                                <div class="log-step-circle">2</div>
                                <div class="log-step-texts">
                                    <span class="log-step-name">Enviando a Geotab API</span>
                                    <span class="log-step-desc" id="log-step-2-desc">Estableciendo comunicación por HTTP POST con los servidores de Geotab...</span>
                                </div>
                            </div>
                            <!-- Paso 3 -->
                            <div class="log-step" id="log-step-3">
                                <div class="log-step-circle">3</div>
                                <div class="log-step-texts">
                                    <span class="log-step-name">Encolado en Servidor (Geotab Queue)</span>
                                    <span class="log-step-desc" id="log-step-3-desc">Esperando ID de mensaje y acuse de confirmación en la base de datos...</span>
                                </div>
                            </div>
                            <!-- Paso 4 -->
                            <div class="log-step" id="log-step-4">
                                <div class="log-step-circle">4</div>
                                <div class="log-step-texts">
                                    <span class="log-step-name">Entrega al Dispositivo GO</span>
                                    <span class="log-step-desc" id="log-step-4-desc">Pendiente de que el vehículo realice conexión telemática (Pull celular).</span>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;

        if (window.lucide) lucide.createIcons();
        bindCommandFormEvents();
    };

    // ── Formatear JSON con resaltado de sintaxis HTML ─────────────
    const highlightJSON = (jsonObj) => {
        let jsonStr = JSON.stringify(jsonObj, null, 2);
        
        // Sanitizar HTML primero
        jsonStr = jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // Expresión regular para encontrar llaves, strings, números y booleanos
        return jsonStr.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
            let cls = 'syntax-num';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'syntax-key';
                } else {
                    cls = 'syntax-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'syntax-bool';
            } else if (/null/.test(match)) {
                cls = 'syntax-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    };

    // ── Actualizar Previsualización del Payload ────────────────────
    const updateCommandPreview = () => {
        const previewEl = document.getElementById("sdk-payload-preview");
        if (!previewEl) return;

        const cmdText = `#setmoutput:moutput=${commandState.moutput}&state=${commandState.state}&duration=${commandState.duration}`;
        
        const payload = {
            typeName: "TextMessage",
            entity: {
                device: {
                    id: activeVehicleId || "SELECCIONAR_UNIDAD"
                },
                isDirectionToDevice: true,
                text: cmdText,
                isResponseRequired: false
            }
        };

        previewEl.innerHTML = highlightJSON(payload);
    };

    // ── Vincular Eventos de Entrada del Formulario de Comando ───────
    const bindCommandFormEvents = () => {
        const channelBtns = document.querySelectorAll("#cmd-channel-selector .channel-btn");
        const stateBtns = document.querySelectorAll(".state-segment-control .state-btn");
        const durationSlider = document.getElementById("cmd-duration-slider");
        const durationVal = document.getElementById("cmd-duration-value");
        const presetBtns = document.querySelectorAll(".preset-row .preset-btn");
        const safetyCheckbox = document.getElementById("safety-confirm-checkbox");
        const submitBtn = document.getElementById("btn-submit-command");
        const submitText = document.getElementById("submit-btn-text");

        // Canales (moutput)
        channelBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                channelBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                commandState.moutput = parseInt(btn.dataset.channel, 10);
                updateCommandPreview();
            });
        });

        // Estado (state)
        stateBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                stateBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                commandState.state = parseInt(btn.dataset.state, 10);
                
                // Cambiar textos y clases de submit dinámicamente si el botón ya está activo
                updateSubmitButtonState(safetyCheckbox.checked);
                updateCommandPreview();
            });
        });

        // Slider de duración
        if (durationSlider) {
            durationSlider.addEventListener("input", (e) => {
                const val = parseInt(e.target.value, 10);
                commandState.duration = val;
                if (durationVal) {
                    durationVal.textContent = val === 0 ? "Permanente" : val + " s";
                }
                
                // Desactivar presets activos
                presetBtns.forEach(b => {
                    b.classList.toggle("active", parseInt(b.dataset.preset, 10) === val);
                });
                updateCommandPreview();
            });
        }

        // Botones rápidos de preset
        presetBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                presetBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                
                const val = parseInt(btn.dataset.preset, 10);
                commandState.duration = val;
                
                if (durationSlider) durationSlider.value = val;
                if (durationVal) {
                    durationVal.textContent = val === 0 ? "Permanente" : val + " s";
                }
                updateCommandPreview();
            });
        });

        // Checkbox de seguridad
        if (safetyCheckbox) {
            safetyCheckbox.addEventListener("change", (e) => {
                const isChecked = e.target.checked;
                updateSubmitButtonState(isChecked);
            });
        }

        // Botón de Enviar Comando
        if (submitBtn) {
            submitBtn.addEventListener("click", () => {
                if (submitBtn.disabled) return;
                sendIOXCommand();
            });
        }
    };

    // Actualiza la visualización y estado del botón de envío
    const updateSubmitButtonState = (isChecked) => {
        const submitBtn = document.getElementById("btn-submit-command");
        const submitText = document.getElementById("submit-btn-text");
        if (!submitBtn || !submitText) return;

        submitBtn.disabled = !isChecked;
        submitBtn.classList.toggle("unlocked", isChecked);

        // Remover estilos de estado anteriores
        submitBtn.classList.remove("state-deactivate");

        if (isChecked) {
            if (commandState.state === 1) {
                submitText.textContent = "Transmitir: ACTIVAR (Corte)";
            } else {
                submitBtn.classList.add("state-deactivate");
                submitText.textContent = "Transmitir: DESACTIVAR (Restaurar)";
            }
        } else {
            submitText.textContent = "Bloqueado - Confirme Casilla";
        }
    };

    // ── Lógica de Envío del Comando IOX (Geotab API / Demo) ────────
    const sendIOXCommand = () => {
        const submitBtn = document.getElementById("btn-submit-command");
        const safetyCheckbox = document.getElementById("safety-confirm-checkbox");
        if (submitBtn) submitBtn.disabled = true;
        if (safetyCheckbox) safetyCheckbox.disabled = true;

        const cmdText = `#setmoutput:moutput=${commandState.moutput}&state=${commandState.state}&duration=${commandState.duration}`;
        
        // Mostrar y resetear panel de monitoreo
        const loggerPanel = document.getElementById("logger-panel");
        if (loggerPanel) loggerPanel.style.display = "block";
        resetLoggerSteps();

        // 1. Paso local
        updateLoggerStep(1, "done", `Comando generado con éxito: "${cmdText}"`);

        // 2. Paso envío servidor
        updateLoggerStep(2, "active");

        if (isDemoMode) {
            // Simulación de flujo celular / API
            setTimeout(() => {
                updateLoggerStep(2, "done", "Llamada Add TextMessage exitosa.");
                updateLoggerStep(3, "active");

                setTimeout(() => {
                    const msgId = "m" + Math.floor(100000 + Math.random() * 900000);
                    updateLoggerStep(3, "done", `Registrado en base de datos Geotab. ID de Mensaje: ${msgId}`);
                    updateLoggerStep(4, "active");

                    // Reactivar controles
                    if (safetyCheckbox) {
                        safetyCheckbox.checked = false;
                        safetyCheckbox.disabled = false;
                    }
                    updateSubmitButtonState(false);

                    toast(`Comando encolado con éxito. ID: ${msgId}`, "success");
                    
                    // Nota descriptiva final
                    const p4Desc = document.getElementById("log-step-4-desc");
                    if (p4Desc) {
                        p4Desc.innerHTML = `Comando pendiente de descarga. El dispositivo GO recibirá e iniciará <code>state=${commandState.state}</code> la próxima vez que se comunique con la red celular (comúnmente < 15 segundos con ignición ON).`;
                    }
                }, 1500);

            }, 1200);
        } else {
            // Envío real a la API de Geotab
            api.call("Add", {
                typeName: "TextMessage",
                entity: {
                    device: {
                        id: activeVehicleId
                    },
                    isDirectionToDevice: true,
                    text: cmdText,
                    isResponseRequired: false
                }
            }, function (result) {
                // Éxito en la llamada
                updateLoggerStep(2, "done", "Llamada Add TextMessage exitosa.");
                updateLoggerStep(3, "done", `Registrado en Geotab con éxito. ID de Mensaje: ${result}`);
                updateLoggerStep(4, "active");

                if (safetyCheckbox) {
                    safetyCheckbox.checked = false;
                    safetyCheckbox.disabled = false;
                }
                updateSubmitButtonState(false);

                toast(`Comando encolado con éxito. ID de Mensaje: ${result}`, "success");

                const p4Desc = document.getElementById("log-step-4-desc");
                if (p4Desc) {
                    p4Desc.innerHTML = `Comando pendiente de descarga celular por la unidad. El dispositivo GO recibirá y ejecutará el comando la próxima vez que conecte.`;
                }

            }, function (error) {
                // Error en la llamada
                updateLoggerStep(2, "error", `Error de API: ${error.message || error}`);
                toast("Error al enviar comando: " + (error.message || error), "error");

                if (safetyCheckbox) {
                    safetyCheckbox.disabled = false;
                }
                updateSubmitButtonState(safetyCheckbox.checked);
            });
        }
    };

    // Helpers para actualizar el Queue Logger
    const resetLoggerSteps = () => {
        for (let i = 1; i <= 4; i++) {
            const stepEl = document.getElementById(`log-step-${i}`);
            const descEl = document.getElementById(`log-step-${i}-desc`);
            if (stepEl) {
                stepEl.className = "log-step";
            }
            if (descEl) {
                // Restaurar descripciones iniciales
                if (i === 1) descEl.textContent = "Codificando sintaxis del comando #setmoutput...";
                if (i === 2) descEl.textContent = "Estableciendo comunicación por HTTP POST con los servidores de Geotab...";
                if (i === 3) descEl.textContent = "Esperando ID de mensaje y acuse de confirmación en la base de datos...";
                if (i === 4) descEl.textContent = "Pendiente de que el vehículo realice conexión telemática (Pull celular).";
            }
        }
    };

    const updateLoggerStep = (stepNumber, status, customDesc = null) => {
        const stepEl = document.getElementById(`log-step-${stepNumber}`);
        const descEl = document.getElementById(`log-step-${stepNumber}-desc`);
        if (!stepEl) return;

        stepEl.className = `log-step ${status}`;
        if (customDesc && descEl) {
            descEl.innerHTML = customDesc;
        }
    };

    // ── Cargar dispositivos reales de Geotab (Live) ──────────────
    const loadDevices = () => {
        const listContainer = document.getElementById("vehicle-list-container");
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="loading-box">
                    <div class="spinner"></div>
                    <p style="font-size:0.75rem; margin-top:0.5rem; text-align:center;">Cargando flota de Geotab...</p>
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
                .filter(d => d.id !== "b0") // Excluir nodo raíz
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
                        ignition: s.isDeviceCommunicating || speed > 0
                    };
                });

            renderVehicleList();
            toast(`${allVehicles.length} unidades cargadas de Geotab.`, "success");

            // Seleccionar el primero automáticamente
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
            console.error("Error al cargar flota de Geotab:", err);
            toast("Error al cargar unidades: " + err, "error");
        });
    };

    // ── Cargar dispositivos simulados (Demo) ─────────────────────
    const loadDemoDevices = () => {
        allVehicles = MOCK_VEHICLES.map(v => ({ ...v }));
        renderVehicleList();
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
                // Simular pequeñas fluctuaciones de telemetría de fondo
                allVehicles.forEach(v => {
                    if (Math.random() > 0.85) {
                        if (v.isMoving) {
                            v.speed = Math.max(0, v.speed + Math.round((Math.random() - 0.5) * 10));
                            if (v.speed === 0) {
                                v.isMoving = false;
                                v.ignition = Math.random() > 0.3;
                            }
                        } else {
                            if (v.ignition && Math.random() > 0.75) {
                                v.isMoving = true;
                                v.speed = 10 + Math.round(Math.random() * 50);
                            } else {
                                v.ignition = Math.random() > 0.65;
                            }
                        }
                    }
                });

                renderVehicleList(document.getElementById("search-input")?.value || "");
                
                // Actualizar panel de vehículo activo si está visible
                if (activeVehicleId) {
                    const activeV = allVehicles.find(x => x.id === activeVehicleId);
                    const kpiIgnition = document.querySelector(".identity-kpi:nth-child(1) .identity-kpi-value");
                    const kpiSpeed = document.querySelector(".identity-kpi:nth-child(2) .identity-kpi-value");
                    
                    if (kpiIgnition && activeV) {
                        kpiIgnition.style.color = activeV.ignition ? 'var(--c-active)' : 'var(--text-3)';
                        kpiIgnition.innerHTML = `<i data-lucide="key" width="14" height="14"></i> ${activeV.ignition ? "ENCENDIDO" : "APAGADO"}`;
                    }
                    if (kpiSpeed && activeV) {
                        kpiSpeed.style.color = activeV.isMoving ? 'var(--c-moving)' : 'var(--text-2)';
                        kpiSpeed.innerHTML = `<i data-lucide="gauge" width="14" height="14"></i> ${activeV.speed} km/h`;
                    }
                    if (window.lucide) lucide.createIcons();
                }
            } else {
                // Live Polling
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
                        // Actualizar encabezados del vehículo activo
                        if (activeVehicleId) {
                            const activeV = allVehicles.find(x => x.id === activeVehicleId);
                            const kpiIgnition = document.querySelector(".identity-kpi:nth-child(1) .identity-kpi-value");
                            const kpiSpeed = document.querySelector(".identity-kpi:nth-child(2) .identity-kpi-value");
                            
                            if (kpiIgnition && activeV) {
                                kpiIgnition.style.color = activeV.ignition ? 'var(--c-active)' : 'var(--text-3)';
                                kpiIgnition.innerHTML = `<i data-lucide="key" width="14" height="14"></i> ${activeV.ignition ? "ENCENDIDO" : "APAGADO"}`;
                            }
                            if (kpiSpeed && activeV) {
                                kpiSpeed.style.color = activeV.isMoving ? 'var(--c-moving)' : 'var(--text-2)';
                                kpiSpeed.innerHTML = `<i data-lucide="gauge" width="14" height="14"></i> ${activeV.speed} km/h`;
                            }
                            if (window.lucide) lucide.createIcons();
                        }
                    }
                }, () => {});
            }
        }, 10000);
    };

    // ── Vincular Eventos de Búsqueda y Refresco de Página ──────────
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
                
                const icon = btnRefresh.querySelector("i");
                if (icon) {
                    icon.style.transition = "transform 0.8s ease";
                    icon.style.transform = "rotate(360deg)";
                }

                setTimeout(() => {
                    if (icon) icon.style.transform = "none";
                    btnRefresh.disabled = false;
                }, 800);

                if (isDemoMode) {
                    loadDemoDevices();
                } else {
                    loadDevices();
                }
            });
        }
    };

    // ── Standalone Fallback ──────────────────────────────────────
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

    // ── Retornar API del Add-In ──────────────────────────────────
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
            },
            blur() {
                if (telemetryTimer) clearInterval(telemetryTimer);
            }
        };
    };

})();
