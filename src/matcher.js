import Fuse from 'fuse.js';
import { buildSupplierProvisionText, calculateTotal, convertMatchedQuantity, parseSupplyOptions, resolveCustomerRequest, selectSupplyOption } from './calculator.js';

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Normalize common buyer wording to Athena catalog naming for better produce matches.
    .replace(/\bdry\s+onions?\b/g, ' white onion ')
    .replace(/\byellow\s+onions?\b/g, ' white onion ')
    .replace(/\bdry\s+onion\b/g, ' white onion ')
    .replace(/\byellow\s+onion\b/g, ' white onion ')
    .replace(/\bbanan\b/g, ' banana ')
    .replace(/\bbanana\s+half\s+ripe\b/g, ' banana ')
    .replace(/\btomato(?:es)?\s+half\s+ripe\b/g, ' tomato ')
    .replace(/\b(lemon|pear)\s+fresh\b/g, ' $1 ')
    .replace(/\beggs?\s+grade(?:\s*[a-d])?\b/g, ' egg ')
    .replace(/\bgrade\s*[a-d]\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\begg\s*plats?\b/g, ' aubergine ')
    .replace(/\begg[\s-]*plants?\b/g, ' aubergine ')
    .replace(/\btanger(?:ines?|ins?)\b/g, ' mandarin ')
    .replace(/\b(?:bok|bak|pak)\s*[- ]?cho(?:i|y)\b/g, ' pak choi ')
    .replace(/\bch(?:i|ic)nese\s*cabbages?\b/g, ' chinese leaf ')
    .replace(/\bch(?:i|ic)nese\s*leaves\b/g, ' chinese leaf ')
    .replace(/\bfillets\b/g, ' fillet ')
    .replace(/\bsides\b/g, ' side ')
    .replace(/\bsacks\b/g, ' bag ')
    .replace(/\blitres?\b/g, ' liter ')
    .replace(/\brolls\b/g, ' roll ')
    .replace(/\bcartons\b/g, ' carton ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanProductText(value) {
  return normalizeText(value)
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(token) {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (/(ches|shes|sses|xes|zes|oes)$/.test(token) && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenize(value) {
  const tokens = cleanProductText(value)
    .split(' ')
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length > 1);

  const meaningfulTokens = tokens.filter((token) => !QUALIFIER_TOKENS.has(token));
  return meaningfulTokens.length ? meaningfulTokens : tokens;
}

function tokenizeRaw(value) {
  return cleanProductText(value)
    .split(' ')
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length > 1);
}

function uniqueTokens(values) {
  return [...new Set(values.flatMap(tokenize))];
}

function uniqueRawTokens(values) {
  return [...new Set(values.flatMap(tokenizeRaw))];
}

const LOW_SIGNAL_TOKENS = new Set([
  'fresh',
  'frozen',
  'brown',
  'white',
  'red',
  'green',
  'yellow',
  'long',
  'small',
  'medium',
  'large',
  'milk',
  'tomato',
  'onion',
  'potato'
]);

const QUALIFIER_TOKENS = new Set([
  'table',
  'salad',
  'kitchen',
  'cooking',
  'local',
  'imported',
  'loose',
  'premium',
  'jumbo',
  'extra',
  'selected',
  'choice',
  'of',
  'for',
  'large',
  'medium',
  'small',
  'baby',
  'whole',
  'cut',
  'sliced',
  'diced',
  'chopped',
  'peeled',
  'trimmed',
  'washed',
  'cleaned',
  'ready',
  'prepared',
  'portion',
  'portioned',
  'ripe',
  'half',
  'grade',
  'halved',
  'quartered',
  'leaf',
  'leaves',
  'head',
  'heads',
  'bunch',
  'bunches',
  'stalk',
  'stalks',
  'tray',
  'trays',
  'box',
  'boxes',
  'carton',
  'cartons',
  'case',
  'cases',
  'pack',
  'packs',
  'packet',
  'packets'
]);

const PRODUCE_STYLE_TOKENS = new Set([
  'slice',
  'chopped',
  'diced',
  'sliced',
  'peeled',
  'trimmed',
  'washed',
  'prepared',
  'ready',
  'tinned',
  'canned',
  'tin',
  'can',
  'puree',
  'paste',
  'sauce',
  'juice',
  'ring',
  'rings',
  'chunk',
  'chunks',
  'cocktail',
  'halves',
  'halved',
  'jarred',
  'preserved'
]);

const PRODUCE_CONTEXT_SKIP_TOKENS = new Set([
  ...QUALIFIER_TOKENS,
  ...PRODUCE_STYLE_TOKENS,
  'fresh',
  'frozen',
  'brown',
  'white',
  'red',
  'green',
  'yellow',
  'long',
  'small',
  'medium',
  'large',
  'fruit',
  'fruits',
  'vegetable',
  'vegetables',
  'food',
  'foods'
]);

const FRUIT_INTENT_TOKENS = new Set([
  'apple', 'banana', 'orange', 'grape', 'melon', 'watermelon', 'pineapple', 'papaya', 'mango',
  'pear', 'peach', 'plum', 'kiwi', 'berry', 'strawberry', 'blueberry', 'raspberry', 'blackberry',
  'mandarin', 'tangerine', 'lemon', 'lime', 'avocado', 'cherry', 'apricot', 'fig', 'date', 'guava'
]);

const VEGETABLE_INTENT_TOKENS = new Set([
  'parsley', 'leek', 'spinach', 'eggplant', 'aubergine', 'onion', 'potato', 'carrot', 'cabbage',
  'lettuce', 'celery', 'pepper', 'chilli', 'chili', 'broccoli', 'cauliflower', 'zucchini', 'courgette',
  'cucumber', 'tomato', 'radish', 'beetroot', 'beet', 'ginger', 'garlic', 'pumpkin', 'okra', 'pak',
  'choi', 'choy', 'kale', 'asparagus', 'artichoke', 'turnip', 'parsnip', 'scallion', 'spring', 'shallot'
]);

const BAKERY_INTENT_TOKENS = new Set([
  'baguette', 'bread', 'loaf', 'french', 'long', 'roll', 'bun', 'bakery'
]);

function inferProduceIntentCategory(context) {
  let fruitHits = 0;
  let vegetableHits = 0;

  for (const token of context.matchTokens) {
    if (FRUIT_INTENT_TOKENS.has(token)) {
      fruitHits += 1;
    }
    if (VEGETABLE_INTENT_TOKENS.has(token)) {
      vegetableHits += 1;
    }
  }

  if (fruitHits === 0 && vegetableHits === 0) {
    return '';
  }

  return fruitHits >= vegetableHits ? 'fruit' : 'vegetable';
}

function inferBakeryIntent(context) {
  return context.matchTokens.some((token) => BAKERY_INTENT_TOKENS.has(token));
}

function countSharedTokens(leftTokens, rightTokens) {
  const rightTokenSet = new Set(rightTokens);
  let count = 0;

  for (const token of leftTokens) {
    if (rightTokenSet.has(token)) {
      count += 1;
    }
  }

  return count;
}

function hasAnyToken(tokens, tokenSet) {
  return tokens.some((token) => tokenSet.has(token));
}

function buildFreshProduceTokenSet(products) {
  return new Set(
    products
      .filter((product) => product.isFreshFoods)
      .flatMap((product) => product.nameTokens)
      .filter((token) => token.length > 2 && !PRODUCE_CONTEXT_SKIP_TOKENS.has(token))
  );
}

function buildMatchContext(item, freshProduceTokens) {
  const cleanedText = cleanProductText(item.originalItem);
  const matchTokens = uniqueTokens([cleanedText]);
  const rawTokens = uniqueRawTokens([item.originalItem]);
  const request = resolveCustomerRequest(item);
  const explicitProcessedRequest = hasAnyToken(rawTokens, PRODUCE_STYLE_TOKENS);
  const produceIntentTokens = matchTokens.filter((token) => freshProduceTokens.has(token));
  const produceIntentCategory = inferProduceIntentCategory({ matchTokens });
  const bakeryIntent = inferBakeryIntent({ matchTokens });

  return {
    cleanedText,
    matchTokens,
    rawTokens,
    request,
    explicitProcessedRequest,
    produceIntentTokens,
    produceIntentCategory,
    bakeryIntent,
    prefersFreshProduce: (produceIntentTokens.length > 0 || Boolean(produceIntentCategory)) && !explicitProcessedRequest
  };
}

function findBakerySemanticMatch(context, products) {
  if (!context.bakeryIntent) {
    return null;
  }

  const requestedBaguetteLike = /\b(baguette|french\s+bread|long\s+bread)\b/i.test(context.cleanedText);
  if (!requestedBaguetteLike) {
    return null;
  }

  let best = null;

  for (const product of products) {
    const name = String(product.productName || '').toLowerCase();
    const hasBaguette = /baguette/.test(name);
    const hasHalfBaked = /half\s*baked/.test(name);
    const bakeryCategory = product.isBakeryCategory === true;
    if (!hasBaguette && !bakeryCategory) {
      continue;
    }

    let score = 0;
    if (hasBaguette) {
      score += 20;
    }
    if (hasHalfBaked) {
      score += 10;
    }
    if (bakeryCategory) {
      score += 4;
    }

    if (!best || score > best.score) {
      best = {
        product,
        score,
        confidence: hasBaguette ? 'high' : 'medium',
        reason: 'semantic bakery match'
      };
    }
  }

  return best;
}

function findProduceCategoryFallbackMatch(context, products) {
  if (!context.produceIntentCategory) {
    return null;
  }

  const candidates = products.filter((product) => (
    context.produceIntentCategory === 'fruit'
      ? (product.isFreshFruitCategory || product.isFreshFoods)
      : (product.isFreshVegetableCategory || product.isFreshFoods)
  ));

  if (!candidates.length) {
    return null;
  }

  let best = null;

  for (const product of candidates) {
    const nameHits = countSharedTokens(context.matchTokens, product.nameTokens);
    const keywordHits = countSharedTokens(context.matchTokens, product.matchTokens);
    const unitFit = scoreUnitFit(context.request, product);
    const score = (nameHits * 8) + (keywordHits * 4) + unitFit;

    if (!best || score > best.score) {
      best = {
        product,
        score,
        confidence: nameHits > 0 ? 'medium' : 'low',
        reason: `category fallback match (${context.produceIntentCategory})`
      };
    }
  }

  return best;
}

function findClosestProductTypeFallback(context, products) {
  if (context.bakeryIntent) {
    const bakeryCandidates = products.filter((product) => product.isBakeryCategory);
    if (bakeryCandidates.length) {
      return {
        product: bakeryCandidates[0],
        score: 0,
        confidence: 'low',
        reason: 'closest product type fallback (bakery)'
      };
    }
  }

  if (context.produceIntentCategory) {
    return findProduceCategoryFallbackMatch(context, products);
  }

  return null;
}

function scoreProducePreference(context, product) {
  const sharedProduceTokens = getSharedTokens(context.produceIntentTokens, product.matchTokens);
  const requestedStyleTokens = context.rawTokens.filter((token) => PRODUCE_STYLE_TOKENS.has(token));
  const sharedStyleTokens = getSharedTokens(requestedStyleTokens, product.rawMatchTokens || []);

  if (!sharedProduceTokens.length) {
    return 0;
  }

  if (context.explicitProcessedRequest) {
    let score = product.hasProduceStyleQualifier ? 4 : -2;

    if (sharedStyleTokens.length) {
      score += 8 + sharedStyleTokens.length;
    }

    if (product.isFreshFoods) {
      score -= 3;
    }

    return score;
  }

  if (!context.prefersFreshProduce) {
    return 0;
  }

  let score = product.isFreshFoods ? 8 : -4;

  if (product.hasProduceStyleQualifier) {
    score -= 4;
  }

  return score;
}

function findAlternativeFreshProduceMatch(context, products) {
  if (!context.prefersFreshProduce) {
    return null;
  }

  let bestMatch = null;

  for (const product of products) {
    if (!product.isFreshFoods) {
      continue;
    }

    const sharedProduceTokens = getSharedTokens(context.produceIntentTokens, product.matchTokens);
    if (!sharedProduceTokens.length) {
      continue;
    }

    const unitFit = scoreUnitFit(context.request, product);
    const nameHits = countSharedTokens(context.matchTokens, product.nameTokens);

    if (!bestMatch
      || sharedProduceTokens.length > bestMatch.sharedProduceHits
      || (sharedProduceTokens.length === bestMatch.sharedProduceHits && unitFit > bestMatch.unitFit)
      || (sharedProduceTokens.length === bestMatch.sharedProduceHits && unitFit === bestMatch.unitFit && nameHits > bestMatch.nameHits)) {
      bestMatch = {
        product,
        score: sharedProduceTokens.length,
        sharedProduceHits: sharedProduceTokens.length,
        unitFit,
        nameHits,
        confidence: sharedProduceTokens.length >= 2 ? 'medium' : 'low',
        reason: 'fresh produce alternative match'
      };
    }
  }

  return bestMatch;
}

function getSharedTokens(leftTokens, rightTokens) {
  const rightTokenSet = new Set(rightTokens);
  return [...new Set(leftTokens.filter((token) => rightTokenSet.has(token)))];
}

const DEFAULT_FUZZY_THRESHOLD = 0.7;

function resolveFuzzyThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold)) {
    return DEFAULT_FUZZY_THRESHOLD;
  }

  return Math.min(0.95, Math.max(0.3, threshold));
}

function scoreKeywordMatch(context, product) {
  const sharedTokens = getSharedTokens(context.matchTokens, product.matchTokens);
  const keywordHits = sharedTokens.length;
  const nameHits = countSharedTokens(context.matchTokens, product.nameTokens);

  return {
    keywordHits,
    nameHits,
    sharedTokens,
    score: keywordHits
  };
}

function scoreUnitFit(request, product) {
  const selection = selectSupplyOption(request, product);
  return selection ? selection.score : -20;
}

function findKeywordMatch(context, products) {

  let bestMatch = null;

  for (const product of products) {
    const candidate = scoreKeywordMatch(context, product);
    const unitFit = scoreUnitFit(context.request, product);
    const producePreference = scoreProducePreference(context, product);
    const isProduceSingleHit = candidate.keywordHits === 1
      && candidate.sharedTokens.some((token) => context.produceIntentTokens.includes(token));
    const lowSignalSingleHit = candidate.keywordHits === 1
      && candidate.sharedTokens.every((token) => LOW_SIGNAL_TOKENS.has(token))
      && context.matchTokens.length > 1;
    const weakSingleKeywordMatch = candidate.keywordHits === 1
      && (context.matchTokens.length > 1 || candidate.sharedTokens.every((token) => LOW_SIGNAL_TOKENS.has(token)));

    if (candidate.keywordHits <= 0
      || ((lowSignalSingleHit || weakSingleKeywordMatch) && !isProduceSingleHit)) {
      continue;
    }

    if (!bestMatch
      || candidate.keywordHits > bestMatch.keywordHits
      || (candidate.keywordHits === bestMatch.keywordHits && producePreference > bestMatch.producePreference)
      || (candidate.keywordHits === bestMatch.keywordHits && producePreference === bestMatch.producePreference && unitFit > bestMatch.unitFit)
      || (candidate.keywordHits === bestMatch.keywordHits && producePreference === bestMatch.producePreference && unitFit === bestMatch.unitFit && candidate.nameHits > bestMatch.nameHits)) {
      bestMatch = {
        product,
        score: candidate.score,
        keywordHits: candidate.keywordHits,
        producePreference,
        unitFit,
        confidence: candidate.keywordHits >= 3 ? 'high' : candidate.keywordHits >= 2 ? 'medium' : 'low',
        reason: context.prefersFreshProduce && producePreference > 0
          ? 'keyword score match; preferred fresh produce alternative'
          : 'keyword score match'
      };
    }
  }

  return bestMatch;
}

function createFuzzyMatcher(products, fuzzyThreshold, freshProduceTokens) {
  const effectiveThreshold = resolveFuzzyThreshold(fuzzyThreshold);
  const fuse = new Fuse(
    products.map((product, index) => ({
      productIndex: index,
      cleanedName: product.cleanedName,
      cleanedKeywords: product.cleanedKeywords
    })),
    {
      includeScore: true,
      shouldSort: true,
      ignoreLocation: true,
      ignoreFieldNorm: true,
      minMatchCharLength: 2,
      threshold: Math.min(0.5, Math.max(0.1, 1 - effectiveThreshold + 0.05)),
      keys: [
        { name: 'cleanedName', weight: 0.7 },
        { name: 'cleanedKeywords', weight: 0.3 }
      ]
    }
  );

  return (item) => {
    const context = buildMatchContext(item, freshProduceTokens);
    if (!context.cleanedText) {
      return null;
    }

    const results = fuse.search(context.cleanedText, { limit: 8 });
    if (!results.length) {
      return null;
    }

    const ranked = results
      .map((result) => {
        const similarity = 1 - Number(result.score ?? 1);
        return {
          product: products[result.item.productIndex],
          similarity,
          unitFit: scoreUnitFit(context.request, products[result.item.productIndex]),
          producePreference: scoreProducePreference(context, products[result.item.productIndex])
        };
      })
      .filter((result) => result.similarity >= effectiveThreshold)
      .sort((left, right) => {
        if (right.producePreference !== left.producePreference) {
          return right.producePreference - left.producePreference;
        }

        if (right.unitFit !== left.unitFit) {
          return right.unitFit - left.unitFit;
        }

        return right.similarity - left.similarity;
      });

    if (!ranked.length) {
      return null;
    }

    const best = ranked[0];

    return {
      product: best.product,
      score: best.similarity,
      confidence: best.similarity >= 0.85 ? 'high' : 'medium',
      reason: context.prefersFreshProduce && best.producePreference > 0
        ? `fuzzy match ${best.similarity.toFixed(2)}; preferred fresh produce alternative`
        : `fuzzy match ${best.similarity.toFixed(2)}`
    };
  };
}


// Custom yogurt matching logic
function matchProduct(item, products, fuzzyMatcher, freshProduceTokens) {
  const context = buildMatchContext(item, freshProduceTokens);
  const itemText = context.cleanedText;
  const requestedQty = context.request.customerQuantity;
  const requestedUnitType = context.request.customerUnitType;

  // Special handling for yogurt
  const isYogurtRequest = /yogurt|yoghurt/.test(itemText);
  if (isYogurtRequest) {
    // If user asks for 'plain yogurt' or 'assorted yogurt', match by name
    let yogurtType = null;
    if (/plain/.test(itemText)) yogurtType = 'plain';
    if (/assorted/.test(itemText)) yogurtType = 'assorted';

    // Find all yogurt products
    const yogurtProducts = products.filter(p => /yogurt|yoghurt/i.test(p.productName));

    // If user asks for pcs, match to 125g x 20pcs packs
    if (requestedUnitType === 'pcs' && requestedQty) {
      // Find 125g x 20pcs packs
      let match = yogurtProducts.find(p => /125g\s*x\s*20pcs/i.test(p.unit));
      if (yogurtType) {
        match = yogurtProducts.find(p => /125g\s*x\s*20pcs/i.test(p.unit) && p.productName.toLowerCase().includes(yogurtType));
      }
      if (match) {
        return { product: match, score: 1, confidence: 'high', reason: 'yogurt pcs pack match' };
      }
    }

    // If user asks for a multiple of 20 pcs, match to 125g x 20pcs packs
    if (requestedUnitType === 'pcs' && requestedQty && requestedQty % 20 === 0) {
      let match = yogurtProducts.find(p => /125g\s*x\s*20pcs/i.test(p.unit));
      if (yogurtType) {
        match = yogurtProducts.find(p => /125g\s*x\s*20pcs/i.test(p.unit) && p.productName.toLowerCase().includes(yogurtType));
      }
      if (match) {
        return { product: match, score: 1, confidence: 'high', reason: 'yogurt pcs pack match' };
      }
    }

    // If user asks for kg, match to 5kg natural set yogurt (if present)
    if (requestedUnitType === 'kg' && requestedQty) {
      let match = yogurtProducts.find(p => /5kg/i.test(p.unit) && /natural set/i.test(p.productName));
      if (match) {
        return { product: match, score: 1, confidence: 'high', reason: 'yogurt 5kg match' };
      }
    }

    // If user asks for plain or assorted yogurt by name, match by name
    if (yogurtType) {
      let match = yogurtProducts.find(p => p.productName.toLowerCase().includes(yogurtType));
      if (match) {
        return { product: match, score: 1, confidence: 'high', reason: 'yogurt name match' };
      }
    }
  }

  // Fallback to default matching
  const bakerySemanticMatch = findBakerySemanticMatch(context, products);
  if (bakerySemanticMatch) {
    return bakerySemanticMatch;
  }

  const keywordMatch = findKeywordMatch(context, products);
  if (keywordMatch) {
    return keywordMatch;
  }

  const categoryFallbackMatch = findProduceCategoryFallbackMatch(context, products);
  if (categoryFallbackMatch) {
    return categoryFallbackMatch;
  }

  const fuzzyMatch = fuzzyMatcher ? fuzzyMatcher(item) : null;
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  const alternativeProduceMatch = findAlternativeFreshProduceMatch(context, products);
  if (alternativeProduceMatch) {
    return alternativeProduceMatch;
  }

  return findClosestProductTypeFallback(context, products);
}

function buildMatchedQuoteItem(item, product, matchMeta, priceOverride) {
  const quantityResult = convertMatchedQuantity(item, product);
  const effectivePrice = Number.isFinite(priceOverride) ? priceOverride : Number(product.price || 0);
  const status = quantityResult.reviewFlags.length ? 'REVIEW REQUIRED' : 'MATCHED';
  const matchReason = quantityResult.reviewFlags.length
    ? `${matchMeta.reason}; ${quantityResult.reviewFlags.join('; ')}`
    : matchMeta.reason;

  return {
    lineNumber: item.lineNumber,
    originalItem: item.originalItem,
    quantity: quantityResult.customerQuantity,
    requestedUnit: quantityResult.requestedUnit,
    customerUnitType: quantityResult.customerUnitType,
    matchedProductKey: product.catalogKey || '',
    matchedProduct: product.productName,
    matchedProductDisplay: product.displayName || product.productName,
    sourceRowNumber: product.sourceRowNumber,
    unitKgEquivalent: Number.isFinite(Number(product.unitKgEquivalent)) ? Number(product.unitKgEquivalent) : null,
    forceKgConversion: product.forceKgConversion === true,
    unit: quantityResult.unit,
    unitType: product.unitType,
    supplyQuantity: quantityResult.supplyQuantity,
    price: effectivePrice,
    total: calculateTotal(quantityResult.supplyQuantity, effectivePrice),
    status,
    confidence: matchMeta.confidence,
    matchReason,
    deliveredQuantity: quantityResult.deliveredQuantity,
    deliveredUnitType: quantityResult.deliveredUnitType,
    supplierProvision: buildSupplierProvisionText({
      matchedProduct: product.productName,
      supplyQuantity: quantityResult.supplyQuantity,
      unit: quantityResult.unit,
      deliveredQuantity: quantityResult.deliveredQuantity,
      deliveredUnitType: quantityResult.deliveredUnitType
    }),
    availableUnits: (Array.isArray(product.supplyOptions) ? product.supplyOptions : parseSupplyOptions(product.unit || '')).map((option) => option.label)
  };
}

function buildManualCheckItem(item, reason = 'no suitable product match found') {
  const resolvedRequest = resolveCustomerRequest(item);

  return {
    lineNumber: item.lineNumber,
    originalItem: item.originalItem,
    quantity: resolvedRequest.customerQuantity,
    requestedUnit: resolvedRequest.rawRequestedUnit,
    customerUnitType: resolvedRequest.customerUnitType,
    matchedProduct: '',
    matchedProductKey: '',
    matchedProductDisplay: '',
    unit: '',
    unitType: '',
    supplyQuantity: 1,
    deliveredQuantity: null,
    deliveredUnitType: '',
    price: 0,
    total: 0,
    status: 'MANUAL CHECK',
    confidence: 'none',
    matchReason: reason,
    supplierProvision: ''
  };
}

export function prepareCatalog(priceList) {
  return priceList.map((product) => ({
    ...product,
    normalizedCategory: normalizeText(product.category || ''),
    cleanedName: cleanProductText(product.productName),
    cleanedKeywords: cleanProductText(product.keywords || ''),
    rawMatchTokens: uniqueRawTokens([product.productName, product.keywords || '']),
    keywordTokens: uniqueTokens((product.keywords || '').split(',')),
    nameTokens: uniqueTokens([product.productName])
      .filter((token) => !/^\d+$/.test(token)),
    matchTokens: uniqueTokens([product.productName, product.keywords || ''])
      .filter((token) => !/^\d+$/.test(token)),
    isFreshFoods: /(^|\s)fresh\s*foods?(\s|$)/.test(normalizeText(product.category || '')),
    isFreshFruitCategory: /(^|\s)(fresh\s*fruit|fresh\s*fruits|fruit|fruits)(\s|$)/.test(normalizeText(product.category || '')),
    isFreshVegetableCategory: /(^|\s)(fresh\s*vegetable|fresh\s*vegetables|vegetable|vegetables)(\s|$)/.test(normalizeText(product.category || '')),
    isBakeryCategory: /(^|\s)(bakery|bread|breads)(\s|$)/.test(normalizeText(product.category || '')),
    hasProduceStyleQualifier: hasAnyToken(uniqueRawTokens([product.productName, product.keywords || '']), PRODUCE_STYLE_TOKENS),
    unitType: product.unitType || '',
    supplyOptions: Array.isArray(product.supplyOptions) && product.supplyOptions.length
      ? product.supplyOptions
      : parseSupplyOptions(product.unit || '')
  }));
}

export function createMatchingEngine(products, additionalStrategies = [], options = {}) {
  const extraMatchers = additionalStrategies;
  const freshProduceTokens = buildFreshProduceTokenSet(products);
  const fuzzyMatcher = createFuzzyMatcher(
    products,
    options.fuzzyThreshold ?? process.env.FUZZY_MATCH_THRESHOLD ?? DEFAULT_FUZZY_THRESHOLD,
    freshProduceTokens
  );

  return {
    matchItem(item) {
      const matchedProduct = matchProduct(item, products, fuzzyMatcher, freshProduceTokens);
      const fallbackProduct = matchedProduct || extraMatchers
        .map((matcher) => matcher(item, products))
        .find(Boolean);

      if (!fallbackProduct) {
        return buildManualCheckItem(item);
      }

      return buildMatchedQuoteItem(item, fallbackProduct.product, fallbackProduct);
    }
  };
}

export function applyManualSelection(item, catalog, selectedProductKey) {
  const selectedProduct = catalog.find((product) => product.catalogKey === selectedProductKey)
    || catalog.find((product) => product.productName === selectedProductKey);
  if (!selectedProduct) {
    return buildManualCheckItem(item, 'manual check pending');
  }

  return buildMatchedQuoteItem(item, selectedProduct, {
    confidence: 'manual',
    reason: 'manual selection'
  });
}

export function summarizeQuote(items) {
  const totals = items.reduce((summary, item) => {
    summary.lineCount += 1;
    summary.totalValue += Number(item.total || 0);

    if (item.status !== 'MATCHED' && item.status !== 'UNAVAILABLE') {
      summary.reviewRequired += 1;
    }

    return summary;
  }, { lineCount: 0, reviewRequired: 0, totalValue: 0 });

  return {
    ...totals,
    totalValue: Number(totals.totalValue.toFixed(2))
  };
}

export { calculateTotal };