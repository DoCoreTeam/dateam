# FAST Summary — v0.7.135

작업: AI저장 항목이 1건으로 분해돼도 원본+AI 드로어(OriginGroupCard)가 보이도록 렌더 게이트 수정
대상: apps/web/app/(member)/daily/page.tsx (LogList 렌더 분기)
이유(재현): 오늘 AI저장 항목들은 각각 1건씩 분해 → origin_group_id가 달라 groupDailyLogs에서 전부 isBatch=false → 기존 게이트가 단일카드로 폴백해 원본/드로어 미표시(.origin-group 0). 사용자 "안 됨"의 실제 원인.
변경: 게이트를 `if(!isBatch) 단일카드` → `isAiGroup(origin_group_id||ai_processed||original_input) 이면 분해 1건이어도 OriginGroupCard, 순수 수동 단건만 단일카드`.
영향: AI저장 입력은 원본 헤더+드로어(분해/중복/일정/놓친메모) 표시. 수동 단건은 기존대로. 표시 게이트만, 저장/계산 무변경.
검증: tsc0, 실인증 재현(.origin-group 2개·원본 전문 헤더·드로어 펼침 스크린샷).
