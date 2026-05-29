import type { Verdict } from "@sus/shared";

// Stitch-derived design system. Light-mode primary palette inspired by Material 3.
// See docs/sus-prd.md §5.1 for legally-required disclaimer wording.

export const colors = {
  // Surfaces
  background: "#F7F9FF",
  surface: "#F7F9FF",
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#F0F4FB",
  surfaceContainer: "#EAEEF5",
  surfaceContainerHigh: "#E4E8F0",
  surfaceContainerHighest: "#DEE3EA",
  surfaceDim: "#D6DAE1",

  // Foreground / text
  text: "#171C21",
  textMuted: "#464553",
  textDim: "#777585",
  border: "#DEE3EA",
  borderStrong: "#C7C4D6",
  outlineVariant: "#C7C4D6",

  // Brand
  primary: "#4241BC",
  primaryContainer: "#5B5BD6",
  onPrimary: "#FFFFFF",
  primaryFixed: "#E2DFFF",
  onPrimaryContainer: "#EDEAFF",

  // Semantic — Looks Legit (green)
  legit: "#006C49",
  legitContainer: "#6CF8BB",
  onLegitContainer: "#00714D",

  // Semantic — Suspicious (amber)
  suspicious: "#754900",
  suspiciousContainer: "#FFDDB8",
  onSuspiciousContainer: "#653E00",

  // Semantic — High Risk (red)
  highRisk: "#BA1A1A",
  highRiskContainer: "#FFDAD6",
  onHighRiskContainer: "#93000A",

  // Semantic — Not Enough Info (slate)
  unknown: "#777585",
  unknownContainer: "#DEE3EA",
  onUnknownContainer: "#464553",

  // Legacy aliases (kept so older screens don't break before they're rewritten)
  surfaceElevated: "#EAEEF5",
  accent: "#4241BC",
} as const;

// Returns the on-surface color (for text/icons drawn on white surfaces).
export function verdictColor(v: Verdict): string {
  switch (v) {
    case "Looks Legit":
      return colors.legit;
    case "Suspicious":
      return colors.suspicious;
    case "High Risk":
      return colors.highRisk;
    case "Not Enough Info":
      return colors.unknown;
  }
}

// Returns the container (background-pill) color for the verdict.
export function verdictContainerColor(v: Verdict): string {
  switch (v) {
    case "Looks Legit":
      return colors.legitContainer;
    case "Suspicious":
      return colors.suspiciousContainer;
    case "High Risk":
      return colors.highRiskContainer;
    case "Not Enough Info":
      return colors.unknownContainer;
  }
}

// Returns the foreground color used INSIDE the verdict container (text on the pill).
export function onVerdictContainerColor(v: Verdict): string {
  switch (v) {
    case "Looks Legit":
      return colors.onLegitContainer;
    case "Suspicious":
      return colors.onSuspiciousContainer;
    case "High Risk":
      return colors.onHighRiskContainer;
    case "Not Enough Info":
      return colors.onUnknownContainer;
  }
}

// Typography scale (from DESIGN.md). Use these as inline styles in StyleSheet.
export const typography = {
  displayScore: {
    fontSize: 72,
    lineHeight: 72,
    fontWeight: "700" as const,
    letterSpacing: -2.88, // -0.04em ≈ -0.04 * 72
  },
  headlineLg: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700" as const,
    letterSpacing: -0.64,
  },
  headlineLgMobile: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "700" as const,
    letterSpacing: -0.56,
  },
  headlineMd: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600" as const,
    letterSpacing: -0.24,
  },
  headlineMdMobile: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600" as const,
    letterSpacing: -0.2,
  },
  bodyLg: { fontSize: 18, lineHeight: 28, fontWeight: "400" as const },
  bodyMd: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  labelMd: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
} as const;

// 4px-based spacing scale.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

// Border radius scale.
export const radius = {
  sm: 4,
  default: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

// Fintech-style soft shadow used across cards.
export const elevation = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 2, // Android
  },
} as const;

// PRD §5.1 — legally-required disclaimer text. Must appear on every verdict card.
export const DISCLAIMER =
  "This is an automated assessment based on publicly available information. It is not legal or financial advice. Sus may be incorrect. Use your own judgment before purchasing.";
