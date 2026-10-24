import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export function revealCommand(filePath: string, platform = process.platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: ['-R', filePath] };
  if (platform === 'win32') return { command: 'explorer', args: [`/select,${filePath}`] };
  return { command: 'xdg-open', args: [path.dirname(filePath)] };
}

export const revealOpener = {
  spawn(command: string, args: string[]): void {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
  },
};

export async function revealFile(filePath: string): Promise<void> {
  await fs.stat(path.dirname(filePath));
  const { command, args } = revealCommand(filePath);
  revealOpener.spawn(command, args);
}
