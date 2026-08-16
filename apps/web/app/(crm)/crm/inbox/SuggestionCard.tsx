'use client'

// 인박스 제안 카드 (dacrm T1-06, 구현명세 §6.1)
//
// 이 카드가 답해야 하는 질문은 하나다: **이 값을 받아들여도 되나.**
// 그래서 화면에 반드시 셋이 함께 있어야 한다 — 현재 값, 제안 값, 그리고 근거.
// 근거가 없으면 사용자는 확신도 숫자만 보고 찍게 되고, 그건 검토가 아니라 도장 찍기다.
//
// 거절 사유를 고르게 하는 이유(부정확·중복·불필요): 나중에 프롬프트를 고칠 때
// "무엇이 문제였나"의 유일한 재료다. 사유 없는 거절은 통계로만 남는다.

import { useState } from 'react'
import Link from 'next/link'
import { Check, Pencil, X, Undo2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import styles from './inbox.module.css'

export interface SuggestionItem {
  id: string
  axis: string
  targetType: string
  targetId: string | null
  field: string | null
  currentValueJson: unknown
  proposedValueJson: unknown
  confidence: number
  evidenceJson: { quote?: string; segmentIds?: string[] } | null
  status: string
  expiresAt: string
  createdAt: string
}

/** 5축 — 스키마 CrmSuggestionAxis 와 같은 다섯 */
const AXIS_LABEL: Record<string, string> = {
  WHO: '누가', WHAT: '무엇을', WHERE: '어디까지', RISK: '무엇이 막나', NEXT: '다음에',
}

const TARGET_LABEL: Record<string, string> = { company: '회사', person: '인물', deal: '딜' }
const TARGET_HREF: Record<string, string> = {
  company: '/crm/companies', person: '/crm/people', deal: '/crm/deals',
}

/** 명세 §6.1 "거절(사유 선택: 부정확, 중복, 불필요)" */
const REJECT_REASONS = ['부정확', '중복', '불필요'] as const

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(비어 있음)'
  return typeof v === 'string' ? v : JSON.stringify(v)
}

interface Props {
  item: SuggestionItem
  targetName?: string
  onDone: () => void
}

export default function SuggestionCard({ item, targetName, onDone }: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(show(item.proposedValueJson))
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pct = Math.round(item.confidence * 100)
  const quote = item.evidenceJson?.quote

  async function decide(decision: 'accept' | 'reject', extra: Record<string, unknown> = {}) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/suggestions/${item.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...extra }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? '처리하지 못했습니다.')
        return
      }
      onDone()
    } catch {
      setError('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const decided = item.status !== 'PENDING'

  return (
    <li className={`card ${styles.card}`}>
      <FormErrorBanner message={error} />

      <div className={styles.head}>
        <NbBadge>{AXIS_LABEL[item.axis] ?? item.axis}</NbBadge>
        <span className={styles.target}>
          {TARGET_LABEL[item.targetType] ?? item.targetType}
          {item.targetId && (
            <>
              {' · '}
              <Link href={`${TARGET_HREF[item.targetType] ?? '/crm'}/${item.targetId}`}>
                {targetName ?? '열기'}
              </Link>
            </>
          )}
          {item.field && <span className={styles.field}> · {item.field}</span>}
        </span>
        <time className={styles.at}>{formatKstDateTimeShort(item.createdAt)}</time>
      </div>

      {/* 현재 값 → 제안 값. 둘을 나란히 놓지 않으면 "무엇이 달라지나"를 머리로 계산해야 한다 */}
      <div className={styles.change}>
        <span className={styles.current}>{show(item.currentValueJson)}</span>
        <span className={styles.arrow} aria-hidden>→</span>
        {editing ? (
          <input
            className="input-field" value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="고칠 값"
            autoFocus
          />
        ) : (
          <strong className={styles.proposed}>{show(item.proposedValueJson)}</strong>
        )}
      </div>

      {/* 확신도는 숫자와 막대를 함께 — 숫자만 있으면 카드 사이 비교가 안 된다 */}
      <div className={styles.confidence}>
        <span className={styles.gauge} aria-hidden>
          <span className={styles.gaugeFill} style={{ width: `${pct}%` }} />
        </span>
        <span className={styles.pct}>확신 {pct}%</span>
      </div>

      {quote && (
        <blockquote className={styles.quote}>{quote}</blockquote>
      )}

      {!decided && (
        <div className={styles.actions}>
          {rejecting ? (
            <>
              <span className={styles.reasonLabel}>왜 아닌가요?</span>
              {REJECT_REASONS.map((r) => (
                <NbButton key={r} variant="ghost" onClick={() => void decide('reject', { reason: r })} disabled={busy}>
                  {r}
                </NbButton>
              ))}
              <NbButton variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>취소</NbButton>
            </>
          ) : (
            <>
              <NbButton
                onClick={() => void decide('accept', editing ? { editedValue: value } : {})}
                disabled={busy}
              >
                <Check size={14} /> {editing ? '고쳐서 반영' : '반영'}
              </NbButton>
              {!editing && (
                <NbButton variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                  <Pencil size={14} /> 고치기
                </NbButton>
              )}
              {editing && (
                <NbButton variant="ghost" onClick={() => { setEditing(false); setValue(show(item.proposedValueJson)) }} disabled={busy}>
                  <Undo2 size={14} /> 되돌리기
                </NbButton>
              )}
              <NbButton variant="ghost" onClick={() => setRejecting(true)} disabled={busy}>
                <X size={14} /> 아니에요
              </NbButton>
            </>
          )}
        </div>
      )}
    </li>
  )
}
