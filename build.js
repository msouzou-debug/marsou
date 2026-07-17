#!/usr/bin/env node
/* Assemble the self-contained CY-DRG-Lookup.html:
   injects the vendored SheetJS library into the source template. */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const src = fs.readFileSync(path.join(root, "src", "CY-DRG-Lookup.src.html"), "utf8");
const xlsx = fs.readFileSync(path.join(root, "vendor", "xlsx.full.min.js"), "utf8");

const marker = "<!--SHEETJS-->";
if (!src.includes(marker)) {
  console.error("Marker " + marker + " not found in source template.");
  process.exit(1);
}
// function replacement: avoids String.replace treating "$&"-style
// sequences inside the minified library as substitution patterns
const out = src.replace(marker, () => "<script>\n" + xlsx + "\n</script>");
const dest = path.join(root, "CY-DRG-Lookup.html");
fs.writeFileSync(dest, out);
const kb = (fs.statSync(dest).size / 1024).toFixed(0);
console.log("Built CY-DRG-Lookup.html (" + kb + " KB)");
