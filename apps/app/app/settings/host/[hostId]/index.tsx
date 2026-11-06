import { Redirect } from "expo-router";

/** A host has no settings page of its own: the landing lists its pages. */
export default function HostSettings() {
  return <Redirect href={"/settings" as never} />;
}
