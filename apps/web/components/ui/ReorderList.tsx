'use client'

// components/ui/ReorderList.tsx — 세로 목록의 순서를 바꾸는 공용 부품
//
// ## 왜 부품인가 (§0 시스템 참조 순서)
//
// 「목록 항목을 세로로 재정렬」은 이 저장소에서 **네 곳이 각자** 만들고 있었다
// (`OrgTree` 는 @dnd-kit, `DealBoard`·`PipelineView`·`Composer` 는 네이티브 드래그).
// 공용 부품은 INVENTORY 에 없었다. 그래서 다섯 번째가 필요해졌을 때(영업 단계)
// 또 새로 만드는 대신 여기에 만들고 등재한다.
//
// ## 왜 드래그인가 (사용자 지적 2026-09-08)
//
// *"영업단계 위치를 조정할 수 있도록 해줘 지금은 위치 이동이 안되니깐"*
//
// 영업 단계에는 이미 위·아래 화살표가 있었다. 그런데 **28×28px** 에 아이콘 14px 이고,
// 행 오른쪽 끝에서 연필·휴지통과 나란히 있어 「이름 바꾸기」 무리로 읽혔다.
// 결정적으로 **첫 항목의 ∧ 는 눌려도 아무 일이 없었다** — 비활성 표시조차 없이 조용히 무시했다.
// 눌러 본 사람은 「이 버튼은 작동하지 않는다」고 결론 낸다.
//
// 그래서 셋을 함께 고친다: ① 집어서 옮긴다(드래그) ② 못 옮기면 **못 옮긴다고 보여 준다**
// ③ 버튼은 터치 최소치(44px)를 지킨다. 화살표를 없애지 않는 이유는 **키보드 경로**이기 때문이다 —
// 드래그만 남기면 마우스 없이는 순서를 못 바꾼다.
//
// 순서 계산은 `lib/ui/reorder.ts` 가 한다(SSOT · E-6) — 핸들러 안의 식은 실브라우저 외에
// 검증 수단이 없는데, 그 결과가 곧바로 서버에 저장되므로 틀리면 데이터가 틀어진다.

import { useState, type ReactNode } from 'react'
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react'
import { moveTo, moveByStep, canMove, orderChanged, dropIndex } from '@/lib/ui/reorder'
import styles from './reorder-list.module.css'

export interface ReorderListProps<T> {
  items: T[]
  getId: (item: T) => string
  /** 스크린리더가 읽을 이름 — 「리드 위로 옮기기」 */
  getLabel: (item: T) => string
  /** 새 순서. **달라졌을 때만** 부른다 */
  onReorder: (orderedIds: string[]) => void
  /** 자리가 고정된 항목(성사·실패처럼 끝에 있어야 하는 것) — 집을 수 없고 자리도 못 내준다 */
  isFixed?: (item: T) => boolean
  disabled?: boolean
  className?: string
  itemClassName?: string
  /**
   * 항목 내용. `controls`(손잡이 + 위/아래)를 **화면이 원하는 자리에** 넣는다.
   *
   * 부품이 직접 그리지 않는 이유: 항목마다 머리 행 구성이 다르다(뱃지·건수·액션…).
   * 손잡이를 `<li>` 직계로 박으면 그 행의 배치가 깨진다 — 행동은 부품이, 배치는 화면이(§patterns 슬롯).
   */
  children: (item: T, index: number, controls: ReactNode) => ReactNode
}

export default function ReorderList<T>({
  items, getId, getLabel, onReorder, isFixed, disabled = false,
  className, itemClassName, children,
}: ReorderListProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [after, setAfter] = useState(false)

  const fixed = (item: T) => Boolean(isFixed?.(item))
  /** 옮길 수 있는 것들만 자리를 주고받는다 — 고정 항목 사이로 끼어들면 순서 규칙이 깨진다 */
  const movable = items.filter((it) => !fixed(it))

  function commit(next: T[]) {
    const before = items.map(getId)
    const ids = next.map(getId)
    if (!orderChanged(before, ids)) return
    onReorder(ids)
  }

  /** 옮길 수 있는 것들 안에서의 자리 — 고정 항목이 섞여 있어도 칸이 어긋나지 않는다 */
  function movableIndex(item: T) {
    return movable.findIndex((m) => getId(m) === getId(item))
  }

  /** 옮길 수 있는 것들의 새 순서를 **원래 자리에** 되돌려 끼운다(고정 항목은 제자리) */
  function withMovable(nextMovable: T[]): T[] {
    let k = 0
    return items.map((it) => (fixed(it) ? it : nextMovable[k++]))
  }

  function step(item: T, delta: -1 | 1) {
    const i = movableIndex(item)
    commit(withMovable(moveByStep(movable, i, delta)))
  }

  function drop(target: T, placeAfter: boolean) {
    if (dragId === null) return
    const from = movable.findIndex((m) => getId(m) === dragId)
    const over = movableIndex(target)
    if (from < 0 || over < 0) return
    // 한 칸 어긋나는 보정은 `reorder.ts` 가 한다 — 핸들러 안의 식은 실브라우저 외에 검증 수단이 없다(E-6)
    commit(withMovable(moveTo(movable, from, dropIndex(from, over, placeAfter))))
  }

  function reset() { setDragId(null); setOverId(null) }

  return (
    <ol className={[styles.list, className].filter(Boolean).join(' ')}>
      {items.map((item, index) => {
        const id = getId(item)
        const locked = disabled || fixed(item)
        const mi = movableIndex(item)
        const isOver = overId === id && dragId !== null && dragId !== id
        const controls = (
          <>
            <span
              className={locked ? `${styles.handle} ${styles.handleFixed}` : styles.handle}
              draggable={!locked}
              onDragStart={() => { if (!locked) setDragId(id) }}
              onDragEnd={reset}
              title={locked ? undefined : `${getLabel(item)}: 끌어서 순서를 바꿔요`}
            >
              {!locked && <GripVertical size={16} aria-hidden />}
              <span className={styles.pos}>{index + 1}</span>
            </span>

            {!locked && (
              <span className={styles.steps}>
                <button
                  type="button" className={styles.step}
                  onClick={() => step(item, -1)}
                  disabled={!canMove(mi, -1, movable.length)}
                  aria-label={`${getLabel(item)} 위로`} title="위로"
                >
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button
                  type="button" className={styles.step}
                  onClick={() => step(item, 1)}
                  disabled={!canMove(mi, 1, movable.length)}
                  aria-label={`${getLabel(item)} 아래로`} title="아래로"
                >
                  <ChevronDown size={16} aria-hidden />
                </button>
              </span>
            )}
          </>
        )
        return (
          <li
            key={id}
            className={[
              styles.item,
              itemClassName,
              dragId === id ? styles.dragging : '',
              isOver ? (after ? styles.overAfter : styles.overBefore) : '',
            ].filter(Boolean).join(' ')}
            onDragOver={(e) => {
              if (locked || dragId === null) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setOverId(id)
              setAfter(e.clientY > r.top + r.height / 2)
            }}
            onDragLeave={() => { if (overId === id) setOverId(null) }}
            onDrop={(e) => {
              if (locked || dragId === null) return
              e.preventDefault()
              drop(item, after)
              reset()
            }}
          >
            {children(item, index, controls)}
          </li>
        )
      })}
    </ol>
  )
}
