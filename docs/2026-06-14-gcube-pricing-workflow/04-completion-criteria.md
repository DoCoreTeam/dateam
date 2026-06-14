# 완료 기준 — gcube 공시가 워크플로 (P1~P3)

## P1 — 통합표 상세 '가격 결정' 섹션 (DB 변경 0)
- [ ] 통합표 상세에 '가격 결정' 탭/섹션 신설
- [ ] 추천 판매가(candidate) 표시 + 산정 근거(공급원가·마진·출처 공급사)
- [ ] 전략가(우리 판매가) 표시 + 인라인 수정(reason 입력) → `PATCH /api/pricing/gpu/strategic-price`
- [ ] gcube 파싱가(gcube.ai 자동 수집, gcube_last_low~high) 표시 + 동기화 뱃지(반영됨/미반영/미발견)
- [ ] [추천가로 반영] 버튼 → candidate를 전략가로 승격(기존 promote)
- [ ] 전략가 변경 이력(기존 strategic_history) 표시
- [ ] 브라우저 검증

## P2 — 반영 완료 추적 (분리)
- [ ] 마이그 082: `gpu_products.gcube_reflected_at/by/price_krw` + audit `gcube_reflected` (dev 적용)
- [ ] `POST /api/pricing/gpu/gcube-reflected` (admin, requireAdminApi, 단건)
- [ ] DetailPanel '홈페이지 반영 완료' 버튼 + 반영 상태(미반영/반영완료@시각) 표시
- [ ] '반영'(전략가 확정)과 '반영 완료'(홈페이지 마킹) 시각적 분리
- [ ] 브라우저 검증

## P3 — 일괄 반영 리스트
- [ ] 미반영(전략가≠파싱가 or 미마킹) 제품 모아보기 + 체크박스
- [ ] `POST /api/pricing/gpu/strategic-price/bulk` (admin) — 일괄 추천가→전략가
- [ ] gcube-reflected 일괄 마킹
- [ ] 일괄 화면(통합표 내 보기 또는 별도 진입) + 브라우저 검증

## 시스템 필수
- [ ] tsc 0 · test 통과 · design:check 통과
- [ ] DC-SEC PASS · DC-REV 80+
- [ ] 계산식 SSOT(pricing.ts/buildCatalog) 불변(R1)
- [ ] RBAC: 쓰기 admin + RLS. CSV/입력 sanitize. 커밋만(push 금지).
