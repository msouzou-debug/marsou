/* ---------- state ----------
   Additive: files can be dropped in at any time and the dashboard re-renders.
   Exposed as window.OKYPY.state — the headless test harness asserts against it. */
export const state={stats:null,report:null,reportFiles:new Set(),isRows:[],isFiles:new Set(),allae:[],aeFiles:new Set(),osClaims:new Map(),osFiles:new Set(),osCodes:new Set(),unknown:[]};
