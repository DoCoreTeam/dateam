# PLAN newAX: teamda 실행 파일을 개발자센터와 CLI 에서 받는다
플랜 ID: P0167
플랜 버전: v0.2.1
상태: 진행중
지시: ins_0352
목표 버전: v0.11.87
푸시: 모음
작성: 2026-10-24
시작 커밋: 58ffa509

## 목표
- 로그인한 사람이 개발자센터 CLI 절에서 운영체제에 맞는 teamda 실행 파일을 단추 하나로 받는다
- 같은 받기 주소를 teamda release 명령으로도 받는다 (웹과 CLI 같은 정의 한 줄)
- 새 판은 스크립트 한 번으로 빌드와 압축과 업로드가 끝나고 화면은 그 판을 저절로 보인다

## 범위 밖
- 코드 서명 인증서 구입과 서명 (SmartScreen 경고는 안내 문구로만 다룸)
- GitHub Actions 자동 빌드 (저장소 비밀 등록이 필요해 다음 플랜)
- teamda 자기 갱신 명령

## 완료 정의
- pnpm typecheck, pnpm lint, pnpm test, pnpm build 통과, cli-parity 검사 통과
- 운영 버킷에 현재 코드로 빌드한 Windows x64 와 macOS arm64 x64 와 Linux x64 압축 파일과 latest.json 이 있음
- 실브라우저에서 로그인 상태로 받기 단추가 파일을 내려받고 sha256 이 latest.json 과 같음, 로그아웃 상태는 받기 대신 로그인 안내
- teamda release 가 같은 판과 받기 주소를 출력

## 참조
- supabase/migrations/250_rfp_storage.sql (비공개 버킷 선례)
- app/api/crm/attachments/[id]/url/route.ts (서명 주소 선례)
- lib/actions/defs/meta.ts, scripts/cli/gen.mjs
- packages/teamda-cli/package.json build build:win

## 항목

### I01 실행 파일 보관 버킷을 만든다
상태: 통과
모드: 경량
범위: supabase/migrations/319_cli_release_bucket.sql (신규)
감사 기준:
- 보안: 버킷 public false, storage.objects 에 이 버킷용 authenticated 나 anon 정책 0 (서버만 읽고 씀), psql 로 확인
- psql 로 storage.buckets 에 cli-release 가 file_size_limit 104857600 으로 있음
의존: 없음

### I02 받기 창구와 기능 정의 한 줄
상태: 통과
모드: 경량
범위: apps/web/lib/cli-release/manifest.ts (신규), apps/web/lib/cli-release/manifest.test.ts (신규), apps/web/app/api/cli/release/route.ts (신규), apps/web/lib/actions/defs/meta.ts, apps/web/lib/actions/generated/ (생성물), docs/cli/02-기능대응표.md, apps/web/package.json
감사 기준:
- 보안: 라우트가 getUser 로 사람을 먼저 확인하고 그 뒤에만 서비스롤로 서명 주소를 만듦, 로그인 없으면 401, 서명 주소 수명 600초, 버킷 경로는 latest.json 에서 읽고 검증한 값만 씀 (../ 와 절대 경로 거절)
- manifest.test.ts 가 정상 매니페스트 통과, 경로 탈출 거절, 필드 누락 거절을 단정하고 pnpm test 총 시험 수가 늚
- cli-parity 검사 통과, 대응표에 meta.cli.release.get 줄과 teamda release 가 있음
의존: I01

### I03 빌드와 업로드 스크립트
상태: 통과
모드: 경량
범위: packages/teamda-cli/scripts/publish.ts (신규), packages/teamda-cli/package.json, packages/teamda-cli/README.md
감사 기준:
- 보안: 서비스롤 키는 env 에서만 읽고 출력 0, 업로드 경로는 고정 형식 v버전/파일이름
- bun scripts/publish.ts --dry-run 이 네 대상 빌드와 압축과 sha256 을 출력하고 업로드는 안 함
의존: I02

### I04 개발자센터 CLI 절에 받기 단추
상태: 통과
모드: 경량
범위: apps/web/app/develop/CliDownload.tsx (신규), apps/web/app/develop/CliSection.tsx, apps/web/lib/terms/api-key.ts
감사 기준:
- 보안: 화면은 창구가 준 서명 주소만 씀, 키나 비밀 값 없음
- 불러오는 중, 로그인 필요, 아직 올린 판 없음, 실패, 목록 다섯 상태가 서로 다르게 그려짐 (U-N)
- 문구는 lib/terms 에서 가져오고 product-copy, native-dialog 가드 통과
의존: I02

### I04a teamda 올리기 스크립트가 저장소 코드를 import 하지 않는다
상태: 통과
모드: 경량
범위: packages/teamda-cli/scripts/release-spec.ts (신규), packages/teamda-cli/scripts/publish.ts, apps/web/lib/cli-release/manifest.test.ts
감사 기준:
- 보안: 올리는 경로 꼴 v버전/파일이름 과 버킷 이름이 웹 창구의 검증과 같음을 시험이 단정, 서비스롤 키 출력 0 유지
- node --experimental-strip-types --test lib/policy/ai-package-boundary.test.ts 통과 (패키지 한글 0, 저장소 import 0)
- manifest.test.ts 가 release-spec 의 대상 목록 버킷 이름 목록 파일 이름 파일 꼴을 웹 manifest 와 대조하고, 그 꼴로 만든 목록이 parseManifest 를 통과함을 단정, 대상 하나를 바꿔 깨면 실패 (S6)
- bun scripts/publish.ts --dry-run 이 네 대상 목록을 출력
의존: I03

### I05 실제 업로드와 실브라우저 CLI 확인
상태: 통과
모드: 경량
범위: 운영 버킷 cli-release (코드 변경은 결함 발견 시만)
감사 기준:
- 보안: 로그아웃 브라우저에서 창구가 401, 서명 주소는 600초 뒤 만료
- 자체 dev 서버에서 1280 과 390 으로 받기 단추가 그려지고 가로 넘침 0, 내려받은 파일 sha256 이 latest.json 과 같음
- pnpm test 전체 통과
의존: I03, I04, I04a

### I05a 맥과 윈도우에서 받은 파일이 바로 실행된다
상태: 통과
모드: 경량
범위: apps/web/lib/cli-release/install-command.ts (신규), apps/web/lib/cli-release/install-command.test.ts (신규), apps/web/app/develop/CliDownload.tsx, apps/web/lib/terms/api-key.ts, apps/web/package.json
감사 기준:
- 보안: 명령에 넣는 주소는 창구가 준 서명 주소뿐이고 셸 인용을 거침 (작은따옴표가 든 주소로도 명령이 끊기지 않음을 시험이 단정), 키나 비밀 값 없음
- install-command.test.ts 가 맥 리눅스 명령(curl -fL, tar -xzf, chmod +x)과 윈도우 명령(Invoke-WebRequest, Expand-Archive, Unblock-File)을 단정하고 pnpm test 총 수가 늚
- 이 기기 줄에 그 운영체제 명령과 복사 단추가 보이고, 복사 실패는 따로 말함 (U-N), 맥은 userAgentData 로 Apple 실리콘과 Intel 을 가름
- 맥 실기기: 복사한 명령으로 받은 teamda 가 격리 표시 없이 --help 종료 0 (브라우저로 받은 파일은 137 로 죽던 것)
의존: I05

### I05b 맥과 윈도우에서 teamda release 확인
상태: 통과
모드: 경량
범위: 없음 (결함 발견 시 packages/teamda-cli/src)
감사 기준:
- 보안: 키는 Windows 자격 증명 관리자에만 저장되고 파일 0
- Windows 가상 머신에서 I05a 의 PowerShell 명령으로 받은 teamda.exe --help 종료 0
- 맥과 Windows 에서 teamda auth login --key-file 과 teamda release 가 화면과 같은 판과 받기 주소를 출력, 시험 키는 확인 뒤 폐기
의존: I05a

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-24) 최초 작성 (ins_0352)
- v0.1.1 (2026-10-24) I03 의 publish.ts 가 apps/web/lib/cli-release/manifest.ts 를 import 해 ai-package-boundary 가 실패, 순수 계약을 패키지 안으로 옮기는 I04a 삽입 (audit:I03)
- v0.2.0 (2026-10-24) 사용자 개입: 맥과 윈도우 둘 다 잘 되게. 실측에서 브라우저로 받은 맥 실행 파일이 격리 표시로 137 종료, 운영체제별 터미널 설치 명령 I05a 와 윈도우 실기기 확인 I05b 추가 (iv_0373)
- v0.2.1 (2026-10-24) I05 의 teamda release 기준은 시험 키 발급이 필요해 I05b(맥 윈도우 둘 다)로 옮김 (audit:I05)
