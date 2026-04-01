/**
 * ═══════════════════════════════════════════════════════════════
 * RECORRIDO.JS — Lógica para la consulta de kilómetros históricos
 * Geotab Add-In | Modern ESM Logic
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

// Geotab API Initialization
geotab.addin.recorrido = function () {
    let api;
    let units = [];

    // DOM Elements
    const unitSelect = document.getElementById("unit-select-recorrido");
    const dateUntilInput = document.getElementById("date-until");
    const btnConsultar = document.getElementById("btn-consultar");
    const resultContainer = document.getElementById("result-container");
    const loadingOverlay = document.getElementById("loading-overlay");
    const distanciaValue = document.getElementById("distancia-value");
    const fechaFooter = document.getElementById("fecha-footer");
    const errorToast = document.getElementById("error-toast");
    const errorToastMsg = document.getElementById("error-toast-msg");

    // --- Helpers ---
    const showError = (msg) => {
        if (errorToastMsg) errorToastMsg.textContent = msg;
        if (errorToast) {
            errorToast.style.display = "flex";
            setTimeout(() => { errorToast.style.display = "none"; }, 5000);
        }
    };

    const formatDateReadable = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr);
        return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
    };

    const animateCount = (el, target) => {
        const duration = 1200;
        const start = performance.now();
        const startVal = parseFloat(el.textContent.replace(/,/g, "")) || 0;
        
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4); // Quartic ease out
            const current = startVal + (target - startVal) * eased;
            
            el.textContent = Math.round(current).toLocaleString("es-MX");
            
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    // --- Data Loaders ---
    const loadUnits = () => {
        api.call("Get", {
            typeName: "Device"
        }, (result) => {
            units = result || [];
            unitSelect.innerHTML = '<option value="" disabled selected>Selecciona una unidad...</option>';
            
            // Sort by name
            units.sort((a, b) => a.name.localeCompare(b.name));

            units.forEach(device => {
                const option = document.createElement("option");
                option.value = device.id;
                option.textContent = device.name;
                unitSelect.appendChild(option);
            });
        }, (err) => {
            console.error("Error loading devices:", err);
            showError("No se pudieron cargar las unidades.");
        });
    };

    const calculateDistance = () => {
        const deviceId = unitSelect.value;
        const toDate = dateUntilInput.value;

        if (!deviceId) {
            showError("Por favor, selecciona una unidad.");
            return;
        }
        if (!toDate) {
            showError("Por favor, selecciona una fecha límite.");
            return;
        }

        // Show loading
        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        // Prepare Search
        // We set toDate to the end of that day
        const searchToDate = new Date(toDate + "T23:59:59Z").toISOString();

        api.call("Get", {
            typeName: "Trip",
            search: {
                deviceSearch: { id: deviceId },
                toDate: searchToDate
            }
        }, (trips) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            if (!trips || trips.length === 0) {
                distanciaValue.textContent = "0";
                fechaFooter.textContent = formatDateReadable(toDate);
                resultContainer.style.display = "block";
                showError("No se encontraron viajes para esta unidad hasta la fecha seleccionada.");
                return;
            }

            // Sum distances (Trip.distance is in meters)
            let totalMeters = 0;
            trips.forEach(trip => {
                if (trip.distance) {
                    totalMeters += trip.distance;
                }
            });

            const totalKm = totalMeters / 1000;

            // Updated UI
            resultContainer.style.display = "block";
            animateCount(distanciaValue, totalKm);
            fechaFooter.textContent = formatDateReadable(toDate);

            // Smooth scroll to result
            setTimeout(() => {
                resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }, 100);

        }, (err) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("Error fetching trips:", err);
            showError("Error al consultar los datos de viajes en Geotab.");
        });
    };

    // --- Lifecycle ---
    return {
        initialize: function (_api, state, callback) {
            api = _api;

            // Set default date to today
            if (dateUntilInput) {
                dateUntilInput.value = new Date().toISOString().split('T')[0];
            }

            // Event Listeners
            if (btnConsultar) {
                btnConsultar.addEventListener("click", calculateDistance);
            }

            // Initialize Lucide
            if (window.lucide) {
                lucide.createIcons();
            }

            // Load initial data
            loadUnits();

            callback();
        },
        focus: function (_api, state) {
            api = _api;
            // Refresh units list in case something changed
            loadUnits();
        },
        blur: function () {
            // Nothing needed on blur
        }
    };
};
