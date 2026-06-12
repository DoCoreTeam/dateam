# v0.7.86 — 빠른 추가 FAB 하이브리드(맥락 강조 speed-dial)
## 작업
우하단 "+" FAB가 통합입력 단일 링크 → 하이브리드 speed-dial(현재 페이지 액션 최상단 강조 + 전역 빠른추가 + 가격·견적 입력).
## 변경
- lib/fab-actions.ts(신규): route→액션 SSOT. GLOBAL_QUICK_ACTIONS(일일/거래처/연락처/딜/일정)+INTAKE_ACTION(가격·견적 입력=구 통합입력). fabActionsForPath()가 현재 경로 매칭 액션을 최상단 강조.
- components/ui/QuickAddFab.tsx(신규): client speed-dial. +↔× 토글, 메뉴(현재페이지 primary+나머지), ESC·바깥클릭·페이지이동 닫힘, a11y(aria-expanded/haspopup/menu).
- MobileShell: 기존 /intake 단일 Link → <QuickAddFab/> 교체(mobile-only 유지).
- globals.css: .quickadd-fab-wrap/.quickadd-menu/.quickadd-item(--primary)/.quickadd-item-icon 토큰 기반.
- "통합입력"→"가격·견적 입력"으로 라벨 정정(실제 GPU 가격입력 반영).
## 검증
Playwright(390px): /accounts→거래처 강조·6항목, /daily→일일업무 강조, FAB 토글·메뉴 렌더. tsc0/design/test72. DB·페이지모달 무변경(네비 링크).
