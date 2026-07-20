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
    .replace(/\bcheery\b/g, ' cherry ')
    .replace(/\bchery\b/g, ' cherry ')
    .replace(/\btomatos\b/g, ' tomato ')
    .replace(/\bcherry\s+tomatoes?\b/g, ' cherry tomato ')
    .replace(/\bfillets\b/g, ' fillet ')
    .replace(/\bsides\b/g, ' side ')
    .replace(/\bsacks\b/g, ' bag ')
    .replace(/\blitres?\b/g, ' liter ')
    .replace(/\brolls\b/g, ' roll ')
    .replace(/\bcartons\b/g, ' carton ')
    // Produce name normalisations — ensure consistent text before matching
    .replace(/\bwatermelons?\b/g, ' water melon ')
    .replace(/\bhoneydew\b/g, ' honeydew melon ')
    .replace(/\bhoney\s+melon[s]?\b/g, ' honeydew melon ')
    .replace(/\bsweet\s+melon[s]?\b/g, ' honeydew melon ')
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

// =====================
// FORCED CATALOG OVERRIDES
// Maps normalised request text to a specific catalog key.
// Rules are evaluated in order; first match wins.
// =====================
const FORCED_CATALOG_OVERRIDES = [
  // --- Soft drinks ---
  // Diet cola / coke (most specific first)
  { test: (n) => /\bdiet\b/.test(n) && /\b(?:coca\s*cola|coke|cola)\b/.test(n), key: 'ATH-DRK008' },
  // Bottled cola / coke
  { test: (n) => /\b(?:coca\s*cola|coke|cola)\b/.test(n) && /\b(?:btl|bottle)\b/.test(n), key: 'ATH-DRK005' },
  // Canned cola / coke (default — no bottle, no diet)
  { test: (n) => /\b(?:coca\s*cola|coke|cola)\b/.test(n), exclude: /\b(?:btl|bottle|diet)\b/, key: 'ATH-DRK007' },
  // Fanta lemon can
  { test: (n) => /\bfanta\b/.test(n) && /\blemon\b/.test(n), exclude: /\b(?:btl|bottle)\b/, key: 'ATH-DRK011' },
  // Fanta orange can (default — not bottled, not lemon)
  { test: (n) => /\bfanta\b/.test(n), exclude: /\b(?:btl|bottle|lemon)\b/, key: 'ATH-DRK012' },
  // Sprite bottled
  { test: (n) => /\bsprite\b/.test(n) && /\b(?:btl|bottle)\b/.test(n), key: 'ATH-DRK013' },
  // Sprite can (default)
  { test: (n) => /\bsprite\b/.test(n), exclude: /\b(?:btl|bottle)\b/, key: 'ATH-DRK014' },
  // --- Fresh vegetables ---
  // Aubergine / eggplant → EGGPLANT 12XBOX (not roasted)
  { test: (n) => /\b(?:aubergine|eggplant)[s]?\b/.test(n), exclude: /\broasted\b/, key: 'ATH-FVG027' },
  // Cauliflower → CAULIFLOWER 8XBOX (not frozen)
  { test: (n) => /\bcauliflower[s]?\b/.test(n), exclude: /\bfrozen\b/, key: 'ATH-FVG017' },
  // Spring / green / fresh onion → SPRING ONIONS 12XBOX
  { test: (n) => /\b(?:spring\s+onion|green\s+onion|fresh\s+onion)[s]?\b/.test(n), key: 'ATH-FVG058' },
  // Fresh tomato → TOMATOES 6KG (exclude cherry and all processed/canned forms)
  {
    test: (n) => /\btomato(?:es)?\b/.test(n),
    exclude: /\b(?:cherry|paste|puree|juice|ketchup|soup|canned|tinned|chopped|peeled|pilchard|sardine|mackerel|sauce)\b/,
    key: 'ATH-FVG062'
  },
  // --- Fresh fruit ---
  // Yellow pear → PEARS YELLOW 12XBOX (most specific, before the green-pear default)
  { test: (n) => /\byellow\b/.test(n) && /\bpear[s]?\b/.test(n), key: 'ATH-FFR019' },
  // Pear → PEARS GREEN 70XBOX (not yellow / syrup / canned)
  { test: (n) => /\bpear[s]?\b/.test(n), exclude: /\b(?:yellow|syrup|canned|tinned|juice)\b/, key: 'ATH-FFR018' },
  // Fresh pineapple → PINEAPPLE 8XBOX (not juice / frozen / canned / sliced)
  {
    test: (n) => /\bpineapple[s]?\b/.test(n),
    exclude: /\b(?:juice|frozen|chunk|slice|canned|tinned)\b/,
    key: 'ATH-FFR020'
  },
  // Watermelon → WATER MELON 5XBOX (note: normalizeText converts 'watermelon' → 'water melon')
  { test: (n) => /\bwater\s*melon[s]?\b/.test(n), key: 'ATH-FFR023' },
  // Honeydew / sweet melon / melon → HONEYDEW MELON 7XBOX (not watermelon / cantaloupe)
  {
    test: (n) => /\b(?:honeydew\s+melon|honeydew|honey\s+melon|sweet\s+melon|melon)[s]?\b/.test(n),
    exclude: /\b(?:water|cantaloupe)\b/,
    key: 'ATH-FFR011'
  }
];

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

function getAnchorTokens(tokens) {
  return tokens.filter((token) => (
    token.length > 2
    && !LOW_SIGNAL_TOKENS.has(token)
    && !QUALIFIER_TOKENS.has(token)
  ));
}

function hasAnchorCompatibility(context, product) {
  const requestAnchors = getAnchorTokens(context.matchTokens);
  if (!requestAnchors.length) {
    return true;
  }

  const candidateTokens = new Set([
    ...(Array.isArray(product.nameTokens) ? product.nameTokens : []),
    ...(Array.isArray(product.matchTokens) ? product.matchTokens : [])
  ]);

  return requestAnchors.some((token) => candidateTokens.has(token));
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

function findProductByRule(products, includePatterns = [], excludePatterns = [], preferredPatterns = []) {
  const rows = products.map((product) => ({
    product,
    normalizedName: normalizeText(product.productName || '')
  }));

  const candidates = rows.filter(({ normalizedName }) => (
    includePatterns.every((pattern) => pattern.test(normalizedName))
      && excludePatterns.every((pattern) => !pattern.test(normalizedName))
  ));

  if (!candidates.length) {
    return null;
  }

  if (preferredPatterns.length) {
    const preferred = candidates.find(({ normalizedName }) => preferredPatterns.every((pattern) => pattern.test(normalizedName)));
    if (preferred) {
      return preferred.product;
    }
  }

  return candidates[0].product;
}

function tryBusinessRuleMatch(context, products) {
  const normalizedRequest = normalizeText(context?.originalItem || '');
  const rawRequest = String(context?.originalItem || '').toLowerCase();
  const customerUnitType = context?.request?.customerUnitType || '';

  const hasToken = (pattern) => pattern.test(normalizedRequest);

  // Tomatoes (half ripe and similar) -> tomatoes 6kg
  const hasHalfRipeTomatoPhrase = /tomato(?:es)?\s*\(?\s*half\s*ripe\s*\)?|half\s*ripe\s*tomato(?:es)?/i.test(rawRequest);
  if (hasToken(/\btomato(?:es)?\b/) && (hasToken(/\bhalf\b/) || hasToken(/\bripe\b/) || hasHalfRipeTomatoPhrase)) {
    const product = findProductByRule(products, [/\btomato(?:es)?\b/], [/\bpaste\b|\bcanned\b|\btin\b|\bcocktail\b/], [/\b6\s*kg\b|\b6kg\b/]);
    if (product) {
      return { product, score: 1, confidence: 'high', reason: 'business rule: half ripe tomato -> tomato 6kg' };
    }
  }

  // Canned soft drinks
  if (hasToken(/\b(can|canned|cans)\b/)) {
    if (hasToken(/\b(coke|coca\s*cola)\b/)) {
      const product = findProductByRule(products, [/\bcoca\b/, /\bcola\b/, /\b(can|cans)\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: canned coke -> coca cola cans' };
    }
    if (hasToken(/\bfanta\b/)) {
      const product = findProductByRule(products, [/\bfanta\b/, /\b(can|cans)\b/], [], [/\borange\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: canned fanta -> fanta orange cans' };
    }
    if (hasToken(/\bsprite\b/)) {
      const product = findProductByRule(products, [/\bsprite\b/, /\b(can|cans)\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: canned sprite -> sprite cans' };
    }
  }

  // Bottled soft drinks
  if (hasToken(/\b(btl|bottle|bottles)\b/)) {
    if (hasToken(/\b(coke|coca\s*cola)\b/)) {
      const product = findProductByRule(products, [/\bcoca\b|\bcoke\b/, /\b(btl|bottle|bottles)\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: coke bottle -> coca cola btl' };
    }
    if (hasToken(/\bfanta\b/)) {
      const product = findProductByRule(products, [/\bfanta\b/, /\b(btl|bottle|bottles)\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: fanta bottle -> fanta btl' };
    }
    if (hasToken(/\bsprite\b/)) {
      const product = findProductByRule(products, [/\bsprite\b/, /\b(btl|bottle|bottles)\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: sprite bottle -> sprite btl' };
    }
  }

  // Garlic priority
  if (hasToken(/\bgarlic\b/)) {
    if (hasToken(/\bpowder\b/)) {
      const product = findProductByRule(products, [/\bgarlic\b/, /\bpowder\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: garlic powder' };
    }

    const product = findProductByRule(products, [/\bgarlic\b/], [/\bpowder\b/], [/\b50\s*x\s*bulb\b|\b50xbulb\b/]);
    if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: garlic default -> 50xbulb' };
  }

  // Watermelon and melon routing
  if (hasToken(/\bwater\s*melon\b|\bwatermelon\b/)) {
    const product = findProductByRule(products, [/\bwater\s*melon\b|\bwatermelon\b/]);
    if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: watermelon' };
  }

  if (hasToken(/\bmelon\b/) && !hasToken(/\bwater\s*melon\b|\bwatermelon\b/)) {
    if (hasToken(/\bhoney\b|\bdew\b|\bhoney\s*dew\b|\bhoneydew\b|\bsweet\b/) || /^\s*melon\s*$/i.test(normalizedRequest)) {
      const product = findProductByRule(products, [/\bmelon\b/], [/\bwater\s*melon\b|\bwatermelon\b/], [/\bhoney\s*dew\b|\bhoneydew\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: melon default -> honey dew melon' };
    }
  }

  // Pineapple — only match to fresh PINEAPPLE 8XBOX; leave juice/frozen/canned to normal matching
  if (hasToken(/\bpine\s*apple\b|\bpineapple\b/) && !hasToken(/\bjuice\b|\bfrozen\b|\bcanned\b|\btinned\b|\bchunk\b|\bslice\b/)) {
    const product = findProductByRule(products, [/\bpine\s*apple\b|\bpineapple\b/], [], [/\b8\s*x\s*box\b|\b8xbox\b/]);
    if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: pineapple -> 8xbox' };
  }

  // Pears -> avoid canned halves
  if (hasToken(/\bpear\b|\bpears\b/)) {
    const product = findProductByRule(
      products,
      [/\bpeas\b|\bpear\b/],
      [/\bhalves\b|\bhalf\b|\bcanned\b|\bcocktail\b/],
      [/\bpeas\s*green\b|\bgreen\s*peas\b|\bgreen\b/]
    );
    if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: pears -> fresh green pears' };
  }

  // Strawberries default to 135g unless specifically requested
  if (hasToken(/\bstrawberry\b|\bstrawberries\b/)) {
    const hasSpecificPack = hasToken(/\b\d+(?:\.\d+)?\s*(kg|g|gram|grams|box|boxes|tray|trays|pack|packs|pkt|btl|bottle|bottles|pcs|pc)\b/);
    if (!hasSpecificPack) {
      const product = products.find((candidate) => {
        const name = normalizeText(candidate.productName || '');
        return /\bstrawberry\b/.test(name) && /\b135\s*g\b|\b135g\b/.test(name);
      });
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: strawberries default' };
      return null;
    }
  }

  // Long-life milk / UHT milk
  if (hasToken(/\bmilk\b/) && hasToken(/\bll\b|\blong\s*life\b|\buht\b/)) {
    const product = findProductByRule(products, [/\bmilk\b/, /\buht\b|\blong\s*life\b/]);
    if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: long-life milk -> uht milk' };
  }

  // Pomegranate molasses -> pomegranate salad dressing
  if (hasToken(/\bpomegranate\b/) && hasToken(/\bmolasses\b/)) {
    const product = findProductByRule(products, [/\bpomegranate\b/, /\bsalad\b/, /\bdressing\b/]);
    if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: pomegranate molasses -> salad dressing' };
  }

  // Cream cheese split by request unit
  if (hasToken(/\bcream\s*cheese\b/)) {
    if (customerUnitType === 'pcs') {
      const product = findProductByRule(products, [/\bphiladelphia\b/, /\bcheese\b/], [], [/\b165\s*g\b|\b165g\b/, /\bpcs\b|\bpc\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: cream cheese pcs -> philadelphia 165g pcs' };
    }

    if (customerUnitType === 'kg') {
      const product = findProductByRule(products, [/\bsoft\b/, /\bcream\s*cheese\b/], [], [/\b1\.65\s*kg\b|\b1\.65kg\b/]);
      if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: cream cheese kg -> soft cream cheese 1.65kg' };
    }
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
      const hasStrongSingleToken = candidate.keywordHits === 1
        && candidate.nameHits > 0
        && candidate.sharedTokens.some((token) => !LOW_SIGNAL_TOKENS.has(token));
      const confidence = candidate.keywordHits >= 3
        ? 'high'
        : (candidate.keywordHits >= 2 || hasStrongSingleToken ? 'medium' : 'low');

      bestMatch = {
        product,
        score: candidate.score,
        keywordHits: candidate.keywordHits,
        producePreference,
        unitFit,
        confidence,
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
        const product = products[result.item.productIndex];
        return {
          product,
          similarity,
          unitFit: scoreUnitFit(context.request, product),
          producePreference: scoreProducePreference(context, product),
          anchorCompatible: hasAnchorCompatibility(context, product)
        };
      })
      .filter((result) => result.similarity >= effectiveThreshold && result.anchorCompatible)
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
function matchProduct(item, products, fuzzyMatcher, freshProduceTokens, matcherOptions = {}) {
  const context = buildMatchContext(item, freshProduceTokens);
  context.originalItem = item.originalItem;
  const itemText = context.cleanedText;
  const requestedQty = context.request.customerQuantity;
  const requestedUnitType = context.request.customerUnitType;
  const normalizedRequest = normalizeText(item.originalItem || '');

  // Forced catalog overrides — highest priority, evaluated before all other matching logic.
  for (const override of FORCED_CATALOG_OVERRIDES) {
    if (override.test(normalizedRequest) && (!override.exclude || !override.exclude.test(normalizedRequest))) {
      const forcedProduct = products.find((p) => p.catalogKey === override.key);
      if (forcedProduct) {
        return { product: forcedProduct, score: 1, confidence: 'high', reason: `forced match: ${override.key}` };
      }
    }
  }

  // Business constraint: strawberries should default to 135g SKU only.
  // If the catalog does not contain that SKU, do not auto-match to milk/syrup/jam variants.
  if (/\bstrawberry\b|\bstrawberries\b/.test(normalizedRequest)) {
    const strawberry135 = products.find((product) => {
      const name = normalizeText(product.productName || '');
      return /\bstrawberry\b/.test(name) && /\b135\s*g\b|\b135g\b/.test(name);
    });
    if (!strawberry135) {
      return null;
    }
  }

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

  if (matcherOptions.enableBusinessRules !== false) {
    const businessRuleMatch = tryBusinessRuleMatch(context, products);
    if (businessRuleMatch) {
      return businessRuleMatch;
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

  const fuzzyMatch = fuzzyMatcher ? fuzzyMatcher(item) : null;
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  return null;
}

function buildMatchedQuoteItem(item, product, matchMeta, priceOverride) {
  const quantityResult = convertMatchedQuantity(item, product);
  const effectivePrice = Number.isFinite(priceOverride) ? priceOverride : Number(product.price || 0);
  const isBusinessRuleMatch = String(matchMeta?.reason || '').startsWith('business rule:');
  const reviewFlags = isBusinessRuleMatch
    ? quantityResult.reviewFlags.filter((flag) => {
      const normalizedFlag = String(flag || '').toLowerCase();
      return !(
        normalizedFlag.startsWith('unit missing')
        || normalizedFlag.startsWith('unit mismatch')
        || normalizedFlag.startsWith('used default supplier unit')
      );
    })
    : quantityResult.reviewFlags;
  const status = reviewFlags.length ? 'REVIEW REQUIRED' : 'MATCHED';
  const matchReason = reviewFlags.length
    ? `${matchMeta.reason}; ${reviewFlags.join('; ')}`
    : matchMeta.reason;

  return {
    lineNumber: item.lineNumber,
    originalItem: item.originalItem,
    quantity: quantityResult.customerQuantity,
    requestedUnit: quantityResult.requestedUnit,
    customerUnitType: quantityResult.customerUnitType,
    matchedProductKey: product.catalogKey || '',
    matchedProduct: product.productName,
    matchedProductDisplay: product.productName,
    sourceRowNumber: product.sourceRowNumber,
    unitKgEquivalent: Number.isFinite(Number(product.unitKgEquivalent)) ? Number(product.unitKgEquivalent) : null,
    forceKgConversion: product.forceKgConversion === true,
    unit: quantityResult.unit,
    supplierUnit: String(product.supplierUnit || '').trim(),
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
    supplierUnit: '',
    unitType: '',
    supplyQuantity: 1,
    deliveredQuantity: null,
    deliveredUnitType: '',
    price: 0,
    total: 0,
    status: 'REVIEW REQUIRED',
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
  const matcherOptions = {
    enableBusinessRules: options.enableBusinessRules !== false
  };
  const fuzzyMatcher = createFuzzyMatcher(
    products,
    options.fuzzyThreshold ?? process.env.FUZZY_MATCH_THRESHOLD ?? DEFAULT_FUZZY_THRESHOLD,
    freshProduceTokens
  );

  return {
    matchItem(item) {
      const matchedProduct = matchProduct(item, products, fuzzyMatcher, freshProduceTokens, matcherOptions);
      const fallbackProduct = matchedProduct || extraMatchers
        .map((matcher) => matcher(item, products))
        .find(Boolean);

      if (!fallbackProduct) {
        return buildManualCheckItem(item);
      }

      const confidenceRank = {
        none: 0,
        low: 1,
        medium: 2,
        high: 3,
        manual: 4
      };
      const minAutoMatchConfidence = String(options.minAutoMatchConfidence || process.env.MIN_AUTO_MATCH_CONFIDENCE || 'medium').toLowerCase();
      const minimumRank = confidenceRank[minAutoMatchConfidence] ?? 2;
      const currentRank = confidenceRank[String(fallbackProduct.confidence || 'low').toLowerCase()] ?? 1;

      if (currentRank < minimumRank) {
        return buildManualCheckItem(item, 'low confidence match requires review');
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