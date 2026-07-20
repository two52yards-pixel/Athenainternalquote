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

function getBudgetStatusTone(percentDifference) {
  if (percentDifference <= 0 || percentDifference <= 5) {
    return 'green';
  }

  if (percentDifference <= 10) {
    return 'orange';
  }

  return 'red';
}

function describeBudgetStatus(differenceAmount, percentDifference) {
  const absoluteDifference = Math.abs(differenceAmount);
  const sign = differenceAmount >= 0 ? 'Above Budget' : 'Below Budget';
  const percentage = Math.abs(percentDifference).toFixed(0);

  if (percentDifference <= 0) {
    return {
      kind: 'green',
      label: 'Within acceptable range',
      detail: 'Within budget'
    };
  }

  if (percentDifference <= 5) {
    return {
      kind: 'green',
      label: 'Within acceptable range',
      detail: 'Within budget tolerance'
    };
  }

  if (percentDifference <= 10) {
    return {
      kind: 'orange',
      label: `${formatWholeCurrency(absoluteDifference, 'GBP')} ${sign} (+${percentage}%)`,
      detail: 'Review recommended'
    };
  }

  return {
    kind: 'red',
    label: `${formatWholeCurrency(absoluteDifference, 'GBP')} ${sign} (+${percentage}%)`,
    detail: 'Review required'
  };
}

export function hasBudget(quote) {
  const rawBudget = safeNumber(quote?.budget);
  return Number.isFinite(rawBudget) && rawBudget > 0;
}

export function getBudgetAnalysis(quote = {}) {
  if (!hasBudget(quote)) {
    return null;
  }

  const budgetCurrency = normalizeCurrency(quote.budgetCurrency);
  const budgetValue = safeNumber(quote.budget);
  const draftTotalGbp = safeNumber(quote?.summary?.totalValue);
  const budgetGbp = convertCurrency(budgetValue, budgetCurrency, 'GBP');
  const convertedOppositeCurrency = convertCurrency(budgetValue, budgetCurrency, 'GBP' === budgetCurrency ? 'USD' : 'GBP');
  const draftTotalUsd = convertCurrency(draftTotalGbp, 'GBP', 'USD');
  const differenceAmount = draftTotalGbp - budgetGbp;
  const percentDifference = budgetGbp === 0 ? 0 : (differenceAmount / budgetGbp) * 100;
  const budgetStatus = describeBudgetStatus(differenceAmount, percentDifference);
  const oppositeCurrency = budgetCurrency === 'USD' ? 'GBP' : 'USD';

  return {
    GBP_USD_RATE,
    budgetCurrency,
    budgetValue,
    budgetGbp,
    draftTotalGbp,
    draftTotalUsd,
    convertedOppositeCurrency,
    oppositeCurrency,
    budgetStatus,
    percentDifference,
    differenceAmount,
    tone: budgetStatus.kind,
    inputDisplay: formatWholeCurrency(budgetValue, budgetCurrency),
    convertedDisplay: formatCurrency(convertedOppositeCurrency, oppositeCurrency),
    budgetStatusDisplay: budgetStatus.label,
    budgetAdvice: budgetStatus.detail,
    displayText: {
      clientBudgetTitle: `Client Budget (${budgetCurrency})`,
      statusTitle: 'Budget Status',
      draftConversionLabel: `≈ ${formatCurrency(draftTotalUsd, 'USD')}`
    }
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
