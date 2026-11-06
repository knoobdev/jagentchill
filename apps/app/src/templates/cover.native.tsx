import { useEffect } from "react";
import { Image } from "react-native";

type CoverProps = { id: string; cover: string; preview: string | null; width: number; height: number; radius: number; border: string; autoPlay?: boolean; onError(): void };

/**
 * The covers of the starter templates as assets of the app: the same files the web build serves, bundled by name so
 * that a phone shows them without a network. (`packages/content/scripts/render-template-covers.mjs` writes them.)
 */
const COVERS: Record<string, number> = {
  "vlog-day": require("../../public/templates/vlog-day/cover.jpg"),
  "vlog-travel": require("../../public/templates/vlog-travel/cover.jpg"),
  "promo-product": require("../../public/templates/promo-product/cover.jpg"),
  "promo-sale": require("../../public/templates/promo-sale/cover.jpg"),
  "slideshow-memories": require("../../public/templates/slideshow-memories/cover.jpg"),
  "slideshow-story": require("../../public/templates/slideshow-story/cover.jpg"),
  "intro-channel": require("../../public/templates/intro-channel/cover.jpg"),
  "outro-end-screen": require("../../public/templates/outro-end-screen/cover.jpg"),
  "short-hook": require("../../public/templates/short-hook/cover.jpg"),
  "short-top-three": require("../../public/templates/short-top-three/cover.jpg"),
  "quote-card": require("../../public/templates/quote-card/cover.jpg"),
  "event-countdown": require("../../public/templates/event-countdown/cover.jpg"),
};

/**
 * The cover of a starter template on a phone: the bundled picture. The app has no video component on a phone yet, so
 * the preview does not play here; the cover stands for it.
 */
export function BundledCover(props: CoverProps) {
  const source = COVERS[props.id];
  const { onError } = props;
  useEffect(() => { if (source === undefined) onError(); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  if (source === undefined) return null;
  return <Image testID="template-cover" source={source} accessibilityLabel="" resizeMode="cover" onError={onError} style={{ width: props.width, height: props.height, borderRadius: props.radius, borderWidth: 1, borderColor: props.border }} />;
}
