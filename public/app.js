const state = {
  currentQuote: null,
  products: []
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
const LAST_OPEN_QUOTE_STORAGE_KEY = 'athena:last-open-quote-id';

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

function getApproximateUnitMatch(request, product, option) {
  const approxPieceWeightKg = Number(product?.approxPieceWeightKg);

  if (!Number.isFinite(approxPieceWeightKg) || approxPieceWeightKg <= 0 || request.customerQuantity === null) {
    return null;
  }

  if (request.customerUnitType === 'pcs' && option.unitType === 'kg') {
    return {
      exactUnitMatch: true,
      effectiveCustomerQuantity: request.customerQuantity * approxPieceWeightKg,
      deliveredUnitType: 'kg'
    };
  }

  if (request.customerUnitType === 'kg' && option.unitType === 'pcs') {
    return {
      exactUnitMatch: true,
      effectiveCustomerQuantity: request.customerQuantity / approxPieceWeightKg,
      deliveredUnitType: 'pcs'
    };
  }

  return null;
}

function selectSupplyOption(product, request) {
  if (!product) {
    return null;
  }

  const options = Array.isArray(product.supplyOptions) && product.supplyOptions.length
    ? product.supplyOptions
    : [{ label: product.unit || '', unitQuantity: 1, unitType: normalizeUnitType(product.unit), orderUnitType: 'pack', descriptor: '', isFallback: true }];
  const customerUnitType = request.customerUnitType;
  const descriptor = requestDescriptor(request.rawRequestedUnit);
  const isEggProduct = /\begg\b/i.test(String(product.productName || ''));

  let bestMatch = null;

  for (const option of options) {
    let score = option.isFallback ? -5 : 5;
    let exactUnitMatch = false;
    let effectiveCustomerQuantity = request.customerQuantity;
    let deliveredUnitType = option.unitType || '';

    if (customerUnitType) {
      if (option.unitType === customerUnitType) {
        score += 100;
        exactUnitMatch = true;
      } else if (customerUnitType === 'pack' && option.orderUnitType === 'pack') {
        score += 85;
        exactUnitMatch = true;
      } else {
        const approximateMatch = getApproximateUnitMatch(request, product, option);
        if (approximateMatch) {
          score += 95;
          exactUnitMatch = true;
          effectiveCustomerQuantity = approximateMatch.effectiveCustomerQuantity;
          deliveredUnitType = approximateMatch.deliveredUnitType;
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

    if (Number.isFinite(effectiveCustomerQuantity) && effectiveCustomerQuantity > 0 && exactUnitMatch && Number(option.unitQuantity) > 0) {
      if (effectiveCustomerQuantity === Number(option.unitQuantity)) {
        score += 30;
      } else {
        const remainder = effectiveCustomerQuantity % Number(option.unitQuantity);
        if (remainder === 0) {
          score += 12;
        }
      }

      const estimatedSupplyCount = Math.ceil(effectiveCustomerQuantity / Number(option.unitQuantity));
      score -= estimatedSupplyCount * 0.01;

      if (isEggProduct && customerUnitType === 'pcs' && effectiveCustomerQuantity >= 1000) {
        score += Number(option.unitQuantity) / 10;
      }
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { option, score, exactUnitMatch, effectiveCustomerQuantity, deliveredUnitType };
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
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

function getProductOptions(selectedValue) {
  const emptyOption = '<option value="">Review required</option>';
  const options = state.products.map((product) => {
    const optionValue = product.catalogKey || product.productName;
    const selected = optionValue === selectedValue ? 'selected' : '';
    return `<option value="${escapeHtml(optionValue)}" ${selected}>${escapeHtml(product.displayName || product.productName)}</option>`;
  });

  return [emptyOption, ...options].join('');
}

function updateSummary(quote) {
  document.querySelector('#summary-lines').textContent = quote.summary.lineCount;
  document.querySelector('#summary-review').textContent = quote.summary.reviewRequired;
  document.querySelector('#summary-total').textContent = formatCurrency(quote.summary.totalValue);
  document.querySelector('#summary-time').textContent = formatProcessingTime(quote.processingMs);
}

function displayStatus(status) {
  if (status === 'MATCHED') {
    return 'Matched';
  }

  if (status === 'UNAVAILABLE') {
    return 'Unavailable';
  }

  return status;
}

function getUnavailableToggleConfig(item) {
  const isUnavailable = Boolean(item.isUnavailable || item.status === 'UNAVAILABLE');

  return {
    isUnavailable,
    symbol: isUnavailable ? '✓' : 'X',
    title: isUnavailable ? 'Restore item' : 'Mark item unavailable',
    className: isUnavailable ? 'restore-button' : 'unavailable-button'
  };
}

function getStatusClass(item) {
  if (item.status === 'MATCHED') {
    return 'matched';
  }

  if (item.status === 'UNAVAILABLE' || item.isUnavailable) {
    return 'unavailable';
  }

  return 'review';
}

function getSupplierQuantity(item) {
  if (item.isUnavailable) {
    return 0;
  }

  return Number(item.supplyQuantity || 1);
}

function getSupplierUnit(item) {
  return String(item.unit || '').trim();
}

function getTotalSuppliedText(item) {
  if (item.isUnavailable) {
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

  state.currentQuote.summary.lineCount = state.currentQuote.items.length;
  state.currentQuote.summary.reviewRequired = state.currentQuote.items.filter((line) => line.status !== 'MATCHED' && line.status !== 'UNAVAILABLE').length;
  state.currentQuote.summary.totalValue = Number(state.currentQuote.items.reduce((sum, line) => sum + Number(line.total || 0), 0).toFixed(2));
}

function markRowUnavailable(item) {
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

  for (const element of resultsTableBody.querySelectorAll('input, select, button')) {
    element.disabled = isClosed;
  }
}

function closeCurrentQuoteView() {
  state.currentQuote = null;
  resultsTableBody.innerHTML = '';
  summaryPanel.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  localStorage.removeItem(LAST_OPEN_QUOTE_STORAGE_KEY);
  setStatus('Current quote view closed.');
}

function renderQuote(quote) {
  state.currentQuote = quote;
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

    return `
      <tr data-index="${index}" class="${isUnavailable ? 'row-unavailable' : ''}">
        <td>${item.lineNumber}</td>
        <td>${escapeHtml(item.originalItem)}</td>
        <td>
          <select class="row-select matched-product" ${disabledAttribute}>
            ${getProductOptions(item.matchedProductKey || item.matchedProduct)}
          </select>
        </td>
        <td><span class="status-pill ${statusClass}">${displayStatus(item.status)}</span></td>
        <td><input class="row-input quantity" type="number" min="0" step="0.01" value="${item.quantity ?? ''}" ${disabledAttribute}></td>
        <td><input class="row-input requested-unit" type="text" value="${item.requestedUnit || item.customerUnitType || ''}" ${disabledAttribute}></td>
        <td>
          <div class="quantity-stepper">
            <button type="button" class="stepper-button supplier-quantity-decrement" aria-label="Decrease supplier quantity" ${disabledAttribute}>-</button>
            <input class="row-input supplier-quantity-input" type="number" min="0" step="0.01" value="${getSupplierQuantity(item)}" ${disabledAttribute}>
            <button type="button" class="stepper-button supplier-quantity-increment" aria-label="Increase supplier quantity" ${disabledAttribute}>+</button>
          </div>
        </td>
        <td class="supplier-unit">${escapeHtml(getSupplierUnit(item))}</td>
        <td class="total-supplied">${escapeHtml(getTotalSuppliedText(item))}</td>
        <td><input class="row-input price" type="number" min="0" step="0.01" value="${Number(item.price || 0).toFixed(2)}" ${disabledAttribute}></td>
        <td class="line-total">${formatCurrency(item.total)}</td>
        <td><button type="button" class="row-action-button unavailable-toggle ${toggleConfig.className}" aria-label="${toggleConfig.title}" title="${toggleConfig.title}">${toggleConfig.symbol}</button></td>
      </tr>
    `;
  }).join('');

  updateQuoteActions(quote);
}

function refreshRow(row, changedField = '') {
  const index = Number(row.dataset.index);
  const item = state.currentQuote.items[index];

   if (item.isUnavailable) {
    markRowUnavailable(item);
    summarizeCurrentQuote();
    updateSummary(state.currentQuote);
    return;
  }

  const selectedProductKey = row.querySelector('.matched-product').value;
  const quantityValue = row.querySelector('.quantity').value;
  const requestedUnitInput = row.querySelector('.requested-unit');
  const supplierQuantityInput = row.querySelector('.supplier-quantity-input');
  const priceInput = row.querySelector('.price');
  const matchedProduct = state.products.find((product) => (product.catalogKey || product.productName) === selectedProductKey)
    || state.products.find((product) => product.productName === selectedProductKey);
  const requestedUnit = requestedUnitInput.value.trim();
  const numericQuantity = quantityValue === '' ? null : Number(quantityValue);
  const request = resolveCustomerRequest(numericQuantity, requestedUnit);
  const selectedOption = selectSupplyOption(matchedProduct || null, request);
  const shouldResetSupplierOverride = ['matched-product', 'quantity', 'requested-unit'].includes(changedField);
  const requestedSupplierQuantity = changedField === 'supplier-quantity-input'
    ? parsePositiveNumber(supplierQuantityInput.value)
    : (shouldResetSupplierOverride ? null : parsePositiveNumber(item.supplierQuantityOverride || supplierQuantityInput.value));
  const reviewFlags = [];

  if (matchedProduct) {
    priceInput.value = Number(matchedProduct.price).toFixed(2);
    item.matchedProductKey = matchedProduct.catalogKey || matchedProduct.productName;
    item.matchedProduct = matchedProduct.productName;
    item.matchedProductDisplay = matchedProduct.displayName || matchedProduct.productName;
  } else {
    item.matchedProductKey = '';
    item.matchedProduct = '';
    item.matchedProductDisplay = '';
  }

  item.quantity = numericQuantity;
  item.requestedUnit = requestedUnit;
  item.price = Number(priceInput.value || 0);
  item.unitType = matchedProduct?.unitType || item.unitType || '';
  item.deliveredQuantity = null;
  item.deliveredUnitType = '';
  item.supplierQuantityOverride = null;
  item.isUnavailable = false;

  if (!matchedProduct) {
    item.unit = '';
    item.supplyQuantity = 1;
    item.status = 'MANUAL CHECK';
  } else {
    if (!Number.isFinite(request.customerQuantity) || request.customerQuantity <= 0) {
      reviewFlags.push('quantity missing');
    }

    if (!request.customerUnitType) {
      reviewFlags.push('unit missing');
    }

    if (!selectedOption) {
      reviewFlags.push('supplier unit missing');
      item.unit = normalizeSupplyLabel(matchedProduct.unit || '');
      item.supplyQuantity = 1;
    } else {
      item.unit = normalizeSupplyLabel(selectedOption.option.label || matchedProduct.unit || '');
      const effectiveCustomerQuantity = Number.isFinite(selectedOption.effectiveCustomerQuantity)
        ? selectedOption.effectiveCustomerQuantity
        : request.customerQuantity;

      if (selectedOption.exactUnitMatch && Number.isFinite(effectiveCustomerQuantity) && effectiveCustomerQuantity > 0) {
        if (request.customerUnitType === 'pack') {
          item.supplyQuantity = Math.max(1, Math.ceil(request.customerQuantity));
          item.deliveredQuantity = item.supplyQuantity;
          item.deliveredUnitType = 'pack';
        } else if (Number(selectedOption.option.unitQuantity) > 0) {
          item.supplyQuantity = Math.max(1, Math.ceil(effectiveCustomerQuantity / Number(selectedOption.option.unitQuantity)));
          item.deliveredQuantity = item.supplyQuantity * Number(selectedOption.option.unitQuantity);
          item.deliveredUnitType = selectedOption.deliveredUnitType || selectedOption.option.unitType || '';
        } else {
          item.supplyQuantity = 1;
        }
      } else {
        if (request.customerUnitType) {
          reviewFlags.push('unit mismatch');
        }
        item.supplyQuantity = 1;
      }
    }

    if (requestedSupplierQuantity) {
      item.supplyQuantity = requestedSupplierQuantity;
      item.supplierQuantityOverride = requestedSupplierQuantity;

      if (selectedOption && request.customerUnitType === 'pack') {
        item.deliveredQuantity = requestedSupplierQuantity;
        item.deliveredUnitType = 'pack';
      } else if (selectedOption && Number(selectedOption.option.unitQuantity) > 0) {
        item.deliveredQuantity = Number((requestedSupplierQuantity * Number(selectedOption.option.unitQuantity)).toFixed(3));
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

resultsTableBody.addEventListener('input', (event) => {
  const row = event.target.closest('tr');
  if (!row || !state.currentQuote) {
    return;
  }

  refreshRow(row, event.target.classList[1] || event.target.classList[0] || '');
});

resultsTableBody.addEventListener('change', (event) => {
  const row = event.target.closest('tr');
  if (!row || !state.currentQuote) {
    return;
  }

  refreshRow(row, event.target.classList[1] || event.target.classList[0] || '');
});

resultsTableBody.addEventListener('click', (event) => {
  const toggleButton = event.target.closest('.unavailable-toggle');
  if (toggleButton && state.currentQuote) {
    const row = toggleButton.closest('tr');
    const index = Number(row?.dataset.index);
    const item = state.currentQuote.items[index];

    if (!row || !item) {
      return;
    }

    if (item.isUnavailable) {
      item.isUnavailable = false;
      renderQuote(state.currentQuote);
      const restoredRow = resultsTableBody.querySelector(`tr[data-index="${index}"]`);
      if (restoredRow) {
        refreshRow(restoredRow, 'restore-available');
      }
      setStatus(`Restored line ${item.lineNumber} to the active quote.`);
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
    ? Math.max(0.01, currentValue - 1)
    : currentValue + 1;

  supplierQuantityInput.value = String(Number(nextValue.toFixed(2)));
  refreshRow(row, 'supplier-quantity-input');
});

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
      body: JSON.stringify({ items: state.currentQuote.items })
    });

    renderQuote(updatedQuote);
    setStatus('Review saved.');
    await loadHistory();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    saveReviewButton.disabled = state.currentQuote?.quoteStatus === 'CLOSED';
    setButtonLoading(saveReviewButton, false);
  }
});

closeQuoteViewButton.addEventListener('click', () => {
  if (!state.currentQuote) {
    return;
  }

  closeCurrentQuoteView();
});

downloadExcelButton.addEventListener('click', () => {
  if (state.currentQuote) {
    window.open(`/api/quotes/${state.currentQuote.id}/export.xlsx`, '_blank');
  }
});

downloadPdfButton.addEventListener('click', () => {
  if (state.currentQuote) {
    window.open(`/api/quotes/${state.currentQuote.id}/export.pdf`, '_blank');
  }
});

historyList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-quote-id]');
  if (!button) {
    return;
  }

  try {
    const quote = await requestJson(`/api/quotes/${button.dataset.quoteId}`);
    renderQuote(quote);
    setStatus(`Loaded quote ${quote.id}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

async function bootstrap() {
  try {
    const [{ products }] = await Promise.all([
      requestJson('/api/master-products'),
      loadHistory()
    ]);
    state.products = products;

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