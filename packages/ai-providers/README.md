# @ax/ai-providers

Which vendor a key belongs to, and which model can do a job. A registry, not a client — this
package never opens a socket.

## Telling providers apart by key

```ts
import { detectProviderByKey, matchesKeyPrefix } from '@ax/ai-providers'

detectProviderByKey('sk-ant-api03-...')   // claude
detectProviderByKey('sk-proj-...')        // openai
```

Matching is **longest prefix wins**. `sk-` belongs to OpenAI and `sk-ant-` to Anthropic, so a
first-match scan silently files every Anthropic key under OpenAI, and the failure shows up
later as an authentication error against the wrong vendor.

## Picking a model for a job

```ts
import { pickModels } from '@ax/ai-providers'

const pick = pickModels(models, { docClass: 'public', needMultimodal: true })
// pick.chain    — usable, first is preferred
// pick.excluded — each left-out model with a reason
```

Every exclusion carries a reason. A picker that returns only what survived cannot answer the
question people actually ask, which is "why is my model not being used" — and that question
gets asked of a support channel, not of a log.

## Vendor specs

`GEMINI` · `CLAUDE` · `OPENAI` · `GROQ` · `GROK` describe capabilities and key shape. They hold
no keys, no prices, and no statement about which vendor anyone has a contract with. Those are
facts about a company, not about calling a model, so they stay in the app.

## Tests

```bash
cd packages/ai-providers && pnpm typecheck
```
