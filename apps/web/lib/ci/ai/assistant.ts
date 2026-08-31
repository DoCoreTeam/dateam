// lib/ci/ai/assistant.ts — 자연어 → Command 매핑 (순수 함수)
// 설계: 02-command-catalog.md
//
// guarded 등급은 실행하지 않고 제안만 한다. 되돌리기 어려운 일을 AI가 몰래 하지 않는다.

export type CommandRisk = 'safe' | 'write' | 'guarded'

export interface CommandSpec {
  name: string
  risk: CommandRisk
  description: string
  /** 어시스턴트 경로에서 아예 제외 */
  assistantBlocked?: boolean
}

export const COMMANDS: CommandSpec[] = [
  { name: 'trends.outliers', risk: 'safe', description: '지정한 조건의 떡상 목록을 봅니다' },
  { name: 'trends.market', risk: 'safe', description: '시장 개요를 봅니다' },
  { name: 'trends.patterns', risk: 'safe', description: '성공 공식을 봅니다' },
  { name: 'trends.signals', risk: 'safe', description: '등록된 이슈를 봅니다' },
  { name: 'inbox.list', risk: 'safe', description: '수집함을 봅니다' },
  { name: 'inbox.review', risk: 'safe', description: '검토가 필요한 항목을 봅니다' },
  { name: 'channels.list', risk: 'safe', description: '관심 채널 목록을 봅니다' },
  { name: 'channels.latest', risk: 'safe', description: '특정 관심 채널에 새로 올라온 게시물과 마지막 수집 시각을 봅니다' },
  { name: 'pipeline.list', risk: 'safe', description: '제작 중인 아이디어를 봅니다' },
  { name: 'performance.mine', risk: 'safe', description: '내 콘텐츠 성과를 봅니다' },
  { name: 'ingest.add', risk: 'write', description: '링크를 수집함에 넣습니다' },
  { name: 'channel.track', risk: 'write', description: '관심 채널로 등록합니다' },
  { name: 'idea.create', risk: 'write', description: '아이디어를 만듭니다' },
  { name: 'signal.add', risk: 'write', description: '이슈를 기록합니다' },
  { name: 'brief.generate', risk: 'guarded', description: 'AI로 기획안을 만듭니다 (사용량을 씁니다)' },
  { name: 'publish.now', risk: 'guarded', description: '실제로 게시합니다', assistantBlocked: true },
  { name: 'setting.set', risk: 'guarded', description: '설정을 바꿉니다' },
  { name: 'topic.reclassify', risk: 'guarded', description: '전체 재분류를 돌립니다' },
  { name: 'workspace.delete', risk: 'guarded', description: '워크스페이스를 삭제합니다', assistantBlocked: true },
]

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]))

export function getCommand(name: string): CommandSpec | undefined {
  return BY_NAME.get(name)
}

/** 어시스턴트가 실제로 실행해도 되는가. guarded와 차단 커맨드는 제안까지만. */
export function isExecutable(name: string): boolean {
  const c = BY_NAME.get(name)
  if (!c || c.assistantBlocked) return false
  return c.risk === 'safe' || c.risk === 'write'
}

export interface Intent {
  command: string
  args: Record<string, string | number | boolean>
  /** 사용자에게 보여줄 한 줄 설명 */
  say: string
}

const URL_RE = /https?:\/\/\S+/gi

/**
 * 규칙 기반 의도 해석.
 * LLM 없이도 흔한 요청은 처리한다 — AI 키가 없다고 어시스턴트가 죽지 않는다.
 */
export function parseIntent(message: string): Intent | null {
  const m = message.trim()
  const lower = m.toLowerCase()

  // 링크가 들어오면 수집이 우선이다
  const urls = m.match(URL_RE)
  if (urls && urls.length > 0) {
    const isChannel = /채널|구독|관심/.test(m) && !/영상|게시물/.test(m)
    if (isChannel) {
      return {
        command: 'channel.track',
        args: { input: urls[0] },
        say: '관심 채널로 등록할게요',
      }
    }
    return {
      command: 'ingest.add',
      args: { urls: urls.join(' ') },
      say: `링크 ${urls.length}건을 수집함에 넣을게요`,
    }
  }

  if (/떡상|잘된|잘 된|터진/.test(m)) {
    const windowDays = /이번\s*주|일주일|7일/.test(m) ? 7 : /90일|석 달|3개월/.test(m) ? 90 : 28
    return { command: 'trends.outliers', args: { windowDays }, say: `최근 ${windowDays}일 떡상을 보여드릴게요` }
  }
  if (/시장|전체 흐름|분포/.test(m)) {
    return { command: 'trends.market', args: {}, say: '시장 개요를 보여드릴게요' }
  }
  if (/공식|패턴|먹히는/.test(m)) {
    return { command: 'trends.patterns', args: {}, say: '확인된 성공 공식을 보여드릴게요' }
  }
  if (/이슈|뉴스|화제/.test(m)) {
    return { command: 'trends.signals', args: {}, say: '등록된 이슈를 보여드릴게요' }
  }
  if (/검토|확인 필요|애매/.test(m)) {
    return { command: 'inbox.review', args: {}, say: '검토가 필요한 항목을 보여드릴게요' }
  }
  if (/수집함|모은 것|담은/.test(m)) {
    return { command: 'inbox.list', args: {}, say: '수집함을 보여드릴게요' }
  }
  // "추성훈 채널 신규 컨텐츠 올라왔어?" — 그 채널에 새로 들어온 게시물.
  //
  // 왜 규칙이 먼저인가(실측 2026-08-31): 이 문장은 정규식에 걸리는 것이 없어 AI로 내려갔고,
  // 같은 프롬프트가 2초~60초를 오갔다. 그런데 정작 AI 는 정확히 `command: null` 을 냈다 —
  // **카탈로그에 이 일을 할 명령이 없었기 때문**이다. 모델이 틀린 게 아니라 할 수 있는 일이 없었다.
  // 명령을 만들고 규칙으로 먼저 잡으면 같은 질문이 AI 호출 없이 즉답된다.
  //
  // channels.list 보다 위에 둔다 — "관심 채널에 새 거 올라왔나"가 목록으로 새면 답이 어긋난다.
  if (/올라왔|올라온|새로 ?올|업로드|신규|새 ?(영상|게시물|콘텐츠|컨텐츠|거|것)|최근 ?(영상|게시물|콘텐츠|컨텐츠)/.test(m)) {
    // 채널 이름은 「… 채널」 앞자리에서만 읽는다. 없으면 전체 관심 채널을 훑는다 —
    // 문장 전체를 이름으로 삼으면 어떤 채널과도 안 맞아 "없다"고 답하게 된다.
    const named = m.match(/^(.*?)\s*채널/)
    const query = named ? named[1].trim() : ''
    return {
      command: 'channels.latest',
      args: query ? { query } : {},
      say: query ? `${query} 채널에 새로 올라온 게시물을 확인할게요` : '관심 채널에 새로 올라온 게시물을 확인할게요',
    }
  }
  if (/관심\s*채널|채널 목록|지켜보/.test(m)) {
    return { command: 'channels.list', args: {}, say: '관심 채널을 보여드릴게요' }
  }
  if (/제작|파이프라인|아이디어 목록|진행/.test(m)) {
    return { command: 'pipeline.list', args: {}, say: '제작 중인 아이디어를 보여드릴게요' }
  }
  if (/성과|내 콘텐츠|얼마나/.test(m)) {
    return { command: 'performance.mine', args: {}, say: '내 콘텐츠 성과를 보여드릴게요' }
  }
  if (/기획안/.test(m)) {
    return { command: 'brief.generate', args: {}, say: '기획안 생성은 AI 사용량을 씁니다. 파이프라인에서 직접 눌러 주세요' }
  }
  if (/설정|바꿔|변경/.test(lower)) {
    return { command: 'setting.set', args: {}, say: '설정 변경은 설정 화면에서 직접 확인하고 바꿔 주세요' }
  }
  if (/아이디어\s*(만들|추가|생성)/.test(m)) {
    const title = m.replace(/아이디어\s*(만들어줘|만들기|추가|생성)?/g, '').trim()
    if (title) return { command: 'idea.create', args: { title }, say: `"${title}" 아이디어를 만들게요` }
  }

  return null
}
