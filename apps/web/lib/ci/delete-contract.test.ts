import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..')
const read = (p: string) => readFileSync(join(web, p), 'utf8')

// 이 저장소의 CI 삭제는 **진짜 삭제**다(사용자 결정 2026-08-16).
// 되돌리기가 없으므로 실수 경로 하나가 곧 데이터 소실이다. 아래 넷을 잠근다:
//   ① 워크스페이스 격리 — id만으로 지우면 남의 데이터가 사라진다
//   ② 권한은 모듈(CI) 멤버십 기준 — 앱 전역 admin으로 갈리면 확장이 막힌다
//   ③ 확인 대화상자 없이 지우는 길이 없다
//   ④ 폴리모픽 고아(ci_board_items)를 코드가 직접 치운다 — DB가 안 해 준다

const DELETE_ROUTES = [
  'app/api/ci/contents/[id]/route.ts',
  'app/api/ci/channels/[id]/route.ts',
  'app/api/ci/boards/[id]/route.ts',
  'app/api/ci/boards/[id]/items/route.ts',
  'app/api/ci/ideas/[id]/route.ts',
  'app/api/ci/briefs/[id]/route.ts',
  'app/api/ci/edit-plans/route.ts',
  'app/api/ci/publications/[id]/route.ts',
]

test('삭제 라우트가 모두 존재한다 — 하나라도 빠지면 그 화면만 못 지운다', () => {
  for (const r of DELETE_ROUTES) {
    assert.ok(existsSync(join(web, r)), `${r} 가 없다`)
    assert.match(read(r), /export async function DELETE/, `${r} 에 DELETE가 없다`)
  }
})

test('★ 삭제는 CI 워크스페이스 멤버 기준이다 — 앱 전역 admin으로 갈리면 확장이 막힌다', () => {
  for (const r of DELETE_ROUTES) {
    const body = read(r).slice(read(r).indexOf('export async function DELETE'))
    assert.match(body, /requireCiMemberApi\([^)]*'member'\)/,
      `${r} 의 삭제 권한이 CI 멤버 기준이 아니다`)
    assert.doesNotMatch(body, /requireCiMemberApi\([^)]*'(admin|owner)'\)/,
      `${r} 이 모듈 멤버십보다 높은 권한을 요구한다 — 다른 변경 API와 어긋난다`)
  }
})

test('★ 삭제 판정은 SSOT를 거친다 — 라우트가 직접 delete를 치면 격리·고아 정리를 빠뜨린다', () => {
  for (const r of DELETE_ROUTES) {
    const body = read(r).slice(read(r).indexOf('export async function DELETE'))
    assert.match(body, /deleteCiEntity\(/, `${r} 이 삭제 SSOT를 쓰지 않는다`)
    assert.doesNotMatch(body, /\.delete\(\)/, `${r} 이 직접 delete를 친다`)
  }
})

test('★ SSOT가 워크스페이스 조건을 항상 건다 — 서비스 롤이라 RLS가 막아 주지 않는다', () => {
  const src = read('lib/ci/queries/delete.ts')
  const del = src.slice(src.indexOf('export async function deleteCiEntity'))
  assert.match(del, /\.eq\('workspace_id', workspaceId\)/,
    '삭제에 워크스페이스 조건이 없다 — 남의 데이터를 지울 수 있다')
  // 보드 항목은 workspace_id가 없어 소속을 미리 확인해야 한다
  assert.match(del, /previewDelete\('boardItem'/,
    '보드 항목 삭제가 소속 확인 없이 지운다')
})

test('★ 폴리모픽 고아를 코드가 치운다 — ci_board_items에는 FK가 없다', () => {
  const src = read('lib/ci/queries/delete.ts')
  assert.match(src, /from\('ci_board_items'\)\s*\.delete\(\)[\s\S]{0,200}?item_type/,
    '본체를 지울 때 보드 항목을 함께 치우지 않는다 — 없는 게시물이 보드에 남는다')
})

test('★ 확인 없이 지우는 길이 없다 — 되돌릴 수 없으므로 확인이 유일한 안전장치다', () => {
  const hook = read('lib/ci/use-delete.ts')
  // confirm은 pending(=ask로 열린 상태)이 있어야만 동작한다
  assert.match(hook, /if \(!pending\) return/,
    'ask 없이 confirm이 지워 버린다')
  const screens = [
    'app/(ci)/ci/inbox/InboxView.tsx',
    'components/ci/ChannelListView.tsx',
    'app/(ci)/ci/boards/BoardsView.tsx',
    'app/(ci)/ci/pipeline/PipelineView.tsx',
    'app/(ci)/ci/publish/PublishView.tsx',
  ]
  for (const f of screens) {
    const s = read(f)
    assert.match(s, /\buseCiDelete\(/, `${f} 이 공용 삭제 흐름을 쓰지 않는다`)
    assert.match(s, /<ConfirmDeleteDialog[\s/>]/, `${f} 에 확인 대화상자가 없다`)
    assert.doesNotMatch(s, /method:\s*'DELETE'/,
      `${f} 이 확인을 건너뛰고 직접 DELETE를 친다`)
  }
})

test('★ 수집값은 수정 대상이 아니다 — 손으로 고치면 배수가 거짓이 된다', () => {
  const src = read('app/api/ci/contents/[id]/route.ts')
  const patch = src.slice(src.indexOf('const Patch = z.object'), src.indexOf('export async function PATCH'))
  for (const forbidden of ['views', 'publishedAt', 'published_at', 'channelId', 'platform', 'durationSec']) {
    assert.ok(!patch.includes(forbidden), `수집값 ${forbidden} 이 수정 가능하게 열려 있다`)
  }
  for (const allowed of ['title', 'topicId', 'statExcluded']) {
    assert.ok(patch.includes(allowed), `${allowed} 수정이 빠졌다`)
  }
})

test('삭제 미리보기도 지울 수 있는 사람만 본다 — 남의 구성을 엿보는 창구가 되면 안 된다', () => {
  const src = read('app/api/ci/delete-preview/route.ts')
  assert.match(src, /requireCiMemberApi\([^)]*'member'\)/)
})
