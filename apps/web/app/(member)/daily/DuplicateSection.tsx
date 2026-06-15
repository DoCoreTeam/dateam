'use client'

import { useMemo, useState, useTransition } from 'react'
import type { DailyLog } from '@/types/database'
import { findDuplicateCandidates } from '@/lib/daily/duplicate'
import { linkDuplicate } from './actions'

interface DuplicateSectionProps {
  /** 이 그룹에 속한 항목들 (각각에 대해 중복 후보를 찾는다) */
  groupLogs: DailyLog[]
  /** 비교 풀 — 같은 날 전체 로그(그룹 항목 포함, 함수가 자기/동일그룹 제외) */
  pool: DailyLog[]
}

/** 화면에 보여줄 후보 1쌍: source(그룹 항목) ↔ target(중복 의심 상대) */
interface CandidatePair {
  key: string
  source: DailyLog
  target: DailyLog
  score: number
}

function pairLabel(log: DailyLog): string {
  const text = (log.content || log.original_input || '').replace(/\s+/g, ' ').trim()
  return text.length > 28 ? `${text.slice(0, 28).trimEnd()}…` : text
}

/**
 * "① 중복 의심" 섹션 (P1) — 후보 표기 전용.
 *
 * 비파괴: 자동 병합·삭제 없음. [무시]는 로컬 상태로 숨기기만, [병합 요청]을 눌러야
 * linkDuplicate 가 relations 1건을 추가한다(원본 불변). 후보 없으면 null 반환.
 */
export function DuplicateSection({ groupLogs, pool }: DuplicateSectionProps) {
  // 그룹 각 항목 × 풀 → 후보쌍 목록. 동일 쌍(A↔B, B↔A) 중복 표기는 키로 1회만.
  const pairs = useMemo<CandidatePair[]>(() => {
    const seen = new Set<string>()
    const result: CandidatePair[] = []
    for (const source of groupLogs) {
      for (const { log: target, score } of findDuplicateCandidates(source, pool)) {
        const pairKey = [source.id, target.id].sort().join('::')
        if (seen.has(pairKey)) continue
        seen.add(pairKey)
        result.push({ key: pairKey, source, target, score })
      }
    }
    return result
  }, [groupLogs, pool])

  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [merged, setMerged] = useState<Set<string>>(new Set())
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visible = pairs.filter((p) => !dismissed.has(p.key))
  if (visible.length === 0) return null

  const dismiss = (key: string) =>
    setDismissed((prev) => new Set(prev).add(key))

  const requestMerge = (pair: CandidatePair) =>
    startTransition(async () => {
      setErrorKey(null)
      const res = await linkDuplicate(pair.source.id, pair.target.id)
      if (res.ok) setMerged((prev) => new Set(prev).add(pair.key))
      else setErrorKey(pair.key)
    })

  return (
    <section className="dup-section" aria-label="중복 의심">
      <p className="dup-section-title">① 중복 의심 {visible.length}건</p>
      <ul className="dup-list">
        {visible.map((pair) => {
          const isMerged = merged.has(pair.key)
          const hasError = errorKey === pair.key
          return (
            <li key={pair.key} className="dup-item">
              <span className="dup-item-text">
                ‘{pairLabel(pair.source)}’ ≈ ‘{pairLabel(pair.target)}’
                <span className="dup-item-score">유사 {Math.round(pair.score * 100)}%</span>
              </span>
              <span className="dup-item-actions">
                {isMerged ? (
                  <span className="dup-item-merged">병합요청됨</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="dup-btn dup-btn-ignore"
                      onClick={() => dismiss(pair.key)}
                      disabled={isPending}
                    >
                      무시
                    </button>
                    <button
                      type="button"
                      className="dup-btn dup-btn-merge"
                      onClick={() => requestMerge(pair)}
                      disabled={isPending}
                    >
                      병합 요청
                    </button>
                  </>
                )}
              </span>
              {hasError && (
                <span className="dup-item-error" role="alert">
                  요청 실패 — 다시 시도해 주세요
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
