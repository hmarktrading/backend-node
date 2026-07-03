'use strict';

const readline = require('readline');
const config = require('../config');
const logger = require('../config/logger');
const { getJsonlStream } = require('./downloadService');
const { passesFilters } = require('../utils/customerFilter');
const { normalizeShopifyId } = require('../utils/shopifyId');
const {
  countActiveRecords,
  getExistingShopifyIds,
  getRecordsToArchive,
  insertIntoArchive,
  deleteFromPipeline,
  insertBatch,
} = require('./pipelineAirtableService');

async function archiveCompletedRecords() {
  logger.info('[pipeline:archive] Fetching records to archive...');

  const records = await getRecordsToArchive();

  if (records.length === 0) {
    logger.info('[pipeline:archive] No records to archive today.');
    return { archived: 0, deleted: 0 };
  }

  logger.info(`[pipeline:archive] Found ${records.length} records to archive`);

  const archived = await insertIntoArchive(records);
  logger.info(`[pipeline:archive] Inserted ${archived} records into archive table`);

  const recordIds = records.map((r) => r.id);
  const deleted = await deleteFromPipeline(recordIds);
  logger.info(`[pipeline:archive] Deleted ${deleted} records from active pipeline`);

  return { archived, deleted };
}

async function computeDailyQuota() {
  const quota = config.pipeline.dailyQuota;

  logger.info(`[pipeline:quota] Daily quota = ${quota}. Counting active records...`);

  const { followUp, empty, total } = await countActiveRecords();

  const freshSlots = Math.max(0, quota - total);

  logger.info('[pipeline:quota] Quota computed', {
    quota,
    followUp,
    empty,
    slotsUsed: total,
    freshSlots,
  });

  return { followUp, empty, slotsUsed: total, freshSlots };
}

/**
 * STEP 3 — Stream JSONL, join line items, filter, collect up to `limit` NEW customers, insert
 *
 * Shopify's Bulk Operations API flattens nested connections (like lineItems)
 * into separate JSONL lines tagged with `__parentId`. Since `lastOrder` is a
 * singular object (not a list), __parentId on each LineItem line points
 * directly at the Customer's own id — there's no separate Order line.
 * LineItem lines also have no `id` field (we only request `title`), so we
 * must NOT require `.id` when bucketing them.
 */
async function fillPipeline(bulkUrl, limit, filterOptions = {}) {
  if (limit === 0) {
    logger.info('[pipeline:fill] No fresh slots available. Skipping fill.');
    return { processed: 0, matched: 0, skippedFilter: 0, skippedDuplicate: 0, inserted: 0 };
  }

  const resolvedFilters = {
    minOrders:        filterOptions.minOrders        ?? config.filters.minOrders,
    minAmountSpent:   filterOptions.minAmountSpent   ?? config.filters.minAmountSpent,
    lastOrderDaysAgo: filterOptions.lastOrderDaysAgo ?? config.filters.lastOrderDaysAgo,
  };

  logger.info(`[pipeline:fill] Will add up to ${limit} fresh records`, { filters: resolvedFilters });

  const existingIds = await getExistingShopifyIds();

  const stats = {
    processed: 0,
    matched: 0,
    skippedFilter: 0,
    skippedDuplicate: 0,
    inserted: 0,
  };

  const stream = await getJsonlStream(bulkUrl);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const customers = [];
  const lineItemTitlesByCustomerId = new Map(); // customerId -> [titles]

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    stats.processed++;

    if (stats.processed % config.processing.progressInterval === 0) {
      logger.info(`[pipeline:fill] Scanned ${stats.processed.toLocaleString()} records`);
    }

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!obj || typeof obj !== 'object') continue;

    if (obj.numberOfOrders !== undefined && obj.id) {
      customers.push(obj);
    } else if (obj.__parentId && obj.title !== undefined) {
      if (!lineItemTitlesByCustomerId.has(obj.__parentId)) {
        lineItemTitlesByCustomerId.set(obj.__parentId, []);
      }
      lineItemTitlesByCustomerId.get(obj.__parentId).push(obj.title);
    }
  }

  rl.close();

  logger.info(`[pipeline:fill] Pass 1 complete`, {
    customers: customers.length,
    lineItemGroups: lineItemTitlesByCustomerId.size,
  });

  const freshCustomers = [];

  for (const customer of customers) {
    if (freshCustomers.length >= limit) break;

    const titles = lineItemTitlesByCustomerId.get(customer.id);

    if (titles && titles.length > 0) {
      customer._lastOrderProductTitles = titles.join(', ');
    }

    if (!passesFilters(customer, resolvedFilters)) {
      stats.skippedFilter++;
      continue;
    }

    if (existingIds.has(normalizeShopifyId(customer.id))) {
      stats.skippedDuplicate++;
      continue;
    }

    stats.matched++;
    freshCustomers.push(customer);
    existingIds.add(normalizeShopifyId(customer.id));
  }

  logger.info(`[pipeline:fill] Collected ${freshCustomers.length} fresh customers. Inserting...`);

  if (freshCustomers.length > 0) {
    stats.inserted = await insertBatch(freshCustomers);
  }

  logger.info('[pipeline:fill] Done', stats);
  return stats;
}

async function runDailyPipeline(bulkUrl, filterOptions = {}) {
  const startTime = Date.now();
  logger.info('[pipeline] ═══ Daily Pipeline Job Started ═══');

  const archiveResult = await archiveCompletedRecords();
  const quotaResult = await computeDailyQuota();
  const fillResult = await fillPipeline(bulkUrl, quotaResult.freshSlots, filterOptions);

  const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

  const summary = {
    success: true,
    archive: archiveResult,
    quota: quotaResult,
    fill: fillResult,
    executionTime: `${executionTime} seconds`,
  };

  logger.info('[pipeline] ═══ Daily Pipeline Job Completed ═══', summary);
  return summary;
}

module.exports = { runDailyPipeline };