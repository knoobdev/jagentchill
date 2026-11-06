import { useRef } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import { Text, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";

/** Six code cells in two groups of three. Read-only when `onChange` is absent. */
export function OtpCells(props: { value: string; onChange?(value: string): void; onComplete?(): void; large?: boolean; inputTestID?: string }) {
  const theme = useTheme(), t = useT();
  const input = useRef<TextInput>(null);
  const [width, height, size] = props.large ? [52, 64, 30] : [44, 52, 22];
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Verification code")} disabled={!props.onChange} onPress={() => input.current?.focus()} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <View key={index} style={{ flexDirection: "row" }}>
            {index === 3 ? <View style={{ width: 8 }} /> : null}
            <View style={{
              width, height, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center",
              borderColor: theme.color(props.onChange && index === props.value.length ? "accent" : "border/strong"),
              backgroundColor: theme.color(props.onChange ? "bg/app" : "bg/inset"),
            }}>
              <Text variant="mono" style={{ fontSize: size, lineHeight: size + 2, fontWeight: "600" }}>{props.value[index] ?? ""}</Text>
            </View>
          </View>
        ))}
      </Pressable>
      {props.onChange ? (
        <TextInput ref={input} accessibilityLabel={t("Verification code")} testID={props.inputTestID} autoFocus keyboardType="number-pad" maxLength={6} value={props.value}
          onChangeText={(text) => props.onChange!(text.replace(/\D/g, "").slice(0, 6))} onSubmitEditing={props.onComplete}
          pointerEvents="none" style={[{ position: "absolute", top: 0, right: 0, width: 1, height: 1, opacity: 0.01, color: "transparent" }, Platform.OS === "web" ? ({ outlineStyle: "none", caretColor: "transparent" } as object) : null]} />
      ) : null}
    </View>
  );
}
