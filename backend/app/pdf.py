"""PDF -> page texts -> chunks (same chunking as the original app: 500 chars, 150 overlap)."""
import io

from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from . import config
from .citations import Passage


def read_pages(data: bytes) -> list[str]:
    reader = PdfReader(io.BytesIO(data))
    return [(page.extract_text() or "") for page in reader.pages]


def chunk_pages(pages: list[str]) -> list[Passage]:
    splitter = RecursiveCharacterTextSplitter(chunk_size=config.CHUNK_SIZE, chunk_overlap=config.CHUNK_OVERLAP)
    chunks = []
    for page_no, text in enumerate(pages, start=1):
        for piece in splitter.split_text(text):
            if piece.strip():
                chunks.append(Passage(text=piece, page=page_no))
    return chunks
