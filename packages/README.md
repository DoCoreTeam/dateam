# The AI layer

Four packages that hold everything general about calling a model, so the product above them
holds only what is specific to the product.

| Package | What it owns |
|---|---|
| `@ax/ai-core` | The contract. What a result must carry, how its version climbs, who may read which field. |
| `@ax/ai-gateway` | The way out. Masking and un-masking personal data, the transfer record, fallback, cost. |
| `@ax/ai-providers` | The vendor registry. Which provider a key belongs to, which model can do the job. |
| `@ax/ai-react` | Drawing a result. Confidence, evidence, the trail of human corrections. |

They depend downward only: `ai-react` and `ai-gateway` use `ai-core`; `ai-core` and
`ai-providers` use nothing. Nothing here imports the app.

## Why they are separate packages

Because a boundary that is only a convention is not a boundary. Before this split, the rule
"a shared component carries no product wording" was written in a comment, and twenty-eight
screens had each grown their own way of drawing the same confidence number. A package cannot
reach into the app by accident: if a component needs a Korean label, the type makes the caller
pass it, and there is no other way in.

The same reasoning applies to the gateway. "Mask personal data before sending it" was a
sentence in a document; measured on 2026-09-16, thirty-four call sites sent text directly to
a vendor and **none** of them masked anything or recorded that the text had left. Moving the
call into a package meant the masking could not be skipped by forgetting it.

## What this layer will not take

- **Product wording.** Every string a user reads comes from the caller. See `ai-react/labels`.
- **Our company's facts.** Model prices, key locations, which vendor we have a contract with,
  what a "deal" is. Those live in the app.
- **Storage.** The gateway writes through a `GatewayStore` the caller supplies. It does not
  know what a database is.
- **Thresholds that are product decisions.** `LOW_CONFIDENCE_BELOW` is a default, not a rule;
  three different numbers are in use across this product and each screen passes its own.

## Adding it to a service

1. **Install.** Inside this repository the four are workspace packages, so
   `"@ax/ai-core": "workspace:*"` in the consumer's `package.json` is enough. Outside it,
   publish to a private registry first — see *Publishing* below.

2. **Transpile them.** These packages ship TypeScript source, not a build. A bundler has to
   compile them. In Next.js:

   ```js
   // next.config.js
   transpilePackages: ['@ax/ai-core', '@ax/ai-gateway', '@ax/ai-providers', '@ax/ai-react'],
   ```

   Source rather than a `dist` is deliberate: the modules import each other with explicit
   `.ts` specifiers so `node --test --experimental-strip-types` can run the rules directly.
   A build step would rewrite those specifiers and the rules would stop being testable
   without a build.

3. **Give the gateway a place to write.** Implement `GatewayStore` over whatever the service
   already uses for storage. The gateway records two things: that a call happened, and that
   text left the building.

4. **Give the components words.** Build one `AiLabels` object for the service's language and
   pass it to every component. `missingLabels()` tells you at runtime if it is incomplete;
   there is no English default, on purpose.

5. **Stamp the contract version on write.** `AI_CONTRACT_VERSION` goes into the row when it is
   first written. On read, `climb()` moves an older row forward one rung at a time. Never
   default a missing version to `1` — a row with no version is a row nobody stamped, and
   guessing hides the bug that failed to stamp it.

## Publishing

`private` is off and `publishConfig.access` is `restricted`, so a publish will not
accidentally reach the public registry. To release inside an organisation:

```jsonc
// in each package.json
"publishConfig": {
  "access": "restricted",
  "registry": "https://your-registry.example.com"   // add this line
}
```

The `@ax` scope is a placeholder. Renaming it is a rename in five places: the four
`package.json` names, and the consumer's imports.

## Checking it

```bash
pnpm typecheck:packages     # every package, including its tests
pnpm --filter web test      # the rules, plus the guards that keep the boundary
```

The boundary itself is guarded. `lib/policy/ai-package-boundary.test.ts` fails if a package
gains a Korean string or an import that points at the app; `lib/policy/package-release-guard.test.ts`
fails if a package loses the metadata a consumer needs.
