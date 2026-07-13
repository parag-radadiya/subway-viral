const PDFDocument = require('pdfkit');

// Colors matching the printed "Weekly Printed Payroll Report".
const COLOR = {
  text: '#000000',
  system: '#1a56db', // blue  — "^ Indicates system time punch"
  manual: '#dc2626', // red   — "* Indicates a user-edited time punch"
  rule: '#000000',
  faint: '#888888',
};

const fmt2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);
const fmtSigned = (v) => {
  const n = Number.isFinite(v) ? v : 0;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
};

/**
 * Render the weekly payroll report (same object returned by the JSON endpoint)
 * to a PDF Buffer. Layout mirrors resourse/Weekly Printed Payroll Report.PDF:
 * store header, one column per day with stacked punches + "Hrs" lines, then
 * TOTAL Adj / TOTAL Before Adj / Adj. Amount rows and an "Hrs Wrkd" column.
 *
 * @param {object} report - structured report data
 * @returns {Promise<Buffer>}
 */
function renderPayrollPdf(report) {
  const dates = report.dates || [];
  // Portrait for a normal week; go landscape when the range is wider so
  // columns stay readable.
  const landscape = dates.length > 7;
  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margins: { top: 28, bottom: 32, left: 28, right: 28 },
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const usableW = right - left;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    // Column geometry.
    const userW = 40;
    const nameW = landscape ? 130 : 104;
    const hrsW = 42;
    const daysAreaW = usableW - userW - nameW - hrsW;
    const dayW = dates.length > 0 ? daysAreaW / dates.length : daysAreaW;

    const colX = [];
    let x = left;
    colX.push(x); // user
    x += userW;
    colX.push(x); // name
    x += nameW;
    for (let i = 0; i < dates.length; i++) {
      colX.push(x);
      x += dayW;
    }
    const hrsX = x; // "Hrs Wrkd" column

    const LH = 8; // line height for 6.5pt cell text
    const PAD = 2;

    // ── header block (store / title / week-ending) ──────────────────────────
    function drawDocHeader() {
      const top = doc.page.margins.top;
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(COLOR.text)
        .text('Store: ', left, top, { continued: true })
        .font('Helvetica')
        .text(report.shop?.display_name || report.shop?.name || '');

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(report.report_title || 'Weekly Printed Payroll Report', left, top - 2, {
          width: usableW,
          align: 'center',
        });

      doc
        .font('Helvetica')
        .fontSize(7)
        .text(`Week ending: ${report.week_ending || ''}`, left, top, {
          width: usableW,
          align: 'right',
        })
        .text(`Printed: ${report.printed_at || ''}`, left, top + 9, {
          width: usableW,
          align: 'right',
        });

      // legend
      let ly = top + 20;
      doc.fontSize(6.5).fillColor(COLOR.system).text('^ Indicates system time punch', left, ly);
      ly += 8;
      doc.fillColor(COLOR.manual).text('* Indicates a user-edited time punch', left, ly);
      doc.fillColor(COLOR.text);
      return ly + 12;
    }

    // ── table column headers ────────────────────────────────────────────────
    function drawTableHeader(y) {
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COLOR.text);
      doc.text('User ID /', colX[0], y, { width: userW - PAD });
      doc.text('Payroll', colX[0], y + 8, { width: userW - PAD });
      doc.text('Employee Name', colX[1], y + 4, { width: nameW - PAD });

      const headers = report.date_headers || dates.map((d) => ({ date_label: d, weekday: '' }));
      headers.forEach((h, i) => {
        doc.text(h.date_label || '', colX[2 + i], y, { width: dayW - PAD });
        doc.text(h.weekday || '', colX[2 + i], y + 8, { width: dayW - PAD });
      });
      doc.text('Hrs Wrkd', hrsX, y + 4, { width: hrsW - PAD, align: 'right' });

      const bottom = y + 20;
      doc
        .moveTo(left, bottom)
        .lineTo(right, bottom)
        .lineWidth(0.7)
        .strokeColor(COLOR.rule)
        .stroke();
      return bottom + 4;
    }

    // draw one punch time label with colored ^ / * markers, return next y
    function drawPunchLine(px, py, punch, width) {
      const base = String(punch.time_label || '').replace(/[\^*]+$/, '');
      doc.font('Helvetica').fontSize(6.5).fillColor(COLOR.text);
      doc.text(base, px, py, { width, lineBreak: false });
      let cx = px + doc.widthOfString(base);
      if (punch.is_system) {
        doc.fillColor(COLOR.system).text('^', cx, py, { lineBreak: false });
        cx += doc.widthOfString('^');
      }
      if (punch.is_manual) {
        doc.fillColor(COLOR.manual).text('*', cx, py, { lineBreak: false });
      }
      doc.fillColor(COLOR.text);
    }

    // ── layout state ────────────────────────────────────────────────────────
    let y = drawDocHeader();
    y = drawTableHeader(y);

    function ensureSpace(needed, redrawHeader = true) {
      if (y + needed <= pageBottom) return;
      doc.addPage();
      y = doc.page.margins.top;
      if (redrawHeader) y = drawTableHeader(y);
    }

    // ── employee blocks ─────────────────────────────────────────────────────
    const employees = report.employees || [];
    employees.forEach((emp) => {
      // Per-day punch line count → tallest day drives the punch area height.
      const dayLineCounts = dates.map((d) => {
        const day = (emp.days || []).find((dd) => dd.date === d);
        return day ? day.punches.length * 2 : 0; // each punch: time line + "Hrs" line
      });
      const maxPunchLines = Math.max(1, ...dayLineCounts);
      const punchAreaH = maxPunchLines * LH;
      const summaryH = 3 * LH + 2; // TOTAL Adj / TOTAL Before Adj / Adj. Amount
      const blockH = punchAreaH + summaryH + 8;

      ensureSpace(blockH);
      const blockTop = y;

      // left identity column
      doc.font('Helvetica').fontSize(6.5).fillColor(COLOR.text);
      doc.text(emp.payroll_id != null ? String(emp.payroll_id) : '', colX[0], blockTop, {
        width: userW - PAD,
      });
      doc.text(emp.employee_name || '', colX[1], blockTop, { width: nameW - PAD });

      // per-day stacked punches
      dates.forEach((d, i) => {
        const day = (emp.days || []).find((dd) => dd.date === d);
        if (!day || day.punches.length === 0) return;
        let py = blockTop;
        const px = colX[2 + i];
        day.punches.forEach((p) => {
          drawPunchLine(px, py, p, dayW - PAD);
          py += LH;
          doc
            .font('Helvetica')
            .fontSize(6.5)
            .fillColor(COLOR.text)
            .text(`Hrs   ${fmt2(p.hours)}`, px + 2, py, { width: dayW - PAD });
          py += LH;
        });
      });

      // summary rows
      let sy = blockTop + punchAreaH + 2;
      const summaryRows = [
        { label: 'TOTAL Adj.', key: 'total_adj', signed: false, bold: true },
        { label: 'TOTAL Before Adj.', key: 'total_before_adj', signed: false, bold: false },
        { label: 'Adj. Amount', key: 'adj_amount', signed: true, bold: false },
      ];
      summaryRows.forEach((rowDef, idx) => {
        doc
          .font(rowDef.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(6.5)
          .fillColor(COLOR.text);
        doc.text(rowDef.label, colX[1], sy, { width: nameW - PAD });
        dates.forEach((d, i) => {
          const day = (emp.days || []).find((dd) => dd.date === d) || {};
          const v = day[rowDef.key] || 0;
          const label = rowDef.signed ? fmtSigned(v) : fmt2(v);
          doc.text(label, colX[2 + i], sy, { width: dayW - PAD });
        });
        // "Hrs Wrkd" weekly total aligned with the first (TOTAL Adj.) row
        if (idx === 0) {
          doc
            .font('Helvetica-Bold')
            .fontSize(7)
            .text(fmt2(emp.hrs_wrkd != null ? emp.hrs_wrkd : emp.weekly_total?.total_adj), hrsX, sy, {
              width: hrsW - PAD,
              align: 'right',
            });
        }
        sy += LH;
      });

      // dotted separator
      y = sy + 3;
      doc
        .moveTo(left, y)
        .lineTo(right, y)
        .lineWidth(0.5)
        .dash(1, { space: 2 })
        .strokeColor(COLOR.faint)
        .stroke()
        .undash();
      y += 5;
    });

    // ── grand totals ────────────────────────────────────────────────────────
    const gt = report.grand_totals;
    if (gt) {
      ensureSpace(3 * LH + 6, false);
      doc
        .moveTo(left, y)
        .lineTo(right, y)
        .lineWidth(0.7)
        .strokeColor(COLOR.rule)
        .stroke();
      y += 4;
      const gtRows = [
        { label: 'GRAND TOTAL Adj.', key: 'total_adj', signed: false },
        { label: 'GRAND TOTAL Before Adj.', key: 'total_before_adj', signed: false },
        { label: 'GRAND Adj. Amount', key: 'adj_amount', signed: true },
      ];
      gtRows.forEach((rowDef, idx) => {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COLOR.text);
        doc.text(rowDef.label, colX[1], y, { width: nameW - PAD });
        (gt.days || []).forEach((day, i) => {
          if (i >= dates.length) return;
          const v = day[rowDef.key] || 0;
          doc.text(rowDef.signed ? fmtSigned(v) : fmt2(v), colX[2 + i], y, { width: dayW - PAD });
        });
        if (idx === 0) {
          doc
            .fontSize(7)
            .text(fmt2(gt.weekly_total?.total_adj), hrsX, y, {
              width: hrsW - PAD,
              align: 'right',
            });
        }
        y += LH;
      });
    }

    doc.end();
  });
}

module.exports = { renderPayrollPdf };
