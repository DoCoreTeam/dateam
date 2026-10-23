/**
 * OS credential store. The key is never written to a plain file.
 *
 * macOS   `security -i` with the command on stdin, so the key is not on any process argv.
 *         (`security add-generic-password -w <key>` would put it in `ps` output for a moment;
 *         `-w` with no value prompts on a TTY, which an agent cannot answer.)
 * Windows PowerShell calling advapi32 CredWrite/CredRead; the key goes in on stdin.
 * Linux   `secret-tool store`, which reads the secret from stdin.
 * memory  process-local map, selected by TEAMDA_CREDENTIAL_BACKEND=memory. For tests only;
 *         a login with it is lost when the process exits.
 */
import type { Context } from './context.ts'
import { CliError, EXIT } from './exit.ts'

export interface CredentialStore {
  name: string
  get(): Promise<string | null>
  set(key: string): Promise<void>
  remove(): Promise<void>
}

const SERVICE = 'teamda'
const ACCOUNT = 'default'

/** Keys are url-safe tokens. Anything else is refused, which also keeps the stdin commands unambiguous. */
export const KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{16,512}$/

function unavailable(message: string): CliError {
  return new CliError(EXIT.AUTH, { code: 'credential_store_unavailable', message })
}

interface RunResult { code: number; stdout: string }

async function run(cmd: string[], stdin?: string): Promise<RunResult> {
  let proc
  try {
    proc = Bun.spawn(cmd, { stdin: stdin === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'ignore' })
  } catch {
    throw unavailable(`cannot run ${cmd[0]}`)
  }
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin)
    await proc.stdin.end()
  }
  const stdout = await new Response(proc.stdout).text()
  const code = await proc.exited
  return { code, stdout }
}

const memory = new Map<string, string>()

function memoryStore(): CredentialStore {
  return {
    name: 'memory',
    get: async () => memory.get(ACCOUNT) ?? null,
    set: async (key) => { memory.set(ACCOUNT, key) },
    remove: async () => { memory.delete(ACCOUNT) },
  }
}

function macosStore(): CredentialStore {
  return {
    name: 'macos-keychain',
    async get() {
      const r = await run(['security', 'find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'])
      return r.code === 0 ? r.stdout.trim() || null : null
    },
    async set(key) {
      // -U updates an existing item. The line is read by security's own parser, not a shell.
      const line = `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w "${key}"\n`
      const r = await run(['security', '-i'], line)
      if (r.code !== 0) throw unavailable('macOS keychain refused the write')
    },
    async remove() {
      await run(['security', 'delete-generic-password', '-s', SERVICE, '-a', ACCOUNT])
    },
  }
}

const WIN_TYPES = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TeamdaCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL c, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr c);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr p);
  public static void Write(string target, string user, string secret) {
    byte[] b = Encoding.Unicode.GetBytes(secret);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = target; c.UserName = user; c.Persist = 2;
    c.CredentialBlobSize = b.Length; c.CredentialBlob = Marshal.AllocHGlobal(b.Length);
    try {
      Marshal.Copy(b, 0, c.CredentialBlob, b.Length);
      if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
}
"@
`

const WIN_ACTIONS = {
  get: `$v = [TeamdaCred]::Read('${SERVICE}'); if ($v -ne $null) { [Console]::Out.Write($v) }`,
  set: `$s = [Console]::In.ReadToEnd().Trim(); [TeamdaCred]::Write('${SERVICE}', '${ACCOUNT}', $s)`,
  remove: `[void][TeamdaCred]::CredDelete('${SERVICE}', 1, 0)`,
}

function powershell(action: keyof typeof WIN_ACTIONS, stdin?: string): Promise<RunResult> {
  const script = `${WIN_TYPES}\n${WIN_ACTIONS[action]}\n`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], stdin)
}

function windowsStore(): CredentialStore {
  return {
    name: 'windows-credential-manager',
    async get() {
      const r = await powershell('get')
      return r.code === 0 ? r.stdout.trim() || null : null
    },
    async set(key) {
      const r = await powershell('set', key)
      if (r.code !== 0) throw unavailable('Windows Credential Manager refused the write')
    },
    async remove() { await powershell('remove') },
  }
}

function linuxStore(): CredentialStore {
  const attrs = ['service', SERVICE, 'account', ACCOUNT]
  return {
    name: 'secret-service',
    async get() {
      const r = await run(['secret-tool', 'lookup', ...attrs])
      return r.code === 0 ? r.stdout.trim() || null : null
    },
    async set(key) {
      const r = await run(['secret-tool', 'store', `--label=${SERVICE}`, ...attrs], key)
      if (r.code !== 0) throw unavailable('secret-tool refused the write (is a keyring running?)')
    },
    async remove() { await run(['secret-tool', 'clear', ...attrs]) },
  }
}

export function credentialStore(ctx: Context): CredentialStore {
  const chosen = ctx.env.TEAMDA_CREDENTIAL_BACKEND
  if (chosen === 'memory') return memoryStore()
  if (chosen === 'macos' || (!chosen && ctx.platform === 'darwin')) return macosStore()
  if (chosen === 'windows' || (!chosen && ctx.platform === 'win32')) return windowsStore()
  if (chosen === 'linux' || (!chosen && ctx.platform === 'linux')) return linuxStore()
  throw unavailable(`no credential store for platform ${ctx.platform}; use TEAMDA_API_KEY`)
}

export interface ResolvedKey { key: string; source: 'env' | 'store' }

/** TEAMDA_API_KEY first (CI), then the OS store. */
export async function resolveKey(ctx: Context): Promise<ResolvedKey | null> {
  const fromEnv = ctx.env.TEAMDA_API_KEY?.trim()
  if (fromEnv) return { key: fromEnv, source: 'env' }
  try {
    const stored = await credentialStore(ctx).get()
    return stored ? { key: stored, source: 'store' } : null
  } catch {
    return null
  }
}
