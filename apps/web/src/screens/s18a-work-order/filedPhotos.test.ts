import { describe, expect, it } from "vitest";
import { buildWorkOrderEvent } from "@/mocks/maintenance";
import { filedPhotos } from "./filedPhotos";

describe("filedPhotos", () => {
  const events = [
    buildWorkOrderEvent(),
    buildWorkOrderEvent({ id: "e-img", kind: "PHOTO", documentId: "d-img", documentTitle: "Πίνακας", documentMime: "image/png" }),
    buildWorkOrderEvent({ id: "e-pdf", kind: "PHOTO", documentId: "d-pdf", documentTitle: "Έκθεση", documentMime: "application/pdf" }),
    buildWorkOrderEvent({ id: "e-old", kind: "PHOTO", documentId: "d-old", documentTitle: "Παλιό", documentMime: null }),
  ];

  it("puts images in the strip through the content route and the rest in the list", () => {
    const { images, others } = filedPhotos(events);
    expect(images).toEqual([
      { id: "e-img", url: "/api/proxy/documents/d-img/content", caption: "Πίνακας", timestamp: events[1]!.at },
    ]);
    expect(others.map((e) => e.id)).toEqual(["e-pdf", "e-old"]);
  });

  // RULE: a photo the session already shows from the file is not shown twice.
  it("leaves out a filed image this session already shows", () => {
    const local = [{ id: "l-1", url: "blob:x", timestamp: new Date(), documentId: "d-img" }];
    expect(filedPhotos(events, local).images).toEqual([]);
  });
});
