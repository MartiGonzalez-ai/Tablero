/**
 * Geotab Add-in for IOX Output control.
 * UI: unit card grid with search + side drawer command panel.
 * Envío de correo electrónico mediante EmailJS.
 */
"use strict";

geotab.addin.ioxOutput = function () {
    var api,
        ioxOutputDiv,
        grid,
        emptyEl,
        searchInput,
        searchClear,
        filterInfo,
        badgeCount,
        drawer,
        drawerOverlay,
        drawerClose,
        drawerHistoryBtn,
        drawerUnitName,
        drawerUnitId,
        drawerAvatar,
        relayBtnOn,
        relayBtnOff,
        selectedStateRow,
        selectedStateBadge,
        sendBtn,
        sendingEl,
        historyEl,
        errorEl,
        // StatusData modal
        statusOverlay,
        statusModal,
        statusClose,
        statusRelayBtn,
        statusAvatar,
        statusUnitName,
        statusUnitId,
        statusLoading,
        statusEmpty,
        statusTableWrap,
        statusTbody,
        statusRowCount,
        statusError;

    // ─── State ───────────────────────────────────────────
    var allDevices = [];      // full device list from API
    var filteredDevices = []; // currently shown after search
    var statusInfoMap = {};   // deviceId -> DeviceStatusInfo
    var selectedDevice = null; // { id, name, ... }
    var selectedState = null;  // 'On' | 'Off' | null

    // ─── Helpers ─────────────────────────────────────────
    function showError(msg) {
        errorEl.textContent = typeof msg === "string" ? msg : JSON.stringify(msg);
    }

    function clearError() {
        errorEl.textContent = "";
    }

    function getInitials(name) {
        if (!name) return "?";
        var parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function sortDevices(a, b) {
        var na = a.name.toLowerCase();
        var nb = b.name.toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
    }

    function safeVal(val) {
        return (val !== undefined && val !== null && val !== "") ? String(val) : null;
    }

    // ─── Email notification mediante EmailJS ──────────────
    function sendEmailNotification(device, state, messageId) {
        // Asegurar que EmailJS está cargado
        if (typeof emailjs === "undefined") {
            console.error("EmailJS no está cargado. Revisa que el script se haya incluido.");
            return;
        }

        // Inicializar con tu Public Key (obtenida en EmailJS)
        emailjs.init("TU_PUBLIC_KEY");  // <-- REEMPLAZAR

        var templateParams = {
            to_email: "mgonzalez@enertrak.mx",   // destinatario fijo
            from_email: "mg668866@gmail.com",    // cuenta que envía (configurada en EmailJS)
            unit_name: device.name,
            unit_id: device.id,
            command: state === "On" ? "ACTIVAR (ON)" : "DESACTIVAR (OFF)",
            message_id: messageId,
            timestamp: new Date().toLocaleString("es-MX", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            })
        };

        emailjs.send("TU_SERVICE_ID", "TU_TEMPLATE_ID", templateParams)
            .then(function(response) {
                console.log("Correo enviado exitosamente", response);
            })
            .catch(function(error) {
                console.error("Error al enviar correo:", error);
            });
    }

    // ─── Render grid ─────────────────────────────────────
    function renderGrid(devices) {
        grid.innerHTML = "";
        filteredDevices = devices;

        if (devices.length === 0) {
            emptyEl.style.display = "flex";
            filterInfo.textContent = "0 resultados";
            return;
        }

        emptyEl.style.display = "none";
        filterInfo.textContent = devices.length + " de " + allDevices.length + " unidades";

        devices.forEach(function (device) {
            var card = document.createElement("div");
            card.className = "unit-card";
            card.dataset.deviceId = device.id;

            if (selectedDevice && selectedDevice.id === device.id) {
                card.classList.add("unit-card--selected");
            }

            var statusInfo = statusInfoMap[device.id];
            var isMoving = statusInfo && statusInfo.isDeviceCommunicating &&
                statusInfo.speed !== undefined && statusInfo.speed > 0;
            var movingClass = isMoving ? "moving" : "stopped";
            var movingLabel = isMoving ? "En movimiento" : "Detenida";
            var movingIcon = isMoving
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

            var rows = "";

            var vin = safeVal(device.vehicleIdentificationNumber);
            rows += buildRow(
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 3v4M8 3v4"/></svg>',
                "ID / VIN",
                vin ? escapeHtml(vin) : '<span class="card-null">—</span>'
            );

            var make = safeVal(device.vinInfoMake);
            var model = safeVal(device.vinInfoModel);
            var year = safeVal(device.vinInfoYear);
            var makeModelYear = [make, model, year].filter(Boolean).join(" · ");
            rows += buildRow(
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="1"/><circle cx="12" cy="20" r="1"/><circle cx="20" cy="20" r="1"/></svg>',
                "",
                makeModelYear ? escapeHtml(makeModelYear) : '<span class="card-null">—</span>'
            );

            var plate = safeVal(device.licensePlate);
            rows += buildRow(
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="7" y1="10" x2="7" y2="14"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="17" y1="10" x2="17" y2="14"/></svg>',
                "Placa",
                plate ? '<span class="card-plate">' + escapeHtml(plate) + '</span>' : '<span class="card-null">—</span>'
            );

            var groupValueHtml = '<span class="card-null">—</span>';
            if (device.groups && device.groups.length > 0) {
                var pills = device.groups.map(function (g) {
                    var name = safeVal(g.name) || safeVal(g.id) || "—";
                    return '<span class="card-group-pill" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>';
                });
                groupValueHtml = '<div class="card-group-pills-wrap">' + pills.join("") + '</div>';
            }
            rows += buildRow(
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
                "Grupo",
                groupValueHtml
            );

            var historyValueHtml = '<button class="card-history-btn">Ver historial</button>';
            rows += buildRow(
                '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
                "Historial",
                historyValueHtml
            );

            // Incluir avatar en la tarjeta
            card.innerHTML =
                '<div class="unit-card-header">' +
                '  <div class="unit-card-avatar">' + getInitials(device.name) + '</div>' +
                '  <div class="unit-card-title-wrap">' +
                '    <div class="unit-card-name">' + escapeHtml(device.name) + '</div>' +
                '  </div>' +
                '  <span class="unit-card-status ' + movingClass + '">' + movingIcon + movingLabel + '</span>' +
                '</div>' +
                '<div class="unit-card-divider"></div>' +
                '<div class="unit-card-details">' + rows + '</div>' +
                '<svg class="unit-card-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" ' +
                'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
                'stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="9 18 15 12 9 6"/></svg>';

            var historyBtn = card.querySelector(".card-history-btn");
            if (historyBtn) {
                historyBtn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    openStatusModal(device);
                });
            }

            card.addEventListener("click", function () {
                openDrawer(device);
            });

            grid.appendChild(card);
        });
    }

    function buildRow(iconSvg, label, valueHtml) {
        return '<div class="card-row">' +
            '  <span class="card-row-icon">' + iconSvg + '</span>' +
            '  <span class="card-row-label">' + escapeHtml(label) + '</span>' +
            '  <span class="card-row-value">' + valueHtml + '</span>' +
            '</div>';
    }

    function applyFilter(query) {
        var q = (query || "").trim().toLowerCase();
        if (!q) {
            renderGrid(allDevices);
            return;
        }
        var filtered = allDevices.filter(function (d) {
            return d.name.toLowerCase().indexOf(q) !== -1;
        });
        renderGrid(filtered);
    }

    // ─── Drawer ───────────────────────────────────────────
    function openDrawer(device) {
        selectedDevice = device;
        selectedState = null;

        clearError();

        drawerUnitName.textContent = device.name;
        drawerUnitId.textContent = "ID: " + device.id;
        drawerAvatar.textContent = getInitials(device.name);

        relayBtnOn.classList.remove("selected");
        relayBtnOff.classList.remove("selected");
        selectedStateRow.style.display = "none";
        selectedStateBadge.textContent = "—";
        selectedStateBadge.className = "selected-state-badge";
        sendBtn.disabled = true;

        sendingEl.style.display = "none";
        sendBtn.style.display = "flex";

        document.querySelectorAll(".unit-card--selected").forEach(function (el) {
            el.classList.remove("unit-card--selected");
        });
        var activeCard = grid.querySelector('[data-device-id="' + device.id + '"]');
        if (activeCard) activeCard.classList.add("unit-card--selected");

        drawer.classList.add("open");
        drawerOverlay.classList.add("active");
    }

    function closeDrawer() {
        drawer.classList.remove("open");
        drawerOverlay.classList.remove("active");
        document.querySelectorAll(".unit-card--selected").forEach(function (el) {
            el.classList.remove("unit-card--selected");
        });
        selectedDevice = null;
        selectedState = null;
    }

    // ─── StatusData Modal ─────────────────────────────────────────
    function openStatusModal(device) {
        selectedDevice = device;

        statusUnitName.textContent = device.name;
        statusUnitId.textContent = "ID: " + device.id;
        statusAvatar.textContent = getInitials(device.name);
        statusError.textContent = "";

        statusLoading.style.display = "flex";
        statusEmpty.style.display = "none";
        statusTableWrap.style.display = "none";
        statusTbody.innerHTML = "";
        statusRowCount.textContent = "";

        document.querySelectorAll(".unit-card--selected").forEach(function (el) {
            el.classList.remove("unit-card--selected");
        });
        var activeCard = grid.querySelector('[data-device-id="' + device.id + '"]');
        if (activeCard) activeCard.classList.add("unit-card--selected");

        statusModal.classList.add("open");
        statusOverlay.classList.add("active");

        api.call("Get", {
            typeName: "TextMessage",
            search: {
                deviceSearch: { id: device.id }
            }
        }, function (results) {
            statusLoading.style.display = "none";

            if (!results || results.length === 0) {
                statusEmpty.style.display = "flex";
                return;
            }

            statusTableWrap.style.display = "flex";
            statusRowCount.textContent = results.length + " registros";

            results.sort(function (a, b) {
                return new Date(b.sent || 0) - new Date(a.sent || 0);
            });

            results.forEach(function (row) {
                var tr = document.createElement("tr");

                var deliveredVal = "—";
                if (row.delivered) {
                    var d = new Date(row.delivered);
                    deliveredVal = d.toLocaleDateString("es-MX") + " " +
                        d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                }

                var contentVal = "—";
                if (row.messageContent) {
                    if (row.messageContent.isRelayOn !== undefined) {
                        contentVal = row.messageContent.isRelayOn ? "⚡ ON (Activar)" : "⏹ OFF (Desactivar)";
                    } else if (row.messageContent.contentType) {
                        contentVal = row.messageContent.contentType + (row.messageContent.text ? ": " + row.messageContent.text : "");
                    } else if (typeof row.messageContent === "string") {
                        contentVal = row.messageContent;
                    } else {
                        contentVal = JSON.stringify(row.messageContent);
                    }
                }

                tr.innerHTML =
                    '<td>' + escapeHtml(deliveredVal) + '</td>' +
                    '<td style="font-weight:500;">' + escapeHtml(contentVal) + '</td>';

                statusTbody.appendChild(tr);
            });

        }, function (err) {
            statusLoading.style.display = "none";
            statusError.textContent = typeof err === "string" ? err : JSON.stringify(err);
        });
    }

    function closeStatusModal() {
        statusModal.classList.remove("open");
        statusOverlay.classList.remove("active");
        document.querySelectorAll(".unit-card--selected").forEach(function (el) {
            el.classList.remove("unit-card--selected");
        });
        selectedDevice = null;
    }

    // ─── State selection ─────────────────────────────────
    function selectState(state) {
        selectedState = state;

        relayBtnOn.classList.toggle("selected", state === "On");
        relayBtnOff.classList.toggle("selected", state === "Off");

        selectedStateRow.style.display = "flex";
        selectedStateBadge.textContent = state === "On" ? "ACTIVAR (ON)" : "DESACTIVAR (OFF)";
        selectedStateBadge.className = "selected-state-badge " + (state === "On" ? "on" : "off");

        sendBtn.disabled = false;
    }

    // ─── Send command ────────────────────────────────────
    function sendCommand() {
        if (!selectedDevice || !selectedState) return;

        clearError();
        sendBtn.style.display = "none";
        sendingEl.style.display = "flex";

        api.call("Add", {
            typeName: "TextMessage",
            entity: {
                device: { id: selectedDevice.id },
                messageContent: {
                    isRelayOn: selectedState === "On",
                    contentType: "IoxOutput"
                },
                isDirectionToVehicle: true
            }
        }, function (messageId) {
            sendingEl.style.display = "none";
            sendBtn.style.display = "flex";
            addHistoryItem(messageId, selectedState, selectedDevice.name);

            // ─── ENVÍO DE CORREO ELECTRÓNICO ───
            sendEmailNotification(selectedDevice, selectedState, messageId);
            // ───────────────────────────────────
        }, function (err) {
            sendingEl.style.display = "none";
            sendBtn.style.display = "flex";
            showError(err);
        });
    }

    // ─── History item ─────────────────────────────────────
    function addHistoryItem(messageId, state, unitName) {
        var item = document.createElement("div");
        item.className = "history-item";

        var now = new Date();
        var timeStr = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        var stateClass = state === "On" ? "on" : "off";
        var stateLabel = state === "On" ? "ON" : "OFF";

        item.innerHTML =
            '<div class="history-item-head">' +
            '<span class="history-item-state ' + stateClass + '">' + stateLabel + '</span>' +
            '<span class="history-item-time">' + timeStr + '</span>' +
            '</div>' +
            '<div>' + escapeHtml(unitName) + '</div>' +
            '<div class="history-item-delivered" id="hist-' + messageId + '"></div>';

        historyEl.insertBefore(item, historyEl.firstChild);
        pollDelivery(messageId, "hist-" + messageId);
    }

    function pollDelivery(messageId, elementId) {
        setTimeout(function () {
            api.call("Get", {
                typeName: "TextMessage",
                search: { id: messageId }
            }, function (result) {
                if (result && result[0] && result[0].delivered) {
                    var el = document.getElementById(elementId);
                    if (el) {
                        var d = new Date(result[0].delivered);
                        el.innerHTML = "✓ Entregado: " + d.toLocaleTimeString("es-MX");
                    }
                } else {
                    pollDelivery(messageId, elementId);
                }
            }, function () { /* ignore polling errors */ });
        }, 2000);
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ─── Public API ──────────────────────────────────────
    return {
        initialize: function (geotabApi, state, initializeCallback) {
            api = geotabApi;

            ioxOutputDiv = document.getElementById("ioxOutput");
            grid = document.getElementById("iox-grid");
            emptyEl = document.getElementById("iox-empty");
            searchInput = document.getElementById("iox-search");
            searchClear = document.getElementById("iox-search-clear");
            filterInfo = document.getElementById("filter-info");
            badgeCount = document.getElementById("badge-count");
            drawer = document.getElementById("iox-drawer");
            drawerOverlay = document.getElementById("iox-overlay");
            drawerClose = document.getElementById("drawer-close");
            drawerHistoryBtn = document.getElementById("drawer-history-btn");
            drawerUnitName = document.getElementById("drawer-unit-name");
            drawerUnitId = document.getElementById("drawer-unit-id");
            drawerAvatar = document.getElementById("drawer-avatar");
            relayBtnOn = document.getElementById("btn-on");
            relayBtnOff = document.getElementById("btn-off");
            selectedStateRow = document.getElementById("selected-state-row");
            selectedStateBadge = document.getElementById("selected-state-badge");
            sendBtn = document.getElementById("drawer-send");
            sendingEl = document.getElementById("drawer-sending");
            historyEl = document.getElementById("drawer-history");
            errorEl = document.getElementById("ioxoutput-error");

            statusOverlay = document.getElementById("status-overlay");
            statusModal = document.getElementById("status-modal");
            statusClose = document.getElementById("status-close");
            statusRelayBtn = document.getElementById("status-relay-btn");
            statusAvatar = document.getElementById("status-avatar");
            statusUnitName = document.getElementById("status-unit-name");
            statusUnitId = document.getElementById("status-unit-id");
            statusLoading = document.getElementById("status-loading");
            statusEmpty = document.getElementById("status-empty");
            statusTableWrap = document.getElementById("status-table-wrap");
            statusTbody = document.getElementById("status-tbody");
            statusRowCount = document.getElementById("status-row-count");
            statusError = document.getElementById("status-error");

            // Eventos
            searchInput.addEventListener("input", function () {
                var val = this.value;
                searchClear.classList.toggle("visible", val.length > 0);
                applyFilter(val);
            });

            searchClear.addEventListener("click", function () {
                searchInput.value = "";
                searchClear.classList.remove("visible");
                searchInput.focus();
                applyFilter("");
            });

            drawerClose.addEventListener("click", closeDrawer);
            drawerOverlay.addEventListener("click", closeDrawer);
            document.getElementById("iox-drawer").addEventListener("click", function (e) {
                e.stopPropagation();
            });

            if (drawerHistoryBtn) {
                drawerHistoryBtn.addEventListener("click", function () {
                    var dev = selectedDevice;
                    closeDrawer();
                    openStatusModal(dev);
                });
            }

            statusClose.addEventListener("click", closeStatusModal);
            statusOverlay.addEventListener("click", closeStatusModal);
            document.getElementById("status-modal").addEventListener("click", function (e) {
                e.stopPropagation();
            });
            statusRelayBtn.addEventListener("click", function () {
                var dev = selectedDevice;
                closeStatusModal();
                openDrawer(dev);
            });

            relayBtnOn.addEventListener("click", function () { selectState("On"); });
            relayBtnOff.addEventListener("click", function () { selectState("Off"); });
            sendBtn.addEventListener("click", sendCommand);

            initializeCallback();
        },

        focus: function (geotabApi, state) {
            api = geotabApi;
            statusInfoMap = {};

            // Mostrar esqueletos mientras carga
            grid.innerHTML = '<div class="unit-card unit-card--skeleton"></div>'.repeat(8);
            emptyEl.style.display = "none";
            ioxOutputDiv.style.display = ""; // Asegurar que el contenedor principal sea visible

            api.call("Get", {
                typeName: "Device",
                resultsLimit: 1000,
                search: {
                    fromDate: (new Date()).toISOString(),
                    groups: state.getGroupFilter()
                }
            }, function (devices) {
                allDevices = (devices || []).sort(sortDevices);
                badgeCount.textContent = allDevices.length + " unidades";

                if (allDevices.length === 0) {
                    grid.innerHTML = "";
                    emptyEl.style.display = "flex";
                    document.getElementById("iox-empty-hint").textContent =
                        "No se encontraron dispositivos en el grupo seleccionado.";
                    return;
                }

                renderGrid(allDevices);

                api.call("Get", {
                    typeName: "DeviceStatusInfo",
                    search: { groups: state.getGroupFilter() }
                }, function (statusList) {
                    statusInfoMap = {};
                    (statusList || []).forEach(function (s) {
                        if (s && s.device && s.device.id) {
                            statusInfoMap[s.device.id] = s;
                        }
                    });
                    var currentQuery = searchInput ? searchInput.value : "";
                    if (currentQuery.trim()) {
                        applyFilter(currentQuery);
                    } else {
                        renderGrid(allDevices);
                    }
                }, function () {
                    // Ignorar errores de estado
                });

            }, showError);
        },

        blur: function () {
            closeDrawer();
            // Nota: se eliminó closeGroupsModal() porque no existe
            ioxOutputDiv.style.display = "none";
            allDevices = [];
            filteredDevices = [];
        }
    };
};
