// S16 (lite) — the loading state (UI instructions §6): skeleton blocks in the
// shape of the content, not a spinner, because the tree is fetched on the
// server and the wait is a network round trip rather than a click.
export default function Loading() {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <div className="mb-s-6">
        <div className="h-3 w-[80px] rounded-k bg-k-grey" />
        <div className="mt-s-2 h-6 w-[280px] rounded-k bg-k-grey" />
      </div>
      <div className="h-4 w-[220px] rounded-k bg-k-grey" />
      <div className="mt-s-6 rounded-k border border-k-grey p-s-4">
        <div className="h-5 w-[240px] rounded-k bg-k-grey" />
        {[0, 1].map((floor) => (
          <div key={floor} className="mt-s-4 border-l border-k-grey pl-s-4">
            <div className="h-4 w-[140px] rounded-k bg-k-grey" />
            <div className="mt-s-2 flex flex-col gap-s-2 border-l border-k-grey pl-s-4">
              {[0, 1, 2].map((area) => (
                <div key={area} className="h-4 w-[200px] rounded-k bg-k-grey" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
