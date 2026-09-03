/**
 * ===================================================================
 * REPORTE-APSA.JS — Inventario de Vehículos (Geotab) & Google Drive
 * ===================================================================
 * 1. Tabla 1: Dispositivos de Geotab API (Nombre, Placa, VIN, IMEI)
 * 2. Tabla 2: Hoja de cálculo de Google Drive (Facturación y Hardware)
 * ===================================================================
 */

"use strict";

(function () {
    // ── Estado Global Tabla 1 (Geotab) ───────────────────────────
    let geotabApi = null;
    let rawDevices = [];
    let filteredDevices = [];
    let currentPage = 1;
    const ITEMS_PER_PAGE = 15;

    // ── Estado Global Tabla 2 (Google Drive) ─────────────────────
    let rawDriveData = [];
    let filteredDriveData = [];
    let currentDrivePage = 1;
    const DRIVE_ITEMS_PER_PAGE = 15;

    const GOOGLE_DRIVE_CSV_URL = "https://docs.google.com/spreadsheets/d/14kMu2pQkO3zwDZuvPPnD-VBvXHKPHX4A/export?format=csv";

    // ── Helper Selector DOM ──────────────────────────────────────
    const $ = id => document.getElementById(id);

    // ── Datos MOCK Tabla 1 (Geotab Standalone) ───────────────────
    const MOCK_DEVICES = [
        { id: "b1", name: "Camión APSA-01", licensePlate: "TRK-9821", vehicleIdentificationNumber: "3AKJHHDR5LS982101", serialNumber: "G90123456789" },
        { id: "b2", name: "Camión APSA-02", licensePlate: "TRK-9822", vehicleIdentificationNumber: "3AKJHHDR5LS982102", serialNumber: "G90123456790" },
        { id: "b3", name: "PickUp Sup 01", licensePlate: "PKP-4410", vehicleIdentificationNumber: "1FTFW1ED4MFA44103", serialNumber: "G90123456791" },
        { id: "b4", name: "PickUp Sup 02", licensePlate: "PKP-4411", vehicleIdentificationNumber: "1FTFW1ED4MFA44104", serialNumber: "G90123456792" },
        { id: "b5", name: "Tractor APSA-10", licensePlate: "TT-7701", vehicleIdentificationNumber: "1XPDD49X5MD770105", serialNumber: "G90123456793" },
        { id: "b6", name: "Tractor APSA-11", licensePlate: "TT-7702", vehicleIdentificationNumber: "1XPDD49X5MD770106", serialNumber: "G90123456794" },
        { id: "b7", name: "Furgón Entrega 01", licensePlate: "FRG-1205", vehicleIdentificationNumber: "3FA6P0H78KR120507", serialNumber: "G90123456795" },
        { id: "b8", name: "Furgón Entrega 02", licensePlate: "FRG-1206", vehicleIdentificationNumber: "3FA6P0H78KR120508", serialNumber: "G90123456796" },
        { id: "b9", name: "Utilitario 01", licensePlate: "UTL-3390", vehicleIdentificationNumber: "NM0ER4E21LT339009", serialNumber: "G90123456797" },
        { id: "b10", name: "Utilitario 02", licensePlate: "UTL-3391", vehicleIdentificationNumber: "NM0ER4E21LT339010", serialNumber: "G90123456798" }
    ];

    // ── Datos Fallback Tabla 2 (Google Drive Backup) ─────────────
    const GOOGLE_DRIVE_FALLBACK = [
        { serie: "G9074HT7U4TS", hwId: "567197836", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT7KN321040", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273190085", imei: "015718009408717", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G90V2H15BY6M", hwId: "566902371", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSCNAPT57N364430", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273169147", imei: "015718009399890", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G92HV3H8C276", hwId: "567200379", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPTXFN658811", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273167117", imei: "015718009372855", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G92PFKZ246AZ", hwId: "567195623", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT3KN329782", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273189293", imei: "015718009372350", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G93BTKTB3422", hwId: "567197758", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDZAPT8PN687251", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273189178", imei: "015718009416132", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G93NZHD476KM", hwId: "567200409", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT1JN327978", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273165608", imei: "015718009363409", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G93VP04AMY2D", hwId: "567194479", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDZAPTXPN687252", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273190978", imei: "015718009391251", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G94TWU81BHFK", hwId: "567206396", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT0HN478465", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273191935", imei: "015718009272253", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G957BVFSJKUD", hwId: "566925122", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "MR0EX8DD0J0254632", producto: "GO9LTETEFM", db: "enerkom", sim: "8934076100165258376", imei: "015718009414210", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G97PJ7H7Z6S0", hwId: "567197730", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT9DN200190", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273190101", imei: "015718009407834", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G97PJPF72KJR", hwId: "567206331", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT0KN329416", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273193014", imei: "015718009342262", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G98BBT9SDZ0R", hwId: "566898975", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSCNAPT57N364427", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273195738", imei: "015718009416330", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G98D2DR3YSEF", hwId: "567200494", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT6EN098980", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273168362", imei: "015718009419763", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G98V42M1H37S", hwId: "567206292", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3C6YDAAK2CG221832", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273193162", imei: "015718009337874", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G991DFRK5M1M", hwId: "567193893", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPTXEN098982", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273189608", imei: "015718009399064", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G995Z1KKEMYX", hwId: "567205359", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "MR0CX3DD0N1328674", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273190267", imei: "015718009409574", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G99SA0VD6HFD", hwId: "567197336", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT2HN158435", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273168438", imei: "015718009411687", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9CP77081ESN", hwId: "566903141", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSCNAPTXAN314890", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273168941", imei: "015718009398637", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9D3PTM1T1PE", hwId: "567197843", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT5KN284361", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273189228", imei: "015718009412438", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9DMCMXVJ1Y5", hwId: "567198837", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDZAPT1PN687169", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273189681", imei: "015718009423443", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9EE6UNJB4XE", hwId: "567198183", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPTXJN580264", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273189525", imei: "015718009412313", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9EHXSMTPPSY", hwId: "567202414", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT1GN282646", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164502", imei: "015718009391384", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9EUAKRFF0E0", hwId: "566920326", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSCNAPT99N067163", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273161854", imei: "015718009370305", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9FP2SFU6ZRW", hwId: "567206363", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT5HN478476", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273193154", imei: "015718009327560", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9J1PUCN5HNB", hwId: "567203014", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPTXEN098982", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164205", imei: "015718009397779", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9JEN6EFFN1R", hwId: "567198677", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HJGH8JP3FSS12230", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273189798", imei: "015718009374604", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9KVW7YV9UFV", hwId: "567206408", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPTXFN602805", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273193063", imei: "015718009342056", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9MR6WP15A7E", hwId: "567200826", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HJGH8JM8HSS15181", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273165442", imei: "015718009400169", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9N3J644ZRUN", hwId: "567200489", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPTXJN327977", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273165590", imei: "015718009364597", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9NACYCAPFEZ", hwId: "567198877", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDZAPTOPN687485", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273191059", imei: "015718009392747", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9NY78K71Y96", hwId: "567196440", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT6JN594663", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273193261", imei: "015718009413576", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9NZPCUKWA3Y", hwId: "567201083", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDZAPT2PN687486", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273165335", imei: "015718009387572", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9PF3YYNJ114", hwId: "567206528", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HJGH8JM7JSS15453", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273193030", imei: "015718009331182", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9PNE7TN3CSY", hwId: "567189676", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT9KN322318", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273192453", imei: "015718009393562", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9SB30UJ1URF", hwId: "567202281", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT0HN486419", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164619", imei: "015718009396474", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9U68007YCY3", hwId: "566901579", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSCNAPT57N379042", producto: "GO9LTETEFM", db: "enerkom", sim: "8934076100165255380", imei: "015718009368788", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9W49SPHBD16", hwId: "567203192", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT0HN706884", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164023", imei: "015718009367673", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9W5KBDMNZMM", hwId: "567202083", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT6HN152430", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164726", imei: "015718009368747", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9W6HJ3UMWSP", hwId: "567193682", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT1JN580251", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273192594", imei: "015718009382235", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9WHDDMSN1T3", hwId: "567202092", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT1FN744511", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164734", imei: "015718009371352", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9X9ZC7VXKKC", hwId: "567189763", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT5KN284361", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273192610", imei: "015718009416181", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9XSVBA2JC5C", hwId: "567202845", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT1HN593818", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164288", imei: "015718009398991", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9YY6CW8FMCH", hwId: "567202269", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSDJAPT9GN215597", producto: "GO9LTETEFM", db: "enerkom", sim: "8934072100273164551", imei: "015718009363185", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" },
        { serie: "G9ZAZ7AWB3K7", hwId: "566924398", cliente: "APSA (JUAN MANUEL YAÑEZ MERIDA)", estado: "Activo", vin: "3HSCNAPT49N067121", producto: "GO9LTETEFM", db: "enerkom", sim: "8934076100165259713", imei: "015718009419961", duracion: "36", nombre: "AUTOTANQUES PENINSULARES" }
    ];

    // ── Notificaciones Toast ──────────────────────────────────────
    const showToast = (message, type = "success") => {
        const toast = $("apsa-toast");
        const toastMsg = $("apsa-toast-msg");
        if (!toast || !toastMsg) return;

        toastMsg.textContent = message;
        toast.className = `apsa-toast apsa-toast-${type}`;
        toast.style.display = "flex";

        setTimeout(() => {
            toast.style.display = "none";
        }, 3500);
    };

    // ── Copiar al Portapapeles ───────────────────────────────────
    window.apsaCopyText = function (text, label) {
        if (!text || text === "—") return;
        navigator.clipboard.writeText(text).then(() => {
            showToast(`${label} copiado: ${text}`);
        }).catch(err => {
            console.error("Error al copiar:", err);
            showToast("No se pudo copiar el texto", "error");
        });
    };

    // ── Mostrar / Ocultar Loading ─────────────────────────────────
    const setLoading = (isLoading, message = "Cargando vehículos de la flota...") => {
        const overlay = $("apsa-loading");
        const textEl = $("apsa-loading-text");
        if (textEl) textEl.textContent = message;
        if (overlay) overlay.style.display = isLoading ? "flex" : "none";
    };

    // ══════════════════════════════════════════════════════════════
    // TABLA 1: GEOTAB API DEVEICES
    // ══════════════════════════════════════════════════════════════
    const fetchVehicles = () => {
        setLoading(true);

        if (!geotabApi || typeof geotabApi.call !== "function") {
            // Modo de prueba Standalone / Demo
            setTimeout(() => {
                rawDevices = MOCK_DEVICES;
                filteredDevices = [...rawDevices];
                currentPage = 1;
                renderTable1();
                setLoading(false);
                showToast("Modo Demo Geotab: 10 vehículos cargados");
            }, 500);
            return;
        }

        geotabApi.call("Get", {
            typeName: "Device"
        }, result => {
            setLoading(false);
            const devices = result || [];
            devices.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: 'base' }));

            rawDevices = devices;
            filteredDevices = [...rawDevices];
            currentPage = 1;

            renderTable1();
            showToast(`${rawDevices.length} vehículos Geotab cargados`);
        }, error => {
            setLoading(false);
            console.error("Error al obtener vehículos de Geotab:", error);
            showToast("Error al conectar con Geotab", "error");

            rawDevices = MOCK_DEVICES;
            filteredDevices = [...rawDevices];
            currentPage = 1;
            renderTable1();
        });
    };

    const applySearchFilter1 = () => {
        const searchInput = $("apsa-search-input");
        const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

        if (!query) {
            filteredDevices = [...rawDevices];
        } else {
            filteredDevices = rawDevices.filter(dev => {
                const name = (dev.name || "").toLowerCase();
                const plate = (dev.licensePlate || "").toLowerCase();
                const vin = (dev.vehicleIdentificationNumber || dev.vin || "").toLowerCase();
                const imei = (dev.serialNumber || "").toLowerCase();

                return name.includes(query) || plate.includes(query) || vin.includes(query) || imei.includes(query);
            });
        }

        currentPage = 1;
        renderTable1();
    };

    const renderTable1 = () => {
        const tbody = $("apsa-tbody");
        const countBadge = $("apsa-total-count");
        const pageInfo = $("apsa-page-info");
        const pageIndicator = $("apsa-page-indicator");
        const btnPrev = $("apsa-btn-prev");
        const btnNext = $("apsa-btn-next");

        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = filteredDevices.length;
        if (countBadge) countBadge.textContent = rawDevices.length;

        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);
        const pageData = filteredDevices.slice(startIndex, endIndex);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td colspan="4" class="apsa-empty-state">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;">
                        <i data-lucide="search-x" width="36" height="36" class="apsa-empty-icon"></i>
                        <span style="font-weight:600;color:var(--apsa-text);">No se encontraron vehículos</span>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach(dev => {
                const name = dev.name || "Sin nombre";
                const plate = dev.licensePlate || "—";
                const vin = dev.vehicleIdentificationNumber || dev.vin || "—";
                const imei = dev.serialNumber || "—";

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>
                        <div class="apsa-td-vehicle">
                            <div class="apsa-vehicle-icon">
                                <i data-lucide="truck" width="16" height="16"></i>
                            </div>
                            <span>${escapeHtml(name)}</span>
                        </div>
                    </td>
                    <td>
                        ${plate !== "—" 
                            ? `<span class="apsa-plate-pill">${escapeHtml(plate)}</span>` 
                            : `<span style="color:var(--apsa-muted);">—</span>`}
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                            <span class="apsa-td-mono">${escapeHtml(vin)}</span>
                            ${vin !== "—" ? `<button class="apsa-copy-btn" title="Copiar VIN" onclick="apsaCopyText('${escapeHtml(vin)}', 'VIN')"><i data-lucide="copy" width="13" height="13"></i></button>` : ''}
                        </div>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                            ${imei !== "—" 
                                ? `<span class="apsa-imei-tag"><i data-lucide="cpu" width="12" height="12"></i> ${escapeHtml(imei)}</span>
                                   <button class="apsa-copy-btn" title="Copiar IMEI" onclick="apsaCopyText('${escapeHtml(imei)}', 'IMEI')"><i data-lucide="copy" width="13" height="13"></i></button>`
                                : `<span style="color:var(--apsa-muted);">—</span>`}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        if (pageInfo) pageInfo.textContent = `Mostrando ${totalItems > 0 ? startIndex + 1 : 0}–${endIndex} de ${totalItems} vehículos Geotab`;
        if (pageIndicator) pageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled = currentPage <= 1;
        if (btnNext) btnNext.disabled = currentPage >= totalPages;

        if (window.lucide) lucide.createIcons();
    };

    // ══════════════════════════════════════════════════════════════
    // TABLA 2: GOOGLE DRIVE SPREADSHEET
    // ══════════════════════════════════════════════════════════════
    const fetchGoogleDriveData = () => {
        fetch(GOOGLE_DRIVE_CSV_URL)
            .then(res => {
                if (!res.ok) throw new Error("No se pudo acceder al CSV de Google Drive");
                return res.text();
            })
            .then(text => {
                const parsedRows = parseCSV(text);
                if (parsedRows.length > 1) {
                    // Omitir fila 0 (encabezados)
                    const dataRows = parsedRows.slice(1).map(row => ({
                        serie: row[0] || "—",
                        hwId: row[1] || "—",
                        cliente: row[2] || "—",
                        estado: row[3] || "Activo",
                        vin: row[4] || "—",
                        producto: row[5] || "—",
                        tipo: row[6] || "",
                        db: row[7] || "—",
                        sim: row[8] || "—",
                        imei: row[9] || "—",
                        duracion: row[10] || "36",
                        nombre: row[11] || "—"
                    }));

                    rawDriveData = dataRows;
                    filteredDriveData = [...rawDriveData];
                    currentDrivePage = 1;
                    renderDriveTable();
                    console.log(`Cargados ${rawDriveData.length} registros desde Google Drive Live API.`);
                } else {
                    useDriveFallback();
                }
            })
            .catch(err => {
                console.warn("Usando respaldo local para datos de Google Drive:", err);
                useDriveFallback();
            });
    };

    const useDriveFallback = () => {
        rawDriveData = GOOGLE_DRIVE_FALLBACK;
        filteredDriveData = [...rawDriveData];
        currentDrivePage = 1;
        renderDriveTable();
    };

    const applyDriveSearchFilter = () => {
        const searchInput = $("apsa-drive-search-input");
        const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

        if (!query) {
            filteredDriveData = [...rawDriveData];
        } else {
            filteredDriveData = rawDriveData.filter(item => {
                return (
                    (item.serie || "").toLowerCase().includes(query) ||
                    (item.nombre || "").toLowerCase().includes(query) ||
                    (item.cliente || "").toLowerCase().includes(query) ||
                    (item.vin || "").toLowerCase().includes(query) ||
                    (item.imei || "").toLowerCase().includes(query) ||
                    (item.sim || "").toLowerCase().includes(query) ||
                    (item.estado || "").toLowerCase().includes(query)
                );
            });
        }

        currentDrivePage = 1;
        renderDriveTable();
    };

    const renderDriveTable = () => {
        const tbody = $("apsa-drive-tbody");
        const countBadge = $("apsa-drive-total-count");
        const pageInfo = $("apsa-drive-page-info");
        const pageIndicator = $("apsa-drive-page-indicator");
        const btnPrev = $("apsa-btn-drive-prev");
        const btnNext = $("apsa-btn-drive-next");

        if (!tbody) return;
        tbody.innerHTML = "";

        const totalItems = filteredDriveData.length;
        if (countBadge) countBadge.textContent = rawDriveData.length;

        const totalPages = Math.ceil(totalItems / DRIVE_ITEMS_PER_PAGE) || 1;
        if (currentDrivePage > totalPages) currentDrivePage = totalPages;

        const startIndex = (currentDrivePage - 1) * DRIVE_ITEMS_PER_PAGE;
        const endIndex = Math.min(startIndex + DRIVE_ITEMS_PER_PAGE, totalItems);
        const pageData = filteredDriveData.slice(startIndex, endIndex);

        if (pageData.length === 0) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td colspan="10" class="apsa-empty-state">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;">
                        <i data-lucide="folder-search" width="36" height="36" class="apsa-empty-icon"></i>
                        <span style="font-weight:600;color:var(--apsa-text);">No se encontraron registros en Google Drive</span>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        } else {
            pageData.forEach(item => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>
                        <div style="display:flex;align-items:center;gap:0.3rem;">
                            <span class="apsa-td-mono" style="color:var(--apsa-teal);font-weight:600;">${escapeHtml(item.serie)}</span>
                            ${item.serie !== "—" ? `<button class="apsa-copy-btn" title="Copiar Serie" onclick="apsaCopyText('${escapeHtml(item.serie)}', 'Serie')"><i data-lucide="copy" width="12" height="12"></i></button>` : ''}
                        </div>
                    </td>
                    <td style="font-weight:600;color:#ffffff;">${escapeHtml(item.nombre)}</td>
                    <td style="font-size:0.82rem;color:var(--apsa-muted);">${escapeHtml(item.cliente)}</td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.3rem;">
                            <span class="apsa-td-mono">${escapeHtml(item.vin)}</span>
                            ${item.vin !== "—" ? `<button class="apsa-copy-btn" title="Copiar VIN" onclick="apsaCopyText('${escapeHtml(item.vin)}', 'VIN')"><i data-lucide="copy" width="12" height="12"></i></button>` : ''}
                        </div>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.3rem;">
                            ${item.imei !== "—" 
                                ? `<span class="apsa-imei-tag"><i data-lucide="cpu" width="11" height="11"></i> ${escapeHtml(item.imei)}</span>
                                   <button class="apsa-copy-btn" title="Copiar IMEI" onclick="apsaCopyText('${escapeHtml(item.imei)}', 'IMEI')"><i data-lucide="copy" width="12" height="12"></i></button>`
                                : `<span style="color:var(--apsa-muted);">—</span>`}
                        </div>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.3rem;">
                            ${item.sim !== "—" 
                                ? `<span class="apsa-sim-tag"><i data-lucide="sim-card" width="11" height="11"></i> ${escapeHtml(item.sim)}</span>
                                   <button class="apsa-copy-btn" title="Copiar SIM" onclick="apsaCopyText('${escapeHtml(item.sim)}', 'SIM')"><i data-lucide="copy" width="12" height="12"></i></button>`
                                : `<span style="color:var(--apsa-muted);">—</span>`}
                        </div>
                    </td>
                    <td><span class="apsa-status-badge">${escapeHtml(item.estado)}</span></td>
                    <td style="font-size:0.8rem;color:var(--apsa-muted);">${escapeHtml(item.producto)}</td>
                    <td style="font-size:0.8rem;color:var(--apsa-teal);">${escapeHtml(item.db)}</td>
                    <td style="text-align:center;font-weight:600;">${escapeHtml(item.duracion)} <span style="font-size:0.72rem;color:var(--apsa-muted)">meses</span></td>
                `;
                tbody.appendChild(tr);
            });
        }

        if (pageInfo) pageInfo.textContent = `Mostrando ${totalItems > 0 ? startIndex + 1 : 0}–${endIndex} de ${totalItems} registros de Drive`;
        if (pageIndicator) pageIndicator.textContent = `Página ${currentDrivePage} de ${totalPages}`;
        if (btnPrev) btnPrev.disabled = currentDrivePage <= 1;
        if (btnNext) btnNext.disabled = currentDrivePage >= totalPages;

        if (window.lucide) lucide.createIcons();
    };

    // ── Evaluador de CSV robusto ─────────────────────────────────
    const parseCSV = text => {
        const lines = [];
        let row = [];
        let inQuotes = false;
        let token = "";

        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            const nextC = text[i + 1];

            if (c === '"') {
                if (inQuotes && nextC === '"') {
                    token += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c === ',' && !inQuotes) {
                row.push(token.trim());
                token = "";
            } else if ((c === '\r' || c === '\n') && !inQuotes) {
                if (c === '\r' && nextC === '\n') i++;
                row.push(token.trim());
                if (row.some(val => val.length > 0)) lines.push(row);
                row = [];
                token = "";
            } else {
                token += c;
            }
        }
        if (token || row.length > 0) {
            row.push(token.trim());
            if (row.some(val => val.length > 0)) lines.push(row);
        }
        return lines;
    };

    // Helper HTML escape
    const escapeHtml = str => {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // ── Exportación CSV Tabla 1 ───────────────────────────────────
    const exportGeotabToCSV = () => {
        if (filteredDevices.length === 0) {
            showToast("No hay datos de Geotab para exportar", "error");
            return;
        }

        const headers = ["Nombre de Vehículo", "Placa", "Número de Serie Carro (VIN)", "IMEI del GPS"];
        const rows = filteredDevices.map(dev => [
            `"${(dev.name || "").replace(/"/g, '""')}"`,
            `"${(dev.licensePlate || "").replace(/"/g, '""')}"`,
            `"${(dev.vehicleIdentificationNumber || dev.vin || "").replace(/"/g, '""')}"`,
            `"${(dev.serialNumber || "").replace(/"/g, '""')}"`
        ]);

        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        downloadCSVFile(csvContent, "Reporte_APSA_Geotab.csv");
    };

    // ── Exportación CSV Tabla 2 (Google Drive) ───────────────────
    const exportDriveToCSV = () => {
        if (filteredDriveData.length === 0) {
            showToast("No hay datos de Google Drive para exportar", "error");
            return;
        }

        const headers = ["Número de Serie", "ID Hardware", "Cliente", "Estado Facturación", "VIN", "Código Producto", "BD Primaria", "Tarjeta SIM", "IMEI", "Duración", "Nombre / Empresa"];
        const rows = filteredDriveData.map(item => [
            `"${(item.serie || "").replace(/"/g, '""')}"`,
            `"${(item.hwId || "").replace(/"/g, '""')}"`,
            `"${(item.cliente || "").replace(/"/g, '""')}"`,
            `"${(item.estado || "").replace(/"/g, '""')}"`,
            `"${(item.vin || "").replace(/"/g, '""')}"`,
            `"${(item.producto || "").replace(/"/g, '""')}"`,
            `"${(item.db || "").replace(/"/g, '""')}"`,
            `"${(item.sim || "").replace(/"/g, '""')}"`,
            `"${(item.imei || "").replace(/"/g, '""')}"`,
            `"${(item.duracion || "").replace(/"/g, '""')}"`,
            `"${(item.nombre || "").replace(/"/g, '""')}"`
        ]);

        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        downloadCSVFile(csvContent, "Reporte_APSA_Google_Drive.csv");
    };

    const downloadCSVFile = (content, filename) => {
        const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const dateStr = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.setAttribute("download", `${dateStr}_${filename}`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast(`Reporte ${filename} descargado`);
    };

    // ── Event Listeners ──────────────────────────────────────────
    const initEvents = () => {
        // Tabla 1
        const searchInput1 = $("apsa-search-input");
        const btnExport1 = $("apsa-btn-export");
        const btnRefresh1 = $("apsa-btn-refresh");
        const btnPrev1 = $("apsa-btn-prev");
        const btnNext1 = $("apsa-btn-next");

        if (searchInput1) searchInput1.addEventListener("input", applySearchFilter1);
        if (btnExport1) btnExport1.addEventListener("click", exportGeotabToCSV);
        if (btnRefresh1) btnRefresh1.addEventListener("click", fetchVehicles);
        if (btnPrev1) btnPrev1.addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderTable1(); } });
        if (btnNext1) btnNext1.addEventListener("click", () => {
            const totalPages = Math.ceil(filteredDevices.length / ITEMS_PER_PAGE);
            if (currentPage < totalPages) { currentPage++; renderTable1(); }
        });

        // Tabla 2 (Drive)
        const searchInput2 = $("apsa-drive-search-input");
        const btnExport2 = $("apsa-btn-export-drive");
        const btnPrev2 = $("apsa-btn-drive-prev");
        const btnNext2 = $("apsa-btn-drive-next");

        if (searchInput2) searchInput2.addEventListener("input", applyDriveSearchFilter);
        if (btnExport2) btnExport2.addEventListener("click", exportDriveToCSV);
        if (btnPrev2) btnPrev2.addEventListener("click", () => { if (currentDrivePage > 1) { currentDrivePage--; renderDriveTable(); } });
        if (btnNext2) btnNext2.addEventListener("click", () => {
            const totalPages = Math.ceil(filteredDriveData.length / DRIVE_ITEMS_PER_PAGE);
            if (currentDrivePage < totalPages) { currentDrivePage++; renderDriveTable(); }
        });
    };

    // ── Geotab Add-In Contract Lifecycle ─────────────────────────
    const createAddinHandler = () => {
        return function (api, state, callback) {
            geotabApi = api;
            initEvents();
            fetchVehicles();
            fetchGoogleDriveData();
            if (typeof callback === "function") callback();

            return {
                initialize: function (_api, _state, _callback) {
                    geotabApi = _api;
                    initEvents();
                    fetchVehicles();
                    fetchGoogleDriveData();
                    if (typeof _callback === "function") _callback();
                },
                focus: function (_api, _state) {
                    geotabApi = _api;
                    fetchVehicles();
                    fetchGoogleDriveData();
                },
                blur: function () {}
            };
        };
    };

    // Registrar en namespace geotab.addin
    if (typeof window.geotab === "undefined") window.geotab = { addin: {} };
    if (!window.geotab.addin) window.geotab.addin = {};

    window.geotab.addin["reporte-apsa"] = createAddinHandler();
    window.geotab.addin.reporteApsa = window.geotab.addin["reporte-apsa"];
    window.geotab.addin.reporte_apsa = window.geotab.addin["reporte-apsa"];

    // ── Ejecución Autónoma ───────────────────────────────────────
    document.addEventListener("DOMContentLoaded", () => {
        initEvents();
        setTimeout(() => {
            if (rawDevices.length === 0) fetchVehicles();
            if (rawDriveData.length === 0) fetchGoogleDriveData();
        }, 300);
    });

})();
