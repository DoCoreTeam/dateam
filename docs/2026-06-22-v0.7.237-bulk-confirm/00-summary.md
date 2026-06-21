# FAST PATH Summary — v0.7.237

작업: 검토대기(ReviewTab) 선택바에 **"일괄 확정"** 추가 — "일괄 삭제"만 있고 일괄 확정이 없어 수십 건을 카드마다 일일이 확인·확정해야 하던 불편(+저신뢰 항목 직접확인 체크도 일괄 불가) 해소.

대상:
- apps/web/app/(member)/pricing/gpu/tabs/ReviewTab.tsx (선택바 버튼 + handleBulkConfirm)
- apps/web/app/api/pricing/gpu/review/[id]/route.ts (confirm 감사에 via:'bulk'·auto_accepted_low_conf 기록)

이유: 검토대기 항목이 수십 건일 때 개별 확정·개별 체크는 비현실적. 사용자 요구 = 저신뢰(90% 미만) 항목까지 일괄 처리.

설계(안전·정직):
- handleBulkConfirm: 선택 항목을 기존 단건 confirm 엔드포인트로 순차 확정(서버·pricing 로직 무변경, 회귀 0).
- 사람 검토 게이트는 다이얼로그 **1회 명시 동의**로 일괄 대체 — 다이얼로그에 **어떤 항목이 90% 미만인지 이름까지 표시**(눈 감고 동의 방지).
- **거짓 검증기록 금지(DC-REV CRITICAL 반영)**: confirmed_items=[] 전송(사람이 직접 확인한 필드 없음). 대신 `bulk:true` + `auto_accepted_low_conf` 플래그로 감사에 정직하게 기록(`via:'bulk'`).
- **실패 항목 선택 유지(DC-REV MEDIUM 반영)**: 성공 id만 선택 해제 → 공급사·모델 미특정 등으로 실패한 건은 선택에 남아 즉시 개별 처리 가능. 실패는 사유와 함께 요약.
- 진행률(확정 중 done/total), 일괄 확정/삭제 버튼 상호 비활성화.

의식적 보류(후속):
- `confirm()`/`alert()` 사용 — 기존 handleBulkDelete와 동일 패턴이라 일관 유지. 추후 공용 ConfirmDialog(§2-2)로 승격 검토.
- 다건 서버 트랜잭션 — `/api/pricing/gpu/review/bulk`에 action:'confirm' 확장(TODO 주석). 현재는 클라 순차 호출.

검증: 브라우저 E2E(throwaway is_test 1건) — 다이얼로그 저신뢰항목 표시 → 일괄 확정 → supply_quote(confirmed)+review_item(confirmed) 생성 확인 후 전량 정리. tsc 0 / lint 0 / test 480 / design ✅. 운영 데이터 미오염.
