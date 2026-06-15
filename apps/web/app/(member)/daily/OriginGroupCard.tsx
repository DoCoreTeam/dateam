import { Fragment, useMemo, type ReactNode } from 'react'
import type { DailyLog } from '@/types/database'
import type { LogGroup } from './grouping'
import { findDuplicateCandidates } from '@/lib/daily/duplicate'
import { DuplicateSection } from './DuplicateSection'

interface OriginGroupCardProps {
  /** 그룹화된 입력 묶음 (origin_group_id 기준) */
  group: LogGroup
  /** 펼침 여부 */
  isOpen: boolean
  /** 헤더 클릭 토글 핸들러 */
  onToggle: () => void
  /** 분해 항목 1건을 렌더하는 기존 카드 함수 (page.tsx의 renderCard) */
  renderCard: (log: DailyLog) => ReactNode
  /** logged_at → 시각 문자열 변환 (page.tsx의 formatTime) */
  formatTime: (iso: string) => string
  /** 중복 비교 풀 — 같은 날 전체 로그(자기/동일그룹은 함수가 제외) */
  pool?: DailyLog[]
}

/**
 * 일일업무 타임라인의 "원본 입력 묶음" 카드 (P0).
 *
 * 비파괴(읽기 전용): 저장·분해·AI 호출 로직과 무관하게 이미 저장된
 * original_input / memo_status 만 표시한다.
 *
 * 구성:
 *  1) 원본 헤더 — 사용자가 쓴 원본 텍스트 그대로(plain)
 *  2) 요약 칩 — 분해 N · 메모 N · 완료 N/N
 *  3) 펼침 드로어(기본 접힘) — 분해 항목(renderCard) + 놓친 메모 환기 섹션
 */
export function OriginGroupCard({ group, isOpen, onToggle, renderCard, formatTime, pool }: OriginGroupCardProps) {
  // 원본 텍스트: 그룹 첫 항목의 original_input (없으면 라벨 폴백)
  const originalText = group.logs[0]?.original_input?.trim() || group.label
  const noteCount = group.logs.filter((l) => l.entry_type === 'note').length
  // 놓친 메모: note + memo_status='new' (미확인)
  const missedMemos = group.logs.filter((l) => l.entry_type === 'note' && l.memo_status === 'new')
  const subsId = `daily-group-subs-${group.key}`

  // 중복 후보 수(요약 칩용) — 그룹 항목 × 풀, 동일 쌍 1회만 카운트
  const comparePool = pool ?? []
  const dupCount = useMemo(() => {
    if (comparePool.length === 0) return 0
    const seen = new Set<string>()
    for (const source of group.logs) {
      for (const { log: target } of findDuplicateCandidates(source, comparePool)) {
        seen.add([source.id, target.id].sort().join('::'))
      }
    }
    return seen.size
  }, [group.logs, comparePool])

  return (
    <div className="origin-group">
      <button
        type="button"
        className="origin-group-header"
        aria-expanded={isOpen}
        aria-controls={subsId}
        onClick={onToggle}
      >
        <span className="origin-group-chevron" aria-hidden>{isOpen ? '▾' : '▸'}</span>
        <span className="origin-group-body">
          <span className="origin-group-text">{originalText}</span>
          <span className="origin-group-chips">
            <span className="origin-group-time">{formatTime(group.loggedAt)}</span>
            <span className="origin-group-chip">분해 {group.count}</span>
            {noteCount > 0 && <span className="origin-group-chip">메모 {noteCount}</span>}
            {group.doneCount > 0 && (
              <span className="origin-group-chip origin-group-chip-done">
                완료 {group.doneCount}/{group.count}
              </span>
            )}
            {missedMemos.length > 0 && (
              <span className="origin-group-chip origin-group-chip-alert">
                미확인 메모 {missedMemos.length}
              </span>
            )}
            {dupCount > 0 && (
              <span className="origin-group-chip origin-group-chip-dup">
                중복 {dupCount}
              </span>
            )}
          </span>
        </span>
      </button>

      {isOpen && (
        <div id={subsId} className="origin-group-subs">
          {comparePool.length > 0 && (
            <DuplicateSection groupLogs={group.logs} pool={comparePool} />
          )}

          {group.logs.map((log) => <Fragment key={log.id}>{renderCard(log)}</Fragment>)}

          {missedMemos.length > 0 && (
            <section className="origin-memo-alert" aria-label="놓친 메모">
              <p className="origin-memo-alert-title">
                ⚠ 놓친 메모 {missedMemos.length}건 — 아직 확인하지 않았습니다
              </p>
              <ul className="origin-memo-alert-list">
                {missedMemos.map((memo) => (
                  <li key={memo.id} className="origin-memo-alert-item">
                    {memo.content}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
