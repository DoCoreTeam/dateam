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
import Sensitive from '@/components/crm/Sensitive'
import Link from 'next/link'
import { Check, Pencil, X, Undo2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { describeSuggestionValue, TARGET_LABEL, FIELD_LABEL } from '@/lib/crm/format/suggestion'
import { axisMeta } from '@/lib/crm/ui/suggestion-axis'
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

const TARGET_HREF: Record<string, string> = {
  company: '/crm/companies', person: '/crm/people', deal: '/crm/deals',
  meeting: '/crm/meetings',
}

/** 명세 §6.1 "거절(사유 선택: 부정확, 중복, 불필요)" */
const REJECT_REASONS = ['부정확', '중복', '불필요'] as const

/** 표시는 SSOT 를 거친다 — 인박스가 원시 JSON 을 보여 주면 사람은 읽지 않고 승인한다 */
function show(v: unknown, item: SuggestionItem): string {
  return describeSuggestionValue(v, item, '(비어 있음)')
}

/** 금액에 관한 제안인가 — WHAT 축은 언제나 금액이다(five-axis-suggest.ts) */
function isMoney(item: SuggestionItem): boolean {
  return item.axis === 'WHAT' || item.field === 'amountMinor'
}

interface Props {
  item: SuggestionItem
  targetName?: string
  onDone: () => void
}

export default function SuggestionCard({ item, targetName, onDone }: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(show(item.proposedValueJson, item))
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
  /**
   * 고칠 수 있는 제안인가.
   *
   * 화면은 객체 제안(인물·할 일)을 "이지원 · 상무 · 결정권자"처럼 **한 줄로 요약**해 보여 준다.
   * 그 한 줄을 그대로 고쳐 저장하면 인물 이름이 통째로 그 문자열이 된다.
   * 보여 주기와 고치기는 다른 일이라, 고치기는 **값이 하나일 때만** 연다.
   */
  const editable = item.proposedValueJson === null
    || ['string', 'number', 'bigint'].includes(typeof item.proposedValueJson)

  return (
    <li className={`card ${styles.card}`}>
      <FormErrorBanner message={error} />

      <div className={styles.head}>
        <NbBadge>{axisMeta(item.axis).label}</NbBadge>
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
          {item.field && <span className={styles.field}> · {FIELD_LABEL[item.field] ?? item.field}</span>}
        </span>
        <time className={styles.at}>{formatKstDateTimeShort(item.createdAt)}</time>
      </div>

      {/* 현재 값 → 제안 값. 둘을 나란히 놓지 않으면 "무엇이 달라지나"를 머리로 계산해야 한다 */}
      <div className={styles.change}>
        {/*
          금액 제안은 회의 모드에서 가린다 — 「15억 → 40억」이 고객 화면에 그대로 보인다.
          금액이 아닌 제안(사람 이름·단계)은 가리지 않는다: 다 가리면 회의 중에 아무것도 못 한다.
        */}
        <span className={styles.current}>
          {isMoney(item) ? <Sensitive>{show(item.currentValueJson, item)}</Sensitive>
                         : show(item.currentValueJson, item)}
        </span>
        <span className={styles.arrow} aria-hidden>→</span>
        {editing ? (
          <input
            className="input-field" value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="고칠 값"
            autoFocus
          />
        ) : (
          <strong className={styles.proposed}>{show(item.proposedValueJson, item)}</strong>
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
              {!editing && editable && (
                <NbButton variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                  <Pencil size={14} /> 고치기
                </NbButton>
              )}
              {editing && (
                <NbButton variant="ghost" onClick={() => { setEditing(false); setValue(show(item.proposedValueJson, item)) }} disabled={busy}>
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
