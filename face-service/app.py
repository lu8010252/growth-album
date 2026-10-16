"""成长册 · 自建人脸识别服务

实现 README 里约定的 POST /identify：
  请求  {"date","candidates":[{"id","name","refs":[base64 jpg,...]}],"images":[base64 jpg,...]}
  返回  {"results":[{"kidIds":[...], "faces":[{"box":[x1,y1,x2,y2],"best":"id","score":0.52}]}, ...]}

做法：InsightFace（ArcFace）给每张脸算 512 维向量 → 与每个孩子的参考照片比余弦相似度 →
每张脸只归给最像的那个孩子，且相似度要过阈值。全部在本机 CPU 上跑，照片不出你的服务器。
"""
import base64
import hashlib
import os
import threading
from collections import OrderedDict

import cv2
import numpy as np
from flask import Flask, jsonify, request
from insightface.app import FaceAnalysis

MODEL = os.environ.get("FACE_MODEL", "buffalo_s")          # buffalo_s 小而快；buffalo_l 更准但更吃内存
ROOT = os.environ.get("FACE_MODEL_DIR", "/models")
THRESHOLD = float(os.environ.get("THRESHOLD", "0.38"))     # 余弦相似度阈值：调低＝更容易认出（也更容易认错）
MIN_FACE = int(os.environ.get("MIN_FACE", "40"))           # 小于这个宽度（像素）的脸不识别
KEY = os.environ.get("FACE_KEY", "")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024
fa = FaceAnalysis(name=MODEL, root=ROOT, providers=["CPUExecutionProvider"])
fa.prepare(ctx_id=-1, det_size=(640, 640))
lock = threading.Lock()                                    # onnxruntime 会话串行使用，简单稳妥
cache = OrderedDict()                                      # 参考照片向量缓存：sha1 -> 向量或 None


def decode(b64):
    arr = np.frombuffer(base64.b64decode(b64), np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def faces_of(img):
    with lock:
        return fa.get(img)


def ref_embedding(b64):
    h = hashlib.sha1(b64.encode()).hexdigest()
    if h in cache:
        cache.move_to_end(h)
        return cache[h]
    emb = None
    img = decode(b64)
    if img is not None:
        fs = faces_of(img)
        if fs:  # 参考照里有多张脸时取最大的
            f = max(fs, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
            emb = f.normed_embedding
    cache[h] = emb
    while len(cache) > 500:
        cache.popitem(last=False)
    return emb


@app.get("/health")
def health():
    return jsonify(ok=True, model=MODEL, threshold=THRESHOLD)


@app.post("/identify")
def identify():
    if KEY and request.headers.get("Authorization", "") != "Bearer " + KEY:
        return jsonify(error="unauthorized"), 401
    d = request.get_json(silent=True) or {}
    cands, warnings = [], []
    for c in d.get("candidates", []):
        embs = [e for e in (ref_embedding(r) for r in c.get("refs", [])) if e is not None]
        if len(embs) < len(c.get("refs", [])):
            warnings.append(f"{c.get('name')}：有 {len(c.get('refs', [])) - len(embs)} 张参考照里没检测到人脸")
        if embs:
            cands.append((c["id"], np.stack(embs)))
    results = []
    for b64 in d.get("images", []):
        ids, faces = set(), []
        img = decode(b64)
        for f in (faces_of(img) if img is not None else []):
            x1, y1, x2, y2 = [float(v) for v in f.bbox]
            if x2 - x1 < MIN_FACE:
                continue
            best, score = None, -1.0
            for cid, embs in cands:
                s = float(np.max(embs @ f.normed_embedding))   # 与该孩子所有参考照里最像的一张比
                if s > score:
                    best, score = cid, s
            ok = best is not None and score >= THRESHOLD
            if ok:
                ids.add(best)
            faces.append({"box": [round(x1), round(y1), round(x2), round(y2)], "best": best, "score": round(score, 3), "match": ok})
        results.append({"kidIds": sorted(ids), "faces": faces})
    return jsonify(results=results, warnings=warnings)
