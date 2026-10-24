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
import { SERVICE_LABEL, API_CLI_DOC, API_APPROVAL_STATUS } from '../terms/index.ts'
import { SUPPLY_ROUNDING_UNITS } from '../crm/domain/quote-compose.ts'
import { CRM_ERROR_HTTP } from '../crm/domain/errors.ts'
import { APPROVAL_SCOPES, type Scope } from '../actions/types.ts'

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

/**
 * 응답 설명. 공통 봉투(success, data, meta)는 화면이 따로 보여 주므로 여기에는 data 안의 칸만 적는다.
 * 칸 이름은 registry.test.ts 가 라우트가 실제로 싣는 키와 대조한다, 손으로 적고 잊으면 막힌다
 */
export interface ApiResponseDoc {
  /** JSON 봉투가 아니라 파일을 돌려주면 그 형식 설명 */
  file?: string
  fields?: ApiParam[]
  /** 표 아래 한 줄. 표가 전체가 아니면 그렇다고 적는다 */
  note?: string
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
  /**
   * 필요한 권한 — 없으면 살아 있는 키면 된다.
   * 라우트가 부르는 인증 함수와 같아야 한다(registry.test.ts 가 대조): requireAdminKey 는 admin,
   * requireMemberKey 는 member(api_user 키 거절), withPublicCrmApi 는 crm-member, withPublicCiList 는 ci-member
   */
  requires?: 'admin' | 'member' | 'crm-member' | 'ci-member'
  /**
   * 관문(dispatchPublicApi)이 정의 표로 여는 창구가 키에 요구하는 범위.
   * registry.test.ts 가 정의 표(lib/actions/generated/table.ts)의 scope 와 대조한다
   */
  scope?: Scope
  status: 'stable' | 'deprecated'
  /** 왜 이관 중인지 — deprecated 면 반드시 적는다 */
  deprecatedNote?: string
  query?: ApiParam[]
  body?: ApiParam[]
  /** 응답 예시(JSON 문자열). 없으면 공통 봉투만 보여 준다 */
  sample?: string
  response?: ApiResponseDoc
  /** 「직접 실행」에 버튼으로 뜬다. 없으면 문서에만 나온다 */
  demo?: ApiDemo
}

/** 목록 API 가 공통으로 받는 것 — 같은 설명을 엔드포인트마다 다시 적지 않는다 */
const CURSOR_QUERY: readonly ApiParam[] = [
  { name: 'limit', type: 'number', desc: '한 번에 가져올 개수. 기본 20, 최대 100' },
  { name: 'cursor', type: 'string', desc: '이어 보기 커서. 응답 meta.nextCursor 를 그대로 넣습니다' },
  { name: 'q', type: 'string', desc: '이름·제목 검색어' },
]

/**
 * 관문으로 들어가는 쓰기 창구의 범위 안내. 범위가 승인 대상이면 202 승인 요청, 아니면 403 이다
 * (dispatch-core.ts decideAccess 와 같은 갈림, APPROVAL_SCOPES 를 그대로 읽는다)
 */
export function scopeNote(scope: Scope): string {
  const missing = APPROVAL_SCOPES.includes(scope)
    ? `없으면 키 주인 계정에 그 권한이 있을 때 202 로 승인 요청이 만들어집니다`
    : `없으면 403 입니다`
  return `키에 ${scope} 범위가 있어야 바로 실행되고, ${missing}. Idempotency-Key 헤더를 실으면 같은 요청을 다시 보내도 한 번만 실행됩니다.`
}

type GatewayEntry = Omit<ApiEndpoint, 'status' | 'scope'> & { scope: Scope }

/** 관문이 여는 쓰기 창구, 설명 끝에 범위 안내를 붙인다 */
function gateway(e: GatewayEntry): ApiEndpoint {
  return { ...e, status: 'stable', desc: `${e.desc} ${scopeNote(e.scope)}` }
}

/** 고치기 창구가 공통으로 받는 칸 */
const VERSION_BODY: ApiParam = {
  name: 'version', type: 'number', required: true,
  desc: `상세 응답의 version 을 그대로 넣습니다. 그 사이 누가 먼저 고쳤으면 ${CRM_ERROR_HTTP.CONFLICT} 입니다`,
}

/** 지우기 창구가 공통으로 받는 쿼리 */
const DELETE_MODE_QUERY: ApiParam = {
  name: 'mode', type: '"purge"', desc: '비우면 휴지통으로 옮기고, purge 면 영구 삭제합니다. 영구 삭제는 되돌릴 수 없습니다',
}

/** 회사 인물 딜은 고치기와 지우기의 모양이 같다 */
function crmEditAndDelete(path: string, idBase: string, word: string, body: ApiParam[]): ApiEndpoint[] {
  return [
    gateway({
      id: `${idBase}.update`, group: 'crm', method: 'PATCH', path, scope: 'write',
      requires: 'crm-member', title: `${word} 수정`, desc: '보낸 칸만 고칩니다. 소유자는 여기서 바꾸지 않습니다.',
      body: [VERSION_BODY, ...body],
    }),
    gateway({
      id: `${idBase}.delete`, group: 'crm', method: 'DELETE', path, scope: 'delete',
      requires: 'crm-member', title: `${word} 삭제`, desc: '기본은 휴지통으로 옮겨 화면에서 되돌릴 수 있습니다.',
      query: [DELETE_MODE_QUERY],
    }),
  ]
}

const COMPANY_BODY: ApiParam[] = [
  { name: 'name', type: 'string', required: true, desc: '회사 이름' },
  { name: 'domain', type: 'string', desc: '웹사이트 도메인' },
  { name: 'industry', type: 'string', desc: '업종' },
  { name: 'region', type: 'string', desc: '지역' },
  { name: 'descriptionMd', type: 'string', desc: '소개(마크다운)' },
]

const PERSON_BODY: ApiParam[] = [
  { name: 'name', type: 'string', required: true, desc: '인물 이름' },
  { name: 'companyId', type: 'string', desc: '속한 회사 id' },
  { name: 'email', type: 'string', desc: '이메일' },
  { name: 'phone', type: 'string', desc: '전화번호' },
  { name: 'title', type: 'string', desc: '직함' },
  { name: 'memo', type: 'string', desc: '메모' },
]

const DEAL_BODY: ApiParam[] = [
  { name: 'companyId', type: 'string', required: true, desc: '딜이 붙는 회사 id' },
  { name: 'name', type: 'string', required: true, desc: '딜 이름' },
  { name: 'pipelineId', type: 'string', desc: '비우면 워크스페이스 기본 파이프라인입니다' },
  { name: 'stageId', type: 'string', desc: '비우면 그 파이프라인의 첫 단계입니다' },
  { name: 'amountMinor', type: 'string | number', desc: '금액. 통화의 가장 작은 단위로 적습니다(원화는 원)' },
  { name: 'currency', type: 'string', desc: '통화 코드' },
  { name: 'expectedCloseDate', type: 'string', desc: '예상 마감일(YYYY-MM-DD)' },
]

/** 고치기는 만들기의 칸을 그대로 받되 필수가 아니다 */
const optional = (body: ApiParam[]): ApiParam[] => body.map(({ required: _required, ...rest }) => rest)

export const ENDPOINTS: readonly ApiEndpoint[] = [
  /* ── GPU 가격 ─────────────────────────────────────────────────────────── */
  {
    id: 'gpu.products.list', group: 'gpu', method: 'GET', path: '/products', status: 'stable',
    demo: { emoji: '📦' },
    requires: 'member',
    title: 'GPU 목록', desc: '취급 중인 GPU 구성과 우리 판매가. 내부 가격표와 같은 계산(getGpuCatalog)을 씁니다. 고정된 목록이라 커서 없이 한 번에 전부 주고, meta.total 이 전체 수입니다.',
    sample: `{
  "success": true,
  "data": [
    { "id": "…", "model_name": "H100 SXM", "memory": "80GB", "gpu_count": 8,
      "price_per_unit_krw": 4200000, "price_per_unit_usd": 2800.0, "available": true }
  ],
  "meta": { "total": 88, "currency": "USD", "fx_usd_krw": 1380.5 }
}`,
  },
  {
    id: 'gpu.products.get', group: 'gpu', method: 'GET', path: '/products/{id}', status: 'stable',
    requires: 'member', title: 'GPU 상세', desc: '구성 하나의 스펙·가격·공급 상태.',
  },
  {
    id: 'gpu.quote.create', group: 'gpu', method: 'POST', path: '/quote', status: 'stable',
    demo: { emoji: '🧮', needs: 'gpu-product-id', body: { items: [{ quantity: 4 }], currency: 'KRW' } },
    requires: 'member',
    title: '견적 계산', desc: '구성과 수량으로 견적을 계산합니다. 아무것도 저장하지 않습니다. 줄마다 마진을 따로 지정할 수 있습니다.',
    body: [
      { name: 'items', type: 'array', required: true,
        desc: '{ product_id, quantity, custom_margin_pct } 목록, 1줄 이상 50줄 이하. product_id 는 구성 id(uuid), quantity 는 1 이상 10000 이하 정수, custom_margin_pct 는 그 줄에만 적용할 마진(%)으로 0 이상 200 이하이고 없으면 기본 판매가입니다' },
      { name: 'currency', type: '"USD" | "KRW"', desc: '견적 통화. 기본 USD' },
    ],
  },
  {
    id: 'gpu.inventory.list', group: 'gpu', method: 'GET', path: '/inventory', status: 'stable',
    demo: { emoji: '🏭' },
    requires: 'member', title: '재고', desc: 'Tier 별 재고 수량.',
  },
  {
    id: 'gpu.fx.list', group: 'gpu', method: 'GET', path: '/fx', status: 'stable',
    demo: { emoji: '💱' },
    requires: 'member', title: '환율', desc: 'USD/KRW 환율 이력(최근 7일). 가격 계산에 쓰인 값과 같습니다.',
  },
  {
    id: 'gpu.suppliers.list', group: 'gpu', method: 'GET', path: '/suppliers', status: 'stable',
    demo: { emoji: '🏢' },
    requires: 'member', title: '공급사 목록', desc: '등록된 공급사.',
  },
  {
    id: 'gpu.suppliers.create', group: 'gpu', method: 'POST', path: '/suppliers', status: 'stable',
    requires: 'admin', title: '공급사 등록', desc: '새 공급사를 등록합니다.',
    body: [
      { name: 'name', type: 'string', required: true, desc: '공급사 이름' },
      { name: 'location', type: 'string', desc: '위치' },
      { name: 'contact', type: 'string', desc: '연락처' },
    ],
  },
  {
    id: 'gpu.market.list', group: 'gpu', method: 'GET', path: '/market', status: 'stable',
    requires: 'member', title: '경쟁사 시세', desc: '수집된 경쟁사 가격 관측치.',
  },
  {
    id: 'gpu.settings.get', group: 'gpu', method: 'GET', path: '/settings', status: 'stable',
    requires: 'member', title: '가격 설정 조회', desc: '기본 마진과 가격 전략 설정.',
  },
  {
    id: 'gpu.settings.update', group: 'gpu', method: 'PATCH', path: '/settings', status: 'stable',
    requires: 'admin', title: '가격 설정 변경', desc: '기본 마진을 바꿉니다. 바꾼 사람은 감사 기록에 남습니다.',
    body: [{ name: 'margin_pct', type: 'number', required: true, desc: '기본 마진(%)' }],
  },
  {
    id: 'gpu.poolStock.list', group: 'gpu', method: 'GET', path: '/pool-stock', status: 'stable',
    requires: 'member', title: '풀 재고 조회', desc: 'Tier 3 풀 재고 수량.',
  },
  {
    id: 'gpu.poolStock.update', group: 'gpu', method: 'POST', path: '/pool-stock', status: 'stable',
    requires: 'admin', title: '풀 재고 갱신', desc: '풀 재고 수량을 갱신합니다. 바꾼 사람은 감사 기록에 남습니다.',
    body: [
      { name: 'product_id', type: 'string', required: true, desc: '대상 구성 id' },
      { name: 'pool_qty', type: 'number', required: true, desc: '풀 재고 수량. 정수로 반올림하고 0 보다 작으면 0 으로 저장합니다' },
      { name: 'sell_price_krw', type: 'number', desc: '함께 바꿀 판매가(원). 없으면 판매가는 그대로입니다' },
      { name: 'note', type: 'string', desc: '메모' },
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
    response: {
      fields: [
        { name: 'supplyRoundingUnit', type: SUPPLY_ROUNDING_UNITS.join(' | '),
          desc: '할인을 뺀 공급가 합계를 이 단위 아래에서 버립니다(원). 0 이면 버리지 않습니다' },
      ],
      note: '최근에 더해진 칸만 적었습니다. 나머지 칸은 화면의 견적 목록과 같습니다.',
    },
  },
  {
    id: 'crm.quotes.export', group: 'crm', method: 'GET', path: '/crm/quotes/{id}/export', status: 'stable',
    requires: 'crm-member', title: '견적서 내려받기',
    desc: '견적서를 화면 미리보기 그대로 PDF 나 PNG 파일로 돌려줍니다. read 범위면 부를 수 있고, '
      + '키를 만든 계정에 CRM 내보내기 권한이 있어야 합니다. '
      + `2단계 인증을 켠 계정의 키로는 만들 수 없어 ${CRM_ERROR_HTTP.FORBIDDEN} 을 돌려줍니다. 그때는 화면에서 내려받아 주세요.`,
    query: [
      { name: 'format', type: '"pdf" | "png"', required: true, desc: 'pdf 는 문서 전체, png 는 한 쪽을 이미지로 받습니다. 다른 값이면 400 입니다' },
      { name: 'page', type: 'number', desc: 'png 로 받을 쪽 번호. 1부터 세고 비우면 1쪽입니다. pdf 에서는 쓰지 않습니다' },
    ],
    response: {
      file: 'JSON 봉투 대신 파일 본문이 옵니다. Content-Type 은 application/pdf 또는 image/png 이고, '
        + '파일 이름은 Content-Disposition 에 견적 번호로 실립니다. 오류일 때만 공통 봉투로 옵니다.',
    },
  },
  {
    id: 'crm.tasks.list', group: 'crm', method: 'GET', path: '/crm/tasks', status: 'stable',
    demo: { emoji: '✅', query: { limit: '5' } },
    requires: 'crm-member', title: '할 일 목록', desc: '딜·회사에 붙은 할 일.',
    query: [...CURSOR_QUERY],
  },
  gateway({
    id: 'crm.companies.create', group: 'crm', method: 'POST', path: '/crm/companies', scope: 'write',
    requires: 'crm-member', title: '새 회사', desc: '회사를 만듭니다. 키 주인이 소유자가 됩니다.',
    body: COMPANY_BODY,
  }),
  ...crmEditAndDelete('/crm/companies/{id}', 'crm.companies', '회사', optional(COMPANY_BODY)),
  gateway({
    id: 'crm.people.create', group: 'crm', method: 'POST', path: '/crm/people', scope: 'write',
    requires: 'crm-member', title: '새 인물', desc: '인물을 만듭니다.',
    body: PERSON_BODY,
  }),
  ...crmEditAndDelete('/crm/people/{id}', 'crm.people', '인물', optional(PERSON_BODY)),
  gateway({
    id: 'crm.deals.create', group: 'crm', method: 'POST', path: '/crm/deals', scope: 'write',
    requires: 'crm-member', title: '새 딜', desc: '딜을 만듭니다.',
    body: DEAL_BODY,
  }),
  ...crmEditAndDelete('/crm/deals/{id}', 'crm.deals', '딜', optional(DEAL_BODY)),
  gateway({
    id: 'crm.meetings.create', group: 'crm', method: 'POST', path: '/crm/meetings', scope: 'write',
    requires: 'crm-member', title: '새 미팅', desc: '미팅 기록을 만듭니다. 제목과 시작 시각이 없으면 400 입니다.',
    body: [
      { name: 'title', type: 'string', required: true, desc: '미팅 제목' },
      { name: 'startedAt', type: 'string', required: true, desc: '시작 시각(ISO 8601)' },
      { name: 'endedAt', type: 'string', desc: '끝난 시각(ISO 8601)' },
      { name: 'companyId', type: 'string', desc: '회사 id' },
      { name: 'dealId', type: 'string', desc: '딜 id' },
      { name: 'location', type: 'string', desc: '장소' },
      { name: 'withNote', type: 'boolean', desc: 'true 면 회의노트도 함께 만듭니다' },
    ],
  }),
  gateway({
    id: 'crm.quotes.create', group: 'crm', method: 'POST', path: '/crm/quotes', scope: 'write',
    requires: 'crm-member', title: '새 견적', desc: '딜에 붙는 견적을 만듭니다. 품목 줄을 함께 보낼 수 있습니다.',
    body: [
      { name: 'dealId', type: 'string', required: true, desc: '견적이 붙는 딜 id' },
      { name: 'title', type: 'string', desc: '견적 제목' },
      { name: 'currency', type: 'string', desc: '통화 코드' },
      { name: 'validUntil', type: 'string', desc: '유효 기한(YYYY-MM-DD)' },
      { name: 'notesMd', type: 'string', desc: '비고(마크다운)' },
      { name: 'lines', type: 'object[]', desc: '품목 줄. 칸은 견적 상세 응답의 줄과 같습니다' },
    ],
  }),
  gateway({
    id: 'crm.tasks.create', group: 'crm', method: 'POST', path: '/crm/tasks', scope: 'write',
    requires: 'crm-member', title: '새 할 일', desc: '할 일을 만듭니다.',
    body: [
      { name: 'title', type: 'string', required: true, desc: '할 일 제목' },
      { name: 'dueAt', type: 'string', desc: '기한(ISO 8601)' },
      { name: 'assigneeId', type: 'string', desc: '맡은 사람 id' },
      { name: 'companyId', type: 'string', desc: '회사 id' },
      { name: 'personId', type: 'string', desc: '인물 id' },
      { name: 'dealId', type: 'string', desc: '딜 id' },
    ],
  }),

  /* ── 콘텐츠 인텔리전스 ─────────────────────────────────────────────────── */
  {
    id: 'ci.channels.list', group: 'ci', method: 'GET', path: '/ci/channels', status: 'stable',
    demo: { emoji: '📡' },
    requires: 'ci-member', title: '채널 목록', desc: '모니터링 중인 채널.',
    query: [
      { name: 'workspace', type: 'string', desc: '워크스페이스 id. 속한 곳이 하나면 생략할 수 있습니다' },
      { name: 'ownership', type: '"owned" | "tracked"', desc: 'owned 는 우리 채널만, tracked 는 추적하는 다른 채널만. 없으면 둘 다' },
    ],
  },
  gateway({
    id: 'ci.channels.create', group: 'ci', method: 'POST', path: '/ci/channels', scope: 'write',
    requires: 'ci-member', title: '새 채널', desc: '채널 주소나 핸들로 채널을 더합니다. 요금제 한도를 넘으면 거절됩니다.',
    query: [
      { name: 'workspaceId', type: 'string', required: true, desc: '워크스페이스 id. 목록의 workspace 와 이름이 다르고, 비우면 400 입니다' },
    ],
    body: [
      { name: 'input', type: 'string', required: true, desc: '채널 주소 또는 핸들' },
      { name: 'topicId', type: 'string', desc: '묶을 주제 id' },
      { name: 'monitor', type: 'boolean', desc: '바로 모니터링할지. 기본 true' },
    ],
  }),
  {
    id: 'ci.contents.list', group: 'ci', method: 'GET', path: '/ci/contents', status: 'stable',
    demo: { emoji: '🎬', query: { limit: '5' } },
    requires: 'ci-member', title: '게시물 목록', desc: '수집된 게시물. 「콘텐츠」가 아니라 「게시물」입니다.',
    query: [
      { name: 'workspace', type: 'string', desc: '워크스페이스 id' },
      { name: 'topicId', type: 'string', desc: '주제로 좁히기' },
      { name: 'windowDays', type: 'number', desc: '최근 N일' },
      { name: 'limit', type: 'number', desc: '개수. 기본 20, 최대 100' },
      { name: 'cursor', type: 'string', desc: '이어 보기 커서. 응답 meta.nextCursor(<first_seen_at>__<uuid> 꼴)를 그대로 넣습니다. 형식이 틀리면 400 이고, 두 번째 쪽부터는 meta.total 을 싣지 않습니다' },
    ],
  },

  /* ── 참고 ─────────────────────────────────────────────────────────────── */
  {
    id: 'ref.openapi', group: 'ref', method: 'GET', path: '/openapi.json', status: 'stable',
    title: 'OpenAPI 스펙', desc: '이 표에서 생성한 OpenAPI 3.1 스펙. 봉투 없이 OpenAPI 문서 그대로(최상위 openapi) 돌려줍니다. 이 주소도 키가 있어야 하므로, 키를 실어 받아 파일로 저장한 뒤 클라이언트 생성기에 넣습니다.',
  },
  {
    id: 'ref.me', group: 'ref', method: 'GET', path: '/me', status: 'stable',
    title: '내 키 정보', desc: '이 키의 주인, 역할, 실제로 쓸 수 있는 범위를 돌려줍니다. 범위와 상관없이 부를 수 있습니다.',
    response: {
      fields: [
        { name: 'userId', type: 'string', desc: '키를 만든 계정 id' },
        { name: 'role', type: 'string', desc: '그 계정의 역할' },
        { name: 'keyId', type: 'string', desc: '키 id. 키 값과 해시는 싣지 않습니다' },
        { name: 'keyName', type: 'string', desc: '키를 만들 때 붙인 이름' },
        { name: 'scopes', type: 'string[]', desc: '실제로 쓸 수 있는 범위. 계정 권한과 키 범위가 겹치는 것만 옵니다' },
        { name: 'rateLimitPerMinute', type: 'number', desc: '분당 호출 한도' },
        { name: 'expiresAt', type: 'string | null', desc: '키가 만료되는 시각(ISO 8601). null 이면 만료가 없는 키입니다' },
        { name: 'remainingThisMinute', type: 'number', desc: '이번 분에 남은 호출 수. 이 요청까지 센 값입니다' },
      ],
    },
  },
  {
    id: 'ref.approval', group: 'ref', method: 'GET', path: '/approvals/{id}', status: 'stable',
    requires: 'member', title: '승인 요청 상태', desc: '범위 밖 동작이 202 로 돌려준 승인 요청의 상태와 실행 결과. 키 주인의 요청만 보입니다.',
    response: {
      fields: [
        { name: 'id', type: 'string', desc: '승인 요청 id. 202 응답에 실린 값입니다' },
        { name: 'action', type: 'string', desc: '실행하려던 동작 이름' },
        { name: 'requiredScope', type: 'string', desc: '그 동작에 필요한 범위' },
        { name: 'status', type: Object.keys(API_APPROVAL_STATUS).map((k) => `"${k}"`).join(' | '),
          desc: Object.entries(API_APPROVAL_STATUS).map(([k, v]) => `${k} ${v}`).join(', ')
            + '. 기다리는 중에 만료 시각이 지나면 EXPIRED 로 옵니다' },
        { name: 'result', type: 'object | null', desc: '승인 뒤 실행한 결과. 아직 실행하지 않았으면 null 입니다' },
        { name: 'expiresAt', type: 'string', desc: '이 시각까지 승인하지 않으면 실행하지 않습니다' },
        { name: 'createdAt', type: 'string', desc: '요청이 만들어진 시각' },
        { name: 'decidedAt', type: 'string | null', desc: '승인하거나 거절한 시각. 아직이면 null 입니다' },
      ],
    },
  },

  /* ── 이관 중(구 CRM) ──────────────────────────────────────────────────── */
  ...legacyCrm('accounts', '거래처', '회사', 'crm.companies.list', '/crm/companies'),
  ...legacyCrm('contacts', '담당자', '인물', 'crm.people.list', '/crm/people'),
  ...legacyCrm('deals', '영업기회', '딜', 'crm.deals.list', '/crm/deals'),
]

/**
 * 구 CRM 3리소스는 모양이 같다 — 손으로 15줄씩 세 번 적으면 하나만 고치게 된다.
 *
 * 조회까지 전부 관리자 키만 부를 수 있다, 라우트가 모든 처리기에서 requireAdminKey 를 부른다
 * (내부 창구가 requireAdminApi 라서 키도 같은 선을 지킨다)
 */
function legacyCrm(
  table: string, oldWord: string, newWord: string, newId: string, newPath: string,
): ApiEndpoint[] {
  const note = `구 화면(/${table})의 표입니다. 새 코드는 「${newWord}」(${newPath})를 쓰세요 — 「${oldWord}」는 폐기된 말입니다.`
  return [
    { id: `legacy.${table}.list`, group: 'legacy', method: 'GET', path: `/${table}`, status: 'deprecated',
      requires: 'admin', deprecatedNote: note, title: `${oldWord} 목록`, desc: `목록 조회. → ${newId}`,
      query: [
        { name: 'search', type: 'string', desc: '이름 검색' },
        { name: 'cursor', type: 'string', desc: '이어 보기 커서' },
        { name: 'sort', type: 'string', desc: '정렬 기준' },
        { name: 'dir', type: '"asc" | "desc"', desc: '정렬 방향' },
      ] },
    { id: `legacy.${table}.create`, group: 'legacy', method: 'POST', path: `/${table}`, status: 'deprecated',
      requires: 'admin', deprecatedNote: note, title: `${oldWord} 생성`, desc: '만든 사람이 소유자가 됩니다.' },
    { id: `legacy.${table}.get`, group: 'legacy', method: 'GET', path: `/${table}/{id}`, status: 'deprecated',
      requires: 'admin', deprecatedNote: note, title: `${oldWord} 상세`, desc: '단건 조회.' },
    { id: `legacy.${table}.update`, group: 'legacy', method: 'PATCH', path: `/${table}/{id}`, status: 'deprecated',
      requires: 'admin', deprecatedNote: note, title: `${oldWord} 수정`, desc: '단건 수정.' },
    { id: `legacy.${table}.delete`, group: 'legacy', method: 'DELETE', path: `/${table}/{id}`, status: 'deprecated',
      requires: 'admin', deprecatedNote: note, title: `${oldWord} 삭제`, desc: '단건 삭제. 되돌릴 수 없습니다.' },
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
 * 이 표는 자주 쓰는 것만 싣는다. 나머지 동작은 정의 표(lib/actions/generated)에서 나온
 * CLI 명령 목록과 OpenAPI 스펙에 전부 있다, 화면이 그 두 곳으로 잇는다
 */
export const CATALOG_NOTE = {
  title: '여기 없는 동작',
  body: '이 묶음에는 자주 쓰는 것만 적었습니다. 견적 상세, 파이프라인, 가격표처럼 나머지 동작은 CLI 명령 목록과 OpenAPI 스펙에 전부 있고, 같은 경로로 부를 수 있습니다.',
  cli: { section: 'cli', label: API_CLI_DOC.nav },
  ref: { section: 'ref', label: 'OpenAPI' },
  groups: ['crm'] as readonly ApiGroupKey[],
} as const

/**
 * 「무엇이 있어야 부를 수 있는가」 — 화면이 이 문장을 직접 적지 않는다.
 * 서비스 이름은 SERVICE_LABEL(SSOT)에서 온다. 여기서 손으로 적으면 간판과 갈린다.
 */
export const REQUIRES_LABEL: Record<NonNullable<ApiEndpoint['requires']>, string> = {
  admin: '관리자 키만 부를 수 있습니다',
  member: '임직원 키(역할 admin 또는 member)만 부를 수 있습니다. api_user 키는 403 으로 거절됩니다',
  'crm-member': `키를 발급한 계정이 ${SERVICE_LABEL.crm} 멤버여야 합니다`,
  'ci-member': `키를 발급한 계정이 ${SERVICE_LABEL.ci} 워크스페이스 멤버여야 합니다`,
}
