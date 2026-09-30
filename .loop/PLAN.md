# PLAN newAX: 녹음은 어떤 상황에서도 안 잃는다 — 오프라인에서도 시작된다
플랜 ID: P0091
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0148
목표 버전: v0.10.733
작성: 2026-09-30
시작 커밋: cbd521ee

## 목표
- 연결이 없어도 **녹음이 시작된다** — 기기가 회의 id 를 먼저 만들고, 연결이 돌아오면 그 회의가 서버로 건너간다
- 녹음된 소리가 **어느 경로로도 안 사라진다** — 오늘 실제로 잃은 10분(전사 힌트가 길어 400)을 되살리고, 같은 이유로 다시 잃지 않게 막는다

## 범위 밖
- 지난 날짜 회의를 오프라인에서 새로 만드는 것(캘린더 두 입구) — 이번 지시는 「녹음」이고, 지난 회의는 연결이 돌아온 뒤 만들어도 잃는 것이 없다. 그 입구는 v0.10.732 의 안내 문구를 그대로 쓴다
- 전사 결과를 오프라인에서 보여 주는 것 — 전사는 서버가 한다. 소리를 안 잃는 것이 이번 일이다
- 936자 프롬프트의 출처 추적 — 힌트가 거절당해도 본문을 잃지 않게 만들면 손실이 멈춘다. 출처는 다음 실패가 사유에 길이를 적어 스스로 말하게 한다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 실브라우저로 확인: 창구를 끊은 채 「녹음 시작」을 눌러 녹음이 돌고, 다시 이으면 서버에 회의와 구간이 생긴다
- 기기에 남는 회의 메타는 올라간 즉시 지워지고, 못 올린 것도 기한이 있다
- 오늘 실패한 구간(note 74a604a9 · 구간 3)이 전사되어 회의록에 들어간다

## 참조
- LOOP.md 7절 보안 기준 — 기기에 회의 메타를 새로 저장한다
- apps/web/lib/offline/blob-store.ts — 「저장 = 기기에 쓴 순간」 기존 계약
- apps/web/lib/offline/offline.test.ts — 순서·개인정보·말 계약 가드

## 항목

### I01 전사 힌트가 본문을 잃게 하지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/stt/provider.ts, apps/web/lib/stt/provider.test.ts (신규), apps/web/package.json
감사 기준:
- 힌트(prompt) 때문에 400 이 오면 **힌트를 빼고 한 번 더 보낸다** — 시험에서 첫 호출 400·두 번째 호출 성공이면 결과가 나온다
- 두 번째 호출에는 prompt 가 아예 실리지 않는다 (보낸 form 을 시험이 직접 센다)
- 그래도 실패하면 사유에 **보낸 힌트 길이**를 적는다 — 다음 실패가 스스로 원인을 말하게 한다
- 힌트와 무관한 400(형식 오류 등)은 지금처럼 바로 실패다 — 두 번 보내지 않는다
- 보안: 밖에서 온 값을 다룬다(업체 응답). 사유 문자열에 응답 원문을 통째로 싣지 않고 길이와 분류만 남겨 내부 구조가 안 새게 한다(S3)
- `pnpm test stt` 통과
의존: 없음

### I02 오늘 잃은 10분을 되살린다
상태: 대기
모드: 경량
범위: apps/web/scripts/retranscribe-part.mjs (신규)
감사 기준:
- 스크립트가 구간 하나를 전사 대기로 되돌린다 — 오디오(`drive_file_id`)가 살아 있고 `audio_deleted_at` 이 비어 있을 때만, 아니면 이유를 말하고 아무것도 안 바꾼다
- note 74a604a9-7d91-4072-9848-fe686ae7d03c 의 구간 3 이 `TRANSCRIBED` 가 되고 `meeting_transcript_segment` 행이 생긴다 (실행해서 확인)
- 되돌리는 법이 스크립트 첫 주석에 있다 — 상태를 `FAILED` 로 다시 쓰면 원래대로다
- 보안: 운영 데이터를 바꾼다. 바꾸는 것은 한 행의 상태 하나이고 오디오·전사는 안 건드린다. 서비스롤을 쓰므로 **대상 id 를 인자로만 받고** 조건 없는 일괄 갱신을 못 하게 막는다(S2)
의존: I01

### I03 기기가 회의 id 를 먼저 만든다
상태: 대기
모드: 경량
범위: apps/web/lib/offline/local-meeting.ts (신규), apps/web/lib/offline/local-meeting.test.ts (신규), apps/web/package.json
감사 기준:
- `newLocalNoteId()` 가 `local_` 로 시작하는 id 를 주고 `isLocalNoteId()` 가 서버 id 와 확실히 가른다 — 서버 id 가 우연히 걸리지 않는 것을 시험이 센다
- 대기 회의 메타(제목·시작 시각·딜·회사)가 `localStorage` 에 남고, **시작 시각은 녹음을 켠 순간으로 굳는다** — 연결이 돌아온 시각으로 회의가 만들어지면 오전 회의가 오후로 기록된다
- 보안: 기기에 **회의 제목**이 남는다(개인정보). 올린 뒤 즉시 지우고, 못 올린 것도 `MAX_KEEP_DAYS` 와 같은 기한을 넘기면 목록에서 만료로 센다 — blob-store 의 기존 규율과 같은 값을 쓴다
- 저장소가 없거나 막힌 브라우저에서 **조용히 성공하지 않는다** — 못 쓰면 false 를 주고 부르는 쪽이 사실대로 말한다
- `pnpm test local-meeting` 통과
의존: 없음

### I04 안 닿아도 녹음이 시작된다
상태: 대기
모드: 경량
범위: apps/web/lib/meeting/begin-recording.ts (신규), apps/web/lib/meeting/begin-recording.test.ts (신규), apps/web/components/crm/MeetingIntakeBox.tsx, apps/web/package.json
감사 기준:
- 서버가 답하면 지금과 똑같다 — 회의를 만들고 작업대로 간다
- 서버에 못 닿으면 **화면을 옮기지 않고** 그 자리에서 녹음을 켠다 — 없는 주소로 이동하면 오프라인에서 화면이 통째로 죽는다
- 기기에 저장할 수 없으면 **녹음을 시작하지 않고** 그 사실을 말한다 — 올리지도 저장하지도 못하는 녹음은 잃는 녹음이다
- 서버가 답했는데 거절한 경우는 예전처럼 그 사유를 보인다 (v0.10.732 계약 유지)
- `pnpm test begin-recording` 통과
보안: 해당 없음 — 기존 창구와 기존 저장소를 부르기만 한다
의존: I03

### I05 연결이 돌아오면 회의가 서버로 건너간다
상태: 대기
모드: 경량
범위: apps/web/lib/offline/reconcile.ts (신규), apps/web/lib/offline/reconcile.test.ts (신규), apps/web/lib/offline/blob-store.ts, apps/web/lib/offline/sync-parts.ts, apps/web/package.json
감사 기준:
- 대기 회의마다 서버에 회의를 만들고, 기기에 쌓인 그 회의 구간의 **키를 진짜 id 로 다시 매긴 뒤** 올린다 — 구간을 잃지 않는다
- 회의 만들기가 실패하면 대기 목록에서 **안 지운다** — 지우면 그 회의가 영영 안 올라간다
- `syncPendingParts` 가 아직 건너오지 않은 로컬 구간을 **건너뛴다** — 없는 주소로 올리면 시도 횟수만 쌓이고 사유가 거짓이 된다
- 같은 회의를 두 번 만들지 않는다 — 두 벌이 되면 딜에 붙는 기록도 둘이 된다
- `pnpm test reconcile` 통과
보안: 해당 없음 — 새 창구를 열지 않고 기존 창구(POST /api/crm/meetings)를 쓴다
의존: I03

### I06 아직 못 올린 회의를 화면이 말한다
상태: 대기
모드: 경량
범위: apps/web/components/meeting/RecordingBar.tsx, apps/web/components/ui/OfflineBar.tsx, apps/web/lib/offline/ui/sync-status.ts, apps/web/lib/offline/offline.test.ts
감사 기준:
- 로컬 회의를 녹음 중일 때 상주 바가 **없는 주소로 가는 링크를 안 건다** — 누르면 오프라인에서 화면이 죽는다
- 아직 서버로 안 건너간 회의가 있으면 그 사실과 건수를 말한다 — 「올렸겠지」라고 믿게 두지 않는다
- `pnpm test offline` 통과
보안: 해당 없음 — 화면 표시만이다
의존: I05

### I07 실브라우저로 끝까지 본다
상태: 대기
모드: 경량
범위: apps/web/e2e/offline-recording.spec.ts (신규)
감사 기준:
- 창구를 끊은 채 「녹음 시작」을 누르면 화면이 안 바뀌고 녹음이 돈다 (상주 바가 뜬다)
- 다시 이으면 아무것도 안 눌러도 서버에 회의가 생기고 기기의 구간이 비워진다 — DB 로 확인한다
- 만든 회의는 시험이 **id 로** 되돌린다 — 제목으로 지우면 남의 것을 지운다
의존: I04, I05

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-30) 최초 작성 (ins_0148)
