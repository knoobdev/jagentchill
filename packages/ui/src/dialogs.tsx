import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Button } from "./button.tsx";
import { Chip } from "./chips.tsx";
import { Input } from "./input.tsx";
import { filterOptions } from "./logic/lists.ts";
import { needsTypedConfirmation } from "./logic/surfaces.ts";
import { Modal } from "./overlay.tsx";
import { ProgressBar } from "./progress.tsx";
import { SearchField } from "./search.tsx";
import { Tabs, TabPanel } from "./tabs.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { Checkbox } from "./toggles.tsx";
import { borderWidth, layout, size, space } from "./tokens.ts";

/** A confirmation: ghost "Cancel", then one primary action. */
export function ConfirmDialog(props: { open: boolean; title: string; description?: string; confirmLabel: string; onConfirm(): void; onClose(): void; children?: ReactNode; busy?: boolean }) {
  const theme = useTheme();
  return (
    <Modal open={props.open} title={props.title} description={props.description} width={layout.modal.confirm} onClose={props.onClose} initialFocus='[data-testid="confirm-cancel"]'
      footer={<><Button kind="ghost" label={theme.t("cancel")} testID="confirm-cancel" onPress={props.onClose} /><Button kind="primary" label={props.confirmLabel} loading={props.busy} onPress={props.onConfirm} /></>}>
      {props.children}
    </Modal>
  );
}

/**
 * A destructive confirmation: the primary action is the `destructive` button labelled with the verb and object, initial focus
 * is on "Cancel" and Enter does not delete. Deleting more than 10 objects, or irreversibly, requires typing the word shown.
 */
export function DestructiveConfirmDialog(props: { open: boolean; title: string; description?: string; confirmLabel: string; onConfirm(): void; onClose(): void; count?: number; irreversible?: boolean; confirmWord?: string; busy?: boolean }) {
  const theme = useTheme();
  const [typed, setTyped] = useState("");
  const word = needsTypedConfirmation(props.count ?? 1, Boolean(props.irreversible)) ? props.confirmWord : undefined;
  const close = () => { setTyped(""); props.onClose(); };
  return (
    <Modal open={props.open} title={props.title} description={props.description} width={layout.modal.confirm} onClose={close} initialFocus='[data-testid="confirm-cancel"]'
      footer={<><Button kind="ghost" label={theme.t("cancel")} testID="confirm-cancel" onPress={close} /><Button kind="destructive" label={props.confirmLabel} loading={props.busy} disabled={Boolean(word) && typed.trim() !== word} onPress={() => { setTyped(""); props.onConfirm(); }} /></>}>
      {word ? (
        <View style={{ gap: space[1] }}>
          <Text variant="meta" color="text/secondary">{theme.t("typeToConfirm", { word })}</Text>
          <Input accessibilityLabel={theme.t("typeToConfirm", { word })} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} />
        </View>
      ) : null}
    </Modal>
  );
}

/** A form: closing with unsaved input asks "Discard changes?" first. */
export function FormDialog(props: { open: boolean; title: string; description?: string; submitLabel: string; onSubmit(): void; onClose(): void; dirty: boolean; children: ReactNode; busy?: boolean; canSubmit?: boolean; width?: 360 | 480 | 640 }) {
  const theme = useTheme();
  return (
    <Modal open={props.open} title={props.title} description={props.description} width={props.width ?? layout.modal.form} dirty={props.dirty} onClose={props.onClose}
      footer={<><Button kind="ghost" label={theme.t("cancel")} onPress={props.onClose} /><Button kind="primary" label={props.submitLabel} loading={props.busy} disabled={props.canSubmit === false} onPress={props.onSubmit} /></>}>
      {props.children}
    </Modal>
  );
}

export type PickerItem = { id: string; label: string; description?: string };
/** A list picker with search and checkboxes; the primary label reflects the count, e.g. "Add 3 clips". */
export function ListPickerDialog(props: { open: boolean; title: string; items: PickerItem[]; selected: string[]; onChange(selected: string[]): void; confirmLabel(count: number): string; onConfirm(): void; onClose(): void; searchLabel: string }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const shown = filterOptions(props.items, query);
  return (
    <Modal open={props.open} title={props.title} width={layout.modal.form} onClose={props.onClose}
      footer={<><Button kind="ghost" label={theme.t("cancel")} onPress={props.onClose} /><Button kind="primary" label={props.confirmLabel(props.selected.length)} disabled={props.selected.length === 0} onPress={props.onConfirm} /></>}>
      <SearchField label={props.searchLabel} value={query} onChangeText={setQuery} resultCount={query ? shown.length : null} />
      <ScrollView style={{ maxHeight: size.imageMax }}>
        {shown.length === 0 ? <Text color="text/secondary">{theme.t("noResults")}</Text> : shown.map((item) => (
          <View key={item.id} style={{ paddingVertical: space[1] }}>
            <Checkbox checked={props.selected.includes(item.id)} onChange={(checked) => props.onChange(checked ? [...props.selected, item.id] : props.selected.filter((id) => id !== item.id))}>
              <View><Text>{item.label}</Text>{item.description ? <Text variant="meta" color="text/secondary">{item.description}</Text> : null}</View>
            </Checkbox>
          </View>
        ))}
      </ScrollView>
    </Modal>
  );
}

/** A tag picker with search and "Create". */
export function TagPickerDialog(props: { open: boolean; title: string; tags: string[]; selected: string[]; onChange(selected: string[]): void; onCreate(tag: string): void; onClose(): void; doneLabel: string; searchLabel: string }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const shown = filterOptions(props.tags.map((label) => ({ label })), query).map((item) => item.label);
  const fresh = query.trim() !== "" && !props.tags.some((tag) => tag.toLowerCase() === query.trim().toLowerCase());
  return (
    <Modal open={props.open} title={props.title} width={layout.modal.form} onClose={props.onClose} footer={<Button kind="primary" label={props.doneLabel} onPress={props.onClose} />}>
      <SearchField label={props.searchLabel} value={query} onChangeText={setQuery} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {shown.map((tag) => <Chip key={tag} size="md" label={tag} selected={props.selected.includes(tag)} onPress={() => props.onChange(props.selected.includes(tag) ? props.selected.filter((item) => item !== tag) : [...props.selected, tag])} />)}
        {fresh ? <Chip size="md" dashed icon="plus" label={theme.t("create", { query: query.trim() })} onPress={() => { props.onCreate(query.trim()); setQuery(""); }} /> : null}
      </View>
    </Modal>
  );
}

/** A tabbed detail with a key–value table per tab. */
export function DetailDialog(props: { open: boolean; title: string; tabs: Array<{ id: string; label: string; rows: Array<{ key: string; value: ReactNode }> }>; onClose(): void }) {
  const theme = useTheme();
  const [tab, setTab] = useState(props.tabs[0]?.id ?? "");
  return (
    <Modal open={props.open} title={props.title} width={layout.modal.complex} onClose={props.onClose}>
      <Tabs id="detail" items={props.tabs.map((item) => ({ id: item.id, label: item.label }))} value={tab} onChange={setTab} />
      {props.tabs.map((item) => (
        <TabPanel key={item.id} group="detail" id={item.id} active={item.id === tab}>
          {item.rows.map((row) => (
            <View key={row.key} role="row" style={{ flexDirection: "row", gap: space[3], paddingVertical: space[2], borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
              <Text color="text/secondary" style={{ width: size.sliderMin * 4 }}>{row.key}</Text>
              <View style={{ flex: 1 }}>{typeof row.value === "string" ? <Text selectable>{row.value}</Text> : row.value}</View>
            </View>
          ))}
        </TabPanel>
      ))}
    </Modal>
  );
}

/** Progress of a running step: not dismissible while the step cannot be cancelled. */
export function ProgressDialog(props: { open: boolean; title: string; step?: string; value?: number | null; onCancel?(): void; onClose(): void }) {
  const theme = useTheme();
  return (
    <Modal open={props.open} title={props.title} width={layout.modal.confirm} blocking={!props.onCancel} onClose={props.onCancel ?? props.onClose}
      footer={props.onCancel ? <Button kind="ghost" label={theme.t("cancel")} onPress={props.onCancel} /> : undefined}>
      <ProgressBar value={props.value ?? null} label={props.title} />
      {props.step ? <Text variant="meta" color="text/secondary" live="polite">{props.step}</Text> : null}
    </Modal>
  );
}
