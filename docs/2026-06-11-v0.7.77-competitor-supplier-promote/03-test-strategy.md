# 03 테스트 전략 (v0.7.77)

## 단위/타입
- tsc --noEmit 0, pnpm design:check 통과, pnpm test(기존 70+) 통과.

## API 검증 (throwaway/원복 — 실데이터 오염 금지)
- promote-supplier: 미연결 경쟁사 → 200 + suppliers row 생성 + supplier_id 세팅. 재호출 → 멱등 200(중복 생성 0).
- 동명 supplier 선존재 시 → 재사용(신규 insert 0).
- 비admin → 401/403. 잘못된 id → 400/404.
- suppliers GET → is_competitor/linked_competitor_name 정확.

## 브라우저 E2E (Playwright — 필수)
1. /pricing/gpu?tab=market admin 로그인
2. 미연결 경쟁사(예: Spheron)에서 "공급사로 지정" 클릭 → 성공
3. /pricing/gpu (공급사 탭) → 그 회사 카드 등장 + "경쟁사 겸업" 뱃지
4. 시장비교 복귀 → 그 경쟁가 "원가 인입" 승인 → 판매가(원가+마진) 형성 확인(콕핏/가격표)
5. 콘솔 에러 0
6. **테스트 데이터 전량 원복**(supplier_id NULL, 자동생성 supplier 삭제, 인입 견적 삭제)

## 보안
- 공개 API(v1/suppliers·market) 응답에 supplier_id·source·경쟁사연계 부재 확인.
