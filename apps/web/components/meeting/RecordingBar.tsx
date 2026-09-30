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

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Square, ArrowUpRight } from 'lucide-react'
import LevelMeter from './LevelMeter'
import { useRecordingSession } from '@/lib/meeting/recording-context'
import { isLocalNoteId } from '@/lib/offline/local-meeting'
import styles from './recording-bar.module.css'

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function RecordingBar() {
  const rec = useRecordingSession()
  const pathname = usePathname()

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

  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden />

      <div className={styles.body}>
        <p className={styles.title}>
          {rec.state === 'stopping' ? '마무리 중' : '녹음 중'} · {rec.target.title}
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

      {!local && (
        <Link className={styles.go} href={rec.target.href}>
          회의로 <ArrowUpRight size={14} aria-hidden />
        </Link>
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
