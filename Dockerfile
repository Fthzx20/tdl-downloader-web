# Stage 1: Build Next.js Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY web_frontend/package*.json ./
RUN npm ci
COPY web_frontend/ ./
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Stage 2: Python FastAPI Backend + Runtime
FROM python:3.11-slim
WORKDIR /app

# Install FFmpeg and system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js runtime for Next.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy backend python code and install requirements
COPY web_backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

COPY web_backend/ ./backend/
COPY --from=frontend-builder /app/frontend ./frontend

# Expose Hugging Face default port 7860
EXPOSE 7860

# Startup script: Run FastAPI backend on port 8000 & Next.js frontend on port 7860
CMD sh -c "cd /app/backend && uvicorn server:app --host 0.0.0.0 --port 8000 & cd /app/frontend && PORT=7860 npm start"
