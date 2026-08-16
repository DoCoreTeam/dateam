'use client'

// AI 예산 카드 (dacrm T1-07, 구현명세 §3.6)
//
// 이 카드가 답해야 하는 것: **이번 달 얼마 썼고, 막히면 어떻게 푸나.**
// 그래서 쓴 금액·상한·남은 비율을 한 화면에 두고, 상한을 그 자리에서 바꾸게 한다 —
// "설정에서 조정하세요"라고만 하고 그 설정이 다른 화면에 있으면 안내가 아니라 떠넘기기다.
//
// 금액은 센트(minor)로 저장하고 화면에서만 달러로 바꾼다.
// 서버·화면이 서로 다른 단위를 쓰면 언젠가 100배 사고가 난다.

import { useCallback, useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import type { StatusKey } from '@/lib/tokens/status-colors'
import styles from './settings.module.css'

interface Budget {
  month: string
  limitMinorUsd: string
  spentMinorUsd: string
  level: 'ok' | 'warn' | 'blocked'
  ratio: number
  /** 상한 0 — 산술로는 안 넘었지만 AI 는 첫 호출부터 막힌다 */
  aiDisabled: boolean
}

const LEVEL: Record<Budget['level'], { label: string; status: StatusKey }> = {
  ok: { label: '정상', status: 'done' },
  warn: { label: '80% 넘음', status: 'planned' },
  blocked: { label: '차단됨', status: 'blocker' },
}

/** 센트 → 달러 표시 */
function usd(minor: string): string {
  const n = Number(minor) / 100
  if (!Number.isFinite(n)) return `${minor}¢`
  return `$${n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function BudgetCard() {
  const [budget, setBudget] = useState<Budget | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/budget')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '예산을 불러오지 못했습니다.'); return }
      setBudget(body)
      setDraft((Number(body.limitMinorUsd) / 100).toString())
    } catch {
      setError('예산을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save() {
    const dollars = Number(draft)
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError('상한은 0 이상의 숫자여야 합니다.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limitMinorUsd: Math.round(dollars * 100) }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      void load()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !budget) return <AXDotLoader />

  // 꺼진 상태를 "정상"으로 표시하면 사용자는 왜 안 되는지 모른다
  const meta = budget
    ? (budget.aiDisabled ? { label: 'AI 꺼짐', status: 'note' as StatusKey } : LEVEL[budget.level])
    : null
  const pct = budget ? Math.min(100, Math.round(budget.ratio * 100)) : 0

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>AI 예산</h2>
        {meta && <NbBadge status={meta.status}>{meta.label}</NbBadge>}
      </div>

      <FormErrorBanner message={error} />

      {budget && (
        <>
          {/* 차단 상태면 무엇을 하면 되는지 바로 아래에서 말한다 */}
          {(budget.level === 'blocked' || budget.aiDisabled) && (
            <p className={styles.blocked}>
              {budget.aiDisabled
                ? '상한이 0이라 AI 기능이 꺼져 있어요. 아래에서 상한을 올리면 바로 쓸 수 있습니다.'
                : '이번 달 AI 기능이 멈춰 있어요. 아래에서 상한을 올리면 바로 다시 쓸 수 있습니다.'}
              {' '}회사·인물·딜 같은 기본 기능은 그대로 됩니다.
            </p>
          )}

          <div className={styles.figures}>
            <span className={styles.spent}>{usd(budget.spentMinorUsd)}</span>
            <span className={styles.of}>/ {usd(budget.limitMinorUsd)}</span>
            <span className={styles.month}>{budget.month}</span>
          </div>

          <span className={styles.gauge} aria-hidden>
            <span
              className={`${styles.gaugeFill}${budget.level === 'blocked' ? ` ${styles.gaugeBlocked}` : budget.level === 'warn' ? ` ${styles.gaugeWarn}` : ''}`}
              style={{ width: `${pct}%` }}
            />
          </span>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className="label" htmlFor="crm-budget-limit">이번 달 상한 (USD)</label>
              <input
                id="crm-budget-limit" className="input-field" value={draft} inputMode="decimal"
                onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
            <NbButton onClick={() => void save()} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </NbButton>
          </div>

          <p className={styles.hint}>
            상한에 닿으면 AI 기능만 멈추고 나머지는 그대로 동작합니다. 매월 1일에 사용액이 새로 시작합니다.
          </p>
        </>
      )}
    </div>
  )
}
