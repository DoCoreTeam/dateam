/**
 * 도움말 — **화면마다 다른 것을 말한다.**
 *
 * 물음표 하나에 같은 문서를 붙이면 사람은 두 번째부터 안 누른다.
 * 그래서 지금 보고 있는 주소로 골라서 그 화면에서 할 일만 말한다.
 *
 * 여기 있는 말은 화면이 아니라 이 표가 갖는다(terms 와 같은 이유 — 화면에 한글 직접 금지).
 */

export interface GuideStep {
  title: string
  body: string
}

export interface GuideEntry {
  /** 이 항목이 맡는 주소. 긴 것이 먼저 걸린다 */
  match: string
  title: string
  lead: string
  steps: GuideStep[]
}

/** 서비스 전체를 한 번 훑는 순서 — 어느 화면에서 열어도 아래에 붙는다 */
export const GUIDE_FLOW: GuideStep[] = [
  { title: '① 회사 프로필을 채운다', body: '실적·인증·인력을 한 번 넣어 두면 이후 모든 공고에서 적합도를 계산합니다' },
  { title: '② 공고를 올린다', body: '한글·PDF·오피스 파일을 그대로 올리면 문서를 읽어 요구사항으로 쪼갭니다' },
  { title: '③ 리포트를 읽는다', body: '요약·요구사항·이상 조항·적합도가 한 장에 나옵니다. 모든 문장에 원문 근거가 붙습니다' },
  { title: '④ 모르는 것은 어시스턴트에게 묻는다', body: '어느 화면에서나 오른쪽 아래 버튼으로 열립니다. 답에 근거가 붙고 누르면 원문으로 갑니다' },
  { title: '⑤ 결과를 남긴다', body: '수주·유찰을 기록하면 다음 공고의 적합도 판정이 우리 실적에 맞게 조정됩니다' },
]

/** 주소별 안내. 위에서부터 훑고 **가장 길게 맞는 것**을 쓴다 */
export const GUIDE_ENTRIES: GuideEntry[] = [
  {
    match: '/rfp/new',
    title: '공고 올리기',
    lead: '파일을 올리면 읽고 쪼개는 일은 시스템이 합니다. 사람이 정하는 것은 등급 하나입니다',
    steps: [
      { title: '사업명', body: '공고문에 적힌 이름을 그대로 넣으면 나중에 찾기 쉽습니다' },
      { title: '문서 등급', body: '이 문서를 어느 AI 까지 보낼 수 있는지 정합니다. 고르지 않으면 시작할 수 없습니다 — 기본값을 주면 비밀 문서가 공개로 새기 때문입니다' },
      { title: '첨부 파일', body: '제안요청서·과업내용서·공고문·서식을 한꺼번에 올리면 한 케이스로 묶입니다' },
    ],
  },
  {
    match: '/rfp/profile',
    title: '회사 프로필',
    lead: '적합도 판정의 근거입니다. 여기가 비면 리포트의 적합도 절은 비어 있습니다',
    steps: [
      { title: '실적', body: '사업명·발주처·금액·연도를 넣습니다. 공고의 실적 요건과 맞춰 봅니다' },
      { title: '인증', body: 'ISMS·CMMI 같은 보유 인증입니다. 공고가 요구하는 인증과 대조합니다' },
      { title: '인력', body: '등급별 인원입니다. 참여 인력 요건과 대조합니다' },
      { title: '초안 만들기', body: '회사 소개서를 올리면 위 세 가지를 뽑아 초안으로 채웁니다. 확정은 사람이 합니다' },
    ],
  },
  {
    match: '/rfp/radar',
    title: '공고 레이더',
    lead: '우리가 볼 만한 공고가 새로 뜨면 알려 줍니다',
    steps: [
      { title: '규칙', body: '키워드·발주처·금액 범위로 조건을 겁니다. 조건이 넓으면 알림이 소음이 됩니다' },
      { title: '알림', body: '조건에 걸린 공고가 목록에 쌓입니다. 누르면 그대로 분석으로 넘어갑니다' },
    ],
  },
  {
    match: '/rfp/admin',
    title: '설정',
    lead: 'AI 키와 모델은 여기가 아니라 관리자 설정 한 곳에서 관리합니다. 여기서는 RFP 에만 해당하는 것을 정합니다',
    steps: [
      { title: 'AI 공급자', body: '어느 공급자가 어느 문서 등급까지 볼 수 있는지 정합니다. 키 등록은 관리자 설정에서 합니다' },
      { title: '이상 조항 규칙', body: '경쟁 제한이 의심되는 문장을 찾는 규칙입니다. 끄면 그 규칙은 리포트에 안 나옵니다' },
      { title: '사용량', body: '이번 달에 쓴 AI 비용과 한도입니다' },
    ],
  },
  {
    match: '/rfp',
    title: 'RFP 분석기',
    lead: '공고문을 읽고 요구사항·이상 조항·우리 적합도를 한 장으로 만듭니다',
    steps: [
      { title: '케이스', body: '올린 공고 하나가 케이스 하나입니다. 상태로 어디까지 진행됐는지 봅니다' },
      { title: '리포트', body: '케이스를 누르면 열립니다. 모든 문장에 원문 근거가 붙어 있어 눌러서 확인할 수 있습니다' },
    ],
  },
]

/** 지금 주소에 맞는 안내를 고른다 — 가장 길게 맞는 것이 이긴다 */
export function guideFor(pathname: string): GuideEntry {
  const hit = GUIDE_ENTRIES
    .filter((e) => pathname === e.match || pathname.startsWith(`${e.match}/`))
    .sort((a, b) => b.match.length - a.match.length)[0]
  // 케이스 상세(/rfp/<id>)처럼 짝이 없는 주소는 서비스 안내로 떨어진다
  return hit ?? GUIDE_ENTRIES[GUIDE_ENTRIES.length - 1]
}
