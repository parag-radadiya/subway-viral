# Frontend Change Tickets: Shift Caps + Overnight Hours

This document lists frontend changes required after backend updates for:
- per-shop shift duration limits (`min_shift_duration_hours`, `max_shift_duration_hours`)
- overnight shop operating hours (`closing_time` can be next day)

## Scope Summary

- Shop settings now include shift caps:
  - `min_shift_duration_hours` (default: `2`)
  - `max_shift_duration_hours` (default: `8`)
- Rota create/update/bulk now validates shift duration against shop caps.
- Overnight shifts are now valid in bulk time-pattern mode when `end_time <= start_time` (end rolls to next day).
- Shop hours can be overnight (example: open `07:00`, close `05:00` next day).
- Attendance coverage logic uses overnight shop hours in adjustment checks.

---

## Ticket FE-SHOP-001: Add Shift Cap Inputs in Shop Edit Screen

### Goal

Allow admins to configure minimum and maximum shift duration per shop.

### Affected API

- `PUT /api/shops/{id}`
- `GET /api/shops/{id}`
- `GET /api/shops`

### New Fields

- `min_shift_duration_hours` (number)
- `max_shift_duration_hours` (number)

### UI Requirements

- Add 2 numeric fields in shop form:
  - Min shift duration (hours)
  - Max shift duration (hours)
- Prefill from API response.
- Validate before submit:
  - both must be positive numbers
  - `max >= min`
- Show hint text: default policy is min 2h / max 8h.

### Example Payload

```json
{
  "min_shift_duration_hours": 2,
  "max_shift_duration_hours": 8
}
```

### Acceptance Criteria

- Admin can save min/max caps via shop update.
- Saved values are visible after refresh.

---

## Ticket FE-SHOP-002: Support Overnight Hours in Shop Hours Form

### Goal

Allow setting shop hours where closing is next day.

### Affected API

- `PUT /api/shops/{id}/hours`
- `PUT /api/shops/{id}` (when updating `opening_time` and `closing_time` together)

### New Rule

- `closing_time` can be earlier than `opening_time` and means next-day close.
- Example: `07:00 -> 05:00` means open from Monday 07:00 to Tuesday 05:00.

### UI Requirements

- Keep existing time pickers.
- Add help text near closing time:
  - "If closing time is earlier than opening time, it is treated as next-day closing."
- Keep blocking only equal values (`opening_time === closing_time`).

### Acceptance Criteria

- Admin can save overnight hours without frontend blocking.
- UI labels this as overnight to avoid confusion.

---

## Ticket FE-ROTA-001: Enforce Shop Shift Caps in Rota Form

### Goal

Prevent invalid short/long shifts in create/update rota UI.

### Affected API

- `POST /api/rotas`
- `PUT /api/rotas/{id}`

### Backend Behavior to Handle

- Request fails with `400` when shift duration is outside shop min/max caps.

### UI Requirements

- Fetch shop caps when rota form opens or when shop changes.
- Client-side duration validation (recommended), then still rely on API validation.
- Message pattern:
  - "Shift duration must be between {min}h and {max}h for this shop."

### Acceptance Criteria

- User gets immediate feedback before submit.
- API errors are still mapped cleanly if client validation misses.

---

## Ticket FE-ROTA-002: Update Bulk Rota UI for Overnight Shifts

### Goal

Allow bulk assignments where shift crosses midnight.

### Affected API

- `POST /api/rotas/bulk`

### New Rule

- If assignment `end_time <= start_time`, backend treats `end_time` as next day.

### UI Requirements

- In bulk assignment row, allow end time earlier than start time.
- Display computed label like: "Overnight (+1 day)".
- Duration check for caps must use overnight math.
- Keep existing conflict handling UI (`created`, `skipped`, `conflicts`).

### Example Assignment

```json
{
  "user_id": "<user_id>",
  "start_time": "23:00",
  "end_time": "05:00"
}
```

### Acceptance Criteria

- Bulk submit succeeds for valid overnight duration.
- Cap violations for overnight shifts show clear error.

---

## Ticket FE-ATT-001: Clarify Overnight Coverage Impact in Adjustment Screens

### Goal

Avoid confusion in attendance adjustment flows when shops run overnight windows.

### Affected API

- `POST /api/attendance/adjust-hours/preview`
- `POST /api/attendance/adjust-hours/apply`
- `POST /api/attendance/adjust-hours/bulk-by-shop`

### UI Requirements

- In preview/apply screens, add info text when shop is overnight:
  - "Coverage is checked across overnight windows based on shop opening/closing time."
- Keep existing display for coverage gap errors (`gaps`, `summary`, `possible_solutions`).

### Acceptance Criteria

- Admin understands why overnight windows can create cross-day coverage gaps.

---

## Error Mapping (Frontend)

Map these responses to actionable UI:

- `400` shift duration error:
  - "Shift duration must be between {min}h and {max}h for this shop."
- `400` equal open/close time:
  - "Opening and closing time cannot be the same."
- `409` coverage gaps (attendance adjust):
  - Show backend `summary` and first `uncovered_windows_preview` item.

---

## QA Checklist

- Shop edit saves and reloads `min_shift_duration_hours` and `max_shift_duration_hours`.
- Overnight shop hours (`07:00` to `05:00`) save successfully.
- Rota create blocks below min and above max duration.
- Bulk rota allows `23:00` to `05:00` and marks as overnight.
- Attendance adjust screens still render coverage-gap payloads correctly for overnight shops.

---

## Rollout Notes for Frontend Team

- Prefer client-side pre-validation for better UX, but never remove API error handling.
- Reuse a shared duration utility for single rota and bulk rota forms.
- Add analytics events for cap-validation failures to monitor adoption issues.

