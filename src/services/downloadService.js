'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');
const { withRetry } = require('../utils/retry');

/**
 * Downloads the JSONL file from the given URL and returns a readable stream.
 * Uses streaming — does NOT buffer the entire response body.
 */
async function getJsonlStream(url) {
  logger.info('[download] Starting JSONL download', { url });

  const response = await withRetry(
    async () => {
      const res = await axios.get(url, {
        responseType: 'stream',
        timeout: config.download.timeoutMs,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      if (res.status !== 200) {
        throw new Error(`Unexpected HTTP status: ${res.status}`);
      }

      return res;
    },
    config.airtable.maxRetries,
    1000,
    'JSONL download'
  );

  logger.info('[download] Stream ready. Beginning processing...');
  return response.data; // This is a Node.js Readable stream
}

module.exports = { getJsonlStream };
