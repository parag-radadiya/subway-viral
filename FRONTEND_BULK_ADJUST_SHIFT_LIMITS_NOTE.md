# Frontend note — bulk-by-shop adjust: shift limits + preview

**TL;DR: no changes required for the current workflow.** The request body and the
existing success/error handling keep working. New fields are additive and optional.

## What changed on the server (transparent to you)

`POST /api/attendance/adjust-hours/bulk-by-shop` now regenerates **realistic
shifts** instead of one 14–22h block:

- Each generated shift is **≥ 4h and ≤ 10h** (defaults), **non-overlapping**, and
  **one shift per user per open window**. A target larger than the max is split
  into multiple shifts across days.
- The request body is unchanged. Two **optional** body fields let you override the
  limits: `min_shift_hours` (default 4) and `max_shift_hours` (default 10).

## Backward compatibility (why nothing breaks)

- **Same request** — send exactly what you send today.
- **Response is a superset** — all previous keys are still present
  (`totals.regenerated_hours`, `users[].regenerated_records_count`, `users_count`,
  `batch_id`, `coverage_rebalanced`, …). New keys are added alongside.
- **Same 200/409 behavior** — still `409` only for the two pre-existing cases
  (`UNSELECTED_USERS_IN_RANGE`, `INSUFFICIENT_TARGET_HOURS_FOR_COVERAGE`). Coverage
  gaps caused purely by the shift limits are **applied and reported as warnings**
  (HTTP `200`), never a new error.

## New optional fields (use only if you want to)

On the `200` apply response (and the preview response):

```jsonc
{
  "applied": true,                 // apply only
  "can_apply": true,
  "has_gaps": false,
  "limits": { "min_shift_hours": 4, "max_shift_hours": 10 },
  "warnings": [                    // empty when everything fit
    {
      "error_code": "COVERAGE_GAP_AFTER_ADJUSTMENT",
      "message": "Some shop open-time could not be staffed under the min/max shift limits (applied with gaps)",
      "detail": { "total_missing_hours": 2, "gaps": [ /* {start,end,minutes} */ ] }
    }
  ],
  "gaps": [ { "start": "…", "end": "…", "minutes": 120 } ],
  "users": [
    {
      "user_id": "…",
      "target_hours": 18,
      "allocated_hours": 18,
      "unallocated_hours": 0,
      "shift_count": 2,
      "regenerated_records_count": 2,   // legacy alias of shift_count
      "shifts": [
        { "punch_in": "…", "punch_out": "…", "hours": 10 },
        { "punch_in": "…", "punch_out": "…", "hours": 8 }
      ]
    }
  ]
}
```

If you want to show the user that some open time couldn't be staffed, read
`has_gaps` / `warnings`. Otherwise ignore them.

## Optional: new preview endpoint (no writes)

`POST /api/attendance/adjust-hours/bulk-by-shop/preview` — same body as apply.
Returns the proposed shift split, `gaps`, per-user `unallocated_hours`, `warnings`
and `can_apply`, **without writing anything**. Handy for a "preview before apply"
step, but not required.

Example:

```bash
curl -X POST '{{BASE_URL}}/api/attendance/adjust-hours/bulk-by-shop/preview' \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
        "shop_id": "…",
        "from_date": "2026-06-01",
        "to_date": "2026-06-02",
        "adjustments": [ { "user_id": "…", "target_hours": 18 } ]
      }'
```
