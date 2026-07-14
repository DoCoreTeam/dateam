# AI 채팅 클론 — 3세션 루프 런북

## 실행 순서 (의존성 — 반드시 순차. 배치 분할 근거는 오직 의존성 — 전체가 확정 완성 스펙)
1. **세션 1**(기반+핵심 채팅 — 배치 1) → 마이그레이션 150 적용 + push → 머지
2. **세션 2**(멀티모달+완성도 — 배치 2) → 마이그레이션 151 적용 + push → 머지
3. **세션 3**(고급: Artifacts·Projects·툴·공유·분기 네비게이션 — 배치 3) → 마이그레이션 152·153 적용 + push

> 각 세션은 **새 Claude 세션**에서 해당 루프 명령어 1개를 입력해 자율 구현. 세션 N은 세션 N-1의 코드+마이그레이션이 머지·적용된 상태에서 시작.

## 정합성 계약 (3세션 공통)
> **`sessions/04-implementation-contract.md`가 단일 구현 계약(SSOT)이다.** 테이블/RLS/트리거 실명, TS 타입, streamChat·SSE 봉투, 서버액션 시그니처, META 키명 전부 04를 따른다. 세션 문서와 어긋나면 **04가 우선**. (본 런북의 구 계약 표는 04로 대체됨.)
- 마이그레이션 번호: 세션1=150 · 세션2=151 · 세션3=152·153.

## 세션 경계 요약
| 세션 | 산출 | 마이그레이션 | 핵심 |
|------|------|--------------|------|
| 1 | 대화관리+스트리밍 채팅+3프로바이더+통합 | 150 | ai_conversations/ai_messages, lib/ai-chat/*, /admin/ai-chat, 좌측메뉴+사이드바 "새 대화" 버튼(FAB 미도입) |
| 2 | 파일업로드·멀티모달+완성도 | 151 | ai_attachments+Storage(office 텍스트 추출 포함), 재생성·편집분기·검색·pin 섹션·시스템프롬프트·thinking(영속 표시)·피드백 |
| 3 | Artifacts·Projects·툴·공유·분기 네비게이션 | 152·153 | ai_projects+pgvector, artifacts 패널, web_search 툴, 내보내기·공유 옵트인, `‹ k/n ›` 분기 열람, LaTeX·비용대시보드 |

## 각 세션 사용자 핸드오프 (루프가 하지 않음)
- 마이그레이션 적용: `PGPASSWORD=… ./scripts/migrate.sh NNN_*.sql`
- 원격 반영: `! git push origin main`  (EXEC-003 — push는 사용자)
- (세션2) Supabase Storage 버킷 `ai-chat`+정책 생성

## 루프 명령어 (각 세션에 그대로 입력)

### 세션 1
```
/ceo-ralph "dateam 'AI 채팅' 클론 세션1 구현. 설계서: docs/2026-07-13-ai-chat-clone-plan/sessions/session-1-foundation-mvp.md 를 그대로 완전 구현한다. 공용 계약 sessions/04-implementation-contract.md(SSOT — 어긋나면 04 우선) 준수. 상위기획 00/01/03 문서 참고. 어드민 전용·프로바이더3종(Gemini+Claude+OpenAI)·고급모델 기본 준수. 완료조건=설계서 §9 완료기준 전항목 ✅ + 'cd apps/web && pnpm exec tsc --noEmit' exit0 + 신규 단위테스트 통과. 마이그레이션 150 파일은 생성만(적용은 사용자), 로컬 git commit까지만 하고 git push는 하지 말 것(사용자 실행). 종료조건: §9 전항목 충족. 미달 시 3회까지 자율 재시도 후 에스컬레이션."
```

### 세션 2 (세션1 머지·150 적용 후)
```
/ceo-ralph "dateam 'AI 채팅' 클론 세션2 구현. 선행: 세션1 완료·마이그레이션150 적용 상태. 설계서: docs/2026-07-13-ai-chat-clone-plan/sessions/session-2-multimodal-completeness.md 를 완전 구현(파일업로드·멀티모달(office 텍스트 추출 포함)+재생성·편집분기·검색·pin 섹션·시스템프롬프트·thinking(영속 표시)·피드백). 공용 계약 sessions/04-implementation-contract.md(SSOT — 어긋나면 04 우선) 준수. 어드민 전용 준수. 완료조건=설계서 §8 완료기준 전항목 ✅ + tsc --noEmit exit0 + 단위테스트 통과. 마이그레이션 151·Storage 정책 파일은 생성만(적용은 사용자), git commit까지만(push 금지=사용자). 종료조건: §8 전항목 충족, 미달 시 3회 재시도 후 에스컬레이션."
```

### 세션 3 (세션2 머지·151 적용 후)
```
/ceo-ralph "dateam 'AI 채팅' 클론 세션3 구현(마감). 선행: 세션1·2 완료·마이그레이션150·151 적용 상태. 설계서: docs/2026-07-13-ai-chat-clone-plan/sessions/session-3-advanced.md 를 완전 구현(Artifacts·Projects+pgvector·툴/web_search·내보내기·공유 옵트인·분기 네비게이션·LaTeX·비용대시보드). 공용 계약 sessions/04-implementation-contract.md(SSOT — 어긋나면 04 우선) 준수. 어드민 전용 준수. 완료조건=설계서 §8 완료기준 전항목 ✅ + tsc --noEmit exit0 + 단위테스트 통과. 마이그레이션 152·153 파일 생성만(적용은 사용자), git commit까지만(push 금지=사용자). 종료조건: §8 전항목 충족, 미달 시 3회 재시도 후 에스컬레이션."
```

> `/ceo-ralph`이 종료조건 Q&A(1-2개)를 물으면: "종료조건=설계서 완료기준 전항목+typecheck+테스트, push/마이그레이션적용 제외"로 답하면 됨.
> `/ceo-ralph` 미사용 환경이면 대체: 각 명령의 큰따옴표 안 내용을 `/ceo "…"` 로 실행(수동 반복).
