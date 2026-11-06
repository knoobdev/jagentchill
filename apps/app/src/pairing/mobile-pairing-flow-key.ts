/** Keep the native pairing form mounted while a saved pending offer hydrates after tailnet sign-in. */
export function mobilePairingFlowKey(_initialLink?: string): string {
  return "mobile-pair-link";
}
