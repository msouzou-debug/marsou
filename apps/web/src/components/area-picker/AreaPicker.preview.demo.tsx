"use client";

// Split out from AreaPicker.preview.tsx: a preview entry's default export is
// plain data read by a Server Component (`/preview/[id]/page.tsx`'s own
// `generateStaticParams`), so the file that defines it must not itself carry
// "use client" — doing so turns that default export into an opaque client
// reference when a server module imports it, and `generateStaticParams`
// receives `{}` instead of `{ id: "area-picker" }`. The interactive demo
// needs its own `useState`, so it gets its own client module instead.
import { useState } from "react";
import { AreaPicker } from "./AreaPicker";
import { INDIRECT, TREE } from "./AreaPicker.preview.fixtures";

export function AreaPickerDemo() {
  const [selected, setSelected] = useState<string[]>(["a1"]);
  return (
    <AreaPicker
      areaTree={TREE}
      selectedAreaIds={selected}
      onToggle={(id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
      indirectAreas={INDIRECT}
    />
  );
}
