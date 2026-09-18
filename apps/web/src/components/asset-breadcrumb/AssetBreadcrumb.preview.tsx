import type { PreviewEntry } from "@/preview/types";
import { AssetBreadcrumb, type AssetBreadcrumbSegment } from "./AssetBreadcrumb";

const segments: AssetBreadcrumbSegment[] = [
  { value: "Νοσοκομείο Λευκωσίας", href: "/units/nicosia" },
  { value: "Κτίριο Α", href: "/units/nicosia/buildings/a" },
  { value: "2ος όροφος", href: "/units/nicosia/buildings/a/floors/2" },
  { value: "Θάλαμος 214", href: "/units/nicosia/buildings/a/floors/2/rooms/214" },
  { value: "Κλιματιστικό οροφής", href: "/assets/hvac-214" },
];

const entry: PreviewEntry = {
  id: "asset-breadcrumb",
  title: "AssetBreadcrumb",
  states: {
    default: () => <AssetBreadcrumb segments={segments} />,
  },
  notes:
    "Only \"default\" applies — a caller resolves the path before rendering it. " +
    "Resize below 1024px to see the middle segments collapse to «…».",
};

export default entry;
