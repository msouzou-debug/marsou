export function el(id){return document.getElementById(id);}

/* Wide tables must scroll inside their own box, never stretch the page — on a
   phone a single un-wrapped table pushes the whole layout sideways. Applied
   after every render so no call site can forget it. */
export function wrapWideTables(root = document.querySelector('main')) {
  if (!root) return;
  for (const table of root.querySelectorAll('table.ok')) {
    if (table.parentElement?.classList.contains('scrollx')) continue;
    const box = document.createElement('div');
    box.className = 'scrollx';
    table.replaceWith(box);
    box.appendChild(table);
  }
}
