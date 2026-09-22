/**
 * 사람을 화면에 그릴 때 쓰는 값 한 벌 — 이름 옆에 무엇을 붙일지 한 곳에서 정한다
 *
 * **왜 필요한가** (실측 2026-09-22)
 *
 * 직급과 직책은 `profiles` 에 이미 들어 있었다 (34명 중 직급 32, 직책 11).
 * 고르는 규칙도 이미 있었다 (`lib/crm/services/member-title.ts` 의 `pickTitle`).
 * 그런데 그 규칙을 **부르는 곳이 견적서 하나뿐**이라, 견적서에만 「김도현 본부장」이 찍히고
 * 멤버 목록에는 이름만 떴다. 사람이 나오는 자리마다 각자 그리고 있어서 생긴 일이다.
 *
 * 그래서 규칙을 새로 만들지 않는다. **있는 규칙을 부르고, 그리는 모양만 한 벌로 정한다.**
 */

import { pickTitle } from '../crm/services/title-rule.ts'

export interface PersonSource {
  /** 사람 이름. 없으면 화면이 대신 쓸 것(메일 등)을 넘긴다 */
  name?: string | null
  /** 이 서비스에서 직접 지정한 직함. 대외 문서용으로 따로 쓰는 경우가 있다 */
  explicitTitle?: string | null
  /** 조직의 직책 — 본부장·팀장·실장 */
  position?: string | null
  /** 조직의 직급 — 상무·부장·차장 */
  rank?: string | null
}

export interface PersonDisplay {
  name: string
  /** 이름 옆에 붙일 한 마디. 없으면 빈 문자열이고 화면은 아무것도 안 그린다 */
  title: string
  /** 동그라미 안에 넣을 한 글자 */
  initial: string
}

/** 이름이 없을 때 쓰는 말. 「직원」처럼 있는 척하는 말을 지어내지 않는다 */
export const NO_NAME = '이름 없음'

/**
 * 화면에 그릴 이름과 직함을 고른다.
 *
 * 직함 우선순위는 `pickTitle` 이 정한다 — 직접 지정 > 직책 > 직급.
 * 여기서 다시 적으면 두 벌이 되고, 두 벌은 갈린다.
 */
export function personDisplay(src: PersonSource): PersonDisplay {
  const name = (src.name ?? '').trim() || NO_NAME
  const title = pickTitle(src.explicitTitle, { position: src.position ?? null, rank: src.rank ?? null })
  return { name, title, initial: name.slice(0, 1) }
}

/**
 * 한 줄로 이어 붙인 모양 — 표 한 칸이나 문장 안에 넣을 때 쓴다.
 *
 * 직함이 없으면 이름만 남는다. 「김도현 ()」 같은 빈 껍데기를 만들지 않는다.
 */
export function personLine(src: PersonSource): string {
  const { name, title } = personDisplay(src)
  return title ? `${name} ${title}` : name
}
