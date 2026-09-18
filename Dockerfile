FROM python:3.11-slim

WORKDIR /app

# Install native Debian FFmpeg and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Optimize Python execution
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=3000

# Copy and install dependencies
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r ./requirements.txt

# Copy backend application files
COPY web_backend/ .

# Ensure temp directories exist with full read/write permissions
RUN mkdir -p /tmp/Tidal_Temp_Zips /tmp/Tidal_Downloads && \
    chmod -R 777 /app /tmp

# Expose port (default 3000)
EXPOSE 3000

# Container health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; p=os.environ.get('PORT', '3000'); urllib.request.urlopen(f'http://localhost:{p}/health')" || exit 1

# Run server.py directly using python for robust port parsing and unbuffered logging
CMD ["python", "server.py"]

