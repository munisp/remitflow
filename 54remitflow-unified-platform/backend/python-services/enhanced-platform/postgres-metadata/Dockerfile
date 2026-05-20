FROM python:3.11-slim

WORKDIR /app

RUN pip install flask flask-cors

COPY src/ ./src/

EXPOSE 5433

CMD ["python", "src/metadata_service.py"]
