# 화면 전수 확인 — 진행 상황과 결함 목록

기준 **v0.7.472** (앞선 판은 v0.7.458) · 실브라우저(사용자 Chrome, 로그인 세션) 직접 확인 + 화면별 자동 점검 스크립트

> **이 문서는 진행 중이다.** 확인한 화면과 확인 못 한 화면을 구분해 적는다.
> "다 봤다"고 적지 않는다 — 앞서 네 화면만 보고 전수 확인이라 보고한 사고가 있었다.

## 점검 방법

화면마다 브라우저에서 스크립트를 주입해 아래를 **한 번에** 판정한다.
항목: 문서 가로 스크롤 · 부모를 넘치는 요소 · 10px 미만 폰트 · `input-field` 없는 raw 입력 ·
표 클래스 · `h1` 유무와 크기.

**눈으로도 본다. 그리고 모바일 폭에서 다시 본다.**
스크립트는 놓치는 게 있고, 데스크톱만 보면 못 보는 게 또 따로 있다(§오늘 배운 것).

---

## 확인 완료 (눈 + 스크립트, 데스크톱 1338px)

member 12 · admin 15 · ci 10 · GPU 탭 12 — 아래 목록은 **결함이 남아 있지 않은** 화면이다.

| 묶음 | 화면 |
|---|---|
| member | `/home` `/calendar` `/deals` `/deals/[id]` `/accounts` `/contacts` `/meeting-notes` `/weekly-report` `/kpi` `/routine` `/operations` `/lead-intake` `/work/overview` `/work/activity` `/work/projects` `/pricing/catalog` `/api-keys` `/change-password` |
| admin | `/admin/members` `/admin/settings` `/admin/content` `/admin/api` `/admin/ai-usage` `/admin/ai-prompts` `/admin/daily-logs` `/admin/kpi` `/admin/reports` `/admin/routine` `/admin/partner-tiers` `/admin/data-quality` `/admin/org-chart` `/admin/ai-chat` |
| ci | `/ci` `/ci/inbox` `/ci/boards` `/ci/trends` `/ci/assets` `/ci/publish` `/ci/performance` `/ci/pipeline` `/ci/settings` `/ci/studio` `/ci/monitoring` `/ci/my-channels` |
| GPU | `?tab=` intake · board · cockpit · market · inventory · catalog · review · suppliers · competitors · sources · specs · log |
| 공개 | `/develop` `/api-access` `/login` |

### GPU 모달 (모바일 452px에서 재확인)

| 모달 | 결과 |
|---|---|
| 공급사 상세 | 428×686 · 견적 행 금액 가려짐 **수정됨**(v0.7.471) |
| 경쟁사 매핑 관리 | 428×687 · 내부 스크롤 정상 |
| 경쟁사 가격 등록 | 428×478 |
| 경쟁사 선택 | 높이 상한 없던 것 **수정됨**(v0.7.472) → 687(90vh) + 내부 스크롤 |
| GPU 스펙 편집 | 428×572 |
| 공급사 등록 · 견적 수정 | `--scroll` 적용 |

---

## 미확인 (남은 것)

- **쓰기 가능성이 있는 E2E 26종** — 실데이터를 변경할 수 있어 의도적으로 돌리지 않는다.
  정규식으로 저장·삭제·POST 흔적을 훑어 분류했다(읽기 전용 8종은 전부 통과).
  돌리려면 격리된 테스트 계정·데이터가 먼저 필요하다.

그 밖의 항목은 v0.7.474~475에서 모두 해소했다 — 아래 "닫은 항목" 참조.

## 닫은 항목 (앞 판에서 "미확인"이던 것)

| 무엇 | 어떻게 닫았나 | 결과 |
|---|---|---|
| 구뷰 '파트너 등급 관리' 모달 | `localStorage['gpu:flag:unified']='off'`로 롤백 경로를 켜서 실제로 열었다 | **입력 9곳이 표준 밖**이었다(v0.7.474). `#fff` 고정·이름표 전무 → `input-field`+`aria-label` |
| `/ci/briefs/[id]` | 파이프라인의 '기획안'으로 진입(기존 데이터, 새로 만들지 않음) | 결함 0 (데스크톱·모바일) |
| `/ci/channels/[id]` | 워크스페이스 API로 기존 채널 id를 얻어 직접 진입 | 결함 0 (데스크톱·모바일) |
| 비-GPU 모달 47개 모바일 | 오늘 찾은 결함 3유형을 47개 전부에 정적 적용 + 대표 4개 실측 | 높이 상한 누락 3건은 전부 로딩·스포트라이트 오버레이(정상) · **모달 내 raw 입력 0건** |
| 읽기 전용 E2E 8종 | 실데이터를 안 바꾸는 것만 골라 실행 | **18 실패 → 30/30 통과**. 원인 중 하나가 접근성 회귀(v0.7.475) |

### E2E 릴리스 전 절차 (CI에는 못 넣는다)

로그인 세션(`apps/web/e2e/auth-state.json`)이 필요한데 그건 사람이 직접 로그인해 만드는
로컬 산출물이라 CI에 자격증명을 두지 않는 한 돌릴 수 없다. 대신 배포 전 로컬에서:

```bash
pnpm exec playwright test apps/web/e2e/{work-ia,work-overview,work-shell-uniformity,\
  work-dashboard,patchnotes-entry,daily-dept-separation,gpu-unified-table,\
  gpu-curation-config-ladder}.spec.ts
```

---

## 해소된 결함 (v0.7.459 ~ v0.7.472)

| 무엇 | 버전 |
|---|---|
| 화면을 덮는데 대화상자가 아니던 오버레이 | 459 · **468**(가드가 놓치던 8곳 추가) |
| 폼 입력 표준 23곳 + JSX 태그 파서 SSOT | 460 |
| 콘텐츠 관리 표 모바일 붕괴 · 모바일 카드 흰 배경 | 461 |
| 캘린더 칩 글자 잘림(제목 말줄임·모바일 시각) | 462 |
| **10px 미만 글씨 141곳** · 탭이 거짓 활성 표시 · GPU 헤더 PageHeader 이관 · classic 테마 테두리 실종 | 463 |
| 이동마다 번쩍이던 전체화면 로더 · 사람 이름 칸 잘림 | 464 |
| API 요청마다 내던 중복 인증 통행료 | 465 |
| 화면당 인증 서버 2~3회 질문 → 1회 | 466 |
| 화면마다 하던 `profiles` 중복 조회(236ms) | 467 |
| GPU 모달 8개 공용 클래스 이관 + dialog-contract 가드 교체 | 468 |
| 어시스턴트 한글 Enter 중복 입력 · 죽은 예외 목록 정리 | 469 |
| **프로덕션 빌드 파손(이틀)** + CI에 빌드 추가 | 470 |
| 모바일에서 견적 금액이 가려져 틀리게 읽히던 것 | 471 |
| 모달 3곳 높이 상한 없어 하단 버튼 도달 불가 | 472 |

---

## 성능 — 결론

| 측정 | 값 |
|---|---|
| dev 서버 화면 응답(v0.7.458 시점) | 157~284ms |
| 미들웨어 `profiles.role` 조회 비용 | **236ms/요청** (같은 `/kpi`로 조회 유무만 바꿔 각 9회) |
| 미들웨어가 API에 중복으로 물리던 인증 | **110~210ms/호출** (순서 뒤집어 2라운드 교차 측정) |
| 레이아웃·페이지 `getUser()` 중복 제거 | 약 **110ms/화면** (대조군 드리프트 차감) |
| 프로덕션 공통 First Load JS | **88.2 kB** (화면별 88~236 kB, 앱 예산 300 kB 안) |

**측정 방법 메모**: dev 서버는 워밍에 따라 ±100ms씩 흔들린다. 한 번 재고 "빨라졌다"고 하면 안 된다.
이번엔 **변경을 타지 않는 대조군을 같이 재고, 순서를 뒤집어 두 라운드**를 돌려 드리프트를 걸러냈다.
처음 잰 수치는 대조군까지 같이 빨라져서 버렸다.

### 남은 병목

없다 — 앞 판에서 "승인 필요"로 남겼던 인증 중복 3건은 465~467에서 전부 처리했다.
더 줄이려면 Supabase Auth Hook으로 role을 JWT 클레임에 넣는 방식이 남는데,
대시보드 설정과 토큰 발급 변경이 필요해 코드만으로는 안 된다.

---

## 오늘 배운 것 — 왜 놓쳤나

1. **가드부터 검증한다.** `dialog-contract`가 role 문자열을 **파일 전체**에서 찾고 있었다.
   모달 *안*의 `role="status"` 안내문 하나 때문에 정작 모달이 통과했다. 초록불인데 8곳이 새고 있었다.
   → 판정 단위를 태그로 바꾸고, 일부러 깨서 실패를 확인했다.
2. **초록불이 배포 가능을 뜻하지 않는다.** tsc·테스트·design:check가 전부 통과하는데
   `next build`만 이틀째 실패하고 있었다. CI가 빌드를 안 돌았기 때문이다.
   → CI에 `next build` 추가. dev를 끄지 않고도 확인하도록 `NEXT_DIST_DIR` 스위치도 함께.
3. **데스크톱만 보면 못 본다.** 모달을 공용 클래스로 이관한 뒤 **모바일에서 다시 열어서야**
   금액이 옆 컨트롤에 가려져 `$1.53`이 `$1`로 읽히는 걸 찾았다. 잘린 게 아니라 가려진 거라 더 나빴다.
4. **예외 목록은 썩는다.** 가드 PENDING을 열어 보니 `css-defined` 5건 중 4건은 이미 쓰는 곳이 없었고,
   `ime-guard`의 1건은 그 가드가 만들어진 원인인 버그를 그대로 갖고 있었다.

## 알려진 탐지기 구멍

- 세로 깨짐: `/ci/inbox`의 "요리"·"원본"을 못 잡았다. 정사각형 아바타를 거르려는
  `height > width*1.4` 조건이나 부모-자식 구조 때문으로 보인다. 규칙 보완 필요.
- 10px 미만: `transform: scale`로 축소된 영역(`/org` 조직도 54%)을 위반으로 센다.
- 넘침 판정: `<input>`은 값이 길면 원래 내부 스크롤이 생긴다 — 폼 컨트롤은 제외해야 한다(반영함).
