/*
 * Συνθετικά δεδομένα ελέγχου. Τα δείγματα-άγκυρες από τις προδιαγραφές:
 *  - F1054 Ιανουάριος: pos 1260.42, posAe 734.31, over15 223.85 → excess ≈ 313.38, impact ≈ −613.054 €
 *  - F1047 Μάρτιος: excess 194.1 → impact ≈ −506.994 €
 *  - Μάιος: έκπτωση 0% → impact 0, αλλά F1054 excess 48.1
 * (Οι μηνιαίες συμφωνημένες: F1054 5239/12, F1047 1519/12 κ.λπ.)
 */
'use strict';

// pos/posAe/neg/negAe ανά νοσηλευτήριο × μήνα (μονάδες ACW).
const MONTH_INPUTS = {
  1: {
    F1054: { pos: 1260.42, posAe: 734.31, neg: -8.4, negAe: -2.1 },
    F1050: { pos: 260, posAe: 60, neg: -3.2, negAe: 0 },
    F1047: { pos: 150, posAe: 40, neg: 0, negAe: 0 },
    F1048: { pos: 30, posAe: 5, neg: 0, negAe: 0 },
    F1049: { pos: 6, posAe: 1, neg: 0, negAe: 0 },
    F1025: { pos: 10, posAe: 2, neg: 0, negAe: 0 },   // amber: posAe>0, over15=0
    F1026: { pos: 1.2, posAe: 0, neg: 0, negAe: 0 },
    F1055: { pos: 0.9, posAe: 0, neg: 0, negAe: 0 }
  },
  2: {
    F1054: { pos: 500, posAe: 50, neg: -5, negAe: -1 },
    F1050: { pos: 100, posAe: 10, neg: 0, negAe: 0 },
    F1047: { pos: 50, posAe: 5, neg: 0, negAe: 0 },
    F1048: { pos: 10, posAe: 0, neg: 0, negAe: 0 },
    F1049: { pos: 3, posAe: 0, neg: 0, negAe: 0 },
    F1025: { pos: 5, posAe: 0, neg: 0, negAe: 0 },
    F1026: { pos: 0.3, posAe: 0, neg: 0, negAe: 0 },
    F1055: { pos: 0, posAe: 0, neg: 0, negAe: 0 }
  },
  3: {
    // excess F1047 = pos − posAe + over15 − 1519/12 = 355.68333… − 80 + 45 − 126.58333… = 194.1
    F1054: { pos: 400, posAe: 30, neg: -2, negAe: 0 },
    F1050: { pos: 120, posAe: 20, neg: 0, negAe: 0 },
    F1047: { pos: 355.6833333333333, posAe: 80, neg: -1.5, negAe: -0.5 },
    F1048: { pos: 12, posAe: 2, neg: 0, negAe: 0 },
    F1049: { pos: 2, posAe: 0, neg: 0, negAe: 0 },
    F1025: { pos: 6, posAe: 1, neg: 0, negAe: 0 },
    F1026: { pos: 0.2, posAe: 0, neg: 0, negAe: 0 },
    F1055: { pos: 0, posAe: 0, neg: 0, negAe: 0 }
  },
  4: {
    F1054: { pos: 600, posAe: 100, neg: -4, negAe: -1.2 },
    F1050: { pos: 90, posAe: 15, neg: 0, negAe: 0 },
    F1047: { pos: 60, posAe: 10, neg: 0, negAe: 0 },
    F1048: { pos: 8, posAe: 1, neg: 0, negAe: 0 },
    F1049: { pos: 1, posAe: 0, neg: 0, negAe: 0 },
    F1025: { pos: 4, posAe: 0, neg: 0, negAe: 0 },
    F1026: { pos: 0.1, posAe: 0, neg: 0, negAe: 0 },
    F1055: { pos: 0, posAe: 0, neg: 0, negAe: 0 }
  },
  5: {
    // excess F1054 = 544.68333… − 120 + 60 − 5239/12 = 48.1
    F1054: { pos: 544.6833333333333, posAe: 120, neg: -6, negAe: -2 },
    F1050: { pos: 150, posAe: 25, neg: 0, negAe: 0 },
    F1047: { pos: 70, posAe: 12, neg: 0, negAe: 0 },
    F1048: { pos: 15, posAe: 3, neg: 0, negAe: 0 },
    F1049: { pos: 2, posAe: 0, neg: 0, negAe: 0 },
    F1025: { pos: 7, posAe: 1, neg: 0, negAe: 0 },
    F1026: { pos: 0.4, posAe: 0, neg: 0, negAe: 0 },
    F1055: { pos: 0, posAe: 0, neg: 0, negAe: 0 }
  }
};

// Μονάδες ΤΑΕΠ >15% ανά μήνα (αρχεία Conso) — οι μήνες 2 και 4 δεν έχουν αρχείο.
const CONSO = {
  1: { F1054: 223.85, F1050: 20, F1047: 10, F1048: 2 },
  3: { F1047: 45, F1054: 15 },
  5: { F1054: 60, F1050: 8 }
};

const DISCOUNTS = { 1: -0.4032, 2: -0.4509, 3: -0.6031, 4: -0.4877, 5: 0 };

const CONSO_B1 = {
  1: 'ΙΑΝΟΥΑΡΙΟΣ 2026',
  3: 'ΜΑΡΤΙΟΣ 2026',
  5: 'ΜΑΪΟΣ 2026'
};

module.exports = { MONTH_INPUTS, CONSO, DISCOUNTS, CONSO_B1 };
