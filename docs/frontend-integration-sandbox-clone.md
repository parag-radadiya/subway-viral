# Frontend Integration — Clone Production → Sandbox (Root only)

A new **Root-only** action lets a Root user copy the entire production database
into a separate **sandbox** database, so new features can be tested against
real-shaped data without touching production.

> ⚠️ This is a **destructive** operation **on the sandbox** — it drops and
> rebuilds every sandbox collection as an exact snapshot of production. It never
> writes to production. Treat it like a "reset sandbox from prod" button.

---

## 1. Who can see this button

This action is restricted to the **Root** role only (not Admin, Manager, etc.).
Show the button only when the logged-in user is Root.

After login, the user object from `POST /api/auth/login` (and
`GET /api/auth/me`) includes `role_id.role_name`:

```js
const isRoot = user?.role_id?.role_name === 'Root';
// render the "Clone production to sandbox" button only when isRoot === true
```

> The server enforces this regardless of the UI — a non-Root token gets `403`.
> The flag is only for UX. Always handle `403` gracefully.

---

## 2. Common response envelope

Every response uses the same shape:

```jsonc
// success
{ "status": 200, "message": "…", "data": { /* … */ } }

// error
{ "status": 403, "message": "Forbidden: root access required", "data": {} }
```

All requests need the auth header:

```
Authorization: Bearer <access_token>
```

---

## 3. The endpoint

### `POST /api/sandbox/clone`

Clones production into the sandbox database.

**Request body**

| Field        | Type    | Required | Notes                                                    |
| ------------ | ------- | -------- | -------------------------------------------------------- |
| `confirm`    | boolean | **Yes**  | Must be exactly `true`. Guard against accidental clicks. |
| `batch_size` | integer | No       | Documents copied per batch. Default `1000`. Leave unset. |

```js
async function cloneProductionToSandbox(token) {
  const res = await fetch('/api/sandbox/clone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ confirm: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message);
  return json.data;
}
```

**Success — `200`**

```jsonc
{
  "status": 200,
  "message": "Production database cloned into sandbox",
  "data": {
    "source_database": "staff_inventory",
    "sandbox_database": "staff_inventory_sandbox",
    "same_cluster": true,
    "collections_cloned": 12,
    "total_documents": 5842,
    "collections": [
      { "collection": "users", "documents": 214, "indexes": 4 },
      { "collection": "attendances", "documents": 3120, "indexes": 3 },
      { "collection": "shops", "documents": 18, "indexes": 2 },
      // … one entry per collection
    ],
    "started_at": "2026-08-19T10:15:00.000Z",
    "finished_at": "2026-08-19T10:15:07.400Z",
    "duration_ms": 7400,
  },
}
```

Use `collections_cloned`, `total_documents`, and `duration_ms` to render a
"Sandbox refreshed — 12 collections, 5,842 documents in 7.4s" confirmation.

---

## 4. Error responses to handle

| Status | When                                        | Suggested UI                                                        |
| ------ | ------------------------------------------- | ------------------------------------------------------------------- |
| `400`  | `confirm` was not `true`                    | Shouldn't happen if you always send `true`; show generic error.     |
| `400`  | Sandbox target misconfigured (same as prod) | "Sandbox is not configured. Contact backend." (server config issue) |
| `401`  | Missing / invalid / expired token           | Redirect to login.                                                  |
| `403`  | Caller is not Root                          | Hide the button; show "Root access required" if reached anyway.     |
| `503`  | Database not connected                      | "Service unavailable, try again shortly."                           |

```jsonc
{ "status": 400, "message": "Confirmation required: send { \"confirm\": true } …", "data": {} }
```

---

## 5. Recommended UX

Because this overwrites the sandbox and can take several seconds:

1. **Guard with a confirm dialog.** Something like:
   _"This will erase the sandbox database and replace it with a fresh copy of
   production. Continue?"_ → only then send `{ confirm: true }`.
2. **Show a loading/spinner state** while the request is in flight — it is a
   longer request than typical CRUD calls (it copies the whole database).
3. **Disable the button** while running to prevent double-submits.
4. **Render the summary** from the response on success (counts + duration).
5. This action is **safe to re-run** anytime — each run fully resets the sandbox.

```jsx
// Example (React-ish)
async function onClone() {
  if (!window.confirm('Erase the sandbox and refresh it from production?')) return;
  setLoading(true);
  try {
    const summary = await cloneProductionToSandbox(token);
    toast.success(
      `Sandbox refreshed: ${summary.collections_cloned} collections, ` +
        `${summary.total_documents.toLocaleString()} docs in ` +
        `${(summary.duration_ms / 1000).toFixed(1)}s`
    );
  } catch (e) {
    toast.error(e.message);
  } finally {
    setLoading(false);
  }
}
```

---

## 6. Notes for the frontend

- **Nothing to point at a "sandbox API".** The frontend keeps calling the same
  backend base URL. Whether the _backend itself_ runs against production or
  sandbox data is a backend/deployment concern — this endpoint only populates
  the sandbox database; it does not switch which database the app reads from.
- **Timeouts:** if your HTTP client has a short default timeout, bump it for
  this call (e.g. 60s+) since large databases take longer to copy.
- **Only expose in internal/admin tooling.** This belongs in a Root-only
  settings/ops screen, not general app UI.
