import base64
import json
import re
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR


HOST = "127.0.0.1"
PORT = 8765
OCR = RapidOCR()


def detect_rows(img):
    h, w = img.shape[:2]
    x1, x2 = int(w * 0.72), int(w * 0.98)
    min_dark = max(6, int(((x2 - x1) / 3) * 0.018))
    dark_rows = []
    for y in range(int(h * 0.04), int(h * 0.985)):
        roi = img[y, x1:x2:3]
        dark = ((roi[:, 0] < 150) & (roi[:, 1] < 150) & (roi[:, 2] < 150)).sum()
        if dark >= min_dark:
            dark_rows.append(y)

    clusters = []
    for y in dark_rows:
        if clusters and y - clusters[-1][1] <= 3:
            clusters[-1][1] = y
            clusters[-1][2] += 1
        else:
            clusters.append([y, y, 1])

    centers = [round((a + b) / 2) for a, b, c in clusters if c >= 5]
    min_gap = round(w * 0.085)
    merged = []
    for center in centers:
        if not merged or center - merged[-1] >= min_gap:
            merged.append(center)
        else:
            merged[-1] = round((merged[-1] + center) / 2)

    gaps = [b - a for a, b in zip(merged, merged[1:]) if min_gap < b - a < w * 0.35]
    median_gap = sorted(gaps)[len(gaps) // 2] if gaps else round(w * 0.19)
    row_h = round(max(w * 0.15, min(w * 0.24, median_gap * 1.05)))

    rows = []
    for center in merged:
        top = max(0, round(center - row_h * 0.44))
        rows.append((top, min(h, top + row_h)))
    return rows


def parse_amount(text):
    s = text.replace(",", "").replace(" ", "")
    if "+" in s:
        return ""
    match = re.search(r"-?\d{1,6}(?:\.\d{1,2})?", s)
    if not match:
        return ""
    value = abs(float(match.group(0)))
    if value <= 0 or value > 20000:
        return ""
    return f"{value:.2f}"


def parse_date(text, year=2026):
    match = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})[:：](\d{2}))?", text)
    if not match:
        return ""
    month, day = int(match.group(1)), int(match.group(2))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return ""
    return f"{year}-{month:02d}-{day:02d}"


def parse_row_texts(texts):
    amount = ""
    date = ""
    description = ""
    for text in texts:
        amount = amount or parse_amount(text)
        date = date or parse_date(text)
    for text in texts:
        if parse_amount(text) or parse_date(text):
            continue
        if re.search(r"[\u4e00-\u9fa5A-Za-z]{2,}", text):
            description = text
            break
    return date, description, amount


def decode_image(data):
    if isinstance(data, str):
        if "," in data and data[:40].lower().startswith("data:"):
            data = data.split(",", 1)[1]
        raw = base64.b64decode(data)
    else:
        raw = bytes(data)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cannot decode image")
    return img


def row_to_data_url(row):
    ok, encoded = cv2.imencode(".jpg", row, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        return ""
    raw = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/jpeg;base64,{raw}"


def parse_wechat_longshot(data):
    img = data if hasattr(data, "shape") else decode_image(data.get("image"))
    rows = detect_rows(img)
    items = []
    with tempfile.TemporaryDirectory(prefix="wechat_ocr_") as tmp:
        tmp_dir = Path(tmp)
        for index, (top, bottom) in enumerate(rows, start=1):
            row = img[top:bottom, :]
            row_path = tmp_dir / f"row_{index:03d}.jpg"
            cv2.imwrite(str(row_path), row)
            result, _ = OCR(str(row_path))
            texts = [item[1].strip() for item in (result or []) if item[1].strip()]
            date, description, amount = parse_row_texts(texts)
            if amount:
                items.append(
                    {
                        "index": index,
                        "date": date,
                        "description": description,
                        "amount": amount,
                        "rowImage": row_to_data_url(row),
                        "texts": texts,
                    }
                )
    return {"ok": True, "rowCount": len(rows), "count": len(items), "items": items}


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self.send_json({"ok": True, "service": "wechat-longshot-ocr"})
            return
        self.send_json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        if urlparse(self.path).path != "/api/wechat-longshot":
            self.send_json({"ok": False, "error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            content_type = self.headers.get("Content-Type", "")
            if "application/json" in content_type:
                payload = json.loads(body.decode("utf-8"))
                result = parse_wechat_longshot(payload)
            else:
                result = parse_wechat_longshot(decode_image(body))
            self.send_json(result)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)

    def send_json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    server = HTTPServer((HOST, PORT), Handler)
    print(f"RapidOCR server listening on http://{HOST}:{PORT}")
    print("Health check: http://127.0.0.1:8765/health")
    print("Wechat longshot API: POST http://127.0.0.1:8765/api/wechat-longshot")
    server.serve_forever()


if __name__ == "__main__":
    main()
