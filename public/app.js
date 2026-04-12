// Warn user before leaving if there is an unsaved quote
window.addEventListener('beforeunload', (e) => {
  if (state.currentQuote && state.currentQuote.quoteStatus !== 'CLOSED') {
    e.preventDefault();
    e.returnValue = 'You have an unsaved quote. Please submit (Save Review) before leaving or your changes will be lost.';
    return 'You have an unsaved quote. Please submit (Save Review) before leaving or your changes will be lost.';
  }
});
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
  if (/(^|\s)(kg|kgs|kilogram|kilograms|g|gram|grams)(\s|$)/.test(normalized)) return 'kg';
  if (/(^|\s)(l|lt|ltr|liter|liters|litre|litres|ml)(\s|$)/.test(normalized)) return 'liter';
  if (/(^|\s)(pc|pcs|piece|pieces|ea|each|unit|units)(\s|$)/.test(normalized)) return 'pcs';
  if (/(^|\s)(pack|packs|packet|packets|pkt|pkts|carton|cartons|case|cases|box|boxes|tray|trays|bag|bags|bottle|bottles|roll|rolls|tin|tins|jar|jars)(\s|$)/.test(normalized)) return 'pack';
  return '';
}

function toBaseQuantity(quantity, rawUnit) {
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity)) return null;
  const normalized = String(rawUnit || '').trim().toLowerCase();
  const unitType = normalizeUnitType(normalized);
  if (unitType === 'kg' && /(^|\s)(g|gram|grams)(\s|$)/.test(normalized)) return numericQuantity / 1000;
  if (unitType === 'liter' && /(^|\s)(ml)(\s|$)/.test(normalized)) return numericQuantity / 1000;
  return numericQuantity;
}

function extractRequestedPackQuantity(quantity, rawRequestedUnit) {
  const match = String(rawRequestedUnit ?? '').match(/(tray|trays|box|boxes|carton|cartons|case|cases|pack|packs|packet|packets)\s*(?:of)?\s*(\d+(?:\.\d+)?)(?:\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units))?/i);
  if (!match || !Number.isFinite(quantity) || quantity <= 0) return null;
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
  if (structuredPackQuantity) return structuredPackQuantity;
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
  if (!Number.isFinite(quantity)) return '';
  const formattedValue = formatValue(quantity);
  if (unitType === 'kg') return `${formattedValue}kg`;
  if (unitType === 'liter') return `${formattedValue}L`;
  if (unitType === 'pcs') return `${formattedValue} pcs`;
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
  if (deliveredPart) return `${unitPart} ${productName} (${deliveredPart})`.trim();
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
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function summarizeCurrentQuote() {
  if (!state.currentQuote) return;
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

const finalizeConfirmDialog = document.querySelector('#finalize-confirm-dialog');

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
        <td><button type="button" class="row-action-button unavailable-toggle ${toggleConfig.className}" aria-label="${toggleConfig.title}" title="${toggleConfig.title}">${toggleConfig.symbol}</button></td>
        <td>${escapeHtml(item.originalItem)}</td>
        <td>
          <select class="row-select matched-product" ${disabledAttribute}>
            ${getProductOptions(item.matchedProductKey || item.matchedProduct)}
          </select>
        </td>
        <td><span class="status-pill ${statusClass}">${displayStatus(item.status)}</span></td>
        <td><input class="row-input quantity" type="number" min="0" step="0.01" value="${item.quantity ?? ''}" ${disabledAttribute}></td>
        <td><input class="row-input requested-unit" type="text" value="${item.requestedUnit || item.customerUnitType || ''}" ${disabledAttribute}></td>
        <td><input class="row-input supplier-quantity-input" type="number" min="0" step="1" value="${getSupplierQuantity(item)}" ${disabledAttribute}></td>
        <td class="supplier-unit">${escapeHtml(getSupplierUnit(item))}</td>
        <td class="total-supplied">${escapeHtml(getTotalSuppliedText(item))}</td>
        <td><input class="row-input price" type="number" min="0" step="0.01" value="${Number(item.price || 0).toFixed(2)}" ${disabledAttribute}></td>
        <td class="line-total">${formatCurrency(item.total)}</td>
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
  // ...existing code for row refresh logic...
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
  if (item.status === 'MATCHED') return 'matched';
  if (item.status === 'UNAVAILABLE' || item.isUnavailable) return 'unavailable';
  return 'review';
}

function getSupplierQuantity(item) {
  if (item.isUnavailable) return 0;
  return Number(item.supplyQuantity || 1);
}

function getSupplierUnit(item) {
  return String(item.unit || '').trim();
}

function getTotalSuppliedText(item) {
  if (item.isUnavailable) return '';
  if (item.deliveredUnitType && Number.isFinite(Number(item.deliveredQuantity))) {
    return formatQuantityForUnit(Number(item.deliveredQuantity), item.deliveredUnitType);
  }
  // ...existing code for total supplied text...
  return '';
}

function setButtonLoading(button, isLoading) {
  button.classList.toggle('is-loading', isLoading);
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

// ...existing event listeners for table, buttons, etc...

// Centralized finalizeQuote logic for single final quote upload
let hasUploaded = false;
async function finalizeQuote() {
    if (hasUploaded) {
        alert('Quote already finalized and uploaded.');
        return;
    }
    if (!state.currentQuote || state.currentQuote.quoteStatus !== 'CLOSED') {
        alert('You must finalize the quote before uploading.');
        return;
    }
    try {
        const response = await fetch('/api/quote/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.currentQuote)
        });
        if (!response.ok) throw new Error('Server error');
        const { r2Url } = await response.json();
        hasUploaded = true;
        setDownloadLinks(r2Url);
        enableDownloadButtons();
        alert('Quote finalized and uploaded!');
    } catch (err) {
        alert('Upload failed: ' + err.message);
    }
}

function setDownloadLinks(r2Url) {
    downloadPdfButton.href = r2Url + '.pdf';
    downloadExcelButton.href = r2Url + '.xlsx';
}

function enableDownloadButtons() {
    downloadPdfButton.disabled = false;
    downloadExcelButton.disabled = false;
}

// Bootstrap
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
