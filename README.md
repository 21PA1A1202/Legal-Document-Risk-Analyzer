# DRA - Legal Document Risk Analyzer

DRA is a full-stack application that reviews legal documents and returns a structured risk analysis with:

- Overall risk score and risk band
- Clause-level risks with severity and recommendations
- Likely missing clauses
- Suggested next actions
- Multilingual output (`en`, `es`, `fr`, `de`, `hi`, `ar`)

It supports both pasted text and uploaded files (`.txt`, `.pdf`, `.docx`).

## Architecture

- `frontend` (Vue 3 + TypeScript + Vite):
  User interface for uploading/pasting documents and viewing analysis output.
- `backend` (Express + TypeScript):
  API layer, validation, risk analysis orchestration, AI + heuristic fallback.
- `backend/extractor` (FastAPI + Python):
  Text extraction service for `.txt/.pdf/.docx` uploads.

## How Analysis Works

1. User submits text directly or uploads a document.
2. For uploads, backend calls the extractor service to convert file to text.
3. Backend runs AI analysis (Gemini) when `GEMINI_API_KEY` is configured.
4. If AI is unavailable, backend uses a deterministic heuristic risk engine.
5. Frontend renders a normalized, structured result.

## Prerequisites

- Node.js 18+
- npm 9+
- Python 3.10+

## Local Setup

### 1. Start extractor service (port `8001`)

```bash
cd backend/extractor
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8001
```

### 2. Start backend API (port `4000`)

```bash
cd backend
npm install
# Optional: enable AI mode
export GEMINI_API_KEY=your_key_here
# Optional if extractor runs elsewhere
# export EXTRACTOR_URL=http://localhost:8001
npm run dev
```

### 3. Start frontend app (port `5173` by default)

```bash
cd frontend
npm install
npm run dev
```

Open the frontend URL from Vite output (typically `http://localhost:5173`).

## API Summary

### Backend (`http://localhost:4000`)

- `GET /api/health` - backend health status
- `GET /api/languages` - supported output languages
- `POST /api/analyze` - analyze pasted document text
- `POST /api/analyze-upload` - analyze uploaded file (base64 payload)

### Extractor (`http://localhost:8001`)

- `GET /health` - extractor health status
- `POST /extract` - multipart upload (`file`) to extract raw text

## Project Structure

```text
.
├── frontend/            # Vue UI
├── backend/             # Express API and analysis logic
│   └── extractor/       # FastAPI file text extraction service
└── README.md
```

## Notes

- DRA provides an automated risk review, not legal advice.
- Always validate high-risk findings with qualified legal counsel before execution/signature.
