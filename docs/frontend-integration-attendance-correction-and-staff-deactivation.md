# Frontend Integration — Attendance Correction & Staff Deactivation

Two new manager-facing abilities were added. This guide is for frontend/mobile
developers integrating the **Correct clock-in/out** button and the **Delete
(deactivate) staff** button in the Admin, Manager, and Sub-Manager sections.

- **Correct clock-in/out** — fix a shift's `punch_in` / `punch_out` after the
  fact (e.g. a shift that was auto punched-out at the wrong time). Staff cannot
  change a closed shift; this is the manager override.
- **Delete staff** — deactivate a staff member who has left the job (soft
  delete, reversible, preserves attendance/payroll history).

---

## 1. Who can see these buttons

Both actions are gated by **role permissions**. After login, the user object
returned by `POST /api/auth/login` (and `GET /api/auth/me`) includes
`role_id.permissions`. Show/hide the buttons based on these flags:

| Button                       | Permission flag           | Roles that have it (default)          |
| ---------------------------- | ------------------------- | ------------------------------------- |
| Correct clock-in / clock-out | `can_correct_attendance`  | Root, Admin, Manager, Sub-Manager     |
| Delete (deactivate) staff    | `can_delete_staff`        | Root, Admin, Manager, Sub-Manager     |

```js
const perms = user?.role_id?.permissions || {};
const canCorrect = Boolean(perms.can_correct_attendance);
const canDeleteStaff = Boolean(perms.can_delete_staff);
```

> The server still enforces every rule below even if the button is shown — the
> permission flags are only for UX. Always handle `403` responses gracefully.

**Scope note:** Managers/Sub-Managers are limited to their **assigned shops**.
The API will return `403` if they try to correct a record or deactivate a user
outside their assigned shops, so surface those errors as "not in your shops".

---

## 2. Common response envelope

Every response uses the same shape:

```jsonc
// success
{ "status": 200, "message": "…", "data": { /* … */ } }

// error
{ "status": 403, "message": "Forbidden: …", "data": { /* … */ } }
```

All requests require the bearer token:

```
Authorization: Bearer <access_token>
```

---

## 3. Correct clock-in / clock-out

### `PUT /api/attendance/:id/correct`

Corrects the punch times of an existing attendance record. Send **one or both**
of `punch_in` / `punch_out`. Omitted fields keep their current value.

**Path params**

| Param | Description               |
| ----- | ------------------------- |
| `id`  | Attendance record `_id`   |

**Body**

| Field       | Type              | Required | Notes                                                    |
| ----------- | ----------------- | -------- | -------------------------------------------------------- |
| `punch_in`  | ISO 8601 datetime | no\*     | New clock-in time. Cannot be in the future.              |
| `punch_out` | ISO 8601 datetime | no\*     | New clock-out time. Cannot be in the future.             |
| `note`      | string (≤300)     | no       | Optional reason for the correction (stored for audit).   |

\* At least one of `punch_in` / `punch_out` must be provided.

**Example request**

```http
PUT /api/attendance/665f0c2a9b1e4a0012a3b4c5/correct
Authorization: Bearer <token>
Content-Type: application/json

{
  "punch_out": "2026-03-16T17:00:00.000Z",
  "note": "Auto punch-out fired 2h late — corrected to real leave time"
}
```

**Example success (`200`)**

```jsonc
{
  "status": 200,
  "message": "Attendance times corrected successfully",
  "data": {
    "attendance": {
      "_id": "665f0c2a9b1e4a0012a3b4c5",
      "user_id": { "_id": "…", "name": "Dave Staff", "email": "staff@org.com" },
      "shop_id": { "_id": "…", "name": "Main Branch" },
      "punch_in": "2026-03-16T09:00:00.000Z",
      "punch_out": "2026-03-16T17:00:00.000Z",   // corrected
      "punch_out_source": "Manual",
      "corrected_by": { "_id": "…", "name": "Bob Manager", "email": "manager@org.com" },
      "corrected_at": "2026-08-12T18:40:00.000Z",
      "correction_note": "Auto punch-out fired 2h late …",
      "original_punch_in": "2026-03-16T09:00:00.000Z",   // first pre-correction snapshot
      "original_punch_out": "2026-03-16T19:00:00.000Z",
      "total_break_minutes": 30,
      "total_break_hours": 0.5,
      "breaks_count": 1,
      "is_on_break": false
    }
  }
}
```

**Behaviour to know about**

- Applying a correction **clears any prior hours adjustment** on that record —
  the effective/adjusted window is removed and totals recompute from the new raw
  punch times.
- `original_punch_in` / `original_punch_out` are snapshotted **once** (on the
  first correction) so the very first values are always recoverable.
- `punch_out_source` becomes `"Manual"` when a punch_out is set.

**Error responses**

| Status | When                                                                         |
| ------ | ---------------------------------------------------------------------------- |
| `400`  | Neither field provided; invalid date; a time in the future; `punch_out` ≤ `punch_in`; window excludes an existing break; an open break exists |
| `403`  | Missing `can_correct_attendance`, or record is outside the caller's assigned shops |
| `404`  | Attendance record not found (or archived)                                    |

**Suggested UX**

1. Pre-fill the two datetime pickers with the record's current `punch_in` /
   `punch_out`.
2. Let the manager edit one or both, add an optional note.
3. On `400`, show `message` inline next to the field.
4. On success, replace the row with `data.attendance` and show a "Corrected" badge
   (you can display `corrected_by.name` + `corrected_at`).

---

## 4. Delete (deactivate) staff

### `DELETE /api/users/:id`

Soft-deletes a user (sets `is_active: false`). The user stays in the database so
their attendance/payroll history is preserved, but they can no longer log in and
disappear from active-staff lists. Reversible by an Admin re-activating them.

**Path params**

| Param | Description        |
| ----- | ------------------ |
| `id`  | Target user `_id`  |

**Example request**

```http
DELETE /api/users/665f0c2a9b1e4a0012a3b4c5
Authorization: Bearer <token>
```

**Example success (`200`)**

```jsonc
{
  "status": 200,
  "message": "User deactivated successfully",
  "data": { "user": { "_id": "…", "name": "Dave Staff", "is_active": false } }
}
```

**Guardrails (enforced server-side)**

- You **cannot deactivate your own account** → `400`.
- **Root** users can never be deactivated via this endpoint → `403`.
- **Managers / Sub-Managers** (shop-scoped):
  - cannot deactivate **Admin** or **Manager** accounts → `403`;
  - can only deactivate users **within their assigned shops** → otherwise `403`.
- **Admin / Root** (global) can deactivate any non-Root user.

**Error responses**

| Status | When                                                                        |
| ------ | --------------------------------------------------------------------------- |
| `400`  | Attempting to deactivate your own account                                   |
| `403`  | Missing `can_delete_staff`; target is Root/Admin/Manager out of allowance; target outside assigned shops |
| `404`  | User not found or already inactive                                          |

**Suggested UX**

1. Show a confirmation dialog: "Deactivate {name}? They will lose access but
   their history is kept." (Prefer the word *Deactivate* over *Delete* since it's
   reversible.)
2. On success, remove the row from the active-staff list.
3. On `403`, show a toast such as "You can only remove staff in your shops."

---

## 5. Quick reference

| Action                  | Method & path                    | Permission                | Success message                          |
| ----------------------- | -------------------------------- | ------------------------- | ---------------------------------------- |
| Correct clock-in/out    | `PUT /api/attendance/:id/correct`| `can_correct_attendance`  | `Attendance times corrected successfully`|
| Deactivate staff        | `DELETE /api/users/:id`          | `can_delete_staff`        | `User deactivated successfully`          |

## 6. Backend rollout note (for reference)

Existing environments must run the one-time permission migration so already-seeded
roles gain the two new flags:

```bash
npm run migrate:correct-delete-permissions
```

Full Swagger definitions for both endpoints are available at `/api-docs` once the
server is running.
