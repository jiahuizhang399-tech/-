# D2 Snapshot

Date: 2026-06-26
Version: D2
Source page: https://jiahuizhang399-tech.github.io/-/v2-local/
Snapshot target: https://jiahuizhang399-tech.github.io/-/d2-2026-06-26/

This snapshot preserves the current reimbursement web app state for future tracing.

Included files:
- index.html
- app.js
- styles.css
- overrides.css
- ocr_server.py
- D2-SNAPSHOT.md

Key preserved behavior:
- V2 local web app at app.js?v=local-v2-rapidocr-30.
- GitHub Pages static web app for reimbursement screenshot and invoice organization.
- Normal single payment screenshots continue to use browser-side OCR.
- WeChat long screenshots use local RapidOCR only when height/width >= 4 or height >= 6000.
- WeChat long screenshot amount thumbnails use dedicated amount crop previews.
- Manual replacement payment screenshots are protected from WeChat longshot thumbnail refresh.
- Search v30 uses visible table fields for short keywords and OCR raw text only for keywords with length >= 4.
- Re-uploading a payment screenshot to an existing row stores screenshotAmount and fills empty date/category/type/amount/description from OCR without overwriting confirmed user values.
- Invoice matching remains strict by amount.
- Export paths synchronize current table values before export.

Local RapidOCR service:
- GET http://127.0.0.1:8765/health
- POST http://127.0.0.1:8765/api/wechat-longshot

Notes:
- This snapshot stores app code, page text, styles, and OCR server source.
- It does not store browser cookies, tokens, passwords, or private uploaded receipt image/PDF contents.
