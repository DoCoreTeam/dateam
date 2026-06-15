# 01 아키텍처 — 완전 자동 연관 연결 엔진

## 전체 흐름 (무개입 자동)
```
[업무 저장/수정]  (사용자 액션 끝 — 여기서부터 전부 자동)
   │
   ├─(동기, 가벼움) 업무 텍스트 임베딩 생성 → daily_logs.embedding 저장
   │
   └─(비동기 큐, 저장 응답을 막지 않음) ── AUTO-LINK PIPELINE ──
        │
        ① 후보 리콜 (넓게, recall 우선)
        │   - 업무 임베딩 ↔ 기존 daily_logs.embedding   pgvector top-K(20)
        │   - 업무 임베딩 ↔ accounts/deals/contacts.embedding  엔티티별 top-K(10)
        │   - LLM 엔티티 추출(회사·인물·딜명) → pg_trgm 퍼지 매칭 후보
        │
        ② LLM 판정 (좁게, precision 우선) — Gemini structured output
        │   각 후보: { 관련 여부, 관계유형(derived_from|related|about_account|about_deal|mentions), confidence 0~1, 근거 1문장 }
        │
        ③ 신뢰도 밴드 분기 (자동)
        │   - HIGH (≥τ_auto, 예 0.88 & top1-top2 gap 충분)
        │         → daily_log_relations / linked_* 에 자동 INSERT (created_by='ai', confidence, reason)
        │   - MID  (τ_suggest ~ τ_auto)
        │         → 동일 테이블에 weak=true(점선/추천)로 자동 INSERT — 화면엔 "추천 연결"로 흐리게
        │   - LOW  (<τ_suggest) → 연결 안 함, autolink_log에만 기록(학습·튜닝용)
        │
        ④ 표시 + 가역 + 학습
            - 플로우/관계도 패널이 위 연결을 즉시 렌더(근거·신뢰도·해제 버튼)
            - 사용자가 해제/승격 → autolink_feedback 기록 → τ 자동 보정(거버넌스)
```

## "완전 자동"을 안전하게 만드는 4중 안전장치
1. **2-stage 게이팅**: 임베딩이 넓게 줍고 LLM이 좁게 거름 → 단일 임베딩 자동확정의 오연결을 차단.
2. **밴드 분리 + 비대칭 임계값**: 피해 작은 연결(업무↔업무)은 τ 낮게, 피해 큰 연결(업무↔거래처/딜)은 τ 높게. 거래처/딜 자동확정엔 **이름 문자열 겹침(trgm) 동시 충족**을 필수 가드로.
3. **가역·투명**: 자동이라도 침묵 아님 — 근거·신뢰도 표시 + 1클릭 해제. 파괴적 쓰기 없음(연결 행만).
4. **자가보정 루프**: 해제=negative, 유지/승격=positive → precision 모니터 → τ 자동 상향/강등. golden-set로 정확도 상시 측정.

## 신규/변경 데이터 모델
| 대상 | 변경 | 비고 |
|---|---|---|
| accounts / deals / contacts | `embedding vector(768)` + ivfflat 인덱스 추가 | 현재 daily_logs에만 있음 |
| daily_logs | `linked_deal_id uuid FK` 추가 | 현재 account/contact만 있음 |
| daily_log_relations | `confidence numeric`, `reason text`, `weak boolean`, (이미 created_by='ai' 있음) | 자동연결 메타 |
| autolink_log / autolink_feedback (신규) | 후보·판정·사용자피드백 이력 | 임계값 보정·감사 |
| match RPC (신규) | `match_entities(query_embedding, kind, threshold, k)` | pgvector top-K (Supabase 정석) |
| ai_prompts | `work.autolink-extract`, `work.autolink-judge` seed | 엔티티추출·관계판정 프롬프트(거버넌스) |

## 재사용(SSOT) — 신규 최소화
- `lib/gemini-embedding.ts`(embed·cosine·toVectorLiteral) 그대로 확장
- `daily_log_relations`·`addRelation()`·`ai_prompts`/`loadPrompt` 재사용
- `LogFlowView`/`KnowledgeGraphView` 골격에 "자동연결 렌더 + 해제" 추가
- 임계값/거버넌스: daily-ai-governance 패턴(프롬프트 자가합성·자동 롤백) 재사용
- 신규 공용: `lib/work/autolink.ts`(리콜→판정→밴드 단일 엔진) — 4개 엔티티·여러 화면 공통 호출

## 실행 위치
- 임베딩 생성: 저장 시 동기(짧음) 또는 트리거.
- 리콜+LLM판정: **비동기**(작업 큐 / 저장 후 background fetch) — 저장 UX 막지 않음. 결과는 패널에 도착하는 대로 표시(낙관적).
