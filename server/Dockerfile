FROM python:3.11.5-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy project file
COPY requirements.txt .
COPY start_server.py .
COPY checkpoints/ ./checkpoints/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Start service
CMD ["python", "start_server.py"]