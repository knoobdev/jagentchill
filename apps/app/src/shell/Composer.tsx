import type { ReactNode } from "react";
import { Composer as ComposerCard } from "@jagentchill/ui";

/** The message composer of a session: the composer primitive docked to the pane, with the text field and the send button. */
export function Composer(props: { value: string; onChange(value: string): void; onSend(): void; placeholder: string; canSend: boolean; banner?: ReactNode }) {
  return <ComposerCard docked value={props.value} onChangeText={props.onChange} onSend={props.onSend} placeholder={props.placeholder} canSend={props.canSend} banner={props.banner} />;
}
