'use client'

// 개발자센터 CLI 명령 참조 (P0168)
// 표를 쓰지 않는다: 802개를 표에 넣자 390 폭에서 명령 칸이 1,236번 꺾였다
// 영역별로 접고, 명령은 줄바꿈 없이 옆으로 밀고, 펼친 항목만 내용을 그린다
import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_KEY_SCOPE } from '@/lib/terms'
import type { Scope } from '@/lib/actions/types'
import {
  ACTION_REF_COPY as COPY, buildActionEntries, curlExample, groupActions,
  type ActionRefEntry,
} from '@/lib/api-docs/action-ref'
import CodeBlock from './CodeBlock'
import styles from './develop.module.css'

interface Props {
  /** lib/actions/generated/openapi.json 한 벌, CliSection 이 열 때 받아 넘긴다 */
  spec: unknown
}

const NOWRAP_SCROLL = { display: 'block', whiteSpace: 'nowrap', overflowX: 'auto', maxWidth: '100%' } as const
const MUTED_SM = { fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' } as const

function ActionDetail({ entry, onCopy, copiedId }: { entry: ActionRefEntry; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const [base, setBase] = useState('/api/public/v1')
  useEffect(() => { setBase(`${window.location.origin}/api/public/v1`) }, [])
  return (
    <div style={{ padding: 'var(--space-2) 0 var(--space-3)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-3)' }}>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: 'var(--space-1) var(--space-3)' }}>
        <dt style={MUTED_SM}>{COPY.scope}</dt>
        <dd style={{ margin: 0 }}><code title={API_KEY_SCOPE[entry.scope as Scope]}>{entry.scope}</code></dd>
        <dt style={MUTED_SM}>{COPY.path}</dt>
        <dd style={{ margin: 0, minWidth: 0 }}><code style={NOWRAP_SCROLL}>{entry.method} {entry.path}</code></dd>
      </dl>
      <div>
        <h4 style={{ fontSize: 'var(--fs-sm)', margin: '0 0 var(--space-1)' }}>{COPY.params}</h4>
        {entry.params.length === 0 ? <p style={{ ...MUTED_SM, margin: 0 }}>{COPY.noParams}</p> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-1)' }}>
            {entry.params.map((p) => (
              <li key={`${p.in} ${p.name}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                <code>{p.name}</code>
                <span style={MUTED_SM}>{p.in === 'path' ? COPY.inPath : COPY.inQuery}{p.required ? `, ${COPY.required}` : ''}</span>
                {p.values.length > 0 && <code style={MUTED_SM}>{p.values.join(' | ')}</code>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 style={{ fontSize: 'var(--fs-sm)', margin: '0 0 var(--space-1)' }}>{COPY.body}</h4>
        {entry.bodyFields === null && <p style={{ ...MUTED_SM, margin: 0 }}>{COPY.bodyFree}</p>}
        {entry.bodyFields?.length === 0 && <p style={{ ...MUTED_SM, margin: 0 }}>{COPY.noBody}</p>}
        {entry.bodyFields && entry.bodyFields.length > 0 && (
          <p style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {entry.bodyFields.map((f) => <code key={f}>{f}</code>)}
          </p>
        )}
      </div>
      <div>
        <h4 style={{ fontSize: 'var(--fs-sm)', margin: '0 0 var(--space-1)' }}>{COPY.example}</h4>
        <CodeBlock code={entry.cliExample} id={`${entry.id} cli`} onCopy={onCopy} copiedId={copiedId} lang="teamda" />
        <CodeBlock code={curlExample(entry, base)} id={`${entry.id} curl`} onCopy={onCopy} copiedId={copiedId} lang="curl" />
      </div>
    </div>
  )
}

function ActionItem({ entry, onCopy, copiedId }: { entry: ActionRefEntry; onCopy: (t: string, id: string) => void; copiedId: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <li style={{ borderBottom: 'var(--hairline) solid var(--border-light)' }}>
      <details onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary style={{ cursor: 'pointer', padding: 'var(--space-2) 0', minWidth: 0 }}>
          <code style={{ ...NOWRAP_SCROLL, display: 'inline-block', verticalAlign: 'middle', maxWidth: 'calc(100% - 1.5rem)' }}>{entry.command}</code>
        </summary>
        {open && <ActionDetail entry={entry} onCopy={onCopy} copiedId={copiedId} />}
      </details>
    </li>
  )
}

export default function ActionReference({ spec }: Props) {
  const entries = useMemo(() => buildActionEntries(spec), [spec])
  const [q, setQ] = useState('')
  // 검색하지 않을 때는 연 영역만, 검색할 때는 접은 영역만 기억한다
  const [openAreas, setOpenAreas] = useState<ReadonlySet<string>>(new Set())
  const [closedInSearch, setClosedInSearch] = useState<ReadonlySet<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const result = useMemo(() => groupActions(entries, q), [entries, q])
  const searching = q.trim().length > 0

  const onCopy = useCallback((text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => setCopiedId(id)).catch(() => setCopiedId(null))
  }, [])

  const flip = (prev: ReadonlySet<string>, area: string): ReadonlySet<string> => {
    const next = new Set(prev)
    if (next.has(area)) next.delete(area)
    else next.add(area)
    return next
  }
  const toggle = (area: string) => {
    if (searching) setClosedInSearch((prev) => flip(prev, area))
    else setOpenAreas((prev) => flip(prev, area))
  }
  const onQuery = (value: string) => { setQ(value); setClosedInSearch(new Set()) }

  return (
    <div>
      <label style={{ display: 'block', maxWidth: '24rem', marginBottom: 'var(--space-3)' }}>
        <span style={{ display: 'block', ...MUTED_SM, marginBottom: 'var(--space-1)' }}>{COPY.search}</span>
        <input type="search" className="input-field" placeholder={COPY.searchPlaceholder}
          value={q} onChange={(e) => onQuery(e.target.value)} style={{ width: '100%' }} />
      </label>
      <p role="status" style={{ ...MUTED_SM, margin: '0 0 var(--space-2)' }}>
        {COPY.total} {COPY.count(entries.length)} / {COPY.count(result.count)}
      </p>
      {result.count === 0 && <p>{COPY.empty}</p>}
      {result.groups.map((g) => {
        const open = searching ? !closedInSearch.has(g.area) : openAreas.has(g.area)
        const listId = `action-ref-${g.area}`
        return (
          <section key={g.area} aria-label={g.label} style={{ borderTop: 'var(--hairline) solid var(--border-light)' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>
              <button type="button" className={`btn-ghost ${styles.groupToggle}`} aria-expanded={open} aria-controls={listId}
                onClick={() => toggle(g.area)}>
                <span>{g.label}</span>
                <span style={MUTED_SM}>{COPY.count(g.entries.length)}</span>
              </button>
            </h3>
            {open && (
              <ul id={listId} aria-label={`${g.label} ${COPY.command}`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {g.entries.map((e) => <ActionItem key={e.id} entry={e} onCopy={onCopy} copiedId={copiedId} />)}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
