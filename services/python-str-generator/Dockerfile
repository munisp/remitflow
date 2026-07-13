FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn[standard]==0.30.1 \
    asyncpg==0.29.0 \
    pydantic==2.7.1 \
    reportlab==4.2.0 \
    kafka-python==2.0.2

COPY main.py .

EXPOSE 8210

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8210"]
