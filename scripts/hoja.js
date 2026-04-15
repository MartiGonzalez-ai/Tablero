"use strict";

geotab.addin.hoja = function () {

    // ─── LÓGICA DE GEOTAB ADD-IN ──────────────────────────────────────────────
    return {
        initialize: function (api, state, callback) {
            
            function getFormattedDate() {
                const hoy = new Date();
                return hoy.toLocaleString('es-MX', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                    timeZoneName: 'short'
                });
            }

            function actualizarFecha() {
                const fechaStr = getFormattedDate();
                const elements = document.querySelectorAll('.print-date');
                elements.forEach(el => el.innerText = `Impresión: ${fechaStr}`);
            }

            // Ejecutamos para actualizar la fecha
            actualizarFecha();

            function processExcel(file) {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function (evt) {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const getCell = (addr) => sheet[addr] ? sheet[addr].v : null;

                    const clientId = getCell('B1');
                    const clientName = getCell('B2');
                    const installed = getCell('B3');
                    const pending = getCell('B4');
                    const uninstalled = getCell('B5');

                    if (!clientId || !clientName || installed === null || pending === null || uninstalled === null) {
                        alert('Error: Las celdas B1..B5 deben contener datos del cliente y totales.');
                        return;
                    }

                    document.querySelector('.client-info h2').innerText = clientName;
                    document.querySelector('.client-id').innerText = `ID CLIENTE: ${clientId}`;
                    document.querySelector('.stat-card.instalados .stat-number').innerText = installed;
                    document.querySelector('.stat-card.pendientes .stat-number').innerText = pending;
                    document.querySelector('.stat-card.desinstalados .stat-number').innerText = uninstalled;

                    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 'A', range: 9 });
                    if (!rawRows.length) { alert('No hay datos a partir de fila 10'); return; }

                    const statusMap = {
                        'PENDIENTE': 'pendiente', 'PENDIENTES': 'pendiente',
                        'DESINSTALADO': 'desinstalado', 'DESINSTALADA': 'desinstalado',
                        'DESINSTALADOS': 'desinstalado', 'DESINSTALADAS': 'desinstalado',
                        'REUBICADO': 'reubicado', 'REUBICADA': 'reubicado',
                        'REUBICADOS': 'reubicado', 'REUBICADAS': 'reubicado',
                        'REHUBICADO': 'reubicado', 'REHUBICADA': 'reubicado',
                        'REHUBICADOS': 'reubicado', 'REHUBICADAS': 'reubicado',
                        'INSTALADO': 'instalado', 'INSTALADA': 'instalado',
                        'INSTALADOS': 'instalado', 'INSTALADAS': 'instalado'
                    };

                    const statusPriority = {
                        'pendiente': 1,
                        'desinstalado': 2,
                        'reubicado': 3,
                        'instalado': 4
                    };

                    const pendingRows = [];
                    const groups = {};

                    rawRows.forEach(row => {
                        const s = (row.J || 'PENDIENTE').toUpperCase();
                        const key = statusMap[s] || 'pendiente';
                        if (key === 'pendiente') {
                            pendingRows.push(row);
                        } else {
                            const type = row.A || 'SIN TIPO';
                            if (!groups[type]) groups[type] = [];
                            groups[type].push(row);
                        }
                    });

                    const container = document.querySelector('.modern-table-container');
                    container.innerHTML = '';

                    const renderSection = (title, rows) => {
                        if (rows.length === 0) return;

                        rows.sort((a, b) => {
                            const keyA = statusMap[(a.J || 'PENDIENTE').toUpperCase()] || 'pendiente';
                            const keyB = statusMap[(b.J || 'PENDIENTE').toUpperCase()] || 'pendiente';
                            const pA = statusPriority[keyA] || 99;
                            const pB = statusPriority[keyB] || 99;
                            if (pA !== pB) return pA - pB;
                            return String(a.B || '').localeCompare(String(b.B || ''), undefined, { numeric: true, sensitivity: 'base' });
                        });

                        const headerDiv = document.createElement('div');
                        headerDiv.className = 'table-header-title';
                        headerDiv.innerHTML = `<h2>${title.toUpperCase()}</h2><span class="print-date">Impresión: ${getFormattedDate()}</span>`;
                        container.appendChild(headerDiv);

                        const table = document.createElement('table');
                        table.className = 'modern-table';
                        table.innerHTML = \`<thead><tr>
                            <th></th>
                            <th><div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>ECO</div></th>
                            <th><div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>VEHÍCULO</div></th>
                            <th><div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 10h2"/><path d="M16 14h2"/><circle cx="8" cy="11" r="2"/><path d="M5 15a3 3 0 0 1 6 0"/></svg>PLACAS</div></th>
                            <th><div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5v14M8 5v14M11 5v14M13 5v14M16 5v14M21 5v14"/></svg>VIN</div></th>
                            <th><div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>EQUIPO / SERIE</div></th>
                            <th><div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>ESTADO</div></th>
                            <th><div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>FECHA</div></th>
                        </tr></thead>\`;

                        rows.forEach(row => {
                            const rawStatus = (row.J || 'PENDIENTE').toUpperCase();
                            const statusKey = statusMap[rawStatus] || 'pendiente';
                            const statusClass = statusKey;

                            const tbody = document.createElement('tbody');
                            tbody.innerHTML = \`
                                <tr class="main-row">
                                    <td class="status-bar status-\${statusClass}" rowspan="2"></td>
                                    <td class="text-bold">\${row.B || '—'}</td>
                                    <td><span class="text-bold">\${row.C || ''} \${row.D || ''}</span><span class="text-small">\${row.E || ''}</span></td>
                                    <td>\${row.F || '—'}</td>
                                    <td>\${row.G || '—'}</td>
                                    <td><span class="text-bold">\${row.H || ''}</span><span class="text-small">\${row.I || '—'}</span></td>
                                    <td><span class="badge badge-\${statusClass}">\${rawStatus}</span></td>
                                    <td class="text-bold">\${row.N || '—'}</td>
                                </tr>
                                <tr class="comment-row">
                                    <td colspan="7">
                                        <div class="comment-container">
                                            <span>Comentario: <strong>\${row.K || 'Sin observaciones'}</strong></span>
                                            <span class="separator-pipe">|</span>
                                            <span>Serie anterior: <span class="mono-text">\${row.M || '—'}</span></span>
                                        </div>
                                    </td>
                                </tr>
                            \`;
                            table.appendChild(tbody);
                        });
                        container.appendChild(table);
                    };

                    if (pendingRows.length) {
                        renderSection('PENDIENTES | Equipos por Instalar', pendingRows);
                    }

                    Object.keys(groups).sort().forEach(typeName => {
                        renderSection(\`\${typeName} | Estado de Equipos por Unidad\`, groups[typeName]);
                    });

                    const modal = document.getElementById('initialModal');
                    if (modal) {
                        modal.classList.add('hidden');
                    }

                    alert('¡Datos actualizados!');
                };
                reader.readAsArrayBuffer(file);
            }

            const uploadInput = document.getElementById('excel-upload');
            if (uploadInput) {
                // remove existing listeners if necessary, but initialize is called once
                uploadInput.addEventListener('change', function (e) {
                    processExcel(e.target.files[0]);
                });
            }

            const modalUploadInput = document.getElementById('modal-excel-upload');
            if (modalUploadInput) {
                modalUploadInput.addEventListener('change', function (e) {
                    processExcel(e.target.files[0]);
                });
            }

            // Avisamos a la API que terminó de cargar la interfaz
            callback();
        },
        focus: function (api, state) {
            // Se invoca cada vez que se vuelve a enfocar el tab
        },
        blur: function (api, state) {
            // Se invoca al salir del tab
        }
    };
};
