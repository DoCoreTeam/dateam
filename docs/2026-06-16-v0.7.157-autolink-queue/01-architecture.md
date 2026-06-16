# v0.7.157 — autolink 저장시 사전계산 큐 (Supabase pg_cron + pg_net)

## 목표
일일업무 저장 시 autolink(AI 자동연결)를 백그라운드 큐로 미리 계산해 DB에 반영 → 업무 플로우 패널을 열면 이미 결과가 있어 체감 지연 제거. 최초 1회 LLM 2회(~5~10초) 대기를 화면 밖으로 이동.

## 현황(조사 사실)
- autolink는 패널 열람 시 on-demand 실행(`AutolinkSection.tsx:46-53`). 결과는 `daily_log_relations`/`work_entity_links`에 영구 저장 → 재열람은 빠름.
- 잡 인프라 0 (vercel cron·pg_cron·데몬 없음). 워커 런타임 = **Supabase pg_cron + pg_net** 선택됨.
- 병목 = `runAutolink`(autolink-run.ts)의 LLM 2회. 임베딩은 저장 시 이미 생성.

## 아키텍처
### 1. 큐 테이블 `autolink_jobs` (mig 106 — 지금 적용)
- `id uuid pk`, `log_id uuid not null FK daily_logs(id) ON DELETE CASCADE`, `requester_id uuid not null`(소유자), `status text default 'pending' CHECK in (pending,processing,done,error)`, `attempts int default 0`, `last_error text`, `created_at/updated_at timestamptz`.
- `UNIQUE(log_id)` — 로그당 1잡(upsert).
- index `(status, created_at)` 워커 폴링용.
- RLS enable, default-deny: 소유자 본인 select만(`requester_id = auth.uid()`), insert/update/delete는 service_role 전용(워커·라우트가 admin client). 

### 2. 적재(enqueue) — 저장 직후 non-blocking
- `daily/actions.ts` `addDailyLog`/`addMultipleDailyLogs`에서 성공 insert 후, `entry_type != 'note'` 로그에 대해 `autolink_jobs` upsert(status='pending'). 단일 insert라 저장 응답에 큰 부담 없음. note(메모)는 autolink 대상 아님 → 제외.

### 3. 워커 라우트 `POST /api/work/autolink/worker` (지금 구현)
- 인증: `Authorization: Bearer ${AUTOLINK_CRON_SECRET}` (env). 불일치 401. (사용자 세션 아님 — 기계 호출)
- pending 잡 최대 N개(예 5) 선점(`status='processing'`, attempts+1). 가능하면 `FOR UPDATE SKIP LOCKED` RPC로 동시성 안전.
- 각 잡: 기존 `runAutolink(logId, requesterId)` 호출(SSOT 재사용) → 성공 done / 실패 error+last_error. autolink_run_at 마커가 이미 중복실행 방지.
- admin client 사용(RLS 우회는 워커 한정). 처리 수 반환.

### 4. pg_cron 스케줄 (mig 107 — 배포시 활성화, 가드)
- `create extension if not exists pg_cron; pg_net;` (권한/대시보드 필요할 수 있음).
- `cron.schedule('autolink-worker','* * * * *', $$ select net.http_post(url:=<APP_URL>/api/work/autolink/worker, headers:=jsonb_build_object('Authorization','Bearer '||<SECRET>)) $$)`.
- URL/시크릿은 하드코딩 금지 → `current_setting('app.autolink_worker_url')`·`app.autolink_worker_secret` 또는 settings 행에서 read. **localhost 미도달이라 배포 URL 필요** → 활성화는 배포 단계 문서로.

### 5. 패널
- 변경 최소: 기존 DB 캐시 읽기 + on-demand 폴백 유지. 큐가 미리 채우면 패널은 즉시 캐시 표시. 폴백은 큐 미가동(dev)·실패 대비 안전망으로 존속.

## 리스크 / 냉정한 평가
- pg_net→앱 URL 도달은 **배포 환경 전제**(dev localhost 불가). → ⓐ메커니즘 즉시 완성, ⓑcron 활성화는 배포시.
- pg_cron/pg_net 확장 활성화에 Supabase 권한/대시보드 필요할 수 있음(pooler 마이그레이션으로 안 될 시 대시보드 안내).
- 신규 업무는 매칭 대상이 적을 수 있으나, 기존 업무/엔티티와 매칭하므로 즉시 유효.
- 비용: 저장마다 LLM 2회가 큐로 비동기 발생 → 토큰 사용 증가(token-logger로 계측됨). 폭주 방지 위해 워커 배치 N 제한.

## 완료 기준
- [ ] mig106 `autolink_jobs` 테이블+RLS(default-deny)+index 적용(실DB)
- [ ] 저장 시 비note 로그에 잡 upsert(중복 log_id 안전)
- [ ] 워커 라우트: 시크릿 인증·pending 선점·runAutolink 호출·done/error 마킹·동시성 안전
- [ ] 워커 수동 호출(Bearer)로 pending→done 전이 검증(실DB 1건)
- [ ] 기존 on-demand 폴백·패널 무회귀
- [ ] mig107 pg_cron 스케줄 SQL 작성(가드)+배포 활성화 절차 문서화
- [ ] AUTOLINK_CRON_SECRET .env.example 문서화, 시크릿 하드코딩 0
- [ ] tsc0·design·DC-SEC(워커 인증/RLS)·DC-REV
