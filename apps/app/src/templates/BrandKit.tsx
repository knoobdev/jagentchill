import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { template, uuidV4, type Commit, type CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import type { StoragePort } from "@jagentchill/storage";
import { Button, Checkbox, ConfirmDialog, EmptyState, IconButton, Input, LoadingSkeleton, Select, Skeleton, Tap, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { registerFontFaces } from "../editor/content-dom";
import { objectUrl, releaseUrl } from "../editor/dom";
import { BUNDLED_FACES } from "../editor/fonts.gen";
import { imageSize } from "../library/platform";
import { useT } from "../locale";
import { pickFiles } from "../platform/store";
import { addLogo, changeBrand, LOGO_ACCEPT, removeLogo, useBrandKit } from "./brand-store";

const FAMILIES = [...new Set(BUNDLED_FACES.filter((face) => face.family !== "Noto Color Emoji").map((face) => face.family))].sort((a, b) => a.localeCompare(b));
const ROLE_LABEL: Record<template.BrandRole, string> = { heading: "Heading", body: "Body", caption: "Caption" };

/** "Apply brand" of template mode: the kit's fonts and colours go into the draft as one undo step. Not offered while the kit is empty. */
export function ApplyBrandButton(props: { disabled: boolean; run(change: (document: ProjectDocument, context: CommitContext) => Commit | null): boolean }) {
  const t = useT();
  const toast = useToast();
  const { kit } = useBrandKit();
  if (!kit || (kit.colors.length === 0 && kit.fonts.every((font) => font.roles.length === 0))) return null;
  return <Button kind="secondary" size="sm" icon="palette" label={t("Apply brand")} testID="template-apply-brand" disabled={props.disabled} onPress={() => { if (props.run((document, context) => template.applyBrandKit(document, context, kit))) toast.show({ kind: "success", message: t("Brand applied") }); }} />;
}

function Logo(props: { storage: StoragePort; logo: template.BrandLogo; size: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null, cancelled = false;
    void props.storage.readLibraryFile(props.logo.file).then((bytes) => { if (cancelled || !bytes) return; made = objectUrl(bytes, props.logo.mime); setUrl(made); }).catch(() => undefined);
    return () => { cancelled = true; if (made) releaseUrl(made); };
  }, [props.storage, props.logo.file, props.logo.mime]);
  return url ? <Image source={{ uri: url }} accessibilityLabel="" resizeMode="contain" style={{ width: props.size, height: props.size }} /> : <View style={{ width: props.size, height: props.size }} />;
}

/**
 * The brand kit: logos, named colours and fonts with the roles Heading, Body and Caption. The Library shows it to
 * manage it; the editor's Brand kit tab shows the same kit and, with `onInsertLogo`, puts a logo on the timeline.
 */
export function BrandKitPanel(props: { onInsertLogo?(file: File): void; dense?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { storage, kit } = useBrandKit();
  const [hex, setHex] = useState("");
  const [name, setName] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [removing, setRemoving] = useState<template.BrandLogo | null>(null);
  // The families that are loaded with the engine are drawn in their own letters.
  useEffect(() => registerFontFaces(BUNDLED_FACES.filter((face) => face.load === "engine" && face.weight === 400 && face.style === "normal")), []);
  if (!kit || !storage) return <LoadingSkeleton testID="brand-skeleton"><Skeleton height={120} /></LoadingSkeleton>;
  const apply = (change: template.BrandChange) => void changeBrand(storage, change).catch((error: unknown) => toast.show({ kind: "warning", message: error instanceof template.BrandRefused ? t(error.message) : error instanceof Error ? error.message : String(error) }));
  const colour = template.brandColorValue(hex);
  const addColour = () => { if (!colour) return; apply({ kind: "add-color", id: uuidV4(), name, value: colour }); setHex(""); setName(""); };
  const importLogos = async () => {
    for (const file of await pickFiles(LOGO_ACCEPT, true)) {
      const size = await imageSize(file);
      if (!size) { toast.show({ kind: "warning", message: `${file.name}: ${t("Couldn't import this file")}` }); continue; }
      await addLogo(storage, file, size).catch((error: unknown) => toast.show({ kind: "warning", message: `${file.name}: ${error instanceof template.BrandRefused ? t(error.message) : String(error)}` }));
    }
  };
  const insert = async (logo: template.BrandLogo) => {
    const bytes = await storage.readLibraryFile(logo.file);
    if (!bytes || !props.onInsertLogo) return;
    props.onInsertLogo(new File([bytes as unknown as BlobPart], `${logo.name}.${logo.file.slice(logo.file.lastIndexOf(".") + 1)}`, { type: logo.mime }));
  };
  const heading = (title: string, count: number, limit: number) => <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}><Text variant={props.dense ? "body-medium" : "title-sm"}>{title}</Text><Text variant="meta" color="text/secondary">{`${count} / ${limit}`}</Text></View>;
  const tile = props.dense ? 64 : 96;
  return (
    <View testID="brand-kit" style={{ gap: space[4] }}>
      {template.isEmptyBrandKit(kit) ? <View testID="brand-empty"><EmptyState icon="palette" title={t("No brand kits yet")} description={t("Add your logo, colours and fonts to reuse them everywhere")} /></View> : null}

      <View testID="brand-colours" style={{ gap: space[2] }}>
        {heading(t("Colours"), kit.colors.length, template.BRAND_LIMITS.colors)}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {kit.colors.map((entry) => (
            <View key={entry.id} testID="brand-colour" {...({ dataSet: { value: entry.value } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], paddingLeft: space[1], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }}>
              <View style={{ width: 20, height: 20, borderRadius: radius.xs, backgroundColor: entry.value, borderWidth: 1, borderColor: theme.color("border/control") }} />
              <View><Text numberOfLines={1}>{entry.name || entry.value}</Text>{entry.name ? <Text variant="mono" color="text/secondary">{entry.value}</Text> : null}</View>
              <IconButton icon="x" size="xs" label={t("Remove {name}", { name: entry.name || entry.value })} onPress={() => apply({ kind: "remove-color", id: entry.id })} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          <Input accessibilityLabel={t("Colour")} mono size="sm" placeholder="#1E6BFF" maxLength={7} value={hex} style={{ width: 110 }} testID="brand-colour-hex" onChangeText={setHex} onSubmitEditing={addColour} leading={<View style={{ width: 14, height: 14, borderRadius: radius.xs, backgroundColor: colour ?? "transparent", borderWidth: 1, borderColor: theme.color("border/control") }} />} />
          <Input accessibilityLabel={t("Colour name")} size="sm" placeholder={t("Name (optional)")} maxLength={template.BRAND_LIMITS.name} value={name} style={{ width: 160 }} testID="brand-colour-name" onChangeText={setName} onSubmitEditing={addColour} />
          <Button kind="secondary" size="sm" icon="plus" label={t("Add colour")} testID="brand-colour-add" disabled={!colour || kit.colors.length >= template.BRAND_LIMITS.colors} onPress={addColour} />
        </View>
      </View>

      <View testID="brand-fonts" style={{ gap: space[2] }}>
        {heading(t("Fonts"), kit.fonts.length, template.BRAND_LIMITS.fonts)}
        {kit.fonts.map((font) => (
          <View key={font.family} testID="brand-font" {...({ dataSet: { family: font.family } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap", padding: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }}>
            <View style={{ flex: 1, minWidth: 120 }}><Text numberOfLines={1} style={{ fontFamily: `"JC ${font.family}", system-ui` } as object}>{font.family}</Text></View>
            {template.BRAND_ROLES.map((role) => <Checkbox key={role} label={t(ROLE_LABEL[role])} checked={font.roles.includes(role)} onChange={(on) => apply({ kind: "set-role", family: font.family, role, on })} />)}
            <IconButton icon="x" size="xs" label={t("Remove {name}", { name: font.family })} onPress={() => apply({ kind: "remove-font", family: font.family })} />
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          <View testID="brand-font-select"><Select label={t("Font")} width={220} placeholder={t("Choose a font")} options={FAMILIES.filter((entry) => !kit.fonts.some((font) => font.family === entry)).map((entry) => ({ value: entry, label: entry }))} value={family} onChange={setFamily} /></View>
          <Button kind="secondary" size="sm" icon="plus" label={t("Add font")} testID="brand-font-add" disabled={!family || kit.fonts.length >= template.BRAND_LIMITS.fonts} onPress={() => { if (family) apply({ kind: "add-font", family }); setFamily(null); }} />
        </View>
      </View>

      <View testID="brand-logos" style={{ gap: space[2] }}>
        {heading(t("Logos"), kit.logos.length, template.BRAND_LIMITS.logos)}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {kit.logos.map((logo) => (
            <View key={logo.id} testID="brand-logo" style={{ width: tile + space[2], gap: space[0.5] }}>
              <Tap label={props.onInsertLogo ? t("Add {name} to the timeline", { name: logo.name }) : logo.name} disabled={!props.onInsertLogo} onPress={() => void insert(logo)} style={{ alignItems: "center", justifyContent: "center", padding: space[1], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle") }}>
                <Logo storage={storage} logo={logo} size={tile} />
              </Tap>
              <View style={{ flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1, minWidth: 0 }}><Text variant="meta" numberOfLines={1}>{logo.name}</Text></View><IconButton icon="x" size="xs" label={t("Remove {name}", { name: logo.name })} onPress={() => setRemoving(logo)} /></View>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row" }}><Button kind="secondary" size="sm" icon="download" label={t("Import logo")} testID="brand-logo-import" disabled={kit.logos.length >= template.BRAND_LIMITS.logos} onPress={() => void importLogos()} /></View>
      </View>
      <ConfirmDialog open={removing !== null} title={removing ? t("Delete {name}?", { name: removing.name }) : ""} confirmLabel={t("Delete")} description={t("The logo is removed from the brand kit. Projects that already use it keep their own copy.")} onClose={() => setRemoving(null)}
        onConfirm={() => { const logo = removing; setRemoving(null); if (logo) void removeLogo(storage, logo); }} />
    </View>
  );
}
