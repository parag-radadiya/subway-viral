# File Upload API Migration Guide

## Overview

The `/api/store-reports/import-historical-workbook` endpoint has been updated to accept **file uploads** instead of file paths. This improves security and user experience by eliminating the need to know server-side file paths.

## Changes Summary

### What Changed
- **Old API**: Accepted `file_path` parameter in JSON request body
- **New API**: Accepts multipart file upload with optional form fields

### Key Features
✅ Secure file uploads (no server file paths needed)
✅ File validation (Excel format only)
✅ File size limit (10MB)
✅ Backward compatible response format
✅ Full test coverage

## Installation

The multer package has been added to handle file uploads:

```bash
npm install multer
```

## API Endpoint

### POST `/api/store-reports/import-historical-workbook`

**Authentication**: Required (`Authorization: Bearer <token>`)
**Permission**: `can_manage_rotas`

---

## Usage Examples

### 1. Using cURL

```bash
curl -X POST http://localhost:5000/api/store-reports/import-historical-workbook \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@Book1.xlsx" \
  -F "year=2026" \
  -F "weekly_store_name=Main Branch"
```

### 2. Using Postman

1. Set request to **POST**
2. URL: `http://localhost:5000/api/store-reports/import-historical-workbook`
3. **Headers** tab:
   - `Authorization: Bearer YOUR_TOKEN`
4. **Body** tab → Select **form-data**
5. Add fields:
   - Key: `file` → Type: **File** → Choose your Excel file
   - Key: `year` → Type: **Text** → Value: `2026`
   - Key: `weekly_store_name` → Type: **Text** → Value: `Main Branch` (optional)

### 3. Using JavaScript/Fetch

```javascript
const formData = new FormData();
formData.append('file', fileInputElement.files[0]);
formData.append('year', 2026);
formData.append('weekly_store_name', 'Main Branch');

const response = await fetch(
  'http://localhost:5000/api/store-reports/import-historical-workbook',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  }
);

const data = await response.json();
console.log(data);
```

### 4. Using Axios

```javascript
const formData = new FormData();
formData.append('file', fileInputElement.files[0]);
formData.append('year', 2026);
formData.append('weekly_store_name', 'Main Branch');

const response = await axios.post(
  'http://localhost:5000/api/store-reports/import-historical-workbook',
  formData,
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'multipart/form-data',
    },
  }
);

console.log(response.data);
```

### 5. Using SuperTest (Testing)

```javascript
const request = require('supertest');
const app = require('../app');

it('should import historical workbook', async () => {
  const response = await request(app)
    .post('/api/store-reports/import-historical-workbook')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', '/path/to/Book1.xlsx')
    .field('year', '2026')
    .field('weekly_store_name', 'Main Branch');

  expect(response.status).toBe(200);
  expect(response.body.data.imported.weekly_2026b).toBeGreaterThan(0);
});
```

---

## Request Parameters

| Field                | Type   | Required | Description                                         |
| -------------------- | ------ | -------- | --------------------------------------------------- |
| `file`               | File   | Yes      | Excel workbook (.xlsx or .xls)                      |
| `year`               | number | No       | Year for records (default: current year)            |
| `weekly_store_name`  | string | No       | Fallback store name for Weekly sheet                |
| `default_store_name` | string | No       | Alternative fallback store name                     |

## Response Format

### Success Response (200 OK)

```json
{
  "status": 200,
  "message": "Historical workbook data imported successfully",
  "data": {
    "file_name": "Book1.xlsx",
    "file_size": 245678,
    "sheets": {
      "jan_dec_26": "Jan-Dec 26",
      "weekly_2026b": "Weekly 2026",
      "monthly_sale_2026": "Monthly Sale 2026"
    },
    "imported": {
      "store_report_entry": 120,
      "weekly_2026b": 52,
      "monthly_sale_2026": 342
    },
    "upserted": {
      "store_report_entry": 120,
      "weekly_2026b": 52,
      "monthly_sale_2026": 342
    },
    "updated": {
      "store_report_entry": 0,
      "weekly_2026b": 0,
      "monthly_sale_2026": 0
    },
    "matched": {
      "store_report_entry": 0,
      "weekly_2026b": 0,
      "monthly_sale_2026": 0
    },
    "failed": 0,
    "errors": []
  }
}
```

### Error Response - No File Provided (400)

```json
{
  "status": 400,
  "message": "Excel file is required. Please upload a file.",
  "data": {}
}
```

### Error Response - Invalid File Format (400)

```json
{
  "status": 400,
  "message": "Only Excel files (.xlsx, .xls) are allowed",
  "data": {}
}
```

### Error Response - File Too Large (413)

```json
{
  "status": 413,
  "message": "File too large. Maximum size is 10MB.",
  "data": {}
}
```

### Error Response - Invalid Excel Format (400)

```json
{
  "status": 400,
  "message": "Failed to parse Excel file: ...",
  "data": {}
}
```

### Error Response - Missing Sheets (400)

```json
{
  "status": 400,
  "message": "Required sheet(s) not found: Jan-Dec 26, Weekly 2026",
  "data": {}
}
```

---

## Required Excel Sheets

The uploaded Excel file must contain the following sheets (exact names or aliases):

1. **Jan-Dec 26** (aliases: `Jan Dec 26`)
2. **Weekly 2026B** (aliases: `Weekly 2026`, `Weekly 2026B`)
3. **Monthly Sale 2026**

### Expected Sheet Structure

#### Jan-Dec 26 Sheet
Columns: Store, Week Ending, Sales, Net, Labour, VAT 18%, Royalties, Food Cost 22%, Commission, etc.

#### Weekly 2026 Sheet
Columns: Week #, Week Ending, Sales, Net, Labour, VAT 18%, Total, Income, etc.

#### Monthly Sale 2026 Sheet
Columns: Store, Gross Sale, Net Sale, VAT, VAT %, Customer Count, Bidfood, Labour Hour, Labour Cost, etc.

---

## File Validation Rules

- **Accepted Formats**: `.xlsx`, `.xls`
- **Maximum Size**: 10MB
- **Content Type**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or `application/vnd.ms-excel`
- **Required Sheets**: All three sheets mentioned above

---

## Migration Notes

### For Frontend Developers

If you're using the old endpoint with `file_path` in the request body, update to:

**Before:**
```javascript
const response = await fetch('/api/store-reports/import-historical-workbook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    file_path: '/server/path/to/file.xlsx',
    year: 2026,
  }),
});
```

**After:**
```javascript
const formData = new FormData();
formData.append('file', fileInputElement.files[0]);
formData.append('year', 2026);

const response = await fetch('/api/store-reports/import-historical-workbook', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
  },
  body: formData,
});
```

### For Backend Developers

The multer middleware is configured in `src/routes/storeReports.js`:

```javascript
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post(
  '/import-historical-workbook',
  protect,
  requirePermission('can_manage_rotas'),
  upload.single('file'),
  importHistoricalWorkbookData
);
```

The file is accessible in the controller via `req.file`:
- `req.file.buffer` - File content as buffer
- `req.file.originalname` - Original filename
- `req.file.mimetype` - MIME type
- `req.file.size` - File size in bytes

---

## Commits

The following commits implement this feature:

1. **feat: modify import-historical-workbook endpoint to accept file uploads**
   - Install multer dependency
   - Add file upload middleware to route
   - Update controller to handle file buffers
   - Update API documentation

2. **test: update store reports tests to use file upload API**
   - Update integration tests to use `.attach()` method
   - Verify file upload functionality

---

## Testing

All tests have been updated and are passing:

```bash
npm test -- tests/integration/storeReports.test.js

# Results: 28 passed
```

Key tests:
- ✅ REPORT-021: admin can import historical workbook into all three report collections
- ✅ REPORT-021b: STORE label rows are skipped during monthly sale import

---

## Troubleshooting

### Issue: "Only Excel files are allowed"
**Solution**: Ensure you're uploading a valid `.xlsx` or `.xls` file.

### Issue: "File too large"
**Solution**: The file exceeds 10MB. Split into smaller files or reduce file size.

### Issue: "Excel file is required"
**Solution**: Ensure the `file` field is included in the multipart form data.

### Issue: "Required sheet(s) not found"
**Solution**: Verify the Excel file contains sheets named exactly: `Jan-Dec 26`, `Weekly 2026`, `Monthly Sale 2026`.

---

## Support

For more details, see:
- Full API Documentation: `docs/STORE_REPORTS_API.md`
- Route Implementation: `src/routes/storeReports.js`
- Controller Implementation: `src/controllers/storeReportController.js`
- Tests: `tests/integration/storeReports.test.js`

