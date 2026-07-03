'use strict';

const config = require('../config');

/**
 * Returns true if customer passes ALL filter conditions.
 * Safely handles missing/null fields — never throws.
 *
 * @param {object} customer       - Shopify customer object from JSONL
 * @param {object} [filters]      - Optional runtime filter overrides
 *   filters.minOrders        (number)
 *   filters.minAmountSpent   (number)
 *   filters.lastOrderDaysAgo (number)
 *
 * Conditions:
 *  1. numberOfOrders >= minOrders
 *  2. amountSpent.amount >= minAmountSpent
 *  3. lastOrder.createdAt older than lastOrderDaysAgo days
 */
function passesFilters(customer, filters = {}) {
  try {
    const minOrders        = filters.minOrders        ?? config.filters.minOrders;
    const minAmountSpent   = filters.minAmountSpent   ?? config.filters.minAmountSpent;
    const lastOrderDaysAgo = filters.lastOrderDaysAgo ?? config.filters.lastOrderDaysAgo;

    // Condition 1: numberOfOrders
    const orders = Number(customer?.numberOfOrders);
    if (!Number.isFinite(orders) || orders < minOrders) return false;

    // Condition 2: amountSpent.amount
    const amount = Number(customer?.amountSpent?.amount);
    if (!Number.isFinite(amount) || amount < minAmountSpent) return false;

    // Condition 3: lastOrder.createdAt older than N days
    const lastOrderDate = customer?.lastOrder?.createdAt;
    if (!lastOrderDate) return false;

    const lastOrderTime = new Date(lastOrderDate).getTime();
    if (isNaN(lastOrderTime)) return false;

    const cutoff = Date.now() - lastOrderDaysAgo * 24 * 60 * 60 * 1000;
    if (lastOrderTime >= cutoff) return false; // NOT older than N days

    return true;
  } catch {
    return false;
  }
}

module.exports = { passesFilters };
