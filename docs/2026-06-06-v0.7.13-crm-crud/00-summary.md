# CRM 풀 CRUD 완성
작업: CRM 4개 엔티티(거래처·담당자·영업기회·리드인테이크) 전부 UI에서 풀 CRUD 일관 동작
대상:
- 신규 API: lead-intakes/route.ts(GET), lead-intakes/[id]/route.ts(PATCH·DELETE, 소유권 강제)
- UI 삭제 배선: contacts/deals/accounts 상세패널에 삭제버튼(기존 [id] DELETE 재사용, mutate 갱신)
- lead-intake SSR 행에 IntakeActions(메모 PATCH·삭제 DELETE)
- accounts 행 삭제 제거 → 패널로 일원화(일관성)
이유: 삭제(담당자·영업기회 UI 0), 리드인테이크 수정·삭제 API/UI 부재 — CRUD 미완성
영향: CRM 4개 엔티티 / GPU 도메인 무관
검증: lead-intakes PATCH·GET·DELETE 200, 3패널 삭제버튼·리드 행 메모·삭제 렌더. DC-REV 82/100. MEDIUM 2건(IntakeActions setLoading·accounts 중복) 반영.
