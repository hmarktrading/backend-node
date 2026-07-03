'use strict';

const express = require('express');
const router = express.Router();
const { handleDailyPipeline } = require('../controllers/pipelineController');

// POST /api/pipeline/daily
// Triggered by Make.com daily scenario
router.post('/pipeline/daily', handleDailyPipeline);

module.exports = router;
