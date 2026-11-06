import { createElement } from "react";
import { View } from "react-native";
import { Spinner, radius, useTheme } from "@jagentchill/ui";
import { useBlobUri } from "../prompt-video/data";

/** A shot's clip, played from the host's blob store by the browser's own video element (no sound: a film's voices and music are its own). */
export function ClipPreview(props: { blobId: string; stillBlobId?: string | null; ratio: number; height: number; label: string; testID?: string }) {
  const theme = useTheme(), uri = useBlobUri(props.blobId, "video/mp4");
  return (
    <View testID={props.testID} {...({ dataSet: { loaded: uri ? "1" : "0", blob: props.blobId } } as object)} style={{ height: props.height, width: Math.round(props.height * props.ratio), alignSelf: "flex-start", borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}>
      {uri ? createElement("video", { src: uri, controls: true, muted: true, loop: true, playsInline: true, "aria-label": props.label, style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } }) : <Spinner size={16} />}
    </View>
  );
}
