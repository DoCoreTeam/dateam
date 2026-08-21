'use client'

// 회의 녹음 패널 (통합 기획 §5·§6)
//
// 타이밍 계약(D7): **전사는 자동, AI 분석은 버튼.**
// 녹음이 끝나면 전사가 알아서 돌고, 전사가 끝나면 사용자가 [AI로 정리하기]를 누른다.
// 분석을 자동으로 안 하는 이유 셋 — ① 사용자가 전사를 먼저 고칠 수 있어야 결과가 맞다
// ② 전사는 길어 비용이 크다 ③ 지시.

import { useCallback, useEffect, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import InlineError from '@/components/ui/InlineError'
import EmptyState from '@/components/ui/EmptyState'
import { useMeetingRecorder } from '@/lib/meeting/use-recorder'
import styles from './recording-panel.module.css'

interface ServerProgress {
  total: number
  transcribed: number
  failed: number
  done: boolean
  label: string
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function RecordingPanel({ noteId }: { noteId: string }) {
  const [progress, setProgress] = useState<ServerProgress | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/recordings`)
      if (!res.ok) return
      const body = await res.json()
      setProgress(body.progress ?? null)
    } catch { /* 진행 표시가 잠깐 안 와도 녹음은 계속된다 */ }
  }, [noteId])

  useEffect(() => { void refresh() }, [refresh])

  const uploadPart = useCallback(async (blob: Blob, partIdx: number, durationSec: number) => {
    const form = new FormData()
    form.append('audio', blob, `part-${partIdx}.webm`)
    form.append('partIdx', String(partIdx))
    form.append('durationSec', String(durationSec))
    const res = await fetch(`/api/meeting-notes/${noteId}/recordings`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? '녹음을 올리지 못했어요')
    }
    const body = await res.json()
    setProgress(body.progress ?? null)
  }, [noteId])

  const rec = useMeetingRecorder({ onPart: uploadPart })

  // 전사는 서버가 돌린다. 녹음이 끝난 뒤에도 잠깐 더 지켜본다 —
  // "끝났는데 화면이 그대로"가 이 흐름에서 가장 흔한 오해다.
  useEffect(() => {
    if (rec.state === 'recording' || rec.state === 'stopping' || (progress && !progress.done && progress.total > 0)) {
      const t = setInterval(() => { void refresh() }, 5000)
      return () => clearInterval(t)
    }
    return undefined
  }, [rec.state, progress, refresh])

  // 못 쓰는 환경에서는 버튼을 그리지 않는다. 대신 왜 안 되는지와 대안을 말한다 —
  // 눌리지 않는 버튼을 보여 주는 것이 아무것도 안 보여 주는 것보다 나쁘다.
  if (!rec.supported) {
    return (
      <EmptyState
        title="이 브라우저에서는 녹음을 쓸 수 없어요"
        description="회의 내용을 직접 적거나 붙여넣어 주세요. 요약과 할 일 뽑기는 그대로 됩니다."
        icon={<Mic size={28} />}
      />
    )
  }

  const recording = rec.state === 'recording'
  const uploading = rec.parts.some((p) => p.state === 'uploading')
  const failedParts = rec.parts.filter((p) => p.state === 'failed')

  return (
    <div className={styles.panel}>
      {rec.error && <InlineError spaced>{rec.error}</InlineError>}
      {serverError && <InlineError spaced onDismiss={() => setServerError(null)}>{serverError}</InlineError>}

      {!recording && rec.state !== 'stopping' ? (
        <div className={styles.idle}>
          <NbButton onClick={() => void rec.start()} disabled={rec.state === 'requesting'}>
            <Mic size={16} /> {rec.state === 'requesting' ? '마이크 여는 중…' : '녹음 시작'}
          </NbButton>
          <span className={styles.hint}>
            10분마다 자동으로 저장돼요. 녹음이 끝나면 전사는 알아서 시작됩니다.
          </span>
        </div>
      ) : (
        <div className={styles.live}>
          <div className={styles.timerRow}>
            <span className={styles.dot} aria-hidden />
            <strong className={styles.timer}>{mmss(rec.elapsedSec)}</strong>
            {/* 레벨 미터 — 마이크가 소리를 받고 있는지 보여 주는 유일한 수단 */}
            <span
              className={styles.meter}
              role="img"
              aria-label={`마이크 입력 세기 ${Math.round(rec.level * 100)}%`}
            >
              <span className={styles.meterFill} style={{ width: `${Math.round(rec.level * 100)}%` }} />
            </span>
          </div>

          <NbButton variant="danger" onClick={() => void rec.stop()} disabled={rec.state === 'stopping'}>
            <Square size={16} /> {rec.state === 'stopping' ? '마무리 중…' : '종료하고 정리'}
          </NbButton>

          {rec.level < 0.02 && rec.elapsedSec > 8 && (
            <p className={styles.warn}>
              소리가 거의 안 잡히고 있어요. 마이크가 음소거돼 있지 않은지 확인해 주세요.
            </p>
          )}
        </div>
      )}

      {rec.parts.length > 0 && (
        <ul className={styles.parts}>
          {rec.parts.map((p) => (
            <li key={p.idx} className={styles[p.state]}>
              구간 {p.idx + 1}
              {p.state === 'uploading' && ' 올리는 중…'}
              {p.state === 'uploaded' && ' 저장됨'}
              {p.state === 'failed' && ` 실패 — ${p.error ?? ''}`}
            </li>
          ))}
        </ul>
      )}

      {/* 부분 실패를 숨기지 않는다 — 전사가 왜 짧은지 사용자가 알아야 한다 */}
      {failedParts.length > 0 && (
        <p className={styles.warn}>
          {failedParts.length}개 구간을 올리지 못했어요. 그만큼의 대화는 전사에 빠집니다.
        </p>
      )}

      {progress && progress.total > 0 && (
        <p className={progress.failed > 0 ? styles.warn : styles.hint}>
          {!progress.done && <Loader2 size={13} className={styles.spin} aria-hidden />} {progress.label}
          {progress.done && progress.transcribed > 0 && ' — 아래 [AI로 정리하기]를 누르면 요약과 할 일을 뽑아 드려요.'}
        </p>
      )}

      {uploading && <span className={styles.hint}>저장 중이에요. 창을 닫아도 올라간 구간은 남습니다.</span>}
    </div>
  )
}
