import { ITranscriptionResult } from "./ITranscriptionResult";

/**
 * C4 Component: Transcription
 * File: src/transcribe.ts
 *
 * The ONLY module allowed to call Deepgram.
 * Handles both file upload (Mode B, our MVP) and live stream (Mode A, bot).
 */
export interface ITranscriber {
  /**
   * Transcribes a complete audio file.
   * Used in Mode B (manual upload via the RapidoMeet UI).
   * @param audioBuffer  - The raw audio bytes
   * @param mimeType     - "audio/mp3", "audio/wav", "audio/m4a"
   * @param language     - "fr" or "en" (defaults to "fr")
   */
  transcribeFile(
    audioBuffer: Buffer,
    mimeType:    string,
    language?:   string,
    apiKeys?:    any
  ): Promise<ITranscriptionResult>;

  /**
   * Transcribes a live audio stream in real time.
   * Used in Mode A (Playwright bot captures the meeting audio).
   * @param stream     - Readable stream of audio chunks from the bot
   * @param onPartial  - Called with partial text as it arrives (for live UI)   
   */
  transcribeStream(
    stream:    NodeJS.ReadableStream,
    onPartial: (text: string) => void,
    apiKeys?:  any
  ): Promise<ITranscriptionResult>;
}

// SECTION 4 — NLP EXTRACTION (extract.ts)
// Takes a transcript and turns it into structured business data.

/**
 * A task extracted from a meeting.
 * Example: "Thomas doit envoyer le devis avant vendredi"
 */
