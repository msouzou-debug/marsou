import type { PreviewEntry } from "@/preview/types";
import { PhotoStrip, type Photo } from "./PhotoStrip";

const photos: Photo[] = [
  { id: "1", url: "https://picsum.photos/seed/1/200", caption: "Πριν την επισκευή", timestamp: "2026-03-14T10:00:00Z" },
  {
    id: "2",
    url: "https://picsum.photos/seed/2/200",
    caption: "Μετά την επισκευή",
    timestamp: "2026-03-14T11:20:00Z",
    gps: "35.1701,33.3606",
  },
];

const entry: PreviewEntry = {
  id: "photo-strip",
  title: "PhotoStrip",
  states: {
    default: () => <PhotoStrip photos={photos} onCapture={() => {}} />,
    empty: () => <PhotoStrip photos={[]} onCapture={() => {}} />,
    loading: () => <PhotoStrip photos={[]} onCapture={() => {}} loading />,
  },
  notes: "Error/offline/noPermission belong to the work-order screen (S19/S20), not to this strip.",
};

export default entry;
