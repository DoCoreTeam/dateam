# FAST PATH Summary
작업: 시장 비교 탭 모바일 UX 개선 — 텍스트→아이콘/축약어 변환으로 반응형 품질 향상
대상: apps/web/app/(member)/pricing/gpu/tabs/MarketTab.tsx, apps/web/app/globals.css
이유: 단순 렌더링 깨짐 방지를 넘어 모바일에서 실제로 쓸 수 있는 UI 구현 (아이콘 전용 버튼, 축약 레이블, 컬럼 축소)
영향: 데스크탑 레이아웃 무변경 (desktop-only/mobile-only CSS 클래스로 분기)

## 변경 내용

### 배너 버튼 — 아이콘 전용 (모바일)
- "가격 등록" → Plus 아이콘만 (텍스트: .gpu-btn-text-mob → 모바일 숨김)
- "새로고침" → RefreshCw 아이콘만 (동일 패턴)
- title 속성으로 접근성 유지

### 그룹 필터 — 축약어 (모바일)
- COMP_GROUPS에 short 필드 추가 (하이퍼스케일러→하이퍼, 전용 서비스→전용, 마켓플레이스→마켓)
- desktop-only/mobile-only 클래스로 분기 렌더링
- "그룹:", "경쟁사:" 레이블: .gpu-filter-label-mob → 모바일 숨김

### 테이블 컬럼 — 핵심만 (모바일)
- 모바일: GPU모델 + 내가격 + 화살표 3컬럼만 표시
- "시장 범위", "가격 포지셔닝" 컬럼: .gpu-market-col-hide → 모바일 숨김
- .gpu-market-grid 클래스로 grid 오버라이드

### 탭 버튼 — 축약 (모바일)
- "시장 위치 분석" → "분석" (desktop-only/mobile-only 분기)
- "1등 전략" → "전략"

### 통계 카드 하위 텍스트 — 숨김 (모바일)
- .gpu-stat-sub: 모바일에서 display:none
