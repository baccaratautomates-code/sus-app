import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import type { ScanResponse, Verdict } from "@sus/shared";
import { ScanThumbnail } from "./ScanThumbnail";
import { colors, elevation, radius, spacing, typography } from "../theme";
import type { RecentScan } from "../store";

// Shared scan card used by both History and Home's recent-scans list so they
// look identical: product photo, verdict chip + source host, product name, and
// a verdict-colored trust score. In select mode it shows a leading checkbox.
export function ScanCard({
  scan,
  selectMode = false,
  selected = false,
  onPress,
  onLongPress,
}: {
  scan: RecentScan;
  selectMode?: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const meta = verdictMeta(scan.verdict);
  const score =
    scan.verdict === "Not Enough Info"
      ? "—"
      : String(scan.response?.trust_score ?? "—");

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        { opacity: pressed ? 0.9 : 1 },
      ]}
    >
      {selectMode && (
        <MaterialIcons
          name={selected ? "check-circle" : "radio-button-unchecked"}
          size={22}
          color={selected ? colors.primary : colors.textDim}
          style={styles.checkbox}
        />
      )}
      <ScanThumbnail thumbnailUrl={scan.thumbnailUrl} url={scan.product_name} />
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <View style={[styles.chip, { backgroundColor: meta.chipBg }]}>
            <Text style={[styles.chipText, { color: meta.chipText }]}>
              {meta.label}
            </Text>
          </View>
          <Text style={styles.sourceLabel} numberOfLines={1}>
            {sourceLabel(scan.product_name)}
          </Text>
        </View>
        <Text style={styles.productName} numberOfLines={2}>
          {productName(scan)}
        </Text>
      </View>
      <View style={styles.scoreBlock}>
        <Text style={[styles.score, { color: meta.score }]}>{score}</Text>
        <Text style={styles.scoreLabel}>TRUST SCORE</Text>
      </View>
    </Pressable>
  );
}

function verdictMeta(v: Verdict): {
  label: string;
  chipBg: string;
  chipText: string;
  score: string;
} {
  switch (v) {
    case "Looks Legit":
      return { label: "LEGIT", chipBg: colors.legitContainer, chipText: colors.onLegitContainer, score: colors.legit };
    case "Suspicious":
      return { label: "SUSPICIOUS", chipBg: colors.suspiciousContainer, chipText: colors.onSuspiciousContainer, score: colors.suspicious };
    case "High Risk":
      return { label: "HIGH RISK", chipBg: colors.highRiskContainer, chipText: colors.onHighRiskContainer, score: colors.highRisk };
    default:
      return { label: "NOT ENOUGH INFO", chipBg: colors.unknownContainer, chipText: colors.onUnknownContainer, score: colors.unknown };
  }
}

// The "source" line — the merchant/host the listing lives on, from the URL.
function sourceLabel(target: string): string {
  try {
    const withScheme = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    return new URL(withScheme).hostname.replace(/^www\./i, "");
  } catch {
    return target;
  }
}

// Human-readable product name. product_name is the raw URL, so mine the stored
// response's source titles (e.g. "Lazada listing: UGREEN Pouch Bag") for a real
// title; fall back to the host.
function productName(scan: RecentScan): string {
  return extractTitle(scan.response) ?? sourceLabel(scan.product_name);
}

function extractTitle(response: ScanResponse | undefined): string | null {
  const sources = response?.sources ?? [];
  const ordered = [...sources].sort(
    (a, b) =>
      (b.signal_type === "price_sanity" ? 1 : 0) -
      (a.signal_type === "price_sanity" ? 1 : 0),
  );
  for (const s of ordered) {
    const t = cleanTitle(s.title);
    if (t) return t;
  }
  return null;
}

function cleanTitle(raw: string | undefined): string | null {
  if (!raw) return null;
  const colon = raw.indexOf(": ");
  const t = (colon >= 0 ? raw.slice(colon + 2) : raw).trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return null;
  if (/no title|no name|unknown/i.test(t)) return null;
  if (/^(lazada|shopee|tiktok|temu|amazon|ebay|instagram|facebook)\b.*\b(listing|seller|shop|product|profile)\b/i.test(t)) {
    return null;
  }
  return t;
}

const CARD_BG = "#F3F1FB"; // light lavender — reads as a card on a white bg

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    ...elevation.card,
  },
  cardSelected: {
    backgroundColor: colors.primaryFixed,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  checkbox: { marginRight: spacing.xs },
  cardBody: { flex: 1, gap: 6 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  chipText: {
    fontSize: 10,
    fontWeight: "800",
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.4,
  },
  sourceLabel: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  productName: { ...typography.bodyMd, color: colors.text },
  scoreBlock: { alignItems: "flex-end", minWidth: 64 },
  score: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  scoreLabel: {
    fontSize: 8,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: colors.textDim,
    letterSpacing: 0.6,
  },
});
