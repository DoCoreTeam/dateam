'use client'

// 연동 카드 (dacrm T1-10, §3.5-6)
//
// 이 카드가 반드시 해야 하는 한 가지: **연결이 끊긴 걸 사용자가 알게 하는 것.**
// 토큰은 조용히 만료된다. 그때 화면이 아무 말도 안 하면 사용자는
// "요즘 메일이 안 들어오네"를 몇 주 뒤에 눈치챈다 — 그 사이 기록이 통째로 빈다.
//
// 구성은 §2-5(3)의 넷을 따른다: 연결 상태 · 변경 · 연결 해제 · 연결 테스트.
//
// 연결은 **호스트에 이미 있는 Google 클라이언트**를 그대로 쓴다(`GOOGLE_CLIENT_ID`).
// 한동안 "관리자가 클라이언트를 등록하면 버튼이 나타납니다"라고 써 뒀었는데,
// 확인해 보니 클라이언트는 처음부터 있었고 Drive 연동이 그것으로 돌고 있었다 —
// 없던 것은 클라이언트가 아니라 **CRM 이 그걸 쓰는 배선**이었다.

import { useCallback, useEffect, useState } from 'react'
import { withReturnTo, currentReturnTo } from '@/lib/nav/return-to'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import type { StatusKey } from '@/lib/tokens/status-colors'
import styles from './settings.module.css'

interface Connection {
  id: string
  provider: string
  memberId: string
  status: string
  gmailHistoryId: string | null
  updatedAt: string
}

/** 상태를 사람 말로 — 'error' 를 그대로 보여 주면 무엇을 하란 뜻인지 모른다 */
const STATUS: Record<string, { label: string; status: StatusKey }> = {
  active: { label: '연결됨', status: 'done' },
  error: { label: '다시 연결 필요', status: 'blocker' },
  revoked: { label: '연결 해제됨', status: 'note' },
}

export default function IntegrationCard() {
  const [items, setItems] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/integrations')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '연동 상태를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('연동 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /**
   * 콜백이 `?google=connected|error` 를 붙여 돌려보낸다.
   * 이걸 화면이 읽지 않으면 연결에 실패해도 아무 말이 없다 —
   * Drive 연동에서 실제로 그랬고(v0.7.438), 같은 사고를 되풀이하지 않는다.
   */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('google')
    if (p === 'connected') setNotice('구글 계정이 연결되었습니다. 이제 메일이 자동으로 들어옵니다.')
    if (p === 'error') setError('구글 연결에 실패했습니다. 다시 시도해 주세요.')
    if (p === 'cancelled') setNotice('연결을 취소했습니다.')
  }, [])

  async function disconnect(id: string) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/integrations?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '연결을 해제하지 못했습니다.'); return }
      await load()
    } catch {
      setError('연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  const broken = items.filter((c) => c.status === 'error')

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>메일·일정 연동</h2>
        {/* 떠났다 돌아올 자리를 함께 실어 보낸다 — 동의를 마치면 이 카드로 돌아온다(복귀 경로 SSOT) */}
        <NbButton onClick={() => { window.location.href = withReturnTo('/api/auth/google-drive?purpose=crm', currentReturnTo()) }}>
          {items.length > 0 ? '다시 연결' : '구글 계정 연결'}
        </NbButton>
      </div>

      <FormErrorBanner message={error} />
      {notice && <p className={styles.undo}>{notice}</p>}

      {/* 끊긴 연결은 카드 맨 위에서 말한다 — 목록 아래에 묻히면 못 본다 */}
      {broken.length > 0 && (
        <p className={styles.blocked}>
          연결이 끊겨 {broken.length}개 계정의 메일이 들어오지 않고 있어요. 다시 연결해 주세요.
        </p>
      )}

      {loading && items.length === 0 ? (
        <AXDotLoader />
      ) : items.length === 0 ? (
        <EmptyState
          title="아직 연결된 계정이 없어요"
          description="구글 계정을 연결하면 주고받은 메일이 자동으로 인물·딜에 붙습니다. 우리 인물 명부에 있는 사람과 주고받은 것만 저장합니다."
        />
      ) : (
        <ul className={styles.conns}>
          {items.map((c) => {
            const meta = STATUS[c.status] ?? { label: c.status, status: 'note' as StatusKey }
            return (
              <li key={c.id} className={styles.conn}>
                <span className={styles.connName}>{c.provider === 'google' ? '구글' : c.provider}</span>
                <NbBadge status={meta.status}>{meta.label}</NbBadge>
                <NbButton variant="ghost" disabled={busy === c.id} onClick={() => void disconnect(c.id)}>
                  {busy === c.id ? '해제 중…' : '연결 해제'}
                </NbButton>
              </li>
            )
          })}
        </ul>
      )}

      <p className={styles.hint}>
        연결을 해제해도 이미 담긴 메일 기록은 남습니다. 우리 인물 명부에 있는 사람과 주고받은 메일만 저장합니다.
      </p>
    </div>
  )
}
