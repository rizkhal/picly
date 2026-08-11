FROM python:3.11-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY services/face-search/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy app (entry point + package)
COPY services/face-search/main.py ./
COPY services/face-search/app ./app

# Create uploads dir
RUN mkdir -p /tmp/picly_uploads

EXPOSE 8000

CMD ["python", "main.py"]
