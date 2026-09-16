FROM python:3.11-slim

WORKDIR /app

# Install minimal ffmpeg and curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Optimize Python execution
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application files
COPY . .

# Expose port (default 8000)
EXPOSE 8000

# Run uvicorn with 1 worker to save RAM on 512MB free tier
CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
