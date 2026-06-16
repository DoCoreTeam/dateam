'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

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
  to_log_date?: string | null
  to_logged_at?: string | null
}

// 현재 패널 대상(앵커) 업무의 기준 시각. 연결 업무의 전/후 판정에 사용.
interface Anchor {
  logDate: string | null
  loggedAt: string | null
}

// 연결 업무 작성 시각 표기: 타임스탬프 있으면 "M/D HH:mm", 없으면 날짜만 "M/D". 둘 다 없으면 null.
function formatLinkTime(loggedAt?: string | null, logDate?: string | null): string | null {
  const src = loggedAt ?? logDate
  if (!src) return null
  const d = new Date(src)
  if (Number.isNaN(d.getTime())) return null
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  if (!loggedAt) return md
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${md} ${hh}:${mm}`
}

// 앵커 대비 연결 업무의 전/후. 타임스탬프 우선, 없으면 날짜 폴백. 비교 불가면 null(뱃지 생략).
function relativePosition(row: LinkRow, anchor: Anchor | null): 'before' | 'after' | null {
  if (!anchor) return null
  const a = anchor.loggedAt ?? anchor.logDate
  const b = row.to_logged_at ?? row.to_log_date
  if (!a || !b) return null
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return null
  return tb < ta ? 'before' : 'after'
}

const KIND_LABEL: Record<string, string> = { account: '거래처', deal: '딜', contact: '연락처' }
// 엔티티 종류 → 상세 라우트(실재하는 page.tsx만). 없는 종류는 매핑 제외 → 비클릭.
const ENTITY_ROUTE: Record<string, string> = { account: '/accounts', deal: '/deals', contact: '/contacts' }

// 연결 종류에 따른 이동 목적지 계산. 이동 불가면 null(=비클릭).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function resolveHref(row: LinkRow): string | null {
  if (row.to_log_id) return row.to_log_date && ISO_DATE.test(row.to_log_date) ? `/daily?date=${row.to_log_date}` : null
  const base = row.kind ? ENTITY_ROUTE[row.kind] : undefined
  return base && row.entity_id ? `${base}/${row.entity_id}` : null
}

export default function AutolinkSection({ logId }: { logId: string }) {
  const router = useRouter()
  const [relations, setRelations] = useState<LinkRow[]>([])
  const [entities, setEntities] = useState<LinkRow[]>([])
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const ranRef = useRef(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/work/autolink?logId=${logId}`).then((r) => r.json()).catch(() => ({}))
    setRelations(res.relations ?? [])
    setEntities(res.entities ?? [])
    setAnchor(res.anchor ? { logDate: res.anchor.logDate ?? null, loggedAt: res.anchor.loggedAt ?? null } : null)
    setLoading(false)
    // ran=true면 빈 결과여도 재실행 안 함(이미 1회 분석 — DC-REV 비용)
    return res.ran ? 1 : (res.relations?.length ?? 0) + (res.entities?.length ?? 0)
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
        {relations.map((r) => {
          const href = resolveHref(r)
          return (
            <LinkCard key={r.id} prefix="업무" label={r.label} confidence={r.confidence} reason={r.reason} weak={r.weak}
              timeLabel={formatLinkTime(r.to_logged_at, r.to_log_date)} position={relativePosition(r, anchor)}
              onUnlink={() => unlink(r, 'log')} onOpen={href ? () => router.push(href) : undefined} />
          )
        })}
        {entities.map((e) => {
          const href = resolveHref(e)
          return (
            <LinkCard key={e.id} prefix={KIND_LABEL[e.kind ?? ''] ?? '연결'} label={e.label} confidence={e.confidence} reason={e.reason} weak={e.weak}
              onUnlink={() => unlink(e, (e.kind as 'account' | 'deal' | 'contact'))} onOpen={href ? () => router.push(href) : undefined} />
          )
        })}
      </div>
    </div>
  )
}

function LinkCard({ prefix, label, confidence, reason, weak, timeLabel, position, onUnlink, onOpen }: {
  prefix: string; label: string; confidence: number | null; reason: string | null; weak: boolean
  timeLabel?: string | null; position?: 'before' | 'after' | null
  onUnlink: () => void; onOpen?: () => void
}) {
  const pct = confidence != null ? Math.round(confidence * 100) : null
  const clickable = !!onOpen
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onOpen) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
  }
  return (
    <div
      onClick={onOpen}
      onKeyDown={clickable ? handleKeyDown : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${prefix} ${label} 열기` : undefined}
      className={clickable ? 'autolink-card-open' : undefined}
      style={{
        border: `var(--hairline) ${weak ? 'dashed' : 'solid'} ${weak ? 'var(--brand-soft-2)' : 'var(--brand)'}`,
        borderRadius: 'var(--radius)', padding: '0.5rem 0.625rem', background: weak ? 'var(--surface-bg)' : 'var(--brand-soft)',
        cursor: clickable ? 'pointer' : 'default',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--brand)', flexShrink: 0 }}>{prefix}</span>
        <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: weak ? 'var(--text-muted)' : 'var(--brand)' }}>{weak ? '추천' : '확정'}</span>
        {pct != null && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{pct}%</span>}
        {position && (
          <span style={{
            fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius)',
            color: position === 'after' ? 'var(--info)' : 'var(--text-muted)',
            background: position === 'after' ? 'var(--info-bg)' : 'var(--surface-bg)',
            border: `var(--hairline) solid ${position === 'after' ? 'var(--info-border)' : 'var(--border-color)'}`,
          }}>{position === 'after' ? '이후' : '이전'}</span>
        )}
        <button onClick={(e) => { e.stopPropagation(); onUnlink() }} title="연결 해제" aria-label="연결 해제"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', marginTop: 2, wordBreak: 'break-word' }}>{label}</div>
      {timeLabel && (
        <div style={{ marginTop: 2 }}>
          <span className="daily-log-time">🕑 {timeLabel}</span>
        </div>
      )}
      {reason && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>✦ {reason}</div>}
    </div>
  )
}
