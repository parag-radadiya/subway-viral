# User Flow (Single Login, Role-Based UI)

This document defines the frontend user journey after **one login endpoint**: `POST /api/auth/login`.

## 1) Global Login Flow (All Roles)

1. User enters email + password.
2. Frontend calls `POST /api/auth/login`.
3. If `must_change_password = true`, force `PUT /api/users/me/password` before dashboard access.
4. After password flow, frontend calls `GET /api/users/me`.
5. Frontend derives role + permissions from `data.role_id.permissions` and shows the correct dashboard.

## 2) Role Routing After Login

- **Employee (Staff)**
  - Default route: Employee Dashboard
  - Visible modules:
    - My Profile (`GET /api/users/me`)
    - My Rotas (`GET /api/rotas`, `GET /api/rotas/week`)
    - Punch In (`POST /api/attendance/verify-location`, `POST /api/attendance/punch-in`)
    - Punch Out (`PUT /api/attendance/{id}/punch-out`)

- **Sub-Manager**
  - Default route: Operations Dashboard
  - Visible modules:
    - Inventory Items (`/api/inventory/items/*`)
    - Inventory Queries (`/api/inventory/queries/*`)
    - Manual Punch (`POST /api/attendance/manual-punch-in`)
    - Assigned-shop employee summary (`GET /api/users/assigned-shops/staff-summary`)

- **Manager**
  - Default route: Manager Dashboard
  - Visible modules:
    - Weekly rota management (`POST /api/rotas/bulk`, `PUT /api/rotas/:id`, `DELETE /api/rotas/:id`)
    - Dashboard views (`GET /api/rotas/dashboard`)
    - Staff joiners/leavers (`POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`)
    - Assigned-shop list and scoped staff views (requires backend support for assignment scoping)

- **Admin / Root**
  - Default route: Admin Dashboard
  - Visible modules:
    - All user management (`/api/users/*`)
    - Role management (`/api/roles/*`)
    - Shop management (`/api/shops/*`)
    - Full rota + inventory oversight

## 3) Screen Visibility Rules

Use backend permissions from `GET /api/users/me` only (do not hardcode by role name).

- `can_manage_rotas` -> Show rota create/edit/publish tools.
- `can_manage_inventory` -> Show inventory + query modules.
- `can_manual_punch` -> Show manual punch override UI.
- `can_create_users` -> Show user create/update/deactivate UI.
- `can_manage_shops` -> Show shop create/update/delete UI.
- `can_manage_roles` -> Show role management UI.
- `can_view_all_staff` -> Show org-level staff dashboards (not self-only views).

## 4) Employee Punch Flow (UI Steps)

1. Collect GPS.
2. `POST /api/attendance/verify-location` with `shop_id`, `latitude`, `longitude`.
3. Run biometric check on device.
4. `POST /api/attendance/punch-in` with `shop_id`, `location_token`, `biometric_verified: true` and header `x-device-id`.
5. Store attendance record ID and use it for punch-out via `PUT /api/attendance/{id}/punch-out`.

## 5) Current Backend Constraints (Important)

- Single login is fully supported.
- Manager/Sub-Manager can be assigned to one or more shops via `assigned_shop_ids`.
- Employee rota endpoints are scoped to own records for non-privileged users.
- Shop read endpoints are scoped for non-privileged users.
- Cross-shop punch-in is blocked (must be within `assigned_shop_ids` scope).
- Manager/Sub-Manager read views are filtered to assigned shops across users/rotas/inventory modules.
- User create/update/deactivate flows are constrained by assigned shops.
- Inventory/query write flows are constrained by assigned shops.







