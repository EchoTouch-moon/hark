#!/usr/bin/env node
/**
 * Read-only validator for the G2 ruleset templates.
 *
 * Why this exists
 * ---------------
 * The rulesets are applied with `gh api --method POST ... --input <file>`, so the
 * JSON files are the single source of truth. A hand-written `-f 'rules[][type]'`
 * argument list is exactly the kind of thing that silently produces the wrong
 * nested array. This script checks, before anything is ever sent to GitHub:
 *
 *   1. both files parse and have the expected top-level shape;
 *   2. target is an EXACT branch ref (no `~DEFAULT_BRANCH`, no wildcard), so a
 *      typo can never protect a branch we did not intend to protect;
 *   3. the five rules carry the right parameters, including `context=ci-gate` and
 *      `integration_id=15368`, and the pull_request rule pins approvals to 0;
 *   4. no bypass actor is configured;
 *   5. master and G0 differ only in name and target ref — nothing else.
 *
 * It performs NO network calls and NO writes. It only reads the two local JSON
 * files under `.github/rulesets/`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_REF = {
  master: 'refs/heads/master',
  g0: 'refs/heads/bot/hearth-g0-contract',
} as const;

const REQUIRED_RULE_TYPES = ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion'] as const;

type Json = unknown;

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: Json): string => (typeof value === 'string' ? value : '');

const asNumber = (value: Json): number => (typeof value === 'number' ? value : NaN);

const asBool = (value: Json): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

const asStringArray = (value: Json): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

interface RuleRecord {
  type: string;
  parameters: Record<string, Json> | null;
}

const asRules = (value: Json): RuleRecord[] => {
  if (!Array.isArray(value)) return [];
  const out: RuleRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const type = asString(item['type']);
    if (type === '') continue;
    out.push({ type, parameters: isRecord(item['parameters']) ? item['parameters'] : null });
  }
  return out;
};

const rule = (rules: RuleRecord[], type: string): RuleRecord | undefined => rules.find((r) => r.type === type);

/**
 * Return a list of problems for a ruleset object. An empty list means the ruleset
 * matches the locked G2 policy exactly.
 */
export function validateRuleset(ruleset: Json, expectedRef: string, expectedName: string): string[] {
  const errors: string[] = [];

  if (!isRecord(ruleset)) {
    return ['ruleset is not a JSON object'];
  }

  if (asString(ruleset['name']) !== expectedName) {
    errors.push(`name must be "${expectedName}", got "${asString(ruleset['name'])}"`);
  }
  if (asString(ruleset['target']) !== 'branch') {
    errors.push(`target must be "branch", got "${asString(ruleset['target'])}"`);
  }
  if (asString(ruleset['enforcement']) !== 'active') {
    errors.push(`enforcement must be "active", got "${asString(ruleset['enforcement'])}"`);
  }

  const bypass = ruleset['bypass_actors'];
  if (bypass !== undefined && !(Array.isArray(bypass) && bypass.length === 0)) {
    errors.push('bypass_actors must be an empty array (no bypass)');
  }

  const conditions = isRecord(ruleset['conditions']) ? ruleset['conditions'] : null;
  const refName = conditions && isRecord(conditions['ref_name']) ? conditions['ref_name'] : null;
  if (!refName) {
    errors.push('conditions.ref_name is missing');
  } else {
    const include = asStringArray(refName['include']);
    const exclude = asStringArray(refName['exclude']);
    if (include.length !== 1 || include[0] !== expectedRef) {
      errors.push(
        `conditions.ref_name.include must be exactly ["${expectedRef}"] (exact match, no wildcard); got ${JSON.stringify(include)}`,
      );
    }
    if (exclude.length !== 0) {
      errors.push(`conditions.ref_name.exclude must be empty; got ${JSON.stringify(exclude)}`);
    }
  }

  const rules = asRules(ruleset['rules']);
  for (const type of REQUIRED_RULE_TYPES) {
    if (!rule(rules, type)) errors.push(`missing rule of type "${type}"`);
  }
  const known = new Set<string>(REQUIRED_RULE_TYPES);
  for (const r of rules) {
    if (!known.has(r.type)) errors.push(`unexpected rule type "${r.type}"`);
  }

  const pr = rule(rules, 'pull_request');
  if (pr) {
    const p = pr.parameters ?? {};
    if (asNumber(p['required_approving_review_count']) !== 0) {
      errors.push('pull_request.parameters.required_approving_review_count must be 0');
    }
    if (asBool(p['dismiss_stale_reviews_on_push']) !== true) {
      errors.push('pull_request.parameters.dismiss_stale_reviews_on_push must be true');
    }
    if (asBool(p['require_code_owner_review']) !== false) {
      errors.push('pull_request.parameters.require_code_owner_review must be false');
    }
    if (asBool(p['require_last_push_approval']) !== false) {
      errors.push('pull_request.parameters.require_last_push_approval must be false');
    }
    if (asBool(p['required_review_thread_resolution']) !== false) {
      errors.push('pull_request.parameters.required_review_thread_resolution must be false');
    }
  }

  const sc = rule(rules, 'required_status_checks');
  if (sc) {
    const p = sc.parameters ?? {};
    if (asBool(p['strict_required_status_checks_policy']) !== true) {
      errors.push('required_status_checks.parameters.strict_required_status_checks_policy must be true');
    }
    const checks = Array.isArray(p['required_status_checks']) ? p['required_status_checks'] : [];
    if (checks.length !== 1) {
      errors.push('required_status_checks must contain exactly one check');
    } else {
      const check = isRecord(checks[0]) ? checks[0] : null;
      if (!check || asString(check['context']) !== 'ci-gate') {
        errors.push('the required status check context must be "ci-gate"');
      }
      if (!check || asNumber(check['integration_id']) !== 15368) {
        errors.push('the required status check must bind integration_id 15368 (GitHub Actions)');
      }
    }
  }

  return errors;
}

/** Compare two rulesets ignoring name and target ref; true when policy is identical. */
export function rulesAreSemanticallyEqual(a: Json, b: Json): boolean {
  const strip = (value: Json): string => {
    if (!isRecord(value)) return JSON.stringify(value);
    const copy: Record<string, Json> = { ...value };
    delete copy['name'];
    delete copy['conditions'];
    return JSON.stringify(copy, null, 0);
  };
  return strip(a) === strip(b);
}

export interface LoadedTemplates {
  master: Json;
  g0: Json;
}

/** Read the two template files. Resolves paths relative to this module, not cwd. */
export function loadTemplateFiles(): LoadedTemplates {
  const dir = fileURLToPath(new URL('../.github/rulesets/', import.meta.url));
  return {
    master: JSON.parse(readFileSync(`${dir}protect-master.json`, 'utf8')) as Json,
    g0: JSON.parse(readFileSync(`${dir}protect-g0.json`, 'utf8')) as Json,
  };
}

/* ------------------------------- CLI entry ------------------------------- */

const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
};

function runValidation(): boolean {
  try {
    const { master, g0 } = loadTemplateFiles();
    const masterErrors = validateRuleset(master, EXPECTED_REF.master, 'protect-master');
    const g0Errors = validateRuleset(g0, EXPECTED_REF.g0, 'protect-g0');

    console.log('protect-master.json:', masterErrors.length === 0 ? 'OK' : 'FAIL');
    for (const e of masterErrors) console.log(`  - ${e}`);
    console.log('protect-g0.json:    ', g0Errors.length === 0 ? 'OK' : 'FAIL');
    for (const e of g0Errors) console.log(`  - ${e}`);

    const equivalent = rulesAreSemanticallyEqual(master, g0);
    console.log('master/g0 规则语义一致（仅 name 与 target 不同）:', equivalent ? 'YES' : 'NO');

    return masterErrors.length > 0 || g0Errors.length > 0 || !equivalent;
  } catch (error) {
    console.error(`unable to read or parse ruleset templates: ${String(error)}`);
    return true;
  }
}

if (isDirectRun()) {
  process.exitCode = runValidation() ? 1 : 0;
}
