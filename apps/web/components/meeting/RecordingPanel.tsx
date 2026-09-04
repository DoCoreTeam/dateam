'use client'

// 회의 녹음 패널 (통합 기획 §5·§6)
//
// **v0.7.592: 화면 폴더에서 공용 부품으로 옮겼다.** 회의노트와 CRM 미팅이 같은 작업대를 쓰므로
// 셸 폴더 안에 두면 한쪽만 고치게 된다(§0-1: 두 번째 사용처가 생기는 순간 이미 늦다).
//
// 타이밍 계약(D7): **전사는 자동, AI 분석은 버튼.**
// 녹음이 끝나면 전사가 알아서 돌고, 전사가 끝나면 사용자가 [AI로 정리하기]를 누른다.
// 분석을 자동으로 안 하는 이유 셋 — ① 사용자가 전사를 먼저 고칠 수 있어야 결과가 맞다
// ② 전사는 길어 비용이 크다 ③ 지시.
//
// **v0.7.589: 레코더를 직접 들지 않는다.** 이 패널이 `useMeetingRecorder` 를 소유하던 시절엔
// 라우트를 옮기면 언마운트되면서 진행 중 구간(최대 10분)이 사라졌다.
// 이제 레코더는 셸의 `RecordingProvider` 가 들고, 이 패널은 **그 상태를 보여 주고 시작/정지만** 시킨다.

import { useCallback, useEffect, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import InlineError from '@/components/ui/InlineError'
import EmptyState from '@/components/ui/EmptyState'
import LevelMeter from './LevelMeter'
import { useRecordingSession, useBusyWithOther } from '@/lib/meeting/recording-context'
import styles from './recording-panel.module.css'

interface ServerProgress {
  total: number
  transcribed: number
  failed: number
  done: boolean
  label: string
}

/**
 * 녹음 안내 — 대기 중과 녹음 중이 **같은 말**을 쓴다.
 * 두 곳에 따로 적으면 한쪽만 고쳐진다.
 */
const AUTOSAVE_HINT = '10분마다 자동으로 저장돼요. 다른 화면으로 옮겨도 녹음은 계속됩니다.'
const MIC_QUIET_HINT = '소리가 거의 안 잡히고 있어요. 마이크가 음소거돼 있지 않은지 확인해 주세요.'

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface Props {
  noteId: string
  /** 상주 바에 띄울 이름. 없으면 "회의" */
  title?: string
  /** 상주 바의 "회의로" 가 갈 곳. 회의노트와 CRM 미팅이 서로 다른 주소를 준다 */
  href?: string
  /** 전사가 새로 끝나면 알린다 — 전사 탭이 다시 조회한다 */
  onTranscribed?: () => void
}

export default function RecordingPanel({ noteId, title, href, onTranscribed }: Props) {
  const [progress, setProgress] = useState<ServerProgress | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const rec = useRecordingSession()
  const busyWithOther = useBusyWithOther(noteId)

  /** 이 회의가 지금 이 브라우저에서 녹음 중인가 */
  const mine = rec.target?.noteId === noteId
  const recording = mine && rec.state === 'recording'
  const stopping = mine && rec.state === 'stopping'

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/recordings`)
      if (!res.ok) return
      const body = await res.json()
      setProgress(body.progress ?? null)
    } catch { /* 진행 표시가 잠깐 안 와도 녹음은 계속된다 */ }
  }, [noteId])

  useEffect(() => { void refresh() }, [refresh])

  // 구간이 하나 올라갈 때마다 서버 진행률을 다시 읽는다 — 제공자가 tick 을 올린다
  useEffect(() => { if (rec.uploadTick > 0) void refresh() }, [rec.uploadTick, refresh])

  // 전사는 서버가 돌린다. 녹음이 끝난 뒤에도 잠깐 더 지켜본다 —
  // "끝났는데 화면이 그대로"가 이 흐름에서 가장 흔한 오해다.
  useEffect(() => {
    if (recording || stopping || (progress && !progress.done && progress.total > 0)) {
      const t = setInterval(() => { void refresh() }, 5000)
      return () => clearInterval(t)
    }
    return undefined
  }, [recording, stopping, progress, refresh])

  // 전사가 새로 끝나면 상위(전사 탭)에 알린다 — 안 알리면 목록이 빈 채로 남는다
  const transcribedCount = progress?.transcribed ?? 0
  useEffect(() => { if (transcribedCount > 0) onTranscribed?.() }, [transcribedCount, onTranscribed])

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

  const myParts = mine ? rec.parts : []
  const uploading = myParts.some((p) => p.state === 'uploading')
  const failedParts = myParts.filter((p) => p.state === 'failed')

  return (
    <div className={styles.panel}>
      {mine && rec.error && <InlineError spaced>{rec.error}</InlineError>}
      {serverError && <InlineError spaced onDismiss={() => setServerError(null)}>{serverError}</InlineError>}

      {/* 동시 녹음은 1건이다 — 조용히 안 눌리게 두지 않고 무엇이 잡고 있는지 말한다 */}
      {busyWithOther && (
        <p className={styles.warn}>
          다른 회의(&ldquo;{busyWithOther.title}&rdquo;)를 녹음하는 중이라 여기서는 시작할 수 없어요.
          그 회의를 끝낸 뒤 다시 눌러 주세요.
        </p>
      )}

      {!recording && !stopping ? (
        <div className={styles.idle}>
          <NbButton
            onClick={() => void rec.start({
              noteId,
              title: title?.trim() || '회의',
              href: href ?? `/meeting-notes/${noteId}`,
            })}
            disabled={rec.state === 'requesting' || Boolean(busyWithOther)}
          >
            <Mic size={16} /> {rec.state === 'requesting' ? '마이크 여는 중…' : '녹음 시작'}
          </NbButton>
          <span className={styles.hint}>{AUTOSAVE_HINT}</span>
        </div>
      ) : (
        <div className={styles.live}>
          <div className={styles.timerRow}>
            <span className={styles.dot} aria-hidden />
            <strong className={styles.timer}>{mmss(rec.elapsedSec)}</strong>
            {/* 레벨 미터 — 마이크가 소리를 받고 있는지 보여 주는 유일한 수단.
                값은 구독으로 받아 DOM 에 직접 쓴다(LevelMeter 주석) */}
            <LevelMeter
              subscribe={rec.subscribeLevel}
              className={styles.meter}
              fillClassName={styles.meterFill}
            />
          </div>

          {/**
            * **이 줄은 항상 있다.**
            *
            * 예전에는 「소리가 거의 안 잡혀요」가 나타났다 사라지며 패널 높이를 바꿨고,
            * 그때마다 아래 에디터가 통째로 밀렸다(사용자 지적 2026-09-04:
            * *"종료하고 정리 버튼 아래로 무슨 멘트가 자꾸 나와서 화면이 떨려"*).
            * 자리만 비워 두면 빈칸이 생기므로, 평소에는 저장 안내가 그 자리를 지킨다.
            *
            * 판정도 순간값이 아니다 — `mic-silence.ts` 가 «몇 초 연속»으로만 뒤집는다.
            */}
          <p className={styles.micLine} data-quiet={rec.micQuiet ? '' : undefined} role="status">
            {rec.micQuiet ? MIC_QUIET_HINT : AUTOSAVE_HINT}
          </p>

          <NbButton variant="danger" onClick={() => void rec.stop()} disabled={stopping}>
            <Square size={16} /> {stopping ? '마무리 중…' : '종료하고 정리'}
          </NbButton>
        </div>
      )}

      {myParts.length > 0 && (
        <ul className={styles.parts}>
          {myParts.map((p) => (
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
        </p>
      )}

      {uploading && <span className={styles.hint}>저장 중이에요. 창을 닫아도 올라간 구간은 남습니다.</span>}
    </div>
  )
}
