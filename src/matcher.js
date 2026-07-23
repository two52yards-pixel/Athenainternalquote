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
    .replace(/\b(?:clementine|satsuma)s?\b/g, ' mandarin ')
    .replace(/\b(?:bok|bak|pak)\s*[- ]?cho(?:i|y)\b/g, ' pak choi ')
    .replace(/\bch(?:i|ic)nese\s*cabbages?\b/g, ' cabbage chinese ')
    .replace(/\bch(?:i|ic)nese\s*leaves\b/g, ' cabbage chinese ')
    .replace(/\bch(?:i|ic)nese\s*leaf\b/g, ' cabbage chinese ')
    .replace(/\b(?:napa|nappa|wombok)\s*cabbages?\b/g, ' cabbage chinese ')
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
    // ---- Client wording → catalog synonyms (applied before token matching; order independent) ----
    // Soft drinks & water
    .replace(/\bcoca[\s-]*cola\b/g, ' coca cola ')
    .replace(/\bcoke\b/g, ' coca cola ')
    .replace(/\bdiet\s+cola\b/g, ' coca cola diet ')
    .replace(/\b(?:seven|7)\s*up\b/g, ' 7up ')
    .replace(/\bred\s*bull\b/g, ' red bull energy ')
    .replace(/\b(?:sparkling|soda|fizzy|carbonated)\s+water\b/g, ' mineral water with gas ')
    .replace(/\bstill\s+water\b/g, ' mineral water ')
    .replace(/\bsquash\b/g, ' cordial ')
    // Dairy / milk / cream
    .replace(/\bcreamer\b/g, ' coffee mate ')
    .replace(/\bphiladelphia\b/g, ' philadelphia cream cheese ')
    .replace(/\bmozarella\b/g, ' mozzarella ')
    .replace(/\bparmigiano\b/g, ' parmesan ')
    // Coffee / tea
    .replace(/\btea\s*bags?\b/g, ' tea bags ')
    // Canned / dry goods
    .replace(/\bgarbanzo(?:\s*beans?)?\b/g, ' chick peas ')
    .replace(/\bchi[c]?k?\s*peas?\b/g, ' chick peas ')
    .replace(/\bcornflour\b/g, ' corn flour ')
    .replace(/\bcorn\s*starch\b/g, ' corn flour ')
    .replace(/\bcornflakes?\b/g, ' corn flakes ')
    .replace(/\bworcester(?:shire)?\b/g, ' worchestershire ')
    .replace(/\btabasco\b/g, ' hot chilli tabasco ')
    .replace(/\bket(?:ch|c)?up\b/g, ' ketchup ')
    .replace(/\bmayo\b/g, ' mayonnaise ')
    .replace(/\bmayonaise\b/g, ' mayonnaise ')
    .replace(/\baubergines?\b/g, ' aubergine ')
    // Pasta / noodles
    .replace(/\bnoodle[s]?\b/g, ' noodles ')
    .replace(/\bvermicelli\b/g, ' vermicelli noodles ')
    // Fresh vegetables
    .replace(/\bcourgettes?\b/g, ' zuchini ')
    .replace(/\bzucchinis?\b/g, ' zuchini ')
    .replace(/\bcapsicums?\b/g, ' bell pepper ')
    .replace(/\bsweet\s+peppers?\b/g, ' bell pepper ')
    .replace(/\bbrinjals?\b/g, ' aubergine ')
    .replace(/\b(?:lady'?s?\s*finger|bhindi|okra)s?\b/g, ' okra ')
    .replace(/\bscallions?\b/g, ' spring onion ')
    .replace(/\bcilantro\b/g, ' coriander ')
    .replace(/\bdhania\b/g, ' coriander ')
    .replace(/\bbeets?\b/g, ' beetroot ')
    .replace(/\bmange\s*touts?\b/g, ' snow peas ')
    // Fresh fruit
    .replace(/\bpaw\s*paws?\b/g, ' papaya ')
    .replace(/\bcanteloupe[s]?\b/g, ' cantaloupe ')
    .replace(/\brock\s*melons?\b/g, ' cantaloupe melon ')
    .replace(/\bmusk\s*melons?\b/g, ' honeydew melon ')
    // Meat / fish
    .replace(/\bshrimps?\b/g, ' prawns ')
    .replace(/\bcalamari\b/g, ' squid ')
    .replace(/\bsea\s*bass\b/g, ' seabass ')
    .replace(/\bsea\s*food\b/g, ' seafood ')
    .replace(/\b(?:ground|minced)\s+beef\b/g, ' beef mince ')
    .replace(/\b(?:ground|minced)\s+lamb\b/g, ' lamb mince ')
    .replace(/\bminced\b/g, ' mince ')
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

// Packaging / measurement fragments that survive digit-stripping (e.g. "6X2.6KG" → "kg").
// They carry no product meaning and must never influence matching scores.
const UNIT_FRAGMENT_TOKENS = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'g', 'gr', 'gm', 'gms', 'gram', 'grams', 'mg',
  'ml', 'cl', 'lt', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres',
  'pc', 'pcs', 'pce', 'pkt', 'pkts', 'no', 'nos', 'cs', 'ctn', 'ctns',
  'oz', 'lb', 'lbs', 'pk', 'pks', 'bch', 'pr', 'pair', 'inch'
]);

function tokenize(value) {
  const tokens = cleanProductText(value)
    .split(' ')
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length > 1 && !UNIT_FRAGMENT_TOKENS.has(token));

  const meaningfulTokens = tokens.filter((token) => !QUALIFIER_TOKENS.has(token));
  return meaningfulTokens.length ? meaningfulTokens : tokens;
}

function tokenizeRaw(value) {
  return cleanProductText(value)
    .split(' ')
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length > 1 && !UNIT_FRAGMENT_TOKENS.has(token));
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
  { test: (n) => /\bdiet\b/.test(n) && /\b(?:coca\s*cola|coke|cola)\b/.test(n), key: 'ATH-DRK008', expect: /cola/ },
  // Bottled cola / coke
  { test: (n) => /\b(?:coca\s*cola|coke|cola)\b/.test(n) && /\b(?:btl|bottle)\b/.test(n), key: 'ATH-DRK005', expect: /cola/ },
  // Canned cola / coke (default — no bottle, no diet)
  { test: (n) => /\b(?:coca\s*cola|coke|cola)\b/.test(n), exclude: /\b(?:btl|bottle|diet)\b/, key: 'ATH-DRK007', expect: /cola/ },
  // Fanta lemon can
  { test: (n) => /\bfanta\b/.test(n) && /\blemon\b/.test(n), exclude: /\b(?:btl|bottle)\b/, key: 'ATH-DRK011', expect: /fanta/ },
  // Fanta orange can (default — not bottled, not lemon)
  { test: (n) => /\bfanta\b/.test(n), exclude: /\b(?:btl|bottle|lemon)\b/, key: 'ATH-DRK012', expect: /fanta/ },
  // Sprite bottled
  { test: (n) => /\bsprite\b/.test(n) && /\b(?:btl|bottle)\b/.test(n), key: 'ATH-DRK013', expect: /sprite/ },
  // Sprite can (default)
  { test: (n) => /\bsprite\b/.test(n), exclude: /\b(?:btl|bottle)\b/, key: 'ATH-DRK014', expect: /sprite/ },
  // --- Fresh vegetables ---
  // Aubergine / eggplant → EGGPLANT 12XBOX (not roasted)
  { test: (n) => /\b(?:aubergine|eggplant)[s]?\b/.test(n), exclude: /\broasted\b/, key: 'ATH-FVG027', expect: /eggplant|aubergine/ },
  // Cauliflower → CAULIFLOWER 8XBOX (not frozen)
  { test: (n) => /\bcauliflower[s]?\b/.test(n), exclude: /\bfrozen\b/, key: 'ATH-FVG017', expect: /cauliflower/ },
  // Spring / green / fresh onion → SPRING ONIONS 12XBOX
  { test: (n) => /\b(?:spring\s+onion|green\s+onion|fresh\s+onion)[s]?\b/.test(n), key: 'ATH-FVG058', expect: /onion/ },
  // Fresh tomato → TOMATOES 6KG (exclude cherry and all processed/canned forms)
  {
    test: (n) => /\btomato(?:es)?\b/.test(n),
    exclude: /\b(?:cherry|paste|puree|juice|ketchup|ketcup|soup|canned|tinned|chopped|peeled|pilchards?|sardines?|mackerels?|pilchard|sauce)\b/,
    key: 'ATH-FVG062',
    expect: /tomato/
  },
  // --- Fresh fruit ---
  // Yellow pear → PEARS YELLOW 12XBOX (most specific, before the green-pear default)
  { test: (n) => /\byellow\b/.test(n) && /\bpear[s]?\b/.test(n), key: 'ATH-FFR019', expect: /pear/ },
  // Pear → PEARS GREEN 70XBOX (not yellow / syrup / canned)
  { test: (n) => /\bpear[s]?\b/.test(n), exclude: /\b(?:yellow|syrup|canned|tinned|juice)\b/, key: 'ATH-FFR018', expect: /pear/ },
  // Fresh pineapple → PINEAPPLE 8XBOX (not juice / frozen / canned / sliced)
  {
    test: (n) => /\bpineapple[s]?\b/.test(n),
    exclude: /\b(?:juice|frozen|chunks?|slices?|sliced|canned|tinned|syrup)\b/,
    key: 'ATH-FFR020',
    expect: /pineapple/
  },
  // Watermelon → WATER MELON 5XBOX (note: normalizeText converts 'watermelon' → 'water melon')
  { test: (n) => /\bwater\s*melon[s]?\b/.test(n), key: 'ATH-FFR023', expect: /water\s*melon/ },
  // Honeydew / sweet melon / melon → HONEYDEW MELON 7XBOX (not watermelon / cantaloupe)
  {
    test: (n) => /\b(?:honeydew\s+melon|honeydew|honey\s+melon|sweet\s+melon|melon)[s]?\b/.test(n),
    exclude: /\b(?:water|cantaloupe)\b/,
    key: 'ATH-FFR011',
    expect: /melon/
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

function buildMatchContext(item, freshProduceTokens, stats = null) {
  const cleanedText = cleanProductText(item.originalItem);
  const correct = stats && typeof stats.correct === 'function'
    ? (token) => stats.correct(token)
    : (token) => token;
  const matchTokens = [...new Set(uniqueTokens([cleanedText]).map(correct))];
  const rawTokens = [...new Set(uniqueRawTokens([item.originalItem]).map(correct))];
  const request = resolveCustomerRequest(item);
  const explicitProcessedRequest = hasAnyToken(rawTokens, PRODUCE_STYLE_TOKENS);
  const produceIntentTokens = matchTokens.filter((token) => freshProduceTokens.has(token));
  const produceIntentCategory = inferProduceIntentCategory({ matchTokens });
  const bakeryIntent = inferBakeryIntent({ matchTokens });

  return {
    cleanedText,
    correctedText: matchTokens.join(' ') || cleanedText,
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

  // Garlic priority. Only when garlic is the subject — not when it is a modifier inside a
  // composite product name (e.g. "chilli garlic stir fry sauce", "garlic bread/butter/mayo").
  const garlicIsModifier = /\b(?:sauce|paste|stir|fry|bread|butter|mayo|mayonnaise|dip|dressing|puree|oil|salt|croutons?|naan|baguette|pizza)\b/.test(normalizedRequest);
  if (hasToken(/\bgarlic\b/) && !garlicIsModifier) {
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
  if (hasToken(/\bpine\s*apple\b|\bpineapple\b/) && !hasToken(/\bjuice\b|\bfrozen\b|\bcanned\b|\btinned\b|\bchunks?\b|\bslices?\b|\bsliced\b|\bsyrup\b/)) {
    const product = findProductByRule(products, [/\bpine\s*apple\b|\bpineapple\b/], [], [/\b8\s*x\s*box\b|\b8xbox\b/]);
    if (product) return { product, score: 1, confidence: 'high', reason: 'business rule: pineapple -> 8xbox' };
  }

  // (Fresh pear default is handled by FORCED_CATALOG_OVERRIDES, which correctly excludes
  // canned/syrup forms and does not conflate "peas" with "pears". Explicit canned pear
  // halves fall through to normal matching.)

  // (Bare "strawberries" → 135g default is handled earlier in matchProduct, before
  // business rules, so it can distinguish strawberry milk/jam/syrup/ice cream.)

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

// Bounded Levenshtein edit distance. Returns a number > maxDistance as soon as it
// is certain the true distance exceeds maxDistance (keeps per-token typo correction cheap).
function boundedEditDistance(a, b, maxDistance) {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = new Array(lenB + 1);
  let current = new Array(lenB + 1);
  for (let j = 0; j <= lenB; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    const charA = a.charCodeAt(i - 1);

    for (let j = 1; j <= lenB; j += 1) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      if (current[j] < rowMin) {
        rowMin = current[j];
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    [previous, current] = [current, previous];
  }

  return previous[lenB];
}

// Build catalog-wide statistics used by the smart matcher:
//  - idf:    inverse document frequency per token (distinctive words weigh more)
//  - vocab:  the set of real catalog tokens, grouped by first letter for fast typo lookup
//  - correct: maps an unknown/misspelled request token to its closest catalog token
function buildCatalogStats(products) {
  const documentFrequency = new Map();
  const tokenFrequency = new Map();
  const knownTokens = new Set();
  const totalDocuments = Math.max(products.length, 1);

  for (const product of products) {
    const productTokens = new Set([
      ...(Array.isArray(product.nameTokens) ? product.nameTokens : []),
      ...(Array.isArray(product.keywordTokens) ? product.keywordTokens : [])
    ]);

    for (const token of productTokens) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }

    // Frequency + known-word set also include raw tokens (qualifiers/style words like
    // "chopped", "smoked") so typo-correction recognises them and leaves them intact.
    for (const token of [
      ...(product.nameTokens || []),
      ...(product.keywordTokens || []),
      ...(product.rawMatchTokens || [])
    ]) {
      tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
      knownTokens.add(token);
    }
  }

  const idf = new Map();
  let idfSum = 0;
  for (const [token, df] of documentFrequency.entries()) {
    const value = Math.log(1 + totalDocuments / (1 + df));
    idf.set(token, value);
    idfSum += value;
  }

  const defaultIdf = Math.log(1 + totalDocuments);
  const averageIdf = documentFrequency.size ? idfSum / documentFrequency.size : defaultIdf;

  const vocabularyByLetter = new Map();
  for (const token of knownTokens) {
    if (token.length < 3) {
      continue;
    }
    const bucketKey = token[0];
    if (!vocabularyByLetter.has(bucketKey)) {
      vocabularyByLetter.set(bucketKey, []);
    }
    vocabularyByLetter.get(bucketKey).push(token);
  }

  const correctionCache = new Map();

  function correct(token) {
    if (!token || token.length < 5 || knownTokens.has(token)) {
      return token;
    }
    if (correctionCache.has(token)) {
      return correctionCache.get(token);
    }

    const maxDistance = token.length >= 8 ? 2 : 1;
    // Only consider candidates that start with the same or an adjacent first letter
    // (typos rarely change the first character), keeping the search small.
    const buckets = [vocabularyByLetter.get(token[0])].filter(Boolean);
    let best = token;
    let bestDistance = maxDistance + 1;
    let bestFrequency = 0;

    for (const bucket of buckets) {
      for (const candidate of bucket) {
        if (Math.abs(candidate.length - token.length) > maxDistance) {
          continue;
        }
        const distance = boundedEditDistance(token, candidate, maxDistance);
        if (distance > maxDistance) {
          continue;
        }
        const frequency = tokenFrequency.get(candidate) || 0;
        if (distance < bestDistance || (distance === bestDistance && frequency > bestFrequency)) {
          best = candidate;
          bestDistance = distance;
          bestFrequency = frequency;
        }
      }
    }

    correctionCache.set(token, best);
    return best;
  }

  return {
    idf,
    defaultIdf,
    averageIdf,
    getIdf(token) {
      return idf.get(token) ?? defaultIdf;
    },
    correct
  };
}

// Cosine-style similarity between the request and a product's name, weighted by IDF.
// Word order is irrelevant (sets, not sequences); distinctive words dominate; and a
// high score requires the request and the product name to overlap in BOTH directions,
// so the most exact catalog item wins.
function scoreSmartMatch(context, product, stats) {
  const requestTokens = context.matchTokens;
  if (!requestTokens.length) {
    return null;
  }

  const nameTokens = Array.isArray(product.nameTokens) ? product.nameTokens : [];
  if (!nameTokens.length) {
    return null;
  }

  const nameSet = new Set(nameTokens);
  const keywordSet = new Set(Array.isArray(product.keywordTokens) ? product.keywordTokens : []);

  let dot = 0;
  const shared = [];
  for (const token of requestTokens) {
    if (nameSet.has(token)) {
      const weight = stats.getIdf(token);
      dot += weight * weight;
      shared.push(token);
    }
  }

  if (!shared.length) {
    // No name overlap — allow a keyword-only rescue but at a heavy discount.
    let keywordOnly = 0;
    for (const token of requestTokens) {
      if (keywordSet.has(token)) {
        keywordOnly += stats.getIdf(token);
      }
    }
    if (keywordOnly <= 0) {
      return null;
    }
    return { cosine: 0, shared, score: 0.18 * keywordOnly, coverage: 0 };
  }

  let requestWeight = 0;
  let sharedWeight = 0;
  for (const token of requestTokens) {
    const weight = stats.getIdf(token);
    requestWeight += weight;
    if (nameSet.has(token)) {
      sharedWeight += weight;
    }
  }

  const requestNorm = Math.sqrt(requestTokens.reduce((sum, token) => {
    const weight = stats.getIdf(token);
    return sum + weight * weight;
  }, 0));
  const nameNorm = Math.sqrt(nameTokens.reduce((sum, token) => {
    const weight = stats.getIdf(token);
    return sum + weight * weight;
  }, 0));

  const cosine = requestNorm && nameNorm ? dot / (requestNorm * nameNorm) : 0;
  // Fraction of the request's meaning that the product name accounts for. Covering ALL
  // requested words (peanut AND butter) must beat covering a subset (butter only).
  const requestCoverage = requestWeight ? sharedWeight / requestWeight : 0;

  let keywordBonus = 0;
  for (const token of requestTokens) {
    if (!nameSet.has(token) && keywordSet.has(token)) {
      keywordBonus += stats.getIdf(token);
    }
  }
  const bonus = requestNorm ? keywordBonus / requestNorm : 0;

  // Raw (unfiltered) qualifier/style words like "chopped", "whole", "smoked", "diet"
  // are dropped from the main token set, but when both the request and the product name
  // carry the same one it disambiguates near-identical SKUs.
  let rawQualifierHits = 0;
  const requestRaw = Array.isArray(context.rawTokens) ? context.rawTokens : [];
  const productRaw = new Set(Array.isArray(product.rawMatchTokens) ? product.rawMatchTokens : []);
  const sharedSet = new Set(shared);
  for (const token of requestRaw) {
    if (!sharedSet.has(token) && productRaw.has(token)) {
      rawQualifierHits += 1;
    }
  }

  // Fraction of the product name's words that were matched. Rewards the product whose
  // name is "mostly the request" (Peanut Butter spread) over one where the request is a
  // minor flavour note (Kind Peanut Butter Dark Chocolate bar).
  const nameCountCoverage = nameTokens.length ? shared.length / nameTokens.length : 0;

  const score = requestCoverage * (0.34 + 0.36 * cosine + 0.3 * nameCountCoverage)
    + 0.1 * bonus
    + 0.05 * rawQualifierHits;

  return {
    cosine,
    shared,
    coverage: shared.length / nameTokens.length,
    score
  };
}

function findSmartMatch(context, products, stats) {
  if (!stats) {
    return null;
  }

  let best = null;

  for (const product of products) {
    const scored = scoreSmartMatch(context, product, stats);
    if (!scored || scored.score <= 0) {
      continue;
    }

    const hasDistinctiveShared = scored.shared.some((token) => (
      !LOW_SIGNAL_TOKENS.has(token) && stats.getIdf(token) >= stats.averageIdf
    ));

    // Reject weak, non-distinctive overlaps (e.g. matching only on "fresh"/"white")
    // unless the overall name similarity is already strong.
    if (scored.cosine < 0.6 && !hasDistinctiveShared) {
      continue;
    }

    if (scored.score < 0.28) {
      continue;
    }

    const unitFit = scoreUnitFit(context.request, product);
    const producePreference = scoreProducePreference(context, product);

    const candidate = {
      product,
      score: scored.score,
      cosine: scored.cosine,
      coverage: scored.coverage,
      producePreference,
      unitFit,
      nameLength: (product.nameTokens || []).length,
      confidence: scored.cosine >= 0.72 ? 'high' : (scored.cosine >= 0.46 ? 'medium' : 'low')
    };

    // Priority: textual similarity (exactness) → fresh-produce preference → name coverage
    // → unit fit → shortest/most-specific name.
    const better = !best
      || candidate.score > best.score
      || (candidate.score === best.score && candidate.producePreference > best.producePreference)
      || (candidate.score === best.score && candidate.producePreference === best.producePreference && candidate.coverage > best.coverage)
      || (candidate.score === best.score && candidate.producePreference === best.producePreference && candidate.coverage === best.coverage && candidate.unitFit > best.unitFit)
      || (candidate.score === best.score && candidate.producePreference === best.producePreference && candidate.coverage === best.coverage && candidate.unitFit === best.unitFit && candidate.nameLength < best.nameLength);

    if (better) {
      best = candidate;
    }
  }

  if (!best) {
    return null;
  }

  return {
    product: best.product,
    score: best.score,
    confidence: best.confidence,
    reason: context.prefersFreshProduce && best.producePreference > 0
      ? `smart match ${best.cosine.toFixed(2)}; preferred fresh produce alternative`
      : `smart match ${best.cosine.toFixed(2)}`
  };
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

function createFuzzyMatcher(products, fuzzyThreshold, freshProduceTokens, stats = null) {
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
    const context = buildMatchContext(item, freshProduceTokens, stats);
    if (!context.cleanedText) {
      return null;
    }

    const results = fuse.search(context.correctedText || context.cleanedText, { limit: 8 });
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
function matchProduct(item, products, fuzzyMatcher, freshProduceTokens, matcherOptions = {}, stats = null) {
  const context = buildMatchContext(item, freshProduceTokens, stats);
  context.originalItem = item.originalItem;
  const itemText = context.cleanedText;
  const requestedQty = context.request.customerQuantity;
  const requestedUnitType = context.request.customerUnitType;
  const normalizedRequest = normalizeText(item.originalItem || '');

  // Forced catalog overrides — highest priority, evaluated before all other matching logic.
  for (const override of FORCED_CATALOG_OVERRIDES) {
    if (override.test(normalizedRequest) && (!override.exclude || !override.exclude.test(normalizedRequest))) {
      const forcedProduct = products.find((p) => p.catalogKey === override.key);
      if (!forcedProduct) {
        continue;
      }
      // Safety: a hardcoded key can drift as the price list changes. Only honour the
      // override if the target product's name actually matches the rule's intent;
      // otherwise fall through to normal (smart) matching.
      if (override.expect && !override.expect.test(normalizeText(forcedProduct.productName || ''))) {
        continue;
      }
      return { product: forcedProduct, score: 1, confidence: 'high', reason: `forced match: ${override.key}` };
    }
  }

  // Business constraint: a BARE "strawberries" request (the fresh fruit, no other product
  // noun) defaults to the 135g SKU. Requests like "strawberry milk", "strawberry jam",
  // "strawberry syrup", "strawberry ice cream" name a different product and fall through to
  // normal matching. (Handles both singular and plural product names.)
  const strawberryRe = /\bstrawberr(?:y|ies)\b/;
  if (strawberryRe.test(normalizedRequest)) {
    const otherAnchors = context.matchTokens.filter((token) => token !== 'strawberry');
    const isBareStrawberry = otherAnchors.length === 0;
    if (isBareStrawberry) {
      const strawberry135 = products.find((product) => {
        const name = normalizeText(product.productName || '');
        return strawberryRe.test(name) && /\b135\s*g\b|\b135g\b/.test(name);
      });
      if (strawberry135) {
        return { product: strawberry135, score: 1, confidence: 'high', reason: 'business rule: strawberries default 135g' };
      }
      // No fresh-strawberry SKU exists — send bare strawberry requests to manual review
      // rather than mis-matching to a flavoured variant.
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

  // Smart, word-order-independent, IDF-weighted similarity match (primary general matcher).
  const smartMatch = findSmartMatch(context, products, stats);

  // Legacy token-overlap match kept as a safety net for edge cases the smart matcher skips.
  const keywordMatch = findKeywordMatch(context, products);

  // Prefer whichever is more confident; on a tie prefer the smart match.
  const confidenceOrder = { high: 3, medium: 2, low: 1 };
  if (smartMatch && keywordMatch) {
    const smartRank = confidenceOrder[smartMatch.confidence] || 0;
    const keywordRank = confidenceOrder[keywordMatch.confidence] || 0;
    return keywordRank > smartRank ? keywordMatch : smartMatch;
  }
  if (smartMatch) {
    return smartMatch;
  }
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
  const catalogStats = buildCatalogStats(products);
  const matcherOptions = {
    enableBusinessRules: options.enableBusinessRules !== false
  };
  const fuzzyMatcher = createFuzzyMatcher(
    products,
    options.fuzzyThreshold ?? process.env.FUZZY_MATCH_THRESHOLD ?? DEFAULT_FUZZY_THRESHOLD,
    freshProduceTokens,
    catalogStats
  );

  return {
    matchItem(item) {
      const matchedProduct = matchProduct(item, products, fuzzyMatcher, freshProduceTokens, matcherOptions, catalogStats);
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