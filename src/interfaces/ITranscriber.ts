import { ITranscriptionResult } from "./ITranscriptionResult";

export interface ITranscriber {
  /**
   * @param audioBuffer  - The raw audio bytes
   * @param mimeType     - "audio/mp3", "audio/wav", "audio/m4a"
   * @param language     - "en"
   */
  transcribeFile(
    audioBuffer: Buffer,
    mimeType:    string,
    language?:   string,
    apiKeys?:    any
  ): Promise<ITranscriptionResult>;

  /**
   * @param stream     - Readable stream of audio chunks from the bot
   * @param onPartial  - Called with partial text as it arrives (for live UI)   
   */
  transcribeStream(
    stream:    NodeJS.ReadableStream,
    onPartial: (text: string) => void,
    apiKeys?:  any
  ): Promise<ITranscriptionResult>;
}