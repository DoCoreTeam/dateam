'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// 업무 자동 연관 연결 표시 — 완전 자동(패널 열릴 때 연결 없으면 자동 실행) + 가역(해제=학습신호) + 투명(근거·신뢰도).
interface LinkRow {
  id: string
  label: string
  confidence: number | null
  reason: string | null
  weak: boolean
  created_by: string
  // entities
  kind?: string
  entity_id?: string
  to_log_id?: string
}

const KIND_LABEL: Record<string, string> = { account: '거래처', deal: '딜', contact: '연락처' }

export default function AutolinkSection({ logId }: { logId: string }) {
  const [relations, setRelations] = useState<LinkRow[]>([])
  const [entities, setEntities] = useState<LinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const ranRef = useRef(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/work/autolink?logId=${logId}`).then((r) => r.json()).catch(() => ({}))
    setRelations(res.relations ?? [])
    setEntities(res.entities ?? [])
    setLoading(false)
    return (res.relations?.length ?? 0) + (res.entities?.length ?? 0)
  }, [logId])

  const run = useCallback(async () => {
    setRunning(true)
    try {
      await fetch('/api/work/autolink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logId, action: 'run' }) })
      await load()
    } finally { setRunning(false) }
  }, [logId, load])

  // 완전 자동: 열릴 때 1회 로드 → 연결 없으면 자동 실행(무개입)
  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    ;(async () => {
      const n = await load()
      if (n === 0) await run()
    })()
  }, [load, run])

  const unlink = useCallback(async (row: LinkRow, kind: 'log' | 'account' | 'deal' | 'contact') => {
    const body = kind === 'log'
      ? { action: 'unlink', kind: 'log', logId, linkId: row.id }
      : { action: 'unlink', kind, logId, linkId: row.id }
    await fetch('/api/work/autolink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await load()
  }, [logId, load])

  const total = relations.length + entities.length

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)' }}>✦ AI 자동 연결</span>
        {(loading || running) && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--brand)' }}>{running ? '연결 찾는 중…' : '불러오는 중…'}</span>}
        <button onClick={run} disabled={running} title="다시 연결 찾기"
          style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--brand)', background: 'none', border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)', padding: '2px 8px', cursor: 'pointer' }}>
          ↻ 다시 찾기
        </button>
      </div>

      {!loading && !running && total === 0 && (
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', padding: 'var(--space-2) 0' }}>AI가 연관을 찾지 못했습니다</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {relations.map((r) => (
          <LinkCard key={r.id} prefix="업무" label={r.label} confidence={r.confidence} reason={r.reason} weak={r.weak}
            onUnlink={() => unlink(r, 'log')} />
        ))}
        {entities.map((e) => (
          <LinkCard key={e.id} prefix={KIND_LABEL[e.kind ?? ''] ?? '연결'} label={e.label} confidence={e.confidence} reason={e.reason} weak={e.weak}
            onUnlink={() => unlink(e, (e.kind as 'account' | 'deal' | 'contact'))} />
        ))}
      </div>
    </div>
  )
}

function LinkCard({ prefix, label, confidence, reason, weak, onUnlink }: {
  prefix: string; label: string; confidence: number | null; reason: string | null; weak: boolean; onUnlink: () => void
}) {
  const pct = confidence != null ? Math.round(confidence * 100) : null
  return (
    <div style={{
      border: `var(--hairline) ${weak ? 'dashed' : 'solid'} ${weak ? 'var(--brand-soft-2)' : 'var(--brand)'}`,
      borderRadius: 'var(--radius)', padding: '0.5rem 0.625rem', background: weak ? 'var(--surface-bg)' : 'var(--brand-soft)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--brand)', flexShrink: 0 }}>{prefix}</span>
        <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: weak ? 'var(--text-muted)' : 'var(--brand)' }}>{weak ? '추천' : '확정'}</span>
        {pct != null && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{pct}%</span>}
        <button onClick={onUnlink} title="연결 해제" aria-label="연결 해제"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', marginTop: 2, wordBreak: 'break-word' }}>{label}</div>
      {reason && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>✦ {reason}</div>}
    </div>
  )
}
