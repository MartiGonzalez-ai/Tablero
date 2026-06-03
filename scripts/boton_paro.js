/* 
 * ═══════════════════════════════════════════════════════════════
 * BOTON_PARO.JS — Fleet Control | Motor Stop Panel
 * Geotab Add-In | geotab.addin.boton_paro
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

window.geotab      = window.geotab      || {};
geotab.addin       = geotab.addin       || {};

geotab.addin.boton_paro = (function () {

    // ── Estado global ────────────────────────────────────────────
    let api            = null;
    let isDemoMode     = false;
    let isInitialized  = false;

    let allVehicles    = [];   // [{ id, name, plate, type, speed, isMoving, outputState }]
    let selectedIds    = new Set();
    let telemetryTimer = null;

    const SECURITY_PIN = "1234";
    let pinBuffer      = "";
    let pendingAction  = "";   // "stop" | "restore"

    // ── Datos simulados ──────────────────────────────────────────
    const MOCK_VEHICLES = [
        { id:"b101", name:"Volvo 01",     plate:"YUC-001", type:"Camión",       speed:0,  isMoving:false, outputState:0, ignition:false  },
        { id:"b102", name:"Kenworth 02",  plate:"YUC-022", type:"Tractocamión", speed:62, isMoving:true,  outputState:0, ignition:true   },
        { id:"b103", name:"Ford 03",      plate:"YUC-183", type:"Pickup",       speed:0,  isMoving:false, outputState:0, ignition:false  },
        { id:"b104", name:"Isuzu 04",     plate:"YUC-214", type:"Caja seca",    speed:0,  isMoving:false, outputState:0, ignition:true   },
        { id:"b105", name:"Mercedes 05",  plate:"YUC-300", type:"Camión",       speed:0,  isMoving:false, outputState:0, ignition:false  },
        { id:"b106", name:"RAM 06",       plate:"YUC-411", type:"Pickup",       speed:0,  isMoving:false, outputState:1, ignition:false  },
    ];

    // ── Toast ────────────────────────────────────────────────────
    const toast = (msg, type = "info") => {
        const wrap = document.getElementById("toast-wrap");
        if (!wrap) return;
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        const icons = { success: "check-circle", error: "alert-octagon", info: "info" };
        el.innerHTML = `<i data-lucide="${icons[type]||"info"}" width="16" height="16"></i><span>${msg}</span>`;
        wrap.appendChild(el);
        if (window.lucide) lucide.createIcons();
        setTimeout(() => el.classList.add("show"), 10);
        setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 4500);
    };

    // ── KPI Header ───────────────────────────────────────────────
    const updateKPIs = () => {
        const activos   = allVehicles.filter(v => v.isMoving || (v.ignition && v.outputState === 0)).length;
        const detenidos = allVehicles.filter(v => v.outputState === 1).length;
        const inactivos = allVehicles.length - activos - detenidos;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set("kpi-activos",   activos   + " activo"   + (activos   !== 1 ? "s" : ""));
        set("kpi-inactivos", inactivos + " inactivo" + (inactivos !== 1 ? "s" : ""));
        set("kpi-detenidos", detenidos + " detenido" + (detenidos !== 1 ? "s" : ""));
    };

    // ── Renderizar tarjetas ──────────────────────────────────────
    const renderCards = (filter = "") => {
        const grid = document.getElementById("vehicles-grid");
        if (!grid) return;

        const q = filter.toLowerCase().trim();
        const list = q
            ? allVehicles.filter(v => v.name.toLowerCase().includes(q) || v.plate.toLowerCase().includes(q) || v.type.toLowerCase().includes(q))
            : allVehicles;

        if (list.length === 0) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
                <i data-lucide="search" width="48" height="48"></i>
                <p>No se encontraron unidades.</p>
            </div>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        grid.innerHTML = list.map(v => {
            const isSelected = selectedIds.has(v.id);
            const isStopped  = v.outputState === 1;
            const isMoving   = v.isMoving;

            // Determinar clase CSS de estado
            let statusClass, statusLabel;
            if (isStopped) {
                statusClass = "stopped"; statusLabel = "Motor Detenido";
            } else if (isMoving) {
                statusClass = "moving"; statusLabel = `En Movimiento (${v.speed} km/h)`;
            } else if (v.ignition) {
                statusClass = "active"; statusLabel = "Motor Activo";
            } else {
                statusClass = "inactive"; statusLabel = "Inactivo";
            }

            const canSelect = !isMoving;

            return `
            <div class="vehicle-card${isSelected ? " selected" : ""}${isMoving ? " moving" : ""}"
                 data-id="${v.id}" role="checkbox" aria-checked="${isSelected}" tabindex="0">
                <div class="card-top">
                    <span class="card-unit-id">${v.plate}</span>
                    <div class="card-checkbox">
                        <i data-lucide="check" width="11" height="11" style="color:#fff;stroke-width:3"></i>
                    </div>
                </div>
                <div class="card-name">${v.name}</div>
                <div class="card-tags">
                    <span class="tag">${v.plate}</span>
                    <span class="tag">${v.type}</span>
                    ${isStopped ? '<span class="tag" style="color:var(--c-stopped);border-color:rgba(239,68,68,0.25);background:rgba(239,68,68,0.1)">🔒 IOX Bloqueado</span>' : ""}
                </div>
                <div class="card-status ${statusClass}">
                    <span class="status-dot"></span>
                    ${statusLabel.toUpperCase()}
                </div>
                ${isMoving ? `<div class="moving-overlay"><span class="moving-chip">⚡ En tránsito — no disponible</span></div>` : ""}
            </div>`;
        }).join("");

        if (window.lucide) lucide.createIcons();
        updateActionBar();
        updateKPIs();

        // Vincular eventos de clic a las tarjetas
        grid.querySelectorAll(".vehicle-card:not(.moving)").forEach(card => {
            card.addEventListener("click", () => toggleSelect(card.dataset.id));
            card.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleSelect(card.dataset.id); } });
        });
    };

    const toggleSelect = (id) => {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);

        const card = document.querySelector(`.vehicle-card[data-id="${id}"]`);
        if (card) card.classList.toggle("selected", selectedIds.has(id));

        updateActionBar();
    };

    const selectAll = () => {
        const canSelect = allVehicles.filter(v => !v.isMoving);
        const allSel = canSelect.every(v => selectedIds.has(v.id));

        if (allSel) {
            canSelect.forEach(v => selectedIds.delete(v.id));
        } else {
            canSelect.forEach(v => selectedIds.add(v.id));
        }

        renderCards(document.getElementById("search-input")?.value || "");
    };

    // ── Barra de Acción Inferior ─────────────────────────────────
    const updateActionBar = () => {
        const count = selectedIds.size;
        const countEl = document.getElementById("sel-count");
        const hintEl  = document.getElementById("sel-hint");
        const stopBtn = document.getElementById("btn-stop-motor");

        if (countEl) countEl.innerHTML = `<span>${count}</span> seleccionada${count !== 1 ? "s" : ""}`;
        if (hintEl)  hintEl.textContent = count === 0 ? "Selecciona una o más unidades para continuar" : `Listas para enviar comando de paro`;

        if (!stopBtn) return;
        stopBtn.classList.remove("armed", "restore");

        if (count === 0) {
            stopBtn.textContent = "DETENER MOTOR";
            stopBtn.disabled = true;
            return;
        }

        stopBtn.disabled = false;

        // Si todas las seleccionadas están detenidas → modo restore
        const selVehicles = allVehicles.filter(v => selectedIds.has(v.id));
        const allStopped  = selVehicles.every(v => v.outputState === 1);

        if (allStopped) {
            stopBtn.classList.add("restore");
            stopBtn.innerHTML = `<i data-lucide="unlock" width="16" height="16"></i> RESTABLECER MOTOR`;
        } else {
            stopBtn.classList.add("armed");
            stopBtn.innerHTML = `<i data-lucide="square" width="16" height="16"></i> DETENER MOTOR`;
        }
        if (window.lucide) lucide.createIcons();
    };

    // ── Cargar dispositivos reales ───────────────────────────────
    const loadDevices = () => {
        showLoading("Cargando flota desde Geotab...", "Consultando dispositivos y estado...");

        // Llamada múltiple: Devices + DeviceStatusInfo
        api.multiCall([
            ["Get", { typeName: "Device" }],
            ["Get", { typeName: "DeviceStatusInfo" }]
        ], (results) => {
            hideLoading();
            const devices = results[0] || [];
            const statuses = results[1] || [];

            // Mapa rápido id -> statusInfo
            const statusMap = {};
            statuses.forEach(s => { statusMap[s.device.id] = s; });

            allVehicles = devices
                .filter(d => d.id !== "b0") // excluir dispositivo raíz
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
                        outputState: 0 // El estado IOX se consulta por separado si se requiere
                    };
                });

            renderCards();
            startTelemetryPoll();
            toast(`${allVehicles.length} unidades cargadas.`, "success");
        }, (err) => {
            hideLoading();
            console.error("Error cargando flota:", err);
            toast("Error al cargar unidades: " + err, "error");
        });
    };

    // ── Telemetría en Polling ────────────────────────────────────
    const startTelemetryPoll = () => {
        if (telemetryTimer) clearInterval(telemetryTimer);
        telemetryTimer = setInterval(() => {
            if (isDemoMode) return;
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
            }, () => {});
        }, 10000); // Cada 10 segundos
    };

    // ── Demo mode ────────────────────────────────────────────────
    const loadDemoDevices = () => {
        allVehicles = MOCK_VEHICLES.map(v => ({ ...v }));
        renderCards();
        toast("Flota simulada cargada (Modo Demo).", "info");
    };

    // ── Modal de confirmación + PIN ──────────────────────────────
    const openConfirmModal = () => {
        const selVehicles = allVehicles.filter(v => selectedIds.has(v.id));
        const allStopped  = selVehicles.every(v => v.outputState === 1);
        pendingAction = allStopped ? "restore" : "stop";

        pinBuffer = "";
        updatePinDots();
        const checkbox = document.getElementById("compliance-checkbox");
        if (checkbox) checkbox.checked = false;

        const summaryEl  = document.getElementById("modal-summary");
        const confirmBtn = document.getElementById("btn-confirm-modal");
        const titleEl    = document.getElementById("modal-title");

        if (pendingAction === "stop") {
            if (titleEl) titleEl.textContent = "Confirmar Paro de Motor";
            if (summaryEl) {
                summaryEl.className = "selected-summary";
                summaryEl.innerHTML = `
                    <strong>⚠ OPERACIÓN CRÍTICA:</strong> Se enviará el comando <code>SetOutput:1</code> vía celular a:<br>
                    <div class="selected-names">${selVehicles.map(v => v.name).join(" · ")}</div>
                `;
            }
            if (confirmBtn) { confirmBtn.className = "btn-confirm-modal"; confirmBtn.textContent = "Ejecutar Paro"; }
        } else {
            if (titleEl) titleEl.textContent = "Confirmar Restablecimiento";
            if (summaryEl) {
                summaryEl.className = "selected-summary restore";
                summaryEl.innerHTML = `
                    Se enviará el comando <code>SetOutput:0</code> para reconectar el circuito en:<br>
                    <div class="selected-names">${selVehicles.map(v => v.name).join(" · ")}</div>
                `;
            }
            if (confirmBtn) { confirmBtn.className = "btn-confirm-modal restore-mode"; confirmBtn.textContent = "Restablecer Motor"; }
        }

        const modal = document.getElementById("pin-modal");
        if (modal) modal.classList.add("open");
    };

    const closeModal = () => {
        const modal = document.getElementById("pin-modal");
        if (modal) modal.classList.remove("open");
        pinBuffer = "";
        updatePinDots();
    };

    const pressKey = (key) => {
        if (key === "clear")  { pinBuffer = pinBuffer.slice(0, -1); }
        else if (key === "cancel") { closeModal(); return; }
        else if (pinBuffer.length < 4) { pinBuffer += key; }
        updatePinDots();
    };

    const updatePinDots = () => {
        document.querySelectorAll(".pin-dot").forEach((dot, i) => {
            dot.classList.toggle("filled", i < pinBuffer.length);
        });
    };

    const executeAction = () => {
        const checked = document.getElementById("compliance-checkbox")?.checked;
        if (!checked) { toast("Debe confirmar la casilla de seguridad.", "error"); return; }
        if (pinBuffer !== SECURITY_PIN) {
            toast("PIN incorrecto. Inténtelo de nuevo.", "error");
            pinBuffer = ""; updatePinDots(); return;
        }

        closeModal();

        const isStopping = pendingAction === "stop";
        const cmdText    = isStopping ? "SetOutput:1" : "SetOutput:0";
        const selVehicles = allVehicles.filter(v => selectedIds.has(v.id));

        showLoading(
            isStopping ? "ENVIANDO COMANDO DE PARO..." : "RESTABLECIENDO CIRCUITO...",
            `Transmitiendo a ${selVehicles.length} unidad${selVehicles.length > 1 ? "es" : ""}...`
        );

        if (isDemoMode) {
            // Simular latencia celular
            const steps = [
                { t:600,  txt:"Encolando TextCommand en base de datos Geotab..." },
                { t:1400, txt:"Transmitiendo por red celular a dispositivos GO..." },
                { t:2200, txt:`Comando "${cmdText}" recibido. Activando relevadores IOX-OUTPUTM...` }
            ];
            steps.forEach(s => setTimeout(() => {
                const sub = document.getElementById("loading-sub");
                if (sub) sub.textContent = s.txt;
            }, s.t));

            setTimeout(() => {
                hideLoading();
                selVehicles.forEach(v => { v.outputState = isStopping ? 1 : 0; });
                selectedIds.clear();
                renderCards();
                toast(
                    isStopping
                        ? `${selVehicles.length} unidad${selVehicles.length > 1 ? "es detenidas" : " detenida"} correctamente.`
                        : `Motor restablecido en ${selVehicles.length} unidad${selVehicles.length > 1 ? "es" : ""}.`,
                    "success"
                );
            }, 2800);

        } else {
            // Envío real en paralelo a todas las unidades seleccionadas
            const calls = selVehicles.map(v => ["Add", {
                typeName: "TextCommand",
                entity: { device: { id: v.id }, text: cmdText }
            }]);

            api.multiCall(calls, (results) => {
                console.log("Comandos enviados:", results);
                hideLoading();
                selVehicles.forEach(v => { v.outputState = isStopping ? 1 : 0; });
                selectedIds.clear();
                renderCards();
                toast(
                    isStopping
                        ? `Comando de paro encolado en ${selVehicles.length} unidad${selVehicles.length > 1 ? "es" : ""}.`
                        : `Restablecimiento encolado en ${selVehicles.length} unidad${selVehicles.length > 1 ? "es" : ""}.`,
                    "success"
                );
            }, (err) => {
                hideLoading();
                console.error("Error multiCall:", err);
                toast("Error al enviar comandos: " + err, "error");
            });
        }
    };

    // ── Helpers de Loading ───────────────────────────────────────
    const showLoading = (main, sub) => {
        const ov = document.getElementById("loading-overlay");
        if (!ov) return;
        document.getElementById("loading-main").textContent = main;
        document.getElementById("loading-sub").textContent  = sub;
        ov.style.display = "flex";
    };

    const hideLoading = () => {
        const ov = document.getElementById("loading-overlay");
        if (ov) ov.style.display = "none";
    };

    // ── Vincular eventos del DOM ─────────────────────────────────
    const bindEvents = () => {
        if (bindEvents._done) return;
        bindEvents._done = true;

        // Seleccionar todas
        const btnAll = document.getElementById("btn-select-all");
        if (btnAll) btnAll.addEventListener("click", selectAll);

        // Búsqueda
        const searchInput = document.getElementById("search-input");
        if (searchInput) searchInput.addEventListener("input", e => renderCards(e.target.value));

        // Botón detener / restablecer
        const stopBtn = document.getElementById("btn-stop-motor");
        if (stopBtn) stopBtn.addEventListener("click", openConfirmModal);

        // Modal: cerrar
        document.querySelectorAll(".modal-close, .btn-cancel-modal").forEach(btn => {
            btn.addEventListener("click", closeModal);
        });

        // Confirmar acción
        const confirmBtn = document.getElementById("btn-confirm-modal");
        if (confirmBtn) confirmBtn.addEventListener("click", executeAction);

        // Teclado numérico (data-key)
        document.querySelectorAll(".key[data-key]").forEach(btn => {
            btn.addEventListener("click", () => pressKey(btn.dataset.key));
        });
    };

    // ── Standalone Fallback (abierto fuera del portal) ───────────
    document.addEventListener("DOMContentLoaded", () => {
        if (window.lucide) lucide.createIcons();

        setTimeout(() => {
            if (!isInitialized) {
                isDemoMode = true;
                const modeBadge = document.getElementById("mode-badge");
                if (modeBadge) { modeBadge.dataset.mode = "demo"; document.getElementById("mode-text").textContent = "Demo (Standalone)"; }
                bindEvents();
                loadDemoDevices();
            }
        }, 600);
    });

    // ── Retornar API del Add-In para MyGeotab ────────────────────
    return function () {
        return {
            initialize (geotabApi, state, callback) {
                isInitialized = true;
                api = geotabApi;
                isDemoMode = false;

                const modeBadge = document.getElementById("mode-badge");
                if (modeBadge) { modeBadge.dataset.mode = "live"; document.getElementById("mode-text").textContent = "Geotab Live"; }

                bindEvents();
                loadDevices();
                if (callback) callback();
            },
            focus (geotabApi, state) {
                api = geotabApi;
                if (window.lucide) lucide.createIcons();
            },
            blur () {
                if (telemetryTimer) clearInterval(telemetryTimer);
            }
        };
    };

})();
