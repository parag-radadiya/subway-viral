# Store Report Historical Import API Guide

This guide explains how frontend clients can import historical Excel data into all store report collections using one API call.

## 1) Endpoint overview

- **Method:** `POST`
- **Path:** `/api/store-reports/import-historical-workbook`
- **Full URL (local):** `http://localhost:3000/api/store-reports/import-historical-workbook`
- **Auth:** Bearer token required
- **Permission required:** `can_manage_rotas`
- **Content-Type:** `application/json`

This endpoint reads an XLSX workbook and imports:

- Sheet `Jan-Dec 26` -> `StoreReportEntry`
- Sheet `Weekly 2026B` (also supports `Weekly 2026`) -> `StoreReportWeekly2026B`
- Sheet `Monthly Sale 2026` -> `StoreReportMonthlySale2026`

## 2) Request body

```json
{
  "file_path": "resourse/Book1 (1).xlsx",
  "year": 2026,
  "weekly_store_name": "Main Branch"
}
```

### Fields

- `file_path` (string, optional)
  - Relative or absolute path to XLSX file.
  - Default: `resourse/Book1 (1).xlsx`
- `year` (number, optional)
  - Fallback year used during parsing.
  - Default: current UTC year.
- `weekly_store_name` (string, optional)
  - Fallback store name for weekly rows if store is missing in sheet.
- `default_store_name` (string, optional)
  - Alternate fallback key for weekly store mapping.

## 3) Authentication flow (example)

> If you already have a token, skip this section.

```bash
curl -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@org.com",
    "password": "Admin@1234"
  }'
```

Use the returned token in `Authorization: Bearer <TOKEN>`.

## 4) cURL examples

### A) Import using default workbook path

```bash
curl -X POST "http://localhost:3000/api/store-reports/import-historical-workbook" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### B) Import using custom file and year

```bash
curl -X POST "http://localhost:3000/api/store-reports/import-historical-workbook" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "resourse/Book1 (1).xlsx",
    "year": 2026,
    "weekly_store_name": "Main Branch"
  }'
```

### C) Import using absolute path

```bash
curl -X POST "http://localhost:3000/api/store-reports/import-historical-workbook" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "/Users/your-user/IdeaProjects/subway-viral/resourse/Book1 (1).xlsx",
    "year": 2026
  }'
```

## 5) Success response format

All success responses follow:

```json
{
  "status": 200,
  "message": "Historical workbook data imported successfully",
  "data": {
    "file_path": "/absolute/path/to/Book1 (1).xlsx",
    "sheets": {
      "jan_dec_26": "Jan-Dec 26",
      "weekly_2026b": "Weekly 2026B",
      "monthly_sale_2026": "Monthly Sale 2026"
    },
    "imported": {
      "store_report_entry": 120,
      "weekly_2026b": 52,
      "monthly_sale_2026": 12
    },
    "upserted": {
      "store_report_entry": 120,
      "weekly_2026b": 52,
      "monthly_sale_2026": 12
    },
    "updated": {
      "store_report_entry": 0,
      "weekly_2026b": 0,
      "monthly_sale_2026": 0
    },
    "matched": {
      "store_report_entry": 120,
      "weekly_2026b": 52,
      "monthly_sale_2026": 12
    },
    "failed": 3,
    "errors": [
      {
        "sheet": "Monthly Sale 2026",
        "row": 9,
        "storeName": "Unknown Store",
        "reason": "Store name does not match any existing shop for Monthly Sale 2026 model; saved without shop_id"
      }
    ]
  }
}
```

## 6) Error responses

### A) File not found (400)

```json
{
  "status": 400,
  "message": "Excel file not found at path: /invalid/path.xlsx",
  "data": {}
}
```

### B) Required sheet missing (400)

```json
{
  "status": 400,
  "message": "Required sheet(s) not found: Monthly Sale 2026",
  "data": {}
}
```

### C) Unauthorized (401)

```json
{
  "status": 401,
  "message": "Token invalid or expired",
  "data": {}
}
```

### D) Forbidden (403)

```json
{
  "status": 403,
  "message": "Forbidden",
  "data": {}
}
```

## 7) Frontend integration notes

- Treat this as a **long-running import** call; show loading + progress state in UI.
- Always display `data.failed` and render `data.errors` in a downloadable table/modal.
- Show per-model counts from `imported`, `upserted`, and `updated`.
- Re-import is safe: API uses upsert keys to avoid duplicate rows.
- If `failed > 0`, import may still be partially successful. Do not assume full failure.

## 8) Suggested frontend TypeScript types

```ts
export type HistoricalImportErrorRow = {
  sheet: string;
  row: number;
  storeName: string;
  reason: string;
};

export type HistoricalImportCounts = {
  store_report_entry: number;
  weekly_2026b: number;
  monthly_sale_2026: number;
};

export type HistoricalImportResponse = {
  status: number;
  message: string;
  data: {
    file_path: string;
    sheets: {
      jan_dec_26: string;
      weekly_2026b: string;
      monthly_sale_2026: string;
    };
    imported: HistoricalImportCounts;
    upserted: HistoricalImportCounts;
    updated: HistoricalImportCounts;
    matched: HistoricalImportCounts;
    failed: number;
    errors: HistoricalImportErrorRow[];
  };
};
```

## 9) Quick QA checklist

- Valid token present
- User role has `can_manage_rotas`
- XLSX path exists on backend host
- Workbook contains required sheet names
- UI displays imported/updated/failed counts
- UI surfaces row-level `errors`

