'use strict';

const express = require('express');
const router = express.Router();
const { handleShopifySync } = require('../controllers/syncController');

router.post('/shopify-sync', handleShopifySync);

module.exports = router;
