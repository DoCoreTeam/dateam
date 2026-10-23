# PLAN newAX: teamda.exe 가 AVX 없는 PC 와 ARM Windows 에서도 돈다
플랜 ID: P0160
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0339
목표 버전: v0.11.64
푸시: 모음
작성: 2026-10-23
시작 커밋: 52b168af

## 목표
- Windows 용 teamda.exe 가 AVX2 없는 x64 PC 와 ARM Windows(x64 에뮬레이션)에서도 실행되고 help --json 이 맥과 같은 바이트를 낸다

## 범위 밖
- ARM64 원생 빌드(bun-windows-arm64), 에뮬레이션으로 충분
- 실제 배포(npm 게시, 내려받기 화면)

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- packages/teamda-cli 의 bun test 통과
- Parallels Windows 10 ARM VM 에서 새 teamda.exe help --json 이 종료 코드 0, 출력이 맥 바이너리 출력과 바이트 동일

## 참조
- 실측 2026-10-23: 기존 build:win(bun-windows-x64) 산출물은 Windows 10 ARM(10.0.21354) 에서 출력 0바이트, 종료 코드 255. bun-windows-x64-baseline 산출물은 종료 0, 130,184바이트, 맥 출력과 동일, 한글 6,061자

## 항목

### I01 Windows 빌드 대상을 baseline 으로
상태: 통과
모드: 경량
범위: packages/teamda-cli/package.json, packages/teamda-cli/test/build-target.test.ts (신규)
감사 기준:
- build:win 이 --target=bun-windows-x64-baseline 을 쓴다 (bun test build-target 통과, 기본 x64 로 되돌리면 실패함을 깨 봄)
- bun run build:win 산출물을 Windows 10 ARM VM 에서 help --json 실행, 종료 0, 맥 출력과 바이트 동일
- 보안: 해당 없음, 빌드 대상만 바뀜, 키 처리 코드 변경 없음
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-23) 최초 작성 (ins_0339)
