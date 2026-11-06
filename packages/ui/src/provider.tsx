import { ThemeRoot, type ThemeProviderProps } from "./theme.tsx";
import { ToastRoot, type Toast } from "./toast.tsx";

/**
 * The root of the design system: tokens under the `light` and `dark` themes, the theme preference, density and form factor,
 * the overlay stack and the toast queue.
 */
export function ThemeProvider(props: ThemeProviderProps & {
  /** Height of a docked toolbar the toasts must clear on compact form factors. */
  toastOffset?: number;
  /** Receives a toast marked persistent when it disappears, so its action stays reachable in the notification inbox. */
  onToastPersist?(toast: Toast): void;
}) {
  const { toastOffset, onToastPersist, children, ...theme } = props;
  return <ThemeRoot {...theme}><ToastRoot bottomOffset={toastOffset} onPersist={onToastPersist}>{children}</ToastRoot></ThemeRoot>;
}
