# Analytics v2 — Frontend Integration Guide

Complete reference for building the new financial analytics dashboard.

- **Base URL (local):** `http://localhost:3000`
- **Base URL (prod):** `https://subway-viral.vercel.app`
- **Auth:** Bearer JWT token in `Authorization` header
- **Permission required:** `can_view_all_staff`

---

## Table of Contents

1. [Available Metrics — Reference Table](#1-available-metrics--reference-table)
2. [Endpoint 1 — KPI Matrix](#2-endpoint-1--kpi-matrix)
3. [Endpoint 2 — Shop Compare](#3-endpoint-2--shop-compare)
4. [Endpoint 3 — Period Compare](#4-endpoint-3--period-compare)
5. [Endpoint 4 — Trend](#5-endpoint-4--trend)
6. [Recommended Chart Types](#6-recommended-chart-types)
7. [Dashboard UX Patterns](#7-dashboard-ux-patterns)
8. [Postman Collection](#8-postman-collection)

---

## 1. Available Metrics — Reference Table

Every numeric field that can be queried by name (`metrics=...`) and that appears in every response.

| Metric Key          | Label               | Unit  | Description                                  |
| ------------------- | ------------------- | ----- | -------------------------------------------- |
| `grossSales`        | Gross Sales         | £     | Total sales including VAT (top-line revenue) |
| `netSales`          | Net Sales           | £     | Sales excluding VAT                          |
| `vat`               | VAT                 | £     | VAT amount collected                         |
| `vatPercent`        | VAT %               | %     | VAT as % of gross sales                      |
| `adjustedVat`       | Adjusted VAT        | £     | VAT after adjustments                        |
| `labour`            | Labour Cost         | £     | Total labour cost                            |
| `labourHours`       | Labour Hours        | hours | Total hours worked                           |
| `labourPercent`     | Labour %            | %     | Labour cost as % of net sales                |
| `foodCost`          | Food Cost (Bidfood) | £     | Cost of food/ingredients                     |
| `foodCostPercent`   | Food Cost %         | %     | Food cost as % of net sales                  |
| `justeat`           | Just Eat Sales      | £     | Revenue from Just Eat                        |
| `ubereat`           | Uber Eats Sales     | £     | Revenue from Uber Eats                       |
| `deliveroo`         | Deliveroo Sales     | £     | Revenue from Deliveroo                       |
| `total3pd`          | Total 3PD Sales     | £     | All third-party delivery combined            |
| `deliveryPercent`   | Delivery %          | %     | 3PD sales as % of gross sales                |
| `commission`        | Commission          | £     | 3PD commission paid                          |
| `commissionPercent` | Commission %        | %     | Commission as % of gross sales               |
| `customerCount`     | Customer Count      | count | Number of customers                          |
| `income`            | Net Income          | £     | Profit (net sales – costs)                   |
| `totalCostPercent`  | Total Cost %        | %     | All costs combined as %                      |
| `instore`           | In-Store Sales      | £     | grossSales – total3pd (computed)             |
| `avgOrderValue`     | Avg Order Value     | £     | grossSales / customerCount (computed)        |

> **Note:** Percentage values are returned as `0–100` numbers (e.g. `22.5` means 22.5%).

---

## 2. Endpoint 1 — KPI Matrix

The main dashboard endpoint. Returns **every metric**, totalled and broken down per shop, with optional comparison to a previous period.

### Endpoint

```
GET /api/store-reports/analytics/v2/kpi-matrix
```

### Query Parameters

| Param          | Type     | Required | Default            | Description                                 |
| -------------- | -------- | -------- | ------------------ | ------------------------------------------- |
| `from_date`    | ISO date | no       | min in data        | Start of current period (e.g. `2025-01-01`) |
| `to_date`      | ISO date | no       | max in data        | End of current period                       |
| `shop_ids`     | string   | no       | all                | Comma-separated shop IDs                    |
| `compare_from` | ISO date | no       | none               | Start of comparison period                  |
| `compare_to`   | ISO date | no       | none               | End of comparison period                    |
| `report_type`  | string   | no       | `weekly_financial` | `weekly_financial` or `monthly_store_kpi`   |
| `view`         | string   | no       | `reconciled`       | `reconciled` / `excel_raw` / `admin_weekly` |

### cURL Example

```bash
curl -X GET "http://localhost:3000/api/store-reports/analytics/v2/kpi-matrix?from_date=2025-01-01&to_date=2025-12-31&compare_from=2024-01-01&compare_to=2024-12-31" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Filtered by specific shops

```bash
curl -X GET "http://localhost:3000/api/store-reports/analytics/v2/kpi-matrix?from_date=2025-01-01&to_date=2025-12-31&shop_ids=69f4c6243a7e3e41d36af715,69f4c6f03a7e3e41d36af722" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response (truncated)

```json
{
  "status": 200,
  "message": "KPI matrix fetched successfully",
  "data": {
    "period": { "from": "2025-01-01", "to": "2025-12-31" },
    "compare_period": { "from": "2024-01-01", "to": "2024-12-31" },
    "total": {
      "current": {
        "grossSales": 13011976.26,
        "netSales": 10515477.74,
        "vat": 2496498.52,
        "vatPercent": 19.19,
        "adjustedVat": 1577385.66,
        "labour": 2393451.0,
        "labourHours": 168523.4,
        "labourPercent": 22.76,
        "foodCost": 2559711.19,
        "foodCostPercent": 24.34,
        "justeat": 485054.8,
        "ubereat": 1813847.88,
        "deliveroo": 1178828.64,
        "total3pd": 3477731.32,
        "deliveryPercent": 26.73,
        "commission": 1951883.45,
        "commissionPercent": 15.0,
        "customerCount": 1117815,
        "income": 5611000.0,
        "totalCostPercent": 67.84,
        "instore": 9534244.94,
        "instorePercent": 73.27,
        "threePdPercent": 26.73,
        "avgOrderValue": 11.64
      },
      "compare": {
        "grossSales": 11250000.0,
        "netSales": 9100000.0,
        "labour": 2150000.0,
        "labourPercent": 23.63
      },
      "delta": {
        "grossSales": {
          "current": 13011976.26,
          "compare": 11250000.0,
          "change": 1761976.26,
          "changePct": 15.66
        },
        "labour": {
          "current": 2393451.0,
          "compare": 2150000.0,
          "change": 243451.0,
          "changePct": 11.32
        },
        "labourPercent": {
          "current": 22.76,
          "compare": 23.63,
          "change": -0.87,
          "changePct": -3.68
        },
        "foodCost": {
          "current": 2559711.19,
          "compare": 2280000.0,
          "change": 279711.19,
          "changePct": 12.27
        }
      },
      "record_count": 519
    },
    "shops": [
      {
        "shopId": "69f4c6f03a7e3e41d36af722",
        "shopName": "baket st",
        "current": { "grossSales": 1850000.0, "labour": 380000.0, "labourPercent": 24.56 },
        "compare": { "grossSales": 1620000.0, "labour": 350000.0, "labourPercent": 25.1 },
        "delta": {
          "grossSales": {
            "current": 1850000,
            "compare": 1620000,
            "change": 230000,
            "changePct": 14.2
          }
        },
        "record_count": 52
      }
      /* ... one entry per shop, sorted by current grossSales DESC ... */
    ],
    "metric_keys": ["grossSales", "netSales", "vat", "vatPercent" /* ... */]
  }
}
```

### How to render

- **Top stats cards (4–6 cards):** `grossSales`, `netSales`, `labourPercent`, `foodCostPercent`, `avgOrderValue`, `customerCount` — show the `current` value and the `changePct` as a green ↑ / red ↓ chip.
- **Shop ranking table:** loop through `data.shops`, one row per shop. Show all key metrics in columns.
- **Cost breakdown donut:** use `total.current.labour`, `foodCost`, `commission`, and `income` as 4 slices.
- **3PD breakdown bar:** use `justeat`, `ubereat`, `deliveroo`.

---

## 3. Endpoint 2 — Shop Compare

Side-by-side comparison: pick N shops, pick which metrics to show.

### Endpoint

```
GET /api/store-reports/analytics/v2/shop-compare
```

### Query Parameters

| Param         | Type     | Required | Description                                 |
| ------------- | -------- | -------- | ------------------------------------------- |
| `shop_ids`    | string   | **yes**  | Comma-separated shop IDs (min 1)            |
| `from_date`   | ISO date | no       | Start of period                             |
| `to_date`     | ISO date | no       | End of period                               |
| `metrics`     | string   | no       | Comma-separated metric keys (default: all)  |
| `report_type` | string   | no       | `weekly_financial` or `monthly_store_kpi`   |
| `view`        | string   | no       | `reconciled` / `excel_raw` / `admin_weekly` |

### cURL Example

```bash
curl -X GET "http://localhost:3000/api/store-reports/analytics/v2/shop-compare?from_date=2025-01-01&to_date=2025-12-31&shop_ids=69f4c6243a7e3e41d36af715,69f4c6f03a7e3e41d36af722,69f4c7823a7e3e41d36af730&metrics=grossSales,netSales,labour,labourPercent,foodCost,foodCostPercent,customerCount,avgOrderValue" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response

```json
{
  "status": 200,
  "message": "Shop comparison fetched successfully",
  "data": {
    "period": { "from": "2025-01-01", "to": "2025-12-31" },
    "shops": [
      { "shopId": "69f4c6243a7e3e41d36af715", "shopName": "paddington", "record_count": 52 },
      { "shopId": "69f4c6f03a7e3e41d36af722", "shopName": "baket st", "record_count": 52 },
      { "shopId": "69f4c7823a7e3e41d36af730", "shopName": "swiss cottage", "record_count": 52 }
    ],
    "metrics": [
      "grossSales",
      "netSales",
      "labour",
      "labourPercent",
      "foodCost",
      "foodCostPercent",
      "customerCount",
      "avgOrderValue"
    ],
    "matrix": [
      {
        "metric": "grossSales",
        "69f4c6243a7e3e41d36af715": 1250000.0,
        "69f4c6f03a7e3e41d36af722": 1850000.0,
        "69f4c7823a7e3e41d36af730": 980000.0,
        "total": 4080000.0,
        "best_shop": {
          "shopId": "69f4c6f03a7e3e41d36af722",
          "shopName": "baket st",
          "value": 1850000.0
        }
      },
      {
        "metric": "labourPercent",
        "69f4c6243a7e3e41d36af715": 23.5,
        "69f4c6f03a7e3e41d36af722": 24.56,
        "69f4c7823a7e3e41d36af730": 28.1,
        "total": 25.05,
        "best_shop": {
          "shopId": "69f4c6f03a7e3e41d36af722",
          "shopName": "baket st",
          "value": 24.56
        }
      }
      /* ... one row per metric ... */
    ],
    "kpis": {
      "69f4c6243a7e3e41d36af715": {
        "grossSales": 1250000,
        "netSales": 1050000,
        "labour": 246750 /* all metrics */
      },
      "69f4c6f03a7e3e41d36af722": { "grossSales": 1850000 /* ... */ },
      "69f4c7823a7e3e41d36af730": { "grossSales": 980000 /* ... */ }
    }
  }
}
```

### How to render

- **Comparison table:** `data.matrix` is already a row-by-row matrix. Render as `<table>` with first column = `metric`, then one column per shop. Highlight `best_shop` cell with a green dot or trophy icon.
- **Grouped bar chart:** for each metric, group bars by shop (3 bars per metric group).
- **Radar chart:** plot 6–8 metrics on axes, one polygon per shop — great for at-a-glance multi-dimensional comparison.

---

## 4. Endpoint 3 — Period Compare

Compare two arbitrary date ranges. Perfect for "Q1 2025 vs Q1 2024" or "this month vs last month".

### Endpoint

```
GET /api/store-reports/analytics/v2/period-compare
```

### Query Parameters

| Param          | Type     | Required | Description                                 |
| -------------- | -------- | -------- | ------------------------------------------- |
| `current_from` | ISO date | **yes**  | Start of current period                     |
| `current_to`   | ISO date | **yes**  | End of current period                       |
| `compare_from` | ISO date | **yes**  | Start of comparison period                  |
| `compare_to`   | ISO date | **yes**  | End of comparison period                    |
| `shop_ids`     | string   | no       | Comma-separated shop IDs                    |
| `metrics`      | string   | no       | Comma-separated metric keys                 |
| `report_type`  | string   | no       | `weekly_financial` or `monthly_store_kpi`   |
| `view`         | string   | no       | `reconciled` / `excel_raw` / `admin_weekly` |

### cURL Example — YoY same-quarter compare

```bash
curl -X GET "http://localhost:3000/api/store-reports/analytics/v2/period-compare?current_from=2025-01-01&current_to=2025-03-31&compare_from=2024-01-01&compare_to=2024-03-31&metrics=grossSales,netSales,labour,labourPercent,foodCost,customerCount" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response

```json
{
  "status": 200,
  "message": "Period comparison fetched successfully",
  "data": {
    "current_period": { "from": "2025-01-01", "to": "2025-03-31", "record_count": 130 },
    "compare_period": { "from": "2024-01-01", "to": "2024-03-31", "record_count": 130 },
    "metrics": ["grossSales", "netSales", "labour", "labourPercent", "foodCost", "customerCount"],
    "total": {
      "current": {
        "grossSales": 3250000,
        "netSales": 2630000,
        "labour": 600000,
        "labourPercent": 22.81,
        "foodCost": 640000,
        "customerCount": 280000
      },
      "compare": {
        "grossSales": 2810000,
        "netSales": 2275000,
        "labour": 540000,
        "labourPercent": 23.74,
        "foodCost": 570000,
        "customerCount": 248000
      },
      "delta": {
        "grossSales": {
          "current": 3250000,
          "compare": 2810000,
          "change": 440000,
          "changePct": 15.66
        },
        "netSales": { "current": 2630000, "compare": 2275000, "change": 355000, "changePct": 15.6 },
        "labour": { "current": 600000, "compare": 540000, "change": 60000, "changePct": 11.11 },
        "labourPercent": {
          "current": 22.81,
          "compare": 23.74,
          "change": -0.93,
          "changePct": -3.92
        },
        "foodCost": { "current": 640000, "compare": 570000, "change": 70000, "changePct": 12.28 },
        "customerCount": {
          "current": 280000,
          "compare": 248000,
          "change": 32000,
          "changePct": 12.9
        }
      }
    },
    "shops": [
      {
        "shopId": "69f4c6f03a7e3e41d36af722",
        "shopName": "baket st",
        "current": {
          "grossSales": 462500,
          "netSales": 374000,
          "labour": 86250,
          "labourPercent": 23.06,
          "foodCost": 91250,
          "customerCount": 39800
        },
        "compare": {
          "grossSales": 405000,
          "netSales": 328000,
          "labour": 78000,
          "labourPercent": 23.78,
          "foodCost": 82000,
          "customerCount": 35200
        },
        "delta": {
          "grossSales": { "current": 462500, "compare": 405000, "change": 57500, "changePct": 14.2 }
        }
      }
      /* ... per shop ... */
    ]
  }
}
```

### How to render

- **Comparison cards (one per metric):** show `current` big number, `compare` small underneath, `changePct` as colored badge.
- **Waterfall chart:** show the breakdown of change from compare → current.
- **Per-shop change ranking:** sort `data.shops` by `delta.grossSales.changePct` to see which shops grew the most.
- **YoY % bar chart:** for each shop, bar height = `delta.grossSales.changePct`.

---

## 5. Endpoint 4 — Trend

Time series for any metric(s). Drives all line/area charts.

### Endpoint

```
GET /api/store-reports/analytics/v2/trend
```

### Query Parameters

| Param         | Type     | Required | Description                                 |
| ------------- | -------- | -------- | ------------------------------------------- |
| `from_date`   | ISO date | no       | Start of period                             |
| `to_date`     | ISO date | no       | End of period                               |
| `metrics`     | string   | no       | Comma-separated metric keys (default: all)  |
| `granularity` | string   | no       | `week` (default) or `month`                 |
| `group_by`    | string   | no       | `total` (default) or `shop`                 |
| `shop_ids`    | string   | no       | Comma-separated shop IDs                    |
| `report_type` | string   | no       | `weekly_financial` or `monthly_store_kpi`   |
| `view`        | string   | no       | `reconciled` / `excel_raw` / `admin_weekly` |

### cURL Example — monthly grossSales + labour trend

```bash
curl -X GET "http://localhost:3000/api/store-reports/analytics/v2/trend?from_date=2024-01-01&to_date=2025-12-31&metrics=grossSales,labour,foodCost&granularity=month&group_by=total" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### cURL Example — weekly per-shop labour %

```bash
curl -X GET "http://localhost:3000/api/store-reports/analytics/v2/trend?from_date=2025-01-01&to_date=2025-12-31&metrics=labourPercent&granularity=week&group_by=shop&shop_ids=69f4c6243a7e3e41d36af715,69f4c6f03a7e3e41d36af722,69f4c7823a7e3e41d36af730" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response — `group_by=total`

```json
{
  "status": 200,
  "message": "Trend data fetched successfully",
  "data": {
    "period": { "from": "2024-01-01", "to": "2025-12-31" },
    "granularity": "month",
    "metrics": ["grossSales", "labour", "foodCost"],
    "group_by": "total",
    "total": {
      "kpis": { "grossSales": 24261976.26, "labour": 4543451.0, "foodCost": 4839711.19 },
      "series": [
        {
          "periodKey": "2024-01",
          "label": "Jan 2024",
          "year": 2024,
          "month": 1,
          "weekNumber": null,
          "grossSales": 945000,
          "labour": 220000,
          "foodCost": 210000
        },
        {
          "periodKey": "2024-02",
          "label": "Feb 2024",
          "year": 2024,
          "month": 2,
          "weekNumber": null,
          "grossSales": 880000,
          "labour": 205000,
          "foodCost": 195000
        },
        {
          "periodKey": "2024-03",
          "label": "Mar 2024",
          "year": 2024,
          "month": 3,
          "weekNumber": null,
          "grossSales": 985000,
          "labour": 230000,
          "foodCost": 220000
        }
        /* ... up to Dec 2025 ... */
      ]
    },
    "shops": null,
    "data_points": 24
  }
}
```

### Response — `group_by=shop`

```json
{
  "data": {
    "metrics": ["labourPercent"],
    "group_by": "shop",
    "total": {
      "kpis": { "labourPercent": 22.76 },
      "series": [
        { "periodKey": "2025-01-W01", "label": "W01 30/12 to 05/01", "labourPercent": 23.1 }
        /* ... */
      ]
    },
    "shops": [
      {
        "shopId": "69f4c6f03a7e3e41d36af722",
        "shopName": "baket st",
        "total": { "labourPercent": 24.56 },
        "series": [
          { "periodKey": "2025-01-W01", "label": "W01 30/12 to 05/01", "labourPercent": 23.5 },
          { "periodKey": "2025-01-W02", "label": "W02 06/01 to 12/01", "labourPercent": 24.2 }
          /* ... 52 weekly points ... */
        ]
      }
      /* ... one entry per shop ... */
    ]
  }
}
```

### How to render

- **Single-series line chart** (`group_by=total`, 1 metric): X = `series[].label`, Y = `series[].grossSales`.
- **Multi-metric line chart** (`group_by=total`, N metrics): one line per metric, all share X axis. Use dual Y-axis if mixing £ and %.
- **Multi-shop line chart** (`group_by=shop`, 1 metric): one line per shop in `data.shops[].series`.
- **Stacked area chart** for `justeat + ubereat + deliveroo + instore` over time — request `metrics=justeat,ubereat,deliveroo,instore`.

---

## 6. Recommended Chart Types

| Use Case                     | Endpoint                                                     | Chart Library Suggestion                                           |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| KPI hero cards               | `kpi-matrix` (`total.current.*`)                             | Plain CSS / shadcn `<Card>`                                        |
| Cost-vs-revenue donut        | `kpi-matrix`                                                 | Recharts `<PieChart>` (4 slices: labour, food, commission, income) |
| 3PD breakdown bar            | `kpi-matrix`                                                 | Recharts `<BarChart>`                                              |
| Shop ranking table           | `kpi-matrix.shops[]`                                         | shadcn `<Table>`                                                   |
| Side-by-side metrics         | `shop-compare.matrix[]`                                      | shadcn `<Table>` + sparkline column                                |
| Radar comparison             | `shop-compare.kpis`                                          | Recharts `<RadarChart>`                                            |
| YoY % change                 | `period-compare.shops[].delta`                               | Horizontal bar chart                                               |
| Revenue over time            | `trend` group_by=total, metric=grossSales, granularity=month | Recharts `<LineChart>` or `<AreaChart>`                            |
| Multi-shop comparison line   | `trend` group_by=shop                                        | Recharts `<LineChart>` with one `<Line>` per shop                  |
| Labour % vs Food % over time | `trend` metrics=labourPercent,foodCostPercent                | Dual-axis line chart                                               |
| Channel mix stacked          | `trend` metrics=justeat,ubereat,deliveroo,instore            | Recharts `<AreaChart stackId="1">`                                 |
| Period-over-period stat      | `period-compare.total.delta`                                 | `<Card>` with up/down arrow                                        |

---

## 7. Dashboard UX Patterns

### Filter Bar (shared across all endpoints)

```jsx
<FilterBar>
  <DateRangePicker value={[fromDate, toDate]} onChange={setRange} />
  <MultiShopSelect value={shopIds} onChange={setShopIds} />
  <CompareDateRangePicker value={[compareFrom, compareTo]} onChange={setCompareRange} />
  <ReportTypeToggle value={reportType} onChange={setReportType} />
</FilterBar>
```

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Filter Bar                                              │
├─────────────────────────────────────────────────────────┤
│ Row 1 — KPI Cards (from kpi-matrix → total.current)     │
│ [Gross £] [Net £] [Labour%] [Food%] [Cust Count] [AOV]  │
├─────────────────────────────────────────────────────────┤
│ Row 2 — Charts (from trend)                             │
│ ┌─Revenue Line───────────┐ ┌─Labour% / Food% Line──┐    │
│ └────────────────────────┘ └───────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│ Row 3 — Channel Mix (from kpi-matrix → total.current)   │
│ ┌─3PD Donut──────────────┐ ┌─In-Store vs 3PD Bar───┐    │
│ └────────────────────────┘ └───────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│ Row 4 — Shop Ranking Table (from kpi-matrix → shops[])  │
│ Shop | Gross | Labour% | Food% | YoY Δ | Avg Order      │
├─────────────────────────────────────────────────────────┤
│ Row 5 — Period Compare (from period-compare)            │
│ Side-by-side cards for last 4 quarters vs YoY           │
└─────────────────────────────────────────────────────────┘
```

### Performance tips

- All four endpoints can be called **in parallel** with `Promise.all()`.
- Cache the `kpi-matrix` response — it's the heaviest. Re-fetch only when filters change.
- For the trend chart, use `granularity=month` for ranges > 3 months, otherwise `week`.
- Lazy-load the `shop-compare` endpoint until the user picks shops.

---

## 8. Postman Collection

Save as `analytics-v2.postman_collection.json` and import to Postman.

```json
{
  "info": {
    "name": "Subway — Analytics v2",
    "description": "Financial analytics dashboard endpoints",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "base_url", "value": "http://localhost:3000" },
    { "key": "jwt", "value": "PASTE_YOUR_TOKEN_HERE" },
    { "key": "shop_id_1", "value": "69f4c6243a7e3e41d36af715" },
    { "key": "shop_id_2", "value": "69f4c6f03a7e3e41d36af722" },
    { "key": "shop_id_3", "value": "69f4c7823a7e3e41d36af730" }
  ],
  "auth": {
    "type": "bearer",
    "bearer": [{ "key": "token", "value": "{{jwt}}", "type": "string" }]
  },
  "item": [
    {
      "name": "1. KPI Matrix — All shops, 2025 vs 2024",
      "request": {
        "method": "GET",
        "header": [],
        "url": {
          "raw": "{{base_url}}/api/store-reports/analytics/v2/kpi-matrix?from_date=2025-01-01&to_date=2025-12-31&compare_from=2024-01-01&compare_to=2024-12-31",
          "host": ["{{base_url}}"],
          "path": ["api", "store-reports", "analytics", "v2", "kpi-matrix"],
          "query": [
            { "key": "from_date", "value": "2025-01-01" },
            { "key": "to_date", "value": "2025-12-31" },
            { "key": "compare_from", "value": "2024-01-01" },
            { "key": "compare_to", "value": "2024-12-31" }
          ]
        }
      }
    },
    {
      "name": "1b. KPI Matrix — Selected shops, no compare",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/store-reports/analytics/v2/kpi-matrix?from_date=2025-01-01&to_date=2025-06-30&shop_ids={{shop_id_1}},{{shop_id_2}}",
          "host": ["{{base_url}}"],
          "path": ["api", "store-reports", "analytics", "v2", "kpi-matrix"],
          "query": [
            { "key": "from_date", "value": "2025-01-01" },
            { "key": "to_date", "value": "2025-06-30" },
            { "key": "shop_ids", "value": "{{shop_id_1}},{{shop_id_2}}" }
          ]
        }
      }
    },
    {
      "name": "2. Shop Compare — 3 shops side by side",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/store-reports/analytics/v2/shop-compare?from_date=2025-01-01&to_date=2025-12-31&shop_ids={{shop_id_1}},{{shop_id_2}},{{shop_id_3}}&metrics=grossSales,netSales,labour,labourPercent,foodCost,foodCostPercent,customerCount,avgOrderValue",
          "host": ["{{base_url}}"],
          "path": ["api", "store-reports", "analytics", "v2", "shop-compare"],
          "query": [
            { "key": "from_date", "value": "2025-01-01" },
            { "key": "to_date", "value": "2025-12-31" },
            { "key": "shop_ids", "value": "{{shop_id_1}},{{shop_id_2}},{{shop_id_3}}" },
            {
              "key": "metrics",
              "value": "grossSales,netSales,labour,labourPercent,foodCost,foodCostPercent,customerCount,avgOrderValue"
            }
          ]
        }
      }
    },
    {
      "name": "3. Period Compare — Q1 2025 vs Q1 2024",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/store-reports/analytics/v2/period-compare?current_from=2025-01-01&current_to=2025-03-31&compare_from=2024-01-01&compare_to=2024-03-31&metrics=grossSales,netSales,labour,labourPercent,foodCost,customerCount",
          "host": ["{{base_url}}"],
          "path": ["api", "store-reports", "analytics", "v2", "period-compare"],
          "query": [
            { "key": "current_from", "value": "2025-01-01" },
            { "key": "current_to", "value": "2025-03-31" },
            { "key": "compare_from", "value": "2024-01-01" },
            { "key": "compare_to", "value": "2024-03-31" },
            {
              "key": "metrics",
              "value": "grossSales,netSales,labour,labourPercent,foodCost,customerCount"
            }
          ]
        }
      }
    },
    {
      "name": "4. Trend — Monthly revenue + labour, all shops total",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/store-reports/analytics/v2/trend?from_date=2024-01-01&to_date=2025-12-31&metrics=grossSales,labour,foodCost&granularity=month&group_by=total",
          "host": ["{{base_url}}"],
          "path": ["api", "store-reports", "analytics", "v2", "trend"],
          "query": [
            { "key": "from_date", "value": "2024-01-01" },
            { "key": "to_date", "value": "2025-12-31" },
            { "key": "metrics", "value": "grossSales,labour,foodCost" },
            { "key": "granularity", "value": "month" },
            { "key": "group_by", "value": "total" }
          ]
        }
      }
    },
    {
      "name": "4b. Trend — Weekly labour % per shop",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/store-reports/analytics/v2/trend?from_date=2025-01-01&to_date=2025-12-31&metrics=labourPercent&granularity=week&group_by=shop&shop_ids={{shop_id_1}},{{shop_id_2}},{{shop_id_3}}",
          "host": ["{{base_url}}"],
          "path": ["api", "store-reports", "analytics", "v2", "trend"],
          "query": [
            { "key": "from_date", "value": "2025-01-01" },
            { "key": "to_date", "value": "2025-12-31" },
            { "key": "metrics", "value": "labourPercent" },
            { "key": "granularity", "value": "week" },
            { "key": "group_by", "value": "shop" },
            { "key": "shop_ids", "value": "{{shop_id_1}},{{shop_id_2}},{{shop_id_3}}" }
          ]
        }
      }
    },
    {
      "name": "4c. Trend — Channel mix stacked area",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/store-reports/analytics/v2/trend?from_date=2025-01-01&to_date=2025-12-31&metrics=justeat,ubereat,deliveroo,instore&granularity=month",
          "host": ["{{base_url}}"],
          "path": ["api", "store-reports", "analytics", "v2", "trend"],
          "query": [
            { "key": "from_date", "value": "2025-01-01" },
            { "key": "to_date", "value": "2025-12-31" },
            { "key": "metrics", "value": "justeat,ubereat,deliveroo,instore" },
            { "key": "granularity", "value": "month" }
          ]
        }
      }
    }
  ]
}
```

---

## 9. Error Responses

All endpoints return standard error envelopes:

```json
{
  "status": 400,
  "message": "Unknown metric(s): foo. Valid: grossSales, netSales, ...",
  "data": {}
}
```

| HTTP | When                                                          |
| ---- | ------------------------------------------------------------- |
| 400  | Invalid metric name, missing required params, bad date format |
| 401  | Missing/invalid JWT                                           |
| 403  | User lacks `can_view_all_staff` permission                    |
| 500  | Unexpected server error                                       |

---

## 10. Quick start for FE devs

1. **Get a JWT** by logging in via `POST /api/auth/login`.
2. **List shops** via `GET /api/shops` — store the `_id` and `name` for the filter dropdown.
3. **Load the dashboard** by parallel-calling all 4 endpoints with the user's filter selections:
   ```js
   const [matrix, compare, trendRevenue, trendLabour] = await Promise.all([
     api.get('/api/store-reports/analytics/v2/kpi-matrix', { params: filters }),
     api.get('/api/store-reports/analytics/v2/period-compare', {
       params: { ...filters, ...compareParams },
     }),
     api.get('/api/store-reports/analytics/v2/trend', {
       params: { ...filters, metrics: 'grossSales', granularity: 'month' },
     }),
     api.get('/api/store-reports/analytics/v2/trend', {
       params: { ...filters, metrics: 'labourPercent,foodCostPercent', granularity: 'week' },
     }),
   ]);
   ```
4. **Pipe responses straight to chart components** — no transformation needed; the API returns chart-ready shapes.
