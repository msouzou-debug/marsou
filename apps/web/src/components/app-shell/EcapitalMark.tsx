/**
 * EcapitalMark — the eCapital mark (owner decision, 13/11/2026: direction C,
 * «Γερανός»): the e of eCapital with its bar extended as a crane jib and
 * hook, white on the ΟΚΥπΥ blue gradient, 64-unit grid, 14-unit corners.
 *
 * | Prop  | Type   | Notes                                             |
 * |-------|--------|---------------------------------------------------|
 * | size  | number | Rendered width and height in px. Default 28.       |
 * | title | string?| Accessible name; omitted = decorative (aria-hidden).|
 *
 * Inline SVG rather than an <img>, so it is crisp at every size and needs no
 * request. The files for print and documents are in brand/logo/.
 */
export function EcapitalMark({ size = 28, title }: { size?: number; title?: string }) {
  const id = `ecg-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none" }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1B75BB" />
          <stop offset="1" stopColor="#069FEC" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id})`} />
      <path d="M17 36 H41 A12 12 0 1 0 37.5 44.5" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      <path d="M41 36 H52" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      <path d="M49.5 38.5 V45.5 a3.5 3.5 0 1 1 -5.5 -1.2" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
