// Maps manual Markdown to the HelpDrawer's reading typography (UI
// instructions §5 S25: 16px/1.6 body, 20px headings). HelpDrawer's content
// wrapper already sets `text-fs-16 leading-[1.6]` on the body and
// `[&_h2]:text-fs-20 [&_h3]:text-fs-20` on headings, so the manual's `#`
// (section title, "the drawer title" per the section — same 20px as the
// drawer's own header) renders as an `h2`, and its `##` sub-headings
// ("Βήματα", "Τι μπορεί να πάει λάθος") render as `h3`; both land on the
// existing 20px rule with no extra classes needed here. `react-markdown`
// never renders raw HTML from the source (no `rehype-raw` is wired in), so
// this is Markdown-only, as required.
import type { Components } from "react-markdown";

// react-markdown always passes a `node` prop (the hast node) to component
// overrides, which must not reach the DOM element itself.
function withoutNode<P extends { node?: unknown }>({ node, ...rest }: P) {
  void node;
  return rest;
}

export const helpMarkdownComponents: Components = {
  h1: (props) => <h2 className="mb-s-3 font-bold" {...withoutNode(props)} />,
  h2: (props) => <h3 className="mb-s-2 mt-s-5 font-bold" {...withoutNode(props)} />,
  h3: (props) => <h3 className="mb-s-2 mt-s-4 font-bold" {...withoutNode(props)} />,
  p: (props) => <p className="mb-s-3" {...withoutNode(props)} />,
  ol: (props) => <ol className="mb-s-3 list-decimal space-y-s-1 pl-s-5" {...withoutNode(props)} />,
  ul: (props) => <ul className="mb-s-3 list-disc space-y-s-1 pl-s-5" {...withoutNode(props)} />,
  li: (props) => <li {...withoutNode(props)} />,
  strong: (props) => <strong className="font-bold" {...withoutNode(props)} />,
  a: (props) => <a className="text-k-blue underline-offset-2 hover:underline" {...withoutNode(props)} />,
};
