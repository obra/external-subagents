import path from 'node:path';

/**
 * Unified permission levels across backends.
 */
export type PermissionLevel = 'read-only' | 'workspace-write';

/**
 * Normalized event from any backend's JSONL stream.
 */
export interface ParsedEvent {
  kind: 'session_started' | 'assistant_message' | 'completed' | 'other';
  sessionId?: string;
  message?: {
    text?: string;
    raw: unknown;
    rawId?: string;
  };
}

/**
 * Backend-specific configuration for spawning and parsing.
 */
export interface Backend {
  name: string;
  command: string;
  buildArgs(options: BackendExecOptions): string[];
  parseEvent(event: Record<string, unknown>): ParsedEvent;
  formatError(baseMessage: string, stderr: string, stdout: string): string;
}

/**
 * Options passed to backend.buildArgs().
 */
export interface BackendExecOptions {
  outputLastPath?: string;
  permissions?: PermissionLevel;
  /** Codex-only: custom profile name (overrides permissions) */
  profile?: string;
  extraArgs?: string[];
  model?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Codex CLI backend (codex exec --json)
 */
export const codexBackend: Backend = {
  name: 'codex',
  command: 'codex',

  buildArgs(options) {
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (options.outputLastPath) {
      args.push('--output-last-message', path.resolve(options.outputLastPath));
    }
    // Profile takes precedence over permissions
    if (options.profile) {
      args.push('--profile', options.profile);
    } else if (options.permissions) {
      // permissions maps directly to Codex sandbox values
      args.push('--sandbox', options.permissions);
    }
    if (options.extraArgs && options.extraArgs.length > 0) {
      args.push(...options.extraArgs);
    }
    args.push('-');
    return args;
  },

  parseEvent(event) {
    const eventType = typeof event.type === 'string' ? event.type : undefined;

    if (eventType === 'thread.started' && typeof event.thread_id === 'string') {
      return { kind: 'session_started', sessionId: event.thread_id };
    }

    if (
      eventType === 'item.completed' &&
      isRecord(event.item) &&
      event.item.type === 'agent_message'
    ) {
      const item = event.item as Record<string, unknown>;
      return {
        kind: 'assistant_message',
        message: {
          text: typeof item.text === 'string' ? item.text : undefined,
          raw: item,
          rawId: typeof item.id === 'string' ? item.id : undefined,
        },
      };
    }

    if (eventType === 'turn.completed') {
      return { kind: 'completed' };
    }

    return { kind: 'other' };
  },

  formatError(baseMessage, stderr, stdout) {
    const haystack = `${stderr}\n${stdout}`.toLowerCase();
    let hint: string | undefined;

    if (haystack.includes('config profile') && haystack.includes('not found')) {
      hint =
        'The requested policy maps to a Codex config profile that does not exist. Use the built-in policies (workspace-write/read-only) or create the profile via `codex config`.';
    } else if (haystack.includes('failed to initialize rollout recorder')) {
      hint =
        'Codex CLI could not initialize its rollout recorder. Rerun your parent codex session with --dangerously-bypass-approvals-and-sandbox or from an environment where the rollout recorder is permitted.';
    } else if (haystack.includes('command not found')) {
      hint = 'Verify that the `codex` CLI is installed and available on PATH in this environment.';
    }

    return hint ? `codex exec failed: ${baseMessage}\nRecovery hint: ${hint}` : `codex exec failed: ${baseMessage}`;
  },
};

/**
 * Claude Code CLI backend (claude -p --output-format stream-json)
 */
export const claudeBackend: Backend = {
  name: 'claude',
  command: 'claude',

  buildArgs(options) {
    const args = ['-p', '--output-format', 'stream-json'];

    if (options.model) {
      args.push('--model', options.model);
    }

    // Map unified permissions to Claude's permission mode
    const permissionMode = options.permissions === 'read-only'
      ? 'plan'  // plan mode is read-only in Claude
      : 'acceptEdits';  // workspace-write maps to acceptEdits
    args.push('--permission-mode', permissionMode);

    if (options.extraArgs && options.extraArgs.length > 0) {
      args.push(...options.extraArgs);
    }

    // Prompt comes via stdin
    args.push('-');
    return args;
  },

  parseEvent(event) {
    const eventType = typeof event.type === 'string' ? event.type : undefined;

    // Session init: {"type":"system","subtype":"init","session_id":"..."}
    if (
      eventType === 'system' &&
      event.subtype === 'init' &&
      typeof event.session_id === 'string'
    ) {
      return { kind: 'session_started', sessionId: event.session_id };
    }

    // Assistant message: {"type":"assistant","message":{...},"session_id":"..."}
    if (eventType === 'assistant' && isRecord(event.message)) {
      const msg = event.message as Record<string, unknown>;
      const content = Array.isArray(msg.content)
        ? (msg.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')
        : undefined;

      return {
        kind: 'assistant_message',
        message: {
          text: content?.text,
          raw: event,
          rawId: typeof msg.id === 'string' ? msg.id : undefined,
        },
      };
    }

    // Result: {"type":"result","subtype":"success"|"error_*",...}
    if (eventType === 'result') {
      return { kind: 'completed' };
    }

    return { kind: 'other' };
  },

  formatError(baseMessage, stderr, stdout) {
    const haystack = `${stderr}\n${stdout}`.toLowerCase();
    let hint: string | undefined;

    if (haystack.includes('command not found')) {
      hint = 'Verify that the `claude` CLI is installed and available on PATH in this environment.';
    } else if (haystack.includes('anthropic_api_key')) {
      hint = 'Ensure ANTHROPIC_API_KEY is set or you are logged in via `claude login`.';
    }

    return hint ? `claude failed: ${baseMessage}\nRecovery hint: ${hint}` : `claude failed: ${baseMessage}`;
  },
};

/**
 * Get backend by name.
 */
export function getBackend(name: 'codex' | 'claude'): Backend {
  switch (name) {
    case 'codex':
      return codexBackend;
    case 'claude':
      return claudeBackend;
    default:
      throw new Error(`Unknown backend: ${name}`);
  }
}
