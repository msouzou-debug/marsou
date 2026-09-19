// S13 print view — the QR back to the record (UI instructions §5 S13). Uses
// `qrcode`'s synchronous `create()` (no canvas, no async, nothing that
// depends on the DOM) to get the module matrix, then S13 draws it as an
// inline SVG itself — sized and coloured with the design tokens, never the
// package's own PNG/canvas renderer, which cannot use `--k-ink`.
import QRCode from "qrcode";

export interface QrMatrix {
  size: number;
  isDark: (row: number, col: number) => boolean;
}

export function qrMatrix(text: string): QrMatrix {
  const symbol = QRCode.create(text, { errorCorrectionLevel: "M" });
  return {
    size: symbol.modules.size,
    isDark: (row, col) => symbol.modules.get(row, col) === 1,
  };
}
