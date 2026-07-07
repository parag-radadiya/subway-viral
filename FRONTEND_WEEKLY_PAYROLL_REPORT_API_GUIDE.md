# Weekly Payroll Report API — Frontend Integration Guide

Pure JSON API — **no Excel involved**. It returns fully structured data matching the printed "Weekly Printed Payroll Report" PDF layout (store header, one row per employee, one column per day, punch-level detail stacked inside each day cell, and adjustment/grand-total rows), so the frontend can render or print an exact match without generating or parsing any spreadsheet.

- **Endpoint:** `GET /api/attendance/weekly-payroll-report`
- **Auth:** `Authorization: Bearer <jwt>`
- **Permission:** `can_view_all_staff`
- **Required query params:** `shop_id`, `from_date`, `to_date` (this endpoint always needs one specific shop — it's the one field that stayed required; see the staff-shifts guide if you need a shop_id-optional, cross-shop view instead).

---

## Query parameters

| Name        | Required | Type              | Notes                                                                                                        |
| ----------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `shop_id`   | yes      | string (ObjectId) | The shop to report on. Caller must have access to it (checked via shop scope; `403` otherwise).              |
| `from_date` | yes      | ISO date          | Start of the reporting week (inclusive).                                                                     |
| `to_date`   | yes      | ISO date          | End of the reporting week (inclusive). Typically `from_date + 6 days` for a 7-day week, but any range works. |

---

## Response shape

```jsonc
{
  "success": true,
  "message": "Weekly payroll report generated successfully",
  "data": {
    "report_title": "Weekly Printed Payroll Report",

    "shop": {
      "id": "66f1aa00bb11cc22dd33ee44",
      "name": "Paddington London",
      "store_identifier": "30324",
      "display_name": "Paddington London(30324)", // ready-to-print "Store:" line
    },

    "date_range": { "from": "2026-04-22", "to": "2026-04-28" },
    "week_ending": "28 Apr 2026", // matches the PDF's "Week ending:" line
    "printed_at": "26 Apr 2026 14:22", // matches the PDF's "Printed:" line (report generation time, UTC)

    "legend": {
      "system_punch": "^ Indicates system time punch",
      "manual_punch": "* Indicates a user-edited time punch",
    },

    // Flat ISO date strings (unchanged) — use these if you already built against this endpoint.
    "dates": [
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
      "2026-04-27",
      "2026-04-28",
    ],

    // NEW — ready-made column headers for the printed table.
    "date_headers": [
      { "date": "2026-04-22", "date_label": "22/04/2026", "weekday": "Wednesday" },
      { "date": "2026-04-23", "date_label": "23/04/2026", "weekday": "Thursday" },
      // ...one per date
    ],

    "employees": [
      {
        "user_id": "66e0...aaa",
        "payroll_id": "1", // "User ID / Payroll" column
        "employee_name": "Baptiste, Dalie",
        "weekly_total": {
          "total_before_adj": 13.17,
          "total_adj": 13.17,
          "adj_amount": 0,
          "total_break_hours": 0,
        },
        "hrs_wrkd": 13.17, // alias of weekly_total.total_adj — matches the "Hrs Wrkd" column directly
        "days": [
          {
            "date": "2026-04-22",
            "punches": [
              {
                "time_label": "08:00-15:11",
                "hours": 7.18,
                "break_hours": 0,
                "is_system": false,
                "is_manual": false,
              },
              {
                "time_label": "15:30-16:01",
                "hours": 0.52,
                "break_hours": 0,
                "is_system": false,
                "is_manual": false,
              },
            ],
            "total_before_adj": 7.7,
            "total_adj": 7.7,
            "adj_amount": 0,
            "total_break_hours": 0,
          },
          // ...one entry per date in `dates`, always present even if empty (punches: [])
        ],
      },
      // ...one entry per employee with attendance in range, sorted by employee_name
    ],

    "grand_totals": {
      "days": [
        {
          "date": "2026-04-22",
          "total_before_adj": 55.7,
          "total_adj": 55.7,
          "adj_amount": 0,
          "total_break_hours": 0,
        },
        // ...one per date — this is the "Hours Worked Adj. / Before Adj. / Total Adjustments" footer row
      ],
      "weekly_total": {
        "total_before_adj": 244.13,
        "total_adj": 244.13,
        "adj_amount": 0,
        "total_break_hours": 0,
      },
    },
  },
}
```

---

## Mapping response fields to the printed layout

| PDF element                                                                   | Response field                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Store: Paddington London(30324)`                                             | `shop.display_name` (or build it yourself from `shop.name` + `shop.store_identifier`)                                                                                                                                         |
| `Weekly Printed Payroll Report` (title)                                       | `report_title`                                                                                                                                                                                                                |
| `Week ending: 28 Apr 2026`                                                    | `week_ending`                                                                                                                                                                                                                 |
| `Printed: 26 Apr 2026 14:22`                                                  | `printed_at`                                                                                                                                                                                                                  |
| `^ Indicates system time punch` / `* Indicates a user-edited time punch`      | `legend.system_punch` / `legend.manual_punch`                                                                                                                                                                                 |
| Day column headers (`22/04/2026` / `Wednesday`)                               | `date_headers[].date_label` / `date_headers[].weekday`                                                                                                                                                                        |
| `User ID / Payroll`                                                           | `employees[].payroll_id`                                                                                                                                                                                                      |
| `Employee Name`                                                               | `employees[].employee_name`                                                                                                                                                                                                   |
| Stacked `HH:MM-HH:MM` + `Hrs X.XX` lines inside a day cell                    | `employees[].days[].punches[]` — render one `time_label` + `hours` line per punch, in order                                                                                                                                   |
| `^` / `*` suffix on a punch time                                              | already baked into `punches[].time_label` (e.g. `"03:44-04:59^"`, `"09:00-12:00*"`) — no extra logic needed, but `is_system` / `is_manual` are also exposed if you want to style them instead of relying on the printed glyph |
| `TOTAL Adj.` row (per day + `Hrs Wrkd` far-right column)                      | `employees[].days[].total_adj` per day, `employees[].hrs_wrkd` (or `weekly_total.total_adj`) for the row total                                                                                                                |
| `TOTAL Before Adj.` row                                                       | `employees[].days[].total_before_adj` / `weekly_total.total_before_adj`                                                                                                                                                       |
| `Adj. Amount` row (signed, e.g. `+0.00`)                                      | `employees[].days[].adj_amount` / `weekly_total.adj_amount` — numeric; prefix `+` yourself when rendering (server does not send the sign as a string)                                                                         |
| `Hours Worked Adj.` / `Hours Worked Before Adj.` / `Total Adjustments` footer | `grand_totals.days[]` (per day) and `grand_totals.weekly_total` (week total) — same three metrics, aggregated across all employees                                                                                            |

### Notes

- **Every date in the range always appears** in `dates`, `date_headers`, and every employee's `days[]` — even days with zero punches (`punches: []`, all totals `0`). You don't need to backfill missing days yourself.
- **Break time is already netted out.** `hours` per punch and every `total_adj`/`total_before_adj` value already excludes lunch-break minutes (see the lunch-break guide). `break_hours` is additive information for anyone who wants to show it — you do **not** need to subtract it again.
- **`store_identifier`** is a new optional field on the Shop record (settable via `PUT /api/shops/:id` or at creation). If a shop has none set, `display_name` just falls back to the plain `name` — handle `store_identifier: null` gracefully.
- No pagination — the endpoint returns every employee with attendance in the range for the requested shop in one response, matching how the printed report always shows a full week on one sheet.
