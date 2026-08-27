'use client'

import { useEffect } from 'react'

/**
 * 서비스 워커를 켠다 — **앱이 뜨게만** 하는 목적이다(`public/sw.js` 주석 참조).
 *
 * 왜 필요한가: 네트워크가 없으면 화면이 **렌더조차 안 됐다.** 고객사 로비·지하 주차장에서
 * 앱이 죽은 것처럼 보이면, 사용자는 회의 직전에 이 앱을 닫는다. 녹음을 기기에 먼저 저장해도
 * (`lib/offline/blob-store.ts`) **화면이 안 뜨면 그 저장을 시작할 수조차 없다.**
 *
 * ⚠️ **개발에서는 켜지 않고, 오히려 지운다.**
 * dev 서버의 `/_next/static/*` 는 이름이 배포처럼 고정되지 않아, 캐시하면 옛 청크를 물고
 * "고쳤는데 화면이 그대로"가 된다. 게다가 이 저장소의 dev 서버(:3000)는 **세션 여럿이 공유**해서
 * 한 번 잘못 설치된 워커가 남의 창까지 오염시킨다. 그래서 개발에서는 **등록된 것을 해제**한다 —
 * 프로덕션을 한 번 열어 본 브라우저로 localhost 를 여는 경우가 실제로 있다.
 */
export default function ServiceWorkerBoot() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((rs) => rs.forEach((r) => { void r.unregister() }))
        .catch(() => {})
      return
    }

    // load 이후에 등록한다 — 첫 페인트와 대역폭을 다투지 않게
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // 실패해도 앱은 그대로 동작한다. 오프라인 대비가 없을 뿐이다 — 사용자를 막지 않는다.
      })
    }
    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
