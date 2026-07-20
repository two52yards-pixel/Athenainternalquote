import fs from 'node:fs/promises';
import path from 'node:path';

const policyPath = path.resolve(process.cwd(), 'logs', 'matching-policy.json');

const DEFAULT_POLICY = {
  enableBusinessRules: true,
  minAutoMatchConfidence: 'medium'
};

function normalizePolicy(policy = {}) {
  const rawConfidence = String(policy.minAutoMatchConfidence || DEFAULT_POLICY.minAutoMatchConfidence).toLowerCase();
  const minAutoMatchConfidence = ['low', 'medium', 'high'].includes(rawConfidence)
    ? rawConfidence
    : DEFAULT_POLICY.minAutoMatchConfidence;

  return {
    enableBusinessRules: policy.enableBusinessRules !== false,
    minAutoMatchConfidence
  };
}

export async function loadMatchingPolicy() {
  try {
    const content = await fs.readFile(policyPath, 'utf8');
    const parsed = JSON.parse(content);
    return normalizePolicy(parsed);
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export async function saveMatchingPolicy(policy) {
  const normalized = normalizePolicy(policy);
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}
