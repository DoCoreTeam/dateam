'use client'

// app/admin/org-chart/DeleteNodeModal.tsx — 조직을 지우기 전에 무엇이 붙어 있는지 보이고 갈 곳을 묻는다
//
// 왜 (사용자 지적 2026-09-17): 지우기를 누르면 이런 문장만 떴다.
//   update or delete on table "org_nodes" violates foreign key constraint
//   "calendar_events_department_id_fkey" on table "calendar_events"
// 무엇이 막는지도, 몇 건인지도, 어떻게 하면 되는지도 화면에 없었다. 그래서 부서 개편을
// 할 수가 없었다. 여기서는 표별 건수를 먼저 보이고 **어디로 옮길지 사람이 정한다.**
//
// 소속을 비워서 지우지 않는 이유는 마이그레이션 257 머리에 적었다 — 지난 보고서의 소속은
// 작성 시점에 얼어붙은 사실이라, 비우면 그 사실이 사라진다.

import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import InlineError from '@/components/ui/InlineError'
import { eulReul } from '@/lib/ui/josa'
import { orgNodeImpact, deleteNodeWithTransfer, type OrgNodeImpactRow } from './actions'
import type { OrgNode } from './OrgNodeCard'

interface Props {
  node: OrgNode
  /** 옮겨 갈 후보. 사람 노드와 자기 자신·자기 자손은 부르는 쪽이 이미 걸러 준다 */
  targets: { id: string; name: string }[]
  onClose: () => void
}

const CHILD_SOURCE = 'org_nodes'

export default function DeleteNodeModal({ node, targets, onClose }: Props) {
  const [rows, setRows] = useState<OrgNodeImpactRow[] | null>(null)
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    orgNodeImpact(node.id).then((res) => {
      if (!alive) return
      if (res.error) setError(res.error)
      setRows(res.rows)
    })
    return () => { alive = false }
  }, [node.id])

  const dataRows = (rows ?? []).filter((r) => r.source !== CHILD_SOURCE)
  const childRow = (rows ?? []).find((r) => r.source === CHILD_SOURCE)
  const total = dataRows.reduce((sum, r) => sum + Number(r.cnt), 0)
  // 기록이 붙어 있으면 갈 곳을 정해야 지울 수 있다(DB 도 같은 규칙으로 막는다)
  const needsTarget = total > 0
  const canDelete = rows !== null && (!needsTarget || Boolean(targetId))

  function run() {
    setError(null)
    startTransition(async () => {
      const res = await deleteNodeWithTransfer(node.id, targetId || null)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <NbModal
      title="조직 삭제"
      onClose={onClose}
      maxWidth={440}
      footer={
        <>
          <NbButton variant="secondary" onClick={onClose} disabled={pending}>취소</NbButton>
          <NbButton variant="danger" onClick={run} disabled={!canDelete || pending}>
            {pending ? '처리 중' : needsTarget ? '옮기고 삭제' : '삭제'}
          </NbButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>
          <strong>{node.name}</strong>{eulReul(node.name)} 삭제합니다
        </p>

        {rows === null && <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>붙어 있는 기록을 세는 중</p>}

        {rows !== null && total === 0 && (
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>붙어 있는 기록 0건 — 바로 지울 수 있습니다</p>
        )}

        {dataRows.length > 0 && (
          <div>
            <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--warning)' }}>
              <AlertTriangle size={13} /> 이 조직에 붙어 있는 기록 {total}건
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {dataRows.map((r) => <li key={r.source}>{r.label} {r.cnt}건</li>)}
            </ul>
          </div>
        )}

        {needsTarget && (
          <div>
            <label className="label" htmlFor="org-transfer-target">기록을 옮길 조직 *</label>
            <select id="org-transfer-target" className="input-field" value={targetId}
              onChange={(e) => setTargetId(e.target.value)} disabled={pending}>
              <option value="">선택하세요</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {childRow && (
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            하위 조직 {childRow.cnt}개는 {targetId
              ? `${targets.find((t) => t.id === targetId)?.name ?? '고른 조직'} 아래로 옮깁니다`
              : '한 단계 위로 올립니다'}
          </p>
        )}

        <InlineError compact>{error}</InlineError>
      </div>
    </NbModal>
  )
}
