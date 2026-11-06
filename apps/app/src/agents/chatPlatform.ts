/** The chat's current file chooser is a browser input; native callers need to explain the missing picker. */
export function needsFilePickerNotice(platform: string, documentAvailable: boolean): boolean {
  return platform !== "web" || !documentAvailable;
}

/** DOM wheel/keyboard listeners belong to the web scroll node; React Native's scroll node is a native handle. */
export function usesDomChatScroll(platform: string): boolean {
  return platform === "web";
}
