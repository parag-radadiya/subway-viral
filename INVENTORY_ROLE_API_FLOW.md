# Inventory Module Role API Flow

This document explains, for each login role, which inventory APIs should be used in frontend and how the inventory flow works end-to-end.

## 1) Single Login for All Roles

All users login from one endpoint:

- `POST /api/auth/login`

Frontend should read role permissions from:

- `data.user.role.permissions`

Main permission for this module:

- `can_manage_inventory`

If `can_manage_inventory` is `false`, hide inventory screens.

## 2) Inventory APIs to Implement in Frontend

### Inventory Items

- `GET /api/inventory/items`
  - Filters: `shop_id`, `status`
  - Pagination: `page`, `limit`
  - Sorting: `sort_by`, `sort_order`
- `GET /api/inventory/items/:id`
- `POST /api/inventory/items`
- `PUT /api/inventory/items/:id`
- `DELETE /api/inventory/items/:id`

### Inventory Queries (Tickets)

- `GET /api/inventory/queries`
  - Filters: `shop_id`, `status`, `item_id`
  - Pagination: `page`, `limit`
  - Sorting: `sort_by`, `sort_order`
- `GET /api/inventory/queries/:id`
- `POST /api/inventory/queries` (open issue)
- `PUT /api/inventory/queries/:id/close` (close issue)

### Inventory Audit Logs

- `GET /api/inventory/audit-logs`
  - Filters: `shop_id`, `item_id`, `query_id`, `action`
  - Pagination: `page`, `limit`
  - Sorting: `sort_by`, `sort_order`

## 3) Role-Wise Access (Current Flow)

## Root

- Has `can_manage_inventory` and full global scope.
- Can use all inventory item, query, and audit-log APIs across all shops.

## Admin

- Has `can_manage_inventory` and global scope.
- Can use all inventory item, query, and audit-log APIs across all shops.

## Manager

- Has `can_manage_inventory` but shop-scoped access.
- Can create/update/delete items only in assigned shops.
- Can open/close queries only in assigned shops.
- Can view audit logs only for assigned shops.

## Sub-Manager

- Has `can_manage_inventory` but shop-scoped access.
- Same inventory permissions pattern as manager, limited to assigned shops.

## Staff (Employee)

- `can_manage_inventory = false`
- Should not see inventory module screens.
- Inventory APIs return `403` if called.

## 4) Core Inventory Flow (How It Works)

### A) Inventory Item Management Flow

1. Load list screen:
   - `GET /api/inventory/items?page=1&limit=20&sort_by=createdAt&sort_order=desc`
2. Create item:
   - `POST /api/inventory/items`
3. Edit item:
   - `PUT /api/inventory/items/:id`
4. Delete item:
   - `DELETE /api/inventory/items/:id`
   - If item has linked queries, delete is blocked with `409`.

### B) Query Ticket Flow

1. Open issue for an item:
   - `POST /api/inventory/queries`
   - Item status auto-updates to `Damaged`.
2. View query list/details:
   - `GET /api/inventory/queries`
   - `GET /api/inventory/queries/:id`
3. Close issue:
   - `PUT /api/inventory/queries/:id/close`
   - If no other open query exists for item, item goes to `Good`.
   - If another open query exists, item remains `Damaged`.

### C) Audit/Traceability Flow

Inventory actions write DB audit logs:

- `ITEM_CREATED`
- `ITEM_UPDATED`
- `ITEM_DELETED`
- `QUERY_OPENED`
- `QUERY_CLOSED`

Admin/manager screens can fetch timeline via:

- `GET /api/inventory/audit-logs`

## 5) Important Backend Rules Frontend Must Handle

- Duplicate open query for same item is blocked: `409`.
- Concurrent close on same query: one succeeds (`200`), second gets conflict (`409`).
- Out-of-scope shop filters often return empty list with `200` (not always `403`).
- Item delete with linked queries is blocked: `409`.

## 6) Recommended Frontend Screen Mapping

- Inventory List: `GET /api/inventory/items`
- Item Create/Edit Form: `POST/PUT /api/inventory/items...`
- Query List: `GET /api/inventory/queries`
- Query Details + Close: `GET /api/inventory/queries/:id`, `PUT /close`
- Audit Timeline: `GET /api/inventory/audit-logs`

## 7) Minimal UI Permission Logic

After login, gate module by:

- `permissions.can_manage_inventory`

Then for role-scoped users (manager/sub-manager), show normal screens but expect data limited by assigned shop scope from backend.

