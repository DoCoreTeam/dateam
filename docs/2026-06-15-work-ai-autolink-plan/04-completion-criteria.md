# 04 완료 기준 (구현 착수 시 — 이번은 기획만)

## 단계 0 (백필)
- [ ] accounts/deals/contacts embedding 컬럼+인덱스, daily_logs.linked_deal_id, relations 메타(confidence/reason/weak) 마이그레이션
- [ ] autolink_log/autolink_feedback 테이블 + RLS(default-deny, 조직범위)
- [ ] 기존 전체 데이터 백필 임베딩 완료(배치, 토큰 로깅)
- [ ] match_entities() RPC

## 단계 1 (업무↔업무 자동)
- [ ] lib/work/autolink.ts 단일 엔진(리콜→LLM판정→밴드) + 단위테스트(밴드·가드 결정성)
- [ ] ai_prompts: work.autolink-extract / work.autolink-judge (거버넌스 경유)
- [ ] 업무 저장 시 임베딩 동기 생성 + 자동연결 비동기 트리거(저장 응답 비차단)
- [ ] HIGH 자동확정 / MID 추천 자동 INSERT(created_by='ai', confidence, reason)

## 단계 2 (표시·가역·학습)
- [ ] 플로우/관계도가 자동연결(과거 포함) 렌더 + 근거·신뢰도·AI배지
- [ ] 1클릭 해제 + 약→강 승격 + feedback 기록
- [ ] τ 자동 보정 거버넌스 + golden-set precision 측정 스크립트

## 단계 3 (엔티티 자동, 가드)
- [ ] 업무→거래처/딜/연락처 자동 링크(임베딩+이름 trgm 동시 충족 가드)
- [ ] Precision@HIGH ≥ 0.92 입증 후에만 거래처/딜 HIGH 자동확정 활성(미달=MID 추천 유지)

## 공통 게이트
- [ ] 완전 자동이지만 가역·투명·자가보정 3원칙 내장(침묵 연결 0)
- [ ] 기존 수동 경로 회귀 0, RLS 권한, SSOT 재사용, design:check
- [ ] DC-QA/SEC/REV(≥80) + GATE 1-5 + 버전·커밋

## 핵심 합의(사용자 지시 반영)
- 목표는 **완전 자동**. "제안형으로 시작"이 아니라, 자동을 **밴드+가드+가역+학습**으로 안전하게 구현한다.
- 단, 돈/신뢰 직결인 거래처·딜 HIGH 자동확정만 정확도 입증을 전제로 켠다(그 전까지도 자동 동작은 하되 MID 추천으로 보임 — 사용자 무클릭은 유지).
