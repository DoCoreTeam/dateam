// lib/ui/reorder.ts — 목록의 «순서 바꾸기» 계산 SSOT
//
// ## 왜 생겼나 (사용자 지적 2026-09-08)
//
// *"이거 영업단계 위치를 조정할 수 있도록 해줘 지금은 위치 이동이 안되니깐
//   보여질때 처음 만든 순서대로 보여지는게 불편해"*
//
// 영업 단계 화면에는 이미 위·아래 화살표가 있었다. 그런데 사용자에게는 «안 되는 것»이었다.
// 실측(v0.7.692 · 실브라우저):
//   · 버튼이 **28×28px** 이다. 터치 최소치 44px 미만이고 아이콘은 14px 이다
//   · 행 오른쪽 끝에서 연필·휴지통과 나란히 있어 «이름 바꾸기» 무리로 읽힌다
//   · **첫 항목의 ∧ 를 누르면 아무 일도 안 일어난다** — 경계에서 조용히 return 한다.
//     비활성 표시도, 안내도 없다. 눌러 본 사람은 «이 버튼은 작동하지 않는다»고 결론 낸다
//   · 카드가 세로로 길어 한 칸씩 옮기려면 누르고 · 다시 그려지고 · 찾아 스크롤하고 · 또 누른다
//
// 기능이 «있는데 발견되지 않는» 상태였다. 그래서 옮기는 방법을 **집는 것**(드래그)으로 바꾸고,
// 화살표는 키보드·접근성 경로로 남긴다.
//
// ## 왜 계산을 여기(컴포넌트 밖)에 두나
//
// 순서 계산이 `onDrop` 핸들러 안의 식이면 검증 수단이 **실브라우저뿐**이다(완료 조건 E-6).
// 그리고 이 계산은 조용히 틀린다 — 한 칸 밀리거나, 항목이 사라지거나, 중복된다.
// 그 결과가 곧바로 서버에 저장되므로 **틀리면 데이터가 틀어진다.**

/** 배열에서 항목 하나를 다른 자리로 옮긴 **새 배열**. 원본은 건드리지 않는다 */
export function moveTo<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length) return next
  // 범위 밖 목적지는 양 끝으로 — 목록 밖으로 떨어뜨려도 항목을 잃지 않는다.
  // (`splice` 도 알아서 자르지만, 음수를 «끝에서 세기»로 읽으므로 여기서 뜻을 못 박는다)
  const dest = Math.max(0, Math.min(next.length - 1, to))
  const [moved] = next.splice(from, 1)
  next.splice(dest, 0, moved)
  return next
}

/**
 * 드래그로 «이 항목의 앞/뒤»에 놓았을 때 **목적지 인덱스**.
 *
 * 여기가 한 칸씩 어긋나는 자리다. 두 보정이 겹친다:
 *   · 뒤에 놓으면 목적지는 한 칸 뒤다
 *   · 집어 든 것이 목적지보다 **앞**에 있었으면, 빠져나가면서 뒤가 이미 한 칸 당겨졌다
 * 둘 중 하나만 하면 화면은 그럴듯한데 순서가 한 칸씩 밀린 채 저장된다.
 */
export function dropIndex(from: number, over: number, placeAfter: boolean): number {
  let to = placeAfter ? over + 1 : over
  if (from < to) to -= 1
  return to
}

/** 한 칸 위(-1)·아래(+1)로. **경계면 원본 그대로** 돌려준다 — 부른 쪽이 «안 바뀜»을 알 수 있게 */
export function moveByStep<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items]
  return moveTo(items, index, to)
}

/**
 * 이 항목을 그 방향으로 옮길 수 있나 — **버튼을 끌지 말지**를 정한다.
 *
 * 예전엔 이 판정이 없어 첫 항목의 ∧ 가 눌리기는 하는데 아무 일도 안 했다.
 * 못 하는 것은 **못 한다고 보여 준다** — 무반응은 고장으로 읽힌다.
 */
export function canMove(index: number, delta: -1 | 1, total: number): boolean {
  const to = index + delta
  return index >= 0 && index < total && to >= 0 && to < total
}

/** 순서가 실제로 달라졌나 — 안 달라졌으면 저장하러 가지 않는다(헛 왕복·헛 감사기록 방지) */
export function orderChanged(before: readonly string[], after: readonly string[]): boolean {
  if (before.length !== after.length) return true
  return before.some((id, i) => id !== after[i])
}
