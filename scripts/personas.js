"use strict";

geotab.addin.personas = function () {
    let api;
    let allUsers = [];
    let filteredUsers = [];
    let selectedEmails = new Set();
    let charts = {
        inactivity: null,
        groups: null,
        orgStacked: null
    };

    let currentFilters = {
        status: null,
        securityGroup: null,
        organization: null
    };

    // DOM Refs
    let btnRefresh, btnClearAll, lastUpdatedEl, searchInput, btnExport, btnEmail, btnEmailSettings, userGrid;
    let modal, btnCloseModal, btnSaveSettings, inputSubject, inputBody;

    // Multi-select Org Refs
    let multiSelectContainer, multiSelectTrigger, multiSelectDropdown, orgSearchInput, orgOptionsList, btnClearOrgs, btnApplyOrgs;
    let selectedOrgs = new Set();

    // Constants
    const STORAGE_KEY_SUBJECT = "geotab_personas_email_subject";
    const STORAGE_KEY_BODY = "geotab_personas_email_body";
    const DEFAULT_SUBJECT = "Dashboard Geotab - Notificación";
    const DEFAULT_BODY = "Hola,\n\nSe adjunta información relevante sobre su acceso al dashboard de Geotab.";

    // ─── Helpers ─────────────────────────────────────────────────────────────
    const formatDate = (dateStr) => {
        if (!dateStr || dateStr.startsWith("0001")) return "—";
        const d = new Date(dateStr);
        return d.toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    };

    const getInactivityDays = (lastAccess) => {
        if (!lastAccess || lastAccess.startsWith("0001")) return Infinity;
        const last = new Date(lastAccess);
        const now = new Date();
        const diff = now - last;
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    const getStatusInfo = (days) => {
        if (days <= 4) return { label: "Normal", class: "badge--normal" };
        if (days <= 8) return { label: "Grave", class: "badge--grave" };
        return { label: "Crítico", class: "badge--critical" };
    };

    const translateSecurityGroup = (id) => {
        if (!id) return "—";
        if (id.includes("ViewOnlySecurity")) return "Solo ver";
        if (id.includes("EverythingSecurity")) return "Administrador";
        if (id.includes("SupervisorSecurity")) return "Supervisor";
        if (id.includes("b27D1")) return "Solo Ver Custom";
        return id;
    };

    const animateCount = (el, target) => {
        if (!el) return;
        el.classList.remove("skeleton");
        const duration = 1000;
        const start = performance.now();
        const targetVal = parseInt(target) || 0;

        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const current = Math.floor(targetVal * progress);
            el.textContent = current.toLocaleString();
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };


    const getStatusType = (label) => {
        if (label.includes("Normal")) return "normal";
        if (label.includes("Grave")) return "grave";
        if (label.includes("Crítico")) return "critical";
        return "normal";
    };

    // ─── Data Processing ─────────────────────────────────────────────────────
    const processData = (users, groups = []) => {
        const groupLookup = {};
        const empresasGroup = groups.find(g => g.name === "EMPRESAS");

        // Map groups for easy upward traversal
        groups.forEach(g => {
            if (g.id) groupLookup[g.id] = g;
        });

        const getTopLevelOrg = (groupId) => {
            if (!empresasGroup) return null;
            let current = groupLookup[groupId];
            while (current) {
                const parentId = current.parent ? (current.parent.id || current.parent) : null;
                // If this group's parent is EMPRESAS, then this group is the top-level org we want
                if (parentId === empresasGroup.id) {
                    return current.name;
                }
                // Stop if we reach the root or another branch
                if (!parentId || parentId === "GroupCompanyId") break;
                current = groupLookup[parentId];
            }
            return null;
        };

        return users
            .filter(u => u.lastAccessDate && !u.lastAccessDate.startsWith("0001"))
            .map(u => {
                const days = getInactivityDays(u.lastAccessDate);
                const userOrgsSet = new Set();

                if (u.companyGroups) {
                    u.companyGroups.forEach(g => {
                        const topOrg = getTopLevelOrg(g.id || g);
                        if (topOrg) userOrgsSet.add(topOrg);
                    });
                }
                const userOrgs = Array.from(userOrgsSet);

                return {
                    id: u.id,
                    name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.name,
                    email: u.name,
                    employeeNumber: u.employeeNumber || "—",
                    isDriver: u.isDriver ? "Sí" : "No",
                    lastAccess: u.lastAccessDate,
                    daysInactive: days,
                    status: getStatusInfo(days),
                    securityGroups: u.securityGroups ? u.securityGroups.map(g => translateSecurityGroup(g.name || g.id)) : [],
                    organizationGroups: userOrgs,
                    phone: u.phone || u.phoneNumber || "—",
                    timeZone: u.timeZoneId || "—",
                    language: u.language || "—"
                };
            })
            .filter(u => u.organizationGroups.length > 0)
            .sort((a, b) => b.daysInactive - a.daysInactive);
    };


    // ─── Rendering ───────────────────────────────────────────────────────────
    const renderKPIs = (users) => {
        const stats = {
            total: users.length,
            normal: users.filter(u => u.daysInactive <= 4).length,
            grave: users.filter(u => u.daysInactive >= 5 && u.daysInactive <= 8).length,
            critical: users.filter(u => u.daysInactive >= 9).length
        };

        animateCount(document.getElementById("stat-total"), stats.total);
        animateCount(document.getElementById("stat-normal"), stats.normal);
        animateCount(document.getElementById("stat-grave"), stats.grave);
        animateCount(document.getElementById("stat-critical"), stats.critical);
    };

    const renderTable = (users) => {
        if (!userGrid) return;
        userGrid.innerHTML = "";

        if (users.length === 0) {
            userGrid.innerHTML = `
                <div style="text-align:center; padding: 5rem; width: 100%; color: var(--color-text-muted);">
                    No se encontraron usuarios que coincidan con la búsqueda.
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();
        users.forEach(u => {
            const statusType = getStatusType(u.status.label);
            const phone = u.phone && u.phone !== "—" ? u.phone : "+52 00 0000 0000";
            const isSelected = selectedEmails.has(u.email);

            const card = document.createElement("div");
            card.className = `user-card user-card--${statusType} ${isSelected ? 'user-card--selected' : ''}`;
            card.dataset.email = u.email;
            card.innerHTML = `
                <div class="user-card__checkbox">
                    <i data-lucide="check" width="14" height="14"></i>
                </div>
                <div class="user-card__badge-status">
                    <i data-lucide="${statusType === 'normal' ? 'check-circle' : statusType === 'grave' ? 'alert-circle' : 'alert-triangle'}" width="14" height="14"></i>
                    <span>${u.status.label}</span>
                </div>

                <div class="user-card__header">
                    <div class="user-card__info">
                        <div class="user-card__name">${u.name}</div>
                        <div class="user-card__email">${u.email}</div>
                        <div class="user-card__phone">
                            <i data-lucide="phone" width="14" height="14"></i>
                            <span>${phone}</span>
                        </div>
                    </div>
                </div>

                <div class="user-card__body">
                    <div class="user-card__data-group">
                        <div class="user-card__label">Organización</div>
                        <div class="user-card__value">${u.organizationGroups.length > 0 ? u.organizationGroups.join(", ") : "—"}</div>
                    </div>
                    <div class="user-card__data-group">
                        <div class="user-card__label">Seguridad</div>
                        <div class="user-card__value">${u.securityGroups.length > 0 ? u.securityGroups.join(", ") : "—"}</div>
                    </div>
                    <div class="user-card__data-group">
                        <div class="user-card__label">Conductor</div>
                        <div class="user-card__value">
                            <span class="user-card__driver-badge" style="background: ${u.isDriver === 'Sí' ? '#f0fff4' : '#fef2f2'}; color: ${u.isDriver === 'Sí' ? '#2f855a' : '#991b1b'};">
                                ${u.isDriver}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="user-card__footer">
                    <div class="user-card__last-access">
                        <i data-lucide="clock" width="14" height="14"></i>
                        <span>Último acceso: ${formatDate(u.lastAccess).toLowerCase()}</span>
                    </div>
                    <div class="user-card__days-badge" style="background: ${statusType === 'normal' ? '#f0fff4' : statusType === 'grave' ? '#fff9db' : '#fff5f5'}; color: ${statusType === 'normal' ? '#2f855a' : statusType === 'grave' ? '#f08c00' : '#c53030'};">
                        Hace ${u.daysInactive} días
                    </div>
                </div>
            `;

            card.addEventListener("click", (e) => {
                toggleSelection(u.email, card);
            });

            fragment.appendChild(card);
        });
        userGrid.appendChild(fragment);

        // Re-initialize icons
        if (window.lucide) window.lucide.createIcons();
    };

    const toggleSelection = (email, card) => {
        if (selectedEmails.has(email)) {
            selectedEmails.delete(email);
            card.classList.remove("user-card--selected");
        } else {
            selectedEmails.add(email);
            card.classList.add("user-card--selected");
        }
        updateEmailButton();
    };

    const updateEmailButton = () => {
        if (!btnEmail) return;
        const count = selectedEmails.size;
        btnEmail.disabled = count === 0;
        btnEmail.querySelector("span").textContent = `Enviar Correo (${count})`;
    };

    const loadEmailSettings = () => {
        const savedSubject = localStorage.getItem(STORAGE_KEY_SUBJECT) || DEFAULT_SUBJECT;
        const savedBody = localStorage.getItem(STORAGE_KEY_BODY) || DEFAULT_BODY;

        if (inputSubject) inputSubject.value = savedSubject;
        if (inputBody) inputBody.value = savedBody;

        return { subject: savedSubject, body: savedBody };
    };

    const saveEmailSettings = () => {
        const subject = inputSubject.value.trim() || DEFAULT_SUBJECT;
        const body = inputBody.value.trim() || DEFAULT_BODY;

        localStorage.setItem(STORAGE_KEY_SUBJECT, subject);
        localStorage.setItem(STORAGE_KEY_BODY, body);

        modal.classList.remove("active");
        alert("Configuración guardada correctamente.");
    };

    const handleSendEmail = () => {
        if (selectedEmails.size === 0) return;

        // Separador estándar (coma) para Thunderbird
        const emails = Array.from(selectedEmails).join(",");

        const settings = loadEmailSettings();
        const subject = encodeURIComponent(settings.subject);
        const body = encodeURIComponent(settings.body);

        // URL mailto: completa
        const mailtoUrl = `mailto:?bcc=${emails}&subject=${subject}&body=${body}`;

        // Límite de seguridad para Thunderbird en Windows (~2000 chars)
        // Si se supera, el sistema operativo o Thunderbird pueden ignorar la llamada
        const URL_LIMIT = 2000;
        const isUrlTooLong = mailtoUrl.length > URL_LIMIT;

        // Siempre intentamos copiar al portapapeles como respaldo seguro
        navigator.clipboard.writeText(emails).then(() => {
            console.log("Emails copiados al portapapeles");

            if (isUrlTooLong) {
                // Si es muy largo, no intentamos abrir el enlace porque fallará silenciosamente
                // y confundirá al usuario. Mejor ser directos.
                alert(`Has seleccionado ${selectedEmails.size} correos.

La lista es demasiado larga para abrirse automáticamente en Thunderbird (límite de longitud de Windows).

ACCIÓN REQUERIDA:
1. Thunderbird NO se abrirá automáticamente.
2. Los correos YA están copiados en tu portapapeles.
3. Abre Thunderbird manualmente y pega (Ctrl+V) en el campo CCO (BCC).`);
            } else {
                // Intentar abrir el enlace
                window.location.href = mailtoUrl;
            }
        }).catch(err => {
            console.error("Error al copiar al portapapeles:", err);

            if (!isUrlTooLong) {
                window.location.href = mailtoUrl;
            } else {
                alert(`Error al acceder al portapapeles. 

La lista de ${selectedEmails.size} correos es demasiado larga para Thunderbird y no se pudo copiar automáticamente. Por favor, selecciona menos usuarios.`);
            }
        });
    };

    const renderCharts = (statusUsers, groupUsers, orgUsers) => {
        // Inactivity Distribution (uses statusUsers, which is filtered by everything EXCEPT status)
        const inactivityGroups = {
            "Normal": statusUsers.filter(u => u.daysInactive <= 4).length,
            "Grave": statusUsers.filter(u => u.daysInactive >= 5 && u.daysInactive <= 8).length,
            "Crítico": statusUsers.filter(u => u.daysInactive >= 9).length
        };

        const inactivityOptions = {
            series: Object.values(inactivityGroups),
            labels: Object.keys(inactivityGroups),
            chart: {
                type: 'donut',
                height: 350,
                events: {
                    dataPointSelection: (event, chartContext, config) => {
                        if (config.dataPointIndex === -1) return;
                        const status = config.w.config.labels[config.dataPointIndex];
                        currentFilters.status = (currentFilters.status === status) ? null : status;
                        applyFilters();
                    }
                }
            },
            colors: ['#10b981', '#f59e0b', '#f43f5e'],
            legend: { position: 'bottom' },
            dataLabels: { enabled: true, formatter: (val) => val.toFixed(0) + "%" },
            plotOptions: {
                pie: {
                    donut: {
                        size: '70%',
                        labels: {
                            show: true,
                            name: { show: true, fontSize: '14px', fontWeight: 600 },
                            value: { show: true, fontSize: '20px', fontWeight: 800 },
                            total: { show: true, label: 'Usuarios', fontSize: '14px', fontWeight: 600 }
                        }
                    }
                }
            }
        };

        if (charts.inactivity) charts.inactivity.destroy();
        charts.inactivity = new ApexCharts(document.getElementById("chart-inactivity"), inactivityOptions);
        charts.inactivity.render();

        // Security Groups Distribution (uses groupUsers)
        const groupsCount = {};
        groupUsers.forEach(u => {
            u.securityGroups.forEach(g => {
                groupsCount[g] = (groupsCount[g] || 0) + 1;
            });
        });

        const sortedGroups = Object.entries(groupsCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const groupOptions = {
            series: [{ data: sortedGroups.map(g => g[1]) }],
            chart: {
                type: 'bar',
                height: 350,
                toolbar: { show: false },
                events: {
                    dataPointSelection: (event, chartContext, config) => {
                        if (config.dataPointIndex === -1) return;
                        const group = sortedGroups[config.dataPointIndex][0];
                        currentFilters.securityGroup = (currentFilters.securityGroup === group) ? null : group;
                        applyFilters();
                    }
                }
            },
            plotOptions: { bar: { borderRadius: 6, horizontal: true, barHeight: '70%' } },
            colors: ['#1e293b'],
            xaxis: { categories: sortedGroups.map(g => g[0]) },
            title: { text: 'Top Grupos de Seguridad', align: 'center', style: { fontSize: '12px' } }
        };

        if (charts.groups) charts.groups.destroy();
        charts.groups = new ApexCharts(document.getElementById("chart-groups"), groupOptions);
        charts.groups.render();

        // Stacked Org Chart (uses orgUsers)
        const orgData = {};
        orgUsers.forEach(u => {
            u.organizationGroups.forEach(org => {
                if (!orgData[org]) orgData[org] = { normal: 0, grave: 0, critical: 0, total: 0 };
                const type = getStatusType(u.status.label);
                orgData[org][type]++;
                orgData[org].total++;
            });
        });

        const topOrgs = Object.entries(orgData)
            .sort((a, b) => b[1].total - a[1].total)
            .slice(0, 15);

        const stackedOptions = {
            series: [
                { name: 'Normal', data: topOrgs.map(o => o[1].normal || 0) },
                { name: 'Grave', data: topOrgs.map(o => o[1].grave || 0) },
                { name: 'Crítico', data: topOrgs.map(o => o[1].critical || 0) }
            ],
            chart: {
                type: 'bar',
                height: 450,
                stacked: true,
                toolbar: { show: true },
                events: {
                    dataPointSelection: (event, chartContext, config) => {
                        if (config.dataPointIndex === -1) return;
                        const org = topOrgs[config.dataPointIndex][0];
                        if (selectedOrgs.has(org)) {
                            selectedOrgs.delete(org);
                        } else {
                            selectedOrgs.clear();
                            selectedOrgs.add(org);
                        }
                        updateOrgTriggerLabel();
                        applyFilters();
                    }
                }
            },
            plotOptions: {
                bar: {
                    horizontal: false,
                    columnWidth: '55%',
                    borderRadius: 4,
                    dataLabels: {
                        total: {
                            enabled: true,
                            formatter: function (val, opts) {
                                return opts.w.globals.seriesTotals[opts.dataPointIndex];
                            },
                            style: {
                                fontSize: '12px',
                                fontWeight: 800,
                                color: '#1e293b'
                            }
                        }
                    }
                }
            },
            dataLabels: {
                enabled: true,
                formatter: function (val) {
                    return val > 0 ? val : "";
                },
                style: {
                    fontSize: '10px',
                    colors: ['#fff']
                }
            },
            colors: ['#10b981', '#f59e0b', '#f43f5e'],
            xaxis: {
                categories: topOrgs.map(o => o[0]),
                labels: { rotate: -45, style: { fontSize: '10px' } }
            },
            yaxis: { title: { text: 'Total de Usuarios' } },
            legend: { position: 'top', horizontalAlign: 'center' },
            fill: { opacity: 1 },
            tooltip: {
                y: {
                    formatter: (val) => `${val} usuarios`
                }
            }
        };

        if (charts.orgStacked) charts.orgStacked.destroy();
        charts.orgStacked = new ApexCharts(document.getElementById("chart-org-stacked"), stackedOptions);
        charts.orgStacked.render();
    };

    // ─── Actions ─────────────────────────────────────────────────────────────
    const loadData = () => {
        if (!api) return;
        btnRefresh.classList.add("loading");

        api.multiCall([
            ["Get", { typeName: "User", search: { isBasicAuthentication: false } }],
            ["Get", { typeName: "Group" }]
        ], (results) => {
            const users = results[0];
            const groups = results[1];

            allUsers = processData(users, groups);

            // Populate organization filter
            if (orgOptionsList) {
                const orgs = [...new Set(allUsers.flatMap(u => u.organizationGroups))].filter(o => o !== "—").sort();
                renderOrgOptions(orgs);
            }

            filteredUsers = [...allUsers];
            selectedEmails.clear();
            updateEmailButton();

            applyFilters();

            lastUpdatedEl.textContent = `Actualizado: ${new Date().toLocaleTimeString()}`;
            btnRefresh.classList.remove("loading");
        }, (err) => {
            console.error("Error fetching data:", err);
            btnRefresh.classList.remove("loading");
            alert("Error al cargar los datos.");
        });
    };

    const getFilteredUsers = (excludeFilter = null) => {
        const query = (searchInput.value || "").toLowerCase().trim();

        return allUsers.filter(u => {
            // Search filter
            if (query && excludeFilter !== 'search') {
                const matchesSearch = u.name.toLowerCase().includes(query) ||
                    u.email.toLowerCase().includes(query) ||
                    u.phone.toLowerCase().includes(query);
                if (!matchesSearch) return false;
            }

            // Organization filter
            if (selectedOrgs.size > 0 && excludeFilter !== 'organization') {
                const matchesOrg = Array.from(selectedOrgs).some(org => u.organizationGroups.includes(org));
                if (!matchesOrg) return false;
            }

            // Status filter
            if (currentFilters.status && excludeFilter !== 'status') {
                if (u.status.label !== currentFilters.status) return false;
            }

            // Security Group filter
            if (currentFilters.securityGroup && excludeFilter !== 'securityGroup') {
                if (!u.securityGroups.includes(currentFilters.securityGroup)) return false;
            }

            return true;
        });
    };

    const applyFilters = () => {
        filteredUsers = getFilteredUsers();

        renderKPIs(filteredUsers);
        renderTable(filteredUsers);

        // Re-render charts with cross-filtering logic
        // Each chart shows data filtered by EVERYTHING ELSE except its own category
        const statusFiltered = getFilteredUsers('status');
        const orgFiltered = getFilteredUsers('organization');
        const securityFiltered = getFilteredUsers('securityGroup');

        renderCharts(statusFiltered, orgFiltered, securityFiltered);
    };

    const renderOrgOptions = (orgs) => {
        if (!orgOptionsList) return;
        orgOptionsList.innerHTML = "";

        orgs.forEach(org => {
            const option = document.createElement("div");
            option.className = "multi-select__option";
            option.dataset.value = org;
            option.innerHTML = `
                <input type="checkbox" ${selectedOrgs.has(org) ? 'checked' : ''}>
                <span>${org}</span>
            `;

            option.addEventListener("click", (e) => {
                const cb = option.querySelector("input");
                if (e.target !== cb) cb.checked = !cb.checked;

                if (cb.checked) selectedOrgs.add(org);
                else selectedOrgs.delete(org);

                updateOrgTriggerLabel();
            });

            orgOptionsList.appendChild(option);
        });
        updateOrgTriggerLabel();
    };

    const updateOrgTriggerLabel = () => {
        const labelEl = multiSelectContainer.querySelector(".multi-select__label");
        if (selectedOrgs.size === 0) {
            labelEl.textContent = "Todas las organizaciones";
        } else if (selectedOrgs.size === 1) {
            labelEl.textContent = Array.from(selectedOrgs)[0];
        } else {
            labelEl.textContent = `${selectedOrgs.size} organizaciones`;
        }
    };

    const handleOrgSearch = (e) => {
        const term = e.target.value.toLowerCase();
        const options = orgOptionsList.querySelectorAll(".multi-select__option");
        options.forEach(opt => {
            const val = opt.dataset.value.toLowerCase();
            opt.classList.toggle("hidden", !val.includes(term));
        });
    };

    const exportToExcel = () => {
        const data = filteredUsers.map(u => ({
            "Nombre": u.name,
            "Email": u.email,
            "¿Es Conductor?": u.isDriver,
            "Grupos de Seguridad": u.securityGroups,
            "Grupos de Organización": u.organizationGroups,
            "Último Acceso": formatDate(u.lastAccess),
            "Días Inactivo": u.daysInactive,
            "Estado": u.status.label,
            "Teléfono": u.phone
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Usuarios");
        XLSX.writeFile(wb, `Reporte_Inactividad_Usuarios_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    // ─── Initialize ──────────────────────────────────────────────────────────
    return {
        initialize: function (geotabApi, state, callback) {
            api = geotabApi;

            // Initialize Lucide icons
            if (window.lucide) window.lucide.createIcons();

            // Bind DOM
            btnRefresh = document.getElementById("btn-refresh");
            btnClearAll = document.getElementById("btn-clear-all");
            lastUpdatedEl = document.getElementById("last-updated-time");
            searchInput = document.getElementById("search-input");
            btnExport = document.getElementById("btn-export");
            btnEmail = document.getElementById("btn-email");
            btnEmailSettings = document.getElementById("btn-email-settings");
            userGrid = document.getElementById("user-grid");

            // Multi-select Bind
            multiSelectContainer = document.getElementById("multi-select-org");
            multiSelectTrigger = multiSelectContainer.querySelector(".multi-select__trigger");
            multiSelectDropdown = multiSelectContainer.querySelector(".multi-select__dropdown");
            orgSearchInput = document.getElementById("org-search-input");
            orgOptionsList = document.getElementById("org-options-list");
            btnClearOrgs = document.getElementById("btn-clear-orgs");
            btnApplyOrgs = document.getElementById("btn-apply-orgs");

            // Modal Refs
            modal = document.getElementById("email-settings-modal");
            btnCloseModal = document.getElementById("btn-close-modal");
            btnSaveSettings = document.getElementById("btn-save-settings");
            inputSubject = document.getElementById("email-subject");
            inputBody = document.getElementById("email-body");

            // Events
            btnRefresh.addEventListener("click", loadData);
            btnClearAll.addEventListener("click", () => {
                // Clear all filters
                searchInput.value = "";
                selectedOrgs.clear();
                currentFilters.status = null;
                currentFilters.securityGroup = null;
                currentFilters.organization = null;

                // Update UI
                updateOrgTriggerLabel();
                document.querySelectorAll(".stat-card").forEach(c => c.classList.remove("active"));

                // Re-apply
                applyFilters();
            });
            searchInput.addEventListener("input", applyFilters);
            btnExport.addEventListener("click", exportToExcel);
            btnEmail.addEventListener("click", handleSendEmail);

            // KPI click listeners
            document.querySelectorAll(".stat-card").forEach(card => {
                card.style.cursor = "pointer";
                card.addEventListener("click", () => {
                    const label = card.querySelector(".stat-label").textContent;
                    let newStatus = null;

                    if (label.includes("Normal")) newStatus = "Normal";
                    else if (label.includes("Grave")) newStatus = "Grave";
                    else if (label.includes("Crítica")) newStatus = "Crítico";

                    // Toggle status filter
                    currentFilters.status = (currentFilters.status === newStatus) ? null : newStatus;

                    // Update UI active state
                    document.querySelectorAll(".stat-card").forEach(c => c.classList.remove("active"));
                    if (currentFilters.status) {
                        card.classList.add("active");
                    } else if (label.includes("Total")) {
                        // If clicking total, we already removed active from all
                    }

                    applyFilters();
                });
            });

            // Multi-select events
            multiSelectTrigger.addEventListener("click", (e) => {
                e.stopPropagation();
                multiSelectContainer.classList.toggle("active");
                if (multiSelectContainer.classList.contains("active")) {
                    orgSearchInput.focus();
                }
            });

            orgSearchInput.addEventListener("input", handleOrgSearch);

            btnClearOrgs.addEventListener("click", (e) => {
                e.stopPropagation();
                selectedOrgs.clear();
                const checks = orgOptionsList.querySelectorAll("input");
                checks.forEach(c => c.checked = false);
                updateOrgTriggerLabel();
                applyFilters();
                multiSelectContainer.classList.remove("active");
            });

            btnApplyOrgs.addEventListener("click", (e) => {
                e.stopPropagation();
                applyFilters();
                multiSelectContainer.classList.remove("active");
            });

            // Modal events
            btnEmailSettings.addEventListener("click", () => {
                loadEmailSettings();
                modal.classList.add("active");
            });

            btnCloseModal.addEventListener("click", () => modal.classList.remove("active"));
            btnSaveSettings.addEventListener("click", saveEmailSettings);

            // Close multi-select on outside click
            window.addEventListener("click", (e) => {
                if (!multiSelectContainer.contains(e.target)) {
                    multiSelectContainer.classList.remove("active");
                }
                if (e.target === modal) modal.classList.remove("active");
            });

            loadEmailSettings();

            loadData();
            if (callback) callback();
        },
        focus: function (api, state) {
            loadData();
        },
        blur: function (api, state) {
            // Cleanup if needed
        }
    };
};
