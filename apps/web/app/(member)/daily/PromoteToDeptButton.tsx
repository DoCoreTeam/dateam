'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'

// 일일업무 행 → 부서업무로 1클릭 승격(참조). 부서 선택 후 /api/work/promote 호출.
export default function PromoteToDeptButton({ logId, onToast }: { logId: string; onToast?: (msg: string, type?: 'success' | 'error') => void }) {
  const [open, setOpen] = useState(false)
  const [deptId, setDeptId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  // 자가 게이팅: 부서장(+admin)만 버튼 노출. 판정 전/false면 렌더 안 함.
  const { data: gate } = useSWR<{ canPromote: boolean }>('/api/work/can-promote', fetcher)
  const { data } = useSWR<{ departments: { id: string; name: string }[] }>(open ? '/api/work/departments' : null, fetcher)
  const depts = data?.departments ?? []

  async function promote() {
    const target = deptId || depts[0]?.id
    if (!target) { onToast?.('등록 가능한 부서가 없습니다', 'error'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/work/promote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceLogId: logId, departmentId: target }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { onToast?.(j.error ?? '부서업무 등록 실패', 'error'); return }
      setDone(true); setOpen(false)
      onToast?.('부서업무로 등록되었습니다')
    } finally { setBusy(false) }
  }

  // 부서장(+admin)만 노출. 판정 전(undefined)·false면 버튼 자체를 렌더 안 함(깜빡임 최소화).
  if (!gate?.canPromote) return null

  if (done) return <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', fontWeight: 700 }} title="부서업무로 등록됨">↗ 부서업무 등록됨</span>

  return (
    // 이 위젯 안의 클릭은 카드로 올려보내지 않는다.
    // 카드(.daily-log-card)에는 "업무 플로우 패널 열기" onClick이 걸려 있어, 그냥 두면
    // 부서업무 등록을 누른 것만으로 관계없는 플로우 패널이 같이 열린다(그 패널은 AI 자동연결까지 돌린다).
    // 사용자에게는 엉뚱한 화면이 뜨는 일이고, 그 요청 폭주가 부서 목록 로딩까지 밀어낸다.
    <div style={{ position: 'relative', display: 'inline-block' }} onClick={(e) => e.stopPropagation()}>
      <button
        data-testid={`promote-btn-${logId}`}
        onClick={() => setOpen((v) => !v)}
        title="부서업무로 등록"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', padding: '0.2rem 0.35rem' }}
      >↗ 부서업무 등록</button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 30, marginTop: 4,
          background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', padding: 'var(--space-2)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 200,
        }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>부서업무로 등록(원본 유지)</span>
          <select className="input-field" value={deptId} onChange={(e) => setDeptId(e.target.value)} style={{ fontSize: 'var(--fs-sm)' }}>
            {depts.length === 0 && <option value="">부서 로딩…</option>}
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)} style={{ fontSize: 'var(--fs-xs)', padding: '3px 10px', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)', background: 'var(--surface-bg)', color: 'var(--text-muted)', cursor: 'pointer' }}>취소</button>
            {/* 부서를 못 고른 상태에서 누르면 요청조차 안 나가고 **아무 반응도 없다**(promote가 즉시 return).
                여기 onToast가 안 넘어오는 화면(/daily)에서는 오류 통보마저 사라져 "눌렀는데 먹통"이 된다.
                → 고를 게 생기기 전에는 누를 수 없게 한다. */}
            <button data-testid={`promote-confirm-${logId}`} onClick={promote} disabled={busy || depts.length === 0} style={{ fontSize: 'var(--fs-xs)', padding: '3px 10px', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--brand)', background: 'var(--brand)', color: 'var(--brand-fg)', fontWeight: 700, cursor: busy || depts.length === 0 ? 'not-allowed' : 'pointer', opacity: depts.length === 0 ? 0.6 : 1 }}>{busy ? '등록 중…' : '등록'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
