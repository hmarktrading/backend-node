'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');
const { withRetry } = require('../utils/retry');
const { mapCustomerToAirtable } = require('../utils/mapCustomerToAirtable');
const { normalizeShopifyId } = require('../utils/shopifyId');

// ── Axios instances ──────────────────────────────────────────────────────────

function makeAxios(table) {
  return axios.create({
    baseURL: `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(table)}`,
    timeout: config.airtable.requestTimeoutMs,
    headers: {
      Authorization: `Bearer ${config.airtable.apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

const pipelineAxios = () => makeAxios(config.airtable.table);
const archiveAxios  = () => makeAxios(config.airtable.archiveTable);

// ── Pipeline quota helpers ───────────────────────────────────────────────────

/**
 * Counts active records in the pipeline:
 * - Status = "Follow Up"
 * - Status is empty/blank
 * Returns { followUp, empty, total }
 */
async function countActiveRecords() {
  const ax = pipelineAxios();

  const followUp = await paginateCount(ax, '{Status} = "Follow Up"');
  const empty    = await paginateCount(ax, 'OR({Status} = "", {Status} = BLANK())');

  return { followUp, empty, total: followUp + empty };
}

/**
 * Counts all records matching a formula by paginating through results.
 */
async function paginateCount(ax, formula) {
  let count = 0;
  let offset = null;

  do {
    const params = {
      filterByFormula: formula,
      fields: ['Shopify Customer ID'],
      pageSize: 100,
    };
    if (offset) params.offset = offset;

    const res = await withRetry(
      () => ax.get('', { params }),
      config.airtable.maxRetries, 1000, `paginate count (${formula})`
    );

    count += (res.data?.records || []).length;
    offset = res.data?.offset || null;
  } while (offset);

  return count;
}

/**
 * Get all existing Shopify Customer IDs in the pipeline (to avoid duplicates).
 * Returns a Set of shopify IDs.
 */
async function getExistingShopifyIds() {
  const ids = new Set();

  logger.info('[pipeline] Fetching existing Shopify IDs to prevent duplicates (active + archived)...');

  for (const ax of [pipelineAxios(), archiveAxios()]) {
    let offset = null;

    do {
      const params = {
        fields: ['Shopify Customer ID'],
        pageSize: 100,
      };
      if (offset) params.offset = offset;

      const res = await withRetry(
        () => ax.get('', { params }),
        config.airtable.maxRetries, 1000, 'fetch existing IDs'
      );

      for (const record of res.data?.records || []) {
        const id = record.fields?.['Shopify Customer ID'];
        if (id) ids.add(normalizeShopifyId(id));
      }

      offset = res.data?.offset || null;
    } while (offset);
  }

  logger.info(`[pipeline] Found ${ids.size} existing records (active + archived)`);
  return ids;
}

// ── Archive helpers ──────────────────────────────────────────────────────────

/**
 * Fetches all records from pipeline where Status = 'Not Interested' or 'Reactivated'.
 * Returns array of { id, fields } records.
 */
async function getRecordsToArchive() {
  const ax = pipelineAxios();
  const records = [];
  let offset = null;

  const formula = `OR({Status} = "Not Interested", {Status} = "Reactivated")`;

  do {
    const params = {
      filterByFormula: formula,
      pageSize: 100,
    };
    if (offset) params.offset = offset;

    const res = await withRetry(
      () => ax.get('', { params }),
      config.airtable.maxRetries, 1000, 'fetch records to archive'
    );

    records.push(...(res.data?.records || []));
    offset = res.data?.offset || null;
  } while (offset);

  return records;
}

/**
 * Inserts records into the archive table in batches of 10.
 * Strips read-only/computed fields (e.g. Attachment Summary) that
 * Airtable will reject if written to directly.
 */
async function insertIntoArchive(records) {
  const ax = archiveAxios();
  let archived = 0;

  // Airtable computed/read-only fields that can never be written via API
  const READONLY_FIELDS = ['Attachment Summary'];

  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10).map((r) => {
      const fields = { ...r.fields };
      for (const key of READONLY_FIELDS) {
        delete fields[key];
      }
      return { fields };
    });

    await withRetry(
      async () => {
        try {
          const res = await ax.post('', { records: batch });
          archived += res.data?.records?.length || 0;
        } catch (err) {
          logger.error('[pipeline:archive] INSERT error detail', { detail: err.response?.data });
          throw err;
        }
      },
      config.airtable.maxRetries, 1000, `archive batch ${i / 10 + 1}`
    );
  }

  return archived;
}

/**
 * Deletes records from pipeline by record ID in batches of 10.
 * Airtable DELETE supports ?records[]=id1&records[]=id2 (up to 10).
 */
async function deleteFromPipeline(recordIds) {
  const ax = pipelineAxios();
  let deleted = 0;

  for (let i = 0; i < recordIds.length; i += 10) {
    const batch = recordIds.slice(i, i + 10);

    await withRetry(
      async () => {
        const params = new URLSearchParams();
        batch.forEach((id) => params.append('records[]', id));

        const res = await ax.delete(`?${params.toString()}`);
        deleted += res.data?.records?.length || 0;
      },
      config.airtable.maxRetries, 1000, `delete batch ${i / 10 + 1}`
    );
  }

  return deleted;
}

// ── Batch insert new customers ───────────────────────────────────────────────

/**
 * Inserts a batch of NEW customers into the pipeline (no upsert — pipeline only gets fresh records).
 * Returns { inserted }
 */
async function insertBatch(customers) {
  const ax = pipelineAxios();
  let inserted = 0;

  for (let i = 0; i < customers.length; i += 10) {
    const batch = customers.slice(i, i + 10).map((c) => ({ fields: mapCustomerToAirtable(c) }));

await withRetry(
      async () => {
        try {
          const res = await ax.post('', { records: batch });
          inserted += res.data?.records?.length || 0;
          logger.info(`[pipeline] Inserted batch of ${batch.length} records (total: ${inserted})`);
        } catch (err) {
          logger.error('[pipeline:insert] INSERT error detail', { detail: err.response?.data, sample: batch[0] });
          throw err;
        }
      },
      config.airtable.maxRetries, 1000, `insert batch ${Math.floor(i / 10) + 1}`
    );
  }

  return inserted;
}

module.exports = {
  countActiveRecords,
  getExistingShopifyIds,
  getRecordsToArchive,
  insertIntoArchive,
  deleteFromPipeline,
  insertBatch,
};