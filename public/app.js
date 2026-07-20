import { analyzeBudgetQuote, getTopLineTotalItems, hasBudget } from './budgetAnalyzer.js';

const state = {
  currentQuote: null,
  products: [],
  productSearchIndex: []
};

const form = document.querySelector('#quote-form');
const statusMessage = document.querySelector('#status-message');
const resultsPanel = document.querySelector('#results-panel');
const summaryPanel = document.querySelector('#summary-panel');
const resultsTableBody = document.querySelector('#results-table tbody');
const saveReviewButton = document.querySelector('#save-review-button');
const refreshQuoteButton = document.querySelector('#refresh-quote-button');
const closeQuoteViewButton = document.querySelector('#close-quote-view-button');
const downloadExcelButton = document.querySelector('#download-excel-button');
const downloadPdfButton = document.querySelector('#download-pdf-button');
const processButton = document.querySelector('#process-button');
const historyList = document.querySelector('#history-list');
const summaryUnavailable = document.querySelector('#summary-unavailable');
const budgetInput = document.querySelector('#budget-input');
const budgetCurrencySelect = document.querySelector('#budget-currency-select');
const summaryBudgetInput = document.querySelector('#summary-budget-input');
const summaryBudgetCurrency = document.querySelector('#summary-budget-currency');
const budgetEditorPanel = document.querySelector('#budget-editor-panel');
const budgetAnalysisGrid = document.querySelector('#budget-analysis-grid');
const budgetClientValue = document.querySelector('#budget-client-value');
const budgetClientLabel = document.querySelector('#budget-client-label');
const budgetClientConverted = document.querySelector('#budget-client-converted');
const budgetStatusValue = document.querySelector('#budget-status-value');
const budgetStatusMessage = document.querySelector('#budget-status-message');
const summaryTotalUsd = document.querySelector('#summary-total-usd');
const LAST_OPEN_QUOTE_STORAGE_KEY = 'athena:last-open-quote-id';
const QUOTE_SCOPE_STORAGE_KEY = 'athena:quote-scope-id';

function createScopeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return `scope-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateQuoteScopeId() {
  const existing = localStorage.getItem(QUOTE_SCOPE_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const scopeId = createScopeId();
  localStorage.setItem(QUOTE_SCOPE_STORAGE_KEY, scopeId);
  return scopeId;
}

const quoteScopeId = getOrCreateQuoteScopeId();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function formatValue(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function sanitizeBudgetValue(value) {
  const raw = String(value ?? '');
  const cleaned = raw.replace(/[£$\s]/g, '');
  const integerPart = cleaned.split(/[.,]/)[0].replace(/[^\d]/g, '');
  return integerPart === '' ? '' : String(Number(integerPart));
}

function normalizeUnitType(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (/(^|\s)(kg|kgs|kilogram|kilograms|g|gram|grams)(\s|$)/.test(normalized)) {
    return 'kg';
  }

  if (/(^|\s)(l|lt|ltr|liter|liters|litre|litres|ml)(\s|$)/.test(normalized)) {
    return 'liter';
  }

  if (/(^|\s)(pc|pcs|piece|pieces|ea|each|unit|units)(\s|$)/.test(normalized)) {
    return 'pcs';
  }

  if (/(^|\s)(pack|packs|packet|packets|pkt|pkts|carton|cartons|case|cases|box|boxes|tray|trays|bag|bags|bottle|bottles|roll|rolls|tin|tins|jar|jars)(\s|$)/.test(normalized)) {
    return 'pack';
  }

  return '';
}

function toBaseQuantity(quantity, rawUnit) {
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity)) {
    return null;
  }

  const normalized = String(rawUnit || '').trim().toLowerCase();
  const unitType = normalizeUnitType(normalized);

  if (unitType === 'kg' && /(^|\s)(g|gram|grams)(\s|$)/.test(normalized)) {
    return numericQuantity / 1000;
  }

  if (unitType === 'liter' && /(^|\s)(ml)(\s|$)/.test(normalized)) {
    return numericQuantity / 1000;
  }

  return numericQuantity;
}

function extractRequestedPackQuantity(quantity, rawRequestedUnit) {
  const match = String(rawRequestedUnit ?? '').match(/(tray|trays|box|boxes|carton|cartons|case|cases|pack|packs|packet|packets)\s*(?:of)?\s*(\d+(?:\.\d+)?)(?:\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units))?/i);
  if (!match || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const innerAmount = Number(match[2]);
  const rawUnit = match[3] || 'pcs';
  const converted = toBaseQuantity(quantity * innerAmount, rawUnit);

  return {
    customerQuantity: converted,
    customerUnitType: normalizeUnitType(rawUnit),
    rawRequestedUnit: String(rawRequestedUnit || '').trim()
  };
}

function resolveCustomerRequest(quantity, requestedUnit) {
  const structuredPackQuantity = extractRequestedPackQuantity(quantity, requestedUnit);
  if (structuredPackQuantity) {
    return structuredPackQuantity;
  }

  const customerUnitType = normalizeUnitType(requestedUnit);
  const customerQuantity = Number.isFinite(quantity) && quantity > 0
    ? (customerUnitType ? toBaseQuantity(quantity, requestedUnit) : Number(quantity))
    : null;

  return {
    customerQuantity,
    customerUnitType,
    rawRequestedUnit: String(requestedUnit || '').trim()
  };
}

function normalizeSupplyLabel(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/(\d)\s*[xX]\s*(\d)/g, '$1 x $2')
    .trim();
}

function formatQuantityForUnit(quantity, unitType) {
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

  return formattedValue;
}

function buildSupplierProvisionText(item) {
  const productName = String(item.matchedProduct || '').trim();
  const supplierUnit = String(item.unit || '').trim();
  const supplierQuantity = Number.isFinite(Number(item.supplyQuantity)) ? Number(item.supplyQuantity) : 1;
  const unitPart = supplierUnit ? `${supplierQuantity} x ${supplierUnit}` : String(supplierQuantity);
  const deliveredPart = item.deliveredUnitType && Number.isFinite(Number(item.deliveredQuantity))
    ? `${formatQuantityForUnit(Number(item.deliveredQuantity), item.deliveredUnitType)} total`
    : '';

  if (deliveredPart) {
    return `${unitPart} ${productName} (${deliveredPart})`.trim();
  }

  return `${unitPart} ${productName}`.trim();
}

function requestDescriptor(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  const match = normalized.match(/\b(box|boxes|tray|trays|carton|cartons|case|cases|bag|bags|pack|packs|packet|packets|bottle|bottles|roll|rolls|tin|tins|jar|jars)\b/);
  return match ? match[1].replace(/s$/, '') : '';
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
      deliveredUnitType: 'kg'
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

function selectSupplyOption(product, request) {
  if (!product) {
    return null;
  }

  const effectiveRequest = withForcedKgRequest(request, product);

  const options = Array.isArray(product.supplyOptions) && product.supplyOptions.length
    ? product.supplyOptions
    : [{ label: product.unit || '', unitQuantity: 1, unitType: normalizeUnitType(product.unit), orderUnitType: 'pack', descriptor: '', isFallback: true }];
  const customerUnitType = effectiveRequest.customerUnitType;
  const descriptor = requestDescriptor(effectiveRequest.rawRequestedUnit);
  const isEggProduct = /\begg\b/i.test(String(product.productName || ''));

  let bestMatch = null;

  for (const option of options) {
    let score = option.isFallback ? -5 : 5;
    let exactUnitMatch = false;
    let effectiveCustomerQuantity = effectiveRequest.customerQuantity;
    let deliveredUnitType = option.unitType || '';
    let unitQuantityForFulfillment = Number(option.unitQuantity) || 1;

    if (customerUnitType) {
      if (option.unitType === customerUnitType) {
        score += 100;
        exactUnitMatch = true;
      } else if (customerUnitType === 'pack' && option.orderUnitType === 'pack') {
        score += 85;
        exactUnitMatch = true;
      } else {
        const approximateMatch = getApproximateUnitMatch(effectiveRequest, product, option);
        if (approximateMatch) {
          score += 95;
          exactUnitMatch = true;
          effectiveCustomerQuantity = approximateMatch.effectiveCustomerQuantity;
          deliveredUnitType = approximateMatch.deliveredUnitType;
          unitQuantityForFulfillment = Number(approximateMatch.unitQuantityForFulfillment) || unitQuantityForFulfillment;
        } else {
          score -= 40;
        }
      }
    }

    if (descriptor) {
      if (option.descriptor === descriptor) {
        score += 35;
      } else if (customerUnitType === 'pack') {
        score -= 10;
      }
    }

    if (Number.isFinite(effectiveCustomerQuantity) && effectiveCustomerQuantity > 0 && exactUnitMatch && unitQuantityForFulfillment > 0) {
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

      if (isEggProduct && customerUnitType === 'pcs' && Number.isFinite(effectiveCustomerQuantity) && effectiveCustomerQuantity > 0 && unitQuantityForFulfillment > 0) {
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
      bestMatch = { option, score, exactUnitMatch, effectiveCustomerQuantity, deliveredUnitType, unitQuantityForFulfillment };
    }
  }

  return bestMatch;
}

function rememberCurrentQuote(quote) {
  if (!quote?.id) {
    localStorage.removeItem(LAST_OPEN_QUOTE_STORAGE_KEY);
    return;
  }

  localStorage.setItem(LAST_OPEN_QUOTE_STORAGE_KEY, quote.id);
}

function getRememberedQuoteId() {
  return localStorage.getItem(LAST_OPEN_QUOTE_STORAGE_KEY);
}

function formatProcessingTime(milliseconds) {
  return `${(Number(milliseconds || 0) / 1000).toFixed(2)} sec`;
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? '#a12a2a' : '#5a6878';
}

async function requestJson(url, options = {}) {
  const requestHeaders = new Headers(options.headers || {});
  requestHeaders.set('x-quote-scope', quoteScopeId);

  const response = await fetch(url, {
    ...options,
    headers: requestHeaders
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

function normalizeSearchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function getProductCategory(product) {
  return String(
    product?.category
    || product?.categoryName
    || product?.categoryLabel
    || product?.productCategory
    || product?.group
    || product?.department
    || ''
  ).trim();
}

function buildProductSearchIndex() {
  state.productSearchIndex = state.products.map((product) => {
    const key = product.catalogKey || product.productName;
    const label = product.productName || '';
    const category = getProductCategory(product);
    const searchable = normalizeSearchValue(`${label} ${category}`);

    return { key, label, category, searchable };
  });
}

function getProductLabelByKey(value) {
  if (!value) {
    return 'Review required';
  }

  const indexed = state.productSearchIndex.find((entry) => entry.key === value);
  return indexed ? indexed.label : String(value);
}

function getFilteredProductEntries(searchTerm) {
  const normalizedTerm = normalizeSearchValue(searchTerm);
  if (!normalizedTerm) {
    return state.productSearchIndex;
  }

  // Filter against both product label and category text for category-aware matching.
  return state.productSearchIndex.filter((entry) => entry.searchable.includes(normalizedTerm));
}

function renderMatchedProductOptions(selectedValue, searchTerm = '') {
  const entries = getFilteredProductEntries(searchTerm);
  if (!entries.length) {
    return '<div class="matched-product-option no-results" aria-disabled="true">No matching items found</div>';
  }

  return entries.map((entry) => {
    const isSelected = entry.key === selectedValue;
    const categorySuffix = entry.category ? ` <span class="matched-product-category">${escapeHtml(entry.category)}</span>` : '';
    return `
      <button type="button" class="matched-product-option ${isSelected ? 'is-selected' : ''}" data-value="${escapeHtml(entry.key)}" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
        <span class="matched-product-label">${escapeHtml(entry.label)}</span>${categorySuffix}
      </button>
    `;
  }).join('');
}

function renderMatchedProductDropdown(selectedValue, isDisabled) {
  const selectedLabel = getProductLabelByKey(selectedValue);
  const disabledAttribute = isDisabled ? 'disabled' : '';

  return `
    <div class="row-product-dropdown ${isDisabled ? 'is-disabled' : ''}" data-open="false">
      <button type="button" class="row-select matched-product-trigger" ${disabledAttribute} aria-haspopup="listbox" aria-expanded="false">
        ${escapeHtml(selectedLabel)}
      </button>
      <input type="hidden" class="matched-product" value="${escapeHtml(selectedValue || '')}" ${disabledAttribute}>
      <div class="matched-product-menu" hidden>
        <input type="text" class="matched-product-search" placeholder="Search items..." aria-label="Search items">
        <div class="matched-product-options" role="listbox">
          ${renderMatchedProductOptions(selectedValue, '')}
        </div>
      </div>
    </div>
  `;
}

function closeMatchedProductDropdown(dropdown) {
  if (!dropdown) {
    return;
  }

  dropdown.dataset.open = 'false';
  const trigger = dropdown.querySelector('.matched-product-trigger');
  const menu = dropdown.querySelector('.matched-product-menu');
  const searchInput = dropdown.querySelector('.matched-product-search');
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
  }
  if (menu) {
    menu.hidden = true;
  }
  if (searchInput) {
    searchInput.value = '';
  }
  dropdown.classList.remove('open-upward');
}

function closeAllMatchedProductDropdowns(exceptDropdown = null) {
  for (const dropdown of resultsTableBody.querySelectorAll('.row-product-dropdown[data-open="true"]')) {
    if (dropdown !== exceptDropdown) {
      closeMatchedProductDropdown(dropdown);
    }
  }
}

function updateProductOptionHighlight(dropdown, nextIndex) {
  const options = Array.from(dropdown.querySelectorAll('.matched-product-option:not(.no-results)'));
  if (!options.length) {
    dropdown.dataset.activeIndex = '-1';
    return;
  }

  const boundedIndex = Math.max(0, Math.min(nextIndex, options.length - 1));
  dropdown.dataset.activeIndex = String(boundedIndex);
  options.forEach((option, index) => {
    option.classList.toggle('is-active', index === boundedIndex);
  });
  options[boundedIndex].scrollIntoView({ block: 'nearest' });
}

function renderFilteredProductOptions(dropdown, searchTerm) {
  const selectedValue = dropdown.querySelector('.matched-product')?.value || '';
  const optionsContainer = dropdown.querySelector('.matched-product-options');
  if (!optionsContainer) {
    return;
  }

  optionsContainer.innerHTML = renderMatchedProductOptions(selectedValue, searchTerm);
  const selectedOption = optionsContainer.querySelector('.matched-product-option.is-selected:not(.no-results)');
  const allOptions = optionsContainer.querySelectorAll('.matched-product-option:not(.no-results)');
  const initialIndex = selectedOption
    ? Array.from(allOptions).indexOf(selectedOption)
    : 0;
  updateProductOptionHighlight(dropdown, initialIndex);
}

function openMatchedProductDropdown(dropdown) {
  if (!dropdown || dropdown.classList.contains('is-disabled')) {
    return;
  }

  closeAllMatchedProductDropdowns(dropdown);

  const trigger = dropdown.querySelector('.matched-product-trigger');
  const menu = dropdown.querySelector('.matched-product-menu');
  const searchInput = dropdown.querySelector('.matched-product-search');
  if (!trigger || !menu || !searchInput) {
    return;
  }

  dropdown.dataset.open = 'true';
  trigger.setAttribute('aria-expanded', 'true');
  menu.hidden = false;

  // If there is not enough room under the trigger (common on last table rows), open upward.
  const triggerRect = trigger.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const estimatedMenuHeight = 290;
  const spaceBelow = viewportHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  const shouldOpenUpward = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
  dropdown.classList.toggle('open-upward', shouldOpenUpward);

  searchInput.value = '';
  renderFilteredProductOptions(dropdown, '');
  searchInput.focus();
}

function selectMatchedProductOption(optionButton) {
  const dropdown = optionButton.closest('.row-product-dropdown');
  if (!dropdown || optionButton.classList.contains('no-results')) {
    return;
  }

  const value = optionButton.dataset.value || '';
  const hiddenInput = dropdown.querySelector('.matched-product');
  const trigger = dropdown.querySelector('.matched-product-trigger');
  if (!hiddenInput || !trigger) {
    return;
  }

  hiddenInput.value = value;
  trigger.textContent = getProductLabelByKey(value);
  closeMatchedProductDropdown(dropdown);

  hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function updateSummary(quote) {
  document.querySelector('#summary-lines').textContent = quote.summary.lineCount;
  document.querySelector('#summary-review').textContent = quote.summary.reviewRequired;
  if (summaryUnavailable) {
    summaryUnavailable.textContent = Number(quote.summary.unavailable || 0);
  }
  document.querySelector('#summary-total').textContent = formatCurrency(quote.summary.totalValue);
  document.querySelector('#summary-time').textContent = formatProcessingTime(quote.processingMs);

  const budgetAnalysis = analyzeBudgetQuote(quote);
  const budgetExists = Boolean(budgetAnalysis);

  // Budget editor is always visible when a quote is open — lets client add/edit at any time
  if (budgetEditorPanel) {
    budgetEditorPanel.classList.remove('hidden');
  }

  // Always keep inputs in sync with current quote state
  if (summaryBudgetInput) {
    summaryBudgetInput.value = quote.budget ? String(Math.round(Number(quote.budget))) : '';
  }
  if (summaryBudgetCurrency) {
    summaryBudgetCurrency.value = (quote.budgetCurrency || 'GBP').toUpperCase();
  }

  // Analysis cards and USD line only appear when a valid budget has been entered
  if (budgetAnalysisGrid) {
    budgetAnalysisGrid.classList.toggle('hidden', !budgetExists);
  }
  if (summaryTotalUsd) {
    summaryTotalUsd.classList.toggle('hidden', !budgetExists);
  }

  if (!budgetExists) {
    return;
  }

  if (summaryTotalUsd) {
    summaryTotalUsd.textContent = `≈ ${budgetAnalysis.draftUsdLabel}`;
  }

  if (budgetClientValue && budgetClientLabel && budgetClientConverted) {
    budgetClientValue.textContent = budgetAnalysis.inputDisplay;
    budgetClientLabel.textContent = `Client Budget (${budgetAnalysis.budgetCurrency})`;
    budgetClientConverted.textContent = `≈ ${budgetAnalysis.budgetEquivalentLabel}`;
  }

  if (budgetStatusValue && budgetStatusMessage) {
    const toneClass = budgetAnalysis.tone;
    budgetStatusValue.className = `budget-status-pill ${toneClass}`;
    budgetStatusValue.textContent = budgetAnalysis.budgetStatusDisplay;
    budgetStatusMessage.textContent = budgetAnalysis.budgetAdvice;
  }
}

function displayStatus(status) {
  if (status === 'MATCHED') {
    return 'Matched';
  }

  if (status === 'UNAVAILABLE') {
    return 'No match';
  }

  if (status === 'REVIEW REQUIRED' || status === 'MANUAL CHECK') {
    return 'Review';
  }

  return 'Review';
}

function isItemUnavailable(item) {
  return item?.available === false || item?.isUnavailable === true || item?.status === 'UNAVAILABLE';
}

function getUnavailableToggleConfig(item) {
  const isUnavailable = isItemUnavailable(item);

  return {
    isUnavailable,
    symbol: isUnavailable ? '✓' : '✕',
    title: isUnavailable ? 'Mark as available' : 'Mark as unavailable',
    className: isUnavailable ? 'is-unavailable' : 'is-available'
  };
}

function getStatusClass(item) {
  if (isItemUnavailable(item)) {
    return 'unavailable';
  }

  if (item.status === 'MATCHED') {
    return 'matched';
  }

  return 'review';
}

function getSupplierQuantity(item) {
  if (isItemUnavailable(item)) {
    return 0;
  }

  return Number(item.supplyQuantity || 1);
}

function getSupplierUnit(item) {
  return String(item.supplierUnit || item.unit || '').trim();
}

function getTotalSuppliedText(item) {
  if (isItemUnavailable(item)) {
    return '';
  }

  if (item.deliveredUnitType && Number.isFinite(Number(item.deliveredQuantity))) {
    return formatQuantityForUnit(Number(item.deliveredQuantity), item.deliveredUnitType);
  }

  const supplierQuantity = Number(item.supplyQuantity || 0);
  const supplierUnit = String(item.unit || '').trim();
  const quantityMatch = supplierUnit.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units)/i);
  const ofMatch = supplierUnit.match(/(tray|trays|box|boxes|carton|cartons|case|cases|pack|packs|packet|packets)\s*(?:of)?\s*(\d+(?:\.\d+)?)(?:\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units))?/i);

  if (supplierQuantity > 0 && quantityMatch) {
    const perUnit = Number(quantityMatch[1]);
    const unitType = normalizeUnitType(quantityMatch[2]);
    if (Number.isFinite(perUnit) && unitType) {
      return formatQuantityForUnit(supplierQuantity * perUnit, unitType);
    }
  }

  if (supplierQuantity > 0 && ofMatch) {
    const perUnit = Number(ofMatch[2]);
    const unitType = normalizeUnitType(ofMatch[3] || 'pcs');
    if (Number.isFinite(perUnit) && unitType) {
      return formatQuantityForUnit(supplierQuantity * perUnit, unitType);
    }
  }

  return '';
}

function setButtonLoading(button, isLoading) {
  button.classList.toggle('is-loading', isLoading);
}

function summarizeCurrentQuote() {
  if (!state.currentQuote) {
    return;
  }

  const unavailableCount = state.currentQuote.items.filter((line) => isItemUnavailable(line)).length;
  state.currentQuote.summary.lineCount = state.currentQuote.items.length;
  state.currentQuote.summary.unavailable = unavailableCount;
  state.currentQuote.summary.reviewRequired = state.currentQuote.items.filter((line) => !isItemUnavailable(line) && line.status !== 'MATCHED').length;
  state.currentQuote.summary.totalValue = Number(state.currentQuote.items.reduce((sum, line) => {
    if (isItemUnavailable(line)) {
      return sum;
    }
    return sum + Number(line.total || 0);
  }, 0).toFixed(2));
}

function markRowUnavailable(item) {
  item.available = false;
  item.isUnavailable = true;
  item.status = 'UNAVAILABLE';
  item.supplyQuantity = 0;
  item.supplierQuantityOverride = null;
  item.deliveredQuantity = null;
  item.deliveredUnitType = '';
  item.total = 0;
  item.supplierProvision = 'Unavailable';
}

function updateQuoteActions(quote) {
  const isClosed = (quote.quoteStatus || 'OPEN') === 'CLOSED';

  saveReviewButton.disabled = isClosed;
  refreshQuoteButton.disabled = false;

  // Enable export buttons only when a quote is loaded
  downloadExcelButton.disabled = false;
  downloadPdfButton.disabled = false;

  // Reset cursor styles on export buttons
  downloadExcelButton.style.cursor = 'pointer';
  downloadPdfButton.style.cursor = 'pointer';

  for (const element of resultsTableBody.querySelectorAll('input, select, button')) {
    element.disabled = isClosed;
  }
}

function closeCurrentQuoteView() {
  state.currentQuote = null;
  resultsTableBody.innerHTML = '';
  summaryPanel.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  // Hide budget editor when no quote is open
  if (budgetEditorPanel) budgetEditorPanel.classList.add('hidden');
  if (budgetAnalysisGrid) budgetAnalysisGrid.classList.add('hidden');
  if (summaryTotalUsd) summaryTotalUsd.classList.add('hidden');

  // Disable export buttons when no quote is open
  downloadExcelButton.disabled = true;
  downloadPdfButton.disabled = true;

  localStorage.removeItem(LAST_OPEN_QUOTE_STORAGE_KEY);
  setStatus('Current quote view closed.');
}

function renderQuote(quote) {
  state.currentQuote = quote;
  if (!state.currentQuote.summary) {
    state.currentQuote.summary = {};
  }

  if (!state.currentQuote.budgetCurrency) {
    state.currentQuote.budgetCurrency = 'GBP';
  }

  if (!state.currentQuote.budget) {
    state.currentQuote.budget = null;
  }

  const topLineItems = new Map(getTopLineTotalItems(state.currentQuote.items, 3).map((item) => [item.lineNumber, item.rank]));

  // Always refresh supplierUnit from the live catalog so column C changes
  // are reflected immediately without re-processing the quote.
  state.currentQuote.items.forEach((item) => {
    const catalogProduct = state.products.find(
      (p) => (p.catalogKey || p.productName) === (item.matchedProductKey || item.matchedProduct)
    );
    if (catalogProduct && catalogProduct.supplierUnit) {
      item.supplierUnit = String(catalogProduct.supplierUnit).trim();
    }
  });

  state.currentQuote.items.forEach((item) => {
    if (typeof item.available !== 'boolean') {
      item.available = !(item.isUnavailable || item.status === 'UNAVAILABLE');
    }

    if (item.available === false) {
      markRowUnavailable(item);
    } else {
      item.isUnavailable = false;
      if (item.status === 'UNAVAILABLE') {
        item.status = 'REVIEW REQUIRED';
      }
    }
  });

  rememberCurrentQuote(quote);
  summaryPanel.classList.remove('hidden');
  resultsPanel.classList.remove('hidden');
  summarizeCurrentQuote();
  updateSummary(quote);

  resultsTableBody.innerHTML = quote.items.map((item, index) => {
    const statusClass = getStatusClass(item);
    const toggleConfig = getUnavailableToggleConfig(item);
    const isUnavailable = toggleConfig.isUnavailable;
    const disabledAttribute = isUnavailable ? 'disabled' : '';
    const topSpendRank = topLineItems.get(item.lineNumber);
    const highlightMarkup = topSpendRank
      ? `<span class="top-spend-pill">💡 Review Quantity</span>`
      : '';

    return `
      <tr data-index="${index}" class="${isUnavailable ? 'row-unavailable' : ''} ${topSpendRank ? 'top-spend-row' : ''}">
        <td class="line-cell">${item.lineNumber}</td>
        <td class="item-cell">${escapeHtml(item.originalItem)}${highlightMarkup}</td>
        <td class="product-cell">
          ${renderMatchedProductDropdown(item.matchedProductKey || item.matchedProduct, isUnavailable)}
        </td>
        <td class="status-cell"><span class="status-pill ${statusClass}">${displayStatus(item.status)}</span></td>
        <td class="qty-cell"><input class="row-input quantity" type="number" min="0" step="1" value="${item.quantity ?? ''}" ${disabledAttribute}></td>
        <td class="requested-unit-cell requested-unit-display">${escapeHtml(item.requestedUnit || item.customerUnitType || '')}</td>
        <td class="supplier-qty-cell">
          <input class="row-input supplier-quantity-input" type="number" min="0" step="1" value="${getSupplierQuantity(item)}" ${disabledAttribute}>
        </td>
        <td class="supplier-unit-cell supplier-unit">${escapeHtml(getSupplierUnit(item))}</td>
        <td class="total-supplied-cell total-supplied">${escapeHtml(getTotalSuppliedText(item))}</td>
        <td class="price-cell price-display">${Number(item.price || 0).toFixed(2)}</td>
        <td class="total-cell line-total">${formatCurrency(item.total)}</td>
        <td class="action-cell"><button type="button" class="row-action-button" ${disabledAttribute}>-</button></td>
        <td class="availability-cell"><button type="button" class="unavailable-toggle ${toggleConfig.className}" aria-label="${toggleConfig.title}" title="${toggleConfig.title}">${toggleConfig.symbol}</button></td>
      </tr>
    `;
  }).join('');

  updateQuoteActions(quote);
}

function refreshRow(row, changedField = '') {
  const index = Number(row.dataset.index);
  const item = state.currentQuote.items[index];

  if (isItemUnavailable(item)) {
    markRowUnavailable(item);
    summarizeCurrentQuote();
    updateSummary(state.currentQuote);
    return;
  }

  const selectedProductKey = row.querySelector('.matched-product').value;
  const quantityValue = row.querySelector('.quantity').value;
  const requestedUnitInput = row.querySelector('.requested-unit');
  const requestedUnitDisplay = row.querySelector('.requested-unit-display');
  const supplierQuantityInput = row.querySelector('.supplier-quantity-input');
  const priceDisplay = row.querySelector('.price-display');
  const matchedProduct = state.products.find((product) => (product.catalogKey || product.productName) === selectedProductKey)
    || state.products.find((product) => product.productName === selectedProductKey);
  const requestedUnit = requestedUnitInput ? requestedUnitInput.value.trim() : (requestedUnitDisplay ? requestedUnitDisplay.textContent.trim() : '');
  const numericQuantity = quantityValue === '' ? null : Number(quantityValue);
  const request = resolveCustomerRequest(numericQuantity, requestedUnit);
  const effectiveRequest = withForcedKgRequest(request, matchedProduct || null);
  const forcedKgMode = isForceKgConversionProduct(matchedProduct || null);
  const selectedOption = selectSupplyOption(matchedProduct || null, effectiveRequest);
  const shouldResetSupplierOverride = ['matched-product', 'quantity', 'requested-unit'].includes(changedField);
  const requestedSupplierQuantity = changedField === 'supplier-quantity-input'
    ? parsePositiveNumber(supplierQuantityInput.value)
    : (shouldResetSupplierOverride ? null : parsePositiveNumber(item.supplierQuantityOverride || supplierQuantityInput.value));
  const reviewFlags = [];

  if (matchedProduct) {
    item.price = Number(matchedProduct.price) || 0;
    item.unit = normalizeSupplyLabel(selectedOption?.option?.label || matchedProduct.unit || '');
    item.supplierUnit = String(matchedProduct.supplierUnit || '').trim();
    if (priceDisplay) priceDisplay.textContent = item.price.toFixed(2);
    item.matchedProductKey = matchedProduct.catalogKey || matchedProduct.productName;
    item.matchedProduct = matchedProduct.productName;
    item.matchedProductDisplay = matchedProduct.productName;
    item.sourceRowNumber = Number.isFinite(Number(matchedProduct.sourceRowNumber)) ? Number(matchedProduct.sourceRowNumber) : null;
    item.unitKgEquivalent = Number.isFinite(Number(matchedProduct.unitKgEquivalent)) ? Number(matchedProduct.unitKgEquivalent) : null;
    item.forceKgConversion = matchedProduct.forceKgConversion === true;
  } else {
    item.matchedProductKey = '';
    item.matchedProduct = '';
    item.matchedProductDisplay = '';
    item.supplierUnit = '';
    item.sourceRowNumber = null;
    item.unitKgEquivalent = null;
    item.forceKgConversion = false;
    item.price = 0;
    item.unit = '';
    if (priceDisplay) priceDisplay.textContent = '0.00';
  }

  item.quantity = numericQuantity;
  item.requestedUnit = requestedUnit;
  item.unitType = matchedProduct?.unitType || item.unitType || '';
  item.deliveredQuantity = null;
  item.deliveredUnitType = '';
  item.supplierQuantityOverride = null;
  item.available = true;
  item.isUnavailable = false;

  if (!matchedProduct) {
    item.supplyQuantity = 1;
    item.status = 'MANUAL CHECK';
  } else {
    if (!Number.isFinite(effectiveRequest.customerQuantity) || effectiveRequest.customerQuantity <= 0) {
      reviewFlags.push('quantity missing');
    }

    if (!effectiveRequest.customerUnitType) {
      reviewFlags.push('unit missing');
    }

    if (!selectedOption) {
      reviewFlags.push('supplier unit missing');
      item.supplyQuantity = 1;
    } else {
      const effectiveCustomerQuantity = Number.isFinite(selectedOption.effectiveCustomerQuantity)
        ? selectedOption.effectiveCustomerQuantity
        : request.customerQuantity;

      if (selectedOption.exactUnitMatch && Number.isFinite(effectiveCustomerQuantity) && effectiveCustomerQuantity > 0) {
        const unitQuantityForFulfillment = Number.isFinite(selectedOption.unitQuantityForFulfillment)
          ? selectedOption.unitQuantityForFulfillment
          : Number(selectedOption.option.unitQuantity);

        if (effectiveRequest.customerUnitType === 'pack' && !forcedKgMode) {
          item.supplyQuantity = Math.max(1, Math.ceil(effectiveRequest.customerQuantity));
          item.deliveredQuantity = item.supplyQuantity;
          item.deliveredUnitType = 'pack';
        } else if (unitQuantityForFulfillment > 0) {
          item.supplyQuantity = Math.max(1, Math.ceil(effectiveCustomerQuantity / unitQuantityForFulfillment));
          item.deliveredQuantity = item.supplyQuantity * unitQuantityForFulfillment;
          item.deliveredUnitType = selectedOption.deliveredUnitType || selectedOption.option.unitType || '';
        } else {
          item.supplyQuantity = 1;
        }
      } else {
        if (effectiveRequest.customerUnitType) {
          reviewFlags.push('unit mismatch');
        }
        item.supplyQuantity = 1;
      }
    }

    if (requestedSupplierQuantity) {
      const wholeSupplierQuantity = Math.max(1, Math.round(requestedSupplierQuantity));
      item.supplyQuantity = wholeSupplierQuantity;
      item.supplierQuantityOverride = wholeSupplierQuantity;

      const unitQuantityForFulfillment = Number.isFinite(selectedOption?.unitQuantityForFulfillment)
        ? selectedOption.unitQuantityForFulfillment
        : Number(selectedOption?.option?.unitQuantity);

      if (selectedOption && effectiveRequest.customerUnitType === 'pack' && !forcedKgMode) {
        item.deliveredQuantity = wholeSupplierQuantity;
        item.deliveredUnitType = 'pack';
      } else if (selectedOption && unitQuantityForFulfillment > 0) {
        item.deliveredQuantity = Number((wholeSupplierQuantity * unitQuantityForFulfillment).toFixed(3));
        item.deliveredUnitType = selectedOption.deliveredUnitType || selectedOption.option.unitType || '';
      } else {
        item.deliveredQuantity = null;
        item.deliveredUnitType = '';
      }
    }

    item.status = reviewFlags.length ? 'REVIEW REQUIRED' : 'MATCHED';
  }

  item.total = Number(((item.supplyQuantity || 1) * item.price).toFixed(2));
  item.supplierProvision = buildSupplierProvisionText(item);

  row.querySelector('.supplier-quantity-input').value = String(getSupplierQuantity(item));
  row.querySelector('.supplier-unit').textContent = getSupplierUnit(item);
  row.querySelector('.total-supplied').textContent = getTotalSuppliedText(item);
  row.querySelector('.line-total').textContent = formatCurrency(item.total);
  row.querySelector('.status-pill').textContent = displayStatus(item.status);
  row.querySelector('.status-pill').className = `status-pill ${getStatusClass(item)}`;

  summarizeCurrentQuote();
  updateSummary(state.currentQuote);
}

async function loadHistory() {
  const { quotes } = await requestJson('/api/quotes/history');
  historyList.innerHTML = quotes.length
    ? quotes.map((quote) => `
        <article class="history-item">
          <div>
            <strong>${escapeHtml(quote.quoteNumber || quote.clientName)}</strong>
            <p>${escapeHtml(quote.clientName)} | ${escapeHtml(quote.vesselName)}</p>
            ${quote.port || quote.scheduledArrival ? `<p>${escapeHtml(quote.port || quote.scheduledArrival || '')}</p>` : ''}
            <p>${new Date(quote.updatedAt).toLocaleString()} | ${quote.summary.lineCount} lines | ${quote.summary.reviewRequired} review</p>
          </div>
          <button type="button" data-quote-id="${quote.id}">Open Quote</button>
        </article>
      `).join('')
    : '<p>No quotes processed yet.</p>';
}

function syncBudgetFromSummaryInputs() {
  if (!state.currentQuote) {
    return;
  }

  const budgetValue = sanitizeBudgetValue(summaryBudgetInput?.value || '');
  const nextBudget = budgetValue === '' ? null : Number(budgetValue);
  state.currentQuote.budget = Number.isFinite(nextBudget) && nextBudget > 0 ? nextBudget : null;
  state.currentQuote.budgetCurrency = summaryBudgetCurrency?.value || 'GBP';
  summarizeCurrentQuote();
  updateSummary(state.currentQuote);
}

// =====================
// FILE INPUT — Show selected filename
// =====================
const fileInput = document.querySelector('#requisition-file-input');
const uploadZoneIcon = document.querySelector('#upload-zone-icon');
const uploadZoneText = document.querySelector('#upload-zone-text');
const uploadZoneHint = document.querySelector('#upload-zone-hint');
const uploadZoneLabel = document.querySelector('#upload-zone-label');

if (summaryBudgetInput) {
  summaryBudgetInput.addEventListener('input', () => {
    summaryBudgetInput.value = sanitizeBudgetValue(summaryBudgetInput.value);
    syncBudgetFromSummaryInputs();
  });
}

if (summaryBudgetCurrency) {
  summaryBudgetCurrency.addEventListener('change', () => {
    syncBudgetFromSummaryInputs();
  });
}

if (budgetInput) {
  budgetInput.addEventListener('input', () => {
    budgetInput.value = sanitizeBudgetValue(budgetInput.value);
  });
}

if (budgetCurrencySelect) {
  budgetCurrencySelect.value = 'GBP';
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) {
      uploadZoneIcon.className = 'ti ti-circle-check';
      uploadZoneIcon.style.color = 'var(--colour-success, #22c55e)';
      uploadZoneText.textContent = file.name;
      uploadZoneHint.textContent = `${(file.size / 1024).toFixed(1)} KB — ready to process`;
      uploadZoneLabel.classList.add('upload-zone--selected');
    } else {
      uploadZoneIcon.className = 'ti ti-upload';
      uploadZoneIcon.style.color = '';
      uploadZoneText.textContent = 'Drop file here or click to upload';
      uploadZoneHint.textContent = 'XLS · XLSX · CSV · PDF - max 10 MB';
      uploadZoneLabel.classList.remove('upload-zone--selected');
    }
  });
}

// =====================
// FORM SUBMIT — Process requisition
// =====================
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  processButton.disabled = true;
  setButtonLoading(processButton, true);
  setStatus('Processing requisition...');

  try {
    const formData = new FormData(form);
    const quote = await requestJson('/api/quotes/process', {
      method: 'POST',
      body: formData
    });

    renderQuote(quote);
    setStatus(`Processed ${quote.summary.lineCount} lines. ${quote.summary.reviewRequired} need review.`);
    await loadHistory();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    processButton.disabled = false;
    setButtonLoading(processButton, false);
  }
});

// =====================
// TABLE INTERACTIONS
// =====================
resultsTableBody.addEventListener('input', (event) => {
  if (event.target.classList.contains('matched-product-search')) {
    const dropdown = event.target.closest('.row-product-dropdown');
    if (!dropdown) {
      return;
    }

    renderFilteredProductOptions(dropdown, event.target.value);
    return;
  }

  const row = event.target.closest('tr');
  if (!row || !state.currentQuote) {
    return;
  }

  refreshRow(row, event.target.classList[1] || event.target.classList[0] || '');
});

resultsTableBody.addEventListener('change', (event) => {
  if (event.target.classList.contains('matched-product-search')) {
    return;
  }

  const row = event.target.closest('tr');
  if (!row || !state.currentQuote) {
    return;
  }

  refreshRow(row, event.target.classList[1] || event.target.classList[0] || '');
});

resultsTableBody.addEventListener('click', (event) => {
  const productTrigger = event.target.closest('.matched-product-trigger');
  if (productTrigger) {
    const dropdown = productTrigger.closest('.row-product-dropdown');
    if (!dropdown) {
      return;
    }

    const isOpen = dropdown.dataset.open === 'true';
    if (isOpen) {
      closeMatchedProductDropdown(dropdown);
    } else {
      openMatchedProductDropdown(dropdown);
    }
    return;
  }

  const productOption = event.target.closest('.matched-product-option');
  if (productOption) {
    selectMatchedProductOption(productOption);
    return;
  }

  const toggleButton = event.target.closest('.unavailable-toggle');
  if (toggleButton && state.currentQuote) {
    const row = toggleButton.closest('tr');
    const index = Number(row?.dataset.index);
    const item = state.currentQuote.items[index];

    if (!row || !item) {
      return;
    }

    if (isItemUnavailable(item)) {
      item.available = true;
      item.isUnavailable = false;
      renderQuote(state.currentQuote);
      const restoredRow = resultsTableBody.querySelector(`tr[data-index="${index}"]`);
      if (restoredRow) {
        refreshRow(restoredRow, 'restore-available');
      }
      setStatus(`Marked line ${item.lineNumber} as available.`);
    } else {
      markRowUnavailable(item);
      renderQuote(state.currentQuote);
      setStatus(`Marked line ${item.lineNumber} as unavailable.`);
    }

    return;
  }

  const button = event.target.closest('.stepper-button');
  if (!button || !state.currentQuote) {
    return;
  }

  const row = button.closest('tr');
  const supplierQuantityInput = row?.querySelector('.supplier-quantity-input');
  if (!row || !supplierQuantityInput) {
    return;
  }

  const currentValue = parsePositiveNumber(supplierQuantityInput.value) || 1;
  const nextValue = button.classList.contains('supplier-quantity-decrement')
    ? Math.max(1, Math.round(currentValue) - 1)
    : currentValue + 1;

  supplierQuantityInput.value = String(Math.round(nextValue));
  refreshRow(row, 'supplier-quantity-input');
});

resultsTableBody.addEventListener('keydown', (event) => {
  if (!event.target.classList.contains('matched-product-search')) {
    return;
  }

  const dropdown = event.target.closest('.row-product-dropdown');
  if (!dropdown) {
    return;
  }

  const options = Array.from(dropdown.querySelectorAll('.matched-product-option:not(.no-results)'));
  const activeIndex = Number(dropdown.dataset.activeIndex || 0);

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    updateProductOptionHighlight(dropdown, activeIndex + 1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    updateProductOptionHighlight(dropdown, activeIndex - 1);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (options.length) {
      const option = options[Math.max(0, Math.min(activeIndex, options.length - 1))];
      selectMatchedProductOption(option);
    }
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeMatchedProductDropdown(dropdown);
  }
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const insideDropdown = event.target.closest('.row-product-dropdown');
  if (!insideDropdown) {
    closeAllMatchedProductDropdowns();
  }
});

// =====================
// REFRESH QUOTE BUTTON
// =====================
refreshQuoteButton.addEventListener('click', async () => {
  if (!state.currentQuote) {
    return;
  }

  setStatus('Refreshing current quote...');
  refreshQuoteButton.disabled = true;
  setButtonLoading(refreshQuoteButton, true);

  try {
    const quote = await requestJson(`/api/quotes/${state.currentQuote.id}`);
    renderQuote(quote);
    setStatus('Current quote refreshed with the latest price list and matching logic.');
    await loadHistory();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    refreshQuoteButton.disabled = false;
    setButtonLoading(refreshQuoteButton, false);
  }
});

// =====================
// SAVE REVIEW BUTTON — Local draft save only. No R2 upload.
// =====================
saveReviewButton.addEventListener('click', async () => {
  if (!state.currentQuote) {
    return;
  }

  setStatus('Saving reviewed quote...');
  saveReviewButton.disabled = true;
  setButtonLoading(saveReviewButton, true);

  try {
    const updatedQuote = await requestJson(`/api/quotes/${state.currentQuote.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.currentQuote.items,
        budget: state.currentQuote.budget || null,
        budgetCurrency: state.currentQuote.budgetCurrency || 'GBP'
      })
    });

    renderQuote(updatedQuote);
    setStatus('Review saved locally.');
    await loadHistory();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    saveReviewButton.disabled = state.currentQuote?.quoteStatus === 'CLOSED';
    setButtonLoading(saveReviewButton, false);
  }
});

// =====================
// CLOSE QUOTE BUTTON
// =====================
closeQuoteViewButton.addEventListener('click', () => {
  if (!state.currentQuote) {
    return;
  }

  closeCurrentQuoteView();
});

// =====================
// DOWNLOAD EXCEL — Triggers server-side finalization, generates buffer,
// downloads to client AND uploads exact same buffer to R2.
// =====================
downloadExcelButton.addEventListener('click', async () => {
  if (!state.currentQuote) return;

  setButtonLoading(downloadExcelButton, true);
  downloadExcelButton.disabled = true;
  setStatus('Generating Excel export...');

  try {
    const response = await fetch(`/api/quotes/${state.currentQuote.id}/export.xlsx`, {
      headers: { 'x-quote-scope': quoteScopeId }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Excel export failed.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.currentQuote.quoteNumber || state.currentQuote.id}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setStatus('Excel downloaded and uploaded to R2.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    downloadExcelButton.disabled = false;
    setButtonLoading(downloadExcelButton, false);
  }
});

// =====================
// DOWNLOAD PDF — Triggers server-side finalization, generates buffer,
// downloads to client AND uploads exact same buffer to R2.
// =====================
downloadPdfButton.addEventListener('click', async () => {
  if (!state.currentQuote) return;

  setButtonLoading(downloadPdfButton, true);
  downloadPdfButton.disabled = true;
  setStatus('Generating PDF export...');

  try {
    const response = await fetch(`/api/quotes/${state.currentQuote.id}/export.pdf`, {
      headers: { 'x-quote-scope': quoteScopeId }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'PDF export failed.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.currentQuote.quoteNumber || state.currentQuote.id}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setStatus('PDF downloaded and uploaded to R2.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    downloadPdfButton.disabled = false;
    setButtonLoading(downloadPdfButton, false);
  }
});

// =====================
// HISTORY PANEL
// =====================
historyList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-quote-id]');
  if (!button) {
    return;
  }

  try {
    const quote = await requestJson(`/api/quotes/${button.dataset.quoteId}`);
    renderQuote(quote);
    setStatus(`Loaded quote ${quote.id}.`);
    document.querySelector('#summary-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setStatus(error.message, true);
  }
});

// =====================
// BOOTSTRAP
// =====================
async function bootstrap() {
  // Start with export buttons disabled until a quote is open
  downloadExcelButton.disabled = true;
  downloadPdfButton.disabled = true;

  try {
    const [{ products }] = await Promise.all([
      requestJson('/api/master-products'),
      loadHistory()
    ]);
    state.products = products;
    buildProductSearchIndex();

    const rememberedQuoteId = getRememberedQuoteId();
    if (rememberedQuoteId) {
      try {
        const quote = await requestJson(`/api/quotes/${rememberedQuoteId}`);
        renderQuote(quote);
        setStatus(`Reloaded quote ${quote.id} with the latest catalog updates.`);
      } catch {
        localStorage.removeItem(LAST_OPEN_QUOTE_STORAGE_KEY);
      }
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

bootstrap();