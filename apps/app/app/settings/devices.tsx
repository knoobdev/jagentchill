import { DeviceSettingsRedirect } from "../../src/pairing/DeviceSettingsRedirect";

/** Legacy route: the Devices page is in the Host section of Settings. */
export default function SettingsDevices() {
  return <DeviceSettingsRedirect />;
}
