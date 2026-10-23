## 무엇을 바꿨나

-

## CLI 대응 (필수, 하나라도 비면 병합하지 않음)

- [ ] 새 동작이나 바뀐 동작이 기능 정의(apps/web/lib/actions/defs/)에 있음
- [ ] CLI 명령 확인: `teamda help --json` 에 그 명령이 보임
- [ ] 대응표 갱신: docs/cli/02-기능대응표.md (node --experimental-strip-types scripts/cli/gen.mjs)
- [ ] 웹=CLI 시험 추가 또는 기존 시험이 덮음 (apps/web/lib/actions/parity.test.ts)

## 확인

- [ ] pnpm typecheck
- [ ] pnpm test
