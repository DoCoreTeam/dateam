/**
 * AI 공통층 안내 SSOT — 개발자센터 화면이 여기서만 읽는다
 *
 * ## 왜 표로 두나
 *
 * 이 저장소는 같은 실수를 한 번 했다. `/develop` 이 940줄짜리 손으로 쓴 JSX 였고,
 * 코드가 664커밋을 가는 사이 문서는 한 문장도 안 바뀌어 **없는 기능을 약속**하고 있었다.
 * 그래서 엔드포인트 문서를 `registry.ts` 로 옮겼고, 이 표는 그 나머지 절반이다.
 *
 * 패키지 소개도 똑같이 썩는다 — 아니, 더 빨리 썩는다. 수출 이름이 바뀌어도 화면은
 * 옛 이름을 계속 보여 주고, 읽는 사람은 그 이름으로 import 를 쓴다. 그래서
 * **여기 적은 이름이 실제로 수출되는지 가드가 센다**
 * (`lib/policy/ai-layer-docs-guard.test.ts`).
 *
 * 화면은 이 표를 그리기만 한다. 화면이 문구를 직접 들면 그 순간 두 벌이 된다.
 */

/** 왼쪽 목록의 항목 */
export type AiDocKey = 'ai-intro' | 'ai-setup' | 'ai-packages' | 'ai-contract'

export interface AiDocNavItem {
  key: AiDocKey
  label: string
}

export const AI_DOC_NAV: readonly AiDocNavItem[] = [
  { key: 'ai-intro', label: '무엇인가' },
  { key: 'ai-setup', label: '붙이는 순서' },
  { key: 'ai-packages', label: '패키지 넷' },
  { key: 'ai-contract', label: '결과 계약' },
] as const

export const AI_LAYER_NAV_LABEL = 'AI 공통층'

/* ── 무엇인가 ─────────────────────────────────────────────────────────────── */

export interface AiIntroBlock {
  /** 소제목 */
  title: string
  /** 한 덩이 설명 — 개조식 여러 줄 */
  lines: readonly string[]
}

export const AI_INTRO: readonly AiIntroBlock[] = [
  {
    title: '한 줄로',
    lines: [
      'AI 를 부르는 일에서 서비스마다 똑같이 지켜야 하는 것만 모아 둔 패키지 넷',
      '무엇을 돌려줄지(계약), 어떻게 나갈지(관문), 누구에게 물을지(등록부), 어떻게 보일지(부품)',
      '우리 회사 사정은 하나도 안 들어 있어 다른 제품에 그대로 붙는다',
    ],
  },
  {
    title: '왜 따로 뺐나',
    lines: [
      '규칙이 문서에만 있으면 안 지켜진다, 실측 2026-09-16 에 벤더를 직접 부르는 자리가 스물다섯이었고 그 중 개인정보를 가리는 곳이 0개였다',
      '「공용 부품은 문구를 갖지 않는다」도 주석에만 있어서, 확신을 그리는 방식이 화면마다 갈려 스물여덟 가지가 됐다',
      '패키지는 실수로 앱을 못 끌어온다, 한글 문구가 필요하면 형이 부르는 쪽에 요구하고 다른 길이 없다',
    ],
  },
  {
    title: '무엇을 안 가져가나',
    lines: [
      '사용자가 읽는 말, 전부 부르는 쪽이 준다, 영어 기본값을 두면 한국어 제품에 영어가 조용히 실린다',
      '우리 회사의 사실, 모델 값, 키를 두는 자리, 어느 업체와 계약했는지, 「딜」이 무엇인지',
      '저장, 관문은 부르는 쪽이 준 창구로 쓸 뿐 표를 모른다',
      '제품이 정할 문턱, 확신이 낮다고 볼 선은 화면마다 다르고, 지금도 셋이 쓰인다',
    ],
  },
  {
    title: '지금 어디에 쓰이나',
    lines: [
      'AI 를 부르는 모든 길이 관문을 지난다, 벤더 주소를 직접 든 파일은 사유가 적힌 여섯뿐이다',
      '확신을 숫자로 그리는 화면 열셋이 공용 규칙 한 벌을 지난다',
      '전송 기록은 ai_llm_calls 와 ai_external_transfers 두 표에 남는다',
    ],
  },
]

/* ── 붙이는 순서 ───────────────────────────────────────────────────────────── */

export interface AiSetupStep {
  /** 몇 번째 */
  no: number
  title: string
  /** 왜 이 순서인가 — 건너뛰면 무엇이 깨지는가 */
  why: string
  /** 붙여 넣을 것. 없으면 글만 */
  code?: { lang: string; text: string }
}

export const AI_SETUP: readonly AiSetupStep[] = [
  {
    no: 1,
    title: '의존에 넣는다',
    why: '저장소 안에서는 작업공간 패키지라 판을 안 적어도 된다, 밖에서는 사내 레지스트리에 먼저 올린다',
    code: {
      lang: 'json',
      text: `{
  "dependencies": {
    "@ax/ai-core": "workspace:*",
    "@ax/ai-gateway": "workspace:*",
    "@ax/ai-providers": "workspace:*",
    "@ax/ai-react": "workspace:*"
  }
}`,
    },
  },
  {
    no: 2,
    title: '묶는 쪽에서 컴파일하게 한다',
    why: '이 넷은 빌드 산출물이 아니라 타입스크립트 원본을 싣는다, 규칙 파일을 node --test 가 바로 읽을 수 있어야 해서다',
    code: {
      lang: 'js',
      text: `// next.config.js
transpilePackages: [
  '@ax/ai-core', '@ax/ai-gateway', '@ax/ai-providers', '@ax/ai-react',
],`,
    },
  },
  {
    no: 3,
    title: '원장 창구를 준다',
    why: '기본 창구를 안 두는 것이 설계다, 아무것도 안 적는 창구는 제대로 도는 것과 화면에서 구분이 안 된다',
    code: {
      lang: 'ts',
      text: `import { createAiLedger, serverAiLedger } from '@/lib/ai/ledger'

// 표 둘에 적는다 — 호출 한 줄, 전송 한 줄
// 기록 실패는 사용자의 일을 멈추지 않는다, 대신 조용히 넘어가지도 않는다
const ledger = serverAiLedger()`,
    },
  },
  {
    no: 4,
    title: '부품에 말을 준다',
    why: '기본값이 없다, 열셋을 다 주기 전에는 형 검사가 통과하지 않고 missingLabels 가 런타임에도 답한다',
    code: {
      lang: 'ts',
      text: `import { missingLabels, type AiLabels } from '@ax/ai-react'
import { AI_LABELS } from '@/lib/terms'

// AI_LABELS 가 용어집 SSOT, 화면이 문구를 직접 쓰지 않는다
const labels: AiLabels = AI_LABELS
if (missingLabels(labels).length > 0) throw new Error('말이 덜 찼다')`,
    },
  },
  {
    no: 5,
    title: '부를 때 관문을 지난다',
    why: '가림과 시간 제한과 전송 기록이 여기서 자동으로 붙는다, 벤더 주소를 화면이나 라우트가 직접 들면 그 셋이 하나도 안 붙는다',
    code: {
      lang: 'ts',
      text: `import { guardedGeminiText } from '@/lib/ai/guarded-gemini'

// 아는 이름은 안 주면 구성원과 주소록 전체를 쓴다
// 답에서 자리표는 자동으로 되돌아온다
const out = await guardedGeminiText({
  prompt, apiKey, model,
  surface: 'my-screen', purpose: '무엇을 하려고 불렀나',
  actorId: user.id,
})`,
    },
  },
  {
    no: 6,
    title: '판 번호를 처음 저장할 때 찍는다',
    why: '읽을 때 한 칸씩 올리고, 번호 없는 줄을 1 로 가정하지 않는다, 가정하면 안 찍은 버그가 가려진다',
    code: {
      lang: 'ts',
      text: `import { AI_CONTRACT_VERSION, climb } from '@ax/ai-core'

// 쓸 때
await db.from('my_ai_rows').insert({ ...row, contract_version: AI_CONTRACT_VERSION })

// 읽을 때
const r = climb(row, [{ from: 1, up: (v) => ({ ...(v as object), evidence: [] }) }])
// r.status: 'current' | 'climbed' | 'held'`,
    },
  },
]

/* ── 패키지 넷 ─────────────────────────────────────────────────────────────── */

export interface AiPackageDoc {
  name: string
  /** 무엇을 갖고 있나 */
  owns: string
  /** 안 갖는 것 — 경계를 말로 못 하면 다음 사람이 넘는다 */
  refuses: string
  /** 대표 수출. 가드가 실제 수출과 대조한다 */
  exports: readonly string[]
  /** 어디에 기대나 */
  dependsOn: readonly string[]
}

export const AI_PACKAGES: readonly AiPackageDoc[] = [
  {
    name: '@ax/ai-core',
    owns: 'AI 결과가 반드시 함께 들어야 하는 일곱, 판 번호를 올리는 사다리, 어느 자리를 누가 읽을 수 있나',
    refuses: '벤더도 네트워크도 리액트도 모른다',
    exports: ['AI_CONTRACT_VERSION', 'newAiValue', 'isAiValue', 'applyCorrection', 'canTransition', 'climb', 'versionOf', 'canRead', 'AI_CAPABILITIES'],
    dependsOn: [],
  },
  {
    name: '@ax/ai-gateway',
    owns: '밖으로 나가는 한 자리, 되돌릴 수 있는 개인정보 가림, 전송과 호출 기록, 모델 사슬과 폴백, 비용 셈',
    refuses: '표를 모른다, 저장 창구는 부르는 쪽이 준다',
    exports: ['maskPii', 'unmaskPii', 'hasUnmaskedPii', 'countByKind', 'callWithFallback', 'recoverJson', 'costKrw', 'TransferBlockedError'],
    dependsOn: ['@ax/ai-core'],
  },
  {
    name: '@ax/ai-providers',
    owns: '키 모양으로 공급자를 가리기, 능력으로 모델 고르기, 빠진 모델마다 이유 달기',
    refuses: '키도 값도 계약도 안 든다',
    exports: ['detectProviderByKey', 'matchesKeyPrefix', 'pickModels', 'GEMINI', 'CLAUDE', 'OPENAI', 'GROQ', 'GROK'],
    dependsOn: [],
  },
  {
    name: '@ax/ai-react',
    owns: '확신과 근거와 고친 흔적을 그리는 규칙과 부품, 규칙은 시험이 읽을 수 있게 .ts 에 둔다',
    refuses: '문구를 한 글자도 안 갖는다, 전부 부르는 쪽이 준다',
    exports: ['confidenceView', 'confidencePercentView', 'statusText', 'isSettled', 'evidenceView', 'diffRows', 'correctionTrail', 'needsGeneratedNotice', 'missingLabels', 'AiValue', 'Evidence', 'GeneratedNotice'],
    dependsOn: ['@ax/ai-core'],
  },
]

/* ── 결과 계약 ─────────────────────────────────────────────────────────────── */

export interface AiContractField {
  key: string
  label: string
  /** 안 지키면 무슨 일이 나나 */
  note: string
}

export const AI_CONTRACT_FIELDS: readonly AiContractField[] = [
  { key: 'value', label: '값', note: '무엇이라고 말했나' },
  { key: 'confidence', label: '확신', note: '모르면 null, 0 이 아니다, 0 으로 그리면 「확실히 틀렸다」고 말하는 셈이다' },
  { key: 'evidence', label: '근거', note: '블록 id 와 글자 구간, 근거 없는 주장은 확인할 방법이 없다' },
  { key: 'source', label: '출처', note: '어느 공급자 어느 모델 언제' },
  { key: 'status', label: '상태', note: '받는 중 · 확인 전 · 확인함 · 사람이 고침, 「받는 중」은 로딩 표시가 아니라 상태다' },
  { key: 'corrections', label: '고친 흔적', note: '덮어쓰지 않고 쌓는다, 「AI 가 여기서 틀렸다」가 이 줄에서 가장 값진 것이다' },
  { key: 'contractVersion', label: '계약 판', note: '첫 저장 때 찍는다, 읽을 때 한 칸씩 올린다' },
]

/**
 * 능력 여덟은 `@ax/ai-core` 의 `AI_CAPABILITIES` 가 진실이고 여기는 그 여덟에
 * 한국어 이름과 「함께 보일 것」을 붙일 뿐이다.
 *
 * 처음 이 표를 쓸 때 여덟을 **지어냈다**(assess·compare·cross_verify 같은 것).
 * 실제 여덟은 다른 이름이었고, 개발자센터가 없는 능력을 안내하고 있었다.
 * 가드가 잡아 준 것이고, 그래서 가드가 이 표를 계약과 대조한다.
 */
export interface AiCapabilityDoc {
  key: string
  label: string
  /** 화면이 답과 함께 반드시 보여야 하는 것 */
  mustShow: string
}

export const AI_CAPABILITY_DOCS: readonly AiCapabilityDoc[] = [
  { key: 'extract', label: '뽑기', mustShow: '후보 목록, 사람이 고르기 전에는 확정이 아니다' },
  { key: 'summarize', label: '줄이기', mustShow: 'AI 가 만들었다는 고지' },
  { key: 'judge', label: '재기', mustShow: '근거, 없으면 판정을 확인할 방법이 없다' },
  { key: 'suggest', label: '권하기', mustShow: '후보 목록' },
  { key: 'generate', label: '만들기', mustShow: '미리보기와 AI 고지, 고지는 끌 수 없다' },
  { key: 'answer', label: '답하기', mustShow: '출처, 어디서 왔는지 없으면 답이 아니다' },
  { key: 'transcribe', label: '옮겨 적기', mustShow: 'AI 가 만들었다는 고지' },
  { key: 'search', label: '찾기', mustShow: '출처' },
]

/** 확인 명령 — 문서가 약속한 것을 사람이 직접 돌려 볼 수 있게 */
export const AI_LAYER_CHECKS: readonly { cmd: string; what: string }[] = [
  { cmd: 'pnpm typecheck:packages', what: '패키지 넷과 그 시험까지 형 검사' },
  { cmd: 'pnpm test', what: '규칙과 경계 가드 전부' },
]
