// AI 제안 표시 SSOT (dacrm)
//
// **왜 한 곳에 두는가**: 같은 제안을 인박스와 미팅 상세가 각자 그렸더니
// 미팅 상세는 "박보안 · 팀장 · 반대하는 쪽"이라 쓰고
// 인박스는 `{"name":"박보안","role":"BLOCKER","title":"팀장",...}` 를 그대로 보여 줬다.
// 사람은 인박스에서 승인/거절을 한다 — **읽을 수 없는 값을 승인하게 두면 안 된다.**
//
// 표시 변환은 여기 하나만 두고, 값을 렌더하는 모든 화면이 import 한다
// (정책 §실제 렌더 경로 4 "표시 로직도 SSOT").

/** 인물의 역할 — CHAMPION/BLOCKER 를 그대로 보여 주면 무슨 뜻인지 모른다 */
const ROLE_LABEL: Record<string, string> = {
  DECISION_MAKER: '결정권자',
  CHAMPION: '우리 편',
  BLOCKER: '반대하는 쪽',
  PRACTITIONER: '실무자',
  INFLUENCER: '영향력 있음',
  // OTHER 는 "모르겠다"는 뜻이다 — 'OTHER'라고 적으면 아는 것처럼 보인다
  OTHER: '',
}

/** 제안이 어디에 붙는지 — 이게 없으면 "왜 금액이 여기 있지"가 된다 */
export const TARGET_LABEL: Record<string, string> = {
  company: '회사',
  person: '인물',
  deal: '딜',
  deal_contact: '딜 담당자',
  meeting: '미팅',
  meeting_summary: '미팅 요약',
  task: '할 일',
}

/** 필드 이름을 사람 말로 — `amountMinor` 를 화면에 적으면 개발자 말이다 */
export const FIELD_LABEL: Record<string, string> = {
  amountMinor: '금액',
  stageId: '단계',
  domain: '도메인',
  industry: '산업',
  region: '지역',
  email: '이메일',
  phone: '전화',
  title: '직함',
  name: '이름',
  closeDate: '마감 예정일',
}

/** 소수 자리가 없는 통화 — minor 가 곧 표시 단위다 */
const ZERO_DECIMAL = new Set(['KRW', 'JPY'])

function formatMoney(minor: string, currency = 'KRW'): string {
  const cur = currency.trim().toUpperCase()
  const digits = ZERO_DECIMAL.has(cur) ? 0 : 2
  const n = Number(minor) / 10 ** digits
  // 표현 가능 범위를 넘으면 반올림된 거짓 숫자 대신 원값을 그대로 보여 준다
  if (!Number.isFinite(n) || !Number.isSafeInteger(Number(minor))) return `${minor} ${cur}`
  return `${n.toLocaleString('ko-KR', { maximumFractionDigits: digits })} ${cur}`
}

export interface SuggestionShape {
  axis: string
  field?: string | null
  targetType?: string
}

/**
 * 제안 값 하나를 사람이 읽을 한 줄로.
 *
 * **축을 먼저 본다.** 예전엔 `title` 이 있으면 무조건 할 일 제목으로 읽었는데,
 * 인물의 `title`(직함)이 거기 걸려서 "박보안 팀장"이 그냥 **"팀장"** 으로 보였다.
 * 축마다 담긴 모양이 다르니 축마다 읽는다.
 *
 * @param empty 값이 비었을 때 뭐라고 할지 — 화면마다 말이 다르다
 */
export function describeSuggestionValue(
  v: unknown,
  s: SuggestionShape,
  empty = '(비어 있음)',
): string {
  if (v === null || v === undefined || v === '') return empty

  if (typeof v === 'string') {
    // 금액은 원 단위 정수 문자열로 온다 — 그대로 두면 "300000000"이 보인다
    if (s.field === 'amountMinor') return formatMoney(v)
    if (s.field === 'stageId') return `"${v}" 단계`
    return v
  }
  if (typeof v === 'bigint' || typeof v === 'number') {
    return s.field === 'amountMinor' ? formatMoney(String(v)) : String(v)
  }
  if (typeof v !== 'object') return String(v)

  const o = v as Record<string, unknown>

  if (s.axis === 'WHO') {
    const role = typeof o.role === 'string' ? ROLE_LABEL[o.role] ?? o.role : null
    const line = [o.name, o.title, role || null, o.email].filter(Boolean).join(' · ')
    return line || empty
  }
  if (s.axis === 'NEXT') {
    const title = typeof o.title === 'string' && o.title ? o.title : '할 일'
    const who = typeof o.assigneeHint === 'string' && o.assigneeHint ? ` · ${o.assigneeHint}` : ''
    return title + (o.dueDate ? ` (${o.dueDate}까지)` : '') + who
  }
  if (s.axis === 'RISK') {
    const desc = typeof o.description === 'string' && o.description ? o.description : null
    // polarity 가 부정이면 그게 핵심이다 — 설명만 있으면 좋은 소식인지 나쁜 소식인지 모른다
    const tone = o.polarity === 'NEGATIVE' ? '⚠ ' : ''
    return desc ? tone + desc : empty
  }
  if (s.axis === 'WHAT') {
    if (o.amountMinor !== undefined && o.amountMinor !== null) {
      return formatMoney(String(o.amountMinor), typeof o.currency === 'string' ? o.currency : 'KRW')
    }
    if (typeof o.description === 'string') return o.description
  }

  // 여기까지 왔으면 우리가 모르는 모양이다. 지어내지 말고 있는 그대로 보여 준다.
  return JSON.stringify(v)
}
