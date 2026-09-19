/**
 * AI 공통층 안내 SSOT — 개발자센터 화면이 여기서만 읽는다
 *
 * ## 화면은 조판만 한다
 *
 * `app/develop/AiLayerSection.tsx` 는 이 표를 그리기만 한다. 화면이 문구를 직접 들면
 * 그 순간 두 벌이 되고, 코드가 바뀌어도 그 쪽은 안 바뀐다. `/develop` 이 이미 그렇게
 * 664커밋 동안 없는 기능을 약속했다.
 *
 * ## 말투는 이 화면의 나머지 절과 같다
 *
 * 「~합니다」로 끝나고 읽는 사람을 2인칭으로 부른다. 시작하기·엔드포인트·오류 절이
 * 그렇게 쓰여 있고, 한 화면 안에서 말투가 갈리면 읽는 사람에게는 다른 제품으로 보인다.
 *
 * LOOP.md 6절의 개조식·마침표 없음 규정은 **문서 산출물(마크다운)** 규정이다.
 * 화면 문구에 적용하지 않는다. 처음 이 표를 쓸 때 그 규정을 화면에 적용해서
 * 이 절만 말투가 달라졌고, 「관문·등록부·판 번호·형 검사」같은 지어낸 번역어가 붙었다.
 * 표준어를 쓴다 — 게이트웨이, 공급자, 계약 버전, 타입 검사.
 *
 * ## 만든 사람 회고를 쓰지 않는다
 *
 * 「왜 따로 뺐나」「실측 스물다섯이었다」는 읽는 사람이 쓸 데가 없다. 설계 배경은
 * 이 파일 주석과 `docs/` 에 남기고, 화면에는 붙이는 법과 지켜지는 것만 적는다.
 *
 * 여기 적은 수출 이름과 숫자는 `lib/policy/ai-layer-docs-guard.test.ts` 가 실제 소스와 대조한다.
 */

/*
 * 숫자와 공급자 표는 코드에서 직접 가져온다. 손으로 옮겨 적으면 그 순간 갈린다.
 * 상대 경로 + .ts 확장자로 적는다 — 가드가 node --test 로 이 파일을 직접 읽는다.
 */
import { MAX_CHAIN_CANDIDATES, MAX_PER_PROVIDER } from '../ai-chat/model-chain.ts'
import { GEMINI, CLAUDE, OPENAI, GROQ, GROK } from '@ax/ai-providers'
import { canTransition, type AiValueStatus } from '@ax/ai-core'

/** 왼쪽 목록의 항목 */
export type AiDocKey = 'ai-intro' | 'ai-setup' | 'ai-policy' | 'ai-packages' | 'ai-contract'

export interface AiDocNavItem {
  key: AiDocKey
  /** 왼쪽 목록에 뜨는 짧은 이름 */
  label: string
  /** 화면 제목 — 화면 나머지 절과 같은 PageHeader 로 뜬다 */
  title: string
  /** 제목 아래 한 줄 */
  description: string
}

export const AI_DOC_NAV: readonly AiDocNavItem[] = [
  {
    key: 'ai-intro',
    label: '무엇인가',
    title: 'AI 공통층',
    description: 'AI 를 부르는 화면이 함께 쓰는 패키지입니다. 무엇을 해 주고 무엇을 안 해 주는지 먼저 읽으세요.',
  },
  {
    key: 'ai-setup',
    label: '붙이는 순서',
    title: '붙이는 순서',
    description: '위에서부터 그대로 따르면 됩니다. 단계를 건너뛰면 무엇이 깨지는지 단계마다 적었습니다.',
  },
  {
    key: 'ai-policy',
    label: '모델 정책',
    title: '모델 정책',
    description: '어느 공급자에게 묻고, 막히면 어디로 넘어가고, 갈아탄 사실을 어떻게 알리는지 정합니다.',
  },
  {
    key: 'ai-packages',
    label: '패키지',
    title: '패키지와 수출',
    description: '무엇이 어느 패키지에 있는지, 그 패키지가 무엇을 일부러 안 갖는지 봅니다.',
  },
  {
    key: 'ai-contract',
    label: '결과 계약',
    title: '결과 계약',
    description: 'AI 가 낸 값 하나를 어떤 모양으로 저장하고 화면에 내보내는지 정합니다.',
  },
] as const

export const AI_LAYER_NAV_LABEL = 'AI 공통층'

/** 화면이 조판할 때 쓰는 나머지 말 — 화면이 한글을 직접 들지 않게 여기 둔다 */
export const AI_DOC_UI = {
  /** 패키지 카드 */
  dependsOnNone: '기대는 것 없음',
  refusesLabel: '안 갖는 것',
  exportsLabel: '주요 수출',
  /** 붙이는 순서 */
  checksTitle: '확인하는 법',
  /** 결과 계약 */
  contractHead: { key: '자리', label: '이름', note: '왜 필요한가' },
  capabilityTitle: '능력마다 함께 보여야 하는 것',
  capabilityHead: { key: '능력', label: '이름', mustShow: '답과 함께 보여야 하는 것' },
  /** 모델 정책 */
  providerHead: { id: '공급자', keyPrefix: '키 앞자리', vision: '이미지', tools: '도구', thinking: '생각', issue: '키 발급' },
  yes: '가능',
  no: '안 됨',
  chainOrderTitle: '시도 순서',
  chainLimitTitle: '몇 개까지 시도하나',
  failureTitle: '실패했을 때 무엇을 더 빼나',
  failureHead: { scope: '갈래', when: '언제', then: '무엇을 빼나' },
  policyCodeTitle: '부르는 쪽 모양',
  /** 패키지 */
  apiHead: { name: '수출', signature: '호출 모양', returns: '돌려주는 모양', note: '무엇을 해 주나' },
  alsoExportsLabel: '그 밖의 수출',
  errorsTitle: '던지는 오류',
  errorHead: { name: '이름', when: '언제 나나', fix: '무엇을 하면 되나' },
  /** 결과 계약 */
  contractTypeTitle: '저장하는 모양',
  statusTitle: '상태와 옮겨 갈 수 있는 곳',
  statusHead: { from: '지금 상태', label: '뜻', to: '옮겨 갈 수 있는 곳', note: '언제 이 상태인가' },
  contractCodeTitle: '한 화면을 처음부터 끝까지',
} as const

/* ── 무엇인가 ─────────────────────────────────────────────────────────────── */

export interface AiIntroBlock {
  /** 소제목 */
  title: string
  lines: readonly string[]
}

export const AI_INTRO: readonly AiIntroBlock[] = [
  {
    title: '무엇을 해 주나',
    lines: [
      'AI 를 부를 때 서비스마다 똑같이 지켜야 하는 것을 대신 지켜 줍니다.',
      '개인정보를 가려서 내보내고 답에서 되돌려 줍니다. 무엇이 몇 건 나갔는지 기록에 남습니다.',
      '한 공급자가 막히면 다음 공급자로 넘어갑니다. 한도 하나에 기능이 멈추지 않습니다.',
      'AI 가 낸 값을 확신과 근거와 출처와 함께 다루게 해 줍니다. 화면은 그 셋을 같은 규칙으로 그립니다.',
    ],
  },
  {
    title: '누가 읽는 절인가',
    lines: [
      '이 저장소 안에서 AI 를 새로 부르는 화면이나 API 를 만드는 사람입니다.',
      '이미 있는 AI 화면을 고치는 경우에도 결과 계약을 먼저 보세요. 저장한 값의 모양이 정해져 있습니다.',
      '공개 API 로 AI 기능을 부르는 방법을 찾는다면 이 절이 아닙니다. 왼쪽 엔드포인트 묶음을 보세요.',
    ],
  },
  {
    title: '무엇을 안 해 주나',
    lines: [
      '사용자가 읽는 말은 주지 않습니다. 부르는 쪽이 전부 넘깁니다. 영어 기본값을 두면 한국어 화면에 영어가 조용히 실립니다.',
      '우리 회사의 사실은 담지 않습니다. 모델 값, 키를 두는 자리, 어느 업체와 계약했는지는 앱에 있습니다.',
      '저장하지 않습니다. 기록은 부르는 쪽이 넘긴 창구로 적을 뿐 표 이름을 모릅니다.',
      '확신이 낮다고 볼 선은 정하지 않습니다. 화면마다 다르고, 부르는 쪽이 넘기면 그 값을 씁니다.',
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
    title: '의존에 넣습니다',
    why: '저장소 안에서는 작업공간 패키지라 버전을 적지 않아도 됩니다. 저장소 밖에서 쓰려면 사내 레지스트리에 먼저 올립니다.',
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
    title: '묶는 쪽에서 컴파일하게 합니다',
    why: '이 패키지들은 빌드 산출물이 아니라 타입스크립트 원본을 싣습니다. 규칙 파일을 node --test 가 바로 읽을 수 있어야 해서입니다.',
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
    title: '기록 창구를 넘깁니다',
    why: '기본 창구를 두지 않은 것이 설계입니다. 아무것도 적지 않는 창구를 기본으로 두면, 기록이 안 되는 것과 제대로 도는 것이 화면에서 똑같이 보입니다.',
    code: {
      lang: 'ts',
      text: `import { serverAiLedger } from '@/lib/ai/ledger'

// 표 둘에 적습니다. 호출 한 줄, 밖으로 나간 전송 한 줄
// 기록이 실패해도 사용자의 일은 멈추지 않습니다. 대신 조용히 넘어가지도 않습니다
const ledger = serverAiLedger()`,
    },
  },
  {
    no: 4,
    title: '부품에 쓸 말을 넘깁니다',
    why: '기본값이 없습니다. 필요한 말을 전부 넘기기 전에는 타입 검사가 통과하지 않고, missingLabels 가 런타임에도 빠진 것을 알려 줍니다.',
    code: {
      lang: 'ts',
      text: `import { missingLabels, type AiLabels } from '@ax/ai-react'
import { AI_LABELS } from '@/lib/terms'

// AI_LABELS 가 용어집 SSOT 입니다. 화면이 문구를 직접 쓰지 않습니다
const labels: AiLabels = AI_LABELS
if (missingLabels(labels).length > 0) throw new Error('말이 덜 찼습니다')`,
    },
  },
  {
    no: 5,
    title: '부를 때 게이트웨이를 지납니다',
    why: '가림과 시간 제한과 전송 기록이 여기서 자동으로 붙습니다. 화면이나 라우트가 벤더 주소를 직접 들면 그 셋이 하나도 붙지 않습니다.',
    code: {
      lang: 'ts',
      text: `import { guardedGeminiText } from '@/lib/ai/guarded-gemini'

// 아는 이름을 안 넘기면 구성원과 주소록 전체를 씁니다
// 답에 남은 자리표는 자동으로 되돌려 줍니다
const out = await guardedGeminiText({
  prompt, apiKey, model,
  surface: 'my-screen', purpose: '무엇을 하려고 불렀나',
  actorId: user.id,
})`,
    },
  },
  {
    no: 6,
    title: '계약 버전을 첫 저장 때 찍습니다',
    why: '읽을 때 한 칸씩 올립니다. 버전 없는 줄을 1 로 가정하지 않습니다. 가정하면 버전을 안 찍은 버그가 가려집니다.',
    code: {
      lang: 'ts',
      text: `import { AI_CONTRACT_VERSION, climb } from '@ax/ai-core'

// 쓸 때
await db.from('my_ai_rows').insert({ ...row, contract_version: AI_CONTRACT_VERSION })

// 읽을 때
const r = climb(row, [{ from: 1, up: (v) => ({ ...(v as object), evidence: [] }) }])
// r.status: 'current' | 'legacy' | 'gap' | 'ahead'`,
    },
  },
]

/* ── 패키지 ───────────────────────────────────────────────────────────────── */

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
    owns: 'AI 결과가 함께 들어야 하는 항목, 계약 버전을 올리는 사다리, 어느 자리를 누가 읽을 수 있는지 정하는 규칙입니다.',
    refuses: '벤더도 네트워크도 리액트도 모릅니다',
    exports: ['AI_CONTRACT_VERSION', 'newAiValue', 'isAiValue', 'applyCorrection', 'canTransition', 'climb', 'versionOf', 'canRead', 'AI_CAPABILITIES'],
    dependsOn: [],
  },
  {
    name: '@ax/ai-gateway',
    owns: '밖으로 나가는 한 자리입니다. 되돌릴 수 있는 개인정보 가림, 호출과 전송 기록, 모델 후보를 차례로 시도하는 폴백, 비용 셈이 여기 있습니다.',
    refuses: '표를 모릅니다, 저장 창구는 부르는 쪽이 넘깁니다',
    exports: ['maskPii', 'unmaskPii', 'hasUnmaskedPii', 'countByKind', 'callWithFallback', 'recoverJson', 'costKrw', 'TransferBlockedError'],
    dependsOn: ['@ax/ai-core'],
  },
  {
    name: '@ax/ai-providers',
    owns: '키 모양으로 공급자를 가리고, 필요한 능력으로 모델을 고르고, 빠진 모델마다 이유를 답니다.',
    refuses: '키도 모델 값도 결과 계약도 들지 않습니다',
    exports: ['detectProviderByKey', 'matchesKeyPrefix', 'pickModels', 'GEMINI', 'CLAUDE', 'OPENAI', 'GROQ', 'GROK'],
    dependsOn: [],
  },
  {
    name: '@ax/ai-react',
    owns: '확신과 근거와 고친 흔적을 그리는 규칙과 부품입니다. 규칙은 시험이 읽을 수 있게 .ts 에 둡니다.',
    refuses: '문구를 한 글자도 갖지 않습니다, 전부 부르는 쪽이 넘깁니다',
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
  { key: 'capability', label: '능력', note: '여덟 중 무엇을 시켰는지입니다. 이 값이 화면이 무엇을 함께 보여야 하는지를 정합니다.' },
  { key: 'value', label: '값', note: '무엇이라고 말했는지입니다.' },
  { key: 'confidence', label: '확신', note: '모르면 null 입니다. 0 이 아닙니다. 0 으로 그리면 「확실히 틀렸다」고 말하는 셈입니다.' },
  { key: 'evidence', label: '근거', note: '블록 id 와 글자 구간입니다. 근거 없는 주장은 확인할 방법이 없습니다.' },
  { key: 'source', label: '출처', note: '어느 공급자 어느 모델이 언제 답했는지입니다.' },
  { key: 'status', label: '상태', note: '받는 중, 확인 전, 확인함, 사람이 고침 넷입니다. 「받는 중」은 로딩 표시가 아니라 상태입니다.' },
  { key: 'corrections', label: '고친 흔적', note: '덮어쓰지 않고 쌓습니다. 「AI 가 여기서 틀렸다」가 이 줄에서 가장 값진 것입니다.' },
  { key: 'contractVersion', label: '계약 버전', note: '첫 저장 때 찍습니다. 읽을 때 한 칸씩 올립니다.' },
]

/**
 * 능력 목록은 `@ax/ai-core` 의 `AI_CAPABILITIES` 가 진실이고, 여기는 그 목록에
 * 한국어 이름과 「함께 보여야 하는 것」을 붙일 뿐이다. 가드가 둘을 대조한다.
 */
export interface AiCapabilityDoc {
  key: string
  label: string
  /** 화면이 답과 함께 반드시 보여야 하는 것 */
  mustShow: string
}

export const AI_CAPABILITY_DOCS: readonly AiCapabilityDoc[] = [
  { key: 'extract', label: '추출', mustShow: '후보 목록입니다. 사람이 고르기 전에는 확정이 아닙니다.' },
  { key: 'summarize', label: '요약', mustShow: 'AI 가 만들었다는 고지입니다.' },
  { key: 'judge', label: '판정', mustShow: '근거입니다. 없으면 판정을 확인할 방법이 없습니다.' },
  { key: 'suggest', label: '추천', mustShow: '후보 목록입니다.' },
  { key: 'generate', label: '생성', mustShow: '미리보기와 AI 고지입니다. 고지는 끌 수 없습니다.' },
  { key: 'answer', label: '답변', mustShow: '출처입니다. 어디서 왔는지 없으면 답이 아닙니다.' },
  { key: 'transcribe', label: '전사', mustShow: 'AI 가 만들었다는 고지입니다.' },
  { key: 'search', label: '검색', mustShow: '출처입니다.' },
]

/** 확인 명령 — 문서가 약속한 것을 직접 돌려 볼 수 있게 */
export const AI_LAYER_CHECKS: readonly { cmd: string; what: string }[] = [
  { cmd: 'pnpm typecheck:packages', what: '패키지와 그 시험까지 타입 검사' },
  { cmd: 'pnpm test', what: '규칙과 경계 가드 전부' },
]

/* ── 모델 정책 ─────────────────────────────────────────────────────────────── */

/**
 * 공급자 표는 `@ax/ai-providers` 의 벤더 명세에서 그대로 만든다.
 *
 * 손으로 옮겨 적었다면 능력 한 칸이 바뀔 때 화면이 옛 답을 계속 보여 준다. 여기는
 * 파생만 하고 사실은 벤더 명세 한 곳에 있다. 능력은 **벤더 천장**이고 모델 하나하나의
 * 답은 카탈로그가 든다.
 */
export interface AiProviderDoc {
  id: string
  /** 키를 보고 공급자를 가리는 앞자리 */
  keyPrefix: string
  vision: boolean
  tools: boolean
  thinking: boolean
  keyIssueUrl: string
}

export const AI_PROVIDERS: readonly AiProviderDoc[] = [GEMINI, CLAUDE, OPENAI, GROQ, GROK].map((v) => ({
  id: v.id,
  keyPrefix: v.keyPrefixes.join(' '),
  vision: v.capabilities.vision,
  tools: v.capabilities.tools,
  thinking: v.capabilities.thinking,
  keyIssueUrl: v.keyIssueUrl,
}))

/** 상한은 `lib/ai-chat/model-chain.ts` 가 진실이고 여기는 그 값을 읽어 보여 준다 */
export const AI_CHAIN_LIMITS = {
  maxCandidates: MAX_CHAIN_CANDIDATES,
  maxPerProvider: MAX_PER_PROVIDER,
} as const

export interface AiChainStep {
  no: number
  title: string
  note: string
}

export const AI_CHAIN_ORDER: readonly AiChainStep[] = [
  {
    no: 1,
    title: '사용자가 고른 것',
    note: '카탈로그가 「지금 못 쓴다」고 말한 경우에만 뺍니다. 관리자가 고른 것을 능력 판정으로 먼저 지우지 않습니다.',
  },
  {
    no: 2,
    title: '같은 공급자의 다른 모델',
    note: '카탈로그 순서를 지키되, 한도에 걸렸던 모델은 뒤로 밉니다. 한도는 시간이 지나면 풀립니다.',
  },
  {
    no: 3,
    title: '다른 공급자',
    note: '키가 확정된 공급자 순서대로 넘어가고, 공급자마다 설정된 모델을 먼저 씁니다. 키가 이미 있는 곳으로 가는 것이라 새 계약이 필요하지 않습니다.',
  },
]

export interface AiFailureRule {
  /** classifyProviderError 가 답하는 갈래 */
  scope: string
  when: string
  then: string
}

export const AI_FAILURE_RULES: readonly AiFailureRule[] = [
  {
    scope: 'provider',
    when: '한도 소진(429), 키 인증 실패(401·403)',
    then: '그 공급자의 남은 모델을 전부 뺍니다. 무료 한도는 키 단위로 걸려서 같은 키의 다른 모델도 함께 죽어 있습니다.',
  },
  {
    scope: 'model',
    when: '요금제가 그 모델을 안 주는 경우(limit: 0), 없어진 모델(404)',
    then: '그 모델만 뺍니다. 같은 키의 다른 모델은 멀쩡합니다.',
  },
  {
    scope: 'transient',
    when: '그 밖의 실패',
    then: '다음 후보로 넘어가고 아무것도 더 빼지 않습니다.',
  },
]

export const AI_POLICY_NOTES: readonly AiIntroBlock[] = [
  {
    title: '능력을 못 채우는 공급자는 후보에서 빠집니다',
    lines: [
      '첨부를 읽어야 하는 일은 이미지를 못 보는 공급자로 넘어가지 않습니다. 넘어가 봐야 400 이 옵니다.',
      '도구를 써야 하는 일도 같습니다. 필요한 능력을 requires 로 넘기면 순서를 만들 때 걸러집니다.',
      '사용자가 고른 것 하나는 관리자 선택을 존중해 남습니다. 그것까지 걸러야 하면 meetsRequirements 로 한 번 더 봅니다.',
    ],
  },
  {
    title: '후보가 0개면 조용히 끝내지 않습니다',
    lines: [
      '무엇이 모자라서 부를 곳이 없는지 사용자에게 말합니다. 빈손으로 끝나면 사용자는 기능이 고장 난 줄 압니다.',
      '키가 없는 것과 능력이 모자란 것과 전부 한도에 걸린 것은 서로 다른 사실입니다. 다르게 말합니다.',
    ],
  },
  {
    title: '갈아탔으면 화면이 말합니다',
    lines: [
      '비용과 품질이 달라지는 일이라 모르고 지나가면 안 됩니다. 조용히 바꾸지 않습니다.',
      '그 한 줄은 formatFallbackNotice 한 곳에서 옵니다. 화면마다 다른 문장을 지으면 같은 일이 다른 일처럼 보입니다.',
      '기록에도 실제로 답한 공급자와 모델이 남습니다. 고른 모델이 아니라 답한 모델입니다.',
    ],
  },
]

/** 부르는 쪽 모양 — 순서를 만들고, 실패하면 그 근거로 남은 후보를 줄인다 */
export const AI_POLICY_CODE = {
  lang: 'ts',
  text: `import { buildModelChain, pruneChain } from '@/lib/ai-chat/model-chain'
import { classifyProviderError } from '@/lib/ai-chat/provider-errors'

let rest = buildModelChain({
  chosen,            // 사용자가 대화에 걸어 둔 공급자와 모델
  providers,         // 키가 확정된 공급자들, 배열 순서가 곧 폴백 순서
  catalog,           // ai_model_catalog 행
  capabilities,      // 공급자별 vision·tools
  requires: { vision: hasAttachment },
})

if (rest.length === 0) throw new Error('부를 수 있는 모델이 없습니다')

while (rest.length > 0) {
  const [candidate, ...others] = rest
  try {
    return await callProvider(candidate)
  } catch (err) {
    const { scope } = classifyProviderError(err)
    rest = pruneChain(others, candidate, scope)
  }
}`,
} as const

/* ── 수출 참조 ─────────────────────────────────────────────────────────────── */

/**
 * 주요 수출의 호출 모양과 돌려주는 모양.
 *
 * 이름만 나열하면 읽는 사람이 붙일 수 없다. 인자 순서와 돌려받는 모양을 보려고
 * 패키지 소스를 열어야 한다면 이 절은 목차일 뿐이다.
 *
 * `signature` 는 `packages/*​/src` 의 선언과 같아야 한다. 가드가 이름이 실제로
 * 수출되는지 보고, `exports` 목록에도 들어 있는지 대조한다.
 */
export interface AiExportDoc {
  /** 어느 패키지 */
  pkg: string
  name: string
  /** 소스 선언과 같은 한 줄 */
  signature: string
  /** 돌려주는 모양 — 갈래가 둘이면 둘 다 적는다 */
  returns: string
  note: string
}

export const AI_API: readonly AiExportDoc[] = [
  {
    pkg: '@ax/ai-core',
    name: 'newAiValue',
    signature: 'newAiValue<T>(input: NewAiValueInput<T>): AiValue<T>',
    returns: '{ contractVersion, capability, value, evidence, confidence, source, status, corrections }',
    note: '결과 하나를 계약 모양으로 만듭니다. 계약 버전은 여기서 찍히고, evidence 와 confidence 를 안 넘기면 빈 배열과 null 입니다.',
  },
  {
    pkg: '@ax/ai-core',
    name: 'applyCorrection',
    signature: 'applyCorrection<T>(value: AiValue<T>, next: T, by: string, at: string, note?: string): AiValue<T>',
    returns: '같은 모양, status 는 corrected 이고 corrections 에 한 줄이 쌓입니다',
    note: '사람이 고친 것을 기록합니다. 덮어쓰지 않습니다. 허용되지 않은 전이면 던집니다.',
  },
  {
    pkg: '@ax/ai-core',
    name: 'climb',
    signature: 'climb(raw: unknown, rungs?: readonly Rung[], target?: number): ClimbResult',
    returns: "{ status: 'current', value, storedVersion, upgraded } 또는 { status: 'legacy' | 'gap' | 'ahead', original, storedVersion, reason }",
    note: '저장된 줄을 지금 계약까지 올립니다. 못 올리면 원본을 그대로 들고 옵니다. 그대로 다시 써도 같은 바이트입니다.',
  },
  {
    pkg: '@ax/ai-core',
    name: 'canRead',
    signature: 'canRead(catalog: Catalog, entity: string, field: string, rowId: string, scope: ReadScope): ReadDecision',
    returns: "{ allowed: true } 또는 { allowed: false, reason: 'unknown_entity' | 'unknown_field' | 'field_closed' | 'field_secret' | 'row_out_of_scope' }",
    note: '이 사람이 이 줄의 이 자리를 볼 수 있는지 한 번에 답합니다. 자리 판정과 줄 판정을 두 곳에서 하면 한쪽이 빠집니다.',
  },
  {
    pkg: '@ax/ai-gateway',
    name: 'maskPii',
    signature: 'maskPii(text: string, options?: MaskOptions): MaskResult',
    returns: '{ text, hits: [{ kind, value, token }] }',
    note: "주민번호·전화·메일·계좌·사업자번호·카드번호를 자리표로 바꿉니다. 이름은 추측하지 않고 options.knownNames 로 넘긴 것만 바꿉니다.",
  },
  {
    pkg: '@ax/ai-gateway',
    name: 'callWithFallback',
    signature: 'callWithFallback<M extends CallableModel, C extends string>(chain: readonly M[], req: CallRequest<C>, deps: GatewayDeps<M, C>): Promise<CallResult>',
    returns: '{ text, meta: { modelId, modelName, fallbackFrom, internal, latencyMs, costKrw, maskedCounts, callReceipt, transferReceipt } }',
    note: '후보를 순서대로 시도합니다. 모델을 바꿀 때마다 전송 판정을 다시 봅니다. 한 번만 보면 폴백이 곧 유출입니다.',
  },
  {
    pkg: '@ax/ai-providers',
    name: 'pickModels',
    signature: 'pickModels<C extends string, M extends PickableModel<C>>(models: readonly M[], opts: PickOptions<C>): ModelPick<M>',
    returns: "{ chain: M[], excluded: [{ model, reason: 'doc_class' | 'disabled' | 'not_multimodal' }] }",
    note: '쓸 수 있는 모델을 순서대로 고르고, 빠진 모델마다 이유를 답니다. 이유가 있으면 화면이 「왜 이 모델이 없나」에 답할 수 있습니다.',
  },
  {
    pkg: '@ax/ai-react',
    name: 'confidenceView',
    signature: "confidenceView(confidence: number | null, labels: Pick<AiLabels, 'confidenceUnknown'>, lowBelow?: number): ConfidenceView",
    returns: "{ kind: 'known', percent, text, low } 또는 { kind: 'unknown', text }",
    note: '확신을 그리는 규칙 한 벌입니다. null 을 0% 로 그리지 않습니다. 낮다고 볼 선은 넘기면 그 값을 씁니다.',
  },
  {
    pkg: '@ax/ai-react',
    name: 'missingLabels',
    signature: 'missingLabels(labels: Partial<AiLabels> | null | undefined): string[]',
    returns: '빠진 말의 이름들, 빈 배열이면 다 찼습니다',
    note: '부품에 넘길 말이 덜 찼는지 런타임에도 답합니다. 타입 검사만 믿으면 빈 문자열이 통과합니다.',
  },
]

export interface AiErrorDoc {
  name: string
  when: string
  fix: string
}

export const AI_ERRORS: readonly AiErrorDoc[] = [
  {
    name: 'NoModelAvailableError',
    when: '후보를 전부 시도했고 하나도 답하지 않았을 때 callWithFallback 이 던집니다.',
    fix: 'tried 에 시도한 모델이, lastError 에 마지막 사유가 들어 있습니다. 그 사유를 사용자에게 보이세요. 「3번 시도함」만 남기면 왜 실패했는지 아무도 모릅니다.',
  },
  {
    name: 'TransferBlockedError',
    when: '이 등급의 문서를 이 모델로 보낼 수 없다고 전송 판정이 답했을 때 만들어집니다. 던지지는 않습니다.',
    fix: '그 후보만 빼고 다음으로 넘어갑니다. 전부 막히면 NoModelAvailableError 의 lastError 로 이 사유가 옵니다. 막힌 호출은 전송 기록에 남지 않습니다. 나간 것이 없기 때문입니다.',
  },
  {
    name: 'JsonRecoverError',
    when: 'recoverJson 이 답에서 JSON 을 못 건졌을 때 던집니다. 모델이 JSON 대신 산문을 낸 경우입니다.',
    fix: '앞 200자를 들고 옵니다. 그 조각을 기록에 남기세요. 같은 프롬프트로 다시 물으면 같은 답이 오는 경우가 많습니다.',
  },
  {
    name: 'Error: cannot correct a value in status "…"',
    when: 'applyCorrection 을 허용되지 않은 전이에 불렀을 때입니다. 받는 중인 값을 바로 고치려는 경우가 이에 해당합니다.',
    fix: 'canTransition 으로 먼저 물어보세요. 상태 전이는 결과 계약 절의 표에 있습니다.',
  },
  {
    name: 'Error: two rungs climb from version N',
    when: 'climb 에 같은 버전에서 올라가는 사다리를 둘 넘겼을 때입니다.',
    fix: '사다리는 버전마다 하나입니다. 둘이면 어느 쪽이 도는지 순서에 따라 달라져 결과가 갈립니다.',
  },
]

/* ── 결과 계약: 타입과 상태 ─────────────────────────────────────────────────── */

/** 저장하는 모양 — `packages/ai-core/src/contract.ts` 의 선언을 그대로 보여 준다 */
export const AI_CONTRACT_TYPE = {
  lang: 'ts',
  text: `interface AiValue<T = unknown> {
  contractVersion: number
  capability: AiCapability               // 능력 여덟 중 하나
  value: T
  evidence: readonly AiEvidence[]
  confidence: number | null              // 0 에서 1, 모델이 말하지 않았으면 null
  source: AiSource
  status: AiValueStatus
  corrections: readonly AiCorrection[]
}

interface AiEvidence { blockId: string; start: number; end: number; quote?: string }
interface AiSource  { providerId: string; modelId: string; at: string }   // at 은 ISO 8601, 항상 UTC
interface AiCorrection { at: string; by: string; from: string; to: string; note?: string }

type AiValueStatus = 'streaming' | 'candidate' | 'confirmed' | 'corrected'`,
} as const

/**
 * 상태와 옮겨 갈 수 있는 곳.
 *
 * `to` 를 손으로 적지 않고 `canTransition` 에게 물어서 만든다. 손으로 적으면
 * 전이 규칙이 바뀔 때 화면이 옛 규칙을 계속 보여 주고, 그 표를 믿은 사람이 막힌다.
 */
export interface AiStatusRow {
  from: AiValueStatus
  label: string
  to: readonly AiValueStatus[]
  note: string
}

const STATUS_ORDER: readonly AiValueStatus[] = ['streaming', 'candidate', 'confirmed', 'corrected']

const STATUS_TEXT: Record<AiValueStatus, { label: string; note: string }> = {
  streaming: {
    label: '받는 중',
    note: '답이 아직 오고 있습니다. 로딩 표시가 아니라 상태입니다. 이 값을 저장해도 계약을 어기지 않습니다.',
  },
  candidate: {
    label: '확인 전',
    note: '모델이 답했고 사람이 아직 고르지 않았습니다. 추출과 추천의 결과는 여기서 시작합니다.',
  },
  confirmed: {
    label: '확인함',
    note: '사람이 받아들였습니다. 되돌리려면 고친 흔적으로 남깁니다.',
  },
  corrected: {
    label: '사람이 고침',
    note: '사람이 값을 바꿨습니다. 이전 값은 corrections 에 그대로 남습니다.',
  },
}

export const AI_STATUS_ROWS: readonly AiStatusRow[] = STATUS_ORDER.map((from) => ({
  from,
  label: STATUS_TEXT[from].label,
  to: STATUS_ORDER.filter((to) => canTransition(from, to)),
  note: STATUS_TEXT[from].note,
}))

/** 상태 이름을 사람이 읽는 말로 — 표의 「옮겨 갈 수 있는 곳」 칸이 쓴다 */
export const AI_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_ORDER.map((s) => [s, STATUS_TEXT[s].label]),
)

/** 한 화면을 처음부터 끝까지 — 부르고, 계약 모양으로 만들고, 저장하고, 그리고, 고친다 */
export const AI_CONTRACT_CODE = {
  lang: 'tsx',
  text: `import { newAiValue, applyCorrection } from '@ax/ai-core'
import { recoverJson } from '@ax/ai-gateway'
import { AiValue as AiValueView } from '@ax/ai-react'
import { guardedGeminiText } from '@/lib/ai/guarded-gemini'
import { AI_LABELS } from '@/lib/terms'

// 1. 부릅니다. 게이트웨이를 지나야 가림과 시간 제한과 전송 기록이 붙습니다
const out = await guardedGeminiText({
  prompt, apiKey, model,
  surface: 'quote-fill', purpose: '견적서에서 품목 뽑기',
  actorId: user.id,
})

// 2. 계약 모양으로 만듭니다. 계약 버전은 여기서 찍힙니다
const value = newAiValue({
  capability: 'extract',
  value: recoverJson(out.text),
  source: { providerId: 'gemini', modelId: model, at: new Date().toISOString() },
  status: 'candidate',                       // 사람이 고르기 전이라 확정이 아닙니다
  confidence: 0.82,
  evidence: [{ blockId: 'p3', start: 120, end: 168 }],
})

// 3. 저장합니다. 계약 버전은 칼럼으로도 함께 넣어야 읽을 때 climb 이 볼 수 있습니다
await db.from('my_ai_rows').insert({
  ...row,
  payload: value,
  contract_version: value.contractVersion,
})

// 4. 그립니다. 값을 어떻게 그릴지는 부르는 쪽만 압니다(금액인지 날짜인지 글인지)
//    문구도 부르는 쪽이 넘깁니다. 부품은 한 글자도 갖고 있지 않습니다
<AiValueView value={value} labels={AI_LABELS} render={(v) => <b>{String(v)}</b>} />

// 5. 사람이 고치면 쌓습니다. 덮어쓰지 않습니다
const fixed = applyCorrection(value, nextValue, user.id, new Date().toISOString())
// fixed.status === 'corrected', fixed.corrections 에 한 줄이 늘어납니다`,
} as const
