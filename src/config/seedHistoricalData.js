'use strict';

const path = require('path');
// Try .env from CWD first, then walk up for worktree environments
require('dotenv').config() ||
  require('dotenv').config({ path: path.resolve(__dirname, '../../../../../../.env') }) ||
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const XLSX = require('xlsx');

const connectDB = require('./db');
const Shop = require('../models/Shop');
const StoreReportEntry = require('../models/StoreReportEntry');
const StoreReportWeekly2026B = require('../models/StoreReportWeekly2026B');
const StoreReportMonthlySale2026 = require('../models/StoreReportMonthlySale2026');

// ── File configuration ────────────────────────────────────────────────────────

const DATA_DIR =
  process.env.HISTORICAL_DATA_DIR || path.join('/Users/radadiyaashvinbhai/Downloads/subway data');

const FILE_CONFIGS = [
  {
    file: 'WEEKLY COST 2022 .xlsx',
    year: 2022,
    janDecSheet: 'May-June-July 2022',
    weeklySheet: 'Weekly',
    monthlySheet: null,
  },
  {
    file: 'Weekly Cost 2023.xlsx',
    year: 2023,
    janDecSheet: 'Jan 23',
    weeklySheet: 'Weekly 2023',
    monthlySheet: null,
  },
  {
    file: 'Weekly Cost 2024 (1).xlsx',
    year: 2024,
    janDecSheet: 'Jan 24',
    weeklySheet: 'Weekly 2024',
    monthlySheet: 'Monthly Sale',
  },
  {
    file: 'Weekly Cost 2025 (3).xlsx',
    year: 2025,
    janDecSheet: 'Jan-Dec 25',
    weeklySheet: 'Weekly 2025',
    monthlySheet: 'Monthly Sale 2025',
  },
  {
    file: 'Weekly Cost 2026 (1).xlsx',
    year: 2026,
    janDecSheet: 'Jan-Dec 26',
    weeklySheet: 'Weekly 2026',
    monthlySheet: 'Monthly Sale 2026',
  },
];

// ── Utility functions ─────────────────────────────────────────────────────────

const normalizeText = (v) => String(v ?? '').trim();

const normalizeStoreName = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, ' ');

const normalizeHeader = (v) => normalizeStoreName(v).replace(/[^a-z0-9]/g, '');

const SKIP_STORE_LABELS = new Set(['total', 'store', '']);
const isTotalRow = (name) => {
  const n = normalizeStoreName(name);
  return SKIP_STORE_LABELS.has(n) || n.startsWith('total ');
};

function sanitizeNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = normalizeText(v).replace(/[^\d.-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function hasAnyValue(vals) {
  return vals.some((v) => v !== null && v !== undefined);
}

const MONTH_NAMES = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function parseFlexibleMonth(value) {
  if (!value && value !== 0) return null;

  // JS Date object (from xlsx raw:true)
  if (value instanceof Date && !isNaN(value)) {
    return { year: value.getFullYear(), month: value.getMonth() + 1 };
  }

  // Excel serial number (dates stored as numbers by xlsx)
  if (typeof value === 'number' && value > 40000 && value < 60000) {
    const d = new Date(Math.round((value - 25569) * 864e5));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }

  const raw = normalizeText(value);
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');

  // "Jan-24" or "Jan-2024" or "Jan/2024"
  const m1 = compact.match(/^([A-Za-z]{3,9})[-/](\d{2}|\d{4})$/);
  if (m1) {
    const mo = MONTH_NAMES[m1[1].toLowerCase()];
    if (mo) {
      const yy = Number(m1[2]);
      return { year: m1[2].length === 2 ? 2000 + yy : yy, month: mo };
    }
  }

  // "January 2024" or "January, 2024"
  const m2 = raw.match(/^([A-Za-z]+)[,\s]+(\d{4})$/);
  if (m2) {
    const mo = MONTH_NAMES[m2[1].toLowerCase()];
    if (mo) return { year: Number(m2[2]), month: mo };
  }

  // "1/1/2024" or "01/01/2024"
  const m3 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m3) return { year: Number(m3[3]), month: Number(m3[1]) };

  // "2024-01-01"
  const m4 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m4) return { year: Number(m4[1]), month: Number(m4[2]) };

  return null;
}

function toPeriodKey(year, month, weekNumber) {
  const mm = String(month).padStart(2, '0');
  if (weekNumber != null) {
    return `${year}-${mm}-W${String(weekNumber).padStart(2, '0')}`;
  }
  return `${year}-${mm}`;
}

function toMetricKey(headerLabel) {
  if (!headerLabel) return null;
  const cleaned = normalizeText(headerLabel)
    .replace(/%/g, ' percent ')
    .replace(/#/g, ' number ')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ');
  const parts = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return null;
  const [first, ...rest] = parts;
  const camel = `${first}${rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}`;
  return /^\d/.test(camel) ? `metric${camel}` : camel;
}

function collectDynamicMetrics(dataRow, headerRow, skipIndexes) {
  const metrics = {};
  const usedCamel = new Set();

  for (let c = 0; c < headerRow.length; c++) {
    if (skipIndexes.has(c)) continue;
    const rawHeader = headerRow[c];
    if (rawHeader == null) continue;

    const val = sanitizeNumber(dataRow[c]);
    if (val === null) continue;

    // Store exact Excel column name (preserves spaces/case exactly as in sample JSON)
    const exactKey = String(rawHeader);
    if (exactKey.trim() && !Object.prototype.hasOwnProperty.call(metrics, exactKey)) {
      metrics[exactKey] = val;
    }

    // Also store camelCase version for programmatic access
    const camelKey = toMetricKey(rawHeader);
    if (!camelKey) continue;
    let k = camelKey;
    let n = 2;
    while (usedCamel.has(k)) {
      k = `${camelKey}${n++}`;
    }
    usedCamel.add(k);
    if (!Object.prototype.hasOwnProperty.call(metrics, k)) {
      metrics[k] = val;
    }
  }
  return metrics;
}

// ── Parse per-store weekly sheet → StoreReportEntry records ──────────────────
// Format (2022): week-header row → column-header row → blank → data rows → total → repeat
// Format (2023+): [None, 'WEEK-N  DD-MM-YYYY To DD-MM-YYYY'] → [weekNum, 'STORE ', ...] → blank → data → total → repeat

const TODAY = new Date();
TODAY.setUTCHours(23, 59, 59, 999);

function parseJanDecSheet(sheetRows, year) {
  const entries = [];

  const WEEK_DATE_RE = /(\d{2})-(\d{2})-(\d{4})\s+[Tt]o\s+(\d{2})-(\d{2})-(\d{4})/;
  const WEEK_NUM_RE = /WEEK-(\d+)/i;

  let currentWeekStart = null;
  let currentWeekEnd = null;
  let currentWeekNumber = null;
  let colHeaderRow = null;
  let weekCounter = 0;

  for (let i = 0; i < sheetRows.length; i++) {
    const row = sheetRows[i] || [];
    const rowText = row.map((v) => String(v ?? '')).join(' ');

    // Detect week header row
    const dateMatch = WEEK_DATE_RE.exec(rowText);
    if (dateMatch && rowText.toUpperCase().includes('WEEK')) {
      const sd = Number(dateMatch[1]),
        sm = Number(dateMatch[2]),
        sy = Number(dateMatch[3]);
      const ed = Number(dateMatch[4]),
        em = Number(dateMatch[5]),
        ey = Number(dateMatch[6]);
      currentWeekStart = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0));
      currentWeekEnd = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999));

      const numMatch = WEEK_NUM_RE.exec(rowText);
      weekCounter += 1;
      currentWeekNumber = numMatch ? Number(numMatch[1]) : weekCounter;
      colHeaderRow = null;
      continue;
    }

    // Skip future weeks entirely
    if (currentWeekEnd && currentWeekEnd > TODAY) continue;

    // Detect column header row (has 'STORE' as a header cell)
    const normalized = row.map(normalizeHeader);
    const storeCol = normalized.findIndex((h) => h === 'store');
    if (storeCol >= 0 && currentWeekStart && !colHeaderRow) {
      colHeaderRow = row;
      continue;
    }

    // Data row
    if (colHeaderRow && currentWeekStart) {
      const hNorm = colHeaderRow.map(normalizeHeader);
      const sc = hNorm.findIndex((h) => h === 'store');
      if (sc < 0) continue;

      const storeName = normalizeText(row[sc]);
      if (!storeName || isTotalRow(storeName)) continue;

      const skipIdx = new Set([sc]);
      const metrics = collectDynamicMetrics(row, colHeaderRow, skipIdx);
      if (!hasAnyValue(Object.values(metrics))) continue;

      // Add frontend-expected summary alias keys (table and modal both read these)
      if (metrics.grossSales != null) metrics.sales = metrics.grossSales;
      if (metrics.netSales != null) metrics.net = metrics.netSales;
      if (metrics.labourCost != null) metrics.labour = metrics.labourCost;
      if (metrics.vat != null) metrics.vat18 = metrics.vat;
      if (metrics.bidFood != null) metrics.foodCost22 = metrics.bidFood;
      if (metrics.bidfoodTotal != null) metrics.foodCost22 = metrics.bidfoodTotal;
      if (metrics.deliveryChargesTotal != null) metrics.commission = metrics.deliveryChargesTotal;
      if (metrics.deliveryChargePercent != null)
        metrics.commissionPercentage = metrics.deliveryChargePercent;

      const weekEnd = currentWeekEnd;
      const wYear = weekEnd.getUTCFullYear();
      const wMonth = weekEnd.getUTCMonth() + 1;

      entries.push({
        storeName,
        weekStart: currentWeekStart,
        weekEnd: currentWeekEnd,
        weekNumber: currentWeekNumber,
        year: wYear,
        month: wMonth,
        weekRangeLabel:
          `${String(currentWeekStart.getUTCDate()).padStart(2, '0')}/` +
          `${String(currentWeekStart.getUTCMonth() + 1).padStart(2, '0')} to ` +
          `${String(currentWeekEnd.getUTCDate()).padStart(2, '0')}/` +
          `${String(currentWeekEnd.getUTCMonth() + 1).padStart(2, '0')}`,
        periodKey: toPeriodKey(wYear, wMonth, currentWeekNumber),
        metrics,
      });
    }
  }

  return entries;
}

// ── Parse summary weekly sheet → StoreReportWeekly2026B records ───────────────
// Format: header row with 'Week Ending'/'Sales'/'Net' → data rows

function parseWeeklySheet(sheetRows, year) {
  const entries = [];

  for (let ri = 0; ri < sheetRows.length; ri++) {
    const headerRow = sheetRows[ri] || [];
    const normalized = headerRow.map(normalizeHeader);

    const weekCol = normalized.findIndex((h) => h === 'weekending' || h.includes('weekending'));
    if (weekCol < 0) continue;

    const storeCol = normalized.findIndex((h) => h === 'store');
    let localCounter = 1;

    for (let di = ri + 1; di < sheetRows.length; di++) {
      const dataRow = sheetRows[di] || [];
      const weekRaw = normalizeText(dataRow[weekCol]);
      if (!weekRaw || !weekRaw.toLowerCase().includes('to')) continue;

      // Parse "DD/MM to DD/MM" format
      const match = weekRaw.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*to\s*(\d{1,2})\s*\/\s*(\d{1,2})/i);
      if (!match) continue;

      const startDay = Number(match[1]),
        startMonth = Number(match[2]);
      const endDay = Number(match[3]),
        endMonth = Number(match[4]);
      const endYear = Number(year);
      const startYear = startMonth > endMonth ? endYear - 1 : endYear;

      const weekStart = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0, 0));
      const weekEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999));
      if (isNaN(weekStart) || isNaN(weekEnd)) continue;

      // Skip future weeks
      if (weekEnd > TODAY) continue;

      const wYear = weekEnd.getUTCFullYear();
      const wMonth = weekEnd.getUTCMonth() + 1;

      const weekFromSheet = Number(dataRow[0]);
      const weekNumber =
        Number.isFinite(weekFromSheet) && weekFromSheet > 0 ? weekFromSheet : localCounter;

      const storeName = normalizeText(storeCol >= 0 ? dataRow[storeCol] : '') || 'Unknown';

      const skipIdx = new Set([0, weekCol]);
      if (storeCol >= 0) skipIdx.add(storeCol);
      const metrics = collectDynamicMetrics(dataRow, headerRow, skipIdx);
      if (!hasAnyValue(Object.values(metrics))) continue;

      entries.push({
        storeName,
        storeKey: normalizeStoreName(storeName) || 'unknown',
        year: wYear,
        month: wMonth,
        weekNumber,
        weekStart,
        weekEnd,
        weekRangeLabel:
          `${String(startDay).padStart(2, '0')}/${String(startMonth).padStart(2, '0')} to ` +
          `${String(endDay).padStart(2, '0')}/${String(endMonth).padStart(2, '0')}`,
        periodKey: toPeriodKey(wYear, wMonth, weekNumber),
        metrics,
      });

      localCounter++;
    }
  }

  return entries;
}

// ── Parse monthly sale sheet → StoreReportMonthlySale2026 records ─────────────
// Format: header row with date in col 0 + 'STORE '/'Gross Sale'/'Net Sale'
//         then data rows until next header

function parseMonthlySheet(sheetRows, defaultYear) {
  const entries = [];
  const seen = new Set();

  for (let ri = 0; ri < sheetRows.length; ri++) {
    const headerRow = sheetRows[ri] || [];
    const normalized = headerRow.map(normalizeHeader);

    const storeCol = normalized.findIndex((h) => h === 'store');
    const grossSaleCol = normalized.findIndex((h) => h === 'grosssale');
    const netSaleCol = normalized.findIndex((h) => h === 'netsale');
    if (storeCol < 0 || grossSaleCol < 0 || netSaleCol < 0) continue;

    // Month may be in column 0 of the header row itself
    let activeMonth = parseFlexibleMonth(headerRow[0]);
    if (!activeMonth) {
      activeMonth = { year: Number(defaultYear), month: 1 };
    }

    for (let di = ri + 1; di < sheetRows.length; di++) {
      const dataRow = sheetRows[di] || [];

      // If column 0 looks like a date → update active month
      const possibleMonth = parseFlexibleMonth(dataRow[0]);
      if (possibleMonth) {
        activeMonth = possibleMonth;
      }

      // Skip future months
      const nowYear = TODAY.getUTCFullYear();
      const nowMonth = TODAY.getUTCMonth() + 1;
      if (
        activeMonth.year > nowYear ||
        (activeMonth.year === nowYear && activeMonth.month > nowMonth)
      )
        continue;

      const storeName = normalizeText(dataRow[storeCol]);
      if (!storeName || isTotalRow(storeName)) continue;

      const skipIdx = new Set([0, storeCol]);
      const metrics = collectDynamicMetrics(dataRow, headerRow, skipIdx);
      if (!hasAnyValue(Object.values(metrics))) continue;

      const periodKey = toPeriodKey(activeMonth.year, activeMonth.month, null);
      const storeKey = normalizeStoreName(storeName) || 'unknown';
      const dedupeKey = `${periodKey}::${storeKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      entries.push({
        storeName,
        storeKey,
        year: activeMonth.year,
        month: activeMonth.month,
        periodKey,
        metrics,
      });
    }
  }

  return entries;
}

// ── Shop lookup / creation ────────────────────────────────────────────────────

async function buildShopLookup() {
  const shops = await Shop.find({}).select('_id name aliases');
  const byName = new Map();
  shops.forEach((s) => {
    byName.set(normalizeStoreName(s.name), s);
    (s.aliases || []).forEach((a) => {
      const k = normalizeStoreName(a);
      if (k && !byName.has(k)) byName.set(k, s);
    });
  });
  return byName;
}

async function getOrCreateShop(storeName, byName) {
  const key = normalizeStoreName(storeName);
  if (!key) return null;
  if (byName.has(key)) return byName.get(key);

  const shop = await Shop.create({
    name: storeName.trim(),
    aliases: [storeName.trim()],
    latitude: 0,
    longitude: 0,
  });
  byName.set(key, shop);
  return shop;
}

// ── Bulk upsert helpers ───────────────────────────────────────────────────────

async function upsertStoreReportEntries(records, sourceFile) {
  if (!records.length) return { upserted: 0, modified: 0 };
  const ops = records.map((r) => ({
    updateOne: {
      filter: {
        shop_id: r.shop_id,
        report_type: 'weekly_financial',
        source_type: 'excel_raw',
        period_key: r.periodKey,
      },
      update: {
        $set: {
          year: r.year,
          month: r.month,
          week_number: r.weekNumber ?? null,
          week_start: r.weekStart ?? null,
          week_end: r.weekEnd ?? null,
          week_range_label: r.weekRangeLabel ?? null,
          store_name_raw: r.storeName ?? null,
          metrics: r.metrics ?? {},
          source_file: sourceFile,
          updated_by: null,
        },
        $setOnInsert: { imported_by: null },
      },
      upsert: true,
    },
  }));
  const res = await StoreReportEntry.bulkWrite(ops, { ordered: false });
  return { upserted: res.upsertedCount || 0, modified: res.modifiedCount || 0 };
}

async function upsertWeeklyRecords(records, sourceFile, sourceSheet) {
  if (!records.length) return { upserted: 0, modified: 0 };
  const ops = records.map((r) => ({
    updateOne: {
      filter: {
        source_sheet: sourceSheet,
        period_key: r.periodKey,
        store_key: r.storeKey,
      },
      update: {
        $set: {
          shop_id: r.shop_id ?? null,
          store_name_raw: r.storeName,
          store_key: r.storeKey,
          source_sheet: sourceSheet,
          period_key: r.periodKey,
          year: r.year,
          month: r.month,
          week_number: r.weekNumber,
          week_start: r.weekStart ?? null,
          week_end: r.weekEnd ?? null,
          week_range_label: r.weekRangeLabel ?? null,
          metrics: r.metrics ?? {},
          source_file: sourceFile,
          updated_by: null,
        },
        $setOnInsert: { imported_by: null },
      },
      upsert: true,
    },
  }));
  const res = await StoreReportWeekly2026B.bulkWrite(ops, { ordered: false });
  return { upserted: res.upsertedCount || 0, modified: res.modifiedCount || 0 };
}

async function upsertMonthlyRecords(records, sourceFile, sourceSheet) {
  if (!records.length) return { upserted: 0, modified: 0 };
  const ops = records.map((r) => ({
    updateOne: {
      filter: {
        source_sheet: sourceSheet,
        period_key: r.periodKey,
        store_key: r.storeKey,
      },
      update: {
        $set: {
          shop_id: r.shop_id ?? null,
          store_name_raw: r.storeName,
          store_key: r.storeKey,
          source_sheet: sourceSheet,
          period_key: r.periodKey,
          year: r.year,
          month: r.month,
          metrics: r.metrics ?? {},
          source_file: sourceFile,
          updated_by: null,
        },
        $setOnInsert: { imported_by: null },
      },
      upsert: true,
    },
  }));
  const res = await StoreReportMonthlySale2026.bulkWrite(ops, { ordered: false });
  return { upserted: res.upsertedCount || 0, modified: res.modifiedCount || 0 };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();

  // ── Delete future-dated records that were previously seeded ──────────────────
  const nowYear = TODAY.getUTCFullYear();
  const nowMonth = TODAY.getUTCMonth() + 1;

  const SEED_SOURCE_FILES = FILE_CONFIGS.map((c) => c.file);
  const SEED_WEEKLY_SHEETS = FILE_CONFIGS.map((c) => c.weeklySheet).filter(Boolean);
  const SEED_MONTHLY_SHEETS = FILE_CONFIGS.map((c) => c.monthlySheet).filter(Boolean);

  const [delEntry, delWeekly, delMonthly] = await Promise.all([
    StoreReportEntry.deleteMany({
      source_type: 'excel_raw',
      source_file: { $in: SEED_SOURCE_FILES },
      week_end: { $gt: TODAY },
    }),
    StoreReportWeekly2026B.deleteMany({
      source_sheet: { $in: SEED_WEEKLY_SHEETS },
      week_end: { $gt: TODAY },
    }),
    StoreReportMonthlySale2026.deleteMany({
      source_sheet: { $in: SEED_MONTHLY_SHEETS },
      $or: [{ year: { $gt: nowYear } }, { year: nowYear, month: { $gt: nowMonth } }],
    }),
  ]);
  console.log(
    `🗑️  Deleted future records — Entry:${delEntry.deletedCount} Weekly:${delWeekly.deletedCount} Monthly:${delMonthly.deletedCount}`
  );

  const totals = {
    entry: { upserted: 0, modified: 0 },
    weekly: { upserted: 0, modified: 0 },
    monthly: { upserted: 0, modified: 0 },
  };

  for (const cfg of FILE_CONFIGS) {
    const filePath = path.join(DATA_DIR, cfg.file);
    console.log(`\n📂  Processing [${cfg.year}]: ${cfg.file}`);

    let workbook;
    try {
      workbook = XLSX.readFile(filePath, { cellDates: true, raw: true, defval: null });
    } catch (err) {
      console.error(`  ❌  Failed to read file: ${err.message}`);
      continue;
    }

    const sheetNames = workbook.SheetNames;
    const shopByName = await buildShopLookup();

    const readSheet = (name) => {
      if (!name || !sheetNames.includes(name)) return null;
      return XLSX.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        raw: true,
        defval: null,
      });
    };

    // ── 1. StoreReportEntry from Jan-Dec / per-store detail sheet ──────────────
    const janDecRows = readSheet(cfg.janDecSheet);
    if (janDecRows) {
      const parsed = parseJanDecSheet(janDecRows, cfg.year);
      const records = [];
      let skipped = 0;

      for (const row of parsed) {
        const shop = await getOrCreateShop(row.storeName, shopByName);
        if (!shop) {
          skipped++;
          continue;
        }
        records.push({ ...row, shop_id: shop._id });
      }

      const res = await upsertStoreReportEntries(records, cfg.file);
      totals.entry.upserted += res.upserted;
      totals.entry.modified += res.modified;
      console.log(
        `  StoreReportEntry  [${cfg.janDecSheet}]: parsed=${parsed.length}  upserted=${res.upserted}  modified=${res.modified}  skipped=${skipped}`
      );
    } else {
      console.log(`  StoreReportEntry  [${cfg.janDecSheet}]: sheet not found`);
    }

    // ── 2. StoreReportWeekly2026B from Weekly summary sheet ────────────────────
    const weeklyRows = readSheet(cfg.weeklySheet);
    if (weeklyRows) {
      const parsed = parseWeeklySheet(weeklyRows, cfg.year);
      const records = [];

      for (const row of parsed) {
        const shop = await getOrCreateShop(row.storeName, shopByName);
        records.push({ ...row, shop_id: shop?._id ?? null });
      }

      const res = await upsertWeeklyRecords(records, cfg.file, cfg.weeklySheet);
      totals.weekly.upserted += res.upserted;
      totals.weekly.modified += res.modified;
      console.log(
        `  StoreReportWeekly [${cfg.weeklySheet}]: parsed=${parsed.length}  upserted=${res.upserted}  modified=${res.modified}`
      );
    } else {
      console.log(`  StoreReportWeekly [${cfg.weeklySheet}]: sheet not found`);
    }

    // ── 3. StoreReportMonthlySale2026 from Monthly Sale sheet ──────────────────
    if (cfg.monthlySheet) {
      const monthlyRows = readSheet(cfg.monthlySheet);
      if (monthlyRows) {
        const parsed = parseMonthlySheet(monthlyRows, cfg.year);
        const records = [];

        for (const row of parsed) {
          const shop = await getOrCreateShop(row.storeName, shopByName);
          records.push({ ...row, shop_id: shop?._id ?? null });
        }

        const res = await upsertMonthlyRecords(records, cfg.file, cfg.monthlySheet);
        totals.monthly.upserted += res.upserted;
        totals.monthly.modified += res.modified;
        console.log(
          `  StoreReportMonthly[${cfg.monthlySheet}]: parsed=${parsed.length}  upserted=${res.upserted}  modified=${res.modified}`
        );
      } else {
        console.log(`  StoreReportMonthly[${cfg.monthlySheet}]: sheet not found`);
      }
    } else {
      console.log(`  StoreReportMonthly: no monthly sheet for ${cfg.year}`);
    }
  }

  console.log('\n✅  Import complete');
  console.log(
    `   StoreReportEntry  : ${totals.entry.upserted} inserted, ${totals.entry.modified} updated`
  );
  console.log(
    `   StoreReportWeekly : ${totals.weekly.upserted} inserted, ${totals.weekly.modified} updated`
  );
  console.log(
    `   StoreReportMonthly: ${totals.monthly.upserted} inserted, ${totals.monthly.modified} updated`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
