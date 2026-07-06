# Backend (Meeting Copilot)

Run the FastAPI backend locally for development.

Prerequisites
- Python 3.10+
- Create and activate a virtualenv (recommended)
- `pip install -r requirements.txt`
- Set `GEMINI_API_KEY` in your environment

Start the server:

```bash
# from backend/ directory
uvicorn main:app --reload --port 8000
```

The upload endpoint is `http://127.0.0.1:8000/upload` and accepts a `file` form field (audio/webm, mp3, wav, etc.).

Notes
- CORS is enabled for development (all origins). Tighten in production.
- Transcription uses `faster_whisper` and the Gemini API for report generation.
 - The backend will also generate a PDF containing the meeting date/time, the transcript, and the analysis report. The upload response includes `pdf_base64` (base64-encoded PDF) and `pdf_name` which the extension downloads automatically.
