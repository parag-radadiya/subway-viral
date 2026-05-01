const fs = require('fs');
const path = require('path');
const Shop = require('../models/Shop');
const StoreReportEntry = require('../models/StoreReportEntry');
const StoreReportWeekly2026B = require('../models/StoreReportWeekly2026B');
const StoreReportMonthlySale2026 = require('../models/StoreReportMonthlySale2026');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');
const { buildShopScope, isShopAllowed } = require('../middleware/shopScopeMiddleware');

const HISTORICAL_SHEET_ALIASES = {
  janDec: ['Jan-Dec 26', 'Jan Dec 26'],
  weekly2026b: ['Weekly 2026B', 'Weekly 2026'],
  monthlySale2026: ['Monthly Sale 2026'],
};

const WEEKLY_NUMERIC_FIELDS = [
  'sales',
  'net',
  'labour',
  'vat18',
  'royalties',
  'foodCost22',
  'commission',
  'commissionPercentage',
  'total',
  'income',
];

const MONTHLY_NUMERIC_FIELDS = [
  'grossSale',
  'netSale',
  'vat',
  'vatPercent',
  'customerCount',
  'bidfood',
  'bidfoodPercent',
  'labourHour',
  'labourCost',
  'labourPercent',
  'kioskPercent',
  'totalCogs',
  'revScoreQ1',
];

const CHANNEL_KEYS = ['justeat', 'ubereat', 'deliveroo', 'thirdParty', 'instore'];

const CHANNEL_ALIASES = {
  justeat: 'justeat',
  justeatSale: 'justeat',
  ubereat: 'ubereat',
  uberEat: 'ubereat',
  ubereatSale: 'ubereat',
  deliveroo: 'deliveroo',
  deliverooSale: 'deliveroo',
  thirdparty: 'thirdParty',
  thirdParty: 'thirdParty',
  third_party: 'thirdParty',
  threedpd: 'thirdParty',
  '3pd': 'thirdParty',
  instore: 'instore',
  inStore: 'instore',
  offline: 'instore',
};

const REPORT_COLUMNS = {
  weekly_financial: [
    { key: 'shopName', label: 'Store' },
    { key: 'weekNumber', label: 'Week #' },
    { key: 'weekRange', label: 'Week Ending' },
    { key: 'sales', label: 'Sales' },
    { key: 'net', label: 'Net' },
    { key: 'labour', label: 'Labour' },
    { key: 'vat18', label: 'VAT 18%' },
    { key: 'royalties', label: 'Royalties' },
    { key: 'foodCost22', label: 'Food Cost 22%' },
    { key: 'commission', label: 'Commision' },
    { key: 'commissionPercentage', label: 'Commision Percentage' },
    { key: 'total', label: 'Total' },
    { key: 'income', label: 'Income' },
  ],
  monthly_store_kpi: [
    { key: 'shopName', label: 'Store' },
    { key: 'grossSale', label: 'Gross Sale' },
    { key: 'netSale', label: 'Net Sale' },
    { key: 'vat', label: 'Vat' },
    { key: 'vatPercent', label: 'Vat %' },
    { key: 'customerCount', label: 'Customer Count' },
    { key: 'bidfood', label: 'Bidfood' },
    { key: 'bidfoodPercent', label: 'Bidfood %' },
    { key: 'labourHour', label: 'Labour Hour' },
    { key: 'labourCost', label: 'Labour Cost' },
    { key: 'labourPercent', label: 'Labour %' },
    { key: 'kioskPercent', label: 'Kiosk %' },
    { key: 'totalCogs', label: 'TOTAL COGS' },
    { key: 'revScoreQ1', label: 'Rev Score Q1' },
  ],
};

const normalizeText = (value) => String(value || '').trim();

const normalizeStoreName = (value) => normalizeText(value).toLowerCase().replace(/\s+/g, ' ');

const normalizeHeader = (value) => normalizeStoreName(value).replace(/[^a-z0-9]/g, '');

function toMetricKey(headerLabel) {
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

  if (parts.length === 0) return null;

  const [first, ...rest] = parts;
  const camel = `${first}${rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`;
  return /^\d/.test(camel) ? `metric${camel}` : camel;
}

function collectAdditionalNumericMetrics(dataRow, headerRow, usedIndexes, reservedKeys) {
  const extraMetrics = {};
  const usedKeys = new Set(reservedKeys || []);

  for (let col = 0; col < headerRow.length; col += 1) {
    if (usedIndexes.has(col)) continue;

    const headerLabel = headerRow[col];
    const baseKey = toMetricKey(headerLabel);
    if (!baseKey) continue;

    const value = sanitizeNumber(dataRow[col]);
    if (value === null) continue;

    let key = baseKey;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey}${suffix}`;
      suffix += 1;
    }

    usedKeys.add(key);
    extraMetrics[key] = value;
  }

  return extraMetrics;
}

function collectDynamicNumericMetrics(dataRow, headerRow, skipIndexes) {
  const metrics = {};
  const usedKeys = new Set();

  for (let col = 0; col < headerRow.length; col += 1) {
    if (skipIndexes.has(col)) continue;

    const keyBase = toMetricKey(headerRow[col]);
    if (!keyBase) continue;

    const value = sanitizeNumber(dataRow[col]);
    if (value === null) continue;

    let key = keyBase;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${keyBase}${suffix}`;
      suffix += 1;
    }

    usedKeys.add(key);
    metrics[key] = value;
  }

  return metrics;
}

const SKIP_STORE_LABELS = new Set(['total', 'store']);

const isTotalRow = (storeName) => {
  const normalized = normalizeStoreName(storeName);
  if (SKIP_STORE_LABELS.has(normalized)) return true;
  return normalized.startsWith('total ');
};

const toMonthNumber = (monthName) => {
  const months = {
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

  return months[normalizeStoreName(monthName)] || null;
};

function parseMonthLabel(value) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, '');
  const match = compact.match(/^([A-Za-z]{3,9})[-/](\d{2}|\d{4})$/);
  if (!match) return null;

  const month = toMonthNumber(match[1]);
  if (!month) return null;
  const yy = Number(match[2]);
  const year = match[2].length === 2 ? 2000 + yy : yy;
  return { year, month };
}

function sanitizeNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = normalizeText(value);
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAnyValue(values) {
  return values.some((value) => value !== null && value !== undefined);
}

function parseWeekRange(weekRange, fallbackYear) {
  const raw = normalizeText(weekRange);
  if (!raw) return null;

  const match = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*to\s*(\d{1,2})\s*\/\s*(\d{1,2})/i);
  if (!match) return null;

  const startDay = Number(match[1]);
  const startMonth = Number(match[2]);
  const endDay = Number(match[3]);
  const endMonth = Number(match[4]);

  if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) return null;
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return null;

  const endYear = Number(fallbackYear);
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;

  const weekStart = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0, 0));
  const weekEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999));

  if (Number.isNaN(weekStart.getTime()) || Number.isNaN(weekEnd.getTime())) return null;

  return {
    weekStart,
    weekEnd,
    year: weekEnd.getUTCFullYear(),
    month: weekEnd.getUTCMonth() + 1,
    weekRangeLabel: `${String(startDay).padStart(2, '0')}/${String(startMonth).padStart(2, '0')} to ${String(endDay).padStart(2, '0')}/${String(endMonth).padStart(2, '0')}`,
  };
}

function resolveSheetName(sheetNames, aliases) {
  const normalizedToRaw = new Map();
  (sheetNames || []).forEach((name) => {
    normalizedToRaw.set(normalizeHeader(name), name);
  });

  for (let i = 0; i < aliases.length; i += 1) {
    const match = normalizedToRaw.get(normalizeHeader(aliases[i]));
    if (match) return match;
  }

  return null;
}

function toUtcDayStart(value) {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toUtcDayEnd(value) {
  const d = new Date(value);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function formatWeekRangeLabel(start, end) {
  const startDay = String(start.getUTCDate()).padStart(2, '0');
  const startMonth = String(start.getUTCMonth() + 1).padStart(2, '0');
  const endDay = String(end.getUTCDate()).padStart(2, '0');
  const endMonth = String(end.getUTCMonth() + 1).padStart(2, '0');
  return `${startDay}/${startMonth} to ${endDay}/${endMonth}`;
}

function countInclusiveUtcDays(start, end) {
  const dayMs = 24 * 60 * 60 * 1000;
  const from = toUtcDayStart(start).getTime();
  const to = toUtcDayStart(end).getTime();
  return Math.floor((to - from) / dayMs) + 1;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function splitMetricsByRatio(metrics, firstRatio) {
  const first = {};
  const second = {};

  Object.entries(metrics || {}).forEach(([key, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      first[key] = value;
      second[key] = value;
      return;
    }

    const firstValue = round2(value * firstRatio);
    const secondValue = round2(value - firstValue);
    first[key] = firstValue;
    second[key] = secondValue;
  });

  return { first, second };
}

function splitWeeklyRecordAcrossMonths(record) {
  if (record.reportType !== 'weekly_financial' || !record.weekStart || !record.weekEnd) {
    return [record];
  }

  const weekStart = toUtcDayStart(record.weekStart);
  const weekEnd = toUtcDayEnd(record.weekEnd);

  if (
    weekStart.getUTCMonth() === weekEnd.getUTCMonth() &&
    weekStart.getUTCFullYear() === weekEnd.getUTCFullYear()
  ) {
    return [
      {
        ...record,
        year: weekEnd.getUTCFullYear(),
        month: weekEnd.getUTCMonth() + 1,
        weekStart,
        weekEnd,
        weekRangeLabel: record.weekRangeLabel || formatWeekRangeLabel(weekStart, weekEnd),
      },
    ];
  }

  const monthEnd = new Date(
    Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );
  const nextMonthStart = new Date(
    Date.UTC(weekEnd.getUTCFullYear(), weekEnd.getUTCMonth(), 1, 0, 0, 0, 0)
  );

  const totalDays = countInclusiveUtcDays(weekStart, weekEnd);
  const firstDays = countInclusiveUtcDays(weekStart, monthEnd);
  const firstRatio = firstDays / totalDays;
  const splitMetrics = splitMetricsByRatio(record.metrics, firstRatio);

  return [
    {
      ...record,
      year: weekStart.getUTCFullYear(),
      month: weekStart.getUTCMonth() + 1,
      weekStart,
      weekEnd: monthEnd,
      weekRangeLabel: formatWeekRangeLabel(weekStart, monthEnd),
      metrics: splitMetrics.first,
    },
    {
      ...record,
      year: weekEnd.getUTCFullYear(),
      month: weekEnd.getUTCMonth() + 1,
      weekStart: nextMonthStart,
      weekEnd,
      weekRangeLabel: formatWeekRangeLabel(nextMonthStart, weekEnd),
      metrics: splitMetrics.second,
    },
  ];
}

function toPeriodKey(reportType, year, month, weekNumber) {
  const monthPart = String(month).padStart(2, '0');
  if (reportType === 'weekly_financial') {
    return `${year}-${monthPart}-W${String(weekNumber || 0).padStart(2, '0')}`;
  }
  return `${year}-${monthPart}`;
}

function extractWeeklyRows(sheetRows, sheetName, defaultYear) {
  const entries = [];

  for (let rowIndex = 0; rowIndex < sheetRows.length; rowIndex += 1) {
    const row = sheetRows[rowIndex] || [];
    const normalized = row.map(normalizeHeader);

    const weekCol = normalized.findIndex(
      (header) => header === 'weekending' || header.includes('weekending')
    );
    const salesCol = normalized.findIndex((header) => header === 'sales');
    const netCol = normalized.findIndex((header) => header === 'net');

    if (weekCol < 0 || salesCol < 0 || netCol < 0) continue;

    const storeCol = normalized.findIndex((header) => header === 'store');
    let localWeekCounter = 1;

    for (let dataIndex = rowIndex + 1; dataIndex < sheetRows.length; dataIndex += 1) {
      const dataRow = sheetRows[dataIndex] || [];
      const weekRangeRaw = normalizeText(dataRow[weekCol]);
      if (!weekRangeRaw) continue;
      if (!weekRangeRaw.toLowerCase().includes('to')) continue;

      const parsedRange = parseWeekRange(weekRangeRaw, defaultYear);
      if (!parsedRange) continue;

      const weekNumberRaw = dataRow[0];
      const parsedWeek = Number(weekNumberRaw);
      const weekNumber =
        Number.isFinite(parsedWeek) && parsedWeek > 0 ? parsedWeek : localWeekCounter;

      const labourCol = normalized.findIndex((header) => header === 'labour');
      const vat18Col = normalized.findIndex((header) => header === 'vat18');
      const royaltiesCol = normalized.findIndex((header) => header === 'royalties');
      const foodCost22Col = normalized.findIndex((header) => header === 'foodcost22');
      const commissionCol = normalized.findIndex(
        (header) => header === 'commision' || header === 'commission'
      );
      const commissionPercentageCol = normalized.findIndex(
        (header) => header === 'commisionpercentage' || header === 'commissionpercentage'
      );
      const totalCol = normalized.findIndex((header) => header === 'total');
      const incomeCol = normalized.findIndex((header) => header === 'income');

      const sales = sanitizeNumber(dataRow[salesCol]);
      const net = sanitizeNumber(dataRow[netCol]);
      const labour = sanitizeNumber(dataRow[labourCol]);
      const vat18 = sanitizeNumber(dataRow[vat18Col]);
      const royalties = sanitizeNumber(dataRow[royaltiesCol]);
      const foodCost22 = sanitizeNumber(dataRow[foodCost22Col]);
      const commission = sanitizeNumber(dataRow[commissionCol]);
      const commissionPercentage = sanitizeNumber(dataRow[commissionPercentageCol]);
      const total = sanitizeNumber(dataRow[totalCol]);
      const income = sanitizeNumber(dataRow[incomeCol]);

      const baseMetrics = {
        sales,
        net,
        labour,
        vat18,
        royalties,
        foodCost22,
        commission,
        commissionPercentage,
        total,
        income,
      };

      const usedColumnIndexes = new Set([
        0,
        storeCol,
        weekCol,
        salesCol,
        netCol,
        labourCol,
        vat18Col,
        royaltiesCol,
        foodCost22Col,
        commissionCol,
        commissionPercentageCol,
        totalCol,
        incomeCol,
      ]);

      const extraMetrics = collectAdditionalNumericMetrics(
        dataRow,
        row,
        usedColumnIndexes,
        Object.keys(baseMetrics)
      );

      if (
        !hasAnyValue([
          sales,
          net,
          labour,
          vat18,
          royalties,
          foodCost22,
          commission,
          commissionPercentage,
          total,
          income,
        ])
      ) {
        continue;
      }

      entries.push({
        reportType: 'weekly_financial',
        storeName: normalizeText(dataRow[storeCol]) || sheetName,
        year: parsedRange.year,
        month: parsedRange.month,
        weekNumber,
        weekStart: parsedRange.weekStart,
        weekEnd: parsedRange.weekEnd,
        weekRangeLabel: parsedRange.weekRangeLabel,
        metrics: { ...baseMetrics, ...extraMetrics },
      });

      localWeekCounter += 1;
    }
  }

  return entries;
}

function extractMonthlyRows(sheetRows, defaultYear) {
  const entries = [];

  for (let rowIndex = 0; rowIndex < sheetRows.length; rowIndex += 1) {
    const row = sheetRows[rowIndex] || [];
    const normalized = row.map(normalizeHeader);

    const storeCol = normalized.findIndex((header) => header === 'store');
    const grossSaleCol = normalized.findIndex((header) => header === 'grosssale');
    const netSaleCol = normalized.findIndex((header) => header === 'netsale');

    if (storeCol < 0 || grossSaleCol < 0 || netSaleCol < 0) continue;

    let activeMonth = null;

    for (let dataIndex = rowIndex + 1; dataIndex < sheetRows.length; dataIndex += 1) {
      const dataRow = sheetRows[dataIndex] || [];
      const cellA = normalizeText(dataRow[0]);
      const possibleMonth = parseMonthLabel(cellA);
      if (possibleMonth) {
        activeMonth = possibleMonth;
      }

      const storeName = normalizeText(dataRow[storeCol]);
      if (!storeName || isTotalRow(storeName)) continue;

      if (!activeMonth) {
        activeMonth = { year: Number(defaultYear), month: 1 };
      }

      const vatCol = normalized.findIndex((header) => header === 'vat');
      const vatPercentCol = normalized.findIndex((header) => header === 'vatpercent');
      const customerCountCol = normalized.findIndex((header) => header === 'customercount');
      const bidfoodCol = normalized.findIndex((header) => header === 'bidfood');
      const bidfoodPercentCol = normalized.findIndex((header) => header === 'bidfoodpercent');
      const labourHourCol = normalized.findIndex((header) => header === 'labourhour');
      const labourCostCol = normalized.findIndex((header) => header === 'labourcost');
      const labourPercentCol = normalized.findIndex((header) => header === 'labourpercent');
      const kioskPercentCol = normalized.findIndex((header) => header === 'kioskpercent');
      const totalCogsCol = normalized.findIndex((header) => header === 'totalcogs');
      const revScoreQ1Col = normalized.findIndex((header) => header === 'revscoreq1');

      const grossSale = sanitizeNumber(dataRow[grossSaleCol]);
      const netSale = sanitizeNumber(dataRow[netSaleCol]);
      const vat = sanitizeNumber(dataRow[vatCol]);
      const vatPercent = sanitizeNumber(dataRow[vatPercentCol]);
      const customerCount = sanitizeNumber(dataRow[customerCountCol]);
      const bidfood = sanitizeNumber(dataRow[bidfoodCol]);
      const bidfoodPercent = sanitizeNumber(dataRow[bidfoodPercentCol]);
      const labourHour = sanitizeNumber(dataRow[labourHourCol]);
      const labourCost = sanitizeNumber(dataRow[labourCostCol]);
      const labourPercent = sanitizeNumber(dataRow[labourPercentCol]);
      const kioskPercent = sanitizeNumber(dataRow[kioskPercentCol]);
      const totalCogs = sanitizeNumber(dataRow[totalCogsCol]);
      const revScoreQ1 = sanitizeNumber(dataRow[revScoreQ1Col]);

      const baseMetrics = {
        grossSale,
        netSale,
        vat,
        vatPercent,
        customerCount,
        bidfood,
        bidfoodPercent,
        labourHour,
        labourCost,
        labourPercent,
        kioskPercent,
        totalCogs,
        revScoreQ1,
      };

      const usedColumnIndexes = new Set([
        0,
        storeCol,
        grossSaleCol,
        netSaleCol,
        vatCol,
        vatPercentCol,
        customerCountCol,
        bidfoodCol,
        bidfoodPercentCol,
        labourHourCol,
        labourCostCol,
        labourPercentCol,
        kioskPercentCol,
        totalCogsCol,
        revScoreQ1Col,
      ]);

      const extraMetrics = collectAdditionalNumericMetrics(
        dataRow,
        row,
        usedColumnIndexes,
        Object.keys(baseMetrics)
      );

      if (
        !hasAnyValue([
          grossSale,
          netSale,
          vat,
          vatPercent,
          customerCount,
          bidfood,
          bidfoodPercent,
          labourHour,
          labourCost,
          labourPercent,
          kioskPercent,
          totalCogs,
          revScoreQ1,
        ])
      ) {
        continue;
      }

      entries.push({
        reportType: 'monthly_store_kpi',
        storeName,
        year: activeMonth.year,
        month: activeMonth.month,
        weekNumber: null,
        weekStart: null,
        weekEnd: null,
        weekRangeLabel: null,
        metrics: { ...baseMetrics, ...extraMetrics },
      });
    }
  }

  return entries;
}

async function buildShopLookup() {
  const shops = await Shop.find({}).select('_id name aliases');
  const byId = new Map();
  const byName = new Map();

  shops.forEach((shop) => {
    byId.set(shop._id.toString(), shop);
    byName.set(normalizeStoreName(shop.name), shop);
    (shop.aliases || []).forEach((alias) => {
      const key = normalizeStoreName(alias);
      if (key && !byName.has(key)) {
        byName.set(key, shop);
      }
    });
  });

  return { byId, byName };
}

async function getOrCreateShop(storeName, shopLookup) {
  const key = normalizeStoreName(storeName);
  if (!key) return null;

  const existing = shopLookup.byName.get(key);
  if (existing) return existing;

  const newShop = await Shop.create({
    name: storeName,
    aliases: [storeName],
    latitude: 0,
    longitude: 0,
  });

  shopLookup.byId.set(newShop._id.toString(), newShop);
  shopLookup.byName.set(key, newShop);

  return newShop;
}

function normalizeForPersistence(record) {
  return splitWeeklyRecordAcrossMonths(record).map((part) => ({
    ...part,
    periodKey: toPeriodKey(part.reportType, part.year, part.month, part.weekNumber),
  }));
}

function mergeRecords(excelRows, adminRows) {
  const merged = new Map();

  excelRows.forEach((row) => {
    const key = `${row.shop_id._id.toString()}::${row.report_type}::${row.period_key}`;
    merged.set(key, row);
  });

  adminRows.forEach((row) => {
    const key = `${row.shop_id._id.toString()}::${row.report_type}::${row.period_key}`;
    merged.set(key, row);
  });

  return Array.from(merged.values());
}

function toTableRow(record) {
  if (record.report_type === 'weekly_financial') {
    return {
      id: record._id,
      shopId: record.shop_id?._id || record.shop_id,
      shopName: record.shop_id?.name || record.store_name_raw,
      year: record.year,
      month: record.month,
      weekNumber: record.week_number,
      weekRange: record.week_range_label,
      sales: record.metrics.sales ?? 0,
      net: record.metrics.net ?? 0,
      labour: record.metrics.labour ?? 0,
      vat18: record.metrics.vat18 ?? 0,
      royalties: record.metrics.royalties ?? 0,
      foodCost22: record.metrics.foodCost22 ?? 0,
      commission: record.metrics.commission ?? 0,
      commissionPercentage: record.metrics.commissionPercentage ?? 0,
      total: record.metrics.total ?? 0,
      income: record.metrics.income ?? 0,
      metrics: record.metrics || {},
      sourceType: record.source_type,
    };
  }

  return {
    id: record._id,
    shopId: record.shop_id?._id || record.shop_id,
    shopName: record.shop_id?.name || record.store_name_raw,
    year: record.year,
    month: record.month,
    grossSale: record.metrics.grossSale ?? 0,
    netSale: record.metrics.netSale ?? 0,
    vat: record.metrics.vat ?? 0,
    vatPercent: record.metrics.vatPercent ?? 0,
    customerCount: record.metrics.customerCount ?? 0,
    bidfood: record.metrics.bidfood ?? 0,
    bidfoodPercent: record.metrics.bidfoodPercent ?? 0,
    labourHour: record.metrics.labourHour ?? 0,
    labourCost: record.metrics.labourCost ?? 0,
    labourPercent: record.metrics.labourPercent ?? 0,
    kioskPercent: record.metrics.kioskPercent ?? 0,
    totalCogs: record.metrics.totalCogs ?? 0,
    revScoreQ1: record.metrics.revScoreQ1 ?? 0,
    metrics: record.metrics || {},
    sourceType: record.source_type,
  };
}

function buildTotals(rows, reportType) {
  const totals = { shopName: 'Total' };
  const numericFields =
    reportType === 'weekly_financial' ? WEEKLY_NUMERIC_FIELDS : MONTHLY_NUMERIC_FIELDS;

  numericFields.forEach((field) => {
    totals[field] = rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  });

  return totals;
}

function applyShopReadFilter(baseFilter, req, shopScope) {
  const queryShopId = req.query.shop_id;

  if (queryShopId) {
    if (!shopScope.all && !isShopAllowed(shopScope, queryShopId)) {
      return { ...baseFilter, shop_id: { $in: [] } };
    }
    return { ...baseFilter, shop_id: queryShopId };
  }

  if (!shopScope.all) {
    if (shopScope.ids.length === 0) {
      return { ...baseFilter, shop_id: { $in: [] } };
    }
    return { ...baseFilter, shop_id: { $in: shopScope.ids } };
  }

  return baseFilter;
}

async function bulkUpsertRecords(records, sourceType, actorId, sourceFile) {
  if (records.length === 0) {
    return { upserted: 0, modified: 0, matched: 0 };
  }

  const ops = records.map((record) => ({
    updateOne: {
      filter: {
        shop_id: record.shop_id,
        report_type: record.reportType,
        source_type: sourceType,
        period_key: record.periodKey,
      },
      update: {
        $set: {
          year: record.year,
          month: record.month,
          week_number: record.weekNumber || null,
          week_start: record.weekStart || null,
          week_end: record.weekEnd || null,
          week_range_label: record.weekRangeLabel || null,
          store_name_raw: record.storeName || null,
          metrics: record.metrics || {},
          source_file: sourceFile || null,
          updated_by: actorId || null,
        },
        $setOnInsert: {
          imported_by: actorId || null,
        },
      },
      upsert: true,
    },
  }));

  const result = await StoreReportEntry.bulkWrite(ops, { ordered: false });
  return {
    upserted: result.upsertedCount || 0,
    modified: result.modifiedCount || 0,
    matched: result.matchedCount || 0,
  };
}

async function bulkUpsertWeekly2026BRecords(records, actorId, sourceFile, sourceSheet) {
  if (records.length === 0) {
    return { upserted: 0, modified: 0, matched: 0 };
  }

  const ops = records.map((record) => ({
    updateOne: {
      filter: {
        source_sheet: sourceSheet,
        period_key: record.periodKey,
        store_key: record.storeKey,
      },
      update: {
        $set: {
          shop_id: record.shop_id || null,
          store_name_raw: record.storeName,
          store_key: record.storeKey,
          source_sheet: sourceSheet,
          period_key: record.periodKey,
          year: record.year,
          month: record.month,
          week_number: record.weekNumber,
          week_start: record.weekStart || null,
          week_end: record.weekEnd || null,
          week_range_label: record.weekRangeLabel || null,
          metrics: record.metrics || {},
          source_file: sourceFile || null,
          updated_by: actorId || null,
        },
        $setOnInsert: {
          imported_by: actorId || null,
        },
      },
      upsert: true,
    },
  }));

  const result = await StoreReportWeekly2026B.bulkWrite(ops, { ordered: false });
  return {
    upserted: result.upsertedCount || 0,
    modified: result.modifiedCount || 0,
    matched: result.matchedCount || 0,
  };
}

async function bulkUpsertMonthlySale2026Records(records, actorId, sourceFile, sourceSheet) {
  if (records.length === 0) {
    return { upserted: 0, modified: 0, matched: 0 };
  }

  const ops = records.map((record) => ({
    updateOne: {
      filter: {
        source_sheet: sourceSheet,
        period_key: record.periodKey,
        store_key: record.storeKey,
      },
      update: {
        $set: {
          shop_id: record.shop_id || null,
          store_name_raw: record.storeName,
          store_key: record.storeKey,
          source_sheet: sourceSheet,
          period_key: record.periodKey,
          year: record.year,
          month: record.month,
          metrics: record.metrics || {},
          source_file: sourceFile || null,
          updated_by: actorId || null,
        },
        $setOnInsert: {
          imported_by: actorId || null,
        },
      },
      upsert: true,
    },
  }));

  const result = await StoreReportMonthlySale2026.bulkWrite(ops, { ordered: false });
  return {
    upserted: result.upsertedCount || 0,
    modified: result.modifiedCount || 0,
    matched: result.matchedCount || 0,
  };
}

function extractWeekly2026BRows(sheetRows, fallbackStoreName, defaultYear) {
  const entries = [];

  for (let rowIndex = 0; rowIndex < sheetRows.length; rowIndex += 1) {
    const headerRow = sheetRows[rowIndex] || [];
    const normalized = headerRow.map(normalizeHeader);

    const weekCol = normalized.findIndex(
      (header) => header === 'weekending' || header.includes('weekending')
    );
    const storeCol = normalized.findIndex((header) => header === 'store');

    if (weekCol < 0) continue;

    let localWeekCounter = 1;

    for (let dataIndex = rowIndex + 1; dataIndex < sheetRows.length; dataIndex += 1) {
      const dataRow = sheetRows[dataIndex] || [];
      const weekRangeRaw = normalizeText(dataRow[weekCol]);
      if (!weekRangeRaw || !weekRangeRaw.toLowerCase().includes('to')) continue;

      const parsedRange = parseWeekRange(weekRangeRaw, defaultYear);
      if (!parsedRange) continue;

      const weekFromSheet = Number(dataRow[0]);
      const weekNumber =
        Number.isFinite(weekFromSheet) && weekFromSheet > 0 ? weekFromSheet : localWeekCounter;

      const storeName =
        normalizeText(storeCol >= 0 ? dataRow[storeCol] : '') || fallbackStoreName || 'Unknown';

      const skipIndexes = new Set([0, weekCol]);
      if (storeCol >= 0) skipIndexes.add(storeCol);
      const metrics = collectDynamicNumericMetrics(dataRow, headerRow, skipIndexes);
      if (!hasAnyValue(Object.values(metrics))) continue;

      entries.push({
        storeName,
        storeKey: normalizeStoreName(storeName) || 'unknown',
        year: parsedRange.year,
        month: parsedRange.month,
        weekNumber,
        weekStart: parsedRange.weekStart,
        weekEnd: parsedRange.weekEnd,
        weekRangeLabel: parsedRange.weekRangeLabel,
        periodKey: toPeriodKey('weekly_financial', parsedRange.year, parsedRange.month, weekNumber),
        metrics,
      });

      localWeekCounter += 1;
    }
  }

  return entries;
}

function extractMonthlySale2026Rows(sheetRows, defaultYear) {
  const entries = [];

  for (let rowIndex = 0; rowIndex < sheetRows.length; rowIndex += 1) {
    const headerRow = sheetRows[rowIndex] || [];
    const normalized = headerRow.map(normalizeHeader);

    const storeCol = normalized.findIndex((header) => header === 'store');
    const grossSaleCol = normalized.findIndex((header) => header === 'grosssale');
    const netSaleCol = normalized.findIndex((header) => header === 'netsale');

    if (storeCol < 0 || grossSaleCol < 0 || netSaleCol < 0) continue;

    let activeMonth = null;

    for (let dataIndex = rowIndex + 1; dataIndex < sheetRows.length; dataIndex += 1) {
      const dataRow = sheetRows[dataIndex] || [];
      const monthCell = parseMonthLabel(dataRow[0]);
      if (monthCell) {
        activeMonth = monthCell;
      }

      const storeName = normalizeText(dataRow[storeCol]);
      if (!storeName || isTotalRow(storeName)) continue;

      if (!activeMonth) {
        activeMonth = { year: Number(defaultYear), month: 1 };
      }

      const metrics = collectDynamicNumericMetrics(dataRow, headerRow, new Set([0, storeCol]));
      if (!hasAnyValue(Object.values(metrics))) continue;

      entries.push({
        storeName,
        storeKey: normalizeStoreName(storeName) || 'unknown',
        year: activeMonth.year,
        month: activeMonth.month,
        periodKey: `${activeMonth.year}-${String(activeMonth.month).padStart(2, '0')}`,
        metrics,
      });
    }
  }

  return entries;
}

function parsePaginationQuery(query) {
  return parsePagination(query, {
    defaultLimit: 20,
    maxLimit: 200,
  });
}

function parseIncludeWeeklyTotals(query) {
  if (query.include_weekly_totals === undefined) return false;
  const value = String(query.include_weekly_totals).toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function parsePaginationBasis(query) {
  const basis = String(query.pagination_basis || 'row').toLowerCase();
  if (!['row', 'week_number'].includes(basis)) {
    throw new AppError('pagination_basis must be one of row, week_number', 400);
  }
  return basis;
}

function parseGroupBy(query) {
  const groupBy = String(query.group_by || 'none').toLowerCase();
  if (!['none', 'month'].includes(groupBy)) {
    throw new AppError('group_by must be one of none, month', 400);
  }
  return groupBy;
}

function buildWeeklyTotals(rows, reportType) {
  if (reportType !== 'weekly_financial') return [];

  const grouped = new Map();

  rows.forEach((row) => {
    const weekNumber = row.weekNumber || 0;
    const key = `${row.year}-${String(row.month).padStart(2, '0')}-W${String(weekNumber).padStart(2, '0')}`;

    if (!grouped.has(key)) {
      const initial = {
        periodKey: key,
        year: row.year,
        month: row.month,
        weekNumber,
        weekRange: row.weekRange || null,
        shopCount: 0,
      };
      WEEKLY_NUMERIC_FIELDS.forEach((field) => {
        initial[field] = 0;
      });
      grouped.set(key, initial);
    }

    const bucket = grouped.get(key);
    bucket.shopCount += 1;
    if (!bucket.weekRange && row.weekRange) bucket.weekRange = row.weekRange;
    WEEKLY_NUMERIC_FIELDS.forEach((field) => {
      bucket[field] = round2(bucket[field] + (Number(row[field]) || 0));
    });
  });

  return Array.from(grouped.values()).sort((a, b) => {
    const yearDiff = (a.year || 0) - (b.year || 0);
    if (yearDiff !== 0) return yearDiff;
    const monthDiff = (a.month || 0) - (b.month || 0);
    if (monthDiff !== 0) return monthDiff;
    return (a.weekNumber || 0) - (b.weekNumber || 0);
  });
}

function deriveMonthlyRowsFromWeekly(rows) {
  const pickMetric = (metrics, aliases) => {
    if (!metrics || typeof metrics !== 'object') return null;

    const lookup = new Map();
    Object.entries(metrics).forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        lookup.set(normalizeMetricAlias(key), value);
      }
    });

    for (let i = 0; i < aliases.length; i += 1) {
      const found = lookup.get(normalizeMetricAlias(aliases[i]));
      if (typeof found === 'number') return found;
    }

    return null;
  };

  const grouped = new Map();

  rows.forEach((row) => {
    const key = `${row.shopId}::${row.year}-${String(row.month || 0).padStart(2, '0')}`;

    if (!grouped.has(key)) {
      const seed = {
        id: `derived-${key}`,
        shopId: row.shopId,
        shopName: row.shopName,
        year: row.year,
        month: row.month,
        weekNumber: null,
        weekRange: null,
        sourceType: 'derived_monthly_from_weekly',
        metrics: {},
      };
      WEEKLY_NUMERIC_FIELDS.forEach((field) => {
        seed[field] = 0;
        seed.metrics[field] = 0;
      });
      seed._derived = {
        total3pdSale: 0,
      };
      grouped.set(key, seed);
    }

    const bucket = grouped.get(key);
    WEEKLY_NUMERIC_FIELDS.forEach((field) => {
      bucket[field] = round2(bucket[field] + (Number(row[field]) || 0));
      bucket.metrics[field] = bucket[field];
    });

    Object.entries(row.metrics || {}).forEach(([metricKey, metricValue]) => {
      if (typeof metricValue !== 'number' || !Number.isFinite(metricValue)) return;
      const prev = Number(bucket.metrics[metricKey]) || 0;
      bucket.metrics[metricKey] = round2(prev + metricValue);
    });

    const total3pdSale = pickMetric(row.metrics, ['Total 3PD Sale', 'total3pdSale', '3pd sale']);
    if (typeof total3pdSale === 'number') {
      bucket._derived.total3pdSale = round2(bucket._derived.total3pdSale + total3pdSale);
    }
  });

  return Array.from(grouped.values())
    .map((row) => {
      const computedTotal = round2(
        (Number(row.labour) || 0) +
          (Number(row.vat18) || 0) +
          (Number(row.royalties) || 0) +
          (Number(row.foodCost22) || 0) +
          (Number(row.commission) || 0)
      );
      row.total = computedTotal;
      row.income = round2((Number(row.net) || 0) - computedTotal);

      if (row._derived.total3pdSale > 0) {
        row.commissionPercentage = round2(
          (Number(row.commission) || 0) / row._derived.total3pdSale
        );
      }

      WEEKLY_NUMERIC_FIELDS.forEach((field) => {
        row.metrics[field] = row[field];
      });

      delete row._derived;
      return row;
    })
    .sort((a, b) => {
      const yearDiff = (a.year || 0) - (b.year || 0);
      if (yearDiff !== 0) return yearDiff;
      const monthDiff = (a.month || 0) - (b.month || 0);
      if (monthDiff !== 0) return monthDiff;
      return String(a.shopName || '').localeCompare(String(b.shopName || ''));
    });
}

function toDatasetPayloadWithPagination(records, reportType, pagination, options = {}) {
  let rows = records.map(toTableRow).sort((a, b) => {
    const yearDiff = (a.year || 0) - (b.year || 0);
    if (yearDiff !== 0) return yearDiff;
    const monthDiff = (a.month || 0) - (b.month || 0);
    if (monthDiff !== 0) return monthDiff;
    const weekDiff = (a.weekNumber || 0) - (b.weekNumber || 0);
    if (weekDiff !== 0) return weekDiff;
    return String(a.shopName || '').localeCompare(String(b.shopName || ''));
  });

  if (options.groupBy === 'month' && reportType === 'weekly_financial') {
    rows = deriveMonthlyRowsFromWeekly(rows);
  }

  const paginationBasis = options.paginationBasis || 'row';

  if (paginationBasis === 'week_number') {
    const groups = new Map();

    rows.forEach((row) => {
      const weekNumber = row.weekNumber || 0;
      const key = `${row.year}-${String(row.month || 0).padStart(2, '0')}-W${String(weekNumber).padStart(2, '0')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    const groupedRows = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const totalWeeks = groupedRows.length;
    const totalPages = Math.max(1, Math.ceil(totalWeeks / pagination.limit));
    const safePage = Math.min(pagination.page, totalPages);
    const weekOffset = (safePage - 1) * pagination.limit;
    const selectedGroups = groupedRows.slice(weekOffset, weekOffset + pagination.limit);
    const pagedRows = selectedGroups.flatMap(([, weekRows]) => weekRows);
    const pageMeta = toPageMeta(totalWeeks, safePage, pagination.limit, selectedGroups.length);

    const payload = {
      rows: pagedRows,
      totals: buildTotals(rows, reportType),
      count: rows.length,
      pagination: {
        enabled: true,
        basis: 'week_number',
        ...pageMeta,
        page_count: pageMeta.total_pages,
        has_next: pageMeta.page < pageMeta.total_pages,
        has_prev: pageMeta.page > 1,
        total_weeks: totalWeeks,
        rows_in_page: pagedRows.length,
      },
    };

    if (options.includeWeeklyTotals) {
      payload.weekly_totals = buildWeeklyTotals(rows, reportType);
    }

    return payload;
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit));
  const safePage = Math.min(pagination.page, totalPages);
  const offset = (safePage - 1) * pagination.limit;
  const pagedRows = rows.slice(offset, offset + pagination.limit);
  const pageMeta = toPageMeta(total, safePage, pagination.limit, pagedRows.length);

  const payload = {
    rows: pagedRows,
    totals: buildTotals(rows, reportType),
    count: total,
    pagination: {
      enabled: true,
      basis: 'row',
      ...pageMeta,
      page_count: pageMeta.total_pages,
      has_next: pageMeta.page < pageMeta.total_pages,
      has_prev: pageMeta.page > 1,
    },
  };

  if (options.includeWeeklyTotals) {
    payload.weekly_totals = buildWeeklyTotals(rows, reportType);
  }

  return payload;
}

function normalizeMetricAlias(key) {
  return normalizeText(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function readMetric(metrics, aliases, fallback = 0) {
  if (!metrics || typeof metrics !== 'object') return fallback;

  const numericLookup = new Map();
  Object.entries(metrics).forEach(([key, value]) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      numericLookup.set(normalizeMetricAlias(key), value);
    }
  });

  for (let i = 0; i < aliases.length; i += 1) {
    const value = numericLookup.get(normalizeMetricAlias(aliases[i]));
    if (typeof value === 'number') return value;
  }

  return fallback;
}

function metricsForRecord(record) {
  const metrics = record.metrics || {};

  const revenue = readMetric(metrics, [
    'sales',
    'gross sales',
    'grossSale',
    'gross_sale',
    'revenue',
    'net sales',
    'netSale',
  ]);

  const profit = readMetric(metrics, ['income', 'profit', 'net profit', 'net']);
  const orders = readMetric(metrics, ['customer count', 'orders', 'order count']);
  const aovFromMetric = readMetric(metrics, ['average order value', 'aov']);

  const justeat = readMetric(metrics, ['justeat sale', 'just eat sale', 'justeat']);
  const ubereat = readMetric(metrics, ['ubereat sale', 'uber eat sale', 'ubereat']);
  const deliveroo = readMetric(metrics, ['deliveroo sale', 'deliveroo']);
  const thirdPartyTotal = readMetric(
    metrics,
    ['total 3pd sale', '3pd sale'],
    justeat + ubereat + deliveroo
  );
  const inStore = round2(Math.max(revenue - thirdPartyTotal, 0));

  return {
    revenue,
    profit,
    orders,
    aov: orders > 0 ? revenue / orders : aovFromMetric,
    channels: {
      justeat,
      ubereat,
      deliveroo,
      thirdParty: thirdPartyTotal,
      instore: inStore,
    },
  };
}

function summarizeKpis(records) {
  const totals = records.reduce(
    (acc, record) => {
      const rowMetrics = metricsForRecord(record);
      acc.revenue += rowMetrics.revenue;
      acc.profit += rowMetrics.profit;
      acc.orders += rowMetrics.orders;
      acc.channels.justeat += rowMetrics.channels.justeat;
      acc.channels.ubereat += rowMetrics.channels.ubereat;
      acc.channels.deliveroo += rowMetrics.channels.deliveroo;
      acc.channels.thirdParty += rowMetrics.channels.thirdParty;
      acc.channels.instore += rowMetrics.channels.instore;
      return acc;
    },
    {
      revenue: 0,
      profit: 0,
      orders: 0,
      channels: {
        justeat: 0,
        ubereat: 0,
        deliveroo: 0,
        thirdParty: 0,
        instore: 0,
      },
    }
  );

  return {
    revenue: round2(totals.revenue),
    profit: round2(totals.profit),
    orders: round2(totals.orders),
    averageOrderValue: totals.orders > 0 ? round2(totals.revenue / totals.orders) : 0,
    channels: {
      justeat: round2(totals.channels.justeat),
      ubereat: round2(totals.channels.ubereat),
      deliveroo: round2(totals.channels.deliveroo),
      thirdParty: round2(totals.channels.thirdParty),
      instore: round2(totals.channels.instore),
    },
  };
}

function parseChannelSelection(query) {
  const raw = normalizeText(query.channels);
  if (!raw) return [...CHANNEL_KEYS];

  const selected = [];
  raw
    .split(',')
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .forEach((token) => {
      const canonical = CHANNEL_ALIASES[token] || CHANNEL_ALIASES[normalizeMetricAlias(token)];
      if (!canonical || !CHANNEL_KEYS.includes(canonical)) {
        throw new AppError(
          'channels must contain only justeat, ubereat, deliveroo, thirdParty, instore/offline',
          400
        );
      }
      if (!selected.includes(canonical)) selected.push(canonical);
    });

  return selected.length > 0 ? selected : [...CHANNEL_KEYS];
}

function pickChannels(kpis, channels) {
  const source = kpis?.channels || {};
  return channels.reduce((acc, key) => {
    acc[key] = round2(Number(source[key]) || 0);
    return acc;
  }, {});
}

function buildChannelComparisonPayload(currentRows, previousRows, channels) {
  const currentChannels = pickChannels(summarizeKpis(currentRows), channels);
  const previousChannels = pickChannels(summarizeKpis(previousRows), channels);

  return channels.reduce((acc, channel) => {
    acc[channel] = computeDelta(currentChannels[channel], previousChannels[channel]);
    return acc;
  }, {});
}

function computeDelta(current, previous) {
  const change = round2(current - previous);
  const changePct = previous === 0 ? null : round2((change / previous) * 100);
  return { current: round2(current), previous: round2(previous), change, changePct };
}

function parseDate(value, fieldName) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 400);
  }
  return date;
}

function parseExplicitComparisonWindow(query, prefix) {
  const fromKey = `${prefix}_from`;
  const toKey = `${prefix}_to`;
  const fromRaw = query[fromKey];
  const toRaw = query[toKey];

  if ((fromRaw && !toRaw) || (!fromRaw && toRaw)) {
    throw new AppError(`${fromKey} and ${toKey} must be provided together`, 400);
  }

  if (!fromRaw && !toRaw) {
    return null;
  }

  const from = toUtcDayStart(parseDate(fromRaw, fromKey));
  const to = toUtcDayEnd(parseDate(toRaw, toKey));
  if (from > to) {
    throw new AppError(`${fromKey} must be before ${toKey}`, 400);
  }

  return { from, to };
}

function toWindowMeta(window, mode) {
  if (!window) return null;
  return {
    from: window.from,
    to: window.to,
    mode,
  };
}

function resolveComparisonWindows(query, currentWindow, compare) {
  const explicitWowWindow = parseExplicitComparisonWindow(query, 'wow');
  const explicitYoyWindow = parseExplicitComparisonWindow(query, 'yoy');

  const wowWindow =
    compare === 'yoy' ? null : explicitWowWindow || shiftWindow(currentWindow, 'wow');

  const yoyWindow =
    compare === 'wow' ? null : explicitYoyWindow || shiftWindow(currentWindow, 'yoy');

  return {
    wowWindow,
    yoyWindow,
    comparisonWindows: {
      current: toWindowMeta(currentWindow, 'current'),
      wow: toWindowMeta(wowWindow, explicitWowWindow ? 'custom' : 'derived'),
      yoy: toWindowMeta(yoyWindow, explicitYoyWindow ? 'custom' : 'derived'),
    },
  };
}

function deriveDateWindow(req, rows) {
  const fromInput = parseDate(req.query.from, 'from');
  const toInput = parseDate(req.query.to, 'to');

  if (fromInput && toInput) {
    const from = toUtcDayStart(fromInput);
    const to = toUtcDayEnd(toInput);
    if (from > to) throw new AppError('from must be before to', 400);
    return { from, to };
  }

  const datedRows = rows.filter((row) => row.week_start && row.week_end);
  if (datedRows.length === 0) return null;

  const minStart = datedRows.reduce(
    (min, row) => (row.week_start < min ? row.week_start : min),
    datedRows[0].week_start
  );
  const maxEnd = datedRows.reduce(
    (max, row) => (row.week_end > max ? row.week_end : max),
    datedRows[0].week_end
  );

  return { from: toUtcDayStart(minStart), to: toUtcDayEnd(maxEnd) };
}

function shiftWindow(window, mode) {
  if (!window) return null;

  if (mode === 'yoy') {
    return {
      from: new Date(
        Date.UTC(
          window.from.getUTCFullYear() - 1,
          window.from.getUTCMonth(),
          window.from.getUTCDate(),
          0,
          0,
          0,
          0
        )
      ),
      to: new Date(
        Date.UTC(
          window.to.getUTCFullYear() - 1,
          window.to.getUTCMonth(),
          window.to.getUTCDate(),
          23,
          59,
          59,
          999
        )
      ),
    };
  }

  const spanMs = window.to.getTime() - window.from.getTime() + 1;
  return {
    from: new Date(window.from.getTime() - spanMs),
    to: new Date(window.to.getTime() - spanMs),
  };
}

function isWithinWindow(record, window) {
  if (!window) return true;
  if (!record.week_start || !record.week_end) return false;
  return record.week_start >= window.from && record.week_end <= window.to;
}

function buildTrend(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = row.period_key;
    if (!grouped.has(key)) {
      grouped.set(key, {
        periodKey: key,
        year: row.year,
        month: row.month,
        weekNumber: row.week_number,
        label:
          row.week_range_label ||
          (row.week_number
            ? `W${String(row.week_number).padStart(2, '0')} ${String(row.month).padStart(2, '0')}/${row.year}`
            : `${String(row.month).padStart(2, '0')}/${row.year}`),
        revenue: 0,
      });
    }

    const bucket = grouped.get(key);
    bucket.revenue += metricsForRecord(row).revenue;
  });

  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      revenue: round2(entry.revenue),
    }))
    .sort((a, b) => {
      const yearDiff = (a.year || 0) - (b.year || 0);
      if (yearDiff !== 0) return yearDiff;
      const monthDiff = (a.month || 0) - (b.month || 0);
      if (monthDiff !== 0) return monthDiff;
      return (a.weekNumber || 0) - (b.weekNumber || 0);
    });
}

function buildStoreBreakdown(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = String(row.shop_id?._id || row.shop_id);
    if (!grouped.has(key)) {
      grouped.set(key, {
        shopId: key,
        shopName: row.shop_id?.name || row.store_name_raw || key,
        revenue: 0,
      });
    }

    grouped.get(key).revenue += metricsForRecord(row).revenue;
  });

  return Array.from(grouped.values())
    .map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
}

function buildComparisonPayload(currentRows, previousRows) {
  const current = summarizeKpis(currentRows);
  const previous = summarizeKpis(previousRows);

  return {
    revenue: computeDelta(current.revenue, previous.revenue),
    profit: computeDelta(current.profit, previous.profit),
    orders: computeDelta(current.orders, previous.orders),
    averageOrderValue: computeDelta(current.averageOrderValue, previous.averageOrderValue),
  };
}

function parseAnalyticsMetric(query) {
  const metric = String(query.metric || 'revenue').toLowerCase();
  if (!['revenue', 'profit', 'orders', 'averageOrderValue'].includes(metric)) {
    throw new AppError('metric must be one of revenue, profit, orders, averageOrderValue', 400);
  }
  return metric;
}

function parseTrendGranularity(query) {
  const granularity = String(query.granularity || 'week').toLowerCase();
  if (!['week', 'month'].includes(granularity)) {
    throw new AppError('granularity must be one of week, month', 400);
  }
  return granularity;
}

function parseSortDirection(query) {
  const sort = String(query.sort || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(sort)) {
    throw new AppError('sort must be one of asc, desc', 400);
  }
  return sort;
}

function parsePositiveInt(queryValue, fallback, fieldName, maxValue = 200) {
  const raw = Number(queryValue ?? fallback);
  if (!Number.isInteger(raw) || raw < 1) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return Math.min(raw, maxValue);
}

function toMetricValue(summary, metric) {
  if (metric === 'revenue') return round2(summary.revenue || 0);
  if (metric === 'profit') return round2(summary.profit || 0);
  if (metric === 'orders') return round2(summary.orders || 0);
  return round2(summary.averageOrderValue || 0);
}

function buildSeriesFromRows(rows, metric, granularity) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key =
      granularity === 'month'
        ? `${row.year}-${String(row.month || 0).padStart(2, '0')}`
        : row.period_key ||
          `${row.year}-${String(row.month || 0).padStart(2, '0')}-W${String(
            row.week_number || 0
          ).padStart(2, '0')}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        periodKey: key,
        year: row.year,
        month: row.month,
        weekNumber: granularity === 'week' ? row.week_number : null,
        label:
          granularity === 'month'
            ? `${String(row.month || 0).padStart(2, '0')}/${row.year}`
            : row.week_range_label ||
              `W${String(row.week_number || 0).padStart(2, '0')} ${String(row.month || 0).padStart(
                2,
                '0'
              )}/${row.year}`,
        rows: [],
      });
    }

    grouped.get(key).rows.push(row);
  });

  return Array.from(grouped.values())
    .map((bucket) => {
      const summary = summarizeKpis(bucket.rows);
      return {
        periodKey: bucket.periodKey,
        year: bucket.year,
        month: bucket.month,
        weekNumber: bucket.weekNumber,
        label: bucket.label,
        value: toMetricValue(summary, metric),
      };
    })
    .sort((a, b) => {
      const yearDiff = (a.year || 0) - (b.year || 0);
      if (yearDiff !== 0) return yearDiff;
      const monthDiff = (a.month || 0) - (b.month || 0);
      if (monthDiff !== 0) return monthDiff;
      return (a.weekNumber || 0) - (b.weekNumber || 0);
    });
}

async function getAnalyticsContext(req) {
  const reportType = req.query.report_type || 'weekly_financial';
  const view = req.query.view || 'reconciled';

  if (!['weekly_financial', 'monthly_store_kpi'].includes(reportType)) {
    throw new AppError('report_type must be weekly_financial or monthly_store_kpi', 400);
  }

  if (!['excel_raw', 'admin_weekly', 'reconciled'].includes(view)) {
    throw new AppError('view must be one of excel_raw, admin_weekly, reconciled', 400);
  }

  const filter = { report_type: reportType };
  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.week_number) filter.week_number = Number(req.query.week_number);

  const shopScope = buildShopScope(req.user);
  const scopedFilter = applyShopReadFilter(filter, req, shopScope);

  const { excelRows, adminRows } = await loadRowsByView(scopedFilter, view);
  const currentRows =
    view === 'reconciled' ? mergeRecords(excelRows, adminRows) : [...excelRows, ...adminRows];

  const window = deriveDateWindow(req, currentRows);
  const rowsInWindow = window
    ? currentRows.filter((row) => isWithinWindow(row, window))
    : currentRows;

  return {
    reportType,
    view,
    window,
    currentRows,
    rowsInWindow,
    sourceCounts: {
      excel_raw: excelRows.length,
      admin_weekly: adminRows.length,
    },
  };
}

async function loadRowsByView(filter, view) {
  if (view === 'excel_raw' || view === 'admin_weekly') {
    const rows = await StoreReportEntry.find({ ...filter, source_type: view }).populate(
      'shop_id',
      'name'
    );
    return {
      excelRows: view === 'excel_raw' ? rows : [],
      adminRows: view === 'admin_weekly' ? rows : [],
    };
  }

  const [excelRows, adminRows] = await Promise.all([
    StoreReportEntry.find({ ...filter, source_type: 'excel_raw' }).populate('shop_id', 'name'),
    StoreReportEntry.find({ ...filter, source_type: 'admin_weekly' }).populate('shop_id', 'name'),
  ]);

  return { excelRows, adminRows };
}

const getStoreReportAnalyticsSummary = asyncHandler(async (req, res) => {
  const compare = req.query.compare || 'both';
  const channels = parseChannelSelection(req.query);
  if (!['wow', 'yoy', 'both'].includes(compare)) {
    throw new AppError('compare must be one of wow, yoy, both', 400);
  }

  const context = await getAnalyticsContext(req);
  const { wowWindow, yoyWindow, comparisonWindows } = resolveComparisonWindows(
    req.query,
    context.window,
    compare
  );

  const wowRows = wowWindow
    ? context.currentRows.filter((row) => isWithinWindow(row, wowWindow))
    : [];
  const yoyRows = yoyWindow
    ? context.currentRows.filter((row) => isWithinWindow(row, yoyWindow))
    : [];

  return sendSuccess(res, 'Store report analytics summary fetched successfully', {
    report_type: context.reportType,
    view: context.view,
    compare,
    filters: {
      channels,
    },
    window: context.window,
    comparison_windows: comparisonWindows,
    kpis: summarizeKpis(context.rowsInWindow),
    comparisons: {
      wow: wowWindow
        ? {
            ...buildComparisonPayload(context.rowsInWindow, wowRows),
            channels: buildChannelComparisonPayload(context.rowsInWindow, wowRows, channels),
          }
        : null,
      yoy: yoyWindow
        ? {
            ...buildComparisonPayload(context.rowsInWindow, yoyRows),
            channels: buildChannelComparisonPayload(context.rowsInWindow, yoyRows, channels),
          }
        : null,
    },
    charts: {
      channelTotals: {
        current: pickChannels(summarizeKpis(context.rowsInWindow), channels),
        wow: pickChannels(summarizeKpis(wowRows), channels),
        yoy: pickChannels(summarizeKpis(yoyRows), channels),
      },
    },
    source_counts: context.sourceCounts,
  });
});

const getStoreReportAnalyticsStoreRanking = asyncHandler(async (req, res) => {
  const metric = parseAnalyticsMetric(req.query);
  const sort = parseSortDirection(req.query);
  const limit = parsePositiveInt(req.query.limit, 20, 'limit', 100);
  const context = await getAnalyticsContext(req);

  const grouped = new Map();
  context.rowsInWindow.forEach((row) => {
    const shopId = String(row.shop_id?._id || row.shop_id);
    if (!grouped.has(shopId)) {
      grouped.set(shopId, {
        shopId,
        shopName: row.shop_id?.name || row.store_name_raw || shopId,
        rows: [],
      });
    }
    grouped.get(shopId).rows.push(row);
  });

  const rankings = Array.from(grouped.values()).map((entry) => {
    const summary = summarizeKpis(entry.rows);
    return {
      shopId: entry.shopId,
      shopName: entry.shopName,
      revenue: summary.revenue,
      profit: summary.profit,
      orders: summary.orders,
      averageOrderValue: summary.averageOrderValue,
      value: toMetricValue(summary, metric),
    };
  });

  rankings.sort((a, b) => (sort === 'asc' ? a.value - b.value : b.value - a.value));

  return sendSuccess(res, 'Store report analytics ranking fetched successfully', {
    report_type: context.reportType,
    view: context.view,
    metric,
    sort,
    count: rankings.length,
    rows: rankings.slice(0, limit),
    source_counts: context.sourceCounts,
  });
});

const getStoreReportAnalyticsTrends = asyncHandler(async (req, res) => {
  const metric = parseAnalyticsMetric(req.query);
  const granularity = parseTrendGranularity(req.query);
  const topN = parsePositiveInt(req.query.top_n, 5, 'top_n', 20);
  const selectedShopId = req.query.selected_shop_id ? String(req.query.selected_shop_id) : null;
  const context = await getAnalyticsContext(req);

  const totalSeries = buildSeriesFromRows(context.rowsInWindow, metric, granularity);
  const byStore = buildStoreBreakdown(context.rowsInWindow);
  const topShopIds = new Set(byStore.slice(0, topN).map((shop) => String(shop.shopId)));
  if (selectedShopId) topShopIds.add(selectedShopId);

  const byShop = Array.from(topShopIds)
    .map((shopId) => {
      const shopRows = context.rowsInWindow.filter(
        (row) => String(row.shop_id?._id || row.shop_id) === shopId
      );
      if (shopRows.length === 0) return null;

      return {
        shopId,
        shopName: shopRows[0].shop_id?.name || shopRows[0].store_name_raw || shopId,
        total: toMetricValue(summarizeKpis(shopRows), metric),
        series: buildSeriesFromRows(shopRows, metric, granularity),
      };
    })
    .filter(Boolean);

  return sendSuccess(res, 'Store report analytics trends fetched successfully', {
    report_type: context.reportType,
    view: context.view,
    metric,
    granularity,
    selected_shop_id: selectedShopId,
    total: {
      value: toMetricValue(summarizeKpis(context.rowsInWindow), metric),
      series: totalSeries,
    },
    shops: byShop,
    source_counts: context.sourceCounts,
  });
});

const getStoreReportAnalyticsSalesChart = asyncHandler(async (req, res) => {
  const granularity = parseTrendGranularity(req.query);
  const topN = parsePositiveInt(req.query.top_n, 8, 'top_n', 30);
  const selectedShopId = req.query.selected_shop_id ? String(req.query.selected_shop_id) : null;
  const context = await getAnalyticsContext(req);

  const metric = 'revenue';
  const totalSeries = buildSeriesFromRows(context.rowsInWindow, metric, granularity);
  const byStore = buildStoreBreakdown(context.rowsInWindow);
  const topShopIds = new Set(byStore.slice(0, topN).map((shop) => String(shop.shopId)));
  if (selectedShopId) topShopIds.add(selectedShopId);

  const shops = Array.from(topShopIds)
    .map((shopId) => {
      const shopRows = context.rowsInWindow.filter(
        (row) => String(row.shop_id?._id || row.shop_id) === shopId
      );
      if (shopRows.length === 0) return null;

      return {
        shopId,
        shopName: shopRows[0].shop_id?.name || shopRows[0].store_name_raw || shopId,
        totalSales: round2(summarizeKpis(shopRows).revenue),
        series: buildSeriesFromRows(shopRows, metric, granularity),
      };
    })
    .filter(Boolean);

  return sendSuccess(res, 'Store report sales chart fetched successfully', {
    report_type: context.reportType,
    view: context.view,
    granularity,
    selected_shop_id: selectedShopId,
    total: {
      totalSales: round2(summarizeKpis(context.rowsInWindow).revenue),
      series: totalSeries,
    },
    shops,
    source_counts: context.sourceCounts,
  });
});

const importExcelData = asyncHandler(async (req, res) => {
  let xlsx;
  try {
    // Keep xlsx require lazy so APIs not using import don't crash if package missing.

    xlsx = require('xlsx');
  } catch {
    throw new AppError('xlsx dependency is missing. Run npm install.', 500);
  }

  const filePathInput = req.body?.file_path || path.join('resourse', 'Book1 (1).xlsx');
  const filePath = path.isAbsolute(filePathInput)
    ? filePathInput
    : path.resolve(process.cwd(), filePathInput);

  if (!fs.existsSync(filePath)) {
    throw new AppError(`Excel file not found at path: ${filePath}`, 400);
  }

  const year = Number(req.body?.year) || new Date().getUTCFullYear();
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const shopLookup = await buildShopLookup();

  const rowErrors = [];
  const records = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

    const weeklyRows = extractWeeklyRows(rows, sheetName, year);
    const monthlyRows = extractMonthlyRows(rows, year);

    [...weeklyRows, ...monthlyRows].forEach((row, index) => {
      const normalizedStoreName = normalizeStoreName(row.storeName);
      const shop = shopLookup.byName.get(normalizedStoreName);

      if (!shop) {
        rowErrors.push({
          sheet: sheetName,
          row: index + 1,
          storeName: row.storeName,
          reason: 'Store name does not match any existing shop',
        });
        return;
      }

      normalizeForPersistence({
        ...row,
        shop_id: shop._id,
      }).forEach((segment) => records.push(segment));
    });
  });

  const result = await bulkUpsertRecords(records, 'excel_raw', req.user?._id, filePath);

  return sendSuccess(res, 'Excel report data imported successfully', {
    imported: result.upserted + result.modified,
    upserted: result.upserted,
    updated: result.modified,
    matched: result.matched,
    failed: rowErrors.length,
    errors: rowErrors,
  });
});

const importHistoricalWorkbookData = asyncHandler(async (req, res) => {
  let xlsx;
  try {
    xlsx = require('xlsx');
  } catch {
    throw new AppError('xlsx dependency is missing. Run npm install.', 500);
  }

  // Handle file upload - check if file is provided in request
  if (!req.file) {
    throw new AppError('Excel file is required. Please upload a file.', 400);
  }

  const year = Number(req.body?.year) || new Date().getUTCFullYear();
  const weeklyFallbackStoreName =
    normalizeText(req.body?.weekly_store_name) || normalizeText(req.body?.default_store_name);

  // Read the Excel file from buffer (uploaded file)
  let workbook;
  try {
    workbook = xlsx.read(req.file.buffer, { cellDates: false });
  } catch (error) {
    throw new AppError(
      `Failed to parse Excel file: ${error.message}. Please ensure it's a valid Excel file.`,
      400
    );
  }

  const janDecSheetName = resolveSheetName(workbook.SheetNames, HISTORICAL_SHEET_ALIASES.janDec);
  const weeklySheetName = resolveSheetName(
    workbook.SheetNames,
    HISTORICAL_SHEET_ALIASES.weekly2026b
  );
  const monthlySheetName = resolveSheetName(
    workbook.SheetNames,
    HISTORICAL_SHEET_ALIASES.monthlySale2026
  );

  const missingSheets = [];
  if (!janDecSheetName) missingSheets.push(HISTORICAL_SHEET_ALIASES.janDec[0]);
  if (!weeklySheetName) missingSheets.push(HISTORICAL_SHEET_ALIASES.weekly2026b[0]);
  if (!monthlySheetName) missingSheets.push(HISTORICAL_SHEET_ALIASES.monthlySale2026[0]);

  if (missingSheets.length > 0) {
    throw new AppError(`Required sheet(s) not found: ${missingSheets.join(', ')}`, 400);
  }

  const shopLookup = await buildShopLookup();
  const rowErrors = [];

  const janDecRows = xlsx.utils.sheet_to_json(workbook.Sheets[janDecSheetName], {
    header: 1,
    raw: false,
    defval: '',
  });
  const janDecEntries = [
    ...extractWeeklyRows(janDecRows, janDecSheetName, year),
    ...extractMonthlyRows(janDecRows, year),
  ];

  const storeReportEntryRecords = [];
  janDecEntries.forEach((row, index) => {
    const shop = shopLookup.byName.get(normalizeStoreName(row.storeName));
    if (!shop) {
      rowErrors.push({
        sheet: janDecSheetName,
        row: index + 1,
        storeName: row.storeName,
        reason: 'Store name does not match any existing shop for StoreReportEntry import',
      });
      return;
    }

    normalizeForPersistence({
      ...row,
      shop_id: shop._id,
    }).forEach((segment) => storeReportEntryRecords.push(segment));
  });

  const weeklyRows = xlsx.utils.sheet_to_json(workbook.Sheets[weeklySheetName], {
    header: 1,
    raw: false,
    defval: '',
  });
  const weeklyEntries = extractWeekly2026BRows(weeklyRows, weeklyFallbackStoreName, year);
  const weeklyRecords = [];
  for (const row of weeklyEntries) {
    const shop = await getOrCreateShop(row.storeName, shopLookup);
    weeklyRecords.push({
      ...row,
      shop_id: shop?._id || null,
    });
  }

  const monthlyRows = xlsx.utils.sheet_to_json(workbook.Sheets[monthlySheetName], {
    header: 1,
    raw: false,
    defval: '',
  });
  const monthlyEntries = extractMonthlySale2026Rows(monthlyRows, year);
  const monthlyRecords = [];
  for (const row of monthlyEntries) {
    const shop = await getOrCreateShop(row.storeName, shopLookup);
    monthlyRecords.push({
      ...row,
      shop_id: shop?._id || null,
    });
  }

  const [janDecResult, weeklyResult, monthlyResult] = await Promise.all([
    bulkUpsertRecords(storeReportEntryRecords, 'excel_raw', req.user?._id, req.file.originalname),
    bulkUpsertWeekly2026BRecords(
      weeklyRecords,
      req.user?._id,
      req.file.originalname,
      weeklySheetName
    ),
    bulkUpsertMonthlySale2026Records(
      monthlyRecords,
      req.user?._id,
      req.file.originalname,
      monthlySheetName
    ),
  ]);

  return sendSuccess(res, 'Historical workbook data imported successfully', {
    file_name: req.file.originalname,
    file_size: req.file.size,
    sheets: {
      jan_dec_26: janDecSheetName,
      weekly_2026b: weeklySheetName,
      monthly_sale_2026: monthlySheetName,
    },
    imported: {
      store_report_entry: janDecResult.upserted + janDecResult.modified,
      weekly_2026b: weeklyResult.upserted + weeklyResult.modified,
      monthly_sale_2026: monthlyResult.upserted + monthlyResult.modified,
    },
    upserted: {
      store_report_entry: janDecResult.upserted,
      weekly_2026b: weeklyResult.upserted,
      monthly_sale_2026: monthlyResult.upserted,
    },
    updated: {
      store_report_entry: janDecResult.modified,
      weekly_2026b: weeklyResult.modified,
      monthly_sale_2026: monthlyResult.modified,
    },
    matched: {
      store_report_entry: janDecResult.matched,
      weekly_2026b: weeklyResult.matched,
      monthly_sale_2026: monthlyResult.matched,
    },
    failed: rowErrors.length,
    errors: rowErrors,
  });
});

const upsertAdminWeeklyData = asyncHandler(async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (entries.length === 0) {
    throw new AppError('entries[] is required', 400);
  }

  const shopLookup = await buildShopLookup();
  const rowErrors = [];
  const records = [];

  entries.forEach((entry, idx) => {
    const reportType = entry.report_type || 'weekly_financial';
    if (!['weekly_financial', 'monthly_store_kpi'].includes(reportType)) {
      rowErrors.push({ row: idx + 1, reason: 'Invalid report_type' });
      return;
    }

    let shop = null;
    if (entry.shop_id) {
      shop = shopLookup.byId.get(String(entry.shop_id));
    } else if (entry.store_name) {
      shop = shopLookup.byName.get(normalizeStoreName(entry.store_name));
    }

    if (!shop) {
      rowErrors.push({
        row: idx + 1,
        reason: 'shop_id/store_name does not map to an existing shop',
      });
      return;
    }

    const year = Number(entry.year);
    const month = Number(entry.month);

    if (!year || !month || month < 1 || month > 12) {
      rowErrors.push({ row: idx + 1, reason: 'year and month are required' });
      return;
    }

    let weekNumber = null;
    let weekStart = null;
    let weekEnd = null;
    let weekRangeLabel = null;

    if (reportType === 'weekly_financial') {
      weekNumber = Number(entry.week_number);
      if (!weekNumber || weekNumber < 1 || weekNumber > 53) {
        rowErrors.push({ row: idx + 1, reason: 'week_number is required for weekly_financial' });
        return;
      }

      weekRangeLabel = normalizeText(entry.week_range_label);
      if (weekRangeLabel) {
        const parsed = parseWeekRange(weekRangeLabel, year);
        if (parsed) {
          weekStart = parsed.weekStart;
          weekEnd = parsed.weekEnd;
          weekRangeLabel = parsed.weekRangeLabel;
        }
      }

      if (!weekStart && entry.week_start) {
        weekStart = new Date(entry.week_start);
      }
      if (!weekEnd && entry.week_end) {
        weekEnd = new Date(entry.week_end);
      }
    }

    if (!entry.metrics || typeof entry.metrics !== 'object') {
      rowErrors.push({ row: idx + 1, reason: 'metrics object is required' });
      return;
    }

    normalizeForPersistence({
      reportType,
      shop_id: shop._id,
      storeName: shop.name,
      year,
      month,
      weekNumber,
      weekStart,
      weekEnd,
      weekRangeLabel,
      metrics: entry.metrics,
    }).forEach((segment) => records.push(segment));
  });

  const result = await bulkUpsertRecords(records, 'admin_weekly', req.user?._id, null);

  return sendSuccess(res, 'Admin weekly data upserted successfully', {
    imported: result.upserted + result.modified,
    upserted: result.upserted,
    updated: result.modified,
    matched: result.matched,
    failed: rowErrors.length,
    errors: rowErrors,
  });
});

const getStoreReportTable = asyncHandler(async (req, res) => {
  const view = req.query.view || 'reconciled';
  const reportType = req.query.report_type || 'weekly_financial';

  if (!['excel_raw', 'admin_weekly', 'reconciled', 'all'].includes(view)) {
    throw new AppError('view must be one of excel_raw, admin_weekly, reconciled, all', 400);
  }

  if (!['weekly_financial', 'monthly_store_kpi'].includes(reportType)) {
    throw new AppError('report_type must be weekly_financial or monthly_store_kpi', 400);
  }

  const filter = { report_type: reportType };
  const includeWeeklyTotals = parseIncludeWeeklyTotals(req.query);
  const paginationBasis = parsePaginationBasis(req.query);
  const groupBy = parseGroupBy(req.query);

  if (groupBy === 'month' && reportType !== 'weekly_financial') {
    throw new AppError('group_by=month is supported only with report_type=weekly_financial', 400);
  }

  if (groupBy === 'month' && paginationBasis === 'week_number') {
    throw new AppError('pagination_basis=week_number is not supported with group_by=month', 400);
  }

  if (includeWeeklyTotals && reportType !== 'weekly_financial') {
    throw new AppError('include_weekly_totals is supported only for weekly_financial', 400);
  }

  if (includeWeeklyTotals && groupBy === 'month') {
    throw new AppError('include_weekly_totals is not supported with group_by=month', 400);
  }

  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.week_number) filter.week_number = Number(req.query.week_number);

  const shopScope = buildShopScope(req.user);
  const scopedFilter = applyShopReadFilter(filter, req, shopScope);
  const pagination = parsePaginationQuery(req.query);

  const [excelRows, adminRows] = await Promise.all([
    StoreReportEntry.find({ ...scopedFilter, source_type: 'excel_raw' }).populate(
      'shop_id',
      'name'
    ),
    StoreReportEntry.find({ ...scopedFilter, source_type: 'admin_weekly' }).populate(
      'shop_id',
      'name'
    ),
  ]);

  const reconciledRows = mergeRecords(excelRows, adminRows);

  const datasets = {
    excel_raw: toDatasetPayloadWithPagination(excelRows, reportType, pagination, {
      includeWeeklyTotals,
      paginationBasis,
      groupBy,
    }),
    admin_weekly: toDatasetPayloadWithPagination(adminRows, reportType, pagination, {
      includeWeeklyTotals,
      paginationBasis,
      groupBy,
    }),
    reconciled: toDatasetPayloadWithPagination(reconciledRows, reportType, pagination, {
      includeWeeklyTotals,
      paginationBasis,
      groupBy,
    }),
  };

  const columns =
    groupBy === 'month' && reportType === 'weekly_financial'
      ? REPORT_COLUMNS.weekly_financial
      : REPORT_COLUMNS[reportType];

  if (view === 'all') {
    return sendSuccess(res, 'Store report tables fetched successfully', {
      view,
      report_type: reportType,
      group_by: groupBy,
      columns,
      tables: datasets,
      source_counts: {
        excel_raw: excelRows.length,
        admin_weekly: adminRows.length,
      },
    });
  }

  return sendSuccess(res, 'Store report table fetched successfully', {
    view,
    report_type: reportType,
    group_by: groupBy,
    columns,
    ...datasets[view],
    source_counts: {
      excel_raw: excelRows.length,
      admin_weekly: adminRows.length,
    },
  });
});

const getStoreReportDashboardAnalytics = asyncHandler(async (req, res) => {
  const reportType = req.query.report_type || 'weekly_financial';
  const view = req.query.view || 'reconciled';
  const compare = req.query.compare || 'both';
  const channels = parseChannelSelection(req.query);

  if (!['weekly_financial', 'monthly_store_kpi'].includes(reportType)) {
    throw new AppError('report_type must be weekly_financial or monthly_store_kpi', 400);
  }

  if (!['excel_raw', 'admin_weekly', 'reconciled'].includes(view)) {
    throw new AppError('view must be one of excel_raw, admin_weekly, reconciled', 400);
  }

  if (!['wow', 'yoy', 'both'].includes(compare)) {
    throw new AppError('compare must be one of wow, yoy, both', 400);
  }

  const filter = { report_type: reportType };
  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.week_number) filter.week_number = Number(req.query.week_number);

  const shopScope = buildShopScope(req.user);
  const scopedFilter = applyShopReadFilter(filter, req, shopScope);

  const { excelRows, adminRows } = await loadRowsByView(scopedFilter, view);
  const currentRows =
    view === 'reconciled' ? mergeRecords(excelRows, adminRows) : [...excelRows, ...adminRows];

  const currentWindow = deriveDateWindow(req, currentRows);
  const rowsInWindow = currentWindow
    ? currentRows.filter((row) => isWithinWindow(row, currentWindow))
    : currentRows;

  const { wowWindow, yoyWindow, comparisonWindows } = resolveComparisonWindows(
    req.query,
    currentWindow,
    compare
  );

  const wowRows = wowWindow ? currentRows.filter((row) => isWithinWindow(row, wowWindow)) : [];
  const yoyRows = yoyWindow ? currentRows.filter((row) => isWithinWindow(row, yoyWindow)) : [];

  return sendSuccess(res, 'Store report analytics fetched successfully', {
    report_type: reportType,
    view,
    compare,
    filters: {
      year: req.query.year ? Number(req.query.year) : null,
      month: req.query.month ? Number(req.query.month) : null,
      week_number: req.query.week_number ? Number(req.query.week_number) : null,
      from: req.query.from || null,
      to: req.query.to || null,
      wow_from: req.query.wow_from || null,
      wow_to: req.query.wow_to || null,
      yoy_from: req.query.yoy_from || null,
      yoy_to: req.query.yoy_to || null,
      shop_id: req.query.shop_id || null,
      channels,
    },
    window: currentWindow
      ? {
          from: currentWindow.from,
          to: currentWindow.to,
        }
      : null,
    comparison_windows: comparisonWindows,
    kpis: summarizeKpis(rowsInWindow),
    comparisons: {
      wow: wowWindow
        ? {
            ...buildComparisonPayload(rowsInWindow, wowRows),
            channels: buildChannelComparisonPayload(rowsInWindow, wowRows, channels),
          }
        : null,
      yoy: yoyWindow
        ? {
            ...buildComparisonPayload(rowsInWindow, yoyRows),
            channels: buildChannelComparisonPayload(rowsInWindow, yoyRows, channels),
          }
        : null,
    },
    charts: {
      growth: {
        current: buildTrend(rowsInWindow),
        wow: buildTrend(wowRows),
        yoy: buildTrend(yoyRows),
      },
      revenueByStore: buildStoreBreakdown(rowsInWindow),
      revenueByChannel: summarizeKpis(rowsInWindow).channels,
      channelTotals: {
        current: pickChannels(summarizeKpis(rowsInWindow), channels),
        wow: pickChannels(summarizeKpis(wowRows), channels),
        yoy: pickChannels(summarizeKpis(yoyRows), channels),
      },
    },
    capabilities: {
      hasDailyBreakdown: false,
      hasSlotBreakdown: false,
      notes:
        'Current data is stored weekly/monthly. Daily and slot heatmap analytics require additional day/slot metrics.',
    },
    table_api: {
      paginated: true,
      notes:
        'GET /api/store-reports/table supports optional pagination via page and limit query params.',
    },
  });
});

// ---------- Weekly 2026B CRUD ----------

const getWeekly2026 = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.week_number) filter.week_number = Number(req.query.week_number);
  if (req.query.store_key) filter.store_key = req.query.store_key;

  const shopScope = buildShopScope(req.user);
  if (req.query.shop_id) {
    if (!shopScope.all && !isShopAllowed(shopScope, req.query.shop_id)) {
      const pageMeta = toPageMeta(0, 1, 20, 0);
      return sendSuccess(res, 'Weekly 2026 records fetched', {
        rows: [],
        count: 0,
        pagination: {
          enabled: true,
          basis: 'row',
          ...pageMeta,
          page_count: pageMeta.total_pages,
          has_next: false,
          has_prev: false,
        },
      });
    }
    filter.shop_id = req.query.shop_id;
  } else if (!shopScope.all) {
    if (shopScope.ids.length === 0) {
      const pageMeta = toPageMeta(0, 1, 20, 0);
      return sendSuccess(res, 'Weekly 2026 records fetched', {
        rows: [],
        count: 0,
        pagination: {
          enabled: true,
          basis: 'row',
          ...pageMeta,
          page_count: pageMeta.total_pages,
          has_next: false,
          has_prev: false,
        },
      });
    }
    filter.shop_id = { $in: shopScope.ids };
  }

  const { page, limit, skip } = parsePaginationQuery(req.query);
  const sort = { year: -1, month: -1, week_number: -1 };

  const [total, rows] = await Promise.all([
    StoreReportWeekly2026B.countDocuments(filter),
    StoreReportWeekly2026B.find(filter)
      .populate('shop_id', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit),
  ]);

  const pageMeta = toPageMeta(total, page, limit, rows.length);

  return sendSuccess(res, 'Weekly 2026 records fetched', {
    rows,
    count: total,
    pagination: {
      enabled: true,
      basis: 'row',
      ...pageMeta,
      page_count: pageMeta.total_pages,
      has_next: pageMeta.page < pageMeta.total_pages,
      has_prev: pageMeta.page > 1,
    },
  });
});

const upsertSingleWeekly2026 = asyncHandler(async (req, res) => {
  const {
    store_name,
    shop_id: inputShopId,
    year,
    month,
    week_number,
    week_range_label,
    metrics,
    source_sheet,
  } = req.body;

  if (!year || !month || !week_number) {
    throw new AppError('year, month, and week_number are required', 400);
  }
  if (!metrics || typeof metrics !== 'object') {
    throw new AppError('metrics object is required', 400);
  }
  if (!store_name && !inputShopId) {
    throw new AppError('store_name or shop_id is required', 400);
  }

  const shopLookup = await buildShopLookup();
  let shop = null;

  if (inputShopId) {
    shop = shopLookup.byId.get(String(inputShopId));
  } else if (store_name) {
    shop = await getOrCreateShop(store_name, shopLookup);
  }

  const storeName = store_name || (shop ? shop.name : 'Unknown');
  const storeKey = normalizeStoreName(storeName) || 'unknown';
  const sheet = normalizeText(source_sheet) || 'Weekly 2026';
  const yr = Number(year);
  const mo = Number(month);
  const wn = Number(week_number);
  const periodKey = toPeriodKey('weekly_financial', yr, mo, wn);

  let weekStart = null;
  let weekEnd = null;
  let weekRangeLabel = normalizeText(week_range_label) || null;

  if (weekRangeLabel) {
    const parsed = parseWeekRange(weekRangeLabel, yr);
    if (parsed) {
      weekStart = parsed.weekStart;
      weekEnd = parsed.weekEnd;
      weekRangeLabel = parsed.weekRangeLabel;
    }
  }

  const record = await StoreReportWeekly2026B.findOneAndUpdate(
    { source_sheet: sheet, period_key: periodKey, store_key: storeKey },
    {
      $set: {
        shop_id: shop?._id || null,
        store_name_raw: storeName,
        store_key: storeKey,
        source_sheet: sheet,
        period_key: periodKey,
        year: yr,
        month: mo,
        week_number: wn,
        week_start: weekStart,
        week_end: weekEnd,
        week_range_label: weekRangeLabel,
        metrics,
        updated_by: req.user?._id || null,
      },
      $setOnInsert: {
        imported_by: req.user?._id || null,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  return sendSuccess(res, 'Weekly 2026 record upserted', { record }, 200);
});

// ---------- Monthly Sale 2026 CRUD ----------

const getMonthlySale2026 = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.store_key) filter.store_key = req.query.store_key;

  const shopScope = buildShopScope(req.user);
  if (req.query.shop_id) {
    if (!shopScope.all && !isShopAllowed(shopScope, req.query.shop_id)) {
      const pageMeta = toPageMeta(0, 1, 20, 0);
      return sendSuccess(res, 'Monthly Sale 2026 records fetched', {
        rows: [],
        count: 0,
        pagination: {
          enabled: true,
          basis: 'row',
          ...pageMeta,
          page_count: pageMeta.total_pages,
          has_next: false,
          has_prev: false,
        },
      });
    }
    filter.shop_id = req.query.shop_id;
  } else if (!shopScope.all) {
    if (shopScope.ids.length === 0) {
      const pageMeta = toPageMeta(0, 1, 20, 0);
      return sendSuccess(res, 'Monthly Sale 2026 records fetched', {
        rows: [],
        count: 0,
        pagination: {
          enabled: true,
          basis: 'row',
          ...pageMeta,
          page_count: pageMeta.total_pages,
          has_next: false,
          has_prev: false,
        },
      });
    }
    filter.shop_id = { $in: shopScope.ids };
  }

  const { page, limit, skip } = parsePaginationQuery(req.query);
  const sort = { year: -1, month: -1 };

  const [total, rows] = await Promise.all([
    StoreReportMonthlySale2026.countDocuments(filter),
    StoreReportMonthlySale2026.find(filter)
      .populate('shop_id', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit),
  ]);

  const pageMeta = toPageMeta(total, page, limit, rows.length);

  return sendSuccess(res, 'Monthly Sale 2026 records fetched', {
    rows,
    count: total,
    pagination: {
      enabled: true,
      basis: 'row',
      ...pageMeta,
      page_count: pageMeta.total_pages,
      has_next: pageMeta.page < pageMeta.total_pages,
      has_prev: pageMeta.page > 1,
    },
  });
});

const upsertSingleMonthlySale2026 = asyncHandler(async (req, res) => {
  const { store_name, shop_id: inputShopId, year, month, metrics, source_sheet } = req.body;

  if (!year || !month) {
    throw new AppError('year and month are required', 400);
  }
  if (!metrics || typeof metrics !== 'object') {
    throw new AppError('metrics object is required', 400);
  }
  if (!store_name && !inputShopId) {
    throw new AppError('store_name or shop_id is required', 400);
  }

  const shopLookup = await buildShopLookup();
  let shop = null;

  if (inputShopId) {
    shop = shopLookup.byId.get(String(inputShopId));
  } else if (store_name) {
    shop = await getOrCreateShop(store_name, shopLookup);
  }

  const storeName = store_name || (shop ? shop.name : 'Unknown');
  const storeKey = normalizeStoreName(storeName) || 'unknown';
  const sheet = normalizeText(source_sheet) || 'Monthly Sale 2026';
  const yr = Number(year);
  const mo = Number(month);
  const periodKey = `${yr}-${String(mo).padStart(2, '0')}`;

  const record = await StoreReportMonthlySale2026.findOneAndUpdate(
    { source_sheet: sheet, period_key: periodKey, store_key: storeKey },
    {
      $set: {
        shop_id: shop?._id || null,
        store_name_raw: storeName,
        store_key: storeKey,
        source_sheet: sheet,
        period_key: periodKey,
        year: yr,
        month: mo,
        metrics,
        updated_by: req.user?._id || null,
      },
      $setOnInsert: {
        imported_by: req.user?._id || null,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  return sendSuccess(res, 'Monthly Sale 2026 record upserted', { record }, 200);
});

// ---------- Excel Export ----------

const MONTH_NAMES = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const exportExcel = asyncHandler(async (req, res) => {
  let xlsx;
  try {
    xlsx = require('xlsx');
  } catch {
    throw new AppError('xlsx package is not installed', 500);
  }

  const filter = {};
  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.store_key) filter.store_key = req.query.store_key;

  const shopScope = buildShopScope(req.user);
  if (req.query.shop_id) {
    if (!shopScope.all && !isShopAllowed(shopScope, req.query.shop_id)) {
      throw new AppError('You do not have access to this shop', 403);
    }
    filter.shop_id = req.query.shop_id;
  } else if (!shopScope.all) {
    if (shopScope.ids.length === 0) {
      throw new AppError('No shops available for export', 403);
    }
    filter.shop_id = { $in: shopScope.ids };
  }

  const requestedSheets = req.query.sheets
    ? req.query.sheets.split(',').map((s) => s.trim().toLowerCase())
    : ['weekly', 'monthly'];

  const wb = xlsx.utils.book_new();
  let sheetsAdded = 0;

  // ---- Weekly Sheet ----
  if (requestedSheets.includes('weekly')) {
    const weeklyRecords = await StoreReportWeekly2026B.find(filter)
      .populate('shop_id', 'name')
      .sort({ year: 1, month: 1, week_number: 1, store_key: 1 })
      .lean();

    if (weeklyRecords.length > 0) {
      const allMetricKeys = new Set();
      weeklyRecords.forEach((r) => {
        Object.keys(r.metrics || {}).forEach((k) => allMetricKeys.add(k));
      });
      const metricCols = Array.from(allMetricKeys);

      const header = ['Week #', 'Week Ending', 'Store', ...metricCols];
      const rows = [header];

      weeklyRecords.forEach((r) => {
        const row = [r.week_number, r.week_range_label || '', r.store_name_raw || ''];
        metricCols.forEach((key) => {
          row.push(r.metrics?.[key] ?? '');
        });
        rows.push(row);
      });

      const ws = xlsx.utils.aoa_to_sheet(rows);
      xlsx.utils.book_append_sheet(wb, ws, 'Weekly');
      sheetsAdded += 1;
    }
  }

  // ---- Monthly Sale Sheet ----
  if (requestedSheets.includes('monthly')) {
    const monthlyRecords = await StoreReportMonthlySale2026.find(filter)
      .populate('shop_id', 'name')
      .sort({ year: 1, month: 1, store_key: 1 })
      .lean();

    if (monthlyRecords.length > 0) {
      const allMetricKeys = new Set();
      monthlyRecords.forEach((r) => {
        Object.keys(r.metrics || {}).forEach((k) => allMetricKeys.add(k));
      });
      const metricCols = Array.from(allMetricKeys);

      const header = ['Month', 'Store', ...metricCols];
      const rows = [header];

      let lastMonthLabel = '';
      monthlyRecords.forEach((r) => {
        const yr = r.year % 100;
        const monthLabel = `${MONTH_NAMES[r.month] || r.month}-${String(yr).padStart(2, '0')}`;

        if (monthLabel !== lastMonthLabel) {
          const separatorRow = [monthLabel];
          for (let i = 1; i < header.length; i++) separatorRow.push('');
          rows.push(separatorRow);
          lastMonthLabel = monthLabel;
        }

        const row = ['', r.store_name_raw || ''];
        metricCols.forEach((key) => {
          row.push(r.metrics?.[key] ?? '');
        });
        rows.push(row);
      });

      const ws = xlsx.utils.aoa_to_sheet(rows);
      xlsx.utils.book_append_sheet(wb, ws, 'Monthly Sale');
      sheetsAdded += 1;
    }
  }

  if (sheetsAdded === 0) {
    const emptyWs = xlsx.utils.aoa_to_sheet([['No data found for the given filters']]);
    xlsx.utils.book_append_sheet(wb, emptyWs, 'Info');
  }

  const yearLabel = req.query.year || 'all';
  const filename = `store_report_${yearLabel}.xlsx`;

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
});

module.exports = {
  importExcelData,
  importHistoricalWorkbookData,
  upsertAdminWeeklyData,
  getStoreReportTable,
  getStoreReportAnalyticsSummary,
  getStoreReportAnalyticsStoreRanking,
  getStoreReportAnalyticsTrends,
  getStoreReportAnalyticsSalesChart,
  getStoreReportDashboardAnalytics,
  getWeekly2026,
  upsertSingleWeekly2026,
  getMonthlySale2026,
  upsertSingleMonthlySale2026,
  exportExcel,
};
