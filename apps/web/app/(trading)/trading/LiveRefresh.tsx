'use client'

// app/(trading)/trading/LiveRefresh.tsx — 현황이 스스로 다시 읽는다
//
// 사용자 지적 2026-09-28: 「실시간으로 보여지는 화면 형태여야」
//
// 현황은 분마다 바뀌는 화면인데 새로고침을 사람이 눌러야 했다. 안 누르면 화면은
// 조용히 옛 값을 계속 보여 주고, 그 상태가 「아무 일도 안 일어난다」와 똑같이 보인다.
//
// ## 안 하는 것 둘
//
// 1 **탭이 뒤에 있으면 안 읽는다.** 안 보는 화면을 위해 서버를 두드리지 않는다.
//   돌아오면 그 자리에서 한 번 읽어 옛 값을 안 남긴다.
// 2 **창구를 새로 안 연다.** `router.refresh()` 가 같은 서버 컴포넌트를 다시 그리므로
//   읽는 길과 관문이 사람이 여는 것과 똑같다.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { seoulTimeText } from '@/lib/trading/position-labels'
import styles from './LiveRefresh.module.css'

interface Props {
  /** 다시 읽는 간격(초). 설정값이고 env 가 아니다 */
  everySeconds: number
}

export default function LiveRefresh({ everySeconds }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  /**
   * 마지막으로 읽은 시각. **서버에서 안 내려받는다** — 서버가 적어 보내면 그것은
   * 「서버가 그린 때」이고, 화면이 실제로 다시 읽은 때와 다르다.
   * 첫 렌더에서는 비워 둔다(서버와 다른 글자를 그리면 하이드레이션이 어긋난다).
   */
  const [readAt, setReadAt] = useState<string | null>(null)

  useEffect(() => {
    const everyMs = Math.max(5, everySeconds) * 1000
    let timer: ReturnType<typeof setInterval> | null = null

    const read = (): void => {
      if (document.hidden) return
      start(() => {
        router.refresh()
        setReadAt(new Date().toISOString())
      })
    }

    const onVisible = (): void => {
      if (document.hidden) return
      // 돌아온 자리에서 한 번 읽는다. 안 읽으면 다음 차례까지 옛 값이 남는다
      read()
    }

    timer = setInterval(read, everyMs)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [everySeconds, router])

  return (
    <p className={styles.bar} role="status">
      <RefreshCw size={13} className={pending ? styles.spinning : undefined} aria-hidden />
      <span>
        {pending
          ? '다시 읽는 중…'
          : readAt
            ? `${seoulTimeText(readAt)}에 읽었습니다`
            : `${everySeconds}초마다 스스로 다시 읽습니다`}
      </span>
    </p>
  )
}
