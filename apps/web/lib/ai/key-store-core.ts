// lib/ai/key-store-core.ts — 표에서 키를 꺼내 오고 호출 결말을 표에 적는 규칙
//
// 왜 server-only 가 아닌가
//   `node --test` 는 `server-only` 를 못 읽는다. 그 패키지는 설치돼 있지 않고 Next 가
//   빌드할 때 별칭으로 붙이는 것이라, 그 줄이 있는 파일은 시험이 아예 불러올 수 없다.
//   그래서 서비스롤을 만드는 자리만 `key-store.ts` 에 두고 규칙은 여기 둔다
//   (저장소 전례: `lib/org-scope.ts` 와 `lib/org-scope-pure.ts`).
//
// 여기는 Supabase 를 모른다
//   표를 읽고 쓰는 일은 `KeyStoreGateway` 세 함수로 주입받는다. 그래야
//   「표를 못 읽을 때 무엇을 하나」 같은 판단을 DB 없이 실제로 실행해 볼 수 있다.
//   고르는 순서 자체는 `key-pool.ts` 가 SSOT 이고 여기서 다시 정하지 않는다.

import {
  orderKeys,
  nextKeyState,
  maskApiKey,
  isCooling,
  type KeyPoolEntry,
  type KeyOutcome,
  type KeyStatePatch,
  type KeyDisabledReason,
} from './key-pool.ts'
import { getProviderSpec, type AiProviderId } from './provider-catalog.ts'
// 말은 용어집에서 온다. 규칙이 말을 가지면 두 번째 화면이 자기 것을 또 적는다
import { AI_KEY_STATUS, type AiKeyStatusKey } from '../terms/ai-key.ts'

/** `ai_provider_keys` 한 줄. 칼럼 이름 그대로 받는다 — 옮겨 적는 자리를 하나로 모으려고 */
export interface KeyRow {
  id: string
  provider: string
  label: string
  api_key: string
  priority: number
  is_active: boolean
  cooldown_until: string | null
  disabled_reason: string | null
  consecutive_failures: number
  /** 결제가 붙은 키인가(마이그 269). 참이면 무료 키를 다 쓴 뒤에만 부른다 */
  is_paid: boolean
}

/**
 * 저장소가 바깥과 닿는 세 자리. 시험에서 갈아 끼운다.
 *
 * 셋 다 **던져도 된다.** 던지는 것을 여기서 받아 삼키는 것이 이 모듈의 일이다 —
 * 키 저장소가 고장 났다고 AI 기능이 멈추면, 고친 것보다 망가뜨린 것이 크다.
 */
export interface KeyStoreGateway {
  readRows(provider: AiProviderId): Promise<KeyRow[]>
  /** org_content 의 META 한 줄. 표가 비었을 때 떨어질 자리 */
  readMeta(): Promise<Record<string, unknown>>
  writeState(id: string, patch: KeyStatePatch): Promise<void>
}

/**
 * 표에 줄이 없을 때 META 의 기존 키로 만든 임시 줄의 id 앞머리.
 *
 * **표에 없는 줄이므로 상태를 적을 데가 없다.** 적으려 들면 없는 id 로 UPDATE 가 나가
 * 조용히 0행을 고치고, 부르는 쪽은 적혔다고 믿는다. 그래서 여기서 갈라 본다.
 */
export const META_ENTRY_PREFIX = 'meta:'

/** META 로 떨어진 줄인가 */
export function isMetaEntry(entry: KeyPoolEntry): boolean {
  return entry.id.startsWith(META_ENTRY_PREFIX)
}

function asDisabledReason(v: string | null): KeyDisabledReason | null {
  return v === 'quota' || v === 'auth' ? v : null
}

/** 표 한 줄을 고르는 규칙이 아는 모양으로 */
export function rowToEntry(row: KeyRow, provider: AiProviderId): KeyPoolEntry {
  return {
    id: row.id,
    provider,
    label: row.label,
    apiKey: row.api_key,
    priority: row.priority,
    // 옛 판에서 온 줄에는 이 칸이 없을 수 있다. 없으면 무료로 본다 — 모르는 키로 결제하지 않는다
    isPaid: row.is_paid === true,
    isActive: row.is_active,
    cooldownUntil: row.cooldown_until,
    disabledReason: asDisabledReason(row.disabled_reason),
    consecutiveFailures: row.consecutive_failures,
  }
}

/**
 * META 에 있던 키 하나로 만든 줄.
 *
 * 이 자리가 있어야 표가 아직 없거나 못 읽는 상황에서도 **지금과 똑같이** 돈다.
 * 마이그레이션이 안 돌아간 환경, 표 권한이 잘못된 환경, 읽기가 한 번 튄 순간이 전부 여기로 온다.
 */
export function metaEntry(provider: AiProviderId, apiKey: string): KeyPoolEntry {
  return {
    id: `${META_ENTRY_PREFIX}${provider}`,
    provider,
    label: '기본',
    apiKey,
    priority: 0,
    // META 칸에는 유료 표시를 둘 자리가 없다. 하나뿐인 키를 안 쓸 수는 없으므로 무료로 본다
    isPaid: false,
    isActive: true,
    cooldownUntil: null,
    disabledReason: null,
    consecutiveFailures: 0,
  }
}

/** META 에서 이 공급자의 키 한 개. 없으면 null */
export function metaApiKey(
  meta: Record<string, unknown>,
  provider: AiProviderId,
): string | null {
  const v = meta[getProviderSpec(provider).meta.apiKey]
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * 시도할 키를 순서대로.
 *
 * 1 표를 읽는다. 읽다 던지면 삼키고 빈 것으로 본다 — **예외를 위로 올리지 않는다**
 * 2 줄이 하나도 없으면 META 의 기존 키 하나로 떨어진다
 * 3 순서는 `key-pool.orderKeys` 가 정한다 (쉬는 키 제외, 전부 쉬면 가장 빨리 풀리는 하나)
 *
 * 돌려주는 줄에는 **원문 키가 들어 있다.** 부르는 쪽이 그걸로 공급자를 부른다.
 * 그래서 이 값은 화면이나 원장으로 그대로 나가면 안 되고, 나가는 것은 `label` 과 가림값이다.
 */
export async function readKeyPoolWith(
  gateway: KeyStoreGateway,
  provider: AiProviderId,
  now: number,
): Promise<KeyPoolEntry[]> {
  let rows: KeyRow[] = []
  try {
    rows = (await gateway.readRows(provider)) ?? []
  } catch (e) {
    console.error('[ai/key-store] 키 표를 읽지 못했다, META 로 떨어진다', provider, describe(e))
    rows = []
  }

  if (rows.length > 0) return orderKeys(rows.map((r) => rowToEntry(r, provider)), now)

  try {
    const fallback = metaApiKey(await gateway.readMeta(), provider)
    return fallback ? [metaEntry(provider, fallback)] : []
  } catch (e) {
    console.error('[ai/key-store] META 도 읽지 못했다', provider, describe(e))
    return []
  }
}

/**
 * 호출이 어떻게 끝났는지를 표에 적는다.
 *
 * **적다 실패해도 부르는 쪽은 그대로 간다.** 기록은 다음 호출을 낫게 하는 장치이지
 * 이번 호출의 조건이 아니다 (마이그 146 의 `fn_audit` 와 같은 규율).
 */
export async function recordKeyOutcomeWith(
  gateway: KeyStoreGateway,
  entry: KeyPoolEntry,
  outcome: KeyOutcome,
  now: number,
  errorMessage?: string,
): Promise<void> {
  // 표에 없는 줄이라 적을 데가 없다. 없는 id 로 UPDATE 를 보내 0행을 고치지 않는다
  if (isMetaEntry(entry)) return

  try {
    // 표에 남는 문구도 지우고 넣는다 — last_error 는 관리자 화면에 그대로 뜬다
    const safe = errorMessage === undefined ? undefined : redactSecrets(errorMessage)
    await gateway.writeState(entry.id, nextKeyState(entry, outcome, now, safe))
  } catch (e) {
    // 키 이름과 가림값까지만. 원문은 어느 로그에도 안 남는다
    console.error('[ai/key-store] 상태 기록 실패', entry.label, maskApiKey(entry.apiKey), describe(e))
  }
}

/**
 * 키처럼 생긴 토막을 가림값으로 바꾼다.
 *
 * **실측으로 잡힌 자리다**(이 항목의 시험이 처음 잡았다). 공급자와 DB 가 돌려주는 오류 문구에
 * 키가 통째로 섞여 온다 — `invalid key AIza...` 같은 모양이다. 그걸 그대로 로그와
 * `last_error` 에 넣으면, 표를 잠가 둔 의미가 로그 한 줄에서 사라진다.
 *
 * 공백 없이 20자 넘게 이어지는 토막을 키로 본다. 다섯 공급자의 키가 전부 그 모양이고
 * (`AIza…` · `sk-ant-…` · `sk-…` · `gsk_…` · `xai-…`), 사람이 쓰는 말은 그렇게 안 이어진다.
 */
const SECRET_LIKE = /[A-Za-z0-9_-]{20,}/g

export function redactSecrets(text: string): string {
  return text.replace(SECRET_LIKE, (token) => maskApiKey(token))
}

/* ── 화면에 보이는 줄 ──────────────────────────────────────────────
   고르는 목록(`readKeyPool`)과 **보는 목록**은 다른 질문이다. 고를 때는 못 쓰는 줄을 빼야 하고,
   볼 때는 그 줄이 왜 못 쓰는지가 바로 그 화면의 용건이다. 빼 버리면 관리자는
   「내가 넣은 키가 사라졌다」고 읽는다. */

/** 한 줄이 지금 어떤 상태인가. 넷 중 하나로만 정해진다 (말은 용어집 AI_KEY_STATUS) */
export type KeyViewStatus = AiKeyStatusKey

export interface KeyView {
  id: string
  label: string
  /** 원문 키는 여기 없다. 화면과 원장에는 이것만 나간다 */
  maskedKey: string
  priority: number
  status: KeyViewStatus
  /** 사람이 읽을 한 줄. 같은 상태가 화면마다 다른 말이 되지 않게 여기서 만든다 */
  statusText: string
  /** 쉬는 중이면 언제 풀리는지. 아니면 null */
  cooldownUntil: string | null
  lastError: string | null
}

/** 상태 판정. 순서가 규칙이다 — 사람이 끈 것이 먼저고, 그다음이 고칠 것, 마지막이 기다릴 것 */
export function keyViewStatus(entry: KeyPoolEntry, now: number): KeyViewStatus {
  if (!entry.isActive && entry.disabledReason !== 'auth') return 'off'
  if (entry.disabledReason === 'auth') return 'auth_broken'
  if (isCooling(entry, now)) return 'cooling'
  return 'usable'
}


/** 화면이 쓸 줄 하나. **원문 키를 담지 않는다** */
export function toKeyView(entry: KeyPoolEntry, now: number, lastError: string | null = null): KeyView {
  const status = keyViewStatus(entry, now)
  return {
    id: entry.id,
    label: entry.label,
    maskedKey: maskApiKey(entry.apiKey),
    priority: entry.priority,
    status,
    statusText: AI_KEY_STATUS[status],
    cooldownUntil: status === 'cooling' ? entry.cooldownUntil : null,
    lastError,
  }
}

/**
 * 줄 순서를 한 칸 옮긴 뒤의 우선순위표.
 *
 * 화면은 「위로」 「아래로」만 누르고, 어떤 숫자가 되는지는 여기서 정한다 —
 * 화면이 숫자를 직접 만들면 줄이 셋만 넘어가도 같은 값이 겹치고, 그러면 순서가 흔들린다.
 * 돌려주는 것은 **바뀐 줄만** 이다(안 바뀐 줄에 쓸 이유가 없다).
 */
export function reorderPriorities(
  ids: readonly string[],
  moveId: string,
  direction: 'up' | 'down',
): { id: string; priority: number }[] {
  const at = ids.indexOf(moveId)
  if (at < 0) return []
  const to = direction === 'up' ? at - 1 : at + 1
  if (to < 0 || to >= ids.length) return []   // 끝에서 더 밀지 않는다

  const next = [...ids]
  next[at] = ids[to]
  next[to] = ids[at]
  return [
    { id: next[Math.min(at, to)], priority: Math.min(at, to) },
    { id: next[Math.max(at, to)], priority: Math.max(at, to) },
  ]
}

/** 오류를 문자열 한 줄로. 객체를 통째로 찍으면 그 안에 키가 섞여 나올 수 있다 */
function describe(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  return redactSecrets(raw).slice(0, MAX_LOG_LEN)
}

/** 로그 한 줄의 상한. 길면 뒤에 무엇이 붙어 있는지 아무도 안 본다 */
const MAX_LOG_LEN = 200
