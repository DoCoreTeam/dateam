'use client'

// 개발자센터 CLI 절의 teamda 받기 (P0167 I04)
// teamda release 와 같은 창구 GET /api/cli/release 를 부른다 (meta.cli.release.get)
// 받기 주소는 창구가 준 600초짜리 서명 주소만 쓴다, 화면에는 키도 버킷 경로도 없다
// 브라우저로 받으면 macOS 격리 표시와 Windows 웹 표시가 붙어 처음 실행이 막힌다 (P0167 I05a)
// 그래서 운영체제별 터미널 명령을 함께 준다, 명령은 lib/cli-release/install-command 가 만든다
import { useCallback, useEffect, useState } from 'react'
import { API_CLI_DOC } from '@/lib/terms'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { installCommandOf } from '@/lib/cli-release/install-command'

type Target = keyof typeof API_CLI_DOC.download.target

interface ReleaseFile {
  target: Target
  fileName: string
  size: number
  sha256: string
  url: string
}

interface Release {
  version: string
  publishedAt: string
  files: ReleaseFile[]
}

type State =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'empty' }
  | { kind: 'failed' }
  | { kind: 'ready'; release: Release }

const T = API_CLI_DOC.download
const MB = 1024 * 1024

/** 이 기기의 운영체제, 맞는 줄을 맨 위에 둔다. 모르면 null, 맥은 처음엔 Apple 실리콘으로 두고 아래에서 가른다 */
function guessTarget(): Target | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows-x64'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'darwin-arm64'
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux-x64'
  return null
}

interface UaData { getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }> }

/** Chromium 계열은 맥의 칩을 알려 준다, Intel 이면 darwin-x64. 못 알면 그대로 둔다 */
async function refineMac(target: Target | null): Promise<Target | null> {
  if (target !== 'darwin-arm64') return target
  const uaData = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
  if (!uaData) return target
  try {
    const { architecture } = await uaData.getHighEntropyValues(['architecture'])
    return architecture === 'x86' ? 'darwin-x64' : target
  } catch {
    return target
  }
}

function sizeText(bytes: number): string {
  return `${(bytes / MB).toFixed(1)}MB`
}

export default function CliDownload() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [mine, setMine] = useState<Target | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/cli/release', { cache: 'no-store' })
      if (res.status === 401) return setState({ kind: 'login' })
      if (!res.ok) return setState({ kind: 'failed' })
      const body = (await res.json()) as { release: Release | null }
      setState(body.release ? { kind: 'ready', release: body.release } : { kind: 'empty' })
    } catch {
      setState({ kind: 'failed' })
    }
  }, [])

  useEffect(() => {
    let alive = true
    const first = guessTarget()
    setMine(first)
    void refineMac(first).then((t) => { if (alive) setMine(t) })
    void load()
    return () => { alive = false }
  }, [load])

  return (
    <section aria-labelledby="cli-download-title" style={{ marginBottom: 'var(--space-6)' }}>
      <h3 id="cli-download-title" style={{ fontSize: 'var(--fs-lg)', margin: '0 0 var(--space-2)' }}>{T.title}</h3>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-3)' }}>{T.description}</p>
      {state.kind === 'loading' && <p role="status">{T.loading}</p>}
      {state.kind === 'login' && (
        <p role="status">
          {T.loginRequired} <a href="/login" className="btn-ghost">{T.login}</a>
        </p>
      )}
      {state.kind === 'empty' && <p role="status">{T.empty}</p>}
      {state.kind === 'failed' && (
        <p role="alert">
          {T.failed} <button type="button" className="btn-ghost" onClick={() => void load()}>{T.retry}</button>
        </p>
      )}
      {state.kind === 'ready' && <ReleaseList release={state.release} mine={mine} />}
    </section>
  )
}

function ReleaseList({ release, mine }: { release: Release; mine: Target | null }) {
  const files = [...release.files].sort((a, b) => Number(b.target === mine) - Number(a.target === mine))
  return (
    <>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 var(--space-2)' }}>
        <span>{T.version} v{release.version}</span>
        <span style={{ marginLeft: 'var(--space-3)' }}>{T.publishedAt} {formatKstDateTimeExact(release.publishedAt)}</span>
      </p>
      <ul aria-label={T.title} style={{ listStyle: 'none', margin: '0 0 var(--space-3)', padding: 0 }}>
        {files.map((f) => (
          <li key={f.target} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', columnGap: 'var(--space-3)', rowGap: 'var(--space-1)', padding: 'var(--space-2) 0', borderBottom: 'var(--hairline) solid var(--border-light)' }}>
            <span style={{ fontWeight: f.target === mine ? 600 : 400 }}>
              {T.target[f.target]}{f.target === mine ? ` (${T.yours})` : ''}
            </span>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }} title={T.size}>{sizeText(f.size)}</span>
            <a href={f.url} download={f.fileName} className={f.target === mine ? 'btn-primary' : 'btn-ghost'} style={{ whiteSpace: 'nowrap' }}>{T.get}</a>
            <code title={T.checksum} style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{T.checksum} {f.sha256}</code>
          </li>
        ))}
      </ul>
      <InstallBlock files={files} mine={mine} />
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{T.unsigned}</p>
    </>
  )
}

type CopyState = 'idle' | 'copied' | 'failed'

/** 운영체제 하나를 골라 그 터미널 명령을 보이고 복사한다. 고르기는 이 절에 한 벌만 둔다 */
function InstallBlock({ files, mine }: { files: ReleaseFile[]; mine: Target | null }) {
  const [picked, setPicked] = useState<Target | null>(null)
  const [copy, setCopy] = useState<CopyState>('idle')
  const current = files.find((f) => f.target === (picked ?? mine)) ?? files[0]
  if (!current) return null
  const cmd = installCommandOf(current.target, current.url, current.fileName)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd.command)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <div style={{ margin: '0 0 var(--space-3)' }}>
      <h4 style={{ fontSize: 'var(--fs-md)', margin: '0 0 var(--space-1)' }}>{T.install.title}</h4>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 var(--space-2)' }}>{T.install.hint}</p>
      <div role="group" aria-label={T.install.targetLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
        {files.map((f) => (
          <button key={f.target} type="button" aria-pressed={f.target === current.target}
            className={f.target === current.target ? 'btn-primary' : 'btn-ghost'}
            onClick={() => { setPicked(f.target); setCopy('idle') }}>
            {T.target[f.target]}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '0 0 var(--space-1)' }}>{T.install.shell[cmd.shell]}</p>
      <pre style={{ margin: '0 0 var(--space-2)', padding: 'var(--space-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--fs-xs)', color: 'var(--text)', background: 'var(--surface-muted)' }}><code>{cmd.command}</code></pre>
      <button type="button" className="btn-ghost" onClick={() => void onCopy()}>{T.install.copy}</button>
      {copy === 'copied' && <span role="status" style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>{T.install.copied}</span>}
      {copy === 'failed' && <span role="alert" style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>{T.install.copyFailed}</span>}
    </div>
  )
}
