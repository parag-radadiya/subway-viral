const PDFDocument = require('pdfkit');

// Colors matching the printed "Weekly Printed Payroll Report".
const COLOR = {
  text: '#000000',
  system: '#1a56db', // blue  — "^ Indicates system time punch"
  manual: '#dc2626', // red   — "* Indicates a user-edited time punch"
  rule: '#000000',
  faint: '#888888',
};

const COLS_PER_PAGE = 7; // day columns per section — keeps columns readable for any range

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
 * Ranges longer than one week are split into week-sized sections (up to 7 day
 * columns each) so the table never overflows the page.
 *
 * @param {object} report - structured report data
 * @returns {Promise<Buffer>}
 */
function renderPayrollPdf(report) {
  const allDates = report.dates || [];
  const headerByDate = {};
  (report.date_headers || []).forEach((h) => {
    headerByDate[h.date] = h;
  });

  // Fast lookup: employee -> (date -> day object).
  const employees = report.employees || [];
  const empDayMaps = new Map();
  employees.forEach((emp) => {
    const m = {};
    (emp.days || []).forEach((d) => {
      m[d.date] = d;
    });
    empDayMaps.set(emp, m);
  });

  // Split the range into sections of at most COLS_PER_PAGE dates.
  const sections = [];
  for (let i = 0; i < allDates.length; i += COLS_PER_PAGE) {
    sections.push(allDates.slice(i, i + COLS_PER_PAGE));
  }
  if (sections.length === 0) sections.push([]);

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
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

    const LH = 8; // line height for 6.5pt cell text
    const PAD = 2;

    let y = 0;
    let geom = null; // { colX[], dayW, hrsX, dates }

    function computeGeometry(dates) {
      const userW = 40;
      const nameW = 116;
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
      return { colX, dayW, hrsX: x, userW, nameW, hrsW, dates };
    }

    function drawDocHeader(dates) {
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

      // Right meta: range covered by this section + printed timestamp.
      const first = dates[0];
      const last = dates[dates.length - 1];
      const rangeLabel =
        first && last
          ? `${headerByDate[first]?.date_label || first} – ${headerByDate[last]?.date_label || last}`
          : report.week_ending || '';
      doc
        .font('Helvetica')
        .fontSize(7)
        .text(`Dates: ${rangeLabel}`, left, top, { width: usableW, align: 'right' })
        .text(`Printed: ${report.printed_at || ''}`, left, top + 9, {
          width: usableW,
          align: 'right',
        });

      let ly = top + 20;
      doc.fontSize(6.5).fillColor(COLOR.system).text('^ Indicates system time punch', left, ly);
      ly += 8;
      doc.fillColor(COLOR.manual).text('* Indicates a user-edited time punch', left, ly);
      doc.fillColor(COLOR.text);
      return ly + 12;
    }

    function drawTableHeader(g, atY) {
      let ty = atY;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COLOR.text);
      doc.text('User ID /', g.colX[0], ty, { width: g.userW - PAD });
      doc.text('Payroll', g.colX[0], ty + 8, { width: g.userW - PAD });
      doc.text('Employee Name', g.colX[1], ty + 4, { width: g.nameW - PAD });

      g.dates.forEach((d, i) => {
        const h = headerByDate[d] || { date_label: d, weekday: '' };
        doc.text(h.date_label || '', g.colX[2 + i], ty, { width: g.dayW - PAD });
        doc.text(h.weekday || '', g.colX[2 + i], ty + 8, { width: g.dayW - PAD });
      });
      doc.text('Hrs Wrkd', g.hrsX, ty + 4, { width: g.hrsW - PAD, align: 'right' });

      const bottom = ty + 20;
      doc.moveTo(left, bottom).lineTo(right, bottom).lineWidth(0.7).strokeColor(COLOR.rule).stroke();
      return bottom + 4;
    }

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

    function ensureSpace(g, needed) {
      if (y + needed <= pageBottom) return;
      doc.addPage();
      y = doc.page.margins.top;
      y = drawTableHeader(g, y);
    }

    // Sum a day-value key over a section's dates for one employee.
    function sumOver(dayMap, dates, key) {
      return dates.reduce((acc, d) => acc + ((dayMap[d] && dayMap[d][key]) || 0), 0);
    }

    // ── render each section ─────────────────────────────────────────────────
    sections.forEach((dates, si) => {
      if (si > 0) doc.addPage();
      const g = computeGeometry(dates);
      geom = g;
      y = drawDocHeader(dates);
      y = drawTableHeader(g, y);

      employees.forEach((emp) => {
        const dayMap = empDayMaps.get(emp);
        const lineCounts = dates.map((d) => (dayMap[d] ? dayMap[d].punches.length * 2 : 0));
        const maxPunchLines = Math.max(1, ...lineCounts);
        const punchAreaH = maxPunchLines * LH;
        const blockH = punchAreaH + 3 * LH + 10;
        ensureSpace(g, blockH);
        const blockTop = y;

        // identity column: payroll id, name, email
        doc.font('Helvetica').fontSize(6.5).fillColor(COLOR.text);
        doc.text(emp.payroll_id != null ? String(emp.payroll_id) : '', g.colX[0], blockTop, {
          width: g.userW - PAD,
        });
        doc.text(emp.employee_name || emp.name || '', g.colX[1], blockTop, {
          width: g.nameW - PAD,
        });
        if (emp.email) {
          doc
            .fontSize(5.5)
            .fillColor(COLOR.faint)
            .text(emp.email, g.colX[1], blockTop + 8, { width: g.nameW - PAD, lineBreak: false });
          doc.fillColor(COLOR.text).fontSize(6.5);
        }

        // per-day stacked punches
        dates.forEach((d, i) => {
          const day = dayMap[d];
          if (!day || day.punches.length === 0) return;
          let py = blockTop;
          const px = g.colX[2 + i];
          day.punches.forEach((p) => {
            drawPunchLine(px, py, p, g.dayW - PAD);
            py += LH;
            doc
              .font('Helvetica')
              .fontSize(6.5)
              .fillColor(COLOR.text)
              .text(`Hrs   ${fmt2(p.hours)}`, px + 2, py, { width: g.dayW - PAD });
            py += LH;
          });
        });

        // total rows (summed over this section's dates)
        let sy = blockTop + punchAreaH + 2;
        const rows = [
          { label: 'TOTAL Adj.', key: 'total_adj', signed: false, bold: true },
          { label: 'TOTAL Before Adj.', key: 'total_before_adj', signed: false, bold: false },
          { label: 'Adj. Amount', key: 'adj_amount', signed: true, bold: false },
        ];
        rows.forEach((rowDef, idx) => {
          doc.font(rowDef.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.5).fillColor(COLOR.text);
          doc.text(rowDef.label, g.colX[1], sy, { width: g.nameW - PAD });
          dates.forEach((d, i) => {
            const day = dayMap[d] || {};
            const v = day[rowDef.key] || 0;
            doc.text(rowDef.signed ? fmtSigned(v) : fmt2(v), g.colX[2 + i], sy, {
              width: g.dayW - PAD,
            });
          });
          if (idx === 0) {
            doc
              .font('Helvetica-Bold')
              .fontSize(7)
              .text(fmt2(sumOver(dayMap, dates, 'total_adj')), g.hrsX, sy, {
                width: g.hrsW - PAD,
                align: 'right',
              });
          }
          sy += LH;
        });

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

      // section grand totals
      ensureSpace(g, 3 * LH + 6);
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(COLOR.rule).stroke();
      y += 4;
      const gtRows = [
        { label: 'GRAND TOTAL Adj.', key: 'total_adj', signed: false },
        { label: 'GRAND TOTAL Before Adj.', key: 'total_before_adj', signed: false },
        { label: 'GRAND Adj. Amount', key: 'adj_amount', signed: true },
      ];
      gtRows.forEach((rowDef, idx) => {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(COLOR.text);
        doc.text(rowDef.label, g.colX[1], y, { width: g.nameW - PAD });
        let weekly = 0;
        dates.forEach((d, i) => {
          const v = employees.reduce((acc, emp) => {
            const day = empDayMaps.get(emp)[d];
            return acc + ((day && day[rowDef.key]) || 0);
          }, 0);
          if (rowDef.key === 'total_adj') weekly += v;
          doc.text(rowDef.signed ? fmtSigned(v) : fmt2(v), g.colX[2 + i], y, {
            width: g.dayW - PAD,
          });
        });
        if (idx === 0) {
          doc.fontSize(7).text(fmt2(weekly), g.hrsX, y, { width: g.hrsW - PAD, align: 'right' });
        }
        y += LH;
      });
    });

    void geom;
    doc.end();
  });
}

module.exports = { renderPayrollPdf };
