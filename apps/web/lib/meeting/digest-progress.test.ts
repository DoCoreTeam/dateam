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

describe('연속성 — 회의는 사실 목록이 아니라 하나의 사건이다', () => {
  it('★ 결론 한 줄이 자료 구조에 자리를 갖는다', () => {
    const s = read('lib/meeting/digest.ts')
    assert.match(s, /outcome: string/, 'DigestResult 에 결론이 있어야 한다')
    assert.match(s, /nextStep: string/)
    assert.match(s, /because\?: string/, '안건을 건너뛰는 인과가 담겨야 한다')
  })

  it('★ 옛 정리본이 깨지지 않는다 — because 는 optional, 결론은 빈 문자열', () => {
    const s = read('lib/meeting/digest.ts')
    assert.match(s, /EMPTY_DIGEST: DigestResult = \{ outcome: '', nextStep: ''/)
    assert.doesNotMatch(s, /because: string\n/, 'because 를 필수로 만들면 옛 행이 전부 깨진다')
  })

  it('★ 저장한다 — 화면에서만 사는 값은 새로고침하면 사라진다', () => {
    const s = read('lib/meeting/digest-run.ts')
    assert.match(s, /agenda_json: \{\s*\n?\s*outcome: digest\.outcome, nextStep: digest\.nextStep/,
      'jsonb 에 결론을 함께 담아야 한다')
  })

  it('★ AI 에게 실제로 시킨다 — 타입만 늘리면 영원히 빈 값이다', () => {
    const s = read('lib/meeting/digest-prompt.ts')
    assert.match(s, /"outcome":/, '출력 형식에 결론이 있어야 한다')
    assert.match(s, /because/, '인과를 지시해야 한다')
    assert.match(s, /지어내지 마라/, '근거 없는 인과를 막아야 한다')
  })

  it('★ 메모만 있는 회의는 결론을 지어내지 않는다', () => {
    const s = read('lib/meeting/digest-run.ts')
    assert.match(s, /outcome: '',\s*\n\s*nextStep: '',/,
      '안건 구조가 없으면 결론을 만들 근거가 없다 — 빈 문자열이 정답이다')
  })

  it('★ 화면과 문서가 같은 결론을 말한다 (§2-7 D-7)', () => {
    assert.match(read('components/meeting/MeetingDigestPanel.tsx'), /current!\.digest\.outcome/)
    assert.match(read('lib/meeting/export-html.ts'), /d\.outcome/)
    assert.match(read('app/api/meeting-notes/[id]/export/route.ts'), /outcome: latest\.digest\.outcome/)
  })
})

describe('진행 문구 — 탭을 안 거쳐 들어와도 무엇을 읽는지 말한다', () => {
  it('★ 형제 탭이 안 떠 0 이면 지난 정리본의 값을 쓴다 (실브라우저에서 잡힌 결함)', () => {
    const s = read('components/meeting/MeetingDigestPanel.tsx')
    assert.match(s, /memoChars: memoChars \|\| latest\?\.sources\?\.memoChars \|\| 0/,
      '?wb=digest 로 바로 열면 형제 탭이 안 떠 카운트가 0 이 된다')
    assert.match(s, /segmentCount: segmentCount \|\| latest\?\.sources\?\.transcriptSegments \|\| 0/)
  })

  it('정말 처음 정리하는 회의는 폴백도 없다 — 그때는 모르는 게 맞다', () => {
    assert.equal(readingWhat(0, 0), '회의 내용을 읽고 있어요')
  })
})

describe('받아적은 내용 상자 — 페이지 스크롤을 가두지 않는다', () => {
  it('★ overscroll-behavior: contain 을 쓰지 않는다 (실브라우저에서 잡힌 회귀)', () => {
    const css = read('components/meeting/workbench.module.css')
    const box = css.slice(css.indexOf('.transcriptBox'), css.indexOf('.transcriptFoot'))
    assert.ok(box.length > 50, '상자 규칙을 못 찾았다 — 가드가 헛돈다')
    assert.doesNotMatch(box, /overscroll-behavior:\s*contain/,
      '커서가 상자 위에 있으면 페이지가 안 내려가 바로 아래 버튼에 닿을 수 없다')
  })
})

describe('AI 예산 — 라우트가 준 시간을 다 쓴다', () => {
  it('★ 정리가 예산을 명시한다 — 기본값(120초)에 맡기면 라우트가 4분 남았는데 포기한다', () => {
    const s = read('lib/meeting/digest-run.ts')
    assert.match(s, /timeoutMs: DIGEST_CALL_MS, overallTimeoutMs: DIGEST_OVERALL_MS/)
    assert.match(s, /timeoutMs: CONDENSE_CALL_MS, overallTimeoutMs: CONDENSE_OVERALL_MS/)
  })

  it('★ 예산이 라우트 상한을 넘지 않는다 — 넘으면 함수가 먼저 죽어 사용자가 이유를 못 듣는다', () => {
    const run = read('lib/meeting/digest-run.ts')
    const route = read('app/api/meeting-notes/[id]/digest/route.ts')
    const overall = Number(/DIGEST_OVERALL_MS = ([\d_]+)/.exec(run)?.[1]?.replace(/_/g, ''))
    const max = Number(/maxDuration = (\d+)/.exec(route)?.[1]) * 1000
    assert.ok(overall > 0 && max > 0, '값을 못 읽었다 — 가드가 헛돈다')
    assert.ok(overall < max, `AI 예산 ${overall}ms 가 라우트 상한 ${max}ms 보다 크다`)
  })

  it('★ 화자 나누기도 마찬가지다', () => {
    const s = read('app/api/meeting-notes/[id]/transcript/speakers/route.ts')
    const overall = Number(/overallTimeoutMs: ([\d_]+)/.exec(s)?.[1]?.replace(/_/g, ''))
    const max = Number(/maxDuration = (\d+)/.exec(s)?.[1]) * 1000
    assert.ok(overall > 0 && max > 0)
    assert.ok(overall < max, `AI 예산 ${overall}ms 가 라우트 상한 ${max}ms 보다 크다`)
  })
})
