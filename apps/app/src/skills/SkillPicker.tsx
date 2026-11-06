import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { ScrollView, View } from "react-native";
import { preference } from "@jagentchill/app-core";
import { SKILL_LIMITS, type SkillRecord } from "@jagentchill/protocol";
import { Badge, Button, Icon, IconButton, Input, Popover, Tap, Text, radius, space, useTheme, useToast, type ComposerPill } from "@jagentchill/ui";
import { hostSettingsRoute } from "../agents/ModelBrowser";
import { useHost, type Session } from "../host";
import { useT } from "../locale";
import { usePref } from "../state";
import { skillReason, useSkills } from "./data";

/** Skills pinned in the picker on this device; never shared with the host or another device. */
const PINNED = preference<string[]>("skills.picker.pinned", [], (value): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string"));

/**
 * The Skills control of a session's composer: which skills are attached, the picker that changes them, and the line
 * that names them in front of a message. The attachment lives on the host, so it follows the session to other devices.
 */
export function useSkillPicker(session: Session | undefined, anchor: RefObject<View | null>, draft?: { skillIds: string[]; onChange(skillIds: string[]): void; runtimeId?: string }): { pill: ComposerPill | null; overlay: ReactNode; apply(sessionKey: string): Promise<void>; prepare(text: string, sessionKey?: string): Promise<string> } {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { connection, host, status, role, can } = useHost();
  const { skills } = useSkills();
  const [attached, setAttached] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = usePref(PINNED);
  const sessionKey = session?.sessionKey;
  const runtimeId = session?.ref?.runtimeId ?? draft?.runtimeId;
  const skillIds = session ? attached : draft?.skillIds ?? attached;
  const mayAttach = status === "connected" && can("jagentchill.agent.use") && role !== "viewer";
  useEffect(() => {
    if (!connection || !sessionKey || !mayAttach) { setAttached([]); return; }
    void connection.call<{ skillIds: string[] }>("jagentchill.session.skills.get", { sessionKey }).then((result) => setAttached(result.skillIds)).catch(() => setAttached([]));
  }, [connection, sessionKey, mayAttach]);

  const usable = useMemo(() => (skills ?? []).filter((skill) => skill.status === "ok" && skill.enabled), [skills]);
  const available = useCallback((skill: SkillRecord) => !runtimeId || skill.visibleTo.includes(runtimeId), [runtimeId]);
  const toggle = async (skill: SkillRecord) => {
    const on = skillIds.includes(skill.skillId);
    if (!on && skillIds.length >= SKILL_LIMITS.perTurn) return;
    const next = on ? skillIds.filter((id) => id !== skill.skillId) : [...skillIds, skill.skillId];
    if (!session) { draft?.onChange(next); return; }
    if (!connection || !sessionKey) return;
    try { setAttached((await connection.call<{ skillIds: string[] }>("jagentchill.session.skills.set", { sessionKey, skillIds: next })).skillIds); }
    catch (err) { toast.show({ kind: "error", message: skillReason(err) }); }
  };
  const needle = query.trim().toLowerCase();
  const matching = usable.filter((skill) => !needle || `${skill.name}\n${skill.description}`.toLowerCase().includes(needle));
  const row = (skill: SkillRecord) => {
    const on = skillIds.includes(skill.skillId), ok = available(skill), full = !on && skillIds.length >= SKILL_LIMITS.perTurn;
    return (
      <View key={skill.skillId} style={{ flexDirection: "row", alignItems: "center" }}>
        <Tap role="option" selected={on} disabled={!ok || full} testID={`skill-option-${skill.name}`} onPress={() => void toggle(skill)}
          label={`${skill.name}, ${on ? t("attached") : t("not attached")}, ${t("{n} of 8 attached", { n: skillIds.length })}`}
          style={(state) => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[2], minHeight: theme.touch ? 48 : 40, paddingHorizontal: space[2], borderRadius: radius.sm, opacity: ok ? 1 : 0.6, backgroundColor: state.hovered || state.focused ? theme.color("bg/hover") : "transparent" })}>
          <View style={{ width: 16 }}>{on ? <Icon name="check" size={14} color="accent" /> : null}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
              <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{skill.name}</Text>
              {skill.hasScripts ? <Badge tone="warning" label={t("Has scripts")} /> : null}{skill.training ? <Badge label={t("Training")} /> : null}
            </View>
            <Text variant="meta" color="text/secondary" numberOfLines={1}>{ok ? skill.description : t("Not available on this runtime")}</Text>
          </View>
        </Tap>
        <IconButton icon="pin" size="xs" label={pinned.includes(skill.skillId) ? t("Unpin {name}", { name: skill.name }) : t("Pin {name}", { name: skill.name })} on={pinned.includes(skill.skillId)} toggle
          onPress={() => setPinned(pinned.includes(skill.skillId) ? pinned.filter((id) => id !== skill.skillId) : [...pinned, skill.skillId].slice(-SKILL_LIMITS.pinnedPerDevice))} />
      </View>
    );
  };
  const caption = (label: string) => <Text variant="meta" color="text/secondary" style={{ paddingHorizontal: space[2], paddingTop: space[2], paddingBottom: space[0.5] }}>{label}</Text>;
  const section = (label: string, list: SkillRecord[]) => (list.length ? <View key={label}>{caption(label)}{list.map(row)}</View> : null);
  const pinnedRows = pinned.map((id) => matching.find((skill) => skill.skillId === id)).filter((skill): skill is SkillRecord => !!skill);
  const rest = matching.filter((skill) => !pinned.includes(skill.skillId));
  const overlay = (
    <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="top" align="start" width={360} label={t("Skills")} title={t("Skills")} padded={false}>
      <View testID="skill-picker" style={{ width: theme.compact ? undefined : 360, maxHeight: 420 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2] }}>
          <View style={{ flex: 1 }}><Input size="sm" leadingIcon="search" clearable accessibilityLabel={t("Search skills")} placeholder={t("Search skills")} value={query} onChangeText={setQuery} onClear={() => setQuery("")} /></View>
          <Text variant="meta" color="text/secondary" tabular testID="skill-count">{skillIds.length}/{SKILL_LIMITS.perTurn}</Text>
        </View>
        {skillIds.length >= SKILL_LIMITS.perTurn ? <Text variant="meta" color="warning/text" style={{ paddingHorizontal: space[3] }}>{t("You can attach up to 8 skills per message")}</Text> : null}
        <ScrollView style={{ paddingHorizontal: space[1], paddingBottom: space[2] }}>
          {usable.length === 0 ? (
            <View style={{ alignItems: "center", gap: space[2], padding: space[4] }}>
              <Text color="text/secondary" align="center">{role === "admin" ? t("No skills installed") : t("Ask an admin device to install skills")}</Text>
              {role === "admin" && host ? <Button size="sm" label={t("Browse skills")} onPress={() => { setOpen(false); router.push(hostSettingsRoute(host.gatewayId, "skills") as never); }} /> : null}
            </View>
          ) : matching.length === 0 ? <Text color="text/secondary" align="center" style={{ padding: space[4] }}>{t("No skills match your search")}</Text> : (
            <>
              {section(t("Pinned"), pinnedRows)}
              {section(t("Built-in"), rest.filter((skill) => skill.bundled && available(skill)))}
              {section(t("Global"), rest.filter((skill) => !skill.bundled && available(skill)))}
              {section(t("Not on this runtime"), rest.filter((skill) => !available(skill)))}
            </>
          )}
        </ScrollView>
      </View>
    </Popover>
  );
  // A host that reports no skill at all has no skill support to offer: the control is not shown.
  const pill: ComposerPill | null = (!session && !draft) || skills === null || !mayAttach ? null
    : { id: "skills", label: skillIds.length === 0 ? t("Skills") : skillIds.length === 1 ? t("1 skill") : t("{n} skills", { n: skillIds.length }), icon: "spark", onPress: () => { setQuery(""); setOpen(true); } };
  return {
    pill, overlay,
    async apply(targetSessionKey) {
      if (!connection || !skillIds.length) return;
      const result = await connection.call<{ skillIds: string[] }>("jagentchill.session.skills.set", { sessionKey: targetSessionKey, skillIds });
      if (sessionKey === targetSessionKey) setAttached(result.skillIds);
    },
    /** The message as it is sent: the line naming the attached skills, a blank line, then the text. A refusal stops the send. */
    async prepare(text, targetSessionKey = sessionKey) {
      if (!connection || !targetSessionKey || skillIds.length === 0) return text;
      if (!session && draft) await connection.call("jagentchill.session.skills.set", { sessionKey: targetSessionKey, skillIds });
      const built = await connection.call<{ line: string }>("jagentchill.skill.invocation.build", { sessionKey: targetSessionKey, skillIds });
      return built.line ? `${built.line}\n\n${text}` : text;
    },
  };
}
