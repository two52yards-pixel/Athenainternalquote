const GBP_USD_RATE = 1.5;

function safeNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeCurrency(value) {
  const normalized = String(value || 'GBP').trim().toUpperCase();
  return normalized === 'USD' ? 'USD' : 'GBP';
}

function formatCurrency(value, currency = 'GBP') {
  const numericValue = safeNumber(value);
  const symbol = currency === 'USD' ? '$' : '£';
  return `${symbol}${numericValue.toFixed(2)}`;
}

function formatWholeCurrency(value, currency = 'GBP') {
  const numericValue = Math.round(safeNumber(value));
  const symbol = currency === 'USD' ? '$' : '£';
  const formatter = new Intl.NumberFormat('en-GB');
  return `${symbol}${formatter.format(numericValue)}`;
}

function convertCurrency(value, fromCurrency, toCurrency) {
  const numericValue = safeNumber(value);
  const sourceCurrency = normalizeCurrency(fromCurrency);
  const targetCurrency = normalizeCurrency(toCurrency);

  if (sourceCurrency === targetCurrency) {
    return numericValue;
  }

  if (sourceCurrency === 'GBP' && targetCurrency === 'USD') {
    return numericValue * GBP_USD_RATE;
  }

  return numericValue / GBP_USD_RATE;
}

function describeBudgetStatus(differenceAmount, percentDifference) {
  const absoluteDifference = Math.abs(differenceAmount);
  const percentage = Math.abs(percentDifference).toFixed(0);

  if (percentDifference <= 0 || percentDifference <= 5) {
    return {
      tone: 'green',
      label: 'Within acceptable range',
      detail: 'Within budget'
    };
  }

  if (percentDifference <= 10) {
    return {
      tone: 'orange',
      label: `${formatWholeCurrency(absoluteDifference, 'GBP')} Above Budget (+${percentage}%)`,
      detail: 'Review recommended'
    };
  }

  return {
    tone: 'red',
    label: `${formatWholeCurrency(absoluteDifference, 'GBP')} Above Budget (+${percentage}%)`,
    detail: 'Review required'
  };
}

export function hasBudget(quote = {}) {
  return safeNumber(quote?.budget) > 0;
}

export function analyzeBudgetQuote(quote = {}) {
  if (!hasBudget(quote)) {
    return null;
  }

  const budgetCurrency = normalizeCurrency(quote.budgetCurrency);
  const budgetValue = safeNumber(quote.budget);
  const budgetGbp = convertCurrency(budgetValue, budgetCurrency, 'GBP');
  const draftTotalGbp = safeNumber(quote?.summary?.totalValue);
  const draftTotalUsd = convertCurrency(draftTotalGbp, 'GBP', 'USD');
  const oppositeCurrency = budgetCurrency === 'USD' ? 'GBP' : 'USD';
  const convertedBudget = convertCurrency(budgetValue, budgetCurrency, oppositeCurrency);
  const differenceAmount = draftTotalGbp - budgetGbp;
  const budgetPercent = budgetGbp === 0 ? 0 : (differenceAmount / budgetGbp) * 100;
  const status = describeBudgetStatus(differenceAmount, budgetPercent);

  return {
    budgetCurrency,
    budgetValue,
    budgetGbp,
    draftTotalGbp,
    draftTotalUsd,
    oppositeCurrency,
    convertedBudget,
    differenceAmount,
    budgetPercent,
    status,
    // Aliases expected by app.js
    tone: status.tone,
    inputDisplay: formatWholeCurrency(budgetValue, budgetCurrency),
    budgetStatusDisplay: status.label,
    budgetAdvice: status.detail,
    budgetLabel: `${formatWholeCurrency(budgetValue, budgetCurrency)} (${budgetCurrency})`,
    budgetEquivalentLabel: `${formatCurrency(convertedBudget, oppositeCurrency)}`,
    draftLabel: `£${draftTotalGbp.toFixed(2)}`,
    draftUsdLabel: `${formatCurrency(draftTotalUsd, 'USD')}`,
    detailLabel: `${formatWholeCurrency(Math.abs(differenceAmount), 'GBP')} ${differenceAmount >= 0 ? 'Above Budget' : 'Below Budget'} (${Math.abs(budgetPercent).toFixed(0)}%)`
  };
}

export function getTopLineTotalItems(items = [], limit = 3) {
  return [...items]
    .filter((item) => Number.isFinite(Number(item?.total)) && Number(item.total) > 0)
    .sort((left, right) => Number(right.total) - Number(left.total))
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      total: Number(item.total || 0)
    }));
}

export {
  GBP_USD_RATE,
  convertCurrency,
  formatCurrency,
  formatWholeCurrency,
  normalizeCurrency
};
