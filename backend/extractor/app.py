from __future__ import annotations

import io
from pathlib import Path

from docx import Document
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PyPDF2 import PdfReader


app = FastAPI(title="DRA Extractor", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".docx"}


def extract_text_from_txt(content: bytes) -> str:
    return content.decode("utf-8", errors="replace")


def extract_text_from_pdf(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def extract_text_from_docx(content: bytes) -> str:
    doc = Document(io.BytesIO(content))
    return "\n".join(paragraph.text for paragraph in doc.paragraphs)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/extract")
async def extract(file: UploadFile = File(...)) -> dict[str, str]:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Use one of: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        if extension == ".txt":
            text = extract_text_from_txt(content)
        elif extension == ".pdf":
            text = extract_text_from_pdf(content)
        else:
            text = extract_text_from_docx(content)
    except Exception as error:  # pragma: no cover - unexpected parser failure path
        raise HTTPException(status_code=500, detail=f"Failed to parse document: {error}") from error

    text = text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="No readable text found in the uploaded file.")

    return {
        "filename": file.filename or "uploaded-document",
        "text": text,
    }
