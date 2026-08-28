/**
 * 설정 체계 (dacrm T1-08, 구현명세 §4.4-1)
 *
 * 코드에 모델명·벤더명을 박지 않는 이유는 하나다: **바꾸려면 배포해야 하기 때문**이다.
 * 모델은 몇 달마다 바뀌고, 그때마다 배포를 기다리면 그 사이 비싼 모델이 계속 돈다.
 *
 * 두 층으로 읽는다(스키마 CrmSettingScope):
 *   GLOBAL     — 전 워크스페이스 기본값
 *   WORKSPACE  — 이 워크스페이스만의 값. 있으면 GLOBAL 을 덮는다
 *
 * 시크릿(API 키)은 **평문으로 두지 않는다.** 저장은 AES-256-GCM, 읽기는 두 갈래다 —
 * 서버가 쓸 때는 복호하고, 화면에 줄 때는 마스킹만 준다.
 * 화면에 한 번이라도 평문으로 내보내면 그때부터 브라우저 기록·로그에 남는다.
 *
 * **AI API 키는 여기에 두지 않는다.** 호스트 시스템 설정(→ 통합)에 Gemini·Claude·OpenAI
 * 키가 이미 있고 AI 채팅·GPU 추출·회의록이 전부 그것으로 돈다. 같은 키를 두 곳에서 받으면
 * 사용자는 같은 값을 두 번 넣어야 하고, 한쪽만 바꾸면 CRM 만 조용히 옛 키로 돈다.
 * CRM 이 정하는 건 **어느 AI 를 쓸지**뿐이다(`ai.model.*`).
 * 음성 인식만 여기 남는다 — 호스트에 그 연동이 없기 때문이다.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { SUPPLIER_SETTING_KEY, SUPPLIER_IMAGE_KEY, QUOTE_SETTING_KEY, type SupplierField } from '../../terms/quote.ts'
import type { SettingGroupKey } from '../domain/setting-group.ts'
import { DEFAULT_QUOTE_NO_PATTERN, validateQuoteNoPattern } from '../domain/quote-number.ts'

export type SettingScope = 'GLOBAL' | 'WORKSPACE'

// 카드 묶음은 domain/setting-group.ts 에 있다 — 화면(클라이언트)도 읽어야 하는데
// 이 파일은 node:crypto 를 물고 있어 클라이언트가 import 할 수 없다
export { SETTING_GROUP, SETTING_GROUP_ORDER, type SettingGroupKey } from '../domain/setting-group.ts'

/**
 * 등록된 설정 키만 쓴다.
 *
 * 자유 문자열로 두면 오타 하나가 조용히 다른 키를 만들고, 화면은 저장됐다고 하는데
 * 읽는 쪽은 기본값을 계속 쓴다. 그 사이 아무도 이상을 못 느낀다.
 */
export interface SettingDef {
  key: string
  label: string
  /**
   * 어느 카드에 묶일지.
   *
   * **왜 필요한가**: 설정이 하나였을 땐 카드도 하나면 됐다. 그런데 성격이 다른 설정
   * (AI 모델 / 견적서에 인쇄되는 우리 회사 정보)을 한 목록에 늘어놓으면
   * 사용자는 「사업자등록번호」와 「추출에 쓸 AI」를 같은 종류로 읽는다.
   * 카드 제목이 무엇을 설정하는지 말해 줘야 한다.
   */
  group: SettingGroupKey
  /** 값 종류 — 화면이 어떤 입력을 그릴지 정한다 */
  kind: 'text' | 'number' | 'secret' | 'choice' | 'multiline' | 'image' | 'quoteNo'
  /**
   * `choice` 일 때 고를 수 있는 것.
   *
   * 함수인 이유: 선택지가 **지금 등록된 AI 키**에 따라 달라진다.
   * 목록을 코드에 박아 두면 키가 없는 것까지 보여 주고, 사용자는 고른 뒤에야
   * "그건 안 됩니다"를 듣는다. 고를 수 없는 것은 아예 안 보여야 한다.
   */
  choices?: (ctx: SettingContext) => { value: string; label: string; hint?: string }[]
  /** 코드 기본값 — 설정이 하나도 없어도 시스템이 돈다 */
  fallback: unknown
  description: string
}

/** 선택지를 정할 때 참고하는 것 — 지금 어떤 AI 키가 살아 있나 */
export interface SettingContext {
  /** 호스트 시스템 설정에 키가 등록된 프로바이더들 */
  availableProviders: { id: string; label: string; model: string }[]
  /** 호스트가 기본으로 쓰는 프로바이더 */
  defaultProvider: string | null
}

export const SETTING_DEFS: readonly SettingDef[] = [
  {
    key: 'ai.model.extract', label: '추출에 쓸 AI', kind: 'choice', group: 'ai',
    fallback: 'auto',
    description: '명함·미팅에서 정보를 뽑을 때 쓸 AI입니다. 키는 시스템 설정에 등록된 것을 그대로 씁니다.',
    choices: (ctx) => [
      {
        value: 'auto',
        label: ctx.defaultProvider
          ? `자동 (지금은 ${ctx.availableProviders.find((p) => p.id === ctx.defaultProvider)?.label ?? ctx.defaultProvider})`
          : '자동',
        hint: '시스템 설정의 기본 AI를 따릅니다. 기본 AI를 바꾸면 여기도 같이 바뀝니다.',
      },
      // 키가 등록된 것만 — 못 쓰는 걸 보여 주면 고른 뒤에야 실패를 듣는다
      ...ctx.availableProviders.map((p) => ({
        value: p.id, label: p.label, hint: `모델: ${p.model}`,
      })),
      {
        value: 'mock', label: 'AI 안 씀 (규칙만)',
        hint: 'AI를 부르지 않고 정해진 규칙으로만 읽습니다. 비용이 들지 않지만 정확도가 낮습니다.',
      },
    ],
  },

  // ── 견적서 공급자 정보 ──────────────────────────────────────
  //
  // **왜 설정인가**: 회사 정보는 견적마다 다르지 않다. 견적 폼에 칸을 두면
  // 영업이 매번 사업자등록번호를 외워서 치고, 한 글자 틀린 문서가 고객에게 간다.
  // 한 번 넣으면 모든 견적서·거래명세서가 같은 값을 쓴다.
  //
  // 키 이름은 `lib/terms/quote.ts` 의 SupplierField 와 **같은 말**을 쓴다 —
  // 설정 표와 문서가 다른 이름을 쓰면 대조가 안 된다.
  {
    key: 'quote.supplier.name', label: '상호', kind: 'text', group: 'quote',
    fallback: '', description: '견적서 「공급자」 칸의 회사 이름입니다. 법인명을 그대로 넣어 주세요.',
  },
  {
    key: 'quote.supplier.bizNo', label: '사업자등록번호', kind: 'text', group: 'quote',
    fallback: '', description: '000-00-00000 형식입니다. 고객이 이 번호로 세금계산서를 발행합니다.',
  },
  {
    key: 'quote.supplier.ceo', label: '대표자', kind: 'text', group: 'quote',
    fallback: '', description: '대표이사 성명입니다.',
  },
  {
    key: 'quote.supplier.address', label: '주소', kind: 'text', group: 'quote',
    fallback: '', description: '사업장 주소입니다.',
  },
  {
    key: 'quote.supplier.bizType', label: '업태', kind: 'multiline', group: 'quote',
    fallback: '',
    description: '사업자등록증에 적힌 대로 한 줄에 하나씩. 종목과 **줄 순서가 짝**입니다. 견적서에는 첫 줄만 인쇄됩니다. 예: 서비스 / 도소매 / 소매',
  },
  {
    key: 'quote.supplier.bizItem', label: '종목', kind: 'multiline', group: 'quote',
    fallback: '',
    description: '업태와 같은 순서로 한 줄에 하나씩. 견적서에는 첫 줄만 인쇄됩니다. 예: 소프트웨어 개발 및 공급 / 단말기 / 전자상거래',
  },
  {
    key: 'quote.supplier.terms', label: '기본 거래 조건', kind: 'multiline', group: 'quote',
    fallback: '', description: '모든 견적서 아래에 한 줄씩 인쇄됩니다. 줄바꿈으로 나눠 주세요. 예: 결제: 검수 후 30일 이내',
  },
  {
    key: 'quote.validDays', label: '견적 유효기간', kind: 'text', group: 'quote',
    fallback: '30',
    description: '새 견적을 만들 때 기본으로 잡히는 기간입니다. 「30」이면 30일, 「3개월」이면 3개월. 견적마다 바꿀 수 있습니다.',
  },
  {
    /*
      견적번호 형식 — **회사의 얼굴이라 배포를 기다릴 일이 아니다.**
      전용 입력(`kind: 'quoteNo'`)이라 화면이 토큰 안내와 미리보기를 함께 보여 준다 —
      `{SEQ}` 같은 표시를 설명 없이 자유 입력하게 두면 반드시 오타가 문서로 나간다.
    */
    key: 'quote.numberFormat', label: '견적번호 형식', kind: 'quoteNo', group: 'quote',
    fallback: DEFAULT_QUOTE_NO_PATTERN,
    description: '견적을 만들 때 붙는 번호입니다. 날짜 토큰이 들어가면 그 단위로 1번부터 다시 셉니다.',
  },
  {
    key: 'quote.supplier.logo', label: '로고', kind: 'image', group: 'quote',
    fallback: '', description: '견적서 왼쪽 위에 들어갑니다. PNG·JPG, 512KB 이하. 가로로 긴 이미지가 잘 맞습니다.',
  },
] as const

/**
 * **아직 안 쓰는 설정은 화면에 두지 않는다.**
 *
 * 음성 인식(`stt.vendor`·`stt.api_key`)은 미팅 녹음 기능(Phase 2)이 붙어야 쓸 데가 생긴다.
 * 그런데 입력창을 먼저 띄워 두면 사용자는 키를 넣고 아무 일도 안 일어나는 걸 보게 된다 —
 * 그건 빈 칸보다 나쁘다. 빈 칸은 적어도 "아직 없구나"라고 알려 준다.
 *
 * 녹음 기능을 붙일 때 여기 두 줄을 SETTING_DEFS 로 옮긴다.
 */
export const PLANNED_SETTINGS = [
  { key: 'ai.model.summary', label: '요약에 쓸 AI', reason: '미팅 요약 기능이 붙으면 씁니다' },
  { key: 'stt.vendor', label: '음성 인식 업체', reason: '미팅 녹음 기능이 붙으면 씁니다' },
  { key: 'stt.api_key', label: '음성 인식 키', reason: '미팅 녹음 기능이 붙으면 씁니다' },
] as const

/** 공급자 설정 키의 뒷부분. 문서 쪽 `SupplierField` 와 **같은 이름**이라 대조가 된다 */
const SUPPLIER_FIELDS: readonly SupplierField[] = [
  'name', 'bizNo', 'ceo', 'address', 'bizType', 'bizItem', 'terms',
]

const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]))

export function settingDef(key: string): SettingDef {
  const d = DEF_BY_KEY.get(key)
  if (!d) throw new CrmError('VALIDATION_FAILED', '알 수 없는 설정입니다.', { field: 'key' })
  return d
}

// ------------------------------------------------------------
// 시크릿 암호화
// ------------------------------------------------------------

/**
 * 암호화 키.
 *
 * 없으면 **평문으로 떨어지지 않고 거절한다.** 평문 폴백을 두면 키를 안 넣은 환경에서
 * API 키가 그대로 DB 에 들어가고, 그 사실을 아무도 모른다.
 */
function masterKey(): Buffer {
  const raw = process.env.CRM_SETTING_KEY
  if (!raw) {
    throw new CrmError('VALIDATION_FAILED',
      '시크릿을 저장할 수 없습니다. 서버에 암호화 키가 설정되지 않았습니다.')
  }
  // 길이가 제각각인 환경변수를 32바이트로 고정한다
  return createHash('sha256').update(raw).digest()
}

/** iv:tag:cipher (base64) — iv 를 매번 새로 뽑아 같은 평문도 다른 암호문이 된다 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(stored: string): string {
  const [ivB, tagB, encB] = stored.split(':')
  if (!ivB || !tagB || !encB) {
    throw new CrmError('VALIDATION_FAILED', '저장된 시크릿을 읽을 수 없습니다.')
  }
  const d = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB, 'base64'))
  d.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8')
}

/**
 * 화면에 보낼 마스킹.
 *
 * 뒤 4자만 남기는 이유: 사용자가 "어느 키를 넣었는지"는 알아야 바꿀지 판단한다.
 * 전부 가리면 키가 있는지조차 헷갈리고, 더 보여 주면 그건 노출이다.
 */
export function maskSecret(plain: string): string {
  if (plain.length <= 4) return '••••'
  return `••••${plain.slice(-4)}`
}

// ------------------------------------------------------------
// 읽기 — GLOBAL 을 WORKSPACE 가 덮는다
// ------------------------------------------------------------

export interface ResolvedSetting {
  key: string
  value: unknown
  /** 이 값이 어디서 왔나 — 화면이 "기본값 사용 중"을 보여 줄 수 있어야 한다 */
  source: 'WORKSPACE' | 'GLOBAL' | 'FALLBACK'
  isSecret: boolean
}

/**
 * 설정 하나를 푼다.
 *
 * 워크스페이스 가드가 CrmAppSetting 을 GLOBAL(null) + 내 워크스페이스로 좁혀 주므로
 * 여기서는 둘 중 어느 것이 이기는지만 정한다.
 */
export async function resolveSetting(db: CrmDb, key: string): Promise<ResolvedSetting> {
  const def = settingDef(key)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key },
    select: { scope: true, valueJson: true, isSecret: true },
  }) as { scope: SettingScope; valueJson: unknown; isSecret: boolean }[]

  const ws = rows.find((r) => r.scope === 'WORKSPACE')
  const global = rows.find((r) => r.scope === 'GLOBAL')
  const hit = ws ?? global

  if (!hit) return { key, value: def.fallback, source: 'FALLBACK', isSecret: def.kind === 'secret' }

  // 시크릿은 여기서 풀지 않는다 — 푸는 곳을 한 군데(readSecret)로 좁혀야 유출 경로를 셀 수 있다
  return {
    key,
    value: hit.isSecret ? null : hit.valueJson,
    source: ws ? 'WORKSPACE' : 'GLOBAL',
    isSecret: hit.isSecret,
  }
}

/** 서버가 실제로 쓸 시크릿 값. 화면으로 나가는 경로에서는 절대 부르지 않는다 */
/**
 * 견적서 공급자 정보를 **한 번에** 읽는다.
 *
 * 키마다 `resolveSetting` 을 부르면 견적 한 장에 조회가 8번이다.
 * 견적 목록에서 미리보기를 그리면 그게 그대로 곱해진다.
 *
 * 반환은 `SupplierField` 이름이다 — 설정 키(`quote.supplier.bizNo`)를
 * 문서 쪽으로 흘려보내지 않는다. 키 이름이 바뀌어도 문서는 안 바뀐다.
 */
/** 견적서에 들어갈 이미지 상한 — 인코딩 후 기준 */
export const IMAGE_MAX_BYTES = 512 * 1024

/**
 * 이미지 설정값 검증.
 *
 * **왜 형식을 좁히나**: 여기 들어온 값은 나중에 엑셀과 인쇄 화면에 **그대로 박힌다**.
 * SVG 를 허용하면 그 안의 스크립트가 함께 실린다 — 견적서를 여는 사람의 브라우저에서 돈다.
 * 그래서 래스터 둘(PNG·JPEG)만 받는다.
 *
 * **왜 상한이 필요한가**: 설정 한 줄이 몇 MB 가 되면 설정 화면을 열 때마다 그게 실려 나오고,
 * 견적서를 만들 때마다 다시 실린다. 로고에 512KB 는 넉넉하다.
 */
export function assertImage(dataUri: string, key: string): void {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri)
  if (!m) {
    // **안 넣은 것을 탓하지 않는다.** 예전엔 무엇을 넣었든 「SVG 는 안 됩니다」라고 말해서,
    // URL 을 붙여 넣은 사람은 자기가 뭘 잘못했는지 알 수 없었다(실브라우저에서 잡았다).
    const isSvg = /^data:image\/svg/i.test(dataUri)
    throw new CrmError('VALIDATION_FAILED',
      isSvg
        ? 'SVG 는 넣을 수 없어요. 그 안의 스크립트가 견적서를 여는 사람의 브라우저에서 함께 실릴 수 있습니다. PNG 나 JPG 로 바꿔 주세요.'
        : 'PNG 또는 JPG 파일을 골라 주세요.',
      { field: key })
  }
  // base64 4글자 = 3바이트. 끝의 `=` 는 실제 바이트가 아니다
  const b64 = m[2]
  const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  if (bytes > IMAGE_MAX_BYTES) {
    throw new CrmError('VALIDATION_FAILED',
      `이미지가 너무 큽니다 — ${Math.round(bytes / 1024)}KB. ${Math.round(IMAGE_MAX_BYTES / 1024)}KB 이하로 줄여 주세요.`,
      { field: key })
  }
}

/**
 * 견적서에 찍을 이미지를 읽는다(지금은 로고 하나).
 *
 * **목록 조회(listSettings)는 이 값을 싣지 않는다.** 로고 하나가 수백 KB 라
 * 설정 화면을 열 때마다 그게 따라오면 화면이 느려진다 — 거기서는 «있음/없음»만 보여 준다.
 */
/**
 * 견적 유효기간 기본값을 **일수**로.
 *
 * **왜 문자열로 받나**: 사용자는 「30」이라고도 「3개월」이라고도 쓴다.
 * 단위를 고르는 드롭다운을 따로 두면 칸이 둘이 되고, 둘이 어긋날 수 있다 —
 * 한 칸에 쓰게 하고 여기서 읽는다.
 *
 * 30일을 기본으로 둔 이유: 예전에는 이 값이 **코드에 박혀 있었다**(`todayPlus(30)`).
 * 바꾸려면 배포를 해야 했다.
 */
export async function readQuoteValidDays(db: CrmDb): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key: QUOTE_SETTING_KEY.validDays },
    select: { scope: true, valueJson: true },
  }) as { scope: SettingScope; valueJson: unknown }[]
  const hit = rows.find((r) => r.scope === 'WORKSPACE') ?? rows.find((r) => r.scope === 'GLOBAL')
  return parseValidDays(hit ? String(hit.valueJson ?? '') : '')
}

/**
 * 견적번호 형식.
 *
 * 못 읽거나 쓸 수 없는 형식이면 **기본값으로 떨어진다** — 설정이 망가졌다고
 * 견적을 못 만들면 안 된다. 잘못된 형식은 설정 화면이 저장 전에 막는다.
 */
// 트랜잭션 안에서도 불린다 — tx 클라이언트는 CrmDb 와 타입이 달라 여기서 넓게 받는다
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readQuoteNoPattern(db: CrmDb | any): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key: QUOTE_SETTING_KEY.numberFormat },
    select: { scope: true, valueJson: true },
  }) as { scope: SettingScope; valueJson: unknown }[]
  const hit = rows.find((r) => r.scope === 'WORKSPACE') ?? rows.find((r) => r.scope === 'GLOBAL')
  const raw = hit ? String(hit.valueJson ?? '').trim() : ''
  return raw && validateQuoteNoPattern(raw) === null ? raw : DEFAULT_QUOTE_NO_PATTERN
}

/** 「30」·「30일」·「3개월」·「1년」 을 일수로. 못 읽으면 30 */
export function parseValidDays(raw: string): number {
  const t = (raw ?? '').trim()
  if (t === '') return 30
  const m = /^(\d+)\s*(일|개월|달|월|년)?$/.exec(t)
  if (!m) return 30
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return 30
  const unit = m[2] ?? '일'
  // 개월·년은 «달력상 개월»이라 30·365 로 환산한다 — 견적 기한에 하루 이틀 차이는 뜻이 없다
  const days = unit === '일' ? n : unit === '년' ? n * 365 : n * 30
  // 상한을 둔다 — 「9999개월」 이 들어오면 날짜 칸이 감당 못 한다
  return Math.min(days, 3650)
}

export async function readQuoteImages(db: CrmDb): Promise<{ logo: string }> {
  const keys = [SUPPLIER_IMAGE_KEY.logo]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key: { in: keys } },
    select: { scope: true, key: true, valueJson: true },
  }) as { scope: SettingScope; key: string; valueJson: unknown }[]

  const pick = (key: string): string => {
    const mine = rows.filter((r) => r.key === key)
    const hit = mine.find((r) => r.scope === 'WORKSPACE') ?? mine.find((r) => r.scope === 'GLOBAL')
    return hit ? String(hit.valueJson ?? '') : ''
  }
  return { logo: pick(SUPPLIER_IMAGE_KEY.logo) }
}

export async function readQuoteSupplier(db: CrmDb): Promise<Record<SupplierField, string>> {
  const keys = SUPPLIER_FIELDS.map((f) => SUPPLIER_SETTING_KEY[f])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key: { in: keys } },
    select: { scope: true, key: true, valueJson: true },
  }) as { scope: SettingScope; key: string; valueJson: unknown }[]

  const out = {} as Record<SupplierField, string>
  for (const f of SUPPLIER_FIELDS) {
    const mine = rows.filter((r) => r.key === SUPPLIER_SETTING_KEY[f])
    // WORKSPACE 가 GLOBAL 을 덮는다 — resolveSetting 과 같은 규칙이다
    const hit = mine.find((r) => r.scope === 'WORKSPACE') ?? mine.find((r) => r.scope === 'GLOBAL')
    out[f] = hit ? String(hit.valueJson ?? '') : ''
  }
  return out
}

export async function readSecret(db: CrmDb, key: string): Promise<string | null> {
  const def = settingDef(key)
  if (def.kind !== 'secret') {
    throw new CrmError('VALIDATION_FAILED', '시크릿이 아닌 설정입니다.', { field: 'key' })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key }, select: { scope: true, valueJson: true },
  }) as { scope: SettingScope; valueJson: unknown }[]

  const hit = rows.find((r) => r.scope === 'WORKSPACE') ?? rows.find((r) => r.scope === 'GLOBAL')
  if (!hit || typeof hit.valueJson !== 'string') return null
  return decryptSecret(hit.valueJson)
}

/** 설정 화면이 읽는 목록 — 시크릿은 마스킹만 나간다 */
export async function listSettings(db: CrmDb, ctx?: SettingContext): Promise<{
  key: string
  label: string
  kind: SettingDef['kind']
  group: SettingGroupKey
  description: string
  value: string | null
  masked: string | null
  source: ResolvedSetting['source']
  /** choice 일 때 고를 수 있는 것 — 없으면 화면이 드롭다운을 못 그린다 */
  choices?: { value: string; label: string; hint?: string }[]
}[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    select: { scope: true, key: true, valueJson: true, isSecret: true },
  }) as { scope: SettingScope; key: string; valueJson: unknown; isSecret: boolean }[]

  return SETTING_DEFS.map((def) => {
    const mine = rows.filter((r) => r.key === def.key)
    const hit = mine.find((r) => r.scope === 'WORKSPACE') ?? mine.find((r) => r.scope === 'GLOBAL')
    const source: ResolvedSetting['source'] = hit
      ? (mine.find((r) => r.scope === 'WORKSPACE') ? 'WORKSPACE' : 'GLOBAL')
      : 'FALLBACK'

    if (def.kind === 'secret') {
      let masked: string | null = null
      if (hit && typeof hit.valueJson === 'string') {
        // 마스킹 실패가 화면 전체를 막지 않게 한다 — 키가 깨졌다는 사실만 보이면 된다
        try { masked = maskSecret(decryptSecret(hit.valueJson)) } catch { masked = '(읽을 수 없음)' }
      }
      return { ...pick(def, ctx), value: null, masked, source }
    }

    if (def.kind === 'image') {
      // 원본(수백 KB)을 목록에 싣지 않는다 — 크기만 알려 주면 «넣었나»는 판단이 된다
      const raw = hit ? String(hit.valueJson ?? '') : ''
      const kb = raw ? Math.round(raw.length * 3 / 4 / 1024) : 0
      return { ...pick(def, ctx), value: null, masked: raw ? `${kb}KB` : null, source }
    }

    const value = hit ? String(hit.valueJson ?? '') : (def.fallback === null ? '' : String(def.fallback))
    return { ...pick(def, ctx), value, masked: null, source }
  })
}

/**
 * 화면에 내보낼 모양.
 *
 * 선택지는 **지금 등록된 AI 키**에 따라 달라지므로 ctx 를 받아 그때 만든다.
 * 목록을 코드에 박아 두면 키가 없는 것까지 보여 주고, 사용자는 고른 뒤에야 실패를 듣는다.
 */
function pick(d: SettingDef, ctx?: SettingContext) {
  return {
    key: d.key, label: d.label, kind: d.kind, group: d.group, description: d.description,
    choices: d.choices && ctx ? d.choices(ctx) : undefined,
  }
}

// ------------------------------------------------------------
// 쓰기 — 감사에 남기되 값은 남기지 않는다
// ------------------------------------------------------------

export async function setSetting(
  workspaceId: string,
  actorId: string | null,
  key: string,
  rawValue: string | number | null,
): Promise<void> {
  const def = settingDef(key)
  const isSecret = def.kind === 'secret'

  if (rawValue === null || rawValue === '') {
    await clearSetting(workspaceId, actorId, key)
    return
  }

  if (def.kind === 'number' && Number.isNaN(Number(rawValue))) {
    throw new CrmError('VALIDATION_FAILED', '숫자를 입력해 주세요.', { field: key })
  }

  if (def.kind === 'image') assertImage(String(rawValue), key)

  /*
    번호 형식은 **서버도 막는다.** 화면이 이미 검사하지만 API 를 직접 부르는 길이 있고,
    잘못된 형식이 들어가면 그 뒤로 만드는 견적마다 이상한 번호가 붙는다 —
    되돌리려면 이미 나간 문서를 전부 찾아야 한다.
  */
  if (def.kind === 'quoteNo') {
    const bad = validateQuoteNoPattern(String(rawValue))
    if (bad) throw new CrmError('VALIDATION_FAILED', bad, { field: key })
  }

  const stored: unknown = isSecret ? encryptSecret(String(rawValue)) : rawValue

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (tx as any).crmAppSetting.findFirst({
      where: { key, scope: 'WORKSPACE' }, select: { id: true },
    })

    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmAppSetting.updateMany({
        where: { id: existing.id }, data: { valueJson: stored as never, isSecret, updatedById: actorId },
      })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmAppSetting.create({
        data: {
          scope: 'WORKSPACE', key, valueJson: stored as never,
          isSecret, description: def.description, updatedById: actorId,
        },
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'setting.changed',
      targetType: 'setting', targetId: key,
      // 시크릿은 감사에도 값을 남기지 않는다 — 감사 로그가 키 유출 경로가 되면 안 된다
      afterJson: isSecret ? { key, changed: true } : { key, value: rawValue },
    })
  })
}

/** 워크스페이스 설정을 지운다 — GLOBAL 또는 코드 기본값으로 돌아간다 */
export async function clearSetting(
  workspaceId: string,
  actorId: string | null,
  key: string,
): Promise<void> {
  settingDef(key)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmAppSetting.deleteMany({ where: { key, scope: 'WORKSPACE' } })
    if (res.count === 0) return

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'setting.cleared',
      targetType: 'setting', targetId: key, afterJson: { key },
    })
  })
}
