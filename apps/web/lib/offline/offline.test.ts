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
const SW = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
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
  assert.match(BAR, /goOnline = \(\) => \{ setOnline\(true\); void sync\(\) \}/, '복구해도 안 올린다')
})

test('밀린 것이 없으면 아무 말도 안 한다 — 늘 떠 있으면 아무도 안 본다', () => {
  assert.match(BAR, /if \(!key\) return null/, '항상 렌더한다')
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
