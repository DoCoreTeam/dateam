/**
 * 오프라인 층 — 저장의 정의를 바꾼 계약을 잠근다
 *
 * **왜 이 가드가 있는가**: 업로드가 실패하면 그 10분이 **영원히 사라졌다**
 * (`use-recorder.ts:150` 의 `catch` 가 상태만 바꾸고 blob 을 버렸다).
 * 사용자는 「올리지 못함」 배지만 보고 "나중에 다시 올라간다"는 뜻인 줄 안다.
 *
 * 여기서 잠그는 것은 셋이다 —
 *   ① **순서**: 로컬에 쓰기 → 올리기 → 성공한 것만 지우기
 *   ② **개인정보**: 올린 것은 즉시 지운다. 못 올린 것도 7일까지만
 *   ③ **말**: 상태 라벨은 용어집이 정한다
 *   ④ **셸이 뜬다**: 네트워크가 없어도 화면이 렌더된다(서비스 워커). 여기서 잘못 캐시하면
 *      **옛 화면을 영원히 보는** 사고가 나므로, 캐시 금지 규칙을 못 박는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_KEEP_DAYS, PART_BYTES_ESTIMATE } from './blob-store.ts'
import { SYNC_STATUS_META, SYNC_STATUS_ORDER, type SyncStatusKey } from './ui/sync-status.ts'
import { STATUS_COLORS } from '../tokens/status-colors.ts'

const STORE = readFileSync(new URL('./blob-store.ts', import.meta.url), 'utf8')
const SYNC = readFileSync(new URL('./sync-parts.ts', import.meta.url), 'utf8')
const CTX = readFileSync(new URL('../meeting/recording-context.tsx', import.meta.url), 'utf8')
const SHELL = readFileSync(new URL('../../components/ui/shell/AppShell.tsx', import.meta.url), 'utf8')
const BAR = readFileSync(new URL('../../components/ui/OfflineBar.tsx', import.meta.url), 'utf8')
const RECBAR = readFileSync(new URL('../../components/meeting/RecordingBar.tsx', import.meta.url), 'utf8')
const SW = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

/**
 * 재는 함수의 몸통만 떼어 온다.
 *
 * 앞에서 `useEffect` 를 하나 더 쓰기 시작하자 `indexOf('useEffect')` 로 끝을 잡던 판이
 * **빈 문자열을 검사하게 됐다**(그래도 통과했으면 가드가 죽은 채로 남았을 것이다).
 * 시작 위치 다음에서 찾는다.
 */
function measureBody(): string {
  const from = BAR.indexOf('const measure = useCallback')
  const to = BAR.indexOf('useEffect(() => {', from)
  return BAR.slice(from, to === -1 ? undefined : to)
}
const BOOT = readFileSync(new URL('../../components/ui/ServiceWorkerBoot.tsx', import.meta.url), 'utf8')
const ROOT = readFileSync(new URL('../../app/layout.tsx', import.meta.url), 'utf8')
const MW = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8')
const MANIFEST = readFileSync(new URL('../../app/manifest.ts', import.meta.url), 'utf8')

/* ── ① 순서 ─────────────────────────────────────────────── */

test('★ 기기에 먼저 쓰고 나서 올린다 — 순서가 뒤집히면 유실이 돌아온다', () => {
  const putAt = CTX.indexOf('blobStore.put(')
  const uploadAt = CTX.indexOf('uploadOnePart(')
  assert.ok(putAt > 0, '로컬 보관을 안 부른다')
  assert.ok(uploadAt > 0, '업로드를 안 부른다')
  assert.ok(putAt < uploadAt, '업로드가 로컬 보관보다 먼저다 — 실패하면 그 구간이 사라진다')
})

test('★ 올린 뒤에만 지운다 — 실패했는데 지우면 그게 유실이다', () => {
  const uploadAt = CTX.indexOf('uploadOnePart(')
  const removeAt = CTX.indexOf('blobStore.remove(')
  assert.ok(removeAt > uploadAt, '업로드 전에 지우고 있다')
  // 실패 경로(catch)에는 remove 가 없어야 한다
  const catchBlock = CTX.slice(CTX.indexOf('} catch (e) {', uploadAt), CTX.indexOf('// ③'))
  assert.ok(!/blobStore\.remove/.test(catchBlock), '실패했는데 원본을 지운다')
})

test('★ 로컬 보관이 실패해도 업로드는 시도한다 — 둘 다 못 하는 것보다 낫다', () => {
  assert.match(CTX, /savedLocally = true/, '보관 성공 여부를 안 남긴다')
  assert.match(CTX, /로컬 보관 실패/, '보관 실패를 조용히 넘긴다')
})

test('하나가 실패해도 나머지는 계속 올린다', () => {
  // for 루프 안에서 try/catch — 던지면 뒷구간이 통째로 안 올라간다
  const loop = SYNC.slice(SYNC.indexOf('for (const p of pending)'))
  assert.match(loop, /try \{/, '실패가 루프를 깬다')
  assert.ok(!/throw /.test(loop.slice(0, loop.indexOf('return'))), '루프 안에서 다시 던진다')
})

test('실패를 조용히 넘기지 않는다 — 무엇이 안 올라갔는지 돌려준다', () => {
  assert.match(SYNC, /failed: SyncResult\['failed'\]/, '실패 목록이 없다')
  assert.match(BAR, /구간 \$\{r\.failed\.map/, '화면이 실패한 구간을 이름으로 말하지 않는다')
})

/* ── ② 개인정보 ─────────────────────────────────────────── */

test('★ 보관 기한이 있다 — 노트북을 잃으면 회의 음성이 통째로 나간다', () => {
  assert.equal(MAX_KEEP_DAYS, 7, '결정 5: 주말을 한 번 넘길 수 있는 최소치')
})

test('★ 기한이 지났다고 말없이 지우지 않는다', () => {
  assert.match(STORE, /listExpired/, '기한 지난 것을 세는 자리가 없다')
  assert.match(STORE, /지우지 않고 알려만 준다/, '자동 삭제로 바뀌었다 — 회의가 조용히 사라진다')
})

test('브라우저가 저장을 보장하지 않으면 그렇게 말한다 (결정 B)', () => {
  assert.match(STORE, /requestPersistence/, '영구 보관 요청이 없다')
  assert.match(STORE, /저장을 보장하지 않아요/, '거부됐을 때 할 말이 없다')
})

test('남은 공간을 모르면 0 이 아니라 null 이다 — 모르는 것을 숫자로 말하지 않는다', () => {
  assert.match(STORE, /Promise<number \| null>/, 'freeBytes 가 모름을 표현하지 못한다')
  assert.ok(PART_BYTES_ESTIMATE > 1024 * 1024, '구간 크기 기준이 비현실적이다')
})

/* ── ③ 말 ──────────────────────────────────────────────── */

test('★ 상태 라벨이 전부 StatusKey 에 매핑된다 — 색을 화면이 안 정한다', () => {
  for (const k of SYNC_STATUS_ORDER) {
    const meta = SYNC_STATUS_META[k]
    assert.ok(STATUS_COLORS[meta.status], `${k}: ${meta.status} 는 StatusKey 가 아니다`)
  }
})

test('진행 표기가 용어집 규칙을 따른다 — 공백 + 말줄임표', () => {
  assert.equal(SYNC_STATUS_META.SYNCING.label, '올리는 중…')
})

test('연결 없음은 실패가 아니다 — 고장으로 읽히면 사람이 앱을 닫는다', () => {
  assert.equal(SYNC_STATUS_META.OFFLINE.status, 'note')
  assert.notEqual(SYNC_STATUS_META.OFFLINE.status, 'blocker')
})

test('모든 상태가 순서 배열에 들어 있다', () => {
  const keys = Object.keys(SYNC_STATUS_META) as SyncStatusKey[]
  assert.deepEqual([...SYNC_STATUS_ORDER].sort(), keys.sort())
})

/* ── 배선 ──────────────────────────────────────────────── */

test('★ 연결 상태 줄이 셸에 실제로 꽂혀 있다', () => {
  assert.match(SHELL, /import OfflineBar/, '셸이 import 하지 않는다')
  assert.match(SHELL, /<OfflineBar \/>/, 'import 만 하고 안 그린다')
})

test('★ 연결이 돌아오면 아무것도 안 눌러도 올라간다', () => {
  assert.match(BAR, /addEventListener\('online'/, '복구를 감지하지 않는다')
  assert.match(BAR, /const goOnline = \(\) => \{[^}]*void sync\(\)/, '복구해도 안 올린다')
})

test('★ 복구할 때 「연결 없음」을 반드시 지운다 — 안 지우면 영원히 붙박인다', () => {
  // 실측 2026-08-31: 인터넷이 멀쩡한데 배너가 계속 「연결 없음」이었다.
  // goOnline 이 setOnline(true) 만 하고 status 를 안 건드려서, 한 번 켜진 OFFLINE 이
  // 밀린 것이 0건일 때(=sync 가 조기 반환) 아무도 안 지웠다.
  assert.match(BAR, /const goOnline = \(\) => \{[^}]*setStatus\(null\)/,
    '복구해도 OFFLINE 상태를 안 지운다 — 배너가 영원히 남는다')
})

test('★ 온라인이면 OFFLINE 상태가 화면에 살아남지 못한다 — 파생으로 못 박는다', () => {
  assert.match(BAR, /online && status === 'OFFLINE' \? null : status/,
    '상태가 붙박이면 지우는 코드를 하나 놓쳤을 때 그대로 새어 나간다')
})

test('★ 이벤트를 놓쳐도 화면으로 돌아오면 다시 잰다 — 배경 탭에서 흔히 샌다', () => {
  assert.match(BAR, /addEventListener\('visibilitychange'/, '돌아왔을 때 다시 재지 않는다')
  assert.match(BAR, /addEventListener\('focus'/, '창을 다시 잡았을 때 다시 재지 않는다')
  assert.match(BAR, /removeEventListener\('visibilitychange'/, '정리하지 않으면 리스너가 쌓인다')
  assert.match(BAR, /removeEventListener\('focus'/, '정리하지 않으면 리스너가 쌓인다')
})

/*
 * ⚠️ 여기 있던 가드 「잃을 것이 없으면 연결 없음을 띄우지 않는다」를 **바꿨다** (v0.10.726).
 *
 * 그 규칙은 이 줄의 일이 「끊겼지만 쓴 것은 안전하다」 하나일 때만 맞았다. 밀린 것이 0건이면
 * 안심시킬 것이 없으니 조용히 있으라는 뜻이었고, 그때는 옳았다.
 *
 * 그런데 실측 2026-09-30, 사용자가 전날 열어 둔 CRM 첫 화면에서 「녹음 시작」을 눌렀고
 * 화면에 뜬 말이 「Failed to fetch」였다. 서버는 내려가 있었고 화면만 살아 있었다 —
 * 딜이 「32일째」라고 적혀 있었는데 그날 서버가 세면 33일째였다. 밀린 것은 0건이었으므로
 * 이 줄은 규칙대로 **아무 말도 하지 않았다.**
 *
 * 그래서 규칙을 고쳤다. 조용히 있어도 되는 조건은 「잃을 것이 없을 때」가 아니라
 * **「닿을 때」**다. 안 닿는 동안에는 밀린 것이 0건이어도 말해야 한다 —
 * 그때 화면에 보이는 값은 전부 지난 것이고, 그때 누르는 것은 전부 실패한다.
 */
test('★ 안 닿으면 밀린 것이 0건이어도 말한다 — 이번 사고의 자리다', () => {
  // 「!reachable 이면 UNREACHABLE」이 pending 을 안 본다는 것을 값으로 확인한다.
  // 이름만 찾으면 `pending > 0 && !reachable` 같은 판으로 되돌아가도 통과한다.
  const branch = BAR.slice(BAR.indexOf('const key: SyncStatusKey | null'), BAR.indexOf('if (!key) return null'))
  assert.match(branch, /!reachable\s*\n?\s*\? 'UNREACHABLE'/, '안 닿을 때 말하는 자리가 없다')
  assert.ok(!/UNREACHABLE[^\n]*pending/.test(branch), '안 닿는데 밀린 것 수를 따진다 — 0건이면 또 침묵한다')
})

test('★ 닿고 밀린 것도 없으면 조용하다 — 늘 떠 있는 배너는 아무도 안 본다', () => {
  const branch = BAR.slice(BAR.indexOf('const key: SyncStatusKey | null'), BAR.indexOf('if (!key) return null'))
  assert.match(branch, /live \?\? \(pending > 0 \? 'QUEUED' : null\)/, '닿을 때도 무언가를 계속 띄운다')
})

test('밀린 것이 없으면 아무 말도 안 한다 — 늘 떠 있으면 아무도 안 본다', () => {
  assert.match(BAR, /if \(!key\) return null/, '항상 렌더한다')
})

/* ── ⑤ 연결 판정의 근거 (v0.10.726) ──────────────────────── */

test('★ 연결 판정이 navigator.onLine 하나에 걸려 있지 않다 — 그 값은 서버를 모른다', () => {
  // 실측 2026-09-30: 와이파이는 멀쩡했고 navigator.onLine 은 true 였다. 죽은 것은 서버였다.
  assert.match(BAR, /pingServer\(/, '실제로 물어보지 않는다 — 기기 상태만 보고 판정한다')
  assert.match(BAR, /await pingServer\(\(url, init\) => fetch\(url, init\)\)/,
    'ping 을 import 만 하고 안 부른다')
})

test('★ 재는 일이 주기적으로 스스로 돈다 — 사고는 사용자가 아무것도 안 하는 동안 일어난다', () => {
  assert.match(BAR, /setInterval\(/, '한 번만 재고 만다 — 열어 둔 탭은 영원히 어제 상태다')
  assert.match(BAR, /clearInterval\(/, '정리하지 않으면 타이머가 쌓인다')
})

test('★ 배경 탭에서는 묻지 않는다 — 안 보는 화면의 연결 상태는 아무에게도 필요 없다', () => {
  const timer = BAR.slice(BAR.indexOf('setInterval('))
  assert.match(timer.slice(0, timer.indexOf('}, suspect')), /visibilityState === 'hidden'\) return/,
    '배경 탭에서도 계속 서버를 두드린다')
})

test('★ 한 번 어긋나면 그때부터 자주 묻는다 — 판정까지 30초를 두 번 기다리면 늦다', () => {
  // 실측: 어긋난 뒤에도 30초 간격을 유지하니 배너가 60초 뒤에야 떴다.
  assert.match(BAR, /setSuspect\(streakRef\.current > 0\)/, '어긋난 것을 간격에 반영하지 않는다')
  assert.match(BAR, /\}, suspect \? PING_EVERY_DOWN_MS : PING_EVERY_MS\)/,
    '판정이 끝난 뒤에야 간격을 줄인다 — 그러면 판정 자체가 늦어진다')
})

test('★ 살아나면 아무것도 안 눌러도 배너가 사라진다 — 돌아온 순간에만 올린다', () => {
  const measure = measureBody()
  assert.match(measure, /nextFailureStreak\(streakRef\.current, answered\)/, '실패 셈을 안 굴린다')
  assert.match(measure, /setReachable\(!down\)/, '잰 결과를 화면에 안 넘긴다')
  assert.match(measure, /if \(!down && wasDownRef\.current\)/,
    '돌아온 순간을 안 가른다 — 닿는 동안 계속 올리기를 걸면 재는 일이 서버를 누른다')
})

test('★ 기기가 끊겨 있으면 묻지 않는다 — 답이 뻔한 요청을 던지지 않는다', () => {
  const measure = measureBody()
  assert.match(measure, /deviceOnline\s*\n?\s*\? await pingServer/, '끊긴 줄 알면서도 물어본다')
})

test('★ 끊긴 것과 안 답하는 것을 갈라 말한다 — 사람이 할 일이 다르다', () => {
  assert.equal(SYNC_STATUS_META.OFFLINE.status, 'note', '기기가 끊긴 것은 우리 고장이 아니다')
  assert.equal(SYNC_STATUS_META.UNREACHABLE.status, 'blocker', '서버가 안 답하는 것은 고장이다')
  assert.notEqual(SYNC_STATUS_META.OFFLINE.label, SYNC_STATUS_META.UNREACHABLE.label)
})

test('★ 안 닿을 때 «값이 언제 것인지»를 말한다 — 이 한 줄이 없어서 사고가 났다', () => {
  assert.match(BAR, /key === 'UNREACHABLE' &&[\s\S]{0,120}마지막으로 받은 것/,
    '안 닿는다고만 하고 화면의 값이 지난 것이라는 말을 안 한다')
})

/* ── ⑥ 오프라인에서 시작한 회의가 서버로 건너가는가 (v0.10.739) ───────
   사용자 지시 2026-09-30: "어떤 상황이든 누락되는게 발생되면 안되는거야
   오프라인에서도 되게 만들어". 부품이 다 있어도 **부르는 자리**가 없으면
   그 회의는 기기에만 남고 아무도 못 본다. 그 자리를 값으로 센다. */

test('★ 올리기 전에 회의를 서버로 건넨다 — 순서가 뒤집히면 올릴 주소가 없다', () => {
  const body = BAR.slice(BAR.indexOf('const sync = useCallback'), BAR.indexOf('const measure = useCallback'))
  const reconcileAt = body.indexOf('reconcilePendingMeetings(')
  const syncAt = body.indexOf('syncPendingParts(')
  assert.ok(reconcileAt > 0, 'reconcile 을 아예 안 부른다 — 오프라인 회의가 영영 안 올라간다')
  assert.ok(syncAt > reconcileAt, '올린 다음에 건넨다 — 그 판에서는 올릴 주소가 없다')
})

test('★ 녹음 중인 회의는 안 건네도록 넘긴다 — 건너면 그 뒤 구간이 고아가 된다', () => {
  assert.match(BAR, /reconcilePendingMeetings\(\{ activeNoteId: activeNoteIdRef\.current \}\)/,
    '지금 녹음 중인 회의를 안 알려 준다')
})

test('★ 아직 안 건너간 구간이 있으면 「다 됐다」고 말하지 않는다', () => {
  assert.match(BAR, /r\.waitingLocal > 0/, '남은 것을 안 센다')
  assert.match(BAR, /아직 서버로 안 건너간 구간/, '남은 것을 말하지 않는다')
})

test('★ 기기가 만든 회의에는 링크를 안 건다 — 누르면 오프라인에서 화면이 죽는다', () => {
  assert.match(RECBAR, /const local = isLocalNoteId\(rec\.target\.noteId\)/, '로컬 회의를 가르지 않는다')
  assert.match(RECBAR, /\{!local && \(\s*<Link/, '로컬 회의에도 링크를 건다')
})

test('★ 기기가 만든 회의에서 상주 바가 사라지지 않는다 — 녹음 중이라는 유일한 표시다', () => {
  // href 를 현재 화면으로 두므로, 로컬을 안 가르면 「그 회의 화면에 있음」으로 보고 통째로 숨긴다
  assert.match(RECBAR, /const onTargetScreen = !local && pathname ===/,
    '로컬 회의에서도 화면이 같다는 이유로 바를 숨긴다')
  assert.match(RECBAR, /이 기기에 저장 중/, '어디에 저장되고 있는지 안 말한다')
})

/* ── ④ 셸이 뜬다 (PWA) ──────────────────────────────────── */

test('★ API 응답을 캐시하지 않는다 — 낡은 영업 데이터를 맞다고 믿게 된다', () => {
  assert.match(SW, /url\.pathname\.startsWith\('\/api\/'\)\) return true/,
    '/api/ 를 통과시키지 않는다 — 캐시되면 지난주 파이프라인이 오늘 값으로 보인다')
})

test("★ 쓰기 요청은 가로채지 않는다 — 저장이 캐시에 삼켜지면 안 된다", () => {
  assert.match(SW, /request\.method !== 'GET'\) return true/, 'GET 이 아닌 요청을 가로챈다')
})

test('★ HTML 은 network-first 다 — 연결이 있으면 언제나 새것을 준다', () => {
  const nav = SW.slice(SW.indexOf("mode === 'navigate'"))
  const fetchAt = nav.indexOf('fetch(event.request)')
  const cacheAt = nav.indexOf('caches.match(event.request)')
  assert.ok(fetchAt > 0 && cacheAt > fetchAt,
    '캐시를 먼저 본다 — 배포해도 옛 화면이 남는다')
})

test('★ 받은 적 없는 화면은 로그인 화면이 아니라 「연결 없음」을 준다', () => {
  assert.match(SW, /PRECACHE = \['\/offline'/, '/offline 을 미리 받아 두지 않는다')
  assert.match(SW, /caches\.match\('\/offline'\)/, '오프라인 폴백으로 쓰지 않는다')
})

test('★ /offline·/sw.js 는 세션 게이트를 타지 않는다 — 타면 로그인 화면이 캐시된다', () => {
  for (const p of ["'/sw.js'", "'/manifest.webmanifest'", "'/offline'"]) {
    assert.ok(MW.includes(`pathname === ${p}`), `${p} 가 공개 경로가 아니다`)
  }
})

test('★ 개발에서는 켜지 않고 오히려 해제한다 — 공유 dev 서버가 옛 청크를 문다', () => {
  assert.match(BOOT, /NODE_ENV !== 'production'/, '개발·배포를 구분하지 않는다')
  const dev = BOOT.slice(BOOT.indexOf("NODE_ENV !== 'production'"))
  assert.match(dev.slice(0, dev.indexOf('// load')), /unregister\(\)/,
    '개발에서 기존 워커를 해제하지 않는다 — 프로덕션을 열어 본 브라우저가 localhost 를 오염시킨다')
})

test('★ 등록 컴포넌트가 루트 레이아웃에 실제로 꽂혀 있다 — 만들고 안 붙이면 없는 기능이다', () => {
  assert.match(ROOT, /import ServiceWorkerBoot/, '루트가 import 하지 않는다')
  assert.match(ROOT, /<ServiceWorkerBoot \/>/, 'import 만 하고 안 그린다')
})

test('설치 아이콘 이름은 브랜딩 SSOT 에서 온다 — 화면과 다른 이름을 쓰지 않는다', () => {
  assert.match(MANIFEST, /getBranding\(\)/, '앱 이름을 하드코딩했다')
  assert.ok(!/name: '[A-Za-z]/.test(MANIFEST), '고정 문자열 이름이 남아 있다')
})
