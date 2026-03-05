# DRA Extractor Service

This FastAPI service extracts plain text from legal documents so the DRA analyzer can process them.

## Supported files

- `.txt`
- `.pdf`
- `.docx`

## Run locally

```bash
cd backend/extractor
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8001
```

## API

- `GET /health`
- `POST /extract` with multipart form field `file`
