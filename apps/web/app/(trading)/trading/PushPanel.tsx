'use client'

// 알림 받기 — **이 기기가 받고 있나**
//
// 실측 2026-09-27: 알림 대기 표·재시도·유일 키까지 다 있었는데 등록된 기기가 0이라
// 신호가 화면에만 남았다. 설계서 §7 의 하루 흐름은 전부 푸시를 전제로 그려져 있다.
//
// 못 켜는 이유를 흐린 단추로 말하지 않는다. 흐린 단추는 왜 못 누르는지를 안 말하고
// 사용자는 화면이 고장난 것으로 읽는다(NotifyPanel 과 같은 규율).

import { useState, useEffect, useTransition } from 'react'
import { BellRing, BellOff, KeyRound } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import {
  PUSH_PANEL_TITLE, PUSH_WHY, PUSH_ON_LABEL, PUSH_OFF_LABEL,
  PUSH_SUBSCRIBE_LABEL, PUSH_UNSUBSCRIBE_LABEL, PUSH_MAKE_KEY_LABEL,
  PUSH_BLOCK_LABEL, PUSH_BLOCK_REMEDY, type PushBlockReason,
} from '@/lib/trading/notify/push-labels'
import { registerPushDevice, unregisterPushDevice, createPushKey } from './actions'

interface Props {
  /** 서버가 준 공개 열쇠. 없으면 아직 안 만든 것이다 */
  publicKey: string | null
}

/**
 * base64url 공개키를 구독이 받는 바이트로.
 *
 * `ArrayBuffer` 로 돌려준다 — `Uint8Array` 를 그대로 넘기면 형이 `SharedArrayBuffer` 까지
 * 받는 꼴이라 `BufferSource` 에 안 맞는다.
 */
function keyBytes(base64Url: string): ArrayBuffer {
  const pad = base64Url.length % 4 === 0 ? '' : '='.repeat(4 - (base64Url.length % 4))
  const raw = atob(base64Url.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return buffer
}

export default function PushPanel({ publicKey }: Props) {
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<PushBlockReason | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(publicKey)
  const [pending, startTransition] = useTransition()

  // 이 기기가 이미 붙어 있나. 첫 렌더는 서버와 같은 모양이어야 해서 효과 안에서 본다
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.isSecureContext) { setBlocked('insecure_context'); return }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setBlocked('unsupported'); return }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? null))
      .catch(() => setEndpoint(null))
  }, [])

  function makeKey() {
    startTransition(async () => {
      const result = await createPushKey()
      setMessage(result.userMessage)
      if (result.publicKey) { setKey(result.publicKey); setBlocked(null) }
    })
  }

  function subscribe() {
    if (!key) { setBlocked('no_key'); return }
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') { setBlocked('permission_denied'); return }
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(key),
        })
        const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
        const result = await registerPushDevice({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
          label: navigator.userAgent.slice(0, 80),
        })
        setMessage(result.userMessage)
        if (result.ok) { setEndpoint(sub.endpoint); setBlocked(null) }
        else setBlocked('subscribe_failed')
      } catch {
        setBlocked('subscribe_failed')
      }
    })
  }

  function unsubscribe() {
    startTransition(async () => {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) { await sub.unsubscribe(); await unregisterPushDevice(sub.endpoint) }
      setEndpoint(null)
      setMessage('이 기기에서 알림을 껐습니다')
    })
  }

  const on = endpoint !== null

  return (
    <section className="card">
      <h2 style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
        margin: 0, marginBottom: 'var(--space-2)',
      }}>
        {on ? <BellRing size={16} /> : <BellOff size={16} />} {PUSH_PANEL_TITLE}
      </h2>

      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        {on ? PUSH_ON_LABEL : PUSH_OFF_LABEL}
      </p>
      {!on && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
          {PUSH_WHY}
        </p>
      )}

      {blocked && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--warning)', margin: 0 }}>
            {PUSH_BLOCK_LABEL[blocked]}
          </p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0 }}>
            {PUSH_BLOCK_REMEDY[blocked]}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        {!key && (
          <NbButton disabled={pending} onClick={makeKey}>
            <KeyRound size={14} /> {PUSH_MAKE_KEY_LABEL}
          </NbButton>
        )}
        {key && !on && (
          <NbButton disabled={pending} onClick={subscribe}>
            <BellRing size={14} /> {PUSH_SUBSCRIBE_LABEL}
          </NbButton>
        )}
        {on && (
          <NbButton variant="secondary" disabled={pending} onClick={unsubscribe}>
            <BellOff size={14} /> {PUSH_UNSUBSCRIBE_LABEL}
          </NbButton>
        )}
      </div>

      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginTop: 'var(--space-3)' }}>
          {message}
        </p>
      )}
    </section>
  )
}
