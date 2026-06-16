# 04 완료 기준 — autolink 사전계산 큐

- [ ] mig106: autolink_jobs 테이블 + UNIQUE(log_id) + index + updated_at 트리거 + RLS default-deny(소유자 select, 쓰기 service_role) — 실DB 적용
- [ ] claim_autolink_jobs RPC: FOR UPDATE SKIP LOCKED + **attempts < MAX 상한** + SECURITY DEFINER/search_path 고정 + service_role only
- [ ] mig107: pg_cron+pg_net 1분 스케줄, cron.command가 **current_setting() 런타임 읽기**(시크릿 평문 미박힘), 설정 없으면 미등록 가드, 배포 절차 주석
- [ ] 적재: addDailyLog·addMultipleDailyLogs 비note 로그 upsert(onConflict log_id), createAdminClient, best-effort(저장 비차단), 수동 updated_at 미세팅
- [ ] 워커: Bearer 시크릿 **timingSafeEqual** 인증(미설정 500/불일치 401), claim 선점 → runAutolink(SSOT) → done/error+last_error clamp, 배치 N=5, no-store
- [ ] AUTOLINK_CRON_SECRET .env.example 문서화, 시크릿 하드코딩 0
- [ ] 기존 on-demand 폴백·패널 무회귀
- [ ] tsc0 · design:check 통과 · DC-SEC PASS · DC-REV APPROVED
- [ ] (배포 단계) ALTER DATABASE로 app.autolink_worker_url/secret 설정 → mig107 재실행 → pg_cron 등록 (localhost 미도달이라 dev 미등록 정상)
