'use strict';

require('dotenv').config();

const requiredEnvVars = [
  'AIRTABLE_API_KEY',
  'AIRTABLE_BASE_ID',
  'AIRTABLE_TABLE',
];

function validateConfig() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateConfig();

module.exports = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  airtable: {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    // Main pipeline table (Inactive Caller Pipeline)
    table: process.env.AIRTABLE_TABLE,
    // Archive table (same base, different table)
    archiveTable: process.env.AIRTABLE_ARCHIVE_TABLE || 'Archived Customers',
    batchSize: parseInt(process.env.AIRTABLE_BATCH_SIZE, 10) || 10,
    requestTimeoutMs: parseInt(process.env.AIRTABLE_REQUEST_TIMEOUT_MS, 10) || 30000,
    maxRetries: parseInt(process.env.AIRTABLE_MAX_RETRIES, 10) || 3,
  },
  shopify: {
    storeHandle: process.env.SHOPIFY_STORE_HANDLE || 'cliara-aromas',
  },
  download: {
    timeoutMs: parseInt(process.env.DOWNLOAD_TIMEOUT_MS, 10) || 300000,
  },
  processing: {
    progressInterval: parseInt(process.env.PROGRESS_INTERVAL, 10) || 10000,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  filters: {
    minOrders: 2,
    minAmountSpent: 10000,
    lastOrderDaysAgo: 90,
  },
  pipeline: {
    // Max active records in the caller pipeline at any time
    dailyQuota: parseInt(process.env.PIPELINE_DAILY_QUOTA, 10) || 150,
    // Statuses that count as "active" (take up quota slots)
    activeStatuses: ['Follow Up', ''],
    // Statuses that trigger archiving
    archiveStatuses: ['Not Interested', 'Reactivated'],
  },
};
