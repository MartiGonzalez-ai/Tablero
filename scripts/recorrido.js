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
    let trendGrouping = "day";
    let dailyGrouping = "day";
    let tableGrouping = "day";
    let lastOdoData = {};
    let lastDistanceData = {};
    let selectedPeriod = "month"; // Default period
    let customFromDate = null;  // For custom modal range
    let customToDate = null;    // For custom modal range

    // Pagination State
    let currentPage = 1;
    const itemsPerPage = 10;
    let currentTableData = [];

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
    const odometerDiagnostics = [
        "DiagnosticOdometerAdjustmentId",
        "DiagnosticOdometerId",
        "DiagnosticOBDOdometerReaderId",
        "DiagnosticJ1939TotalVehicleDistanceId"
    ];

    let chartDaily;

    // --- Helpers ---
    const showError = (msg) => {
        if (errorToastMsg) errorToastMsg.textContent = msg;
        if (errorToast) {
            errorToast.style.display = "flex";
            setTimeout(() => { errorToast.style.display = "none"; }, 5000);
        }
    };

    // ─── Table grouping helpers ─────────────────────────────────────────────────
    // NOTE: dailyOdoData[date] = odómetro al FINAL del día.
    // Para mostrar el odómetro de INICIO del periodo (odo_inicio + dist = odo_fin_siguiente),
    // se calcula: odo_inicio = odo_fin - dist_total_del_periodo.
    const groupTableData = (rawRows, grouping) => {
        // rawRows: [{ date (YYYY-MM-DD), dist, odo (end-of-day) }]
        if (grouping === "day") {
            // For day view, show start-of-day odometer = odo_end - dist
            return rawRows.map(r => ({ ...r, odo: r.odo - r.dist, odoFin: r.odo }));
        }

        const getWeekNumber = (d) => {
            const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            const dayNum = date.getUTCDay() || 7;
            date.setUTCDate(date.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
            return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        };

        const grouped = {}; // key -> { label, dist, odo (last), sortKey }

        rawRows.forEach(row => {
            const d = new Date(row.date + "T12:00:00");
            let key, label;

            if (grouping === "week") {
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d); monday.setDate(diff);
                key = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, '0') + "-" + String(monday.getDate()).padStart(2, '0');
                label = "Semana " + getWeekNumber(monday) + " (" + monday.getFullYear() + ")";
            } else if (grouping === "month") {
                key = row.date.substring(0, 7);
                const lbl = d.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
                label = lbl.charAt(0).toUpperCase() + lbl.slice(1);
            } else if (grouping === "bimester") {
                const month = parseInt(row.date.substring(5, 7));
                const year = row.date.substring(0, 4);
                const bStart = Math.floor((month - 1) / 2) * 2 + 1;
                key = year + "-" + String(bStart).padStart(2, '0');
                const d1 = new Date(parseInt(year), bStart - 1, 1);
                const d2 = new Date(parseInt(year), bStart, 1);
                const l1 = d1.toLocaleDateString("es-MX", { month: "short" });
                const l2 = d2.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                label = l1.charAt(0).toUpperCase() + l1.slice(1) + " - " + l2.charAt(0).toUpperCase() + l2.slice(1);
            } else if (grouping === "trimester") {
                const month = parseInt(row.date.substring(5, 7));
                const year = row.date.substring(0, 4);
                const q = Math.floor((month - 1) / 3) + 1;
                key = year + "-Q" + q;
                label = "T" + q + " " + year;
            } else if (grouping === "6months") {
                const month = parseInt(row.date.substring(5, 7));
                const year = row.date.substring(0, 4);
                const sem = month <= 6 ? 1 : 2;
                key = year + "-S" + sem;
                label = (sem === 1 ? "1er Sem" : "2do Sem") + " " + year;
            } else if (grouping === "year") {
                key = row.date.substring(0, 4);
                label = key;
            } else {
                key = row.date; label = row.date;
            }

            if (!grouped[key]) {
                grouped[key] = { label, dist: 0, odo: 0, sortKey: key };
            }
            grouped[key].dist += row.dist;
            // Keep the odo of the most recent day in the group (rows are descending) = end-of-period odo
            if (grouped[key].odo === 0) grouped[key].odo = row.odo;
        });

        // Convert end-of-period odo → start-of-period odo so that: odo_inicio + dist = odo_inicio_siguiente
        return Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(k => ({
            date: grouped[k].label,
            dist: grouped[k].dist,
            odo: grouped[k].odo - grouped[k].dist,  // odo_inicio = odo_fin - dist
            odoFin: grouped[k].odo                   // odo_fin = most recent day odo in group
        }));
    };

    const renderTablePage = () => {
        const tbody = document.getElementById("daily-recorrido-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";

        // Apply grouping
        const displayData = groupTableData(currentTableData, tableGrouping);

        const totalItems = displayData.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

        if (currentPage > totalPages) currentPage = totalPages;

        const startIdx = (currentPage - 1) * itemsPerPage;
        const endIdx = Math.min(startIdx + itemsPerPage, totalItems);
        const pageData = displayData.slice(startIdx, endIdx);

        pageData.forEach(row => {
            const tr = document.createElement("tr");
            const fmt = v => v.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km";
            tr.innerHTML = `
                <td class="date-td">${row.date}</td>
                <td class="dist-td" style="text-align: right; color: var(--color-primary); font-weight: 600;">${fmt(row.dist)}</td>
                <td class="odo-td" style="text-align: right; font-weight: 700;">${fmt(row.odo)}</td>
                <td class="odo-td" style="text-align: right; font-weight: 700; color: var(--color-accent);">${fmt(row.odoFin !== undefined ? row.odoFin : row.odo + row.dist)}</td>
            `;
            tbody.appendChild(tr);
        });

        // Update UI controls
        const btnPrev = document.getElementById("btn-prev-page");
        const btnNext = document.getElementById("btn-next-page");
        const pageIndicator = document.getElementById("page-indicator");
        const paginationInfo = document.getElementById("pagination-info");
        const paginationContainer = document.getElementById("pagination-controls");

        if (totalItems > 0) {
            if (paginationContainer) paginationContainer.style.display = "flex";
            if (paginationInfo) paginationInfo.textContent = `Mostrando ${startIdx + 1} - ${endIdx} de ${totalItems} registros`;
            if (pageIndicator) pageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
            if (btnPrev) btnPrev.disabled = currentPage <= 1;
            if (btnNext) btnNext.disabled = currentPage >= totalPages;
        } else {
            if (paginationContainer) paginationContainer.style.display = "none";
        }
    };

    const formatDateReadable = (isoStr) => {
        if (!isoStr) return "—";
        const d = new Date(isoStr + "T00:00:00"); // Forzar interpretación local
        return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
    };

    // ─── Excel Export ──────────────────────────────────────────────────
    const exportToExcel = async () => {
        if (typeof ExcelJS === "undefined") {
            showError("La librer\u00eda de exportaci\u00f3n no est\u00e1 disponible.");
            return;
        }
        if (currentTableData.length === 0) {
            showError("No hay datos para exportar.");
            return;
        }

        const btnExport = document.getElementById("btn-export-excel");
        const origHtml = btnExport ? btnExport.innerHTML : "";
        if (btnExport) {
            btnExport.disabled = true;
            btnExport.innerHTML = "\u23f3 Generando...";
        }

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = "Geotab Recorrido";
            wb.created = new Date();

            const ws = wb.addWorksheet("Reporte", { views: [{ showGridLines: true }] });

            // \u2500\u2500 Source Data \u2500\u2500
            const displayData = groupTableData(currentTableData, tableGrouping);
            const unitEl = document.getElementById("unit-select-recorrido");
            const unitLabel = unitEl ? (unitEl.options[unitEl.selectedIndex]?.text || "Unidad") : "Unidad";

            // Build date range label
            let dateRangeStr = "";
            if (selectedPeriod === "custom" && customFromDate && customToDate) {
                const fmt = s => s.split("-").reverse().join("/");
                dateRangeStr = fmt(customFromDate) + " a " + fmt(customToDate);
            } else {
                const range = getSelectedRange();
                if (range) {
                    const fmtD = d => String(d.getDate()).padStart(2,"0") + "/" +
                        String(d.getMonth()+1).padStart(2,"0") + "/" + d.getFullYear();
                    dateRangeStr = fmtD(range.from) + " a " + fmtD(range.to);
                }
            }

            // \u2500\u2500 Column Widths \u2500\u2500
            ws.columns = [
                { width: 28 },  // A - Fecha
                { width: 16 },  // B - Distancia
                { width: 22 },  // C - Odo Inicio
                { width: 22 },  // D - Odo Fin
                { width: 3  },  // E - spacer
                { width: 15 },  // F - chart col start
                { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }
            ];

            // \u2500\u2500 Palette \u2500\u2500
            const COL_DARK   = { argb: "FF002060" };  // deep navy (title bg)
            const COL_TEAL   = { argb: "FF1F6B75" };  // teal (header bg)
            const COL_WHITE  = { argb: "FFFFFFFF" };
            const COL_ALT    = { argb: "FFEBF3FB" };  // alternate row
            const COL_TOTAL  = { argb: "FFD6E4F0" };  // total row bg
            const COL_BORDER = { argb: "FFB0C4D8" };

            const applyFill = (cell, argb) => {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: argb };
            };
            const applyBorder = (cell) => {
                cell.border = {
                    top:    { style: "thin", color: COL_BORDER },
                    left:   { style: "thin", color: COL_BORDER },
                    bottom: { style: "thin", color: COL_BORDER },
                    right:  { style: "thin", color: COL_BORDER }
                };
            };

            // \u2500\u2500 Row 1: Title \u2500\u2500
            ws.mergeCells("A1:D1");
            const r1 = ws.getRow(1);
            r1.height = 30;
            const titleCell = ws.getCell("A1");
            titleCell.value = "REPORTE DE RECORRIDO";
            titleCell.font = { bold: true, size: 13, color: COL_WHITE, name: "Calibri" };
            applyFill(titleCell, COL_DARK);
            titleCell.alignment = { horizontal: "center", vertical: "middle" };

            // \u2500\u2500 Row 2: Date range | Unit \u2500\u2500
            ws.getRow(2).height = 20;
            const dateCell = ws.getCell("A2");
            dateCell.value = dateRangeStr;
            dateCell.font = { size: 9, color: COL_WHITE, name: "Calibri" };
            applyFill(dateCell, COL_DARK);
            dateCell.alignment = { horizontal: "left", vertical: "middle" };

            ws.mergeCells("B2:D2");
            const unitCell = ws.getCell("B2");
            unitCell.value = unitLabel;
            unitCell.font = { bold: true, size: 9, color: COL_WHITE, name: "Calibri" };
            applyFill(unitCell, COL_DARK);
            unitCell.alignment = { horizontal: "right", vertical: "middle" };

            // \u2500\u2500 Row 3: Column Headers \u2500\u2500
            ws.getRow(3).height = 18;
            const headers = ["Fecha", "Distancia (km)", "Od\u00f3metro Inicio (km)", "Od\u00f3metro Fin (km)"];
            headers.forEach((h, i) => {
                const cell = ws.getCell(3, i + 1);
                cell.value = h;
                cell.font = { bold: true, size: 9, color: COL_WHITE, name: "Calibri" };
                applyFill(cell, COL_TEAL);
                cell.alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle" };
                applyBorder(cell);
            });

            // \u2500\u2500 Data Rows \u2500\u2500
            let rowIdx = 4;
            displayData.forEach((row, idx) => {
                const odoFin = row.odoFin !== undefined ? row.odoFin : row.odo + row.dist;
                const r = ws.getRow(rowIdx);
                r.height = 16;

                const vals = [row.date, parseFloat(row.dist.toFixed(1)), parseFloat(row.odo.toFixed(1)), parseFloat(odoFin.toFixed(1))];
                vals.forEach((v, ci) => {
                    const cell = r.getCell(ci + 1);
                    cell.value = v;
                    cell.font = { size: 9, name: "Calibri" };
                    applyFill(cell, idx % 2 === 0 ? COL_WHITE : COL_ALT);
                    cell.alignment = { horizontal: ci === 0 ? "left" : "right", vertical: "middle" };
                    if (ci > 0) cell.numFmt = "#,##0.0";
                    applyBorder(cell);
                });
                rowIdx++;
            });

            // \u2500\u2500 Empty separator \u2500\u2500
            rowIdx++;

            // \u2500\u2500 TOTAL Row \u2500\u2500
            const totalDist = displayData.reduce((s, r) => s + r.dist, 0);
            const totalRow = ws.getRow(rowIdx);
            totalRow.height = 18;
            ["TOTAL", parseFloat(totalDist.toFixed(1)), "", ""].forEach((v, ci) => {
                const cell = totalRow.getCell(ci + 1);
                cell.value = v;
                cell.font = { bold: true, size: 9, name: "Calibri" };
                applyFill(cell, COL_TOTAL);
                cell.alignment = { horizontal: ci === 0 ? "left" : "right", vertical: "middle" };
                if (ci === 1) cell.numFmt = "#,##0.0";
                applyBorder(cell);
            });

            // ── Generate native Excel charts via JSZip post-processing ──
            const bufferTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("writeBuffer timeout")), 15000)
            );
            const rawBuffer = await Promise.race([wb.xlsx.writeBuffer(), bufferTimeout]);

            // Post-process the generated Excel file to inject native charts
            const zip = await JSZip.loadAsync(rawBuffer);

            // 1. Add drawings and charts override to [Content_Types].xml
            let contentTypes = await zip.file("[Content_Types].xml").async("text");
            if (!contentTypes.includes("PartName=\"/xl/drawings/drawing1.xml\"")) {
                contentTypes = contentTypes.replace("</Types>", 
                    `  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>\r\n` +
                    `  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>\r\n` +
                    `  <Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>\r\n</Types>`
                );
                zip.file("[Content_Types].xml", contentTypes);
            }

            // 2. Reference the drawing in xl/worksheets/sheet1.xml
            let sheet1Xml = await zip.file("xl/worksheets/sheet1.xml").async("text");
            if (!sheet1Xml.includes("<drawing")) {
                sheet1Xml = sheet1Xml.replace("</worksheet>", `<drawing r:id="rId1"/></worksheet>`);
                zip.file("xl/worksheets/sheet1.xml", sheet1Xml);
            }

            // 3. Add relationship to xl/worksheets/_rels/sheet1.xml.rels
            let sheet1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
                `<Relationships xmlns="http://schemas.openxmlformats.org/relationships">\r\n` +
                `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>\r\n` +
                `</Relationships>`;
            zip.file("xl/worksheets/_rels/sheet1.xml.rels", sheet1Rels);

            // 4. Create xl/drawings/drawing1.xml linking to chart1.xml and chart2.xml
            let drawing1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
                `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\r\n` +
                `  <!-- Chart 1: Odómetro Acumulado (Line) from F1 to L15 -->\r\n` +
                `  <xdr:twoCellAnchor editAs="oneCell">\r\n` +
                `    <xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>\r\n` +
                `    <xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>\r\n` +
                `    <xdr:graphicFrame>\r\n` +
                `      <xdr:nvGraphicFramePr>\r\n` +
                `        <xdr:cNvPr id="1" name="Chart 1"/>\r\n` +
                `        <xdr:cNvGraphicFramePr/>\r\n` +
                `      </xdr:nvGraphicFramePr>\r\n` +
                `      <xdr:xfrm>\r\n` +
                `        <a:off x="0" y="0"/>\r\n` +
                `        <a:ext cx="0" cy="0"/>\r\n` +
                `      </xdr:xfrm>\r\n` +
                `      <a:graphic>\r\n` +
                `        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">\r\n` +
                `          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/>\r\n` +
                `        </a:graphicData>\r\n` +
                `      </a:graphic>\r\n` +
                `    </xdr:graphicFrame>\r\n` +
                `    <xdr:clientData/>\r\n` +
                `  </xdr:twoCellAnchor>\r\n` +
                `  <!-- Chart 2: Kilometros recorridos (Bar) from F17 to L32 -->\r\n` +
                `  <xdr:twoCellAnchor editAs="oneCell">\r\n` +
                `    <xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>\r\n` +
                `    <xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>31</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>\r\n` +
                `    <xdr:graphicFrame>\r\n` +
                `      <xdr:nvGraphicFramePr>\r\n` +
                `        <xdr:cNvPr id="2" name="Chart 2"/>\r\n` +
                `        <xdr:cNvGraphicFramePr/>\r\n` +
                `      </xdr:nvGraphicFramePr>\r\n` +
                `      <xdr:xfrm>\r\n` +
                `        <a:off x="0" y="0"/>\r\n` +
                `        <a:ext cx="0" cy="0"/>\r\n` +
                `      </xdr:xfrm>\r\n` +
                `      <a:graphic>\r\n` +
                `        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">\r\n` +
                `          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/>\r\n` +
                `        </a:graphicData>\r\n` +
                `      </a:graphic>\r\n` +
                `    </xdr:graphicFrame>\r\n` +
                `    <xdr:clientData/>\r\n` +
                `  </xdr:twoCellAnchor>\r\n` +
                `</xdr:wsDr>`;
            zip.file("xl/drawings/drawing1.xml", drawing1Xml);

            // 5. Create drawing relations
            let drawing1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
                `<Relationships xmlns="http://schemas.openxmlformats.org/relationships">\r\n` +
                `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>\r\n` +
                `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/>\r\n` +
                `</Relationships>`;
            zip.file("xl/drawings/_rels/drawing1.xml.rels", drawing1Rels);

            // Calculate active data range inside drawing (rows start at 4, up to displayData.length + 3)
            const maxRow = displayData.length + 3;

            // 6. Create xl/charts/chart1.xml (Odómetro Acumulado - Line Chart)
            let chart1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
                `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\r\n` +
                `  <c:chart>\r\n` +
                `    <c:title>\r\n` +
                `      <c:tx>\r\n` +
                `        <c:rich>\r\n` +
                `          <a:bodyPr/>\r\n` +
                `          <a:lstStyle/>\r\n` +
                `          <a:p>\r\n` +
                `            <a:r>\r\n` +
                `              <a:rPr><a:latin typeface="Calibri"/></a:rPr>\r\n` +
                `              <a:t>Od\u00f3metro Acumulado (km)</a:t>\r\n` +
                `            </a:r>\r\n` +
                `          </a:p>\r\n` +
                `        </c:rich>\r\n` +
                `      </c:tx>\r\n` +
                `    </c:title>\r\n` +
                `    <c:plotArea>\r\n` +
                `      <c:lineChart>\r\n` +
                `        <c:grouping val="standard"/>\r\n` +
                `        <c:ser>\r\n` +
                `          <c:idx val="0"/>\r\n` +
                `          <c:order val="0"/>\r\n` +
                `          <c:tx><c:v>Od\u00f3metro Fin (km)</c:v></c:tx>\r\n` +
                `          <c:cat>\r\n` +
                `            <c:strRef>\r\n` +
                `              <c:f>Reporte!$A$4:$A$${maxRow}</c:f>\r\n` +
                `            </c:strRef>\r\n` +
                `          </c:cat>\r\n` +
                `          <c:val>\r\n` +
                `            <c:numRef>\r\n` +
                `              <c:f>Reporte!$D$4:$D$${maxRow}</c:f>\r\n` +
                `            </c:numRef>\r\n` +
                `          </c:val>\r\n` +
                `        </c:ser>\r\n` +
                `        <c:axId val="1001"/>\r\n` +
                `        <c:axId val="1002"/>\r\n` +
                `      </c:lineChart>\r\n` +
                `      <c:catAx>\r\n` +
                `        <c:axId val="1001"/>\r\n` +
                `        <c:scaling><c:orientation val="minMax"/></c:scaling>\r\n` +
                `        <c:axPos val="b"/>\r\n` +
                `        <c:tickLblPos val="nextTo"/>\r\n` +
                `      </c:catAx>\r\n` +
                `      <c:valAx>\r\n` +
                `        <c:axId val="1002"/>\r\n` +
                `        <c:scaling><c:orientation val="minMax"/></c:scaling>\r\n` +
                `        <c:axPos val="l"/>\r\n` +
                `        <c:majorGridlines/>\r\n` +
                `        <c:tickLblPos val="nextTo"/>\r\n` +
                `      </c:valAx>\r\n` +
                `    </c:plotArea>\r\n` +
                `    <c:legend>\r\n` +
                `      <c:legendPos val="b"/>\r\n` +
                `    </c:legend>\r\n` +
                `  </c:chart>\r\n` +
                `</c:chartSpace>`;
            zip.file("xl/charts/chart1.xml", chart1Xml);

            // 7. Create xl/charts/chart2.xml (Kilómetros recorridos - Bar/Column Chart)
            let chart2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
                `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\r\n` +
                `  <c:chart>\r\n` +
                `    <c:title>\r\n` +
                `      <c:tx>\r\n` +
                `        <c:rich>\r\n` +
                `          <a:bodyPr/>\r\n` +
                `          <a:lstStyle/>\r\n` +
                `          <a:p>\r\n` +
                `            <a:r>\r\n` +
                `              <a:rPr><a:latin typeface="Calibri"/></a:rPr>\r\n` +
                `              <a:t>Kil\u00f3metros recorridos</a:t>\r\n` +
                `            </a:r>\r\n` +
                `          </a:p>\r\n` +
                `        </c:rich>\r\n` +
                `      </c:tx>\r\n` +
                `    </c:title>\r\n` +
                `    <c:plotArea>\r\n` +
                `      <c:barChart>\r\n` +
                `        <c:barDir val="col"/>\r\n` +
                `        <c:grouping val="clustered"/>\r\n` +
                `        <c:ser>\r\n` +
                `          <c:idx val="0"/>\r\n` +
                `          <c:order val="0"/>\r\n` +
                `          <c:tx><c:v>Distancia (km)</c:v></c:tx>\r\n` +
                `          <c:cat>\r\n` +
                `            <c:strRef>\r\n` +
                `              <c:f>Reporte!$A$4:$A$${maxRow}</c:f>\r\n` +
                `            </c:strRef>\r\n` +
                `          </c:cat>\r\n` +
                `          <c:val>\r\n` +
                `            <c:numRef>\r\n` +
                `              <c:f>Reporte!$B$4:$B$${maxRow}</c:f>\r\n` +
                `            </c:numRef>\r\n` +
                `          </c:val>\r\n` +
                `        </c:ser>\r\n` +
                `        <c:axId val="2001"/>\r\n` +
                `        <c:axId val="2002"/>\r\n` +
                `      </c:barChart>\r\n` +
                `      <c:catAx>\r\n` +
                `        <c:axId val="2001"/>\r\n` +
                `        <c:scaling><c:orientation val="minMax"/></c:scaling>\r\n` +
                `        <c:axPos val="b"/>\r\n` +
                `        <c:tickLblPos val="nextTo"/>\r\n` +
                `      </c:catAx>\r\n` +
                `      <c:valAx>\r\n` +
                `        <c:axId val="2002"/>\r\n` +
                `        <c:scaling><c:orientation val="minMax"/></c:scaling>\r\n` +
                `        <c:axPos val="l"/>\r\n` +
                `        <c:majorGridlines/>\r\n` +
                `        <c:tickLblPos val="nextTo"/>\r\n` +
                `      </c:valAx>\r\n` +
                `    </c:plotArea>\r\n` +
                `    <c:legend>\r\n` +
                `      <c:legendPos val="b"/>\r\n` +
                `    </c:legend>\r\n` +
                `  </c:chart>\r\n` +
                `</c:chartSpace>`;
            zip.file("xl/charts/chart2.xml", chart2Xml);

            // Generate ZIP buffer and download
            const buffer = await zip.generateAsync({ type: "blob" });
            const dlUrl = URL.createObjectURL(buffer);
            const a = document.createElement("a");
            const today = new Date();
            const ds = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0");
            a.href = dlUrl;
            a.download = "Recorrido_" + ds + ".xlsx";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);

        } catch (err) {
            console.error("Error exportando:", err);
            showError("Error al generar el archivo Excel.");
        } finally {
            if (btnExport) {
                btnExport.disabled = false;
                btnExport.innerHTML = origHtml || "\uD83D\uDCCA Exportar Excel";
                if (window.lucide) lucide.createIcons();
            }
        }
    };

    const getLocalDateString = (date) => {
        const d = new Date(date);
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
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

    const renderChart = (dailyData) => {
        if (!window.ApexCharts) return;

        const sortedDates = Object.keys(dailyData).sort();
        let seriesData = [];

        const getWeekNumber = function (d) {
            const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            const dayNum = date.getUTCDay() || 7;
            date.setUTCDate(date.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
            return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        };

        if (dailyGrouping === "day") {
            seriesData = sortedDates.map(d => ({
                x: d,
                y: parseFloat(dailyData[d].toFixed(1))
            }));
        } else if (dailyGrouping === "week") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const d = new Date(dateStr + "T12:00:00");
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d.setDate(diff));
                const weekKey = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, '0') + "-" + String(monday.getDate()).padStart(2, '0');
                if (!grouped[weekKey]) grouped[weekKey] = 0;
                grouped[weekKey] += dailyData[dateStr];
            });
            Object.keys(grouped).sort().forEach(weekKey => {
                const d = new Date(weekKey + "T12:00:00");
                const weekNum = getWeekNumber(d);
                seriesData.push({ x: "Semana " + weekNum, y: parseFloat(grouped[weekKey].toFixed(1)) });
            });
        } else if (dailyGrouping === "month") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const monthKey = dateStr.substring(0, 7) + "-01";
                if (!grouped[monthKey]) grouped[monthKey] = 0;
                grouped[monthKey] += dailyData[dateStr];
            });
            Object.keys(grouped).sort().forEach(monthKey => {
                const d = new Date(monthKey + "T12:00:00");
                const label = d.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
                seriesData.push({ x: capitalized, y: parseFloat(grouped[monthKey].toFixed(1)) });
            });
        } else if (dailyGrouping === "bimester") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const bimesterStartMonth = Math.floor((month - 1) / 2) * 2 + 1;
                const bKey = year + "-" + String(bimesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[bKey]) grouped[bKey] = 0;
                grouped[bKey] += dailyData[dateStr];
            });
            Object.keys(grouped).sort().forEach(key => {
                const d1 = new Date(key + "T12:00:00");
                const d2 = new Date(d1); d2.setMonth(d2.getMonth() + 1);
                const l1 = d1.toLocaleDateString("es-MX", { month: "short" });
                const l2 = d2.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                const label = l1.charAt(0).toUpperCase() + l1.slice(1) + " - " + l2.charAt(0).toUpperCase() + l2.slice(1);
                seriesData.push({ x: label, y: parseFloat(grouped[key].toFixed(1)) });
            });
        } else if (dailyGrouping === "trimester") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const trimesterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
                const tKey = year + "-" + String(trimesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[tKey]) grouped[tKey] = 0;
                grouped[tKey] += dailyData[dateStr];
            });
            Object.keys(grouped).sort().forEach(key => {
                const d = new Date(key + "T12:00:00");
                const q = Math.floor(d.getMonth() / 3) + 1;
                seriesData.push({ x: "T" + q + " " + d.getFullYear(), y: parseFloat(grouped[key].toFixed(1)) });
            });
        } else if (dailyGrouping === "6months") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const semesterStartMonth = Math.floor((month - 1) / 6) * 6 + 1;
                const sKey = year + "-" + String(semesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[sKey]) grouped[sKey] = 0;
                grouped[sKey] += dailyData[dateStr];
            });
            Object.keys(grouped).sort().forEach(key => {
                const d = new Date(key + "T12:00:00");
                const sem = d.getMonth() < 6 ? "1er Sem" : "2do Sem";
                seriesData.push({ x: sem + " " + d.getFullYear(), y: parseFloat(grouped[key].toFixed(1)) });
            });
        } else if (dailyGrouping === "year") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const yearKey = dateStr.substring(0, 4) + "-01-01";
                if (!grouped[yearKey]) grouped[yearKey] = 0;
                grouped[yearKey] += dailyData[dateStr];
            });
            Object.keys(grouped).sort().forEach(key => {
                seriesData.push({ x: key.substring(0, 4), y: parseFloat(grouped[key].toFixed(1)) });
            });
        }

        const options = {
            series: [{
                name: 'Distancia (km)',
                data: seriesData
            }],
            chart: {
                type: 'bar',
                height: 260,
                width: '100%',
                toolbar: { show: false },
                fontFamily: "'Inter', sans-serif"
            },
            colors: ['#003666'], // Geotab Blue
            plotOptions: {
                bar: {
                    borderRadius: 3,
                    columnWidth: '55%',
                }
            },
            dataLabels: {
                enabled: dailyGrouping !== "day",
                formatter: (val) => val.toLocaleString("es-MX", { maximumFractionDigits: 1 }),
                style: { fontSize: '10px', colors: ['#fff'] }
            },
            xaxis: {
                type: 'category',
                categories: seriesData.map(p => p.x),
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    rotate: -45,
                    formatter: function (value) {
                        if (dailyGrouping !== 'day') return value;
                        if (!value) return "";
                        const d = new Date(value + "T12:00:00");
                        if (isNaN(d.getTime())) return value;
                        const label = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
                        return label.charAt(0).toUpperCase() + label.slice(1);
                    }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    formatter: (val) => val.toFixed(0) + " km"
                }
            },
            grid: {
                borderColor: '#eaecf0',
                strokeDashArray: 4
            },
            tooltip: {
                theme: 'light',
                y: { formatter: (val) => val.toFixed(1) + " km" }
            }
        };

        if (chartDaily) chartDaily.destroy();
        const chartEl = document.querySelector("#chart-daily-recorrido");
        if (chartEl) {
            chartDaily = new ApexCharts(chartEl, options);
            chartDaily.render();
        }
    };

    let chartOdoTrend;
    const renderOdoTrendChart = (odoData, dailyDistanceData) => {
        if (!window.ApexCharts) return;

        const sortedDates = Object.keys(odoData).sort();
        let trendSeries = [];

        const getWeekNumber = function (d) {
            const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            const dayNum = date.getUTCDay() || 7;
            date.setUTCDate(date.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
            return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        };

        if (trendGrouping === "day") {
            trendSeries = sortedDates.map(date => ({
                x: date,
                y: parseFloat(odoData[date].toFixed(1))
            }));
        } else if (trendGrouping === "week") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const d = new Date(dateStr + "T12:00:00");
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d.setDate(diff));
                const weekKey = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, '0') + "-" + String(monday.getDate()).padStart(2, '0');

                if (!grouped[weekKey] || new Date(dateStr) > new Date(grouped[weekKey].lastDate)) {
                    grouped[weekKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(weekKey => {
                const d = new Date(weekKey + "T12:00:00");
                const weekNum = getWeekNumber(d);
                trendSeries.push({ x: "Semana " + weekNum, y: parseFloat(grouped[weekKey].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "month") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const monthKey = dateStr.substring(0, 7) + "-01";
                if (!grouped[monthKey] || new Date(dateStr) > new Date(grouped[monthKey].lastDate)) {
                    grouped[monthKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(monthKey => {
                const d = new Date(monthKey + "T12:00:00");
                const label = d.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
                trendSeries.push({ x: capitalized, y: parseFloat(grouped[monthKey].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "bimester") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const bimesterStartMonth = Math.floor((month - 1) / 2) * 2 + 1;
                const bKey = year + "-" + String(bimesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[bKey] || new Date(dateStr) > new Date(grouped[bKey].lastDate)) {
                    grouped[bKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                const d1 = new Date(key + "T12:00:00");
                const d2 = new Date(d1); d2.setMonth(d2.getMonth() + 1);
                const l1 = d1.toLocaleDateString("es-MX", { month: "short" });
                const l2 = d2.toLocaleDateString("es-MX", { month: "short", year: "numeric" });
                const label = l1.charAt(0).toUpperCase() + l1.slice(1) + " - " + l2.charAt(0).toUpperCase() + l2.slice(1);
                trendSeries.push({ x: label, y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "trimester") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const trimesterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
                const tKey = year + "-" + String(trimesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[tKey] || new Date(dateStr) > new Date(grouped[tKey].lastDate)) {
                    grouped[tKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                const d = new Date(key + "T12:00:00");
                const q = Math.floor(d.getMonth() / 3) + 1;
                trendSeries.push({ x: "T" + q + " " + d.getFullYear(), y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "6months") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const month = parseInt(dateStr.substring(5, 7));
                const year = dateStr.substring(0, 4);
                const semesterStartMonth = Math.floor((month - 1) / 6) * 6 + 1;
                const sKey = year + "-" + String(semesterStartMonth).padStart(2, '0') + "-01";
                if (!grouped[sKey] || new Date(dateStr) > new Date(grouped[sKey].lastDate)) {
                    grouped[sKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                const d = new Date(key + "T12:00:00");
                const sem = d.getMonth() < 6 ? "1er Sem" : "2do Sem";
                trendSeries.push({ x: sem + " " + d.getFullYear(), y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        } else if (trendGrouping === "year") {
            const grouped = {};
            sortedDates.forEach(dateStr => {
                const yearKey = dateStr.substring(0, 4) + "-01-01";
                if (!grouped[yearKey] || new Date(dateStr) > new Date(grouped[yearKey].lastDate)) {
                    grouped[yearKey] = { odo: odoData[dateStr], lastDate: dateStr };
                }
            });
            Object.keys(grouped).sort().forEach(key => {
                trendSeries.push({ x: key.substring(0, 4), y: parseFloat(grouped[key].odo.toFixed(1)) });
            });
        }

        const options = {
            series: [{
                name: 'Odómetro (km)',
                data: trendSeries
            }],
            chart: {
                type: 'area',
                height: 260,
                width: '100%',
                toolbar: { show: false },
                fontFamily: "'Inter', sans-serif",
                zoom: { enabled: false }
            },
            stroke: {
                curve: 'smooth',
                width: 2.5
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.35,
                    opacityTo: 0.05,
                    stops: [0, 100],
                    colorStops: [
                        { offset: 0, color: "#00b1e1", opacity: 0.35 },
                        { offset: 100, color: "#00b1e1", opacity: 0 }
                    ]
                }
            },
            colors: ["#00b1e1"],
            dataLabels: {
                enabled: trendGrouping !== "day",
                formatter: (val) => Math.round(val).toLocaleString("es-MX"),
                offsetY: -6,
                style: { fontSize: '11px', fontWeight: '700', colors: ["#003666"] },
                background: { enabled: true, foreColor: '#fff', borderRadius: 4, borderWidth: 0, opacity: 0.9 }
            },
            markers: {
                size: trendGrouping === "day" ? 0 : 4,
                colors: ['#fff'],
                strokeColors: "#00b1e1",
                strokeWidth: 2,
                hover: { size: 7 }
            },
            xaxis: {
                type: "category",
                categories: trendSeries.map(p => p.x),
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    rotate: -45,
                    formatter: (value) => {
                        if (trendGrouping !== 'day') return value;
                        if (!value) return "";
                        const d = new Date(value + "T12:00:00");
                        if (isNaN(d.getTime())) return value;
                        const label = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
                        return label.charAt(0).toUpperCase() + label.slice(1);
                    }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    style: { colors: '#64748b', fontSize: '10px' },
                    formatter: (val) => Math.round(val).toLocaleString("es-MX") + " km"
                }
            },
            grid: {
                borderColor: '#eaecf0',
                strokeDashArray: 4
            },
            tooltip: {
                shared: true,
                theme: 'light',
                y: { formatter: (val) => Math.round(val).toLocaleString("es-MX") + " km" }
            }
        };

        if (chartOdoTrend) chartOdoTrend.destroy();
        const chartTrendEl = document.querySelector("#chart-odo-trend");
        if (chartTrendEl) {
            chartOdoTrend = new ApexCharts(chartTrendEl, options);
            chartOdoTrend.render();
        }
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

    const getSelectedRange = () => {
        const toDate = new Date();
        const fromDate = new Date();

        if (selectedPeriod === "custom") {
            if (!customFromDate || !customToDate) return null;
            const fromD = new Date(customFromDate + "T00:00:00");
            const toD = new Date(customToDate + "T23:59:59");
            return { from: fromD, to: toD };
        }

        if (selectedPeriod === "week") {
            const day = toDate.getDay();
            const diff = toDate.getDate() - day + (day === 0 ? -6 : 1);
            fromDate.setDate(diff);
        } else if (selectedPeriod === "month") {
            fromDate.setDate(1);
        } else if (selectedPeriod === "bimester") {
            fromDate.setMonth(toDate.getMonth() - 1);
            fromDate.setDate(1);
        } else if (selectedPeriod === "trimester") {
            fromDate.setMonth(toDate.getMonth() - 2);
            fromDate.setDate(1);
        } else if (selectedPeriod === "semester") {
            fromDate.setMonth(toDate.getMonth() - 5);
            fromDate.setDate(1);
        }

        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
        return { from: fromDate, to: toDate };
    };

    const calculateDistance = () => {
        const deviceId = unitSelect.value;
        const range = getSelectedRange();

        if (!deviceId) {
            showError("Por favor, selecciona una unidad.");
            return;
        }
        if (!range) {
            showError("Por favor, selecciona una fecha válida.");
            return;
        }

        // Show loading
        loadingOverlay.style.display = "flex";
        btnConsultar.disabled = true;

        const toDateObj = range.to;
        const fromDateHistoric = range.from;

        // Number of days in the selected range (for the daily breakdown)
        const diffTime = Math.abs(toDateObj - fromDateHistoric);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const historyDays = Math.max(diffDays, 1);

        const now = new Date();
        const searchToDateToken = now.toISOString();
        const searchFromDateToken = fromDateHistoric.toISOString();

        const calls = odometerDiagnostics.map(diagId => [
            "Get",
            {
                typeName: "StatusData",
                search: {
                    deviceSearch: { id: deviceId },
                    diagnosticSearch: { id: diagId },
                    toDate: searchToDateToken,
                    resultsLimit: 1,
                    applyLatest: true
                }
            }
        ]);

        // Paginación y Optimización de la API (Chunking Trips)
        // Obtener viajes en lotes de 30 días para evitar carga pesada
        const chunks = [];
        let chunkStart = new Date(fromDateHistoric);
        while (chunkStart < toDateObj) {
            let chunkEnd = new Date(chunkStart);
            chunkEnd.setDate(chunkEnd.getDate() + 30);
            if (chunkEnd > toDateObj) chunkEnd = new Date(toDateObj);
            chunks.push({ start: chunkStart.toISOString(), end: chunkEnd.toISOString() });
            chunkStart = new Date(chunkEnd);
        }

        chunks.forEach(chunk => {
            calls.push([
                "Get",
                {
                    typeName: "Trip",
                    search: {
                        deviceSearch: { id: deviceId },
                        fromDate: chunk.start,
                        toDate: chunk.end
                    }
                }
            ]);
        });

        api.multiCall(calls, (results) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;

            try {
                // A. Extraer lectura base de odómetro (la absoluta actual)
                const odoResults = results.slice(0, odometerDiagnostics.length)
                    .flat()
                    .filter(r => r && r.data !== undefined);

                if (odoResults.length === 0) {
                    showError("No se encontraron lecturas de odómetro recientes para este vehículo.");
                    return;
                }

                odoResults.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
                const latestOdoData = odoResults[0];
                let currentOdoKms = latestOdoData.data / 1000;
                const odoDateTime = new Date(latestOdoData.dateTime);

                // B. Extraer viajes (juntando todos los lotes de trips)
                const tripsRaw = results.slice(odometerDiagnostics.length).flat().filter(t => t);

                // Limpiar duplicados si se empalmaron por los chunks
                const tripsIdSet = new Set();
                const trips = [];
                tripsRaw.forEach(t => {
                    if (!tripsIdSet.has(t.id)) {
                        tripsIdSet.add(t.id);
                        trips.push(t);
                    }
                });

                // Ordenar del más reciente al más antiguo
                trips.sort((a, b) => new Date(b.stop || b.start) - new Date(a.stop || a.start));

                // C. Reconstrucción lógica
                // Usamos el odómetro base (en KM) y ajustamos según los viajes ocurridos
                // entre la lectura de anclaje (odoDateTime) y la fecha de interés (toDateObj).

                const dailyDistanceData = {};
                // Initialize range days previos a toDate
                for (let i = 0; i < historyDays; i++) {
                    const d = new Date(toDateObj);
                    d.setDate(d.getDate() - i);
                    dailyDistanceData[getLocalDateString(d)] = 0;
                }

                let targetOdoKms = currentOdoKms;

                trips.forEach(trip => {
                    const tripDist = trip.distance || 0; // Se asume KM basándose en historial rendimiento.js
                    const tripStart = new Date(trip.start);
                    const tripStop = new Date(trip.stop || trip.start);

                    // 1. Ajustar el Odómetro al final de la 'fechaObjetivo' (toDateObj)
                    // Si el viaje terminó ANTES del anclaje pero DESPUÉS del objetivo -> restamos para ir al pasado.
                    if (tripStop <= odoDateTime && tripStop > toDateObj) {
                        targetOdoKms -= tripDist;
                    }
                    // Si el viaje terminó DESPUÉS del anclaje pero ANTES del objetivo -> sumamos para ir al futuro.
                    else if (tripStop > odoDateTime && tripStop <= toDateObj) {
                        targetOdoKms += tripDist;
                    }

                    // 2. Poblar desglose diario (usando fecha local para evitar desfases de zona horaria)
                    const dStr = getLocalDateString(tripStart);
                    if (dailyDistanceData[dStr] !== undefined) {
                        dailyDistanceData[dStr] += tripDist;
                    }
                });

                // D. Reconstrucción de Odómetro Acumulado por día (Historial para la tabla)
                const dailyOdoData = {};
                const sortedDatesAsc = Object.keys(dailyDistanceData).sort((a, b) => a.localeCompare(b));
                const reversedDates = [...sortedDatesAsc].reverse(); // Recientes primero (el seleccionado es el primero)

                let currentRunningOdo = targetOdoKms;

                reversedDates.forEach((date) => {
                    dailyOdoData[date] = currentRunningOdo;
                    // El odómetro del día anterior es el actual menos lo que se recorrió hoy
                    currentRunningOdo -= dailyDistanceData[date];
                });

                // --- UI Update ---
                resultContainer.style.display = "block";

                // KPI: Odómetro al final del día seleccionado (en KM)
                animateCount(distanciaValue, targetOdoKms);

                // KPI: Distancia total recorrida en el periodo
                const totalDistancePeriod = Object.values(dailyDistanceData).reduce((a, b) => a + b, 0);
                const distanciaPeriodoValue = document.getElementById("distancia-periodo-value");
                if (distanciaPeriodoValue) {
                    animateCount(distanciaPeriodoValue, totalDistancePeriod);
                }

                const rangeDisplay = selectedPeriod === "custom"
                    ? (formatDateReadable(customFromDate) + " → " + formatDateReadable(customToDate))
                    : formatDateReadable(getLocalDateString(toDateObj));
                fechaFooter.textContent = rangeDisplay;

                // Tabla (ahora paginada)
                const sortedDatesForTable = Object.keys(dailyOdoData).sort((a, b) => b.localeCompare(a));

                currentTableData = sortedDatesForTable.map(date => {
                    return {
                        date: date,
                        dist: dailyDistanceData[date],
                        odo: dailyOdoData[date]
                    };
                });

                currentPage = 1;
                renderTablePage();

                const labelPeriodo = document.getElementById("label-periodo");
                if (labelPeriodo) labelPeriodo.textContent = `Detalle de odómetro y distancia por día`;

                // Store results for re-grouping
                lastOdoData = dailyOdoData;
                lastDistanceData = dailyDistanceData;

                // Gráficas
                renderChart(dailyDistanceData);
                renderOdoTrendChart(dailyOdoData, dailyDistanceData);

                if (window.lucide) lucide.createIcons();
                setTimeout(() => {
                    resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }, 100);

            } catch (err) {
                console.error("Error processing data:", err);
                showError("No se pudieron reconstruir los datos de odómetro satisfactoriamente.");
            }
        }, (err) => {
            loadingOverlay.style.display = "none";
            btnConsultar.disabled = false;
            console.error("MultiCall Error:", err);
            showError("Error de conexión con Geotab.");
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

            // Pagination Listeners
            const btnPrev = document.getElementById("btn-prev-page");
            const btnNext = document.getElementById("btn-next-page");
            if (btnPrev) {
                btnPrev.addEventListener("click", () => {
                    if (currentPage > 1) {
                        currentPage--;
                        renderTablePage();
                    }
                });
            }
            if (btnNext) {
                btnNext.addEventListener("click", () => {
                    const totalPages = Math.ceil(currentTableData.length / itemsPerPage);
                    if (currentPage < totalPages) {
                        currentPage++;
                        renderTablePage();
                    }
                });
            }

            // Period Presets
            const presetButtons = document.querySelectorAll("#period-presets .btn-range");

            presetButtons.forEach(btn => {
                btn.addEventListener("click", function () {
                    const period = this.getAttribute("data-period");

                    if (this.id === "btn-custom-range" || !period) {
                        // Open modal instead of showing inline
                        const modal = document.getElementById("custom-date-modal");
                        if (modal) {
                            // Pre-fill with today
                            const today = new Date().toISOString().split('T')[0];
                            const fromEl = document.getElementById("custom-date-from");
                            const toEl = document.getElementById("custom-date-to");
                            if (fromEl && !fromEl.value) fromEl.value = today;
                            if (toEl && !toEl.value) toEl.value = today;
                            modal.style.display = "flex";
                            if (window.lucide) lucide.createIcons();
                        }
                        return;
                    }

                    presetButtons.forEach(b => b.classList.remove("active"));
                    this.classList.add("active");
                    selectedPeriod = period;

                    // Set automatic grouping based on the selected period preset
                    const isMultiMonth = (period === "semester" || period === "trimester" || period === "bimester");
                    const newGrouping = isMultiMonth ? "month" : "day";

                    trendGrouping = newGrouping;
                    dailyGrouping = newGrouping;
                    tableGrouping = newGrouping;

                    const selectOdo = document.getElementById("trend-timeframe-select-odo");
                    const selectDaily = document.getElementById("trend-timeframe-select-daily");
                    const selectTable = document.getElementById("table-timeframe-select");
                    if (selectOdo) selectOdo.value = newGrouping;
                    if (selectDaily) selectDaily.value = newGrouping;
                    if (selectTable) selectTable.value = newGrouping;

                    calculateDistance();
                });
            });

            // Custom Date Modal Listeners
            const customModal = document.getElementById("custom-date-modal");
            const modalClose = document.getElementById("date-modal-close");
            const modalCancel = document.getElementById("date-modal-cancel");
            const modalApply = document.getElementById("date-modal-apply");

            const closeModal = () => {
                if (customModal) customModal.style.display = "none";
            };

            if (modalClose) modalClose.addEventListener("click", closeModal);
            if (modalCancel) modalCancel.addEventListener("click", closeModal);

            // Close on backdrop click
            if (customModal) {
                customModal.addEventListener("click", function (e) {
                    if (e.target === customModal) closeModal();
                });
            }

            if (modalApply) {
                modalApply.addEventListener("click", () => {
                    const fromVal = document.getElementById("custom-date-from").value;
                    const toVal = document.getElementById("custom-date-to").value;

                    if (!fromVal || !toVal) {
                        showError("Por favor, selecciona ambas fechas.");
                        return;
                    }
                    if (fromVal > toVal) {
                        showError("La fecha de inicio no puede ser mayor que la fecha de fin.");
                        return;
                    }

                    customFromDate = fromVal;
                    customToDate = toVal;
                    selectedPeriod = "custom";

                    // Update active button
                    presetButtons.forEach(b => b.classList.remove("active"));
                    const btnCustom = document.getElementById("btn-custom-range");
                    if (btnCustom) btnCustom.classList.add("active");

                    closeModal();
                    calculateDistance();
                });
            }

            const timeframeSelectOdo = document.getElementById("trend-timeframe-select-odo");
            if (timeframeSelectOdo) {
                timeframeSelectOdo.addEventListener("change", function (e) {
                    trendGrouping = e.target.value;
                    if (Object.keys(lastOdoData).length > 0) {
                        renderOdoTrendChart(lastOdoData, lastDistanceData);
                    }
                });
            }

            const timeframeSelectDaily = document.getElementById("trend-timeframe-select-daily");
            if (timeframeSelectDaily) {
                timeframeSelectDaily.addEventListener("change", function (e) {
                    dailyGrouping = e.target.value;
                    if (Object.keys(lastDistanceData).length > 0) {
                        renderChart(lastDistanceData);
                    }
                });
            }

            const tableTimeframeSelect = document.getElementById("table-timeframe-select");
            if (tableTimeframeSelect) {
                tableTimeframeSelect.addEventListener("change", function (e) {
                    tableGrouping = e.target.value;
                    currentPage = 1;
                    renderTablePage();
                });
            }

            // Export Excel button
            const btnExport = document.getElementById("btn-export-excel");
            if (btnExport) {
                btnExport.addEventListener("click", () => exportToExcel());
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
