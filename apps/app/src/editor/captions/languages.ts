/** The languages speech is recognised in and captions are translated to (`captions-subtitles.Transcription language list`); the first entry lets the model decide. */
export const LANGUAGES = [
  { value: "auto", label: "Auto detect" }, { value: "en", label: "English" }, { value: "es", label: "Spanish" }, { value: "it", label: "Italian" }, { value: "fr", label: "French" }, { value: "de", label: "German" }, { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" }, { value: "ja", label: "Japanese" }, { value: "zh", label: "Chinese" }, { value: "ko", label: "Korean" }, { value: "vi", label: "Vietnamese" }, { value: "id", label: "Indonesian" }, { value: "ms", label: "Malay" },
  { value: "th", label: "Thai" }, { value: "tr", label: "Turkish" }, { value: "ar", label: "Arabic" }, { value: "hi", label: "Hindi" }, { value: "nl", label: "Dutch" }, { value: "pl", label: "Polish" }, { value: "uk", label: "Ukrainian" },
  { value: "sv", label: "Swedish" }, { value: "fil", label: "Filipino" }, { value: "el", label: "Greek" }, { value: "he", label: "Hebrew" },
] as const;
