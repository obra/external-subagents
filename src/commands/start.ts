import process from 'node:process';
import { Writable } from 'node:stream';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runStartThreadWorkflow } from '../lib/start-thread.ts';
import { loadPersonaRuntime, mapModelAliasToPolicy, PersonaRuntime } from '../lib/personas.ts';
import { StartManifest } from '../lib/start-manifest.ts';

export interface StartCommandOptions {
  rootDir?: string;
  role?: string;
  policy?: string;
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
}

interface ResolvedManifestTask {
  promptBody?: string;
  promptFile?: string;
  role: string;
  policy: string;
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

const WORKER_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../start-runner.js'
);

export async function startCommand(options: StartCommandOptions): Promise<string | undefined> {
  const stdout = options.stdout ?? process.stdout;
  const projectRoot = getProjectRoot(options.rootDir);
  const personaCache = new Map<string, PersonaRuntime>();

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
    });
    return undefined;
  }

  const role = options.role;
  if (!role) {
    throw new Error('start command requires --role');
  }
  const policy = options.policy;
  if (!policy) {
    throw new Error('start command requires --policy');
  }

  const prompt = ensurePromptSource(
    { promptFile: options.promptFile, promptBody: options.promptBody },
    'start command'
  );

  const persona = options.personaName
    ? await loadPersonaCached(options.personaName, projectRoot, personaCache)
    : undefined;
  const resolvedPolicy = applyPersonaPolicy(policy, persona);

  if (options.wait) {
    const result = await runStartThreadWorkflow({
      rootDir: options.rootDir,
      role,
      policy: resolvedPolicy,
      promptFile: prompt.promptFile,
      promptBody: prompt.promptBody,
      outputLastPath: options.outputLastPath,
      controllerId: options.controllerId,
      workingDir: options.workingDir,
      label: options.label,
      persona,
    });
    stdout.write(`Started thread ${result.threadId}\n`);
    return result.threadId;
  }

  launchDetachedWorker({
    rootDir: options.rootDir,
    role,
    policy: resolvedPolicy,
    promptFile: prompt.promptFile,
    promptBody: prompt.promptBody,
    outputLastPath: options.outputLastPath,
    controllerId: options.controllerId,
    workingDir: options.workingDir,
    label: options.label,
    persona,
  });
  stdout.write(
    'Subagent launched in the background; Codex may run for minutes or hours. Use `codex-subagent list`, `peek`, or `log` later to inspect results.\n'
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
    const resolvedPolicy = applyPersonaPolicy(task.policy, persona);

    if (task.wait) {
      const result = await runStartThreadWorkflow({
        rootDir: args.baseOptions.rootDir,
        role: task.role,
        policy: resolvedPolicy,
        promptFile: task.promptFile,
        promptBody: task.promptBody,
        outputLastPath: task.outputLastPath,
        controllerId: args.controllerId,
        workingDir: task.workingDir,
        label: task.label,
        persona,
      });
      results.push({
        index,
        label: task.label,
        mode: 'waited',
        threadId: result.threadId,
      });
    } else {
      launchDetachedWorker({
        rootDir: args.baseOptions.rootDir,
        role: task.role,
        policy: resolvedPolicy,
        promptFile: task.promptFile,
        promptBody: task.promptBody,
        outputLastPath: task.outputLastPath,
        controllerId: args.controllerId,
        workingDir: task.workingDir,
        label: task.label,
        persona,
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
      result.mode === 'waited'
        ? `thread ${result.threadId ?? '[unknown]'}` :
          'thread pending';
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

    const policy = task.policy ?? options.policy ?? defaults.policy;
    if (!policy) {
      throw new Error(
        `Manifest task ${index} is missing a policy. Set it on the task, defaults.policy, or --policy.`
      );
    }

    const workingDir = task.cwd ?? defaults.cwd ?? options.workingDir;
    const outputLast = task.outputLast ?? defaults.outputLast ?? options.outputLastPath;
    return {
      promptBody,
      promptFile: resolvePathRelative(promptFile, baseDir),
      role,
      policy,
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

function applyPersonaPolicy(basePolicy: string, persona?: PersonaRuntime): string {
  let policy = basePolicy;
  if (persona?.model) {
    const mapping = mapModelAliasToPolicy(persona.model);
    if (mapping.warning) {
      process.stderr.write(`${mapping.warning}\n`);
    }
    if (mapping.policy) {
      policy = mapping.policy;
    }
  }
  return policy;
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
  policy: string;
  promptFile?: string;
  promptBody?: string;
  outputLastPath?: string;
  controllerId: string;
  workingDir?: string;
  label?: string;
  persona?: PersonaRuntime;
}

function launchDetachedWorker(options: DetachedWorkerOptions): void {
  const payloadData = {
    rootDir: options.rootDir ? path.resolve(options.rootDir) : undefined,
    role: options.role,
    policy: options.policy,
    promptFile: options.promptFile ? path.resolve(options.promptFile) : undefined,
    promptBody: options.promptBody ?? undefined,
    outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
    controllerId: options.controllerId,
    workingDir: options.workingDir ? path.resolve(options.workingDir) : undefined,
    label: options.label,
    persona: options.persona ?? null,
  };

  const payload = Buffer.from(JSON.stringify(payloadData), 'utf8').toString('base64');
  const child = spawn(process.execPath, [WORKER_SCRIPT, '--payload', payload], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function getProjectRoot(rootDir?: string): string {
  if (rootDir) {
    return path.resolve(path.resolve(rootDir), '..');
  }
  return process.cwd();
}
