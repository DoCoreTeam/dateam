// lib/ci/analysis/signal-taxonomy.ts — 플랫폼 신호 사전 (SSOT)
//
// 무엇: 플랫폼이 주는 코드값을 사람이 읽는 말로 옮긴다.
//   YouTube categoryId '22' → '인물·블로그'
//   topicCategories 'Music_of_Latin_America' → '음악'
//
// 이것은 우리가 주제를 정하는 표가 아니다. **플랫폼이 정한 코드표**를 옮겨 적은 것이다.
// 주제 체계는 워크스페이스마다 다르고 ci_topics가 정한다 — 이 파일은 그 사이의 번역기다.
//
// 왜 필요한가: 이 번역이 없으면 화면이 사용자에게 "categoryId 22"라고 말하게 된다.
// 그리고 주제 자동 제안(topic-proposal.ts)이 무엇을 제안할지 이름을 못 짓는다.

/**
 * YouTube 영상 카테고리 (snippet.categoryId).
 * 출처: YouTube Data API v3 videoCategories.list (지역 KR 기준 활성 목록).
 * 여기 없는 코드는 번역하지 않고 원문을 그대로 둔다 — 모르는 것을 아는 척하지 않는다.
 */
export const YOUTUBE_CATEGORY: Readonly<Record<string, string>> = {
  '1': '영화·애니메이션',
  '2': '자동차',
  '10': '음악',
  '15': '반려동물·동물',
  '17': '스포츠',
  '18': '단편영화',
  '19': '여행·이벤트',
  '20': '게임',
  '21': '동영상 블로그',
  '22': '인물·블로그',
  '23': '코미디',
  '24': '엔터테인먼트',
  '25': '뉴스·정치',
  '26': '노하우·스타일',
  '27': '교육',
  '28': '과학기술',
  '29': '비영리·사회운동',
  '30': '영화',
  '31': '애니메이션',
  '32': '액션·모험',
  '33': '클래식',
  '34': '코미디',
  '35': '다큐멘터리',
  '36': '드라마',
  '37': '가족',
  '38': '해외',
  '39': '공포',
  '40': 'SF·판타지',
  '41': '스릴러',
  '42': '단편',
  '43': '쇼',
  '44': '예고편',
}

/**
 * topicDetails.topicCategories 말단값 → 한국어 이름.
 *
 * YouTube는 Wikipedia URL로 준다: https://en.wikipedia.org/wiki/Food → 'Food'.
 * 세분값(Music_of_Latin_America)은 상위 개념(음악)으로 접는다 — 주제 제안 단계에서
 * 'Music'과 'Music_of_Asia'가 따로 세어지면 같은 채널이 두 주제로 갈린다.
 */
export const TOPIC_SIGNAL: Readonly<Record<string, string>> = {
  // 음악
  Music: '음악', Pop_music: '음악', Rock_music: '음악', Soul_music: '음악',
  Jazz: '음악', Classical_music: '음악', Electronic_music: '음악',
  Hip_hop_music: '음악', Country_music: '음악', Independent_music: '음악',
  Music_of_Asia: '음악', Music_of_Latin_America: '음악', Reggae: '음악',
  Rhythm_and_blues: '음악', Christian_music: '음악',
  // 게임
  Video_game_culture: '게임', Action_game: '게임', Action_adventure_game: '게임',
  Casual_game: '게임', Music_video_game: '게임', Puzzle_video_game: '게임',
  Racing_video_game: '게임', Role_playing_video_game: '게임',
  Simulation_video_game: '게임', Sports_game: '게임', Strategy_video_game: '게임',
  // 스포츠
  Sport: '스포츠', American_football: '스포츠', Baseball: '스포츠',
  Basketball: '스포츠', Boxing: '스포츠', Cricket: '스포츠', Football: '스포츠',
  Golf: '스포츠', Ice_hockey: '스포츠', Mixed_martial_arts: '스포츠',
  Motorsport: '스포츠', Tennis: '스포츠', Volleyball: '스포츠',
  Professional_wrestling: '스포츠',
  // 엔터테인먼트
  Entertainment: '엔터테인먼트', Humour: '엔터테인먼트', Film: '영화·영상',
  Performing_arts: '엔터테인먼트', Television_program: '방송',
  // 라이프스타일
  Lifestyle_sociology: '라이프스타일',
  'Lifestyle_(sociology)': '라이프스타일',
  Fashion: '패션·뷰티', Beauty: '패션·뷰티', Physical_fitness: '운동·건강',
  Health: '운동·건강', Food: '음식', Hobby: '취미', Pet: '반려동물',
  Tourism: '여행', Vehicle: '자동차',
  // 사회·지식
  Society: '사회', Politics: '뉴스·정치', Business: '비즈니스',
  Technology: '과학기술', Knowledge: '교육', Military: '사회',
  Religion: '사회', Institution: '사회',
}

/** 신호 하나를 한국어 주제명으로. 모르는 값은 그대로 돌려준다(번역 실패를 감추지 않는다). */
export function signalLabel(raw: string): string {
  return TOPIC_SIGNAL[raw] ?? raw.replace(/_/g, ' ')
}

/** 카테고리 코드를 한국어로. 플랫폼별로 체계가 달라 platform을 함께 받는다. */
export function categoryLabel(platform: string, code: string | null): string | null {
  if (!code) return null
  if (platform === 'youtube') return YOUTUBE_CATEGORY[code] ?? `카테고리 ${code}`
  return code
}

/**
 * Wikipedia URL 배열 → 말단 조각 배열.
 * `https://en.wikipedia.org/wiki/Lifestyle_(sociology)` → `Lifestyle_(sociology)`
 * 중복은 없앤다 — 같은 주제가 여러 URL로 오는 경우가 흔하다.
 */
export function parseTopicCategories(urls: readonly string[] | undefined | null): string[] {
  if (!urls || urls.length === 0) return []
  const out = new Set<string>()
  for (const u of urls) {
    if (typeof u !== 'string') continue
    const tail = u.split('/').pop()
    if (tail) out.add(decodeURIComponent(tail))
  }
  return Array.from(out)
}

/**
 * 신호 목록을 한국어 주제명으로 접어 **빈도순**으로 돌려준다.
 * 'Music'과 'Pop_music'이 같이 오면 '음악 ×2'가 아니라 '음악 ×1'이다 —
 * 하나의 콘텐츠가 같은 주제를 여러 번 말한 것이지 두 건이 아니다.
 */
export function foldSignals(signals: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of signals) {
    const label = signalLabel(s)
    if (seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

/**
 * 주제 이름을 하나만 골라야 할 때의 우선순위.
 *
 * 'Entertainment'와 'Lifestyle'은 거의 모든 채널에 붙는 범용 신호라
 * 이것만으로 주제를 만들면 모든 채널이 '엔터테인먼트'가 된다 —
 * 지금 모든 것이 '요리'인 것과 똑같은 실패다. 구체적인 신호를 먼저 본다.
 */
const GENERIC = new Set(['엔터테인먼트', '라이프스타일', '사회', '방송'])

export function isGenericSignal(label: string): boolean {
  return GENERIC.has(label)
}

/**
 * 신호 빈도표에서 대표 주제를 고른다.
 * 구체 신호가 하나라도 있으면 그중 최빈값, 전부 범용이면 그중 최빈값.
 * 아무것도 없으면 null — 억지로 고르지 않는다.
 */
export function pickDominantSignal(
  counts: ReadonlyMap<string, number>,
): { label: string; count: number } | null {
  if (counts.size === 0) return null
  const entries = Array.from(counts.entries())
  const specific = entries.filter(([l]) => !isGenericSignal(l))
  const pool = specific.length > 0 ? specific : entries
  // 동점이면 이름순으로 끊는다 — 같은 입력이 실행할 때마다 다른 답을 내면 안 된다
  pool.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
  return { label: pool[0][0], count: pool[0][1] }
}
