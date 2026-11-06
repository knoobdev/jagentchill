import { View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Button, type ButtonKind } from "./button.tsx";
import { errorDetails, errorMessage } from "./logic/content.ts";
import { copyText } from "./platform/dom";
import { Text } from "./text.tsx";
import { useHostGate, useTheme } from "./theme.tsx";
import { useToast } from "./toast.tsx";
import { TOAST } from "./logic/toast.ts";
import { size, space } from "./tokens.ts";

export type EmptyAction = { label: string; onPress(): void; kind?: ButtonKind };
/** A 32 px outline icon, a title, a one- or two-line description and up to two actions, centred with a maximum width of 320 px. */
export function EmptyState(props: { icon: IconName; title: string; description?: string; actions?: EmptyAction[] }) {
  return (
    <View style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: space[4] }}>
      <View style={{ alignItems: "center", gap: space[1], maxWidth: size.emptyMax }}>
        <Icon name={props.icon} size={32} color="text/secondary" />
        <Text variant="title-sm" level={2} align="center">{props.title}</Text>
        {props.description ? <Text color="text/secondary" align="center" numberOfLines={2}>{props.description}</Text> : null}
        {props.actions?.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[2], marginTop: space[2] }}>
            {props.actions.slice(0, 2).map((action) => <Button key={action.label} size="sm" kind={action.kind ?? "secondary"} label={action.label} onPress={action.onPress} />)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** First use: says what the area is for and offers the creating action. */
export function FirstUseState(props: { icon: IconName; title: string; description: string; action?: EmptyAction }) {
  return <EmptyState icon={props.icon} title={props.title} description={props.description} actions={props.action ? [{ kind: "strong", ...props.action }] : undefined} />;
}

/** No results: names the active query or filter and offers to clear it. */
export function NoResultsState(props: { query: string; description?: string; onClear(): void; title?: string }) {
  const theme = useTheme();
  return <EmptyState icon="search" title={props.title ?? theme.t("noResultsFor", { query: props.query })} description={props.description} actions={[{ label: theme.t("clearSearch"), onPress: props.onClear }]} />;
}

export type ErrorInfo = { code: string; message: string; request: string; at_ms: number; context?: Record<string, unknown> };
/**
 * An error: the message is the localised string of the error code — or "Something went wrong (<code>)" — never raw exception
 * text. Offers "Retry" and "Copy details".
 */
export function ErrorState(props: { title: string; error: ErrorInfo; resolve(code: string): string | undefined | null; onRetry(): void }) {
  const theme = useTheme();
  const toast = useToast();
  return (
    <EmptyState icon="warn" title={props.title} description={errorMessage(props.error.code, props.resolve, theme.t)}
      actions={[{ label: theme.t("retry"), onPress: props.onRetry }, { label: theme.t("copyDetails"), kind: "ghost", onPress: () => { void copyText(errorDetails(props.error)).then(() => toast.show({ kind: "info", message: theme.t("copied"), duration: TOAST.confirmation })); } }]} />
  );
}

/**
 * Shown by any screen or sheet that needs a connected host when none is connected: it names the feature, reads "Requires a
 * host" and offers "Connect a host", which opens the pairing flow.
 */
export function RequiresHostState(props: { feature: string; description?: string; onConnect?(): void }) {
  const theme = useTheme();
  const gate = useHostGate();
  return (
    <EmptyState icon="device" title={props.feature} description={props.description ? `${theme.t("requiresHost")}. ${props.description}` : theme.t("requiresHost")}
      actions={[{ label: theme.t("connectHost"), kind: "primary", onPress: () => (props.onConnect ? props.onConnect() : gate.onRequiresHost(props.feature)) }]} />
  );
}
