'use client'

// Google Drive 연동 카드.
//
// 왜 이 모양인가: 예전에는 이 카드만 진입할 때마다 `/api/auth/google-drive/status`를 불러
// "연결 상태 확인 중…"을 띄웠다. 옆의 YouTube·수출입은행 카드는 서버 렌더로 상태를 받고
// [테스트]를 눌러야 외부를 호출한다 — 같은 종류 카드인데 동작이 갈렸다(§2-5 위반).
// 이제 셋 다 같다: **상태는 서버 렌더 · 외부 호출은 버튼을 눌렀을 때만.**

import { useState, useTransition } from 'react'
import { Cloud } from 'lucide-react'
import { checkGoogleDriveHealth } from './actions'
import { IntegrationCard, IntegrationStatus, IntegrationTest } from './integration-ui'
import { currentReturnTo, withReturnTo } from '@/lib/nav/return-to'

/** 콜백이 `?drive=` 로 알려주는 결과. 표시하지 않으면 실패가 조용히 묻힌다 */
const OUTCOME: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Google Drive가 연결되었습니다' },
  cancelled: { ok: false, text: '연결을 취소했습니다' },
}
const FAIL_REASON: Record<string, string> = {
  token_exchange: '인증 코드 교환에 실패했습니다 — 다시 시도해주세요',
  missing_tokens: '갱신 토큰을 받지 못했습니다 — Google 계정 연결을 해제한 뒤 다시 연결해주세요',
  save_failed: '토큰 저장에 실패했습니다 — 잠시 후 다시 시도해주세요',
}

interface Props {
  /** 서버에서 읽은 연결 여부 (getDriveConnectionStatus) */
  connected: boolean
  /** 연결된 Google 계정 이메일 */
  email: string | null
  /** 콜백 결과 (`?drive=`) */
  outcome?: string
  /** 실패 사유 (`?reason=`) */
  reason?: string
}

export default function GoogleDriveSettings({
  connected: initialConnected,
  email: initialEmail,
  outcome,
  reason,
}: Props) {
  const [connected, setConnected] = useState(initialConnected)
  const [email, setEmail] = useState(initialEmail)
  const [revoking, setRevoking] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    // 콜백이 돌려준 결과를 첫 렌더에 그대로 보여준다.
    // 예전엔 `?drive=error&reason=…`가 붙어도 화면에 아무것도 안 나왔다.
    outcome === 'error'
      ? { ok: false, text: FAIL_REASON[reason ?? ''] ?? '연결에 실패했습니다' }
      : (OUTCOME[outcome ?? ''] ?? null),
  )

  const [healthPending, startHealth] = useTransition()
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const r = await checkGoogleDriveHealth()
      setHealthMsg({ ok: r.ok, text: r.message })
    })
  }

  async function handleRevoke() {
    setMsg(null)
    setHealthMsg(null)
    setRevoking(true)
    try {
      const res = await fetch('/api/auth/google-drive/revoke', { method: 'POST' })
      if (res.ok) {
        setConnected(false)
        setEmail(null)
        setMsg({ ok: true, text: 'Google Drive 연결이 해제되었습니다' })
      } else {
        const d = await res.json() as { error?: string }
        setMsg({ ok: false, text: d.error ?? '연결 해제 실패' })
      }
    } catch {
      setMsg({ ok: false, text: '네트워크 오류가 발생했습니다' })
    } finally {
      setRevoking(false)
    }
  }

  function handleConnect() {
    // 떠나온 화면(탭 쿼리 포함)을 실어 보낸다 — 동의를 마치면 여기로 돌아온다.
    // 하드코딩하면 `?tab=integrations`가 날아가 엉뚱한 탭이 열린다(§복귀 경로 SSOT).
    window.location.href = withReturnTo('/api/auth/google-drive', currentReturnTo())
  }

  return (
    <IntegrationCard
      icon={<Cloud size={16} />}
      title="Google Drive 연동"
      desc="자료 원본을 서비스 서버가 아닌 회사 드라이브에 보관합니다. 담당자 명함 이미지도 여기에 저장됩니다."
    >
      <IntegrationStatus
        value={connected ? (email ?? '연결된 계정') : null}
        emptyHint="자료 원본을 드라이브에 저장할 수 없습니다"
        onChange={handleConnect}
        onDisconnect={connected ? handleRevoke : undefined}
        disconnectPending={revoking}
        connectAction={{ label: 'Google 계정 연결', onClick: handleConnect }}
      />

      {msg && (
        <p className={`ci-status ${msg.ok ? 'ci-status-ok' : 'ci-status-danger'}`} role="status">
          {msg.text}
        </p>
      )}

      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="Google Drive 연결과 토큰 유효성을 확인합니다"
      />
    </IntegrationCard>
  )
}
