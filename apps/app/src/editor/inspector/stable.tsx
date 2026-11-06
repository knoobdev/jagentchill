import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { Button, IconButton, NumberField, Select, Slider, Tabs } from "@jagentchill/ui";

/**
 * The controls of the inspector, drawn again only when what they SHOW changes. The inspector renders on every change of
 * the selection and of the project; a click from one picture clip to the next drew its whole tab again — 255 components
 * for values that were the same — because every control was handed functions made in that render.
 * `useStableHandlers` gives each handler one identity for the life of the component (it calls the handler of the latest
 * committed render, so it always writes to the clip that is shown); with it a control's props are equal when its value is.
 */
// The handlers of a component: any functions, by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handlers = Record<string, (...args: any[]) => unknown>;
export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  // After the commit, before any event can reach a control: an event always runs the handlers of what is on screen.
  useLayoutEffect(() => { latest.current = handlers; });
  // The names are those of the first render: a component passes the same set every time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.fromEntries(Object.keys(handlers).map((name) => [name, (...args: unknown[]) => latest.current[name](...args)])) as T, []);
}

export const Field = memo(NumberField);
export const Slide = memo(Slider);
export const Act = memo(IconButton);
export const Press = memo(Button);
export const Pick = memo(Select) as unknown as typeof Select;
export const TabStrip = memo(Tabs);
