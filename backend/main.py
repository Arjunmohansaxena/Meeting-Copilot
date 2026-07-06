import json
import logging
import os
from pathlib import Path
import io
import base64
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from starlette.status import HTTP_400_BAD_REQUEST, HTTP_500_INTERNAL_SERVER_ERROR
from faster_whisper import WhisperModel
from google import genai
from fastapi.middleware.cors import CORSMiddleware
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins for development; tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logging.basicConfig(level=logging.INFO)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac"}
ALLOWED_CONTENT_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/m4a",
    "audio/webm",
    "video/webm",
    "audio/ogg",
    "audio/x-flac",
    "audio/flac",
    "audio/mp4",
    "audio/m4a",
}
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY environment variable is required")

client = genai.Client(api_key=GEMINI_API_KEY)
whisper_model = WhisperModel("base")  # loads once when server starts


def get_safe_filepath(filename: str) -> Path:
    if not filename:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Filename is required")

    safe_name = Path(filename).name
    if not safe_name or safe_name.startswith("."):
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Invalid filename")

    destination = UPLOAD_DIR / safe_name
    if destination.resolve().parent != UPLOAD_DIR.resolve():
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Invalid filename")
    return destination


async def save_upload_file(file: UploadFile, destination: Path) -> None:
    if destination.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Unsupported file extension")

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Unsupported file type")

    size = 0
    chunk_size = 8192
    with destination.open("wb") as buffer:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_SIZE:
                raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="File exceeds maximum size")
            buffer.write(chunk)

    await file.close()


@app.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    save_path = get_safe_filepath(file.filename)
    await save_upload_file(file, save_path)
    transcript = transcribe_audio(save_path)
    report = generate_report(transcript)

    meeting_dt = datetime.now()
    try:
        pdf_bytes = create_pdf_bytes(meeting_dt, transcript, report)
        pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
        pdf_name = f"{save_path.stem}_report.pdf"
    except Exception:
        logging.exception("PDF generation failed")
        pdf_b64 = None
        pdf_name = None

    return {
        "filename": save_path.name,
        "transcript": transcript,
        "report": report,
        "pdf_name": pdf_name,
        "pdf_base64": pdf_b64,
        "meeting_datetime": meeting_dt.isoformat(),
    }


def transcribe_audio(path: str) -> str:
    try:
        segments, _ = whisper_model.transcribe(str(path))
        return "".join(segment.text for segment in segments)
    except Exception:
        logging.exception("Transcription failed")
        raise HTTPException(status_code=HTTP_500_INTERNAL_SERVER_ERROR, detail="Audio transcription failed")


def generate_report(transcript: str) -> dict:
    prompt = f"""You are analyzing a meeting transcript. Read it carefully and classify the discussion into three categories:

1. "decided" — things the group clearly agreed on or finalized
2. "open" — things that were discussed but NOT resolved or agreed upon
3. "action_items" — specific tasks mentioned, with an owner if named

Respond ONLY with valid JSON in this exact format, no other text, no markdown formatting, no code fences:
{{
  "decided": ["...", "..."],
  "open": ["...", "..."],
  "action_items": [{{"task": "...", "owner": "..."}}]
}}

Transcript:
{transcript}
"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
        )
        raw_text = response.text.strip()
    except Exception:
        logging.exception("AI report generation failed")
        raise HTTPException(status_code=HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate report")

    if raw_text.startswith("```"):
        raw_text = raw_text.strip("`")
        if raw_text.startswith("json"):
            raw_text = raw_text[4:].strip()

    try:
        return json.loads(raw_text) 
    except json.JSONDecodeError:
        logging.error("AI response could not be parsed as JSON: %s", raw_text)
        raise HTTPException(
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI returned an unexpected response format",
        )


def create_pdf_bytes(meeting_datetime: datetime, transcript: str, report: dict) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    margin = 50
    y = height - margin

    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin, y, "Meeting Copilot Report")
    y -= 24

    c.setFont("Helvetica", 10)
    c.drawString(margin, y, f"Generated: {meeting_datetime.isoformat(sep=' ', timespec='seconds')}")
    y -= 18

    # Transcript
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin, y, "Transcript:")
    y -= 16
    c.setFont("Helvetica", 10)
    for line in transcript.splitlines():
        for chunk in _split_text(line, 80):
            if y < margin + 40:
                c.showPage()
                y = height - margin
                c.setFont("Helvetica", 10)
            c.drawString(margin, y, chunk)
            y -= 14

    # Report JSON
    if y < margin + 80:
        c.showPage()
        y = height - margin

    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin, y, "Analysis Report:")
    y -= 16
    c.setFont("Helvetica", 10)
    pretty = json.dumps(report, indent=2, ensure_ascii=False)
    for line in pretty.splitlines():
        for chunk in _split_text(line, 100):
            if y < margin + 40:
                c.showPage()
                y = height - margin
                c.setFont("Helvetica", 10)
            c.drawString(margin, y, chunk)
            y -= 14

    c.save()
    buffer.seek(0)
    return buffer.read()


def _split_text(text: str, max_len: int):
    if not text:
        return [""]
    parts = []
    while len(text) > max_len:
        parts.append(text[:max_len])
        text = text[max_len:]
    parts.append(text)
    return parts