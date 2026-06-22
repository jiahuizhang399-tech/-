const categories = ["交通费", "差旅费", "餐费", "物料费", "其他费用"];
const categoryRules = [
  { category: "交通费", type: "加油费", words: ["加油", "油费", "油站", "中石油", "中国石油", "中石化", "中国石化", "便利店"] },
  { category: "交通费", type: "高速费", words: ["高速", "通行费", "通行费用", "通行", "etc", "收费站", "收费所", "停车区", "服务区", "隧道", "公路联网收费", "联网收费", "清分结算"] },
  { category: "交通费", type: "停车费", words: ["停车"] },
  { category: "交通费", type: "打车费", words: ["滴滴", "出租", "网约车", "出行"] },
  { category: "差旅费", type: "住宿费", words: ["酒店", "宾馆", "民宿", "客栈", "住宿", "携程", "去哪儿", "飞猪", "旅店", "公寓"] },
  { category: "餐费", type: "餐费", words: ["餐", "饭", "咖啡", "美食", "luckin", "午餐"] },
  { category: "物料费", type: "物料采购", words: ["采购", "道具", "设备", "耗材", "快递"] },
];

let items = [];
const draftKey = "reimbursement-draft-v2";
const wechatLongOcrKey = "wechat-long-ocr-v2";
let dirty = false;
let restoringDraft = false;
let suppressBeforeUnload = false;
const $ = (selector) => document.querySelector(selector);
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const invoiceBatchInput = $("#invoiceBatchInput");
const invoiceDropZone = $("#invoiceDropZone");
const wechatBillInput = $("#wechatBillInput");
const wechatBillDropZone = $("#wechatBillDropZone");
const wechatShotInput = $("#wechatShotInput");
const wechatShotDropZone = $("#wechatShotDropZone");
const statusBar = $("#statusBar");
const tableBody = $("#itemsTable tbody");
const imageViewer = $("#imageViewer");
const viewerImage = $("#viewerImage");
const viewerCaption = $("#viewerCaption");
const textViewer = $("#textViewer");
const rawText = $("#rawText");
const pdfViewer = $("#pdfViewer");
const pdfPages = $("#pdfPages");
const pdfViewerTitle = $("#pdfViewerTitle");
let pdfPreviewRun = 0;

invoiceBatchInput.multiple = true;
invoiceBatchInput.setAttribute("multiple", "");
invoiceBatchInput.accept = "application/pdf,.pdf,*/*";
fileInput.addEventListener("change", (event) => handleFiles(event.target.files));
fileInput.addEventListener("click", () => { fileInput.value = ""; });
invoiceBatchInput.addEventListener("change", (event) => handleInvoiceFiles(event.target.files));
invoiceBatchInput.addEventListener("click", () => { invoiceBatchInput.value = ""; });
if (wechatBillInput) {
  wechatBillInput.addEventListener("change", (event) => handleWechatBillFile(event.target.files?.[0]));
  wechatBillInput.addEventListener("click", () => { wechatBillInput.value = ""; });
}
if (wechatShotInput) {
  wechatShotInput.addEventListener("change", (event) => handleWechatBillScreenshots(event.target.files));
  wechatShotInput.addEventListener("click", () => { wechatShotInput.value = ""; });
}
for (const zone of [dropZone, invoiceDropZone, wechatBillDropZone, wechatShotDropZone].filter(Boolean)) {
  ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove("dragover"); }));
}
dropZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));
invoiceDropZone.addEventListener("drop", (event) => handleInvoiceFiles(event.dataTransfer.files));
if (wechatBillDropZone) wechatBillDropZone.addEventListener("drop", (event) => handleWechatBillFile(event.dataTransfer.files?.[0]));
if (wechatShotDropZone) wechatShotDropZone.addEventListener("drop", (event) => handleWechatBillScreenshots(event.dataTransfer.files));
$("#projectInput").addEventListener("input", () => { renderAll(); markDirtyAndSave(); });
$("#personInput").addEventListener("input", () => { renderAll(); markDirtyAndSave(); });
$("#addItemBtn").addEventListener("click", addManualItem);
$("#saveDraftBtn").addEventListener("click", () => saveDraft(true));
$("#restoreDraftBtn").addEventListener("click", () => restoreDraft(true));
$("#clearDraftBtn").addEventListener("click", clearDraft);
$("#clearBtn").addEventListener("click", () => {
  if (!items.length) return setStatus("当前没有可清空的明细。");
  if (!confirm("确认清空所有待确认明细吗？此操作不可恢复。")) return;
  items.forEach(revokeInvoiceUrl);
  items = [];
  fileInput.value = "";
  invoiceBatchInput.value = "";
  dirty = false;
  saveDraft(false);
  setStatus("已清空，等待上传截图。");
  renderAll();
});
$("#exportCsvBtn").addEventListener("click", exportCsv);
$("#exportXlsxBtn").addEventListener("click", exportXlsx);
$("#exportScreenshotsBtn").addEventListener("click", exportScreenshotsDoc);
$("#exportInvoicesBtn").addEventListener("click", exportInvoicesPdf);
$("#exportReportPreviewBtn").addEventListener("click", exportReportPreviewImage);
$("#viewerClose").addEventListener("click", closeImageViewer);
$("#textClose").addEventListener("click", closeTextViewer);
$("#pdfClose").addEventListener("click", closePdfViewer);
imageViewer.addEventListener("click", (event) => { if (event.target === imageViewer) closeImageViewer(); });
textViewer.addEventListener("click", (event) => { if (event.target === textViewer) closeTextViewer(); });
pdfViewer.addEventListener("click", (event) => { if (event.target === pdfViewer) closePdfViewer(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeImageViewer(); closeTextViewer(); closePdfViewer(); } });
window.addEventListener("beforeunload", (event) => { if (suppressBeforeUnload || !dirty || !hasDraftableData()) return; event.preventDefault(); event.returnValue = ""; });
restoreDraft(false);
setTimeout(resumeWechatLongOcrIfNeeded, 600);

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    setStatus(`正在识别 ${index + 1}/${files.length}：${file.name}`);
    const imageUrl = await imageFileToDraftDataUrl(file);
    let screenshotPreviewUrl = imageUrl;
    let text = "";
    try {
      const images = await prepareImageForOcr(file);
      const recognized = await recognizePaymentImage(images, file.name);
      text = recognized.text;
      const parsedPreview = parsePaymentText(text, file.name);
      screenshotPreviewUrl = await imageFileToAmountPreviewDataUrl(file, selectBestAmountPreviewBox(recognized.amountPreviewCandidates, parsedPreview.amount, images.fullWidth, images.fullHeight), images.fullWidth, images.fullHeight) || imageUrl;
    } catch (error) {
      console.error(error);
      setStatus(`OCR 识别失败：${file.name}。已创建空白行，可手动填写。`);
    }
    const parsed = parsePaymentText(text, file.name);
    items.push({ id: crypto.randomUUID(), fileName: file.name, imageUrl, screenshotPreviewUrl, rawText: `${text}\n__AMOUNT_EXPLAIN__ ${explainPaymentAmount(text)}`, screenshotAmount: parsed.amount, invoiceFile: null, invoiceFileName: "", invoiceFileUrl: "", invoiceLink: "", invoiceAmount: "", ...parsed });
    markDirtyAndSave();
    renderAll();
  }
  const missing = items.filter((item) => !item.amount).length;
  setStatus(missing ? `已处理 ${files.length} 张截图，其中 ${missing} 条未识别到金额。` : `已处理 ${files.length} 张截图。`);
}

async function handleWechatBillFile(file) {
  if (!file) return;
  if (!window.XLSX) return setStatus("Excel 解析组件还没有加载完成，请稍后再导入微信账单。");
  if (!/\.xlsx$/i.test(file.name)) return setStatus("请导入微信导出的 .xlsx 账单文件。");
  setStatus(`正在导入微信账单：${file.name}`);
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const imported = importWechatBillRows(rows, file.name);
    markDirtyAndSave();
    renderAll();
    setStatus(imported.skipped ? `已导入微信账单 ${imported.count} 条支出，跳过退款/收入/无效记录 ${imported.skipped} 条。请继续补完整付款截图。` : `已导入微信账单 ${imported.count} 条支出。请继续补完整付款截图。`);
  } catch (error) {
    console.error(error);
    setStatus("微信账单导入失败，请确认文件是微信导出的 .xlsx 账单。");
  } finally {
    if (wechatBillInput) wechatBillInput.value = "";
  }
}

async function handleWechatBillScreenshots(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return setStatus("请选择微信账单列表截图。");
  setStatus(`已接收到 ${files.length} 张微信账单截图，开始切分单行截图...`);
  let total = 0;
  let matchedExcelScreenshots = 0;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    setStatus(`正在切分微信账单截图 ${fileIndex + 1}/${files.length}：${file.name}`);
    const localParsed = await tryLocalWechatLongshotOcr(file);
    if (localParsed) {
      await importLocalWechatLongshotResult(localParsed, file.name);
      total += localParsed.rowCount || localParsed.items.length;
      renderAll();
      markDirtyAndSave();
      continue;
    }
    const rowImages = await splitWechatBillScreenshot(file);
    const longShotAmounts = rowImages.length > 30 ? await recognizeWechatLongScreenshotAmounts(file) : [];
    const excelMatches = rowImages.length > 30 ? matchWechatLongScreenshotWithExcel(longShotAmounts) : [];
    const longShotDetails = [];
    const longShotDates = [];
    const createdLongRows = [];
    for (let index = 0; index < rowImages.length; index += 1) {
      const imageUrl = rowImages[index];
      const presetAmount = longShotAmounts[index] || "";
      const excelMatch = excelMatches[index] || null;
      const presetDetail = longShotDetails[index] || {};
      const id = crypto.randomUUID();
      if (rowImages.length > 30 && !presetAmount) continue;
      if (rowImages.length > 30 && excelMatch?.id) {
        const matchedItem = items.find((item) => item.id === excelMatch.id);
        if (matchedItem) {
          matchedItem.fileName = `${file.name} #${index + 1}`;
          matchedItem.imageUrl = imageUrl;
          matchedItem.screenshotPreviewUrl = imageUrl;
          matchedItem.rawText = `${matchedItem.rawText}\n微信长截图已匹配：${file.name} 第 ${index + 1} 条\n截图金额：${presetAmount}`;
          matchedExcelScreenshots += 1;
        }
        continue;
      }
      const presetDescription = excelMatch?.description || presetDetail.description || `微信账单截图第 ${index + 1} 条`;
      const presetDate = excelMatch?.date || longShotDates[index] || presetDetail.date || "";
      const cat = guessCategory(normalizeText(presetDescription));
      items.push({
        id,
        fileName: `${file.name} #${index + 1}`,
        imageUrl,
        screenshotPreviewUrl: imageUrl,
        rawText: `微信账单列表截图导入：${file.name}\n第 ${index + 1} 条\n说明：${presetDescription}\n日期：${presetDate}\n金额：${presetAmount}${excelMatch ? "\n已按微信 Excel 明细自动匹配日期和说明。" : ""}`,
        date: presetDate,
        category: cat.category,
        type: cat.type,
        amount: presetAmount,
        screenshotAmount: presetAmount,
        description: presetDescription,
        invoiceFile: null,
        invoiceFileName: "",
        invoiceFileUrl: "",
        invoiceLink: "",
        invoiceAmount: "",
        invoice: "待补",
        source: "微信列表截图",
      });
      if (rowImages.length > 30) createdLongRows.push({ id, imageUrl, index });
    }
    total += rowImages.length;
    renderAll();
    if (rowImages.length > 30 && !excelMatches.some(Boolean)) {
      setStatus(`已从微信长截图切出 ${rowImages.length} 行并填入金额。要识别准确日期和说明，请先启动本地 RapidOCR 服务：python3 ocr_server.py`);
    }
    else await recognizeWechatBillRowsSequentially(file.name, rowImages.length, false);
  }
  markDirtyAndSave();
  if (wechatShotInput) wechatShotInput.value = "";
  setStatus(matchedExcelScreenshots ? `已从微信账单截图切出 ${total} 条单行截图，已按微信 Excel 自动匹配 ${matchedExcelScreenshots} 条截图，并使用 Excel 的准确日期和说明。` : `已从微信账单截图切出 ${total} 条单行截图，已先填入金额；说明和日期正在后台自动补识别。`);
}

async function tryLocalWechatLongshotOcr(file) {
  try {
    setStatus(`正在调用本地 RapidOCR 服务识别微信长截图：${file.name}`);
    const response = await fetch("http://127.0.0.1:8765/api/wechat-longshot", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result || !Array.isArray(result.items) || !result.items.length) return null;
    setStatus(`本地 RapidOCR 已识别 ${result.items.length}/${result.rowCount || result.items.length} 条微信账单。`);
    return result;
  } catch (error) {
    console.warn("本地 RapidOCR 服务不可用，回退浏览器识别。", error);
    setStatus("本地 RapidOCR 服务未启动，回退到浏览器金额识别。若要准确日期和说明，请先启动 ocr_server.py。");
    return null;
  }
}

async function importLocalWechatLongshotResult(result, fileName) {
  await importLocalWechatLongshotResultInChunks(result, fileName);
}

async function importLocalWechatLongshotResultInChunks(result, fileName) {
  const entries = result.items || [];
  for (let start = 0; start < entries.length; start += 15) {
    setStatus(`正在写入本地 RapidOCR 识别结果 ${Math.min(start + 15, entries.length)}/${entries.length}：${fileName}`);
    for (const entry of entries.slice(start, start + 15)) {
      addLocalWechatLongshotItem(entry, fileName);
    }
    markDirtyAndSave();
    renderAll();
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  setStatus(`已通过本地 RapidOCR 从 ${fileName} 识别 ${entries.length} 条，包含日期、说明和金额。`);
}

function addLocalWechatLongshotItem(entry, fileName) {
    const description = entry.description || `微信账单截图第 ${entry.index || items.length + 1} 条`;
    const cat = guessCategory(normalizeText(description));
    items.push({
      id: crypto.randomUUID(),
      fileName: `${fileName} #${entry.index || items.length + 1}`,
      imageUrl: entry.rowImage || "",
      screenshotPreviewUrl: entry.rowImage || "",
      rawText: `本地 RapidOCR 识别：${fileName}\n第 ${entry.index || ""} 条\n${entry.rawText || ""}`,
      date: entry.date || "",
      category: cat.category,
      type: cat.type,
      amount: entry.amount || "",
      screenshotAmount: entry.amount || "",
      description,
      invoiceFile: null,
      invoiceFileName: "",
      invoiceFileUrl: "",
      invoiceLink: "",
      invoiceAmount: "",
      invoice: "待补",
      source: "微信长截图RapidOCR",
    });
}

function startWechatLongOcrJob(fileName, ids) {
  const chunks = [];
  const rowsPerChunk = 5;
  for (let index = 0; index < ids.length; index += rowsPerChunk) chunks.push(ids.slice(index, index + rowsPerChunk));
  localStorage.setItem(wechatLongOcrKey, JSON.stringify({ fileName, ids, chunks, chunkIndex: 0, startedAt: new Date().toISOString() }));
  setStatus(`已先填入金额，共 ${ids.length} 行，将按每段 ${rowsPerChunk} 行切成 ${chunks.length} 段继续识别说明和日期：${fileName}`);
}

function matchWechatLongScreenshotWithExcel(amounts) {
  const excelItems = items
    .filter((item) => item.source === "微信Excel" && item.amount)
    .map((item) => ({ id: item.id, amount: item.amount, date: item.date, description: item.description, used: false }));
  if (!excelItems.length) return [];
  const result = [];
  let cursor = 0;
  for (const amount of amounts) {
    if (!amount) { result.push(null); continue; }
    let matchIndex = -1;
    for (let i = cursor; i < excelItems.length; i += 1) {
      if (!excelItems[i].used && sameMoney(excelItems[i].amount, amount)) { matchIndex = i; break; }
    }
    if (matchIndex < 0) {
      for (let i = 0; i < excelItems.length; i += 1) {
        if (!excelItems[i].used && sameMoney(excelItems[i].amount, amount)) { matchIndex = i; break; }
      }
    }
    if (matchIndex >= 0) {
      excelItems[matchIndex].used = true;
      cursor = Math.max(cursor, matchIndex + 1);
      result.push({ id: excelItems[matchIndex].id, date: excelItems[matchIndex].date, description: excelItems[matchIndex].description });
    } else {
      result.push(null);
    }
  }
  return result;
}

function sameMoney(a, b) {
  const left = normalizeAmount(a);
  const right = normalizeAmount(b);
  return left && right && Math.abs(left - right) < 0.005;
}

async function resumeWechatLongOcrIfNeeded() {
  const raw = localStorage.getItem(wechatLongOcrKey);
  if (!raw) return;
  let job;
  try { job = JSON.parse(raw); } catch { localStorage.removeItem(wechatLongOcrKey); return; }
  const chunks = Array.isArray(job.chunks) ? job.chunks : [];
  const chunkIndex = Number(job.chunkIndex || 0);
  if (!chunks.length || chunkIndex >= chunks.length) { localStorage.removeItem(wechatLongOcrKey); return; }
  const slice = chunks[chunkIndex] || [];
  const rows = slice.map((id, offset) => {
    const item = items.find((entry) => entry.id === id);
    return item ? { id, imageUrl: item.imageUrl, index: chunkIndex * 5 + offset } : null;
  }).filter(Boolean);
  if (!rows.length) { localStorage.removeItem(wechatLongOcrKey); return; }
  try {
    setStatus(`正在识别微信长截图第 ${chunkIndex + 1}/${chunks.length} 段，本段 ${rows.length} 行：${job.fileName}`);
    const details = await recognizeWechatLongRowBatch(rows);
    for (const detail of details) applyWechatLongOcrDetail(detail);
    job.chunkIndex = chunkIndex + 1;
    localStorage.setItem(wechatLongOcrKey, JSON.stringify(job));
    markDirtyAndSave();
    renderAll();
    if (job.chunkIndex >= chunks.length) {
      localStorage.removeItem(wechatLongOcrKey);
      setStatus(`微信长截图说明和日期识别完成：${job.fileName}，共 ${chunks.length} 段。`);
      return;
    }
    setStatus(`已完成第 ${job.chunkIndex}/${chunks.length} 段，正在自动刷新释放内存后继续下一段。`);
    setTimeout(() => { suppressBeforeUnload = true; window.location.reload(); }, 1200);
  } catch (error) {
    console.error(error);
    setStatus(`说明和日期识别中断：${String(error?.message || error)}。刷新页面后会从当前进度继续。`);
  }
}

function applyWechatLongOcrDetail(detail) {
  const item = items.find((entry) => entry.id === detail.id);
  if (!item) return;
  if (detail.description) {
    item.description = detail.description;
    const cat = guessCategory(normalizeText(detail.description));
    item.category = cat.category;
    item.type = cat.type;
  }
  if (detail.date) item.date = detail.date;
  item.rawText = `${item.rawText}\n自动分段识别说明：${detail.description || ""}\n自动分段识别日期：${detail.date || ""}`;
}

async function recognizeWechatLongRowsInBatches(fileName, rows) {
  if (!window.Tesseract || !rows.length) return;
  const batchSize = 1;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    setStatus(`正在补识别微信长截图说明和日期 ${Math.min(start + batch.length, rows.length)}/${rows.length}：${fileName}`);
    const details = await recognizeWechatLongRowBatch(batch);
    for (const detail of details) {
      const item = items.find((entry) => entry.id === detail.id);
      if (!item) continue;
      if (detail.description) {
        item.description = detail.description;
        const cat = guessCategory(normalizeText(detail.description));
        item.category = cat.category;
        item.type = cat.type;
      }
      if (detail.date) item.date = detail.date;
      item.rawText = `${item.rawText}\n补识别说明：${detail.description || ""}\n补识别日期：${detail.date || ""}`;
    }
    markDirtyAndSave();
    renderAll();
    const restMs = (start + batch.length) % 10 === 0 ? 10000 : 2500;
    setStatus(`已补识别微信长截图说明和日期 ${Math.min(start + batch.length, rows.length)}/${rows.length}，${restMs >= 10000 ? "休息 10 秒后继续，防止浏览器卡死。" : "继续处理中。"}`);
    await new Promise((resolve) => setTimeout(resolve, restMs));
  }
  setStatus(`微信长截图说明和日期补识别完成：${fileName}，共 ${rows.length} 条。`);
}

async function recognizeWechatLongRowBatch(rows) {
  const rowHeight = 132;
  const canvas = document.createElement("canvas");
  canvas.width = 1120;
  canvas.height = rows.length * rowHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const loaded = await Promise.all(rows.map((row) => loadImage(row.imageUrl)));
  loaded.forEach((image, index) => {
    const sourceX = Math.round(image.naturalWidth * 0.145);
    const sourceY = Math.round(image.naturalHeight * 0.04);
    const sourceWidth = Math.round(image.naturalWidth * 0.58);
    const sourceHeight = Math.round(image.naturalHeight * 0.78);
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, index * rowHeight + 10, canvas.width, rowHeight - 20);
  });
  thresholdCanvas(ctx, canvas.width, canvas.height, 224);
  try {
    const blob = dataUrlToBlob(canvas.toDataURL("image/png"));
    let result;
    if (Tesseract.createWorker) {
      const worker = await Tesseract.createWorker("chi_sim+eng");
      try {
        result = await worker.recognize(blob);
      } finally {
        await worker.terminate();
      }
    } else {
      result = await Tesseract.recognize(blob, "chi_sim+eng");
    }
    const output = rows.map((row) => ({ id: row.id, description: "", date: "" }));
    const lines = Array.isArray(result.data?.lines) && result.data.lines.length ? result.data.lines : [];
    for (const line of lines) {
      const text = cleanWechatOcrLine(line.text);
      if (!text) continue;
      const rowIndex = Math.max(0, Math.min(output.length - 1, Math.floor(Number(line.bbox?.y0 ?? 0) / rowHeight)));
      const date = normalizeWechatFutureDate(parseWechatRowDate(text));
      if (date) output[rowIndex].date = date;
      else if (!output[rowIndex].description && /[\u4e00-\u9fa5a-zA-Z]{2,}/.test(text)) output[rowIndex].description = cleanProductName(text);
    }
    return output;
  } catch (error) {
    console.error(error);
    return rows.map((row) => ({ id: row.id, description: "", date: "" }));
  }
}

function cleanWechatOcrLine(value) {
  return String(value || "")
    .replace(/[|｜]/g, "")
    .replace(/[﹣－—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function recognizeWechatLongScreenshotAmounts(file) {
  if (!window.Tesseract) return [];
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const bounds = detectWechatBillRowBounds(image);
    if (!bounds.length) return [];
    const rowHeight = 78;
    const sourceX = Math.round(image.naturalWidth * 0.70);
    const sourceWidth = Math.round(image.naturalWidth * 0.30);
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = bounds.length * rowHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    bounds.forEach((bound, index) => {
      const cropHeight = Math.round(bound.height * 0.62);
      ctx.drawImage(image, sourceX, bound.top, sourceWidth, cropHeight, 0, index * rowHeight + 8, canvas.width, rowHeight - 16);
    });
    const result = await Tesseract.recognize(dataUrlToBlob(canvas.toDataURL("image/jpeg", 0.95)), "eng", { tessedit_char_whitelist: "0123456789.,-+¥￥ \n" });
    const lines = String(result.data.text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const amounts = [];
    for (const line of lines) {
      if (/\+/.test(line)) { amounts.push(""); continue; }
      amounts.push(parseWechatRowAmount(line));
    }
    while (amounts.length < bounds.length) amounts.push("");
    return amounts.slice(0, bounds.length);
  } catch (error) {
    console.error(error);
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function recognizeWechatLongScreenshotDetails(file) {
  if (!window.Tesseract) return [];
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const bounds = detectWechatBillRowBounds(image);
    if (!bounds.length) return [];
    const rowHeight = 132;
    const sourceX = Math.round(image.naturalWidth * 0.145);
    const sourceWidth = Math.round(image.naturalWidth * 0.56);
    const canvas = document.createElement("canvas");
    canvas.width = 1120;
    canvas.height = bounds.length * rowHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    bounds.forEach((bound, index) => {
      const top = Math.max(0, bound.top + Math.round(bound.height * 0.06));
      const cropHeight = Math.round(bound.height * 0.72);
      ctx.drawImage(image, sourceX, top, sourceWidth, cropHeight, 0, index * rowHeight + 10, canvas.width, rowHeight - 20);
    });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
      const value = gray < 214 ? 0 : 255;
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
    }
    ctx.putImageData(pixels, 0, 0);
    const result = await Tesseract.recognize(dataUrlToBlob(canvas.toDataURL("image/jpeg", 0.95)), "chi_sim+eng");
    const details = Array.from({ length: bounds.length }, () => ({ description: "", date: "" }));
    const lines = Array.isArray(result.data?.lines) && result.data.lines.length ? result.data.lines : [];
    if (lines.length) {
      for (const line of lines) {
        const text = String(line.text || "").trim();
        if (!text) continue;
        const y = Number(line.bbox?.y0 ?? line.bbox?.y ?? 0);
        const rowIndex = Math.max(0, Math.min(details.length - 1, Math.floor(y / rowHeight)));
        if (/\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text) || /\d{1,2}[:：]\d{2}/.test(text)) {
          details[rowIndex].date = normalizeWechatFutureDate(parseWechatRowDate(text)) || details[rowIndex].date;
        } else if (/[ -\u4e00-\u9fa5]{2,}/.test(text) && !details[rowIndex].description) {
          details[rowIndex].description = cleanProductName(text);
        }
      }
    } else {
      const textLines = String(result.data?.text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
      let rowIndex = 0;
      for (const text of textLines) {
        if (rowIndex >= details.length) break;
        if (/\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}[:：]\d{2}/.test(text)) {
          details[rowIndex].date = normalizeWechatFutureDate(parseWechatRowDate(text)) || details[rowIndex].date;
          rowIndex += 1;
        } else if (!details[rowIndex].description) {
          details[rowIndex].description = cleanProductName(text);
        }
      }
    }
    return details;
  } catch (error) {
    console.error(error);
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function recognizeWechatLongScreenshotDates(file) {
  if (!window.Tesseract) return [];
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const bounds = detectWechatBillRowBounds(image);
    if (!bounds.length) return [];
    const rowHeight = 92;
    const sourceX = Math.round(image.naturalWidth * 0.12);
    const sourceWidth = Math.round(image.naturalWidth * 0.42);
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = bounds.length * rowHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    bounds.forEach((bound, index) => {
      const top = Math.max(0, bound.top + Math.round(bound.height * 0.40));
      const cropHeight = Math.round(bound.height * 0.34);
      ctx.drawImage(image, sourceX, top, sourceWidth, cropHeight, 0, index * rowHeight + 12, canvas.width, rowHeight - 24);
    });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
      const value = gray < 226 ? 0 : 255;
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
    }
    ctx.putImageData(pixels, 0, 0);
    const result = await Tesseract.recognize(dataUrlToBlob(canvas.toDataURL("image/png")), "chi_sim+eng", { tessedit_char_whitelist: "0123456789年月日:： " });
    const dates = Array.from({ length: bounds.length }, () => "");
    const lines = Array.isArray(result.data?.lines) && result.data.lines.length ? result.data.lines : [];
    if (lines.length) {
      for (const line of lines) {
        const text = String(line.text || "").trim();
        const date = normalizeWechatFutureDate(parseWechatRowDate(text));
        if (!date) continue;
        const y = Number(line.bbox?.y0 ?? line.bbox?.y ?? 0);
        const rowIndex = Math.max(0, Math.min(dates.length - 1, Math.floor(y / rowHeight)));
        dates[rowIndex] = date;
      }
    } else {
      String(result.data?.text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
        if (index < dates.length) dates[index] = normalizeWechatFutureDate(parseWechatRowDate(line));
      });
    }
    return dates;
  } catch (error) {
    console.error(error);
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function recognizeWechatBillRowsSequentially(fileName, expectedCount, fastMode = false) {
  const pending = items.filter((item) => item.source === "微信列表截图" && item.fileName.startsWith(`${fileName} #`) && /^微信账单截图第/.test(item.description));
  const workerState = { worker: null };
  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index];
    setStatus(`正在 OCR 识别微信账单 ${index + 1}/${expectedCount}：${fileName}`);
    const parsed = fastMode ? await recognizeWechatBillRowAmountOnly(entry.imageUrl, index, fileName) : await recognizeWechatBillRow(entry.imageUrl, index, fileName, workerState);
    const itemIndex = items.findIndex((item) => item.id === entry.id);
    const item = items[itemIndex];
    if (!item || item.source !== "微信列表截图") continue;
    if (parsed.skip) {
      items.splice(itemIndex, 1);
    } else {
      const cat = guessCategory(normalizeText(parsed.description));
      item.rawText = parsed.rawText;
      item.date = parsed.date || item.date;
      item.category = cat.category;
      item.type = cat.type;
      item.amount = parsed.amount || item.amount;
      item.screenshotAmount = parsed.amount || item.screenshotAmount;
      item.description = parsed.description || item.description;
    }
    if (index % 2 === 0 || index === pending.length - 1) {
      markDirtyAndSave();
      renderAll();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (workerState.worker && index > 0 && index % 20 === 0) {
      await workerState.worker.terminate();
      workerState.worker = null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (workerState.worker) await workerState.worker.terminate();
}

async function recognizeWechatBillRowAmountOnly(imageUrl, index, fileName) {
  const fallback = {
    description: `微信账单截图第 ${index + 1} 条`,
    date: "",
    amount: "",
    skip: true,
    rawText: `微信账单长截图导入：${fileName}\n第 ${index + 1} 条。金额 OCR 未执行。`,
  };
  if (!window.Tesseract) return fallback;
  try {
    const image = await loadImage(imageUrl);
    const amountCrop = cropImageToScaledDataUrl(image, image.naturalWidth * .70, 0, image.naturalWidth * .30, image.naturalHeight * .62, 2.2);
    const result = await Tesseract.recognize(dataUrlToBlob(amountCrop), "eng", { tessedit_char_whitelist: "0123456789.,-+¥￥ " });
    const amountText = result.data.text || "";
    const amount = parseWechatRowAmount(amountText);
    return {
      description: fallback.description,
      date: "",
      amount,
      skip: shouldSkipWechatBillRow("", amountText, amount),
      rawText: `微信账单长截图导入：${fileName}\n第 ${index + 1} 条\n__ROW_AMOUNT__\n${amountText}`,
    };
  } catch (error) {
    console.error(error);
    return { ...fallback, rawText: `${fallback.rawText}\nOCR 失败：${String(error?.message || error)}` };
  }
}

async function splitWechatBillScreenshot(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const bounds = detectWechatBillRowBounds(image);
    if (bounds.length) return bounds.map((bound) => cropImageToDataUrl(image, 0, bound.top, image.naturalWidth, bound.height));
    const startY = Math.round(image.naturalHeight * 0.237);
    const rowHeight = Math.round(Math.min(image.naturalHeight * 0.084, image.naturalWidth * 0.18));
    const minBottomGap = Math.round(image.naturalHeight * 0.012);
    const maxRows = image.naturalHeight > image.naturalWidth * 4 ? 80 : 12;
    const rowImages = [];
    for (let top = startY, index = 0; top + rowHeight <= image.naturalHeight - minBottomGap && index < maxRows; top += rowHeight, index += 1) {
      rowImages.push(cropImageToDataUrl(image, 0, top, image.naturalWidth, rowHeight));
    }
    return rowImages;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectWechatBillRowBounds(image) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  const x1 = Math.round(width * 0.72);
  const x2 = Math.round(width * 0.98);
  const minDarkPixels = Math.max(6, Math.round((x2 - x1) * 0.018));
  const darkRows = [];
  for (let y = Math.round(height * 0.04); y < Math.round(height * 0.985); y += 1) {
    let dark = 0;
    for (let x = x1; x < x2; x += 3) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (r < 150 && g < 150 && b < 150) dark += 1;
    }
    if (dark >= minDarkPixels) darkRows.push(y);
  }
  const clusters = [];
  for (const y of darkRows) {
    const last = clusters[clusters.length - 1];
    if (last && y - last.end <= 3) {
      last.end = y;
      last.count += 1;
    } else {
      clusters.push({ start: y, end: y, count: 1 });
    }
  }
  const amountCenters = clusters
    .filter((cluster) => cluster.count >= 5)
    .map((cluster) => Math.round((cluster.start + cluster.end) / 2));
  const minGap = Math.round(width * 0.085);
  const centers = [];
  for (const center of amountCenters) {
    if (!centers.length || center - centers[centers.length - 1] >= minGap) centers.push(center);
    else centers[centers.length - 1] = Math.round((centers[centers.length - 1] + center) / 2);
  }
  if (centers.length < 3) return [];
  const gaps = centers.slice(1).map((center, index) => center - centers[index]).filter((gap) => gap > minGap && gap < width * 0.35);
  const medianGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : Math.round(width * 0.19);
  const rowHeight = Math.round(Math.max(width * 0.15, Math.min(width * 0.24, medianGap * 1.05)));
  return centers.map((center) => {
    const top = Math.max(0, Math.round(center - rowHeight * 0.44));
    const bottom = Math.min(height, Math.round(top + rowHeight));
    return { top, height: bottom - top };
  }).filter((bound) => bound.height >= width * 0.12);
}

function cropImageToDataUrl(image, left, top, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, Math.round(left), Math.round(top), Math.round(width), Math.round(height), 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function cropImageToScaledDataUrl(image, left, top, width, height, scale = 2) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, Math.round(left), Math.round(top), Math.round(width), Math.round(height), 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.94);
}

async function recognizeWechatBillRow(imageUrl, index, fileName, workerState = null) {
  const fallback = {
    description: `微信账单截图第 ${index + 1} 条`,
    date: "",
    amount: "",
    rawText: `微信账单列表截图导入：${fileName}\n第 ${index + 1} 条。OCR 未执行。`,
  };
  if (!window.Tesseract) return fallback;
  try {
    const result = await recognizeWechatImageText(imageUrl, workerState);
    const text = result.data.text || "";
    const amountText = text;
    const dateText = text;
    const amount = parseWechatRowAmount(text);
    const date = normalizeWechatFutureDate(parseWechatRowDate(text));
    const description = parseWechatRowDescription(text) || fallback.description;
    const rawText = `微信账单列表截图导入：${fileName}\n第 ${index + 1} 条\n__ROW_TEXT__\n${text}\n__ROW_DATE__\n${dateText}\n__ROW_AMOUNT__\n${amountText}`;
    return { description, date, amount, skip: shouldSkipWechatBillRow(text, amountText, amount), rawText };
  } catch (error) {
    console.error(error);
    return { ...fallback, rawText: `${fallback.rawText}\nOCR 失败：${String(error?.message || error)}` };
  }
}

async function recognizeWechatImageText(imageUrl, workerState) {
  const blob = dataUrlToBlob(imageUrl);
  if (!Tesseract.createWorker || !workerState) return Tesseract.recognize(blob, "chi_sim+eng");
  if (!workerState.worker) workerState.worker = await Tesseract.createWorker("chi_sim+eng");
  return workerState.worker.recognize(blob);
}

async function recognizeWechatLongScreenshotDetailsChunked(file) {
  if (!window.Tesseract) return [];
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const bounds = detectWechatBillRowBounds(image);
    const details = Array.from({ length: bounds.length }, () => ({ description: "", date: "" }));
    for (let start = 0; start < bounds.length; start += 15) {
      const chunk = bounds.slice(start, start + 15);
      const rowHeight = 132;
      const canvas = document.createElement("canvas");
      canvas.width = 1120;
      canvas.height = chunk.length * rowHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const sourceX = Math.round(image.naturalWidth * 0.145);
      const sourceWidth = Math.round(image.naturalWidth * 0.56);
      chunk.forEach((bound, index) => {
        const top = Math.max(0, bound.top + Math.round(bound.height * 0.06));
        const cropHeight = Math.round(bound.height * 0.72);
        ctx.drawImage(image, sourceX, top, sourceWidth, cropHeight, 0, index * rowHeight + 10, canvas.width, rowHeight - 20);
      });
      thresholdCanvas(ctx, canvas.width, canvas.height, 214);
      const result = await Tesseract.recognize(dataUrlToBlob(canvas.toDataURL("image/png")), "chi_sim+eng");
      const lines = Array.isArray(result.data?.lines) && result.data.lines.length ? result.data.lines : [];
      for (const line of lines) {
        const text = String(line.text || "").trim();
        if (!text) continue;
        const rowIndex = Math.max(0, Math.min(details.length - 1, start + Math.floor(Number(line.bbox?.y0 ?? 0) / rowHeight)));
        if (/\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text) || /\d{1,2}[:：]\d{2}/.test(text)) {
          details[rowIndex].date = normalizeWechatFutureDate(parseWechatRowDate(text)) || details[rowIndex].date;
        } else if (!details[rowIndex].description && /[\u4e00-\u9fa5a-zA-Z]{2,}/.test(text)) {
          details[rowIndex].description = cleanProductName(text);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return details;
  } catch (error) {
    console.error(error);
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function recognizeWechatLongScreenshotDatesChunked(file) {
  if (!window.Tesseract) return [];
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const bounds = detectWechatBillRowBounds(image);
    const dates = Array.from({ length: bounds.length }, () => "");
    for (let start = 0; start < bounds.length; start += 15) {
      const chunk = bounds.slice(start, start + 15);
      const rowHeight = 92;
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = chunk.length * rowHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const sourceX = Math.round(image.naturalWidth * 0.145);
      const sourceWidth = Math.round(image.naturalWidth * 0.38);
      chunk.forEach((bound, index) => {
        const top = Math.max(0, bound.top + Math.round(bound.height * 0.40));
        const cropHeight = Math.round(bound.height * 0.34);
        ctx.drawImage(image, sourceX, top, sourceWidth, cropHeight, 0, index * rowHeight + 12, canvas.width, rowHeight - 24);
      });
      thresholdCanvas(ctx, canvas.width, canvas.height, 226);
      const result = await Tesseract.recognize(dataUrlToBlob(canvas.toDataURL("image/png")), "chi_sim+eng", { tessedit_char_whitelist: "0123456789年月日:： " });
      const lines = Array.isArray(result.data?.lines) && result.data.lines.length ? result.data.lines : [];
      for (const line of lines) {
        const date = normalizeWechatFutureDate(parseWechatRowDate(String(line.text || "")));
        if (!date) continue;
        const rowIndex = Math.max(0, Math.min(dates.length - 1, start + Math.floor(Number(line.bbox?.y0 ?? 0) / rowHeight)));
        dates[rowIndex] = date;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return dates;
  } catch (error) {
    console.error(error);
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function thresholdCanvas(ctx, width, height, threshold) {
  const pixels = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
    const value = gray < threshold ? 0 : 255;
    pixels.data[i] = value;
    pixels.data[i + 1] = value;
    pixels.data[i + 2] = value;
  }
  ctx.putImageData(pixels, 0, 0);
}

function dataUrlToBlob(dataUrl) {
  const [meta, data] = String(dataUrl).split(",");
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/jpeg";
  const binary = atob(data || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function parseWechatRowAmount(text) {
  const normalized = normalizeText(text).replace(/\s+/g, "").replace(/[—–−﹣－]/g, "-");
  const signed = normalized.match(/[¥￥+-]\d{1,5}(?:[.,]\d{1,2})?/) || normalized.match(/\d{1,5}[.,]\d{1,2}/);
  const amount = normalizeAmount((signed || [])[0]);
  if (!amount || amount > 20000) return "";
  return amount ? amount.toFixed(2) : "";
}

function shouldSkipWechatBillRow(text, amountText, amount) {
  const normalized = normalizeText(`${amountText}\n${text}`).replace(/\s+/g, "");
  if (/\+\s*(?:¥|￥)?\d/.test(normalized) || /(?:¥|￥)\+\d/.test(normalized)) return true;
  if (/收入|退款|已退|转入/.test(normalized)) return true;
  return !amount;
}

function parseWechatRowDate(text) {
  const normalized = normalizeText(text)
    .replace(/[il|]/g, "1")
    .replace(/[oO]/g, "0")
    .replace(/\s+/g, " ");
  const currentYear = new Date().getFullYear();
  const match = normalized.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日)?/) || normalized.match(/(?:^|\D)(\d{1,2})\s+[月\s]?\s*(\d{1,2})(?=\D|$)/);
  if (!match) return "";
  return normalizeDateParts(currentYear, Number(match[1]), Number(match[2]));
}

function normalizeWechatFutureDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (parsed.getFullYear() === today.getFullYear() && parsed > today) {
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return `${parsed.getFullYear()}-${month}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return date;
}

function parseWechatRowDescription(text) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const first = lines.find((line) => /[\u4e00-\u9fa5a-zA-Z]{2,}/.test(line) && !/\d+\s*月\s*\d+\s*日|^[-+]?\d/.test(line));
  return cleanProductName(first || "");
}

function importWechatBillRows(rows, sourceFileName) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim() === "交易时间") && row.some((cell) => String(cell).trim() === "金额(元)"));
  if (headerIndex < 0) throw new Error("未找到微信账单明细表头");
  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const col = (name) => headers.indexOf(name);
  const importedItems = [];
  let skipped = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const get = (name) => String(row[col(name)] || "").trim();
    const direction = get("收/支");
    const status = get("当前状态");
    const type = get("交易类型");
    const amount = normalizeAmount(get("金额(元)"));
    if (!amount || direction !== "支出" || /退款|已全额退款|已退款/i.test(`${status} ${type}`)) { skipped += 1; continue; }
    const time = get("交易时间");
    const description = cleanWechatDescription(get("商品"), get("交易对方"));
    const cat = guessCategory(normalizeText(`${description} ${type}`));
    importedItems.push({
      id: crypto.randomUUID(),
      fileName: "",
      imageUrl: "",
      screenshotPreviewUrl: "",
      rawText: `微信账单导入：${sourceFileName}\n交易时间：${time}\n交易类型：${type}\n交易对方：${get("交易对方")}\n商品：${get("商品")}\n当前状态：${status}`,
      date: normalizeWechatDate(time),
      category: cat.category,
      type: cat.type,
      amount: amount.toFixed(2),
      screenshotAmount: amount.toFixed(2),
      description,
      invoiceFile: null,
      invoiceFileName: "",
      invoiceFileUrl: "",
      invoiceLink: "",
      invoiceAmount: "",
      invoice: "待补",
      source: "微信Excel",
    });
  }
  items.push(...importedItems);
  return { count: importedItems.length, skipped };
}

function cleanWechatDescription(product, counterparty) {
  const primary = String(product || "").replace(/^转账$/, "").replace(/^收款方备注$/, "").trim();
  const fallback = String(counterparty || "").trim();
  return cleanProductName(primary) || cleanProductName(fallback) || primary || fallback || "微信账单支出";
}

function normalizeWechatDate(value) {
  const match = String(value || "").match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

async function recognizePaymentImage(images, fileName) {
  const amountOptions = { tessedit_char_whitelist: "0123456789.,-+¥￥YyOo " };
  const dateOptions = { tessedit_char_whitelist: "0123456789年月日-/.:： 支付交易创建完成时间" };
  const [result, amountResult, middleResult, topAmountResult, mainAmountResult, lowerMainAmountResult, upperResult, dateResult] = await runLimited([
    () => Tesseract.recognize(images.full, "chi_sim+eng", { logger: (m) => { if (m.status === "recognizing text") setStatus(`正在识别 ${fileName}：${Math.round(m.progress * 100)}%`); } }),
    () => Tesseract.recognize(images.amountRegion, "eng", amountOptions),
    () => Tesseract.recognize(images.middleRegion, "eng", amountOptions),
    () => Tesseract.recognize(images.topAmountRegion, "eng", amountOptions),
    () => Tesseract.recognize(images.mainAmountRegion, "eng", amountOptions),
    () => Tesseract.recognize(images.lowerMainAmountRegion, "eng", amountOptions),
    () => Tesseract.recognize(images.upperRegion, "chi_sim+eng"),
    () => Tesseract.recognize(images.dateRegion, "chi_sim+eng", dateOptions),
  ], 3);
  const visualAmounts = [
    extractLargestVisualAmount(mainAmountResult.data),
    extractLargestVisualAmount(lowerMainAmountResult.data),
    extractLargestVisualAmount(topAmountResult.data),
    extractLargestVisualAmount(middleResult.data),
    extractLargestVisualAmount(amountResult.data),
    extractLargestVisualAmount(upperResult.data),
    extractLargestVisualAmount(result.data),
  ];
  const visualAmount = bestVisualAmount(visualAmounts);
  const amountPreviewCandidates = collectAmountPreviewCandidates([
    { data: mainAmountResult.data, offset: images.mainAmountRegionBox, priority: 7 },
    { data: lowerMainAmountResult.data, offset: images.lowerMainAmountRegionBox, priority: 6 },
    { data: topAmountResult.data, offset: images.topAmountRegionBox, priority: 5 },
    { data: middleResult.data, offset: images.middleRegionBox, priority: 4 },
    { data: amountResult.data, offset: images.amountRegionBox, priority: 3 },
    { data: upperResult.data, offset: images.upperRegionBox, priority: 2 },
    { data: result.data, offset: { x: 0, y: 0 }, priority: 1 },
  ]);
  return { text: `${result.data.text || ""}\n__VISUAL_AMOUNT__ ${visualAmount}\n__DATE_REGION__\n${dateResult.data.text || ""}\n__MAIN_AMOUNT_REGION__\n${mainAmountResult.data.text || ""}\n__LOWER_MAIN_AMOUNT_REGION__\n${lowerMainAmountResult.data.text || ""}\n__AMOUNT_REGION__\n${amountResult.data.text || ""}\n__MIDDLE_AMOUNT_REGION__\n${middleResult.data.text || ""}\n__TOP_AMOUNT_REGION__\n${topAmountResult.data.text || ""}\n__UPPER_REGION__\n${upperResult.data.text || ""}`, amountPreviewCandidates, amountPreviewBox: selectBestAmountPreviewBox(amountPreviewCandidates, visualAmount, images.fullWidth, images.fullHeight) };
}

async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function imageFileToDraftDataUrl(file) {
  const url = URL.createObjectURL(file);
  const image = await loadImage(url);
  URL.revokeObjectURL(url);
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

async function imageFileToAmountPreviewDataUrl(file, box, ocrWidth, ocrHeight) {
  if (!box || !ocrWidth || !ocrHeight) return "";
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scaleX = image.naturalWidth / ocrWidth;
    const scaleY = image.naturalHeight / ocrHeight;
    const amountBox = { x: box.x * scaleX, y: box.y * scaleY, width: Math.max(1, box.width * scaleX), height: Math.max(1, box.height * scaleY) };
    const aspect = box.preferredCrop ? 1.28 : 1.42;
    let cropWidth = Math.min(image.naturalWidth, Math.max(amountBox.width * (box.preferredCrop ? 1.15 : 4.8), image.naturalWidth * (box.preferredCrop ? .54 : .46)));
    let cropHeight = Math.min(image.naturalHeight, Math.max(amountBox.height * (box.preferredCrop ? 2.55 : 4), cropWidth / aspect));
    cropWidth = Math.min(cropWidth, cropHeight * aspect, image.naturalWidth);
    const centerX = amountBox.x + amountBox.width / 2;
    const centerY = amountBox.y + amountBox.height / 2;
    const left = clamp(centerX - cropWidth / 2, 0, image.naturalWidth - cropWidth);
    const top = clamp(centerY - cropHeight * (box.preferredCrop ? .46 : .52), 0, image.naturalHeight - cropHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cropWidth);
    canvas.height = Math.round(cropHeight);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.84);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

async function handleInvoiceFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  if (!files.length) return setStatus("请选择 PDF 发票文件。安卓文件选择器如不能多选，可重复点击上传发票 PDF 逐个追加。");
  if (!window.pdfjsLib) return setStatus("PDF 解析组件还没有加载完成，请稍后再上传发票。");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  let matched = 0;
  const failed = [];
  for (const file of files) {
    setStatus(`正在识别发票：${file.name}`);
    try {
      const amounts = await getInvoiceAmounts(file);
      if (amounts.length && matchInvoiceToItem(file, amounts)) matched += 1;
      else failed.push(`${file.name}: 发票金额 ${amounts.join("、") || "未识别"}，未找到同金额明细`);
    } catch (error) {
      console.error(error);
      failed.push(`${file.name}: 解析失败`);
    }
  }
  invoiceBatchInput.value = "";
  renderAll();
  setStatus(failed.length ? `发票处理完成：已匹配 ${matched} 份，未匹配 ${failed.length} 份。${failed.slice(0, 3).join("；")}` : `发票处理完成：已匹配 ${matched} 份。`);
}

function addManualItem() {
  items.push({
    id: crypto.randomUUID(),
    fileName: "手动新增",
    imageUrl: "",
    screenshotPreviewUrl: "",
    rawText: "手动新增明细，无 OCR 原文。",
    date: new Date().toISOString().slice(0, 10),
    category: "其他费用",
    type: "其他费用",
    amount: "",
    screenshotAmount: "",
    description: "",
    invoiceFileName: "",
    invoiceFile: null,
    invoiceFileUrl: "",
    invoiceLink: "",
    invoiceAmount: "",
    invoice: "待补",
  });
  setStatus("已新增一条手动明细，可直接填写。");
  markDirtyAndSave();
  renderAll();
}


function parsePaymentText(text, fileName) {
  const compact = normalizeText(`${text}\n${fileName}`);
  const description = guessProductName(getUsefulTextLines(text));
  const cat = guessCategory(`${compact} ${normalizeText(description)}`);
  return { date: guessDate(compact), category: cat.category, type: cat.type, amount: guessAnyPaymentAmount(text, fileName), description, invoice: "待补" };
}

function guessAnyPaymentAmount(text, fileName = "") {
  const payment = findPrimaryPaymentAmount(text);
  const refund = findRefundAmount(text);
  if (payment) return Math.max(0, payment - refund).toFixed(2);
  return guessAmount(normalizeText(`${text}\n${fileName}`)) || guessAmountFallback(text) || guessAmountFallback(fileName);
}

function explainPaymentAmount(text) {
  const payment = findPrimaryPaymentAmount(text);
  const refund = findRefundAmount(text);
  return payment ? `主金额 ${payment.toFixed(2)}${refund ? ` - 退款 ${refund.toFixed(2)}` : ""}` : "未提取到主金额";
}

function findPrimaryPaymentAmount(text) {
  const lines = String(text || "").split(/\n+/).map(normalizeText).filter(Boolean);
  const visual = findVisualAmount(lines, text);
  if (visual) return visual;
  const marked = findMarkedAmount(lines);
  if (marked) return marked;
  const candidates = [];
  lines.forEach((line, index) => {
    const matches = [...line.matchAll(/(?:^|[^\d])([-+一ー−﹣－—–]?\s*\d{1,6}\s*[.,]\s*\d{1,2})(?=\D|$)/g)];
    for (const match of matches) {
      const raw = normalizeText(match[1]).replace(/\s+/g, "").replace(/[一ー−﹣－—–]/g, "-");
      const amount = normalizeAmount(raw);
      if (!amount) continue;
      let score = 0;
      if (/^-/.test(raw)) score += 200;
      if (line.length <= 16) score += 80;
      if (index < 8) score += 60;
      if (/退款|已退款|退回/.test(line)) score -= 500;
      if (/支付时间|交易单号|商户单号|订单|条形码|二维码/.test(line)) score -= 200;
      if (/支付成功|交易成功|当前状态/.test(lines.slice(index, index + 5).join(" "))) score += 30;
      candidates.push({ amount, score, index });
    }
  });
  if (!candidates.length) return 0;
  candidates.sort((a, b) => b.score - a.score || a.index - b.index || b.amount - a.amount);
  return candidates[0].amount;
}

function findVisualAmount(lines, rawText = "") {
  for (const line of lines) {
    const match = line.match(/__visual_amount__\s*(\d{1,6}(?:[.,]\d{1,2})?)/);
    const amount = normalizeAmount(match && match[1]);
    if (!amount) continue;
    const context = normalizeText(rawText).slice(0, 600);
    if (/[-−﹣－—–]\s*[¥￥]?\s*\d/.test(context) || /支付成功|交易成功|当前状态|付款|支付/.test(context)) return amount;
  }
  return 0;
}

function extractLargestVisualAmount(data) {
  const parts = [...(data?.lines || []), ...(data?.words || [])];
  const candidates = [];
  for (const part of parts) {
    const text = normalizeText(part.text || "")
      .replace(/(^|\s)([-+])\s+(\d)/g, "$1$2$3")
      .replace(/(\d)\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1.$3");
    const match = text.match(/[-+]?\d{1,6}[.,]\d{1,2}/);
    const amount = normalizeAmount(match && match[0]);
    if (!amount) continue;
    const box = part.bbox || {};
    const width = Math.max(1, Number(box.x1 || 0) - Number(box.x0 || 0));
    const height = Math.max(1, Number(box.y1 || 0) - Number(box.y0 || 0));
    let score = width * height;
    if (/^[-+]/.test(match[0])) score *= 1.8;
    if (/退款|订单|单号|时间|日期/.test(text)) score *= 0.2;
    candidates.push({ amount, score });
  }
  if (!candidates.length) {
    const fallback = findBestDecimalAmount(data?.text || "", true);
    return fallback ? fallback.toFixed(2) : "";
  }
  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return candidates[0].amount.toFixed(2);
}

function collectAmountPreviewCandidates(regions) {
  return regions.flatMap((region) => amountBoxCandidates(region.data, region.offset, region.priority));
}

function selectBestAmountPreviewBox(candidates, targetAmount, ocrWidth, ocrHeight) {
  if (ocrWidth && ocrHeight) return fallbackMainAmountBox(ocrWidth, ocrHeight);
  candidates = [...(candidates || [])];
  const target = normalizeAmount(targetAmount);
  if (!target && ocrWidth && ocrHeight) return fallbackMainAmountBox(ocrWidth, ocrHeight);
  let hasTargetCandidate = false;
  if (target) candidates.forEach((candidate) => { if (Math.abs(candidate.amount - target) < .01) { candidate.score *= 8; hasTargetCandidate = true; } });
  candidates.sort((a, b) => b.score - a.score);
  if (target && !hasTargetCandidate && ocrWidth && ocrHeight) return fallbackMainAmountBox(ocrWidth, ocrHeight);
  return candidates[0] || null;
}

function fallbackMainAmountBox(ocrWidth, ocrHeight) {
  return { x: ocrWidth * .23, y: ocrHeight * .255, width: ocrWidth * .54, height: ocrHeight * .18, amount: 0, score: 0, preferredCrop: true };
}

function amountBoxCandidates(data, offset = { x: 0, y: 0 }, priority = 1) {
  const parts = [...(data?.words || []), ...(data?.lines || [])];
  const candidates = [];
  for (const part of parts) {
    const text = normalizeText(part.text || "").replace(/(^|\s)([-+])\s+(\d)/g, "$1$2$3").replace(/(\d)\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1.$3");
    if (!/\d/.test(text) || /\d{1,2}\s*[:：]\s*\d{1,2}/.test(text) || /20\d{2}/.test(text) || /\d{8,}/.test(text)) continue;
    const match = text.match(/[-+¥￥]?\s*\d{1,6}(?:[.,]\d{1,2})?/);
    const amount = normalizeAmount(match && match[0]);
    if (!amount || amount < 1) continue;
    const box = part.bbox || {};
    const localX = Number(box.x0 || 0);
    const localY = Number(box.y0 || 0);
    const x = localX + Number(offset.x || 0);
    const y = localY + Number(offset.y || 0);
    const width = Math.max(1, Number(box.x1 || 0) - localX);
    const height = Math.max(1, Number(box.y1 || 0) - localY);
    let score = width * height * priority;
    if (/[.,]\d{1,2}/.test(match[0])) score *= 2;
    if (/[-+¥￥]/.test(match[0])) score *= 1.4;
    if (amount >= 10) score *= 1.2;
    if (/订单|单号|时间|日期|余额|积分|卡号/.test(text)) score *= .25;
    candidates.push({ x, y, width, height, amount, score });
  }
  return candidates;
}

function bestVisualAmount(values) {
  const amount = values.map(normalizeAmount).find((value) => value >= 2);
  return amount ? amount.toFixed(2) : "";
}

function findMarkedAmount(lines) {
  const markerIndexes = lines
    .map((line, index) => (/__main_amount_region__|__lower_main_amount_region__|__top_amount_region__|__middle_amount_region__|__amount_region__/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  for (const markerIndex of markerIndexes) {
    const nearby = lines.slice(markerIndex + 1, markerIndex + 8).join(" ");
    const amount = findBestDecimalAmount(nearby, true);
    if (amount) return amount;
  }
  return 0;
}

function findBestDecimalAmount(text, preferSigned = false) {
  const normalized = normalizeText(text)
    .replace(/(^|\s)([-+])\s+(\d)/g, "$1$2$3")
    .replace(/(^|\s)([-+])\s*(\d{1,6})\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1$2$3.$5")
    .replace(/(\d)\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1.$3");
  const candidates = [];
  for (const match of normalized.matchAll(/(?:^|[^\d])([-+]?\d{1,6}[.,]\d{1,2})(?=\D|$)/g)) {
    const raw = match[1];
    const amount = normalizeAmount(raw);
    if (!amount || amount < 2) continue;
    let score = 0;
    if (/^[-+]/.test(raw)) score += preferSigned ? 100 : 30;
    if (amount >= 1 && amount < 10000) score += 20;
    candidates.push({ amount, score });
  }
  if (!candidates.length) return 0;
  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return candidates[0].amount;
}

function findRefundAmount(text) {
  const normalized = normalizeText(text)
    .replace(/__amount_region__[\s\S]*?__middle_amount_region__/g, " ")
    .replace(/__middle_amount_region__[\s\S]*?__upper_region__/g, " ")
    .replace(/[>›》]/g, " ")
    .replace(/[¥￥y]\s*(?=\d)/g, "¥")
    .replace(/(\d)\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1.$3");
  const refunds = [];
  const patterns = [
    /(?:已退款|退款|退回)[^\d¥]{0,40}¥?\s*(\d{1,6}(?:[.,]\d{1,2})?)/g,
    /¥\s*(\d{1,6}(?:[.,]\d{1,2})?)[^\n]{0,40}(?:已退款|退款|退回)/g,
    /(?:退款记录|当前状态)[^\n]{0,80}(?:已退款|退款|退回)[^\d¥]{0,40}¥?\s*(\d{1,6}(?:[.,]\d{1,2})?)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalized))) {
      const amount = normalizeAmount(match[1]);
      if (amount) refunds.push(amount);
    }
  }
  if (!refunds.length) {
    for (const match of normalized.matchAll(/(?:退款记录|已退款|退款|退回)[\s\S]{0,120}/g)) {
      const amount = findBestDecimalAmount(match[0], false);
      if (amount) refunds.push(amount);
    }
  }
  return [...new Set(refunds.map((amount) => amount.toFixed(2)))].reduce((sum, amount) => sum + Number(amount), 0);
}

function guessAmount(text) {
  const normalized = text.replace(/(^|\s)([-+])\s+(\d)/g, "$1$2$3").replace(/(^|\s)([-+])\s*(\d{1,6})\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1$2$3.$5").replace(/(\d)[oO](?=\d|\s|$)/g, "$10").replace(/(\d)\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1.$3");
  const patterns = [/(?:支付|付款|实付|消费|支出|金额|合计|总额|账单)\s*[:：]?\s*(?:¥|￥)?\s*([-+]?\d{1,6}(?:,\d{3})*(?:[.,]\d{1,2})?)/gi, /(?:¥|￥)\s*([-+]?\d{1,6}(?:,\d{3})*(?:[.,]\d{1,2})?)/gi, /(?:^|[^\d])([-+]\d{1,6}[.,]\d{1,2})(?=\D|$)/g];
  const candidates = [];
  for (let priority = 0; priority < patterns.length; priority += 1) {
    let match;
    while ((match = patterns[priority].exec(normalized))) {
      const amount = normalizeAmount(match[1]);
      if (amount) candidates.push({ amount, priority });
    }
  }
  if (!candidates.length) return "";
  candidates.sort((a, b) => a.priority - b.priority || b.amount - a.amount);
  return candidates[0].amount.toFixed(2);
}

function guessAmountFallback(rawText) {
  const candidates = [];
  String(rawText || "").split(/\n+/).map(normalizeText).forEach((line, index) => {
    const normalized = line.replace(/(\d)\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1.$3");
    for (const match of normalized.matchAll(/(?:^|[^\d])([¥￥]?\s*[-+]?\s*\d{1,6}(?:,\d{3})*(?:[.,]\d{1,2})?)(?=\D|$)/g)) {
      const raw = match[1].replace(/[¥￥\s]/g, "");
      const amount = normalizeAmount(raw);
      if (!amount) continue;
      let score = 0;
      if (/^[-+]/.test(raw)) score += 100;
      if (/[¥￥元圆块]|支付|付款|实付|消费|支出|金额|合计|总额|交易成功|支付成功/.test(normalized)) score += 70;
      if (normalized.length <= 18) score += 40;
      score -= index;
      candidates.push({ amount, score });
    }
  });
  if (!candidates.length) return "";
  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return candidates[0].amount.toFixed(2);
}

function normalizeText(value) { return String(value || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[，。；：]/g, " ").replace(/[−﹣－—–]/g, "-").replace(/[一ー](?=\s*\d{1,6}[,.]\d{1,2})/g, "-").replace(/[￥]/g, "¥").replace(/[oO](?=\d|\s|$)/g, "0").replace(/\s+/g, " ").toLowerCase(); }
function normalizeAmount(value) { const amount = Number(String(value || "").replace(/,/g, "").replace(/^[-+]/, "").replace(/\s/g, "")); return Number.isFinite(amount) && amount > 0 && amount < 1000000 ? amount : 0; }
function guessDate(text) {
  const currentYear = new Date().getFullYear();
  const normalized = normalizeText(text)
    .replace(/([年月日])\s+/g, "$1")
    .replace(/\s+([年月日])/g, "$1")
    .replace(/(\d)\s+([-/.:：年月日])\s+(\d)/g, "$1$2$3")
    .replace(/(\d)\s+(\d)(?=\s*(?:年|月|日|[-/.]))/g, "$1$2");
  const candidates = [];
  const patterns = [
    /(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*(?:日)?(?:\s+\d{1,2}\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{1,2})?)?/g,
    /(?<!\d)(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*(?:日)?(?:\s+\d{1,2}\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{1,2})?)?/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalized))) {
      const hasYear = match.length > 3 && /^20\d{2}$/.test(match[1]);
      const year = hasYear ? Number(match[1]) : currentYear;
      const month = Number(hasYear ? match[2] : match[1]);
      const day = Number(hasYear ? match[3] : match[2]);
      const value = normalizeDateParts(year, month, day);
      if (!value) continue;
      const windowText = normalized.slice(Math.max(0, match.index - 24), match.index + match[0].length + 24);
      let score = 0;
      if (/支付时间|交易时间|付款时间|完成时间|创建时间|下单时间|消费时间/.test(windowText)) score += 100;
      if (/__date_region__/.test(windowText)) score += 80;
      if (hasYear) score += 30;
      if (/\d{1,2}\s*[:：]\s*\d{1,2}/.test(match[0])) score += 20;
      if (/发票|开票|账单周期|有效期|订单|单号/.test(windowText)) score -= 60;
      candidates.push({ value, score, index: match.index });
    }
  }
  if (!candidates.length) return "";
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0].value;
}

function normalizeDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  if (year < 2020 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function guessCategory(text) { for (const rule of categoryRules) if (rule.words.some((word) => text.includes(word.toLowerCase()))) return { category: rule.category, type: rule.type }; return { category: "其他费用", type: "其他费用" }; }
function getUsefulTextLines(rawText) { return String(rawText || "").split(/\n+/).map((line) => line.trim().replace(/\s+/g, " ").replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1")).filter(Boolean); }
function guessProductName(lines) {
  const stopWords = "商户全称|商户名称|收款机构|收单机构|清算机构|支付方式|交易单号|商户单号|订单号|当前状态|支付时间|退款记录|账单服务|商家小程序|发起群收款|在此商户的交易";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const inlineMatch = line.match(new RegExp(`(?:商品说明|商品名称|商品信息|商品|交易说明|订单标题|订单信息|付款给|收款方|店铺|商户)\\s*[:：]?\\s*(.+?)(?=\\s*(?:${stopWords}|$))`));
    const inlineProduct = cleanProductName(inlineMatch && inlineMatch[1]);
    if (inlineProduct) return inlineProduct;

    if (/^(商品说明|商品名称|商品信息|商品|交易说明|订单标题|订单信息|付款给|收款方|店铺|商户)$/.test(line) && lines[index + 1]) {
      const nextProduct = cleanProductName(lines[index + 1].replace(new RegExp(`\\s*(?:${stopWords}).*$`), ""));
      if (nextProduct) return nextProduct;
    }
  }
  return guessProductNameFallback(lines);
}
function guessProductNameFallback(lines) {
  const candidates = [];
  lines.forEach((line, index) => {
    const text = cleanProductName(line);
    if (!text) return;
    let score = 0;
    if (/美团|饿了么|餐饮|饭店|酒店|滴滴|高德|加油|高速|停车|咖啡|便利|超市|商店|收银|付款给|收款方/.test(text)) score += 80;
    if (/商品|服务|客运|餐饮|用车|加油|通行|停车|采购/.test(text)) score += 50;
    if (text.length >= 3 && text.length <= 24) score += 30;
    score -= index;
    candidates.push({ text, score });
  });
  if (!candidates.length) return "";
  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  return candidates[0].text;
}
function cleanProductName(value) {
  const text = String(value || "")
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/([a-zA-Z])\s+(?=[a-zA-Z])/g, "$1")
    .replace(/\b\d{8,}\b/g, "")
    .replace(/[-_ ]?(?:美团|支付宝|微信|花呗|app|App)[-_ ]?\d+.*/g, "")
    .replace(/^[：:>＞\s]+|[：:>＞\s]+$/g, "")
    .trim();
  if (!/[\u4e00-\u9fa5a-zA-Z]{2,}/.test(text)) return "";
  if (/img[_-]?v\d|[0-9a-f]{8}-[0-9a-f]{4}|截图|截屏|screenshot/i.test(text)) return "";
  if (/商户全称|收款机构|收单机构|支付方式|交易单号|商户单号|订单号|当前状态|支付时间|交易时间|付款时间|创建时间|完成时间|退款记录|支付成功|交易成功|待支付|已退款/.test(text)) return "";
  if (/^[-+]?\s*[¥￥]?\s*\d+(?:\.\d{1,2})?\s*(?:元)?$/.test(text)) return "";
  if (/^\d{1,2}[:：]\d{1,2}|20\d{2}[年/-]\d{1,2}/.test(text)) return "";
  return text.slice(0, 40);
}

async function prepareImageForOcr(file) { const bitmap = await createImageBitmap(file); const scale = Math.min(2.5, Math.max(1.4, 1800 / bitmap.width)); const canvas = createScaledCanvas(bitmap, scale); enhanceCanvas(canvas); const box = (x, y, width, height) => ({ x: canvas.width * x, y: canvas.height * y, width: canvas.width * width, height: canvas.height * height }); const mainAmountRegionBox = box(.22, .20, .56, .13); const lowerMainAmountRegionBox = box(.20, .23, .60, .14); const amountRegionBox = box(.10, .12, .80, .28); const topAmountRegionBox = box(.14, .18, .72, .22); const middleRegionBox = box(.12, .24, .76, .30); const upperRegionBox = box(.03, .03, .94, .52); const dateRegionBox = box(.04, .40, .92, .45); return { full: await canvasToBlob(canvas, file), fullWidth: canvas.width, fullHeight: canvas.height, mainAmountRegionBox, lowerMainAmountRegionBox, amountRegionBox, topAmountRegionBox, middleRegionBox, upperRegionBox, dateRegionBox, mainAmountRegion: await canvasToBlob(cropCanvas(canvas, mainAmountRegionBox.x, mainAmountRegionBox.y, mainAmountRegionBox.width, mainAmountRegionBox.height), file), lowerMainAmountRegion: await canvasToBlob(cropCanvas(canvas, lowerMainAmountRegionBox.x, lowerMainAmountRegionBox.y, lowerMainAmountRegionBox.width, lowerMainAmountRegionBox.height), file), amountRegion: await canvasToBlob(cropCanvas(canvas, amountRegionBox.x, amountRegionBox.y, amountRegionBox.width, amountRegionBox.height), file), topAmountRegion: await canvasToBlob(cropCanvas(canvas, topAmountRegionBox.x, topAmountRegionBox.y, topAmountRegionBox.width, topAmountRegionBox.height), file), middleRegion: await canvasToBlob(cropCanvas(canvas, middleRegionBox.x, middleRegionBox.y, middleRegionBox.width, middleRegionBox.height), file), upperRegion: await canvasToBlob(cropCanvas(canvas, upperRegionBox.x, upperRegionBox.y, upperRegionBox.width, upperRegionBox.height), file), dateRegion: await canvasToBlob(cropCanvas(canvas, dateRegionBox.x, dateRegionBox.y, dateRegionBox.width, dateRegionBox.height), file) }; }
function createScaledCanvas(bitmap, scale) { const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale); canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); return canvas; }
function cropCanvas(sourceCanvas, left, top, width, height) { const canvas = document.createElement("canvas"); canvas.width = Math.round(width); canvas.height = Math.round(height); canvas.getContext("2d").drawImage(sourceCanvas, Math.round(left), Math.round(top), Math.round(width), Math.round(height), 0, 0, canvas.width, canvas.height); return canvas; }
function enhanceCanvas(canvas) { const ctx = canvas.getContext("2d"); const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); const data = imageData.data; for (let i = 0; i < data.length; i += 4) { const gray = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114; const c = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128)); data[i] = c; data[i + 1] = c; data[i + 2] = c; } ctx.putImageData(imageData, 0, 0); }
function canvasToBlob(canvas, fallback) { return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || fallback), "image/png")); }

async function getInvoiceAmounts(file) {
  const fileNameAmount = findInvoiceFileNameAmount(normalizeText(file.name));
  if (fileNameAmount) return [fileNameAmount.toFixed(2)];

  const textAmounts = guessInvoiceAmounts(`${await readPdfText(file)}\n${file.name}`);
  if (textAmounts.length) return textAmounts;

  const regionAmount = await readInvoiceTotalRegion(file);
  return regionAmount ? [regionAmount.toFixed(2)] : [];
}

async function readPdfText(file) { const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; const pages = []; for (let i = 1; i <= pdf.numPages; i += 1) { const page = await pdf.getPage(i); const text = await page.getTextContent(); pages.push(text.items.map((item) => item.str).join(" ")); } return pages.join("\n"); }

async function readInvoiceTotalRegion(file) {
  if (!window.Tesseract) return 0;
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.5 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

  const crops = [
    cropCanvas(canvas, canvas.width * .67, canvas.height * .69, canvas.width * .20, canvas.height * .10),
    cropCanvas(canvas, canvas.width * .60, canvas.height * .68, canvas.width * .30, canvas.height * .12),
  ];
  for (const crop of crops) {
    enhanceCanvas(crop);
    const blob = await canvasToBlob(crop, new Blob());
    const result = await Tesseract.recognize(blob, "chi_sim+eng", { tessedit_char_whitelist: "0123456789.,¥￥小写 " });
    const amount = findInvoiceRegionAmount(result.data.text || "");
    if (amount) return amount;
  }
  return 0;
}

function findInvoiceRegionAmount(text) {
  const normalized = normalizeText(text)
    .replace(/小\s*写/g, "小写")
    .replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, "$1.$3");
  const patterns = [/小写[\s\S]{0,20}[¥￥]?\s*(\d{1,5}\.\d{2})/, /[¥￥]\s*(\d{1,5}\.\d{2})/];
  for (const pattern of patterns) {
    const amount = normalizeAmount((normalized.match(pattern) || [])[1]);
    if (validInvoiceAmount(amount)) return amount;
  }
  return 0;
}

function validInvoiceAmount(amount) { return amount > 0 && amount <= 10000; }
function guessInvoiceAmounts(text) {
  const t = normalizeText(text)
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/价\s*税\s*合\s*计/g, "价税合计")
    .replace(/发\s*票\s*金\s*额/g, "发票金额")
    .replace(/小\s*写/g, "小写")
    .replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, "$1.$3");
  const invoiceTotal = findInvoiceTotalAmount(t);
  if (invoiceTotal) return [invoiceTotal.toFixed(2)];

  const fileNameAmount = findInvoiceFileNameAmount(t);
  if (fileNameAmount) return [fileNameAmount.toFixed(2)];

  return [];
}

function findInvoiceTotalAmount(text) {
  const windows = [];
  for (const keyword of ["价税合计", "税价合计", "合计小写", "小写", "发票金额"]) {
    let index = text.indexOf(keyword);
    while (index >= 0) {
      windows.push(text.slice(Math.max(0, index - 80), index + 320));
      index = text.indexOf(keyword, index + keyword.length);
    }
  }

  const patterns = [
    /[零〇壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]+\s*[¥￥]?\s*(\d{1,5}\.\d{2})/,
    /(\d{1,5}\.\d{2})\s*[¥￥]?\s*[零〇壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]+/,
    /(?:价税合计|税价合计|合计小写|小写)[\s\S]{0,120}[¥￥]?\s*(\d{1,5}\.\d{2})/,
    /[¥￥]\s*(\d{1,5}\.\d{2})/,
    /(?:合计|总计|金额)[^\d¥￥]{0,30}[¥￥]?\s*(\d{1,5}\.\d{2})/,
  ];

  for (const windowText of windows) {
    for (const pattern of patterns) {
      const match = windowText.match(pattern);
      const amount = normalizeAmount(match && match[1]);
      if (/税率|单价|数量/.test(windowText.slice(Math.max(0, (match?.index || 0) - 20), (match?.index || 0) + 40))) continue;
      if (validInvoiceAmount(amount)) return amount;
    }
  }
  return 0;
}

function findInvoiceFileNameAmount(text) {
  const patterns = [/发票金额\s*(\d{1,5}\.\d{2})\s*(?:元|圆)?/, /_(\d{1,5}\.\d{2})\s*(?:元|圆)?_/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const amount = normalizeAmount(match && match[1]);
    if (validInvoiceAmount(amount)) return amount;
  }
  return 0;
}
function matchInvoiceToItem(file, amounts) { const target = findInvoiceTarget(amounts); if (!target) return false; revokeInvoiceUrl(target); target.invoiceFile = file; target.invoiceFileName = file.name; target.invoiceFileUrl = URL.createObjectURL(file); target.invoiceAmount = amounts.find((amount) => sameAmount(target.amount, amount)) || amounts[0] || ""; return true; }
function findInvoiceTarget(amounts) { const amountList = Array.isArray(amounts) ? amounts : [amounts]; return items.find((item) => !item.invoiceFileName && amountList.some((amount) => sameAmount(item.amount, amount))); }
function sameAmount(left, right) { return Math.abs(Number(left || 0) - Number(right || 0)) < .01; }
function revokeInvoiceUrl(item) { if (item.invoiceFileUrl) URL.revokeObjectURL(item.invoiceFileUrl); }

function renderAll() { renderTable(); renderSummary(); renderReportPreview(); }
function markDirtyAndSave() { if (restoringDraft) return; dirty = true; saveDraft(false); }
function hasDraftableData() { return items.length || $("#projectInput").value.trim() || $("#personInput").value.trim(); }
function draftPayload() { return { version: 2, savedAt: new Date().toISOString(), project: $("#projectInput").value, person: $("#personInput").value, items: items.map(serializeItemForDraft) }; }
function serializeItemForDraft(item) { return { id: item.id, fileName: item.fileName, imageUrl: isDataUrl(item.imageUrl) ? item.imageUrl : "", screenshotPreviewUrl: isDataUrl(item.screenshotPreviewUrl) ? item.screenshotPreviewUrl : "", rawText: item.rawText, date: item.date, category: item.category, type: item.type, amount: item.amount, screenshotAmount: item.screenshotAmount, description: item.description, invoiceFileName: item.invoiceFileName, invoiceAmount: item.invoiceAmount, invoiceLink: item.invoiceLink, invoice: item.invoice, source: item.source || "" }; }
function saveDraft(showStatus) { try { if (!hasDraftableData()) localStorage.removeItem(draftKey); else localStorage.setItem(draftKey, JSON.stringify(draftPayload())); if (showStatus) setStatus("已保存当前状态到本机浏览器。刷新后会自动恢复。"); } catch (error) { console.error(error); if (showStatus) setStatus("保存失败：浏览器本地存储空间可能不足。可先导出文件备份。"); } }
function restoreDraft(showStatus) { const raw = localStorage.getItem(draftKey); if (!raw) { if (showStatus) setStatus("没有可恢复的草稿。"); renderAll(); return; } try { restoringDraft = true; const draft = JSON.parse(raw); items.forEach(revokeInvoiceUrl); $("#projectInput").value = draft.project || ""; $("#personInput").value = draft.person || ""; items = (draft.items || []).map(restoreDraftItem); dirty = false; renderAll(); if (showStatus) setStatus(`已恢复本机草稿${draft.savedAt ? `（保存于 ${formatDraftTime(draft.savedAt)}）` : ""}。PDF 原文件需重新上传后才能合并导出。`); else setStatus(`已自动恢复上次草稿${draft.savedAt ? `（${formatDraftTime(draft.savedAt)}）` : ""}。PDF 原文件需重新上传后才能合并导出。`); } catch (error) { console.error(error); if (showStatus) setStatus("草稿恢复失败，可能已损坏。可清空草稿后重新上传。"); } finally { restoringDraft = false; } }
function restoreDraftItem(item) { return { id: item.id || crypto.randomUUID(), fileName: item.fileName || "已恢复截图", imageUrl: item.imageUrl || "", screenshotPreviewUrl: item.screenshotPreviewUrl || item.imageUrl || "", rawText: item.rawText || "由本机草稿恢复。", date: item.date || "", category: categories.includes(item.category) ? item.category : "其他费用", type: item.type || "其他费用", amount: item.amount || "", screenshotAmount: item.screenshotAmount || "", description: item.description || "", invoiceFile: null, invoiceFileName: item.invoiceFileName || "", invoiceFileUrl: "", invoiceLink: item.invoiceLink || "", invoiceAmount: item.invoiceAmount || "", invoice: item.invoice || "待补", source: item.source || "" }; }
function clearDraft() { if (!localStorage.getItem(draftKey)) return setStatus("当前没有已保存的草稿。"); if (!confirm("确认清空本机保存的草稿吗？当前页面数据不会被删除。")) return; localStorage.removeItem(draftKey); dirty = false; setStatus("已清空本机草稿。当前页面数据仍保留。"); }
function isDataUrl(value) { return /^data:image\//.test(String(value || "")); }
function formatDraftTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value; }
function renderTable() { tableBody.innerHTML = ""; if (!items.length) { tableBody.innerHTML = `<tr><td colspan="9" class="empty">还没有明细。上传付款截图后会自动生成待确认行。</td></tr>`; return; } for (const item of sortedItems()) { const row = document.createElement("tr"); row.dataset.rowId = item.id; const invoiceStatus = hasInvoice(item); row.innerHTML = `<td><input type="date" value="${escapeHtml(item.date)}" data-id="${item.id}" data-field="date"></td><td>${categorySelect(item)}</td><td><input value="${escapeHtml(item.type)}" data-id="${item.id}" data-field="type"></td><td><input class="${item.amount ? "" : "needs-check"}" type="number" step="0.01" value="${escapeHtml(item.amount)}" placeholder="待填写" data-id="${item.id}" data-field="amount"></td><td><textarea data-id="${item.id}" data-field="description">${escapeHtml(item.description)}</textarea></td><td class="${invoiceStatus === "有票" ? "invoice-yes" : "invoice-no"}">${invoiceStatus}</td><td>${invoiceCell(item)}</td><td>${screenshotCell(item)}</td><td><div class="row-actions"><button class="delete" data-delete="${item.id}">删除本条</button><button class="drag-handle" type="button" data-drag-handle="${item.id}" aria-label="拖动调整顺序">拖动</button></div></td>`; tableBody.appendChild(row); } bindTableEvents(); }
function bindTableEvents() { tableBody.querySelectorAll("input,select,textarea").forEach((control) => control.addEventListener("input", (event) => { updateItem(event.target.dataset.id, event.target.dataset.field, event.target.value); if (event.target.dataset.field === "amount") event.target.classList.toggle("needs-check", !event.target.value); })); tableBody.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => { const item = items.find((entry) => entry.id === button.dataset.delete); if (item) revokeInvoiceUrl(item); items = items.filter((entry) => entry.id !== button.dataset.delete); markDirtyAndSave(); renderAll(); })); tableBody.querySelectorAll("[data-preview]").forEach((button) => button.addEventListener("click", () => openImageViewer(button.dataset.preview))); tableBody.querySelectorAll("[data-remove-screenshot]").forEach((button) => button.addEventListener("click", () => removeScreenshot(button.dataset.removeScreenshot))); tableBody.querySelectorAll("[data-screenshot-add]").forEach((input) => input.addEventListener("change", (event) => addScreenshotToItem(input.dataset.screenshotAdd, event.target.files[0]))); tableBody.querySelectorAll("[data-invoice-preview]").forEach((button) => button.addEventListener("click", () => openInvoicePreview(button.dataset.invoicePreview))); tableBody.querySelectorAll("[data-invoice-file]").forEach((input) => input.addEventListener("change", (event) => updateInvoiceFile(input.dataset.invoiceFile, event.target.files[0]))); tableBody.querySelectorAll("[data-remove-invoice]").forEach((button) => button.addEventListener("click", () => removeInvoiceFile(button.dataset.removeInvoice))); bindRowDragEvents(); }
function categorySelect(item) { return `<select data-id="${item.id}" data-field="category">${categories.map((c) => `<option ${item.category === c ? "selected" : ""}>${c}</option>`).join("")}</select>`; }
function screenshotCell(item) { return item.imageUrl ? `<div class="screenshot-cell"><button class="thumb-button" type="button" data-preview="${item.id}"><img class="thumb" src="${item.screenshotPreviewUrl || item.imageUrl}" alt="${escapeHtml(item.fileName)}"></button><button class="screenshot-remove" type="button" data-remove-screenshot="${item.id}" title="删除付款截图" aria-label="删除付款截图">×</button></div>` : `<label class="thumb-empty">${item.source === "微信Excel" ? "待补完整截图" : "点击上传"}<input type="file" accept="image/*" data-screenshot-add="${item.id}" hidden></label>`; }
function invoiceCell(item) { const restoredOnly = item.invoiceFileName && !item.invoiceFileUrl; return `<div class="invoice-cell ${item.invoiceFileUrl ? "has-invoice" : restoredOnly ? "invoice-needs-reupload" : "no-invoice"}">${item.invoiceFileUrl ? `<button class="invoice-upload invoice-preview-action" type="button" data-invoice-preview="${item.id}">预览</button><button class="invoice-remove" type="button" data-remove-invoice="${item.id}">删发票</button><button class="invoice-file" type="button" data-invoice-preview="${item.id}">${escapeHtml(item.invoiceFileName)}</button>${item.invoiceAmount ? `<span class="invoice-amount">发票金额：${escapeHtml(item.invoiceAmount)}</span>` : ""}` : restoredOnly ? `<label class="invoice-upload">重传<input type="file" accept="application/pdf,.pdf" data-invoice-file="${item.id}"></label><button class="invoice-remove" type="button" data-remove-invoice="${item.id}">删记录</button><span class="invoice-file invoice-file-note">${escapeHtml(item.invoiceFileName)}</span><span class="invoice-amount">需重传 PDF 才能预览</span>` : `<label class="invoice-upload">PDF<input type="file" accept="application/pdf,.pdf" data-invoice-file="${item.id}"></label><span class="invoice-empty">未上传 PDF</span>`}</div>`; }
async function updateInvoiceFile(id, file) { if (!file) return; const item = items.find((entry) => entry.id === id); if (!item) return; revokeInvoiceUrl(item); item.invoiceFile = file; item.invoiceFileName = file.name; item.invoiceFileUrl = URL.createObjectURL(file); item.invoiceAmount = window.pdfjsLib ? ((await getInvoiceAmounts(file))[0] || "") : ""; markDirtyAndSave(); setStatus(item.invoiceAmount ? `已上传发票 PDF：${file.name}，识别金额 ${item.invoiceAmount}。刷新后需重新上传原 PDF 才能合并导出。` : `已上传发票 PDF：${file.name}。刷新后需重新上传原 PDF 才能合并导出。`); renderTable(); }
async function openInvoicePreview(id) {
  const item = items.find((entry) => entry.id === id);
  if (!item?.invoiceFileUrl) return setStatus(item?.invoiceFileName ? "草稿只保留了发票名称，请重新上传该 PDF 后再预览。" : "请先上传发票 PDF 后再预览。");
  if (!window.pdfjsLib) return setStatus("PDF 预览组件还没有加载完成，请稍后再试。");

  const run = ++pdfPreviewRun;
  pdfViewerTitle.textContent = item.invoiceFileName || "发票 PDF 预览";
  pdfPages.innerHTML = '<div class="pdf-loading">正在生成页面内预览...</div>';
  pdfViewer.classList.add("open");
  document.body.classList.add("viewer-open");

  try {
    const source = item.invoiceFile ? await item.invoiceFile.arrayBuffer() : await (await fetch(item.invoiceFileUrl)).arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: source }).promise;
    if (run !== pdfPreviewRun) return;
    pdfPages.innerHTML = "";
    const availableWidth = Math.max(280, Math.min(1200, pdfPages.clientWidth - 24));
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (run !== pdfPreviewRun) return;
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, availableWidth / baseViewport.width);
      const outputScale = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
      const viewport = page.getViewport({ scale });
      const renderViewport = page.getViewport({ scale: scale * outputScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      canvas.setAttribute("aria-label", `发票 PDF 第 ${pageNumber} 页`);
      pdfPages.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: renderViewport }).promise;
    }
    setStatus("已在当前页面生成 PDF 预览，不会跳转到下载页。");
  } catch (error) {
    console.error(error);
    if (run === pdfPreviewRun) {
      pdfPages.innerHTML = '<div class="pdf-loading">预览失败，请关闭后重新上传该 PDF 再试。</div>';
      setStatus("PDF 预览失败，请重新上传该发票 PDF 后再试。");
    }
  }
}
function removeInvoiceFile(id) { const item = items.find((entry) => entry.id === id); if (!item) return; revokeInvoiceUrl(item); item.invoiceFile = null; item.invoiceFileName = ""; item.invoiceFileUrl = ""; item.invoiceAmount = ""; if (item.screenshotAmount) item.amount = item.screenshotAmount; markDirtyAndSave(); setStatus(item.screenshotAmount ? `已删除该行发票 PDF，金额已恢复为截图识别金额 ${item.screenshotAmount}。` : "已删除该行发票 PDF。"); renderAll(); }
function removeScreenshot(id) { const item = items.find((entry) => entry.id === id); if (!item?.imageUrl) return; item.imageUrl = ""; item.screenshotPreviewUrl = ""; item.fileName = ""; markDirtyAndSave(); setStatus("已删除该行付款截图，明细和发票信息仍保留。"); renderAll(); }

async function addScreenshotToItem(id, file) { if (!file) return; const item = items.find((entry) => entry.id === id); if (!item) return; item.imageUrl = await imageFileToDraftDataUrl(file); item.screenshotPreviewUrl = item.imageUrl; item.fileName = file.name; item.rawText = ""; try { const images = await prepareImageForOcr(file); const recognized = await recognizePaymentImage(images, file.name); item.rawText = recognized.text; const parsedPreview = parsePaymentText(recognized.text, file.name); item.screenshotPreviewUrl = await imageFileToAmountPreviewDataUrl(file, selectBestAmountPreviewBox(recognized.amountPreviewCandidates, parsedPreview.amount, images.fullWidth, images.fullHeight), images.fullWidth, images.fullHeight) || item.imageUrl; } catch (error) { console.error(error); } markDirtyAndSave(); setStatus(`已上传截图：${file.name}。请确认金额和说明是否正确。`); renderAll(); }
function bindRowDragEvents() { let dragId = ""; let overId = ""; const clear = () => tableBody.querySelectorAll(".drag-over,.dragging").forEach((row) => row.classList.remove("drag-over", "dragging")); tableBody.querySelectorAll("[data-drag-handle]").forEach((handle) => { handle.addEventListener("pointerdown", (event) => { dragId = handle.dataset.dragHandle; overId = dragId; handle.setPointerCapture?.(event.pointerId); handle.closest("tr")?.classList.add("dragging"); document.body.classList.add("drag-sorting"); event.preventDefault(); }); handle.addEventListener("pointermove", (event) => { if (!dragId) return; const row = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("tr[data-row-id]"); if (!row || row.dataset.rowId === overId) return; tableBody.querySelectorAll(".drag-over").forEach((entry) => entry.classList.remove("drag-over")); overId = row.dataset.rowId; row.classList.add("drag-over"); }); handle.addEventListener("pointerup", (event) => { handle.releasePointerCapture?.(event.pointerId); if (dragId && overId && dragId !== overId) reorderItems(dragId, overId); dragId = ""; overId = ""; document.body.classList.remove("drag-sorting"); clear(); }); handle.addEventListener("pointercancel", () => { dragId = ""; overId = ""; document.body.classList.remove("drag-sorting"); clear(); }); }); }
function reorderItems(sourceId, targetId) { const from = items.findIndex((item) => item.id === sourceId); const to = items.findIndex((item) => item.id === targetId); if (from < 0 || to < 0 || from === to) return; const [moved] = items.splice(from, 1); items.splice(to, 0, moved); markDirtyAndSave(); setStatus("已调整明细顺序，导出时会按当前顺序排列。"); renderAll(); }
function updateItem(id, field, value) { const item = items.find((entry) => entry.id === id); if (!item) return; item[field] = value; markDirtyAndSave(); if (field === "date") renderAll(); else { renderSummary(); renderReportPreview(); } }
function getTotals() { return categories.map((category) => { const matched = items.filter((item) => item.category === category); return { category, amount: sumAmount(matched), count: matched.length }; }); }
function renderSummary() { const totals = getTotals(); $("#totalAmount").textContent = sumAmount(items).toFixed(2); $("#summaryCards").innerHTML = totals.map((item) => `<div class="summary-card"><span>${item.category}</span><small>${item.count} 条</small><strong>${item.amount.toFixed(2)}</strong></div>`).join(""); }
function renderReportPreview() { $("#reportPreview").innerHTML = `<div class="report-block"><h3>报销汇总</h3><table><tbody><tr><th>关联项目编号</th><td>${escapeHtml($("#projectInput").value)}</td><th>报销人</th><td>${escapeHtml($("#personInput").value)}</td></tr><tr><th>合计</th><td>${sumAmount(items).toFixed(2)}</td><th>明细条数</th><td>${items.length}</td></tr></tbody></table></div>` + categories.map(reportBlock).join(""); }
function reportBlock(category) { const matched = sortedItems().filter((item) => item.category === category); const rows = matched.map((item) => `<tr><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.type)}</td><td>${Number(item.amount || 0).toFixed(2)}</td><td>${escapeHtml(item.description)}</td><td>${hasInvoice(item)}</td><td>${escapeHtml(invoiceSummary(item))}</td></tr>`).join(""); return `<div class="report-block"><h3>${category}合计：${sumAmount(matched).toFixed(2)}</h3>${matched.length ? `<table><thead><tr><th>时间</th><th>费用类型</th><th>金额</th><th>费用说明</th><th>是否有发票</th><th>发票</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">暂无${category}明细</div>`}</div>`; }
function sumAmount(list) { return list.reduce((sum, item) => sum + Number(item.amount || 0), 0); }
function invoiceSummary(item) { return [item.invoiceFileName, item.invoiceAmount ? `金额 ${item.invoiceAmount}` : ""].filter(Boolean).join(" / "); }
function hasInvoice(item) { return item.invoiceFileName ? "有票" : "无票"; }
function sortedItems(list = items) { return [...list]; }
function reportOrderedItems() { return categories.flatMap((category) => sortedItems(items.filter((item) => item.category === category))); }
function dateSortValue(value) { const date = Date.parse(String(value || "").replace(/\//g, "-")); return Number.isFinite(date) ? date : Number.MAX_SAFE_INTEGER; }
function exportRows() { const project = $("#projectInput").value.trim(); const person = $("#personInput").value.trim(); return sortedItems().map((item, index) => ({ 序号: index + 1, 关联项目编号: project, 报销人: person, 日期: item.date, 一级费用类别: item.category, 费用类型: item.type, 金额: Number(item.amount || 0), 费用说明: item.description, 是否有发票: hasInvoice(item), 发票PDF文件名: item.invoiceFileName || "", 发票识别金额: item.invoiceAmount || "", 发票链接: item.invoiceLink || "", 付款截图文件名: item.fileName, 备注: "由付款截图识别整理" })); }
function exportCsv() { if (!validateExportMeta()) return; if (!items.length) return setStatus("没有可导出的明细。"); const rows = exportRows(); const headers = Object.keys(rows[0]); const csv = [headers.join(",")].concat(rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))).join("\n"); downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `${exportBaseFileName("报销明细")}-报销明细.csv`); }
function exportXlsx() { if (!validateExportMeta()) return; if (!items.length) return setStatus("没有可导出的明细。"); const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(buildTemplateRows()); ws["!merges"] = [{ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } }]; ws["!cols"] = [{ wch: 9.16 }, { wch: 16.66 }, { wch: 11.83 }, { wch: 11 }, { wch: 88.83 }, { hidden: true }]; ws["!rows"] = Array.from({ length: 84 }, (_, index) => ({ hpt: index === 0 ? 35.25 : 18 })); applyTemplateSheetStyle(ws); XLSX.utils.book_append_sheet(wb, ws, "Sheet1"); const fileName = `${exportBaseFileName("报销明细")}-报销明细.xlsx`; XLSX.writeFile(wb, fileName); markExportDone(fileName); }

function buildTemplateRows() {
  const rows = Array.from({ length: 84 }, () => Array(6).fill(null));
  rows[1][1] = "关联项目编号";
  rows[1][2] = $("#projectInput").value.trim();
  rows[2][1] = "费用类别";
  rows[2][2] = "金额";
  rows[2][3] = "发票金额";

  const config = [
    { category: "交通费", title: "交通费", titleRow: 10, headerRow: 11, startRow: 12, endRow: 21, sumRow: 22, totalRow: 3, note: "费用说明（需说明该笔费用如何产生，比如私车公用的起始地点和行驶里程、停车时间、高速费的起始地点等）" },
    { category: "差旅费", title: "差旅费", titleRow: 24, headerRow: 25, startRow: 26, endRow: 37, sumRow: 38, totalRow: 4, note: "费用说明（住宿费需说明几人几间房几晚等）" },
    { category: "餐费", title: "餐费", titleRow: 40, headerRow: 41, startRow: 42, endRow: 51, sumRow: 52, totalRow: 5, note: "费用说明（需说明几人用餐及用餐场景）" },
    { category: "物料费", title: "物料采购", titleRow: 55, headerRow: 56, startRow: 57, endRow: 66, sumRow: 67, totalRow: 6, note: "费用说明（需说明采购原因及用途）" },
    { category: "其他费用", title: "其他费用", titleRow: 71, headerRow: 72, startRow: 73, endRow: 82, sumRow: 83, totalRow: 7, note: "费用说明" },
  ];

  for (const block of config) {
    const matched = sortedItems(items.filter((item) => item.category === block.category)).slice(0, block.endRow - block.startRow + 1);
    const blockAmount = sumAmount(matched);
    const blockInvoiceAmount = sumInvoiceAmount(matched);
    rows[block.totalRow][1] = `${block.category}合计`;
    rows[block.totalRow][2] = formulaCell(`D${block.sumRow + 1}`, blockAmount);
    rows[block.totalRow][3] = formulaCell(`F${block.sumRow + 1}`, blockInvoiceAmount);
    rows[block.titleRow][1] = block.title;
    rows[block.headerRow][1] = "时间";
    rows[block.headerRow][2] = "费用类型";
    rows[block.headerRow][3] = "金额";
    rows[block.headerRow][4] = block.note;

    matched.forEach((item, index) => {
      const row = rows[block.startRow + index];
      row[1] = item.date;
      row[2] = item.type;
      row[3] = Number(item.amount || 0);
      row[4] = item.description;
      row[5] = Number(item.invoiceAmount || 0);
    });
    rows[block.sumRow][1] = "合计";
    rows[block.sumRow][3] = formulaCell(`SUM(D${block.startRow + 1}:D${block.endRow + 1})`, blockAmount);
    rows[block.sumRow][5] = formulaCell(`SUM(F${block.startRow + 1}:F${block.endRow + 1})`, blockInvoiceAmount);
  }

  rows[8][1] = "合计";
  rows[8][2] = formulaCell("SUM(C4:C8)", sumAmount(items));
  rows[8][3] = formulaCell("SUM(D4:D8)", sumInvoiceAmount(items));
  return rows;
}

function formulaCell(formula, value) { return { f: formula, t: "n", v: Number(value || 0) }; }
function sumInvoiceAmount(list) { return list.reduce((sum, item) => sum + Number(item.invoiceAmount || 0), 0); }
function validateExportMeta() { const project = $("#projectInput").value.trim(); const person = $("#personInput").value.trim(); if (project && person) return true; setStatus(!project && !person ? "请先填写关联项目编号和报销人，再导出文件。" : !project ? "请先填写关联项目编号，再导出文件。" : "请先填写报销人，再导出文件。"); (!project ? $("#projectInput") : $("#personInput")).focus(); return false; }
function exportBaseFileName(fallback) { const project = $("#projectInput").value.trim(); const person = $("#personInput").value.trim(); return sanitizeFileName([project, person].filter(Boolean).join("-") || fallback); }
function sanitizeFileName(value) { return String(value || "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "").slice(0, 80) || "自动整理报销表"; }

function applyTemplateSheetStyle(ws) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = 0; c <= 4; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { t: "z", v: null };
      ws[ref].s = {
        font: { name: "微软雅黑", sz: 10 },
        alignment: { vertical: "center", wrapText: c === 4 },
        border: { top: { style: "thin", color: { rgb: "D9D9D9" } }, bottom: { style: "thin", color: { rgb: "D9D9D9" } }, left: { style: "thin", color: { rgb: "D9D9D9" } }, right: { style: "thin", color: { rgb: "D9D9D9" } } },
      };
    }
  }
}

async function exportScreenshotsDoc() {
  if (!validateExportMeta()) return;
  const rows = reportOrderedItems().filter((item) => item.imageUrl);
  if (!rows.length) return setStatus("没有可导出的截图。");
  if (window.JSZip) return exportScreenshotsDocx(rows);
  const cards = await Promise.all(rows.map(async (item) => {
    const dataUrl = await imageUrlToFittedDataUrl(item.imageUrl);
    return `<td class="shot-cell"><div class="shot-frame"><img src="${dataUrl}"></div></td>`;
  }));
  const pages = [];
  for (let start = 0; start < cards.length; start += 16) {
    const pageCards = cards.slice(start, start + 16);
    while (pageCards.length < 16) pageCards.push(`<td class="shot-cell empty"></td>`);
    pages.push(`<div class="page"><table class="shot-table"><tr>${pageCards.slice(0, 8).join("")}</tr><tr>${pageCards.slice(8, 16).join("")}</tr></table></div>`);
  }
  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><meta name="Generator" content="Microsoft Word"><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><style>@page{size:841.9pt 595.3pt;margin:90pt 72pt 90pt 72pt}@page WordSection1{size:841.9pt 595.3pt;mso-page-orientation:landscape;margin:90pt 72pt 90pt 72pt}body{margin:0}div.WordSection1{page:WordSection1}.page{width:697.7pt;height:405.6pt;page-break-after:always;overflow:hidden}.shot-table{width:697.7pt;height:405.6pt;border-collapse:collapse;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt}.shot-cell{width:87.2pt;height:202.8pt;padding:0;border:0.75pt solid #d9d9d9;vertical-align:middle;text-align:center;overflow:hidden;page-break-inside:avoid}.shot-frame{width:100%;height:100%;overflow:hidden;text-align:center}.shot-frame img{display:block;width:100%;height:100%;border:0}.empty{border-color:#eeeeee}.page:last-child{page-break-after:auto}</style></head><body><div class="WordSection1">${pages.join("")}</div></body></html>`;
  downloadBlob(new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" }), `${exportBaseFileName("报销")}-付款截图.doc`);
}

async function exportScreenshotsDocx(rows) {
  setStatus("正在生成付款截图 Word...");
  const zip = new JSZip();
  const images = await Promise.all(rows.map(async (item, index) => ({
    id: index + 1,
    ...(await imageUrlToOriginalImageData(item.imageUrl)),
  })));
  images.forEach((image) => zip.file(`word/media/image${image.id}.png`, image.data));
  zip.file("[Content_Types].xml", docxContentTypes(images.length));
  zip.folder("_rels").file(".rels", docxRootRels());
  zip.folder("word").file("document.xml", docxDocumentXml(images));
  zip.folder("word").folder("_rels").file("document.xml.rels", docxDocumentRels(images.length));
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const fileName = `${exportBaseFileName("报销")}-付款截图.docx`;
  downloadBlob(blob, fileName);
  markExportDone(fileName);
}

function docxDocumentXml(images) {
  const pages = [];
  for (let start = 0; start < images.length; start += 16) pages.push(docxTable(images.slice(start, start + 16), start + 16 < images.length));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${pages.join("")}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1800" w:right="1440" w:bottom="1800" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function docxTable(pageImages, addBreak) {
  const cells = Array.from({ length: 16 }, (_, index) => docxCell(pageImages[index]));
  return `<w:tbl><w:tblPr><w:tblW w:w="13954" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${docxBorder("top")}${docxBorder("left")}${docxBorder("bottom")}${docxBorder("right")}${docxBorder("insideH")}${docxBorder("insideV")}</w:tblBorders></w:tblPr><w:tblGrid>${Array.from({ length: 8 }, () => `<w:gridCol w:w="1744"/>`).join("")}</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="4056" w:hRule="exact"/></w:trPr>${cells.slice(0, 8).join("")}</w:tr><w:tr><w:trPr><w:trHeight w:val="4056" w:hRule="exact"/></w:trPr>${cells.slice(8, 16).join("")}</w:tr></w:tbl>${addBreak ? `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` : ""}`;
}

function docxCell(image) {
  const content = image ? docxImage(image) : "";
  return `<w:tc><w:tcPr><w:tcW w:w="1744" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${content}</w:r></w:p></w:tc>`;
}

function docxImage(image) {
  const width = 1107440;
  const height = Math.max(1, Math.round(width * image.height / image.width));
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${image.id}" name="付款截图${image.id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${image.id}" name="image${image.id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${image.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function docxBorder(name) { return `<w:${name} w:val="single" w:sz="6" w:color="D9D9D9"/>`; }
function docxContentTypes(count) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`; }
function docxRootRels() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`; }
function docxDocumentRels(count) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${index + 1}.png"/>`).join("")}</Relationships>`; }
function dataUrlToUint8Array(dataUrl) { const base64 = dataUrl.split(",")[1] || ""; const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes; }

async function exportInvoicesPdf() {
  if (!validateExportMeta()) return;
  const invoiceItems = sortedItems().filter((item) => item.invoiceFile);
  if (!invoiceItems.length) return setStatus("没有可导出的发票 PDF。请先上传发票 PDF 文件。");
  if (!window.PDFLib) return setStatus("PDF 合并组件还没加载完成，请稍后再试。");
  const merged = await PDFLib.PDFDocument.create();
  for (const item of invoiceItems) {
    const source = await PDFLib.PDFDocument.load(await item.invoiceFile.arrayBuffer());
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const bytes = await merged.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${exportBaseFileName("报销")}-发票.pdf`);
}

async function exportReportPreviewImage() {
  if (!validateExportMeta()) return;
  if (!window.html2canvas) return setStatus("预览截图组件还没加载完成，请稍后再试。");
  const panel = $("#reportPreviewPanel");
  const preview = $("#reportPreview");
  if (!panel || !preview) return setStatus("没有找到报销单预览区域。");
  setStatus("正在生成报销单预览图...");
  const restore = prepareReportPreviewCapture(panel, preview);
  await nextFrame();
  try {
    const exportScale = getReportPreviewExportScale(panel);
    const canvas = await html2canvas(panel, {
      backgroundColor: "#fffdf8",
      scale: exportScale,
      useCORS: true,
      logging: false,
      width: panel.scrollWidth,
      height: panel.scrollHeight,
      windowWidth: Math.max(document.documentElement.clientWidth, panel.scrollWidth),
      windowHeight: Math.max(document.documentElement.clientHeight, panel.scrollHeight),
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return setStatus("生成预览图失败，请重试。");
    const fileName = `${exportBaseFileName("报销")}-报销单预览.png`;
    downloadBlob(blob, fileName);
    markReportPreviewExportDone(fileName);
  } catch (error) {
    console.error(error);
    setStatus("生成预览图失败，请重试。");
  } finally {
    restore();
  }
}

function getReportPreviewExportScale(panel) {
  const width = Math.max(panel.scrollWidth, panel.getBoundingClientRect().width, 1);
  const height = Math.max(panel.scrollHeight, panel.getBoundingClientRect().height, 1);
  const targetWidth = 3600;
  const maxPixels = 24000000;
  const sharpScale = Math.max(3, targetWidth / width);
  const safeScale = Math.sqrt(maxPixels / (width * height));
  return Math.max(2, Math.min(4, sharpScale, safeScale));
}

function prepareReportPreviewCapture(panel, preview) {
  const previous = { panelStyle: panel.getAttribute("style"), previewStyle: preview.getAttribute("style") };
  const captureWidth = Math.max(panel.scrollWidth, preview.scrollWidth + 30, 900);
  panel.style.width = `${captureWidth}px`;
  panel.style.maxWidth = "none";
  preview.style.overflow = "visible";
  preview.style.width = "100%";
  preview.style.maxWidth = "none";
  return () => {
    if (previous.panelStyle === null) panel.removeAttribute("style"); else panel.setAttribute("style", previous.panelStyle);
    if (previous.previewStyle === null) preview.removeAttribute("style"); else preview.setAttribute("style", previous.previewStyle);
  };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function imageUrlToDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
}

async function imageUrlToFittedDataUrl(url) {
  const image = await loadImage(url);
  const width = 640;
  const height = 930;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = Math.round(image.naturalWidth * scale);
  const drawHeight = Math.round(image.naturalHeight * scale);
  const left = Math.round((width - drawWidth) / 2);
  const top = Math.round((height - drawHeight) / 2);
  ctx.drawImage(image, left, top, drawWidth, drawHeight);
  return canvas.toDataURL("image/png");
}

async function imageUrlToOriginalImageData(url) {
  const image = await loadImage(url);
  return { data: dataUrlToUint8Array(await imageUrlToDataUrl(url)), width: image.naturalWidth || 1, height: image.naturalHeight || 1 };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function invoiceTotalByCategory(category) {
  return items.filter((item) => item.category === category && hasInvoice(item) === "是").reduce((sum, item) => sum + Number(item.invoiceAmount || item.amount || 0), 0);
}
function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function downloadBlob(blob, fileName) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); dirty = false; saveDraft(false); markExportDone(fileName); }
function markExportDone(fileName) { setStatus(`已导出：${fileName}。请在浏览器下载记录或系统“下载”文件夹中查看；网页无法直接打开本地文件夹。`); }
function markReportPreviewExportDone(fileName) { setStatus(`已导出 PNG 图片：${fileName}。手机端请在浏览器下载记录或“文件”App 中打开，长按图片或点分享后选择“保存到相册”。`); }
function openImageViewer(id) { const item = items.find((entry) => entry.id === id); if (!item) return; viewerImage.src = item.imageUrl; viewerCaption.textContent = item.fileName; imageViewer.classList.add("open"); document.body.classList.add("viewer-open"); }
function closeImageViewer() { imageViewer.classList.remove("open"); viewerImage.removeAttribute("src"); document.body.classList.remove("viewer-open"); }
function openTextViewer(id) { const item = items.find((entry) => entry.id === id); if (!item) return; rawText.textContent = item.rawText || "无 OCR 原文"; textViewer.classList.add("open"); document.body.classList.add("viewer-open"); }
function closeTextViewer() { textViewer.classList.remove("open"); document.body.classList.remove("viewer-open"); }
function closePdfViewer() { pdfPreviewRun += 1; pdfViewer.classList.remove("open"); pdfPages.innerHTML = ""; document.body.classList.remove("viewer-open"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function setStatus(message) { statusBar.textContent = message; }
renderAll();
