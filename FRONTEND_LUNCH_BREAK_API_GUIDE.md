# Lunch Break API — Frontend Integration Guide

Adds lunch-break tracking on top of the existing punch-in/punch-out attendance system. This is a **fully backward-compatible, additive** change — every existing attendance screen keeps working with zero changes. This guide covers the 2 new endpoints and the new fields you'll now see on existing attendance/report responses.

- **Auth:** `Authorization: Bearer <jwt>` (same as every other attendance API)
- **No breaking changes:** old response fields (`punch_in`, `punch_out`, `work_hours`, `total_work_hours`, etc.) keep the exact same meaning and shape. New fields are additive only.

---

## 1. New endpoints

### `POST /api/attendance/:id/break-start`

Starts a lunch break on an attendance record that is currently punched in (`punch_out` still `null`).

- **Who can call it:**
  - The staff member who owns the record (self-service, no special permission needed) — same rule as punch-out today.
  - A manager/sub-manager with the `can_manual_punch` permission (same permission that gates today's manual-punch-in exception flow) may start a break **on behalf of** another staff member's open record.
- **Body (optional):**
  ```json
  { "break_type": "Lunch" }
  ```
  `break_type` is `"Lunch"` (default) or `"Other"`.
- **Success — `200`:**
  ```json
  {
    "success": true,
    "message": "Break started successfully",
    "data": {
      "attendance": {
        "_id": "...",
        "punch_in": "2026-07-06T09:00:00.000Z",
        "punch_out": null,
        "breaks": [
          {
            "_id": "...",
            "break_start": "2026-07-06T12:30:00.000Z",
            "break_end": null,
            "break_type": "Lunch",
            "duration_minutes": null,
            "is_manual": false,
            "manual_by": null
          }
        ]
        // ...rest of the Attendance document
      }
    }
  }
  ```
- **Errors:**
  - `404` — attendance record not found (or archived/replaced by an hours-adjustment batch).
  - `400 "Cannot start a break on a shift that has already been punched out"` — record is already closed.
  - `400 "A break is already in progress"` — there's already an open break on this record; end it first.
  - `403 "Forbidden: not allowed to manage break for this staff member"` — caller doesn't own the record and lacks `can_manual_punch`.

### `PUT /api/attendance/:id/break-end`

Ends the currently open break on an attendance record. Same authorization rule as `break-start` (owner, or manager with `can_manual_punch`).

- **Body:** none required.
- **Success — `200`:** same shape as above, but the open break entry now has `break_end` and `duration_minutes` filled in.
- **Errors:**
  - `404` — attendance record not found.
  - `400 "No break is currently in progress"` — nothing open to end.
  - `403` — same as above.

---

## 2. Changed behavior on existing endpoints

### `PUT /api/attendance/:id/punch-out`

**New rule:** punch-out is rejected while a break is still open.

- `400 "Please end your lunch break before punching out"` — call `break-end` first, then retry punch-out.

**UI recommendation:** disable/hide the "Punch Out" button while `is_on_break` is `true` (see field below), and show "End Break" instead.

### Auto punch-out (background sweep)

If a shift's auto punch-out time arrives while the staff member is still on an open break, the system **skips** auto-closing that record (rather than silently closing it mid-break). It stays open until the staff ends the break and punches out manually, or a manager does it for them. No frontend action needed — this is transparent — but don't be surprised if you see a shift that's well past its scheduled end time and still open; check `is_on_break` to explain why.

---

## 3. New response fields

All of these are **additive** — nothing existing changes shape or meaning.

### Per attendance record

Everywhere a raw attendance record/shift is returned (`GET /api/attendance`, `GET /api/attendance/range`, shifts inside `GET /api/attendance/staff-shifts`), each record now also includes:

| Field                 | Type    | Meaning                                                                                                                                                        |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breaks`              | array   | Full break history for this record (see shape above). Empty array `[]` for records with no breaks — including all historical records from before this feature. |
| `total_break_minutes` | number  | Sum of closed break durations on this record.                                                                                                                  |
| `total_break_hours`   | number  | Same, in hours (2dp).                                                                                                                                          |
| `breaks_count`        | number  | Number of break entries (open + closed).                                                                                                                       |
| `is_on_break`         | boolean | `true` if there's currently an open (unfinished) break on this record. Use this to drive the punch-out button state.                                           |

**Work-hour fields now net out break time.** `work_hours` / `work_minutes` (staff-shifts), and the fallback used for `effective`/`adjusted` hours everywhere, now subtract closed break minutes — e.g. an 8h shift with a 30m lunch reports as 7.5h worked, not 8h. This only changes numbers for records that actually have a tracked break; every historical record with no `breaks` reports exactly as it did before.

### Aggregate / totals fields

| Endpoint                              | New field                                                       | Meaning                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/attendance`                 | `adjusted_hours_total` (existing, now break-netted)             | unchanged field name, corrected math                                                                                                              |
| `GET /api/attendance/range`           | `total_break_hours`                                             | Sum of break hours across the whole range (all pages, not just current page) — sits alongside existing `total_work_hours` / `total_actual_hours`. |
| `GET /api/attendance/summary-by-user` | `users[].total_break_hours`                                     | Per-user break hours for the queried range.                                                                                                       |
| `GET /api/attendance/staff-shifts`    | `total_break_hours` (top-level) and `staff[].total_break_hours` | Shop-wide and per-staff break totals, same pattern as existing `total_work_hours` / `total_actual_hours`.                                         |

### `GET /api/attendance/weekly-payroll-report`

- Each entry in `days[].punches[]` now has a `break_hours` field alongside `hours`.
- Each `days[]` entry has `total_break_hours`.
- Each employee's `weekly_total` has `total_break_hours`.
- `grand_totals.days[]` and `grand_totals.weekly_total` also have `total_break_hours`.

The printed/PDF-matching fields (`time_label`, `total_before_adj`, `total_adj`, `adj_amount`) are unchanged in shape; `total_adj` already reflects the break-netted hours (see above), so if you're printing exactly what the PDF shows today, no layout change is required — `break_hours` is purely additive for screens that want to show it.

---

## 4. Suggested UI changes

1. **Staff punch screen:** when punched in and not on break, show a "Start Lunch Break" button. When `is_on_break` is `true`, show "End Break" and disable/hide "Punch Out" (the API will reject it anyway, but avoid the round trip).
2. **Manager/admin attendance views:** add a "Break" column showing `total_break_hours` (and maybe a small icon when `is_on_break` is `true` on an open shift, so managers can see who's currently at lunch).
3. **Staff-shifts / summary screens:** the existing "Worked hours" totals will now be slightly lower than before for shifts with recorded breaks — this is expected and correct (breaks are unpaid). No copy changes needed unless you want to add "(break time excluded)" as a hint.
4. **Weekly payroll report:** optionally show `break_hours` per punch/day/week if the printed layout has room; otherwise no change needed since `hours`/`total_adj` already exclude break time.
