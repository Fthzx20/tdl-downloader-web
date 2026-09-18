# ================= Stage 1: Build Dependencies =================
FROM python:3.11-slim AS builder

WORKDIR /build
ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY web_backend/requirements.txt .
RUN pip install --user --no-warn-script-location -r requirements.txt

# ================= Stage 2: Final Minimal Runtime =================
FROM python:3.11-slim AS final

# Copy static stripped ffmpeg binary (~35MB vs ~200MB+ from apt)
COPY --from=mwader/static-ffmpeg:7.1 /ffmpeg /usr/local/bin/ffmpeg

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/home/appuser/.local/bin:$PATH \
    PORT=8000

# Create dedicated non-root user
RUN useradd -u 10001 -m -s /bin/sh appuser

# Copy installed Python packages from builder
COPY --from=builder --chown=appuser:appuser /root/.local /home/appuser/.local

# Copy backend application source
COPY --chown=appuser:appuser web_backend/ /app

# Ensure temp directories exist
RUN mkdir -p /tmp/Tidal_Temp_Zips /tmp/Tidal_Downloads && \
    chown -R appuser:appuser /tmp/Tidal_Temp_Zips /tmp/Tidal_Downloads

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "server.py"]
