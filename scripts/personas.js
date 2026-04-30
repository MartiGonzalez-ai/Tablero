"use strict";

geotab.addin.personas = function () {
    let api;
    let allUsers = [];
    let filteredUsers = [];
    let charts = {
        inactivity: null,
        groups: null
    };

    // DOM Refs
    let btnRefresh, lastUpdatedEl, searchInput, btnExport, userGrid, groupsTbody;

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
        if (days < 7) return { label: "Activo", class: "badge--active" };
        if (days <= 30) return { label: "Inactivo (Medio)", class: "badge--warning" };
        return { label: "Inactivo (Crítico)", class: "badge--critical" };
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
        if (label.includes("Activo")) return "active";
        if (label.includes("Medio")) return "warning";
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
            active: users.filter(u => u.daysInactive < 7).length,
            warning: users.filter(u => u.daysInactive >= 7 && u.daysInactive <= 30).length,
            critical: users.filter(u => u.daysInactive > 30).length
        };

        animateCount(document.getElementById("stat-total"), stats.total);
        animateCount(document.getElementById("stat-active"), stats.active);
        animateCount(document.getElementById("stat-warning"), stats.warning);
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
            const phone = u.phone && u.phone !== "—" ? u.phone : "+52 00 0000 0000"; // Placeholder as in image if none
            
            const card = document.createElement("div");
            card.className = `user-card user-card--${statusType}`;
            card.innerHTML = `
                <div class="user-card__badge-status">
                    <i data-lucide="${statusType === 'active' ? 'check-circle' : statusType === 'warning' ? 'alert-circle' : 'alert-triangle'}" width="14" height="14"></i>
                    <span>${u.status.label.split(" (")[0]}</span>
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
                    <div class="user-card__days-badge" style="background: ${statusType === 'active' ? '#f0fff4' : statusType === 'warning' ? '#fff9db' : '#fff5f5'}; color: ${statusType === 'active' ? '#2f855a' : statusType === 'warning' ? '#f08c00' : '#c53030'};">
                        Hace ${u.daysInactive === Infinity ? "—" : u.daysInactive} días
                    </div>
                </div>
            `;
            fragment.appendChild(card);
        });
        userGrid.appendChild(fragment);

        // Re-initialize icons
        if (window.lucide) window.lucide.createIcons();
    };

    const renderGroupsTable = (groups) => {
        if (!groupsTbody) return;
        groupsTbody.innerHTML = "";

        // Filter to only show groups that have a name (ignore system groups if necessary)
        const sortedGroups = groups
            .filter(g => g.name && g.id)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (sortedGroups.length === 0) {
            groupsTbody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding: 2rem;">No se encontraron grupos.</td></tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        sortedGroups.forEach(g => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="font-weight:600;">${g.name}</td>
                <td style="font-family:monospace; color: var(--color-text-muted);">${g.id}</td>
            `;
            fragment.appendChild(tr);
        });
        groupsTbody.appendChild(fragment);
    };

    const renderCharts = (users) => {
        // Inactivity Distribution
        const inactivityGroups = {
            "< 7d": users.filter(u => u.daysInactive < 7).length,
            "7-30d": users.filter(u => u.daysInactive >= 7 && u.daysInactive <= 30).length,
            "> 30d": users.filter(u => u.daysInactive > 30 && u.daysInactive !== Infinity).length,
            "Nunca": users.filter(u => u.daysInactive === Infinity).length
        };

        const inactivityOptions = {
            series: Object.values(inactivityGroups),
            labels: Object.keys(inactivityGroups),
            chart: { type: 'donut', height: 350 },
            colors: ['#3b753c', '#f29300', '#cc0000', '#5e6c84'],
            legend: { position: 'bottom' },
            dataLabels: { enabled: true, formatter: (val) => val.toFixed(1) + "%" },
            plotOptions: {
                pie: {
                    donut: {
                        labels: {
                            show: true,
                            total: { show: true, label: 'Usuarios' }
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
            chart: { type: 'bar', height: 350 },
            plotOptions: { bar: { borderRadius: 4, horizontal: true } },
            colors: ['#003666'],
            xaxis: { categories: sortedGroups.map(g => g[0]) },
            title: { text: 'Top Grupos de Seguridad', align: 'center', style: { fontSize: '12px' } }
        };

        if (charts.groups) charts.groups.destroy();
        charts.groups = new ApexCharts(document.getElementById("chart-groups"), groupOptions);
        charts.groups.render();
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
            filteredUsers = [...allUsers];

            renderKPIs(allUsers);
            renderTable(allUsers);
            renderCharts(allUsers);
            renderGroupsTable(groups);

            lastUpdatedEl.textContent = `Actualizado: ${new Date().toLocaleTimeString()}`;
            btnRefresh.classList.remove("loading");
        }, (err) => {
            console.error("Error fetching data:", err);
            btnRefresh.classList.remove("loading");
            alert("Error al cargar los datos.");
        });
    };

    const handleSearch = (e) => {
        const query = e.target.value.toLowerCase();
        filteredUsers = allUsers.filter(u =>
            u.name.toLowerCase().includes(query) ||
            u.email.toLowerCase().includes(query)
        );
        renderTable(filteredUsers);
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
            userGrid = document.getElementById("user-grid");
            groupsTbody = document.getElementById("groups-tbody");

            // Events
            btnRefresh.addEventListener("click", loadData);
            searchInput.addEventListener("input", handleSearch);
            btnExport.addEventListener("click", exportToExcel);

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
