# Postman + Test Coverage Audit

This document records the verification status for Postman requests and automated test coverage, focused on rota and attendance role-based flows.

## Scope Checked

- `postman_collection.json`
- `tests/integration/rotas.test.js`
- `tests/integration/attendance.test.js`
- `TEST_CASES.md`

## 1) Postman Verification

### Before audit

Rota folder had only partial coverage (`GET /api/rotas`, `GET /api/rotas?shop_id=...`, `POST /api/rotas`).

### Updated now

The collection now includes full rota flow coverage:

- `GET /api/rotas`
- `GET /api/rotas?shop_id={{shop_id}}`
- `GET /api/rotas/{{rota_id}}`
- `POST /api/rotas`
- `PUT /api/rotas/{{rota_id}}`
- `DELETE /api/rotas/{{rota_id}}`
- `POST /api/rotas/bulk`
- `GET /api/rotas/week?week_start={{week_start}}&shop_id={{shop_id}}`
- `DELETE /api/rotas/week?week_start={{week_start}}&shop_id={{shop_id}}`
- `GET /api/rotas/dashboard?week_start={{week_start}}`

Attendance folder now explicitly includes role-view calls for dashboard screens:

- `GET /api/attendance` (admin/root all records)
- `GET /api/attendance?shop_id={{shop_id}}` (manager/sub-manager assigned-shop view)
- `GET /api/attendance?user_id={{user_id}}` (employee self view)

New collection variable added:

- `week_start` (default: `2026-03-16`)

Validation done:

- `postman_collection.json` parses successfully as valid JSON.

## 2) Automated Test Verification

Executed suites:

- `tests/integration/rotas.test.js`
- `tests/integration/attendance.test.js`

Run result:

- Test suites: `2 passed`
- Tests: `33 passed`
- Failures: `0`

## 3) Test Case Catalog Verification (`TEST_CASES.md`)

### Gaps fixed

The test case catalog has been updated to match implemented/tested behavior:

- Added rota cases `ROTA-014` to `ROTA-020` (self-scope enforcement, assigned-shop restrictions, merged datetime payload)
- Corrected `ATT-017` from "forbidden" to actual behavior "employee self-scope"
- Added attendance cases `ATT-018` to `ATT-020` (unregistered device, admin cross-shop visibility, sub-manager shop scope)

## 4) Current Conclusion

- Postman coverage for rota + attendance role views is now aligned with current backend routes.
- Integration test coverage for rota + attendance success/error/security paths is present and currently passing.
- `TEST_CASES.md` now reflects the implemented behavior more accurately for role-scoped access.

