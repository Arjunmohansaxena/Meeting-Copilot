# Meet-Log

This repository contains a Chrome extension and a FastAPI backend for recording meeting audio, transcribing it, and extracting decisions and action items using an LLM.

Structure

```
meeting-copilot/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env                     (never committed — in .gitignore)
│   └── uploads/                 (never committed — in .gitignore)
├── extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   ├── background.js
│   ├── offscreen.html
│   ├── offscreen.js
│   ├── content.js
│   └── icon.png
├── README.md
├── LICENSE
└── .gitignore
```

Quick start

1. Backend

```powershell
Set-Location 'e:\CSE\projects\meeting-copilot\backend'
.\\.venv\Scripts\Activate.ps1
Set-Content -Path .env -Value "GEMINI_API_KEY=your_api_key_here"
uvicorn main:app --reload
```

Alternatively, set `GEMINI_API_KEY` in your shell before launching the backend.

2. Extension

Load the `extension` folder in `chrome://extensions` with Developer mode enabled. Set backend URL in popup to `http://127.0.0.1:8000/upload`.

Security
- Do not commit the `.env` file. Store `GEMINI_API_KEY` in environment variables or secret manager in production.