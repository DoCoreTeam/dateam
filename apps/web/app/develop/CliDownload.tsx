'use client'

// 개발자센터 CLI 절의 teamda 받기 (P0167 I04)
// teamda release 와 같은 창구 GET /api/cli/release 를 부른다 (meta.cli.release.get)
// 받기 주소는 창구가 준 600초짜리 서명 주소만 쓴다, 화면에는 키도 버킷 경로도 없다
import { useCallback, useEffect, useState } from 'react'
import { API_CLI_DOC } from '@/lib/terms'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'

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

/** 이 기기의 운영체제, 맞는 줄을 맨 위에 둔다. 모르면 null */
function guessTarget(): Target | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows-x64'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'darwin-arm64'
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux-x64'
  return null
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
    setMine(guessTarget())
    void load()
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
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{T.unsigned}</p>
    </>
  )
}
