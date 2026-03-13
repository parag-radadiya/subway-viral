# Frontend Developer Guide (Ticket-Wise)

This guide is an execution plan for frontend integration with a **single login** and role-based dashboards.

## Ticket 1 - Authentication Shell and Session

### Goal
Implement one login flow for all users, then route by permissions.

### Integration Steps
1. Call `POST /api/auth/login`.
2. If `must_change_password` is true, force password screen.
3. Call `PUT /api/users/me/password`.
4. Fetch profile with `GET /api/users/me`.
5. Build app menu and dashboard from `data.role_id.permissions`.

### APIs
- `POST /api/auth/login`
- `PUT /api/users/me/password`
- `GET /api/users/me`

### Acceptance
- User cannot enter dashboard until mandatory password change is complete.
- Wrong credentials and rate-limit (`429`) are handled cleanly.

## Ticket 2 - Employee Dashboard (Staff)

### Goal
Show only self data for employee users.

### Integration Steps
1. Show profile using `GET /api/users/me`.
2. Load own rota list via `GET /api/rotas`.
3. Load own week rota via `GET /api/rotas/week?week_start=YYYY-MM-DD`.
4. Build punch workflow:
   - `POST /api/attendance/verify-location`
   - Biometric prompt
   - `POST /api/attendance/punch-in`
   - `PUT /api/attendance/{id}/punch-out`

### APIs
- `GET /api/users/me`
- `GET /api/rotas`
- `GET /api/rotas/week`
- `POST /api/attendance/verify-location`
- `POST /api/attendance/punch-in`
- `PUT /api/attendance/{id}/punch-out`

### Acceptance
- Employee sees only own rota data.
- Cross-shop punch-in is rejected with `403`.

## Ticket 3 - Sub-Manager Operations

### Goal
Enable inventory and manual operations UI for sub-managers.

### Integration Steps
1. Show inventory list and details (`/api/inventory/items`).
2. Show query list/detail and close flow (`/api/inventory/queries`).
3. Enable manual punch for staff where allowed.
4. Load assigned-shop staff summary for dashboard cards/tables.

### APIs
- `GET/POST/PUT/DELETE /api/inventory/items`
- `GET/POST /api/inventory/queries`
- `GET /api/inventory/queries/{id}`
- `PUT /api/inventory/queries/{id}/close`
- `POST /api/attendance/manual-punch-in`
- `GET /api/users/assigned-shops/staff-summary`

### Backend Gap for Requested Requirement
- Requested: sub-manager assigned to one or more shops and can view assigned-shop employees + rota.
- Current: assigned-shop employee summary endpoint is now available via `GET /api/users/assigned-shops/staff-summary`.

## Ticket 4 - Manager Dashboard

### Goal
Support rota publishing and employee lifecycle actions.

### Integration Steps
1. Weekly rota publish UI using `POST /api/rotas/bulk`.
2. Rota dashboard UI using `GET /api/rotas/dashboard`.
3. User joiner flow using `POST /api/users`.
4. Leaver flow using `DELETE /api/users/{id}` (soft deactivate).
5. Edit employee details with `PUT /api/users/{id}`.

### APIs
- `POST /api/rotas/bulk`
- `GET /api/rotas/dashboard`
- `POST /api/users`
- `PUT /api/users/{id}`
- `DELETE /api/users/{id}`

### Backend Gaps for Requested Requirement
- Requested: managers should be limited to admin-assigned shops.
- Current: user write actions are now constrained by assigned shops.
- Requested: manager can always create employees.
- Current: depends on role permissions data (`can_create_users`), not guaranteed by code alone.

## Ticket 5 - Admin Dashboard

### Goal
Full organization control for admin/root users.

### Integration Steps
1. Role management UI (`/api/roles`).
2. Shop management UI (`/api/shops`).
3. Full staff oversight (`/api/users`, `/api/attendance`, rota dashboard).
4. Manager/sub-manager creation and updates through user management.

### APIs
- `GET/POST/PUT/DELETE /api/roles`
- `GET/POST/PUT/DELETE /api/shops`
- `GET/POST/PUT/DELETE /api/users`
- `GET /api/attendance`
- `GET /api/rotas/dashboard`

## UI Visibility Matrix (Single Login)

- `can_manage_rotas`: show rota create/edit/publish actions.
- `can_manage_inventory`: show items + queries modules.
- `can_manual_punch`: show manual punch feature.
- `can_create_users`: show employee create/update/deactivate actions.
- `can_manage_shops`: show shop management module.
- `can_manage_roles`: show role management module.
- `can_view_all_staff`: show organization-level analytics/lists.

## API Coverage Check vs Your Requirement

### Available Now
- Single login and password-change onboarding.
- Self-profile endpoint (`GET /api/users/me`).
- Multi-shop assignment field (`assigned_shop_ids`) on user profile and auth payload.
- Employee self rota visibility protection.
- Assignment-scoped read filtering for users, rotas, inventory items, and inventory queries.
- Assignment-scoped write constraints for inventory items and inventory queries.
- Inventory and query modules for permissioned roles.
- Manager/admin rota publishing and dashboards.

### Missing or Partial (Need Backend Tickets)
No critical gaps pending from current requested scope.

## Recommended Backend Tickets (Next)

- Optional: Add richer assigned-shop dashboard endpoint with attendance + weekly rota aggregates in one payload.

## Reference

- Detailed role journey: `USER_FLOW.md`
