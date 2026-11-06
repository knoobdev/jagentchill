import { DeviceSettingsRedirect } from "../src/pairing/DeviceSettingsRedirect";

/** Legacy sidebar destination: device administration belongs under Settings ▸ Host ▸ Devices. */
export default function Devices() {
  return <DeviceSettingsRedirect />;
}
