import { config } from "./config";
import { HttpError } from "./errors";
import { getGemini } from "./aiService";

export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const client = await getGemini();
  const file = await client.files.upload({
    file: new Blob([new Uint8Array(buffer)], { type: mimeType }),
    config: { mimeType, displayName: "interview-answer" }
  });
  if (!file.uri || !file.mimeType) throw new HttpError(502, "Audio upload failed");
  try {
    if (file.name) {
      let state = file.state;
      for (let attempt = 0; state === "PROCESSING" && attempt < 15; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        state = (await client.files.get({ name: file.name! })).state;
      }
      if (state === "FAILED" || state === "PROCESSING") {
        throw new HttpError(502, "Không xử lý được bản thu âm. Hãy thử lại hoặc nhập câu trả lời.");
      }
    }
    const result = await client.interactions.create({
      model: config.GEMINI_STT_MODEL,
      input: [{ type: "audio", uri: file.uri, mime_type: file.mimeType }],
      store: false
    }, { timeout_ms: 90_000, maxRetries: 0 });
    const transcript = result.output_text?.trim();
    if (!transcript) throw new HttpError(422, "Không nhận diện được lời nói. Hãy thử thu âm lại hoặc nhập câu trả lời.");
    return transcript.slice(0, 5000);
  } finally {
    if (file.name) await client.files.delete({ name: file.name }).catch((error) => {
      console.error("Could not delete temporary transcription file", error);
    });
  }
}

export async function synthesizeQuestion(text: string): Promise<Buffer> {
  const client = await getGemini();
  const result = await client.interactions.create({
    model: config.GEMINI_TTS_MODEL,
    input: [{ type: "user_input", content: [{ type: "text", text,
      annotations: [{ type: "speech_metadata", style: "Giọng phỏng vấn rõ ràng, thân thiện, tiếng Việt" }] }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: config.GEMINI_TTS_VOICE }] },
    store: false
  }, { timeout_ms: 90_000, maxRetries: 0 });
  const data = result.output_audio?.data;
  if (!data) throw new HttpError(502, "Không tạo được giọng nói cho câu hỏi.");
  return Buffer.from(data, "base64");
}
