/**
 * 공개 API 엔드포인트 SSOT — 문서·OpenAPI·가드가 **모두 여기서 나온다**
 *
 * 왜 이 파일이 생겼나 (실측 v0.7.616):
 *   `/develop` 이 940줄짜리 손으로 쓴 JSX 였다. 엔드포인트를 추가해도 문서는 저절로 늘지 않고,
 *   문서를 고쳐도 코드는 변하지 않는다. 둘이 서로를 모르니 **어긋나도 아무 일도 일어나지 않았다** —
 *   그래서 2026-05-31 에 쓴 문장이 그대로 남아 「분당 60회」처럼 없는 기능을 약속했다.
 *   그 사이 저장소는 664커밋을 갔고 `app/api` 에 라우트 167개가 생겼는데,
 *   `app/api/public` 에서 바뀐 파일은 **0개**였다.
 *
 *   유일하게 안 썩은 부분이 7개 언어 코드 예시였다 — `lib/api-docs/snippets.ts` 가
 *   요청 명세 하나에서 **생성**하기 때문이다. 우리는 이미 답을 갖고 있었고, 그걸
 *   코드 예시에만 쓰고 엔드포인트에는 안 썼다. 이 파일이 그 나머지 절반이다.
 *
 * 이 표가 지배하는 것:
 *   · `/develop` 화면 — 목록·설명·파라미터·예시를 여기서 렌더한다(수기 JSX 금지)
 *   · `/api/public/v1/openapi.json` — 같은 표에서 생성한다
 *   · `lib/api-docs/registry.test.ts` — 라우트 파일 ↔ 이 표가 어긋나면 **테스트가 실패한다**
 *
 * 새 엔드포인트를 만들면 **여기 등재하기 전까지 `pnpm test` 가 통과하지 않는다.**
 */

import type { HttpMethod } from './snippets.ts'
import { SERVICE_LABEL } from '../terms/index.ts'

/** 화면 왼쪽 묶음 — 사용자가 "무엇을 하려는가"로 나눈다 */
export type ApiGroupKey = 'start' | 'gpu' | 'crm' | 'ci' | 'legacy' | 'ref'

export interface ApiGroup {
  key: ApiGroupKey
  label: string
  /** 묶음 자체의 안내 — 무엇을 할 수 있는 곳인지 한 줄 */
  desc?: string
}

export const API_GROUPS: readonly ApiGroup[] = [
  { key: 'start', label: '시작하기' },
  { key: 'gpu', label: 'GPU 가격', desc: '실시간 가격·견적·재고·환율. 내부 화면과 같은 계산을 씁니다.' },
  { key: 'crm', label: SERVICE_LABEL.crm, desc: '회사·인물·딜·미팅·견적·할 일. 키를 만든 계정의 CRM 권한을 그대로 씁니다.' },
  { key: 'ci', label: SERVICE_LABEL.ci, desc: '채널·게시물. 워크스페이스가 여럿이면 workspace 를 지정합니다.' },
  { key: 'legacy', label: '이관 중', desc: '구 CRM 표를 향합니다. 새 코드는 「영업 CRM」을 쓰세요.' },
  { key: 'ref', label: '참고' },
] as const

export interface ApiParam {
  name: string
  type: string
  required?: boolean
  desc: string
}

/**
 * 라이브 데모 — **문을 선언한 자리에서 데모도 선언한다.**
 *
 * 왜 여기 있나 (실측 v0.7.621): `DemoSection.tsx` 가 자기 목록 8개를 따로 들고 있었다.
 * 그래서 이 표에 문을 24개 등재하는 동안 데모는 8개에 멈춰 있었고, 그중 둘은
 * **이관 중인 구 표**(`/accounts`·`/deals`)를 두드렸다 — 같은 페이지 위쪽 문서가
 * 「새 코드는 `/crm/companies` 를 쓰세요」라고 말하는 바로 아래에서.
 * 목록이 두 벌이면 반드시 갈린다. 이 표가 940줄 수기 JSX 를 없앤 이유와 같은 이유다.
 *
 * ⚠️ **함수를 담지 않는다.** 이 파일은 `/api/public/v1/openapi.json` 라우트(서버)도 읽는다.
 *    앞선 응답에서 값을 꺼내 와야 하는 요청은 **이름으로 가리키고**(`needs`),
 *    그 이름을 푸는 코드는 화면이 갖는다.
 */
export interface ApiDemo {
  emoji: string
  /** 데모가 붙일 쿼리. 운영 데이터를 통째로 끌지 않게 데모는 조금만 가져온다 */
  query?: Record<string, string>
  /** 고정 요청 본문. 값이 실데이터에 따라 달라지면 여기 두지 말고 `needs` 를 쓴다 */
  body?: Record<string, unknown>
  /** 먼저 실데이터에서 얻어야 하는 값 — 화면이 이 이름을 푼다 */
  needs?: 'gpu-product-id'
}

export interface ApiEndpoint {
  /** 안정 식별자 — OpenAPI operationId 이자 화면 앵커 */
  id: string
  group: ApiGroupKey
  method: HttpMethod
  /** `/api/public/v1` 다음의 경로. 경로 변수는 `{id}` 로 적는다 */
  path: string
  title: string
  desc: string
  /** 필요한 권한 — 없으면 살아 있는 키면 된다 */
  requires?: 'admin' | 'crm-member' | 'ci-member'
  status: 'stable' | 'deprecated'
  /** 왜 이관 중인지 — deprecated 면 반드시 적는다 */
  deprecatedNote?: string
  query?: ApiParam[]
  body?: ApiParam[]
  /** 응답 예시(JSON 문자열). 없으면 공통 봉투만 보여 준다 */
  sample?: string
  /** 「직접 실행」에 버튼으로 뜬다. 없으면 문서에만 나온다 */
  demo?: ApiDemo
}

/** 목록 API 가 공통으로 받는 것 — 같은 설명을 엔드포인트마다 다시 적지 않는다 */
const CURSOR_QUERY: readonly ApiParam[] = [
  { name: 'limit', type: 'number', desc: '한 번에 가져올 개수. 기본 20, 최대 100' },
  { name: 'cursor', type: 'string', desc: '이어 보기 커서. 응답 meta.nextCursor 를 그대로 넣습니다' },
  { name: 'q', type: 'string', desc: '이름·제목 검색어' },
]

export const ENDPOINTS: readonly ApiEndpoint[] = [
  /* ── GPU 가격 ─────────────────────────────────────────────────────────── */
  {
    id: 'gpu.products.list', group: 'gpu', method: 'GET', path: '/products', status: 'stable',
    demo: { emoji: '📦' },
    title: 'GPU 목록', desc: '취급 중인 GPU 구성과 우리 판매가. 내부 가격표와 같은 계산(getGpuCatalog)을 씁니다.',
    query: [{ name: 'cursor', type: 'string', desc: '이어 보기 커서' }],
    sample: `{
  "success": true,
  "data": [
    { "id": "…", "model_name": "H100 SXM", "memory": "80GB", "gpu_count": 8,
      "price_per_unit_krw": 4200000, "price_per_unit_usd": 2800.0, "available": true }
  ],
  "meta": { "total": 88, "nextCursor": null, "hasMore": false }
}`,
  },
  {
    id: 'gpu.products.get', group: 'gpu', method: 'GET', path: '/products/{id}', status: 'stable',
    title: 'GPU 상세', desc: '구성 하나의 스펙·가격·공급 상태.',
  },
  {
    id: 'gpu.quote.create', group: 'gpu', method: 'POST', path: '/quote', status: 'stable',
    demo: { emoji: '🧮', needs: 'gpu-product-id', body: { items: [{ quantity: 4 }], currency: 'KRW' } },
    title: '견적 계산', desc: '구성과 수량으로 견적을 계산합니다. 마진·통화를 지정할 수 있습니다.',
    body: [
      { name: 'items', type: 'array', required: true, desc: '{ product_id, quantity } 목록' },
      { name: 'currency', type: '"KRW" | "USD"', desc: '견적 통화. 기본 KRW' },
      { name: 'margin_pct', type: 'number', desc: '이 견적에만 적용할 마진(%)' },
    ],
  },
  {
    id: 'gpu.inventory.list', group: 'gpu', method: 'GET', path: '/inventory', status: 'stable',
    demo: { emoji: '🏭' },
    title: '재고', desc: 'Tier 별 재고 수량.',
  },
  {
    id: 'gpu.fx.list', group: 'gpu', method: 'GET', path: '/fx', status: 'stable',
    demo: { emoji: '💱' },
    title: '환율', desc: 'USD/KRW 환율 이력(최근 7일). 가격 계산에 쓰인 값과 같습니다.',
  },
  {
    id: 'gpu.suppliers.list', group: 'gpu', method: 'GET', path: '/suppliers', status: 'stable',
    demo: { emoji: '🏢' },
    title: '공급사 목록', desc: '등록된 공급사.',
  },
  {
    id: 'gpu.suppliers.create', group: 'gpu', method: 'POST', path: '/suppliers', status: 'stable',
    title: '공급사 등록', desc: '새 공급사를 등록합니다.',
    body: [{ name: 'name', type: 'string', required: true, desc: '공급사 이름' }],
  },
  {
    id: 'gpu.market.list', group: 'gpu', method: 'GET', path: '/market', status: 'stable',
    title: '경쟁사 시세', desc: '수집된 경쟁사 가격 관측치.',
  },
  {
    id: 'gpu.settings.get', group: 'gpu', method: 'GET', path: '/settings', status: 'stable',
    title: '가격 설정 조회', desc: '기본 마진과 가격 전략 설정.',
  },
  {
    id: 'gpu.settings.update', group: 'gpu', method: 'PATCH', path: '/settings', status: 'stable',
    title: '가격 설정 변경', desc: '기본 마진을 바꿉니다. 바꾼 사람은 감사 기록에 남습니다.',
    body: [{ name: 'margin_pct', type: 'number', required: true, desc: '기본 마진(%)' }],
  },
  {
    id: 'gpu.poolStock.list', group: 'gpu', method: 'GET', path: '/pool-stock', status: 'stable',
    title: '풀 재고 조회', desc: 'Tier 3 풀 재고 수량.',
  },
  {
    id: 'gpu.poolStock.update', group: 'gpu', method: 'POST', path: '/pool-stock', status: 'stable',
    title: '풀 재고 갱신', desc: '풀 재고 수량을 갱신합니다.',
    body: [
      { name: 'product_id', type: 'string', required: true, desc: '대상 구성 id' },
      { name: 'quantity', type: 'number', required: true, desc: '수량' },
    ],
  },

  /* ── 영업 CRM (신규) ───────────────────────────────────────────────────── */
  {
    id: 'crm.companies.list', group: 'crm', method: 'GET', path: '/crm/companies', status: 'stable',
    demo: { emoji: '🏛', query: { limit: '5' } },
    requires: 'crm-member', title: '회사 목록', desc: '워크스페이스의 회사. 최신순 커서 페이지.',
    query: [...CURSOR_QUERY],
    sample: `{
  "success": true,
  "data": [ { "id": "…", "name": "…", "domain": "…", "ownerId": "…" } ],
  "meta": { "total": 373, "nextCursor": "…", "hasMore": true }
}`,
  },
  {
    id: 'crm.companies.get', group: 'crm', method: 'GET', path: '/crm/companies/{id}', status: 'stable',
    requires: 'crm-member', title: '회사 상세', desc: '회사 하나의 속성.',
  },
  {
    id: 'crm.people.list', group: 'crm', method: 'GET', path: '/crm/people', status: 'stable',
    demo: { emoji: '👤', query: { limit: '5' } },
    requires: 'crm-member', title: '인물 목록', desc: '회사에 속한 사람. 「담당자」가 아니라 「인물」입니다.',
    query: [...CURSOR_QUERY],
  },
  {
    id: 'crm.people.get', group: 'crm', method: 'GET', path: '/crm/people/{id}', status: 'stable',
    requires: 'crm-member', title: '인물 상세', desc: '인물 하나의 속성과 연락 수단.',
  },
  {
    id: 'crm.deals.list', group: 'crm', method: 'GET', path: '/crm/deals', status: 'stable',
    demo: { emoji: '📈', query: { limit: '5' } },
    requires: 'crm-member', title: '딜 목록', desc: '진행 중인 영업 건. 「영업기회」가 아니라 「딜」입니다.',
    query: [...CURSOR_QUERY],
  },
  {
    id: 'crm.deals.get', group: 'crm', method: 'GET', path: '/crm/deals/{id}', status: 'stable',
    requires: 'crm-member', title: '딜 상세', desc: '딜 하나의 단계·금액·소유자.',
  },
  {
    id: 'crm.meetings.list', group: 'crm', method: 'GET', path: '/crm/meetings', status: 'stable',
    demo: { emoji: '🗓', query: { limit: '5' } },
    requires: 'crm-member', title: '미팅 목록', desc: '기록된 미팅. 요약·전사 상태를 함께 줍니다.',
    query: [...CURSOR_QUERY],
  },
  {
    id: 'crm.quotes.list', group: 'crm', method: 'GET', path: '/crm/quotes', status: 'stable',
    demo: { emoji: '🧾', query: { limit: '5' } },
    requires: 'crm-member', title: '견적 목록', desc: 'CRM 견적(딜에 붙는 문서). GPU 견적 계산과는 다릅니다.',
    query: [...CURSOR_QUERY],
  },
  {
    id: 'crm.tasks.list', group: 'crm', method: 'GET', path: '/crm/tasks', status: 'stable',
    demo: { emoji: '✅', query: { limit: '5' } },
    requires: 'crm-member', title: '할 일 목록', desc: '딜·회사에 붙은 할 일.',
    query: [...CURSOR_QUERY],
  },

  /* ── 콘텐츠 인텔리전스 ─────────────────────────────────────────────────── */
  {
    id: 'ci.channels.list', group: 'ci', method: 'GET', path: '/ci/channels', status: 'stable',
    demo: { emoji: '📡' },
    requires: 'ci-member', title: '채널 목록', desc: '모니터링 중인 채널.',
    query: [
      { name: 'workspace', type: 'string', desc: '워크스페이스 id. 속한 곳이 하나면 생략할 수 있습니다' },
      { name: 'ownership', type: '"mine" | "market"', desc: '내 채널만 / 시장만' },
    ],
  },
  {
    id: 'ci.contents.list', group: 'ci', method: 'GET', path: '/ci/contents', status: 'stable',
    demo: { emoji: '🎬', query: { limit: '5' } },
    requires: 'ci-member', title: '게시물 목록', desc: '수집된 게시물. 「콘텐츠」가 아니라 「게시물」입니다.',
    query: [
      { name: 'workspace', type: 'string', desc: '워크스페이스 id' },
      { name: 'topicId', type: 'string', desc: '주제로 좁히기' },
      { name: 'windowDays', type: 'number', desc: '최근 N일' },
      { name: 'limit', type: 'number', desc: '개수. 기본 20, 최대 100' },
    ],
  },

  /* ── 참고 ─────────────────────────────────────────────────────────────── */
  {
    id: 'ref.openapi', group: 'ref', method: 'GET', path: '/openapi.json', status: 'stable',
    title: 'OpenAPI 스펙', desc: '이 표에서 생성한 OpenAPI 3.1 스펙. 클라이언트 생성기에 그대로 넣을 수 있습니다.',
  },

  /* ── 이관 중(구 CRM) ──────────────────────────────────────────────────── */
  ...legacyCrm('accounts', '거래처', '회사', 'crm.companies.list', '/crm/companies'),
  ...legacyCrm('contacts', '담당자', '인물', 'crm.people.list', '/crm/people'),
  ...legacyCrm('deals', '영업기회', '딜', 'crm.deals.list', '/crm/deals'),
]

/**
 * 구 CRM 3리소스는 모양이 같다 — 손으로 15줄씩 세 번 적으면 하나만 고치게 된다.
 *
 * 수정·삭제는 **본인이 만든 것이거나 관리자**만 할 수 있다. 이건 우리가 정한 규칙이 아니라
 * DB 의 RLS(`*_update_own`·`*_delete_own`)를 앱이 그대로 다시 지키는 것이다 —
 * 공개 API 는 서비스 롤로 돌아 RLS 를 우회하기 때문이다.
 */
function legacyCrm(
  table: string, oldWord: string, newWord: string, newId: string, newPath: string,
): ApiEndpoint[] {
  const note = `구 화면(/${table})의 표입니다. 새 코드는 「${newWord}」(${newPath})를 쓰세요 — 「${oldWord}」는 폐기된 말입니다.`
  const owner = '본인이 만든 항목이거나 관리자만 할 수 있습니다.'
  return [
    { id: `legacy.${table}.list`, group: 'legacy', method: 'GET', path: `/${table}`, status: 'deprecated',
      deprecatedNote: note, title: `${oldWord} 목록`, desc: `조회는 로그인한 전원이 할 수 있습니다. → ${newId}`,
      query: [
        { name: 'search', type: 'string', desc: '이름 검색' },
        { name: 'cursor', type: 'string', desc: '이어 보기 커서' },
        { name: 'sort', type: 'string', desc: '정렬 기준' },
        { name: 'dir', type: '"asc" | "desc"', desc: '정렬 방향' },
      ] },
    { id: `legacy.${table}.create`, group: 'legacy', method: 'POST', path: `/${table}`, status: 'deprecated',
      deprecatedNote: note, title: `${oldWord} 생성`, desc: '만든 사람이 소유자가 됩니다.' },
    { id: `legacy.${table}.get`, group: 'legacy', method: 'GET', path: `/${table}/{id}`, status: 'deprecated',
      deprecatedNote: note, title: `${oldWord} 상세`, desc: '단건 조회.' },
    { id: `legacy.${table}.update`, group: 'legacy', method: 'PATCH', path: `/${table}/{id}`, status: 'deprecated',
      deprecatedNote: note, title: `${oldWord} 수정`, desc: owner },
    { id: `legacy.${table}.delete`, group: 'legacy', method: 'DELETE', path: `/${table}/{id}`, status: 'deprecated',
      deprecatedNote: note, title: `${oldWord} 삭제`, desc: `${owner} 되돌릴 수 없습니다.` },
  ]
}

/** 화면이 묶음별로 그릴 때 쓴다 — 순서는 ENDPOINTS 선언 순서 그대로다 */
export function endpointsOf(group: ApiGroupKey): ApiEndpoint[] {
  return ENDPOINTS.filter((e) => e.group === group)
}

/** `/crm/companies/{id}` → `/crm/companies/:id` (라우트 파일 경로 대조용) */
export function toRoutePath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1')
}

/**
 * 「직접 실행」에 버튼으로 뜨는 것 — 화면이 목록을 따로 들지 않는다.
 *
 * 이관 중인 문은 여기 오지 않는다. 새 코드에 권하지 않는 것을 눌러 보게 두면
 * 문서는 「/crm/companies 를 쓰세요」라고 말하는데 손은 구 표를 두드리게 된다.
 */
export const DEMO_ENDPOINTS = ENDPOINTS.filter((e) => e.demo && e.status === 'stable')

/** 살아 있는 것만 — 이관 중인 것을 새로 쓰라고 권하지 않는다 */
export const STABLE_ENDPOINTS = ENDPOINTS.filter((e) => e.status === 'stable')

/**
 * 「무엇이 있어야 부를 수 있는가」 — 화면이 이 문장을 직접 적지 않는다.
 * 서비스 이름은 SERVICE_LABEL(SSOT)에서 온다. 여기서 손으로 적으면 간판과 갈린다.
 */
export const REQUIRES_LABEL: Record<NonNullable<ApiEndpoint['requires']>, string> = {
  admin: '관리자 키만 부를 수 있습니다',
  'crm-member': `키를 발급한 계정이 ${SERVICE_LABEL.crm} 멤버여야 합니다`,
  'ci-member': `키를 발급한 계정이 ${SERVICE_LABEL.ci} 워크스페이스 멤버여야 합니다`,
}
