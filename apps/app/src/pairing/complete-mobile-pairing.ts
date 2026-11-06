/**
 * Leave the verification screen as soon as the host record has been saved. Native secure-store reads can be slow,
 * and refreshing the host list is not a prerequisite for routing to Home: HostProvider observes the refresh when it
 * completes.
 */
export function completeMobilePairing(
  gatewayId: string | undefined,
  deps: { selectHost(gatewayId: string): void; navigateHome(): void; refreshHosts(): Promise<void> },
): void {
  if (gatewayId) deps.selectHost(gatewayId);
  deps.navigateHome();
  void deps.refreshHosts().catch(() => undefined);
}
