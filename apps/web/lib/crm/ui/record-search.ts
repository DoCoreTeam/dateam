// lib/crm/ui/record-search.ts — RecordPicker 가 쓰는 검색 창구 (SSOT)
//
// **왜 생겼나**: 같은 검색 함수가 화면마다 복붙돼 있었다 — 실측 v0.7.693 기준
// `searchCompanies` **5벌**(회의노트 발행카드·딜 폼·인물 폼·미팅 폼·미팅 사실),
// `searchDeals` **3벌**. 본문은 글자까지 같다.
// 여섯 번째가 생기기 전에 여기로 모은다(§재사용·단일구현).
//
// **찾기는 서버가 한다.** 받아온 20건 안에서 거르면 21번째는 영영 못 찾는다 —
// `RecordPicker` 가 그 원칙으로 만들어졌고, 이 창구도 같은 원칙을 지킨다.

import type { RecordOption, RecordSearch } from '@/components/ui/RecordPicker'
import { eulReul } from '@/lib/ui/josa'

/**
 * 한 번에 받아 올 개수.
 *
 * 목록 전체를 받는 것이 아니라 **검색어로 좁힌 결과의 앞부분**이다.
 * 사람이 한 화면에서 눈으로 훑을 수 있는 수를 넘기면 고르는 데 더 오래 걸린다.
 */
const LIMIT = 20

interface Row {
  id: string
  name: string
  companyName?: string | null
  title?: string | null
  stageName?: string | null
}

/**
 * 목록 API 를 부르고 `{ id, name }` 로 접는다 — 실패는 호출부(RecordPicker)가 보여 준다.
 *
 * 조사는 `josa.ts` 가 센다. 「회사을(를)」 같은 병기를 화면에 내보내지 않는다(§0-2 규칙 3).
 */
function listSearch(path: string, noun: string, hint?: (row: Row) => string | undefined): RecordSearch {
  return async (query, signal) => {
    const q = query.trim()
    const res = await fetch(
      `/api/crm/${path}?limit=${LIMIT}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      { signal },
    )
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? `${noun}${eulReul(noun)} 불러오지 못했습니다.`)
    return ((body.items ?? []) as Row[]).map((r): RecordOption => ({
      id: r.id,
      name: r.name,
      hint: hint?.(r),
    }))
  }
}

export const searchCompanies: RecordSearch = listSearch('companies', '회사')

/** 딜은 이름만으로 못 가릴 때가 있다 — 회사·단계를 곁들인다 */
export const searchDeals: RecordSearch = listSearch('deals', '딜', (r) =>
  [r.companyName, r.stageName].filter(Boolean).join(' · ') || undefined)

/** 인물도 동명이인이 흔하다 — 소속·직함을 곁들인다 */
export const searchPeople: RecordSearch = listSearch('people', '인물', (r) =>
  [r.companyName, r.title].filter(Boolean).join(' · ') || undefined)

/**
 * 제목에서 «찾아볼 만한 말»을 뽑는다.
 *
 * **왜 필요한가**: 할 일을 손으로 적으면 딜이 안 붙는다(실측 2026-09-08 `/crm/tasks`).
 * 그렇다고 제목을 통째로 검색어에 넣으면 아무것도 안 걸린다 —
 * 「숙명여대 부가포함 견적 송부」로 딜을 찾으면 0건이다. 걸리는 것은 「숙명여대」 하나뿐이다.
 *
 * 그래서 **고유명사처럼 보이는 첫 낱말**만 준다. 자동으로 잇지 않는다 —
 * 고를 창을 열어 줄 뿐이고 확정은 사람이 한다(§5-3 추출/제안형).
 */
/** 낱말 끝에 붙어 검색을 방해하는 부호 — 한글·영문·숫자는 건드리지 않는다 */
const PUNCT = /[.,·・…–—\-()[\]{}'"“”‘’!?:;/\\|~@#$%^&*+=<>]/g

export function searchHintFromTitle(title: string): string {
  for (const w of title.trim().split(/\s+/)) {
    // `\p{L}` 는 이 저장소의 컴파일 목표에서 못 쓴다(TS1501) — 붙는 부호만 떼어 낸다
    const bare = w.replace(PUNCT, '')
    // 한 글자는 거의 다 걸려서 고르는 데 도움이 안 된다
    if (bare.length < 2) continue
    // 「견적」처럼 어느 딜에나 붙는 말은 단서가 아니다
    if (COMMON_WORDS.has(bare)) continue
    return bare
  }
  return ''
}

/**
 * 업무 문장에 흔히 나오지만 상대를 특정하지 못하는 말.
 *
 * 늘리는 기준은 「이 말로 검색하면 대부분이 걸리는가」다.
 * 회사·사업 이름은 절대 넣지 않는다 — 그게 바로 우리가 찾으려는 것이다.
 */
const COMMON_WORDS = new Set([
  '견적', '견적서', '계약', '계약서', '미팅', '회의', '자료', '문서', '메일', '연락',
  '전화', '확인', '검토', '작성', '발송', '송부', '전달', '공유', '요청', '답변',
  '수정', '보고', '정리', '준비', '진행', '내부', '관련', '오늘', '내일', '이번',
])
