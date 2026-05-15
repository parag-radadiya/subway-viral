# Notifications API — Frontend Integration Guide

Complete reference for building the admin notification bell / inbox / toasts.

- **Base URL (local dev):** `http://localhost:3000`
- **Auth:** Bearer JWT in `Authorization` header
- **Permission:** Any authenticated user. Notifications are scoped per-recipient — each user only sees their own.

---

## Table of Contents

1. [Concept](#1-concept)
2. [Notification anatomy](#2-notification-anatomy)
3. [Categories, severities & event types](#3-categories-severities--event-types)
4. [Endpoints](#4-endpoints)
5. [Auto-fired events (no API needed)](#5-auto-fired-events-no-api-needed)
6. [Background scan endpoint (cron)](#6-background-scan-endpoint-cron)
7. [Recommended UI patterns](#7-recommended-ui-patterns)
8. [Postman collection JSON](#8-postman-collection-json)

---

## 1. Concept

Backend automatically creates notifications whenever a noteworthy event happens (someone is late, an item gets damaged, rota gets published, etc.). Each event is **fanned out** to all admins/managers with the right permission and shop scope.

The frontend's job is just:

- Show a **bell icon with badge count** (poll `/unread-count` every 30–60 s)
- Show a **dropdown / drawer** with a list (`/`)
- Optionally show **toasts** for new critical-severity items
- Provide **filter chips** for category (Attendance / Inventory / Rota / System)

You don't need to create notifications yourself — just read and mark them read.

---

## 2. Notification anatomy

```json
{
  "_id": "65fb...",
  "recipient_id": "65fa...", // current user
  "category": "attendance", // attendance | inventory | rota | system
  "event_type": "LATE_PUNCH_IN",
  "severity": "warning", // info | warning | critical
  "title": "John Smith punched in late",
  "message": "John Smith punched in 45 minutes after the scheduled shift start at Camden.",
  "actor_id": { "_id": "...", "name": "John Smith" }, // who did the action
  "target_user_id": { "_id": "...", "name": "John Smith" }, // who the action is about
  "shop_id": { "_id": "...", "name": "Camden" },
  "attendance_id": "65...",
  "rota_id": "65...",
  "inventory_item_id": null,
  "inventory_query_id": null,
  "metadata": { "late_minutes": 45 },
  "dedupe_key": "LATE_PUNCH_IN::65...",
  "read_at": null, // null = unread
  "archived_at": null,
  "createdAt": "2026-05-15T14:23:01.000Z",
  "updatedAt": "2026-05-15T14:23:01.000Z"
}
```

### Field-by-field reference

| Field             | Type                   | Notes                                                           |
| ----------------- | ---------------------- | --------------------------------------------------------------- |
| `category`        | enum                   | Use this for the **badge tabs** in your UI                      |
| `event_type`      | enum                   | Specific code — drives icon/color choice                        |
| `severity`        | enum                   | `info` (gray) / `warning` (amber) / `critical` (red)            |
| `title`           | string                 | Short headline for list/toast                                   |
| `message`         | string                 | Full sentence for dropdown body                                 |
| `actor_id`        | populated User \| null | Person who performed the action                                 |
| `target_user_id`  | populated User \| null | Person the action is about (e.g. the late staffer)              |
| `shop_id`         | populated Shop \| null | Which shop — for filtering                                      |
| `*_id` other refs | ObjectId \| null       | For deep-linking (click to go to that attendance / rota / item) |
| `metadata`        | object                 | Free-form extras (e.g. `late_minutes`, `repair_cost`)           |
| `read_at`         | Date \| null           | When marked read                                                |
| `archived_at`     | Date \| null           | When archived (won't show in list)                              |

---

## 3. Categories, severities & event types

### Categories (4)

| Category     | Description                                                     | Who receives it                                                           |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `attendance` | Late punches, missed punches, auto-punch-outs, bulk adjustments | `can_view_all_staff` / `can_manage_rotas` / `can_adjust_attendance_hours` |
| `inventory`  | New items, item damaged, query opened/closed                    | `can_manage_inventory`                                                    |
| `rota`       | Bulk rota published                                             | `can_manage_rotas`                                                        |
| `system`     | Shop hours changed, new user created                            | `can_manage_shops` / `can_manage_roles` / `can_create_users`              |

### Severities (3)

| Severity   | When                                                         | Suggested UI                |
| ---------- | ------------------------------------------------------------ | --------------------------- |
| `info`     | Routine info (item created, rota published)                  | Gray badge, no toast        |
| `warning`  | Late punch, item damaged, auto-punched-out, missed punch-out | Amber badge, soft toast     |
| `critical` | Missed punch-in (staff scheduled but no show)                | Red badge, persistent toast |

### Event types (14)

```ts
// Attendance
'LATE_PUNCH_IN'; // 30+ min after shift_start
'MISSED_PUNCH_IN'; // shift started, no punch_in yet
'AUTO_PUNCH_OUT'; // system punched them out 2h after shift end
'MISSED_PUNCH_OUT'; // shift ended, no manual punch_out
'MANUAL_PUNCH_IN'; // sub-manager punched someone in
'ATTENDANCE_ADJUSTED'; // admin ran bulk-adjust

// Inventory
'INVENTORY_QUERY_OPENED'; // damaged item reported
'INVENTORY_QUERY_CLOSED'; // damaged item fixed
'INVENTORY_ITEM_CREATED';
'INVENTORY_ITEM_DAMAGED'; // item status → Damaged

// Rota
'ROTA_PUBLISHED'; // weekly bulk publish

// System
'SHOP_HOURS_CHANGED';
'USER_CREATED';
```

Suggested icon/color mapping for each event type:

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

## 4. Endpoints

### 4.1 List notifications

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

**cURL — get unread inventory notifications:**

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

### 4.2 Unread count (badge)

```
GET /api/notifications/unread-count
```

**cURL:**

```bash
curl -X GET "http://localhost:3000/api/notifications/unread-count" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**

```json
{
  "status": 200,
  "message": "Unread notification counts fetched",
  "data": {
    "total": 8,
    "by_category": {
      "attendance": 5,
      "inventory": 2,
      "rota": 1,
      "system": 0
    }
  }
}
```

> Poll this every **30–60 seconds** for the bell badge. Or wire it into your existing app-level interval.

---

### 4.3 Summary (dashboard quick-view)

```
GET /api/notifications/summary
```

Returns unread count + 3 most-recent items **for each category**. Useful for a dashboard widget with a section per category.

**cURL:**

```bash
curl -X GET "http://localhost:3000/api/notifications/summary" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**

```json
{
  "data": {
    "categories": {
      "attendance": {
        "unread_count": 5,
        "recent": [
          /* up to 3 notifications */
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

### 4.4 List categories / event types / severities

```
GET /api/notifications/categories
```

Returns the enum constants. Use to build filter dropdowns dynamically.

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

### 4.5 Mark single read

```
PATCH /api/notifications/:id/read
```

**cURL:**

```bash
curl -X PATCH "http://localhost:3000/api/notifications/65fb.../read" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**

```json
{ "data": { "notification": { "_id": "...", "read_at": "2026-05-15T14:30:00.000Z", "..." } } }
```

---

### 4.6 Mark all read (optionally per category)

```
POST /api/notifications/mark-all-read
```

**Body:** `{ "category": "attendance" }` (or omit for ALL categories)

**cURL — mark all attendance notifications read:**

```bash
curl -X POST "http://localhost:3000/api/notifications/mark-all-read" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category": "attendance"}'
```

**Response (200):**

```json
{ "data": { "modified": 5, "filter": { "category": "attendance" } } }
```

---

### 4.7 Archive notification

```
DELETE /api/notifications/:id
```

Soft-delete (sets `archived_at`). Won't appear in the list anymore.

```bash
curl -X DELETE "http://localhost:3000/api/notifications/65fb..." \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 5. Auto-fired events (no API needed)

These notifications are created **automatically** by the backend when the underlying action happens — frontend just consumes them:

| Action                                        | Endpoint that triggers it                                                           | Notification                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| Staff punches in late (30+ min)               | `POST /api/attendance/punch-in`                                                     | `LATE_PUNCH_IN` (info or warning)  |
| Manager manually punches someone in           | `POST /api/attendance/manual-punch-in`                                              | `MANUAL_PUNCH_IN` (info)           |
| System auto-punches out (2 h after shift end) | Triggered automatically on every punch-in/-out request via `runAutoPunchOutSweep()` | `AUTO_PUNCH_OUT` (warning)         |
| Admin runs bulk hours adjust                  | `POST /api/attendance/bulk-adjust`                                                  | `ATTENDANCE_ADJUSTED` (info)       |
| Inventory item created                        | `POST /api/inventory/items`                                                         | `INVENTORY_ITEM_CREATED` (info)    |
| Item updated → status = Damaged               | `PUT /api/inventory/items/:id`                                                      | `INVENTORY_ITEM_DAMAGED` (warning) |
| Damaged-item ticket opened                    | `POST /api/inventory/queries`                                                       | `INVENTORY_QUERY_OPENED` (warning) |
| Damaged-item ticket closed                    | `PUT /api/inventory/queries/:id/close`                                              | `INVENTORY_QUERY_CLOSED` (info)    |
| Weekly rota published                         | `POST /api/rotas/bulk`                                                              | `ROTA_PUBLISHED` (info)            |
| Shop hours updated                            | `PUT /api/shops/:id/hours`                                                          | `SHOP_HOURS_CHANGED` (info)        |
| New user onboarded                            | `POST /api/users`                                                                   | `USER_CREATED` (info)              |

---

## 6. Background scan endpoint (cron)

For **missed punch-in** (staff has rota but didn't punch in) and **missed punch-out** (rota ended, no punch_out), we don't have a real event trigger — they're absences. Run this scan on a schedule:

```
POST /api/notifications/scan?target=all
```

| Query param     | Default | Description                                          |
| --------------- | ------- | ---------------------------------------------------- |
| `target`        | `all`   | `all` / `missed_punch_in` / `missed_punch_out`       |
| `grace_minutes` | `30`    | How long after shift_start before flagging as missed |

**cURL:**

```bash
curl -X POST "http://localhost:3000/api/notifications/scan?target=all&grace_minutes=30" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "data": {
    "missed_punch_in": { "scanned": 12, "missed_count": 2, "emitted": 8 },
    "missed_punch_out": { "scanned": 3, "emitted": 5 }
  }
}
```

### Production recommendation

Set up a cron job (or Vercel cron) to hit this endpoint **every 15 minutes** during operating hours. Notifications are deduped via `dedupe_key` so re-running the scan won't create duplicates.

---

## 7. Recommended UI patterns

### 7.1 Bell icon with category-specific badges

```jsx
function NotificationBell() {
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

### 7.2 Drawer with category tabs

```
┌────────────────────────────────────────┐
│ Notifications              [Mark all]  │
├────────────────────────────────────────┤
│ [All 8] [Attend 5] [Inv 2] [Rota 1]    │
├────────────────────────────────────────┤
│ ⏰ John Smith punched in late          │
│    45 min after shift • Camden         │
│    2 minutes ago                       │
├────────────────────────────────────────┤
│ 🔧 Coffee Machine reported broken      │
│    by Sarah • Baker St                 │
│    1 hour ago                          │
└────────────────────────────────────────┘
```

```jsx
const [activeTab, setActiveTab] = useState('all');
const { data } = useSWR(
  `/api/notifications?${activeTab !== 'all' ? `category=${activeTab}&` : ''}page=1&limit=20`
);
```

### 7.3 Toast for critical-only

```jsx
useEffect(() => {
  const interval = setInterval(async () => {
    const res = await fetch('/api/notifications?severity=critical&read=false&limit=5');
    const { data } = await res.json();
    data.notifications.forEach((n) => {
      if (!shown.has(n._id)) {
        toast.error(n.title, { description: n.message });
        shown.add(n._id);
      }
    });
  }, 30000);
  return () => clearInterval(interval);
}, []);
```

### 7.4 Deep-link on click

Each notification has the relevant `*_id` fields. On click:

```ts
function handleClick(n) {
  // Mark read
  fetch(`/api/notifications/${n._id}/read`, { method: 'PATCH', headers });

  // Deep-link based on category
  if (n.attendance_id) router.push(`/attendance/${n.attendance_id}`);
  else if (n.inventory_query_id) router.push(`/inventory/queries/${n.inventory_query_id}`);
  else if (n.rota_id) router.push(`/rotas/${n.rota_id}`);
  else if (n.shop_id) router.push(`/shops/${n.shop_id._id || n.shop_id}`);
}
```

### 7.5 Format relative time

```ts
import { formatDistanceToNow } from 'date-fns';
formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true });
// → "2 minutes ago"
```

---

## 8. Postman collection JSON

Save as `notifications.postman_collection.json` and import.

```json
{
  "info": {
    "name": "Subway — Notifications",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "base_url", "value": "http://localhost:3000" },
    { "key": "jwt", "value": "PASTE_YOUR_TOKEN_HERE" }
  ],
  "auth": {
    "type": "bearer",
    "bearer": [{ "key": "token", "value": "{{jwt}}", "type": "string" }]
  },
  "item": [
    {
      "name": "List — all unread",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/notifications?read=false&page=1&limit=20",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications"],
          "query": [
            { "key": "read", "value": "false" },
            { "key": "page", "value": "1" },
            { "key": "limit", "value": "20" }
          ]
        }
      }
    },
    {
      "name": "List — attendance only",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/notifications?category=attendance&page=1&limit=20",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications"],
          "query": [
            { "key": "category", "value": "attendance" },
            { "key": "page", "value": "1" },
            { "key": "limit", "value": "20" }
          ]
        }
      }
    },
    {
      "name": "Unread count (bell badge)",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/notifications/unread-count",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications", "unread-count"]
        }
      }
    },
    {
      "name": "Summary (dashboard widget)",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/notifications/summary",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications", "summary"]
        }
      }
    },
    {
      "name": "Categories enum",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{base_url}}/api/notifications/categories",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications", "categories"]
        }
      }
    },
    {
      "name": "Mark one read",
      "request": {
        "method": "PATCH",
        "url": {
          "raw": "{{base_url}}/api/notifications/PASTE_NOTIFICATION_ID/read",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications", "PASTE_NOTIFICATION_ID", "read"]
        }
      }
    },
    {
      "name": "Mark all read — attendance",
      "request": {
        "method": "POST",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": { "mode": "raw", "raw": "{\n  \"category\": \"attendance\"\n}" },
        "url": {
          "raw": "{{base_url}}/api/notifications/mark-all-read",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications", "mark-all-read"]
        }
      }
    },
    {
      "name": "Archive (soft delete)",
      "request": {
        "method": "DELETE",
        "url": {
          "raw": "{{base_url}}/api/notifications/PASTE_NOTIFICATION_ID",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications", "PASTE_NOTIFICATION_ID"]
        }
      }
    },
    {
      "name": "Scan missed punches (cron)",
      "request": {
        "method": "POST",
        "url": {
          "raw": "{{base_url}}/api/notifications/scan?target=all&grace_minutes=30",
          "host": ["{{base_url}}"],
          "path": ["api", "notifications", "scan"],
          "query": [
            { "key": "target", "value": "all" },
            { "key": "grace_minutes", "value": "30" }
          ]
        }
      }
    }
  ]
}
```

---

## 9. Quick-start integration checklist

- [ ] Add bell icon to header, poll `/unread-count` every 30 s
- [ ] Build drawer/dropdown that fetches `/api/notifications?read=false`
- [ ] Add category tabs (Attendance / Inventory / Rota / System)
- [ ] Show icon based on `event_type` per the mapping table
- [ ] Apply severity color to border or badge
- [ ] On click → mark read + deep-link
- [ ] Add "Mark all read" button → `POST /mark-all-read`
- [ ] Optional: set up cron to call `/scan?target=all` every 15 min
- [ ] Optional: critical-severity toast polling

---

## 10. Error responses

```json
{ "status": 400, "message": "category must be one of: attendance, inventory, rota, system", "data": {} }
{ "status": 401, "message": "Authentication required", "data": {} }
{ "status": 404, "message": "Notification not found", "data": {} }
```

| HTTP | Cause                                                 |
| ---- | ----------------------------------------------------- |
| 400  | Invalid category/severity in query                    |
| 401  | Missing/invalid JWT                                   |
| 403  | Lacks permission for `/scan` endpoint                 |
| 404  | Notification ID not found, or belongs to another user |
