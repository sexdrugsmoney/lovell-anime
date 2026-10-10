FROM python:3.11-slim

WORKDIR /app

# curl-cffi için gerekli sistem bağımlılıkları
RUN apt-get update && apt-get install -y \
    curl \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10000"]
