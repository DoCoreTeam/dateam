# 02 작업 분해 (단계적 — 완전 자동을 안전하게 도달)

## 단계 0 — 백필(Backfill) [선행 필수]
- B1 마이그레이션: accounts/deals/contacts에 `embedding vector(768)` + ivfflat 인덱스; daily_logs에 `linked_deal_id`; daily_log_relations에 `confidence/reason/weak`.
- B2 신규 테이블: autolink_log, autolink_feedback (+RLS default-deny, 조직 범위).
- B3 백필 잡: 기존 daily_logs/accounts/deals/contacts 전부 임베딩 생성(배치, token-logger). 없으면 신규 업무가 과거와 연결될 대상이 없음.
- B4 RPC: `match_entities()` (pgvector top-K, kind 파라미터).

## 단계 1 — 자동 연결 엔진 (업무↔업무 자동, 피해 최소부터)
- E1 `lib/work/autolink.ts` (SSOT): recall(임베딩+엔티티) → LLM judge → 밴드. 순수 로직 단위테스트.
- E2 ai_prompts seed: `work.autolink-extract`(엔티티 추출), `work.autolink-judge`(관계·신뢰도·근거).
- E3 저장 훅: daily 업무 저장 시 임베딩 생성(동기) + autolink 비동기 트리거.
- E4 daily_log_relations 자동 INSERT(created_by='ai', confidence, reason, weak). HIGH=실선, MID=점선.

## 단계 2 — 표시·가역·학습 (자동의 신뢰 담보)
- D1 LogFlowView/KnowledgeGraph가 daily_log_relations(ai 포함, 과거 날짜 포함) 읽어 렌더 — 근거·신뢰도·"AI 연결" 배지.
- D2 1클릭 해제(연결 삭제) + "확정 승격"(weak→strong). 해제/승격 → autolink_feedback 기록.
- D3 거버넌스: feedback 누적 → precision 산출 → τ_auto/τ_suggest 자동 보정. golden-set 평가 스크립트.

## 단계 3 — 엔티티(거래처·딜·연락처) 자동 연결 (피해 큰 영역, 가드 강화)
- N1 업무→거래처/딜/연락처 자동 링크: 임베딩 + 이름 trgm 동시 충족 시에만 HIGH 자동확정(오연결 가드).
- N2 linked_account_id/contact_id/deal_id 자동 세팅(created_by 추적, 가역).
- N3 정확도 golden-set ≥92% 입증 후에만 거래처/딜 HIGH 자동확정 활성(미달 시 MID 추천 유지).

## 단계 4 — 확장
- X1 GPU견적·주간보고·부서업무로 동일 엔진 확장(SSOT 재사용).
- X2 양방향 뷰(거래처 상세에서 "관련 업무" 자동 노출).

## 평가/게이트 (각 단계 공통)
- 단위테스트(autolink 밴드·가드 결정성), golden-set precision/recall, DC-QA/SEC/REV, GATE 1-5.
