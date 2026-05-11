<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="utf-8">
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <meta name="description" content="Dashboard de Monitoreo de Acceso de Usuarios - Geotab">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Monitoreo de Usuarios | Geotab</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles/vendor.css">
    <link rel="stylesheet" href="styles/personas.css">
</head>

<body>
    <div id="app-personas">

        <!-- ═══════════ HEADER ═══════════ -->
        <header class="top-nav glass-panel">
            <div class="nav-brand">
                <i data-lucide="users" width="30" height="30" stroke="var(--color-primary)" stroke-width="2"></i>
                <div>
                    <h1>Monitoreo de Acceso de Usuarios</h1>
                </div>
            </div>

            <div class="nav-controls">
                <div class="search-group">
                    <i data-lucide="search" width="16" height="16"></i>
                    <input type="text" id="search-input" class="search-input"
                        placeholder="Nombre, email o teléfono...">
                </div>
                <div id="multi-select-org" class="multi-select">
                    <div class="multi-select__trigger" title="Filtrar por organizaciones">
                        <i data-lucide="building-2" width="16" height="16"></i>
                        <span class="multi-select__label">Todas las organizaciones</span>
                        <i data-lucide="chevron-down" width="14" height="14" class="chevron"></i>
                    </div>
                    <div class="multi-select__dropdown glass-panel">
                        <div class="multi-select__search">
                            <i data-lucide="search" width="12" height="12"></i>
                            <input type="text" id="org-search-input" placeholder="Buscar organización...">
                        </div>
                        <div class="multi-select__options-container">
                            <div id="org-options-list" class="multi-select__options">
                                <!-- Options populated by JS -->
                            </div>
                        </div>
                        <div class="multi-select__footer">
                            <button id="btn-clear-orgs" class="btn-text">Limpiar</button>
                            <button id="btn-apply-orgs" class="btn-primary-sm">Aplicar</button>
                        </div>
                    </div>
                </div>
                <button id="btn-refresh" class="btn-refresh" title="Refrescar datos">
                    <i data-lucide="refresh-cw" width="18" height="18" stroke-width="2.5"></i>
                    <span>Refrescar</span>
                </button>
                <button id="btn-clear-all" class="btn-clear-all" title="Limpiar todos los filtros">
                    <i data-lucide="filter-x" width="18" height="18"></i>
                    <span>Limpiar</span>
                </button>
                <span class="last-updated" id="last-updated-time">Actualizado: --:--</span>
            </div>
        </header>

        <!-- ═══════════ SUMMARY KPI STRIP ═══════════ -->
        <section class="summary-strip">
            <!-- Total Usuarios -->
            <div class="stat-card" data-color="blue">
                <div class="stat-icon stat-icon--total">
                    <i data-lucide="users" stroke-width="2"></i>
                </div>
                <div class="stat-body">
                    <div class="stat-label">Total Usuarios</div>
                    <div class="stat-value skeleton" id="stat-total">—</div>
                </div>
            </div>

            <!-- Usuarios Activos -->
            <div class="stat-card" data-color="green">
                <div class="stat-icon stat-icon--normal">
                    <i data-lucide="user-check" stroke-width="2"></i>
                </div>
                <div class="stat-body">
                    <div class="stat-label">Normal (0-4 días)</div>
                            <div class="stat-value skeleton" id="stat-normal">—</div>
                    </div>
                </div>

                <!-- Inactividad Grave -->
                <div class="stat-card" data-color="orange">
                    <div class="stat-icon stat-icon--grave">
                        <i data-lucide="user-minus" stroke-width="2"></i>
                    </div>
                    <div class="stat-body">
                        <div class="stat-label">Grave (5-8 días)</div>
                        <div class="stat-value skeleton" id="stat-grave">—</div>
                    </div>
                </div>

                <!-- Inactividad Crítica -->
                <div class="stat-card" data-color="red">
                    <div class="stat-icon stat-icon--critical">
                        <i data-lucide="user-x" stroke-width="2"></i>
                    </div>
                    <div class="stat-body">
                        <div class="stat-label">Crítica (9+ días)</div>
                        <div class="stat-value skeleton" id="stat-critical">—</div>
                    </div>
                </div>
        </section>

        <!-- ═══════════ CHARTS SECTION ═══════════ -->
        <section class="charts-section">
            <div class="chart-card glass-panel">
                <div class="panel-header">
                    <div class="panel-title-group">
                        <i data-lucide="pie-chart" width="16" height="16" stroke-width="2"></i>
                        <span>Distribución de Inactividad</span>
                    </div>
                </div>
                <div id="chart-inactivity" class="chart-container"></div>
            </div>

            <div class="chart-card glass-panel">
                <div class="panel-header">
                    <div class="panel-title-group">
                        <i data-lucide="shield" width="16" height="16" stroke-width="2"></i>
                        <span>Usuarios por Grupo de Seguridad</span>
                    </div>
                </div>
                <div id="chart-groups" class="chart-container"></div>
            </div>
        </section>

        <section class="charts-section charts-section--full" style="padding-top: 0;">
            <div class="chart-card glass-panel">
                <div class="panel-header">
                    <div class="panel-title-group">
                        <i data-lucide="bar-chart-3" width="16" height="16" stroke-width="2"></i>
                        <span>Inactividad por Organización (Top 15)</span>
                    </div>
                </div>
                <div id="chart-org-stacked" class="chart-container" style="min-height: 450px;"></div>
            </div>
        </section>

        <!-- ═══════════ TABLE SECTION ═══════════ -->
        <section class="table-section">
            <div class="table-panel glass-panel">
                <div class="panel-header">
                    <div class="panel-title-group">
                        <i data-lucide="list" width="16" height="16" stroke-width="2"></i>
                        <span>Detalle de Usuarios</span>
                    </div>
                    <div class="table-controls">
                        <button id="btn-email" class="btn-email" disabled>
                            <i data-lucide="mail" width="16" height="16"></i>
                            <span>Enviar Correo (0)</span>
                        </button>
                        <button id="btn-email-settings" class="btn-icon-only" title="Configurar mensaje predeterminado">
                            <i data-lucide="settings" width="16" height="16"></i>
                        </button>
                        <button id="btn-export" class="btn-export">
                            <i data-lucide="download" width="16" height="16"></i>
                            Exportar Excel
                        </button>
                    </div>
                </div>
                <div class="table-wrapper">
                    <div id="user-grid" class="user-grid">
                        <!-- User Cards will be rendered here -->
                        <div style="text-align:center; padding: 5rem; width: 100%; color: var(--color-text-muted);">
                            Cargando usuarios...
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- ═══════════ EMAIL SETTINGS MODAL ═══════════ -->
        <div id="email-settings-modal" class="modal-overlay">
            <div class="modal-content glass-panel">
                <div class="modal-header">
                    <div class="panel-title-group">
                        <i data-lucide="mail" width="18" height="18"></i>
                        <span>Configuración de Correo</span>
                    </div>
                    <button id="btn-close-modal" class="btn-close">
                        <i data-lucide="x" width="20" height="20"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="email-subject">Asunto del Correo</label>
                        <input type="text" id="email-subject" placeholder="Ej: Notificación de Geotab">
                    </div>
                    <div class="form-group">
                        <label for="email-body">Mensaje Predeterminado</label>
                        <textarea id="email-body" rows="6" placeholder="Escribe el mensaje aquí..."></textarea>
                    </div>
                    <p class="form-hint">
                        <i data-lucide="info" width="12" height="12"></i>
                        Estos datos se guardarán en tu navegador. Los correos se abrirán con tu aplicación predeterminada.
                    </p>
                    <p class="form-hint" style="font-size: 0.65rem; margin-top: -0.25rem; opacity: 0.8;">
                        * Tip: Si usas Chrome/Edge, puedes configurarlo para que abra Telmex automáticamente al hacer clic en enlaces de correo.
                    </p>
                </div>
                <div class="modal-footer">
                    <button id="btn-save-settings" class="btn-save">
                        <i data-lucide="save" width="16" height="16"></i>
                        Guardar Configuración
                    </button>
                </div>
            </div>
        </div>

    </div>

    <!-- Scripts -->
    <script src="https://cdn.jsdelivr.net/npm/apexcharts" defer></script>
    <script src="https://unpkg.com/lucide@latest" defer></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" defer></script>
    <script src="scripts/vendor.js" defer></script>
    <script src="scripts/personas.js" defer></script>
</body>

</html>
