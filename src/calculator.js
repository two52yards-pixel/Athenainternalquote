function normalizeUnitText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectUnitType(value) {
  const normalized = normalizeUnitText(value);

  if (!normalized) {
    return '';
  }

  if (/^units?$/.test(normalized)) {
    return 'pack';
  }

  if (/(^|\s)(kg|kgs|kilo|kilos|kilogram|kilograms|g|gram|grams)(\s|$)/.test(normalized)) {
    return 'kg';
  }

  if (/(^|\s)(l|lt|ltr|liter|liters|litre|litres|ml)(\s|$)/.test(normalized)) {
    return 'liter';
  }

  if (/(^|\s)(pc|pcs|piece|pieces|ea|each|unit|units)(\s|$)/.test(normalized)) {
    return 'pcs';
  }

  if (/(^|\s)(pack|packs|packet|packets|pkt|pkts|carton|cartons|case|cases|box|boxes|tray|trays|bag|bags|bottle|bottles|roll|rolls|tin|tins|jar|jars|bunch|bunches|bch|bchs)(\s|$)/.test(normalized)) {
    return 'pack';
  }

  return '';
}

export function convertToBaseUnit(quantity, rawUnit) {
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity)) {
    return null;
  }

  const normalized = normalizeUnitText(rawUnit);
  const unitType = detectUnitType(normalized);

  if (unitType === 'kg') {
    if (/(^|\s)(g|gram|grams)(\s|$)/.test(normalized)) {
      return numericQuantity / 1000;
    }

    return numericQuantity;
  }

  if (unitType === 'liter') {
    if (/(^|\s)(ml)(\s|$)/.test(normalized)) {
      return numericQuantity / 1000;
    }

    return numericQuantity;
  }

  return numericQuantity;
}

function formatValue(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function formatQuantityForUnit(quantity, unitType) {
  if (!Number.isFinite(quantity)) {
    return '';
  }

  const formattedValue = formatValue(quantity);

  if (unitType === 'kg') {
    return `${formattedValue}kg`;
  }

  if (unitType === 'liter') {
    return `${formattedValue}L`;
  }

  if (unitType === 'pcs') {
    return `${formattedValue} pcs`;
  }

  if (unitType === 'pack') {
    return `${formattedValue} pack`;
  }

  return formattedValue;
}

export function buildSupplierProvisionText({
  matchedProduct,
  supplyQuantity,
  unit,
  deliveredQuantity,
  deliveredUnitType
}) {
  const productName = String(matchedProduct ?? '').trim();
  const supplierUnit = String(unit ?? '').trim();
  const numericSupplyQuantity = Number.isFinite(supplyQuantity) ? supplyQuantity : 1;
  const unitPart = supplierUnit ? `${numericSupplyQuantity} x ${supplierUnit}` : String(numericSupplyQuantity);
  const deliveredPart = deliveredUnitType && Number.isFinite(deliveredQuantity)
    ? `${formatQuantityForUnit(deliveredQuantity, deliveredUnitType)} total`
    : '';
  const productPart = productName ? ` ${productName}` : '';

  if (deliveredPart) {
    return `${unitPart}${productPart} (${deliveredPart})`;
  }

  return `${unitPart}${productPart}`.trim();
}

function buildCompactUnitLabel(quantity, rawUnit) {
  const normalizedUnit = String(rawUnit ?? '').trim().toLowerCase();

  if (!normalizedUnit || !Number.isFinite(quantity)) {
    return '';
  }

  return `${formatValue(quantity)}${normalizedUnit}`;
}

function cleanSupplyLabel(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/(\d)\s*[xX]\s*(\d)/g, '$1 x $2')
    .trim();
}

function createSupplyOption(label, quantity, unitType, descriptor = '') {
  return {
    label: cleanSupplyLabel(label),
    unitQuantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unitType: unitType || 'pack',
    orderUnitType: 'pack',
    descriptor: normalizeUnitText(descriptor),
    isFallback: false
  };
}

function splitSupplyOptionSegments(packaging) {
  return String(packaging ?? '')
    .split(/\s*\/\s*|\s+or\s+/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseSupplyOptionSegment(segment) {
  const rawSegment = String(segment ?? '').trim();
  if (!rawSegment) {
    return null;
  }

  if (/^\(?\s*units?\s*\)?$/i.test(rawSegment)) {
    return createSupplyOption('BOX', 1, 'pack', 'box');
  }

  const ofMatch = rawSegment.match(/(box|boxes|tray|trays|carton|cartons|case|cases|bag|bags|pack|packs|packet|packets|bottle|bottles|roll|rolls|tin|tins|jar|jars)\s*(?:of)?\s*(\d+(?:\.\d+)?)(?:\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units))?/i);
  if (ofMatch) {
    const descriptor = ofMatch[1];
    const rawUnit = ofMatch[3] || 'pcs';
    const converted = convertToBaseUnit(ofMatch[2], rawUnit);
    const unitType = detectUnitType(rawUnit) || 'pcs';

    if (converted !== null) {
      return createSupplyOption(rawSegment, converted, unitType, descriptor);
    }
  }

  const multiMatch = rawSegment.match(/(?:(\d+(?:\.\d+)?)\s*x\s*)?(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units)/i);
  if (multiMatch) {
    const outerCount = Number(multiMatch[1] || 1);
    const innerAmount = Number(multiMatch[2]);
    const rawUnit = multiMatch[3];
    const converted = convertToBaseUnit(outerCount * innerAmount, rawUnit);
    const unitType = detectUnitType(rawUnit);

    if (converted !== null && unitType) {
      const label = outerCount === 1
        ? buildCompactUnitLabel(innerAmount, rawUnit)
        : rawSegment;

      return createSupplyOption(label, converted, unitType);
    }
  }

  const singleMatch = rawSegment.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units)/i);
  if (singleMatch) {
    const converted = convertToBaseUnit(singleMatch[1], singleMatch[2]);
    const unitType = detectUnitType(singleMatch[2]);

    if (converted !== null && unitType) {
      return createSupplyOption(rawSegment, converted, unitType);
    }
  }

  const descriptorMatch = rawSegment.match(/\b(box|boxes|tray|trays|carton|cartons|case|cases|bag|bags|pack|packs|packet|packets|bottle|bottles|roll|rolls|tin|tins|jar|jars)\b/i);
  if (descriptorMatch) {
    return createSupplyOption(rawSegment, 1, 'pack', descriptorMatch[1]);
  }

  const inferredUnitType = detectUnitType(rawSegment);
  if (inferredUnitType) {
    return createSupplyOption(rawSegment, 1, inferredUnitType);
  }

  return {
    label: cleanSupplyLabel(rawSegment),
    unitQuantity: 1,
    unitType: 'pack',
    orderUnitType: 'pack',
    descriptor: '',
    isFallback: true
  };
}

export function parseSupplyOptions(packaging) {
  const rawPackaging = String(packaging ?? '').trim();
  const segments = splitSupplyOptionSegments(rawPackaging);
  const options = segments
    .map((segment) => parseSupplyOptionSegment(segment))
    .filter(Boolean);

  if (options.length) {
    return options;
  }

  return [{
    label: rawPackaging || '1 unit',
    unitQuantity: 1,
    unitType: detectUnitType(rawPackaging) || 'pack',
    orderUnitType: 'pack',
    descriptor: '',
    isFallback: true
  }];
}

export function extractQuantityFromText(text) {
  const structuredPackMatch = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*(tray|trays|box|boxes|carton|cartons|case|cases|pack|packs|packet|packets)\s*(?:of)?\s*(\d+(?:\.\d+)?)(?:\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units))?/i);
  if (structuredPackMatch) {
    const outerQuantity = Number(structuredPackMatch[1]);
    const innerAmount = Number(structuredPackMatch[3]);
    const rawUnit = structuredPackMatch[4] || 'pcs';
    const converted = convertToBaseUnit(outerQuantity * innerAmount, rawUnit);

    return {
      quantity: converted,
      unitType: detectUnitType(rawUnit) || 'pcs',
      rawUnit: `${structuredPackMatch[2]} of ${structuredPackMatch[3]} ${rawUnit}`.trim()
    };
  }

  const match = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|kilograms?|g|grams?|l|lt|ltr|liters?|litres?|ml|pcs?|pieces?|ea|each|units?|packs?|packets?|pkts?|cartons?|cases?|boxes?|trays?|bags?|bottles?|rolls?|tins?|jars?)/i);
  if (!match) {
    return { quantity: null, unitType: '', rawUnit: '' };
  }

  return {
    quantity: convertToBaseUnit(match[1], match[2]),
    unitType: detectUnitType(match[2]),
    rawUnit: match[2]
  };
}

function extractRequestedPackQuantity(quantity, rawRequestedUnit) {
  const match = String(rawRequestedUnit ?? '').match(/(tray|trays|box|boxes|carton|cartons|case|cases|pack|packs|packet|packets)\s*(?:of)?\s*(\d+(?:\.\d+)?)(?:\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units))?/i);
  if (!match || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const innerAmount = Number(match[2]);
  const rawUnit = match[3] || 'pcs';
  const converted = convertToBaseUnit(quantity * innerAmount, rawUnit);

  return {
    customerQuantity: converted,
    customerUnitType: detectUnitType(rawUnit) || 'pcs',
    rawRequestedUnit: String(rawRequestedUnit || '').trim(),
    quantitySource: 'column-packed'
  };
}

export function resolveCustomerRequest(item) {
  const textQuantity = extractQuantityFromText(item.originalItem);
  const rawRequestedUnit = String(item.requestedUnit || '').trim();
  const unitFromField = detectUnitType(rawRequestedUnit);
  const structuredPackQuantity = extractRequestedPackQuantity(item.quantity, rawRequestedUnit);
  const quantityFromField = Number.isFinite(item.quantity) && item.quantity > 0
    ? (unitFromField ? convertToBaseUnit(item.quantity, rawRequestedUnit) : Number(item.quantity))
    : null;

  if (structuredPackQuantity) {
    return structuredPackQuantity;
  }

  if (quantityFromField !== null) {
    return {
      customerQuantity: quantityFromField,
      customerUnitType: unitFromField,
      rawRequestedUnit: rawRequestedUnit || textQuantity.rawUnit,
      quantitySource: rawRequestedUnit ? 'column' : 'column-untyped'
    };
  }

  return {
    customerQuantity: textQuantity.quantity,
    customerUnitType: textQuantity.unitType,
    rawRequestedUnit: rawRequestedUnit || textQuantity.rawUnit,
    quantitySource: textQuantity.quantity !== null ? 'text' : 'missing'
  };
}

function unitWordFromRequest(rawRequestedUnit) {
  const normalized = normalizeUnitText(rawRequestedUnit);
  const descriptorMatch = normalized.match(/\b(box|boxes|tray|trays|carton|cartons|case|cases|bag|bags|pack|packs|packet|packets|bottle|bottles|roll|rolls|tin|tins|jar|jars)\b/);
  return descriptorMatch ? descriptorMatch[1].replace(/s$/, '') : '';
}

function isForceKgConversionProduct(product) {
  const unitKgEquivalent = Number(product?.unitKgEquivalent);
  if (!Number.isFinite(unitKgEquivalent) || unitKgEquivalent <= 0) {
    return false;
  }

  if (product?.forceKgConversion === true) {
    return true;
  }

  const sourceRowNumber = Number(product?.sourceRowNumber);
  return Number.isInteger(sourceRowNumber) && sourceRowNumber >= 521 && sourceRowNumber <= 615;
}

function withForcedKgRequest(request, product) {
  if (!isForceKgConversionProduct(product)) {
    return request;
  }

  return {
    ...request,
    customerUnitType: 'kg'
  };
}

function getApproximateUnitMatch(request, product, option) {
  const approxPieceWeightKg = Number(product?.approxPieceWeightKg);
  const unitKgEquivalent = Number(product?.unitKgEquivalent);

  if (request.customerUnitType === 'pcs' && option.unitType === 'kg' && Number.isFinite(approxPieceWeightKg) && approxPieceWeightKg > 0 && request.customerQuantity !== null) {
    return {
      exactUnitMatch: true,
      effectiveCustomerQuantity: request.customerQuantity * approxPieceWeightKg,
      deliveredUnitType: 'kg',
      unitQuantityForFulfillment: option.unitQuantity
    };
  }

  if (request.customerUnitType === 'kg' && option.unitType === 'pcs' && Number.isFinite(approxPieceWeightKg) && approxPieceWeightKg > 0 && request.customerQuantity !== null) {
    return {
      exactUnitMatch: true,
      effectiveCustomerQuantity: request.customerQuantity / approxPieceWeightKg,
      deliveredUnitType: 'pcs',
      unitQuantityForFulfillment: option.unitQuantity
    };
  }

  // If customer requests KG and product is sold in pack units, use remarks KG equivalent.
  if (request.customerUnitType === 'kg' && option.orderUnitType === 'pack' && request.customerQuantity !== null && Number.isFinite(unitKgEquivalent) && unitKgEquivalent > 0) {
    return {
      exactUnitMatch: true,
      effectiveCustomerQuantity: request.customerQuantity,
      deliveredUnitType: 'kg',
      unitQuantityForFulfillment: Math.max((Number(option.unitQuantity) || 1) * unitKgEquivalent, unitKgEquivalent)
    };
  }

  return null;
}

export function selectSupplyOption(request, product) {
  const effectiveRequest = withForcedKgRequest(request, product);
  const options = Array.isArray(product?.supplyOptions) && product.supplyOptions.length
    ? product.supplyOptions
    : parseSupplyOptions(product?.unit || '');
  const requestedDescriptor = unitWordFromRequest(effectiveRequest.rawRequestedUnit);
  const isEggProduct = /\begg\b/i.test(String(product?.productName || ''));

  let bestMatch = null;

  for (const option of options) {
    let score = option.isFallback ? -5 : 5;
    let exactUnitMatch = false;
    let effectiveCustomerQuantity = effectiveRequest.customerQuantity;
    let deliveredUnitType = option.unitType;
    let approximateUnitMatch = false;
    let unitQuantityForFulfillment = Number(option.unitQuantity) || 1;

    if (effectiveRequest.customerUnitType) {
      if (effectiveRequest.customerUnitType === option.unitType) {
        score += 100;
        exactUnitMatch = true;
      } else if (effectiveRequest.customerUnitType === 'pack' && option.orderUnitType === 'pack') {
        score += 85;
        exactUnitMatch = true;
      } else {
        const approximateMatch = getApproximateUnitMatch(effectiveRequest, product, option);
        if (approximateMatch) {
          score += 95;
          exactUnitMatch = true;
          approximateUnitMatch = true;
          effectiveCustomerQuantity = approximateMatch.effectiveCustomerQuantity;
          deliveredUnitType = approximateMatch.deliveredUnitType;
          unitQuantityForFulfillment = Number(approximateMatch.unitQuantityForFulfillment) || unitQuantityForFulfillment;
        } else {
          score -= 40;
        }
      }
    }

    if (requestedDescriptor) {
      if (option.descriptor === requestedDescriptor) {
        score += 35;
      } else if (effectiveRequest.customerUnitType === 'pack') {
        score -= 10;
      }
    }

    if (effectiveCustomerQuantity !== null && exactUnitMatch && unitQuantityForFulfillment > 0) {
      if (effectiveCustomerQuantity === unitQuantityForFulfillment) {
        score += 30;
      } else {
        const remainder = effectiveCustomerQuantity % unitQuantityForFulfillment;
        if (remainder === 0) {
          score += 12;
        }
      }

      const estimatedSupplyCount = Math.ceil(effectiveCustomerQuantity / unitQuantityForFulfillment);
      score -= estimatedSupplyCount * 0.01;

      if (estimatedSupplyCount > 500) {
        score -= 15;
      }

      if (isEggProduct && effectiveRequest.customerUnitType === 'pcs' && Number.isFinite(effectiveCustomerQuantity) && effectiveCustomerQuantity > 0 && unitQuantityForFulfillment > 0) {
        const eggRemainder = effectiveCustomerQuantity % unitQuantityForFulfillment;
        if (eggRemainder === 0) {
          // Exact fit: strongly favour this option; among exact options prefer larger packs (fewer boxes needed).
          score += 40;
          score += unitQuantityForFulfillment * 0.15;
        } else {
          // Not exact: penalise proportionally to how many extra pieces would be supplied.
          const eggOvershoot = unitQuantityForFulfillment - eggRemainder;
          score -= eggOvershoot * 0.5;
        }
      }
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { option, score, exactUnitMatch, effectiveCustomerQuantity, deliveredUnitType, approximateUnitMatch, unitQuantityForFulfillment };
    }
  }

  return bestMatch;
}

export function calculateTotal(quantity, price) {
  const numericQuantity = Number.isFinite(quantity) ? quantity : 0;
  const numericPrice = Number.isFinite(price) ? price : 0;
  return Number((numericQuantity * numericPrice).toFixed(2));
}

export function convertMatchedQuantity(item, product) {
  const resolvedRequest = withForcedKgRequest(resolveCustomerRequest(item), product);
  const forcedKgMode = isForceKgConversionProduct(product);
  const reviewFlags = [];
  const selectedOption = selectSupplyOption(resolvedRequest, product);

  if (!selectedOption) {
    reviewFlags.push('supplier unit missing; defaulted to 1 unit');
    return {
      customerQuantity: null,
      customerUnitType: resolvedRequest.customerUnitType,
      requestedUnit: resolvedRequest.rawRequestedUnit,
      unit: String(product?.unit || '').trim(),
      supplyQuantity: 1,
      deliveredQuantity: null,
      deliveredUnitType: '',
      reviewFlags
    };
  }

  if (resolvedRequest.customerQuantity === null) {
    reviewFlags.push('quantity missing; defaulted to 1 supplier unit');
    return {
      customerQuantity: null,
      customerUnitType: resolvedRequest.customerUnitType,
      requestedUnit: resolvedRequest.rawRequestedUnit,
      unit: selectedOption.option.label,
      supplyQuantity: 1,
      deliveredQuantity: null,
      deliveredUnitType: selectedOption.option.unitType,
      reviewFlags
    };
  }

  if (!resolvedRequest.customerUnitType) {
    reviewFlags.push('unit missing; used default supplier unit');
  }

  if (resolvedRequest.customerUnitType && !selectedOption.exactUnitMatch) {
    reviewFlags.push(`unit mismatch (${resolvedRequest.customerUnitType} vs ${selectedOption.option.unitType})`);
  }

  const effectiveCustomerQuantity = Number.isFinite(selectedOption.effectiveCustomerQuantity)
    ? selectedOption.effectiveCustomerQuantity
    : resolvedRequest.customerQuantity;
  const unitQuantityForFulfillment = Number.isFinite(selectedOption.unitQuantityForFulfillment)
    ? selectedOption.unitQuantityForFulfillment
    : selectedOption.option.unitQuantity;

  const supplyQuantity = selectedOption.exactUnitMatch
    ? (resolvedRequest.customerUnitType === 'pack' && !forcedKgMode
      ? Math.max(1, Math.ceil(resolvedRequest.customerQuantity))
      : (unitQuantityForFulfillment > 0 && Number.isFinite(effectiveCustomerQuantity)
        ? Math.max(1, Math.ceil(effectiveCustomerQuantity / unitQuantityForFulfillment))
        : 1))
    : 1;
  const deliveredQuantity = selectedOption.exactUnitMatch
    ? (resolvedRequest.customerUnitType === 'pack' && !forcedKgMode
      ? supplyQuantity
      : supplyQuantity * unitQuantityForFulfillment)
    : null;

  return {
    customerQuantity: resolvedRequest.customerQuantity,
    customerUnitType: resolvedRequest.customerUnitType,
    requestedUnit: resolvedRequest.rawRequestedUnit,
    unit: selectedOption.option.label,
    supplyQuantity,
    deliveredQuantity,
    deliveredUnitType: selectedOption.exactUnitMatch ? selectedOption.deliveredUnitType || selectedOption.option.unitType : '',
    reviewFlags
  };
}