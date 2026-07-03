'use strict';

const logger = require('../config/logger');

/**
 * Retry a function with exponential backoff.
 *
 * @param {Function} fn          - Async function to retry
 * @param {number}   maxRetries  - Max number of attempts (default 3)
 * @param {number}   baseDelayMs - Initial delay in ms (default 1000)
 * @param {string}   label       - Label for log messages
 */
async function withRetry(fn, maxRetries = 3, baseDelayMs = 1000, label = 'operation') {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) break;

      const delay = baseDelayMs * Math.pow(2, attempt - 1); // exponential: 1s, 2s, 4s
      logger.warn(`[retry] ${label} failed on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`, {
        error: err.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { withRetry, sleep };
