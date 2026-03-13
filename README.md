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

### 📦 Inventory Management
- **Item Tracking**: Manage stock levels and item status (Good, Damaged, In Repair) across multiple shops.
- **Issue Ticketing (Queries)**: Streamlined reporting of damaged items.
- **Real-Time Status Sync**: Opening a query ticket automatically marks the item as 'Damaged'; closing the ticket reverts it to 'Good'.

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

---

### Root Administrator Credentials (Post-Seed)
- **Email**: `root@org.com`
- **Password**: `Root@1234`
