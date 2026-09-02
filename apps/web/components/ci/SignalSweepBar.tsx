'use client'

// components/ci/SignalSweepBar.tsx — 이슈 수집이 지금 어떤 상태인지 + 직접 돌리기
//
// 왜 필요한가(실측 2026-09-01): 수집이 사흘째 실패하는 동안 화면은 후보 0건만 보였다.
// 「아직 안 돌았다」·「돌았는데 없었다」·「돌다가 실패했다」가 전부 **같은 빈 화면**이라
// 사용자는 «변한 게 없다»고 읽었다. 실패는 화면에 나와야 정보가 된다(B-5).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { formatKstDateTimeShort, formatKstAgo } from '@/lib/datetime/kst'
import {
  signalSweepHeadline, signalSweepDetail, signalSweepStuckText, signalSweepEscalation,
  type SignalSweepState,
} from '@/lib/ci/analysis/signals'
import type { ApiResponse } from '@/lib/ci/contracts'
import styles from './signal-sweep-bar.module.css'

/** 웹 검색은 오래 걸린다. 서버 상한(80초)보다 길게 잡아 서버 답을 받을 기회를 준다. */
const SWEEP_TIMEOUT_MS = 90_000

export default function SignalSweepBar({
  workspaceId, state,
}: {
  workspaceId: string
  state: SignalSweepState
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function sweep() {
    setBusy(true); setMessage(null); setFailed(false)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), SWEEP_TIMEOUT_MS)
    try {
      const res = await fetch('/api/ci/signals/sweep', {
        method: 'POST',
        headers: { 'X-CI-Workspace': workspaceId },
        signal: ctl.signal,
      }).then((r) => r.json() as Promise<ApiResponse<{ found: number; inserted: number; note: string | null }>>)

      if (!res.success) {
        setFailed(true)
        setMessage(res.error.message)
        return
      }
      setMessage(res.data.inserted > 0
        ? `새 이슈 ${res.data.inserted}건 · 아래에서 확인해 주세요`
        : (res.data.note ?? '새로 담을 만한 이슈가 없었어요'))
      router.refresh()
    } catch (e) {
      setFailed(true)
      setMessage(e instanceof Error && e.name === 'AbortError'
        ? '응답 지연 · 잠시 후 다시 시도해 주세요'
        : '수집 실패 · 잠시 후 다시 시도해 주세요')
    } finally {
      clearTimeout(timer)
      setBusy(false)
    }
  }

  // 방금 실행한 결과가 있으면 그것이 가장 최신 사실이다 — 서버가 준 옛 상태보다 앞선다
  const headline = message ?? signalSweepHeadline(state)
  const detail = message ? null : signalSweepDetail(state)
  const stuck = message ? null : signalSweepStuckText(state)
  const escalation = message ? null : signalSweepEscalation(state)
  // 도는 중에는 실패 색을 쓰지 않는다 — 아직 결과가 없는데 빨간 글씨는 «실패했다»로 읽힌다
  const bad = !busy && (failed || (!message && (state.outcome === 'failed' || state.outcome === 'retrying')))

  return (
    <div className={`card ${styles.bar}`}>
      <div className={styles.text}>
        {/* 두괄식 — 상태·원인이 첫 줄에서 끝난다 */}
        <p className={bad ? styles.headlineDanger : styles.headline}>
          {busy ? '수집 중… 최대 90초' : headline}
        </p>

        {/* 숫자는 라벨로 — 읽지 않고 훑어도 들어오게 */}
        {!busy && (stuck || state.lastSweepAt || state.nextAttemptAt) && (
          <p className={styles.facts}>
            {stuck && <span className={styles.factStrong}>{stuck}</span>}
            {state.lastSweepAt && (
              <span>마지막 {formatKstDateTimeShort(state.lastSweepAt)} ({formatKstAgo(state.lastSweepAt)})</span>
            )}
            {state.nextAttemptAt && <span>다음 {formatKstDateTimeShort(state.nextAttemptAt)}</span>}
          </p>
        )}

        {!busy && escalation && <p className={styles.detail}>{escalation}</p>}
        {!busy && detail && <p className={styles.detail}>{detail}</p>}
      </div>

      <NbButton variant="ghost" onClick={sweep} disabled={busy}>
        <RefreshCw size={14} aria-hidden />
        {busy ? '수집 중…' : '지금 수집'}
      </NbButton>
    </div>
  )
}
