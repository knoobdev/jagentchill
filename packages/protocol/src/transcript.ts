/** Removes editor- and host-authored wrappers from the person's transcript text. */
export function stripInjectedUserText(value: string): string {
  return value
    .replace(/\[JAgentChill editor context — written by the editor, not by the user\][\s\S]*?\[End of editor context\. The user's message follows\.\]\s*/g, "")
    .replace(/^\[(?:Workflow|Film|Script|One prompt)[^\n]*\][\s\S]*?\n\n/, "")
    .replace(/\s*\[Attached file: [^\]\n]*\]/g, "")
    .replace(/\s*\[Runtime file: [^\]\n]*\]/g, "")
    .replace(/\s*\[\[jc-attachments:[0-9a-f-]{36}\]\]/g, "")
    .replace(/^\s*(?:\[Current turn:[^\]\n]*\]|Current turn:[^\n]*)\s*\n/gm, "")
    .replace(/^<chat-history-summary>\n[\s\S]*?\n<\/chat-history-summary>\s*/, "")
    .replace(/^\n{1,2}/, "");
}
