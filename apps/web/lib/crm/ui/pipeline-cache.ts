// lib/crm/ui/pipeline-cache.ts — 파이프라인 목록의 **화면 쪽 캐시**(SSOT)
//
// ## 왜 필요한가 (실측 2026-08-31 · 프로덕션)
//
// 딜 화면은 파이프라인을 받아야 보드를 붙이고, 보드가 붙어야 딜을 묻는다.
// 그래서 딜 요청이 **1,553ms** 에야 나갔고 그동안 사용자는 점 세 개만 봤다
// (사용자 지적: 「뭐든 데이터 있는곳을 클릭해서 열려면 한세월이야」).
//
// 파이프라인은 **거의 바뀌지 않는 값**이다 — 영업 단계를 하루에 몇 번씩 고치지 않는다.
// 그런데 화면을 열 때마다 처음인 것처럼 다시 묻고, 그 왕복이 딜 조회를 통째로 뒤로 밀었다.
//
// ## 어떻게 하나
//
// 화면은 **가진 것으로 먼저 그리고, 최신값이 오면 갈아 끼운다**(stale-while-revalidate).
// 캐시가 있으면 보드가 곧바로 붙어 딜 요청이 왕복 하나만큼 앞당겨진다.
//
// ## 조심할 것
//
// **첫 렌더에서 읽지 않는다.** `useState(() => read())` 로 읽으면 서버가 그린 HTML(빈 값)과
// 달라져 하이드레이션이 깨진다. 반드시 `useEffect` 안에서 읽어 그다음 렌더에 반영한다.
//
// **탭을 닫으면 사라진다**(`sessionStorage`). 로그아웃·워크스페이스 전환 뒤에 남의 값을
// 보여 주는 일이 없어야 하는데, 세션 저장소는 탭 수명과 같아 그 경계가 저절로 맞는다.

/** 저장 키 — 모양이 바뀌면 v 를 올린다(옛 값을 읽어 화면이 깨지지 않게) */
const KEY = 'crm:pipelines:v1'

/** 얼마나 지난 값까지 그려도 되나 — 이보다 오래면 그냥 안 쓴다(빈 화면이 틀린 화면보다 낫다) */
const MAX_AGE_MS = 10 * 60 * 1000

interface Envelope {
  at: number
  items: unknown[]
}

/** 세션 저장소는 브라우저에만 있고, 시크릿 모드·정책 설정에서 던질 수 있다 */
function store(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** 캐시에 든 파이프라인 — 없거나 오래됐거나 깨졌으면 빈 배열 */
export function readCachedPipelines<T>(): T[] {
  const s = store()
  if (!s) return []
  try {
    const raw = s.getItem(KEY)
    if (!raw) return []
    const env = JSON.parse(raw) as Envelope
    if (!env || !Array.isArray(env.items)) return []
    if (!Number.isFinite(env.at) || Date.now() - env.at > MAX_AGE_MS) return []
    return env.items as T[]
  } catch {
    // 깨진 값은 조용히 버린다 — 캐시 때문에 화면이 죽으면 안 된다
    return []
  }
}

/** 최신값을 받아 두었다가 다음 방문에 곧바로 그린다. 빈 목록은 저장하지 않는다 */
export function writeCachedPipelines(items: unknown[]): void {
  const s = store()
  if (!s || !Array.isArray(items) || items.length === 0) return
  try {
    s.setItem(KEY, JSON.stringify({ at: Date.now(), items } satisfies Envelope))
  } catch {
    // 저장 공간이 꽉 찼을 뿐이다 — 화면은 그대로 동작해야 한다
  }
}

/** 영업 단계를 고쳤을 때 — 다음 화면이 옛 단계를 그리지 않게 지운다 */
export function clearCachedPipelines(): void {
  try {
    store()?.removeItem(KEY)
  } catch {
    /* 지우지 못해도 MAX_AGE_MS 가 지나면 저절로 안 쓰인다 */
  }
}
