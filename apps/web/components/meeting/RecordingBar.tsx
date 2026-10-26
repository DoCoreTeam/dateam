'use client'

/**
 * 녹음 상주 바 — 녹음 중이면 **어느 화면에서든** 보인다.
 *
 * 왜 필요한가: 이제 라우트를 옮겨도 녹음이 안 끊긴다(`RecordingProvider`).
 * 그런데 안 끊기는 것만으로는 부족하다 — 안 보이면 사람은 **끊긴 줄 안다**.
 * 그러면 다시 시작하고, 같은 회의가 두 벌로 쪼개진다.
 * 이 바가 하는 일은 하나다: "지금 녹음 중이고, 여기로 가면 그 회의다"를 계속 말하는 것.
 *
 * 좌하단에 둔다 — 우하단은 Dock 이 좌표를 독점한다(`lib/ui/dock-exclusive.test.ts`).
 * 모바일에서는 가로로 펴고 Dock 높이(`--dock-safe-area`)만큼 띄운다.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Square, ArrowUpRight, Pause, Play, ChevronDown, ChevronUp } from 'lucide-react'
import LevelMeter from './LevelMeter'
import { useRecordingSession } from '@/lib/meeting/recording-context'
import { isLocalNoteId } from '@/lib/offline/local-meeting'
import { readLocalMemo, saveLocalMemo } from '@/lib/offline/local-memo'
import { remoteElapsedSec, type RemoteRecording } from '@/lib/meeting/recording-tabs'
import { ACTION, LOCAL_MEMO_LABEL, LOCAL_MEMO_SAVED, LOCAL_MEMO_SAVE_FAILED } from '@/lib/terms'
import styles from './recording-bar.module.css'

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function RecordingBar() {
  const rec = useRecordingSession()
  const pathname = usePathname()

  // 다른 탭에서 녹음 중이면 그것을 알린다 — 새 탭을 연 사람이 녹음이 끊긴 줄 알고 또 시작하지 않게
  if (rec.remote && (!rec.target || rec.state === 'idle' || rec.state === 'error')) return <RemoteBar remote={rec.remote} />
  if (!rec.target) return null
  if (rec.state === 'idle' || rec.state === 'error') return null

  /**
   * 기기가 만든 회의인가 — 그렇다면 **갈 화면이 아직 없다.**
   *
   * 연결이 없을 때 시작한 녹음은 서버에 회의가 없으므로 주소도 없다.
   * 그 상태에서 링크를 걸면 누르는 순간 오프라인에서 화면이 죽고,
   * 「그 회의 화면에 있으니 숨긴다」를 그대로 적용하면 **바가 통째로 사라진다** —
   * 녹음 중이라는 유일한 표시가 없어지고, 사람은 끊긴 줄 알고 다시 시작한다.
   */
  const local = isLocalNoteId(rec.target.noteId)

  // 그 회의 화면에 있으면 안 그린다 — 같은 정보가 두 벌이면 어느 쪽을 눌러야 할지 헷갈린다
  const onTargetScreen = !local && pathname === rec.target.href.split('?')[0]
  if (onTargetScreen) return null

  const uploading = rec.parts.filter((p) => p.state === 'uploading').length
  const failed = rec.parts.filter((p) => p.state === 'failed').length
  const paused = rec.state === 'paused'

  return (
    <div
      className={styles.bar}
      data-paused={paused ? '' : undefined}
      data-memo={local ? '' : undefined}
      role="status"
      aria-live="polite"
    >
      {/* 멈춰 있으면 점도 멈춘다 — 깜박이는 점은 «지금 받아적는 중»이라는 뜻이다 */}
      <span className={styles.dot} data-paused={paused ? '' : undefined} aria-hidden />

      <div className={styles.body}>
        <p className={styles.title}>
          {rec.state === 'stopping' ? '마무리 중' : paused ? '멈춤' : '녹음 중'} · {rec.target.title}
        </p>
        <p className={styles.meta}>
          <span className={styles.timer}>{mmss(rec.elapsedSec)}</span>
          <LevelMeter
            subscribe={rec.subscribeLevel}
            className={styles.meter}
            fillClassName={styles.meterFill}
          />
          {local && <span>이 기기에 저장 중 · 연결되면 올라가요</span>}
          {uploading > 0 && <span>구간 {uploading}개 올리는 중</span>}
          {failed > 0 && <span className={styles.failed}>{failed}개 실패</span>}
        </p>
      </div>

      {/* 연결 없이 시작한 녹음은 갈 화면이 없다, 그래서 기록을 적는 자리를 바가 연다 */}
      {local && <LocalMemo key={rec.target.noteId} localId={rec.target.noteId} />}

      {!local && (
        <Link className={styles.go} href={rec.target.href}>
          회의로 <ArrowUpRight size={14} aria-hidden />
        </Link>
      )}

      {/* 잠깐 쉬는 것과 끝내는 것은 다른 일이다 — 어느 화면에 있든 둘 다 손에 닿아야 한다 */}
      {rec.canPause && (
        <button
          type="button"
          className={styles.hold}
          onClick={() => (paused ? rec.resume() : rec.pause())}
          disabled={rec.state === 'stopping'}
        >
          {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
          {paused ? ACTION.resume : ACTION.pause}
        </button>
      )}

      <button
        type="button"
        className={styles.stop}
        onClick={() => void rec.stop()}
        disabled={rec.state === 'stopping'}
      >
        <Square size={14} aria-hidden /> 종료
      </button>
    </div>
  )
}

const MEMO_SAVE_DELAY_MS = 800

/**
 * 기기에 적는 회의 기록. 처음엔 펼쳐 둔다, 단추를 누른 직후 어디에 적는지 보여야 한다.
 *
 * 저장은 멈춘 뒤 잠깐, 칸을 떠날 때, 바가 사라질 때(녹음 종료) 한 번 더 한다.
 * 글은 연결이 돌아오면 회의노트 본문으로 올라간다(`reconcile`).
 */
function LocalMemo({ localId }: { localId: string }) {
  const [open, setOpen] = useState(true)
  const [text, setText] = useState(() => readLocalMemo(localId))
  const [failed, setFailed] = useState(false)
  const latest = useRef(text)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelId = useId()

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!dirty.current) return true
    const ok = saveLocalMemo(localId, latest.current)
    if (ok) dirty.current = false
    return ok
  }, [localId])

  // 바가 사라질 때 마지막 글을 놓치지 않는다
  useEffect(() => () => { flush() }, [flush])

  const onChange = (value: string) => {
    setText(value)
    latest.current = value
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFailed(!flush()), MEMO_SAVE_DELAY_MS)
  }

  return (
    <>
      <button
        type="button"
        className={styles.memoToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
        {LOCAL_MEMO_LABEL}
      </button>
      <div id={panelId} className={styles.memo} hidden={!open}>
        <textarea
          aria-label={LOCAL_MEMO_LABEL}
          className={`input-field ${styles.memoText}`}
          value={text}
          rows={5}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setFailed(!flush())}
        />
        <p className={failed ? styles.memoFailed : styles.memoHint} role={failed ? 'alert' : undefined}>
          {failed ? LOCAL_MEMO_SAVE_FAILED : LOCAL_MEMO_SAVED}
        </p>
      </div>
    </>
  )
}

/**
 * 다른 탭의 녹음. 이 탭에서는 멈추거나 끝낼 수 없다 — 녹음은 시작한 탭이 들고 있다.
 * 그래서 단추 대신 어디서 다루는지 말한다.
 */
function RemoteBar({ remote }: { remote: RemoteRecording }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])
  const paused = remote.state === 'paused'
  return (
    <div className={styles.bar} data-paused={paused ? '' : undefined} role="status" aria-live="polite">
      <span className={styles.dot} data-paused={paused ? '' : undefined} aria-hidden />
      <div className={styles.body}>
        <p className={styles.title}>
          다른 탭에서 {remote.state === 'stopping' ? '마무리 중' : paused ? '멈춤' : '녹음 중'} · {remote.title}
        </p>
        <p className={styles.meta}>
          <span className={styles.timer}>{mmss(remoteElapsedSec(remote, now))}</span>
          <span>멈추거나 끝내기는 녹음을 시작한 탭에서 할 수 있어요</span>
        </p>
      </div>
    </div>
  )
}
