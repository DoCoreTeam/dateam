'use client'

// 개발자센터 CLI 명령 절 (P0158 I08)
// 목록은 손으로 적지 않는다, 정의 표 생성물(lib/actions/generated/openapi.json)을 이 절을 열 때만 받아 그린다
import { useEffect, useMemo, useState } from 'react'
import { API_CLI_DOC, API_KEY_SCOPE } from '@/lib/terms'
import type { Scope } from '@/lib/actions/types'

interface CliRow {
  cli: string
  scope: Scope
  method: string
  path: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(spec: any): CliRow[] {
  const out: CliRow[] = []
  for (const [path, item] of Object.entries(spec?.paths ?? {})) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [method, op] of Object.entries(item as Record<string, any>)) {
      if (op?.['x-cli']) out.push({ cli: op['x-cli'], scope: op['x-scope'], method: method.toUpperCase(), path })
    }
  }
  return out.sort((a, b) => a.cli.localeCompare(b.cli))
}

export default function CliSection() {
  const [rows, setRows] = useState<CliRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    import('@/lib/actions/generated/openapi.json')
      .then((m) => { if (alive) setRows(rowsOf(m.default ?? m)) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows ?? []).filter((r) => !t || r.cli.includes(t) || r.path.toLowerCase().includes(t))
  }, [rows, q])

  return (
    <section aria-labelledby="cli-title">
      <h2 id="cli-title" style={{ fontSize: 'var(--fs-xl)', margin: '0 0 var(--space-2)' }}>{API_CLI_DOC.title}</h2>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-4)' }}>{API_CLI_DOC.description}</p>
      {failed && <p role="alert">{API_CLI_DOC.failed}</p>}
      {!failed && !rows && <p role="status">{API_CLI_DOC.loading}</p>}
      {rows && (
        <>
          <input type="search" className="input-field" placeholder={API_CLI_DOC.search} aria-label={API_CLI_DOC.search}
            value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '20rem', marginBottom: 'var(--space-3)' }} />
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 var(--space-2)' }}>
            {API_CLI_DOC.total} {rows.length.toLocaleString()} / {shown.length.toLocaleString()}
          </p>
          {/* 문서의 명령 목록이라 정렬과 쪽 넘김을 붙이지 않는다, 검색 한 칸으로 찾는다 */}
          <ul aria-label={API_CLI_DOC.command} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((r) => (
              <li key={`${r.method} ${r.path}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 5rem minmax(0, 3fr)', gap: 'var(--space-2)', padding: 'var(--space-2) 0', borderBottom: 'var(--hairline) solid var(--border-light)' }}>
                <code style={{ overflowWrap: 'anywhere' }}>teamda {r.cli}</code>
                <code title={API_KEY_SCOPE[r.scope]}>{r.scope}</code>
                <code style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{r.method} {r.path}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
