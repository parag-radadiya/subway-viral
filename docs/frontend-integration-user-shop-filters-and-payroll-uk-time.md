# Frontend Integration — User/Shop Filters, Shop Staff Membership & Payroll UK Time

This guide covers the API changes frontend developers need to pick up:

| #   | API                                         | Change                                      | Breaking?          |
| --- | ------------------------------------------- | ------------------------------------------- | ------------------ |
| 1   | `GET /api/users/by-shop/:shopId/staff`      | New `include_assigned` query param          | No (opt-in)        |
| 2   | `GET /api/users/by-shop/:shopId/staff`      | New `shop_membership` field on every user   | No (additive)      |
| 3   | `GET /api/users`                            | New `search` query param (name / email)     | No (opt-in)        |
| 4   | `GET /api/users`                            | New `role_id` query param                   | No (opt-in)        |
| 5   | `GET /api/shops`                            | New `search` query param (shop name)        | No (opt-in)        |
| 6   | `GET /api/attendance/weekly-payroll-report` | Punch `time_label` now in UK time (GMT/BST) | **Display change** |

Section 7 lists what Manager and Sub-Manager roles can access by default.

All requests still need the bearer token and use the usual response envelope:

```jsonc
// success
{ "status": 200, "message": "…", "data": { /* … */ } }
// error
{ "status": 400, "message": "…", "data": { /* … */ } }
```

---

## 1. Shop staff: include users who have the shop _assigned_

`GET /api/users/by-shop/:shopId/staff`

A user has one **active shop** (`shop_id` / `active_shop_id`) and a list of
**assigned shops** (`assigned_shop_ids`). Before this change, the endpoint only
returned users whose **active** shop is `:shopId`.

### New query param

| Param              | Type                           | Default | Meaning                                                                                                    |
| ------------------ | ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `include_assigned` | boolean (`true` / `1` / `yes`) | `false` | Also return users who have `:shopId` in their assigned shops, even if their active shop is a different one |

```
GET /api/users/by-shop/69f4c7823a7e3e41d36af730/staff?page=1&limit=100
GET /api/users/by-shop/69f4c7823a7e3e41d36af730/staff?page=1&limit=100&include_assigned=true
```

- If you don't send the param, the endpoint behaves exactly as before.
- Root and Admin users are still excluded, and pagination (`page`, `limit`,
  `sort_by`, `sort_order`) works as before.
- Managers and Sub-Managers can only query shops they're assigned to. Other
  shops return `403`.

---

## 2. Shop staff: `shop_membership` field

Every user returned by `GET /api/users/by-shop/:shopId/staff` now has a
`shop_membership` field, so you can tell active and assigned users apart
without comparing ids yourself.

| Value        | Meaning                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `"active"`   | `:shopId` is the user's current active shop                                                                                     |
| `"assigned"` | `:shopId` is only in the user's assigned shops; their active shop is a different one. Only appears when `include_assigned=true` |

```jsonc
{
  "total": 2,
  "page": 1,
  "limit": 100,
  "total_pages": 1,
  "count": 2,
  "users": [
    {
      "_id": "…",
      "name": "Bob Manager",
      "email": "manager@org.com",
      "shop_id": { "_id": "69f4c7823a7e3e41d36af730", "name": "swiss cottage" },
      "role_id": {
        "_id": "…",
        "role_name": "Manager",
        "permissions": {
          /* … */
        },
      },
      "shop_membership": "active",
    },
    {
      "_id": "…",
      "name": "Carol Sub-Manager",
      "email": "submanager@org.com",
      "shop_id": { "_id": "<another shop id>", "name": "Main Branch" },
      "role_id": {
        "_id": "…",
        "role_name": "Sub-Manager",
        "permissions": {
          /* … */
        },
      },
      "shop_membership": "assigned",
    },
  ],
}
```

```js
const activeStaff = users.filter((u) => u.shop_membership === 'active');
const assignedOnly = users.filter((u) => u.shop_membership === 'assigned');
// e.g. show an "Assigned" badge for assignedOnly users
```

The field is always present. Without `include_assigned`, every user is `"active"`.

> Known quirk: in this endpoint `total` counts Root/Admin users, but they are
> removed from `users`. So `total` can be slightly higher than the number of
> rows you actually receive. Use `count` for the rows on the current page.

---

## 3. Users list: search by name or email

`GET /api/users`

### New query param

| Param    | Type   | Meaning                                                          |
| -------- | ------ | ---------------------------------------------------------------- |
| `search` | string | Case-insensitive **partial** match on user `name` **or** `email` |

```
GET /api/users?page=1&limit=10&search=dave
GET /api/users?page=1&limit=10&search=@gmail.com
```

- The response shape is **exactly the same** as without `search`.
- `total`, `total_pages` and `count` reflect the filtered results, so
  pagination works while searching.
- Search text is matched literally: characters like `.`, `*`, `+` or `(` have
  no special meaning. Input over 100 characters is cut off.
- An empty or whitespace-only `search` is ignored.
- Can be combined with `shop_id`, `role_id`, `page`, `limit`, `sort_by`,
  `sort_order`.
- Results still only include users the logged-in person is allowed to see
  (their assigned shops for Manager/Sub-Manager).

Tip: debounce the search input (around 300 ms) and reset to `page=1` whenever
the search text changes.

---

## 4. Users list: filter by role

`GET /api/users`

### New query param

| Param     | Type   | Meaning                                                              |
| --------- | ------ | -------------------------------------------------------------------- |
| `role_id` | string | One role id, **or** a comma-separated list of role ids (matches any) |

```
GET /api/users?page=1&limit=10&role_id=<staffRoleId>
GET /api/users?page=1&limit=10&role_id=<staffRoleId>,<managerRoleId>
GET /api/users?page=1&limit=10&role_id=<managerRoleId>&search=bob&shop_id=<shopId>
```

- The filter uses role **ids**, not role names. Build the role dropdown from
  the roles you already have, e.g. `role_id` on users you've loaded, or
  `GET /api/roles` for users with `can_manage_roles`.
- An invalid id returns **`400`** with message `Invalid role_id`.
- The response shape doesn't change, and pagination totals reflect the filter.

---

## 5. Shops list: search by shop name

`GET /api/shops`

### New query param

| Param    | Type   | Meaning                                           |
| -------- | ------ | ------------------------------------------------- |
| `search` | string | Case-insensitive **partial** match on shop `name` |

```
GET /api/shops?page=1&limit=10&search=swiss
```

- The response shape doesn't change, and pagination totals reflect the filter.
- Same literal-matching and 100-character rules as the users `search`.
- Results stay limited to the shops the user can access. For example, a
  Manager searching for a shop they aren't assigned to gets an empty list.

---

## 6. Weekly payroll report: punch times in UK time

`GET /api/attendance/weekly-payroll-report` (JSON and `?format=pdf`)

The punch `time_label` values in the report are now converted **on the
backend** to UK local time (`Europe/London`):

- **GMT (UTC+0)** in winter
- **BST (UTC+1)** in summer (last Sunday of March to last Sunday of October)

The same field is used (`employees[].days[].punches[].time_label`); no new
field was added. The PDF prints the same labels.

| Shift (stored in UTC)                                      | Before         | After                     |
| ---------------------------------------------------------- | -------------- | ------------------------- |
| `2026-08-01T18:04Z` → `2026-08-02T06:00Z` (auto punch-out) | `18:04-06:00^` | `19:04-07:00^`            |
| `2026-03-27T09:00Z` → `17:00Z` (GMT period)                | `09:00-17:00`  | `09:00-17:00` (unchanged) |

### What the frontend needs to do

- **Do not add +1 hour to `time_label` yourself anymore.** It's already UK
  time. If the payroll screen currently converts these labels, remove that
  conversion or times will show 2 hours ahead in summer.
- Nothing else changes:
  - the `^` (system/auto punch) and `*` (manual/edited punch) markers
  - `hours`, `break_hours`, every total, `adj_amount`, `hrs_wrkd`
  - the day columns: a punch still appears under the same `date` as the
    dashboard's `shift_date`
- `printed_at` is **still UTC**, so it's 1 hour behind UK time in summer.
- Other attendance APIs (e.g. `GET /api/attendance/staff-shifts`) still return
  raw ISO UTC timestamps (`punch_in`, `punch_out`, …). Keep converting those to
  UK time in the frontend, as the dashboard does today.

> Heads-up: **manual and bulk-adjusted punches**, and rota times, save the time
> the manager typed as if it were UTC. For example, `07:00` is saved as
> `07:00Z`. In summer these now show an hour later in the payroll report
> (`08:00-18:00*` for a shift entered as 07:00–17:00). This matches what the
> dashboard already shows for them. A backend fix for how those times are saved
> is being tracked separately.

---

## 7. Role access reference: Manager vs Sub-Manager

These are the default permissions. Permissions are stored on each role, so an
admin can change them. Always use `user.role_id.permissions` from
`POST /api/auth/login` or `GET /api/auth/me` to show or hide buttons, and handle
`403` responses gracefully.

| Permission                    | Manager | Sub-Manager |
| ----------------------------- | :-----: | :---------: |
| `can_view_all_staff`          |   ✅    |     ❌      |
| `can_manage_rotas`            |   ✅    |     ❌      |
| `can_manual_punch`            |   ✅    |     ✅      |
| `can_manage_inventory`        |   ✅    |     ✅      |
| `can_correct_attendance`      |   ✅    |     ✅      |
| `can_delete_staff`            |   ✅    |     ✅      |
| `can_create_users`            |   ❌    |     ❌      |
| `can_adjust_attendance_hours` |   ❌    |     ❌      |
| `can_manage_shops`            |   ❌    |     ❌      |
| `can_manage_roles`            |   ❌    |     ❌      |

Both roles only see data for their **assigned shops**. Only roles with
`can_manage_shops` or `can_manage_roles` (Admin, Root) see all shops.

| Feature                                                        | Manager | Sub-Manager |
| -------------------------------------------------------------- | :-----: | :---------: |
| View users, shop staff, attendance and rotas in assigned shops |   ✅    |     ✅      |
| Manual punch-in; start/end a break for other staff             |   ✅    |     ✅      |
| Correct punch in/out (`PUT /api/attendance/:id/correct`)       |   ✅    |     ✅      |
| Deactivate staff (`DELETE /api/users/:id`)¹                    |   ✅    |     ✅      |
| Inventory (items, queries, audit logs)                         |   ✅    |     ✅      |
| Weekly payroll report                                          |   ✅    |     ❌      |
| Reconcile overdue punches for others                           |   ✅    |     ❌      |
| Trigger notification scan (`POST /api/notifications/scan`)     |   ✅    |     ❌      |
| Create, edit or delete rotas (incl. bulk)                      |   ✅    |     ❌      |
| Create or edit users                                           |   ❌    |     ❌      |
| Adjust attendance hours (`/api/attendance/adjust-hours/*`)     |   ❌    |     ❌      |
| Create or edit shops, shop hours                               |   ❌    |     ❌      |
| Rota dashboard, store reports and analytics (Root/Admin only)  |   ❌    |     ❌      |
| Roles management, observability                                |   ❌    |     ❌      |

¹ Only users in their assigned shops. They cannot deactivate Admin, Manager or
Root accounts, or themselves.
