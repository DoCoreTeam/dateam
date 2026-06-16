# 02 작업 분해 — autolink 사전계산 큐

1. DB(mig106): autolink_jobs 테이블 + UNIQUE(log_id) + index(status,created_at) + updated_at 트리거 + RLS default-deny(소유자 select) + claim_autolink_jobs(p_limit) RPC(FOR UPDATE SKIP LOCKED, **attempts<MAX 상한**, SECURITY DEFINER, service_role only).
2. DB(mig107): pg_cron+pg_net 1분 스케줄 → 워커 라우트 POST. URL/시크릿은 **cron.command 내 current_setting() 런타임 읽기**(평문 박힘 방지), 설정 없으면 미등록(가드). 배포 활성화 절차 주석.
3. BE 적재: addDailyLog/addMultipleDailyLogs 성공 후 비note 로그 autolink_jobs upsert(onConflict log_id, status=pending). createAdminClient, best-effort try/catch(저장 비차단).
4. BE 워커: POST /api/work/autolink/worker. Bearer 시크릿(timingSafeEqual) 인증 → claim RPC 선점 → runAutolink(SSOT 호출) → done/error 마킹(last_error clamp). 배치 N=5.
5. 검증: tsc0·design·mig106 실DB 적용·워커 수동호출 pending→done 전이.
