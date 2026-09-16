FROM python:3.11-slim

WORKDIR /app

# Install minimal ffmpeg and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Optimize Python execution
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

# Copy and install dependencies
COPY web_backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r ./requirements.txt

# Copy backend application files
COPY web_backend/ .

# Ensure permissions are open so container runs smoothly under root or non-root user
RUN chmod -R 777 /app /tmp

# Expose port (default 8000)
EXPOSE 8000

# Run server.py directly using python for robust port parsing and unbuffered logging
CMD ["python", "server.py"]
