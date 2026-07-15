# Frontend Guide — Shop flags + Financial record edit/delete

This covers **what you (frontend) need to change**. Two areas:

1. **Shops** now return two new flags — `is_active` and `is_all_shops` — so you can drop the query param you used to exclude the "All Shops" aggregate, and you can show/hide closed shops.
2. **Financial records** (Weekly 2026 + Monthly Sale 2026) now have **edit** and **delete** endpoints.

All responses use the standard envelope:

```jsonc
{ "status": 200, "message": "…", "data": { … } }
```

All requests need `Authorization: Bearer <jwt>`. Base URL below is written as `{{BASE_URL}}`.

---

## Part 1 — Shop flags (`is_active`, `is_all_shops`)

### What changed for you

- Every shop object now includes:
  - `is_active` (boolean) — `false` means the shop is **closed/inactive**.
  - `is_all_shops` (boolean) — `true` only on the special **"All Shops"** aggregate record (the "sum of all shops" row).
- `GET /api/shops` behavior is **unchanged** — it still returns **all** shops (including inactive ones and the "All Shops" row). Filtering is now **your job on the client** using these flags.

### ✅ Action items

1. **Remove** whatever query param you were sending to keep the "All Shops" row out of the list. Instead, filter client-side:
   - To **hide** the aggregate row: `shops.filter(s => !s.is_all_shops)`
   - To **show only** the aggregate (e.g. a combined view): `shops.find(s => s.is_all_shops)`
2. Use `is_active` to hide or badge closed shops, e.g. `shops.filter(s => s.is_active)` for pickers, or show a "Closed" badge when `is_active === false`.
3. Add an on/off toggle in the shop edit screen that sends `is_active` (see below).

### List shops

```bash
curl '{{BASE_URL}}/api/shops' \
  -H 'Authorization: Bearer <jwt>'
```

**Response** (note the two new fields on every shop):

```jsonc
{
  "status": 200,
  "message": "Shops fetched successfully",
  "data": {
    "total": 14,
    "page": 1,
    "limit": 20,
    "total_pages": 1,
    "count": 14,
    "shops": [
      {
        "_id": "69f4c7823a7e3e41d36af730",
        "name": "swiss cottage",
        "is_active": true,          // ← NEW
        "is_all_shops": false,      // ← NEW
        "opening_time": "07:00",
        "closing_time": "05:00",
        "closes_next_day": true,
        "geofence_radius_m": 100,
        "aliases": [],
        "latitude": 51.54,
        "longitude": -0.17
        // …other existing fields…
      },
      {
        "_id": "6a15cacc55a39a4e95760143",
        "name": "All Shops",
        "is_active": true,
        "is_all_shops": true        // ← the aggregate row; filter it out client-side
      }
    ]
  }
}
```

### Mark a shop closed / open

Use the existing update endpoint; just include `is_active` (and, if ever needed, `is_all_shops`).

```bash
curl -X PUT '{{BASE_URL}}/api/shops/69f4c7823a7e3e41d36af730' \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{ "is_active": false }'
```

**Response:**

```jsonc
{
  "status": 200,
  "message": "Shop updated successfully",
  "data": {
    "shop": {
      "_id": "69f4c7823a7e3e41d36af730",
      "name": "swiss cottage",
      "is_active": false,           // ← now closed
      "is_all_shops": false
      // …other fields…
    }
  }
}
```

> Requires `can_manage_shops`. Sending `is_active` is optional — omit it and the value is left unchanged.

---

## Part 2 — Financial record **edit** & **delete**

Applies to both financial record families. Get the record `_id` from the existing list endpoints (`GET /api/store-reports/weekly` and `GET /api/store-reports/monthly-sale`) — each row has an `_id`.

| Action | Weekly | Monthly Sale |
| ------ | ------ | ------------ |
| Edit   | `PUT /api/store-reports/weekly/:id`    | `PUT /api/store-reports/monthly-sale/:id`    |
| Delete | `DELETE /api/store-reports/weekly/:id` | `DELETE /api/store-reports/monthly-sale/:id` |

- The existing **create/save** flow (`POST /api/store-reports/weekly` and `.../monthly-sale`) is **unchanged** — keep using it to add records.
- All four new calls require permission `can_manage_rotas`.
- You only need to send the fields you want to change. Sending just `metrics` is the common case.

### Edit a weekly record

```bash
curl -X PUT '{{BASE_URL}}/api/store-reports/weekly/6a12f0d3e4b1c2a3f4567890' \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
        "metrics": { "sales": 18250.5, "labour": 2700, "royalties": 2228.77 },
        "week_number": 2,
        "week_range_label": "05/01 to 11/01"
      }'
```

**Response:**

```jsonc
{
  "status": 200,
  "message": "Weekly 2026 record updated",
  "data": {
    "record": {
      "_id": "6a12f0d3e4b1c2a3f4567890",
      "shop_id": "69f4c7823a7e3e41d36af730",
      "store_name_raw": "swiss cottage",
      "store_key": "swiss cottage",
      "source_sheet": "Weekly 2026",
      "period_key": "2026-01-W02",      // ← recomputed automatically
      "year": 2026,
      "month": 1,
      "week_number": 2,
      "week_start": "2026-01-05T00:00:00.000Z",
      "week_end": "2026-01-11T23:59:59.999Z",
      "week_range_label": "05/01 to 11/01",
      "metrics": { "sales": 18250.5, "labour": 2700, "royalties": 2228.77 },
      "updated_by": "69ef6f73540ceeb7b82b8083",
      "updatedAt": "2026-07-15T10:22:01.114Z"
    }
  }
}
```

**Editable fields** (all optional — send only what changes):

| Field | Notes |
| ----- | ----- |
| `metrics` | Object of numeric KPIs. **Replaces** the whole metrics object (send the full set you want stored). |
| `year`, `month`, `week_number` | Change the period. `period_key`, `week_start`, `week_end` are recomputed for you. |
| `week_range_label` | e.g. `"05/01 to 11/01"`; sets `week_start`/`week_end` when parseable. |
| `store_name` **or** `shop_id` | Re-point the record to a different store. |
| `source_sheet` | Rarely needed. |

### Edit a monthly-sale record

Same idea, no week fields:

```bash
curl -X PUT '{{BASE_URL}}/api/store-reports/monthly-sale/6a12aa11bb22cc33dd44ee55' \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{ "metrics": { "sales": 74210.9 }, "month": 3 }'
```

**Response:**

```jsonc
{
  "status": 200,
  "message": "Monthly Sale 2026 record updated",
  "data": {
    "record": {
      "_id": "6a12aa11bb22cc33dd44ee55",
      "shop_id": "69f4c7823a7e3e41d36af730",
      "store_name_raw": "swiss cottage",
      "period_key": "2026-03",         // ← recomputed
      "year": 2026,
      "month": 3,
      "metrics": { "sales": 74210.9 },
      "updated_by": "69ef6f73540ceeb7b82b8083"
    }
  }
}
```

### Delete a record

```bash
curl -X DELETE '{{BASE_URL}}/api/store-reports/weekly/6a12f0d3e4b1c2a3f4567890' \
  -H 'Authorization: Bearer <jwt>'
```

**Response** (the deleted record is echoed back so you can undo/toast):

```jsonc
{
  "status": 200,
  "message": "Weekly 2026 record deleted",
  "data": {
    "record": {
      "_id": "6a12f0d3e4b1c2a3f4567890",
      "store_name_raw": "swiss cottage",
      "period_key": "2026-01-W02"
      // …the record that was removed…
    }
  }
}
```

Monthly is identical: `DELETE /api/store-reports/monthly-sale/:id` → `"Monthly Sale 2026 record deleted"`.

### Error responses to handle

| HTTP | When | `message` example |
| ---- | ---- | ----------------- |
| `400` | `metrics` sent but not an object | `"metrics must be an object"` |
| `403` | User lacks `can_manage_rotas`, or the target store is outside their scope | `"Forbidden: …"` |
| `404` | No record with that `:id` (or it's outside the caller's shop scope) | `"Weekly 2026 record not found"` |
| `409` | An edit would make this record collide with another (same sheet + period + store) | `"A weekly record with the same sheet/period/store already exists"` |

All errors use the same envelope, e.g.:

```jsonc
{ "status": 409, "message": "A weekly record with the same sheet/period/store already exists", "data": {} }
```

---

## Quick checklist

- [ ] Stop sending the old "exclude All Shops" query param; filter with `is_all_shops` instead.
- [ ] Read `is_active` to show/hide/badge closed shops; add an is-active toggle that `PUT`s `{ "is_active": … }`.
- [ ] Wire up **Edit** on weekly/monthly records → `PUT …/:id` (send changed fields, usually `metrics`).
- [ ] Wire up **Delete** on weekly/monthly records → `DELETE …/:id`.
- [ ] Handle `400 / 403 / 404 / 409` on edit/delete.
