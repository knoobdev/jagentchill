import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { elapsedLabel } from "@jagentchill/app-core";
import { MEDIA_MESSAGES, recordingCountdown, type RecordingKind, type RecordingSession } from "@jagentchill/media";
import { Button, Modal, Select, Switch, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { CapturePreview, listCaptureDevices, openCapture, permissionHelpUrl, systemAudioSupported, type Capture, type CaptureDevice, type CaptureError } from "../platform/media";
import { openExternal } from "../platform/store";
import type { MediaSession } from "./session";

type Phase = { step: "setup" } | { step: "opening" } | { step: "denied"; error: CaptureError } | { step: "countdown"; left: number } | { step: "recording" } | { step: "paused" } | { step: "saving" };
const TITLE: Record<RecordingKind, string> = { camera: "Record camera", screen: "Record screen", voice: "Record voice" };

/**
 * The recorder: source options and device selectors, the countdown before camera and screen recording, elapsed time,
 * an input level meter, Pause / Resume and Stop. On Stop the recording becomes a media asset of the project.
 */
export function Recorder(props: { session: MediaSession; source: RecordingKind; onClose(): void; onDone(result: Awaited<ReturnType<MediaSession["importRecording"]>>): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ step: "setup" });
  const [devices, setDevices] = useState<CaptureDevice[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [microphoneId, setMicrophoneId] = useState<string | null>(null);
  const [microphone, setMicrophone] = useState(true);
  const [systemAudio, setSystemAudio] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const capture = useRef<Capture | null>(null), recording = useRef<RecordingSession | null>(null), finishing = useRef(false);
  const refreshDevices = () => void listCaptureDevices().then(setDevices);
  useEffect(refreshDevices, []);
  // Leaving the dialog while a capture is open releases the camera, the screen and the microphone.
  useEffect(() => () => { if (!finishing.current) capture.current?.close(); }, []);
  useEffect(() => {
    if (phase.step !== "recording" && phase.step !== "paused") return;
    const timer = setInterval(() => { setElapsed(recording.current?.elapsedMs ?? 0); setLevel(phase.step === "recording" ? capture.current?.level() ?? 0 : 0); }, 100);
    return () => clearInterval(timer);
  }, [phase.step]);

  const finish = async (stoppedForStorage = false) => {
    const active = recording.current;
    if (!active || finishing.current) return;
    finishing.current = true;
    setPhase({ step: "saving" });
    try {
      const result = await active.stop();
      if (stoppedForStorage || result.stoppedForStorage) toast.show({ kind: "warning", message: t(MEDIA_MESSAGES["media.recording.storage-low"]), sticky: true });
      props.onDone(await props.session.importRecording(result.id, result.name, result.mimeType));
    } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
    props.onClose();
  };
  const begin = async () => {
    const opened = capture.current;
    if (!opened) return;
    try {
      recording.current = await props.session.startRecording(props.source, opened, () => void finish(true));
      opened.onEnded(() => void finish());
      setElapsed(0); setPhase({ step: "recording" });
    } catch (error) { opened.close(); capture.current = null; toast.show({ kind: "error", message: error instanceof Error && /storage/.test(error.message) ? t("Not enough storage to record") : error instanceof Error ? error.message : String(error) }); setPhase({ step: "setup" }); }
  };
  const start = async () => {
    setPhase({ step: "opening" });
    try {
      capture.current = await openCapture({ kind: props.source, cameraId: cameraId ?? undefined, microphoneId: microphoneId ?? undefined, microphone, systemAudio });
    } catch (error) {
      const failure = error as CaptureError;
      // Dismissing the browser's own source chooser is not a refusal: the recorder goes back to its options.
      if (failure.reason === "cancelled" || (props.source === "screen" && failure.reason === "denied" && /dismiss|cancel/i.test(failure.message))) { setPhase({ step: "setup" }); return; }
      setPhase({ step: "denied", error: failure });
      return;
    }
    refreshDevices();
    const seconds = recordingCountdown(props.source);
    if (seconds === 0) { void begin(); return; }
    setPhase({ step: "countdown", left: seconds });
  };
  useEffect(() => {
    if (phase.step !== "countdown") return;
    const timer = setTimeout(() => { if (phase.left <= 1) void begin(); else setPhase({ step: "countdown", left: phase.left - 1 }); }, 1000);
    return () => clearTimeout(timer);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const cameras = devices.filter((device) => device.kind === "camera"), microphones = devices.filter((device) => device.kind === "microphone");
  const options = (list: CaptureDevice[], fallback: string) => [{ value: "default", label: t("System default") }, ...list.filter((device) => device.id && device.id !== "default").map((device, index) => ({ value: device.id, label: device.label || `${fallback} ${index + 1}` }))];
  const live = phase.step === "recording" || phase.step === "paused";
  const close = () => { if (live) void finish(); else { capture.current?.close(); capture.current = null; props.onClose(); } };
  const footer = phase.step === "setup" || phase.step === "opening" ? <><View style={{ flex: 1 }} /><Button kind="ghost" label={t("Cancel")} onPress={close} /><Button kind="primary" icon="record" label={t("Start recording")} loading={phase.step === "opening"} onPress={() => void start()} /></>
    : phase.step === "denied" ? <><Button kind="ghost" label={t("How to allow access")} onPress={() => openExternal(permissionHelpUrl())} /><View style={{ flex: 1 }} /><Button kind="ghost" label={t("Close")} onPress={close} /><Button kind="primary" label={t("Try again")} onPress={() => void start()} /></>
      : phase.step === "countdown" ? <><View style={{ flex: 1 }} /><Button kind="ghost" label={t("Cancel")} onPress={close} /></>
        : live ? <><View style={{ flex: 1 }} /><Button icon={phase.step === "paused" ? "play" : "pause"} label={phase.step === "paused" ? t("Resume") : t("Pause")} onPress={() => { if (phase.step === "paused") { recording.current?.resume(); setPhase({ step: "recording" }); } else { recording.current?.pause(); setPhase({ step: "paused" }); } }} /><Button kind="destructive" icon="stop" label={t("Stop")} onPress={() => void finish()} /></>
          : undefined;
  return (
    <Modal title={t(TITLE[props.source])} width={480} blocking={live || phase.step === "saving"} hideClose={live || phase.step === "saving"} onClose={close} footer={footer}>
      <View testID="recorder" style={{ gap: space[3] }}>
        {phase.step === "denied" ? (
          <View role="alert" testID="recorder-denied" style={{ gap: space[1] }}>
            <Text variant="body-medium">{props.source === "voice" ? t("The microphone is not available") : props.source === "camera" ? t("The camera or microphone is not available") : t("The screen cannot be recorded")}</Text>
            <Text color="text/secondary">{phase.error.reason === "denied" ? t("JAgentChill is not allowed to use it. Allow access in the site settings of your browser, then try again.") : t("No device was found, or another app is using it.")}</Text>
          </View>
        ) : null}
        {phase.step === "setup" || phase.step === "opening" ? (
          <>
            {props.source === "camera" ? <Field label={t("Camera")}><Select label={t("Camera")} value={cameraId ?? "default"} options={options(cameras, t("Camera"))} onChange={(value) => setCameraId(value === "default" ? null : value)} /></Field> : null}
            {props.source === "screen" ? (
              <>
                <Text color="text/secondary">{t("Your browser asks which screen, window or tab to record.")}</Text>
                {systemAudioSupported() ? <Row label={t("System audio")}><Switch accessibilityLabel={t("System audio")} value={systemAudio} onChange={setSystemAudio} /></Row> : null}
                <Row label={t("Microphone")}><Switch accessibilityLabel={t("Microphone")} value={microphone} onChange={setMicrophone} /></Row>
              </>
            ) : null}
            {props.source !== "screen" || microphone ? <Field label={t("Microphone")}><Select label={t("Microphone")} value={microphoneId ?? "default"} options={options(microphones, t("Microphone"))} onChange={(value) => setMicrophoneId(value === "default" ? null : value)} /></Field> : null}
          </>
        ) : null}
        {phase.step === "countdown" || live || phase.step === "saving" ? (
          <>
            {capture.current?.hasVideo ? (
              <View style={{ borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("preview/offline-fill") }}>
                <CapturePreview stream={capture.current.stream} height={220} label={t(TITLE[props.source])} />
                {phase.step === "countdown" ? <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/scrim") }}><Text variant="display" color="clip/label" testID="recorder-countdown">{phase.left}</Text></View> : null}
              </View>
            ) : phase.step === "countdown" ? <Text variant="display" align="center" testID="recorder-countdown">{phase.left}</Text> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <View style={{ width: 10, height: 10, borderRadius: radius.full, backgroundColor: theme.color(phase.step === "recording" ? "danger" : "text/tertiary") }} />
              <Text variant="title-sm" tabular testID="recorder-elapsed">{elapsedLabel(elapsed)}</Text>
              <Text color="text/secondary">{phase.step === "paused" ? t("Paused") : phase.step === "saving" ? t("Saving…") : phase.step === "countdown" ? t("Starting…") : t("Recording")}</Text>
            </View>
            <View accessibilityRole="progressbar" aria-label={t("Input level")} aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100} testID="recorder-level" style={{ height: 6, borderRadius: radius.full, backgroundColor: theme.color("bg/subtle"), overflow: "hidden" }}>
              <View style={{ width: `${Math.round(Math.min(1, level * 1.4) * 100)}%`, height: "100%", backgroundColor: theme.color(level > 0.9 ? "danger" : "success") }} />
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}
function Field(props: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: space[1] }}><Text variant="meta" color="text/secondary">{props.label}</Text>{props.children}</View>;
}
function Row(props: { label: string; children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 32 }}><Text style={{ flex: 1 }}>{props.label}</Text>{props.children}</View>;
}
