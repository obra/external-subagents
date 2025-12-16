export interface StartManifestTask {
  prompt?: string;
  promptFile?: string;
  role?: string;
  permissions?: string;
  profile?: string;
  cwd?: string;
  label?: string;
  persona?: string;
  outputLast?: string;
  wait?: boolean;
}

export type StartManifestDefaults = Omit<StartManifestTask, 'prompt' | 'promptFile'>;

export interface StartManifest {
  tasks: StartManifestTask[];
  defaults?: StartManifestDefaults;
  source?: string;
}

function ensureArray(value: unknown, sourceLabel: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Manifest ${sourceLabel} must provide an array of tasks.`);
  }
  return value;
}

function toStringOrUndefined(value: unknown, field: string, allowEmpty = false): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Manifest field "${field}" must be a string.`);
  }
  if (!allowEmpty && value.trim().length === 0) {
    return undefined;
  }
  return value;
}

function toBooleanOrUndefined(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Manifest field "${field}" must be a boolean.`);
  }
  return value;
}

function normalizeTask(raw: unknown, index: number): StartManifestTask {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Manifest task ${index} must be an object.`);
  }
  const record = raw as Record<string, unknown>;
  return {
    prompt: toStringOrUndefined(record.prompt ?? record.prompt_body, `tasks[${index}].prompt`, true),
    promptFile: toStringOrUndefined(
      record.promptFile ?? record.prompt_file,
      `tasks[${index}].promptFile`
    ),
    role: toStringOrUndefined(record.role, `tasks[${index}].role`),
    permissions: toStringOrUndefined(record.permissions, `tasks[${index}].permissions`),
    profile: toStringOrUndefined(record.profile, `tasks[${index}].profile`),
    cwd: toStringOrUndefined(record.cwd, `tasks[${index}].cwd`),
    label: toStringOrUndefined(record.label, `tasks[${index}].label`),
    persona: toStringOrUndefined(record.persona, `tasks[${index}].persona`),
    outputLast: toStringOrUndefined(
      record.outputLast ?? record.output_last,
      `tasks[${index}].outputLast`
    ),
    wait: toBooleanOrUndefined(record.wait, `tasks[${index}].wait`),
  };
}

function normalizeDefaults(raw: unknown): StartManifestDefaults | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Manifest defaults must be an object.');
  }
  const record = raw as Record<string, unknown>;
  const defaults: StartManifestDefaults = {};
  defaults.role = toStringOrUndefined(record.role, 'defaults.role');
  defaults.permissions = toStringOrUndefined(record.permissions, 'defaults.permissions');
  defaults.profile = toStringOrUndefined(record.profile, 'defaults.profile');
  defaults.cwd = toStringOrUndefined(record.cwd, 'defaults.cwd');
  defaults.label = toStringOrUndefined(record.label, 'defaults.label');
  defaults.persona = toStringOrUndefined(record.persona, 'defaults.persona');
  defaults.outputLast = toStringOrUndefined(
    record.outputLast ?? record.output_last,
    'defaults.outputLast'
  );
  defaults.wait = toBooleanOrUndefined(record.wait, 'defaults.wait');
  return defaults;
}

export function parseStartManifest(data: unknown, source = 'manifest'): StartManifest {
  if (Array.isArray(data)) {
    const tasks = ensureArray(data, source).map((task, index) => normalizeTask(task, index));
    return { tasks, source };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Manifest ${source} must be either an array or an object with a tasks array.`);
  }

  const record = data as Record<string, unknown>;
  const rawTasks = record.tasks;
  if (!Array.isArray(rawTasks)) {
    throw new Error(`Manifest ${source} is missing a tasks array.`);
  }

  const tasks = ensureArray(rawTasks, source).map((task, index) => normalizeTask(task, index));
  const defaults = normalizeDefaults(record.defaults);

  return {
    tasks,
    defaults,
    source,
  };
}
