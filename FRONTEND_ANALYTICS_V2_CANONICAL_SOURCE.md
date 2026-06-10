# Frontend Guide — Analytics v2 Canonical-Source Switch

## What changed

The v2 analytics endpoints now read from the **canonical source tables** instead of
the aggregated `StoreReportEntry` table:

| `report_type`       | Source table                 |
| ------------------- | ---------------------------- |
| `weekly_financial`  | `StoreReportWeekly2026B`     |
| `monthly_store_kpi` | `StoreReportMonthlySale2026` |

Affected endpoints:

- `GET /api/store-reports/analytics/v2/kpi-matrix`
- `GET /api/store-reports/analytics/v2/shop-compare`
- `GET /api/store-reports/analytics/v2/period-compare`
- `GET /api/store-reports/analytics/v2/trend`

Every response now includes a `reference_ids` field so admins can drill back to
the underlying rows that produced each aggregate.

---

## Request changes

### `report_type` (existing, behaviour clarified)

- `weekly_financial` (default) — week-level data from `StoreReportWeekly2026B`.
- `monthly_store_kpi` — month-level data from `StoreReportMonthlySale2026`.

### `granularity` (trend only)

- For `weekly_financial`: `week` (default) or `month`. Both valid.
- For `monthly_store_kpi`: **forced to `month`** regardless of what is sent.
  The monthly source table has no weekly breakdown.

### Weekly sources are unioned

For `report_type=weekly_financial`, the backend now reads from BOTH
`StoreReportWeekly2026B` AND `StoreReportEntry` rows with
`source_type=admin_weekly` and unions them. Dedup is on
`(shop_id, period_key)`; admin-entered overrides win when both sources have
data for the same period+shop. No client-side action needed — this is
transparent and means admin-uploaded weekly data now shows up in v2 analytics
where it previously did not.

### `view` (deprecated, ignored)

The `view` param (`excel_raw`, `admin_weekly`, `reconciled`) is **silently
ignored**. The canonical tables have no admin/excel split, so the param has no
effect. Safe to remove from the client; leaving it in does no harm.

### Date filtering

- `weekly_financial` — matches any record whose `week_start..week_end` overlaps
  `from_date..to_date`.
- `monthly_store_kpi` — matches any record whose `(year, month)` falls within
  the calendar months spanned by `from_date..to_date` (inclusive on both ends).
  Day-of-month inside the query dates is irrelevant for monthly data.

---

## Response changes — `reference_ids`

Each aggregated section now carries a `reference_ids` array (or object) listing
the underlying record `_id`s that contributed to the numbers. Use these to:

- Show admins a "view source rows" affordance on every KPI.
- Validate that the aggregate row counts and totals match what was imported.
- Drill into a specific period or shop to inspect raw `metrics`.

You can fetch a specific record by ID via the existing endpoints:

- Weekly: `GET /api/store-reports/weekly-2026` — filter or fetch by `_id`.
- Monthly: `GET /api/store-reports/monthly-sale` — filter or fetch by `_id`.

---

## Response shape per endpoint

### 1. `kpi-matrix`

```jsonc
{
  "period": { "from": "2026-06-01", "to": "2026-06-30" },
  "compare_period": null,
  "report_type": "weekly_financial",
  "total": {
    "current": { "grossSales": 12345, "labourPercent": 24.5 /* … */ },
    "compare": null,
    "delta": null,
    "record_count": 8,
    "reference_ids": {
      "current": ["66ab…", "66ab…"],
      "compare": [],
    },
  },
  "shops": [
    {
      "shopId": "…",
      "shopName": "Main Branch",
      "current": {
        /* kpis */
      },
      "compare": null,
      "delta": null,
      "record_count": 4,
      "reference_ids": {
        "current": ["66ab…"],
        "compare": [],
      },
    },
  ],
  "metric_keys": ["grossSales", "netSales" /* … */],
}
```

### 2. `shop-compare`

```jsonc
{
  "period": { "from": "2026-06-01", "to": "2026-06-30" },
  "report_type": "weekly_financial",
  "shops": [
    {
      "shopId": "…",
      "shopName": "Main Branch",
      "record_count": 4,
      "reference_ids": ["66ab…", "66ab…"],
    },
  ],
  "metrics": ["grossSales", "labour"],
  "matrix": [
    /* metric × shop rows */
  ],
  "kpis": {
    /* per-shop kpis */
  },
}
```

### 3. `period-compare`

```jsonc
{
  "current_period": {
    "from": "2026-06-01",
    "to": "2026-06-30",
    "record_count": 8,
    "reference_ids": ["66ab…"],
  },
  "compare_period": {
    "from": "2025-06-01",
    "to": "2025-06-30",
    "record_count": 8,
    "reference_ids": ["66ab…"],
  },
  "report_type": "weekly_financial",
  "metrics": ["grossSales"],
  "total": {
    "current": {
      /* … */
    },
    "compare": {
      /* … */
    },
    "delta": {
      /* … */
    },
  },
  "shops": [
    {
      "shopId": "…",
      "shopName": "Main Branch",
      "current": {
        /* … */
      },
      "compare": {
        /* … */
      },
      "delta": {
        /* … */
      },
      "reference_ids": {
        "current": ["66ab…"],
        "compare": ["66ab…"],
      },
    },
  ],
}
```

### 4. `trend`

`reference_ids` appears **per data point** in the series, on each per-shop
series, and at the top-level total.

```jsonc
{
  "period": { "from": "2026-06-01", "to": "2026-06-30" },
  "granularity": "month",
  "report_type": "monthly_store_kpi",
  "metrics": ["labourPercent", "foodCostPercent"],
  "group_by": "total",
  "total": {
    "kpis": { "labourPercent": 24.5, "foodCostPercent": 30.1 },
    "series": [
      {
        "periodKey": "2026-06",
        "label": "Jun 2026",
        "year": 2026,
        "month": 6,
        "weekNumber": null,
        "labourPercent": 24.5,
        "foodCostPercent": 30.1,
        "reference_ids": ["66ab…", "66ab…"],
      },
    ],
    "reference_ids": ["66ab…", "66ab…"],
  },
  "shops": null,
  "data_points": 1,
}
```

When `group_by=shop`, each shop bucket also carries its own series with
`reference_ids` per point plus a shop-level `reference_ids` aggregate.

---

## Recommended UI changes

1. **Report-type selector** — surface `weekly_financial` and `monthly_store_kpi`
   as user-visible options if not already. Default to `weekly_financial`.

2. **Granularity selector (trend)** — disable / hide the "week" option when the
   selected `report_type` is `monthly_store_kpi`. The backend forces `month`
   anyway, but the UI should reflect that to avoid user confusion.

3. **"View source rows" affordance** — on each KPI card, period bar, or trend
   point, expose a small "i" / "audit" button that opens the underlying rows
   using `reference_ids`. Helpful pattern:

   ```ts
   // Trend point
   onClick={() => openRowDrawer(point.reference_ids, reportType)}
   ```

   Then fetch and display:
   - `weekly_financial` → from the weekly 2026 records endpoint.
   - `monthly_store_kpi` → from the monthly sale records endpoint.

4. **Validation badge** — show `record_count` next to aggregate values. If the
   `reference_ids.length` doesn't match `record_count`, surface a warning (this
   should never happen, but it's a cheap consistency check).

5. **Drop `view`** — remove `view` from all v2 analytics requests. It is now a
   no-op.

---

## Migration checklist for clients

- [ ] Stop sending `view` on v2 analytics calls.
- [ ] If you currently force `granularity=week` for monthly KPI views, drop
      that — the backend forces `month` and the response will reflect it.
- [ ] Wire `reference_ids` through your data layer so audit drawers can use it.
- [ ] Update any type definitions / API clients to include `reference_ids`
      (top-level `total`, per-shop, per-period, per-data-point).
- [ ] Confirm `report_type` is read from `response.data.report_type` rather than
      assumed from the request — defensive against future defaulting changes.
