FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libxcb1 libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
# arm64 上 insightface 若没有现成 wheel 需要本地编译，装编译器，装完同一层清掉
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
# 构建时就把模型下载好，运行时不用联网
ARG FACE_MODEL=buffalo_s
ENV FACE_MODEL=${FACE_MODEL} FACE_MODEL_DIR=/models
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='${FACE_MODEL}', root='/models', providers=['CPUExecutionProvider']).prepare(ctx_id=-1)"
COPY app.py .
EXPOSE 8000
CMD ["gunicorn", "-b", "0.0.0.0:8000", "-w", "1", "--threads", "2", "-t", "120", "app:app"]
