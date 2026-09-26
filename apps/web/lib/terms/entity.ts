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
  surface: 'member' | 'crm' | 'ci' | 'rfp'
}

export type EntityKey =
  | 'company' | 'person' | 'deal' | 'quote' | 'cost' | 'product' | 'meeting' | 'note'
  | 'task' | 'event' | 'pipeline' | 'stage'
  | 'channel' | 'content'
  | 'dailyLog' | 'weeklyReport'
  | 'bid' | 'project' | 'doc' | 'requirement'
  | 'anomaly' | 'report' | 'companyProfile' | 'source'

export const ENTITY: Record<EntityKey, EntityMeta> = {
  /** 「거래처」는 **메뉴 묶음 이름**이고 개체 이름은 「회사」다 — 둘을 섞지 않는다 */
  company: { label: '회사', id: 'company', counter: '곳', surface: 'crm' },
  /** `담당자`·`연락처` 금지 — 구 화면(/contacts) 잔재 */
  person: { label: '인물', id: 'person', counter: '명', surface: 'crm' },
  /** `영업기회` 금지 — 구 화면(/deals) 잔재 */
  deal: { label: '딜', id: 'deal', counter: '건', surface: 'crm' },
  quote: { label: '견적', id: 'quote', counter: '건', surface: 'crm' },
  /** 딜에 드는 돈 한 줄. 「비용」이 아니라 **원가**다 — 코드도 화면도 전부 cost 로 부른다 */
  cost: { label: '원가 항목', id: 'deal_cost', counter: '건', surface: 'crm' },
  /**
   * 견적에 올릴 수 있는 것 하나. **`상품`·`제품` 금지** —
   * 우리가 파는 것에는 장비도 라이선스도 사람의 공수도 있어서
   * 「상품」이라 부르면 공수 줄이 그 목록에 없는 것처럼 읽힌다.
   * 견적 표의 열 이름(`QUOTE.lineName`)과 같은 말을 쓴다.
   */
  product: { label: '품목', id: 'product', counter: '개', surface: 'crm' },
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

  /*
    RFP 분석기의 개체 여덟.

    낱말 358개가 `lib/rfp/terms.ts` 안에만 있고 용어집에는 서비스 이름 한 줄뿐이었다.
    카탈로그와 어시스턴트가 이 이름들을 전제하므로, 그 둘보다 먼저 여기 있어야 한다.
  */

  /** 기관이 낸 것. 「입찰공고」는 문서 이름이고 개체 이름은 「공고」다 */
  bid: { label: '공고', id: 'bid', counter: '건', surface: 'rfp' },
  /** 공고가 가리키는 일. 공고 하나에 사업 하나가 원칙이지만 나뉘기도 한다 */
  project: { label: '사업', id: 'project', counter: '건', surface: 'rfp' },
  /** 공고에 딸려 온 파일 하나. 「첨부」는 딸려 온 방식이지 개체가 아니다 */
  doc: { label: '문서', id: 'doc', counter: '건', surface: 'rfp' },
  /** 문서에서 뽑아낸 지켜야 할 것 하나 */
  requirement: { label: '요구사항', id: 'requirement', counter: '건', surface: 'rfp' },
  /** 확정과 의심을 함께 담는다. 「독소조항」이라 부르지 않는다 — 단정이 세다 */
  anomaly: { label: '이상 조항', id: 'anomaly', counter: '건', surface: 'rfp' },
  /** 분석 한 판의 결과. 차수가 쌓이므로 판마다 한 건이다 */
  report: { label: '리포트', id: 'report', counter: '건', surface: 'rfp' },
  /** 우리 회사가 무엇을 할 수 있나. 조직마다 하나라 세는 말이 「개」다 */
  companyProfile: { label: '회사 프로필', id: 'company_profile', counter: '개', surface: 'rfp' },
  /** 공고를 어디서 가져오나. 「수집처」이지 「사이트」가 아니다 */
  source: { label: '수집처', id: 'source', counter: '곳', surface: 'rfp' },
}

/** 어느 시스템의 일인가 — 캘린더가 표면 배지를 붙일 때 쓴다 */
export type SurfaceKey = EntityMeta['surface']

/** 표면의 말 — 캘린더 배지·이동 안내가 쓴다 */
export const SURFACE_LABEL: Record<SurfaceKey, string> = {
  member: '업무',
  crm: 'CRM',
  ci: '콘텐츠',
  /** 배지에 「RFP 분석기」를 다 쓰면 다른 배지와 길이가 안 맞는다. 간판은 SERVICE_LABEL 이 따로 있다 */
  rfp: 'RFP',
}

/**
 * 서비스 **간판** — 셸의 로고 자리가 "지금 어느 서비스인가"를 말할 때 쓴다.
 *
 * `SURFACE_LABEL`(위)과 **쓰임이 다르다**: 저건 항목 옆에 붙는 **배지**라 짧아야 하고
 * (`CRM` · `콘텐츠`), 이건 **간판**이라 정식 이름이어야 한다(`영업 CRM` · `콘텐츠 인텔리전스`).
 * 두 벌인 이유를 안 적어 두면 다음 사람이 "중복"이라며 하나로 합치고, 그러면 배지가 길어지거나
 * 간판이 짧아진다.
 *
 * **왜 생겼나**: 셸 넷이 로고 자리에 **회사 브랜드만** 똑같이 띄워서, 화면만 봐서는
 * 지금 CRM 인지 콘텐츠 인텔리전스인지 알 수 없었다(사용자 지적 2026-08-27:
 * "각각 로고 위치에 정확히 지금 보여주고 있는게 어떤 서비스인지 표시 되야 하는게
 * 명확한거 아닌가? 메인로고 텍스트가 아니라"). `/develop` 만 이미 「개발자센터」를 달고 있었다.
 */
export const SERVICE_LABEL = {
  member: '업무 워크스페이스',
  crm: '영업 CRM',
  ci: '콘텐츠 인텔리전스',
  /**
   * AI 채팅·프로젝트·목록 심층분석을 한 서비스로 묶은 이름.
   * 「AI 채팅」이라 부르면 채팅이 아닌 둘이 채팅 밑에 들어가는 꼴이 된다.
   */
  ai: 'AI 스튜디오',
  /**
   * 제안요청서를 읽어 리포트·적합도·이상 조항까지 내는 서비스.
   * 「RFP 분석」이라 부르지 않는 이유: 분석만 하는 것이 아니라 제안서 목차까지 낸다.
   */
  rfp: 'RFP 분석기',
  /**
   * 선물 매매 판단을 모으고 신호를 내는 서비스. **소유자 한 사람만** 본다(명세 M11).
   *
   * 다른 넷과 달리 쓰는 사람이 한 명이지만 **골격은 같다** — 들어가면 사이드바가 이 서비스
   * 것으로 바뀌고 나가는 문이 한 벌 선다. 사람 수는 그 서비스가 어떻게 생겨야 하는지를
   * 정하지 않는다(사용자 지적 2026-09-27: 「다른 서비스들처럼 왜 별도의 메뉴 구성이 안되나?」).
   */
  trading: 'AI 트레이딩',
  admin: '관리자',
  develop: '개발자센터',
} as const

/**
 * AI 트레이딩 안의 화면 이름 — **사이드바와 화면 제목이 같은 상수를 읽는다**(§2-3-3 N-4).
 *
 * 같은 경로를 두 곳이 다르게 부르면 사용자는 다른 화면이라고 읽는다 —
 * `/lead-intake` 가 사이드바에선 「프로젝트관리」, 전체 메뉴에선 「리드 인테이크」였던 전례.
 */
export const TRADING_NAV_LABEL = {
  /** 첫 화면. 지금 무슨 일이 벌어지고 있나 — 신호·들고 있는 것·알림 */
  overview: '현황',
  /** 내가 무엇을 하기로 했나의 기록. 쌓이는 목록이라 자기 자리가 있어야 한다 */
  judgments: '판단 기록',
  /** 이 전략으로 실제 돈을 걸어도 되나 — 관문과 지연 */
  validation: '검증',
  /** 도는 것을 지켜보는 자리 — AI 운영자 점검·자동 주문 무장·최근 실행 */
  operations: '운영',
  /** 판단의 재료가 제대로 모이고 있나 — 봉 수집·파일 넣기·이벤트 */
  data: '자료',
  /** 무엇을 근거로 그렇게 판단하나 */
  knowledge: '지식',
  /** 처음 한 번 정하고 가끔 손보는 것. 그래서 맨 아래다 */
  settings: '설정',
} as const

export type ServiceKey = keyof typeof SERVICE_LABEL

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
