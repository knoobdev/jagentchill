import { formatUsd } from "@jagentchill/app-core";

/**
 * How many decimals the amounts of ONE card are shown with, so that its rows add up to its total AS SHOWN: the fewest
 * (two at least) at which every amount is shown exactly — nothing is rounded, so nothing can fail to add up ("$0.034"
 * twice under "$0.068"; never "$0.03" twice under "$0.07"). The host keeps money to a millionth of a dollar: six at most.
 */
export function cardDigits(amounts: readonly (number | null | undefined)[]): number {
  const known = amounts.filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount));
  for (let digits = 2; digits < 6; digits++) if (known.every((amount) => Math.abs(amount * 10 ** digits - Math.round(amount * 10 ** digits)) < 1e-6)) return digits;
  return 6;
}
/** The rows and the total of a card, worded by the shared money formatter at the card's one precision. */
export function cardAmounts(items: readonly (number | null)[], totalUsd: number, locale?: string): { items: (string | null)[]; total: string } {
  const digits = cardDigits([...items, totalUsd]), say = (amount: number) => (locale ? formatUsd(amount, { digits }, locale) : formatUsd(amount, { digits }));
  return { items: items.map((amount) => (amount === null ? null : say(amount))), total: say(totalUsd) };
}
