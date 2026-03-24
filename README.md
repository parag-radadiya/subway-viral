# Staff & Inventory Management Backend

A robust Node.js and MongoDB backend designed for efficient employee scheduling, attendance tracking with geofencing, and shop inventory management.

## 🚀 Key Features

### 👤 Employee Management

- **Role-Based Access Control (RBAC)**: Fine-grained permissions (Root, Admin, Manager, Sub-Manager, Staff).
- **Admin-Only User Creation**: No public signup; users are onboarded by authorized administrators.
- **Secure Password Management**: Mandatory password change for new users and self-service password updates.
- **Device ID Verification**: Pin users to specific devices for secure punch-ins.

### 📅 Rota & Scheduling

- **Bulk Weekly Publishing**: Schedule multiple staff for an entire week in one action.
- **Split-Shift Support**: Multiple shifts per user per day are supported.
- **Conflict Detection**: Built-in prevention of duplicate shift assignments at the database level.
- **Dashboard Views**: Real-time weekly overviews grouped by shop or by employee.

### ⏰ Attendance Tracking

- **Two-Step Geofenced Punch-In**:
  1. GPS validation against per-shop geofence radius.
  2. Biometric confirmation (frontend-driven) and Device ID verification.
- **Manual Punch-In Accountability**: Sub-Managers can manually clock in staff (exception flow), with full audit logs of who authorized the punch-in.

### 📈 System Observability (Root)

- **Request Analytics in MongoDB**: Route/method/status counts and latency metrics are aggregated and stored for dashboarding.
- **Central Error Logging**: API errors are persisted with status, route, user, and timestamp for troubleshooting.
- **Root Dashboard APIs**:
  - `GET /api/observability/overview?days=7`
  - `GET /api/observability/errors?days=7&limit=50`

### 📦 Inventory Management

- **Item Tracking**: Manage stock levels and item status (Good, Damaged, In Repair) across multiple shops.
- **Issue Ticketing (Queries)**: Streamlined reporting of damaged items.
- **Real-Time Status Sync**: Opening a query ticket automatically marks the item as 'Damaged'; closing the ticket reverts it to 'Good'.

## API Response Standard

All API responses are centralized and return the same envelope:

```json
{
  "status": 200,
  "message": "Request completed successfully",
  "data": {}
}
```

- `status` always mirrors the HTTP code.
- `message` is a readable summary.
- `data` contains the payload object (or `{}` if no payload).

This same structure is used for error responses as well (for example `400`, `401`, `403`, `404`, `409`, `429`, `500`).

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Security**: JWT, bcryptjs, Helmet, CORS
- **Documentation**: Swagger (OpenAPI 3.0), Postman

## ⚙️ Installation & Setup

### Prerequisites

- Node.js (v18+)
- MongoDB (Running locally or on Atlas)

### Local Setup

1. **Clone and Install**:
   ```bash
   git clone <repository-url>
   cd staff-inventory-backend
   npm install
   ```
2. **Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   MONGO_URI=mongodb://localhost:27017/staff_inventory
   JWT_SECRET=your_secret_key_here
   JWT_EXPIRES_IN=7d
   LOCATION_TOKEN_SECRET=geofence_secret_key
   LOCATION_TOKEN_TTL_MINUTES=5
   LOGIN_RATE_LIMIT_WINDOW_MINUTES=15
   LOGIN_RATE_LIMIT_MAX_ATTEMPTS=5
   ```
3. **Seed Initial Data**:
   Populate the database with roles, a root admin, and sample data:
   ```bash
   npm run seed
   ```
4. **Start the Server**:
   ```bash
   npm run dev
   ```

## 📖 API Documentation

- **Swagger UI**: Accessible at `http://localhost:3000/api-docs` when the server is running.
- **Postman**: Import the provided `postman_collection.json` to immediate testing.

## Deploy to Vercel

This project is ready for Vercel using `api/index.js` as the serverless entrypoint.

### 1) Push code to GitHub

Vercel deploys from your Git repository.

### 2) Import project in Vercel

- Open Vercel dashboard.
- Click **Add New Project**.
- Select this repo.
- Framework preset: **Other** (Node.js serverless API).

### 3) Configure environment variables

Add these in Vercel project settings for each environment (Preview/Production):

- `MONGO_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `LOCATION_TOKEN_SECRET`
- `LOCATION_TOKEN_TTL_MINUTES`
- `LOGIN_RATE_LIMIT_WINDOW_MINUTES`
- `LOGIN_RATE_LIMIT_MAX_ATTEMPTS`

### 4) Deploy

Trigger deploy from Vercel UI or push to the connected branch.

### 5) Verify deployment

After deploy, check:

- `https://<your-vercel-domain>/health`
- `https://<your-vercel-domain>/api-docs`

All API routes continue to work under the same paths, for example:

- `POST /api/auth/login`
- `GET /api/users`
- `POST /api/attendance/punch-in`

## ✅ Automated Test Setup (with Sandbox DB)

The project now includes Jest + Supertest integration tests under `tests/`.

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm test
```

### Coverage mode

```bash
npm run test:ci
```

## Git Hooks and Quality Checks

This repo uses Husky + lint-staged to keep commits clean and to block low-quality pushes.

### What runs automatically

- **Pre-commit** (`.husky/pre-commit`): runs `npx lint-staged`
  - `*.{js,json,md,yml,yaml}` -> `prettier --write`
  - `*.js` -> `eslint --fix` and `jest --bail --findRelatedTests --passWithNoTests`
- **Pre-push** (`.husky/pre-push`): runs full coverage tests via `npm run test:coverage`

### Useful manual commands

```bash
npm run lint
npm run format:check
npm run test:coverage
npm run quality:check
```

### Bypass hooks (only for emergencies)

```bash
git commit -m "message" --no-verify
HUSKY=0 git push
```

Use bypass only temporarily and fix issues before opening or merging a PR.

### Sandbox database strategy

- Default: tests use an isolated in-memory MongoDB instance (`mongodb-memory-server`).
- This prevents test data from touching your local/staging/prod MongoDB.
- Test data is reseeded before each test so results stay deterministic.

### Optional external sandbox DB

If you need to run tests against a real sandbox MongoDB, create `.env.test` from `.env.test.example` and set your sandbox values.

### Current automated coverage

- Auth and onboarding (`tests/integration/auth.test.js`)
- User permission gates (`tests/integration/users.test.js`)
- Attendance handshake and manual punch flows (`tests/integration/attendance.test.js`)
- Inventory + query lifecycle status sync (`tests/integration/inventory.test.js`)
- Rota bulk/dashboard access control (`tests/integration/rotas.test.js`)

Reference checklist: `TEST_CASES.md`

---

### Root Administrator Credentials (Post-Seed)

- **Email**: `root@org.com`
- **Password**: `Root@1234`
