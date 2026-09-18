#!/usr/bin/env node
// R46 for the API. The error bodies the API returns are keyed and live in
// apps/api/src/i18n; the same parity rules apply to them as to the screens,
// so this runs the web check's logic over the API's directory.
import { checkI18nParity } from "./check-i18n-parity.mjs";

checkI18nParity("apps/api/src/i18n");
