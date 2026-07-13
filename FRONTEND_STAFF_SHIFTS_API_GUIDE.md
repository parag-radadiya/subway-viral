# Staff Shifts API — Frontend Integration Guide

Endpoint shipped in PR [#14](https://github.com/parag-radadiya/subway-viral/pull/14) for the mobile app's "view attendance day-wise per staff" screen. One call returns every staff member of a shop together with all their attendance shifts in a date range, plus aggregate work hours.

- **Endpoint:** `GET /api/attendance/staff-shifts`
- **Auth:** `Authorization: Bearer <jwt>` (same as the rest of the attendance APIs)
- **Pagination:** by staff member (each page contains the full list of shifts for the staff on that page)

---

## When to use it

Pick this endpoint when the UI flow is:

1. User picks a **shop** + **date range** (typically one month).
2. App shows a **list of staff** with their totals for that range.
3. Tapping a staff row expands to show each individual **shift** (date + work hours) in that range.

If you only need a single staff's shifts, pass `user_id`. If you need range-level totals on top of the page (e.g. the "this month: 187h" headline), use `total_work_hours` / `total_actual_hours` on the top-level response — those are computed across the entire range, not just the current page.

> **Update:** `shop_id` is now **optional**. Omit it to get a cross-shop view scoped to whatever shops the caller can already see — see [Access control / scope](#access-control--scope) below. Useful for an admin/manager "all my shops this week" screen without a shop picker.

---

## Query parameters

| Name          | Required | Type                         | Default            | Notes                                                                                                                                                                                                           |
| ------------- | -------- | ---------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shop_id`     | no       | string (ObjectId)            | —                  | Mongo `_id` of the shop. Omit to span every shop in the caller's access (see scope table below). Each shift in the response still carries its own populated `shop_id`, so multi-shop results stay attributable. |
| `from_date`   | yes      | ISO date                     | —                  | Inclusive. `YYYY-MM-DD` or full ISO. Server normalizes to start-of-day UTC.                                                                                                                                     |
| `to_date`     | yes      | ISO date                     | —                  | Inclusive. `YYYY-MM-DD` or full ISO. Server normalizes to end-of-day UTC. Must be ≥ `from_date`.                                                                                                                |
| `user_id`     | no       | string (ObjectId)            | —                  | Limit the result to one staff member. Self-scope users automatically restricted to themselves.                                                                                                                  |
| `page`        | no       | integer ≥ 1                  | `1`                | Paginates **staff**, not shifts.                                                                                                                                                                                |
| `limit`       | no       | integer 1–100                | `20`               | Staff per page.                                                                                                                                                                                                 |
| `sort_by`     | no       | `total_work_hours` \| `name` | `total_work_hours` | Sort key for the staff list.                                                                                                                                                                                    |
| `sort_dir`    | no       | `asc` \| `desc`              | `desc`             | Sort direction.                                                                                                                                                                                                 |
| `shift_order` | no       | `asc` \| `desc`              | `asc`              | Order of `shifts[]` **inside each staff** (chronological vs reverse-chronological by `punch_in`).                                                                                                               |

### What "omit shop_id" means per role

| Role / scope              | Behavior when `shop_id` is omitted                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **root / admin**          | Sees every shop, same as before.                                                                                         |
| **shop-scoped** (manager) | Restricted to every shop they're assigned to (not just one) — their totals and staff list are merged across those shops. |
| **self-scoped** (staff)   | Sees only their own shifts, across whatever shop(s) they happen to have punches in.                                      |

### Validation behavior

- Missing or invalid `from_date` / `to_date` → `400 from_date and to_date are required and must be valid ISO dates`
- `to_date < from_date` → `400 to_date must be greater than or equal to from_date`
- `shop_id` no longer has a "required" validation error — omitting it is valid input.

---

## Access control / scope

The endpoint honors the same role rules as every other attendance API:

| Role / scope              | Behavior                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **root**                  | Sees every shop. Time math uses raw `punch_in` → `punch_out` minutes (no effective/adjusted overrides).                                       |
| **admin**                 | Sees every shop. Time math uses `effective_minutes → adjusted_minutes → actual` fallback.                                                     |
| **shop-scoped** (manager) | Sees only their assigned shop(s). Asking for a shop they don't own returns an **empty page** (200, with `staff: []`, `total: 0`) — not a 403. |
| **self-scoped** (staff)   | Sees only their own data even if asking for a shop. Passing a different `user_id` returns an empty page.                                      |

> Frontend tip: an empty page is the only signal you'll get for "you don't have access to this shop." Treat `total === 0 && staff.length === 0` as either "no data" or "no access" — show the same empty-state UI either way.

---

## Response shape

```jsonc
{
  "success": true,
  "message": "Shop staff shifts fetched successfully",
  "data": {
    // Pagination + echo of query
    "total": 12, // total staff with attendance in this range
    "page": 1,
    "limit": 20,
    "total_pages": 1,
    "count": 12, // staff returned on this page

    "from_date": "2026-06-01T00:00:00.000Z",
    "to_date": "2026-06-30T23:59:59.999Z",
    "shop_id": "66f1aa00bb11cc22dd33ee44",
    "user_id": null,
    "sort_by": "total_work_hours",
    "sort_dir": "desc",
    "shift_order": "asc",

    // Range-level totals across ALL staff (not just current page)
    "total_work_hours": 187.5,
    "total_actual_hours": 192.25,

    "staff": [
      {
        "user_id": "66e0...aaa",
        "name": "Alice Patel",
        "email": "alice@example.com",
        "records_count": 18, // number of shifts in range
        "total_work_minutes": 1530,
        "total_work_hours": 25.5,
        "total_actual_minutes": 1560,
        "total_actual_hours": 26.0,
        "first_punch_in": "2026-06-02T08:01:13.000Z",
        "last_punch_out": "2026-06-29T17:04:09.000Z",
        "shifts": [
          {
            "_id": "66f9...001",
            "user_id": "66e0...aaa",
            "shop_id": { "_id": "66f1...", "name": "Subway Oxford St" },
            "rota_id": {
              "_id": "...",
              "shift_start": "...",
              "shift_end": "...",
              "shift_date": "2026-06-02",
              "start_time": "08:00",
              "end_time": "17:00",
              "note": "",
            },
            "punch_in": "2026-06-02T08:01:13.000Z",
            "punch_out": "2026-06-02T17:03:48.000Z",
            "shift_date": "2026-06-02",
            "work_minutes": 540,
            "work_hours": 9.0,
            // ...the rest of the Attendance document fields (status, manual_by, etc.)
          },
          // ...one entry per shift, ordered by shift_order
        ],
      },
      // ...next staff
    ],
  },
}
```

### Field semantics — important ones for UI

- **`work_minutes` / `work_hours` (per shift)** — the canonical "paid hours" for that shift. Uses `effective_minutes`, falling back to `adjusted_minutes`, falling back to the raw `punch_out − punch_in` difference. **Use these for display**, not the raw `punch_out − punch_in`.
- **`shift_date`** — date string `YYYY-MM-DD` derived from `punch_in`. Safe to group by for a day-wise view.
- **`punch_in` / `punch_out` on each shift** — for non-root users, these are overwritten with `effective_start` / `effective_end` when those exist (so the UI shows the adjusted shift window, not the raw clock-in/out).
- **`total_work_hours` (per staff)** — sum of per-shift work minutes, in hours (2 decimals).
- **`total_actual_hours` (per staff)** — pure clock-time sum (`punch_out − punch_in`). Useful if you want to show "scheduled vs actual" or surface adjustments.
- **`records_count`** — number of shifts in the range for that staff.
- **`first_punch_in` / `last_punch_out`** — useful if the UI wants to show a range badge like "Jun 2 → Jun 29" without scanning shifts.
- **Top-level `total_work_hours` / `total_actual_hours`** — sum across **every** staff in the range, not just the current page. Use these for the screen headline.

---

## curl examples

Replace `$TOKEN`, `$SHOP_ID`, `$USER_ID` with real values. All examples assume the staging host:

```bash
HOST="https://subway-viral.vercel.app"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
```

### 1. List all staff for a shop in June 2026, sorted by hours desc

```bash
curl -s "$HOST/api/attendance/staff-shifts?shop_id=$SHOP_ID&from_date=2026-06-01&to_date=2026-06-30" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json"
```

### 2. Sort by name (A→Z), 50 staff per page

```bash
curl -s "$HOST/api/attendance/staff-shifts?shop_id=$SHOP_ID&from_date=2026-06-01&to_date=2026-06-30&sort_by=name&sort_dir=asc&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Show one staff's shifts for a week, newest first

```bash
curl -s "$HOST/api/attendance/staff-shifts?shop_id=$SHOP_ID&from_date=2026-06-15&to_date=2026-06-21&user_id=$USER_ID&shift_order=desc" \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Pagination — page 2 of staff (in case a shop has many staff)

```bash
curl -s "$HOST/api/attendance/staff-shifts?shop_id=$SHOP_ID&from_date=2026-06-01&to_date=2026-06-30&page=2&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Suggested mobile UI integration

A typical month-picker screen can be built with **one request per (shop, month)** load:

```ts
type Shift = {
  _id: string;
  shift_date: string; // "YYYY-MM-DD"
  punch_in: string | null; // ISO
  punch_out: string | null; // ISO
  work_hours: number;
  work_minutes: number;
  shop_id: { _id: string; name: string };
  rota_id?: { shift_date?: string; start_time?: string; end_time?: string };
  // ...other Attendance fields
};

type StaffRow = {
  user_id: string;
  name: string | null;
  email: string | null;
  records_count: number;
  total_work_hours: number;
  total_actual_hours: number;
  first_punch_in: string | null;
  last_punch_out: string | null;
  shifts: Shift[];
};

type StaffShiftsResponse = {
  success: true;
  data: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
    count: number;
    from_date: string;
    to_date: string;
    shop_id: string;
    user_id: string | null;
    sort_by: 'total_work_hours' | 'name';
    sort_dir: 'asc' | 'desc';
    shift_order: 'asc' | 'desc';
    total_work_hours: number;
    total_actual_hours: number;
    staff: StaffRow[];
  };
};

async function fetchStaffShifts(args: {
  shopId: string;
  fromDate: string;
  toDate: string;
  page?: number;
  limit?: number;
  sortBy?: 'total_work_hours' | 'name';
  sortDir?: 'asc' | 'desc';
  shiftOrder?: 'asc' | 'desc';
  userId?: string;
  token: string;
}) {
  const p = new URLSearchParams({
    shop_id: args.shopId,
    from_date: args.fromDate,
    to_date: args.toDate,
    ...(args.page && { page: String(args.page) }),
    ...(args.limit && { limit: String(args.limit) }),
    ...(args.sortBy && { sort_by: args.sortBy }),
    ...(args.sortDir && { sort_dir: args.sortDir }),
    ...(args.shiftOrder && { shift_order: args.shiftOrder }),
    ...(args.userId && { user_id: args.userId }),
  });
  const res = await fetch(`${BASE_URL}/api/attendance/staff-shifts?${p}`, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  const body = (await res.json()) as StaffShiftsResponse;
  if (!res.ok || !body.success) throw new Error((body as any).message || 'Failed');
  return body.data;
}
```

### Grouping shifts day-by-day inside one staff

```ts
const byDay = (shifts: Shift[]) =>
  shifts.reduce<Record<string, Shift[]>>((acc, s) => {
    const k = s.shift_date ?? 'unknown';
    (acc[k] ||= []).push(s);
    return acc;
  }, {});
```

---

## Edge cases to handle in the UI

- **`null` `punch_out`** on a shift → staff is still clocked in. `work_hours` will be `0` until they clock out (the server auto-runs a sweep on each request, but mid-shift entries can still appear). Render as "In progress" instead of `0.0h`.
- **Empty page (`total: 0`)** → either no data or no access for this shop (see access control table). Use one empty-state UI.
- **`name` / `email` `null`** on a staff entry → the underlying User document was deleted; the attendance row still exists. Fall back to `user_id` for the label.
- **Pagination is over staff**, not shifts. A single staff can return dozens of shifts in one page entry; no need to paginate shifts on the client.
- **`total_work_hours` (top-level) ≠ sum of `staff[].total_work_hours` on the current page** when there are more pages. Use the top-level value for the screen headline; sum the staff array only if you need a per-page subtotal.

---

## Also in PR #14 (non-frontend)

PR [#14](https://github.com/parag-radadiya/subway-viral/pull/14) also added a `console.log` inside the `login` handler that prints the attempted email and whether the user was found. This is **server-side only** — no API contract change, no frontend impact. Surface to the BE team if you'd rather see this swapped for structured logging before prod.
