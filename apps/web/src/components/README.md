# Components

One folder per component, kebab-case, matching the ids in UI instructions §4.

```
src/components/rag-chip/
  RagChip.tsx          # the component; props table in the header comment
  RagChip.test.tsx     # unit tests on behaviour and business rules
  RagChip.preview.tsx  # default export: PreviewEntry with the five states
  index.ts             # export { RagChip } from "./RagChip"
```

Then add the preview entry to `src/preview/registry.ts`. See `/CONVENTIONS.md` at the repo root for the rules.
