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
import { iGa, eulReul, eunNeun } from '../ui/josa.ts'

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
export interface DeleteConfirmParts {
  /** 물음 한 줄. **제목 자리에 그대로 들어간다** */
  title: string
  /** 결과 — 함께 사라지는 것과 남는 것. 없으면 `undefined` */
  body?: string
}

/**
 * 삭제 확인을 **물음과 결과로 나눠** 준다.
 *
 * **왜 나눠야 하나**: 대화상자의 제목은 `.tape-title` 이고 그 클래스는
 * `white-space: nowrap` 이다(테이프 라벨이라 그렇다). 그래서 결과 문장까지 붙은
 * 긴 한 줄을 제목으로 넘기면 **상자 밖으로 흘러넘친다** —
 * 실측(2026-09-08 프로덕션 `/crm/tasks`): 「할 일 1건을 삭제할까요? 딜과 미팅 기록은
 * 그대로 남아요.는 남습니…」가 모달을 뚫고 잘려 나갔다.
 *
 * 자리를 나눠 주면 화면이 「어디에 무엇을 넣을지」를 매번 정하지 않아도 된다(§2-3-4 C-1).
 *
 * `alsoGone`·`stays` 는 **명사구**를 준다 — 조사와 서술어는 여기서 붙인다.
 * 완성된 문장을 넘기면 「…남아요.는 남습니다.」처럼 두 번 끝난다(그 사고가 위 실측이다).
 */
export function confirmDeleteParts(
  key: EntityKey,
  n: number,
  opts?: { alsoGone?: string; stays?: string },
): DeleteConfirmParts {
  const phrase = count(key, n)              // 예: '미팅 1건'
  const title = `${phrase}${eulReul(phrase)} 삭제할까요?`

  const tail: string[] = []
  if (opts?.alsoGone) tail.push(`${opts.alsoGone}${iGa(opts.alsoGone)} 함께 사라지고`)
  // 받침은 `josa.ts` 가 센다 — 여기에 `는` 을 박아 두면 「기록는 남습니다」가 된다
  if (opts?.stays) tail.push(`${opts.stays}${eunNeun(opts.stays)} 남습니다`)
  return { title, body: tail.length ? `${tail.join(', ')}.` : undefined }
}

/**
 * 한 줄로 필요한 자리(브라우저 `confirm()` 등)를 위한 조립본.
 *
 * **우리 대화상자에는 이걸 제목으로 넘기지 않는다** — `confirmDeleteParts` 를 써서
 * 제목과 본문으로 나눈다. 그 규칙은 `lib/ui/ask-dialog-standard.test.ts` 가 지킨다.
 */
export function confirmDelete(
  key: EntityKey,
  n: number,
  opts?: { alsoGone?: string; stays?: string },
): string {
  const p = confirmDeleteParts(key, n, opts)
  return p.body ? `${p.title} ${p.body}` : p.title
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
