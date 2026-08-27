/**
 * 문장의 틀 — SSOT (용어집 §06)
 *
 * **왜 필요한가**: `scripts/ui-phrases.mjs` 가 빈 상태·로딩 문구를 **판정**은 하는데
 * **표준 문안이 없어서** 화면마다 각자 쓴다. 판정만 있고 답이 없으면 사람은 가드를 피해 갈 뿐이다.
 *
 * **여기서 정하는 것은 문형이지 문장이 아니다.** 개체 이름만 넣으면 같은 말투가 나온다.
 * 조사는 `lib/ui/josa.ts` 가 붙인다 — 화면에 "회사을(를)" 같은 병기가 나오지 않게.
 */

import { ENTITY, count, type EntityKey } from './entity.ts'
import { iGa, eulReul } from '../ui/josa.ts'

/**
 * 빈 상태 제목 — `딜이 아직 없어요`.
 *
 * **"없습니다"가 아니라 "없어요"다.** 빈 상태는 사용자를 탓하는 자리가 아니라
 * 다음 행동을 권하는 자리라서 말투가 부드러워야 한다(기존 `EmptyState` 문안과 같은 결).
 */
export function emptyTitle(key: EntityKey): string {
  const label = ENTITY[key].label
  return `${label}${iGa(label)} 아직 없어요`
}

/**
 * 오류 문장 — `회의노트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.`
 *
 * **사과하지 않는다.** "죄송합니다"는 무엇을 해야 하는지 안 알려 주면서 줄만 차지한다.
 * 대신 **무엇이 안 됐는지 + 다음에 무엇을 하면 되는지**를 준다.
 *
 * `verb` 는 '만들지'·'저장하지'처럼 **'-지' 까지** 넣는다 — 어미를 여기서 만들면
 * 불규칙 활용(만들다→만들지, 긋다→긋지)을 이 파일이 다 알아야 한다.
 */
export function failedTo(objectLabel: string, verb: string, next = '잠시 후 다시 시도해 주세요.'): string {
  return `${objectLabel}${eulReul(objectLabel)} ${verb} 못했습니다. ${next}`
}

/**
 * 삭제 확인 — `미팅 1건을 삭제할까요?`
 *
 * 되돌릴 수 없는 일이라 확인창이 유일한 안전장치다(R-5).
 * **함께 사라지는 것과 남는 것을 둘 다** 적는다 — 하나만 적으면 나머지를 상상하게 된다.
 *
 * 조사는 조수사에 붙는다 — `3건을` 이지만 `4개를` 다. 손으로 적으면 반드시 틀린다.
 */
export function confirmDelete(
  key: EntityKey,
  n: number,
  opts?: { alsoGone?: string; stays?: string },
): string {
  const phrase = count(key, n)              // 예: '미팅 1건'
  const head = `${phrase}${eulReul(phrase)} 삭제할까요?`

  const tail: string[] = []
  if (opts?.alsoGone) tail.push(`${opts.alsoGone}${iGa(opts.alsoGone)} 함께 사라지고`)
  if (opts?.stays) tail.push(`${opts.stays}는 남습니다`)
  return tail.length ? `${head} ${tail.join(', ')}.` : head
}

/**
 * 근거가 모자랄 때 — **숫자를 지어내지 않는다.**
 *
 * 표본이 적으면 "모른다"고 말하는 것이 맞다. 우리 AI 화면들이 이미 그렇게 하고 있고
 * (완료 조건 E-4 "근거 부족"), 그 계약을 문장으로도 고정한다.
 */
export function notEnough(what: string, because?: string): string {
  return because
    ? `${because}이라 ${what}${eulReul(what)} 내기 어려워요`
    : `아직 ${what}${iGa(what)} 부족해 말씀드리기 어려워요`
}
