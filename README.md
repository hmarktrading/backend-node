# shopify-reactivation-service

Production-ready Node.js/Express backend that receives a Shopify Bulk Operation JSONL URL, streams it line-by-line, filters inactive high-value customers, and upserts matching records into Airtable.

Designed to handle 300,000–1,000,000+ customer records with constant low memory usage.

---

## Architecture

```
Make.com (HTTP POST)
    │
    ▼
POST /api/shopify-sync
    │
    ├── downloadService   → Streams JSONL from Google Storage URL
    │
    ├── syncService       → readline line-by-line parse + filter loop
    │       │
    │       └── customerFilter → Applies 3 business filter conditions
    │
    └── airtableService   → Batch upsert via Airtable REST API
            │
            ├── findRecordByShopifyId (lookup existing)
            ├── Batch POST  (create new)
            └── Batch PATCH (update existing)
```

---

## Customer Filter Logic

Only customers matching **ALL** of the following are synced:

| Condition | Rule |
|-----------|------|
| Orders | `numberOfOrders >= 2` |
| Spend | `amountSpent.amount >= 50000` |
| Recency | `lastOrder.createdAt` is **older than 90 days** |

Missing fields are handled safely — the customer is skipped, never crashes.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `AIRTABLE_API_KEY` | ✅ | — | Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | ✅ | — | Airtable Base ID (starts with `app`) |
| `AIRTABLE_TABLE` | ✅ | — | Airtable table name |
| `PORT` | ❌ | `3000` | Server port |
| `NODE_ENV` | ❌ | `development` | Environment |
| `AIRTABLE_BATCH_SIZE` | ❌ | `10` | Records per Airtable request (max 10) |
| `AIRTABLE_REQUEST_TIMEOUT_MS` | ❌ | `30000` | Airtable request timeout |
| `AIRTABLE_MAX_RETRIES` | ❌ | `3` | Retry attempts for Airtable + downloads |
| `DOWNLOAD_TIMEOUT_MS` | ❌ | `300000` | JSONL download timeout (5 min) |
| `LOG_LEVEL` | ❌ | `info` | Winston log level |
| `PROGRESS_INTERVAL` | ❌ | `10000` | Log every N customers processed |

---

## Airtable Setup

### Required Columns

Create the following fields in your Airtable table (names must match exactly):

| Field Name | Type |
|---|---|
| Shopify Customer ID | Single line text |
| Email | Email |
| First Name | Single line text |
| Last Name | Single line text |
| Phone | Phone number |
| Number of Orders | Number |
| Total Amount Spent | Number |
| Currency | Single line text |
| Last Order Date | Date |
| Last Order ID | Single line text |
| Tags | Long text |
| Created At | Date |
| Updated At | Date |
| Verified Email | Checkbox |
| Synced At | Date |

> **Note**: You can rename fields by editing `src/utils/mapCustomerToAirtable.js`.

---

## Installation

```bash
git clone https://github.com/yourrepo/shopify-reactivation-service
cd shopify-reactivation-service
npm install
cp .env.example .env
# Fill in .env values
```

---

## Running Locally

```bash
npm run dev
```

Test with:

```bash
curl -X POST http://localhost:3000/api/shopify-sync \
  -H "Content-Type: application/json" \
  -d '{"bulkUrl":"https://storage.googleapis.com/your-file.jsonl"}'
```

Health check:

```bash
curl http://localhost:3000/health
```

---

## Deploying to Render

### Option A — Using render.yaml (recommended)

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → New → Blueprint.
3. Select your repo — Render will auto-detect `render.yaml`.
4. Set the secret environment variables (`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE`) in the Render dashboard.
5. Deploy.

### Option B — Manual

1. New → Web Service → Connect your repo.
2. Build Command: `npm ci --omit=dev`
3. Start Command: `node server.js`
4. Add environment variables from `.env.example`.
5. Deploy.

Your API will be live at:
```
https://shopify-reactivation-service.onrender.com
```

---

## Connecting Make.com

Configure your Make scenario as follows:

```
[Scheduler]
    ↓
[Shopify] → Run a Bulk Operation (query all customers)
    ↓
[Sleep] → Wait 60–120s for bulk job to complete
    ↓
[Shopify] → Get Current Bulk Operation (poll status)
    ↓
[Filter] → Status = COMPLETED
    ↓
[HTTP] → Make a Request
    Method: POST
    URL: https://your-service.onrender.com/api/shopify-sync
    Body type: Raw
    Content type: application/json
    Body:
    {
      "bulkUrl": "{{currentBulkOperation.url}}"
    }
```

The backend handles everything else automatically.

---

## API Reference

### POST `/api/shopify-sync`

**Request:**
```json
{
  "bulkUrl": "https://storage.googleapis.com/shopify-exports/customers.jsonl"
}
```

**Response (200):**
```json
{
  "success": true,
  "processed": 300000,
  "matched": 1850,
  "inserted": 1800,
  "updated": 50,
  "skipped": 298150,
  "errors": 0,
  "executionTime": "142.33 seconds"
}
```

**Response (400):**
```json
{
  "success": false,
  "error": "Invalid or missing bulkUrl. Must be a valid HTTP(S) URL."
}
```

### GET `/health`

```json
{
  "status": "ok",
  "timestamp": "2024-07-01T10:00:00.000Z"
}
```

---

## Performance Notes

- Uses `readline` interface over a streamed Axios response — only one line is in memory at a time.
- Batch size is capped at 10 to respect Airtable's API limit.
- Airtable upsert uses `filterByFormula` to find existing records before writing.
- All Airtable + download calls have automatic retry with exponential backoff (1s → 2s → 4s).
- The service can process 1M+ records without OOM errors on the smallest Render plan.

---

## Project Structure

```
shopify-reactivation-service/
├── server.js                          # Express app + graceful shutdown
├── package.json
├── Dockerfile
├── render.yaml
├── .env.example
├── README.md
└── src/
    ├── config/
    │   ├── index.js                   # All env vars validated + exported
    │   └── logger.js                  # Winston logger
    ├── routes/
    │   ├── sync.js                    # POST /api/shopify-sync
    │   └── health.js                  # GET /health
    ├── controllers/
    │   └── syncController.js          # Input validation + response shaping
    ├── services/
    │   ├── syncService.js             # Streaming orchestration
    │   ├── downloadService.js         # Axios stream download
    │   └── airtableService.js         # Batch upsert via REST API
    ├── middlewares/
    │   ├── requestLogger.js
    │   └── errorHandler.js
    └── utils/
        ├── customerFilter.js          # Business filter conditions
        ├── mapCustomerToAirtable.js   # Field mapping
        └── retry.js                   # Exponential backoff helper
```
