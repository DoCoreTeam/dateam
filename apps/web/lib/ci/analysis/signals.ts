// lib/ci/analysis/signals.ts — 「지금 바깥에서 무슨 일이 있나」를 후보로 받아들이는 규칙 (순수 함수)
//
// **왜 이 파일이 생겼나**(실측 2026-08-31): 트렌드의 「이슈」 탭에 데이터가 들어오는 길은
// 화면의 입력폼 하나뿐이었다. 자동으로 넣는 코드는 저장소 전체에 0건이었고, 그래서
// 이슈는 1건이었다 — 같은 시점에 게시물은 1,709건, 성공 공식은 617건이었다.
// 사용자가 기대한 것은 «AI가 뉴스를 모아 지금 이슈와 트렌드를 가져오는 것»이었다.
//
// 이 파일은 DB도 AI도 모른다. **무엇을 후보로 볼 것인가**만 정한다 —
// 그래야 판정을 실제 호출 없이 검증할 수 있다(순수 모듈 분리는 classify·patterns와 같은 이유).

import type { CiSignalKind } from '../types.ts'

/** 후보가 갖춰야 할 최소치. 이것을 못 넘으면 만들지 않는다. */
export const SIGNAL_TITLE_MAX = 200
export const SIGNAL_SOURCE_MAX = 80

/**
 * 한 번에 받아들일 후보 수.
 *
 * 상한을 두는 이유는 «많으면 좋다»가 틀렸기 때문이다. 확인 대기가 수십 건 쌓이면
 * 사람은 목록 전체를 안 본다 — 그러면 자동 수집은 이슈 1건일 때와 똑같아진다.
 */
export const SIGNAL_CANDIDATE_MAX = 8

/** AI 가 고를 수 있는 종류. DB의 check 제약과 같은 값이어야 한다. */
export const SIGNAL_KINDS: readonly CiSignalKind[] = ['news', 'search_spike', 'community']

const KIND_LABEL: Record<CiSignalKind, string> = {
  news: '뉴스',
  search_spike: '검색 급상승',
  community: '커뮤니티 화제',
}

export function signalKindLabel(kind: string): string {
  return KIND_LABEL[kind as CiSignalKind] ?? kind
}

/**
 * 같은 사건을 한 번만 담기 위한 열쇠.
 *
 * 같은 뉴스가 매체 여러 곳에 뜨는 것이 아니라, **같은 주소가 여러 번 들어오는 것**을 막는다.
 * (다른 매체의 같은 사건까지 합치려면 내용 비교가 필요한데, 그건 잘못 합칠 위험이
 *  얻는 것보다 크다 — 남겨서 사람이 지우는 편이 낫다.)
 *
 * 정규화 규칙: 스킴·www·쿼리·해시·끝 슬래시를 떼고 호스트+경로만 남긴다.
 * 추적 파라미터(utm_*)가 붙은 같은 기사를 다른 것으로 세지 않기 위해서다.
 */
export function signalDedupeKey(url: string | null | undefined): string | null {
  const raw = (url ?? '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // 점이 없으면 도메인이 아니다.
    //
    // `new URL('https://홈페이지없음')` 은 예외 없이 통과한다(국제화 호스트명).
    // 그대로 두면 «홈페이지없음» 같은 말이 «출처가 있는 후보»로 둔갑해 확인 대기에 오른다 —
    // 출처 필수 규칙이 그 자리에서 무의미해진다(가드가 실제로 잡아낸 구멍이다).
    if (!u.hostname.includes('.')) return null
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path}` || host
  } catch {
    return null
  }
}

/** 화면·저장 전 단계의 후보 한 건. */
export interface SignalCandidate {
  kind: CiSignalKind
  title: string
  url: string
  source: string | null
  /** 사건이 일어난 날(KST 벽시계 기준 YYYY-MM-DD). 모르면 null — 지어내지 않는다 */
  occurredDate: string | null
  /** 이 후보가 어느 주제와 이어지는지. 못 정하면 null(사람이 고른다) */
  topicId: string | null
  /** 0~1. 출처 수와 주제 확정 여부가 정한다 */
  confidence: number
  /** 왜 이걸 골랐는지 — 사람이 읽고 판단할 한 줄 */
  reason: string
  dedupeKey: string
}

export interface TopicHint { id: string; name: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 후보의 확신도.
 *
 * CRM 회사 보강과 같은 사고 방식이다 — **정직한 확신만 매긴다.**
 *  · 주제까지 정해졌다 → 0.9 (사람이 바로 확정할 만하다)
 *  · 주제를 못 정했다  → 0.7 (담을 자리를 사람이 골라야 한다)
 * 출처가 없으면 애초에 후보를 만들지 않으므로 여기서 다루지 않는다.
 */
export function signalConfidence(hasTopic: boolean): number {
  return hasTopic ? 0.9 : 0.7
}

/**
 * AI 응답을 후보 목록으로 옮긴다.
 *
 * **버리는 것이 이 함수의 일이다.** 통과 기준은 셋뿐이고 전부 «확인할 수 있는가»를 본다:
 *   ① 제목이 있다 ② 출처 주소가 있다(없으면 폐기) ③ 종류가 목록 안에 있다
 * 주제 id 는 넘겨준 목록 밖이면 버린다 — 환각한 id 로 남의 주제에 붙으면
 * 그 주제의 통계가 조용히 오염된다(분류에서 겪은 것과 같은 사고).
 */
export function parseSignalCandidates(raw: string, topics: TopicHint[]): SignalCandidate[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { signals?: unknown })?.signals)
      ? (parsed as { signals: unknown[] }).signals
      : []

  const topicIds = new Set(topics.map((t) => t.id))
  const out: SignalCandidate[] = []
  const seen = new Set<string>()

  for (const item of list) {
    if (out.length >= SIGNAL_CANDIDATE_MAX) break
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>

    const title = typeof o.title === 'string' ? o.title.trim().slice(0, SIGNAL_TITLE_MAX) : ''
    if (!title) continue

    // 출처가 없으면 폐기한다. 확인할 방법이 없는 줄은 목록을 어지럽히기만 한다.
    const url = typeof o.url === 'string' ? o.url.trim() : ''
    const dedupeKey = signalDedupeKey(url)
    if (!dedupeKey) continue
    if (seen.has(dedupeKey)) continue

    const kindRaw = typeof o.kind === 'string' ? o.kind.trim() : ''
    const kind = (SIGNAL_KINDS as readonly string[]).includes(kindRaw)
      ? kindRaw as CiSignalKind
      : 'news'

    const topicRaw = typeof o.topicId === 'string' ? o.topicId.trim() : ''
    const topicId = topicIds.has(topicRaw) ? topicRaw : null

    const occurredRaw = typeof o.occurredDate === 'string' ? o.occurredDate.trim() : ''
    const occurredDate = DATE_RE.test(occurredRaw) ? occurredRaw : null

    const source = typeof o.source === 'string' && o.source.trim()
      ? o.source.trim().slice(0, SIGNAL_SOURCE_MAX)
      : null

    const reason = typeof o.reason === 'string' && o.reason.trim()
      ? o.reason.trim().slice(0, 300)
      : '콘텐츠 소재가 될 만한 화제입니다'

    seen.add(dedupeKey)
    out.push({
      kind, title, url, source, occurredDate, topicId,
      confidence: signalConfidence(topicId !== null),
      reason, dedupeKey,
    })
  }
  return out
}

/**
 * 무엇을 찾을지. **주제 이름이 곧 검색어다.**
 *
 * 사용자가 설정에 따로 적어 두면 그것이 이긴다 — 주제 이름은 분류용이라
 * 검색어로는 너무 넓거나 좁을 수 있고, 그 판단은 사용자만 할 수 있다.
 * 아무것도 없으면 빈 배열이고, 호출부는 «훑을 거리가 없다»고 말한다(억지로 찾지 않는다).
 */
export function resolveSignalQueries(configured: string, topics: TopicHint[]): string[] {
  const fromSetting = configured
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromSetting.length > 0) return fromSetting.slice(0, 12)
  return topics.map((t) => t.name.trim()).filter(Boolean).slice(0, 12)
}

/**
 * 웹을 훑어 후보를 받아 오는 프롬프트.
 *
 * 못 박는 것 넷:
 *   ① 실제로 웹을 볼 것 — 기억으로 답하면 그럴듯한 거짓이 들어온다
 *   ② 출처 주소가 없으면 아예 넣지 말 것
 *   ③ 주제는 준 목록에서만 고르고, 애매하면 null — 억지로 고르면 통계가 오염된다
 *   ④ 없으면 빈 배열이 정답 — 억지로 채우면 사람이 이 기능 전체를 무시한다
 */
export function buildSignalPrompt(input: {
  queries: string[]
  topics: TopicHint[]
  todayKst: string
  windowDays: number
}): string {
  const topicLines = input.topics.length > 0
    ? input.topics.map((t) => `- ${t.id} : ${t.name}`).join('\n')
    : '(등록된 주제가 없습니다 — topicId 는 전부 null 로 두세요)'

  return [
    '너는 콘텐츠 기획자를 돕는 조사원이다.',
    '**웹을 실제로 검색해서** 아래 관심사와 관련해 최근 화제가 된 것을 찾아라.',
    '',
    '## 관심사',
    input.queries.map((q) => `- ${q}`).join('\n'),
    '',
    '## 담을 수 있는 주제 (topicId)',
    topicLines,
    '',
    '## 규칙',
    `- 오늘은 ${input.todayKst}(한국 기준)이다. 최근 ${input.windowDays}일 안의 일만 고른다.`,
    '- **출처 주소(url)가 없으면 넣지 않는다.** 확인할 수 없는 것은 쓸모가 없다.',
    '- 기억으로 답하지 않는다. 검색해서 확인한 것만 적는다.',
    '- kind 는 news(뉴스) · search_spike(검색 급상승) · community(커뮤니티 화제) 중 하나다.',
    '- topicId 는 위 목록의 id 만 쓴다. 어디에 넣을지 애매하면 null 로 둔다.',
    '- occurredDate 는 YYYY-MM-DD. 날짜를 모르면 null 로 둔다. **지어내지 않는다.**',
    '- reason 은 "왜 이게 콘텐츠 소재가 되는지" 한 문장.',
    `- 최대 ${SIGNAL_CANDIDATE_MAX}건. 찾은 것이 없으면 빈 배열이 정답이다.`,
    '',
    '## 출력',
    'JSON만 출력한다. 설명·코드펜스 없이.',
    '{"signals":[{"kind":"news","title":"...","url":"https://...","source":"매체명",'
      + '"occurredDate":"2026-08-30","topicId":null,"reason":"..."}]}',
  ].join('\n')
}
