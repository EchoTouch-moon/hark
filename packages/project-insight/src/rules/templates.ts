const TITLE_KEYS = new Set([
  'test_failure_observed',
  'test_result_changed',
  'observation_gap_detected',
  'observer_health_degraded',
  'repository_unavailable',
]);

const DETAIL_KEYS = new Set([
  'test_failure_observed_detail',
  'test_result_changed_detail',
  'observation_gap_detected_detail',
  'observer_health_degraded_detail',
  'repository_unavailable_detail',
]);

const MAX_STRING = 200;
const HOMEISH = /(?:\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+)/gi;

export function assertTemplateKeys(titleKey: string, detailKey: string): void {
  if (!TITLE_KEYS.has(titleKey) || !DETAIL_KEYS.has(detailKey)) {
    throw new Error(`unknown template keys ${titleKey}/${detailKey}`);
  }
}

export function sanitizeTemplateValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return String(value).slice(0, MAX_STRING);
  const stripped = [...value.replace(HOMEISH, '[path]')].filter((ch) => ch.charCodeAt(0) >= 32).join('');
  return stripped.length > MAX_STRING ? stripped.slice(0, MAX_STRING) : stripped;
}

export function sanitizeTemplateData(
  data: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(data).slice(0, 16)) {
    out[key.slice(0, 64)] = sanitizeTemplateValue(value);
  }
  return out;
}

export function renderTitle(titleKey: string, data: Record<string, string | number | boolean | null>): string {
  switch (titleKey) {
    case 'test_failure_observed':
      return `Observed failures in test report ${String(data['relativePath'] ?? 'unknown')}`;
    case 'test_result_changed':
      return `Observed result changed for report ${String(data['relativePath'] ?? 'unknown')}`;
    case 'observation_gap_detected':
      return 'Observation gap detected';
    case 'observer_health_degraded':
      return 'Repeated collection errors';
    case 'repository_unavailable':
      return 'Repository remained unavailable';
    default:
      return titleKey;
  }
}

export function renderDetail(detailKey: string, data: Record<string, string | number | boolean | null>): string {
  switch (detailKey) {
    case 'test_failure_observed_detail':
      return `The report at ${String(data['relativePath'] ?? 'unknown')} contained failures. Commit binding is undetermined.`;
    case 'test_result_changed_detail':
      return `Same report path moved from ${String(data['previousFailed'] ?? '?')} to ${String(data['currentFailed'] ?? '?')} failures. Commit binding is undetermined.`;
    case 'observation_gap_detected_detail':
      return `There is an observation gap of ${String(data['gapMs'] ?? '?')} ms. Activity during the gap is unknown.`;
    case 'observer_health_degraded_detail':
      return `Collection errors repeated ${String(data['count'] ?? '?')} times for ${String(data['subject'] ?? 'source')}.`;
    case 'repository_unavailable_detail':
      return 'The repository stayed unavailable across repeated observations.';
    default:
      return detailKey;
  }
}
