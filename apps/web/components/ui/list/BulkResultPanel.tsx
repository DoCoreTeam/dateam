'use client'

// components/ui/list/BulkResultPanel.tsx — 여러 건을 한 번에 처리한 결과 한 벌 (§2-6)
//
// **왜 생겼나**(v0.7.574): 회사 목록의 AI 보강 결과가 화면 안에서 `<div className="card">` +
// raw `<ul>` + 인라인 style 로 직접 그려져 있었다. 그래서 ① 실패 줄에 이름이 없고
// ② 같은 사유가 연달아 두 줄 나오고 ③ 다음 화면이 또 자기 식으로 그릴 참이었다.
// `pnpm design:check` 는 이 부류를 규칙으로 갖고 있지 않아 통과시켰다.
//
// 여기서 강제하는 것은 셋이다.
//   ① **실패에는 언제나 이름이 붙는다** — 어느 것이 안 됐는지 모르면 다시 누를 수가 없다
//   ② **같은 사유는 한 줄로 접는다** — 20건이 같은 이유로 실패했는데 20줄이면 아무도 안 읽는다
//   ③ **진행 중에는 몇 개째인지 보여 준다** — 점 세 개는 멈춘 것과 구분되지 않는다

import type { ReactNode } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import type { BulkFailure } from '@/lib/ui/use-bulk-action'

interface Props {
  /** 무슨 일이 일어났는지 한 줄. 실패가 있으면 화면이 실패부터 말한다 */
  headline: string
  failures?: BulkFailure[]
  /** 중단 사유처럼 **한 번만** 말해야 하는 것 */
  notice?: ReactNode
  /** 성공 쪽 상세(회사별 결과 등) */
  children?: ReactNode
  onClose: () => void
}

/** 같은 사유는 접는다 — 사유가 같으면 사용자가 할 일도 같다 */
function groupByMessage(failures: BulkFailure[]): { message: string; labels: string[] }[] {
  const map = new Map<string, string[]>()
  for (const f of failures) {
    const list = map.get(f.message)
    if (list) list.push(f.label)
    else map.set(f.message, [f.label])
  }
  return Array.from(map, ([message, labels]) => ({ message, labels }))
}

/** 이름을 늘어놓되 길면 접는다 — 100개를 다 적으면 사유가 안 보인다 */
const NAMES_SHOWN = 5
function nameList(labels: string[]): string {
  if (labels.length <= NAMES_SHOWN) return labels.join(' · ')
  return `${labels.slice(0, NAMES_SHOWN).join(' · ')} 외 ${labels.length - NAMES_SHOWN}곳`
}

export default function BulkResultPanel({
  headline, failures = [], notice, children, onClose,
}: Props) {
  const groups = groupByMessage(failures)

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>{headline}</p>

      {children}

      {groups.length > 0 && (
        <ul style={{
          margin: 'var(--space-3) 0 0',
          paddingLeft: 'var(--space-5)',
          display: 'grid',
          gap: 'var(--space-1)',
        }}>
          {groups.map((g) => (
            <li key={g.message} style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              <strong>{nameList(g.labels)}</strong>
              {' — '}
              {g.message}
            </li>
          ))}
        </ul>
      )}

      {notice && <div style={{ marginTop: 'var(--space-3)' }}>{notice}</div>}

      <div style={{ marginTop: 'var(--space-3)' }}>
        <NbButton variant="secondary" onClick={onClose}>닫기</NbButton>
      </div>
    </div>
  )
}

/**
 * 진행률 한 줄 — 버튼 옆에 붙인다.
 *
 * "AI가 찾는 중…"처럼 끝을 모르는 문구만 두면 사용자는 멈춘 것과 구분하지 못한다.
 * 몇 개 중 몇 개째인지가 보이면 기다릴 수 있다.
 */
export function BulkProgress({ done, total }: { done: number; total: number }) {
  if (total <= 1) return null
  return (
    <span style={{
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {done}/{total}
    </span>
  )
}

/** 결과 한 줄을 화면마다 다시 쓰지 않게 — "12곳을 삭제했어요. 3곳은 실패했어요." */
export function bulkHeadline(ok: number, failedCount: number, verb: string, unit = '건'): string {
  if (ok === 0) return `${verb}하지 못했어요.`
  const base = `${ok.toLocaleString()}${unit}을 ${verb}했어요.`
  return failedCount > 0 ? `${base} ${failedCount.toLocaleString()}${unit}은 실패했어요.` : base
}
