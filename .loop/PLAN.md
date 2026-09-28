# PLAN newAX: 빌드가 메모리로 죽지 않게 한다
플랜 ID: P0083
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0140
목표 버전: v0.10.658
작성: 2026-09-28
시작 커밋: 3dba3698

## 목표
- 프로덕션 빌드가 메모리 때문에 죽지 않는다 — 배포가 다시 READY 가 된다
- 같은 일이 다시 나면 그 전에 알아챈다 — 빌드 성공을 배포 성공으로 착각하지 않는다

## 범위 밖
- 증권사 kis_APAC0071 (배포 뒤 시스템 로그를 보고 따로 봄)
- 번들 크기 자체를 줄이는 일 (메모리 고갈이 급하므로 이번 판은 빌드가 쓰는 메모리만)
- 빌드 머신 등급 올리기 (돈이 드는 계정 설정이라 사람이 정할 일)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 빌드 최대 메모리가 고치기 전보다 실제로 줄었다 (숫자를 PLAN.md 에 적음)
- 설정이 사라지면 가드가 잡는다 (일부러 지워 확인)
- 「빌드 성공」과 「배포 성공」이 다르다는 것을 확인하는 길이 남는다

## 참조
- 실측 2026-09-28 Vercel 배포 dpl_B69b8U5oqSL7PTRMXrKkpsiMtVEX (v0.10.651) = ERROR
  errorStep=buildStep, `terminate called after throwing an instance of 'std::bad_alloc'`,
  `Next.js build worker exited with code: null and signal: SIGABRT`
- 실측 2026-09-28 운영은 v0.10.649 에 멈춰 있고 650~657 은 안 밀린 상태
- 실측 2026-09-28 로컬 프로덕션 빌드 최대 RSS 7,096,205,312 바이트 (약 6.6GB), 빌드 151초
- Vercel 프로젝트 설정: buildMachineType=turbo, nodeVersion=24.x, rootDirectory=apps/web
- std::bad_alloc 은 V8 힙 상한이 아니라 **네이티브 메모리 고갈**이다 — 힙 상한을 올리면 더 나빠진다
- 앞 판에서 같은 SIGABRT 를 로컬에서 보고 힙을 8G 로 올려 넘겼는데, 그것은 증상을 가린 것이었다

## 항목

### I01 빌드가 쓰는 메모리를 줄인다
상태: 통과
모드: 경량
범위: apps/web/next.config.js
감사 기준:
- 고치기 전과 후의 최대 RSS 를 같은 방법으로 재고, 후가 실제로 작다 (숫자를 둘 다 적음)
- 켠 설정마다 왜 켰는지 근거가 있다 — 재 보고 안 줄어든 설정은 안 켠다 (짐작으로 안 켬)
- 빌드 결과가 같다 — 생성된 쪽 수와 첫 화면 JS 가 고치기 전과 같다
- 빌드 시간이 크게 안 늘어난다 (늘면 그 값을 적고 왜 감수하는지 적음)
- 응답 헤더와 번들 경계를 안 건드린다 (보안 S5: headers 여섯 줄·serverExternalPackages·
  outputFileTracingIncludes 를 손대지 않고, security-headers 가드와 deploy-fragile 가드가 통과)
의존: 없음

### I02 다시 늘어나면 그 전에 알아챈다
상태: 통과
모드: 경량
범위: apps/web/lib/policy/build-memory.test.ts (신규), apps/web/package.json, apps/web/scripts/deploy-state.mjs (신규)
감사 기준:
- next.config.js 에서 메모리 설정이 사라지면 시험이 실패한다 (일부러 지워 확인)
- 그 시험이 왜 그 설정인지를 사유와 함께 들고 있다 — 숫자만 적힌 가드는 다음 사람이 못 고친다
- 배포가 READY 인지 확인하는 길이 하나 있다 — 「빌드 성공」은 「배포 성공」이 아니다
  (실측 2026-09-28: 로컬 빌드는 통과했는데 Vercel 은 ERROR 였고 운영은 여드레 전 판에 멈춰 있었다)
- 그 확인기는 토큰을 코드에 안 적는다 — 기존 자리에서 읽는다 (보안: 비밀을 코드에 안 둠, 출력에도 안 실음)
- pnpm test 에 등재되고 총 시험 수가 늘어난다
의존: I01

### I03 종합 감사와 업데이트 내역
상태: 통과
모드: 경량
범위: apps/web/lib/changelog/entries.ts, .loop/PLAN.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 네 개 전부 통과 (결과를 PLAN.md 에 적음)
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과가 전부 0
- 시작 커밋부터 HEAD 까지의 diff 에 범위 밖 변경·비밀 없음
- 사용자 체감 변경이 없으면 entries.ts 를 안 건드리고 그 사유를 적는다
의존: I01, I02

## 종합 감사
실행 2026-09-28, 시작 커밋 3dba3698 .. HEAD v0.10.659

### 넷 다 돌렸다
- pnpm tsc --noEmit 통과 (오류 0)
- pnpm lint 통과 (오류 0, 경고 6은 이 판 전부터 있던 것)
- pnpm test 통과 — 8178/8178, 실패 0 (시작 8172 → 8178, +6)
- pnpm build 통과 — 295/295 쪽, 공용 첫 화면 JS 104 kB, **최대 RSS 4.28GB · 150초**

### 완료 정의 한 줄씩
- 빌드 최대 메모리가 실제로 줄었다 — **6.61GB → 4.28GB (35% 감소)**, 시간 151 → 150초
- 설정이 사라지면 가드가 잡는다 — 넷을 일부러 깨뜨려 전부 실패를 확인했다
- 「빌드 성공」과 「배포 성공」이 다르다는 것을 확인하는 길이 남는다 —
  `pnpm deploy:state` 가 최근 운영 배포를 찍고 안 뜬 판이 있으면 종료 코드 1

### 무엇이 죽었나 (원인)
- Vercel 배포 dpl_B69b8U5oqSL7PTRMXrKkpsiMtVEX (v0.10.651) = ERROR,
  errorStep=buildStep, `std::bad_alloc` + `SIGABRT`
- **코드 오류가 아니라 빌드 머신 메모리 고갈**이다. 그래서 로컬 `pnpm build` 는 계속 초록이었고
  아무도 못 봤다 — 운영은 v0.10.649 에 멈춘 채 그 뒤 여섯 판이 사용자에게 안 갔다
- `std::bad_alloc` 은 V8 힙 상한이 아니라 네이티브 메모리 고갈이라 **힙 상한을 올리면 더 나빠진다.**
  앞 판에서 로컬 SIGABRT 를 `--max-old-space-size=8192` 로 넘긴 것은 증상을 가린 것이었다

### 잰 값 (같은 기계·같은 커밋)
| 설정 | 최대 RSS | 시간 |
|---|---|---|
| 손 안 댄 것 | 6.61 GB | 151초 |
| webpackMemoryOptimizations + cpus:2 만 | 7.00 GB | 156초 |
| 캐시 끄기만 | 4.44 GB | 160초 |
| **캐시 끄기 + webpackMemoryOptimizations** | **4.22~4.28 GB** | 150~159초 |

생성 쪽 수(295/295)와 공용 첫 화면 JS(104 kB)는 넷 다 같다 — 결과물은 안 바뀐다.
`cpus: 2` 는 혼자서는 오히려 더 썼으므로 안 켰다.

### 보안 다섯 줄 (LOOP.md 7절)
psql -f docs/policy/security-count.sql 결과 전부 0
(RLS 꺼진 표 0 · anon 쓰기 표 0 · TO public USING(true) 0 · search_path 없는 SECURITY DEFINER 함수 0 · anon 이 읽는 SECURITY DEFINER 뷰 0)

### 전체 diff
git diff 3dba3698..HEAD --stat 8개 파일, +244 / -7
- 범위 밖 변경 없음 — next.config.js · 새 가드 · 새 확인기 · 버전 파일 다섯뿐이다
- 응답 헤더와 번들 경계는 안 건드렸다 (security-headers · deploy-fragile 가드 19개 통과)
- 비밀 없음 — 추가된 줄에 키 꼴 0건이고, 확인기는 토큰을 META 에서 읽는다

### entries.ts 를 안 건드린 사유
사용자가 화면에서 겪는 변화가 없다 — 빌드가 죽던 것을 고친 판이다.
다만 이 판이 배포되면 **밀려 있던 v0.10.650~658 이 함께 사용자에게 간다.**
그 판들의 사용자향 글은 v0.10.647·v0.10.655 블록에 이미 적혀 있다.

## 변경 이력
- v0.1.0 (2026-09-28) 최초 작성 (ins_0140)
