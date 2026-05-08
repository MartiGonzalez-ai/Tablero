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

    // DOM Refs
    let btnRefresh, lastUpdatedEl, searchInput, btnExport, btnEmail, btnEmailSettings, userGrid;
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
        if (!dateStr || dateStr.startsWith("0001")) return "Nunca";
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
        if (days === Infinity) return { label: "Nunca", class: "badge--never" };
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

    const getInitials = (name) => {
        if (!name) return "?";
        const parts = name.trim().split(" ");
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    const getStatusType = (label) => {
        if (label.includes("Normal")) return "normal";
        if (label.includes("Grave")) return "grave";
        if (label.includes("Crítico")) return "critical";
        return "never";
    };

    // ─── Data Processing ─────────────────────────────────────────────────────
    const processData = (users, groups = []) => {
        const groupMap = {};
        groups.forEach(g => {
            if (g.id && g.name) groupMap[g.id] = g.name;
        });

        return users.map(u => {
            const days = getInactivityDays(u.lastAccessDate);
            return {
                id: u.id,
                name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.name,
                email: u.name,
                employeeNumber: u.employeeNumber || "—",
                isDriver: u.isDriver ? "Sí" : "No",
                lastAccess: u.lastAccessDate,
                daysInactive: days,
                status: getStatusInfo(days),
                securityGroups: u.securityGroups ? u.securityGroups.map(g => translateSecurityGroup(g.name || g.id)).join(", ") : "—",
                organizationGroups: u.companyGroups ? u.companyGroups.map(g => {
                    const groupId = g.id || g;
                    return groupMap[groupId] || g.name || groupId;
                }).join(", ") : "—",
                phone: u.phoneNumber || "—",
                timeZone: u.timeZoneId || "—",
                language: u.language || "—"
            };
        }).sort((a, b) => b.daysInactive - a.daysInactive);
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
            const initials = getInitials(u.name);
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
                    <div class="user-card__avatar">${initials}</div>
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
                        <div class="user-card__value">${u.organizationGroups}</div>
                    </div>
                    <div class="user-card__data-group">
                        <div class="user-card__label">Seguridad</div>
                        <div class="user-card__value">${u.securityGroups}</div>
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
                        Hace ${u.daysInactive === Infinity ? "—" : u.daysInactive} días
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

    const renderCharts = (users) => {
        // Inactivity Distribution
        const inactivityGroups = {
            "0-4d": users.filter(u => u.daysInactive <= 4).length,
            "5-8d": users.filter(u => u.daysInactive >= 5 && u.daysInactive <= 8).length,
            "9+ d": users.filter(u => u.daysInactive >= 9 && u.daysInactive !== Infinity).length,
            "Nunca": users.filter(u => u.daysInactive === Infinity).length
        };

        const inactivityOptions = {
            series: Object.values(inactivityGroups),
            labels: Object.keys(inactivityGroups),
            chart: { type: 'donut', height: 350 },
            colors: ['#10b981', '#f59e0b', '#f43f5e', '#94a3b8'],
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

        // Security Groups Distribution (Top 10)
        const groupsCount = {};
        users.forEach(u => {
            const groups = u.securityGroups.split(", ");
            groups.forEach(g => {
                if (g === "—") return;
                groupsCount[g] = (groupsCount[g] || 0) + 1;
            });
        });

        const sortedGroups = Object.entries(groupsCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const groupOptions = {
            series: [{ data: sortedGroups.map(g => g[1]) }],
            chart: { type: 'bar', height: 350, toolbar: { show: false } },
            plotOptions: { bar: { borderRadius: 6, horizontal: true, barHeight: '70%' } },
            colors: ['#1e293b'],
            xaxis: { categories: sortedGroups.map(g => g[0]) },
            title: { text: 'Top Grupos de Seguridad', align: 'center', style: { fontSize: '12px' } }
        };

        if (charts.groups) charts.groups.destroy();
        charts.groups = new ApexCharts(document.getElementById("chart-groups"), groupOptions);
        charts.groups.render();

        // Stacked Org Chart
        const orgData = {};
        users.forEach(u => {
            const orgs = u.organizationGroups.split(", ");
            orgs.forEach(org => {
                if (org === "—") return;
                if (!orgData[org]) orgData[org] = { normal: 0, grave: 0, critical: 0, never: 0, total: 0 };
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
                { name: 'Crítico', data: topOrgs.map(o => o[1].critical || 0) },
                { name: 'Nunca', data: topOrgs.map(o => o[1].never || 0) }
            ],
            chart: {
                type: 'bar',
                height: 450,
                stacked: true,
                toolbar: { show: true }
            },
            plotOptions: {
                bar: {
                    horizontal: false,
                    columnWidth: '55%',
                    borderRadius: 4,
                    dataLabels: {
                        total: {
                            enabled: true,
                            style: {
                                fontSize: '12px',
                                fontWeight: 800,
                                color: '#1e293b'
                            }
                        }
                    }
                }
            },
            dataLabels: { enabled: false },
            colors: ['#10b981', '#f59e0b', '#f43f5e', '#94a3b8'],
            xaxis: {
                categories: topOrgs.map(o => o[0]),
                labels: { rotate: -45, style: { fontSize: '10px' } }
            },
            yaxis: { title: { text: 'Porcentaje de Usuarios' } },
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
                const orgs = [...new Set(allUsers.flatMap(u => u.organizationGroups.split(", ")))].filter(o => o !== "—").sort();
                renderOrgOptions(orgs);
            }

            filteredUsers = [...allUsers];
            selectedEmails.clear();
            updateEmailButton();

            renderKPIs(allUsers);
            renderTable(allUsers);
            renderCharts(allUsers);

            lastUpdatedEl.textContent = `Actualizado: ${new Date().toLocaleTimeString()}`;
            btnRefresh.classList.remove("loading");
        }, (err) => {
            console.error("Error fetching data:", err);
            btnRefresh.classList.remove("loading");
            alert("Error al cargar los datos.");
        });
    };

    const applyFilters = () => {
        const query = searchInput.value.toLowerCase();

        filteredUsers = allUsers.filter(u => {
            const matchesSearch = u.name.toLowerCase().includes(query) || 
                                 u.email.toLowerCase().includes(query) ||
                                 u.phone.toLowerCase().includes(query);
            
            let matchesOrg = true;
            if (selectedOrgs.size > 0) {
                const userGroups = u.organizationGroups.split(", ");
                matchesOrg = Array.from(selectedOrgs).some(org => userGroups.includes(org));
            }
            
            return matchesSearch && matchesOrg;
        });

        renderKPIs(filteredUsers);
        renderTable(filteredUsers);
        renderCharts(filteredUsers);
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
            "Días Inactivo": u.daysInactive === Infinity ? "Nunca" : u.daysInactive,
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
            searchInput.addEventListener("input", applyFilters);
            btnExport.addEventListener("click", exportToExcel);
            btnEmail.addEventListener("click", handleSendEmail);
            
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
