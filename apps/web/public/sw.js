/* newAX 서비스 워커 — **앱이 뜨게만 한다**
 *
 * 왜 생겼나: 네트워크가 없으면 `/crm/today` 가 **렌더조차 안 됐다.**
 * 지하철·엘리베이터·고객사 게스트 와이파이 대기 화면에서 앱이 죽은 것처럼 보였다.
 * 사용자 지시(2026-08-27): *"네트워크가 없으면 우리 시스템 접속이 안될텐데
 * 일단 접속을 해두면 녹음 하는것도 로컬에서 우선 저장을"* — 접속이 되어야 그 다음이 있다.
 *
 * ⚠️ 캐시는 **보수적으로** 잡는다. 서비스 워커가 잘못 캐시하면
 * 사용자가 **옛 화면을 영원히 보는** 종류의 사고가 난다. 그래서 규칙은 셋뿐이다:
 *
 *   ① API 응답은 **절대 캐시하지 않는다.** 영업 데이터가 낡은 채 보이면
 *      "저장했는데 안 됐다"보다 나쁘다 — 틀린 값을 맞다고 믿게 된다.
 *   ② HTML 문서는 **network-first.** 연결이 있으면 언제나 새것을 받는다.
 *      끊겼을 때만 마지막으로 받은 것을 준다.
 *   ③ 정적 자산(빌드 산출물·폰트)만 **cache-first.** 파일 이름에 해시가 박혀 있어
 *      바뀌면 이름이 바뀐다 — 낡은 것을 줄 수가 없다.
 *
 * 새 배포가 나오면 **즉시 갈아탄다**(skipWaiting + clients.claim).
 * 기다리게 두면 사용자가 탭을 다 닫을 때까지 옛 워커가 산다.
 */

const VERSION = 'v1'
const SHELL_CACHE = `newax-shell-${VERSION}`
const ASSET_CACHE = `newax-asset-${VERSION}`

/** 오프라인일 때 보여 줄 최소한 — 이것만 있으면 "앱이 살아 있다"가 성립한다 */
const PRECACHE = ['/offline', '/fonts/fonts.css']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // 하나가 실패해도 설치는 끝낸다 — 폰트 하나 때문에 워커가 아예 안 서면 안 된다
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  )
})

/** 이 요청을 건드리지 않는다 — 건드리면 안 되는 것을 한 곳에 모은다 */
function isPassthrough(url, request) {
  if (request.method !== 'GET') return true          // 쓰기는 절대 가로채지 않는다
  if (url.origin !== self.location.origin) return true
  if (url.pathname.startsWith('/api/')) return true  // ① 영업 데이터는 캐시하지 않는다
  if (url.pathname.startsWith('/_next/webpack-hmr')) return true
  return false
}

/** 빌드 산출물·폰트 — 이름에 해시가 있어 낡을 수 없다 */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (isPassthrough(url, event.request)) return

  // ③ 정적 자산 — cache-first
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit ?? fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(ASSET_CACHE).then((c) => c.put(event.request, copy))
        }
        return res
      })),
    )
    return
  }

  // ② HTML 문서 — network-first. 끊겼을 때만 마지막 것을 준다
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy))
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(event.request)
          if (cached) return cached
          // 그 화면을 받은 적이 없으면 "연결이 없다"고 말하는 화면을 준다.
          // 브라우저 기본 오류 화면은 **앱이 고장난 것처럼** 보인다.
          return (await caches.match('/offline'))
            ?? new Response('연결이 없어요', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
        }),
    )
  }
})
