# Summary — v0.7.238 (일괄 확정 완결 — 보류 0)

작업: v0.7.237 일괄 확정의 "후속 보류" 2건을 완결 + DC-REV 62점 지적 전부 반영.

## 1. 표준 모달로 교체 (confirm()/alert() 제거)
- 공용 `NbModal`(§2-2 SSOT — useEscClose·tape-title·광원형 shadow·통일 backdrop) 재사용.
- 일괄 확정/삭제 모두 브라우저 기본 다이얼로그 → 표준 모달:
  - 확정 동의 모달: 대상 건수 + 저신뢰(90%↓) 항목 **이름 리스트** + "공급사·모델 미특정은 제외" 안내.
  - 결과 모달: 반영 건수 + 실패 항목·사유 목록.

## 2. 서버 배치 처리 (클라 N회 → 1회 호출)
- confirm 로직을 `lib/gpu/confirm-review-item.ts`(SSOT)로 추출 — 단건(`review/[id]`)·일괄(`review/bulk`)이 동일 함수 호출(복붙 제거).
- `review/bulk` 라우트에 `action:'confirm'` 추가: ids 받아 서버에서 순차 확정, 항목별 성공/실패 집계 반환. 클라는 1회 호출.

## 3. DC-REV 지적 반영
- CRITICAL(거짓 검증기록): confirmed_items=[] + `via:'bulk'`·auto_accepted_low_conf 감사 기록(실측 확인 — review_finalized.detail.via='bulk').
- HIGH(confirm/alert): NbModal로 교체.
- HIGH(bulk 라우트 미사용): 서버 배치로 전환.
- MEDIUM(실패 선택유지): 실패 id만 선택에 남김.
- MEDIUM(감사 누락): 마이그 128 — gpu_audit_logs action_type CHECK에 review_bulk_confirmed/review_bulk_deleted 추가(기존 delete 감사도 그동안 조용히 거부되던 것 함께 교정).

대상: ReviewTab.tsx, lib/gpu/confirm-review-item.ts(신규), review/[id]/route.ts, review/bulk/route.ts, 마이그 128.

검증: 브라우저 E2E(throwaway is_test 2건 A고신뢰/B저신뢰) — 표준 모달 표시→서버 배치 1회→2건 confirmed(supply_quotes), via:'bulk' 감사 기록(psql ts컬럼 확인), 결과 모달 표시 후 전량 정리. tsc 0 / lint 0 / test 480 / build ✅(163/163) / design ✅. 단건 confirm 회귀 0(공용 함수 동일 경로).
