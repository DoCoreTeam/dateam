# 135 backfill 적용 가이드 (운영 데이터 교정 — 1회성)

## 사전 확인 (적용 전 영향 행 수)
```sql
-- 보정 대상(오염): source IN ('user','ai') AND link_kind ≠ 'meeting'
SELECT source, link_kind, count(*) AS rows, count(end_at) AS with_end
FROM calendar_events
WHERE source IN ('user','ai') AND link_kind IS DISTINCT FROM 'meeting'
GROUP BY source, link_kind;

-- 불변(정상 UTC) — 건드리면 안 되는 행: source='rule' + link_kind='meeting'(회의 앵커/AI파생)
SELECT source, link_kind, count(*) FROM calendar_events
WHERE source = 'rule' OR link_kind = 'meeting'
GROUP BY source, link_kind;
```

> ⚠️ DC-REV CRITICAL: 회의노트 앵커(`source='user' AND link_kind='meeting'`)와 AI파생 회의일정
> (`source='ai' AND link_kind='meeting'`)은 **이미 올바른 UTC**다. backfill에서 `link_kind ≠ 'meeting'`로 제외된다.

## 적용 (CLAUDE.md 표준 — psql migrate.sh, supabase CLI 아님)
```bash
PGPASSWORD='...' ./scripts/migrate.sh 135_calendar_tz_backfill.sql
PGPASSWORD='...' ./scripts/migrate.sh --status   # 적용 확인
```

## 적용 순서 주의 (race 최소화)
신규 코드(+09:00 앵커 저장)와 backfill은 함께 배포한다.
- 권장: **신규 빌드 배포 직후 즉시 135 적용.**
- 135는 schema_migrations로 1회만 추적됨 → **재적용 금지**(중복 -9h).

## 적용 후 검증
```sql
-- 임의 'user' 일정 1건의 KST 표시가 입력값과 일치하는지(앱 화면) 교차 확인
SELECT id, title, start_at,
       to_char(start_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS kst
FROM calendar_events
WHERE source IN ('user','ai')
ORDER BY updated_at DESC LIMIT 10;
```
`kst` 컬럼이 사용자가 원래 입력한 시각과 같아야 한다(예: 13:00).
