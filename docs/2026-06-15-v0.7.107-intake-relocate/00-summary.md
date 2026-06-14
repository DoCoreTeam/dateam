# 통합입력 메뉴 이동 + GPU 관리 탭화 — 작업 요약

작성 2026-06-15 · v0.7.107 · MEDIUM · 표시/네비게이션 변경(계산·데이터 불변)

## 작업
1. **사이드바**: "통합 입력"을 최상단(highlight=+버튼형)에서 **'가격정책' 그룹 내 GPU 관리 바로 위**로 이동 + **highlight 제거**(다른 메뉴와 동일 스타일).
2. **GPU 관리 탭**: "가격표" **왼쪽(첫 탭)**에 **"통합 입력" 탭 신설** → 클릭 시 **화면 내 임베드**(페이지 이동 없이 `QuoteRegisterTab` 표시). 사용자 선택: 임베드형.

## 수정 파일
- `app/(member)/layout.tsx` — NAV_ITEMS에서 intake 제거 → NAV_GROUPS '가격정책' 첫 항목으로(highlight 미지정).
- `app/(member)/pricing/gpu/GpuPricingClient.tsx` — MainTabId에 'intake' 추가, MAIN_TABS 첫 항목, unifiedOn 필터에 intake 포함, 'intake' 패널에 `QuoteRegisterTab` 렌더, VALID_TABS·admin가드 허용목록에 추가.

## 변경 이유
- 통합입력이 메뉴 최상단 특수버튼이라 동선·위계가 GPU 가격정책과 어긋남 → 가격정책 묶음으로 정렬.
- GPU 관리 안에서 입력→가격표를 한 화면 탭 전환으로 처리(페이지 왕복 제거).

## 영향 범위
- 기존 `/intake` 페이지·사이드바 링크 **유지**(병존). QuoteRegisterTab은 두 진입점이 공유(SSOT, 재구현 없음).
- 계산식(buildCatalog)·DB·API 무변경. 표시/라우팅만.

## 완료 조건
- [ ] 사이드바: 통합입력이 GPU 관리 바로 위, 일반 항목 스타일(+버튼 아님)
- [ ] GPU 관리: 가격표 왼쪽 "통합 입력" 탭, 클릭 시 같은 화면에 QuoteRegisterTab 표시
- [ ] 탭 복원(URL/세션)·admin가드에 intake 반영, member 접근 정상
- [ ] tsc 0 / test / design:check / DC-REV / 브라우저 확인
