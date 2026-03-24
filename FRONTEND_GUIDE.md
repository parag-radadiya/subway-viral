# Frontend Developer Guide

This guide outlines the core user flows and integration logic for building a frontend on top of the Staff & Inventory Management API.

## API Response Contract (All Endpoints)

Every API now returns a unified envelope:

```json
{
  "status": 200,
  "message": "Human readable message",
  "data": {}
}
```

- `status`: mirrors the HTTP status code.
- `message`: user-friendly or developer-friendly summary.
- `data`: payload object (empty object when there is no payload).

Error responses also follow the same envelope (for example `400`, `401`, `403`, `404`, `409`, `429`, `500`).

---

## Authentication & Onboarding

### Flow: Initial Login

1. **Login**: `POST /api/auth/login`.
2. **Response Check**: If `data.must_change_password: true`, immediately redirect the user to a "Change Password" screen.
3. **Password Update**: `PUT /api/users/me/password` (Requires providing `currentPassword`).
4. **Completion**: Once updated, the user can proceed to the dashboard.

### Storing Tokens

- Store the JWT token securely (e.g., Secure Cookie or Encrypted Storage).
- Include `Authorization: Bearer <token>` in all subsequent requests.

### Access + Refresh Token (New)

- Login now returns:
  - `access_token`
  - `refresh_token`
  - `refresh_token_expires_at`
  - legacy `token` alias (same as `access_token`)
- When access token expires, call `POST /api/auth/refresh-token` with:
  ```json
  { "refresh_token": "<REFRESH_TOKEN>" }
  ```
- Replace both tokens after refresh (token rotation).
- On logout call `POST /api/auth/logout` with refresh token to revoke session server-side.

---

## ⏰ Attendance + Rota: Punch-In and Punch-Out Flow

Punch-in now requires a rota context. Backend supports both auto selection and explicit rota selection.

### Key Rules (New)

- User can punch in only when rota is eligible for now:
  - from **1 hour before shift start**, until
  - **2 hours after shift end**.
- `rota_id` is saved in attendance records.
- If user forgets punch-out, backend auto closes attendance at `shift_end + 2h`.
- Auto punch-out is event-driven (runs on normal attendance API calls), so UI should not assume it is real-time to the exact minute.

The secure handshake is still 3 steps:

### 1. GPS Verification (GPS Validation)

- Get the user's current Coordinates.
- Call `POST /api/attendance/verify-location` with `shop_id`, `latitude`, and `longitude`.
- **Success**: You receive a `location_token` (valid for 5 minutes).
- **Failure**: Inform the user they are outside the shop's geofence boundaries.

### 2. Biometric Confirmation

- Trigger the native Biometric (FaceID/Fingerprint) prompt on the device.
- Ensure the user successfully authenticates locally.

### 3. Finalize Punch-In

- Optional step before this call: fetch eligible rotas for current user/shop:
  - `GET /api/attendance/eligible-rotas?shop_id=<SHOP_ID>`
  - Use this to show selectable shifts in UI.
- Call `POST /api/attendance/punch-in`.
- **Headers**: Include `x-device-id` (a unique persistent ID for that device).
- **Body**:
  ```json
  {
    "shop_id": "<ID>",
    "location_token": "<TOKEN_FROM_STEP_1>",
    "biometric_verified": true,
    "rota_id": "<OPTIONAL_ROTA_ID>"
  }
  ```
- The backend verifies the `location_token` and matches the `x-device-id` against the user's registered ID.
- If `rota_id` is omitted, backend auto-selects the best eligible rota.

### Punch-Out

- Existing API remains: `PUT /api/attendance/{attendance_id}/punch-out`.
- For manually closed records, API sets `punch_out_source: "Manual"`.
- For auto closed records, API sets `punch_out_source: "Auto"`.

### UI Changes Required

1. Add rota picker before final punch-in (optional but recommended).
2. If eligible rota list has 1 item, auto-select it.
3. If list has multiple items, force user selection.
4. On attendance history screen, show `rota_id`, `auto_punch_out_at`, and `punch_out_source`.
5. If punch-in fails with rota window message, show a clear toast: "You can punch in from 1 hour before shift start until 2 hours after shift end.".

---

## Rota & Dashboarding

### Bulk Weekly Rota (Manager Only)

- Managers can use a drag-and-drop or checklist UI to pick days and employees.
- Call `POST /api/rotas/bulk`.
- Use the `replace_existing: true` flag if the manager wants to overwrite the entire week for those users (e.g., when correcting a mistake).
- **Conflict Handling**: The API returns a `conflicts[]` array. Show these to the manager so they know which shifts were skipped.

### Dashboard Views

- Use `GET /api/rotas/dashboard?week_start=YYYY-MM-DD` to get a full weekly summary.
- The response provides `by_shop` (for store-view calendars) and `by_employee` (for staff-view calendars) in a single request.

---

## Inventory Issue Tracking

### Ticket Lifecycle

1. **Reporting**: Call `POST /api/inventory/queries` to report an issue.
2. **Auto-Update**: The UI should automatically reflect the item status as "Damaged" in the inventory list.
3. **Closing**: To resolve an issue, call `PUT /api/inventory/queries/{id}/close` with repair costs and notes.
4. **Revert**: The item status will automatically flip back to "Good" via the backend logic.

### Screen -> API Mapping

- **Inventory List Screen**
  - `GET /api/inventory/items?page=1&limit=20&sort_by=createdAt&sort_order=desc`

- **Inventory Item View Screen**
  - `GET /api/inventory/items/{item_id}`
  - optional related tickets: `GET /api/inventory/queries?item_id={item_id}`

- **Inventory Query List Screen**
  - `GET /api/inventory/queries?page=1&limit=20&sort_by=createdAt&sort_order=desc`

- **Inventory Query View Screen**
  - `GET /api/inventory/queries/{query_id}`
  - close action (if open): `PUT /api/inventory/queries/{query_id}/close`

- **Inventory Audit Timeline Screen**
  - `GET /api/inventory/audit-logs?page=1&limit=20&sort_by=createdAt&sort_order=desc`

---

## Handling Permissions

The `data.user.role.permissions` object from the login response should be used to hide/show UI elements:

- `can_manage_rotas`: Show "Add Rota" / "Bulk Upload" buttons.
- `can_manage_inventory`: Show "Record Damage" / "Manage Stock" sections.
- `can_manual_punch`: Show "Manual Clock-In" override buttons.
