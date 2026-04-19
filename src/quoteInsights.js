import fs from 'node:fs/promises';
import path from 'node:path';
import { detectUnitType } from './calculator.js';

const quotesDirectory = path.resolve(process.cwd(), 'logs', 'quotes');

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRequestKey(item) {
  const normalizedItem = normalizeText(item?.originalItem || '');
  const requestedUnitType = String(item?.customerUnitType || detectUnitType(item?.requestedUnit || ''));

  if (!normalizedItem) {
    return '';
  }

  return `${normalizedItem}||${requestedUnitType}`;
}

function choosePreferredInsight(currentInsight, nextInsight) {
  if (!currentInsight) {
    return nextInsight;
  }

  const currentManualSignals = currentInsight.manualSignals || 0;
  const nextManualSignals = nextInsight.manualSignals || 0;

  if (nextManualSignals !== currentManualSignals) {
    return nextManualSignals > currentManualSignals ? nextInsight : currentInsight;
  }

  return new Date(nextInsight.updatedAt || 0) >= new Date(currentInsight.updatedAt || 0)
    ? nextInsight
    : currentInsight;
}

export async function loadQuoteInsights(catalog = []) {
  await fs.mkdir(quotesDirectory, { recursive: true });

  const files = await fs.readdir(quotesDirectory);
  const catalogKeys = new Set(catalog.map((product) => product.catalogKey || product.productName));
  const insightsByRequestKey = new Map();

  for (const fileName of files.filter((file) => file.endsWith('.json'))) {
    const quote = JSON.parse(await fs.readFile(path.join(quotesDirectory, fileName), 'utf8'));

    for (const item of quote.items || []) {
      const requestKey = buildRequestKey(item);
      const matchedProductKey = String(item?.matchedProductKey || item?.matchedProduct || '').trim();

      if (!requestKey || !matchedProductKey || item?.status === 'MANUAL CHECK' || item?.status === 'UNAVAILABLE') {
        continue;
      }

      if (catalogKeys.size && !catalogKeys.has(matchedProductKey)) {
        continue;
      }

      const quantity = Number(item.quantity);
      const supplyQuantity = Number(item.supplyQuantity);
      const quantityRatio = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(supplyQuantity) && supplyQuantity > 0
        ? supplyQuantity / quantity
        : null;
      const overrideReasonText = String(item.overrideReasonText || item.matchReason || '');
      const manualSignals = [
        item.supplierQuantityOverride ? 1 : 0,
        /manual selection/i.test(overrideReasonText) ? 1 : 0,
        /manual unit override/i.test(overrideReasonText) ? 1 : 0,
        /manual price override/i.test(overrideReasonText) ? 1 : 0,
        /manual supplier quantity/i.test(overrideReasonText) ? 1 : 0
      ].reduce((sum, value) => sum + value, 0);

      const nextInsight = {
        requestKey,
        sourceQuoteId: quote.id,
        updatedAt: quote.updatedAt,
        matchedProductKey,
        matchedProduct: item.matchedProduct || '',
        matchedProductDisplay: item.matchedProductDisplay || item.matchedProduct || '',
        requestedUnitType: item.customerUnitType || detectUnitType(item.requestedUnit || ''),
        learnedUnit: item.unit || '',
        learnedPrice: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
        learnedSupplyQuantity: Number.isFinite(supplyQuantity) && supplyQuantity > 0 ? supplyQuantity : null,
        quantityRatio,
        hasSupplierQuantityOverride: Boolean(item.supplierQuantityOverride),
        hasManualPriceOverride: /manual price override/i.test(overrideReasonText),
        hasManualUnitOverride: /manual unit override/i.test(overrideReasonText),
        manualSignals
      };

      const currentInsight = insightsByRequestKey.get(requestKey);
      insightsByRequestKey.set(requestKey, choosePreferredInsight(currentInsight, nextInsight));
    }
  }

  return {
    count: insightsByRequestKey.size,
    find(item) {
      const requestKey = buildRequestKey(item);
      return requestKey ? insightsByRequestKey.get(requestKey) || null : null;
    }
  };
}