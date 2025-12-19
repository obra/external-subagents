import process from 'node:process';
import { Writable } from 'node:stream';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { runStartThreadWorkflow } from '../lib/start-thread.ts';
import { loadPersonaRuntime, mapModelAliasToPermissions, PersonaRuntime } from '../lib/personas.ts';
import { StartManifest } from '../lib/start-manifest.ts';
import { composePrompt } from '../lib/prompt.ts';
import { LaunchRegistry } from '../lib/launch-registry.ts';
import { Paths } from '../lib/paths.ts';
import { validateSpawnedWorker } from '../lib/spawn-validation.ts';
import { isClaudeBackendEnabled, type PermissionLevel } from '../lib/backends.ts';

export interface StartCommandOptions {
  rootDir?: string;
  role?: string;
  /** Permission level: 'read-only' or 'workspace-write' */
  permissions?: PermissionLevel;
  /** Codex-only: custom profile name (overrides permissions) */
  profile?: string;
  promptFile?: string;
  promptBody?: string;
  manifest?: StartManifest;
  outputLastPath?: string;
  stdout?: Writable;
  controllerId: string;
  wait?: boolean;
  workingDir?: string;
  label?: string;
  personaName?: string;
  printPrompt?: boolean;
  dryRun?: boolean;
  cliPath?: string;
  /** Backend to use: 'codex' (default) or 'claude' */
  backend?: 'codex' | 'claude';
  /** Model to use (e.g., 'sonnet', 'opus', 'haiku') */
  model?: string;
}

interface ResolvedManifestTask {
  promptBody?: string;
  promptFile?: string;
  role: string;
  permissions: PermissionLevel;
  profile?: string;
  workingDir?: string;
  label?: string;
  personaName?: string;
  wait: boolean;
  outputLastPath?: string;
}

interface ManifestResult {
  index: number;
  label?: string;
  mode: 'waited' | 'detached';
  threadId?: string;
}

export async function startCommand(options: StartCommandOptions): Promise<string | undefined> {
  const stdout = options.stdout ?? process.stdout;
  const projectRoot = getProjectRoot(options.rootDir);
  const paths = new Paths(options.rootDir ? path.resolve(options.rootDir) : undefined);
  const launchRegistry = new LaunchRegistry(paths);
  const personaCache = new Map<string, PersonaRuntime>();

  if (options.backend === 'claude' && !isClaudeBackendEnabled()) {
    throw new Error('Claude backend is disabled. Set CODEX_SUBAGENT_ENABLE_CLAUDE=1 to enable it.');
  }

  if (options.manifest) {
    if (options.promptFile || options.promptBody) {
      throw new Error('Manifest mode does not accept --prompt-file or inline prompt text.');
    }
    await runManifestStart({
      stdout,
      controllerId: options.controllerId,
      manifest: options.manifest,
      baseOptions: options,
      projectRoot,
      personaCache,
      launchRegistry,
    });
    return undefined;
  }

  const role = options.role;
  if (!role) {
    throw new Error('start command requires --role');
  }
  const permissions = options.permissions;
  if (!permissions) {
    throw new Error('start command requires --permissions');
  }

  const prompt = ensurePromptSource(
    { promptFile: options.promptFile, promptBody: options.promptBody },
    'start command'
  );

  const persona = options.personaName
    ? await loadPersonaCached(options.personaName, projectRoot, personaCache)
    : undefined;
  const { permissions: resolvedPermissions, profile: resolvedProfile } = applyPersonaPermissions(permissions, options.profile, persona);

  const promptFile = prompt.promptFile;
  let promptBody = prompt.promptBody;

  if (options.printPrompt || options.dryRun) {
    if (!promptBody && !promptFile) {
      throw new Error('start command requires prompt content before printing.');
    }
    if (!promptBody && promptFile) {
      promptBody = await readFile(promptFile, 'utf8');
    }
    const preview = composePrompt(promptBody ?? '', {
      workingDir: options.workingDir,
      persona,
    });
    stdout.write(`${preview}\n`);
    if (options.dryRun) {
      stdout.write('Dry run: Codex exec not started.\n');
      return undefined;
    }
  }

  if (options.wait) {
    const backendName = options.backend === 'claude' ? 'Claude' : 'Codex';
    const labelHint = options.label ? ` (${options.label})` : '';
    stdout.write(`Running ${backendName}${labelHint}... (this may take minutes)\n`);

    // Track progress for heartbeat
    const startTime = Date.now();
    let lineCount = 0;
    const onProgress = (count: number) => {
      lineCount = count;
    };

    // Heartbeat every 30s so caller knows we're not dead
    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timestamp = new Date().toLocaleTimeString();
      stdout.write(`[${timestamp}] Still running... (${mins}m ${secs}s, ${lineCount} events)\n`);
    }, 30_000);

    try {
      const result = await runStartThreadWorkflow({
        rootDir: options.rootDir,
        role,
        permissions: resolvedPermissions,
        profile: resolvedProfile,
        promptFile: promptBody ? undefined : promptFile,
        promptBody,
        outputLastPath: options.outputLastPath,
        controllerId: options.controllerId,
        workingDir: options.workingDir,
        label: options.label,
        persona,
        onProgress,
        backend: options.backend,
        model: options.model,
      });
      stdout.write(`Started thread ${result.threadId}\n`);
      return result.threadId;
    } finally {
      clearInterval(heartbeat);
    }
  }

  let launchId: string | undefined;
  if (!options.printPrompt && !options.dryRun) {
    const attempt = await launchRegistry.createAttempt({
      controllerId: options.controllerId,
      type: 'start',
      label: options.label,
      role,
      permissions: resolvedPermissions,
    });
    launchId = attempt.id;
  }

  await launchDetachedWorker({
    rootDir: options.rootDir,
    role,
    permissions: resolvedPermissions,
    profile: resolvedProfile,
    promptFile: promptBody ? undefined : promptFile,
    promptBody,
    outputLastPath: options.outputLastPath,
    controllerId: options.controllerId,
    workingDir: options.workingDir,
    label: options.label,
    persona,
    cliPath: options.cliPath,
    launchId,
    launchRegistry,
    backend: options.backend,
    model: options.model,
  });
  const backendName = options.backend === 'claude' ? 'Claude' : 'Codex';
  stdout.write(
    `Subagent launched in the background; ${backendName} may run for minutes or hours. Use \`codex-subagent list\`, \`peek\`, or \`log\` later to inspect results.\n`
  );
  return undefined;
}

async function runManifestStart(args: {
  stdout: Writable;
  controllerId: string;
  manifest: StartManifest;
  baseOptions: StartCommandOptions;
  projectRoot: string;
  personaCache: Map<string, PersonaRuntime>;
  launchRegistry: LaunchRegistry;
}): Promise<void> {
  const baseDir =
    args.manifest.source && args.manifest.source !== 'stdin'
      ? path.dirname(path.resolve(args.manifest.source))
      : process.cwd();
  const tasks = resolveManifestTasks(args.manifest, args.baseOptions, baseDir);
  if (tasks.length === 0) {
    throw new Error('Manifest did not contain any tasks to launch.');
  }

  // Preload personas to fail fast before launching anything.
  const personaNames = Array.from(
    new Set(tasks.map((task) => task.personaName).filter((name): name is string => Boolean(name)))
  );
  for (const name of personaNames) {
    await loadPersonaCached(name, args.projectRoot, args.personaCache);
  }

  const results: ManifestResult[] = [];
  for (const [index, task] of tasks.entries()) {
    const persona = task.personaName
      ? await loadPersonaCached(task.personaName, args.projectRoot, args.personaCache)
      : undefined;
    const { permissions: resolvedPermissions, profile: resolvedProfile } = applyPersonaPermissions(task.permissions, task.profile, persona);

    if (task.wait) {
      const result = await runStartThreadWorkflow({
        rootDir: args.baseOptions.rootDir,
        role: task.role,
        permissions: resolvedPermissions,
        profile: resolvedProfile,
        promptFile: task.promptFile,
        promptBody: task.promptBody,
        outputLastPath: task.outputLastPath,
        controllerId: args.controllerId,
        workingDir: task.workingDir,
        label: task.label,
        persona,
        backend: args.baseOptions.backend,
        model: args.baseOptions.model,
      });
      results.push({
        index,
        label: task.label,
        mode: 'waited',
        threadId: result.threadId,
      });
    } else {
      const attempt = await args.launchRegistry.createAttempt({
        controllerId: args.controllerId,
        type: 'start',
        label: task.label,
        role: task.role,
        permissions: resolvedPermissions,
      });
      await launchDetachedWorker({
        rootDir: args.baseOptions.rootDir,
        role: task.role,
        permissions: resolvedPermissions,
        profile: resolvedProfile,
        promptFile: task.promptFile,
        promptBody: task.promptBody,
        outputLastPath: task.outputLastPath,
        controllerId: args.controllerId,
        workingDir: task.workingDir,
        label: task.label,
        persona,
        cliPath: args.baseOptions.cliPath,
        launchId: attempt.id,
        launchRegistry: args.launchRegistry,
        backend: args.baseOptions.backend,
        model: args.baseOptions.model,
      });
      results.push({
        index,
        label: task.label,
        mode: 'detached',
      });
    }
  }

  args.stdout.write(
    `Launched ${results.length} manifest task${results.length === 1 ? '' : 's'}:\n`
  );
  for (const result of results) {
    const label = result.label ?? `Task ${result.index + 1}`;
    const threadInfo =
      result.mode === 'waited' ? `thread ${result.threadId ?? '[unknown]'}` : 'thread pending';
    args.stdout.write(`- [${result.index}] ${label} · ${result.mode} · ${threadInfo}\n`);
  }
}

function resolveManifestTasks(
  manifest: StartManifest,
  options: StartCommandOptions,
  baseDir: string
): ResolvedManifestTask[] {
  const defaults = manifest.defaults ?? {};
  return manifest.tasks.map((task, index) => {
    const promptBody =
      task.prompt && task.prompt.trim().length > 0 ? task.prompt : options.promptBody;
    const promptFile = task.promptFile ?? options.promptFile;
    if (!promptBody && !promptFile) {
      throw new Error(
        `Manifest task ${index} is missing a prompt. Provide "prompt" text or "promptFile".`
      );
    }

    const role = task.role ?? options.role ?? defaults.role;
    if (!role) {
      throw new Error(
        `Manifest task ${index} is missing a role. Set it on the task, defaults.role, or --role.`
      );
    }

    const permissions = (task.permissions ?? options.permissions ?? defaults.permissions) as PermissionLevel | undefined;
    if (!permissions) {
      throw new Error(
        `Manifest task ${index} is missing permissions. Set it on the task, defaults.permissions, or --permissions.`
      );
    }

    const workingDir = task.cwd ?? defaults.cwd ?? options.workingDir;
    const outputLast = task.outputLast ?? defaults.outputLast ?? options.outputLastPath;
    return {
      promptBody,
      promptFile: resolvePathRelative(promptFile, baseDir),
      role,
      permissions,
      profile: task.profile ?? options.profile ?? defaults.profile,
      workingDir: resolvePathRelative(workingDir, baseDir),
      label: task.label ?? defaults.label ?? options.label,
      personaName: task.persona ?? defaults.persona ?? options.personaName,
      wait: task.wait ?? options.wait ?? defaults.wait ?? false,
      outputLastPath: resolvePathRelative(outputLast, baseDir),
    };
  });
}

function resolvePathRelative(value: string | undefined, baseDir: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

async function loadPersonaCached(
  name: string,
  projectRoot: string,
  cache: Map<string, PersonaRuntime>
): Promise<PersonaRuntime> {
  if (cache.has(name)) {
    return cache.get(name)!;
  }
  const persona = await loadPersonaRuntime(name, { projectRoot });
  cache.set(name, persona);
  return persona;
}

function applyPersonaPermissions(
  basePermissions: PermissionLevel,
  baseProfile: string | undefined,
  persona?: PersonaRuntime
): { permissions: PermissionLevel; profile?: string } {
  let permissions = basePermissions;
  const profile = baseProfile;
  if (persona?.model) {
    const mapping = mapModelAliasToPermissions(persona.model);
    if (mapping.warning) {
      process.stderr.write(`${mapping.warning}\n`);
    }
    if (mapping.permissions) {
      permissions = mapping.permissions;
    }
  }
  return { permissions, profile };
}

function ensurePromptSource(
  source: { promptFile?: string; promptBody?: string },
  context: string
): { promptFile?: string; promptBody?: string } {
  if (source.promptBody && source.promptBody.trim().length > 0) {
    return { promptBody: source.promptBody };
  }
  if (source.promptFile) {
    return { promptFile: path.resolve(source.promptFile) };
  }
  throw new Error(`${context} requires prompt content (file or inline body).`);
}

interface DetachedWorkerOptions {
  rootDir?: string;
  role: string;
  permissions: PermissionLevel;
  profile?: string;
  promptFile?: string;
  promptBody?: string;
  outputLastPath?: string;
  controllerId: string;
  workingDir?: string;
  label?: string;
  persona?: PersonaRuntime;
  cliPath?: string;
  launchId?: string;
  launchRegistry?: LaunchRegistry;
  backend?: 'codex' | 'claude';
  model?: string;
}

async function launchDetachedWorker(options: DetachedWorkerOptions): Promise<void> {
  const cliPath = resolveCliPath(options.cliPath);
  const payloadData = {
    rootDir: options.rootDir ? path.resolve(options.rootDir) : undefined,
    role: options.role,
    permissions: options.permissions,
    profile: options.profile,
    promptFile: options.promptFile ? path.resolve(options.promptFile) : undefined,
    promptBody: options.promptBody ?? undefined,
    outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
    controllerId: options.controllerId,
    workingDir: options.workingDir ? path.resolve(options.workingDir) : undefined,
    label: options.label,
    persona: options.persona ?? null,
    launchId: options.launchId,
    backend: options.backend,
    model: options.model,
  };

  const payload = Buffer.from(JSON.stringify(payloadData), 'utf8').toString('base64');
  const child = spawn(process.execPath, [cliPath, 'worker-start', '--payload', payload], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr during validation
  });
  child.unref();

  const validation = await validateSpawnedWorker(child, 500);
  if (!validation.healthy) {
    if (options.launchRegistry && options.launchId) {
      await options.launchRegistry.markFailure(options.launchId, {
        error: new Error(validation.error ?? 'Worker failed to start'),
      });
    }
    throw new Error(`Detached worker failed to start: ${validation.error}`);
  }
}

function resolveCliPath(overridePath?: string): string {
  if (overridePath) {
    return path.resolve(overridePath);
  }
  if (process.argv[1]) {
    return process.argv[1];
  }
  throw new Error('Cannot determine CLI path: process.argv[1] is not set');
}

function getProjectRoot(rootDir?: string): string {
  if (rootDir) {
    return path.resolve(path.resolve(rootDir), '..');
  }
  return process.cwd();
}
