'use strict';

/**
 * Normalizes a Shopify GID (e.g. "gid://shopify/Customer/5316736876646")
 * down to just its trailing numeric id ("5316736876646").
 *
 * Safe to call on values that are already numeric-only — they pass through
 * unchanged. This must be used consistently everywhere a Shopify id is
 * stored or compared, so dedup logic and Airtable-stored ids always match
 * regardless of which raw format the id originally came in as.
 */
function normalizeShopifyId(rawId) {
  if (!rawId) return '';
  const str = String(rawId);
  return str.includes('/') ? str.split('/').pop() : str;
}

module.exports = { normalizeShopifyId };
