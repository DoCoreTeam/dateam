# AI 트레이딩 1-A 가정과 선택

명세 `newplan/TRD/AI_TRADING_SPEC.md` v0.8.1 이 「먼저 찾고, 없으면 기본 구현으로 진행하고 여기 적으라」고 한 것들
적은 시점 v0.10.460, 플랜 P0057

## §17.1 「먼저 찾고, 없으면 기본 구현」 네 가지

| 대상 | 찾은 것 | 쓴 것 |
|---|---|---|
| 크론 인증 | `lib/crm/jobs/machine-auth.ts` 의 `isMachineCall` · `machineAuthUnconfigured` (CRON_SECRET · CI_WORKER_TOKEN 둘 다 받음) | 그것을 그대로 씀, 새 인증 안 만듦 |
| 암호화 | `ai_provider_keys.api_key` 는 **평문**이라(마이그 264) 본뜰 헬퍼가 없었음. `lib/ci/settings/crypto.ts` 에 AES-256-GCM 봉투 + `CI_SETTINGS_MASTER_KEY` 가 있었음 | 그 모듈을 감싸 씀(`lib/trading/broker/crypto.ts`), **새 env 안 만듦** — `TRADING_ENCRYPTION_KEY` 는 안 씀 |
| 감사 기록 | `activity_log` 와 마이그 265 의 범용 감사 트리거가 이미 있음 | 기존 것을 씀, `trading_audit_log` 표 안 만듦 |
| 알림·업무 항목 | 1-A 에 필요 없음(명세가 그렇게 적음) | 안 만듦, 1-C 에서 찾음 |

## 스케줄러

- 기본은 **Supabase pg_cron**(마이그 280), 대체는 Vercel Cron(`apps/web/vercel.json`)
- 명세 §17.2 가 이 모듈만 예외로 pg_cron 을 허용함 — 1분 판단의 정시성 때문
- pg_cron 은 `app.trading_tick_url` · `app.trading_tick_secret` 을 설정해야 등록됨. 안 하면 NOTICE 만 남고 Vercel Cron 이 돔

## 실측으로 확인한 것

| 무엇 | 확인 방법 | 결과 |
|---|---|---|
| KIS 분봉 요청 인자 | 공식 저장소 `examples_llm/domestic_futureoption/inquire_time_fuopchartprice` | `FID_COND_MRKT_DIV_CODE` 는 `JF` 가 아니라 **`F`**, 1분은 `FID_HOUR_CLS_CODE=60`, 1회 102건 |
| 월물 코드 | `fo_idx_code_mts.mst.zip` 을 실제로 받아 풀고 cp949 로 읽음 (92,908바이트 · 8,543줄) | 정규 근월물 `A01612`(F 202612), 미니 `A05610`(미니F 202610). 상품종류 `1`=지수선물 `B`=미니선물, 월물구분 `1`=최근월물 |
| 2026년 둘째 목요일 | `date` 명령으로 독립 검산 | 열두 달 전부 일치 |
| Vercel AI Gateway | 공식 문서 + `/v1/models` 실호출 | 접두사 `vck_`, 주소 `https://ai-gateway.vercel.sh/v1`, 모델 390개 |

## 확인 못 해 가정으로 둔 것 — **1-B 전에 실데이터로 확인할 것**

| 무엇 | 지금 가정 | 틀리면 어떻게 되나 | 어떻게 확인하나 |
|---|---|---|---|
| 분봉의 `stck_cntg_hour` 가 봉 **시작**인가 끝인가 | 시작으로 읽음 | 봉이 1분씩 밀려 저장됨. 판단 시각이 전부 어긋남 | 실계정으로 장중에 한 번 조회해 마지막 봉 시각과 현재 시각을 대조 |
| 조회 API 가 마스터의 `A01612` 형식 코드를 받나 | 받는다고 가정 | 오류가 아니라 **빈 응답**이 옴. 화면에는 「시장이 조용하다」로 보임 | 실계정으로 한 번 조회. 안 되면 설정 「근월물 코드 직접 지정」으로 진행 |
| 만기일에 장 마감 단일가가 있나 | **없는 것으로 둠** | 있으면 단일가 봉으로 판단하게 됨 | 거래소 공지 확인 후 `trading_session_calendar.close_auction_end` 를 채움 |
| 공휴일 | 출처가 없어 **평일을 전부 거래일 후보**로 세움 | 휴장일에 봉이 하나도 안 와 결측이 하루치 쌓임 | 휴장일 줄을 지우거나 고침(`source='manual'`). 자동 수집은 Release 2 |

## 개발 환경

- KIS 키는 **실전 조회 전용 키**를 씀(명세 §19). 분봉 API 가 모의투자를 지원하지 않기 때문이고, 주문 코드가 없어(M1) 위험이 없음
- 그 사실을 `lib/policy/trading-no-order-guard.test.ts` 가 계속 센다

## 이 저장소를 만지며 알게 된 것 (트레이딩과 무관하지만 남김)

- `apps/web` 아래에 `.next-*` 잔여 빌드 디렉터리가 스무 개 넘고 그중 셋이 2.7~3.1GB, `tsconfig.json` 의 `include` 에도 남아 있다
  기본 힙으로는 `pnpm tsc --noEmit` 과 `pnpm build` 가 **OOM 으로 죽는다**. `NODE_OPTIONS=--max-old-space-size=8192` 를 붙이면 통과한다
  다른 세션이 남긴 것이라 지우지 않았다

## 만들어 놓고 안 이은 자리 여덟 (2026-09-26 발견·수정, P0058)

1-A 를 「끝냈다」고 보고한 직후 사용자가 «전체 다 구현 했다고?» 라고 물었고, 세어 보니 여덟 자리가
**만들어만 놓고 아무도 안 부르는** 상태였다. 단위 시험은 전부 초록이었다.

| 자리 | 결과 | 고친 방법 |
|---|---|---|
| `seedRegularSessions` 소비처 0 | 캘린더가 영원히 비어 크론이 매분 `no_session_row` 로 끝남 — **봉이 한 줄도 안 쌓임** | `ensureSessionWindow` 로 바꿔 크론이 그날 줄을 스스로 세움 (옛 함수는 지움) |
| `aggregateBars` 소비처 0 | 5분 봉이 저장 안 됨 (단정 15개로 검증돼 있었는데) | 구간을 닫는 분에서만 묶어 저장 |
| `KisClient.price` 소비처 0 | 미결제약정이 늘 null | 시세를 불러 `open_interest` 를 채움 |
| `ai_request_at`·`ai_response_at` 미기록 | Jev 지연을 못 잼 (§14.2 필수) | 밖으로 나가는 판단기만 시각을 남김 |
| 야간장 미구현 | §6.1 「야간장도 수집한다」가 안 지켜짐 | 야간 창을 세우고 모으되 판단은 정규장만 |
| `trading_day_config` 미사용 | §14.4 거래일 고정이 안 됨 | 거래일 시작에 굳히고, 그 덕에 마스터 재다운로드도 막음 |
| `syncContracts` 를 매분 호출 | 92KB 마스터를 하루 1,440번 받게 됨 | 굳힌 날은 표에서 읽음 |
| 크론 `job_name` 이 판마다 같음 | 운영과 로컬이 같은 분 슬롯을 다툼 — **로컬이 운영 수집을 가로챌 수 있었음** | 이름에 판을 박음(`trading-tick@development`) |

### 왜 못 봤나

시험이 **함수가 맞게 계산하는가**만 봤다. **그 함수가 불리는가**는 아무도 안 물었다.
크론을 실제로 쳐서 `no_session_row` 를 받고도 「캘린더가 비었으니 맞는 답」으로 읽었다 —
「비어 있는 것이 정상」이 아니라 「채우는 코드가 없다」는 신호였다.

### 어떻게 막았나

`apps/web/lib/policy/trading-wiring-guard.test.ts` 가 `lib/trading/**` 의 값 export 를 전부 훑어
운영 코드 어디에서도 안 불리는 것을 센다. 만들 때 세 번 깨뜨려 보며 고쳤다.

- 시험 파일을 소비처로 세면 **잡아야 할 것을 정확히 놓친다** (`aggregateBars` 가 그랬다)
- `import` 줄만 남아도 통과한다 — 들여온 것은 쓴 것이 아니다
- **주석도 통과시킨다** — 다른 파일 주석에 이름이 적혀 있어 한 번 놓쳤다

셋 다 「이름이 있나」가 아니라 「값이 가나」를 봐야 한다는 같은 이야기다.
