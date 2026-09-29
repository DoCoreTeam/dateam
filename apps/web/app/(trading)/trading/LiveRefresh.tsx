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
import { seoulTimeText, seoulClockText } from '@/lib/trading/position-labels'
import { liveWindowAt, CLOSED_REASON_LABEL, nextOpenLine } from '@/lib/trading/live-window'
import styles from './LiveRefresh.module.css'

interface Props {
  /** 다시 읽는 간격(초). 설정값이고 env 가 아니다 */
  everySeconds: number
  /**
   * 마지막 봉이 시작한 시각 (ISO). 없으면 null.
   *
   * **「30초마다 다시 읽습니다」만으로는 지금 무엇을 하는지 알 수 없다**
   * (사용자 지적 2026-09-28 「실시간이어야 하는데 30초는 왜? 이게 뭘 하고 있는건지 모르겠네」).
   * 1분 봉이라 데이터는 1분에 한 번 바뀐다 — 그 사실과 다음 읽기까지 남은 초를 함께 말한다.
   */
  lastBarAt: string | null
}

export default function LiveRefresh({ everySeconds, lastBarAt }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  /**
   * 마지막으로 읽은 시각. **서버에서 안 내려받는다** — 서버가 적어 보내면 그것은
   * 「서버가 그린 때」이고, 화면이 실제로 다시 읽은 때와 다르다.
   * 첫 렌더에서는 비워 둔다(서버와 다른 글자를 그리면 하이드레이션이 어긋난다).
   */
  const [readAt, setReadAt] = useState<string | null>(null)
  /**
   * 다음 읽기까지 남은 초. **화면 안에서만 센다** — 1초마다 서버를 두드리면
   * 「살아 있다」를 보여 주려고 서버를 죽이는 셈이다.
   * 서버 렌더에서는 null 이라 첫 그림이 서버와 같다(하이드레이션).
   */
  const [leftSec, setLeftSec] = useState<number | null>(null)
  /**
   * 지금 장이 서 있나. **첫 렌더에서는 「살아 있다」로 둔다** —
   * 서버가 그린 글자와 달라지면 하이드레이션이 어긋나기 때문이다.
   * 마운트한 뒤 곧바로 실제 판정으로 바뀌고, 1분마다 다시 본다.
   */
  const [closed, setClosed] = useState<{ reason: keyof typeof CLOSED_REASON_LABEL; nextOpenAt: string } | null>(null)
  /**
   * 지금 시각(초까지)과 마지막 봉이 들어온 지 몇 초인가.
   *
   * 사용자 지적 2026-09-29: 「초나 시간이 실시간으로 흐르는것도 봤으면 좋겠어 지금은
   * 분까지만 있고 이게 변하고 있는지를 모르겠거든」.
   *
   * **「다음 읽기까지 29초」는 우리 시계이지 데이터가 오고 있다는 증거가 아니다.**
   * 크론이 죽어도 그 숫자는 똑같이 줄어든다. 그래서 「마지막 봉 이후 몇 초」를 같이 둔다 —
   * 이 값이 60을 크게 넘어 가면 봉이 안 들어오고 있다는 뜻이고, 그것은 화면이 말해야 한다.
   *
   * 첫 렌더에는 null 이다. 서버가 그린 글자와 달라지면 하이드레이션이 어긋난다.
   */
  const [nowText, setNowText] = useState<string | null>(null)
  const [barAgeSec, setBarAgeSec] = useState<number | null>(null)

  useEffect(() => {
    const everyMs = Math.max(5, everySeconds) * 1000
    let timer: ReturnType<typeof setInterval> | null = null
    let tick: ReturnType<typeof setInterval> | null = null
    let nextAt = Date.now() + everyMs

    const read = (): void => {
      if (document.hidden) return
      /*
        **닫힌 장은 안 두드린다.** 값이 안 바뀌는데 30초마다 서버를 부르면
        사람에게는 「뭔가 오고 있다」로 보이고 서버는 밤새 헛일을 한다.
      */
      if (!liveWindowAt(new Date()).live) return
      nextAt = Date.now() + everyMs
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
    // 1초마다 남은 시간만 줄인다. 이 시계는 서버에 아무것도 안 묻는다
    tick = setInterval(() => {
      const now = new Date()
      const w = liveWindowAt(now)
      setClosed(w.live ? null : { reason: w.reason!, nextOpenAt: w.nextOpenAt! })
      // 초까지 흐르는 시계. 이 줄만 봐도 화면이 살아 있는지 안다
      setNowText(seoulClockText(now))
      /*
        장이 닫혀 있으면 봉이 안 오는 것이 정상이다. 그 자리에 초를 세면
        멀쩡한 상태가 고장으로 읽힌다 — 그때는 안 그린다.
      */
      const at = lastBarAt ? Date.parse(lastBarAt) : Number.NaN
      setBarAgeSec(
        w.live && Number.isFinite(at)
          ? Math.max(0, Math.floor((now.getTime() - at) / 1000))
          : null,
      )
      // 멈춘 동안에는 남은 시간을 안 센다 — 세고 있으면 곧 뭔가 온다는 뜻이 된다
      setLeftSec(document.hidden || !w.live ? null : Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)))
    }, 1000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) clearInterval(timer)
      if (tick) clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [everySeconds, router, lastBarAt])

  return (
    <p className={styles.bar} role="status">
      <RefreshCw size={13} className={pending ? styles.spinning : undefined} aria-hidden />
      {/*
        **무엇을 기다리는지 먼저 말한다.** 가격은 1분 봉이라 1분에 한 번만 바뀐다 —
        그 사실을 안 말하면 「30초마다 읽는데 왜 안 바뀌나」가 된다
      */}
      <span className={styles.head}>{barLine(lastBarAt)}</span>
      {/*
        **봉이 들어온 지 몇 초인가.** 1분봉이라 이 값은 0에서 60 사이를 돈다 —
        60을 크게 넘어 가면 봉이 안 들어오고 있다는 뜻이고, 그 사실이 여기서 보인다
      */}
      {barAgeSec !== null && (
        <span className={styles.age}>{`${barAgeSec}초 전`}</span>
      )}
      <span className={styles.sep} aria-hidden>·</span>
      <span>
        {closed
          /* 멈춘 자리가 죽은 화면으로 안 읽히게 — 왜 멈췄고 언제 다시 여는지 */
          ? `${CLOSED_REASON_LABEL[closed.reason]} · ${nextOpenLine(closed.nextOpenAt)}`
          : pending
            ? '다시 읽는 중…'
            : leftSec !== null
              ? `${leftSec}초 뒤 다시 읽습니다`
              : `${everySeconds}초마다 스스로 다시 읽습니다`}
      </span>
      {readAt && !pending && (
        <span className={styles.quiet}>{`(${seoulTimeText(readAt)}에 읽음)`}</span>
      )}
      {/* 지금 시각. **이 줄이 1초마다 바뀌는 것이 화면이 살아 있다는 증거다** */}
      {nowText && (
        <span className={styles.clock} aria-label="지금 시각">{nowText}</span>
      )}
    </p>
  )
}

/** 마지막 봉이 언제 것인가. 없으면 없다고 말한다 — 빈 칸을 지어내지 않는다 */
function barLine(lastBarAt: string | null): string {
  if (!lastBarAt) return '가격 봉이 아직 없습니다'
  /*
    **몇 분짜리 봉인지를 같이 말한다.** 사용자 지적 2026-09-29 「1분 단위로 계속 바뀌나?」 —
    시각만 있으면 그 시각이 봉 하나인지 다섯 분치인지 모른다. 옆줄이 「몇 초 뒤 다시 읽는다」를
    말하고 있어, 여기서 봉 주기를 말해야 둘이 이어 읽힌다.
  */
  return `마지막 1분봉 ${seoulTimeText(lastBarAt)}`
}
