# 2단계 실측, 지금 무엇이 판 번호 없이 저장되나

잰 날 2026-09-14
기준 커밋 fade4484

## 0 한 줄

AI 결과 칸을 가진 표가 열다섯이고, 계약 판 번호를 가진 표는 **0개**다

## 1 표 열다섯

근거(evidence) 또는 확신(confidence) 또는 상태(grounding, verification, grade) 칸을 가진 표를
마이그레이션 전수로 골랐다

| 표 | 가진 칸 | 쓰기 | 읽기 | 마이그 |
|---|---|---|---|---|
| work_entity_links | 확신 | 3 | 7 | 101 |
| autolink_feedback | 확신 | 2 | 4 | 101 |
| ci_content_media | 근거 | 2 | 9 | 209 |
| review_iterations | 근거 확신 | 2 | 1 | 029 |
| system_event_remedies | 확신 | 2 | 2 | 218 |
| ci_content_creative | 근거 | 1 | 5 | 191 |
| ci_content_derived | 확신 | 1 | 4 | 187 |
| ci_patterns | 확신 | 1 | 4 | 188 |
| ci_content_groups | 확신 | 1 | 0 | 187 |
| gpu_intake_runs | 근거 | 1 | 1 | 136 |
| weekly_report_items | 확신 | 1 | 2 | 138 |
| rfp_report_fields | 근거 확신 상태 | 1 | 0 | 247 |
| ci_channel_links | 근거 확신 | 0 | 0 | 186 |
| rfp_anomalies | 근거 상태 | 0 | 0 | 247 |
| rfp_field_vendor_results | 근거 확신 상태 | 0 | 0 | 247 |

살아 있는 쓰기 경로 열둘, 선언만 되고 쓰는 코드가 0곳인 표 셋

## 2 사용자가 실제로 보는 값이 오는 곳

`rfp_report_versions` 는 위 표에 안 들어간다, 근거 칸이 행이 아니라 JSON 통째로 들어 있기 때문이다
그런데 화면과 내보내기와 제안서와 비교와 차수와 교차검증이 전부 이 표를 읽는다

- 쓰기 1곳 `lib/rfp/analyze/persist.ts`
- 읽기 8곳 (화면 1, API 6, 자기 조회 1)

즉 RFP 에서 사용자가 보는 AI 값은 행 단위 표가 아니라 이 JSON 덩어리에서 온다
판 번호를 여기 안 박으면 나머지에 박아도 화면은 못 올린다

## 3 이미 있는 판 번호 칸과의 구분

`rfp_report_versions.schema_version` 이 있다
이것은 **리포트 서식의 판**이고 계약 판이 아니다

- 서식 판: 어떤 칸을 몇 개 보여 줄지, 조직마다 다를 수 있음
- 계약 판: 값 하나가 어떤 규칙으로 만들어졌는지, 시스템 전체에 하나

둘을 같은 칸에 담으면 서식을 고칠 때마다 값의 해석이 같이 흔들린다
그래서 칸을 따로 둔다

## 4 결과 계약과 표의 대응

| 계약 칸 | 표에 있는 것 | 없는 표에서는 |
|---|---|---|
| 값 | value, resolved_value, 각 도메인 칸 | 있음 |
| 근거 | evidence | 근거 없는 표 아홉 |
| 확신 | confidence | 확신 없는 표 넷 |
| 출처 | model_id, display_model_id | 대부분 없음 |
| 상태 | grounding, verification, grade, user_status | 셋만 있음 |
| 고친 흔적 | user_status, reviewed_by, resolved_by | 대부분 없음 |
| 계약 판 번호 | 없음 | **열다섯 전부 없음** |

일곱 칸을 한 번에 맞추지 않는다, 이번 단계는 **판 번호 하나**만 박는다
나머지 칸은 값이 쌓여도 나중에 채울 수 있지만 판 번호는 그렇지 않다

## 5 이번 단계가 하는 것

- 열다섯 표에 판 번호 칸을 만든다, 기본값을 두지 않는다 (두면 옛 행이 새 판인 척한다)
- 살아 있는 쓰기 경로 열둘과 rfp_report_versions 가 저장할 때 판 번호를 같이 넣는다
- 읽을 때 지나는 사다리를 패키지에 하나 둔다
- 판 번호 없는 옛 행은 버리지 않고 이전 판으로 표시한다
- 쌓인 행을 일괄로 다시 쓰지 않는다, 읽고 쓰는 길이 지나갈 때만 다시 저장한다

## 6 이번 단계가 안 하는 것

- 근거와 출처와 고친 흔적 칸 채우기 (표마다 사정이 달라 도메인별로 따로 봐야 한다)
- 쓰는 코드가 0곳인 표 셋에 실제 쓰기 붙이기
- 부품이 이 값을 어떻게 그릴지 (3단계)
