# End-to-End Test Cases (Frontend + API)

This document gives your frontend team a detailed checklist of **success**, **error**, and **security** scenarios for the current backend.

Use these tests against local/staging APIs before every release.

## 1) Test Setup

- Base URL: `http://localhost:3000`
- Auth endpoint: `POST /api/auth/login`
- Response envelope expected on all endpoints:

```json
{
  "status": 200,
  "message": "...",
  "data": {}
}
```

### Test Accounts (recommended)

- `root/admin` user with all permissions
- `manager` user (rota + staff management)
- `sub-manager` user (inventory + manual punch)
- `employee` user (self rota + self attendance)
- `deactivated` user (`is_active: false`)

### Shared Assertions for Every Test

- HTTP status code matches `response.status`
- `message` is present and non-empty
- `data` is always an object (not null, not array root)
- Errors still follow the same envelope

---

## 2) Authentication + Onboarding

### AUTH-001 Login success

- API: `POST /api/auth/login`
- Input: valid `email`, `password`
- Expect:
  - HTTP `200`
  - `data.token` exists
  - `data.user.role.permissions` exists
  - frontend routes user to role dashboard based on permissions

### AUTH-002 Login missing fields

- Input: only email or only password
- Expect: HTTP `400`, message like required fields error

### AUTH-003 Login invalid credentials

- Input: valid email + wrong password
- Expect: HTTP `401`, invalid credentials message

### AUTH-004 Login deactivated user

- Input: deactivated user credentials
- Expect: HTTP `401`

### AUTH-005 Login rate limit

- Repeat invalid login until threshold
- Expect: HTTP `429`

### AUTH-006 Must change password flow

- Precondition: user has `must_change_password=true`
- Steps:
  1. Login
  2. Call `PUT /api/users/me/password`
- Expect:
  - login returns `must_change_password=true`
  - password update returns `200`
  - next login returns `must_change_password=false`

### AUTH-007 Password change wrong current password

- API: `PUT /api/users/me/password`
- Input: wrong `currentPassword`
- Expect: HTTP `401`

### AUTH-008 Password change weak new password

- Input: `newPassword` length < 8
- Expect: HTTP `400`

---

## 3) Global Auth Guard + Token Security

### SEC-001 Missing token

- Call any protected endpoint without bearer token
- Expect: HTTP `401`

### SEC-002 Expired/invalid token

- Use tampered token
- Expect: HTTP `401`

### SEC-003 Token of user A accessing user B sensitive action

- Example: employee tries to punch out another employee attendance ID
- Expect: HTTP `403`

### SEC-004 Unknown route format

- Call invalid path like `/api/unknown`
- Expect: HTTP `404` with standard envelope

---

## 4) Role-Based UI Visibility (Frontend)

### UI-EMP-001 Employee dashboard visibility

- Expect visible:
  - self rota views (`GET /api/rotas`, `GET /api/rotas/week`)
  - punch in/out screens
- Expect hidden:
  - user create/delete
  - role management
  - shop management
  - inventory modules (unless permissions explicitly granted)

### UI-SM-001 Sub-manager dashboard visibility

- Expect visible:
  - inventory items screen
  - inventory queries screen
  - manual punch screen
- Expect hidden:
  - role management
  - admin-only controls

### UI-MGR-001 Manager dashboard visibility

- Expect visible:
  - rota create/update/delete/bulk
  - dashboard weekly summaries
  - staff onboarding/leaver actions if `can_create_users=true`

### UI-ADMIN-001 Admin dashboard visibility

- Expect visible all major modules:
  - users, roles, shops, rota, attendance oversight, inventory oversight

### UI-ALL-001 Permission-driven UI (not role-name hardcoded)

- Modify role permission flags in DB
- Login again
- Expect UI changes according to `data.user.role.permissions`

---

## 5) Users Module

### USER-001 List users success

- API: `GET /api/users`
- Token: role with `can_view_all_staff`
- Expect: `200`, `data.users[]`

### USER-002 List users forbidden

- Token: employee
- Expect: `403`

### USER-003 Get user by ID success

- API: `GET /api/users/:id`
- Expect: `200`

### USER-004 Get user not found

- Invalid/non-existent ID
- Expect: `404`

### USER-005 Create user success

- API: `POST /api/users`
- Token: role with `can_create_users`
- Expect: `201`, `must_change_password=true` for created user

### USER-006 Create user duplicate email

- Same email as existing user
- Expect: `400`

### USER-007 Create user forbidden

- Token without `can_create_users`
- Expect: `403`

### USER-008 Update user success

- API: `PUT /api/users/:id`
- Expect: `200`

### USER-009 Update user not found

- Expect: `404`

### USER-010 Deactivate user success

- API: `DELETE /api/users/:id`
- Expect: `200`, `is_active=false`

### USER-011 Deactivated user cannot login

- Try login with deactivated user
- Expect: `401`

---

## 6) Roles Module

### ROLE-001 List roles success

- API: `GET /api/roles`
- Token with `can_manage_roles`
- Expect: `200`

### ROLE-002 Roles forbidden

- Token without `can_manage_roles`
- Expect: `403`

### ROLE-003 Create role success

- API: `POST /api/roles`
- Expect: `201`

### ROLE-004 Update role success

- API: `PUT /api/roles/:id`
- Expect: `200`

### ROLE-005 Delete role success

- API: `DELETE /api/roles/:id`
- Expect: `200`

### ROLE-006 Delete role in use (if referenced)

- Try deleting role assigned to users
- Expect: validation/protection error (usually `400`/`409`)

---

## 7) Shops Module

### SHOP-001 List shops success

- API: `GET /api/shops`
- Any authenticated user
- Expect: `200`

### SHOP-002 Get shop success

- API: `GET /api/shops/:id`
- Expect: `200`

### SHOP-003 Create shop success

- Token with `can_manage_shops`
- Expect: `201`

### SHOP-004 Create shop forbidden

- Token without `can_manage_shops`
- Expect: `403`

### SHOP-005 Update geofence radius

- API: `PUT /api/shops/:id`
- Expect: `200`; new radius used by `verify-location`

### SHOP-006 Delete shop success

- API: `DELETE /api/shops/:id`
- Expect: `200`

---

## 8) Rota Module

### ROTA-001 List rota success

- API: `GET /api/rotas`
- Expect: `200`, sorted records

### ROTA-002 Get rota by ID success

- API: `GET /api/rotas/:id`
- Expect: `200`

### ROTA-003 Create single rota success

- API: `POST /api/rotas`
- Token with `can_manage_rotas`
- Expect: `201`

### ROTA-004 Create single rota duplicate

- Same `user_id + shift_date + start_time`
- Expect: `409`

### ROTA-005 Create single rota forbidden

- Token without `can_manage_rotas`
- Expect: `403`

### ROTA-006 Bulk create success

- API: `POST /api/rotas/bulk`
- Valid `shop_id`, `week_start`, `days[]`, `assignments[]`
- Expect: `201`, created count

### ROTA-007 Bulk create partial conflicts

- Include duplicate rows
- Expect: `201`, `data.conflicts[]` populated

### ROTA-008 Bulk create invalid day values

- `days` contains `-1` or `7`
- Expect: `400`

### ROTA-009 Week view success

- API: `GET /api/rotas/week?week_start=...`
- Expect: `200`, Mon-Sun grouped data

### ROTA-010 Week view missing week_start

- Expect: `400`

### ROTA-011 Clear week success

- API: `DELETE /api/rotas/week`
- Token with `can_manage_rotas`
- Expect: `200`, deleted count

### ROTA-012 Dashboard success

- API: `GET /api/rotas/dashboard?week_start=...`
- Token with `can_view_all_staff`
- Expect: `200`, `data.by_shop` and `data.by_employee`

### ROTA-013 Dashboard forbidden

- Employee token
- Expect: `403`

### ROTA-014 Staff list ignores foreign user filter (self-scope enforced)

- API: `GET /api/rotas?user_id=<another-user-id>`
- Token: employee
- Expect: `200`, records belong to logged-in employee only

### ROTA-015 Staff cannot fetch other user rota by ID

- API: `GET /api/rotas/:id`
- Token: employee, `:id` belongs to another user
- Expect: `404`

### ROTA-016 Manager rota reads limited to assigned shops

- API: `GET /api/rotas`, `GET /api/rotas/week?shop_id=<unassigned-shop>&week_start=...`
- Token: manager with limited `assigned_shop_ids`
- Expect: unassigned shop data excluded/empty

### ROTA-017 Manager cannot create rota in unassigned shop

- API: `POST /api/rotas`
- Token: manager with limited shop scope
- Expect: `403`

### ROTA-018 Manager cannot update/delete rota in unassigned shop

- API: `PUT /api/rotas/:id`, `DELETE /api/rotas/:id`
- Token: manager with limited shop scope
- Expect: `403`

### ROTA-019 Clear week respects manager shop scope

- API: `DELETE /api/rotas/week?week_start=...`
- Token: manager with limited `assigned_shop_ids`
- Expect: only assigned-shop week data deleted

### ROTA-020 Create rota using merged datetime keys

- API: `POST /api/rotas`
- Payload uses `shift_start` and `shift_end`
- Expect: `201`, stored `start_time`/`end_time` derived correctly

### ROTA-021 Block overlapping shift for same employee

- API: `POST /api/rotas`
- Create `08:00-12:00` then try `09:00-12:00` for same user/date
- Expect: `409`

### ROTA-022 Allow adjacent shifts for same employee

- API: `POST /api/rotas`
- Create `08:00-12:00` and then `12:00-16:00` for same user/date
- Expect: both succeed (`201`)

### ROTA-023 Bulk create skips overlapping windows

- API: `POST /api/rotas/bulk`
- Two assignments overlap for same user/day
- Expect: `201`, one created and one skipped with overlap reason in `data.conflicts[]`

---

## 9) Attendance Module

### ATT-001 Verify location success

- API: `POST /api/attendance/verify-location`
- Input: in-range coordinates
- Expect: `200`, `data.location_token`

### ATT-002 Verify location outside geofence

- Input: far coordinates
- Expect: `403`

### ATT-003 Verify location missing fields

- Missing `shop_id` or lat/lng
- Expect: `400`

### ATT-004 Punch in success

- API: `POST /api/attendance/punch-in`
- Requires:
  - valid `location_token`
  - `biometric_verified=true`
  - matching `x-device-id`
- Expect: `201`

### ATT-005 Punch in biometric false

- `biometric_verified=false`
- Expect: `403`

### ATT-006 Punch in token mismatch

- token generated for different shop/user
- Expect: `403`

### ATT-007 Punch in expired/invalid location token

- Expect: `403`

### ATT-008 Punch in missing/invalid device id

- No `x-device-id` or wrong value
- Expect: `403`

### ATT-009 Punch in when already punched in

- existing open attendance record
- Expect: `400`

### ATT-010 Punch out success

- API: `PUT /api/attendance/:id/punch-out`
- Same user owning attendance
- Expect: `200`

### ATT-011 Punch out duplicate

- punch-out same record again
- Expect: `400`

### ATT-012 Punch out other user record

- user A tries to punch out user B attendance
- Expect: `403`

### ATT-013 Manual punch success

- API: `POST /api/attendance/manual-punch-in`
- Token with `can_manual_punch`
- Expect: `201`, `is_manual=true`, `manual_by` set

### ATT-014 Manual punch forbidden

- Employee token
- Expect: `403`

### ATT-015 Manual punch user not found

- Invalid `user_id`
- Expect: `404`

### ATT-016 Attendance list success

- API: `GET /api/attendance`
- Token with `can_view_all_staff`
- Expect: `200`, records array

### ATT-017 Attendance list self-scope for employee

- API: `GET /api/attendance?user_id=<another-user-id>`
- Employee token
- Expect: `200`, records limited to logged-in employee

### ATT-018 Punch in blocked when device is not registered

- API: `POST /api/attendance/punch-in`
- Precondition: `device_id` is null for logged-in employee
- Expect: `403`

### ATT-019 Admin can view attendance across shops

- API: `GET /api/attendance`
- Token: admin/root
- Expect: `200`, includes multi-shop records

### ATT-020 Sub-manager attendance view is assigned-shop only

- API: `GET /api/attendance`
- Token: sub-manager with limited `assigned_shop_ids`
- Expect: `200`, records only from assigned shops

---

## 10) Inventory Items Module

### INV-001 List items success

- API: `GET /api/inventory/items`
- Token with `can_manage_inventory`
- Expect: `200`

### INV-012 List items pagination and sorting

- API: `GET /api/inventory/items?page=1&limit=20&sort_by=item_name&sort_order=asc`
- Expect: `200`, response includes `total`, `page`, `limit`, `total_pages`, and sorted `items`

### INV-002 List items forbidden

- Token without permission
- Expect: `403`

### INV-003 Create item success

- API: `POST /api/inventory/items`
- Expect: `201`

### INV-004 Create item validation failure

- Missing required fields
- Expect: `400`

### INV-005 Get item by ID success

- API: `GET /api/inventory/items/:id`
- Expect: `200`

### INV-006 Get item not found

- Expect: `404`

### INV-007 Update item success

- API: `PUT /api/inventory/items/:id`
- Expect: `200`

### INV-008 Delete item success

- API: `DELETE /api/inventory/items/:id`
- Expect: `200`

### INV-011 Delete item blocked when linked queries exist

- API: `DELETE /api/inventory/items/:id`
- Precondition: item has at least one inventory query
- Expect: `409`

---

## 11) Inventory Queries Module

### QRY-001 List queries success

- API: `GET /api/inventory/queries`
- Token with `can_manage_inventory`
- Expect: `200`

### QRY-002 Open query success + item auto-damaged

- API: `POST /api/inventory/queries`
- Expect:
  - `201`
  - linked item status becomes `Damaged`

### QRY-003 Open query invalid item

- non-existent `item_id`
- Expect: `404` or `400`

### QRY-004 Get query by ID success

- API: `GET /api/inventory/queries/:id`
- Expect: `200`

### QRY-005 Close query success + item auto-good

- API: `PUT /api/inventory/queries/:id/close`
- Expect:
  - `200`
  - linked item status becomes `Good`

### QRY-006 Close already closed query

- Expect: `409` (deterministic conflict)

### QRY-007 Inventory queries forbidden

- token without `can_manage_inventory`
- Expect: `403`

### QRY-009 Prevent second open query for same item

- API: `POST /api/inventory/queries`
- Open query once for item, then open again while first is still open
- Expect: `409`

### QRY-010 List queries pagination and sorting

- API: `GET /api/inventory/queries?page=1&limit=20&sort_by=createdAt&sort_order=desc`
- Expect: `200`, response includes `total`, `page`, `limit`, `total_pages`, and sorted `queries`

### QRY-011 Close with another open query keeps item Damaged

- Precondition: legacy data has 2 open queries for same item
- Close one query
- Expect: item status remains `Damaged`

### QRY-012 Concurrent close calls are deterministic

- Send two close requests simultaneously for the same open query
- Expect: one `200`, one `409`

### AUD-001 Inventory audit logs list success

- API: `GET /api/inventory/audit-logs`
- Token with `can_manage_inventory`
- Expect: `200`, logs with action, actor, and timestamps

---

## 12) Cross-Role and Data-Leak Security Tests (High Priority)

### LEAK-001 Employee data isolation

- Employee calls list endpoints with another user/shop filter
- Expected secure behavior: only self/allowed data should return
- Flag as **critical** if unrelated data appears

### LEAK-002 Manager/sub-manager shop scope isolation

- Query users/rotas/inventory from unassigned shop IDs
- Expected secure behavior: blocked or empty result
- Flag as **critical** if data leaks

### LEAK-003 Manual punch misuse

- Sub-manager manually punches staff from unassigned shop
- Expected secure behavior: blocked
- Flag if allowed

### LEAK-004 Role escalation attempt

- User without permission calls privileged endpoints
- Expect: `403` always

### LEAK-005 Location token replay

- Reuse one `location_token` after successful punch-in or after expiration
- Expected secure behavior: reject (`403`)

---

## 13) Contract and Documentation Consistency Checks

### DOC-001 Envelope consistency

- Verify all endpoints (including errors) follow status/message/data format

### DOC-002 Frontend guide endpoint validity

- Verify every endpoint in `FRONTEND_GUIDE.md` exists and is callable

### DOC-003 User flow endpoint validity

- Verify every endpoint in `USER_FLOW.md` exists and is callable
- Note: `GET /api/users/assigned-shops/staff-summary` should be verified; if missing, open a backend ticket

---

## 14) Suggested Execution Order (Ticket-wise)

1. `P0`: Auth + token + password flow (`AUTH-*`, `SEC-*`)
2. `P0`: Role visibility + permission gating (`UI-*`, forbidden checks)
3. `P0`: Attendance flow (`ATT-*`) including geofence/device/biometric failures
4. `P1`: Rota + dashboard (`ROTA-*`)
5. `P1`: Users + shops + roles admin flows (`USER-*`, `SHOP-*`, `ROLE-*`)
6. `P1`: Inventory + query lifecycle (`INV-*`, `QRY-*`)
7. `P0`: Data-leak tests (`LEAK-*`) before production release

---

## 15) Bug Report Template (for frontend QA)

When any test fails, capture:

- Test ID (example: `ATT-008`)
- API endpoint + method
- Request payload/headers
- Actual response body
- Expected response body/status
- Role used
- Repro steps
- Screenshot/video if UI-related

This will help backend fix issues quickly and avoid back-and-forth with frontend team.
