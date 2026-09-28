'use server'

// app/(trading)/trading/settings/actions.ts — 설정 저장 창구
//
// **왜 이제야 생기나** (사용자 지적 2026-09-27: 「설정하는 것 자체가 없네」):
// 레지스트리에 값이 88개인데 바꾸는 길은 좁은 토글 셋뿐이었다. 나머지 85개는 화면에
// **읽기 전용으로 그려지기만** 했다. 볼 수는 있는데 못 고치는 값은 설정이 아니라 전시다.
//
// **왜 API 라우트가 아닌가**: 이 모듈은 값 바꾸는 길을 전부 서버 액션으로 둔다
// (`../actions.ts` 머리말). 라우트를 하나 열면 소유자 확인이 두 벌이 되고,
// 갈린 결과가 「화면은 열리는데 창구가 막힌다」이거나 그 반대다.
//
// **왜 새 인증을 안 만드나**: 셸(`app/(trading)/layout.tsx`)과 소유자 문이 이미
// `tradingAccess()` 를 부른다. 여기서도 같은 함수를 부른다 — 판정이 하나여야 답이 하나다.

import { revalidatePath } from 'next/cache'
import { tradingAccess } from '@/lib/trading/access'
import { getRequestUser } from '@/lib/supabase/server'
import { saveTradingSetting, loadTradingSettings } from '@/lib/trading/settings/store'
import { tradingSetting, validateSetting, type TradingSettingValue } from '@/lib/trading/settings/registry'
import { editableHere, whyElsewhere } from '@/lib/trading/settings/editable'
import { saveTradingCredentials } from '@/lib/trading/broker/credentials'
import type { KisEnv } from '@/lib/trading/broker/endpoints'
import { kstTodayKey } from '@/lib/datetime/kst'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveProviderKey } from '@/lib/ai/provider-key-source'
import { JUDGE_PROVIDERS } from '@/lib/trading/settings/registry'
import type { AiProviderId } from '@/lib/ai/provider-catalog'
import { MODEL_PAIRS } from '@/lib/trading/settings/model-pick'
import {
  toModelCatalogItems, type ModelCatalogItem, type ModelCatalogRow,
} from '@/lib/ai-chat/model-catalog-item'
import {
  buildAssistantPrompt, planChanges, parseAssistantResponse, type AssistantPlan,
} from '@/lib/trading/settings/assistant'
import { callKnowledge } from '@/lib/trading/knowledge/ai-call'
import {
  fillFrom, riskView, raisesLossLimit, filledNumber,
  type Answers, type FilledValue, type RiskView, type StartOverrides,
} from '@/lib/trading/settings/onboarding'
import { ENV_BLOCKED_MESSAGE, type KeyChoice } from '@/lib/ai/provider-key-source'
import { refreshCatalogFor } from '@/lib/ai-chat/model-catalog-refresh'
import { computeRisk } from '@/lib/trading/risk/arithmetic'
import { loadInstrumentSpec } from '@/lib/trading/settings/store'

export interface SaveSettingResult {
  ok: boolean
  userMessage: string | null
  /** 저장됐으면 몇 번째 판인지. 화면이 「쌓였다」를 눈으로 확인할 수 있게 */
  version?: number
}

const DENIED: SaveSettingResult = { ok: false, userMessage: '이 화면의 소유자만 바꿀 수 있습니다' }

/**
 * 값 하나를 다음 판으로 저장한다.
 *
 * @param key 레지스트리에 등재된 설정 키. **밖에서 온 값이라 대조 없이는 안 쓴다**
 * @param raw 화면이 보낸 글자. 형은 레지스트리가 정하고 여기서 그 형으로 읽는다
 */
export async function saveTradingSettingValue(key: string, raw: string): Promise<SaveSettingResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const user = await getRequestUser()
  if (!user) return DENIED

  /**
   * **모르는 키는 저장하지 않는다.** 레지스트리에 없는 키를 넣으면 아무도 안 읽는 줄이
   * 판으로 쌓이고, 화면에는 「저장됨」으로 보인다.
   */
  const spec = tradingSetting(key)
  if (!spec) return { ok: false, userMessage: '모르는 설정입니다' }

  /**
   * **관문이 있는 값은 여기서 안 바꾼다.** 설정으로 쓰면 그 관문을 지나가는 옆문이 된다.
   * 어디서 바꾸는지는 화면이 이미 말하고 있고, 창구도 같은 말을 한다 —
   * 화면만 막으면 주소를 아는 사람이 그대로 부를 수 있다.
   */
  if (!editableHere(key)) {
    return { ok: false, userMessage: whyElsewhere(key) ?? '이 값은 여기서 바꾸지 않습니다' }
  }

  const value = parseByType(spec.type, raw)
  if (value === null) return { ok: false, userMessage: `${spec.label}의 값을 읽지 못했습니다` }

  // 형과 범위는 레지스트리가 본다. 여기서 또 재면 두 벌이 되고 한쪽만 고쳐진다
  const rejection = validateSetting(key, value)
  if (rejection) return { ok: false, userMessage: rejection.userMessage }

  const saved = await saveTradingSetting({
    key,
    value,
    source: 'admin',
    // 누가·언제는 칼럼이 들고, 여기에는 어디서 바꿨는지를 적는다
    reason: '설정 화면에서 변경',
    changedBy: user.id,
    /**
     * **다음 거래일부터**다. 이 화면에서 바꾸는 것은 전략 값이라 장중에 듣게 하면
     * 그날 판단이 두 기준으로 갈린다(§15.2). 문을 여닫는 값은 위에서 이미 막았다.
     */
    effectiveTradeDate: nextTradeDate(),
  })
  if (!saved.ok) return { ok: false, userMessage: saved.rejection.userMessage }

  revalidatePath('/trading/settings')
  return { ok: true, userMessage: null, version: saved.version }
}

/** 화면이 보낸 글자를 레지스트리가 정한 형으로. 못 읽으면 null 이고 저장하지 않는다 */
function parseByType(type: string, raw: string): TradingSettingValue | null {
  if (type === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  }
  if (type === 'number') {
    const n = Number(raw.trim())
    return Number.isFinite(n) ? n : null
  }
  // 글자와 고르기는 그대로. 고르기의 후보 대조는 validateSetting 이 한다
  return raw.trim()
}

/**
 * 다음 거래일. **달력을 여기서 계산하지 않는다** — 휴장일 판정은 트레이딩 달력의 일이고,
 * 설정 저장이 그것을 흉내 내면 두 달력이 생긴다. 여기서는 「오늘보다 뒤」만 보장하면 되고,
 * 그 다음 거래일이 언제인지는 값을 읽는 쪽(`pickEffective`)이 거래일 기준으로 고른다.
 */
function nextTradeDate(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return kstTodayKey(tomorrow)
}

export interface SaveCredentialActionResult {
  ok: boolean
  userMessage: string | null
}

/**
 * 증권사 자격증명을 넣는다 — **넣는 길만 만든다.**
 *
 * ## 왜 이제야 생기나 (실측 2026-09-27)
 *
 * `saveTradingCredentials` 는 있었는데 **부르는 자리가 0곳**이었다. 저장 로직·암호화·가린
 * 계좌번호까지 다 만들어 두고 넣을 화면이 없어서, 실제로 넣으려면 사람이 DB 를 직접 만져야 했다.
 *
 * ## 돌려주지 않는다
 *
 * 앱키와 시크릿은 저장한 뒤 화면으로 다시 나가지 않는다(`credentials.ts` 머리말).
 * 이 함수도 성공 여부만 돌려준다 — 「확인용으로 한 번만」을 만들면 그 길이 곧 유출 경로다.
 * 그래서 결과에 `userMessage` 말고는 아무것도 없다.
 *
 * ## 모의와 실전은 따로다
 *
 * `env` 가 유일 키라 한쪽을 넣어도 다른 쪽은 그대로다. 둘을 한 줄로 합치면
 * 모의로 시험하다가 실전 자격증명을 덮어쓴다.
 */
export async function saveTradingCredentialsAction(
  env: string,
  appKey: string,
  appSecret: string,
  accountNo: string,
): Promise<SaveCredentialActionResult> {
  if (!(await tradingAccess()).allowed) return { ok: false, userMessage: DENIED.userMessage }
  const user = await getRequestUser()
  if (!user) return { ok: false, userMessage: DENIED.userMessage }

  // 밖에서 온 값이라 아는 둘 말고는 안 받는다. 모르는 값이면 그 환경이 새로 생긴다
  if (env !== 'real' && env !== 'paper') {
    return { ok: false, userMessage: '모르는 증권사 환경입니다' }
  }

  const saved = await saveTradingCredentials({
    env: env as KisEnv,
    appKey,
    appSecret,
    accountNo,
    updatedBy: user.id,
  })
  if (!saved.ok) return { ok: false, userMessage: saved.userMessage }

  revalidatePath('/trading/settings')
  return { ok: true, userMessage: null }
}

/* ── 모델 고르기 ───────────────────────────────────────── */

/**
 * 판단에 쓸 모델 목록. **소유자 문을 지난다.**
 *
 * AI 화면의 목록 창구(`listModelCatalog`)는 관리자 전용이다. 그것을 그대로 부르면
 * 「화면은 열리는데 창구가 403」이 된다 — 이 파일 머리말이 경계하는 바로 그 상태다.
 * 같은 표를 읽되 문은 이 화면의 문을 쓴다.
 *
 * **키 원문은 안 나간다.** 어느 공급자에 키가 있나(있음·없음)만 함께 준다.
 */
export async function listJudgeModels(): Promise<{
  ok: boolean
  /** 관리자 연동 카드가 받는 것과 **같은 줄**이다. 같은 변환기를 지난다 */
  items?: ModelCatalogItem[]
  /** 키가 등록된 공급자. 화면이 없는 키의 탭을 안 세운다 */
  withKey?: string[]
  /**
   * 공급자마다 **왜** 쓸 수 있나 없나. `resolveProviderKey` 의 사유를 그대로 옮긴다.
   *
   * 있음·없음 둘로만 답하면 「키가 없다」와 「키는 있는데 이 판에서는 운영 키를 안 쓴다」가
   * 같은 말이 된다. 조치가 정반대다 — 앞은 키를 넣어야 하고 뒤는 이미 넣은 키가 맞다.
   * 키 값은 안 싣는다. 이 표에 실리는 것은 사유 글자뿐이다 (S3)
   */
  keyState?: Record<string, KeyChoice['reason']>
  /**
   * 「이 판에서는 운영 키를 안 씁니다」를 뭐라고 말하나.
   * 문장은 키를 고르는 모듈 한 곳에만 있고, 화면은 그것을 받아 그린다 —
   * 화면이 직접 들여오면 그 모듈의 동적 import 가 server-only 를 끌고 들어온다
   */
  envBlockedMessage?: string
  error?: string
}> {
  if (!(await tradingAccess()).allowed) return { ok: false, error: '이 화면의 소유자만 볼 수 있습니다' }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('ai_model_catalog')
      .select('provider, model_id, label, context_length, capabilities, released_at, is_active, availability, availability_reason, availability_checked_at')
      .in('provider', [...JUDGE_PROVIDERS])
      .eq('is_active', true)
      .order('released_at', { ascending: false, nullsFirst: false })
    if (error) return { ok: false, error: `모델 목록을 읽지 못했습니다: ${error.message}` }

    const withKey: string[] = []
    const keyState: Record<string, KeyChoice['reason']> = {}
    for (const id of JUDGE_PROVIDERS) {
      const choice = await resolveProviderKey(id as AiProviderId, null)
      // 사유만 옮긴다. 값은 이 함수 밖으로 안 나간다
      keyState[id] = choice.reason
      if (choice.apiKey) withKey.push(id)
    }
    return {
      ok: true, withKey, keyState, envBlockedMessage: ENV_BLOCKED_MESSAGE,
      items: toModelCatalogItems((data ?? []) as ModelCatalogRow[]),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '모델 목록을 읽지 못했습니다' }
  }
}

/**
 * 판단에 쓸 공급자의 모델 목록을 **관문에서 받아 채운다.**
 *
 * ## 왜 이 창구가 필요한가 (실측 2026-09-28)
 *
 * `ai_model_catalog` 에 jev 모델이 **0개**였다. 관문(Vercel AI Gateway)은 자기 모델을
 * `GET /v1/models` 로 알려 주는데(실측 391개) 아무도 그것을 받아 온 적이 없었기 때문이다.
 * 받아 오는 창구는 있었지만 **관리자 전용**이라 트레이딩 소유자가 못 불렀다.
 * 그 결과 화면은 「다른 모델을 고르세요」라고 말하는데 고를 것이 하나도 없었다.
 *
 * ## 안 하는 것 셋
 *
 * 1 **관리자 창구를 그대로 안 부른다.** 소유자가 관리자가 아닌 날 통째로 막힌다 —
 *   일은 `refreshCatalogFor` 한 곳에 있고 관문만 여기서 다시 건다
 * 2 **아무 공급자나 안 받는다.** 밖에서 온 값이므로 판단에 쓸 수 있는 목록으로만 거른다
 * 3 **모델마다 찔러 보지 않는다.** 관문 뒤에 391개가 있어 전부 부르면 목록 한 번에
 *   391번을 부른다. 고르는 데는 목록이면 족하고, 상태는 「모름」으로 정직하게 둔다
 *
 * 키는 서버 밖으로 안 나간다 — 돌려주는 것은 받은 개수와 사유뿐이다 (S3).
 */
export async function refreshJudgeModels(
  provider: string,
): Promise<{ ok: boolean; count?: number; userMessage: string }> {
  if (!(await tradingAccess()).allowed) {
    return { ok: false, userMessage: '이 화면의 소유자만 할 수 있습니다' }
  }
  if (!JUDGE_PROVIDERS.includes(provider)) {
    return { ok: false, userMessage: '판단에 쓸 수 있는 공급자가 아닙니다' }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const r = await refreshCatalogFor(admin, provider as AiProviderId, { probe: false })
    if (!r.ok) return { ok: false, userMessage: r.error ?? '모델 목록을 받지 못했습니다' }
    if ((r.count ?? 0) === 0) {
      return { ok: true, count: 0, userMessage: '관문이 고를 수 있는 모델을 하나도 안 줬습니다' }
    }
    return { ok: true, count: r.count, userMessage: `${r.count}개를 받았습니다. 이제 고를 수 있습니다` }
  } catch (error) {
    return {
      ok: false,
      userMessage: error instanceof Error ? error.message : '모델 목록을 받지 못했습니다',
    }
  }
}

/**
 * 공급자와 모델을 **함께** 저장한다.
 *
 * 한쪽만 저장하는 길을 안 둔다 — 모델만 바꾸고 공급자가 그대로면 그 공급자에 없는 모델을
 * 가리키게 되고, 화면에는 이름이 멀쩡히 적혀 있는데 그 자리는 한 건도 안 돈다.
 *
 * 저장은 **기존 창구를 그대로 지난다**(M7) — 다음 거래일부터 듣는다.
 */
export async function savePickedModel(
  providerKey: string, modelKey: string, provider: string, model: string,
): Promise<SaveSettingResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  const pair = MODEL_PAIRS.find((p) => p.providerKey === providerKey && p.modelKey === modelKey)
  // 밖에서 온 키다. 등재된 쌍이 아니면 아무것도 안 한다
  if (!pair) return { ok: false, userMessage: '고를 수 있는 자리가 아닙니다' }
  if (!JUDGE_PROVIDERS.includes(provider)) {
    return { ok: false, userMessage: '고를 수 있는 공급자가 아닙니다' }
  }

  const first = await saveTradingSettingValue(providerKey, provider)
  if (!first.ok) return first
  const second = await saveTradingSettingValue(modelKey, model)
  if (!second.ok) return second
  return { ok: true, userMessage: `${provider} · ${model} 로 저장했습니다. 다음 거래일부터 듣습니다`, version: second.version }
}

/* ── 말로 설정 바꾸기 ──────────────────────────────────── */

export interface AssistantResult {
  ok: boolean
  plan?: AssistantPlan
  userMessage: string | null
}

/**
 * 말을 받아 **바꿀 값 목록만** 만든다. 저장은 안 한다.
 *
 * 사람이 확인하기 전에는 아무 값도 안 바뀐다 — 이 창구에는 저장하는 길이 없다.
 * 금지 목록(§15.3)에 걸리는 키는 `planChanges` 가 후보로도 안 올린다.
 */
export async function proposeSettingChanges(ask: string): Promise<AssistantResult> {
  if (!(await tradingAccess()).allowed) return { ok: false, userMessage: DENIED.userMessage }
  const question = ask.trim()
  if (question === '') return { ok: false, userMessage: '무엇을 하고 싶은지 적어 주세요' }

  const today = kstTodayKey()
  const { values } = await loadTradingSettings(today)
  const call = await callKnowledge({
    purpose: 'setting_help',
    prompt: buildAssistantPrompt(question, values),
    model: (values.knowledge_model as string) || null,
    provider: (values.knowledge_provider as AiProviderId) ?? 'gemini',
    json: true,
  })
  if (!call.ok) return { ok: false, userMessage: call.userMessage }

  const plan = planChanges(parseAssistantResponse(call.text), values)
  return { ok: true, plan, userMessage: null }
}

/**
 * 확인한 것만 저장한다. **기존 창구를 그대로 지난다** (M7) — 다음 거래일부터 듣는다.
 *
 * 여기서 규정을 한 번 더 본다. 미리보기와 저장 사이에 금지 목록이 늘었을 수 있고,
 * 화면이 보낸 값은 **밖에서 온 값**이다.
 */
export async function applySettingChanges(
  changes: readonly { key: string; nextValue: unknown }[],
): Promise<{ ok: boolean; saved: number; userMessage: string }> {
  if (!(await tradingAccess()).allowed) return { ok: false, saved: 0, userMessage: DENIED.userMessage! }
  const today = kstTodayKey()
  const { values } = await loadTradingSettings(today)
  const plan = planChanges(
    changes.map((c) => ({ key: c.key, value: c.nextValue, why: '사람이 확인함' })),
    values,
  )
  if (plan.changes.length === 0) {
    return { ok: false, saved: 0, userMessage: plan.rejected[0]?.userMessage ?? '저장할 값이 없습니다' }
  }

  let saved = 0
  for (const change of plan.changes) {
    // 리스크 산술(M6)은 이 창구가 본다. 안 맞으면 그 줄에서 멈춘다
    const result = await saveTradingSettingValue(change.key, String(change.nextValue))
    if (!result.ok) {
      return {
        ok: false, saved,
        userMessage: `${change.label}: ${result.userMessage ?? '저장하지 못했습니다'}`,
      }
    }
    saved += 1
  }
  return { ok: true, saved, userMessage: `${saved}개를 저장했습니다. 다음 거래일부터 듣습니다` }
}

/* ── 세 문항으로 시작하기 ──────────────────────────────── */

export interface StartPreview {
  ok: boolean
  filled?: FilledValue[]
  risk?: RiskView
  /** 손실 한도를 올리는 답인가. 올리면 화면이 확인을 받는다 */
  raisesLimit?: boolean
  /**
   * 지금 저장돼 있는 손실 한도. 화면이 손댄 값으로 **다시 견주려면** 이 값이 있어야 한다 —
   * 없으면 표를 고칠 때마다 창구를 다시 불러야 하고, 그러면 한 글자마다 서버를 두드린다
   */
  currentLossLimitKrw?: number
  userMessage: string | null
}

/**
 * 답 셋으로 무엇을 채울지 **보여 주기만** 한다. 저장은 안 한다.
 *
 * 한 번의 위험을 돈으로 환산해 함께 준다 — 명세 M6 이 「리스크 산술이 안 맞는 설정은
 * 저장되지 않는다」고 정했으므로, 저장 창구가 거절하기 전에 화면이 먼저 말해야 한다.
 */
export async function previewStart(
  answers: Answers, overrides?: StartOverrides,
): Promise<StartPreview> {
  if (!(await tradingAccess()).allowed) return { ok: false, userMessage: DENIED.userMessage }
  const today = kstTodayKey()
  const { values } = await loadTradingSettings(today)
  const filled = fillFrom(answers, overrides)

  /**
   * 한 번의 위험은 **상품 규격과 손절 설정**에서 나온다. 지어내지 않는다.
   * 규격을 못 읽으면 위험을 0 으로 두고 화면이 「아직 못 잽니다」를 말한다.
   */
  let onceKrw = 0
  try {
    const instrument = await loadInstrumentSpec(today)
    const atr = Number(values.risk_reference_atr) || 1.3
    const stopMultiple = Number(values.exit_stop_atr_multiple) || 1.2
    const chaseMultiple = Number(values.exit_chase_atr_multiple) || 0.3
    const reference = 1100
    onceKrw = computeRisk({
      direction: 'long',
      instrument,
      referencePrice: reference,
      stopPrice: reference - stopMultiple * atr,
      chaseDistance: chaseMultiple * atr,
      stopSlippageTicks: Number(values.replay_fallback_ticks) || 2,
      roundTripFeeKrw: Number(values.fee_rate) || 0,
      quantity: 1,
    }).riskPerTradeKrw
  } catch {
    // 규격을 못 읽어도 미리보기를 막지 않는다. 못 쟀다는 사실만 화면에 남는다
    onceKrw = 0
  }

  /**
   * 한도는 **채운 표의 값**으로 견준다. 답의 값으로 견주면 표에서 한도를 고친 뒤에도
   * 화면이 고치기 전 숫자로 「몇 번분입니다」를 말한다 — 고친 사람이 그것을 믿는다.
   */
  const limitKrw = filledNumber(filled, 'daily_loss_limit_krw', answers.lossLimitKrw)
  const currentLossLimitKrw = typeof values.daily_loss_limit_krw === 'number'
    ? values.daily_loss_limit_krw : 0
  return {
    ok: true,
    filled,
    risk: riskView(onceKrw, limitKrw),
    raisesLimit: raisesLossLimit(limitKrw, currentLossLimitKrw),
    currentLossLimitKrw,
    userMessage: null,
  }
}

/**
 * 확인한 값을 저장한다. **기존 창구를 그대로 지난다** (M7) — 다음 거래일부터 듣는다.
 *
 * 화면이 보낸 값은 밖에서 온 값이라 **답에서 다시 계산해** 대조한다.
 * 화면이 값을 바꿔 보내도 답이 만든 값만 저장된다.
 */
export async function applyStart(
  answers: Answers, overrides?: StartOverrides,
): Promise<{ ok: boolean; saved: number; userMessage: string }> {
  if (!(await tradingAccess()).allowed) return { ok: false, saved: 0, userMessage: DENIED.userMessage! }
  /**
   * 손댄 값도 **여기서 다시 만든다.** 화면이 보낸 줄을 그대로 저장하지 않는다 —
   * `fillFrom` 이 답이 만든 키에만 손댄 값을 얹고 등록부 규칙으로 걸러 내므로,
   * 화면이 없는 키나 범위 밖 값을 보내도 여기서 떨어진다.
   */
  const filled = fillFrom(answers, overrides)
  if (filled.length === 0) return { ok: false, saved: 0, userMessage: '채울 값이 없습니다' }

  let saved = 0
  for (const item of filled) {
    // 리스크 산술(M6)은 이 창구가 본다. 안 맞으면 그 줄에서 멈추고 사유를 올린다
    const result = await saveTradingSettingValue(item.key, String(item.value))
    if (!result.ok) {
      return { ok: false, saved, userMessage: `${item.label}: ${result.userMessage ?? '저장하지 못했습니다'}` }
    }
    saved += 1
  }
  return { ok: true, saved, userMessage: `${saved}개를 채웠습니다. 다음 거래일부터 듣습니다` }
}
