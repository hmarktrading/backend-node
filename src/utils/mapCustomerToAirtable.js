'use strict';

const config = require('../config');
const { normalizeShopifyId } = require('./shopifyId');

/**
 * Maps a Shopify JSONL customer to the client's Airtable schema.
 *
 * Shopify-filled columns:
 *   Shopify Customer ID
 *   Customer Name
 *   Phone
 *   Email
 *   Last Purchase Date
 *   Days Since Last Purchase
 *   Number Of Orders Placed
 *   Lifetime Value (Rs.)
 *   Products In The Customer's Latest Order
 *   Shopify Latest Customer Order Link
 *
 * Caller-filled columns — left empty on insert, filled by callers:
 *   Caller Name, Status, Called Date, Revenue (If Reactivated), Remarks
 */
function mapCustomerToAirtable(customer) {
  const firstName = (customer.firstName || '').trim();
  const lastName  = (customer.lastName  || '').trim();
  const fullName  = [firstName, lastName].filter(Boolean).join(' ');

  // Shopify returns customer.id as a full GID, e.g. "gid://shopify/Customer/5316736876646".
  // Extract just the trailing numeric id — used both as the stored ID and in the admin link.
  const numericId = normalizeShopifyId(customer.id);

  const shopifyLink = numericId
    ? `https://admin.shopify.com/store/${config.shopify.storeHandle}/customers/${numericId}`
    : '';

  // Last Purchase Date — YYYY-MM-DD
  const rawDate = customer.lastOrder?.createdAt || '';
  const lastPurchaseDate = rawDate ? rawDate.substring(0, 10) : '';

  // Days Since Last Purchase
  const daysSince = lastPurchaseDate
    ? Math.floor((Date.now() - new Date(lastPurchaseDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const lastOrderProducts = customer._lastOrderProductTitles || extractProductTitles(customer.lastOrder);
  const lifetimeValue = Number(customer.amountSpent?.amount) || 0;
  const numberOfOrders = Number(customer.numberOfOrders) || 0;

  return {
    'Shopify Customer ID':                     numericId,
    'Customer Name':                           fullName,
    'Phone':                                   customer.phone || '',
    'Email':                                   customer.email || '',
    'Last Purchase Date':                      lastPurchaseDate,
    'Days Since Last Purchase':                daysSince,
    'Number Of Orders Placed':                 numberOfOrders,
    'Lifetime Value (Rs.)':                    lifetimeValue,
    "Products In The Customer's Latest Order": lastOrderProducts,
    'Shopify Latest Customer Order Link':      shopifyLink,
    // Caller columns intentionally omitted — callers fill these manually:
    // Caller Name, Status, Called Date, Revenue (If Reactivated), Remarks
  };
}

function extractProductTitles(lastOrder) {
  if (!lastOrder) return '';
  const lineItems = lastOrder.lineItems;
  if (!lineItems) return '';

  let titles = [];
  if (Array.isArray(lineItems.edges)) {
    titles = lineItems.edges.map((e) => e?.node?.title).filter(Boolean);
  } else if (Array.isArray(lineItems)) {
    titles = lineItems.map((i) => i?.title || i?.name).filter(Boolean);
  } else if (Array.isArray(lineItems.nodes)) {
    titles = lineItems.nodes.map((n) => n?.title).filter(Boolean);
  }
  return titles.join(', ');
}

module.exports = { mapCustomerToAirtable };
