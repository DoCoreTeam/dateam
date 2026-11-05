// GPU 문의 — 모델 한 줄에서 가장 싼 공급사를 고르고, 그 공급사에 물을 글을 짓는다
//
// 누구에게: 줄의 1위 공급사 (board.ts vendors[0], 싼 순)
// 어디로: 공급사(suppliers)에 이어진 CRM 회사의 담당자 메일 전화, 홈페이지, 그 값의 출처 주소
// 글: 한국어와 영어 두 벌, 공급사 나라가 한국이거나 이름이 한글이면 한국어가 기본, 그 밖과 모름은 영어 (해외 공급사가 대부분)
// 메일은 서버가 보내지 않는다, 화면은 메일 앱을 열거나 글을 복사하고 누른 사실만 이력(inquiry_sent)에 남긴다
// 화면(/pricing/gpu 문의하기)과 창구(GET POST /api/pricing/gpu/inquiry, teamda gpu inquiry get create)가 이 파일을 지난다

import { vendorDisplayName, vendorKeyOf, type BoardOffer, type BoardRow } from './board.ts'
import { termLabel } from './term.ts'

export const INQUIRY_CHANNELS = ['mail', 'phone', 'copy', 'site'] as const
export type InquiryChannel = (typeof INQUIRY_CHANNELS)[number]

export const INQUIRY_LANGS = ['ko', 'en'] as const
export type InquiryLang = (typeof INQUIRY_LANGS)[number]

export interface InquiryDraft {
  subject: string
  body: string
}

/** 공급사 이름 칸 상한 (기록용) */
export const INQUIRY_VENDOR_MAX = 100

export interface InquiryContact {
  name: string
  title: string | null
  email: string | null
  phone: string | null
}

/** 이름으로 공급사를 찾을 때 쓰는 후보 — suppliers 와 competitors(이어진 supplier_id 포함) */
export interface InquiryOrgIn {
  names: string[]
  supplier_id: string | null
  account_id: string | null
  website: string | null
  /** 나라 칸 그대로 (KR, 한국, 미국 등이 섞여 있다) */
  country: string | null
}

export interface Inquiry {
  product_id: string
  model: string
  vendor: string
  offer: BoardOffer
  contacts: InquiryContact[]
  website: string | null
  source_url: string | null
  /** 이 이름이 공급사로 등록돼 있나 (안 돼 있으면 담당자를 넣을 자리가 없다) */
  supplier_id: string | null
  /** 담당자를 넣는 곳 (CRM 회사), 공급사가 회사와 안 이어졌으면 null */
  crm_company_path: string | null
  /** 기본 언어 (조건으로 고르지 않았으면 공급사 나라로 정한 것) */
  lang: InquiryLang
  /** lang 쪽 글 */
  subject: string
  body: string
  /** 두 언어 글 전부, 화면이 바꿔 쓸 수 있게 */
  drafts: Record<InquiryLang, InquiryDraft>
}

/** 모델 줄에서 문의할 값 — 원화로 읽힌 가장 싼 공급사, 없으면 null */
export function inquiryOffer(row: BoardRow): BoardOffer | null {
  return row.vendors.find((v) => v.krw != null) ?? null
}

/** 화면에 보이는 공급사 이름(표기 통일 뒤)과 같은 곳을 고른다 */
export function matchOrg(vendor: string, orgs: InquiryOrgIn[]): InquiryOrgIn | null {
  const key = vendorKeyOf(vendor)
  const hits = orgs.filter((o) => o.names.some((n) => vendorKeyOf(vendorDisplayName(n)) === key))
  // 같은 이름이 공급사와 경쟁사에 다 있으면 CRM 회사가 이어진 쪽이 담당자를 준다
  return hits.find((o) => o.account_id) ?? hits[0] ?? null
}

function memoryText(gb: number | null): string {
  return gb == null ? '' : ` ${gb}GB`
}

/** 받은 값 그대로(통화와 단위), 없으면 원화 1장 1시간 */
function priceText(o: BoardOffer, lang: InquiryLang): string {
  if (o.original_amount != null && o.original_currency) {
    // 단위에 통화가 이미 들었으면(USD/GPU·hr) 단위만, 아니면(hour) 통화/단위
    const unit = !o.original_unit ? o.original_currency
      : o.original_unit.includes(o.original_currency) ? o.original_unit : `${o.original_currency}/${o.original_unit}`
    return `${o.original_amount} ${unit}`
  }
  if (o.krw == null) return ''
  return lang === 'ko' ? `${o.krw.toLocaleString('ko-KR')}원 (1장 1시간)` : `KRW ${o.krw.toLocaleString('en-US')} per GPU-hour`
}

/** 약정을 영어로 — termLabel 의 영어 짝 (on_demand 는 적지 않으므로 여기 안 옴) */
export function termLabelEn(term: string): string {
  if (term === 'spot') return 'spot'
  if (term === 'reserved') return 'reserved'
  const m = term.match(/^reserved_(\d+)m$/)
  if (m) {
    const n = parseInt(m[1], 10)
    return n % 12 === 0 ? `${n / 12}-year commitment` : `${n}-month commitment`
  }
  const d = term.match(/^(\d+)days?$/)
  if (d) return `${parseInt(d[1], 10)} days`
  return term
}

const KOREA = /^(kr|kor|korea|south korea|한국|대한민국)$/i
const HANGUL = /[가-힣]/

/** 공급사 나라가 한국이거나 이름이 한글이면 한국어, 그 밖과 모름은 영어 */
export function defaultLang(vendor: string, org: InquiryOrgIn | null): InquiryLang {
  if (HANGUL.test(vendor) || org?.names.some((n) => HANGUL.test(n))) return 'ko'
  return org?.country && KOREA.test(org.country.trim()) ? 'ko' : 'en'
}

export function inquiryDraft(row: BoardRow, offer: BoardOffer, lang: InquiryLang): InquiryDraft {
  const model = `${row.model}${memoryText(row.memory_per_gpu_gb)}`
  const term = offer.term === 'on_demand' ? null : lang === 'ko' ? termLabel(offer.term) : termLabelEn(offer.term)
  const date = offer.date ? (lang === 'ko' ? `${offer.date} 기준` : `as of ${offer.date}`) : null
  const seen = [priceText(offer, lang), term, date].filter(Boolean).join(', ')
  const lines = lang === 'ko'
    ? [
      `안녕하세요, ${offer.vendor} 담당자님.`, '',
      '아래 GPU 의 지금 가격과 쓸 수 있는 수량을 여쭙니다.', '',
      `- 모델: ${model}`,
      seen ? `- 저희가 본 값: ${seen}` : null,
      '- 여쭙는 것: 1장과 8장 구성의 시간당 가격, 약정 기간별 가격, 지금 바로 쓸 수 있는 수량', '',
      '회신 부탁드립니다. 감사합니다.',
    ]
    : [
      `Hello ${offer.vendor} team,`, '',
      'We would like to ask about the current pricing and availability of the GPU below.', '',
      `- Model: ${model}`,
      seen ? `- Price we found: ${seen}` : null,
      '- Questions: hourly price for 1-GPU and 8-GPU configurations, pricing by commitment term, and how many GPUs are available now', '',
      'We look forward to your reply. Thank you.',
    ]
  return {
    subject: lang === 'ko' ? `${model} GPU 가격과 가용 수량 문의` : `GPU pricing and availability inquiry: ${model}`,
    body: lines.filter((line) => line !== null).join('\n'),
  }
}

export function buildInquiry(input: {
  row: BoardRow
  product_id: string
  org: InquiryOrgIn | null
  contacts: InquiryContact[]
  /** 고른 언어, 없으면 공급사 나라로 */
  lang?: InquiryLang | null
}): Inquiry | null {
  const offer = inquiryOffer(input.row)
  if (!offer) return null
  const reachable = input.contacts.filter((c) => c.email || c.phone)
  const lang = input.lang ?? defaultLang(offer.vendor, input.org)
  const drafts = { ko: inquiryDraft(input.row, offer, 'ko'), en: inquiryDraft(input.row, offer, 'en') }
  return {
    product_id: input.product_id,
    model: `${input.row.model}${memoryText(input.row.memory_per_gpu_gb)}`,
    vendor: offer.vendor,
    offer,
    contacts: reachable,
    website: input.org?.website ?? null,
    source_url: offer.source_url,
    supplier_id: input.org?.supplier_id ?? null,
    crm_company_path: input.org?.account_id ? `/crm/companies/${input.org.account_id}` : null,
    lang,
    subject: drafts[lang].subject,
    body: drafts[lang].body,
    drafts,
  }
}

/** 메일 앱을 여는 주소 — 받는 사람, 제목, 본문 */
export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export interface InquiryRecordIn {
  product_id: string
  vendor: string
  channel: InquiryChannel
}

export function isInquiryLang(v: unknown): v is InquiryLang {
  return INQUIRY_LANGS.includes(v as InquiryLang)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** 기록 본문 검사 — 틀리면 까닭 한 줄 */
export function parseInquiryRecord(body: unknown): { ok: true; value: InquiryRecordIn } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (!isUuid(b.product_id)) return { ok: false, error: 'product_id 는 상품 uuid 입니다' }
  const vendor = typeof b.vendor === 'string' ? b.vendor.trim() : ''
  if (!vendor || vendor.length > INQUIRY_VENDOR_MAX) return { ok: false, error: `vendor 는 1~${INQUIRY_VENDOR_MAX}자입니다` }
  if (!INQUIRY_CHANNELS.includes(b.channel as InquiryChannel)) {
    return { ok: false, error: `channel 은 ${INQUIRY_CHANNELS.join(', ')} 중 하나입니다` }
  }
  return { ok: true, value: { product_id: b.product_id, vendor, channel: b.channel as InquiryChannel } }
}
