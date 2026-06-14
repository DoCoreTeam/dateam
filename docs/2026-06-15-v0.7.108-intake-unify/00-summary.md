# 통합입력 진입 단일화 — FAST PATH Summary

작성 2026-06-15 · v0.7.108 · SMALL

## 작업
사이드바 "통합 입력" 메뉴가 별도 `/intake` 페이지(다른 뷰)로 가던 것을, **가격표 옆 탭과 동일한 뷰**(`/pricing/gpu?tab=intake`)로 통일. 두 갈래(독립 페이지 ↔ 탭) 제거.

## 대상 파일
- `app/(member)/layout.tsx` — 사이드바 '통합 입력' href `/intake` → `/pricing/gpu?tab=intake`.
- `app/(member)/intake/page.tsx` — 독립 페이지를 `redirect('/pricing/gpu?tab=intake')`로 변경(고아 뷰 제거, 북마크/딥링크도 탭으로 수렴).
- `app/(member)/pricing/gpu/GpuPricingClient.tsx` — URL `?tab=` 변화를 감시(useSearchParams)해, **이미 GPU 페이지에 있을 때 메뉴 재클릭 시에도** intake 탭으로 전환(마운트 1회 복원의 사각 보완).

## 이유
직전 작업에서 사이드바=독립페이지, 탭=임베드로 **뷰가 2개로 갈렸음**. 사용자는 "메뉴를 눌러도 탭과 같은 뷰로 가야 한다" → 단일 뷰로 통일.

## 영향
- 입력 UI(QuoteRegisterTab)는 이미 SSOT 공유 — 재구현 없음.
- 계산·DB·API 무변경. 라우팅/표시만.
- `/intake`는 redirect로 유지(깨진 링크 없음).

## 완료조건
- [ ] 사이드바 '통합 입력' 클릭 → `/pricing/gpu?tab=intake` (탭 활성, 같은 화면)
- [ ] 다른 페이지에서 클릭 / GPU 페이지에서 재클릭 모두 intake 탭 전환
- [ ] `/intake` 직접 진입 → 탭 뷰로 redirect
- [ ] tsc 0 / test / design / DC-REV / 브라우저
