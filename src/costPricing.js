// =====================
// INTERNAL COST PRICING — ADMIN ONLY
// Cost price sits on the master price list next to sale price. It must never
// reach a client, so it is stripped from anything client-facing and is only
// ever resolved here, server-side, for the admin panel.
//
// Total cost = cost price x supplier quantity, per line, summed. This is
// deliberately independent of the sale-price markup, so markup changes never
// move the cost figure.
// =====================

export function buildCostPriceIndex(catalog = []) {
  const byKey = new Map();
  const byName = new Map();

  for (const product of catalog) {
    const cost = Number(product?.costPrice);
    if (!Number.isFinite(cost) || cost <= 0) {
      continue;
    }

    const key = String(product.catalogKey || '').trim().toUpperCase();
    if (key && !byKey.has(key)) {
      byKey.set(key, cost);
    }

    const name = String(product.productName || '').trim().toUpperCase();
    if (name && !byName.has(name)) {
      byName.set(name, cost);
    }
  }

  return { byKey, byName };
}

// Live lookup against the current master list — works for quotes saved before
// cost tracking existed, since quote lines already store the matched item code.
export function lookupCostPrice(index, line) {
  const key = String(line?.matchedProductKey || '').trim().toUpperCase();
  if (key && index.byKey.has(key)) {
    return index.byKey.get(key);
  }

  const name = String(line?.matchedProduct || '').trim().toUpperCase();
  if (name && index.byName.has(name)) {
    return index.byName.get(name);
  }

  return null;
}

function isUnavailableLine(line) {
  return line?.available === false
    || line?.isUnavailable === true
    || line?.status === 'UNAVAILABLE';
}

export function buildQuoteCostSummary(index, costLines, saleTotalValue) {
  const lines = Array.isArray(costLines) ? costLines : [];
  let totalCostValue = 0;
  let linesCosted = 0;
  let linesMissingCost = 0;
  let linesUnmatched = 0;

  for (const line of lines) {
    if (isUnavailableLine(line)) {
      continue;
    }

    const supplyQuantity = Number(line?.supplyQuantity);
    if (!Number.isFinite(supplyQuantity) || supplyQuantity <= 0) {
      continue;
    }

    // Pending-review lines have no product and no sale value, so they cannot
    // understate cost — counted separately rather than flagged as missing cost.
    const hasProduct = Boolean(String(line?.matchedProductKey || '').trim() || String(line?.matchedProduct || '').trim());
    if (!hasProduct) {
      linesUnmatched += 1;
      continue;
    }

    const costPrice = lookupCostPrice(index, line);
    if (costPrice === null) {
      linesMissingCost += 1;
      continue;
    }

    totalCostValue += costPrice * supplyQuantity;
    linesCosted += 1;
  }

  const totalCost = Number(totalCostValue.toFixed(2));
  const saleTotal = Number(saleTotalValue) || 0;
  const grossProfit = Number((saleTotal - totalCost).toFixed(2));

  return {
    totalCostValue: totalCost,
    grossProfit,
    marginPercent: saleTotal > 0 ? Number(((grossProfit / saleTotal) * 100).toFixed(1)) : null,
    linesCosted,
    linesMissingCost,
    linesUnmatched,
    // Partial quotes still show a figure, flagged so admins know it understates cost.
    isComplete: linesMissingCost === 0 && linesCosted > 0
  };
}
