// Mirrors the grading logic in the HTML prototype exactly, so the backend and
// the existing prototype agree on every computed number.

export const SUBLEVELS = ['EE1', 'EE2', 'ME1', 'ME2', 'AE1', 'AE2', 'BE1', 'BE2'];

export const SUBLEVEL_POINTS = {
  EE1: 8, EE2: 7, ME1: 6, ME2: 5, AE1: 4, AE2: 3, BE1: 2, BE2: 1,
};

// Default percentage bands — same defaults shipped in the prototype.
// Flagged there and here: these are a reasonable default, not confirmed
// against Ndovoini Center's actual conversion table yet.
export const PERCENT_BANDS = [
  { min: 80, max: 100, sublevel: 'EE1' },
  { min: 70, max: 79, sublevel: 'EE2' },
  { min: 60, max: 69, sublevel: 'ME1' },
  { min: 50, max: 59, sublevel: 'ME2' },
  { min: 40, max: 49, sublevel: 'AE1' },
  { min: 30, max: 39, sublevel: 'AE2' },
  { min: 20, max: 29, sublevel: 'BE1' },
  { min: 0, max: 19, sublevel: 'BE2' },
];

export function levelOf(sublevel) {
  return sublevel.slice(0, 2);
}

export function pointsToLevel(points) {
  const rounded = Math.max(1, Math.min(8, Math.round(points)));
  if (rounded >= 7) return 'EE';
  if (rounded >= 5) return 'ME';
  if (rounded >= 3) return 'AE';
  return 'BE';
}

export function percentToSublevel(pct) {
  const clamped = Math.max(0, Math.min(100, Number(pct)));
  const band = PERCENT_BANDS.find((b) => clamped >= b.min && clamped <= b.max);
  return band ? band.sublevel : 'BE2';
}

export function isValidSublevel(sl) {
  return SUBLEVELS.includes(sl);
}
