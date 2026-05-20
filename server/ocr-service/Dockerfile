FROM python:3.11-slim

WORKDIR /app

# System dependencies for PaddleOCR and image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxrender1 libxext6 libgl1-mesa-glx \
    poppler-utils tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir paddlepaddle paddleocr docling

COPY main.py .

EXPOSE 8765

CMD ["python", "main.py"]
