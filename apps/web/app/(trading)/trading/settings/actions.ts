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
import { saveTradingSetting } from '@/lib/trading/settings/store'
import { tradingSetting, validateSetting, type TradingSettingValue } from '@/lib/trading/settings/registry'
import { editableHere, whyElsewhere } from '@/lib/trading/settings/editable'
import { kstTodayKey } from '@/lib/datetime/kst'

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
