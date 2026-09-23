# Frontend Integration — Weekly Report Analytics

A new dashboard endpoint returns analytics over the **by-week totals** — one
aggregate figure per week across all shops (not a per-shop breakdown). It
mirrors the other dashboard analytics: a period **summary**, a per-week
**trend** series, and an optional current-vs-previous **comparison**.

This is the third analytics dataset alongside the existing per-shop **storewise
weekly** and **monthly** analytics — this one is the **weekly roll-up** report.

> Also shipped in the same change: the existing per-shop analytics
> (`/analytics/v2/kpi-matrix`, `shop-compare`, `period-compare`, `trend`) no
> longer include the aggregate **"Unknown" / "All Shops"** row. If you were
> filtering that out on the client, you can remove that workaround.

---

## 1. Endpoint

### `GET /api/store-reports/analytics/v2/weekly-report`

- **Auth:** `Authorization: Bearer <access_token>` — requires the
  `can_view_all_staff` permission (Root / Admin / Manager by default). A caller
  without it gets `403`.

**Query params** (all optional):

| Param          | Type          | Notes                                                     |
| -------------- | ------------- | --------------------------------------------------------- |
| `from_date`    | date (ISO)    | Start of the current window, e.g. `2026-07-06`.           |
| `to_date`      | date (ISO)    | End of the current window, e.g. `2026-08-02`.             |
| `compare_from` | date (ISO)    | Start of the comparison window. Omit for no comparison.   |
| `compare_to`   | date (ISO)    | End of the comparison window.                             |

If neither `from_date` nor `to_date` is given, **all** weeks are returned.
`comparison` is included in the response **only** when `compare_from` and/or
`compare_to` are supplied.

```js
async function fetchWeeklyReport(token, { fromDate, toDate, compareFrom, compareTo }) {
  const qs = new URLSearchParams();
  if (fromDate) qs.set('from_date', fromDate);
  if (toDate) qs.set('to_date', toDate);
  if (compareFrom) qs.set('compare_from', compareFrom);
  if (compareTo) qs.set('compare_to', compareTo);

  const res = await fetch(`/api/store-reports/analytics/v2/weekly-report?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message);
  return json.data;
}
```

---

## 2. Response

Standard envelope — the payload is in `data`:

```jsonc
{
  "status": 200,
  "message": "Weekly report analytics fetched successfully",
  "data": {
    "report_type": "weekly_report",
    "period": { "from": "2026-07-06", "to": "2026-08-02" },
    "weeks_count": 4,
    "has_data": true,

    "summary": {
      "sales": 197362.85,
      "net": 161837.54,
      "labour": 15789.03,
      "vat": 35525.31,
      "royalties": 20229.7,
      "foodCost": 35604.25,
      "commission": 56831.49,
      "total": 163979.78,
      "income": 33383.07,
      "commissionPercent": 0.29,     // FRACTION — multiply by 100 to display (29%)
      "avgWeeklySales": 49340.71
    },

    "trend": [
      {
        "year": 2026,
        "week_number": 28,
        "week_range_label": "06/07 to 12/07",
        "week_start": "2026-07-06T00:00:00.000Z",
        "week_end": "2026-07-12T23:59:59.999Z",
        "sales": 52288.15, "net": 42500.10, "labour": 4100.00,
        "vat": 9200.00, "royalties": 5200.00, "foodCost": 9300.00,
        "commission": 15000.00, "total": 43000.00, "income": 8600.00,
        "commissionPercent": 0.29
      }
      // …one entry per week, ordered by year then week_number
    ]
  }
}
```

### Fields

| Field                  | Meaning                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `report_type`          | Always `"weekly_report"`.                                           |
| `period`               | Echoes the `from`/`to` you sent (or `null`).                        |
| `weeks_count`          | Number of weeks in range.                                           |
| `has_data`             | `false` when no weeks fall in the range — show an empty state.      |
| `summary`              | Totals across the range (see metric keys below) + derived fields.   |
| `trend[]`              | One object per week, same metric keys, for charting a time series.  |

**Metric keys** (in both `summary` and each `trend` item): `sales`, `net`,
`labour`, `vat`, `royalties`, `foodCost`, `commission`, `total`, `income` —
all money amounts. Plus:

- `commissionPercent` — a **fraction** (e.g. `0.29`). Multiply by 100 for a `%`.
- `avgWeeklySales` — **summary only**; `sales / weeks_count`.

---

## 3. Comparison (period-over-period)

When you pass `compare_from` / `compare_to`, the payload adds a `comparison`
block: the current summary, the compare-window summary, and a per-metric
`delta` with absolute `change` and `changePct`.

Request:

```
/api/store-reports/analytics/v2/weekly-report?from_date=2026-07-06&to_date=2026-08-02&compare_from=2026-06-08&compare_to=2026-07-05
```

Response adds:

```jsonc
"comparison": {
  "period": { "from": "2026-06-08", "to": "2026-07-05" },
  "weeks_count": 4,
  "current": { /* same shape as summary */ },
  "compare": { /* summary for the compare window */ },
  "delta": {
    "sales":  { "current": 197362.85, "compare": 194188.22, "change": 3174.63, "changePct": 1.63 },
    "net":    { "current": 161837.54, "compare": 159002.10, "change": 2835.44, "changePct": 1.78 }
    // …one entry per metric, including commissionPercent / avgWeeklySales
  }
}
```

- `change` = `current − compare`.
- `changePct` = percentage change, or **`null`** when `compare` is `0` (avoid
  dividing by zero — render as "—" or "n/a").
- Use `changePct` sign for the up/down arrow and colour.

```jsx
const delta = data.comparison?.delta?.sales;
if (delta) {
  const up = (delta.changePct ?? 0) >= 0;
  render(`£${delta.current.toLocaleString()}`, {
    badge: delta.changePct == null ? '—' : `${up ? '▲' : '▼'} ${Math.abs(delta.changePct)}%`,
    color: up ? 'green' : 'red',
  });
}
```

---

## 4. Error responses

| Status | When                                   | Suggested UI                          |
| ------ | -------------------------------------- | ------------------------------------- |
| `400`  | A date param is not a valid date       | Fix the picker value; show a message. |
| `401`  | Missing / invalid / expired token      | Redirect to login.                    |
| `403`  | Caller lacks `can_view_all_staff`      | Hide the report from this role.       |

```jsonc
{ "status": 400, "message": "from_date must be a valid date", "data": {} }
```

---

## 5. Notes

- **Aggregate, not per-shop.** This report has no `shop_id` dimension — it's the
  weekly total across every store. For per-shop weekly figures keep using the
  storewise weekly analytics (`report_type=weekly_financial`).
- **Percentages are fractions.** `commissionPercent` (and any percentage-style
  delta) is `0.29`, not `29`. Multiply by 100 when displaying.
- **Empty ranges** return `200` with `has_data: false` and empty `trend` — not
  an error. Render an empty state.
- **Ordering.** `trend` is sorted by `year` then `week_number`, so you can plot
  it directly.
