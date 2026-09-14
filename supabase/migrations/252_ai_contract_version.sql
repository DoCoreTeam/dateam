-- 252 AI 결과에 계약 판 번호를 붙인다
--
-- 왜: AI 결과 칸(근거, 확신, 상태)을 가진 표가 열다섯인데 어느 판의 규칙으로 만들어졌는지
--   적는 칸이 한 표에도 없다. 판 번호 없이 쌓인 값은 나중에 규칙이 바뀌어도 못 올린다.
--   무슨 규칙으로 쓰였는지 아무 데도 안 적혀 있기 때문이다.
--   값이 더 쌓이기 전인 지금이 가장 싸다.
--
-- 기본값을 두지 않는 이유: default 1 을 주면 이미 쌓인 옛 행이 전부 「1판으로 만들어진 값」이
--   된다. 실제로는 판 번호가 생기기 전에 쓰인 값이라 1판 규칙을 따랐다는 보장이 없고,
--   사다리가 그 행에 1판 단계를 돌려 버린다. 모르는 것은 null 로 둔다.
--
-- 옛 행을 건드리지 않는 이유: 일괄 이관은 한 번만 돌고 실데이터를 상대하며, 틀리면 옛 바이트가
--   사라진 뒤에 알게 된다. 읽고 쓰는 길이 지나갈 때만 다시 저장한다.
--
-- 되돌리기:
--   alter table rfp_report_versions      drop column if exists contract_version;
--   alter table rfp_report_fields        drop column if exists contract_version;
--   alter table rfp_field_vendor_results drop column if exists contract_version;
--   alter table rfp_anomalies            drop column if exists contract_version;
--   alter table ci_channel_links         drop column if exists contract_version;
--   alter table ci_content_creative      drop column if exists contract_version;
--   alter table ci_content_derived       drop column if exists contract_version;
--   alter table ci_content_groups        drop column if exists contract_version;
--   alter table ci_content_media         drop column if exists contract_version;
--   alter table ci_patterns              drop column if exists contract_version;
--   alter table autolink_feedback        drop column if exists contract_version;
--   alter table work_entity_links        drop column if exists contract_version;
--   alter table weekly_report_items      drop column if exists contract_version;
--   alter table gpu_intake_runs          drop column if exists contract_version;
--   alter table review_iterations        drop column if exists contract_version;
--   alter table system_event_remedies    drop column if exists contract_version;
--   (칸만 떨어지고 값은 안 지워진다. 다시 붙이면 그때부터 새로 쌓인다)

-- RFP
alter table rfp_report_versions      add column if not exists contract_version int;
alter table rfp_report_fields        add column if not exists contract_version int;
alter table rfp_field_vendor_results add column if not exists contract_version int;
alter table rfp_anomalies            add column if not exists contract_version int;

-- 콘텐츠 인텔리전스
alter table ci_channel_links    add column if not exists contract_version int;
alter table ci_content_creative add column if not exists contract_version int;
alter table ci_content_derived  add column if not exists contract_version int;
alter table ci_content_groups   add column if not exists contract_version int;
alter table ci_content_media    add column if not exists contract_version int;
alter table ci_patterns         add column if not exists contract_version int;

-- 업무와 주간보고
alter table autolink_feedback   add column if not exists contract_version int;
alter table work_entity_links   add column if not exists contract_version int;
alter table weekly_report_items add column if not exists contract_version int;

-- GPU 와 시스템 로그
alter table gpu_intake_runs       add column if not exists contract_version int;
alter table review_iterations     add column if not exists contract_version int;
alter table system_event_remedies add column if not exists contract_version int;

-- 판 번호가 있는 행만 골라 보는 길. 파생 계산이 옛 행을 새 판인 척 읽지 않게 한다
create index if not exists idx_rfp_report_versions_contract
  on rfp_report_versions (contract_version) where contract_version is not null;
create index if not exists idx_rfp_report_fields_contract
  on rfp_report_fields (contract_version) where contract_version is not null;

comment on column rfp_report_versions.contract_version is
  'AI 결과 계약의 판 번호. 만들 때 박고 읽을 때 사다리가 올린다. null 은 판 번호가 생기기 전에 쓰인 값이며 1 로 채우지 않는다';
