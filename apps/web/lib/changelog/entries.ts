// 사용자향 업데이트 내역 SSOT — "사용자에게 보내는 친절한 편지".
// git 커밋(개발자 일지)과 완전 분리된, 진짜 사용자를 위한 변경 안내.
// ChangelogModal이 이 파일을 직접 import해 렌더한다(배포 = 게시. DB·런타임 동기화 없음).
//
// ┌─ 작성 규율 (커밋할 때 사용자 체감 변경이 있으면 이 파일 맨 위에 1블록 추가) ─┐
// │ 포함 ✅  새 사용자 기능 · 사용자가 겪던 버그 수정 · 눈에 보이는 개선(속도·UI·편의)   │
// │ 제외 ❌  어드민 전용 · 백엔드/DB/인프라 · 리팩터/테스트/CI · 버전범프 · 내부검증문구  │
// │ 톤      귀엽고 친절한 비즈니스 언어. "~했어요/~돼요". 개발 용어·내부 표현 금지.     │
// │ 판정    "로그인한 일반 사용자가 화면에서 직접 체감하나?" 예=포함(친절어), 아니오=제외 │
// └──────────────────────────────────────────────────────────────────┘

import type { ChangeType } from './types'

export interface ChangelogNoteItem {
  /** 배지: 새 기능(feature) / 해결(fix) / 개선(improve) */
  kind: ChangeType
  /** 귀여운 아이콘 */
  emoji: string
  /** 친절한 한 줄 */
  headline: string
  /** 1~2문장 비즈니스 친화 설명(무엇이 되고 왜 좋은지) */
  detail: string
}

export interface ChangelogNote {
  version: string        // '0.7.205'
  date: string           // 'YYYY-MM-DD'
  title: string          // 이 업데이트를 한 줄로
  items: ChangelogNoteItem[]
}

// 최신이 위로 — 사용자 체감 기능만 큐레이션.
export const CHANGELOG: ChangelogNote[] = [
  {
    version: '0.7.377',
    date: '2026-07-24',
    title: 'GPU 목록이 한눈에 깔끔해졌어요',
    items: [
      {
        kind: 'improve',
        emoji: '🗂️',
        headline: 'H100·A100이 폼팩터별로 하나로 묶여 보여요',
        detail:
          '같은 H100인데 SXM·PCIe·NVL이 제각기 다른 모델처럼 여러 줄로 흩어져 보이던 걸, 이제 "H100" 하나로 묶고 펼치면 폼팩터별로 확인할 수 있게 정리했어요. 장수(×1·2·4·8) 계산도 폼팩터마다 동일하게 적용됩니다.',
      },
      {
        kind: 'fix',
        emoji: '🧹',
        headline: '똑같은 GPU가 중복으로 뜨던 것 정리',
        detail:
          'RTX 시리즈·T4 등 완전히 같은 사양이 목록에 두세 번씩 겹쳐 보이던 중복을 하나로 합쳤어요. 기존 가격·견적 정보는 그대로 유지되며 목록만 깔끔해집니다.',
      },
    ],
  },
  {
    version: '0.7.365',
    date: '2026-07-21',
    title: '경쟁사 GPU 시세가 더 정확해졌어요',
    items: [
      {
        kind: 'fix',
        emoji: '💴',
        headline: '엔화·달러 시세가 원화로 제대로 환산돼요',
        detail:
          '일본·해외 가격표를 넣었을 때 통화가 잘못 바뀌거나 월정액 가격이 저장조차 안 되던 문제를 고쳤어요. 이제 경쟁사 가격이 원래 통화 그대로 정확히 원화로 환산돼 보입니다.',
      },
      {
        kind: 'fix',
        emoji: '📊',
        headline: '가격표 표시 오류 정리',
        detail:
          '모델과 사양이 섞여 보이거나, 금액이 어긋나거나, 예약형·즉시형(Spot) 가격이 구분되지 않고, 값이 "0원"으로 잘못 뜨던 문제들을 한 번에 바로잡았어요.',
      },
    ],
  },
  {
    version: '0.7.337',
    date: '2026-07-20',
    title: '주간보고에서 몇 주차인지 헷갈리지 않아요',
    items: [
      {
        kind: 'improve',
        emoji: '📅',
        headline: '현재 주차가 탭 옆에 항상 보이고, 탭을 옮겨도 유지돼요',
        detail:
          '내 보고·팀·취합 탭을 오갈 때 보던 주차가 그대로 유지돼요. 지금 보고 있는 주차가 화면 위에 늘 표시되고, 한 번에 다른 주차로 빠르게 바꿀 수도 있어요.',
      },
    ],
  },
  {
    version: '0.7.334',
    date: '2026-07-16',
    title: 'GPU 관리 화면 떨림을 없앴어요',
    items: [
      {
        kind: 'fix',
        emoji: '🩹',
        headline: '탭을 눌렀을 때 화면이 떨리던 문제 해결',
        detail:
          'GPU 관리에서 탭을 전환할 때 화면이 "다다닥" 떨리며 왔다 갔다 하던 현상을 근본적으로 고쳤어요. 이제 부드럽게 한 번에 전환됩니다.',
      },
    ],
  },
  {
    version: '0.7.326',
    date: '2026-07-15',
    title: '통합입력이 GPU가 아닌 항목은 걸러내요',
    items: [
      {
        kind: 'fix',
        emoji: '🧹',
        headline: 'GPU 모델이 아닌 잘못된 추출 자동 제외',
        detail:
          '가격표가 아닌 페이지(예: 메뉴·소개 페이지)를 넣었을 때 "서비스·월정액·스토리지" 같은 GPU가 아닌 항목이 모델로 잘못 잡히던 문제를 고쳤어요. 이제 진짜 GPU 모델만 남깁니다.',
      },
    ],
  },
  {
    version: '0.7.324',
    date: '2026-07-15',
    title: 'AI 조회를 어느 화면에서든 바로 열 수 있어요',
    items: [
      {
        kind: 'improve',
        emoji: '✨',
        headline: 'AI 조회 상시 열기',
        detail:
          'GPU 관리의 어느 탭(공급사·경쟁사·수집 소스 등)에 있든 오른쪽 위 "AI 조회"를 누르면 바로 질문 패널이 떠요. 예전엔 가격표에서만 열렸어요.',
      },
    ],
  },
  {
    version: '0.7.323',
    date: '2026-07-15',
    title: '통합입력 종류를 탭으로, AI 조회가 더 똑똑해졌어요',
    items: [
      {
        kind: 'improve',
        emoji: '🗂️',
        headline: '통합입력 — 공급사/경쟁사를 탭으로 먼저 선택',
        detail:
          '"공급사 견적"과 "경쟁사 시장가"를 위쪽 탭에서 먼저 고르고 붙여넣어요. 무엇을 넣는지 명확해져서 뒤바뀌는 혼란이 사라졌어요.',
      },
      {
        kind: 'fix',
        emoji: '🔎',
        headline: 'AI 조회가 경쟁사 시세까지 전부 봐요',
        detail:
          'AI 조회가 우리 상품·공급가뿐 아니라 경쟁사 시장가·경쟁사 목록·스펙·직판가까지 모두 참고해 답해요. "어느 경쟁사가 더 싼가" 같은 질문에 정확히 답합니다.',
      },
      {
        kind: 'fix',
        emoji: '📜',
        headline: 'AI 조회 답변이 자동으로 따라 내려가요',
        detail:
          '답변이 길게 나올 때 직접 스크롤을 내리지 않아도 최신 내용이 자동으로 보이도록 고쳤어요.',
      },
    ],
  },
  {
    version: '0.7.314',
    date: '2026-07-15',
    title: '통합입력에서 "넣는 종류"를 먼저 고를 수 있어요',
    items: [
      {
        kind: 'improve',
        emoji: '🎯',
        headline: '공급사 견적인지 경쟁사 시장가인지 먼저 선택',
        detail:
          'GPU 통합입력에서 붙여넣기 전에 "넣는 종류"(공급사 견적 / 경쟁사 시장가)를 고르면, 시스템이 추측하지 않고 고른 대로 정확히 분류해요. 그동안 가끔 공급가와 경쟁가가 뒤바뀌던 혼란이 줄어듭니다. (그대로 두면 예전처럼 자동 판별해요.)',
      },
    ],
  },
  {
    version: '0.7.311',
    date: '2026-07-15',
    title: 'GPU 데이터에 말로 물어보는 AI 조회가 켜졌어요',
    items: [
      {
        kind: 'feature',
        emoji: '💬',
        headline: 'AI 조회 — 우리 GPU 데이터에 바로 질문',
        detail:
          'GPU 가격표 화면 오른쪽 "AI 조회"를 누르면, 우리 시스템에 저장된 상품·공급가·시장가·재고에 대해 한국어로 물어보고 답을 받을 수 있어요. (그동안 버튼만 있고 안 열리던 문제를 고쳐 실제로 동작하게 했습니다.)',
      },
    ],
  },
  {
    version: '0.7.309',
    date: '2026-07-15',
    title: 'GPU 가격 화면이 넣은 그대로 보이고, 정렬도 돼요',
    items: [
      {
        kind: 'fix',
        emoji: '💱',
        headline: '원으로 넣은 가격은 원으로 보여요',
        detail:
          '공급사 화면에서 원(₩)으로 입력한 공급가가 달러($)로 바뀌어 보이던 문제를 고쳤어요. 이제 넣은 통화 그대로 — 원은 원, 달러는 달러로 표시됩니다.',
      },
      {
        kind: 'improve',
        emoji: '↕️',
        headline: '공급사 모델 목록 정렬 추가',
        detail:
          '공급사 상세에서 모델 목록을 이름순·가격 낮은순·등급순·상태순으로 정렬할 수 있어요. 원하는 순서로 빠르게 찾아보세요.',
      },
    ],
  },
  {
    version: '0.7.298',
    date: '2026-07-14',
    title: '주간보고가 쉬워지고, 지난 활동을 한눈에',
    items: [
      {
        kind: 'feature',
        emoji: '🤖',
        headline: '주간보고 AI 자동 초안',
        detail:
          '한 주 동안의 일일 업무와 일정을 AI가 분석해 성과·계획·이슈 초안을 미리 작성해 드려요. 확인하고 다듬기만 하면 주간보고가 완성됩니다.',
      },
      {
        kind: 'feature',
        emoji: '📋',
        headline: '업무 통합 이력 한눈에',
        detail:
          '일일·주간·부서·프로젝트 활동을 한 곳에서 모아 보고, 예전에 작성한 내용을 그대로 되살릴 수 있어요.',
      },
      {
        kind: 'improve',
        emoji: '👥',
        headline: '조직원 선택이 편리해졌어요',
        detail:
          '이름 검색이나 조직도 트리에서 여러 명을 한 번에 골라 담을 수 있어, 회의·업무 연결이 훨씬 빨라졌습니다.',
      },
      {
        kind: 'fix',
        emoji: '🕘',
        headline: '캘린더 시간 표시 정확도 개선',
        detail:
          '일정 시각이 실제보다 늦게 표시되던 문제를 바로잡아, 입력한 시간 그대로 정확히 보이도록 했어요.',
      },
    ],
  },
  {
    version: '0.7.224',
    date: '2026-06-21',
    title: '사용자 편의 및 기능 개선 업데이트',
    items: [
      {
        kind: 'improve',
        emoji: '✨',
        headline: '화면 간격 및 디자인 정돈',
        detail: '파비콘의 간격을 보기 좋게 조정하여 시각적인 편안함을 더했습니다.',
      },
      {
        kind: 'feature',
        emoji: '🤖',
        headline: 'GPU 가격 정보 입력 방식 고도화',
        detail: 'AI가 복잡한 형식의 데이터를 스스로 인식하고 정리하여, 입력 오류를 줄이고 더욱 정확한 가격 정보를 제공합니다.',
      },
      {
        kind: 'improve',
        emoji: '🔄',
        headline: 'GPU 가격 정보 실시간 동기화 강화',
        detail: '가격 변경 사항이 모든 화면에 즉시 반영되도록 개선하여, 항상 최신 정보를 확인하실 수 있습니다.',
      },
      {
        kind: 'fix',
        emoji: '🛠️',
        headline: 'GPU 가격 표시 오류 수정',
        detail: '일부 화면에서 최저가 공급사 정보가 잘못 표시되거나 가격이 갱신되지 않던 문제를 해결했습니다.',
      },
      {
        kind: 'feature',
        emoji: '🏷️',
        headline: '공급가 직접 지정 기능 추가',
        detail: 'GPU 통합 뷰에서 특정 공급사의 견적을 판매가 기준으로 직접 지정할 수 있게 되어 가격 관리가 더욱 편리해졌습니다.',
      },
      {
        kind: 'fix',
        emoji: '📝',
        headline: '주간 보고서 작성 기능 안정화',
        detail: '보고서 생성 시 기존 내용이 덮어쓰여지거나 병합이 매끄럽지 않던 현상을 수정하여 안심하고 작성하실 수 있습니다.',
      },
      {
        kind: 'improve',
        emoji: '🗓️',
        headline: '주간 보고서 작성 안내 개선',
        detail: '보고서 작성 안내 모달과 업데이트 알림 모달이 겹치지 않게 개선하여 업무 흐름을 방해하지 않도록 했습니다.',
      },
      {
        kind: 'feature',
        emoji: '⏰',
        headline: '주간 보고서 제출 현황 확인 기능',
        detail: '보고서 제출 여부와 지연 상태를 한눈에 파악할 수 있도록 배지와 툴팁 기능을 추가했습니다.',
      },
      {
        kind: 'improve',
        emoji: '📊',
        headline: '일일 업무 모니터링 화면 개편',
        detail: '달력 형태로 팀원들의 업무 작성 현황을 더 직관적으로 확인하고 관리할 수 있게 되었습니다.',
      },
      {
        kind: 'feature',
        emoji: '🔔',
        headline: '새로운 업데이트 알림 기능',
        detail: '새로운 기능이 추가되면 상단 버전 버튼에 알림 배지가 표시되며, 첫 접속 시 변경 사항을 모달로 간편하게 확인할 수 있습니다.',
      },
      {
        kind: 'fix',
        emoji: '📅',
        headline: '회의 노트 일정 시간 표시 오류 수정',
        detail: 'AI가 추출한 회의 일정 시간이 한국 표준시 기준으로 정확하게 표시되도록 수정했습니다.',
      },
    ],
  },
  {
    version: '0.7.205',
    date: '2026-06-20',
    title: '회의노트가 더 똑똑해졌어요',
    items: [
      {
        kind: 'feature',
        emoji: '🔗',
        headline: '회의 참석자를 자동으로 알아봐요',
        detail: '회의록에 적은 참석자를 조직원과 자동으로 연결하고, 외부 참석자도 함께 깔끔하게 정리해드려요.',
      },
      {
        kind: 'feature',
        emoji: '📅',
        headline: '회의 → 일정 → 업무가 하나로 이어져요',
        detail: '회의에서 정한 일정과 할 일이 캘린더와 업무에 자동으로 연결돼, 따로 옮겨 적지 않아도 돼요.',
      },
    ],
  },
  {
    version: '0.7.199',
    date: '2026-06-18',
    title: '회의노트가 생겼어요',
    items: [
      {
        kind: 'feature',
        emoji: '📝',
        headline: '회의 내용을 적으면 AI가 정리해드려요',
        detail: '회의록을 작성하면 핵심을 깔끔하게 다듬고, 할 일과 일정까지 자동으로 뽑아드려요. 회의록 따로·정리 따로 하지 않아도 돼요.',
      },
    ],
  },
  {
    version: '0.7.195',
    date: '2026-06-18',
    title: 'GPU 견적이 훨씬 쉬워졌어요',
    items: [
      {
        kind: 'feature',
        emoji: '📥',
        headline: '이미지·PDF·엑셀을 한 곳에 끌어다 놓기',
        detail: '견적 자료를 형식에 상관없이 한 번에 올리면 AI가 알아서 읽어들여 정리해드려요.',
      },
      {
        kind: 'improve',
        emoji: '🔢',
        headline: '가격표에 카드 장수를 함께 표시',
        detail: "메모리를 '40GB × 2'처럼 카드당 용량과 장수로 명확하게 보여드려, 한눈에 구성을 파악할 수 있어요.",
      },
    ],
  },
  {
    version: '0.7.185',
    date: '2026-06-17',
    title: '처음 오셨나요? 함께 둘러봐요',
    items: [
      {
        kind: 'feature',
        emoji: '🎯',
        headline: '직접 따라 하며 익히는 첫 사용 안내',
        detail: '핵심 기능을 화면에서 콕 짚어주고, 업무 등록·GPU 확인을 직접 해보며 자연스럽게 익힐 수 있어요.',
      },
    ],
  },
  {
    version: '0.7.169',
    date: '2026-06-17',
    title: '캘린더가 더 빠르고 편해졌어요',
    items: [
      {
        kind: 'improve',
        emoji: '⚡',
        headline: '달력이 먼저 바로 떠요',
        detail: '데이터를 기다리지 않고 달력 화면이 즉시 나타나고, 일정은 준비되는 대로 채워져요.',
      },
      {
        kind: 'improve',
        emoji: '📅',
        headline: '업무 카드에서 바로 캘린더 등록',
        detail: '각 업무에서 한 번의 클릭으로 일정에 등록하고, 필요하면 바로 취소할 수 있어요.',
      },
    ],
  },
  {
    version: '0.7.167',
    date: '2026-06-17',
    title: '프로젝트를 더 체계적으로',
    items: [
      {
        kind: 'feature',
        emoji: '📁',
        headline: '프로젝트 일정·기간·예산 관리',
        detail: '프로젝트마다 기간과 예산을 기록하고 진행 상태를 한눈에 관리할 수 있어요.',
      },
      {
        kind: 'feature',
        emoji: '✨',
        headline: 'AI가 예상 프로젝트를 제안해요',
        detail: '그동안의 업무를 똑똑하게 묶어 새 프로젝트 후보를 제안해드리고, 확인만 하면 바로 등록돼요.',
      },
    ],
  },
  {
    version: '0.7.159',
    date: '2026-06-16',
    title: '한 번에 모아서 찾기',
    items: [
      {
        kind: 'feature',
        emoji: '🔎',
        headline: '업무·부서·주간보고 통합 검색',
        detail: '상단 검색창 한 곳에서 일일업무, 부서업무, 주간보고를 한 번에 찾아볼 수 있어요.',
      },
    ],
  },
  {
    version: '0.7.154',
    date: '2026-06-16',
    title: '쓰던 글이 사라지지 않아요',
    items: [
      {
        kind: 'improve',
        emoji: '💾',
        headline: '자동 임시저장 + 되돌리기',
        detail: '작성 중 실수로 새로고침해도 내용이 그대로 남아있고, 지워버려도 Ctrl+Z로 손쉽게 되돌릴 수 있어요.',
      },
    ],
  },
  {
    version: '0.7.149',
    date: '2026-06-16',
    title: '내 업무를 한눈에',
    items: [
      {
        kind: 'feature',
        emoji: '📊',
        headline: '활동 현황 대시보드',
        detail: '고객별 관여도, 주별 활동 추세, 진행 상태를 보기 좋은 그래프로 한눈에 보여드려요.',
      },
    ],
  },
]

// 'a.b.c' 버전 비교 — 양수면 v1>v2. 정렬·신규판정·현재버전 판정의 단일 비교 함수(SSOT).
export function cmpVersion(v1: string, v2: string): number {
  const a = v1.split('.').map((n) => parseInt(n, 10) || 0)
  const b = v2.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d !== 0) return d }
  return 0
}

// 큐레이션 항목 중 가장 최신 버전(신규 배지·자동 안내 기준).
export const LATEST_CHANGELOG_VERSION = CHANGELOG.length
  ? [...CHANGELOG].sort((a, b) => cmpVersion(b.version, a.version))[0].version
  : ''

// 마지막으로 본 업데이트 내역 버전 localStorage 키(SSOT) — 자동 안내 모달 노출/억제 판정.
// 다른 모달(주간보고 작성안내 등)이 changelog 모달과 동시 노출 충돌을 피하려 이 키를 참조.
export const CHANGELOG_SEEN_KEY = 'changelog_seen_version'

/** changelog 자동 안내 모달이 떠야 하는 상태인지(미확인 신버전 존재). seen은 localStorage 값. */
export function isChangelogPending(seen: string | null): boolean {
  return !!LATEST_CHANGELOG_VERSION && (!seen || cmpVersion(LATEST_CHANGELOG_VERSION, seen) > 0)
}
