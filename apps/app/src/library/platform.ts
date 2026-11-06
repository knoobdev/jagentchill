/** Native builds read the size of a picked image through the media importer; the Library's own import runs on the web and desktop builds. */
export async function imageSize(_file: File): Promise<{ width: number; height: number } | null> { return null; }
