# 목록 심층분석 v2 — "명령 주도 확산 심층 + 완성형 취합" 설계 기획서
> 2026-07-15 · 🟦 DC-BIZ·DC-RES·DC-OSS(fable-5) 종합 · **기획 전용(구현 0)**
> 결론: 신규 구축 아님. 기존 `/ai-chat/analyze` 파이프라인의 **3개 개조 + 스키마 확장**으로 성립.

## 1. 사용자 요구 (원문 흐름)
문서(기획서/md/이미지/엑셀/ppt/html…) 투입 → **기획서 맥락 중심**으로 항목 발췌(단순 항목만 뽑으면 답 이상) → 각 항목을 **N개 개별 탭에서 병렬 심층 분석** → 완성되면 **생략 없이 하나로 취합**(흐름상 이상한 것만 수정, 완성형) → 오래 걸리므로 **진행상태를 실시간(상태값 하드코딩 금지)**으로 보여줘 사용자가 무슨 일 하는지 알게.
+ 보강: 항목별 "심층"은 고정 템플릿이 아니라 **사용자 명령 기반의 확산적 심층 전개**(지금 CEO가 명령받아 확장 사고하듯).

## 2. 현 구현의 실측 갭 (v1 → v2가 반드시 고칠 것)
| # | 갭(코드 위치) | v2 |
|---|---|---|
| G1 맥락 | `analyzeItem`이 원문 앞 8,000자만 슬라이스(actions.ts MAX_CONTEXT_CHARS) → 뒷부분 항목 무맥락 = "답 이상" | 문서 이해 패스 + 항목별 **맥락 팩**(원문앵커 발췌+의도) |
| G2 취합 | `synthesizeInsights`가 30,000자 **slice로 잘라** 요약형 종합(actions.ts:331) = 유실·요약, "완성형" 아님 | **결정론 조립 + 계층 collapse + 커버리지 게이트**(무손실) |
| G3 실시간 | 클라 4상태 배지, 탭 닫으면 중단·running 고아, DB반영 best-effort | **DB status=SSOT + 서버 오케스트레이터 SSE + 폴링 폴백** |
| G4 명령 | 사용자 명령(customInstruction)이 세션에 **미영속** → resume 시 유실 | 세션 `command` 컬럼 신설, 3단계 프롬프트 전체를 지배 |

## 3. 아키텍처 (명령 주도 파이프라인)
```
사용자 명령 + 문서
 → [추출] parseListItems(결정론 무손실) + AI보정 병합(유실0 계약 유지)
 → [맥락 주석] 2패스: (1)결정론 원문앵커(source_text.indexOf→감싸는 섹션) (2)AI 의도주석(idx참조 JSON만 = 항목 재출력 안 함 → 왜곡 구조적 불가)
 → [병렬 심층] 항목마다 (항목+맥락팩+명령)을 system+user로 확산 전개. 서버 워커풀 K개. 상태 전이 DB 즉시 기록
 → [취합] 항목 다이제스트 → (예산초과시 그룹 collapse) → 명령목적 완성형 통합 → 커버리지 검증(코드) → 패치식 흐름교정
```
- **명령 주입**: `callGemini`에 `system` 파라미터 추가(provider.ts가 이미 `system?` 지원, gemini `system_instruction` 매핑 — 최소변경). 명령/항목/원문 분리로 프롬프트 인젝션·희석 방지.
- **무손실 취합(G2 해법)**: 30k slice 제거. map(항목 다이제스트 `[#idx]` 강제) → reduce(전체 인벤토리 + 다이제스트, Gemini 1M라 비용이 실제 제약 → 예산 내 단일취합, 초과만 계층 collapse) → **커버리지 게이트**: 출력의 `[#idx]` 집합 vs 전체 idx 대조, 누락 시 보수 패스 1회 → 그래도 누락이면 **원문 다이제스트를 부록에 결정론 append**(어떤 경우에도 전 항목 물리적 존재). "이상한 것만 수정"=전면 재작성 금지, **idx 단위 패치 JSON만 받아 코드가 적용**(비패치=무왜곡 증명).
- **실시간(G3 해법)**: 진행률을 저장하지 않음 — `count(status)` 파생만이 "하드코딩 금지"의 정답(listAnalysisSessions가 이미 임베드 집계로 doneCount 파생 = 이 패턴 확장). 신규 `POST /api/admin/ai-chat/analyze/stream`(기존 stream/route.ts의 sse()·ReadableStream·runtime=nodejs 골격 복제)가 pending/error 항목 원자적 claim→워커풀 실행→상태전이 DB기록+SSE emit. 클라는 sse.ts 파서 공용 수신, 단절 시 getAnalysisSession 폴링 폴백. **드레인 루프**로 함수 시간예산 내 실행 후 미완은 재-POST(멱등 claim). 사내 선례: `pricing/gpu/review/stream`(진행 내레이션), `reports/aggregate-stream`(증분 결과).

## 4. 데이터모델 (마이그 157 확장)
- `ai_analysis_sessions` +: `command text`(명령·resume복원) · `phase text`(extracting/analyzing/synthesizing/done — 서버전이만) · `run_claimed_at`(이중실행 락, weekly draft_gen 선례) · `synth_status/synth_text`(**현재 종합 미영속=유실0 사각 해소**) · `coverage jsonb`(누락/복구 리포트)
- `ai_analysis_items` +: `context_excerpt/intent_note/span_start/span_end`(맥락) · `digest_text`(취합 캐시) · `error_text/attempts` · `claimed_at/started_at/finished_at`(stall 감지: running & claimed_at<now-10m → 재claim) · `prompt_tokens/output_tokens`(항목별 비용)
- RLS·트리거는 157 패턴 그대로. `fn_aiai_touch_session` 기존 트리거가 폴링 변경감지 저렴하게 함.

## 5. 재사용(신규 최소·npm 의존성 0)
그대로: list-extract(무손실)·provider/gemini(system 파라미터)·sse.ts·document-extract·export 4종·token-logger·requireAdminApi·157 RLS. 개조: synthesizeInsights(계층화)·analyzeItem(스트리밍/맥락)·runWithConcurrency(lib 승격+백오프). 신규: analyze/stream 라우트·맥락앵커 순수모듈·계층취합 순수모듈(둘 다 단위테스트).

## 6. 우선순위
- **MVP(v2.0)**: G4 명령영속 → G1 맥락팩 → G2 무손실취합(커버리지 게이트) → G3 실시간(DB SSOT+SSE)
- **v2.1**: 항목별 lens 오버라이드·개별 재분석(지시수정)·일시정지·취합본 버전(append)·교정 승인 체크리스트·비용/시간 예측
- **v2.2+**: 근거추적(문장 앵커)·취합본→채팅·대량(50+) 계층취합·세션 검색·member 개방·멀티프로바이더

## 7. 착수 전 결정 필요 (Q&A — 세 플래너 공통)
> ✅ **종결됨 → `DECISIONS.md` 참조**(Q1 Vercel+크론 · Q2 완성형보고서 · Q3 status+열람delta · Q4 lens→명령프리셋 · Q5 admin/K=META4). 아래는 원 논점 기록.
1. **배포 타깃**: Vercel? → maxDuration/드레인 전략 확정 (셀프호스트면 제약 없음)
2. **취합 산출 형태**: 인사이트 요약 vs **완성형 문서(원문 개정판/별도 분석보고서)** vs 둘 다 — 프롬프트 계약이 달라짐
3. **실시간 깊이**: status 전이만 vs 항목 텍스트 delta 스트리밍(열람 항목만) 어디까지
4. **lens 5종 거취**: 자유 명령이 상위 → lens를 "명령 프리셋 버튼"으로 흡수?
5. **권한**: admin 유지 vs member 개방(비용정책 트레이드오프) / K(동시성) 설정 위치(META vs 고정)

## 9. 실행 런타임 — 시스템 기본 (백그라운드·중단·재개) [MVP 코어]
> 사용자 지적: "이탈했을 때 멈추면 안 되고, 사용자가 임의 중단할 수 있어야 한다 — 시스템 기본."
> 현 v1은 **클라이언트가 실행 주체** → 탭 닫으면 미시작 항목 멈춤 + DB에 `running` 고아. 이건 코어 결함이므로 v2에서 반드시 해소.

### 9-1. 브라우저 이탈해도 죽지 않는 백그라운드 실행
- **원칙: 실행 주체는 브라우저가 아니라 서버 + DB.** 브라우저는 "관전자"일 뿐. SSE 연결이 끊겨도(탭 닫힘·네트워크) 작업은 계속돼야 한다.
- **실행 모델(배포 타깃이 결정 — Q&A 1번이 load-bearing)**:
  - **(Vercel 서버리스)**: 함수 1회 수명(maxDuration) 안에서 워커풀이 돌다 시간예산 임박 시 `drained:false`로 중단 → **워커가 이어받아 재-POST**. 이어받는 주체 3택: ⓐ 크론(예: `/api/cron/analyze-drain`이 주기적으로 미완 세션 claim·진행 — **브라우저 완전 독립**, 진짜 백그라운드) ⓑ 사용자가 페이지 재진입 시 미완 감지 재개(반쪽 백그라운드) ⓒ QStash/Inngest 같은 외부 잡큐(신규 의존 — 비권장). **권장 ⓐ 크론 드레인 워커** = 이탈해도 실제로 계속 도는 유일한 서버리스 방식.
  - **(셀프호스트/Railway 등)**: 장수명 프로세스 하나가 큐를 계속 소비 — 시간제약 없음. 가장 단순.
- **큐·claim(중복 실행 방지)**: 워커/커넥션이 `UPDATE ... SET status='running', claimed_at=now() WHERE status IN ('pending') RETURNING`로 원자적 claim → 두 워커가 같은 항목 중복 처리 불가(주간보고 `draft_gen` 락 선례).
- **stall 회복**: `running AND claimed_at < now()-10m`(하트비트 없음) → 죽은 워커의 고아로 판단, 재claim 대상. 현 "영원한 running 고아" 원천 해소.
- **완료 알림(백그라운드의 필수 짝)**: 백그라운드로 돌면 사용자는 다른 일을 함 → 끝나면 알려줘야 함. 세션 완료 시 이력 뱃지/알림(기존 activity/알림 인프라 재사용). "언제 끝나는지 몰라 계속 들여다봄" 방지.
- **다기기 관전(선택)**: 상태 SSOT가 DB라, 다른 기기·탭에서 같은 세션 진행을 폴링/Realtime으로 관전 가능(스키마가 이를 막지 않음 — 지금 도입 안 해도 나중에 publication 추가만으로 증설).

### 9-2. 사용자 임의 중단 — 취소·일시정지 (1급 컨트롤)
- **세션 상태에 제어 플래그**: `control text` = `running|paused|cancelled`(또는 phase와 통합). UI 버튼 → DB 플래그 set. **워커는 매 항목 착수 전 이 플래그를 확인**해 즉시 반응.
- **일시정지(pause)**: 진행 중인 항목은 완료까지 두고(중간 토큰 낭비 방지) 새 항목 착수 중단. 재개 시 미완부터. 비용 통제 겸용.
- **취소(cancel)**: 진행 중 항목까지 `AbortController`로 즉시 중단(provider.streamChat이 이미 `signal` 지원 → 하향 전파). 세션 `cancelled`, 완료분은 보존(유실0 — 이미 한 일은 안 버림).
- **개별 항목 중단/재시도**: 특정 항목만 멈추거나 명령 보강해 재전개(전체 재실행 금지).
- **즉시성**: 취소/일시정지는 서버 왕복 1회로 플래그만 세우면 되므로 사용자 체감 즉각. 실제 중단 시점은 "다음 항목 경계 + in-flight abort".

### 9-3. 재개(resume)·이어하기
- 새로고침·재접속·다른 기기: DB에서 done/error 복원(현 로직 유지) + 미완 있으면 워커가 이어감(크론) 또는 재-POST. 멱등 claim이 보장.
- **부분 완료 활용**: 완료 항목은 즉시 읽기·복사·채팅 이어가기(전체 완료 대기 강제 금지).

### 9-4. 데이터모델 추가(4장에 반영)
`ai_analysis_sessions` +: `control text`(running/paused/cancelled), `run_claimed_at`(워커 claim), `cron_managed bool`(백그라운드 위임 여부). `ai_analysis_items`: `claimed_at`으로 stall 감지(4장 기재분과 통합).

## 8. TRADEOFF·리스크
- 서버 병렬화 시 서버리스 시간예산(항목수×응답시간) → 드레인 루프 필수(1번 결정 선행)
- 취합 무손실은 **AI 신뢰 금지, 코드 게이트가 최종** — 이게 핵심 안전장치
- 대량 항목 비용 폭주 → 사전 예측+상한. 이미지 소스는 오프셋 매칭 불가 → 맥락은 전체 OCR 폴백
- **구현 미착수**(사용자 지시 "절대구현하지마").
