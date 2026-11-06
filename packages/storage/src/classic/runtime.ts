/**
 * The two impure inputs of the classic steps — new ids and "now" — come from the migration context, so that the chain
 * is a pure function of (record, context): the same inputs and id source give the same bytes on every platform.
 * The chain runs synchronously, so one module-level context per run is sufficient.
 */
export type ClassicRuntime = {
	newId: () => string;
	now_ms: number;
	/** The sticker provider whose bundled catalogue contains an un-prefixed id, or `null` when none does (v4→v5). */
	stickerProviderOf?: (id: string) => string | null;
};

let current: ClassicRuntime | null = null;

export function withClassicRuntime<T>(runtime: ClassicRuntime, run: () => T): T {
	const previous = current;
	current = runtime;
	try {
		return run();
	} finally {
		current = previous;
	}
}

function runtime(): ClassicRuntime {
	if (!current) throw new Error("a classic migration step ran outside withClassicRuntime()");
	return current;
}

export const generateUUID = (): string => runtime().newId();
export const classicNow = (): Date => new Date(runtime().now_ms);
export const stickerProviderOf = (id: string): string | null => runtime().stickerProviderOf?.(id) ?? null;

/** Rounds half away from zero onto the integer-tick lattice and normalises `-0` to `0` (classic `roundMediaTime`). */
export function roundMediaTime({ time }: { time: number }): number {
	const roundedMagnitude = Math.round(Math.abs(time));
	if (roundedMagnitude === 0) return 0;
	return time < 0 ? -roundedMagnitude : roundedMagnitude;
}
