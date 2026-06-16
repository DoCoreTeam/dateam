# 00 요구사항 — autolink 사전계산 큐

## 문제
일일업무 저장 후 업무 플로우 패널을 처음 열 때 autolink(LLM 2회, ~5~10초)가 on-demand로 돌아 느림.

## 요구
- R1: 저장 시점에 autolink를 백그라운드로 미리 계산해 DB에 반영 → 패널 최초 열람도 즉시 표시.
- R2: 워커 런타임 = Supabase pg_cron + pg_net (외부 데몬 없음).
- R3: 기존 on-demand 폴백 보존(큐 미가동·dev·실패 대비 무회귀).
- R4: 메모(note)는 autolink 비대상 → 큐 제외.
- R5: 보안 — 워커는 시크릿 인증, 큐 테이블 RLS default-deny(소유자 select만, 쓰기 service_role).
- R6: 영구 실패 잡이 무한 재시도/폭주하지 않을 것(attempts 상한).

## 비범위
- 패널 UI 변경, updateDailyLog 수정 시 재적재(후속), 에러 잡 알림/DLQ 대시보드(후속), typed supabase client.
