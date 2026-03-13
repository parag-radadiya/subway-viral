# Frontend Developer Guide

This guide outlines the core user flows and integration logic for building a frontend on top of the Staff & Inventory Management API.

---

##  Authentication & Onboarding

### Flow: Initial Login
1. **Login**: `POST /api/auth/login`.
2. **Response Check**: If `must_change_password: true`, immediately redirect the user to a "Change Password" screen.
3. **Password Update**: `PUT /api/users/me/password` (Requires providing `currentPassword`).
4. **Completion**: Once updated, the user can proceed to the dashboard.

### Storing Tokens
- Store the JWT token securely (e.g., Secure Cookie or Encrypted Storage).
- Include `Authorization: Bearer <token>` in all subsequent requests.

---

## ⏰ Attendance: The Punch-In Flow

The punch-in process is a 3-step security handshake:

### 1. GPS Verification (GPS Validation)
- Get the user's current Coordinates.
- Call `POST /api/attendance/verify-location` with `shop_id`, `latitude`, and `longitude`.
- **Success**: You receive a `location_token` (valid for 5 minutes).
- **Failure**: Inform the user they are outside the shop's geofence boundaries.

### 2. Biometric Confirmation
- Trigger the native Biometric (FaceID/Fingerprint) prompt on the device.
- Ensure the user successfully authenticates locally.

### 3. Finalize Punch-In
- Call `POST /api/attendance/punch-in`.
- **Headers**: Include `x-device-id` (a unique persistent ID for that device).
- **Body**:
  ```json
  {
    "shop_id": "<ID>",
    "location_token": "<TOKEN_FROM_STEP_1>",
    "biometric_verified": true
  }
  ```
- The backend verifies the `location_token` and matches the `x-device-id` against the user's registered ID.

---

##  Rota & Dashboarding

### Bulk Weekly Rota (Manager Only)
- Managers can use a drag-and-drop or checklist UI to pick days and employees.
- Call `POST /api/rotas/bulk`.
- Use the `replace_existing: true` flag if the manager wants to overwrite the entire week for those users (e.g., when correcting a mistake).
- **Conflict Handling**: The API returns a `conflicts[]` array. Show these to the manager so they know which shifts were skipped.

### Dashboard Views
- Use `GET /api/rotas/dashboard?week_start=YYYY-MM-DD` to get a full weekly summary.
- The response provides `by_shop` (for store-view calendars) and `by_employee` (for staff-view calendars) in a single request.

---

##  Inventory Issue Tracking

### Ticket Lifecycle
1. **Reporting**: Call `POST /api/inventory/queries` to report an issue.
2. **Auto-Update**: The UI should automatically reflect the item status as "Damaged" in the inventory list.
3. **Closing**: To resolve an issue, call `PUT /api/inventory/queries/{id}/close` with repair costs and notes.
4. **Revert**: The item status will automatically flip back to "Good" via the backend logic.

---

##  Handling Permissions
The `user.role_id.permissions` object provided in the login response (or via `GET /api/users/me`) should be used to hide/show UI elements:
- `can_manage_rotas`: Show "Add Rota" / "Bulk Upload" buttons.
- `can_manage_inventory`: Show "Record Damage" / "Manage Stock" sections.
- `can_manual_punch`: Show "Manual Clock-In" override buttons.
