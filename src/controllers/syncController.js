'use strict';

const config = require('../config');
const logger = require('../config/logger');
const { runSync } = require('../services/syncService');

async function handleShopifySync(req, res) {
  const { bulkUrl, days, minimumOrders, minimumSpend } = req.body;

  if (!bulkUrl || typeof bulkUrl !== 'string' || !bulkUrl.startsWith('http')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing bulkUrl. Must be a valid HTTP(S) URL.',
    });
  }

  const filterOptions = {
    lastOrderDaysAgo: parsePositiveInt(days,           config.filters.lastOrderDaysAgo),
    minOrders:        parsePositiveInt(minimumOrders,  config.filters.minOrders),
    minAmountSpent:   parsePositiveNumber(minimumSpend, config.filters.minAmountSpent),
  };

  logger.info('[controller] Received sync request', { bulkUrl, filters: filterOptions });

  // ── Respond immediately so Make doesn't time out ──────────────────────────
  res.status(202).json({ success: true, message: 'Sync started' });

  // ── Process in background ─────────────────────────────────────────────────
  runSync(bulkUrl, filterOptions)
    .then(result => logger.info('[controller] Sync completed', result))
    .catch(err  => logger.error('[controller] Sync failed', { error: err.message, stack: err.stack }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = { handleShopifySync };
