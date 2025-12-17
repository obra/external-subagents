import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export interface PersonaDefinition {
  name: string;
  description?: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  permissions?: string;
  prompt: string;
}

export interface PersonaRuntime extends PersonaDefinition {
  skillDocs: string[];
}

interface PersonaLoadOptions {
  projectRoot?: string;
  superpowersRoot?: string;
}

const DEFAULT_PROJECT_CLAUDE_DIR = '.codex/agents';
const DEFAULT_SUPERPOWERS_ENV = 'SUPERPOWERS_ROOT';

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveSuperpowersAgentsDir(explicitRoot?: string): string | undefined {
  const envRoot = process.env[DEFAULT_SUPERPOWERS_ENV];
  if (envRoot) {
    return path.join(envRoot, 'agents');
  }
  if (explicitRoot) {
    return path.join(explicitRoot, 'agents');
  }
  // Fallback: look relative to the CLI executable
  if (process.argv[1]) {
    const cliDir = path.dirname(process.argv[1]);
    return path.resolve(cliDir, 'agents');
  }
  return undefined;
}

async function readPersonaFile(filePath: string): Promise<PersonaDefinition> {
  const raw = await readFile(filePath, 'utf8');
  const match = raw.match(/^---\s*\n([\s\S]+?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Persona file ${filePath} is missing YAML frontmatter.`);
  }
  const frontMatter = parseYaml(match[1]) ?? {};
  const body = match[2]?.trim() ?? '';
  if (!body) {
    throw new Error(`Persona file ${filePath} is missing prompt content.`);
  }
  const definition: PersonaDefinition = {
    name: frontMatter.name ?? path.basename(filePath, path.extname(filePath)),
    description: frontMatter.description,
    tools: normalizeStringArray(frontMatter.tools),
    skills: normalizeStringArray(frontMatter.skills),
    model: typeof frontMatter.model === 'string' ? frontMatter.model.trim() : undefined,
    permissions:
      typeof frontMatter.permissions === 'string'
        ? frontMatter.permissions.trim()
        : undefined,
    prompt: body,
  };
  return definition;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return undefined;
}

export async function loadPersona(
  personaName: string,
  options: PersonaLoadOptions = {}
): Promise<PersonaDefinition> {
  const searchDirs: string[] = [];
  const projectRoot = options.projectRoot ?? process.cwd();
  searchDirs.push(path.join(projectRoot, DEFAULT_PROJECT_CLAUDE_DIR));
  searchDirs.push(path.join(os.homedir(), '.codex', 'agents'));
  const superpowersAgents = resolveSuperpowersAgentsDir(options.superpowersRoot);
  if (superpowersAgents) {
    searchDirs.push(superpowersAgents);
  }

  for (const dir of searchDirs) {
    const personaPath = path.join(dir, `${personaName}.md`);
    if (await pathExists(personaPath)) {
      return readPersonaFile(personaPath);
    }
  }

  throw new Error(
    `Persona "${personaName}" not found in .codex/agents, ~/.codex/agents, or superpowers agents directories.`
  );
}

function getSkillPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.codex', 'skills'),
    path.join(home, '.codex', 'superpowers', 'skills'),
  ];
}

export async function loadSkillDocuments(skillNames: string[] = []): Promise<string[]> {
  const contents: string[] = [];
  for (const skill of skillNames) {
    const baseName = skill.trim();
    if (!baseName) {
      continue;
    }
    let skillFound = false;
    for (const base of getSkillPaths()) {
      const candidate = path.join(base, baseName, 'SKILL.md');
      if (await pathExists(candidate)) {
        const raw = await readFile(candidate, 'utf8');
        contents.push(`Skill ${baseName}:\n${raw.trim()}`);
        skillFound = true;
        break;
      }
    }
    if (!skillFound) {
      contents.push(`Skill ${baseName}: (definition not found locally)`);
    }
  }
  return contents;
}

export async function loadPersonaRuntime(
  personaName: string,
  options: PersonaLoadOptions = {}
): Promise<PersonaRuntime> {
  const definition = await loadPersona(personaName, options);
  const skillDocs = await loadSkillDocuments(definition.skills ?? []);
  return { ...definition, skillDocs };
}

import type { PermissionLevel } from './backends.ts';

export interface ModelPermissionsResult {
  permissions?: PermissionLevel;
  warning?: string;
}

export function mapModelAliasToPermissions(alias?: string): ModelPermissionsResult {
  if (!alias) {
    return {};
  }
  const normalized = alias.trim().toLowerCase();
  switch (normalized) {
    case 'inherit':
      return {};
    case 'haiku':
      return { permissions: 'read-only' };
    case 'sonnet':
      return { permissions: 'workspace-write' };
    case 'opus':
      return {
        permissions: 'workspace-write',
        warning:
          'Persona model "opus" mapped to workspace-write; specify --permissions manually if needed.',
      };
    default:
      return {
        warning: `Unknown persona model "${alias}"; using the provided --permissions value instead.`,
      };
  }
}
