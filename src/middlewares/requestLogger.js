'use strict';

const logger = require('../config/logger');

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`[http] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });

  next();
}

module.exports = { requestLogger };
