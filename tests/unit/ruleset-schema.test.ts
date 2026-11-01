import { describe, expect, it } from 'vitest';
import {
  loadTemplateFiles,
  rulesAreSemanticallyEqual,
  validateRuleset,
} from '../../scripts/validate-rulesets';

type Json = unknown;

/** Loose but typed shape used only to mutate test fixtures without `any`. */
interface MutableRuleset {
  name: string;
  target: string;
  enforcement: string;
  bypass_actors: unknown[];
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: Array<{ type: string; parameters?: Record<string, unknown> }>;
}

const canonical = (): MutableRuleset => ({
  name: 'protect-master',
  target: 'branch',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { include: ['refs/heads/master'], exclude: [] } },
  rules: [
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'ci-gate', integration_id: 15368 }],
        strict_required_status_checks_policy: true,
      },
    },
    { type: 'non_fast_forward' },
    { type: 'deletion' },
  ],
});

const mutate = (mutator: (obj: MutableRuleset) => void): Json => {
  const obj = JSON.parse(JSON.stringify(canonical())) as MutableRuleset;
  mutator(obj);
  return obj as Json;
};

describe('validate-rulesets against the locked G2 policy', () => {
  it('accepts the canonical master template', () => {
    expect(validateRuleset(canonical(), 'refs/heads/master', 'protect-master')).toEqual([]);
  });

  it('loads and accepts both real files on disk', () => {
    const { master, g0 } = loadTemplateFiles();
    expect(validateRuleset(master, 'refs/heads/master', 'protect-master')).toEqual([]);
    expect(validateRuleset(g0, 'refs/heads/bot/hearth-g0-contract', 'protect-g0')).toEqual([]);
  });

  it('reports that master and G0 share identical rule semantics', () => {
    const { master, g0 } = loadTemplateFiles();
    expect(rulesAreSemanticallyEqual(master, g0)).toBe(true);
  });

  it('rejects a ruleset that targets tags instead of branches', () => {
    const errors = validateRuleset(mutate((o) => void (o.target = 'tag')), 'refs/heads/master', 'protect-master');
    expect(errors.some((e) => e.includes('target'))).toBe(true);
  });

  it('rejects any approval count above zero', () => {
    const errors = validateRuleset(
      mutate((o) => {
        o.rules[0]!.parameters!.required_approving_review_count = 1;
      }),
      'refs/heads/master',
      'protect-master',
    );
    expect(errors.some((e) => e.includes('required_approving_review_count'))).toBe(true);
  });

  it('rejects a missing deletion rule', () => {
    const errors = validateRuleset(
      mutate((o) => {
        o.rules.splice(
          o.rules.findIndex((r) => r.type === 'deletion'),
          1,
        );
      }),
      'refs/heads/master',
      'protect-master',
    );
    expect(errors.some((e) => e.includes('deletion'))).toBe(true);
  });

  it('rejects a wildcard or default-branch ref pattern', () => {
    for (const include of ['~DEFAULT_BRANCH', 'refs/heads/*', 'refs/heads/**']) {
      const errors = validateRuleset(
        mutate((o) => {
          o.conditions.ref_name.include = [include];
        }),
        'refs/heads/master',
        'protect-master',
      );
      expect(errors.some((e) => e.includes('include')), `include=${include}`).toBe(true);
    }
  });

  it('rejects a status check that is not bound to the Actions app id', () => {
    const errors = validateRuleset(
      mutate((o) => {
        const sc = o.rules.find((r) => r.type === 'required_status_checks')!;
        sc.parameters!.required_status_checks = [{ context: 'ci-gate' }];
      }),
      'refs/heads/master',
      'protect-master',
    );
    expect(errors.some((e) => e.includes('integration_id'))).toBe(true);
  });

  it('rejects a non-empty bypass actor list', () => {
    const errors = validateRuleset(
      mutate((o) => {
        o.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
      }),
      'refs/heads/master',
      'protect-master',
    );
    expect(errors.some((e) => e.includes('bypass_actors'))).toBe(true);
  });

  it('rejects an unexpected extra rule type', () => {
    const errors = validateRuleset(
      mutate((o) => {
        o.rules.push({ type: 'required_signatures' });
      }),
      'refs/heads/master',
      'protect-master',
    );
    expect(errors.some((e) => e.includes('unexpected rule type'))).toBe(true);
  });

  it('still treats name and target as the only allowed differences', () => {
    const g0 = mutate((o) => {
      o.name = 'protect-g0';
      o.conditions.ref_name.include = ['refs/heads/bot/hearth-g0-contract'];
    });
    expect(rulesAreSemanticallyEqual(canonical(), g0)).toBe(true);
  });

  it('flags an enforcement mismatch as a semantic difference', () => {
    const relaxed = mutate((o) => {
      o.enforcement = 'evaluate';
    });
    expect(rulesAreSemanticallyEqual(canonical(), relaxed)).toBe(false);
  });
});
