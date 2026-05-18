import type { Verdict } from "@sus/shared";

export const colors = {
  background: "#0B0B0E",
  surface: "#17171C",
  surfaceElevated: "#23232B",
  border: "#2C2C36",
  text: "#F4F4F6",
  textMuted: "#9A9AA8",
  textDim: "#6E6E7A",
  accent: "#FFCC33",
  legit: "#22C55E",
  suspicious: "#F59E0B",
  highRisk: "#EF4444",
  unknown: "#9CA3AF",
} as const;

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

export const DISCLAIMER =
  "This is an automated assessment based on publicly available information. It is not legal or financial advice. Sus may be incorrect. Use your own judgment before purchasing.";
