-- 296 이상 조항 기본 규칙을 표에 넣는다
--
-- ## 왜 넣나
--
-- 규칙 열두 개는 `lib/rfp/anomaly/rules.ts` 의 DEFAULT_RULES 에 있고, 실행기는 표가 비어도
-- 그 기본값으로 돈다(`mergeRules`). 그런데 표가 비어 있으면 **관리자 화면에서 고칠 것이 없다** —
-- 스위치를 내려도 저장할 행이 없다. 실측 2026-09-30: rfp_anomaly_rules 0행.
--
-- ## 표를 만들지 않는다
--
-- 표는 247 이 이미 만들었고 RLS 도 그때 켰다. 여기서는 행만 넣는다.
--   읽기 rfp_anomaly_rules_read  : org_id is null or org_id in (rfp_my_orgs())
--   쓰기 rfp_anomaly_rules_admin : org_id is not null and rfp_is_admin(org_id)
--
-- ## org_id 를 반드시 채운다
--
-- 읽기 정책에 `org_id is null` 갈래가 있다. org_id 를 비운 채 넣으면 그 행은
-- **조직을 가리지 않고 읽히는 줄**이 된다. 기본 규칙이라 해도 그 길을 새로 내지 않는다.
-- 그래서 실제 조직 id 를 박는다.
--
-- ## 다시 돌려도 안 덮는다
--
-- `on conflict do nothing`. 관리자가 고친 값을 마이그레이션 재실행이 되돌리면
-- 아무도 규칙을 안 고치게 된다 — 코드가 DB 를 이기면 DB 를 고칠 이유가 없다.
--
-- 이 파일은 손으로 적지 않고 DEFAULT_RULES 에서 뽑았다. 손으로 적으면 코드와 갈라지고,
-- 갈라진 사실은 화면에서 규칙 이름이 다르게 보일 때에야 드러난다.

insert into rfp_anomaly_rules
  (id, org_id, category, name, rule_type, definition, severity_default, enabled)
values
  ('R01', '00000000-0000-4000-8000-000000000001', 'competition', '특정 상표 명시', 'regex', '{"equivalencePhrases":["동등 이상","또는 동등","이상의 성능","동등 사양","이와 동등"],"brandDictionary":["오라클","Oracle","MS SQL","SAP","VMware","Cisco","NVIDIA","AWS","Azure"],"windowSentences":2,"method":"regex_dictionary","grade":"confirmed"}'::jsonb, 'competition', true),
  ('R02', '00000000-0000-4000-8000-000000000001', 'competition', '고유 규격 수치', 'regex', '{"minSpecTokens":3,"specPattern":"(\\d+\\s?(GB|TB|GHz|Gbps|nm|W)\\b)|(NVLink|InfiniBand|PCIe\\s?\\d)","method":"regex","grade":"suspected"}'::jsonb, 'competition', true),
  ('R03', '00000000-0000-4000-8000-000000000001', 'blocking', '법정 공고 기간', 'numeric', '{"general":7,"negotiated":40,"urgent":5,"rebid":5,"method":"numeric","grade":"confirmed"}'::jsonb, 'blocking', true),
  ('R04', '00000000-0000-4000-8000-000000000001', 'competition', '실적 요건 과다', 'numeric', '{"maxSingleRecordRatio":1,"maxRecordCount":3,"method":"numeric","grade":"suspected"}'::jsonb, 'competition', true),
  ('R05', '00000000-0000-4000-8000-000000000001', 'competition', '자본금과 매출 요건', 'numeric', '{"maxCapitalRatio":0.5,"maxRevenueRatio":2,"method":"numeric","grade":"suspected"}'::jsonb, 'competition', true),
  ('R06', '00000000-0000-4000-8000-000000000001', 'margin', '인력 요건 대비 예산', 'numeric', '{"laborRateKrwPerMonth":{"특급":9500000,"고급":7800000,"중급":6200000,"초급":4800000},"maxLaborCostRatio":1.1,"method":"numeric","grade":"confirmed"}'::jsonb, 'margin', true),
  ('R07', '00000000-0000-4000-8000-000000000001', 'margin', '기간 대비 산출물', 'numeric', '{"fallbackRequirementsPerMonth":12,"multiplier":2,"method":"numeric","grade":"suspected"}'::jsonb, 'margin', true),
  ('R08', '00000000-0000-4000-8000-000000000001', 'contract', '지식재산권 귀속', 'regex', '{"patterns":["저작권.{0,10}전부.{0,10}(발주|기관).{0,6}귀속","소스\\s?코드.{0,10}무상","무상.{0,6}유지보수","무제한.{0,6}수정"],"method":"regex","grade":"suspected"}'::jsonb, 'contract', true),
  ('R09', '00000000-0000-4000-8000-000000000001', 'contract', '손해배상과 지체상금', 'numeric', '{"maxDelayRate":0.0025,"maxGuaranteeRate":0.1,"patterns":["무한.{0,4}책임","전액.{0,4}배상"],"method":"regex_numeric","grade":"suspected"}'::jsonb, 'contract', true),
  ('R10', '00000000-0000-4000-8000-000000000001', 'blocking', '상충 기재', 'numeric', '{"amountTolerance":0.01,"dateToleranceDays":1,"method":"numeric","grade":"confirmed"}'::jsonb, 'blocking', true),
  ('R11', '00000000-0000-4000-8000-000000000001', 'competition', '특정 인증 요구', 'regex', '{"certifications":["CSAP","GS인증 1등급","파트너 등급","Gold Partner","Premier Partner","총판"],"method":"dictionary","grade":"suspected"}'::jsonb, 'competition', true),
  ('R12', '00000000-0000-4000-8000-000000000001', 'competition', '하도급과 공동수급 제한', 'regex', '{"patterns":["공동\\s?수급.{0,6}(불가|금지|제한)","하도급.{0,6}(전면|일체).{0,4}금지","지역.{0,6}업체.{0,10}(의무|이상)"],"method":"regex","grade":"suspected"}'::jsonb, 'competition', true)
on conflict (id) do nothing;
