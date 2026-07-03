'use strict';

const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error('[middleware] Unhandled error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
  });
}

module.exports = { errorHandler };
