const BLOCKED_POLICIES = new Set([
  'danger-full-access',
  'dangerously-bypass-approvals-and-sandbox',
  'allow-everything',
]);

const SANDBOX_VALUES = new Set(['read-only', 'workspace-write']);

export interface PolicyExecConfig {
  sandbox?: string;
  profile?: string;
}

export function resolvePolicy(policy: string): PolicyExecConfig {
  const trimmed = policy?.trim();
  if (!trimmed) {
    throw new Error('policy is required');
  }

  if (BLOCKED_POLICIES.has(trimmed)) {
    throw new Error(
      `Policy ${trimmed} is not permitted. Choose a read-only or workspace-write sandbox or a trusted profile.`
    );
  }

  if (SANDBOX_VALUES.has(trimmed)) {
    return { sandbox: trimmed };
  }

  return { profile: trimmed };
}
