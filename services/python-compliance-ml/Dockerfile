FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn==0.30.0 \
    pydantic==2.7.0 \
    scikit-learn==1.5.0 \
    numpy==1.26.4

COPY main.py .

EXPOSE 8097

CMD ["python", "main.py"]
