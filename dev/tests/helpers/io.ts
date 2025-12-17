import { Writable } from 'node:stream';

export interface CapturedOutput {
  stdout: Writable;
  output: string[];
}

export function captureOutput(): CapturedOutput {
  const output: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output.push(chunk.toString());
      callback();
    },
  });
  return { stdout, output };
}
