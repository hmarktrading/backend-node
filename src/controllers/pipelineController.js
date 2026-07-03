'use strict';

const config = require('../config');
const logger = require('../config/logger');
const { runDailyPipeline } = require('../services/pipelineService');

async function handleDailyPipeline(req, res) {
  const { bulkUrl, days, minimumOrders, minimumSpend } = req.body;

  if (!bulkUrl || typeof bulkUrl !== 'string' || !bulkUrl.startsWith('http')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing bulkUrl. Must be a valid HTTP(S) URL.',
    });
  }

  const filterOptions = {
    lastOrderDaysAgo: parsePositiveInt(days,          config.filters.lastOrderDaysAgo),
    minOrders:        parsePositiveInt(minimumOrders, config.filters.minOrders),
    minAmountSpent:   parsePositiveNumber(minimumSpend, config.filters.minAmountSpent),
  };

  logger.info('[pipeline:controller] Daily pipeline triggered', { bulkUrl, filterOptions });

  try {
    const result = await runDailyPipeline(bulkUrl, filterOptions);
    return res.status(200).json(result);
  } catch (err) {
    logger.error('[pipeline:controller] Pipeline failed', { error: err.message, stack: err.stack });
    return res.status(500).json({
      success: false,
      error: 'Pipeline job failed. See server logs for details.',
      message: err.message,
    });
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = { handleDailyPipeline };
