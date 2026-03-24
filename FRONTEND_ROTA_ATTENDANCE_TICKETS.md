# Frontend Change Tickets: Rota + Attendance Merge

This document breaks down required frontend work for the new rota-linked attendance flow.

## Scope Summary

- Punch-in now requires a rota context.
- Backend supports two modes:
  - explicit rota selection (`rota_id` sent from frontend)
  - backend auto-selection (when `rota_id` is omitted)
- Punch-in window policy:
  - allowed from 1 hour before shift start
  - allowed until 2 hours after shift end
- Attendance records now include:
  - `rota_id`
  - `auto_punch_out_at`
  - `punch_out_source` (`Manual` or `Auto`)

---

## Ticket FE-ATT-001: Add Eligible Rota Fetch Before Punch-In

### Goal

Show user which shifts are eligible to punch in right now.

### API Endpoint

- `GET /api/attendance/eligible-rotas?shop_id=<SHOP_ID>`

### Request

- Headers:
  - `Authorization: Bearer <token>`

### Success Response (200)

- `data.count`
- `data.rotas[]` (rota objects)

### UI Requirements

- Trigger this call after shop selection and before final punch-in submit.
- If `count === 0`, disable punch-in CTA and show an actionable message.
- If `count === 1`, auto-select that rota.
- If `count > 1`, force user to select one rota.

### Acceptance Criteria

- User can always see current eligible shifts.
- No punch-in call is made when no eligible rota exists.

---

## Ticket FE-ATT-002: Update Punch-In Payload with Optional Rota

### Goal

Send selected rota when available, while preserving auto-selection fallback.

### API Endpoint

- `POST /api/attendance/punch-in`

### Required Existing Inputs

- Header: `x-device-id`
- Body:
  - `shop_id`
  - `location_token`
  - `biometric_verified`

### New Optional Input

- `rota_id`

### Example Payload

```json
{
  "shop_id": "<shop_id>",
  "location_token": "<location_token>",
  "biometric_verified": true,
  "rota_id": "<selected_rota_id>"
}
```

### UI Requirements

- Include `rota_id` when user selected one.
- If not selected and only one eligible rota exists, include that rota id automatically.
- If user bypasses selection (and backend auto-selects), handle backend response rota details for UI confirmation.

### Acceptance Criteria

- Punch-in works with explicit rota selection.
- Punch-in still works when `rota_id` is omitted and backend can auto-match.

---

## Ticket FE-ATT-003: Show New Attendance Fields in History and Detail

### Goal

Expose rota-linked attendance state clearly to users and managers.

### API Endpoints

- `GET /api/attendance`
- existing attendance detail source in current UI state (if any)

### New/Important Fields

- `attendance.rota_id`
- `attendance.auto_punch_out_at`
- `attendance.punch_out_source`

### UI Requirements

- Add columns/labels in attendance table/detail view:
  - Shift reference (`rota_id` or shift time summary)
  - Auto punch-out deadline (`auto_punch_out_at`)
  - Punch-out source badge (`Manual`/`Auto`)
- For `punch_out_source = Auto`, display a helper text like: "Auto closed by system".

### Acceptance Criteria

- Attendance screens reflect whether closure was manual or automatic.
- Support and operations can inspect rota linkage quickly.

---

## Ticket FE-ATT-004: Update Error Handling for Rota Window Validation

### Goal

Provide clear UX when punch-in is rejected due to timing/rota mismatch.

### Common Backend Failures to Handle

- `400`: no eligible rota found in allowed window
- `400`: selected rota outside punch-in window
- `404`: selected rota not found for user/shop

### UI Requirements

- Map these cases to actionable messages:
  - "No eligible shift found. You can punch in from 1 hour before shift start until 2 hours after shift end."
  - "Selected shift is not in the allowed punch-in window."
  - "Selected shift is invalid for this shop/user. Please refresh and reselect."
- For all three, provide a "Refresh shifts" action that re-calls eligible rota API.

### Acceptance Criteria

- User gets specific recovery guidance, not a generic failure toast.

---

## Ticket FE-ATT-005: Manual Punch-In Screen (Supervisor Flow)

### Goal

Align manual punch-in UI with rota-linked backend behavior.

### API Endpoint

- `POST /api/attendance/manual-punch-in`

### Request Body (updated)

```json
{
  "user_id": "<staff_user_id>",
  "shop_id": "<shop_id>",
  "rota_id": "<optional_selected_rota_id>"
}
```

### UI Requirements

- On staff selection, optionally fetch and show eligible rotas for selected staff/shop (reuse FE-ATT-001 logic with user context if available in your UI architecture).
- If rota selection is supported in manual flow UI, send `rota_id`.
- Show clear errors for ineligible rota/time.

### Acceptance Criteria

- Supervisor can perform manual punch-in with rota linkage.
- Existing permission checks remain unchanged in UI guards.

---

## Ticket FE-ATT-006: Punch Lifecycle UX and State Sync

### Goal

Prevent stale UI state after punch-in/punch-out and reflect auto-close.

### API Endpoints

- `POST /api/attendance/punch-in`
- `PUT /api/attendance/{attendance_id}/punch-out`
- `GET /api/attendance`

### UI Requirements

- After successful punch-in:
  - store returned `attendance._id`
  - show active shift summary from `attendance.rota_id`
  - start local timer/countdown to `auto_punch_out_at`
- After successful punch-out:
  - clear active attendance state
  - refresh attendance list
- On screen load/app resume:
  - refresh attendance list to detect server-side auto punch-out completion.

### Acceptance Criteria

- Active/closed state is accurate after refresh and app resume.
- Auto-closed records become visible without manual support intervention.

---

## Ticket FE-ATT-007: End-to-End Punch-In Flow Integration

### Goal

Implement final production flow with all required backend calls and guards.

### End-to-End Flow

1. User selects shop.
2. App fetches eligible rotas:
   - `GET /api/attendance/eligible-rotas?shop_id=...`
3. App captures location and verifies geofence:
   - `POST /api/attendance/verify-location`
4. App performs biometric check locally.
5. App submits punch-in:
   - `POST /api/attendance/punch-in` with optional `rota_id`
6. App displays success state and linked shift details.

### Acceptance Criteria

- Flow works for:
  - single eligible rota
  - multiple eligible rotas with user selection
  - no eligible rota (blocked with clear message)

---

## Ticket FE-AUTH-001: Adopt Access + Refresh Token Flow

### Goal

Support token expiry with refresh token rotation.

### API Endpoints

- `POST /api/auth/login`
- `POST /api/auth/refresh-token`
- `POST /api/auth/logout`

### Expected Login Response Fields

- `data.access_token`
- `data.refresh_token`
- `data.refresh_token_expires_at`
- `data.token` (legacy alias, still available)

### UI/Client Requirements

1. Store `access_token` and `refresh_token` securely.
2. Use `access_token` in `Authorization` header.
3. On 401 due to access token expiry, call refresh endpoint once and retry original request.
4. Replace both tokens after successful refresh (rotation).
5. On logout, call `/api/auth/logout` with current `refresh_token` and clear local auth storage.

### Refresh Request Example

```json
{
  "refresh_token": "<refresh_token>"
}
```

### Acceptance Criteria

- Expired access token can be renewed without forcing re-login.
- Old refresh token stops working after refresh rotation.

---

## Ticket FE-AUTH-002: Trigger Self Reconcile on Login/Refresh/Logout Hooks

### Goal

Ensure user-level overdue attendance is reconciled quickly from auth lifecycle screens.

### API Endpoint

- `POST /api/attendance/reconcile-self`

### Trigger Points

1. After successful login.
2. After successful token refresh.
3. Before local sign-out completion (best effort, non-blocking).

### Notes

- Backend already performs reconciliation during login/refresh/logout, but this endpoint gives frontend explicit control for admin/user screens.
- Call is idempotent and safe to retry.

### Acceptance Criteria

- Client can force reconciliation from auth-related UI events.
- Failures do not block login/logout UI completion.

---

## Ticket FE-ADMIN-001: Add Admin Reconcile Action in Attendance Admin Screen

### Goal

Give admins/managers a manual action to reconcile overdue auto punch-outs for all users.

### API Endpoint

- `POST /api/attendance/reconcile-overdue`

### Access

- Requires token of user with `can_view_all_staff` permission.

### UI Requirements

1. Add "Reconcile Overdue Punch-Outs" button in admin attendance screen.
2. On click, call endpoint and show a summary toast with `processed` and `updated` counts.
3. Refresh attendance list after success.
4. Disable button while request is running to avoid duplicate clicks.

### Example Success Payload

```json
{
  "status": 200,
  "message": "Overdue attendance auto punch-out reconciliation completed",
  "data": {
    "processed": 12,
    "updated": 12
  }
}
```

### Acceptance Criteria

- Admin can trigger reconciliation from UI without support intervention.
- Reconcile result is visible immediately and attendance table reflects changes.

---

## Token Lifecycle Flow (Implementation Reference)

1. Login:
   - Call `POST /api/auth/login`
   - Save `access_token`, `refresh_token`, `refresh_token_expires_at`
2. API request failure with 401:
   - Attempt one refresh via `POST /api/auth/refresh-token`
   - Replace both tokens (rotation)
   - Retry original request once
3. Refresh failure (401/expired):
   - Clear auth storage
   - Redirect to login
4. Logout:
   - Call `POST /api/auth/logout` with current `refresh_token`
   - Clear auth storage regardless of API outcome (best effort)

---

## API Response Contracts (Frontend Parsing)

### `POST /api/auth/login` and `POST /api/auth/refresh-token`

- Parse from `data`:
  - `access_token`
  - `refresh_token`
  - `refresh_token_expires_at`
  - `token` (legacy alias; keep fallback only)

### `POST /api/attendance/reconcile-self`

- `data.processed`: records checked in this run
- `data.updated`: records auto-closed in this run

### `POST /api/attendance/reconcile-overdue`

- Same fields as self reconcile (`processed`, `updated`), but global scope.

---

## Release Checklist (Frontend + Backend Integration)

- [ ] Backend deployed with new auth endpoints and attendance reconcile endpoints.
- [ ] Frontend auth interceptor updated for refresh-token rotation.
- [ ] Admin attendance screen includes global reconcile action.
- [ ] Login/refresh/logout hooks call self reconcile (best effort).
- [ ] Regression tested for old `data.token` fallback clients.
- [ ] API error states mapped for refresh expiry and rota window violations.

---

## QA Checklist (Frontend)

- [ ] Eligible rota API integrated and rendered.
- [ ] Punch-in sends `rota_id` when selected.
- [ ] Punch-in works with omitted `rota_id` when backend can auto-match.
- [ ] Attendance list shows `rota_id`, `auto_punch_out_at`, `punch_out_source`.
- [ ] Manual punch-in supports new payload shape.
- [ ] Error mapping added for rota-window failures.
- [ ] State sync verified after app resume and refresh.
- [ ] Token refresh interceptor implemented and tested.
- [ ] Logout revokes refresh token on server.

---

## API Quick Reference

- `GET /api/attendance/eligible-rotas?shop_id=<SHOP_ID>`
- `POST /api/attendance/reconcile-overdue`
- `POST /api/attendance/reconcile-self`
- `POST /api/attendance/verify-location`
- `POST /api/attendance/punch-in`
- `POST /api/attendance/manual-punch-in`
- `PUT /api/attendance/{attendance_id}/punch-out`
- `GET /api/attendance`
- `POST /api/auth/login`
- `POST /api/auth/refresh-token`
- `POST /api/auth/logout`
