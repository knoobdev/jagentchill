import { useLocalSearchParams } from "expo-router";
import { SkillsScreen } from "../../../../src/skills/SkillsScreen";

/** The Skills screen with one skill's detail open. */
export default function SkillRoute() {
  const { skillId } = useLocalSearchParams<{ hostId: string; skillId: string }>();
  return <SkillsScreen key={skillId} skillId={skillId} />;
}
