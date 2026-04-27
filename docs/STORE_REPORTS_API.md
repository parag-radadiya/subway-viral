# Store Reports API Reference

> **Base URL:** `http://localhost:5000/api/store-reports`
>
> **Auth:** All endpoints require `Authorization: Bearer <token>` header.

---

## Table of Contents

| #   | Method | Endpoint                      | Permission           | Description                                                  |
| --- | ------ | ----------------------------- | -------------------- | ------------------------------------------------------------ |
| 1   | POST   | `/import-excel`               | `can_manage_rotas`   | Import weekly data from Excel file                           |
| 2   | POST   | `/import-historical-workbook` | `can_manage_rotas`   | Bulk import historical workbook (3 sheets)                   |
| 3   | POST   | `/admin-weekly`               | `can_manage_rotas`   | Upsert admin weekly report entries                           |
| 4   | GET    | `/table`                      | `can_view_all_staff` | Paginated report table (excel_raw, admin_weekly, reconciled) |
| 5   | GET    | `/analytics/summary`          | `can_view_all_staff` | KPI summary with WoW/YoY comparison                          |
| 6   | GET    | `/analytics/store-ranking`    | `can_view_all_staff` | Store ranking by selected metric                             |
| 7   | GET    | `/analytics/trends`           | `can_view_all_staff` | Trend data (total + by-shop series)                          |
| 8   | GET    | `/analytics/charts/sales`     | `can_view_all_staff` | Sales chart data                                             |
| 9   | GET    | `/analytics/dashboard`        | `can_view_all_staff` | Full dashboard analytics                                     |
| 10  | GET    | `/weekly`                     | `can_view_all_staff` | Get Weekly records                                           |
| 11  | POST   | `/weekly`                     | `can_manage_rotas`   | Add/update single Weekly entry                               |
| 12  | GET    | `/monthly-sale`               | `can_view_all_staff` | Get Monthly Sale records                                     |
| 13  | POST   | `/monthly-sale`               | `can_manage_rotas`   | Add/update single Monthly Sale entry                         |
| 14  | GET    | `/export`                     | `can_view_all_staff` | Export filtered database records to Excel (`.xlsx`)          |

---

## 1. Import Excel Data

Upload and import weekly financial data from an Excel file.

```bash
curl -X POST http://localhost:5000/api/store-reports/import-excel \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "/path/to/your/file.xlsx"
  }'
```

**Example Response:**

```json
{
  "status": 200,
  "message": "Excel data imported successfully",
  "data": {
    "imported": 52,
    "updated": 0,
    "failed": 0,
    "errors": []
  }
}
```

---

## 2. Import Historical Workbook

Bulk import from a workbook containing 3 sheets: `Jan-Dec 26`, `Weekly 2026`, `Monthly Sale 2026`.

> **Auto-creates shops** for unmatched store names with default values.

```bash
curl -X POST http://localhost:5000/api/store-reports/import-historical-workbook \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "/path/to/Book1.xlsx"
  }'
```

**Example Response:**

```json
{
  "status": 200,
  "message": "Historical workbook data imported successfully",
  "data": {
    "file_path": "/path/to/Book1.xlsx",
    "sheets": {
      "jan_dec_26": "Jan-Dec 26",
      "weekly_2026b": "Weekly 2026",
      "monthly_sale_2026": "Monthly Sale 2026"
    },
    "imported": {
      "store_report_entry": 120,
      "weekly_2026b": 52,
      "monthly_sale_2026": 342
    },
    "upserted": {
      "store_report_entry": 120,
      "weekly_2026b": 52,
      "monthly_sale_2026": 342
    },
    "failed": 0,
    "errors": []
  }
}
```

---

## 3. Upsert Admin Weekly Data

Add or update weekly report entries manually (supports multiple entries, month-crossing splits).

```bash
curl -X POST http://localhost:5000/api/store-reports/admin-weekly \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      {
        "shop_id": "663f1a2b3c4d5e6f7a8b9c0d",
        "report_type": "weekly_financial",
        "year": 2026,
        "month": 3,
        "week_number": 10,
        "metrics": {
          "net_sales": 5200,
          "uber_eats": 800,
          "deliveroo": 600,
          "just_eat": 400
        }
      }
    ]
  }'
```

---

## 4. Get Store Report Table

Paginated table of report entries. Supports filtering by view, shop, year, month, and grouping.

```bash
# Default (reconciled view)
curl "http://localhost:5000/api/store-reports/table" \
  -H "Authorization: Bearer YOUR_TOKEN"

# All views (excel_raw + admin_weekly + reconciled)
curl "http://localhost:5000/api/store-reports/table?view=all" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filtered by year, month, and shop
curl "http://localhost:5000/api/store-reports/table?year=2026&month=3&shop_id=663f..." \
  -H "Authorization: Bearer YOUR_TOKEN"

# Monthly grouping
curl "http://localhost:5000/api/store-reports/table?group_by=month&year=2026" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Paginated
curl "http://localhost:5000/api/store-reports/table?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**

| Param         | Type     | Description                                                              |
| ------------- | -------- | ------------------------------------------------------------------------ |
| `view`        | string   | `excel_raw`, `admin_weekly`, `reconciled`, `all` (default: `reconciled`) |
| `year`        | number   | Filter by year                                                           |
| `month`       | number   | Filter by month (1-12)                                                   |
| `week_number` | number   | Filter by week number                                                    |
| `shop_id`     | ObjectId | Filter by specific shop                                                  |
| `group_by`    | string   | `month` — aggregates weekly data into monthly rows                       |
| `page`        | number   | Page number (default: 1)                                                 |
| `limit`       | number   | Records per page (default: 20)                                           |

---

## 5. Analytics Summary

KPI totals with WoW (week-over-week) and YoY (year-over-year) comparison.

```bash
curl "http://localhost:5000/api/store-reports/analytics/summary?year=2026&month=3" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 6. Store Ranking

Stores ranked by a selected metric.

```bash
curl "http://localhost:5000/api/store-reports/analytics/store-ranking?year=2026&month=3&metric=net_sales" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 7. Trends

Trend data with total and by-shop series.

```bash
curl "http://localhost:5000/api/store-reports/analytics/trends?year=2026" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 8. Sales Chart

Sales chart data for visualization.

```bash
curl "http://localhost:5000/api/store-reports/analytics/charts/sales?year=2026" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 9. Dashboard Analytics

Full dashboard with KPIs, channel splits, growth charts, store breakdowns, and comparisons.

```bash
curl "http://localhost:5000/api/store-reports/analytics/dashboard?year=2026&month=3" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 10. GET Weekly Records

Paginated list of Weekly records with filtering.

```bash
# All records
curl "http://localhost:5000/api/store-reports/weekly" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filter by year and month
curl "http://localhost:5000/api/store-reports/weekly?year=2026&month=3" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filter by week number
curl "http://localhost:5000/api/store-reports/weekly?year=2026&month=3&week_number=10" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filter by store
curl "http://localhost:5000/api/store-reports/weekly?store_key=baker%20st" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filter by shop_id
curl "http://localhost:5000/api/store-reports/weekly?shop_id=663f1a2b3c4d5e6f7a8b9c0d" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Paginated
curl "http://localhost:5000/api/store-reports/weekly?year=2026&page=2&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**

| Param         | Type     | Description                     |
| ------------- | -------- | ------------------------------- |
| `year`        | number   | Filter by year                  |
| `month`       | number   | Filter by month (1-12)          |
| `week_number` | number   | Filter by week (1-53)           |
| `shop_id`     | ObjectId | Filter by shop                  |
| `store_key`   | string   | Filter by normalized store name |
| `page`        | number   | Page number (default: 1)        |
| `limit`       | number   | Records per page (default: 20)  |

**Example Response:**

```json
{
  "status": 200,
  "message": "Weekly 2026 records fetched",
  "data": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "count": 1,
    "rows": [
      {
        "_id": "663f...",
        "shop_id": {
          "_id": "663f1a2b3c4d5e6f7a8b9c0d",
          "name": "Baker Street"
        },
        "store_name_raw": "BAKER ST",
        "store_key": "baker st",
        "source_sheet": "Weekly 2026",
        "period_key": "2026-03-W10",
        "year": 2026,
        "month": 3,
        "week_number": 10,
        "week_start": "2026-03-02T00:00:00.000Z",
        "week_end": "2026-03-08T00:00:00.000Z",
        "week_range_label": "02/03 to 08/03",
        "metrics": {
          "sales": 4500,
          "net": 3200,
          "transactions": 120
        },
        "createdAt": "2026-04-26T18:00:00.000Z",
        "updatedAt": "2026-04-26T18:00:00.000Z"
      }
    ]
  }
}
```

---

## 11. POST Single Weekly Entry

Add or update a single weekly record. Auto-creates a shop if the store name doesn't exist.

```bash
curl -X POST http://localhost:5000/api/store-reports/weekly \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "store_name": "BAKER ST",
    "year": 2026,
    "month": 3,
    "week_number": 10,
    "week_range_label": "02/03 to 08/03",
    "metrics": {
      "sales": 4500,
      "net": 3200,
      "transactions": 120
    }
  }'
```

**Using shop_id instead of store_name:**

```bash
curl -X POST http://localhost:5000/api/store-reports/weekly \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "shop_id": "663f1a2b3c4d5e6f7a8b9c0d",
    "year": 2026,
    "month": 3,
    "week_number": 10,
    "metrics": {
      "sales": 4500,
      "net": 3200
    }
  }'
```

**Required Fields:**

| Field              | Type     | Required | Description                           |
| ------------------ | -------- | -------- | ------------------------------------- |
| `store_name`       | string   | Yes\*    | Store name (auto-creates shop if new) |
| `shop_id`          | ObjectId | Yes\*    | Or provide shop_id directly           |
| `year`             | number   | Yes      | Year (e.g., 2026)                     |
| `month`            | number   | Yes      | Month (1-12)                          |
| `week_number`      | number   | Yes      | Week of the year (1-53)               |
| `metrics`          | object   | Yes      | Key-value pairs of metric data        |
| `week_range_label` | string   | No       | e.g., "02/03 to 08/03"                |
| `source_sheet`     | string   | No       | Defaults to "Weekly 2026"             |

> \* Either `store_name` or `shop_id` is required.

---

## 12. GET Monthly Sale Records

Paginated list of Monthly Sale records with filtering.

```bash
# All records
curl "http://localhost:5000/api/store-reports/monthly-sale" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filter by year and month
curl "http://localhost:5000/api/store-reports/monthly-sale?year=2026&month=5" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Filter by store
curl "http://localhost:5000/api/store-reports/monthly-sale?store_key=camden" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Paginated
curl "http://localhost:5000/api/store-reports/monthly-sale?year=2026&page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**

| Param       | Type     | Description                     |
| ----------- | -------- | ------------------------------- |
| `year`      | number   | Filter by year                  |
| `month`     | number   | Filter by month (1-12)          |
| `shop_id`   | ObjectId | Filter by shop                  |
| `store_key` | string   | Filter by normalized store name |
| `page`      | number   | Page number (default: 1)        |
| `limit`     | number   | Records per page (default: 20)  |

**Example Response:**

```json
{
  "status": 200,
  "message": "Monthly Sale 2026 records fetched",
  "data": {
    "total": 2,
    "page": 1,
    "limit": 20,
    "count": 2,
    "rows": [
      {
        "_id": "663f...",
        "shop_id": {
          "_id": "663f1a2b3c4d5e6f7a8b9c0d",
          "name": "Camden"
        },
        "store_name_raw": "Camden",
        "store_key": "camden",
        "source_sheet": "Monthly Sale 2026",
        "period_key": "2026-05",
        "year": 2026,
        "month": 5,
        "metrics": {
          "grossSale": 12000,
          "netSale": 9500,
          "vat": 2500,
          "uber_eats": 1800,
          "deliveroo": 1200
        },
        "createdAt": "2026-04-26T18:00:00.000Z",
        "updatedAt": "2026-04-26T18:00:00.000Z"
      }
    ]
  }
}
```

---

## 13. POST Single Monthly Sale Entry

Add or update a single monthly record. Auto-creates a shop if the store name doesn't exist.

```bash
curl -X POST http://localhost:5000/api/store-reports/monthly-sale \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "store_name": "Camden",
    "year": 2026,
    "month": 5,
    "metrics": {
      "grossSale": 12000,
      "netSale": 9500,
      "vat": 2500,
      "uber_eats": 1800,
      "deliveroo": 1200,
      "just_eat": 900
    }
  }'
```

**Required Fields:**

| Field          | Type     | Required | Description                           |
| -------------- | -------- | -------- | ------------------------------------- |
| `store_name`   | string   | Yes\*    | Store name (auto-creates shop if new) |
| `shop_id`      | ObjectId | Yes\*    | Or provide shop_id directly           |
| `year`         | number   | Yes      | Year (e.g., 2026)                     |
| `month`        | number   | Yes      | Month (1-12)                          |
| `metrics`      | object   | Yes      | Key-value pairs of metric data        |
| `source_sheet` | string   | No       | Defaults to "Monthly Sale 2026"       |

> \* Either `store_name` or `shop_id` is required.

---

## 14. Export to Excel (NEW)

Download an Excel file (`.xlsx`) containing database records for Weekly and Monthly Sale sheets, matching the format of the original `Book1.xlsx`.

```bash
# Export EVERYTHING
curl -o full_report.xlsx "http://localhost:5000/api/store-reports/export" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export filtered by YEAR
curl -o report_2026.xlsx "http://localhost:5000/api/store-reports/export?year=2026" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export filtered by YEAR and MONTH
curl -o report_2026_03.xlsx "http://localhost:5000/api/store-reports/export?year=2026&month=3" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export filtered by store name
curl -o baker_st_report.xlsx "http://localhost:5000/api/store-reports/export?store_key=baker%20st" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export ONLY the Weekly sheet
curl -o weekly_only.xlsx "http://localhost:5000/api/store-reports/export?sheets=weekly" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Export ONLY the Monthly Sale sheet
curl -o monthly_only.xlsx "http://localhost:5000/api/store-reports/export?sheets=monthly" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Query Parameters:**

| Param       | Type     | Description                                             | Example                    |
| ----------- | -------- | ------------------------------------------------------- | -------------------------- |
| `year`      | number   | Filter completely by year                               | `?year=2026`               |
| `month`     | number   | Filter by month (1-12)                                  | `?month=3`                 |
| `shop_id`   | ObjectId | Filter by specific shop                                 | `?shop_id=663f1a2b3c4d...` |
| `store_key` | string   | Filter by normalized store name                         | `?store_key=baker st`      |
| `sheets`    | string   | Comma-separated sheets to include (`weekly`, `monthly`) | `?sheets=weekly,monthly`   |

**Response Details:**

- **Status:** 200 OK
- **Headers:** `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Body:** Binary Buffer of the `.xlsx` file.

**Output Structure:**
The exported file will contain tabs matching your request (e.g., `Weekly`, `Monthly Sale`). The structure inside matches the original Excel data format with dynamically constructed summary rows and columns based strictly on your data metrics.
