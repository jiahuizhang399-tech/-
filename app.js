const categories = ["交通费", "差旅费", "餐费", "物料费", "其他费用"];
const categoryRules = [
  { category: "交通费", type: "高速费", words: ["高速", "通行费", "通行费用", "通行", "etc", "收费站", "收费所", "停车区", "服务区", "隧道"] },
  { category: "交通费", type: "停车费", words: ["停车"] },
  { category: "交通费", type: "打车费", words: ["滴滴", "出租", "网约车", "出行"] },
  { category: "餐费", type: "餐费", words: ["餐", "饭", "咖啡", "美食", "luckin", "午餐"] },
  { category: "物料费", type: "物料采购", words: ["采购", "道具", "设备", "耗材", "快递"] },
];

let items = [];
const draftKey = "reimbursement-draft-v2";
let dirty = false;
let restoringDraft = false;
const $ = (selector) => document.querySelector(selector);
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const invoiceBatchInput = $("#invoiceBatchInput");
const invoiceDropZone = $("#invoiceDropZone");
const statusBar = $("#statusBar");
const tableBody = $("#itemsTable tbody");
const imageViewer = $("#imageViewer");
const viewerImage = $("#viewerImage");
const viewerCaption = $("#viewerCaption");
const textViewer = $("#textViewer");
const rawText = $("#rawText");
const pdfViewer = $("#pdfViewer");
const pdfFrame = $("#pdfFrame");
const pdfViewerTitle = $("#pdfViewerTitle");

invoiceBatchInput.multiple = true;
invoiceBatchInput.setAttribute("multiple", "");
invoiceBatchInput.accept = "application/pdf,.pdf,*/*";
fileInput.addEventListener("change", (event) => handleFiles(event.target.files));
fileInput.addEventListener("click", () => { fileInput.value = ""; });
invoiceBatchInput.addEventListener("change", (event) => handleInvoiceFiles(event.target.files));
invoiceBatchInput.addEventListener("click", () => { invoiceBatchInput.value = ""; });
for (const zone of [dropZone, invoiceDropZone]) {
  ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove("dragover"); }));
}
dropZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));
invoiceDropZone.addEventListener("drop", (event) => handleInvoiceFiles(event.dataTransfer.files));
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
window.addEventListener("beforeunload", (event) => { if (!dirty || !hasDraftableData()) return; event.preventDefault(); event.returnValue = ""; });
restoreDraft(false);

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    setStatus(`正在识别 ${index + 1}/${files.length}：${file.name}`);
    const imageUrl = await imageFileToDraftDataUrl(file);
    let text = "";
    try {
      const images = await prepareImageForOcr(file);
      text = await recognizePaymentImage(images, file.name);
    } catch (error) {
      console.error(error);
      setStatus(`OCR 识别失败：${file.name}。已创建空白行，可手动填写。`);
    }
    const parsed = parsePaymentText(text, file.name);
    items.push({ id: crypto.randomUUID(), fileName: file.name, imageUrl, rawText: `${text}\n__AMOUNT_EXPLAIN__ ${explainPaymentAmount(text)}`, screenshotAmount: parsed.amount, invoiceFile: null, invoiceFileName: "", invoiceFileUrl: "", invoiceLink: "", invoiceAmount: "", ...parsed });
    markDirtyAndSave();
    renderAll();
  }
  const missing = items.filter((item) => !item.amount).length;
  setStatus(missing ? `已处理 ${files.length} 张截图，其中 ${missing} 条未识别到金额。` : `已处理 ${files.length} 张截图。`);
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
  return `${result.data.text || ""}\n__VISUAL_AMOUNT__ ${bestVisualAmount(visualAmounts)}\n__DATE_REGION__\n${dateResult.data.text || ""}\n__MAIN_AMOUNT_REGION__\n${mainAmountResult.data.text || ""}\n__LOWER_MAIN_AMOUNT_REGION__\n${lowerMainAmountResult.data.text || ""}\n__AMOUNT_REGION__\n${amountResult.data.text || ""}\n__MIDDLE_AMOUNT_REGION__\n${middleResult.data.text || ""}\n__TOP_AMOUNT_REGION__\n${topAmountResult.data.text || ""}\n__UPPER_REGION__\n${upperResult.data.text || ""}`;
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

async function prepareImageForOcr(file) { const bitmap = await createImageBitmap(file); const scale = Math.min(2.5, Math.max(1.4, 1800 / bitmap.width)); const canvas = createScaledCanvas(bitmap, scale); enhanceCanvas(canvas); return { full: await canvasToBlob(canvas, file), mainAmountRegion: await canvasToBlob(cropCanvas(canvas, canvas.width * .22, canvas.height * .20, canvas.width * .56, canvas.height * .13), file), lowerMainAmountRegion: await canvasToBlob(cropCanvas(canvas, canvas.width * .20, canvas.height * .23, canvas.width * .60, canvas.height * .14), file), amountRegion: await canvasToBlob(cropCanvas(canvas, canvas.width * .10, canvas.height * .12, canvas.width * .80, canvas.height * .28), file), topAmountRegion: await canvasToBlob(cropCanvas(canvas, canvas.width * .14, canvas.height * .18, canvas.width * .72, canvas.height * .22), file), middleRegion: await canvasToBlob(cropCanvas(canvas, canvas.width * .12, canvas.height * .24, canvas.width * .76, canvas.height * .30), file), upperRegion: await canvasToBlob(cropCanvas(canvas, canvas.width * .03, canvas.height * .03, canvas.width * .94, canvas.height * .52), file), dateRegion: await canvasToBlob(cropCanvas(canvas, canvas.width * .04, canvas.height * .40, canvas.width * .92, canvas.height * .45), file) }; }
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
  for (const keyword of ["价税合计", "税价合计", "小写", "发票金额"]) {
    let index = text.indexOf(keyword);
    while (index >= 0) {
      windows.push(text.slice(index, index + 260));
      index = text.indexOf(keyword, index + keyword.length);
    }
  }

  const patterns = [
    /[零〇壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]+\s*[¥￥]?\s*(\d{1,5}\.\d{2})/,
    /(\d{1,5}\.\d{2})\s*[¥￥]?\s*[零〇壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]+/,
    /小写[\s\S]{0,80}[¥￥]?\s*(\d{1,5}\.\d{2})/,
    /[¥￥]\s*(\d{1,5}\.\d{2})/,
  ];

  for (const windowText of windows) {
    for (const pattern of patterns) {
      const match = windowText.match(pattern);
      const amount = normalizeAmount(match && match[1]);
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
function serializeItemForDraft(item) { return { id: item.id, fileName: item.fileName, imageUrl: isDataUrl(item.imageUrl) ? item.imageUrl : "", rawText: item.rawText, date: item.date, category: item.category, type: item.type, amount: item.amount, screenshotAmount: item.screenshotAmount, description: item.description, invoiceFileName: item.invoiceFileName, invoiceAmount: item.invoiceAmount, invoiceLink: item.invoiceLink, invoice: item.invoice }; }
function saveDraft(showStatus) { try { if (!hasDraftableData()) localStorage.removeItem(draftKey); else localStorage.setItem(draftKey, JSON.stringify(draftPayload())); if (showStatus) setStatus("已保存当前状态到本机浏览器。刷新后会自动恢复。"); } catch (error) { console.error(error); if (showStatus) setStatus("保存失败：浏览器本地存储空间可能不足。可先导出文件备份。"); } }
function restoreDraft(showStatus) { const raw = localStorage.getItem(draftKey); if (!raw) { if (showStatus) setStatus("没有可恢复的草稿。"); renderAll(); return; } try { restoringDraft = true; const draft = JSON.parse(raw); items.forEach(revokeInvoiceUrl); $("#projectInput").value = draft.project || ""; $("#personInput").value = draft.person || ""; items = (draft.items || []).map(restoreDraftItem); dirty = false; renderAll(); if (showStatus) setStatus(`已恢复本机草稿${draft.savedAt ? `（保存于 ${formatDraftTime(draft.savedAt)}）` : ""}。PDF 原文件需重新上传后才能合并导出。`); else setStatus(`已自动恢复上次草稿${draft.savedAt ? `（${formatDraftTime(draft.savedAt)}）` : ""}。PDF 原文件需重新上传后才能合并导出。`); } catch (error) { console.error(error); if (showStatus) setStatus("草稿恢复失败，可能已损坏。可清空草稿后重新上传。"); } finally { restoringDraft = false; } }
function restoreDraftItem(item) { return { id: item.id || crypto.randomUUID(), fileName: item.fileName || "已恢复截图", imageUrl: item.imageUrl || "", rawText: item.rawText || "由本机草稿恢复。", date: item.date || "", category: categories.includes(item.category) ? item.category : "其他费用", type: item.type || "其他费用", amount: item.amount || "", screenshotAmount: item.screenshotAmount || "", description: item.description || "", invoiceFile: null, invoiceFileName: item.invoiceFileName || "", invoiceFileUrl: "", invoiceLink: item.invoiceLink || "", invoiceAmount: item.invoiceAmount || "", invoice: item.invoice || "待补" }; }
function clearDraft() { if (!localStorage.getItem(draftKey)) return setStatus("当前没有已保存的草稿。"); if (!confirm("确认清空本机保存的草稿吗？当前页面数据不会被删除。")) return; localStorage.removeItem(draftKey); dirty = false; setStatus("已清空本机草稿。当前页面数据仍保留。"); }
function isDataUrl(value) { return /^data:image\//.test(String(value || "")); }
function formatDraftTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value; }
function renderTable() { tableBody.innerHTML = ""; if (!items.length) { tableBody.innerHTML = `<tr><td colspan="9" class="empty">还没有明细。上传付款截图后会自动生成待确认行。</td></tr>`; return; } for (const item of sortedItems()) { const row = document.createElement("tr"); const invoiceStatus = hasInvoice(item); row.innerHTML = `<td><input type="date" value="${escapeHtml(item.date)}" data-id="${item.id}" data-field="date"></td><td>${categorySelect(item)}</td><td><input value="${escapeHtml(item.type)}" data-id="${item.id}" data-field="type"></td><td><input class="${item.amount ? "" : "needs-check"}" type="number" step="0.01" value="${escapeHtml(item.amount)}" placeholder="待填写" data-id="${item.id}" data-field="amount"></td><td><textarea data-id="${item.id}" data-field="description">${escapeHtml(item.description)}</textarea></td><td class="${invoiceStatus === "有票" ? "invoice-yes" : "invoice-no"}">${invoiceStatus}</td><td>${invoiceCell(item)}</td><td>${screenshotCell(item)}</td><td><button class="delete" data-delete="${item.id}">删除本条</button></td>`; tableBody.appendChild(row); } bindTableEvents(); }
function bindTableEvents() { tableBody.querySelectorAll("input,select,textarea").forEach((control) => control.addEventListener("input", (event) => { updateItem(event.target.dataset.id, event.target.dataset.field, event.target.value); if (event.target.dataset.field === "amount") event.target.classList.toggle("needs-check", !event.target.value); })); tableBody.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => { const item = items.find((entry) => entry.id === button.dataset.delete); if (item) revokeInvoiceUrl(item); items = items.filter((entry) => entry.id !== button.dataset.delete); markDirtyAndSave(); renderAll(); })); tableBody.querySelectorAll("[data-preview]").forEach((button) => button.addEventListener("click", () => openImageViewer(button.dataset.preview))); tableBody.querySelectorAll("[data-invoice-preview]").forEach((button) => button.addEventListener("click", () => openInvoicePreview(button.dataset.invoicePreview))); tableBody.querySelectorAll("[data-invoice-file]").forEach((input) => input.addEventListener("change", (event) => updateInvoiceFile(input.dataset.invoiceFile, event.target.files[0]))); tableBody.querySelectorAll("[data-remove-invoice]").forEach((button) => button.addEventListener("click", () => removeInvoiceFile(button.dataset.removeInvoice))); }
function categorySelect(item) { return `<select data-id="${item.id}" data-field="category">${categories.map((c) => `<option ${item.category === c ? "selected" : ""}>${c}</option>`).join("")}</select>`; }
function screenshotCell(item) { return item.imageUrl ? `<button class="thumb-button" type="button" data-preview="${item.id}"><img class="thumb" src="${item.imageUrl}" alt="${escapeHtml(item.fileName)}"></button>` : `<span class="thumb-empty">手动</span>`; }
function invoiceCell(item) { const restoredOnly = item.invoiceFileName && !item.invoiceFileUrl; return `<div class="invoice-cell ${item.invoiceFileUrl ? "has-invoice" : restoredOnly ? "invoice-needs-reupload" : "no-invoice"}">${item.invoiceFileUrl ? `<button class="invoice-upload invoice-preview-action" type="button" data-invoice-preview="${item.id}">预览</button><button class="invoice-remove" type="button" data-remove-invoice="${item.id}">删发票</button><button class="invoice-file" type="button" data-invoice-preview="${item.id}">${escapeHtml(item.invoiceFileName)}</button>${item.invoiceAmount ? `<span class="invoice-amount">发票金额：${escapeHtml(item.invoiceAmount)}</span>` : ""}` : restoredOnly ? `<label class="invoice-upload">重传<input type="file" accept="application/pdf,.pdf" data-invoice-file="${item.id}"></label><button class="invoice-remove" type="button" data-remove-invoice="${item.id}">删记录</button><span class="invoice-file invoice-file-note">${escapeHtml(item.invoiceFileName)}</span><span class="invoice-amount">需重传 PDF 才能预览</span>` : `<label class="invoice-upload">PDF<input type="file" accept="application/pdf,.pdf" data-invoice-file="${item.id}"></label><span class="invoice-empty">未上传 PDF</span>`}</div>`; }
async function updateInvoiceFile(id, file) { if (!file) return; const item = items.find((entry) => entry.id === id); if (!item) return; revokeInvoiceUrl(item); item.invoiceFile = file; item.invoiceFileName = file.name; item.invoiceFileUrl = URL.createObjectURL(file); item.invoiceAmount = window.pdfjsLib ? ((await getInvoiceAmounts(file))[0] || "") : ""; markDirtyAndSave(); setStatus(item.invoiceAmount ? `已上传发票 PDF：${file.name}，识别金额 ${item.invoiceAmount}。刷新后需重新上传原 PDF 才能合并导出。` : `已上传发票 PDF：${file.name}。刷新后需重新上传原 PDF 才能合并导出。`); renderTable(); }
function openInvoicePreview(id) { const item = items.find((entry) => entry.id === id); if (!item?.invoiceFileUrl) return setStatus(item?.invoiceFileName ? "草稿只保留了发票名称，请重新上传该 PDF 后再预览。" : "请先上传发票 PDF 后再预览。"); pdfViewerTitle.textContent = item.invoiceFileName || "发票 PDF 预览"; pdfFrame.src = item.invoiceFileUrl; pdfViewer.classList.add("open"); document.body.classList.add("viewer-open"); setStatus("已在当前页面打开 PDF 预览，不会触发浏览器弹窗拦截。"); }
function removeInvoiceFile(id) { const item = items.find((entry) => entry.id === id); if (!item) return; revokeInvoiceUrl(item); item.invoiceFile = null; item.invoiceFileName = ""; item.invoiceFileUrl = ""; item.invoiceAmount = ""; if (item.screenshotAmount) item.amount = item.screenshotAmount; markDirtyAndSave(); setStatus(item.screenshotAmount ? `已删除该行发票 PDF，金额已恢复为截图识别金额 ${item.screenshotAmount}。` : "已删除该行发票 PDF。"); renderAll(); }
function updateItem(id, field, value) { const item = items.find((entry) => entry.id === id); if (!item) return; item[field] = value; markDirtyAndSave(); if (field === "date") renderAll(); else { renderSummary(); renderReportPreview(); } }
function getTotals() { return categories.map((category) => { const matched = items.filter((item) => item.category === category); return { category, amount: sumAmount(matched), count: matched.length }; }); }
function renderSummary() { const totals = getTotals(); $("#totalAmount").textContent = sumAmount(items).toFixed(2); $("#summaryCards").innerHTML = totals.map((item) => `<div class="summary-card"><span>${item.category}</span><small>${item.count} 条</small><strong>${item.amount.toFixed(2)}</strong></div>`).join(""); }
function renderReportPreview() { $("#reportPreview").innerHTML = `<div class="report-block"><h3>报销汇总</h3><table><tbody><tr><th>关联项目编号</th><td>${escapeHtml($("#projectInput").value)}</td><th>报销人</th><td>${escapeHtml($("#personInput").value)}</td></tr><tr><th>合计</th><td>${sumAmount(items).toFixed(2)}</td><th>明细条数</th><td>${items.length}</td></tr></tbody></table></div>` + categories.map(reportBlock).join(""); }
function reportBlock(category) { const matched = sortedItems().filter((item) => item.category === category); const rows = matched.map((item) => `<tr><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.type)}</td><td>${Number(item.amount || 0).toFixed(2)}</td><td>${escapeHtml(item.description)}</td><td>${hasInvoice(item)}</td><td>${escapeHtml(invoiceSummary(item))}</td></tr>`).join(""); return `<div class="report-block"><h3>${category}合计：${sumAmount(matched).toFixed(2)}</h3>${matched.length ? `<table><thead><tr><th>时间</th><th>费用类型</th><th>金额</th><th>费用说明</th><th>是否有发票</th><th>发票</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">暂无${category}明细</div>`}</div>`; }
function sumAmount(list) { return list.reduce((sum, item) => sum + Number(item.amount || 0), 0); }
function invoiceSummary(item) { return [item.invoiceFileName, item.invoiceAmount ? `金额 ${item.invoiceAmount}` : ""].filter(Boolean).join(" / "); }
function hasInvoice(item) { return item.invoiceFileName ? "有票" : "无票"; }
function sortedItems(list = items) { return [...list].sort((a, b) => dateSortValue(a.date) - dateSortValue(b.date) || String(a.fileName || "").localeCompare(String(b.fileName || ""), "zh-Hans-CN")); }
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
function closePdfViewer() { pdfViewer.classList.remove("open"); pdfFrame.removeAttribute("src"); document.body.classList.remove("viewer-open"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function setStatus(message) { statusBar.textContent = message; }
renderAll();
