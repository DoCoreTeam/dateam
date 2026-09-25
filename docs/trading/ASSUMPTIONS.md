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
