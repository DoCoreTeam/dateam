# 04-completion-criteria

- [x] C1. 마이그 174 적용 — 완전중복 그룹 count>1 = 0 (psql 검증)
- [x] C2. 병합 무손실 — FK 참조 survivor로 이동, loser 소프트삭제, 총참조 보존(충돌삭제분만 제외)
- [x] C3. merge RPC는 트랜잭션·멱등·재사용 SSOT (재실행 시 변경 0)
- [x] C4. `baseModelKey` SSOT export + 단위테스트 통과(package.json test 목록 등록)
- [x] C5. specs API가 base+폼팩터 2단으로 그룹핑, SpecsTab 외 소비자 회귀 0
- [x] C6. GPU 관리에서 H100 1종 + 폼팩터(generic/SXM/PCIe/NVL) 전개 + 각 ×1/2/4/8 수량 (실브라우저)
- [x] C7. 폼팩터 SKU에 물리 ×N DB행 생성 없음 (v0.7.240 정책 준수)
- [x] C8. 5개 화면(가격표·시장비교·재고·고객가격표·스펙) 회귀 0 (실브라우저)
- [x] C9. tsc green / design:check green / 영향 단위테스트 green
- [x] C10. 버전 0.7.377 (루트+web package.json+CLAUDE.md+AGENTS.md) + changelog entries.ts 블록 + commit(no push)
