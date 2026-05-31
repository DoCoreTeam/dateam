# FAST PATH Summary
작업: 시장 비교 탭 경쟁사 가격 카드 오름차순 정렬 (싼 순서 → 비싼 순서, 좌→우)
대상: apps/web/app/(member)/pricing/gpu/tabs/MarketTab.tsx
이유: byComp 렌더링이 API 반환 순서 그대로여서 가격 정렬이 없었음. price_usd 기준 오름차순 정렬 추가. 가격 없는 경쟁사(null)는 맨 뒤로.
영향: MarketTab.tsx 내부만 (AnalyzePanel 컴포넌트). API·DB 변경 없음.
부가: dangerouslySetInnerHTML + no-op replace → 단순 span으로 XSS 위험 제거
