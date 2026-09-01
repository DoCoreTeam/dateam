/**
 * 서버 값이 **밖에서** 바뀌었을 때 폼을 어떻게 따라잡나 — SSOT
 *
 * **왜 이 파일이 생겼나** (실측 /crm/meetings/[id] v0.7.668):
 * 「원본에 맞추기」를 눌러 제목이 `8/31 미팅` → `8/31 김해사업 미팅` 으로 바뀌었는데,
 * 바로 아래 「무슨 미팅이었나요」 칸은 **옛 제목을 그대로 들고** 있었다.
 * 폼이 `useState(value.title)` 로 초기값만 잡고 다시 안 맞추기 때문이다.
 * 그래서 화면은 「저장」 줄을 띄우고(바뀐 게 있다고 보므로), 사용자가 그걸 누르면
 * **방금 맞춘 제목이 옛 제목으로 되돌아간다.** 고친 것을 화면이 되돌리는 셈이다.
 *
 * 고치는 방법이 둘 있는데 **둘 다 틀렸다**:
 *   ⓐ 서버 값이 바뀌면 폼을 통째로 덮는다 → 사용자가 입력 중이던 장소·회사가 사라진다.
 *      같은 화면에서 「미팅 끝내기」를 누르면 상세가 다시 읽으므로 실제로 일어난다.
 *   ⓑ 아무것도 안 한다 → 지금 상태. 옛 값이 남아 「저장」이 헛돈다.
 *
 * 그래서 **손대지 않은 칸만** 따라간다. 손댔는지는 「지금 값이 직전에 받은 서버 값과 같은가」로 안다 —
 * 같으면 사용자가 안 건드린 것이고, 다르면 사용자가 쓴 것이라 남의 변경으로 덮지 않는다.
 * (버전 관리의 3-way merge 와 같은 판정이다: base=직전 서버 값, theirs=새 서버 값, ours=지금 폼)
 *
 * **컴포넌트 밖에 두는 이유**(완료 조건 E-6): 이 판정이 틀리면 화면은 멀쩡한데
 * 사용자가 쓰던 글이 조용히 사라진다. 렌더 안의 `if` 로 두면 실브라우저 말고 검증 수단이 없다.
 */

/** 폼 한 벌을 「칸 이름 → 문자열」로 납작하게 편 것. 날짜·시각도 폼에서는 문자열이다 */
export type FormSnapshot = Record<string, string>

/**
 * 사용자가 손대지 않은 칸만 새 서버 값으로 바꾼 폼을 **새로 만들어** 돌려준다(원본 불변).
 *
 * @param base    직전에 서버에서 받아 폼에 반영했던 값
 * @param incoming 방금 서버에서 새로 받은 값
 * @param current 지금 폼에 들어 있는 값(사용자가 고쳤을 수 있다)
 */
export function adoptUntouched<T extends FormSnapshot>(base: T, incoming: T, current: T): T {
  const out: FormSnapshot = { ...current }
  for (const key of Object.keys(incoming)) {
    // 지금 값이 직전 서버 값 그대로면 = 사용자가 안 건드렸다 → 새 값을 받는다.
    // 다르면 = 사용자가 쓰던 것이다 → 그대로 둔다.
    if (current[key] === base[key]) out[key] = incoming[key]
  }
  return out as T
}

/**
 * 두 벌이 같은가 — 렌더 중에 상태를 고칠지 판정한다.
 *
 * 객체 동일성(`===`)으로 재면 **안 된다.** 부모가 `value={{...}}` 처럼 매 렌더 새 객체를 만들면
 * 영원히 «달라졌다»가 되어 렌더→setState→렌더가 멈추지 않는다. 값으로 잰다.
 */
export function sameSnapshot(a: FormSnapshot, b: FormSnapshot): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => a[k] === b[k])
}
