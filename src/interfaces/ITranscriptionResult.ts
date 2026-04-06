import { ISpeakerSegment } from "./ISpeakerSegment";

/**
 * Full result of transcribing one audio file or stream.
 */
export interface ITranscriptionResult {
  transcript:  string;             // Complete transcript as one string
  segments:    ISpeakerSegment[];  // Same transcript split by speaker
  duration:    number;             // Total audio duration in seconds
  confidence:  number;             // Deepgram confidence score 0.0 to 1.0
  language:    string;             // Detected language: "fr" or "en"
}

/**
 * C4 Component: Transcription
 * File: src/transcribe.ts
 *
 * The ONLY module allowed to call Deepgram.
 * Handles both file upload (Mode B, our MVP) and live stream (Mode A, bot).
 */
