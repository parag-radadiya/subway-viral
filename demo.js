const oneOrder = 3;
const totalOrders = 30;

const finalValue = oneOrder * totalOrders;
console.log(`The final value is: ${finalValue * 125}`);

[
  {
    _id: { $oid: '69ee4976df168e7a70424483' },
    __v: 0,
    createdAt: { $date: '2026-04-26T17:20:54.693Z' },
    imported_by: { $oid: '69b96e909d8692506ab257e4' },
    metrics: {
      sales: 500,
      net: 410,
      labour: 40,
      vat18Percent: 90,
      royalties: 51.25,
      foodCost22Percent: 90.2,
      commision: 100,
      commisionPercentage: 20,
      total: 371.45,
      income: 128.55,
    },
    month: 1,
    period_key: '2026-01-W01',
    shop_id: { $oid: '69b96e909d8692506ab257df' },
    source_file: '/Users/radadiyaashvinbhai/IdeaProjects/subway-viral/resourse/Book1 (1).xlsx',
    source_sheet: 'Weekly 2026',
    store_key: 'main branch',
    store_name_raw: 'Main Branch',
    updatedAt: { $date: '2026-04-26T17:45:40.971Z' },
    updated_by: { $oid: '69b96e909d8692506ab257e4' },
    week_end: { $date: '2026-01-04T23:59:59.999Z' },
    week_number: 1,
    week_range_label: '29/12 to 04/01',
    week_start: { $date: '2025-12-29T00:00:00.000Z' },
    year: 2026,
  },
];
