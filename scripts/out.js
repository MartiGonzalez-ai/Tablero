/**
 * Geotab Add-in for IOX Output control.
 * UI: unit card grid with search + side drawer command panel.
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
    var allDevices      = [];   // full device list from API
    var filteredDevices = [];   // currently shown after search
    var selectedDevice  = null; // { id, name }
    var selectedState   = null; // 'On' | 'Off' | null

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

    // ─── Render grid ─────────────────────────────────────
    function renderGrid(devices) {
        // Remove skeleton cards
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

            // Re-select highlight if this card is already selected
            if (selectedDevice && selectedDevice.id === device.id) {
                card.classList.add("unit-card--selected");
            }

            var initials = getInitials(device.name);

            card.innerHTML =
                '<div class="unit-card-avatar">' + initials + '</div>' +
                '<div class="unit-card-name">' + escapeHtml(device.name) + '</div>' +
                '<div class="unit-card-id">' + device.id + '</div>' +
                '<svg class="unit-card-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" ' +
                'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
                'stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="9 18 15 12 9 6"/></svg>';

            card.addEventListener("click", function () {
                openStatusModal(device);
            });

            grid.appendChild(card);
        });
    }

    // ─── Filter ───────────────────────────────────────────
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
        selectedState  = null;

        clearError();

        // Update drawer info
        drawerUnitName.textContent = device.name;
        drawerUnitId.textContent   = "ID: " + device.id;
        drawerAvatar.textContent   = getInitials(device.name);

        // Reset state buttons
        relayBtnOn.classList.remove("selected");
        relayBtnOff.classList.remove("selected");
        selectedStateRow.style.display = "none";
        selectedStateBadge.textContent = "—";
        selectedStateBadge.className   = "selected-state-badge";
        sendBtn.disabled               = true;

        // Reset sending area
        sendingEl.style.display  = "none";
        sendBtn.style.display    = "flex";

        // Highlight selected card
        document.querySelectorAll(".unit-card--selected").forEach(function (el) {
            el.classList.remove("unit-card--selected");
        });
        var activeCard = grid.querySelector('[data-device-id="' + device.id + '"]');
        if (activeCard) activeCard.classList.add("unit-card--selected");

        // Open
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
        selectedState  = null;
    }

    // ─── StatusData Modal ─────────────────────────────────────────
    function openStatusModal(device) {
        selectedDevice = device;

        // Fill header
        statusUnitName.textContent = device.name;
        statusUnitId.textContent   = "ID: " + device.id;
        statusAvatar.textContent   = getInitials(device.name);
        statusError.textContent    = "";

        // Reset table
        statusLoading.style.display   = "flex";
        statusEmpty.style.display     = "none";
        statusTableWrap.style.display = "none";
        statusTbody.innerHTML         = "";
        statusRowCount.textContent    = "";

        // Highlight card
        document.querySelectorAll(".unit-card--selected").forEach(function (el) {
            el.classList.remove("unit-card--selected");
        });
        var activeCard = grid.querySelector('[data-device-id="' + device.id + '"]');
        if (activeCard) activeCard.classList.add("unit-card--selected");

        // Open modal
        statusModal.classList.add("open");
        statusOverlay.classList.add("active");

        // Build today’s date range (from midnight to now)
        var now   = new Date();
        var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

        api.call("Get", {
            typeName: "StatusData",
            resultsLimit: 500,
            search: {
                deviceSearch: { id: device.id },
                diagnosticSearch: { id: "aztaiZ_rDlEy5Nsg6UTXc2A" },
                fromDate: start.toISOString(),
                toDate:   now.toISOString()
            }
        }, function (results) {
            statusLoading.style.display = "none";

            var filteredResults = (results || []).filter(function (row) {
                return row.diagnostic && row.diagnostic.id === "aztaiZ_rDlEy5Nsg6UTXc2A";
            });

            if (filteredResults.length === 0) {
                statusEmpty.style.display = "flex";
                return;
            }

            statusTableWrap.style.display = "flex";
            statusRowCount.textContent = filteredResults.length + " registros";

            // Sort newest first
            filteredResults.sort(function (a, b) {
                return new Date(b.dateTime) - new Date(a.dateTime);
            });

            filteredResults.forEach(function (row) {
                var tr = document.createElement("tr");

                // data value
                var dataVal = row.data !== undefined && row.data !== null ? row.data : "—";

                // datetime
                var dtVal = "—";
                if (row.dateTime) {
                    var d = new Date(row.dateTime);
                    dtVal = d.toLocaleDateString("es-MX") + " " +
                            d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                }

                // diagnostic name
                var diagVal = "—";
                if (row.diagnostic) {
                    if (row.diagnostic.id === "aztaiZ_rDlEy5Nsg6UTXc2A") {
                        diagVal = "Paro de motor";
                    } else {
                        diagVal = row.diagnostic.name || row.diagnostic.id || "—";
                    }
                }

                tr.innerHTML =
                    '<td class="td-data">'  + escapeHtml(String(dataVal)) + '</td>' +
                    '<td class="td-dt">'    + escapeHtml(dtVal)           + '</td>' +
                    '<td class="td-diag">'  + escapeHtml(String(diagVal)) + '</td>';

                statusTbody.appendChild(tr);
            });

        }, function (err) {
            statusLoading.style.display = "none";
            statusError.textContent     = typeof err === "string" ? err : JSON.stringify(err);
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

        relayBtnOn.classList.toggle("selected",  state === "On");
        relayBtnOff.classList.toggle("selected", state === "Off");

        selectedStateRow.style.display    = "flex";
        selectedStateBadge.textContent    = state === "On" ? "ACTIVAR (ON)" : "DESACTIVAR (OFF)";
        selectedStateBadge.className      = "selected-state-badge " + (state === "On" ? "on" : "off");

        sendBtn.disabled = false;
    }

    // ─── Send command ────────────────────────────────────
    function sendCommand() {
        if (!selectedDevice || !selectedState) return;

        clearError();
        sendBtn.style.display   = "none";
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
            sendBtn.style.display   = "flex";
            addHistoryItem(messageId, selectedState, selectedDevice.name);
        }, function (err) {
            sendingEl.style.display = "none";
            sendBtn.style.display   = "flex";
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

        // Prepend so newest is on top
        historyEl.insertBefore(item, historyEl.firstChild);

        // Poll for delivery
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

    // ─── Escape HTML ─────────────────────────────────────
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ─── Public API ──────────────────────────────────────
    return {
        /**
         * initialize() — called once when the Add-In first loads.
         */
        initialize: function (geotabApi, state, initializeCallback) {
            api = geotabApi;

            // DOM references
            ioxOutputDiv      = document.getElementById("ioxOutput");
            grid              = document.getElementById("iox-grid");
            emptyEl           = document.getElementById("iox-empty");
            searchInput       = document.getElementById("iox-search");
            searchClear       = document.getElementById("iox-search-clear");
            filterInfo        = document.getElementById("filter-info");
            badgeCount        = document.getElementById("badge-count");
            drawer            = document.getElementById("iox-drawer");
            drawerOverlay     = document.getElementById("iox-overlay");
            drawerClose       = document.getElementById("drawer-close");
            drawerUnitName    = document.getElementById("drawer-unit-name");
            drawerUnitId      = document.getElementById("drawer-unit-id");
            drawerAvatar      = document.getElementById("drawer-avatar");
            relayBtnOn        = document.getElementById("btn-on");
            relayBtnOff       = document.getElementById("btn-off");
            selectedStateRow  = document.getElementById("selected-state-row");
            selectedStateBadge= document.getElementById("selected-state-badge");
            sendBtn           = document.getElementById("drawer-send");
            sendingEl         = document.getElementById("drawer-sending");
            historyEl         = document.getElementById("drawer-history");
            errorEl           = document.getElementById("ioxoutput-error");
            // StatusData modal
            statusOverlay    = document.getElementById("status-overlay");
            statusModal      = document.getElementById("status-modal");
            statusClose      = document.getElementById("status-close");
            statusRelayBtn   = document.getElementById("status-relay-btn");
            statusAvatar     = document.getElementById("status-avatar");
            statusUnitName   = document.getElementById("status-unit-name");
            statusUnitId     = document.getElementById("status-unit-id");
            statusLoading    = document.getElementById("status-loading");
            statusEmpty      = document.getElementById("status-empty");
            statusTableWrap  = document.getElementById("status-table-wrap");
            statusTbody      = document.getElementById("status-tbody");
            statusRowCount   = document.getElementById("status-row-count");
            statusError      = document.getElementById("status-error");

            // ── Events ──
            // Search live filter
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

            // Close modal when clicking the overlay background
            drawerClose.addEventListener("click", closeDrawer);
            drawerOverlay.addEventListener("click", closeDrawer);
            // Prevent clicks inside the modal from bubbling to overlay
            document.getElementById("iox-drawer").addEventListener("click", function (e) {
                e.stopPropagation();
            });

            // StatusData modal events
            statusClose.addEventListener("click", closeStatusModal);
            statusOverlay.addEventListener("click", closeStatusModal);
            document.getElementById("status-modal").addEventListener("click", function (e) {
                e.stopPropagation();
            });
            statusRelayBtn.addEventListener("click", function () {
                // Keep selectedDevice, close status modal then open relay drawer
                var dev = selectedDevice;
                closeStatusModal();
                openDrawer(dev);
            });

            // State selection
            relayBtnOn.addEventListener("click", function () { selectState("On"); });
            relayBtnOff.addEventListener("click", function () { selectState("Off"); });

            // Send
            sendBtn.addEventListener("click", sendCommand);

            initializeCallback();
        },

        /**
         * focus() — called every time the user navigates to the Add-In.
         */
        focus: function (geotabApi, state) {
            api = geotabApi;

            // Show skeleton while loading
            grid.innerHTML =
                '<div class="unit-card unit-card--skeleton"></div>'.repeat(8);
            emptyEl.style.display = "none";

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
                ioxOutputDiv.style.display = "";
            }, showError);
        },

        /**
         * blur() — called when the user navigates away.
         */
        blur: function () {
            closeDrawer();
            ioxOutputDiv.style.display = "none";
            allDevices      = [];
            filteredDevices = [];
        }
    };
};
