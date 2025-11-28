import type { PersonaRuntime } from './personas.ts';

export function applyWorkingDirectoryInstruction(body: string, workingDir: string): string {
  const normalized = workingDir.trim();
  const instructionLines = [
    `You are working inside ${normalized}.`,
    `Before running commands, ensure your shell is at ${normalized} (e.g., run 'cd ${normalized}').`,
    'Do not modify files outside this directory unless explicitly instructed.',
  ];
  const instruction = instructionLines.join(' ');
  return `${instruction}\n\n${body}`;
}

export function composePrompt(
  body: string,
  options: { workingDir?: string; persona?: PersonaRuntime }
): string {
  let result = body;
  if (options.workingDir) {
    result = applyWorkingDirectoryInstruction(result, options.workingDir);
  }

  if (!options.persona) {
    return result;
  }

  const personaSections = [] as string[];
  const header = options.persona.description
    ? `${options.persona.name}: ${options.persona.description}`
    : `${options.persona.name}`;
  personaSections.push(`Persona ${header}`);
  personaSections.push(options.persona.prompt);
  if (options.persona.skillDocs.length > 0) {
    personaSections.push(options.persona.skillDocs.join('\n\n'));
  }

  return `${personaSections.join('\n\n')}\n\n${result}`;
}
