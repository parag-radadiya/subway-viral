# Notifications API — Frontend Integration Guide

Complete reference for building the admin notification bell / inbox / toasts.

- **Base URL (local dev):** `http://localhost:3000`
- **Auth:** Bearer JWT in `Authorization` header
- **Permission:** Any authenticated user can hit these endpoints. Each user only sees notifications addressed to them — fan-out is decided by the backend based on role + shop scope.

---

## Table of Contents

1. [Concept — no cron needed](#1-concept--no-cron-needed)
2. [Role × Category visibility matrix](#2-role--category-visibility-matrix)
3. [Notification anatomy](#3-notification-anatomy)
4. [Event-type catalogue (14)](#4-event-type-catalogue-14)
5. [Endpoints](#5-endpoints)
6. [What the frontend needs to show](#6-what-the-frontend-needs-to-show)
7. [Postman collection JSON](#7-postman-collection-json)
8. [Quick-start checklist](#8-quick-start-checklist)

---

## 1. Concept — no cron needed

Most events (late punch-in, query opened, rota published, etc.) fire **synchronously** when the action happens in their own API endpoint — those create notifications on the spot, no scan required.

Two events are **absences** — they fire only when a scan detects something missing:

- `MISSED_PUNCH_IN` — staff has a rota but no `punch_in`
- `MISSED_PUNCH_OUT` — shift ended, no manual `punch_out`

Since the project has **no VPC / cron infrastructure**, the scan runs **opportunistically** instead. It is triggered automatically on:

| Trigger                               | When                                   |
| ------------------------------------- | -------------------------------------- |
| `POST /api/auth/login`                | Every login by an admin/manager        |
| `GET /api/notifications`              | Every list call                        |
| `GET /api/notifications/unread-count` | Every badge poll (every 30–60 s on FE) |
| `GET /api/notifications/summary`      | Dashboard widget load                  |

The scan is **internally throttled** to one actual DB pass every **10 minutes** (configurable via `NOTIFICATION_SCAN_INTERVAL_MS` env var). So even if the FE polls the badge every 30 seconds, the DB only runs the missed-punch scan 6 times an hour. Triggers fire-and-forget — they don't slow down the parent request.

**This means: the frontend just polls the bell badge as normal. Missed punches will appear automatically.**

If you still want a deterministic manual trigger (e.g. an admin "refresh" button), you can still call `POST /api/notifications/scan` — it bypasses the throttle.

---

## 2. Role × Category visibility matrix

Notifications are fanned out only to users whose role has the required permissions. With the system's default 5 roles, here's exactly who sees what:

| Category       | Required permission(s)                                                      | Root | Admin | Manager | Sub-Manager | Staff |
| -------------- | --------------------------------------------------------------------------- | :--: | :---: | :-----: | :---------: | :---: |
| **attendance** | `can_view_all_staff` OR `can_manage_rotas` OR `can_adjust_attendance_hours` |  ✅  |  ✅   |   ✅    |     ❌      |  ❌   |
| **inventory**  | `can_manage_inventory`                                                      |  ✅  |  ✅   |   ✅    |     ✅      |  ❌   |
| **rota**       | `can_manage_rotas`                                                          |  ✅  |  ✅   |   ✅    |     ❌      |  ❌   |
| **system**     | `can_manage_shops` OR `can_manage_roles` OR `can_create_users`              |  ✅  |  ✅   |   ❌    |     ❌      |  ❌   |

**Shop scope:** if a user has `assigned_shop_ids` set, they only see notifications for those shops. Users with no assignment receive notifications from every shop.

### What the FE should hide based on role

- **Staff** — hide the bell icon entirely (no notifications)
- **Sub-Manager** — only show the Inventory tab
- **Manager** — show Attendance, Inventory, Rota (hide System)
- **Admin / Root** — show all four tabs

The backend already returns an empty list for users who don't qualify, but hiding the UI is cleaner. Drive this off the role you get back from `POST /api/auth/login`:

```ts
const TABS_BY_ROLE = {
  Root: ['attendance', 'inventory', 'rota', 'system'],
  Admin: ['attendance', 'inventory', 'rota', 'system'],
  Manager: ['attendance', 'inventory', 'rota'],
  'Sub-Manager': ['inventory'],
  Staff: [],
};
```

---

## 3. Notification anatomy

```json
{
  "_id": "65fb...",
  "recipient_id": "65fa...",
  "category": "attendance",
  "event_type": "LATE_PUNCH_IN",
  "severity": "warning",
  "title": "John Smith punched in late",
  "message": "John Smith punched in 45 minutes after the scheduled shift start at Camden.",
  "actor_id": { "_id": "...", "name": "John Smith" },
  "target_user_id": { "_id": "...", "name": "John Smith" },
  "shop_id": { "_id": "...", "name": "Camden" },
  "attendance_id": "65...",
  "rota_id": "65...",
  "inventory_item_id": null,
  "inventory_query_id": null,
  "metadata": { "late_minutes": 45 },
  "dedupe_key": "LATE_PUNCH_IN::65...",
  "read_at": null,
  "archived_at": null,
  "createdAt": "2026-05-15T14:23:01.000Z",
  "updatedAt": "2026-05-15T14:23:01.000Z"
}
```

| Field                                        | Type                   | Notes                                                               |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `category`                                   | enum                   | `attendance` / `inventory` / `rota` / `system` — drives filter tabs |
| `event_type`                                 | enum                   | Specific event code — drives icon/color                             |
| `severity`                                   | enum                   | `info` (gray) / `warning` (amber) / `critical` (red)                |
| `title`                                      | string                 | Short headline for list/toast                                       |
| `message`                                    | string                 | Full sentence for dropdown body                                     |
| `actor_id`                                   | populated User \| null | Who did the action                                                  |
| `target_user_id`                             | populated User \| null | Who the action is about                                             |
| `shop_id`                                    | populated Shop \| null | Which shop                                                          |
| `attendance_id`, `rota_id`, `inventory_*_id` | ObjectId \| null       | Deep-link refs                                                      |
| `metadata`                                   | object                 | Free-form extras (e.g. `late_minutes`, `repair_cost`)               |
| `read_at`                                    | Date \| null           | `null` = unread                                                     |
| `archived_at`                                | Date \| null           | `null` = visible; non-null = hidden                                 |

---

## 4. Event-type catalogue (14)

### Attendance (6 events) — for Root / Admin / Manager

| Event type            | Trigger                                        | Severity                                 | What FE shows                                         |
| --------------------- | ---------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `LATE_PUNCH_IN`       | Staff punched in 30+ min after shift_start     | `info` (30–59 min) / `warning` (60+ min) | "John punched in 45 min late at Camden"               |
| `MISSED_PUNCH_IN`     | Scan detected: shift started, no punch yet     | `critical`                               | "John missed his punch-in (30 min after shift start)" |
| `AUTO_PUNCH_OUT`      | System auto-punched out 2 h after shift end    | `warning`                                | "John forgot to punch out — auto-punched at 23:00"    |
| `MISSED_PUNCH_OUT`    | Scan detected: shift ended, still no punch_out | `warning`                                | "Sarah did not punch out on time at Baker St"         |
| `MANUAL_PUNCH_IN`     | Sub-manager manually punched in someone        | `info`                                   | "Manager punched in Sarah at Camden"                  |
| `ATTENDANCE_ADJUSTED` | Admin ran bulk hours adjust                    | `info`                                   | "Admin adjusted hours for 5 staff at Camden"          |

### Inventory (4 events) — for Root / Admin / Manager / Sub-Manager

| Event type               | Trigger                        | Severity  | What FE shows                                      |
| ------------------------ | ------------------------------ | --------- | -------------------------------------------------- |
| `INVENTORY_QUERY_OPENED` | Damaged-item ticket opened     | `warning` | "Sarah reported issue: Coffee Machine at Baker St" |
| `INVENTORY_QUERY_CLOSED` | Damaged-item ticket resolved   | `info`    | "Coffee Machine fixed (repair £45)"                |
| `INVENTORY_ITEM_CREATED` | New inventory item added       | `info`    | "Sarah added 'Coffee Machine' to Baker St"         |
| `INVENTORY_ITEM_DAMAGED` | Item status changed to Damaged | `warning` | "Coffee Machine marked damaged"                    |

### Rota (1 event) — for Root / Admin / Manager

| Event type       | Trigger                    | Severity | What FE shows                                              |
| ---------------- | -------------------------- | -------- | ---------------------------------------------------------- |
| `ROTA_PUBLISHED` | Weekly rota bulk-published | `info`   | "Manager published 12 rota entries for week of 2026-05-12" |

### System (2 events) — for Root / Admin only

| Event type           | Trigger                      | Severity | What FE shows                                 |
| -------------------- | ---------------------------- | -------- | --------------------------------------------- |
| `SHOP_HOURS_CHANGED` | Shop operating hours updated | `info`   | "Admin changed Camden hours"                  |
| `USER_CREATED`       | New user onboarded           | `info`   | "Admin created account for sarah@example.com" |

### Suggested icon / color map

```ts
const EVENT_DISPLAY = {
  LATE_PUNCH_IN: { icon: '⏰', color: 'amber' },
  MISSED_PUNCH_IN: { icon: '🚨', color: 'red' },
  AUTO_PUNCH_OUT: { icon: '🔄', color: 'amber' },
  MISSED_PUNCH_OUT: { icon: '⏱', color: 'amber' },
  MANUAL_PUNCH_IN: { icon: '✋', color: 'blue' },
  ATTENDANCE_ADJUSTED: { icon: '📊', color: 'blue' },
  INVENTORY_QUERY_OPENED: { icon: '🔧', color: 'amber' },
  INVENTORY_QUERY_CLOSED: { icon: '✅', color: 'green' },
  INVENTORY_ITEM_CREATED: { icon: '📦', color: 'blue' },
  INVENTORY_ITEM_DAMAGED: { icon: '⚠️', color: 'amber' },
  ROTA_PUBLISHED: { icon: '🗓', color: 'blue' },
  SHOP_HOURS_CHANGED: { icon: '🏪', color: 'gray' },
  USER_CREATED: { icon: '👤', color: 'gray' },
};
```

---

## 5. Endpoints

### 5.1 List notifications

```
GET /api/notifications
```

| Query param | Type     | Description                                             |
| ----------- | -------- | ------------------------------------------------------- |
| `category`  | string   | `attendance` / `inventory` / `rota` / `system`          |
| `severity`  | string   | `info` / `warning` / `critical`                         |
| `read`      | boolean  | `true` (read only) / `false` (unread only) / omit (all) |
| `shop_id`   | ObjectId | Only items for one shop                                 |
| `page`      | number   | Default 1                                               |
| `limit`     | number   | Default 20, max 200                                     |

**Side effect:** auto-triggers a missed-punch scan if the caller can see attendance notifications (throttled to once per 10 min).

```bash
curl -X GET "http://localhost:3000/api/notifications?category=inventory&read=false&page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**

```json
{
  "status": 200,
  "message": "Notifications fetched successfully",
  "data": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "count": 3,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false,
    "notifications": [
      {
        "_id": "...",
        "category": "inventory",
        "event_type": "INVENTORY_QUERY_OPENED",
        "severity": "warning",
        "title": "Inventory issue reported: Coffee Machine",
        "message": "John Smith reported an issue with \"Coffee Machine\" at Camden.",
        "actor_id": { "_id": "...", "name": "John Smith" },
        "shop_id": { "_id": "...", "name": "Camden" },
        "inventory_item_id": "...",
        "inventory_query_id": "...",
        "metadata": { "issue_note": "Won't heat up" },
        "read_at": null,
        "createdAt": "2026-05-15T14:23:01.000Z"
      }
    ]
  }
}
```

---

### 5.2 Unread count (badge)

```
GET /api/notifications/unread-count
```

**Side effect:** auto-triggers a missed-punch scan (throttled).

```bash
curl -X GET "http://localhost:3000/api/notifications/unread-count" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```json
{
  "data": {
    "total": 8,
    "by_category": { "attendance": 5, "inventory": 2, "rota": 1, "system": 0 }
  }
}
```

> Poll every **30–60 seconds** for the bell badge. Each poll piggybacks the throttled scan, so missed punches surface within 10 minutes of happening.

---

### 5.3 Summary (dashboard widget)

```
GET /api/notifications/summary
```

Returns unread count + 3 most-recent items **for each category**.

```bash
curl -X GET "http://localhost:3000/api/notifications/summary" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```json
{
  "data": {
    "categories": {
      "attendance": {
        "unread_count": 5,
        "recent": [
          /* up to 3 */
        ]
      },
      "inventory": {
        "unread_count": 2,
        "recent": [
          /* ... */
        ]
      },
      "rota": {
        "unread_count": 1,
        "recent": [
          /* ... */
        ]
      },
      "system": { "unread_count": 0, "recent": [] }
    }
  }
}
```

---

### 5.4 List categories / event types / severities

```
GET /api/notifications/categories
```

Returns enum constants for dynamic filter dropdowns.

```json
{
  "data": {
    "categories": ["attendance", "inventory", "rota", "system"],
    "severities": ["info", "warning", "critical"],
    "event_types": ["LATE_PUNCH_IN", "MISSED_PUNCH_IN", "AUTO_PUNCH_OUT", "..."]
  }
}
```

---

### 5.5 Mark single read

```
PATCH /api/notifications/:id/read
```

```bash
curl -X PATCH "http://localhost:3000/api/notifications/65fb.../read" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 5.6 Mark all read (optionally per category)

```
POST /api/notifications/mark-all-read
```

**Body:** `{ "category": "attendance" }` (omit for ALL)

```bash
curl -X POST "http://localhost:3000/api/notifications/mark-all-read" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category": "attendance"}'
```

---

### 5.7 Archive notification

```
DELETE /api/notifications/:id
```

Soft-delete (sets `archived_at`). Won't appear in the list anymore.

```bash
curl -X DELETE "http://localhost:3000/api/notifications/65fb..." \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 5.8 Manual scan trigger (optional)

```
POST /api/notifications/scan?target=all&grace_minutes=30
```

Bypasses the throttle. Useful for an admin "Refresh now" button. Requires `can_view_all_staff`.

```bash
curl -X POST "http://localhost:3000/api/notifications/scan?target=all" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

| Query param     | Default | Description                                          |
| --------------- | ------- | ---------------------------------------------------- |
| `target`        | `all`   | `all` / `missed_punch_in` / `missed_punch_out`       |
| `grace_minutes` | `30`    | How long after shift_start before flagging as missed |

---

## 6. What the frontend needs to show

### 6.1 Bell icon with badge (top nav)

Show **only when role !== 'Staff'**.

```jsx
function NotificationBell({ userRole }) {
  if (userRole === 'Staff') return null;

  const { data } = useSWR('/api/notifications/unread-count', { refreshInterval: 30000 });
  const total = data?.data?.total || 0;

  return (
    <button onClick={openDrawer} className="relative">
      <BellIcon />
      {total > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1.5">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  );
}
```

### 6.2 Drawer / dropdown with role-filtered tabs

```jsx
const tabs = TABS_BY_ROLE[userRole] || [];
// Render <Tabs> with only those entries
```

Layout sketch:

```
┌─────────────────────────────────────────┐
│ Notifications              [Mark all]   │
├─────────────────────────────────────────┤
│ [All 8] [Attend 5] [Inv 2] [Rota 1]     │   ← tabs filtered by role
├─────────────────────────────────────────┤
│ 🚨 John Smith missed his punch-in       │   ← critical = red badge
│    30 min after shift • Camden          │
│    2 minutes ago                        │
├─────────────────────────────────────────┤
│ ⏰ Sarah punched in late                 │   ← warning = amber
│    45 min after shift • Baker St        │
│    1 hour ago                           │
├─────────────────────────────────────────┤
│ 🔧 Coffee Machine reported broken       │
│    by Mark • Baker St                   │
│    3 hours ago                          │
└─────────────────────────────────────────┘
```

### 6.3 Critical-severity toast

`MISSED_PUNCH_IN` is `critical`. Show a sticky toast so managers notice immediately:

```jsx
useEffect(() => {
  if (userRole === 'Staff') return;

  const interval = setInterval(async () => {
    const res = await fetch('/api/notifications?severity=critical&read=false&limit=5');
    const { data } = await res.json();
    data.notifications.forEach((n) => {
      if (!shown.has(n._id)) {
        toast.error(n.title, { description: n.message, duration: 30000 });
        shown.add(n._id);
      }
    });
  }, 30000);
  return () => clearInterval(interval);
}, [userRole]);
```

### 6.4 Deep-link on click

```ts
function handleClick(n) {
  fetch(`/api/notifications/${n._id}/read`, { method: 'PATCH', headers });

  if (n.attendance_id) router.push(`/attendance/${n.attendance_id}`);
  else if (n.inventory_query_id) router.push(`/inventory/queries/${n.inventory_query_id}`);
  else if (n.rota_id) router.push(`/rotas/${n.rota_id}`);
  else if (n.target_user_id) router.push(`/users/${n.target_user_id._id || n.target_user_id}`);
  else if (n.shop_id) router.push(`/shops/${n.shop_id._id || n.shop_id}`);
}
```

### 6.5 Relative time

```ts
import { formatDistanceToNow } from 'date-fns';
formatDistanceToNow(new Date(n.createdAt), { addSuffix: true });
// → "2 minutes ago"
```

### 6.6 Section-wise inbox page

For an inbox page (full-page view), show one section per category — but only sections the role can see:

```
┌─────── Attendance Notifications (5) ───────┐
│ ⏰ Sarah punched in late · 45 min late      │
│ 🚨 John missed punch-in                     │
└────────────────────────────────────────────┘

┌─────── Inventory Notifications (2) ────────┐
│ 🔧 Coffee Machine reported broken           │
│ ⚠️ Oven marked damaged                       │
└────────────────────────────────────────────┘
```

Drive each section's data from a separate call with `?category=...&limit=10`.

---

## 7. Postman collection JSON

Import `docs/notifications.postman_collection.json` into Postman, set the `{{jwt}}` variable once, and run any of the 18 ready-made requests grouped by Setup / Read / Mark / Scan.

---

## 8. Quick-start checklist

- [ ] Read the user's role from the login response → derive `tabs` and `showBell`
- [ ] If `role !== 'Staff'`, add bell icon to header
- [ ] Poll `GET /api/notifications/unread-count` every 30 s for the badge
- [ ] Build drawer with category tabs filtered by role using `TABS_BY_ROLE`
- [ ] Each tab calls `GET /api/notifications?category=...&read=false&limit=20`
- [ ] On notification click: `PATCH /:id/read` then deep-link
- [ ] Add "Mark all read" button → `POST /mark-all-read` (optional `{category}`)
- [ ] Optional: critical-severity toast loop (`?severity=critical&read=false`)
- [ ] Use `event_type` to pick icon + color from the suggested map
- [ ] Use `severity` to set border / badge color (info=gray, warning=amber, critical=red)

> **No cron setup required.** The scan that finds missed punch-ins runs automatically each time an admin loads the bell or logs in (throttled to once every 10 min). You don't need to call `/scan` unless you want a manual "refresh now" button.

---

## 9. Error responses

```json
{ "status": 400, "message": "category must be one of: attendance, inventory, rota, system", "data": {} }
{ "status": 401, "message": "Authentication required", "data": {} }
{ "status": 404, "message": "Notification not found", "data": {} }
```

| HTTP | Cause                                                 |
| ---- | ----------------------------------------------------- |
| 400  | Invalid category/severity in query                    |
| 401  | Missing/invalid JWT                                   |
| 403  | Lacks `can_view_all_staff` for `/scan` endpoint       |
| 404  | Notification ID not found, or belongs to another user |
