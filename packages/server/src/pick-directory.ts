import { spawn } from 'node:child_process';

// Windows notes: after a FolderBrowserDialog has been shown, the PowerShell STA
// process routinely fails to exit on its own (even [Environment]::Exit hangs),
// and Add-Type -TypeDefinition occasionally stalls before the dialog appears.
// So the script avoids runtime compilation, prints a DONE marker, and Node
// terminates the child from the outside as soon as the marker arrives. The
// dialog is kept above the browser with a 1x1 owner form parked offscreen:
// an owned window sits above its owner in the z-order, so once the owner is
// topmost the dialog rides above every non-topmost window — which plain
// SetForegroundWindow/AppActivate cannot achieve because Windows denies
// foreground switches to background processes. ShowDialog strips the owner's
// WS_EX_TOPMOST on open (Opacity=0 and the classic -32000 park position also
// strip it), so a Forms.Timer inside the modal loop re-asserts TopMost every
// tick and additionally calls WScript.Shell AppActivate once to grab keyboard
// focus when Windows allows it.
const WINDOWS_PICKER = `Add-Type -AssemblyName System.Windows.Forms; $owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.FormBorderStyle = 'None'; $owner.Size = New-Object System.Drawing.Size(1, 1); $owner.StartPosition = 'Manual'; $owner.Location = New-Object System.Drawing.Point(-2000, -2000); $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.ShowNewFolderButton = $true; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ws = New-Object -ComObject WScript.Shell; $timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 150; $script:activated = $false; $timer.Add_Tick({ $owner.TopMost = $true; if (-not $script:activated -and $ws.AppActivate([int]$PID)) { $script:activated = $true } }); $timer.Start(); $owner.Show(); $out = ''; try { if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $out = $dialog.SelectedPath } } catch { [Console]::Error.Write($_.Exception.Message); [Console]::Error.Flush() }; $owner.Close(); $owner.Dispose(); [Console]::Write($out + "\`nDONE"); [Console]::Out.Flush(); Stop-Process -Id $PID -Force`;

const DONE_MARKER = '\nDONE';

export function directoryPickerCommand(platform = process.platform): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-Command', WINDOWS_PICKER] };
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', 'POSIX path of (choose folder with prompt "Select a project folder")'] };
  return { command: 'zenity', args: ['--file-selection', '--directory', '--title=Select a project folder'] };
}

type PickResult = { code: number | null; stdout: string; stderr: string };

export const directoryPicker = {
  run(command: string, args: string[]): Promise<PickResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (!settled && stdout.includes(DONE_MARKER)) {
          settled = true;
          child.kill();
          resolve({ code: null, stdout, stderr });
        }
      });
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          resolve({ code, stdout, stderr });
        }
      });
    });
  },
};

export async function pickDirectory(): Promise<string | null> {
  const { command, args } = directoryPickerCommand();
  const result = await directoryPicker.run(command, args);
  if (process.platform === 'win32') {
    if (result.stderr.trim()) throw new Error(result.stderr.trim());
    return (result.stdout.split(DONE_MARKER)[0] ?? '').trim() || null;
  }
  if (result.code === 0) return result.stdout.trim() || null;
  if (result.code === 1) return null;
  throw new Error(result.stderr.trim() || `Folder picker exited with code ${result.code ?? 'unknown'}`);
}
