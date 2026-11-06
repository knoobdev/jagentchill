import { Corner, Picture } from "./parts";

/** A shot's clip where no video element is at hand (a phone build): its still, marked as a clip. The browser window plays it (ClipPreview.web.tsx). */
export function ClipPreview(props: { blobId: string; stillBlobId?: string | null; ratio: number; height: number; label: string; testID?: string }) {
  return <Picture blobId={props.stillBlobId} ratio={props.ratio} height={props.height} testID={props.testID}><Corner label={props.label} tone="accent" /></Picture>;
}
