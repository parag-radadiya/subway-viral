# Store Reports Dashboard Analytics API

This document describes the backend API used by the dashboard route:

- `GET /api/store-reports/analytics/dashboard`

Route registration:

```js
router.get(
  '/analytics/dashboard',
  protect,
  requirePermission('can_view_all_staff'),
  getStoreReportDashboardAnalytics
);
```

## Purpose

This API returns **dashboard-ready analytics** from store report data, including:

- KPI cards (Revenue, Profit, Orders, AOV)
- WoW / YoY comparisons
- Growth chart data
- Revenue split by store
- Revenue split by channel

It supports `excel_raw`, `admin_weekly`, and `reconciled` views.

---

## Auth and Access

- **Auth required**: `Bearer <token>`
- **Permission required**: `can_view_all_staff`
- Shop-level access is automatically enforced by backend scope logic.

If user does not have permission, API returns `403`.

---

## Endpoint

```http
GET /api/store-reports/analytics/dashboard
```

### Query Parameters

| Param         | Type             | Required | Default            | Allowed                                   | Description                        |
| ------------- | ---------------- | -------: | ------------------ | ----------------------------------------- | ---------------------------------- |
| `report_type` | string           |       no | `weekly_financial` | `weekly_financial`, `monthly_store_kpi`   | Data family used for analytics     |
| `view`        | string           |       no | `reconciled`       | `excel_raw`, `admin_weekly`, `reconciled` | Data source view                   |
| `compare`     | string           |       no | `both`             | `wow`, `yoy`, `both`                      | Which comparison blocks to include |
| `year`        | number           |       no | -                  | any valid year                            | Optional filter                    |
| `month`       | number           |       no | -                  | `1..12`                                   | Optional filter                    |
| `week_number` | number           |       no | -                  | `1..53`                                   | Optional filter                    |
| `shop_id`     | string(ObjectId) |       no | -                  | scoped by user                            | Optional shop filter               |
| `from`        | date             |       no | auto-derived       | ISO/date string                           | Start date for comparison window   |
| `to`          | date             |       no | auto-derived       | ISO/date string                           | End date for comparison window     |

### Validation Errors (400)

- Invalid `report_type`
- Invalid `view`
- Invalid `compare`
- Invalid date values for `from` / `to`
- `from > to`

---

## Response Shape

```json
{
  "status": 200,
  "message": "Store report analytics fetched successfully",
  "data": {
    "report_type": "weekly_financial",
    "view": "reconciled",
    "compare": "both",
    "filters": {
      "year": 2026,
      "month": 4,
      "week_number": 15,
      "from": "2026-04-05",
      "to": "2026-04-11",
      "shop_id": null
    },
    "window": {
      "from": "2026-04-05T00:00:00.000Z",
      "to": "2026-04-11T23:59:59.999Z"
    },
    "kpis": {
      "revenue": 2000,
      "profit": 400,
      "orders": 100,
      "averageOrderValue": 20,
      "channels": {
        "justeat": 300,
        "ubereat": 150,
        "deliveroo": 150,
        "thirdParty": 600,
        "instore": 1400
      }
    },
    "comparisons": {
      "wow": {
        "revenue": { "current": 2000, "previous": 1600, "change": 400, "changePct": 25 },
        "profit": { "current": 400, "previous": 320, "change": 80, "changePct": 25 },
        "orders": { "current": 100, "previous": 80, "change": 20, "changePct": 25 },
        "averageOrderValue": { "current": 20, "previous": 20, "change": 0, "changePct": 0 }
      },
      "yoy": null
    },
    "charts": {
      "growth": {
        "current": [],
        "wow": [],
        "yoy": []
      },
      "revenueByStore": [],
      "revenueByChannel": {
        "justeat": 300,
        "ubereat": 150,
        "deliveroo": 150,
        "thirdParty": 600,
        "instore": 1400
      }
    },
    "capabilities": {
      "hasDailyBreakdown": false,
      "hasSlotBreakdown": false,
      "notes": "Current data is stored weekly/monthly. Daily and slot heatmap analytics require additional day/slot metrics."
    },
    "table_api": {
      "paginated": true,
      "notes": "GET /api/store-reports/table supports optional pagination via page and limit query params."
    }
  }
}
```

---

## How Frontend Should Use It

### 1) Dashboard load (default)

Call once on page load:

```http
GET /api/store-reports/analytics/dashboard?view=reconciled&report_type=weekly_financial&compare=both
```

Use:

- `data.kpis` for top cards
- `data.comparisons.wow` and `data.comparisons.yoy` for deltas
- `data.charts.growth` for trend line chart
- `data.charts.revenueByStore` for store bar table/chart
- `data.charts.revenueByChannel` for channel donut/stacked chart

### 2) Date range compare picker

When user changes date window:

```http
GET /api/store-reports/analytics/dashboard?from=2026-04-05&to=2026-04-11&compare=both&view=reconciled&report_type=weekly_financial
```

### 3) Shop filter

When user selects one shop:

```http
GET /api/store-reports/analytics/dashboard?shop_id=<SHOP_ID>&compare=both&view=reconciled&report_type=weekly_financial
```

### 4) Source switch (admin/excel/reconciled)

```http
GET /api/store-reports/analytics/dashboard?view=admin_weekly&report_type=weekly_financial
```

---

## KPI Calculation Notes

Backend reads values from `metrics` with alias fallback logic. For weekly financial data, common keys are:

- Revenue: `sales` (or `gross sales` aliases)
- Profit: `income` (fallbacks supported)
- Orders: `customer count` / `orders`
- AOV: `revenue / orders`
- Channel split: `justeatSale`, `ubereatSale`, `deliverooSale`, with third-party and in-store derivation

If a metric is missing, backend safely falls back to `0`.

---

## Use Cases

1. **Weekly performance dashboard**
   - Last week vs week-before KPIs and trend
2. **YoY business review**
   - Compare same date window with previous year
3. **Store leaderboard**
   - Revenue ranking by store using `charts.revenueByStore`
4. **Channel mix analysis**
   - Track delivery platform dependency over time
5. **Scoped analytics by role/shop access**
   - Same endpoint works for admins and scoped managers

---

## Known Limitations

- Daily and slot heatmap are not available from current schema (`hasDailyBreakdown=false`, `hasSlotBreakdown=false`).
- Endpoint is aggregate-oriented; for raw table rows use:
  - `GET /api/store-reports/table`

---

## Related APIs

- `GET /api/store-reports/table` - tabular data (supports pagination, `group_by=month` for weekly-derived monthly table)
- `GET /api/store-reports/analytics/summary` - KPI summary + WoW/YoY compare blocks
- `GET /api/store-reports/analytics/store-ranking` - ranked shop list by selected metric
- `GET /api/store-reports/analytics/trends` - total + by-shop trend series for charts
- `GET /api/store-reports/analytics/charts/sales` - sales-only chart API (total and selected/top shops)
- `POST /api/store-reports/admin-weekly` - upsert admin weekly input
- `POST /api/store-reports/import-excel` - import excel source rows

---

## New Analytics APIs (Frontend)

### 1) Summary API

```http
GET /api/store-reports/analytics/summary
```

Useful for top cards + comparison badges without full dashboard payload.

Query parameters:

| Param         | Type   | Required | Default            | Allowed                                   | Notes                         |
| ------------- | ------ | -------: | ------------------ | ----------------------------------------- | ----------------------------- |
| `view`        | string |       no | `reconciled`       | `excel_raw`, `admin_weekly`, `reconciled` | Data source selection         |
| `report_type` | string |       no | `weekly_financial` | `weekly_financial`, `monthly_store_kpi`   | Analytics data family         |
| `compare`     | string |       no | `both`             | `wow`, `yoy`, `both`                      | Comparison blocks returned    |
| `year`        | number |       no | -                  | any                                       | Optional filter               |
| `month`       | number |       no | -                  | `1..12`                                   | Optional filter               |
| `week_number` | number |       no | -                  | `1..53`                                   | Optional filter               |
| `shop_id`     | string |       no | -                  | ObjectId                                  | Optional shop filter (scoped) |
| `from`        | date   |       no | auto               | valid date                                | Comparison window start       |
| `to`          | date   |       no | auto               | valid date                                | Comparison window end         |

Example:

```http
GET /api/store-reports/analytics/summary?view=reconciled&report_type=weekly_financial&from=2026-04-05&to=2026-04-11&compare=both
```

### 2) Store Ranking API

```http
GET /api/store-reports/analytics/store-ranking
```

Useful for leaderboard table.

Query parameters:

| Param         | Type   | Required | Default            | Allowed                                            | Notes                  |
| ------------- | ------ | -------: | ------------------ | -------------------------------------------------- | ---------------------- |
| `view`        | string |       no | `reconciled`       | `excel_raw`, `admin_weekly`, `reconciled`          | Data source selection  |
| `report_type` | string |       no | `weekly_financial` | `weekly_financial`, `monthly_store_kpi`            | Data family            |
| `metric`      | string |       no | `revenue`          | `revenue`, `profit`, `orders`, `averageOrderValue` | Ranking metric         |
| `sort`        | string |       no | `desc`             | `asc`, `desc`                                      | Ranking order          |
| `limit`       | number |       no | `20`               | positive int                                       | Max ranking rows       |
| `year`        | number |       no | -                  | any                                                | Optional filter        |
| `month`       | number |       no | -                  | `1..12`                                            | Optional filter        |
| `week_number` | number |       no | -                  | `1..53`                                            | Optional filter        |
| `shop_id`     | string |       no | -                  | ObjectId                                           | Optional scoped filter |
| `from`        | date   |       no | auto               | valid date                                         | Window start           |
| `to`          | date   |       no | auto               | valid date                                         | Window end             |

Example:

```http
GET /api/store-reports/analytics/store-ranking?view=admin_weekly&report_type=weekly_financial&metric=revenue&sort=desc&limit=10
```

### 3) Trends API (Total + By Shop)

```http
GET /api/store-reports/analytics/trends
```

Useful for metric trend chart where FE can show total line + selected shop lines in one call.

Query parameters:

| Param              | Type   | Required | Default            | Allowed                                            | Notes                        |
| ------------------ | ------ | -------: | ------------------ | -------------------------------------------------- | ---------------------------- |
| `view`             | string |       no | `reconciled`       | `excel_raw`, `admin_weekly`, `reconciled`          | Data source selection        |
| `report_type`      | string |       no | `weekly_financial` | `weekly_financial`, `monthly_store_kpi`            | Data family                  |
| `metric`           | string |       no | `revenue`          | `revenue`, `profit`, `orders`, `averageOrderValue` | Trend metric                 |
| `granularity`      | string |       no | `week`             | `week`, `month`                                    | Series bucket size           |
| `top_n`            | number |       no | `5`                | positive int                                       | Top shops to include         |
| `selected_shop_id` | string |       no | -                  | ObjectId                                           | Always include selected shop |
| `year`             | number |       no | -                  | any                                                | Optional filter              |
| `month`            | number |       no | -                  | `1..12`                                            | Optional filter              |
| `week_number`      | number |       no | -                  | `1..53`                                            | Optional filter              |
| `shop_id`          | string |       no | -                  | ObjectId                                           | Optional scoped filter       |
| `from`             | date   |       no | auto               | valid date                                         | Window start                 |
| `to`               | date   |       no | auto               | valid date                                         | Window end                   |

Example:

```http
GET /api/store-reports/analytics/trends?view=reconciled&report_type=weekly_financial&metric=revenue&granularity=week&top_n=5&selected_shop_id=<SHOP_ID>
```

### 4) Sales Chart API (Chart-Ready)

```http
GET /api/store-reports/analytics/charts/sales
```

Dedicated chart payload for sales graph.

Query parameters:

| Param              | Type   | Required | Default            | Allowed                                   | Notes                        |
| ------------------ | ------ | -------: | ------------------ | ----------------------------------------- | ---------------------------- |
| `view`             | string |       no | `reconciled`       | `excel_raw`, `admin_weekly`, `reconciled` | Data source selection        |
| `report_type`      | string |       no | `weekly_financial` | `weekly_financial`, `monthly_store_kpi`   | Data family                  |
| `granularity`      | string |       no | `week`             | `week`, `month`                           | Series bucket size           |
| `top_n`            | number |       no | `8`                | positive int                              | Top shops returned           |
| `selected_shop_id` | string |       no | -                  | ObjectId                                  | Include selected shop series |
| `year`             | number |       no | -                  | any                                       | Optional filter              |
| `month`            | number |       no | -                  | `1..12`                                   | Optional filter              |
| `week_number`      | number |       no | -                  | `1..53`                                   | Optional filter              |
| `shop_id`          | string |       no | -                  | ObjectId                                  | Optional scoped filter       |
| `from`             | date   |       no | auto               | valid date                                | Window start                 |
| `to`               | date   |       no | auto               | valid date                                | Window end                   |

Response includes:

- `total.series` (overall sales trend)
- `shops[].series` (shop-level sales trends)

Example:

```http
GET /api/store-reports/analytics/charts/sales?view=reconciled&report_type=weekly_financial&granularity=week&top_n=8&selected_shop_id=<SHOP_ID>
```

This is ideal for FE behavior: select shop from dropdown and draw selected-shop line + total line from same API response.

---

## Frontend Integration Checklist

- Send auth token in `Authorization` header
- Handle `403` as permission issue (show access denied)
- Treat `comparisons.wow` / `comparisons.yoy` as nullable based on `compare` query
- Render zeros safely when KPI fields are absent
- Use `window.from/to` from response for consistent labels
- Read `capabilities` flags to hide unsupported charts
