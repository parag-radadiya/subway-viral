require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('./db');
const Shop = require('../models/Shop');
const User = require('../models/User');
const StoreReportEntry = require('../models/StoreReportEntry');

const TOTAL_WEEKS = Number(process.env.STORE_REPORT_SEED_WEEKS || 104);
const REPORT_TYPE = 'weekly_financial';
const SOURCE_TYPE = 'admin_weekly';

function toUtcDayStart(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toUtcDayEnd(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function getWeekStartMondayUtc(date) {
  const d = toUtcDayStart(date);
  const day = d.getUTCDay();
  const shift = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

function addUtcDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatWeekRangeLabel(weekStart, weekEnd) {
  const startDay = String(weekStart.getUTCDate()).padStart(2, '0');
  const startMonth = String(weekStart.getUTCMonth() + 1).padStart(2, '0');
  const endDay = String(weekEnd.getUTCDate()).padStart(2, '0');
  const endMonth = String(weekEnd.getUTCMonth() + 1).padStart(2, '0');
  return `${startDay}/${startMonth} to ${endDay}/${endMonth}`;
}

function getIsoWeekNumber(date) {
  const utcDate = toUtcDayStart(date);
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - (utcDate.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function countInclusiveUtcDays(start, end) {
  const dayMs = 24 * 60 * 60 * 1000;
  const from = toUtcDayStart(start).getTime();
  const to = toUtcDayStart(end).getTime();
  return Math.floor((to - from) / dayMs) + 1;
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

function splitWeekAcrossMonths(weekStart, weekEnd, metrics) {
  const start = toUtcDayStart(weekStart);
  const end = toUtcDayEnd(weekEnd);

  if (
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear()
  ) {
    return [
      {
        year: end.getUTCFullYear(),
        month: end.getUTCMonth() + 1,
        weekStart: start,
        weekEnd: end,
        weekRangeLabel: formatWeekRangeLabel(start, end),
        metrics,
      },
    ];
  }

  const monthEnd = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );
  const nextMonthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0));

  const totalDays = countInclusiveUtcDays(start, end);
  const firstDays = countInclusiveUtcDays(start, monthEnd);
  const firstRatio = firstDays / totalDays;
  const splitMetrics = splitMetricsByRatio(metrics, firstRatio);

  return [
    {
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
      weekStart: start,
      weekEnd: monthEnd,
      weekRangeLabel: formatWeekRangeLabel(start, monthEnd),
      metrics: splitMetrics.first,
    },
    {
      year: end.getUTCFullYear(),
      month: end.getUTCMonth() + 1,
      weekStart: nextMonthStart,
      weekEnd: end,
      weekRangeLabel: formatWeekRangeLabel(nextMonthStart, end),
      metrics: splitMetrics.second,
    },
  ];
}

function generateMetrics(shopIndex, weekIndex, weekEnd) {
  const seasonal = Math.sin((2 * Math.PI * (weekIndex % 52)) / 52) * 250;
  const trend = weekIndex * 7;
  const shopBias = shopIndex * 180;

  const grossSales = round2(1400 + seasonal + trend + shopBias);
  const vat = round2(grossSales * 0.15);
  const netSales = round2(grossSales - vat);

  const deliveryPercent = 0.22 + ((weekIndex + shopIndex) % 7) * 0.01;
  const total3pd = round2(grossSales * deliveryPercent);
  const justeatSale = round2(total3pd * 0.34);
  const ubereatSale = round2(total3pd * 0.33);
  const deliverooSale = round2(total3pd - justeatSale - ubereatSale);

  const labourCost = round2(netSales * (0.17 + ((weekIndex + 3) % 5) * 0.005));
  const bidfood = round2(netSales * (0.21 + ((weekIndex + 1) % 4) * 0.004));

  const royalties = round2(netSales * 0.04);
  const commission = round2(total3pd * 0.1);
  const total = round2(vat + labourCost + bidfood + royalties + commission);
  const income = round2(netSales - total);

  const customerCount = Math.max(1, Math.round(grossSales / 19));
  const vatPercent = netSales === 0 ? 0 : round2(vat / netSales);

  const justCharge = round2(justeatSale * 0.1);
  const uberCharge = round2(ubereatSale * 0.1);
  const deliverooCharge = round2(deliverooSale * 0.1);

  return {
    sales: grossSales,
    net: netSales,
    labour: labourCost,
    vat18: vat,
    royalties,
    foodCost22: bidfood,
    commission,
    commissionPercentage: total3pd === 0 ? 0 : round2(commission / total3pd),
    total,
    income,
    customerCount,
    justeatSale,
    ubereatSale,
    deliverooSale,

    'GROSS SALES': grossSales,
    VAT: vat,
    'VAT %': vatPercent,
    'Adjusted VAT': round2(vat * 0.8),
    'NET SALES': netSales,
    'Delivery %': round2(total3pd / grossSales),
    'Total 3PD Sale': total3pd,
    'Customer Count': customerCount,
    'JustEat Sale': justeatSale,
    'JUST Charge': justCharge,
    'JustEat 20% Vat': round2(justCharge * 0.2),
    'Receive from Justeat': round2(justeatSale - justCharge),
    'JustEat Amount Received in Bank': 0,
    'JustEat Variance from Bank': 0,
    'UberEat Sale': ubereatSale,
    'UBEREAT Charge': uberCharge,
    'UBEREAT 20% Vat': round2(uberCharge * 0.2),
    'Receive From Uber': round2(ubereatSale - uberCharge),
    'UBEREAT Amount Received in Bank': 0,
    'Ubereats Advertise': 0,
    'Uber discount %': 0,
    'Deliveroo sale': deliverooSale,
    'DELIVEROO Charge': deliverooCharge,
    'DELIVEROO 20% Vat': round2(deliverooCharge * 0.2),
    'Recive From Deliveroo': round2(deliverooSale - deliverooCharge),
    'DELIVEROO Amount Received in Bank': 0,
    'Variance from Bank': 0,
    'delivery Charges TOTAL': round2(justCharge + uberCharge + deliverooCharge),
    'Delivery Charge %':
      total3pd === 0 ? 0 : round2((justCharge + uberCharge + deliverooCharge) / total3pd),
    'LABOUR HOURS': round2(labourCost / 12),
    'LABOUR COST ': labourCost,
    'Labour cost %': netSales === 0 ? 0 : round2(labourCost / netSales),
    'BID FOOD ': bidfood,
    'Food cost %': netSales === 0 ? 0 : round2(bidfood / netSales),
    'TOTAL COST %': netSales === 0 ? 0 : round2(total / netSales),
    'Instore Food Cost': round2(bidfood * 0.55),
    'Instore Labour Cost': round2(labourCost * 0.6),
    'Bidfood Total': bidfood,
    'Previous Week': weekIndex === 0 ? 0 : 1,
    generatedAtWeekEnd: weekEnd.toISOString().slice(0, 10),
  };
}

function buildPeriodKey(year, month, weekNumber) {
  return `${year}-${String(month).padStart(2, '0')}-W${String(weekNumber).padStart(2, '0')}`;
}

async function run() {
  await connectDB();

  const shops = await Shop.find({}).select('_id name').sort({ name: 1 });
  if (shops.length === 0) {
    throw new Error('No shops found. Seed shops/users first using npm run seed.');
  }

  const actor = await User.findOne({ email: 'admin@org.com' }).select('_id');
  const actorId = actor?._id || null;

  const currentWeekStart = getWeekStartMondayUtc(new Date());
  const firstWeekStart = addUtcDays(currentWeekStart, -7 * (TOTAL_WEEKS - 1));

  const ops = [];
  let weekStart = new Date(firstWeekStart);

  for (let weekIndex = 0; weekIndex < TOTAL_WEEKS; weekIndex += 1) {
    const weekEnd = toUtcDayEnd(addUtcDays(weekStart, 6));
    const weekNumber = getIsoWeekNumber(weekEnd);

    shops.forEach((shop, shopIndex) => {
      const metrics = generateMetrics(shopIndex, weekIndex, weekEnd);
      const segments = splitWeekAcrossMonths(weekStart, weekEnd, metrics);

      segments.forEach((segment) => {
        const periodKey = buildPeriodKey(segment.year, segment.month, weekNumber);

        ops.push({
          updateOne: {
            filter: {
              shop_id: shop._id,
              report_type: REPORT_TYPE,
              source_type: SOURCE_TYPE,
              period_key: periodKey,
            },
            update: {
              $set: {
                year: segment.year,
                month: segment.month,
                week_number: weekNumber,
                week_start: segment.weekStart,
                week_end: segment.weekEnd,
                week_range_label: segment.weekRangeLabel,
                store_name_raw: shop.name,
                metrics: segment.metrics,
                source_file: 'dummy-seed-last-2-years',
                updated_by: actorId,
              },
              $setOnInsert: {
                imported_by: actorId,
              },
            },
            upsert: true,
          },
        });
      });
    });

    weekStart = addUtcDays(weekStart, 7);
  }

  const result = await StoreReportEntry.bulkWrite(ops, { ordered: false });

  console.log('Store report dummy data seeded successfully');
  console.log(`Shops: ${shops.length}`);
  console.log(`Weeks per shop: ${TOTAL_WEEKS}`);
  console.log(`Upserted: ${result.upsertedCount || 0}`);
  console.log(`Modified: ${result.modifiedCount || 0}`);
  console.log(`Matched: ${result.matchedCount || 0}`);
  console.log(`Total operations: ${ops.length}`);
}

run()
  .catch((error) => {
    console.error('Failed to seed store report dummy data:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
