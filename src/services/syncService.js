'use strict';

const readline = require('readline');

const config = require('../config');
const logger = require('../config/logger');
const { getJsonlStream } = require('./downloadService');
const { processBatch } = require('./airtableService');
const { passesFilters } = require('../utils/customerFilter');

/**
 * Main orchestration function.
 *
 * @param {string} bulkUrl       - JSONL file URL from Shopify bulk operation
 * @param {object} filterOptions - Optional runtime filter overrides from Make.com body
 *   filterOptions.minOrders        (number) — override FILTER_MIN_ORDERS
 *   filterOptions.minAmountSpent   (number) — override FILTER_MIN_AMOUNT_SPENT
 *   filterOptions.lastOrderDaysAgo (number) — override FILTER_LAST_ORDER_DAYS_AGO
 *
 * Memory footprint: Only one batch (10 records) in memory at a time.
 */
async function runSync(bulkUrl, filterOptions = {}) {
  const startTime = Date.now();
  const batchSize = config.airtable.batchSize;
  const progressInterval = config.processing.progressInterval;

  // Merge runtime overrides with .env/config defaults
  const resolvedFilters = {
    minOrders:        filterOptions.minOrders        ?? config.filters.minOrders,
    minAmountSpent:   filterOptions.minAmountSpent   ?? config.filters.minAmountSpent,
    lastOrderDaysAgo: filterOptions.lastOrderDaysAgo ?? config.filters.lastOrderDaysAgo,
  };

  const stats = {
    processed: 0,
    matched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  logger.info('[sync] Starting bulk sync', { bulkUrl, filters: resolvedFilters });

  const stream = await getJsonlStream(bulkUrl);

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let batch = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    stats.processed++;

    // Progress logging
    if (stats.processed % progressInterval === 0) {
      logger.info(`[sync] Progress: ${stats.processed.toLocaleString()} customers processed`, {
        matched: stats.matched,
        inserted: stats.inserted,
        updated: stats.updated,
        skipped: stats.skipped,
      });
    }

    // Parse JSON safely
    let customer;
    try {
      customer = JSON.parse(trimmed);
    } catch (parseErr) {
      logger.warn('[sync] Malformed JSON line, skipping', { line: trimmed.substring(0, 100) });
      stats.skipped++;
      continue;
    }

    // Skip non-customer objects (e.g., order nodes in some exports)
    if (!customer || typeof customer !== 'object' || !customer.id) {
      stats.skipped++;
      continue;
    }

    // Apply business filters — pass resolved filter values at runtime
    if (!passesFilters(customer, resolvedFilters)) {
      stats.skipped++;
      continue;
    }

    stats.matched++;
    batch.push(customer);

    // Flush when batch is full
    if (batch.length >= batchSize) {
      const flushBatch = batch;
      batch = [];

      try {
        const result = await processBatch(flushBatch);
        stats.inserted += result.inserted;
        stats.updated += result.updated;
      } catch (batchErr) {
        logger.error('[sync] Batch failed after all retries', {
          error: batchErr.message,
          batchSize: flushBatch.length,
        });
        stats.errors += flushBatch.length;
      }
    }
  }

  // Flush remaining records
  if (batch.length > 0) {
    try {
      const result = await processBatch(batch);
      stats.inserted += result.inserted;
      stats.updated += result.updated;
    } catch (batchErr) {
      logger.error('[sync] Final batch failed after all retries', {
        error: batchErr.message,
        batchSize: batch.length,
      });
      stats.errors += batch.length;
    }
  }

  const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

  logger.info('[sync] Completed', {
    ...stats,
    filters: resolvedFilters,
    executionTime: `${executionTime}s`,
  });

  return {
    success: true,
    processed: stats.processed,
    matched: stats.matched,
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skipped,
    errors: stats.errors,
    filtersApplied: resolvedFilters,
    executionTime: `${executionTime} seconds`,
  };
}

module.exports = { runSync };
