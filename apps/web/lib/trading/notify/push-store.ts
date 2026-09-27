import 'server-only'

/**
 * 알림 받을 기기와 발송 열쇠 — **비밀은 봉투 안에서만 산다** (마이그 290)
 *
 * ## 왜 이 자리가 필요했나
 *
 * 알림 대기 표는 282 에서 만들었고 정책·재시도·유일 키까지 다 있었는데 **보낼 곳이
 * 없었다.** `flushNotifications` 가 행을 `sent` 로 적기만 하고 밖으로 나가는 호출이
 * 0건이었다. 설계서 §7 의 하루 흐름은 전부 휴대폰 푸시를 전제로 그려져 있다.
 *
 * ## 규율 셋
 *
 *   ① 비밀키는 **평문으로 안 나간다.** 화면 쪽 함수는 「있나 없나」와 공개키만 돌려준다(S3)
 *   ② 열쇠는 env 가 아니라 표에 있다. 새 환경변수를 안 만든다(LOOP.md 부록)
 *   ③ 기기 주소(`endpoint`)가 유일 키다. 같은 기기가 두 줄이면 알림이 두 번 간다(M9)
 */

import { generateKeyPairSync, createPublicKey, createPrivateKey } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { sealTradingSecret, openTradingSecret, canSealTradingSecret } from '../broker/crypto.ts'
import { toBase64Url, rawPublicKeyFromSpki } from './push-core.ts'

/** 발송 열쇠는 한 벌이다. 두 벌이면 어느 키로 받은 구독인지 못 가린다 */
const KEY_ROW_ID = 'default'

export interface PushSubscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  label: string | null
  failureCount: number
}

/** 화면이 보는 열쇠 상태. **비밀키 자리가 없다** — 형에 자리가 있으면 언젠가 채워진다 */
export interface PushKeyStatus {
  configured: boolean
  /** 브라우저가 구독할 때 그대로 쓰는 값. 이름 그대로 공개다 */
  publicKey: string | null
  subject: string | null
}

/** 서버만 쓰는 한 벌. 이 형은 `server-only` 모듈 밖으로 안 나간다 */
export interface VapidKeyPair {
  publicKey: string
  privateKeyPem: string
  subject: string
}

/* ── 구독 ──────────────────────────────────────────────── */

export interface SaveSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userId: string | null
  label: string | null
}

export type SaveSubscriptionResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: string; userMessage: string }

/**
 * 기기를 등록한다. 같은 주소가 또 오면 **덮어쓴다** —
 * 브라우저가 열쇠를 갱신하면 주소는 같고 `p256dh` 만 바뀌는 일이 있다.
 */
export async function saveSubscription(input: SaveSubscriptionInput): Promise<SaveSubscriptionResult> {
  const endpoint = input.endpoint.trim()
  if (endpoint === '' || input.p256dh.trim() === '' || input.auth.trim() === '') {
    return { ok: false, reason: 'incomplete_subscription', userMessage: '기기 등록 정보가 모자랍니다' }
  }
  // 바깥에서 온 주소다. https 만 받는다 — http 주소를 그대로 부르면 본문이 평문으로 간다(S4)
  let parsed: URL
  try { parsed = new URL(endpoint) } catch { 
    return { ok: false, reason: 'bad_endpoint', userMessage: '기기 주소를 읽지 못했습니다' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'insecure_endpoint', userMessage: '안전하지 않은 기기 주소입니다' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: before } = await admin
    .from('trading_push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle()

  const { error } = await admin.from('trading_push_subscriptions').upsert({
    endpoint,
    p256dh: input.p256dh.trim(),
    auth: input.auth.trim(),
    user_id: input.userId,
    label: input.label,
    // 다시 등록했으면 지난 실패는 이 기기의 사실이 아니다
    failure_count: 0,
    last_error: null,
  }, { onConflict: 'endpoint' })
  if (error) return { ok: false, reason: `save_failed:${error.message}`, userMessage: '기기를 등록하지 못했습니다' }
  return { ok: true, created: !before }
}

export async function listSubscriptions(): Promise<PushSubscription[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_push_subscriptions')
    .select('id, endpoint, p256dh, auth, label, failure_count')
    .order('created_at', { ascending: true })
  // 못 읽으면 던진다. 빈 배열로 돌려주면 「보낼 기기가 없다」와 「못 읽었다」가 같아진다
  if (error) throw new Error(`구독 목록을 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth,
    label: r.label ?? null, failureCount: Number(r.failure_count ?? 0),
  }))
}

/** 죽은 기기를 지운다. 404·410 은 「이 주소는 이제 없다」라는 뜻이라 재시도가 무의미하다 */
export async function deleteSubscription(endpoint: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  await admin.from('trading_push_subscriptions').delete().eq('endpoint', endpoint)
}

export async function recordSubscriptionOutcome(
  endpoint: string,
  outcome: { ok: true } | { ok: false; error: string },
  now: Date,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  if (outcome.ok) {
    await admin.from('trading_push_subscriptions')
      .update({ last_sent_at: now.toISOString(), failure_count: 0, last_error: null })
      .eq('endpoint', endpoint)
    return
  }
  const { data } = await admin
    .from('trading_push_subscriptions').select('failure_count').eq('endpoint', endpoint).maybeSingle()
  await admin.from('trading_push_subscriptions')
    .update({ failure_count: Number(data?.failure_count ?? 0) + 1, last_error: outcome.error.slice(0, 300) })
    .eq('endpoint', endpoint)
}

/* ── 발송 열쇠 ─────────────────────────────────────────── */

/**
 * 화면이 묻는 것. **비밀키를 안 돌려준다.**
 *
 * 못 읽어도 던지지 않는다 — 열쇠 한 줄 때문에 현황이 죽으면 안 되고,
 * 그때는 「없다」가 아니라 모르는 것이다. 그래서 사유를 함께 준다.
 */
export async function pushKeyStatus(): Promise<PushKeyStatus> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('trading_push_keys').select('public_key, subject').eq('id', KEY_ROW_ID).maybeSingle()
  if (!data?.public_key) return { configured: false, publicKey: null, subject: null }
  return { configured: true, publicKey: data.public_key, subject: data.subject ?? null }
}

/**
 * 서버가 쓰는 한 벌. 없으면 null 이다 — 지어내지 않는다.
 *
 * 이 함수의 반환값은 **`server-only` 모듈 안에서만** 돌아다닌다.
 */
export async function loadVapidKeys(): Promise<VapidKeyPair | null> {
  if (!canSealTradingSecret()) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('trading_push_keys').select('public_key, private_key_enc, subject').eq('id', KEY_ROW_ID).maybeSingle()
  if (!data?.public_key || !data?.private_key_enc) return null
  return {
    publicKey: data.public_key,
    privateKeyPem: openTradingSecret(data.private_key_enc),
    subject: data.subject ?? 'mailto:admin@example.com',
  }
}

export type EnsureKeysResult =
  | { ok: true; created: boolean; publicKey: string }
  | { ok: false; reason: string; userMessage: string }

/**
 * 열쇠가 없으면 만든다. **있으면 절대 안 바꾼다** —
 * 키를 갈면 이미 등록된 기기가 전부 조용히 안 받게 된다.
 */
export async function ensureVapidKeys(subject: string): Promise<EnsureKeysResult> {
  if (!canSealTradingSecret()) {
    return {
      ok: false, reason: 'encryption_unavailable',
      userMessage: '암호화 키가 설정되지 않아 알림 열쇠를 만들 수 없습니다',
    }
  }
  const existing = await pushKeyStatus()
  if (existing.configured && existing.publicKey) {
    return { ok: true, created: false, publicKey: existing.publicKey }
  }

  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const raw = publicKey.export({ format: 'der', type: 'spki' })
  const publicKeyB64 = toBase64Url(rawPublicKeyFromSpki(Buffer.from(raw)))
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_push_keys').upsert({
    id: KEY_ROW_ID,
    public_key: publicKeyB64,
    private_key_enc: sealTradingSecret(privateKeyPem),
    subject,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (error) {
    return { ok: false, reason: `key_save_failed:${error.message}`, userMessage: '알림 열쇠를 저장하지 못했습니다' }
  }
  return { ok: true, created: true, publicKey: publicKeyB64 }
}

/** PEM 을 서명에 쓸 수 있는 꼴로. 여기서만 비밀키를 만진다 */
export function privateKeyFrom(pem: string) {
  return createPrivateKey(pem)
}

export function publicKeyFrom(pem: string) {
  return createPublicKey(pem)
}
