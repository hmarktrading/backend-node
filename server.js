'use strict';

const express = require('express');
const config = require('./src/config');
const logger = require('./src/config/logger');
const { requestLogger } = require('./src/middlewares/requestLogger');
const { errorHandler } = require('./src/middlewares/errorHandler');

const syncRoutes     = require('./src/routes/sync');
const pipelineRoutes = require('./src/routes/pipeline');
const healthRoutes   = require('./src/routes/health');

const app = express();

// ── Global Middlewares ────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', syncRoutes);      // POST /api/shopify-sync  (original bulk sync)
app.use('/api', pipelineRoutes);  // POST /api/pipeline/daily (new daily pipeline)
app.use('/', healthRoutes);       // GET  /health

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(config.server.port, () => {
  logger.info('[server] shopify-reactivation-service running', {
    port: config.server.port,
    env: config.server.nodeEnv,
    routes: [
      'POST /api/shopify-sync',
      'POST /api/pipeline/daily',
      'GET  /health',
    ],
  });
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('[server] SIGTERM — shutting down gracefully...');
  server.close(() => { logger.info('[server] Closed.'); process.exit(0); });
});
process.on('SIGINT', () => {
  logger.info('[server] SIGINT — shutting down gracefully...');
  server.close(() => { logger.info('[server] Closed.'); process.exit(0); });
});
process.on('uncaughtException', (err) => {
  logger.error('[server] Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('[server] Unhandled rejection', { reason: String(reason) });
});

module.exports = app;
