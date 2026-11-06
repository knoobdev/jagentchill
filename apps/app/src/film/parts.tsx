import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, View } from "react-native";
import { Icon, Spinner, Text, radius, space, useTheme, type ColorToken } from "@jagentchill/ui";
import { useBlobUri } from "../prompt-video/data";

/** A picture of the film from the host's blob store; the checkerboard-free empty state is the neutral fill with an icon. */
export function Picture(props: { blobId?: string | null; ratio: number; testID?: string; busy?: boolean; selected?: boolean; children?: ReactNode; height?: number }) {
  const theme = useTheme(), uri = useBlobUri(props.blobId ?? undefined);
  return (
    <View testID={props.testID} {...({ dataSet: { loaded: uri ? "1" : "0", blob: props.blobId ?? "" } } as object)}
      style={[{ aspectRatio: props.ratio, borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }, props.height ? { height: props.height } : { width: "100%" }]}>
      {uri ? <Image source={{ uri }} resizeMode="cover" style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, width: "100%", height: "100%" }} /> : props.blobId || props.busy ? null : <Icon name="image" size="md" color="text/tertiary" />}
      {props.busy || (props.blobId && !uri) ? <Spinner size={16} /> : null}
      {props.children}
    </View>
  );
}

const TONES = {
  success: ["success/subtle", "success/text"], warning: ["warning/subtle", "warning/text"], purple: ["purple/subtle", "purple/text"], danger: ["danger/subtle", "danger/text"], neutral: ["bg/subtle", "text/secondary"], accent: ["accent/subtle", "accent/text"],
} as const satisfies Record<string, [ColorToken, ColorToken]>;
export type PillTone = keyof typeof TONES;
/** The 20 px state pill of a card: a dot and a word. */
export function Pill(props: { tone: PillTone; label: string; testID?: string; busy?: boolean }) {
  const theme = useTheme(), [fill, ink] = TONES[props.tone];
  return (
    <View testID={props.testID} {...({ dataSet: { tone: props.tone } } as object)} style={{ height: 20, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], borderRadius: radius.full, backgroundColor: theme.color(fill) }}>
      {props.busy ? <Spinner size={12} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color(ink) }} />}
      <Text variant="meta" color={ink} numberOfLines={1}>{props.label}</Text>
    </View>
  );
}
/** A small number or letter in a square, over a picture. */
export function Corner(props: { label: string; end?: boolean; tone?: "accent" }) {
  const theme = useTheme();
  return (
    <View style={[{ position: "absolute", paddingHorizontal: 5, minWidth: 18, height: 18, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(props.tone === "accent" ? "accent" : "clip/label-scrim") }, props.end ? { bottom: space[1], end: space[1] } : { top: space[1], start: space[1] }]}>
      <Text variant="meta" color={props.tone === "accent" ? "text/on-accent" : "clip/label"} tabular>{props.label}</Text>
    </View>
  );
}
export const Caption = (props: { children: string }) => <Text variant="meta" color="text/secondary">{props.children}</Text>;
export const Field = (props: { label: string; children: ReactNode; grow?: boolean }) => <View style={[{ gap: space[1] }, props.grow ? { flex: 1, minWidth: 160 } : null]}><Caption>{props.label}</Caption>{props.children}</View>;

type Sound = { play(): Promise<void>; pause(): void; currentTime: number; duration: number; onended: (() => void) | null; ontimeupdate: (() => void) | null };
/** Whether this platform can play a take: the browser's audio element. */
export const CAN_PLAY = typeof (globalThis as { Audio?: unknown }).Audio === "function";
/** Plays one audio blob of the host at a time. */
export function usePlayer(): { playing: string | null; position: number; toggle(blobId: string): void; stop(): void } {
  const [wanted, setWanted] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const uri = useBlobUri(wanted ?? undefined, "audio/wav");
  const sound = useRef<Sound | null>(null);
  const stop = useCallback(() => { sound.current?.pause(); sound.current = null; setPlaying(null); setWanted(null); setPosition(0); }, []);
  useEffect(() => {
    if (!uri || !wanted || !CAN_PLAY) return;
    const made = new (globalThis as unknown as { Audio: new (src: string) => Sound }).Audio(uri);
    sound.current = made;
    made.onended = () => { setPlaying(null); setWanted(null); setPosition(0); };
    made.ontimeupdate = () => setPosition(made.currentTime);
    setPlaying(wanted);
    void made.play().catch(() => { setPlaying(null); setWanted(null); });
    return () => { made.onended = null; made.ontimeupdate = null; made.pause(); };
  }, [uri, wanted]);
  useEffect(() => stop, [stop]);
  return { playing, position, toggle: (blobId) => { if (wanted === blobId) stop(); else { sound.current?.pause(); setPosition(0); setPlaying(null); setWanted(blobId); } }, stop };
}
