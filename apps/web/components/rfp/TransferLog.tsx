'use client'

// 외부 전송 기록 — 무엇이 어느 모델로 나갔나.
//
// 이 장부는 **고칠 수 없다**(마이그 247 에 update·delete 정책이 없다).
// 고칠 수 있는 장부는 장부가 아니다.

import EmptyState from '@/components/ui/EmptyState'
import NbBadge from '@/components/ui/nb/NbBadge'
import { RFP_ADMIN, DOC_CLASS_LABEL } from '@/lib/rfp/terms'

export interface TransferRow {
  id: string
  case_id: string | null
  model_id: string | null
  doc_class: string
  purpose: string | null
  created_at: string
}

export default function TransferLog({ rows }: { rows: TransferRow[] }) {
  if (rows.length === 0) return <EmptyState title={RFP_ADMIN.transferLog} />

  return (
    <section className="card">
      <h2 className="label">{RFP_ADMIN.transferLog}</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <span>{r.created_at.slice(0, 16)}</span>
            <NbBadge status="note">{DOC_CLASS_LABEL[r.doc_class as 'public'] ?? r.doc_class}</NbBadge>
            <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}> {r.purpose}</span>
            {r.case_id && <a href={`/rfp/${r.case_id}`} style={{ marginLeft: 'var(--space-2)' }}>{r.case_id.slice(0, 8)}</a>}
          </li>
        ))}
      </ul>
    </section>
  )
}
