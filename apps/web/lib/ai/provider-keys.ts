// 공급자 키 저장 창구 한 벌
//
// 예전에는 공급자마다 저장·삭제·모델저장·연결확인을 따로 썼다 — 넷 곱하기 넷이면 열여섯 벌이고,
// 그래서 Gemini 칸에만 있던 접두사 검증이 Claude 칸에는 없었고, Groq 해제는 회의 전사가 함께
// 멈춘다는 말을 아무 데서도 하지 않았다.
//
// 이 파일은 그 넷을 공급자 id 하나로 받는 순수 함수로 모은다. 권한 확인과 DB 왕복은 서버액션이
// 맡고, 무엇이 옳은 키이고 무엇을 지우며 뭐라고 말할지는 여기서 정한다 — 그래야 단위테스트가
// 네트워크 없이 규칙을 확인할 수 있다.

import { getProviderSpec, matchesKeyPrefix, type AiProviderId } from './provider-catalog.ts'
import type { ModelAvailability } from '../ai-chat/model-status.ts'

/**
 * 이 공급자 키가 함께 데리고 다니는 설정.
 * 키를 지우면 이것도 지운다 — 남겨 두면 「설정했는데 왜 이 모델이지」를 아무도 설명하지 못한다.
 * 코드에 흩어 쓰지 않고 여기 한 곳에 데이터로 선언한다.
 */
const COMPANION_META_KEYS: Partial<Record<AiProviderId, readonly string[]>> = {
  // 음성 인식 카드가 넣던 값들. 키 이름 자체(stt_api_key)는 명세가 승계했다
  groq: ['stt_model', 'stt_provider'],
}

/** 화면으로 돌아가는 가림값. 원문 키는 어떤 응답에도 담기지 않는다 */
export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 8) return '*'.repeat(Math.max(k.length, 4))
  return `${k.slice(0, 4)}${'*'.repeat(Math.max(k.length - 8, 4))}${k.slice(-4)}`
}

export interface KeyValidation {
  ok: boolean
  /** 사용자에게 보일 이유. 원문 키를 담지 않는다 */
  error?: string
}

/**
 * 저장 전 검증. 빈 값과 남의 공급자 키를 여기서 막는다.
 * 접두사 규칙은 명세에서 온다 — 화면이 자기 규칙을 또 적으면 카드마다 통과 기준이 갈린다.
 */
export function validateProviderKey(id: AiProviderId, raw: string): KeyValidation {
  const spec = getProviderSpec(id)
  const key = (raw ?? '').trim()
  if (!key) return { ok: false, error: 'API 키를 입력해주세요' }
  if (!matchesKeyPrefix(id, key)) {
    return { ok: false, error: `${spec.label} 키가 아닙니다 (${spec.keyPrefixes.join(' 또는 ')} 로 시작해야 합니다)` }
  }
  return { ok: true }
}

/** META 에 키를 앉힌 새 객체. 원본은 고치지 않는다 */
export function withProviderKey(
  id: AiProviderId,
  raw: string,
  meta: Record<string, unknown>,
): Record<string, unknown> {
  return { ...meta, [getProviderSpec(id).meta.apiKey]: (raw ?? '').trim() }
}

/** META 에 모델 선택을 앉힌 새 객체 */
export function withProviderModel(
  id: AiProviderId,
  model: string,
  meta: Record<string, unknown>,
): Record<string, unknown> {
  return { ...meta, [getProviderSpec(id).meta.model]: (model ?? '').trim() }
}

export interface KeyRemoval {
  meta: Record<string, unknown>
  /** 이 키가 또 하던 일이 있으면 무엇이 함께 멈추는지. 없으면 null */
  warning: string | null
}

/**
 * META 에서 키를 뺀다.
 * 지우기 전에 무엇이 함께 사라지는지 말한다 — Groq 키를 「AI 공급자」로만 알고 해제하면
 * 회의 녹음 전사가 조용히 멈춘다.
 */
export function withoutProviderKey(id: AiProviderId, meta: Record<string, unknown>): KeyRemoval {
  const spec = getProviderSpec(id)
  const next = { ...meta }
  delete next[spec.meta.apiKey]
  delete next[spec.meta.model]
  for (const companion of COMPANION_META_KEYS[id] ?? []) delete next[companion]
  return { meta: next, warning: describeKeyRemoval(id) }
}

/** 해제하면 무엇이 함께 멈추는가. 명세의 alsoUsedFor 에서 온다 */
export function describeKeyRemoval(id: AiProviderId): string | null {
  const spec = getProviderSpec(id)
  if (!spec.alsoUsedFor) return null
  return `${spec.alsoUsedFor}. 해제하면 그 기능도 함께 멈춥니다`
}

/** 저장된 키. 없으면 null (빈 문자열도 없는 것으로 본다) */
export function readProviderKey(id: AiProviderId, meta: Record<string, unknown>): string | null {
  const v = meta[getProviderSpec(id).meta.apiKey]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** 저장된 모델. 고르지 않았으면 명세의 기본값, 그것도 없으면 null */
export function readProviderModel(id: AiProviderId, meta: Record<string, unknown>): string | null {
  const spec = getProviderSpec(id)
  const v = meta[spec.meta.model]
  if (typeof v === 'string' && v.trim()) return v.trim()
  return spec.defaultModel
}

/** 저장 성공 문장. 가림값만 담는다 */
export function describeKeySaved(id: AiProviderId, raw: string): string {
  return `${getProviderSpec(id).label} 키를 저장했습니다 (${maskKey(raw)})`
}

/**
 * 목록을 받았다는 사실만 말하는 문장. **쓸 수 있다고 단정하지 않는다.**
 *
 * 실측 2026-10-01: 여기서 「120개 모델 사용 가능」이라고 적고 있었는데 그 계정은
 * 크레딧이 0원이라 어느 모델도 못 불렀다. 목록 받기(`models.list`)는 크레딧과 무관하게
 * 되기 때문이다. 같은 화면의 모델 선택 창은 「전부 사용 불가」라고 했고, 한 화면이
 * 두 말을 하니 사용자는 어느 쪽이 맞는지 알 수 없었다. 확인한 것만 말한다.
 */
export function describeConnectionOk(id: AiProviderId, modelCount: number): string {
  const spec = getProviderSpec(id)
  const tail = spec.alsoUsedFor ? ` (${spec.alsoUsedFor})` : ''
  return `연결 성공: 모델 목록 ${modelCount}개를 받았습니다${tail}`
}

/** 모델 하나를 실제로 불러 본 결과. 안 불러 봤으면 null */
export interface ConnectionProbe {
  /** 어느 모델로 불러 봤나 */
  model: string
  availability: ModelAvailability
  /** 왜 그 상태인지. 고정 문장만 들어온다 (공급자 원문 금지) */
  reason: string | null
}

export interface ConnectionCheck {
  modelCount: number
  probe: ConnectionProbe | null
}

/**
 * 연결 확인의 **판정과 문장**.
 *
 * 질문이 둘이다 — 「키가 공급자에 닿나」와 「그 키로 부를 수 있나」. 앞만 보고 성공이라
 * 적으면 크레딧이 떨어진 계정이 초록으로 보인다. 그래서 불러 본 결과가 있으면 그것이
 * 판정을 정하고, 목록 수는 함께 적되 판정을 대신하지 않는다.
 *
 * `unknown` 은 실패가 아니다. 모르는 것을 실패로 적으면 등급 제한 모델 하나나 일시 장애로
 * 멀쩡한 키가 빨개진다.
 */
export function describeConnection(id: AiProviderId, check: ConnectionCheck): { ok: boolean; message: string } {
  const spec = getProviderSpec(id)
  const tail = spec.alsoUsedFor ? ` (${spec.alsoUsedFor})` : ''
  const { modelCount, probe } = check

  if (!probe) return { ok: true, message: describeConnectionOk(id, modelCount) }

  if (probe.availability === 'available') {
    return { ok: true, message: `연결 성공: 모델 목록 ${modelCount}개를 받았고 ${probe.model} 호출도 됩니다${tail}` }
  }
  /*
    모델 이름 뒤에 조사를 붙이지 않는다 — `gpt-5.5` 같은 id 는 받침을 셀 수 없어
    「을(를)」이 나오거나 틀린 조사가 붙는다(lib/ui/josa). 문장을 그렇게 짓지 않는다.
  */
  const why = probe.reason ? ` ${probe.reason}` : ''
  if (probe.availability === 'unknown') {
    return { ok: true, message: `연결 성공: 모델 목록 ${modelCount}개를 받았습니다. ${probe.model} 호출 여부는 확인하지 못했습니다.${why}` }
  }
  return { ok: false, message: `모델 목록 ${modelCount}개는 받았지만 지금 ${probe.model} 호출이 안 됩니다.${why}` }
}

/**
 * 연결 확인 실패 문장.
 * 공급자가 돌려준 원문을 그대로 흘리지 않는다 — 거기에 키 조각이 섞여 오는 경우가 있다.
 */
export function describeConnectionFailed(id: AiProviderId, status?: number): string {
  const spec = getProviderSpec(id)
  if (status === 401 || status === 403) return `${spec.label} 키가 올바르지 않습니다`
  if (status === 429) return `${spec.label} 사용량 한도에 걸렸습니다`
  if (status) return `${spec.label} 연결 실패 (${status})`
  return `${spec.label} 연결에 실패했습니다`
}

/** 키를 아직 넣지 않은 공급자에게 하는 말 */
export function describeMissingKey(id: AiProviderId): string {
  return `저장된 ${getProviderSpec(id).label} 키가 없습니다`
}

/* ── 키가 여러 개일 때 ────────────────────────────────────────────
   키 하나였을 때의 규칙을 그대로 쓰면 두 자리가 틀린다.
   ① 하나를 지워도 그 공급자가 멈추는 것은 아니다 — 남은 키가 받는다
   ② 표를 고쳐도 META 를 그대로 두면 그 칸을 직접 읽는 마흔 자리가 옛 키로 돈다 */

/**
 * 이 줄을 지우면 무엇이 함께 멈추는가.
 *
 * **마지막 하나일 때만 말한다.** 둘 이상 남아 있는데 「회의 전사가 멈춘다」고 말하면
 * 그것은 거짓이고, 거짓 경고는 두 번째부터 아무도 안 읽는다.
 */
export function describeKeyRemovalAt(id: AiProviderId, remainingAfter: number): string | null {
  if (remainingAfter > 0) return null
  return describeKeyRemoval(id)
}

/**
 * 표를 고친 뒤 META 의 기존 키 칸을 어떻게 맞출 것인가.
 *
 * 그 칸을 직접 읽는 자리가 아직 마흔이다(마이그 264 머리주석). 표에서 첫 줄이 바뀌었는데
 * META 가 옛 값을 들고 있으면, 화면에서는 지운 키로 그 마흔이 계속 돈다 —
 * **화면과 동작이 갈라지는 자리**라 고칠 때마다 맞춘다. 줄이 하나도 없으면 칸을 비운다.
 */
export function metaAfterKeyChange(
  id: AiProviderId,
  firstKey: string | null,
  meta: Record<string, unknown>,
): Record<string, unknown> {
  if (firstKey) return withProviderKey(id, firstKey, meta)
  const next = { ...meta }
  delete next[getProviderSpec(id).meta.apiKey]
  return next
}

/** 새 줄에 붙일 이름. 사람이 안 적으면 순서로 짓는다 — 이름 없는 줄은 원장에서 못 가린다 */
export function defaultKeyLabel(existingLabels: readonly string[]): string {
  for (let n = 1; n <= existingLabels.length + 1; n++) {
    const candidate = n === 1 ? '기본' : `${n}번째`
    if (!existingLabels.includes(candidate)) return candidate
  }
  return `${existingLabels.length + 1}번째`
}

/** 이름 검증. 표에 (공급자, 이름) 유니크가 걸려 있어 겹치면 저장이 실패한다 */
export function validateKeyLabel(label: string, existingLabels: readonly string[]): KeyValidation {
  const t = (label ?? '').trim()
  if (!t) return { ok: false, error: '키 이름을 입력해주세요' }
  if (t.length > 40) return { ok: false, error: '키 이름은 40자까지 넣을 수 있습니다' }
  if (existingLabels.includes(t)) return { ok: false, error: `'${t}' 라는 이름이 이미 있습니다` }
  return { ok: true }
}
