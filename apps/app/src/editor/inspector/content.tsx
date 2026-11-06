import type { ReactNode } from "react";
import { useRouter } from "expo-router";
import { timeline } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { useEditor, useHeldTransport } from "../context";
import { AnimationTab } from "./AnimationTab";
import { AudioInspector } from "./AudioInspector";
import { CaptionInspector, CaptionTextTab } from "./CaptionInspector";
import { ShapeInspector } from "./ShapeInspector";
import { StickerInspector } from "./StickerInspector";
import { TextInspector } from "./TextInspector";
import { TextToSpeech } from "../captions/SpeechTools";

type El = timeline.El;
export type InspectorTab = { id: string; label: string };

/**
 * The tabs the content capabilities (text, audio, stickers and shapes, captions) add to a selection's inspector, after
 * the ones the frame of the element type already has.
 */
export function contentTabs(_document: ProjectDocument, elements: El[], tabs: InspectorTab[]): InspectorTab[] {
  const [first] = elements;
  // The frame's order: Text, Animation, Text to speech; a caption has Captions, Text, Animation.
  if (elements.length === 1 && first.type === "text") return [...tabs.slice(0, 1), { id: "animation", label: "Animation" }, { id: "tts", label: "Text to speech" }, ...tabs.slice(1)];
  if (elements.length === 1 && first.type === "caption") return [{ id: "captions", label: "Captions" }, { id: "caption-text", label: "Text" }, { id: "animation", label: "Animation" }, { id: "tts", label: "Text to speech" }, ...tabs];
  // Several texts or captions selected together are spoken together ("{n} selected texts are spoken…", one estimate): the same tool, after the selection's own tabs.
  if (elements.length > 1 && elements.every((element) => element.type === "text" || element.type === "caption")) return [...tabs, { id: "tts", label: "Text to speech" }];
  return tabs;
}

/**
 * The Basic tab of a selection: a text element's Text sub-tabs wrap the Transform and Blend sections, other types show
 * them as they are. Every kind goes through the one frame (`TextInspector`), which keeps those sections mounted
 * from one kind of selection to the next.
 */
export function ContentBasic(props: { elements: El[]; children: ReactNode }) {
  const [first] = props.elements, single = props.elements.length === 1;
  // A shape's or a drawing's own parameters, and a sticker's playback, sit above its Transform and Blend sections.
  const above = single && first.type === "graphic" ? <ShapeInspector key="shape" element={first} /> : single && first.type === "sticker" ? <StickerInspector key="sticker" element={first} /> : null;
  return <TextInspector element={single && first.type === "text" ? first : null} above={above}>{props.children}</TextInspector>;
}

/** The body of a tab a content capability owns; `null` for the tabs of other capabilities. */
export function ContentTab(props: { active: string | undefined; elements: El[] }) {
  const router = useRouter();
  const transport = useHeldTransport();
  const { controller } = useEditor();
  const [first] = props.elements;
  if (!first) return null;
  if (props.active === "audio") return <AudioInspector elements={props.elements.filter((element) => ["audio", "video", "compound"].includes(element.type))} playhead={transport.time} />;
  if (props.active === "captions" && first.type === "caption") return <CaptionInspector element={first} />;
  if (props.active === "caption-text" && first.type === "caption") return <CaptionTextTab element={first} />;
  if (props.active === "animation" && props.elements.length === 1 && (first.type === "text" || first.type === "caption")) return <AnimationTab element={first} />;
  if (props.active === "tts" && props.elements.every((element) => element.type === "text" || element.type === "caption")) return <TextToSpeech document={controller.stored} onOpenSettings={() => router.push("/settings" as never)} />;
  return null;
}
