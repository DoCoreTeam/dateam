# v0.7.274 — datetime 정합성 SSOT (시간대 +9h 버그 시스템적 차단)

## 문제 (근본원인)
캘린더에서 사용자가 13:00 선택 → 화면 22:00(+9h) 표시. **저장은 naive=KST 가정, DB/표시는 naive=UTC** 비대칭.
- 저장: `EventModal`이 `${date}T${time}:00` (오프셋 없는 naive) → Supabase timestamptz가 UTC로 적재(13:00 UTC)
- 표시: `formatKstTime`이 UTC→KST(+9) 변환 → 22:00

동일 패턴이 Gemini 추천(actions.ts)·그룹핑(raw slice)·범위필터(UTC 앵커)·dept 날짜경계에 산재.

## 해결 — 단일 SSOT로 수렴
신규 `apps/web/lib/datetime/kst.ts` 1개 모듈이 모든 KST↔UTC 변환의 출처.
- **WRITE**(폼 KST 벽시계 → +09:00 앵커 ISO): `kstWallToIso`·`kstDateOnlyToIso`·`normalizeKstWallString`
- **READ/그룹핑/범위**(항상 KST 변환): `formatKstTime`·`kstDateKey`·`kstParts`·`kstTodayKey`·`kstRangeToUtc`·`formatKstDateTimeShort`

정책: **DB에는 항상 UTC 절대시각 저장, 표시·그룹핑·필터는 항상 KST 변환.**

## 수정 파일 (배선)
| 파일 | 변경 |
|---|---|
| `lib/datetime/kst.ts` | **신규 SSOT** |
| `lib/calendar/format-time.ts` | formatKstTime을 SSOT 재노출(중복 구현 제거), formatMonthDay KST화 |
| `calendar/EventModal.tsx` | naive 조립 → `kstWallToIso`/`kstDateOnlyToIso` |
| `calendar/actions.ts` | Gemini 추천 start_at을 `normalizeKstWallString`로 +09:00 정규화 |
| `calendar/RecommendPanel.tsx` | raw slice 표시 → `formatKstDateTimeShort` |
| `calendar/page.tsx` | 그룹핑 `slice(0,10)` → `kstDateKey` |
| `calendar/DayDetailPanel.tsx` | "오늘" UTC slice → `kstTodayKey` |
| `api/calendar/events/route.ts` | 범위필터 UTC 앵커 → `kstRangeToUtc` (쿼리 경계 포함) |
| `dept-tasks/actions.ts` | log_date ×2 + 폴백 → `kstTodayKey` |
| `meeting-notes/MeetingCalendarView.tsx` | dayKey 서버UTC → `kstDateKey` |
| `meeting-notes/actions.ts` | todayStr → `kstTodayKey` |

## 기존 오염 데이터 보정
`supabase/migrations/135_calendar_tz_backfill.sql` — **`source IN ('user','ai')` 행만 -9h**.
`source='rule'`(일일 일정연동, 올바른 UTC)은 불변. 시각·종일 일정 균일 -9h(그룹핑이 KST 변환이라 날짜 보존).
⚠️ 적용은 사용자 배포 시 1회. 적용 명령·검증 쿼리는 03 참조.

## 재발 방지 가드
- `lib/datetime/kst.test.ts` — 라운드트립(13:00→13:00)·경계·범위 단위테스트 (11 케이스)
- `lib/datetime/kst-guard.test.ts` — **정적 스캔**: calendar/dept-tasks/meeting/api 디렉터리에서 naive datetime 템플릿·`toISOString().slice(0,10)` 재유입 차단(`// kst-ok` 의식적 예외만 허용)

## 검증
tsc 0 · design:check 통과 · 627/627 테스트 통과 (신규 12케이스 포함).
