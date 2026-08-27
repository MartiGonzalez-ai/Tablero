/* 
 * ═══════════════════════════════════════════════════════════════
 * PARO_MOTOR.JS — Fleet Control | Motor Stop Panel
 * Geotab Add-In | geotab.addin.boton_paro
 * Cargado por: boton_paro.html (GitHub Pages) y paro_motor.html (local)
 * NOTA: El namespace es boton_paro para que Geotab pueda inicializarlo
 *       desde boton_paro.html. El add-in deriva el nombre del HTML.
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

window.geotab = window.geotab || {};
geotab.addin = geotab.addin || {};

geotab.addin.boton_paro = (function () {

    // ── Estado global ────────────────────────────────────────────
    let api = null;
    let isDemoMode = false;
    let isInitialized = false;

    let allVehicles = [];   // [{ id, name, plate, type, speed, isMoving, outputState }]
    let selectedIds = new Set();
    let telemetryTimer = null;
    let activeVehicleId = null;
    let activeHistoryRecords = [];

    const SECURITY_PIN = "1234";
    let pinBuffer = "";
    let pendingAction = "";   // "stop" | "restore"

    // ── Lista de correos autorizados ─────────────────────────────
    // Agrega o elimina correos aquí para controlar el acceso al add-in.
    const ALLOWED_EMAILS = [
        "mgonzalez@enerkom.com.mx",
        "admin@enerkom.com.mx",
        "supervisor@enerkom.com.mx"
        // Agrega más correos aquí...
    ];

    // ── Control de Acceso ────────────────────────────────────────
    const checkAccess = (email) => {
        if (!email) return false;
        return ALLOWED_EMAILS.some(allowed => allowed.toLowerCase() === email.toLowerCase());
    };

    const showAccessDenied = (email) => {
        // Ocultar todo el contenido principal
        const mainContent = document.getElementById("app-root") || document.querySelector(".app-shell") || document.body.firstElementChild;
        
        // Ocultar todos los hijos directos del body excepto toast-wrap
        document.querySelectorAll("body > *:not(#toast-wrap):not(#access-denied-screen)").forEach(el => {
            el.style.display = "none";
        });

        // Crear pantalla de acceso denegado si no existe
        if (!document.getElementById("access-denied-screen")) {
            const screen = document.createElement("div");
            screen.id = "access-denied-screen";
            screen.style.cssText = [
                "position:fixed","inset:0","display:flex","align-items:center",
                "justify-content:center","flex-direction:column","gap:1.5rem",
                "background:var(--bg-1,#0f1117)","z-index:99999",
                "font-family:'Inter',sans-serif","text-align:center","padding:2rem"
            ].join(";");

            screen.innerHTML = `
                <div style="
                    background:rgba(239,68,68,0.08);
                    border:1px solid rgba(239,68,68,0.25);
                    border-radius:20px;
                    padding:3rem 2.5rem;
                    max-width:480px;
                    width:100%;
                    display:flex;
                    flex-direction:column;
                    align-items:center;
                    gap:1.25rem;
                    box-shadow:0 0 60px rgba(239,68,68,0.08);
                ">
                    <div style="
                        width:72px;height:72px;border-radius:50%;
                        background:rgba(239,68,68,0.12);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(239,68,68,0.3);
                    ">
                        <svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'
                             viewBox='0 0 24 24' fill='none' stroke='#ef4444'
                             stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
                            <circle cx='12' cy='12' r='10'/>
                            <line x1='4.93' y1='4.93' x2='19.07' y2='19.07'/>
                        </svg>
                    </div>
                    <div>
                        <h2 style="margin:0 0 0.5rem;font-size:1.4rem;font-weight:700;color:#ef4444;letter-spacing:-0.01em;">
                            Add-In No Disponible
                        </h2>
                        <p style="margin:0;font-size:0.95rem;color:rgba(255,255,255,0.6);line-height:1.6;">
                            Tu cuenta (<strong style='color:rgba(255,255,255,0.85);'>${email || 'desconocido'}</strong>)
                            no tiene acceso a este panel de control.
                        </p>
                    </div>
                    <div style="
                        background:rgba(255,255,255,0.04);
                        border:1px solid rgba(255,255,255,0.08);
                        border-radius:10px;
                        padding:0.85rem 1.25rem;
                        font-size:0.82rem;
                        color:rgba(255,255,255,0.45);
                        display:flex;
                        align-items:center;
                        gap:0.6rem;
                    ">
                        <svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'
                             viewBox='0 0 24 24' fill='none' stroke='currentColor'
                             stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
                            <circle cx='12' cy='12' r='10'/>
                            <line x1='12' y1='8' x2='12' y2='12'/>
                            <line x1='12' y1='16' x2='12.01' y2='16'/>
                        </svg>
                        Habla con tu administrador para solicitar acceso.
                    </div>
                </div>
            `;
            document.body.appendChild(screen);
        }
    };

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
        "DiagnosticDeviceRelayStateId": { name: "Relay de Paro de Motor", type: "output" },
        "DiagnosticDigitalOutput1StateId": { name: "Salida Digital 1 (Cable Amarillo)", type: "output" },
        "DiagnosticDigitalOutput2StateId": { name: "Salida Digital 2", type: "output" },
        "DiagnosticDigitalOutput3StateId": { name: "Salida Digital 3", type: "output" },
        "DiagnosticDigitalOutput4StateId": { name: "Salida Digital 4", type: "output" },
        
        "DiagnosticDigitalInput1StateId": { name: "Entrada Digital 1", type: "input" },
        "DiagnosticDigitalInput2StateId": { name: "Entrada Digital 2", type: "input" },
        "DiagnosticDigitalInput3StateId": { name: "Entrada Digital 3", type: "input" },
        "DiagnosticDigitalInput4StateId": { name: "Entrada Digital 4", type: "input" },
        "DiagnosticDigitalInput5StateId": { name: "Entrada Digital 5", type: "input" },
        "DiagnosticDigitalInput6StateId": { name: "Entrada Digital 6", type: "input" },
        "DiagnosticDigitalInput7StateId": { name: "Entrada Digital 7", type: "input" },
        "DiagnosticDigitalInput8StateId": { name: "Entrada Digital 8", type: "input" },
        
        "DiagnosticAux1Id": { name: "Entrada Auxiliar 1", type: "input" },
        "DiagnosticAux2Id": { name: "Entrada Auxiliar 2", type: "input" },
        "DiagnosticAux3Id": { name: "Entrada Auxiliar 3", type: "input" },
        "DiagnosticAux4Id": { name: "Entrada Auxiliar 4", type: "input" },
        "DiagnosticAux5Id": { name: "Entrada Auxiliar 5", type: "input" },
        "DiagnosticAux6Id": { name: "Entrada Auxiliar 6", type: "input" },
        "DiagnosticAux7Id": { name: "Entrada Auxiliar 7", type: "input" },
        "DiagnosticAux8Id": { name: "Entrada Auxiliar 8", type: "input" },
        
        "DiagnosticIgnitionId": { name: "Estado de Ignición (Motor)", type: "ignition" }
    };

    // ── Datos simulados ──────────────────────────────────────────
    const MOCK_VEHICLES = [
        { id: "b101", name: "Volvo 01", plate: "YUC-001", type: "Camión", speed: 0, isMoving: false, outputState: 0, ignition: false },
        { id: "b102", name: "Kenworth 02", plate: "YUC-022", type: "Tractocamión", speed: 62, isMoving: true, outputState: 0, ignition: true },
        { id: "b103", name: "Ford 03", plate: "YUC-183", type: "Pickup", speed: 0, isMoving: false, outputState: 0, ignition: false },
        { id: "b104", name: "Isuzu 04", plate: "YUC-214", type: "Caja seca", speed: 0, isMoving: false, outputState: 0, ignition: true },
        { id: "b105", name: "Mercedes 05", plate: "YUC-300", type: "Camión", speed: 0, isMoving: false, outputState: 0, ignition: false },
        { id: "b106", name: "RAM 06", plate: "YUC-411", type: "Pickup", speed: 0, isMoving: false, outputState: 1, ignition: false },
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
        setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 4500);
    };

    // ── KPI Header & Usuario ───────────────────────────────────────
    const loadCurrentUser = () => {
        const emailEl = document.getElementById("user-email-display");
        if (!emailEl) return;

        if (api && typeof api.getSession === "function") {
            api.getSession(function (session, server) {
                if (session && session.userName) {
                    emailEl.textContent = session.userName;
                    emailEl.title = `Usuario: ${session.userName} | Servidor: ${server || window.location.hostname || ''} | Base de datos: ${session.database || ''}`;
                } else {
                    emailEl.textContent = "mgonzalez@enerkom.com.mx";
                }
            });
        } else {
            emailEl.textContent = "mgonzalez@enerkom.com.mx";
            emailEl.title = "Modo Demo: mgonzalez@enerkom.com.mx";
        }
    };

    const updateKPIs = () => {
        const activos = allVehicles.filter(v => v.isMoving || (v.ignition && v.outputState === 0)).length;
        const detenidos = allVehicles.filter(v => v.outputState === 1).length;
        const inactivos = allVehicles.length - activos - detenidos;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set("kpi-activos", activos + " activo" + (activos !== 1 ? "s" : ""));
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
            const isStopped = v.outputState === 1;
            const isMoving = v.isMoving;

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
                ${isMoving ? `<div class="moving-overlay"><span class="moving-chip">⚡ En tránsito — Ver I/O</span></div>` : ""}
            </div>`;
        }).join("");

        if (window.lucide) lucide.createIcons();
        updateActionBar();
        updateKPIs();

        // Vincular eventos de clic y teclado a las tarjetas
        grid.querySelectorAll(".vehicle-card").forEach(card => {
            card.addEventListener("click", (e) => {
                const isCheckbox = e.target.closest(".card-checkbox");
                if (isCheckbox) {
                    e.stopPropagation();
                    toggleSelect(card.dataset.id);
                } else {
                    openVehicleDrawer(card.dataset.id);
                }
            });

            card.addEventListener("keydown", e => {
                if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    // Si presionan espacio en la tarjeta (o enter en el checkbox), se selecciona.
                    // Si presionan enter en el cuerpo de la tarjeta, se abre el drawer.
                    const isCheckbox = e.target.closest(".card-checkbox");
                    if (e.key === " " || isCheckbox) {
                        toggleSelect(card.dataset.id);
                    } else {
                        openVehicleDrawer(card.dataset.id);
                    }
                }
            });
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
        const canSelect = allVehicles;
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
        const hintEl = document.getElementById("sel-hint");
        const stopBtn = document.getElementById("btn-stop-motor");

        if (countEl) countEl.innerHTML = `<span>${count}</span> seleccionada${count !== 1 ? "s" : ""}`;
        if (hintEl) hintEl.textContent = count === 0 ? "Selecciona una o más unidades para continuar" : `Listas para enviar comando de paro`;

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
        const allStopped = selVehicles.every(v => v.outputState === 1);

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
                        id: d.id,
                        name: d.name,
                        plate: d.licensePlate || d.serialNumber || d.id.substring(0, 6),
                        type: d.vehicleType || "Vehículo",
                        speed: speed,
                        isMoving: s.isDeviceMoving || speed > 0,
                        ignition: s.isDeviceCommunicating || speed > 0,
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
                        v.speed = speed;
                        v.isMoving = s.isDeviceMoving || speed > 0;
                        v.ignition = s.isDeviceCommunicating || speed > 0;
                    }
                });
                updateKPIs();
                renderCards(document.getElementById("search-input")?.value || "");
            }, () => { });
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
        const allStopped = selVehicles.every(v => v.outputState === 1);
        pendingAction = allStopped ? "restore" : "stop";

        pinBuffer = "";
        updatePinDots();
        const checkbox = document.getElementById("compliance-checkbox");
        if (checkbox) checkbox.checked = false;

        const summaryEl = document.getElementById("modal-summary");
        const confirmBtn = document.getElementById("btn-confirm-modal");
        const titleEl = document.getElementById("modal-title");

        if (pendingAction === "stop") {
            if (titleEl) titleEl.textContent = "Confirmar Paro de Motor";
            const movingVehicles = selVehicles.filter(v => v.isMoving);
            let movingNotice = "";
            if (movingVehicles.length > 0) {
                movingNotice = `
                    <div style="margin-top:0.5rem; padding:0.4rem 0.6rem; border-radius:6px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); font-size:0.75rem; color:var(--c-moving);">
                        ⚡ <strong>Aviso:</strong> ${movingVehicles.length} unidad${movingVehicles.length > 1 ? 'es se encuentran' : ' se encuentra'} en movimiento. El paro se ejecutará de inmediato.
                    </div>
                `;
            }
            if (summaryEl) {
                summaryEl.className = "selected-summary";
                summaryEl.innerHTML = `
                    <strong>⚠ OPERACIÓN CRÍTICA:</strong> Se enviará el comando <code>SetOutput:1</code> vía celular a:<br>
                    <div class="selected-names">${selVehicles.map(v => `${v.name}${v.isMoving ? ` (⚡ ${v.speed} km/h)` : ''}`).join(" · ")}</div>
                    ${movingNotice}
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
        if (key === "clear") { pinBuffer = pinBuffer.slice(0, -1); }
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
        const cmdText = isStopping ? "SetOutput:1" : "SetOutput:0";
        const selVehicles = allVehicles.filter(v => selectedIds.has(v.id));

        showLoading(
            isStopping ? "ENVIANDO COMANDO DE PARO..." : "RESTABLECIENDO CIRCUITO...",
            `Transmitiendo a ${selVehicles.length} unidad${selVehicles.length > 1 ? "es" : ""}...`
        );

        if (isDemoMode) {
            // Simular latencia celular
            const steps = [
                { t: 600, txt: "Encolando TextCommand en base de datos Geotab..." },
                { t: 1400, txt: "Transmitiendo por red celular a dispositivos GO..." },
                { t: 2200, txt: `Comando "${cmdText}" recibido. Activando relevadores IOX-OUTPUTM...` }
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
            // La API de Geotab usa typeName "TextMessage" con messageContent IoxOutput
            const calls = selVehicles.map(v => ["Add", {
                typeName: "TextMessage",
                entity: {
                    device: { id: v.id },
                    messageContent: {
                        contentType: "IoxOutput",
                        isRelayOn: isStopping   // true = paro (relay ON), false = restablecer (relay OFF)
                    },
                    isDirectionToVehicle: true
                }
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
        document.getElementById("loading-sub").textContent = sub;
        ov.style.display = "flex";
    };

    const hideLoading = () => {
        const ov = document.getElementById("loading-overlay");
        if (ov) ov.style.display = "none";
    };

    // ── Lógica de Fechas y Rangos de Tiempo ──────────────────────────
    const formatDateToISOString = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const getDateRangeFromSelect = (rangeValue) => {
        const toDate = new Date();
        let fromDate = new Date();
        
        switch (rangeValue) {
            case "24h":
                fromDate.setHours(fromDate.getHours() - 24);
                break;
            case "3d":
                fromDate.setDate(fromDate.getDate() - 3);
                break;
            case "7d":
                fromDate.setDate(fromDate.getDate() - 7);
                break;
            case "30d":
                fromDate.setDate(fromDate.getDate() - 30);
                break;
            case "custom":
                const fromEl = document.getElementById("drawer-date-from");
                const toEl = document.getElementById("drawer-date-to");
                if (fromEl && fromEl.value) {
                    fromDate = new Date(fromEl.value + "T00:00:00");
                } else {
                    fromDate.setDate(fromDate.getDate() - 7);
                }
                if (toEl && toEl.value) {
                    toDate = new Date(toEl.value + "T23:59:59");
                }
                break;
        }
        return { fromDate, toDate };
    };

    // ── Generar Historial Simulado (Modo Demo) ───────────────────────
    const generateMockHistory = (deviceId, fromDate, toDate) => {
        const history = [];
        const v = allVehicles.find(x => x.id === deviceId);
        const isStopped = v ? v.outputState === 1 : false;
        
        const diffMs = toDate.getTime() - fromDate.getTime();
        // Generar entre 2 y 6 eventos para dar una apariencia realista
        const numEvents = Math.floor(Math.random() * 4) + 2; 
        
        let currentState = isStopped ? 1 : 0;
        let currentMs = toDate.getTime() - (Math.random() * (diffMs / numEvents) * 0.3); // comenzar poco antes del fin
        
        for (let i = 0; i < numEvents; i++) {
            if (currentMs < fromDate.getTime()) break;
            
            history.push({
                data: currentState,
                dateTime: new Date(currentMs).toISOString(),
                device: { id: deviceId },
                diagnostic: { id: "DiagnosticDeviceRelayStateId" }
            });
            
            // alternar estados retrocediendo en el tiempo
            currentState = currentState === 1 ? 0 : 1;
            // restar tiempo aleatorio
            currentMs -= (Math.random() * (diffMs / numEvents) * 0.8) + (diffMs / numEvents) * 0.4;
        }
        
        return history;
    };

    // ── Lógica del Drawer de Diagnóstico I/O e Historial ─────────────
    const openVehicleDrawer = (deviceId) => {
        activeVehicleId = deviceId;
        const v = allVehicles.find(x => x.id === deviceId);
        if (!v) return;

        const nameEl = document.getElementById("drawer-veh-name");
        const plateEl = document.getElementById("drawer-veh-plate");
        const overlay = document.getElementById("drawer-overlay");
        const drawer = document.getElementById("vehicle-drawer");

        if (nameEl) nameEl.textContent = v.name;
        if (plateEl) plateEl.textContent = `${v.plate} · ${v.type}`;

        // Resetear elementos del filtro
        const timeRangeSel = document.getElementById("drawer-time-range");
        const customDatesDiv = document.getElementById("drawer-custom-dates");
        const dateFromInput = document.getElementById("drawer-date-from");
        const dateToInput = document.getElementById("drawer-date-to");
        const btnDownload = document.getElementById("btn-download-history");
        const ioDetails = document.getElementById("drawer-io-details");

        if (timeRangeSel) timeRangeSel.value = "24h";
        if (customDatesDiv) customDatesDiv.style.display = "none";
        
        // Inicializar selectores de fecha personalizados
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 7);
        if (dateFromInput) dateFromInput.value = formatDateToISOString(pastDate);
        if (dateToInput) dateToInput.value = formatDateToISOString(today);

        if (btnDownload) btnDownload.disabled = true;
        if (ioDetails) ioDetails.removeAttribute("open"); // cerrar acordeón

        activeHistoryRecords = [];

        if (overlay) overlay.classList.add("open");
        if (drawer) drawer.classList.add("open");

        // Consultar datos de historial y telemetría
        fetchVehicleDiagnostics(deviceId);
    };

    const closeVehicleDrawer = () => {
        activeVehicleId = null;
        const overlay = document.getElementById("drawer-overlay");
        const drawer = document.getElementById("vehicle-drawer");
        if (overlay) overlay.classList.remove("open");
        if (drawer) drawer.classList.remove("open");
    };

    const fetchVehicleDiagnostics = (deviceId) => {
        const historyListEl = document.getElementById("drawer-history-list");
        const ioListEl = document.getElementById("drawer-io-list");
        const badgeEl = document.getElementById("drawer-motor-badge");
        const statusTextEl = document.getElementById("drawer-motor-status-text");

        // Mostrar loaders en las subsecciones
        if (historyListEl) {
            historyListEl.innerHTML = `
                <div class="drawer-loading" style="padding: 1.5rem 0;">
                    <i data-lucide="loader" width="24" height="24" style="animation: spin 1s linear infinite;"></i>
                    <p style="font-size:0.8rem; margin-top:0.5rem;">Cargando historial...</p>
                </div>
            `;
        }
        if (ioListEl) {
            ioListEl.innerHTML = `
                <div class="drawer-loading" style="padding: 1.5rem 0;">
                    <i data-lucide="loader" width="24" height="24" style="animation: spin 1s linear infinite;"></i>
                    <p style="font-size:0.8rem; margin-top:0.5rem;">Cargando diagnósticos...</p>
                </div>
            `;
        }
        if (badgeEl) badgeEl.className = "drawer-motor-badge status-unknown";
        if (statusTextEl) statusTextEl.textContent = "CONSULTANDO...";
        if (window.lucide) lucide.createIcons();

        if (isDemoMode) {
            // Modo Demo: Simular respuesta telemática
            setTimeout(() => {
                if (activeVehicleId !== deviceId) return; // Se cerró o cambió de dispositivo

                const mockResults = {};
                // Generar datos aleatorios coherentes
                IO_DIAGNOSTICS.forEach(diagId => {
                    const isRelay = diagId === "DiagnosticDeviceRelayStateId";
                    const isOut1 = diagId === "DiagnosticDigitalOutput1StateId";
                    const isIn1 = diagId === "DiagnosticDigitalInput1StateId";
                    const isIgnition = diagId === "DiagnosticIgnitionId";
                    
                    let hasData = false;
                    let value = 0;
                    
                    if (deviceId === "b101") {
                        if (isRelay || isOut1 || isIn1) { hasData = true; value = 1; }
                        else if (isIgnition) { hasData = true; value = 0; }
                        else if (diagId === "DiagnosticAux1Id") { hasData = true; value = 0; }
                    } else if (deviceId === "b106") {
                        if (isRelay || isOut1) { hasData = true; value = 1; }
                        else if (isIgnition) { hasData = true; value = 0; }
                        else if (isIn1) { hasData = true; value = 0; }
                    } else if (deviceId === "b102") {
                        if (isIgnition) { hasData = true; value = 1; }
                        else if (isRelay || isOut1 || isIn1 || diagId === "DiagnosticAux1Id") { hasData = true; value = 0; }
                    } else {
                        const vObj = allVehicles.find(x => x.id === deviceId);
                        if (isIgnition) { hasData = true; value = (vObj && vObj.ignition) ? 1 : 0; }
                        else if (isRelay || isOut1) { hasData = true; value = (vObj && vObj.outputState === 1) ? 1 : 0; }
                        else if (isIn1 || diagId === "DiagnosticAux1Id") { hasData = true; value = 0; }
                    }

                    if (hasData) {
                        mockResults[diagId] = {
                            value: value,
                            dateTime: new Date(Date.now() - Math.random() * 3600000).toISOString()
                        };
                    }
                });

                const range = getDateRangeFromSelect(document.getElementById("drawer-time-range")?.value || "24h");
                const mockHistory = generateMockHistory(deviceId, range.fromDate, range.toDate);

                renderHistoryAndDiagnostics(mockResults, mockHistory);
            }, 750);
        } else {
            // Modo Live: Consulta real al API de Geotab
            const range = getDateRangeFromSelect(document.getElementById("drawer-time-range")?.value || "24h");
            
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

            // Agregar consulta histórica usando TextMessage (comandos IoxOutput enviados)
            calls.push([
                "Get",
                {
                    typeName: "TextMessage",
                    search: {
                        deviceSearch: { id: deviceId },
                        fromDate: range.fromDate.toISOString(),
                        toDate: range.toDate.toISOString(),
                        isDirectionToVehicle: true
                    }
                }
            ]);

            api.multiCall(calls, (results) => {
                if (activeVehicleId !== deviceId) return;

                const processedResults = {};
                IO_DIAGNOSTICS.forEach((diagId, idx) => {
                    const records = results[idx] || [];
                    if (records.length > 0) {
                        const record = records[0];
                        processedResults[diagId] = {
                            value: record.data,
                            dateTime: record.dateTime
                        };
                    }
                });

                // Filtrar solo mensajes IoxOutput del historial TextMessage
                const allTextMessages = results[IO_DIAGNOSTICS.length] || [];
                const historyRecords = allTextMessages
                    .filter(msg => msg.messageContent && msg.messageContent.contentType === "IoxOutput")
                    .map(msg => ({
                        // Normalizar estructura para que renderHistoryAndDiagnostics la entienda
                        data: msg.messageContent.isRelayOn ? 1 : 0,
                        dateTime: msg.sent || msg.activeFrom,
                        delivered: msg.delivered,
                        device: msg.device,
                        id: msg.id
                    }));

                renderHistoryAndDiagnostics(processedResults, historyRecords);
            }, (err) => {
                console.error("Error al consultar diagnósticos I/O:", err);
                if (historyListEl) {
                    historyListEl.innerHTML = `
                        <div class="drawer-no-data">
                            <i data-lucide="alert-triangle" width="24" height="24" style="color:var(--c-stopped);"></i>
                            <p>Error de comunicación con Geotab al consultar historial.</p>
                            <span>${err.message || err}</span>
                        </div>
                    `;
                }
                if (ioListEl) {
                    ioListEl.innerHTML = `
                        <div class="drawer-no-data">
                            <i data-lucide="alert-triangle" width="24" height="24" style="color:var(--c-stopped);"></i>
                            <p>Error de comunicación con Geotab al consultar diagnósticos actuales.</p>
                        </div>
                    `;
                }
                if (window.lucide) lucide.createIcons();
            });
        }
    };

    const renderHistoryAndDiagnostics = (currentDiags, historyRecords) => {
        // 1. Actualizar Badge de Estado Rápido
        const badgeEl = document.getElementById("drawer-motor-badge");
        const statusTextEl = document.getElementById("drawer-motor-status-text");

        let relayState = null;
        if (currentDiags["DiagnosticDeviceRelayStateId"] !== undefined) {
            relayState = currentDiags["DiagnosticDeviceRelayStateId"].value;
        } else {
            const v = allVehicles.find(x => x.id === activeVehicleId);
            if (v) relayState = v.outputState;
        }

        if (badgeEl && statusTextEl) {
            badgeEl.className = "drawer-motor-badge";
            if (relayState === 1 || relayState === true) {
                badgeEl.classList.add("status-locked");
                statusTextEl.textContent = "BLOQUEADO (PARO ACTIVO)";
            } else if (relayState === 0 || relayState === false) {
                badgeEl.classList.add("status-unlocked");
                statusTextEl.textContent = "RESTABLECIDO (PARO INACTIVO)";
            } else {
                badgeEl.classList.add("status-unknown");
                statusTextEl.textContent = "SIN INFORMACIÓN";
            }
        }

        // 1.1 Actualizar Botón de Acción Directa en Drawer
        const drawerMotorBtn = document.getElementById("btn-drawer-motor");
        if (drawerMotorBtn) {
            const isLocked = relayState === 1 || relayState === true;
            if (isLocked) {
                drawerMotorBtn.className = "btn-drawer-motor restore";
                drawerMotorBtn.innerHTML = `<i data-lucide="unlock" width="14" height="14"></i><span>RESTABLECER MOTOR</span>`;
            } else {
                drawerMotorBtn.className = "btn-drawer-motor";
                drawerMotorBtn.innerHTML = `<i data-lucide="square" width="14" height="14"></i><span>DETENER MOTOR</span>`;
            }
            if (window.lucide) lucide.createIcons();
        }

        // 2. Guardar registros del historial cargado
        activeHistoryRecords = [...historyRecords];

        // 3. Activar/Desactivar botón de descarga
        const downloadBtn = document.getElementById("btn-download-history");
        if (downloadBtn) {
            downloadBtn.disabled = historyRecords.length === 0;
        }

        // 4. Renderizar lista del historial (Línea de Tiempo)
        const historyListEl = document.getElementById("drawer-history-list");
        if (historyListEl) {
            if (historyRecords.length === 0) {
                historyListEl.innerHTML = `
                    <div class="drawer-no-data" style="padding: 2rem 1rem;">
                        <i data-lucide="info" width="24" height="24"></i>
                        <p style="font-size: 0.8rem; margin-top: 0.5rem;">No se encontraron cambios en el paro de motor para este período.</p>
                    </div>
                `;
            } else {
                // Ordenar más recientes primero
                const sortedRecords = [...historyRecords].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
                
                historyListEl.innerHTML = sortedRecords.map(rec => {
                    const isActive = rec.data === 1 || rec.data === true;
                    const cardClass = isActive ? "active-shutoff" : "inactive-shutoff";
                    const statusText = isActive ? "Paro de Motor" : "Motor Restablecido";
                    const statusIcon = isActive ? "lock" : "unlock";
                    const iconColor = isActive ? "var(--c-stopped)" : "var(--c-active)";

                    // Estado de entrega del TextMessage
                    let deliveryBadge = "";
                    if (rec.delivered === true) {
                        deliveryBadge = `<span style="font-size:0.68rem; padding:0.15rem 0.45rem; border-radius:4px; background:rgba(34,197,94,0.12); color:var(--c-active); border:1px solid rgba(34,197,94,0.2);">✓ Entregado</span>`;
                    } else if (rec.delivered === false) {
                        deliveryBadge = `<span style="font-size:0.68rem; padding:0.15rem 0.45rem; border-radius:4px; background:rgba(245,158,11,0.12); color:var(--c-moving); border:1px solid rgba(245,158,11,0.2);">⏳ Pendiente</span>`;
                    }
                    
                    return `
                        <div class="history-card ${cardClass}">
                            <div class="history-card-top">
                                <span class="history-card-title" style="color: ${iconColor}">
                                    <i data-lucide="${statusIcon}" width="14" height="14"></i>
                                    ${statusText}
                                </span>
                                <span class="history-card-time">${formatTime(rec.dateTime)}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.72rem; color:var(--text-2); margin-top:0.35rem;">
                                <span>Comando IoxOutput enviado vía Geotab (Relay: ${isActive ? '1' : '0'}).</span>
                                ${deliveryBadge}
                            </div>
                        </div>
                    `;
                }).join("");
            }
        }

        // 5. Renderizar diagnósticos I/O actuales dentro del acordeón
        const ioListEl = document.getElementById("drawer-io-list");
        if (ioListEl) {
            const outputs = [];
            const inputs = [];
            
            Object.entries(currentDiags).forEach(([diagId, info]) => {
                const labelMeta = DIAG_LABELS[diagId];
                if (!labelMeta) return;

                const item = {
                    id: diagId,
                    name: labelMeta.name,
                    value: info.value,
                    dateTime: info.dateTime
                };

                if (labelMeta.type === "output") {
                    outputs.push(item);
                } else if (labelMeta.type === "input" || labelMeta.type === "ignition") {
                    inputs.push(item);
                }
            });

            outputs.sort((a, b) => b.value - a.value);
            inputs.sort((a, b) => b.value - a.value);

            let html = "";
            if (outputs.length > 0) {
                html += `
                    <div class="drawer-section" style="padding: 0 1rem 0.5rem 1rem;">
                        <h3 class="drawer-section-title">
                            <i data-lucide="arrow-right" width="13" height="13"></i>
                            Salidas de Control / Relays (${outputs.length})
                        </h3>
                        <div class="drawer-list">
                            ${outputs.map(renderItemHTML).join("")}
                        </div>
                    </div>
                `;
            }

            if (inputs.length > 0) {
                html += `
                    <div class="drawer-section" style="padding: 0.5rem 1rem 0 1rem;">
                        <h3 class="drawer-section-title">
                            <i data-lucide="arrow-left" width="13" height="13"></i>
                            Entradas Digitales / Sensores (${inputs.length})
                        </h3>
                        <div class="drawer-list">
                            ${inputs.map(renderItemHTML).join("")}
                        </div>
                    </div>
                `;
            }

            if (outputs.length === 0 && inputs.length === 0) {
                html = `
                    <div class="drawer-no-data" style="margin: 0 1rem; border: none; background: transparent;">
                        <i data-lucide="help-circle" width="24" height="24"></i>
                        <p style="font-size:0.78rem;">No hay diagnósticos I/O disponibles.</p>
                    </div>
                `;
            }

            ioListEl.innerHTML = html;
        }

        if (window.lucide) lucide.createIcons();
    };

    const formatTime = (isoString) => {
        if (!isoString) return "";
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

    const renderItemHTML = (item) => {
        const isActive = item.value === 1 || item.value === true;
        let badgeClass = "inactive";
        let badgeText = "INACTIVO";
        let iconColor = "var(--text-3)";
        
        if (isActive) {
            if (item.id === "DiagnosticDeviceRelayStateId" || item.id.includes("Output")) {
                badgeClass = "active-red";
                badgeText = "ACTIVO (1)";
                iconColor = "var(--c-stopped)";
            } else {
                badgeClass = "active-green";
                badgeText = "ACTIVO (1)";
                iconColor = "var(--c-active)";
            }
        } else {
            badgeText = "INACTIVO (0)";
        }

        // Seleccionar icono lucide adecuado
        let iconName = "arrow-right-circle";
        if (item.id === "DiagnosticDeviceRelayStateId") iconName = "cpu";
        else if (item.id === "DiagnosticIgnitionId") iconName = "key";
        else if (item.id.includes("Input")) iconName = "arrow-left-circle";
        else if (item.id.includes("Aux")) iconName = "activity";

        return `
            <div class="drawer-item">
                <div class="drawer-item-info">
                    <div class="drawer-item-icon" style="color: ${iconColor}; border-color: ${isActive ? 'rgba(255,255,255,0.08)' : 'var(--border)'}">
                        <i data-lucide="${iconName}" width="16" height="16"></i>
                    </div>
                    <div class="drawer-item-texts">
                        <span class="drawer-item-name">${item.name}</span>
                        <span class="drawer-item-id">${item.id}</span>
                    </div>
                </div>
                <div class="drawer-item-meta">
                    <span class="drawer-badge ${badgeClass}">
                        <span class="drawer-badge-dot"></span>
                        ${badgeText}
                    </span>
                    <span class="drawer-item-time" title="Hora de lectura telemática">${formatTime(item.dateTime)}</span>
                </div>
            </div>
        `;
    };

    // ── Buscar Coordenadas Más Cercanas ──────────────────────────────
    const findNearestCoordinates = (eventTime, logRecords) => {
        if (!logRecords || logRecords.length === 0) return null;
        const targetMs = new Date(eventTime).getTime();
        
        let closestRecord = logRecords[0];
        let minDiff = Math.abs(new Date(closestRecord.dateTime).getTime() - targetMs);
        
        for (let i = 1; i < logRecords.length; i++) {
            const currentRecord = logRecords[i];
            if (!currentRecord.dateTime) continue;
            
            const diff = Math.abs(new Date(currentRecord.dateTime).getTime() - targetMs);
            if (diff < minDiff) {
                minDiff = diff;
                closestRecord = currentRecord;
            }
        }
        
        return {
            latitude: closestRecord.latitude,
            longitude: closestRecord.longitude
        };
    };

    // ── Descargar Historial a CSV (Individual) ───────────────────────
    const downloadHistoryCSV = () => {
        if (!activeVehicleId || activeHistoryRecords.length === 0) return;
        const v = allVehicles.find(x => x.id === activeVehicleId);
        const name = v ? v.name : "Unidad";
        const plate = v ? v.plate : "S-N";
        
        // Encabezados incluyendo coordenadas y mapa
        const headers = ["Vehículo", "Placa", "Fecha y Hora", "Evento", "Valor Relay", "Latitud", "Longitud", "Google Maps", "Diagnóstico"];
        
        // Filas
        const rows = activeHistoryRecords.map(rec => {
            const isActive = rec.data === 1 || rec.data === true;
            const eventText = isActive ? "ACTIVADO (PARO ACTIVO)" : "DESACTIVADO (RESTABLECIDO)";
            const formattedDate = formatTime(rec.dateTime).replace(",", ""); // quitar coma
            const lat = rec.latitude ? rec.latitude.toFixed(6) : "—";
            const lon = rec.longitude ? rec.longitude.toFixed(6) : "—";
            const mapsUrl = (rec.latitude && rec.longitude) ? `https://www.google.com/maps?q=${rec.latitude},${rec.longitude}` : "—";
            
            return [
                `"${name}"`,
                `"${plate}"`,
                `"${formattedDate}"`,
                `"${eventText}"`,
                rec.data,
                lat,
                lon,
                `"${mapsUrl}"`,
                `"Relay de Paro de Motor"`
            ];
        });
        
        // Unir CSV e incluir el BOM para correcta decodificación en Excel (caracteres en español)
        const csvContent = "\uFEFF" + [headers.join(",")].concat(rows.map(r => r.join(","))).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const filename = `Historial_Paro_${name.replace(/\s+/g, "_")}_${formatDateToISOString(new Date())}.csv`;
        
        if (navigator.msSaveBlob) { 
            navigator.msSaveBlob(blob, filename);
        } else {
            const link = document.createElement("a");
            if (link.download !== undefined) {
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
        
        toast(`Historial exportado correctamente a CSV.`, "success");
    };

    // ── Modal Historial General ──────────────────────────────────────
    const openGeneralHistoryModal = () => {
        const modal = document.getElementById("general-history-modal");
        const dateFromInput = document.getElementById("gen-date-from");
        const dateToInput = document.getElementById("gen-date-to");
        const unitsListEl = document.getElementById("modal-units-list");

        // Fechas por defecto: últimas 7 días
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 7);
        
        if (dateFromInput) dateFromInput.value = formatDateToISOString(pastDate);
        if (dateToInput) dateToInput.value = formatDateToISOString(today);

        // Rellenar checkboxes de unidades
        if (unitsListEl) {
            unitsListEl.innerHTML = allVehicles.map(v => `
                <label class="modal-unit-row">
                    <input type="checkbox" class="gen-unit-cb" value="${v.id}" checked>
                    <span>${v.name} (${v.plate})</span>
                </label>
            `).join("");
        }

        if (modal) modal.classList.add("open");
    };

    const closeGeneralHistoryModal = () => {
        const modal = document.getElementById("general-history-modal");
        if (modal) modal.classList.remove("open");
        // Limpiar buscador al cerrar
        const searchEl = document.getElementById("gen-unit-search");
        if (searchEl) searchEl.value = "";
    };

    // Filtrar checkboxes de unidades en tiempo real
    const filterGenUnits = (query) => {
        const q = query.trim().toLowerCase();
        document.querySelectorAll(".modal-unit-row").forEach(row => {
            const label = row.querySelector("span");
            if (!label) return;
            const text = label.textContent.toLowerCase();
            row.style.display = (!q || text.includes(q)) ? "" : "none";
        });
    };

    const selectAllGenCheckboxes = () => {
        document.querySelectorAll(".gen-unit-cb").forEach(cb => cb.checked = true);
    };

    const selectNoneGenCheckboxes = () => {
        document.querySelectorAll(".gen-unit-cb").forEach(cb => cb.checked = false);
    };

    // ── Descargar Historial Combinado (General) ──────────────────────
    const downloadGeneralHistory = () => {
        const dateFromEl = document.getElementById("gen-date-from");
        const dateToEl = document.getElementById("gen-date-to");
        const checkedBoxes = document.querySelectorAll(".gen-unit-cb:checked");
        
        if (checkedBoxes.length === 0) {
            toast("Debe seleccionar al menos una unidad.", "error");
            return;
        }

        const fromDate = dateFromEl && dateFromEl.value ? new Date(dateFromEl.value + "T00:00:00") : new Date(Date.now() - 7 * 86400000);
        const toDate = dateToEl && dateToEl.value ? new Date(dateToEl.value + "T23:59:59") : new Date();

        const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);

        showLoading(
            "GENERANDO HISTORIAL GENERAL...",
            `Consultando registros de ${selectedIds.length} unidad${selectedIds.length > 1 ? "es" : ""}...`
        );

        if (isDemoMode) {
            setTimeout(() => {
                const combinedRecords = [];
                
                selectedIds.forEach(id => {
                    const v = allVehicles.find(x => x.id === id);
                    const mockHistory = generateMockHistory(id, fromDate, toDate);
                    
                    mockHistory.forEach(rec => {
                        combinedRecords.push({
                            vehicleName: v ? v.name : "Desconocido",
                            vehiclePlate: v ? v.plate : "",
                            dateTime: rec.dateTime,
                            data: rec.data,
                            latitude: rec.latitude,
                            longitude: rec.longitude
                        });
                    });
                });

                // Ordenar por fecha descendente
                combinedRecords.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

                downloadCombinedCSV(combinedRecords);
                hideLoading();
                closeGeneralHistoryModal();
            }, 1000);
        } else {
            // Consulta paralela telemática y GPS vía Geotab API
            const calls = [];
            selectedIds.forEach(id => {
                // Estado del relay
                calls.push(["Get", {
                    typeName: "StatusData",
                    search: {
                        deviceSearch: { id: id },
                        diagnosticSearch: { id: "DiagnosticDeviceRelayStateId" },
                        fromDate: fromDate.toISOString(),
                        toDate: toDate.toISOString()
                    }
                }]);
                // GPS LogRecord
                calls.push(["Get", {
                    typeName: "LogRecord",
                    search: {
                        deviceSearch: { id: id },
                        fromDate: fromDate.toISOString(),
                        toDate: toDate.toISOString()
                    }
                }]);
            });

            api.multiCall(calls, (results) => {
                const combinedRecords = [];

                selectedIds.forEach((id, idx) => {
                    const statusResults = results[idx * 2] || [];
                    const logRecords = results[idx * 2 + 1] || [];
                    const v = allVehicles.find(x => x.id === id);
                    const name = v ? v.name : "Desconocido";
                    const plate = v ? v.plate : "";

                    statusResults.forEach(rec => {
                        const coords = findNearestCoordinates(rec.dateTime, logRecords);
                        combinedRecords.push({
                            vehicleName: name,
                            vehiclePlate: plate,
                            dateTime: rec.dateTime,
                            data: rec.data,
                            latitude: coords ? coords.latitude : null,
                            longitude: coords ? coords.longitude : null
                        });
                    });
                });

                combinedRecords.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

                downloadCombinedCSV(combinedRecords);
                hideLoading();
                closeGeneralHistoryModal();
            }, (err) => {
                hideLoading();
                console.error("Error al generar reporte general:", err);
                toast("Error al generar reporte general: " + err, "error");
            });
        }
    };

    const downloadCombinedCSV = (records) => {
        const headers = ["Vehículo", "Placa", "Fecha y Hora", "Evento", "Valor Relay", "Latitud", "Longitud", "Google Maps", "Diagnóstico"];
        
        const rows = records.map(rec => {
            const isActive = rec.data === 1 || rec.data === true;
            const eventText = isActive ? "ACTIVADO (PARO ACTIVO)" : "DESACTIVADO (RESTABLECIDO)";
            const formattedDate = formatTime(rec.dateTime).replace(",", "");
            const lat = rec.latitude ? rec.latitude.toFixed(6) : "—";
            const lon = rec.longitude ? rec.longitude.toFixed(6) : "—";
            const mapsUrl = (rec.latitude && rec.longitude) ? `https://www.google.com/maps?q=${rec.latitude},${rec.longitude}` : "—";

            return [
                `"${rec.vehicleName}"`,
                `"${rec.vehiclePlate}"`,
                `"${formattedDate}"`,
                `"${eventText}"`,
                rec.data,
                lat,
                lon,
                `"${mapsUrl}"`,
                `"Relay de Paro de Motor"`
            ];
        });

        const csvContent = "\uFEFF" + [headers.join(",")].concat(rows.map(r => r.join(","))).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const filename = `Historial_General_Paro_${formatDateToISOString(new Date())}.csv`;

        if (navigator.msSaveBlob) { 
            navigator.msSaveBlob(blob, filename);
        } else {
            const link = document.createElement("a");
            if (link.download !== undefined) {
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
        
        toast(`Historial general exportado correctamente a CSV (${records.length} registros).`, "success");
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

        // Cerrar drawer de unidad
        const btnCloseDrawer = document.getElementById("drawer-close");
        if (btnCloseDrawer) btnCloseDrawer.addEventListener("click", closeVehicleDrawer);

        const overlayDrawer = document.getElementById("drawer-overlay");
        if (overlayDrawer) overlayDrawer.addEventListener("click", closeVehicleDrawer);

        // Refrescar drawer de unidad
        const btnRefreshDrawer = document.getElementById("drawer-refresh");
        if (btnRefreshDrawer) {
            btnRefreshDrawer.addEventListener("click", () => {
                if (activeVehicleId) {
                    fetchVehicleDiagnostics(activeVehicleId);
                }
            });
        }

        // Filtro de rango de tiempo e inputs de fecha (Drawer)
        const timeRangeSel = document.getElementById("drawer-time-range");
        const customDatesDiv = document.getElementById("drawer-custom-dates");
        const dateFromInput = document.getElementById("drawer-date-from");
        const dateToInput = document.getElementById("drawer-date-to");
        const btnDownload = document.getElementById("btn-download-history");

        if (timeRangeSel) {
            timeRangeSel.addEventListener("change", (e) => {
                if (e.target.value === "custom") {
                    if (customDatesDiv) customDatesDiv.style.display = "grid";
                } else {
                    if (customDatesDiv) customDatesDiv.style.display = "none";
                    if (activeVehicleId) {
                        fetchVehicleDiagnostics(activeVehicleId);
                    }
                }
            });
        }

        if (dateFromInput) {
            dateFromInput.addEventListener("change", () => {
                if (activeVehicleId && timeRangeSel?.value === "custom") {
                    fetchVehicleDiagnostics(activeVehicleId);
                }
            });
        }

        if (dateToInput) {
            dateToInput.addEventListener("change", () => {
                if (activeVehicleId && timeRangeSel?.value === "custom") {
                    fetchVehicleDiagnostics(activeVehicleId);
                }
            });
        }

        if (btnDownload) {
            btnDownload.addEventListener("click", () => {
                if (activeVehicleId) {
                    downloadHistoryCSV();
                }
            });
        }

        // --- Botón de Acción Directa en Drawer ---
        const btnDrawerMotor = document.getElementById("btn-drawer-motor");
        if (btnDrawerMotor) {
            btnDrawerMotor.addEventListener("click", () => {
                if (activeVehicleId) {
                    selectedIds.clear();
                    selectedIds.add(activeVehicleId);
                    updateActionBar();
                    renderCards(document.getElementById("search-input")?.value || "");
                    openConfirmModal();
                }
            });
        }

        // --- Eventos del Historial General (Modal y Botones) ---
        const btnGeneralHistory = document.getElementById("btn-general-history");
        const btnGenCancel = document.getElementById("btn-gen-cancel");
        const btnGenClose = document.getElementById("gen-modal-close");
        const btnGenDownload = document.getElementById("btn-gen-download");
        const btnGenSelectAll = document.getElementById("btn-gen-select-all");
        const btnGenSelectNone = document.getElementById("btn-gen-select-none");

        if (btnGeneralHistory) btnGeneralHistory.addEventListener("click", openGeneralHistoryModal);
        if (btnGenCancel) btnGenCancel.addEventListener("click", closeGeneralHistoryModal);
        if (btnGenClose) btnGenClose.addEventListener("click", closeGeneralHistoryModal);
        if (btnGenDownload) btnGenDownload.addEventListener("click", downloadGeneralHistory);
        if (btnGenSelectAll) btnGenSelectAll.addEventListener("click", selectAllGenCheckboxes);
        if (btnGenSelectNone) btnGenSelectNone.addEventListener("click", selectNoneGenCheckboxes);

        // Buscador de unidades en modal general
        const genUnitSearch = document.getElementById("gen-unit-search");
        if (genUnitSearch) {
            genUnitSearch.addEventListener("input", e => filterGenUnits(e.target.value));
        }
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
                loadCurrentUser();
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

                // ── Verificar acceso antes de cargar el add-in ────
                api.getSession((session) => {
                    const userEmail = session && session.userName ? session.userName : null;

                    if (!checkAccess(userEmail)) {
                        // Usuario no autorizado → mostrar pantalla de acceso denegado
                        showAccessDenied(userEmail);
                        if (callback) callback();
                        return;
                    }

                    // Usuario autorizado → inicializar normalmente
                    const modeBadge = document.getElementById("mode-badge");
                    if (modeBadge) { modeBadge.dataset.mode = "live"; document.getElementById("mode-text").textContent = "Geotab Live"; }

                    bindEvents();
                    loadCurrentUser();
                    loadDevices();
                    if (callback) callback();
                });
            },
            focus(geotabApi, state) {
                api = geotabApi;
                loadCurrentUser();
                if (window.lucide) lucide.createIcons();
            },
            blur() {
                if (telemetryTimer) clearInterval(telemetryTimer);
            }
        };
    };

})();
