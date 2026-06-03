"use strict";

window.geotab      = window.geotab      || {};
geotab.addin       = geotab.addin       || {};

geotab.addin.paro_motor = (function () {

    // ── Estado global del add-in ──────────────────────────────────
    let api            = null;
    let isDemoMode     = false;
    let isInitialized  = false;

    let allVehicles    = [];   // [{ id, name, plate, type, speed, isMoving, outputState, ignition }]
    let selectedIds    = new Set();
    let telemetryTimer = null;

    const SECURITY_PIN = "1234";
    let pinBuffer      = "";
    let pendingAction  = "";   // "stop" | "restore"

    // ── Flota simulada para Modo Demo ─────────────────────────────
    const MOCK_VEHICLES = [
        { id:"pm-1", name:"Carga Pesada Volvo FH", plate:"XT-982-A", type:"Tractocamión", speed:0,  isMoving:false, outputState:0, ignition:false },
        { id:"pm-2", name:"Logística Kenworth T680", plate:"YU-114-K", type:"Tractocamión", speed:74, isMoving:true,  outputState:0, ignition:true  },
        { id:"pm-3", name:"Distribución Isuzu Elf",  plate:"MZ-339-C", type:"Caja Seca",    speed:0,  isMoving:false, outputState:0, ignition:true  },
        { id:"pm-4", name:"Supervisión Ford F-150", plate:"LE-402-Q", type:"Pickup",       speed:0,  isMoving:false, outputState:0, ignition:false },
        { id:"pm-5", name:"Reparto Mercedes Sprinter", plate:"DF-778-F", type:"Van",         speed:0,  isMoving:false, outputState:1, ignition:false },
        { id:"pm-6", name:"Ruta Escolta RAM 2500", plate:"PL-015-S", type:"Pickup",       speed:0,  isMoving:false, outputState:0, ignition:false }
    ];

    // ── Notificaciones flotantes (Toasts) ──────────────────────────
    const showToast = (message, type = "info") => {
        const wrap = document.getElementById("toast-wrap");
        if (!wrap) return;
        
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        
        const icons = { 
            success: "check-circle", 
            error: "alert-octagon", 
            info: "info" 
        };
        
        el.innerHTML = `
            <i data-lucide="${icons[type] || "info"}" width="18" height="18"></i>
            <span>${message}</span>
        `;
        
        wrap.appendChild(el);
        if (window.lucide) lucide.createIcons();
        
        // Animación de entrada
        setTimeout(() => el.classList.add("show"), 10);
        
        // Auto-eliminar después de 4.5 segundos
        setTimeout(() => { 
            el.classList.remove("show"); 
            setTimeout(() => el.remove(), 350); 
        }, 4500);
    };

    // ── Actualización de KPIs en la cabecera ──────────────────────
    const updateKPIs = () => {
        const activos   = allVehicles.filter(v => v.isMoving || (v.ignition && v.outputState === 0)).length;
        const detenidos = allVehicles.filter(v => v.outputState === 1).length;
        const inactivos = allVehicles.length - activos - detenidos;

        const setVal = (id, val) => { 
            const el = document.getElementById(id); 
            if (el) el.textContent = val; 
        };

        setVal("kpi-activos",   `${activos} activo${activos !== 1 ? "s" : ""}`);
        setVal("kpi-inactivos", `${inactivos} inactivo${inactivos !== 1 ? "s" : ""}`);
        setVal("kpi-detenidos", `${detenidos} detenido${detenidos !== 1 ? "s" : ""}`);
    };

    // ── Renderizado dinámico de tarjetas ──────────────────────────
    const renderCards = (filterText = "") => {
        const grid = document.getElementById("vehicles-grid");
        if (!grid) return;

        const query = filterText.toLowerCase().trim();
        const list = query
            ? allVehicles.filter(v => 
                v.name.toLowerCase().includes(query) || 
                v.plate.toLowerCase().includes(query) || 
                v.type.toLowerCase().includes(query)
              )
            : allVehicles;

        if (list.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1">
                    <i data-lucide="search" width="48" height="48"></i>
                    <p>No se encontraron unidades en la búsqueda.</p>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        grid.innerHTML = list.map(v => {
            const isSelected = selectedIds.has(v.id);
            const isStopped  = v.outputState === 1;
            const isMoving   = v.isMoving;

            // Determinar estados y etiquetas
            let statusClass = "inactive";
            let statusLabel = "Inactivo";

            if (isStopped) {
                statusClass = "stopped";
                statusLabel = "Motor Detenido";
            } else if (isMoving) {
                statusClass = "moving";
                statusLabel = `En Movimiento (${v.speed} km/h)`;
            } else if (v.ignition) {
                statusClass = "active";
                statusLabel = "Motor Encendido";
            }

            return `
                <div class="vehicle-card ${isSelected ? "selected" : ""} ${isMoving ? "moving" : ""}"
                     data-id="${v.id}" role="checkbox" aria-checked="${isSelected}" tabindex="0">
                    <div class="card-top">
                        <span class="card-unit-id">${v.plate}</span>
                        <div class="card-checkbox">
                            <i data-lucide="check" width="12" height="12" style="color:#fff; stroke-width:3"></i>
                        </div>
                    </div>
                    <div>
                        <div class="card-name">${v.name}</div>
                        <div class="card-tags">
                            <span class="tag">${v.type}</span>
                            ${isStopped ? '<span class="tag" style="color:var(--c-stopped); border-color:rgba(239,68,68,0.25); background:rgba(239,68,68,0.1)">🔒 Paro Activo</span>' : ''}
                        </div>
                    </div>
                    <div class="card-status ${statusClass}">
                        <span class="status-dot"></span>
                        ${statusLabel}
                    </div>
                    ${isMoving ? `<div class="moving-overlay"><span class="moving-chip">⚡ En tránsito — Bloqueado</span></div>` : ""}
                </div>
            `;
        }).join("");

        if (window.lucide) lucide.createIcons();
        updateActionBar();
        updateKPIs();

        // Agregar listeners a las tarjetas
        grid.querySelectorAll(".vehicle-card:not(.moving)").forEach(card => {
            const id = card.dataset.id;
            card.addEventListener("click", () => toggleSelect(id));
            card.addEventListener("keydown", (e) => {
                if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggleSelect(id);
                }
            });
        });
    };

    // ── Selección de unidades ─────────────────────────────────────
    const toggleSelect = (id) => {
        if (selectedIds.has(id)) {
            selectedIds.delete(id);
        } else {
            selectedIds.add(id);
        }

        const card = document.querySelector(`.vehicle-card[data-id="${id}"]`);
        if (card) {
            card.classList.toggle("selected", selectedIds.has(id));
        }
        updateActionBar();
    };

    const selectAll = () => {
        const selectable = allVehicles.filter(v => !v.isMoving);
        const allSelected = selectable.every(v => selectedIds.has(v.id));

        if (allSelected) {
            selectable.forEach(v => selectedIds.delete(v.id));
        } else {
            selectable.forEach(v => selectedIds.add(v.id));
        }

        renderCards(document.getElementById("search-input")?.value || "");
    };

    // ── Barra de acción inferior ──────────────────────────────────
    const updateActionBar = () => {
        const count = selectedIds.size;
        const countEl = document.getElementById("sel-count");
        const hintEl  = document.getElementById("sel-hint");
        const stopBtn = document.getElementById("btn-stop-motor");

        if (countEl) {
            countEl.innerHTML = `<span>${count}</span> seleccionada${count !== 1 ? "s" : ""}`;
        }
        if (hintEl) {
            hintEl.textContent = count === 0 
                ? "Selecciona unidades para enviar comandos de paro o restablecimiento" 
                : "Confirmación requerida para transmitir comandos.";
        }

        if (!stopBtn) return;
        stopBtn.classList.remove("armed", "restore");

        if (count === 0) {
            stopBtn.innerHTML = `<i data-lucide="power" width="16" height="16"></i> PARO DE MOTOR`;
            stopBtn.disabled = true;
            if (window.lucide) lucide.createIcons();
            return;
        }

        stopBtn.disabled = false;

        // Si todas las seleccionadas están bajo paro activo -> Modo restablecer
        const selVehicles = allVehicles.filter(v => selectedIds.has(v.id));
        const allStopped  = selVehicles.every(v => v.outputState === 1);

        if (allStopped) {
            stopBtn.classList.add("restore");
            stopBtn.innerHTML = `<i data-lucide="unlock" width="16" height="16"></i> RESTABLECER MOTOR`;
        } else {
            stopBtn.classList.add("armed");
            stopBtn.innerHTML = `<i data-lucide="shield-alert" width="16" height="16"></i> DETENER MOTOR`;
        }
        if (window.lucide) lucide.createIcons();
    };

    // ── Cargar dispositivos reales desde Geotab API ───────────────
    const loadDevices = () => {
        showLoading("Sincronizando con Geotab...", "Consultando flota de vehículos...");

        api.multiCall([
            ["Get", { typeName: "Device" }],
            ["Get", { typeName: "DeviceStatusInfo" }]
        ], (results) => {
            hideLoading();
            const devices = results[0] || [];
            const statuses = results[1] || [];

            // Mapeo id -> status
            const statusMap = {};
            statuses.forEach(s => { statusMap[s.device.id] = s; });

            allVehicles = devices
                .filter(d => d.id !== "b0") // excluir dispositivo raíz virtual
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(d => {
                    const s = statusMap[d.id] || {};
                    const speed = Math.round(s.speed || 0);
                    return {
                        id:          d.id,
                        name:        d.name,
                        plate:       d.licensePlate || d.serialNumber || d.id.substring(0, 6),
                        type:        d.vehicleType || "Vehículo",
                        speed:       speed,
                        isMoving:    s.isDeviceMoving || speed > 0,
                        ignition:    s.isDeviceCommunicating || speed > 0,
                        outputState: 0 // El estado de paro real IOX se consulta bajo demanda o comando
                    };
                });

            renderCards();
            startTelemetryPoll();
            showToast(`${allVehicles.length} unidades vinculadas correctamente.`, "success");
        }, (err) => {
            hideLoading();
            console.error("Error al cargar unidades Geotab:", err);
            showToast("Error al obtener la flota de Geotab: " + err, "error");
        });
    };

    // ── Polling de Telemetría Real ────────────────────────────────
    const startTelemetryPoll = () => {
        if (telemetryTimer) clearInterval(telemetryTimer);
        
        telemetryTimer = setInterval(() => {
            if (isDemoMode || !api) return;
            
            api.call("Get", { typeName: "DeviceStatusInfo" }, (results) => {
                (results || []).forEach(s => {
                    const v = allVehicles.find(x => x.id === s.device.id);
                    if (v) {
                        const speed = Math.round(s.speed || 0);
                        v.speed    = speed;
                        v.isMoving = s.isDeviceMoving || speed > 0;
                        v.ignition = s.isDeviceCommunicating || speed > 0;
                    }
                });
                updateKPIs();
                renderCards(document.getElementById("search-input")?.value || "");
            }, (err) => {
                console.error("Error en telemetría en tiempo real:", err);
            });
        }, 10000); // 10 segundos
    };

    // ── Carga en Modo Demo Standalone ─────────────────────────────
    const loadDemoDevices = () => {
        allVehicles = MOCK_VEHICLES.map(v => ({ ...v }));
        renderCards();
        showToast("Inicializado en Modo Demo (Simulado).", "info");
    };

    // ── Apertura y Cierre de Modal de Confirmación ────────────────
    const openConfirmModal = () => {
        const selVehicles = allVehicles.filter(v => selectedIds.has(v.id));
        if (selVehicles.length === 0) return;

        const allStopped = selVehicles.every(v => v.outputState === 1);
        pendingAction = allStopped ? "restore" : "stop";

        // Reset PIN
        pinBuffer = "";
        updatePinDots();
        
        const checkbox = document.getElementById("compliance-checkbox");
        if (checkbox) checkbox.checked = false;

        const titleEl    = document.getElementById("modal-title");
        const summaryEl  = document.getElementById("modal-summary");
        const confirmBtn = document.getElementById("btn-confirm-modal");

        if (pendingAction === "stop") {
            if (titleEl) titleEl.innerHTML = `<i data-lucide="shield-alert" width="20" height="20" style="color:var(--c-stopped)"></i> Confirmar Paro de Motor`;
            if (summaryEl) {
                summaryEl.className = "selected-summary";
                summaryEl.innerHTML = `
                    <strong>⚠ COMANDO DE PARO CRÍTICO (SetOutput:1):</strong> Se transmitirá la orden de apertura de circuito a las unidades:<br>
                    <div class="selected-names">${selVehicles.map(v => v.name).join(" · ")}</div>
                `;
            }
            if (confirmBtn) {
                confirmBtn.className = "btn-confirm-modal";
                confirmBtn.textContent = "Ejecutar Paro";
            }
        } else {
            if (titleEl) titleEl.innerHTML = `<i data-lucide="unlock" width="20" height="20" style="color:var(--c-moving)"></i> Confirmar Restablecimiento`;
            if (summaryEl) {
                summaryEl.className = "selected-summary restore";
                summaryEl.innerHTML = `
                    <strong>RECONECTAR CIRCUITO (SetOutput:0):</strong> Se enviará el comando para permitir el encendido regular de las unidades:<br>
                    <div class="selected-names">${selVehicles.map(v => v.name).join(" · ")}</div>
                `;
            }
            if (confirmBtn) {
                confirmBtn.className = "btn-confirm-modal restore-mode";
                confirmBtn.textContent = "Restablecer Motor";
            }
        }

        if (window.lucide) lucide.createIcons();

        const modal = document.getElementById("pin-modal");
        if (modal) modal.classList.add("open");
    };

    const closeModal = () => {
        const modal = document.getElementById("pin-modal");
        if (modal) modal.classList.remove("open");
        pinBuffer = "";
        updatePinDots();
    };

    // ── Teclado numérico PIN ──────────────────────────────────────
    const pressKey = (key) => {
        if (key === "clear") {
            pinBuffer = pinBuffer.slice(0, -1);
        } else if (key === "cancel") {
            closeModal();
            return;
        } else if (pinBuffer.length < 4) {
            pinBuffer += key;
        }
        
        updatePinDots();

        // Autoprocesar si el PIN llega a 4 dígitos
        if (pinBuffer.length === 4) {
            setTimeout(executeAction, 200);
        }
    };

    const updatePinDots = () => {
        document.querySelectorAll(".pin-dot").forEach((dot, i) => {
            dot.classList.toggle("filled", i < pinBuffer.length);
        });
    };

    // ── Ejecución de Comandos (Paro o Restablecer) ────────────────
    const executeAction = () => {
        const checkbox = document.getElementById("compliance-checkbox");
        if (checkbox && !checkbox.checked) {
            showToast("Por seguridad, debes confirmar la casilla de verificación de ubicación segura.", "error");
            pinBuffer = "";
            updatePinDots();
            return;
        }

        if (pinBuffer !== SECURITY_PIN) {
            showToast("PIN de Autorización Incorrecto.", "error");
            pinBuffer = "";
            updatePinDots();
            return;
        }

        closeModal();

        const isStopping = pendingAction === "stop";
        const cmdText    = isStopping ? "SetOutput:1" : "SetOutput:0";
        const selVehicles = allVehicles.filter(v => selectedIds.has(v.id));

        showLoading(
            isStopping ? "TRANSMITIENDO COMANDO DE PARO..." : "RESTABLECIENDO CIRCUITOS...",
            "Conectando con la pasarela celular de Geotab..."
        );

        if (isDemoMode) {
            // Animación secuencial en modo demo
            const stages = [
                { t: 600,  sub: "Encolando comando TextCommand en base de datos local..." },
                { t: 1500, sub: "Buscando enlace satelital / celular con el hardware GO..." },
                { t: 2400, sub: `Comando "${cmdText}" ejecutado por el relevador IOX-OUTPUTM.` }
            ];

            stages.forEach(stage => {
                setTimeout(() => {
                    const subEl = document.getElementById("loading-sub");
                    if (subEl) subEl.textContent = stage.sub;
                }, stage.t);
            });

            setTimeout(() => {
                hideLoading();
                selVehicles.forEach(v => { v.outputState = isStopping ? 1 : 0; });
                selectedIds.clear();
                renderCards();
                showToast(
                    isStopping
                        ? `Paro de motor activado con éxito en ${selVehicles.length} unidad(es).`
                        : `Comando de restablecimiento enviado en ${selVehicles.length} unidad(es).`,
                    "success"
                );
            }, 3000);

        } else {
            // Envío real a la API de Geotab
            const calls = selVehicles.map(v => ["Add", {
                typeName: "TextCommand",
                entity: { 
                    device: { id: v.id }, 
                    text: cmdText 
                }
            }]);

            api.multiCall(calls, (results) => {
                hideLoading();
                selVehicles.forEach(v => { v.outputState = isStopping ? 1 : 0; });
                selectedIds.clear();
                renderCards();
                showToast(
                    isStopping
                        ? `Comando de paro encolado correctamente en ${selVehicles.length} unidad(es).`
                        : `Comando de restablecimiento encolado en ${selVehicles.length} unidad(es).`,
                    "success"
                );
            }, (err) => {
                hideLoading();
                console.error("Error al transmitir comandos por Geotab API:", err);
                showToast("Fallo al enviar comandos: " + err, "error");
            });
        }
    };

    // ── Pantalla de Carga (Overlay) ───────────────────────────────
    const showLoading = (title, subtitle) => {
        const overlay = document.getElementById("loading-overlay");
        const mainText = document.getElementById("loading-main");
        const subText  = document.getElementById("loading-sub");

        if (mainText) mainText.textContent = title;
        if (subText) subText.textContent = subtitle;
        if (overlay) overlay.style.display = "flex";
    };

    const hideLoading = () => {
        const overlay = document.getElementById("loading-overlay");
        if (overlay) overlay.style.display = "none";
    };

    // ── Vincular Eventos de Entrada del DOM ────────────────────────
    const bindEvents = () => {
        if (bindEvents._isBound) return;
        bindEvents._isBound = true;

        // Botón Seleccionar Todas
        const selectAllBtn = document.getElementById("btn-select-all");
        if (selectAllBtn) {
            selectAllBtn.addEventListener("click", selectAll);
        }

        // Búsqueda
        const searchInput = document.getElementById("search-input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => renderCards(e.target.value));
        }

        // Botón Principal Detener/Restablecer
        const stopBtn = document.getElementById("btn-stop-motor");
        if (stopBtn) {
            stopBtn.addEventListener("click", openConfirmModal);
        }

        // Cierre de Modal
        document.querySelectorAll(".modal-close, .btn-cancel-modal").forEach(btn => {
            btn.addEventListener("click", closeModal);
        });

        // Confirmar Modal
        const confirmBtn = document.getElementById("btn-confirm-modal");
        if (confirmBtn) {
            confirmBtn.addEventListener("click", executeAction);
        }

        // Numpad de PIN
        document.querySelectorAll(".key[data-key]").forEach(keyBtn => {
            keyBtn.addEventListener("click", () => pressKey(keyBtn.dataset.key));
        });
    };

    // ── Carga inicial fuera del portal (Standalone) ────────────────
    document.addEventListener("DOMContentLoaded", () => {
        if (window.lucide) lucide.createIcons();

        // Si en 600ms no ha sido inicializado por Geotab, cargar modo demo
        setTimeout(() => {
            if (!isInitialized) {
                isDemoMode = true;
                const badge = document.getElementById("mode-badge");
                const badgeText = document.getElementById("mode-text");
                
                if (badge) badge.dataset.mode = "demo";
                if (badgeText) badgeText.textContent = "Demo Standalone";

                bindEvents();
                loadDemoDevices();
            }
        }, 600);
    });

    // ── Hook del Add-In para MyGeotab ──────────────────────────────
    return function () {
        return {
            initialize(geotabApi, state, callback) {
                isInitialized = true;
                api = geotabApi;
                isDemoMode = false;

                const badge = document.getElementById("mode-badge");
                const badgeText = document.getElementById("mode-text");
                
                if (badge) badge.dataset.mode = "live";
                if (badgeText) badgeText.textContent = "Geotab Live";

                bindEvents();
                loadDevices();

                if (callback) callback();
            },
            focus(geotabApi, state) {
                api = geotabApi;
                if (window.lucide) lucide.createIcons();
            },
            blur() {
                if (telemetryTimer) {
                    clearInterval(telemetryTimer);
                    telemetryTimer = null;
                }
            }
        };
    };

})();
