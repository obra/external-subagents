import { describe, it, expect } from 'vitest';
import { codexBackend, claudeBackend, getBackend } from '../src/lib/backends.ts';

describe('backends', () => {
  describe('getBackend', () => {
    it('returns codex backend by name', () => {
      const backend = getBackend('codex');
      expect(backend.name).toBe('codex');
      expect(backend.command).toBe('codex');
    });

    it('throws when claude backend is disabled', () => {
      const prev = process.env.CODEX_SUBAGENT_ENABLE_CLAUDE;
      try {
        delete process.env.CODEX_SUBAGENT_ENABLE_CLAUDE;
        expect(() => getBackend('claude')).toThrow('Claude backend is disabled');
      } finally {
        if (prev === undefined) {
          delete process.env.CODEX_SUBAGENT_ENABLE_CLAUDE;
        } else {
          process.env.CODEX_SUBAGENT_ENABLE_CLAUDE = prev;
        }
      }
    });

    it('returns claude backend when enabled', () => {
      const prev = process.env.CODEX_SUBAGENT_ENABLE_CLAUDE;
      try {
        process.env.CODEX_SUBAGENT_ENABLE_CLAUDE = '1';
        const backend = getBackend('claude');
        expect(backend.name).toBe('claude');
        expect(backend.command).toBe('claude');
      } finally {
        if (prev === undefined) {
          delete process.env.CODEX_SUBAGENT_ENABLE_CLAUDE;
        } else {
          process.env.CODEX_SUBAGENT_ENABLE_CLAUDE = prev;
        }
      }
    });

    it('throws for unknown backend', () => {
      expect(() => getBackend('unknown' as 'codex')).toThrow('Unknown backend: unknown');
    });
  });

  describe('codexBackend', () => {
    describe('buildArgs', () => {
      it('builds basic args', () => {
        const args = codexBackend.buildArgs({});
        expect(args).toContain('exec');
        expect(args).toContain('--json');
        expect(args).toContain('--skip-git-repo-check');
        expect(args.at(-1)).toBe('-');
      });

      it('includes permissions when specified', () => {
        const args = codexBackend.buildArgs({ permissions: 'workspace-write' });
        expect(args).toContain('--sandbox');
        expect(args).toContain('workspace-write');
      });

      it('includes profile when specified', () => {
        const args = codexBackend.buildArgs({ profile: 'my-profile' });
        expect(args).toContain('--profile');
        expect(args).toContain('my-profile');
      });

      it('includes extra args', () => {
        const args = codexBackend.buildArgs({ extraArgs: ['--foo', 'bar'] });
        expect(args).toContain('--foo');
        expect(args).toContain('bar');
      });
    });

    describe('parseEvent', () => {
      it('parses thread.started event', () => {
        const event = { type: 'thread.started', thread_id: 'thread-abc123' };
        const parsed = codexBackend.parseEvent(event);
        expect(parsed.kind).toBe('session_started');
        expect(parsed.sessionId).toBe('thread-abc123');
      });

      it('parses item.completed agent_message event', () => {
        const event = {
          type: 'item.completed',
          item: {
            id: 'item_5',
            type: 'agent_message',
            text: 'Hello world',
          },
        };
        const parsed = codexBackend.parseEvent(event);
        expect(parsed.kind).toBe('assistant_message');
        expect(parsed.message?.text).toBe('Hello world');
        expect(parsed.message?.rawId).toBe('item_5');
      });

      it('ignores non-agent_message items', () => {
        const event = {
          type: 'item.completed',
          item: {
            id: 'item_1',
            type: 'command_execution',
            command: 'ls -la',
          },
        };
        const parsed = codexBackend.parseEvent(event);
        expect(parsed.kind).toBe('other');
      });

      it('parses turn.completed event', () => {
        const event = { type: 'turn.completed', usage: {} };
        const parsed = codexBackend.parseEvent(event);
        expect(parsed.kind).toBe('completed');
      });

      it('returns other for unknown events', () => {
        const event = { type: 'unknown.event' };
        const parsed = codexBackend.parseEvent(event);
        expect(parsed.kind).toBe('other');
      });
    });

    describe('formatError', () => {
      it('formats basic error', () => {
        const msg = codexBackend.formatError('spawn error', '', '');
        expect(msg).toBe('codex exec failed: spawn error');
      });

      it('adds hint for missing profile', () => {
        const msg = codexBackend.formatError('failed', 'config profile foo not found', '');
        expect(msg).toContain('Recovery hint:');
        expect(msg).toContain('profile');
      });

      it('adds hint for command not found', () => {
        const msg = codexBackend.formatError('failed', 'command not found', '');
        expect(msg).toContain('Recovery hint:');
        expect(msg).toContain('codex');
      });
    });
  });

  describe('claudeBackend', () => {
    describe('buildArgs', () => {
      it('builds basic args with default acceptEdits permission', () => {
        const args = claudeBackend.buildArgs({});
        expect(args).toContain('-p');
        expect(args).toContain('--output-format');
        expect(args).toContain('stream-json');
        expect(args).toContain('--permission-mode');
        // Default when no permissions specified maps to acceptEdits (workspace-write)
        expect(args).toContain('acceptEdits');
        expect(args.at(-1)).toBe('-');
      });

      it('includes model when specified', () => {
        const args = claudeBackend.buildArgs({ model: 'opus' });
        expect(args).toContain('--model');
        expect(args).toContain('opus');
      });

      it('maps read-only permissions to plan mode', () => {
        const args = claudeBackend.buildArgs({ permissions: 'read-only' });
        expect(args).toContain('--permission-mode');
        expect(args).toContain('plan');
      });

      it('maps workspace-write permissions to acceptEdits mode', () => {
        const args = claudeBackend.buildArgs({ permissions: 'workspace-write' });
        expect(args).toContain('--permission-mode');
        expect(args).toContain('acceptEdits');
      });

      it('includes extra args', () => {
        const args = claudeBackend.buildArgs({ extraArgs: ['--agent', 'my-agent'] });
        expect(args).toContain('--agent');
        expect(args).toContain('my-agent');
      });
    });

    describe('parseEvent', () => {
      it('parses system init event', () => {
        const event = {
          type: 'system',
          subtype: 'init',
          session_id: 'session-xyz789',
          tools: [],
          model: 'claude-sonnet-4',
        };
        const parsed = claudeBackend.parseEvent(event);
        expect(parsed.kind).toBe('session_started');
        expect(parsed.sessionId).toBe('session-xyz789');
      });

      it('parses assistant message event', () => {
        const event = {
          type: 'assistant',
          message: {
            id: 'msg_123',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello, Jesse!' }],
          },
          session_id: 'session-xyz',
        };
        const parsed = claudeBackend.parseEvent(event);
        expect(parsed.kind).toBe('assistant_message');
        expect(parsed.message?.text).toBe('Hello, Jesse!');
        expect(parsed.message?.rawId).toBe('msg_123');
      });

      it('handles assistant message with no text content', () => {
        const event = {
          type: 'assistant',
          message: {
            id: 'msg_456',
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Bash' }],
          },
        };
        const parsed = claudeBackend.parseEvent(event);
        expect(parsed.kind).toBe('assistant_message');
        expect(parsed.message?.text).toBeUndefined();
      });

      it('parses result event', () => {
        const event = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done!',
        };
        const parsed = claudeBackend.parseEvent(event);
        expect(parsed.kind).toBe('completed');
      });

      it('parses error result event as completed', () => {
        const event = {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
        };
        const parsed = claudeBackend.parseEvent(event);
        expect(parsed.kind).toBe('completed');
      });

      it('ignores system hook_response events', () => {
        const event = {
          type: 'system',
          subtype: 'hook_response',
          session_id: 'session-xyz',
        };
        const parsed = claudeBackend.parseEvent(event);
        expect(parsed.kind).toBe('other');
      });

      it('returns other for unknown events', () => {
        const event = { type: 'user', message: {} };
        const parsed = claudeBackend.parseEvent(event);
        expect(parsed.kind).toBe('other');
      });
    });

    describe('formatError', () => {
      it('formats basic error', () => {
        const msg = claudeBackend.formatError('spawn error', '', '');
        expect(msg).toBe('claude failed: spawn error');
      });

      it('adds hint for command not found', () => {
        const msg = claudeBackend.formatError('failed', 'command not found', '');
        expect(msg).toContain('Recovery hint:');
        expect(msg).toContain('claude');
      });

      it('adds hint for API key issues', () => {
        const msg = claudeBackend.formatError('failed', 'ANTHROPIC_API_KEY not set', '');
        expect(msg).toContain('Recovery hint:');
        expect(msg).toContain('ANTHROPIC_API_KEY');
      });
    });
  });
});
