/**
 * 개체의 말 — SSOT (용어집 §03)
 *
 * **왜 필요한가**: 조수사가 갈려 있다(실측 v0.7.597) — `건` 167 · `개` 62 · `곳` 30 · `명` 8.
 * 같은 개체를 어떤 화면은 「딜 3건」, 어떤 화면은 「딜 3개」로 센다.
 * 사람은 이걸 "다른 것을 세고 있나?"로 읽는다.
 *
 * **받침은 여기 안 적는다.** `lib/ui/josa.ts` 가 유니코드로 계산한다
 * (한글 음절은 `(코드-0xAC00)%28` 이 0이면 받침 없음). 표에 또 적으면 두 벌이 되고,
 * 둘이 어긋나면 어느 쪽이 진실인지 알 수 없다 — §재사용·단일구현 정책.
 */

/** 조수사 넷 — 이 밖은 쓰지 않는다 */
export type Counter = '건' | '곳' | '명' | '개'

export interface EntityMeta {
  /** 화면에 보이는 말 */
  label: string
  /** 코드·API·URL 이 쓰는 이름 */
  id: string
  /**
   * 셀 때 붙이는 말.
   *   · 건 — 사건·기록·문서 (딜·미팅·할 일·일정·견적)
   *   · 곳 — 장소성 개체 (회사·채널)
   *   · 명 — 사람
   *   · 개 — 설정·구조물 (파이프라인·단계)
   */
  counter: Counter
  /** 이 개체가 사는 표면 — 배지·이동 경로가 여기서 갈린다 */
  surface: 'member' | 'crm' | 'ci'
}

export type EntityKey =
  | 'company' | 'person' | 'deal' | 'quote' | 'meeting' | 'note'
  | 'task' | 'event' | 'pipeline' | 'stage'
  | 'channel' | 'content'
  | 'dailyLog' | 'weeklyReport'

export const ENTITY: Record<EntityKey, EntityMeta> = {
  /** 「거래처」는 **메뉴 묶음 이름**이고 개체 이름은 「회사」다 — 둘을 섞지 않는다 */
  company: { label: '회사', id: 'company', counter: '곳', surface: 'crm' },
  /** `담당자`·`연락처` 금지 — 구 화면(/contacts) 잔재 */
  person: { label: '인물', id: 'person', counter: '명', surface: 'crm' },
  /** `영업기회` 금지 — 구 화면(/deals) 잔재 */
  deal: { label: '딜', id: 'deal', counter: '건', surface: 'crm' },
  quote: { label: '견적', id: 'quote', counter: '건', surface: 'crm' },
  /** 팀에 공개된 기록. **회의노트(원본)와 다르다** */
  meeting: { label: '미팅', id: 'meeting', counter: '건', surface: 'crm' },
  /** 개인 소유 **원본**. 미팅은 여기서 발행받는다 */
  note: { label: '회의노트', id: 'note', counter: '건', surface: 'member' },
  /** `업무` 금지 — 「업무」는 `(member)` 표면 이름이라 충돌한다 */
  task: { label: '할 일', id: 'task', counter: '건', surface: 'crm' },
  event: { label: '일정', id: 'event', counter: '건', surface: 'member' },
  pipeline: { label: '파이프라인', id: 'pipeline', counter: '개', surface: 'crm' },
  /** 메뉴는 「영업 단계」, 본문은 「단계」 */
  stage: { label: '단계', id: 'stage', counter: '개', surface: 'crm' },
  channel: { label: '채널', id: 'channel', counter: '곳', surface: 'ci' },
  /** `콘텐츠` 금지 — 표면 이름(콘텐츠 인텔리전스)과 충돌한다 */
  content: { label: '게시물', id: 'content', counter: '건', surface: 'ci' },
  dailyLog: { label: '일일업무', id: 'daily_log', counter: '건', surface: 'member' },
  weeklyReport: { label: '주간보고', id: 'weekly_report', counter: '건', surface: 'member' },
}

/** 표면의 말 — 캘린더 배지·이동 안내가 쓴다 */
export const SURFACE_LABEL: Record<EntityMeta['surface'], string> = {
  member: '업무',
  crm: 'CRM',
  ci: '콘텐츠',
}

/**
 * 개수를 사람이 읽는 말로 — `딜 3건` · `회사 372곳`.
 *
 * 화면이 조수사를 고르지 않게 한다. 고르게 두면 같은 개체가 화면마다 다르게 세어진다.
 */
export function count(key: EntityKey, n: number): string {
  const e = ENTITY[key]
  return `${e.label} ${n}${e.counter}`
}

/** 개수만 — 앞말이 이미 나온 자리(`딜 · 3건`)에서 쓴다 */
export function countOnly(key: EntityKey, n: number): string {
  return `${n}${ENTITY[key].counter}`
}
