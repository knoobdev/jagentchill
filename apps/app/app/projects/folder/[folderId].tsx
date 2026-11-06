import { useLocalSearchParams } from "expo-router";
import { ProjectsScreen } from "../../../src/projects/ProjectsScreen";

export default function ProjectFolder() {
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  return <ProjectsScreen folderId={folderId} />;
}
