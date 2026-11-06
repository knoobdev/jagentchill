export type TailnetLoginState = "unknown" | "connecting" | "needs-login" | "connected" | "unavailable";
export type TailnetLoginResult = { ok: boolean; error?: string };

/** Contract exported by the local JAgentChill Expo module. Secrets cross this boundary only as call arguments. */
export interface JAgentChillTailscaleNativeModule {
  getStatus(): Promise<"unknown" | "connecting" | "needs-login" | "connected">;
  beginInteractiveLogin?(): TailnetLoginResult;
  prepareInteractiveLogin?(): TailnetLoginResult;
  getAuthURL?(): string | null;
  startInteractiveLogin(): Promise<TailnetLoginResult>;
  loginWithAuthKey(authKey: string): Promise<TailnetLoginResult>;
  getDevicePublicKeyB64?(): string | null;
  signNonce?(nonce: string): string;
  getProxyAddress?(target: string): string | null;
  logTechnicalError?(message: string): void;
}

export type DeviceSigningMaterial = {
  devicePublicKeyB64: string;
  signNonce(nonce: string): string | Promise<string>;
};

export class NativeTailscaleAdapter {
  readonly platform: "ios" | "android";
  readonly isSupported: boolean;

  private readonly module: JAgentChillTailscaleNativeModule | null;

  constructor(platform: "ios" | "android", module: JAgentChillTailscaleNativeModule | null) {
    this.platform = platform;
    this.module = module;
    this.isSupported = module !== null;
  }

  async getStatus(): Promise<TailnetLoginState> {
    if (!this.module) return "unavailable";
    try { return await this.module.getStatus(); } catch { return "unavailable"; }
  }

  prepareInteractiveLogin(): TailnetLoginResult {
    if (!this.module) return { ok: false, error: "Tailscale is unavailable in this build." };
    try { return this.module.prepareInteractiveLogin?.() ?? { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Tailscale login failed." }; }
  }

  async startInteractiveLogin(): Promise<TailnetLoginResult> {
    if (!this.module) return { ok: false, error: "Tailscale is unavailable in this build." };
    try { return this.module.beginInteractiveLogin?.() ?? await this.module.startInteractiveLogin(); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Tailscale login failed." }; }
  }

  getInteractiveLoginUrl(): string | null {
    try { return this.module?.getAuthURL?.()?.trim() || null; } catch { return null; }
  }

  async loginWithAuthKey(authKey: string): Promise<TailnetLoginResult> {
    const key = authKey.trim();
    if (!key) return { ok: false, error: "An auth key is required." };
    if (!this.module) return { ok: false, error: "Tailscale is unavailable in this build." };
    // The key is passed directly to native memory and is not written to JS or native persistent storage.
    try { return await this.module.loginWithAuthKey(key); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Tailscale login failed." }; }
  }

  getDeviceSigningMaterial(): DeviceSigningMaterial | null {
    const publicKey = this.module?.getDevicePublicKeyB64?.();
    const signNonce = this.module?.signNonce;
    return publicKey && signNonce ? { devicePublicKeyB64: publicKey, signNonce: (nonce) => signNonce.call(this.module, nonce) } : null;
  }

  getProxyAddress(target: string): string | null {
    try { return this.module?.getProxyAddress?.(target) ?? null; } catch { return null; }
  }
}
