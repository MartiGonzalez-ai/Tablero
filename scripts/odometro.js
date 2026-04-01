/* 
 * ═══════════════════════════════════════════════════════════════
 * ODOMETRO.JS — Lógica Maestra para Consulta de Odómetro Real
 * Geotab SDK | Implementation with Multi-Diagnostic Strategy
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

let api;
let chart;

// IDs de diagnóstico para el odómetro (Estrategia recomendada por Geotab SDK)
const ODOMETER_DIAGNOSTICS = [
    "DiagnosticOdometerId",
    "DiagnosticOBDOdometerReaderId",
    "DiagnosticJ1939TotalVehicleDistanceId",
    "DiagnosticJ1708TotalVehicleDistanceId",
    "DiagnosticOdometerAdjustmentId"
];

/**
 * Muestra alertas en la interfaz
 */
const showAlert = (id, message, type = 'success') => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert-${type}`;
    el.style.display = 'block';
    if (type === 'success') {
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
};

/**
 * Autenticación con la API de Geotab
 */
window.loginGeotab = function() {
    const server = document.getElementById('server').value.trim();
    const database = document.getElementById('database').value.trim();
    const user = document.getElementById('user').value.trim();
    const pass = document.getElementById('password').value.trim();

    if (!server || !database || !user || !pass) {
        showAlert('login-alert', 'Por favor, completa todos los campos.', 'error');
        return;
    }

    document.getElementById('btn-login').disabled = true;
    document.getElementById('loading-overlay').style.flexDirection = 'column';
    document.getElementById('loading-overlay').style.display = 'flex';

    // Instanciar GeotabApi (mg-api-js)
    api = new GeotabApi(user, pass, database, server);

    api.authenticate((err, data) => {
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('btn-login').disabled = false;

        if (err) {
            console.error("Auth Error:", err);
            showAlert('login-alert', `Error: ${err.message || err}`, 'error');
            return;
        }

        // Éxito: Ocultar login, mostrar dashboard
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-main').classList.remove('hidden');
        loadDevices();
    });
};

/**
 * Carga la lista de dispositivos (vehículos)
 */
const loadDevices = () => {
    api.call("Get", { typeName: "Device" }, (result) => {
        const select = document.getElementById('unit-select');
        select.innerHTML = '<option value="" disabled selected>Selecciona una unidad...</option>';
        
        // Ordenar alfabéticamente
        result.sort((a, b) => a.name.localeCompare(b.name));

        result.forEach(device => {
            const opt = document.createElement('option');
            opt.value = device.id;
            opt.textContent = device.name;
            select.appendChild(opt);
        });

        document.getElementById('btn-consultar').disabled = false;
        select.disabled = false;
    }, (err) => {
        showAlert('main-alert', 'Error al cargar unidades: ' + err, 'error');
    });
};

/**
 * Consulta de datos de odómetro usando multiCall
 */
window.consultarOdometro = function() {
    const deviceId = document.getElementById('unit-select').value;
    const fromDateVal = document.getElementById('fromDate').value;
    const toDateVal = document.getElementById('toDate').value;

    if (!deviceId || !fromDateVal || !toDateVal) {
        showAlert('main-alert', 'Selecciona unidad y rango de fechas.', 'error');
        return;
    }

    const fromDate = new Date(fromDateVal).toISOString();
    const toDate = new Date(toDateVal + "T23:59:59Z").toISOString();

    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('btn-consultar').disabled = true;

    // Crear array de llamadas para multiCall (una por cada ID de diagnóstico)
    const calls = ODOMETER_DIAGNOSTICS.map(diagnosticId => [
        "Get",
        {
            typeName: "StatusData",
            search: {
                deviceSearch: { id: deviceId },
                diagnosticSearch: { id: diagnosticId },
                fromDate: fromDate,
                toDate: toDate
            }
        }
    ]);

    api.multiCall(calls, (results) => {
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('btn-consultar').disabled = false;

        // Combinar todos los resultados de los diferentes diagnósticos
        let mergedData = [];
        results.forEach(resArray => {
            if (resArray && resArray.length > 0) {
                mergedData = mergedData.concat(resArray);
            }
        });

        if (mergedData.length === 0) {
            showAlert('main-alert', 'No se encontraron registros de odómetro para este periodo.', 'error');
            return;
        }

        // Ordenar por fecha
        mergedData.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

        processAndRender(mergedData);
    }, (err) => {
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('btn-consultar').disabled = false;
        showAlert('main-alert', 'Error en consulta: ' + err, 'error');
    });
};

/**
 * Procesa los datos y actualiza la UI
 */
const processAndRender = (data) => {
    // 1. Cálculos de KPI
    const firstVal = data[0].data / 1000; // Metros a KM
    const lastVal = data[data.length - 1].data / 1000;
    const distanceTraveled = lastVal - firstVal;

    // Actualizar Texto
    document.getElementById('kpi-current-val').textContent = lastVal.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km";
    document.getElementById('kpi-traveled-val').textContent = distanceTraveled.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km";
    
    const lastDate = new Date(data[data.length - 1].dateTime);
    document.getElementById('kpi-current-footer').textContent = "Última lectura: " + lastDate.toLocaleString("es-MX");

    // 2. Gráfica ApexCharts
    renderChart(data);

    // Lucide Icons update
    if (window.lucide) lucide.createIcons();
};

const renderChart = (data) => {
    const seriesData = data.map(d => {
        return {
            x: new Date(d.dateTime).getTime(),
            y: parseFloat((d.data / 1000).toFixed(2))
        };
    });

    const options = {
        series: [{
            name: 'Lectura Odómetro',
            data: seriesData
        }],
        chart: {
            type: 'area',
            height: 400,
            zoom: { enabled: true },
            toolbar: { show: true },
            fontFamily: 'Inter, sans-serif'
        },
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth', width: 2 },
        colors: ['#00b1e1'],
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.45,
                opacityTo: 0.05,
                stops: [20, 100, 100, 100]
            }
        },
        xaxis: {
            type: 'datetime',
            labels: { style: { colors: '#64748b' } }
        },
        yaxis: {
            labels: {
                style: { colors: '#64748b' },
                formatter: (val) => val.toLocaleString() + " km"
            }
        },
        tooltip: {
            x: { format: 'dd MMM yyyy HH:mm' },
            y: { formatter: (val) => val.toLocaleString() + " km" }
        },
        grid: {
            borderColor: '#e2e8f0',
            strokeDashArray: 4
        }
    };

    if (chart) chart.destroy();
    chart = new ApexCharts(document.querySelector("#chart-area"), options);
    chart.render();
};

/**
 * Inicialización de fechas
 */
document.addEventListener('DOMContentLoaded', () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);

    document.getElementById('toDate').valueAsDate = to;
    document.getElementById('fromDate').valueAsDate = from;
});
