import qrcode from "qrcode-generator";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";

/** A QR code with dark modules on a white field in both themes and a 4-module quiet zone. */
export function Qr(props: { value: string; size?: number }) {
  const size = props.size ?? 240;
  const code = qrcode(0, "M");
  code.addData(props.value);
  code.make();
  const count = code.getModuleCount();
  const quiet = 4;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const box = count + quiet * 2;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#FFFFFF"/><path d="${path}" fill="#000000"/></svg>`;
  return <View accessibilityLabel="Pairing QR code" style={{ borderRadius: 8, overflow: "hidden" }}><SvgXml xml={xml} width={size} height={size} /></View>;
}
