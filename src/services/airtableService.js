'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');
const { withRetry } = require('../utils/retry');
const { mapCustomerToAirtable } = require('../utils/mapCustomerToAirtable');

const BASE_URL = `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(config.airtable.table)}`;

const airtableAxios = axios.create({
  baseURL: BASE_URL,
  timeout: config.airtable.requestTimeoutMs,
  headers: {
    Authorization: `Bearer ${config.airtable.apiKey}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Searches for an existing Airtable record by Shopify Customer ID.
 * Returns the record ID if found, otherwise null.
 */
async function findRecordByShopifyId(shopifyCustomerId) {
  const formula = `{Shopify Customer ID} = "${shopifyCustomerId}"`;

  const response = await airtableAxios.get('', {
    params: {
      filterByFormula: formula,
      maxRecords: 1,
      fields: ['Shopify Customer ID'],
    },
  });

  const records = response.data?.records || [];
  return records.length > 0 ? records[0].id : null;
}

/**
 * Upserts a single customer to Airtable.
 * - If record exists: PATCH (update).
 * - If not: POST (create).
 *
 * Returns 'inserted' or 'updated'.
 */
async function upsertCustomer(customer) {
  const shopifyId = customer.id;
  const fields = mapCustomerToAirtable(customer);

  return withRetry(
    async () => {
      const existingRecordId = await findRecordByShopifyId(shopifyId);

      if (existingRecordId) {
        await airtableAxios.patch(`/${existingRecordId}`, { fields });
        return 'updated';
      } else {
        await airtableAxios.post('', { fields });
        return 'inserted';
      }
    },
    config.airtable.maxRetries,
    1000,
    `upsert customer ${shopifyId}`
  );
}

/**
 * Processes a batch of customers:
 * - Looks up each by Shopify Customer ID
 * - Splits into creates and updates
 * - Fires batch POST for new records
 * - Fires individual PATCHes for updates (Airtable batch PATCH requires record IDs)
 *
 * Returns { inserted, updated }
 */
async function processBatch(customers) {
  const batchNumber = Math.random().toString(36).substring(2, 7); // short ID for log tracing
  logger.info(`[airtable] Processing batch of ${customers.length} customers`, { batchId: batchNumber });

  let inserted = 0;
  let updated = 0;

  // Step 1: Lookup all existing records in parallel
  const lookups = await Promise.allSettled(
    customers.map((c) =>
      withRetry(
        () => findRecordByShopifyId(c.id),
        config.airtable.maxRetries,
        1000,
        `lookup ${c.id}`
      ).then((recordId) => ({ customer: c, recordId }))
    )
  );

  const toCreate = [];
  const toUpdate = [];

  for (const result of lookups) {
    if (result.status === 'fulfilled') {
      const { customer, recordId } = result.value;
      if (recordId) {
        toUpdate.push({ recordId, fields: mapCustomerToAirtable(customer) });
      } else {
        toCreate.push({ fields: mapCustomerToAirtable(customer) });
      }
    } else {
      logger.warn('[airtable] Failed to look up record, skipping', { error: result.reason?.message });
    }
  }

  // Step 2: Batch create (up to 10 per request)
 if (toCreate.length > 0) {
    await withRetry(
      async () => {
        try {
          const response = await airtableAxios.post('', { records: toCreate });
          inserted += response.data?.records?.length || 0;
          logger.info(`[airtable] Batch created ${inserted} records`, { batchId: batchNumber });
        } catch (err) {
          logger.error('[airtable] CREATE error detail', { detail: err.response?.data });
          throw err;
        }
      },
      config.airtable.maxRetries,
      1000,
      `batch create (batchId: ${batchNumber})`
    );
  }

  // Step 3: Batch update (Airtable supports PATCH with array of {id, fields})
  if (toUpdate.length > 0) {
    const updatePayload = toUpdate.map((r) => ({ id: r.recordId, fields: r.fields }));

await withRetry(
      async () => {
        try {
          const response = await airtableAxios.patch('', { records: updatePayload });
          updated += response.data?.records?.length || 0;
          logger.info(`[airtable] Batch updated ${updated} records`, { batchId: batchNumber });
        } catch (err) {
          logger.error('[airtable] UPDATE error detail', { detail: err.response?.data });
          throw err;
        }
      },
      config.airtable.maxRetries,
      1000,
      `batch update (batchId: ${batchNumber})`
    );
  }

  return { inserted, updated };
}

module.exports = { processBatch, upsertCustomer };
