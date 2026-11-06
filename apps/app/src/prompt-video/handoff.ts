/**
 * What another screen hands to the setup of a run when it opens it: a script of the script studio ("Send to
 * workflow…"), or a prompt written in the editor ("Generate video from prompt"). Held for the one navigation: the setup
 * screen takes it when it mounts.
 */
export type Handoff = { script?: string; title?: string; prompt?: string; language?: string };
let pending: Handoff | null = null;
export const handToSetup = (handoff: Handoff): void => { pending = handoff; };
export function takeHandoff(): Handoff | null { const taken = pending; pending = null; return taken; }
