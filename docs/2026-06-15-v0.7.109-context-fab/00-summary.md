# 페이지별 컨텍스트 FAB + 사이드바 정리 — 작업 요약

작성 2026-06-15 · v0.7.109 · MEDIUM · UI/네비게이션(계산 불변)

## 작업
1. 사이드바 '통합 입력' 항목 **제거**(GPU 관리 탭으로 흡수 완료).
2. 우하단 빠른추가 FAB를 **데스크탑+모바일 모두 표시**(현재 `mobile-only-flex`로 데스크탑 숨김 → 해제).
3. FAB 액션을 **페이지별 컨텍스트**로 재구성. 액션 클릭 = **그 기능 바로 열기**(탭 전환 + 등록계열은 생성 모달 자동 오픈).
   - GPU 관리(/pricing/gpu): 통합 입력(가격·견적)·공급사 등록·경쟁사 등록·시장가/매핑 등록 4종.
   - 기타 페이지: 기존 글로벌 빠른추가 유지(현재 페이지 매칭 강조).

## 동작 설계 — "기능 바로 열기"
- FAB 액션 = URL Link(`?tab=…&create=1`). GpuPricingClient가 `?tab=`로 탭 전환(이미 구현) + `?create=1` 감지 시 활성 탭에 `autoCreate` 전달 → 탭이 마운트 시 생성 모달 자동 오픈.
  - 통합입력 → `?tab=intake` (탭만)
  - 공급사 등록 → `?tab=suppliers&create=1` → SuppliersTab `setShowCreate(true)`
  - 경쟁사 등록 → `?tab=competitors&create=1` → CompetitorsTab `setShowCreate(true)`
  - 시장가·매핑 등록 → `?tab=market&create=1` → MarketTab `setShowRegister(true)`
- `?create`는 1회성(탭 전환 effect에서 제거) → 새로고침 시 재오픈 안 함.

## 수정 파일 (8)
- `app/(member)/layout.tsx` — 사이드바 intake 항목 제거.
- `app/globals.css` — `.quickadd-fab-wrap`에 `display:flex` 부여(데스크탑 노출).
- `components/ui/QuickAddFab.tsx` — `mobile-only-flex` 클래스 제거.
- `lib/fab-actions.ts` — 페이지별 액션 SSOT 재구성(GPU 전용 세트 + 글로벌).
- `app/(member)/pricing/gpu/GpuPricingClient.tsx` — `?create` 감지·autoCreate 전달·1회성 제거.
- `tabs/SuppliersTab.tsx`·`tabs/CompetitorsTab.tsx`·`tabs/MarketTab.tsx` — `autoCreate?` prop로 모달 자동 오픈.

## 이유
- 통합입력이 탭으로 흡수되어 사이드바 중복 → 제거.
- FAB가 모바일 전용이라 데스크탑에서 "사라진 것처럼" 보임 → 노출 + 페이지 맞춤 기능으로 실효화.

## 영향
- 계산·DB·API 불변. 표시/라우팅/모달 오픈만. SSOT(각 탭 기존 생성 모달 재사용, 재구현 0).
- suppliers/competitors는 admin 전용 탭 — 비관리자에겐 GPU 가드가 board로 복귀(기존 정책). FAB는 admin 사용자 기준.

## 완료조건
- [ ] 사이드바에서 '통합 입력' 사라짐
- [ ] 데스크탑 우하단 FAB 노출 + 멀티 액션 펼침
- [ ] GPU 페이지 4액션이 탭+모달 즉시 오픈(통합입력 탭, 공급사/경쟁사/시장가 모달)
- [ ] tsc 0 / test / design / DC-REV / 브라우저
