# 03 테스트 전략 — autolink 사전계산 큐

- 타입: `tsc --noEmit` 0. 디자인: `design:check` 통과.
- 마이그레이션: mig106 실DB 적용(테이블/RLS/RPC 생성 확인). mig107은 가드라 설정 없으면 NOTICE만(무해) — 적용 시 미등록 정상.
- 통합(수동): AUTOLINK_CRON_SECRET 설정 → 비note 일일업무 저장 → autolink_jobs에 pending 1건 생성 확인 → 워커 라우트 Bearer 호출 → 잡 done 전이 + daily_log_relations/work_entity_links 결과 확인.
- 인증 음성: Bearer 누락/오류 → 401, 시크릿 미설정 → 500.
- 동시성: claim RPC FOR UPDATE SKIP LOCKED로 중복 처리 없음(2회 동시 호출 시 같은 잡 미중복).
- 상한: attempts>=MAX 잡은 claim 제외(영구실패 폭주 방지).
- 회귀: 패널 on-demand 폴백·기존 저장/임베딩 흐름 무변경.
- 보안(DC-SEC): RLS default-deny, requester_id 위조 차단(서버 user.id), 시크릿 비번들 노출.
