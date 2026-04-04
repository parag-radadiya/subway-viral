# Frontend Guide: Complete Session Changes (Admin + Attendance Effective Time)

This document is the full frontend handoff for everything implemented in this session.

It includes:

1. All backend behavior changes.
2. Every relevant endpoint and payload.
3. Role-based UI behavior (especially Root vs non-Root attendance visibility).
4. Full admin workflows (shop hours, single-user adjustment, bulk adjustment).
5. Pagination contract and rollout endpoints.
6. Error handling and edge-case mapping for frontend.

## 1) Final Business Rules (Must Follow in Frontend)

### 1.1 Attendance data model behavior

- Actual fields are immutable for adjustment:
  - `punch_in`, `punch_out`
- Effective fields are adjustment outputs:
  - `effective_start`, `effective_end`, `effective_minutes`, `effective_source`
  - plus audit fields: `adjusted_minutes`, `adjusted_at`, `adjusted_by`, `adjustment_note`

### 1.2 Attendance display behavior

- Root user:
  - sees raw actual `punch_in` and `punch_out` values in `GET /api/attendance`
  - can view all users/shops
- Non-root users (Admin, Manager, Sub-Manager, Staff):
  - if `effective_start` + `effective_end` exist, backend response already maps these into returned `punch_in`/`punch_out`
  - should treat returned times as the final display time
  - cannot get data older than last 30 days (server enforced)

### 1.3 Access and scope rules

- Root: global attendance visibility
- Admin: not global anymore for attendance data; scoped by assigned shops
- Manager/Sub-Manager: scoped by assigned shops
- Staff: self scope

### 1.4 Coverage safety rule during adjustment

Adjustments are blocked if shop open-time would have zero staff coverage after effective-time changes.

Coverage window source is historical:

- uses current `opening_time`/`closing_time`
- and uses `shop_time_history` for past dates if hours changed mid-month

## 2) Global API Response Contract

All APIs follow envelope style:

```json
{
  "status": 200,
  "message": "...",
  "data": {}
}
```

List APIs with pagination return in `data`:

```json
{
  "total": 120,
  "page": 2,
  "limit": 20,
  "total_pages": 6,
  "count": 20,
  "<items_key>": []
}
```

## 3) Endpoints Added/Changed in This Session

## 3.1 Attendance Adjustment APIs

### `POST /api/attendance/adjust-hours/preview`

Purpose:

- dry-run adjustment for one user in a date range.

Body:

```json
{
  "user_id": "<user-id>",
  "shop_id": "<shop-id>",
  "from_date": "2026-03-01",
  "to_date": "2026-03-31",
  "target_hours": 120
}
```

Returns:

- `actual_hours`, `target_hours`, `adjusted_hours`, `reduced_hours`
- `coverage_safe`
- per-record preview list

### `POST /api/attendance/adjust-hours/apply`

Purpose:

- applies one-user adjustment and persists effective fields.

Body:

```json
{
  "user_id": "<user-id>",
  "shop_id": "<shop-id>",
  "from_date": "2026-03-01",
  "to_date": "2026-03-31",
  "target_hours": 120,
  "note": "Payroll correction"
}
```

### `POST /api/attendance/adjust-hours/bulk-by-shop`

Purpose:

- apply multiple user targets for same shop/date range in one call.

Body:

```json
{
  "shop_id": "<shop-id>",
  "from_date": "2026-03-01",
  "to_date": "2026-03-31",
  "adjustments": [
    { "user_id": "<u1>", "target_hours": 110 },
    { "user_id": "<u2>", "target_hours": 95 }
  ],
  "note": "Month close"
}
```

Validation behavior:

- rejects if duplicate user in adjustments
- rejects if some users in range are not selected (`409`, returns `unchanged_users`)
- rejects if coverage gap would occur (`409`, returns `gaps`)

### `GET /api/attendance/adjust-hours/unchanged-users`

Purpose:

- helper list of users in selected shop/date range not yet part of adjustment set.

Query:

- `shop_id` required
- `from_date` required
- `to_date` required
- `page`, `limit` supported

## 3.2 Shop Hours Management APIs

### `PUT /api/shops/:id/hours`

Purpose:

- admin updates shop operational hours.

Body:

```json
{
  "opening_time": "09:00",
  "closing_time": "21:00",
  "note": "Seasonal timing update"
}
```

### `GET /api/shops/:id/hours-history`

Purpose:

- paginated history of shop time changes.

Query:

- `page`, `limit`

Returned history entry fields:

- `opening_time`, `closing_time`
- `effective_from`, `effective_to`
- `changed_at`, `changed_by`, `note`

## 3.3 User Picker API

### `GET /api/users/by-shop/:shopId/staff`

Purpose:

- provides selectable users for adjustment UI.
- excludes Root/Admin roles.

Query:

- `page`, `limit`, `sort_by`, `sort_order`

## 4) Attendance List API Behavior (Frontend Critical)

### `GET /api/attendance`

Supported query params:

- `user_id`
- `shop_id`
- `from_date`
- `to_date`
- `page`
- `limit`
- `sort_by` (`punch_in`, `punch_out`, `createdAt`, `updatedAt`)
- `sort_order` (`asc`, `desc`)

Data behavior by role:

- Root:
  - no 30-day cap
  - raw actual times
- Non-root:
  - 30-day cap always enforced
  - returned `punch_in/out` are effective times when effective exists

Totals in response:

- `actual_hours_total`
- `adjusted_hours_total`

## 5) Pagination Rollout in Backend (Session Scope)

Pagination now applied on these GET list APIs:

- `GET /api/roles`
- `GET /api/shops`
- `GET /api/shops/:id/hours-history`
- `GET /api/users`
- `GET /api/users/by-shop/:shopId/staff`
- `GET /api/users/assigned-shops/staff-summary`
- `GET /api/rotas`
- `GET /api/attendance`
- `GET /api/attendance/adjust-hours/unchanged-users`
- `GET /api/observability/error-logs` (controller-backed error list)

Already paginated earlier (pre-existing):

- `GET /api/inventory/items`
- `GET /api/inventory/queries`
- `GET /api/inventory/audit-logs`

## 6) Frontend Screen-by-Screen Implementation

### 6.1 Shop Settings (Admin)

UI blocks:

- Current hours form
- Save button
- Hours history table with pagination

Flow:

1. Load shop details (`GET /api/shops/:id` if needed)
2. Update with `PUT /api/shops/:id/hours`
3. Refresh history via `GET /api/shops/:id/hours-history?page=1&limit=20`

### 6.2 Adjustment Single User Screen

UI fields:

- shop selector
- date range picker
- user selector
- target hours input
- preview + apply buttons

Flow:

1. Call preview endpoint.
2. Render hours comparison and per-shift preview.
3. If `coverage_safe` and admin confirms, call apply endpoint.
4. Refresh attendance list.

### 6.3 Bulk Adjustment Screen

UI fields:

- shop selector
- date range picker
- grid of users with target hours

Flow:

1. Load users from `GET /api/users/by-shop/:shopId/staff`.
2. Submit `bulk-by-shop` payload.
3. If `409` with `unchanged_users`, display missing list and allow one-click add.
4. Retry with complete selection.

### 6.4 Attendance Reporting Screens

Root screen:

- show raw times
- full range filter allowed

Non-root screens:

- show returned times as-is (they are effective when available)
- show hint: "Data is limited to last 30 days"

## 7) Error Handling Map (Frontend)

### 400

- invalid dates, invalid payload, invalid target hours

### 403

- permission/scope denied

### 404

- missing entities (user/shop/attendance)

### 409

Two important adjustment cases:

1. `unchanged_users` present:
   - show list and ask admin to include them.
2. `gaps` present:
   - show uncovered windows where shop would have no employee.

## 8) Frontend API Client Checklist

- Add typed models for:
  - attendance adjustment preview/apply response
  - bulk conflict payload (`unchanged_users`, `gaps`)
  - shop hours history entries
- Add shared pagination wrapper:
  - request: `page`, `limit`, optional sorting
  - response: `total`, `total_pages`, `count`
- Centralize role checks for root/non-root attendance rendering.

## 9) QA Checklist for Frontend Team

1. Root attendance list shows raw times.
2. Admin attendance list shows effective times where available.
3. Admin cannot see attendance outside assigned shop scope.
4. Non-root older-than-30-day filters do not return old data.
5. Single preview handles coverage conflict messaging.
6. Bulk flow handles unchanged users and retry path.
7. Shop hours update immediately reflects in hours history.
8. Pagination controls work on all updated list endpoints.

## 10) Postman + Swagger Status

All session APIs are present in `postman_collection.json` and documented in route Swagger annotations. Frontend developers should use Postman examples as request payload templates.
