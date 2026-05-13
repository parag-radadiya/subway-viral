# Frontend Guide: Overnight Shop Hours

This document covers every UI touch-point affected by the overnight operating
hours change. Shops now open at **07:00** and close at **05:00 the following
day** (22 hours open, 2 hours closed).

---

## 1. New API field — `closes_next_day`

Every shop object returned by the API now includes a computed boolean:

```json
{
  "opening_time": "07:00",
  "closing_time": "05:00",
  "closes_next_day": true
}
```

| `closes_next_day` | Meaning                                        |
| ----------------- | ---------------------------------------------- |
| `false`           | Shop opens and closes on the same calendar day |
| `true`            | `closing_time` is on the **next** calendar day |

No extra computation needed — read this flag directly.

---

## 2. Shop Settings / Edit Screen

### Hours display

Show the closing time with a "next day" badge when `closes_next_day` is `true`.

**Before (same-day):**

```
Opening time:  10:00
Closing time:  23:00
```

**After (overnight):**

```
Opening time:  07:00
Closing time:  05:00  (+1 day)
```

Suggested component change:

```jsx
// Before
<span>{shop.closing_time}</span>

// After
<span>
  {shop.closing_time}
  {shop.closes_next_day && <Badge>+1 day</Badge>}
</span>
```

### Hours edit form

- Both fields remain plain `HH:MM` text inputs — no date picker needed.
- Add helper text: _"If closing time is earlier than opening time, the shop closes on the following day (e.g. 07:00 → 05:00 = 22-hour window)."_
- Validation: allow `closing_time < opening_time` (currently may show an error — remove that guard if present).

### Example payload (no change to API contract)

```json
PUT /api/shops/:id/hours
{
  "opening_time": "07:00",
  "closing_time": "05:00",
  "note": "Extended overnight hours"
}
```

---

## 3. Rota Creation — Single Shift

### End time rolls to next day automatically

When a user enters:

- **Start:** `23:00`
- **End:** `04:00`

The backend already adds `+1 day` to the end when `end_time <= start_time`
(both `POST /api/rotas` and `POST /api/rotas/bulk` handle this).

**Frontend change:** When `end_time < start_time`, show a "+1 day" indicator
next to the end time field so the user knows the shift ends the next morning.

```jsx
const isOvernight = endTime < startTime;

<TimeInput label="End time" value={endTime} onChange={setEndTime} />;
{
  isOvernight && <span className="text-blue-500 text-sm">Ends next day</span>;
}
```

### Shift date label

For overnight shifts, the `shift_date` stored by the backend is the date of
`shift_start`. A shift starting `Monday 23:00` and ending `Tuesday 04:00` has
`shift_date = Monday`. Display should reflect this:

```
Mon 11 May   23:00 → 04:00 (+1)   [Staff Name]
```

---

## 4. Rota Bulk Publish (Weekly Schedule)

### Week view grid

The weekly grid spans Mon–Sun. Overnight shifts (e.g. `23:00→05:00`) start on
day N and bleed into day N+1.

**Recommended:** render the overnight block as a bar that stretches from 23:00
to the end of the day column, and optionally show a "continues" indicator on
the next day column if your grid supports it.

At minimum, show the times correctly in the shift card:

```
23:00 – 05:00 (+1)
```

### Bulk assignment payload (no change)

```json
POST /api/rotas/bulk
{
  "shop_id": "...",
  "week_start": "2026-05-11",
  "days": [0, 1, 2, 3, 4, 5, 6],
  "assignments": [
    { "user_id": "...", "start_time": "07:00", "end_time": "15:00" },
    { "user_id": "...", "start_time": "15:00", "end_time": "23:00" },
    { "user_id": "...", "start_time": "23:00", "end_time": "05:00" }
  ]
}
```

The last assignment (`23:00→05:00`) will have its end rolled to the next day
automatically. No frontend change to the request payload is needed.

---

## 5. Attendance / Punch-In

### Geofence punch-in window

The attendance controller already calculates the shop's operating window using
the overnight-aware logic. No frontend change needed for punch-in itself.

### Attendance summary display

If you show "Today's operating hours" on a staff dashboard, use the same
`closes_next_day` flag:

```
Today: 07:00 – 05:00 (+1)   Shop is open
```

---

## 6. Bulk Adjust Hours (Admin)

The `POST /api/attendance/bulk-adjust` endpoint now correctly computes a 22-hour
coverage window per day for overnight shops. The required hours displayed in the
UI should match:

| Date range | Required coverage |
| ---------- | ----------------- |
| 1 day      | 22 h              |
| 2 days     | 44 h              |
| 7 days     | 154 h             |

**Frontend change:** If you display "Required coverage hours" from the error
payload (`required_coverage_hours`), no change is needed — the backend already
returns the correct value.

---

## 7. Shop Hours History

The `GET /api/shops/:id/hours-history` response is unchanged. Each history
entry has `opening_time` and `closing_time`. Apply the same "+1 day" badge
logic described in section 2 when `closing_time < opening_time`.

---

## 8. Summary of frontend changes

| Area                   | Change required                                                      | Priority |
| ---------------------- | -------------------------------------------------------------------- | -------- |
| Shop hours display     | Show `+1 day` badge on closing time when `closes_next_day` is `true` | **High** |
| Shop hours edit form   | Allow `closing_time < opening_time`; add helper text                 | **High** |
| Rota single-shift form | Show "Ends next day" hint when end < start                           | Medium   |
| Weekly rota grid       | Display overnight shifts with `(+1)` label                           | Medium   |
| Attendance dashboard   | Show overnight indicator on shop hours                               | Low      |
| Bulk adjust UI         | No change — correct values come from the API                         | None     |
| Punch-in screen        | No change — backend handles it                                       | None     |
