import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  digestProgress, formatElapsed, readingWhat,
  DIGEST_START_MS, DIGEST_LONG_MS, DIGEST_VERY_LONG_MS,
} from './digest-progress.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PANEL = 'components/meeting/MeetingDigestPanel.tsx'

describe('정리 진행 문구 — 5분 동안 침묵하지 않는다', () => {
  const src = { memoChars: 218, segmentCount: 406 }

  it('막 눌렀을 때는 시작했다고만 말한다 — 곧바로 상세를 말하면 깜빡인다', () => {
    assert.equal(digestProgress({ ...src, elapsedMs: 0 }).message, '정리를 시작했어요')
    assert.equal(digestProgress({ ...src, elapsedMs: DIGEST_START_MS - 1 }).message, '정리를 시작했어요')
  })

  it('★ 곧 무엇을 읽는지 말한다 — 숫자가 근거다', () => {
    const v = digestProgress({ ...src, elapsedMs: DIGEST_START_MS })
    assert.equal(v.message, '메모 218자와 녹음 406줄을 함께 읽고 있어요')
    assert.equal(v.reassure, null, '평소에는 덧말을 붙이지 않는다')
  })

  it('★ 없는 것을 세지 않는다 — 「녹음 0줄」은 실패로 읽힌다', () => {
    assert.equal(readingWhat(218, 0), '메모 218자를 읽고 있어요')
    assert.equal(readingWhat(0, 406), '녹음 406줄을 읽고 있어요')
    assert.doesNotMatch(readingWhat(218, 0), /0줄/)
    assert.doesNotMatch(readingWhat(0, 406), /0자/)
  })

  it('둘 다 모를 때 숫자를 지어내지 않는다', () => {
    assert.equal(readingWhat(0, 0), '회의 내용을 읽고 있어요')
    assert.doesNotMatch(readingWhat(0, 0), /\d/)
  })

  it('★ 오래 걸리면 오래 걸린다고 밝힌다 — 침묵이 고장으로 읽힌다', () => {
    assert.equal(digestProgress({ ...src, elapsedMs: DIGEST_LONG_MS - 1 }).reassure, null)
    assert.match(digestProgress({ ...src, elapsedMs: DIGEST_LONG_MS }).reassure ?? '', /나눠 읽고/)
    assert.match(digestProgress({ ...src, elapsedMs: DIGEST_VERY_LONG_MS }).reassure ?? '', /거의 다/)
  })

  it('경과 시간 — 분이 0이면 분을 적지 않는다', () => {
    assert.equal(formatElapsed(0), '0초')
    assert.equal(formatElapsed(12_400), '12초')
    assert.equal(formatElapsed(80_000), '1분 20초')
    assert.equal(formatElapsed(-5), '0초', '음수도 0초로 — 시계 어긋남에 화면이 깨지지 않게')
  })

  it('경계가 순서대로다 — 상수를 잘못 고치면 단계가 뒤집힌다', () => {
    assert.ok(DIGEST_START_MS < DIGEST_LONG_MS && DIGEST_LONG_MS < DIGEST_VERY_LONG_MS)
  })
})

describe('정리 화면 — 첫 정리에도 진행이 보인다 (이번 결함 그 자체)', () => {
  it('★ 진행 표시가 «결과가 있을 때»에 갇혀 있지 않다', () => {
    const s = read(PANEL)
    const progressAt = s.indexOf('digestProgress')
    const branchAt = s.indexOf('!latest ?')
    assert.ok(progressAt > -1, '패널이 진행 SSOT 를 써야 한다')
    assert.ok(branchAt > -1, '빈 상태 분기를 찾지 못했다 — 가드가 헛돈다')
    assert.ok(progressAt < branchAt,
      '진행 표시는 «결과 있음/없음» 분기보다 **먼저** 그려져야 한다.\n' +
      '분기 안에 두면 첫 정리에서 또 침묵한다 — 그게 이번 결함이다.')
  })

  it('★ 도는 동안 다시 못 누른다 — 여러 번 눌리면 AI 호출이 그만큼 낭비된다', () => {
    const s = read(PANEL)
    assert.doesNotMatch(s, /action=\{canEdit \? \{ label: '전체 정리하기'/,
      '빈 상태의 action 버튼은 running 을 모른다 — 실행 버튼을 한 벌로 모아야 한다')
    assert.match(s, /disabled=\{running\}/, '실행 버튼은 도는 동안 잠긴다')
  })

  it('진행 표시가 실제로 렌더된다 — import 만 해 두고 안 쓰면 통과하면 안 된다', () => {
    const s = read(PANEL)
    assert.match(s, /\{running && /, 'running 일 때 그리는 블록이 있어야 한다')
  })
})

describe('받아적은 내용 — 페이지가 무한히 길어지지 않는다', () => {
  const VIEW = 'components/meeting/MeetingTranscriptView.tsx'

  it('★ 목록이 높이 상자 안에 있다 — 406줄이 페이지를 늘리던 것이 결함이었다', () => {
    const s = read(VIEW)
    assert.match(s, /styles\.transcriptBox/, '상자 클래스를 붙여야 한다')
    const css = read('components/meeting/workbench.module.css')
    assert.match(css, /\.transcriptBox\s*\{[^}]*max-height/, '상자에 높이 상한이 있어야 한다')
    assert.match(css, /\.transcriptBox\s*\{[^}]*overflow-y:\s*auto/, '상자 안에서 넘겨 볼 수 있어야 한다')
  })

  it('★ 줄을 지우지 않는다 — 지우면 정리의 「근거」가 그 줄을 못 찾는다', () => {
    const s = read(VIEW)
    assert.doesNotMatch(s, /segments\.slice\(/,
      'slice 로 잘라내면 scrollIntoView 로 찾아가는 근거 기능이 죽는다. 높이만 가둔다')
  })

  it('펼치고 접을 수 있다 — 상자가 답답할 때 빠져나갈 길', () => {
    assert.match(read(VIEW), /setExpanded/)
  })
})

describe('내보내기 — 전사와 정리도 문서로 나간다', () => {
  it('★ 전사 탭과 정리 탭에 내보내기가 있다 — 예전엔 작성 탭에만 있었다', () => {
    assert.match(read('components/meeting/MeetingTranscriptView.tsx'), /view="transcript"/)
    assert.match(read('components/meeting/MeetingDigestPanel.tsx'), /view="digest"/)
  })

  it('★ 라우트가 데이터를 실제로 실어 보낸다 — 뷰만 늘리면 빈 문서가 나간다', () => {
    const s = read('app/api/meeting-notes/[id]/export/route.ts')
    assert.match(s, /listTranscriptSegments/, '전사를 읽어야 한다')
    assert.match(s, /listMeetingDigests/, '정리를 읽어야 한다')
    assert.match(s, /segments,/, '빌더에 전사를 넘겨야 한다')
    assert.match(s, /digest,/, '빌더에 정리를 넘겨야 한다')
  })

  it('★ 내보내기는 한 줄도 줄이지 않는다 — 종이에는 「전체 보기」를 누를 사람이 없다', () => {
    const s = read('lib/meeting/export-html.ts')
    const fn = s.slice(s.indexOf('function renderTranscript'), s.indexOf('function renderDigest'))
    assert.ok(fn.length > 100, '전사 렌더러를 못 찾았다 — 가드가 헛돈다')
    assert.doesNotMatch(fn, /\.slice\(0,|MAX_|limit/, '내보내기에 상한을 두지 않는다')
  })

  it('뷰 이름을 화면이 짓지 않는다 — 빌더가 정한 라벨을 쓴다(§0-2)', () => {
    assert.match(read('app/(member)/meeting-notes/MeetingExportModal.tsx'), /EXPORT_VIEW_LABEL\[view\]/)
  })
})

describe('공개 범위 — 열자마자 보인다', () => {
  const DETAIL = 'app/(member)/meeting-notes/MeetingDetailClient.tsx'
  const CARD = 'app/(member)/meeting-notes/CrmPublishCard.tsx'

  it('★ 배지가 제목 옆이다 — 예전엔 288줄 중 284번째라 스크롤해야 닿았다', () => {
    const s = read(DETAIL)
    assert.match(s, /titleAfter=\{<CrmPublishCard/, '제목에 붙어야 한다')
    const at = s.indexOf('<CrmPublishCard')
    assert.ok(at / s.length < 0.65,
      `화면 아래쪽(${Math.round(at / s.length * 100)}%)에 있다 — 첫 화면에서 보여야 한다`)
  })

  it('★ 손잡이가 하나뿐이다 — 둘이면 어느 쪽이 진짜인지 모른다', () => {
    assert.equal((read(DETAIL).match(/<CrmPublishCard/g) ?? []).length, 1)
  })

  it('★ 로딩 중에 사라지지 않는다 — 늦게 나타나는 것은 「없다」로 읽힌다', () => {
    const s = read(CARD)
    assert.doesNotMatch(s, /phase === 'loading' \|\| phase === 'no-access'/,
      '로딩을 no-access 와 같이 묶어 감추면 배지가 뒤늦게 나타난다')
    assert.match(s, /initialShareState\(visibility\)/,
      '서버가 이미 아는 visibility 로 첫 렌더부터 그려야 한다')
  })

  it('CRM 을 못 쓰는 사람에게는 여전히 안 보인다 — 못 쓰는 손잡이를 주지 않는다', () => {
    assert.match(read(CARD), /if \(phase === 'no-access'\) return null/)
  })

  it('배지를 눌러 그 자리에서 바꾼다 · ESC 로 닫힌다(§2-2)', () => {
    const s = read(CARD)
    assert.match(s, /aria-expanded=\{open\}/)
    assert.match(s, /useEscClose/)
  })

  it('★ 보는 것과 고치는 것이 다름을 밝힌다 — 안 밝히면 팀원이 「왜 수정이 안 되지」로 겪는다', () => {
    assert.match(read(CARD), /작성한 사람만 할 수 있어요/)
  })
})

describe('CRM 미팅 목록 — 「가져오기」 버튼이 사라졌다', () => {
  const LIST = 'app/(crm)/crm/meetings/MeetingsClient.tsx'

  it('★ 가져오기 버튼과 고르기 모달이 없다 — 내가 쓴 것을 «가져올» 이유가 없다', () => {
    const s = read(LIST)
    assert.doesNotMatch(s, /회의노트에서 가져오기<\/NbButton>/, '버튼이 남아 있다')
    assert.doesNotMatch(s, /NbModal title="회의노트에서 가져오기"/, '고르기 모달이 남아 있다')
    assert.doesNotMatch(s, /setPickingNote/, '모달 상태가 남아 있다')
  })

  it('★ 안 올린 내 노트가 같은 목록에 선다', () => {
    const s = read(LIST)
    assert.match(s, /noteOnly: true/, '노트를 목록 행으로 만들어야 한다')
    assert.match(s, /rows=\{merged\}/, '병합한 목록을 그려야 한다')
    assert.match(s, /useEffect\(\(\) => \{ void loadNotes\(\) \}/,
      '노트를 언제나 읽어야 한다 — 모달을 열 때만 읽으면 목록에 못 선다')
  })

  it('★ 이미 올린 노트는 안 끼운다 — 끼우면 같은 회의가 목록에 두 번 나온다', () => {
    assert.match(read(LIST), /\.filter\(\(n\) => !n\.published\)/)
  })

  it('★ 노트 행은 원본으로 간다 — 없는 미팅으로 보내면 404 다', () => {
    assert.match(read(LIST), /m\.noteOnly \? `\/meeting-notes\/\$\{m\.noteId\}`/)
  })

  it('★ 배지를 눌러도 행 이동이 안 일어난다 (§2-3-1 액션 칸 전파 차단)', () => {
    assert.match(read(LIST), /e\.stopPropagation\(\)/)
  })

  it('★ 올린 뒤 목록이 갱신된다 — 그 자리에서 배지가 바뀌는 게 기대하는 결과다', () => {
    const s = read(LIST)
    assert.match(s, /await Promise\.all\(\[loadNotes\(\), load\(false, null\)\]\)/)
    assert.doesNotMatch(s, /router\.push\(meetingHref\(body\.meetingId/,
      '공개 범위를 바꿨을 뿐인데 다른 화면으로 끌고 가지 않는다')
  })

  it('배지 색을 화면이 정하지 않는다 — SSOT 가 정한다(§0-2 규칙 4)', () => {
    const s = read(LIST)
    assert.match(s, /SHARE_STATE_STATUS\[state\]/)
    const share = read('lib/meeting/share-state.ts')
    assert.match(share, /export const SHARE_STATE_STATUS/)
  })

  it('서버가 공개 상태를 함께 준다 — 건당 다시 물으면 노트 수만큼 왕복이다(N+1)', () => {
    assert.match(read('lib/crm/services/meeting-publish.ts'), /shareState: readShareState\(/)
  })
})
