import { useState, type ReactNode } from "react";
import { Image, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { truncateEnd, truncateMiddle } from "./logic/status.ts";
import { ProgressBar } from "./progress.tsx";
import { Tap, type ForcedState } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, opacity, radius, size, space } from "./tokens.ts";

/** The remove × of a chip, with a 44 px hit area at compact-touch density. */
function RemoveButton(props: { label: string; onPress(): void }) {
  return (
    <Tap role="button" label={props.label} onPress={props.onPress} target style={{ borderRadius: radius.full }}>
      <Icon name="x" size={12} color="text/secondary" />
    </Tap>
  );
}

export type ChipProps = {
  label: string; icon?: IconName; thumbnail?: string; size?: "sm" | "md"; tone?: "neutral" | "accent";
  /** Makes the chip interactive: hover `bg/hover`, selected `accent/subtle` with `accent/text` and a leading check. */
  onPress?(): void; selected?: boolean; onRemove?(): void; disabled?: boolean; forceState?: ForcedState; trailingIcon?: IconName; dashed?: boolean;
};

/** A pill 20 px (`sm`) or 24 px (`md`) tall. Without `onPress` it is a non-interactive label. */
export function Chip(props: ChipProps) {
  const theme = useTheme();
  const accent = props.tone === "accent" || props.selected;
  const fg = accent ? "accent/text" : props.dashed ? "text/secondary" : "text/primary";
  const body = (hovered: boolean) => ({
    height: props.size === "md" ? size.chipMd : size.chipSm, paddingHorizontal: space[2], borderRadius: radius.full, flexDirection: "row" as const, alignItems: "center" as const, gap: space[1], flexShrink: 0,
    backgroundColor: props.dashed ? "transparent" : theme.color(accent ? "accent/subtle" : hovered ? "bg/hover" : "bg/subtle"),
    borderWidth: props.dashed ? borderWidth.hairline : 0, borderStyle: "dashed" as const, borderColor: theme.color("border/control"),
  });
  const content = (
    <>
      {props.selected ? <Icon name="check" size={12} color="accent/text" /> : props.thumbnail ? <Image source={{ uri: props.thumbnail }} style={{ width: size.chipThumb, height: size.chipThumb, borderRadius: radius.full }} />
        : props.icon ? <Icon name={props.icon} size={12} color={fg} /> : null}
      <Text variant="meta" color={fg} numberOfLines={1}>{props.label}</Text>
      {props.trailingIcon ? <Icon name={props.trailingIcon} size={12} color="text/secondary" /> : null}
    </>
  );
  if (!props.onPress) {
    return (
      <View style={body(props.forceState === "hover")}>
        {content}
        {props.onRemove ? <RemoveButton label={theme.t("remove", { name: props.label })} onPress={props.onRemove} /> : null}
      </View>
    );
  }
  if (!props.onRemove) {
    return (
      <Tap role="button" label={props.label} onPress={props.onPress} disabled={props.disabled} pressedState={props.selected} forceState={props.forceState} target style={(state) => body(state.hovered || state.pressed)}>
        {content}
      </Tap>
    );
  }
  // The label and the remove × are two controls side by side inside one pill.
  return <RemovableChip {...props} body={body} content={content} />;
}
function RemovableChip(props: ChipProps & { body(hovered: boolean): object; content: ReactNode }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <View style={[props.body(hovered || props.forceState === "hover" || props.forceState === "pressed"), props.disabled ? { opacity: opacity.disabled } : null]}>
      <Tap role="button" label={props.label} onPress={props.onPress} disabled={props.disabled} pressedState={props.selected} forceState={props.forceState} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        style={{ flexDirection: "row", alignItems: "center", gap: space[1], borderRadius: radius.full, opacity: 1 }}>
        {props.content}
      </Tap>
      <RemoveButton label={theme.t("remove", { name: props.label })} onPress={props.onRemove!} />
    </View>
  );
}

/** A non-interactive chip used for labels. */
export function Tag(props: { label: string; icon?: IconName; size?: "sm" | "md" }) {
  return <Chip label={props.label} icon={props.icon} size={props.size} />;
}

/** "<field> is <value> ×". */
export function FilterChip(props: { field: string; value: string; onRemove(): void; onPress?(): void; forceState?: ForcedState; disabled?: boolean }) {
  const theme = useTheme();
  return <Chip label={`${props.field} ${theme.t("is")} ${props.value}`} onRemove={props.onRemove} onPress={props.onPress} forceState={props.forceState} disabled={props.disabled} />;
}
/** The "+ Add filter" trigger that ends a row of filter chips. */
export function AddFilterChip(props: { onPress(): void }) {
  const theme = useTheme();
  return <Chip dashed label={`+ ${theme.t("addFilter")}`} onPress={props.onPress} />;
}

/**
 * An inline chip inside a sentence: trigger conditions and @-mentions. It shows the entity icon and its name truncated at
 * 24 characters and opens the entity on press. In editable text it counts as one character (`logic/content.ts`).
 */
export function TokenChip(props: { label: string; icon?: IconName; onPress?(): void; forceState?: ForcedState }) {
  const theme = useTheme();
  const name = truncateEnd(props.label, 24);
  const style = { height: size.chipSm, paddingHorizontal: space[2], borderRadius: radius.full, backgroundColor: theme.color("accent/subtle"), flexDirection: "row" as const, alignItems: "center" as const, gap: space[1], flexShrink: 0 };
  const content = <>{props.icon ? <Icon name={props.icon} size={12} color="accent" /> : null}<Text variant="meta" color="accent/text" numberOfLines={1}>{name}</Text></>;
  return props.onPress
    ? <Tap role="link" label={props.label} onPress={props.onPress} forceState={props.forceState} style={(state) => [style, state.hovered || state.pressed ? { opacity: 0.85 } : null]}>{content}</Tap>
    : <View accessible accessibilityLabel={props.label} style={style}>{content}</View>;
}

export type Attachment = { name: string; size?: string; thumbnail?: string; icon?: IconName; status: "uploading" | "ready" | "failed"; progress?: number; error?: string };
/**
 * A file in the composer: thumbnail or file-type icon, name truncated in the middle, size, upload progress as a 2 px bottom
 * bar, and an error state with a `danger` border, an error icon and "Retry".
 */
export function AttachmentChip(props: { file: Attachment; onRemove(): void; onRetry?(): void; preview?: ReactNode }) {
  const theme = useTheme();
  const { file } = props;
  const failed = file.status === "failed";
  return (
    <View accessible accessibilityLabel={failed ? `${file.name}, ${file.error ?? theme.t("retry")}` : file.name}
      style={{ height: size.attachment, paddingStart: space[1], paddingEnd: space[1.5], borderRadius: radius.sm, borderWidth: failed ? borderWidth.focus : borderWidth.hairline, borderColor: theme.color(failed ? "danger" : "border/hairline"),
        backgroundColor: theme.color("bg/app"), flexDirection: "row", alignItems: "center", gap: space[1.5], overflow: "hidden", flexShrink: 0 }}>
      {failed ? <Icon name="warn" size={14} color="danger" />
        : props.preview ?? (file.thumbnail ? <Image source={{ uri: file.thumbnail }} style={{ width: size.attachmentThumb, height: size.attachmentThumb, borderRadius: radius.xs }} /> : <Icon name={file.icon ?? "doc"} size={14} color="text/secondary" />)}
      <Text variant="meta" numberOfLines={1}>{truncateMiddle(file.name, 24)}</Text>
      {failed ? <Text variant="meta" color="danger/text">{file.error}</Text>
        : file.status === "uploading" ? <Text variant="meta" color="text/secondary" tabular>{theme.t("percent", { n: Math.round(file.progress ?? 0) })}</Text>
        : file.size ? <Text variant="meta" color="text/secondary">{file.size}</Text> : null}
      {failed && props.onRetry ? <Tap role="button" label={theme.t("retry")} onPress={props.onRetry} target style={{ borderRadius: radius.full }}><Icon name="refresh" size={12} /></Tap> : null}
      <RemoveButton label={theme.t("remove", { name: file.name })} onPress={props.onRemove} />
      {file.status === "uploading" ? <View style={{ position: "absolute", start: 0, end: 0, bottom: 0 }}><ProgressBar thin value={file.progress ?? 0} label={file.name} /></View> : null}
    </View>
  );
}
