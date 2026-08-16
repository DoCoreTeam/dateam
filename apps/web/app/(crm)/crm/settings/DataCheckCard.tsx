'use client'

// 데이터 점검 카드 (dacrm — "오류를 줄이는 자리")
//
// 규칙이 찾고 AI 가 고른다. 이 순서에는 이유가 있다:
//   · 규칙은 빠지지 않고 정확하지만 결과가 수십 건이라 **아무도 안 읽는다**
//   · AI 는 "지금 이것부터"를 말할 수 있지만 혼자 두면 없는 문제도 만든다
//   · 그래서 찾기는 규칙이, 고르기는 AI 가 한다
//
// 여기서 값을 고치지 않는다. 무엇이 문제인지 말하고 **그 화면으로 보낸다** —
// 자동으로 채우면 그 값이 어디서 왔는지 아무도 모르게 된다.

import { useState } from 'react'
import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import styles from './settings.module.css'

interface Issue { key: string; kind: string; label: string; detail: string; href: string }
interface Pick { key: string; because: string; todo: string }
interface Result {
  issues: Issue[]
  total: number
  review: { headline: string; picks: Pick[] } | null
  reason: string | null
}

/** 목록에 한 번에 보여 주는 수 — 넘으면 그 자체가 다시 "안 읽히는 목록"이 된다 */
const SHOW = 12

export default function DataCheckCard() {
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/data-check', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '점검하지 못했습니다.'); return }
      setResult(body)
    } catch {
      setError('점검하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const byKey = new Map((result?.issues ?? []).map((i) => [i.key, i]))
  const picked = new Set((result?.review?.picks ?? []).map((p) => p.key))
  const rest = (result?.issues ?? []).filter((i) => !picked.has(i.key)).slice(0, SHOW)

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>데이터 점검</h2>
        <NbButton variant="ghost" onClick={() => void run()} disabled={busy}>
          {busy ? '보는 중…' : '지금 점검'}
        </NbButton>
      </div>

      <FormErrorBanner message={error} />

      {!result ? (
        <EmptyState
          icon={<ClipboardCheck size={22} />}
          title="아직 점검하지 않았어요"
          description="열린 딜과 인물에서 영업에 실제로 손해가 되는 빈 곳을 찾고, 무엇부터 손볼지 AI가 골라 줍니다."
        />
      ) : result.total === 0 ? (
        <EmptyState
          title="손볼 것이 없어요"
          description="열린 딜과 인물에서 지금 문제가 될 만한 것을 찾지 못했습니다."
        />
      ) : (
        <>
          {/* AI 가 고른 것 — 이유와 함께. 이유가 없으면 그냥 목록을 다시 보여 준 것이다 */}
          {result.review && result.review.picks.length > 0 && (
            <div className={styles.checkTop}>
              <strong className={styles.checkHeadline}>{result.review.headline}</strong>
              <ol className={styles.checkPicks}>
                {result.review.picks.map((p) => {
                  const issue = byKey.get(p.key)
                  return (
                    <li key={p.key} className={styles.checkPick}>
                      <span className={styles.checkTodo}>{p.todo}</span>
                      <span className={styles.checkBecause}>{p.because}</span>
                      {issue && <Link href={issue.href}>{issue.label} 열기</Link>}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {/* 우선순위를 못 매겼어도 목록은 산다 — 이 구조를 고른 이유가 여기 있다 */}
          {result.reason && <p className={styles.hint}>{result.reason}</p>}

          {rest.length > 0 && (
            <ul className={styles.checkList}>
              {rest.map((i) => (
                <li key={i.key} className={styles.checkItem}>
                  <Link href={i.href}>{i.label}</Link>
                  <span className={styles.checkDetail}>{i.detail}</span>
                </li>
              ))}
            </ul>
          )}

          {/* 잘렸으면 잘렸다고 말한다 — 조용히 자르면 "이게 전부"로 읽는다 */}
          {result.total > picked.size + rest.length && (
            <p className={styles.hint}>
              모두 {result.total}건 중 {picked.size + rest.length}건만 보여 주고 있어요.
            </p>
          )}
        </>
      )}
    </div>
  )
}
