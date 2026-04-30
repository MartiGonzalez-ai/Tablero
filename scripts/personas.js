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
    let btnRefresh, lastUpdatedEl, searchInput, btnExport, userTbody;

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

    // ─── Data Processing ─────────────────────────────────────────────────────
    const processData = (users) => {
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
                securityGroups: u.securityGroups ? u.securityGroups.map(g => g.name || g.id).join(", ") : "—",
                organizationGroups: u.companyGroups ? u.companyGroups.map(g => g.name || g.id).join(", ") : "—",
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
        if (!userTbody) return;
        userTbody.innerHTML = "";

        if (users.length === 0) {
            userTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 3rem;">No se encontraron usuarios.</td></tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        users.forEach(u => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="font-family:monospace; font-size:0.7rem;">${u.id}</td>
                <td>
                    <div class="user-info">
                        <span class="user-name">${u.name}</span>
                    </div>
                </td>
                <td><span class="user-email">${u.email}</span></td>
                <td>${u.employeeNumber}</td>
                <td style="text-align:center;">${u.isDriver}</td>
                <td style="font-size:0.75rem;">${u.securityGroups}</td>
                <td style="font-size:0.75rem;">${u.organizationGroups}</td>
                <td>${formatDate(u.lastAccess)}</td>
                <td style="font-weight:700;">${u.daysInactive === Infinity ? "—" : u.daysInactive + " días"}</td>
                <td><span class="badge ${u.status.class}">${u.status.label}</span></td>
                <td>${u.phone}</td>
                <td style="font-size:0.75rem;">${u.timeZone}</td>
                <td>${u.language}</td>
            `;
            fragment.appendChild(tr);
        });
        userTbody.appendChild(fragment);
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

        api.call("Get", {
            typeName: "User",
            search: { isBasicAuthentication: false } // Typical filter for real users
        }, (users) => {
            allUsers = processData(users);
            filteredUsers = [...allUsers];

            renderKPIs(allUsers);
            renderTable(allUsers);
            renderCharts(allUsers);

            lastUpdatedEl.textContent = `Actualizado: ${new Date().toLocaleTimeString()}`;
            btnRefresh.classList.remove("loading");
        }, (err) => {
            console.error("Error fetching users:", err);
            btnRefresh.classList.remove("loading");
            alert("Error al cargar los datos de usuarios.");
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
            "ID": u.id,
            "Nombre": u.name,
            "Email": u.email,
            "Núm. Empleado": u.employeeNumber,
            "¿Es Conductor?": u.isDriver,
            "Grupos de Seguridad": u.securityGroups,
            "Grupos de Organización": u.organizationGroups,
            "Último Acceso": formatDate(u.lastAccess),
            "Días Inactivo": u.daysInactive === Infinity ? "Nunca" : u.daysInactive,
            "Estado": u.status.label,
            "Teléfono": u.phone,
            "Zona Horaria": u.timeZone,
            "Idioma": u.language
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
            userTbody = document.getElementById("user-tbody");

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
