import { PixelRatio, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { Button } from "./button.tsx";
import { qrLayout, qrPath, qrSymbol, QR } from "./logic/qr.ts";
import { Skeleton } from "./progress.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { palettes, radius, size, space } from "./tokens.ts";
import type { ReactNode } from "react";

export type QRCodeProps = {
  /** The payload. It is drawn locally and exposed to assistive technology only through the controls in `children`. */
  value: string;
  /** Appended to the accessible name "QR code". */
  description: string; size?: number; logo?: ReactNode;
  state?: "ready" | "loading" | "expired"; onNewCode?(): void;
  /** The same payload in a non-visual-only form: a copyable link, a short code, or both. Always rendered with the symbol. */
  children: ReactNode;
};

/**
 * A QR symbol: black modules on a white tile in both themes, a 4-module quiet zone, radius 8, at least 160 px (220 by default,
 * 320 at most) with each module at least 3 device pixels. An expired symbol is replaced by an overlay so it cannot be scanned.
 */
export function QRCode(props: QRCodeProps) {
  const theme = useTheme();
  const state = props.state ?? "ready";
  const name = `${theme.t("qrCode")}: ${props.description}`;
  const symbol = state === "ready" ? qrSymbol(props.value, Boolean(props.logo)) : null;
  const fit = symbol ? qrLayout(symbol.count, props.size ?? size.qrDefault, PixelRatio.get()) : state === "ready" ? { error: "too-long" as const } : { size: Math.max(size.qrMin, Math.min(size.qrMax, props.size ?? size.qrDefault)), module: 0 };
  const box = "error" in fit ? Math.max(size.qrMin, Math.min(size.qrMax, props.size ?? size.qrDefault)) : fit.size;
  // The tile is not themed: the two colours are the fixed tokens `qr/tile` and `qr/module`.
  const tile = { width: box, height: box, borderRadius: radius.md, backgroundColor: palettes.light["qr/tile"], overflow: "hidden" as const, alignItems: "center" as const, justifyContent: "center" as const };
  let face: ReactNode;
  if (state === "loading") face = <Skeleton width={box} height={box} style={{ borderRadius: radius.md }} />;
  else if (state === "expired") {
    face = (
      <View style={[tile, { backgroundColor: theme.color("bg/subtle"), gap: space[2] }]}>
        <Text variant="title-sm">{theme.t("expired")}</Text>
        {props.onNewCode ? <Button size="sm" kind="secondary" label={theme.t("newCode")} onPress={props.onNewCode} /> : null}
      </View>
    );
  } else if ("error" in fit) {
    face = <View style={[tile, { backgroundColor: theme.color("bg/subtle"), padding: space[4] }]}><Text color="danger/text" align="center" role="alert">{theme.t("qrTooLong")}</Text></View>;
  } else {
    const cells = symbol!.count + 2 * QR.quietZone;
    face = (
      <View accessible accessibilityRole="image" role="img" accessibilityLabel={name} aria-label={name} testID="qr-tile" style={tile}>
        <Svg width={box} height={box} viewBox={`0 0 ${cells} ${cells}`} {...({ shapeRendering: "crispEdges" } as object)}>
          <Rect width={cells} height={cells} fill={palettes.light["qr/tile"]} />
          <Path d={qrPath(symbol!)} fill={palettes.light["qr/module"]} />
        </Svg>
        {props.logo ? <View style={{ position: "absolute", backgroundColor: palettes.light["qr/tile"], padding: space[1], borderRadius: radius.sm }}>{props.logo}</View> : null}
      </View>
    );
  }
  return (
    <View style={{ alignItems: "center", gap: space[3] }}>
      {face}
      {props.children}
    </View>
  );
}
