const categories = ["交通费", "差旅费", "餐费", "物料费", "其他费用"];
const categoryRules = [
  { category: "交通费", type: "高速费", words: ["高速", "通行费", "etc", "收费站", "停车区"] },
  { category: "交通费", type: "停车费", words: ["停车"] },
  { category: "交通费", type: "打车费", words: ["滴滴", "出租", "网约车", "出行"] },
  { category: "餐费", type: "餐费", words: ["餐", "饭", "咖啡", "美食", "luckin", "午餐"] },
  { category: "物料费", type: "物料采购", words: ["采购", "道具", "设备", "耗材", "快递"] },
];

let items = [];
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

fileInput.addEventListener("change", (event) => handleFiles(event.target.files));
invoiceBatchInput.addEventListener("change", (event) => handleInvoiceFiles(event.target.files));
for (const zone of [dropZone, invoiceDropZone]) {
  ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove("dragover"); }));
}
dropZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));
invoiceDropZone.addEventListener("drop", (event) => handleInvoiceFiles(event.dataTransfer.files));
$("#projectInput").addEventListener("input", renderAll);
$("#personInput").addEventListener("input", renderAll);
$("#addItemBtn").addEventListener("click", addManualItem);
$("#clearBtn").addEventListener("click", () => { items.forEach(revokeInvoiceUrl); items = []; fileInput.value = ""; invoiceBatchInput.value = ""; setStatus("已清空，等待上传截图。"); renderAll(); });
$("#exportCsvBtn").addEventListener("click", exportCsv);
$("#exportXlsxBtn").addEventListener("click", exportXlsx);
$("#exportScreenshotsBtn").addEventListener("click", exportScreenshotsDoc);
$("#exportInvoicesBtn").addEventListener("click", exportInvoicesPdf);
$("#viewerClose").addEventListener("click", closeImageViewer);
$("#textClose").addEventListener("click", closeTextViewer);
imageViewer.addEventListener("click", (event) => { if (event.target === imageViewer) closeImageViewer(); });
textViewer.addEventListener("click", (event) => { if (event.target === textViewer) closeTextViewer(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeImageViewer(); closeTextViewer(); } });

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    setStatus(`正在识别 ${index + 1}/${files.length}：${file.name}`);
    const imageUrl = URL.createObjectURL(file);
    let text = "";
    try {
      const images = await prepareImageForOcr(file);
      const result = await Tesseract.recognize(images.full, "chi_sim+eng", { logger: (m) => { if (m.status === "recognizing text") setStatus(`正在识别 ${file.name}：${Math.round(m.progress * 100)}%`); } });
      text = result.data.text || "";
      const fullVisualAmount = extractLargestVisualAmount(result.data);
      const amountResult = await Tesseract.recognize(images.amountRegion, "eng", { tessedit_char_whitelist: "0123456789.,-+¥￥YyOo " });
      const middleResult = await Tesseract.recognize(images.middleRegion, "eng", { tessedit_char_whitelist: "0123456789.,-+¥￥YyOo " });
      const topAmountResult = await Tesseract.recognize(images.topAmountRegion, "eng", { tessedit_char_whitelist: "0123456789.,-+¥￥YyOo " });
      const mainAmountResult = await Tesseract.recognize(images.mainAmountRegion, "eng", { tessedit_char_whitelist: "0123456789.,-+¥￥YyOo " });
      const lowerMainAmountResult = await Tesseract.recognize(images.lowerMainAmountRegion, "eng", { tessedit_char_whitelist: "0123456789.,-+¥￥YyOo " });
      const upperResult = await Tesseract.recognize(images.upperRegion, "chi_sim+eng");
      const dateResult = await Tesseract.recognize(images.dateRegion, "chi_sim+eng", { tessedit_char_whitelist: "0123456789年月日-/.:： 支付交易创建完成时间" });
      const visualAmounts = [
        extractLargestVisualAmount(mainAmountResult.data),
        extractLargestVisualAmount(lowerMainAmountResult.data),
        extractLargestVisualAmount(topAmountResult.data),
        extractLargestVisualAmount(middleResult.data),
        extractLargestVisualAmount(amountResult.data),
        extractLargestVisualAmount(upperResult.data),
        fullVisualAmount,
      ];
      text = `${text}\n__VISUAL_AMOUNT__ ${bestVisualAmount(visualAmounts)}\n__DATE_REGION__\n${dateResult.data.text || ""}\n__MAIN_AMOUNT_REGION__\n${mainAmountResult.data.text || ""}\n__LOWER_MAIN_AMOUNT_REGION__\n${lowerMainAmountResult.data.text || ""}\n__AMOUNT_REGION__\n${amountResult.data.text || ""}\n__MIDDLE_AMOUNT_REGION__\n${middleResult.data.text || ""}\n__TOP_AMOUNT_REGION__\n${topAmountResult.data.text || ""}\n__UPPER_REGION__\n${upperResult.data.text || ""}`;
    } catch (error) {
      console.error(error);
      setStatus(`OCR 识别失败：${file.name}。已创建空白行，可手动填写。`);
    }
    const parsed = parsePaymentText(text, file.name);
    items.push({ id: crypto.randomUUID(), fileName: file.name, imageUrl, rawText: `${text}\n__AMOUNT_EXPLAIN__ ${explainPaymentAmount(text)}`, screenshotAmount: parsed.amount, invoiceFile: null, invoiceFileName: "", invoiceFileUrl: "", invoiceLink: "", invoiceAmount: "", ...parsed });
    renderAll();
  }
  const missing = items.filter((item) => !item.amount).length;
  setStatus(missing ? `已处理 ${files.length} 张截图，其中 ${missing} 条未识别到金额。` : `已处理 ${files.length} 张截图。`);
}

async function handleInvoiceFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  if (!files.length) return;
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
  renderAll();
}


function parsePaymentText(text, fileName) {
  const compact = normalizeText(`${text}\n${fileName}`);
  const cat = guessCategory(compact);
  return { date: guessDate(compact), category: cat.category, type: cat.type, amount: guessAnyPaymentAmount(text, fileName), description: guessProductName(getUsefulTextLines(text)) || fileName.replace(/\.[^.]+$/, ""), invoice: "待补" };
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
  const visual = findVisualAmount(lines);
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

function findVisualAmount(lines) {
  for (const line of lines) {
    const match = line.match(/__visual_amount__\s*(\d{1,6}(?:[.,]\d{1,2})?)/);
    const amount = normalizeAmount(match && match[1]);
    if (amount) return amount;
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
    .replace(/(\d)\s*([.,])\s*(\d{1,2})(?=\D|$)/g, "$1.$3");
  const refunds = [];
  const patterns = [/(?:已退款|退款|退回)[^\d¥￥]{0,16}[¥￥]?\s*(\d{1,6}(?:[.,]\d{1,2})?)/g, /[¥￥]\s*(\d{1,6}(?:[.,]\d{1,2})?)[^\n]{0,16}(?:已退款|退款|退回)/g, /当前状态[^\n]{0,20}已退款[^\d¥￥]{0,16}[¥￥]?\s*(\d{1,6}(?:[.,]\d{1,2})?)/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalized))) {
      const amount = normalizeAmount(match[1]);
      if (amount) refunds.push(amount);
    }
  }
  return refunds.reduce((sum, amount) => sum + amount, 0);
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
function getUsefulTextLines(rawText) { return String(rawText || "").split(/\n+/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean); }
function guessProductName(lines) {
  const stopWords = "商户全称|商户名称|商户|收款机构|收单机构|清算机构|支付方式|交易单号|商户单号|订单号|当前状态|支付时间|退款记录|账单服务|商家小程序|发起群收款|在此商户的交易";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const inlineMatch = line.match(new RegExp(`(?:商品说明|商品名称|商品|交易说明)\\s*[:：]?\\s*(.+?)(?=\\s*(?:${stopWords}|$))`));
    const inlineProduct = cleanProductName(inlineMatch && inlineMatch[1]);
    if (inlineProduct) return inlineProduct;

    if (/^(商品说明|商品名称|商品|交易说明)$/.test(line) && lines[index + 1]) {
      const nextProduct = cleanProductName(lines[index + 1].replace(new RegExp(`\\s*(?:${stopWords}).*$`), ""));
      if (nextProduct) return nextProduct;
    }
  }
  return "";
}
function cleanProductName(value) {
  const text = String(value || "")
    .replace(/\b\d{8,}\b/g, "")
    .replace(/[-_ ]?(?:美团|支付宝|微信|花呗|app|App)[-_ ]?\d+.*/g, "")
    .replace(/^[：:>＞\s]+|[：:>＞\s]+$/g, "")
    .trim();
  if (!/[\u4e00-\u9fa5a-zA-Z]{2,}/.test(text)) return "";
  if (/商户全称|收款机构|收单机构|支付方式|交易单号|商户单号|订单号|当前状态|支付时间/.test(text)) return "";
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
  const patterns = [/小写[\s\S]{0,20}[¥￥]?\s*(\d{1,5}\.\d{2})/, /[¥￥]\s*(\d{1,5}\.\d{2})/, /(\d{1,5}\.\d{2})/];
  for (const pattern of patterns) {
    const amount = normalizeAmount((normalized.match(pattern) || [])[1]);
    if (amount && amount <= 10000) return amount;
  }
  return 0;
}
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
      windows.push(text.slice(index, index + 100));
      index = text.indexOf(keyword, index + keyword.length);
    }
  }

  const patterns = [
    /小写[\s\S]{0,40}[¥￥]\s*(\d{1,5}\.\d{2})/,
    /[¥￥]\s*(\d{1,5}\.\d{2})/,
    /(\d{1,5}\.\d{2})\s*(?:元|圆)?/,
  ];

  for (const windowText of windows) {
    for (const pattern of patterns) {
      const match = windowText.match(pattern);
      const amount = normalizeAmount(match && match[1]);
      if (amount && amount <= 10000) return amount;
    }
  }
  return 0;
}

function findInvoiceFileNameAmount(text) {
  const patterns = [/发票金额\s*(\d{1,5}\.\d{2})\s*(?:元|圆)?/, /_(\d{1,5}\.\d{2})\s*(?:元|圆)?_/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const amount = normalizeAmount(match && match[1]);
    if (amount && amount <= 10000) return amount;
  }
  return 0;
}
function matchInvoiceToItem(file, amounts) { const target = findInvoiceTarget(amounts); if (!target) return false; revokeInvoiceUrl(target); target.invoiceFile = file; target.invoiceFileName = file.name; target.invoiceFileUrl = URL.createObjectURL(file); target.invoiceAmount = amounts.find((amount) => sameAmount(target.amount, amount)) || amounts[0] || ""; return true; }
function findInvoiceTarget(amounts) { const amountList = Array.isArray(amounts) ? amounts : [amounts]; return items.find((item) => !item.invoiceFileName && amountList.some((amount) => sameAmount(item.amount, amount))); }
function sameAmount(left, right) { return Math.abs(Number(left || 0) - Number(right || 0)) < .01; }
function revokeInvoiceUrl(item) { if (item.invoiceFileUrl) URL.revokeObjectURL(item.invoiceFileUrl); }

function renderAll() { renderTable(); renderSummary(); renderReportPreview(); }
function renderTable() { tableBody.innerHTML = ""; if (!items.length) { tableBody.innerHTML = `<tr><td colspan="9" class="empty">还没有明细。上传付款截图后会自动生成待确认行。</td></tr>`; return; } for (const item of sortedItems()) { const row = document.createElement("tr"); row.innerHTML = `<td><input type="date" value="${escapeHtml(item.date)}" data-id="${item.id}" data-field="date"></td><td>${categorySelect(item)}</td><td><input value="${escapeHtml(item.type)}" data-id="${item.id}" data-field="type"></td><td><input class="${item.amount ? "" : "needs-check"}" type="number" step="0.01" value="${escapeHtml(item.amount)}" placeholder="待填写" data-id="${item.id}" data-field="amount"></td><td><textarea data-id="${item.id}" data-field="description">${escapeHtml(item.description)}</textarea></td><td>${hasInvoice(item)}</td><td>${invoiceCell(item)}</td><td>${screenshotCell(item)}</td><td><button class="delete" data-delete="${item.id}">删除</button></td>`; tableBody.appendChild(row); } bindTableEvents(); }
function bindTableEvents() { tableBody.querySelectorAll("input,select,textarea").forEach((control) => control.addEventListener("input", (event) => { updateItem(event.target.dataset.id, event.target.dataset.field, event.target.value); if (event.target.dataset.field === "amount") event.target.classList.toggle("needs-check", !event.target.value); })); tableBody.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => { const item = items.find((entry) => entry.id === button.dataset.delete); if (item) revokeInvoiceUrl(item); items = items.filter((entry) => entry.id !== button.dataset.delete); renderAll(); })); tableBody.querySelectorAll("[data-preview]").forEach((button) => button.addEventListener("click", () => openImageViewer(button.dataset.preview))); tableBody.querySelectorAll("[data-invoice-file]").forEach((input) => input.addEventListener("change", (event) => updateInvoiceFile(input.dataset.invoiceFile, event.target.files[0]))); tableBody.querySelectorAll("[data-remove-invoice]").forEach((button) => button.addEventListener("click", () => removeInvoiceFile(button.dataset.removeInvoice))); }
function categorySelect(item) { return `<select data-id="${item.id}" data-field="category">${categories.map((c) => `<option ${item.category === c ? "selected" : ""}>${c}</option>`).join("")}</select>`; }
function screenshotCell(item) { return item.imageUrl ? `<button class="thumb-button" type="button" data-preview="${item.id}"><img class="thumb" src="${item.imageUrl}" alt="${escapeHtml(item.fileName)}"></button>` : `<span class="thumb-empty">手动</span>`; }
function invoiceCell(item) { return `<div class="invoice-cell"><label class="invoice-upload">上传 PDF<input type="file" accept="application/pdf,.pdf" data-invoice-file="${item.id}"></label>${item.invoiceFileUrl ? `<span class="invoice-file-row"><a class="invoice-file" href="${item.invoiceFileUrl}" target="_blank" rel="noopener">${escapeHtml(item.invoiceFileName)}</a><button class="invoice-remove" type="button" data-remove-invoice="${item.id}">删除</button></span>` : `<span class="invoice-empty">未上传 PDF</span>`}${item.invoiceAmount ? `<span class="invoice-amount">发票金额：${escapeHtml(item.invoiceAmount)}</span>` : ""}<input type="url" placeholder="发票链接" value="${escapeHtml(item.invoiceLink || "")}" data-id="${item.id}" data-field="invoiceLink"></div>`; }
async function updateInvoiceFile(id, file) { if (!file) return; const item = items.find((entry) => entry.id === id); if (!item) return; revokeInvoiceUrl(item); item.invoiceFile = file; item.invoiceFileName = file.name; item.invoiceFileUrl = URL.createObjectURL(file); item.invoiceAmount = window.pdfjsLib ? ((await getInvoiceAmounts(file))[0] || "") : ""; setStatus(item.invoiceAmount ? `已上传发票 PDF：${file.name}，识别金额 ${item.invoiceAmount}` : `已上传发票 PDF：${file.name}`); renderTable(); }
function removeInvoiceFile(id) { const item = items.find((entry) => entry.id === id); if (!item) return; revokeInvoiceUrl(item); item.invoiceFile = null; item.invoiceFileName = ""; item.invoiceFileUrl = ""; item.invoiceAmount = ""; if (item.screenshotAmount) item.amount = item.screenshotAmount; setStatus(item.screenshotAmount ? `已删除该行发票 PDF，金额已恢复为截图识别金额 ${item.screenshotAmount}。` : "已删除该行发票 PDF。"); renderAll(); }
function updateItem(id, field, value) { const item = items.find((entry) => entry.id === id); if (!item) return; item[field] = value; if (field === "date") renderAll(); else { renderSummary(); renderReportPreview(); } }
function getTotals() { return categories.map((category) => { const matched = items.filter((item) => item.category === category); return { category, amount: sumAmount(matched), count: matched.length }; }); }
function renderSummary() { const totals = getTotals(); $("#totalAmount").textContent = sumAmount(items).toFixed(2); $("#summaryCards").innerHTML = totals.map((item) => `<div class="summary-card"><span>${item.category}<br><small>${item.count} 条</small></span><strong>${item.amount.toFixed(2)}</strong></div>`).join(""); }
function renderReportPreview() { $("#reportPreview").innerHTML = `<div class="report-block"><h3>报销汇总</h3><table><tbody><tr><th>关联项目编号</th><td>${escapeHtml($("#projectInput").value)}</td><th>报销人</th><td>${escapeHtml($("#personInput").value)}</td></tr><tr><th>合计</th><td>${sumAmount(items).toFixed(2)}</td><th>明细条数</th><td>${items.length}</td></tr></tbody></table></div>` + categories.map(reportBlock).join(""); }
function reportBlock(category) { const matched = sortedItems().filter((item) => item.category === category); const rows = matched.map((item) => `<tr><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.type)}</td><td>${Number(item.amount || 0).toFixed(2)}</td><td>${escapeHtml(item.description)}</td><td>${hasInvoice(item)}</td><td>${escapeHtml(invoiceSummary(item))}</td></tr>`).join(""); return `<div class="report-block"><h3>${category}合计：${sumAmount(matched).toFixed(2)}</h3>${matched.length ? `<table><thead><tr><th>时间</th><th>费用类型</th><th>金额</th><th>费用说明</th><th>是否有发票</th><th>发票</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">暂无${category}明细</div>`}</div>`; }
function sumAmount(list) { return list.reduce((sum, item) => sum + Number(item.amount || 0), 0); }
function invoiceSummary(item) { return [item.invoiceFileName, item.invoiceAmount ? `金额 ${item.invoiceAmount}` : "", item.invoiceLink].filter(Boolean).join(" / "); }
function hasInvoice(item) { return item.invoiceFileName || item.invoiceLink ? "是" : "否"; }
function sortedItems(list = items) { return [...list].sort((a, b) => dateSortValue(a.date) - dateSortValue(b.date) || String(a.fileName || "").localeCompare(String(b.fileName || ""), "zh-Hans-CN")); }
function dateSortValue(value) { const date = Date.parse(String(value || "").replace(/\//g, "-")); return Number.isFinite(date) ? date : Number.MAX_SAFE_INTEGER; }
function exportRows() { const project = $("#projectInput").value.trim(); const person = $("#personInput").value.trim(); return sortedItems().map((item, index) => ({ 序号: index + 1, 关联项目编号: project, 报销人: person, 日期: item.date, 一级费用类别: item.category, 费用类型: item.type, 金额: Number(item.amount || 0), 费用说明: item.description, 是否有发票: hasInvoice(item), 发票PDF文件名: item.invoiceFileName || "", 发票识别金额: item.invoiceAmount || "", 发票链接: item.invoiceLink || "", 付款截图文件名: item.fileName, 备注: "由付款截图识别整理" })); }
function exportCsv() { if (!items.length) return setStatus("没有可导出的明细。"); const rows = exportRows(); const headers = Object.keys(rows[0]); const csv = [headers.join(",")].concat(rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))).join("\n"); downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), "报销明细.csv"); }
function exportXlsx() { if (!items.length) return setStatus("没有可导出的明细。"); const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(buildTemplateRows()); ws["!merges"] = [{ s: { r: 1, c: 2 }, e: { r: 1, c: 3 } }]; ws["!cols"] = [{ wch: 9.16 }, { wch: 16.66 }, { wch: 11.83 }, { wch: 11 }, { wch: 88.83 }]; ws["!rows"] = Array.from({ length: 84 }, (_, index) => ({ hpt: index === 0 ? 35.25 : 18 })); applyTemplateSheetStyle(ws); XLSX.utils.book_append_sheet(wb, ws, "Sheet1"); XLSX.writeFile(wb, "自动整理报销表.xlsx"); }

function buildTemplateRows() {
  const rows = Array.from({ length: 84 }, () => Array(5).fill(null));
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
    rows[block.totalRow][1] = `${block.category}合计`;
    rows[block.totalRow][2] = { f: `D${block.sumRow + 1}` };
    rows[block.totalRow][3] = { f: `SUM(E${block.startRow + 1}:E${block.endRow + 1})` };
    rows[block.titleRow][1] = block.title;
    rows[block.headerRow][1] = "时间";
    rows[block.headerRow][2] = "费用类型";
    rows[block.headerRow][3] = "金额";
    rows[block.headerRow][4] = block.note;

    const matched = sortedItems(items.filter((item) => item.category === block.category)).slice(0, block.endRow - block.startRow + 1);
    matched.forEach((item, index) => {
      const row = rows[block.startRow + index];
      row[1] = item.date;
      row[2] = item.type;
      row[3] = Number(item.amount || 0);
      row[4] = item.description;
    });
  }

  rows[3][3] = invoiceTotalByCategory("交通费");
  rows[4][3] = invoiceTotalByCategory("差旅费");
  rows[5][3] = invoiceTotalByCategory("餐费");
  rows[6][3] = invoiceTotalByCategory("物料费");
  rows[7][3] = invoiceTotalByCategory("其他费用");
  rows[8][1] = "合计";
  rows[8][2] = { f: "SUM(C4:C8)" };
  rows[8][3] = { f: "SUM(D4:D8)" };
  return rows;
}

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
  const rows = sortedItems().filter((item) => item.imageUrl);
  if (!rows.length) return setStatus("没有可导出的截图。");
  const blocks = await Promise.all(rows.map(async (item, index) => {
    const dataUrl = await imageUrlToDataUrl(item.imageUrl);
    return `<h2>${index + 1}. ${escapeHtml(item.date)} ${escapeHtml(item.type)} ${Number(item.amount || 0).toFixed(2)}</h2><p>${escapeHtml(item.description || item.fileName)}</p><img src="${dataUrl}">`;
  }));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Microsoft YaHei,Arial,sans-serif}h1{font-size:22px}h2{font-size:16px;margin:24px 0 6px}p{margin:0 0 8px;color:#555}img{display:block;max-width:640px;width:100%;height:auto;margin:0 0 18px;page-break-inside:avoid;border:1px solid #ddd}</style></head><body><h1>报销截图汇总</h1>${blocks.join("")}</body></html>`;
  downloadBlob(new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" }), "报销截图汇总.doc");
}

async function exportInvoicesPdf() {
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
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), "报销发票汇总.pdf");
}

async function imageUrlToDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
}

function invoiceTotalByCategory(category) {
  return items.filter((item) => item.category === category && hasInvoice(item) === "是").reduce((sum, item) => sum + Number(item.invoiceAmount || item.amount || 0), 0);
}
function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function downloadBlob(blob, fileName) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); }
function openImageViewer(id) { const item = items.find((entry) => entry.id === id); if (!item) return; viewerImage.src = item.imageUrl; viewerCaption.textContent = item.fileName; imageViewer.classList.add("open"); document.body.classList.add("viewer-open"); }
function closeImageViewer() { imageViewer.classList.remove("open"); viewerImage.removeAttribute("src"); document.body.classList.remove("viewer-open"); }
function openTextViewer(id) { const item = items.find((entry) => entry.id === id); if (!item) return; rawText.textContent = item.rawText || "无 OCR 原文"; textViewer.classList.add("open"); document.body.classList.add("viewer-open"); }
function closeTextViewer() { textViewer.classList.remove("open"); document.body.classList.remove("viewer-open"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function setStatus(message) { statusBar.textContent = message; }
renderAll();
