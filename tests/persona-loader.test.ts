import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPersonaRuntime, mapModelAliasToPolicy } from '../src/lib/personas.ts';

describe('persona loader', () => {
  it('loads persona from project directory and pulls skills', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'persona-project-'));
    const agentsDir = path.join(projectRoot, '.codex', 'agents');
    await mkdir(agentsDir, { recursive: true });
    const personaBody = `---\nname: reviewer\ndescription: Code reviewer\nskills: skill-alpha\n---\nYou are Reviewer.\n`;
    await writeFile(path.join(agentsDir, 'reviewer.md'), personaBody, 'utf8');

    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'persona-home-'));
    const skillDir = path.join(fakeHome, '.codex', 'skills', 'skill-alpha');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Skill Alpha\nFollow rules.');

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const persona = await loadPersonaRuntime('reviewer', { projectRoot });
    expect(persona.prompt).toContain('You are Reviewer');
    expect(persona.skillDocs.join('\n')).toContain('Skill Alpha');

    homedirSpy.mockRestore();
  });

  it('maps model aliases to policies', () => {
    expect(mapModelAliasToPolicy('haiku').policy).toBe('read-only');
    expect(mapModelAliasToPolicy('sonnet').policy).toBe('workspace-write');
    expect(mapModelAliasToPolicy('inherit').policy).toBeUndefined();
  });
});
