-- 330: 기본 조항과 모듈 초안 (P0184 I13)
--
-- 계약서를 조립할 바탕을 넣는다. 전부 **초안(DRAFT)** 이다.
-- 초안은 조립에도, 표준 이탈 판정에도 쓰이지 않는다. 법무와 세무가 문구를 확정해 관리자가
-- 승인해야 표준이 된다 (조항 라이브러리 326, 승인본만 조립 contract-assembly.ts)
--
-- 사용자 판정 2026-11-09 반영
--   하드웨어 급부는 거래 형태 셋으로 나눈다. 세금계산서 명의와 하자 책임이 형태마다 다르다
--     판매     우리 명의로 사서 우리 명의로 판다. 세금계산서는 우리가 고객에게, 하자는 우리가 1차 책임
--     중개     우리를 거치되 물건의 위험은 공급사. 세금계산서는 우리가 고객에게, 하자는 공급사가 직접 책임
--     수수료형 공급사와 고객이 직거래하고 우리는 수수료만. 물품 세금계산서는 공급사가 고객에게, 하자는 공급사
--   포인트는 돈이 아니고 지역화폐 전환분의 돈은 지자체 몫 → 포인트 선불수단 규제 모듈은 기본 꺼짐
--   GPU 크레딧은 우리 서비스에만 쓰인다 → 크레딧 별도관리 규제 모듈도 기본 꺼짐
--   크레딧의 소진 기한과 남은 금액 처리 조항은 대가 모듈(선불)에 남긴다
--
-- 보안 (LOOP.md 7절 세 질문)
--   ① 새 데이터를 저장하나 — 새 표는 없다. 기존 crm_contract_clause(326) crm_contract_module(327)
--      에 행만 넣는다, 둘 다 RLS 켜짐과 REVOKE 를 그 마이그레이션에서 했다
--   ② 새 창구를 여나 — 아니다
--   ③ 밖에서 온 값을 다루나 — 아니다. 비밀 없음
-- 워크스페이스마다 넣는다(행마다 workspaceId). 이미 같은 키가 있으면 건너뛴다 — 손으로 만든 것을 덮지 않는다
--
-- 되돌리기: DELETE FROM crm_contract_module WHERE "createdById" = 'seed:330';
--           DELETE FROM crm_contract_clause WHERE "createdById" = 'seed:330' AND status = 'DRAFT';

WITH clauses(key, title, html) AS (VALUES
  -- 공통: 앞
  ('common.purpose', '목적', '<p>이 계약은 갑과 을이 이 계약서에 적은 급부와 대가를 주고받는 데 필요한 권리와 의무를 정하는 것을 목적으로 한다.</p>'),
  ('common.definitions', '정의', '<p>이 계약에서 「급부」는 을이 갑에게 제공하는 물품, 사용권, 용역을 말하고, 「대가」는 그 급부에 대하여 갑이 을에게 지급하는 금액을 말한다. 그 밖의 용어는 관련 법령과 거래 관행에 따른다.</p>'),
  -- 공통: 뒤
  ('common.confidentiality', '비밀유지', '<p>각 당사자는 이 계약과 관련하여 알게 된 상대방의 영업상 비밀을 상대방의 서면 동의 없이 제3자에게 누설하거나 이 계약의 목적 외로 쓰지 아니한다. 이 의무는 계약이 끝난 뒤 3년간 유지된다.</p>'),
  ('common.damages', '손해배상', '<p>당사자 일방이 이 계약을 위반하여 상대방에게 손해를 입힌 경우 그 손해를 배상한다.</p>'),
  ('common.liability-cap', '책임한도', '<p>고의 또는 중대한 과실이 없는 한, 각 당사자의 이 계약에 따른 손해배상 책임은 직접 손해에 한하며 그 총액은 이 계약의 대가 총액을 넘지 아니한다.</p>'),
  ('common.no-assignment', '양도금지', '<p>각 당사자는 상대방의 서면 동의 없이 이 계약상의 지위나 권리 의무를 제3자에게 양도하거나 담보로 제공하지 아니한다.</p>'),
  ('common.termination', '해지', '<p>당사자 일방이 이 계약을 위반하고 상대방의 서면 시정 요구를 받은 날부터 14일 안에 시정하지 아니하면 상대방은 서면으로 이 계약을 해지할 수 있다.</p>'),
  ('common.force-majeure', '불가항력', '<p>천재지변, 전쟁, 감염병, 정부의 조치 등 당사자가 통제할 수 없는 사유로 의무를 이행하지 못한 경우 그 기간 동안 책임을 지지 아니한다. 해당 당사자는 지체 없이 상대방에게 알린다.</p>'),
  ('common.governing-law', '준거법과 관할', '<p>이 계약은 대한민국 법률에 따르며, 이 계약에 관한 분쟁은 서울중앙지방법원을 제1심 관할법원으로 한다.</p>'),
  ('common.precedence', '우선순위', '<p>이 계약서 본문과 부속서의 내용이 서로 다르면 본문이 우선한다. 개별계약이 기본계약과 다르면 개별계약이 그 거래에 한하여 우선한다.</p>'),
  -- 급부: 하드웨어 거래 형태 셋
  ('perf.hw-sale.supply', '물품 공급 (판매)', '<p>을은 갑에게 부속서에 적은 물품을 자기 명의로 매입하여 공급하고, 소유권은 대금 완납 시 갑에게 이전된다.</p>'),
  ('perf.hw-sale.tax-invoice', '세금계산서 (판매)', '<p>을은 공급한 물품 전액에 대하여 자기 명의로 갑에게 세금계산서를 발행한다.</p>'),
  ('perf.hw-sale.defect', '하자 책임 (판매)', '<p>을은 인도일부터 1년간 물품의 하자에 대하여 갑에게 1차로 책임을 지고 수리 또는 교체한다. 을이 제조사에 대하여 갖는 보증 권리는 을이 행사한다.</p>'),
  ('perf.hw-broker.supply', '물품 공급 (중개)', '<p>을은 공급사로부터 갑이 정한 물품을 조달하여 갑에게 인도한다. 물품의 멸실과 훼손의 위험은 인도 전까지 공급사가 부담한다.</p>'),
  ('perf.hw-broker.tax-invoice', '세금계산서 (중개)', '<p>을은 물품 대금에 대하여 자기 명의로 갑에게 세금계산서를 발행하고, 공급사는 을에게 세금계산서를 발행한다.</p>'),
  ('perf.hw-broker.defect', '하자 책임 (중개)', '<p>물품의 하자는 공급사가 갑에게 직접 책임을 지고, 을은 갑의 하자 청구가 공급사에 전달되고 처리되도록 협조한다.</p>'),
  ('perf.hw-commission.service', '거래 주선 (수수료형)', '<p>을은 갑과 공급사 사이의 물품 거래를 주선하고, 물품 매매계약은 갑과 공급사가 직접 체결한다.</p>'),
  ('perf.hw-commission.tax-invoice', '세금계산서 (수수료형)', '<p>물품 대금의 세금계산서는 공급사가 갑에게 발행하고, 을은 주선 수수료에 대하여만 세금계산서를 발행한다.</p>'),
  ('perf.hw-commission.defect', '하자 책임 (수수료형)', '<p>물품의 하자와 그로 인한 손해는 공급사가 갑에게 책임을 지며, 을은 주선 업무의 과실에 대하여만 책임을 진다.</p>'),
  -- 급부: 그 밖
  ('perf.sw-license', '소프트웨어 사용권', '<p>을은 갑에게 계약 기간 동안 부속서에 적은 소프트웨어를 갑의 내부 업무에 쓸 수 있는 비독점 사용권을 부여한다. 재판매, 역설계, 제3자 제공은 할 수 없다.</p>'),
  ('perf.maintenance', '유지보수', '<p>을은 계약 기간 동안 부속서의 대상에 대하여 장애 접수, 원인 분석, 복구, 정기 점검을 제공한다. 응답과 복구 시간은 부속서의 서비스 수준에 따른다.</p>'),
  ('perf.gpu-rental', 'GPU 자원 임대', '<p>을은 갑에게 부속서에 적은 GPU 자원을 계약 기간 동안 쓸 수 있게 제공한다. 가용률과 장애 보상은 부속서의 서비스 수준에 따른다.</p>'),
  ('perf.inspection', '검수', '<p>갑은 급부를 받은 날부터 7일 안에 검수하고 결과를 을에게 알린다. 그 기간 안에 알리지 아니하면 검수에 합격한 것으로 본다.</p>'),
  -- 대가: 아홉 (지급 일정 표는 {{계약.지급일정}} 칸이 찍는다)
  ('cons.lump', '대가 (일시 지급)', '<p>갑은 을에게 아래 지급 일정에 따라 대가를 한 번에 지급한다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.installment', '대가 (분할 지급)', '<p>갑은 을에게 아래 지급 일정의 구분과 비율에 따라 대가를 나누어 지급한다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.fixed', '대가 (정액 정기 지급)', '<p>갑은 을에게 아래 지급 일정의 주기와 지급일에 정해진 금액을 지급한다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.usage', '대가 (사용량 정산)', '<p>갑은 을에게 사용량에 단가를 곱한 금액을 아래 주기로 정산하여 지급한다. 최소 금액이 있으면 그 금액에 못 미쳐도 최소 금액을 지급한다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.prepaid', '대가 (선불)', '<p>갑은 을에게 아래 금액을 미리 지급하고, 을은 그 금액만큼 급부를 제공한다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.prepaid.credit-expiry', '크레딧 사용 기한과 회수', '<p>선불로 충전한 크레딧은 지급 일정에 적은 사용 기한 안에 쓴다. 기한이 지나 남은 크레딧은 지급 일정에 적은 남은 금액 처리 방법에 따라 돌려주거나 소멸한다.</p>'),
  ('cons.commitment', '대가 (약정)', '<p>갑은 아래 주기마다 약정 금액 이상을 사용하기로 하고, 약정에 못 미치면 지급 일정에 적은 방법으로 처리한다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.commission', '대가 (수수료)', '<p>갑은 을에게 아래 기준 금액에 수수료율을 곱한 금액을 수수료로 지급한다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.point-conversion', '대가 (포인트 전환)', '<p>갑의 포인트는 아래 비율로 전환되어 정산된다. 포인트는 금전이 아니며 전환된 금액의 정산은 지급 일정에 적은 방법에 따른다.</p><p>{{계약.지급일정}}</p>'),
  ('cons.subsidy', '대가 (보조금)', '<p>대가 중 보조금 부분은 지원 기관의 지급 결정에 따라 지급되고, 갑은 자부담 금액을 을에게 지급한다.</p><p>{{계약.지급일정}}</p>'),
  -- 규제: 기본 꺼짐 (사용자 판정 2026-11-09)
  ('reg.point-prepaid', '선불전자지급수단 해당 여부', '<p>(법무 확인 뒤 확정) 포인트가 선불전자지급수단에 해당하는 경우 발행과 상환에 관한 관련 법령의 의무를 따른다.</p>'),
  ('reg.credit-segregation', '선불 크레딧 별도 관리', '<p>(법무 확인 뒤 확정) 을은 갑이 미리 지급한 크레딧 대금을 관련 법령이 요구하는 경우 고유 재산과 구분하여 관리한다.</p>'),
  -- 부속서
  ('annex.items', '급부 명세', '<p>품목, 수량, 규격, 단가를 적는다.</p>'),
  ('annex.sla', '서비스 수준', '<p>가용률, 응답 시간, 복구 시간, 미달 시 보상을 적는다.</p>')
)
INSERT INTO crm_contract_clause ("id", "workspaceId", "key", "lang", "versionNo", "title", "html", "status", "createdById", "updatedAt")
SELECT gen_random_uuid()::text, w.id, c.key, 'ko', 1, c.title, c.html, 'DRAFT', 'seed:330', CURRENT_TIMESTAMP
FROM crm_workspace w CROSS JOIN clauses c
WHERE NOT EXISTS (
  SELECT 1 FROM crm_contract_clause x WHERE x."workspaceId" = w.id AND x."key" = c.key AND x."lang" = 'ko'
);

WITH modules(key, kind, title, clause_keys, enable_when, is_active, position) AS (VALUES
  ('common.front', 'COMMON', '공통 조항 (앞)', ARRAY['common.purpose', 'common.definitions'], NULL::jsonb, true, 0),
  ('perf.hw-sale', 'PERFORMANCE', '하드웨어 판매', ARRAY['perf.hw-sale.supply', 'perf.inspection', 'perf.hw-sale.tax-invoice', 'perf.hw-sale.defect'], NULL, true, 10),
  ('perf.hw-broker', 'PERFORMANCE', '하드웨어 중개', ARRAY['perf.hw-broker.supply', 'perf.inspection', 'perf.hw-broker.tax-invoice', 'perf.hw-broker.defect'], NULL, true, 11),
  ('perf.hw-commission', 'PERFORMANCE', '하드웨어 수수료형', ARRAY['perf.hw-commission.service', 'perf.hw-commission.tax-invoice', 'perf.hw-commission.defect'], NULL, true, 12),
  ('perf.sw-license', 'PERFORMANCE', '소프트웨어 사용권', ARRAY['perf.sw-license', 'perf.inspection'], NULL, true, 13),
  ('perf.maintenance', 'PERFORMANCE', '유지보수', ARRAY['perf.maintenance'], NULL, true, 14),
  ('perf.gpu-rental', 'PERFORMANCE', 'GPU 임대', ARRAY['perf.gpu-rental'], NULL, true, 15),
  ('cons.lump', 'CONSIDERATION', '일시 지급', ARRAY['cons.lump'], NULL, true, 20),
  ('cons.installment', 'CONSIDERATION', '분할 지급', ARRAY['cons.installment'], NULL, true, 21),
  ('cons.fixed', 'CONSIDERATION', '정액 정기 지급', ARRAY['cons.fixed'], NULL, true, 22),
  ('cons.usage', 'CONSIDERATION', '사용량 정산', ARRAY['cons.usage'], NULL, true, 23),
  ('cons.prepaid', 'CONSIDERATION', '선불 (크레딧)', ARRAY['cons.prepaid', 'cons.prepaid.credit-expiry'], NULL, true, 24),
  ('cons.commitment', 'CONSIDERATION', '약정', ARRAY['cons.commitment'], NULL, true, 25),
  ('cons.commission', 'CONSIDERATION', '수수료', ARRAY['cons.commission'], NULL, true, 26),
  ('cons.point-conversion', 'CONSIDERATION', '포인트 전환', ARRAY['cons.point-conversion'], NULL, true, 27),
  ('cons.subsidy', 'CONSIDERATION', '보조금', ARRAY['cons.subsidy'], NULL, true, 28),
  ('reg.point-prepaid', 'REGULATION', '포인트 선불수단 규제', ARRAY['reg.point-prepaid'], NULL, false, 30),
  ('reg.credit-segregation', 'REGULATION', '크레딧 별도관리 규제', ARRAY['reg.credit-segregation'], NULL, false, 31),
  ('common.back', 'COMMON', '공통 조항 (뒤)', ARRAY['common.confidentiality', 'common.damages', 'common.liability-cap', 'common.no-assignment', 'common.termination', 'common.force-majeure', 'common.governing-law', 'common.precedence'], NULL, true, 40),
  ('annex.items', 'ANNEX', '급부 명세 부속서', ARRAY['annex.items'], NULL, true, 50),
  ('annex.sla', 'ANNEX', '서비스 수준 부속서', ARRAY['annex.sla'], NULL, true, 51)
)
INSERT INTO crm_contract_module ("id", "workspaceId", "key", "kind", "title", "clauseKeys", "enableWhen", "isActive", "position", "createdById", "updatedAt")
SELECT gen_random_uuid()::text, w.id, m.key, m.kind, m.title, m.clause_keys, m.enable_when, m.is_active, m.position, 'seed:330', CURRENT_TIMESTAMP
FROM crm_workspace w CROSS JOIN modules m
WHERE NOT EXISTS (
  SELECT 1 FROM crm_contract_module x WHERE x."workspaceId" = w.id AND x."key" = m.key
);
