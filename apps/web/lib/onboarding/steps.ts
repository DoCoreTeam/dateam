/**
 * 온보딩 스텝 데이터 SSOT.
 *
 * driver.js 자체에 의존하지 않는 순수 데이터(서버·클라이언트 양쪽 import 가능).
 * useTour.ts가 이 데이터를 driver.js DriveStep으로 변환한다.
 *
 * 시퀀스 종류:
 *  - main:    최초 로그인 시 자동 강제(P0). /home → /daily(실습) → /org.
 *  - ai:      "더 둘러보기" 선택형(P1). 자동 강제 X.
 *  - gpu:     "더 둘러보기" 선택형(P2). 자동 강제 X.
 *  - weekly:  주간보고 작성 가이드(기존 SpotlightOnboarding 흡수). 주간보고 화면에서만 시작.
 */

export type OnboardingSequenceKey = 'main' | 'ai' | 'gpu' | 'weekly'

export interface OnboardingStep {
  /** 시퀀스 내 고유 key. URL `?onboard=<key>` 동기화에 사용. */
  key: string
  /** 이 스텝이 속한 라우트(pathname). 라우트 진입 후에만 강조. element 없는 중앙 모달도 라우트 필요. */
  route: string
  /** 라우트 이동 시 보존할 쿼리스트링(예: 'tab=cockpit'). onboard 파라미터와 함께 붙는다. */
  routeQuery?: string
  /**
   * 강조 대상 CSS 셀렉터.
   * 비우면 element 없는 중앙 모달(환영/안내).
   * 비동기 렌더 타겟이라 useTour가 함수형 `() => document.querySelector(selector)`로 감싼다.
   */
  element?: string
  title: string
  description: string
  /**
   * true면 Next 버튼을 숨기고(showButtons:[]), 실제 행동 성공 시에만 moveNext()로 진행.
   * 행동 성공 신호는 전역 이벤트 "ax-onboarding-advance"로 도착한다.
   */
  gated?: boolean
  /** 게이팅 스텝이 기다리는 행동 식별자(이벤트 detail.event와 매칭). */
  interactionEvent?: string
  /** 팝오버 위치 힌트(driver.js side/align). */
  side?: 'top' | 'right' | 'bottom' | 'left' | 'over'
  align?: 'start' | 'center' | 'end'
}

export interface OnboardingSequence {
  key: OnboardingSequenceKey
  /** 시퀀스 첫 스텝이 위치한 라우트(자동시작·재진입 시 이동 대상). */
  entryRoute: string
  steps: OnboardingStep[]
}

/** P0 — 최초 로그인 자동 강제 시퀀스. */
const MAIN_SEQUENCE: OnboardingSequence = {
  key: 'main',
  entryRoute: '/home',
  steps: [
    {
      key: 'welcome',
      route: '/home',
      title: '환영합니다 👋',
      description:
        '업무를 더 빠르게 처리하도록 핵심 화면을 1분 안에 함께 둘러봅니다. 언제든 건너뛸 수 있고, 나중에 다시 시작할 수도 있어요.',
      side: 'over',
      align: 'center',
    },
    {
      key: 'sidebar',
      route: '/home',
      element: '#onboarding-sidebar-nav',
      title: '여기서 모든 화면으로 이동해요',
      description:
        '왼쪽 메뉴로 홈·업무·캘린더·조직도를 오갑니다. 자주 쓰는 화면이 모두 여기 모여 있어요.',
      side: 'right',
      align: 'start',
    },
    {
      key: 'daily-input',
      route: '/daily',
      element: '#onboarding-daily-input',
      title: '오늘 한 일을 직접 입력해 보세요',
      description:
        '여기에 업무를 자유롭게 적고 "저장"을 누르면 AI가 자동으로 분류해 줍니다. 직접 한 번 등록해 볼까요? (연습용으로 기록되며 보고서·통계에는 집계되지 않습니다)',
      gated: true,
      interactionEvent: 'daily-saved',
      side: 'bottom',
      align: 'start',
    },
    {
      key: 'org',
      route: '/org',
      element: '#onboarding-org-tree',
      title: '조직과 내 위치를 확인해요',
      description:
        '회사 조직도와 내가 속한 부서를 한눈에 볼 수 있습니다. 동료를 찾거나 보고 라인을 확인할 때 유용해요.',
      side: 'top',
      align: 'center',
    },
    {
      key: 'gpu-prices',
      route: '/pricing/gpu',
      routeQuery: 'tab=board',
      element: '.gpu-pricing-root',
      title: 'GPU 가격표를 확인해요',
      description:
        'GPU별 우리 판매가를 가격표에서 한눈에 봅니다. 행을 펼치면 시장가 대비·상세 근거도 확인할 수 있어요.',
      side: 'over',
      align: 'center',
    },
    {
      key: 'done',
      route: '/pricing/gpu',
      title: '준비 완료 🎉',
      description:
        '핵심 화면을 모두 둘러봤어요. 더 궁금한 기능은 사이드바의 "온보딩 다시 하기"로 언제든 다시 볼 수 있습니다.',
      side: 'over',
      align: 'center',
    },
  ],
}

/** P1 — AI 체험 선택형 시퀀스. */
const AI_SEQUENCE: OnboardingSequence = {
  key: 'ai',
  entryRoute: '/daily',
  steps: [
    {
      key: 'ai-intro',
      route: '/daily',
      element: '#onboarding-daily-input',
      title: 'AI가 업무를 정리해 줘요',
      description:
        '여러 일을 한 번에 적어도 AI가 항목별로 나누고 우선순위·일정을 추정합니다. 결과는 항상 확인 후 반영되니 안심하세요.',
      side: 'bottom',
      align: 'start',
    },
  ],
}

/** P2 — GPU 가격 확인 선택형 시퀀스. */
const GPU_SEQUENCE: OnboardingSequence = {
  key: 'gpu',
  entryRoute: '/pricing/gpu?tab=board',
  steps: [
    {
      key: 'gpu-prices',
      route: '/pricing/gpu',
      routeQuery: 'tab=board',
      element: '.gpu-pricing-root',
      title: 'GPU 가격표를 확인해요',
      description:
        'GPU별 우리 판매가를 가격표에서 한눈에 봅니다. 행을 펼치면 시장가 대비·상세 근거도 확인할 수 있어요.',
      side: 'over',
      align: 'center',
    },
  ],
}

/** 주간보고 작성 가이드 — 기존 SpotlightOnboarding 5스텝 흡수. */
const WEEKLY_SEQUENCE: OnboardingSequence = {
  key: 'weekly',
  entryRoute: '/weekly-report',
  steps: [
    {
      key: 'weekly-selector',
      route: '/weekly-report',
      element: '#onboarding-daily-selector',
      title: '일일보고에서 가져와 반영',
      description:
        '작성폼 우측에 이번 주 일일업무가 상시 표시됩니다. 포함할 업무를 체크하고 "폼에 반영"을 누르면 AI가 성과·계획·이슈로 작성해 왼쪽 폼에 채워 줍니다.',
      side: 'bottom',
      align: 'start',
    },
    {
      key: 'weekly-category',
      route: '/weekly-report',
      element: '#onboarding-category',
      title: '구분',
      description: '업무 카테고리를 입력하세요. 예: 영업, 마케팅, 기획 (AI 생성 시 자동 분류됩니다).',
      side: 'bottom',
      align: 'start',
    },
    {
      key: 'weekly-performance',
      route: '/weekly-report',
      element: '#onboarding-performance',
      title: '성과',
      description: '이번 주 완료한 업무와 결과를 작성합니다. 클릭하면 편집기가 열립니다.',
      side: 'top',
      align: 'start',
    },
    {
      key: 'weekly-plan',
      route: '/weekly-report',
      element: '#onboarding-plan',
      title: '계획',
      description: '다음 주 진행할 업무 계획을 작성합니다.',
      side: 'top',
      align: 'start',
    },
    {
      key: 'weekly-issues',
      route: '/weekly-report',
      element: '#onboarding-issues',
      title: '이슈/협조사항',
      description: '진행 중 발생한 문제나 도움이 필요한 사항을 작성합니다.',
      side: 'top',
      align: 'start',
    },
  ],
}

export const ONBOARDING_SEQUENCES: Record<OnboardingSequenceKey, OnboardingSequence> = {
  main: MAIN_SEQUENCE,
  ai: AI_SEQUENCE,
  gpu: GPU_SEQUENCE,
  weekly: WEEKLY_SEQUENCE,
}

export function getSequence(key: OnboardingSequenceKey): OnboardingSequence {
  return ONBOARDING_SEQUENCES[key]
}

/** stepKey로 해당 스텝의 시퀀스 내 인덱스를 찾는다. 없으면 0. */
export function findStepIndex(seq: OnboardingSequence, stepKey: string | null): number {
  if (!stepKey) return 0
  const i = seq.steps.findIndex((s) => s.key === stepKey)
  return i >= 0 ? i : 0
}
