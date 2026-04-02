from fastapi import FastAPI, UploadFile, File, Form
import json
from faster_whisper import WhisperModel
import os
import tempfile
import time

#dont forget to add token authentication to this endpoint in production, or anyone can use your server to transcribe audio and run up your costs
app = FastAPI()

# Configuration (could be moved to env vars)
MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base") # Changed from large-v3 to base for vastly improved CPU performance
DEVICE = os.getenv("WHISPER_DEVICE", "cpu") # Changed from cuda to cpu due to missing cublas64_12.dll
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8") # float16 is usually for GPUs, int8 is faster/better optimized for CPU

print(f"Loading WhisperModel {MODEL_SIZE} on {DEVICE}...")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
print("Model loaded.")

@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str = Form("en")):
    start_time = time.time()
    
    # Save the uploaded file to a temporary location
    suffix = os.path.splitext(audio.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        print(f"Transcribing {tmp_path} in {language}...")
        segments, info = model.transcribe(tmp_path, language=language, beam_size=5)
        
        transcript = ""
        segment_list = []
        for segment in segments:
            transcript += segment.text + " "
            segment_list.append({
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
                "speaker": "Speaker 0"
            })
            
        result = {
            "transcript": transcript.strip(),
            "segments": segment_list,
            "duration": info.duration,
            "language": info.language,
            "language_probability": float(info.language_probability) if hasattr(info, "language_probability") else 0.95
        }
        
        elapsed = time.time() - start_time
        print(f"Transcription complete in {elapsed:.2f}s")
        return result
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}
    finally:
        os.remove(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
