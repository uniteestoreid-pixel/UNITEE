"use strict";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORAGE_KEY = "spk_generator_data_v3";
const LOGO_STORAGE_KEY = "spk_generator_logos_v1";
const LOGO_COUNT = 4;
let selectedLogoId = null;
let currentLogoSnapshot = null;
const categories = [
  { id: "dewasa-pendek", label: "Dewasa Pendek" },
  { id: "dewasa-panjang", label: "Dewasa Panjang" },
  { id: "dewasa-3-4", label: "Dewasa 3/4" },
  { id: "anak-pendek", label: "Anak Pendek" },
  { id: "anak-panjang", label: "Anak Panjang" },
  { id: "anak-3-4", label: "Anak 3/4" }
];
const sizes = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
let currentRecordId = null;
let currentCreatedAt = null;
let currentRecordVersion = 0;
let currentDesignStoragePath = null;
let currentDesignFileSize = 0;
let currentDesignMimeType = "image/jpeg";
let spkNumberReady = true;
let persistPromise = null;
let toastTimer = null;
let autoSaveTimer = null;
let storageReadFailed = false;
let currentSpkNo = generateSpkNo();

function toast(message, type = "") {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 3000);
}

function generateSpkNo() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const existingNumbers = new Set(getSaved().map(record => record.spkNo).filter(Boolean));
  let number;
  do {
    number = `SPK-${date}-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (existingNumbers.has(number));
  return number;
}

function paintSpkNo() {
  $("#spkNoBadge").textContent = currentSpkNo;
  $("#pSpkNo").textContent = currentSpkNo;
}

function getSaved() {
  storageReadFailed = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = JSON.parse(raw || "[]");
    if (!Array.isArray(data)) throw new Error("Format arsip tidak valid");
    return data;
  } catch (error) {
    storageReadFailed = true;
    toast("Arsip SPK tidak dapat dibaca. Data lama tidak diubah.", "error");
    return [];
  }
}

function setSaved(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    toast("Penyimpanan gagal. Formulir tetap utuh; periksa ruang penyimpanan browser.", "error");
    return false;
  }
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatLongDate(timestamp) {
  if (!timestamp) return "Belum disimpan";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "long", year: "numeric"
  }).format(new Date(timestamp));
}

function updatePrintDate() {
  const record = currentRecordId === null
    ? null
    : getSaved().find(item => String(item.id) === String(currentRecordId));
  const timestamp = getCreatedTimestamp(record || {}) || Number(currentCreatedAt);
  $("#printDate").textContent = `Tanggal dibuat: ${formatLongDate(timestamp)}`;
}

function bindText(inputSelector, outputSelector) {
  const input = $(inputSelector);
  const output = $(outputSelector);
  const update = () => { output.textContent = input.value; };
  input.addEventListener("input", update);
  input.addEventListener("change", update);
  update();
}

function syncDates() {
  $("#pOrderDate").textContent = formatDate($("#orderDate").value);
  $("#pDeadline").textContent = formatDate($("#deadline").value);
}

function renderSizeInputs() {
  $("#sizeGroups").innerHTML = categories.map(category => `
    <section class="size-group">
      <h3>${category.label}</h3>
      <div class="size-grid">${sizes.map(size => `
        <label>${size}<input class="size" data-category="${category.id}" data-size="${size}"
          type="number" inputmode="numeric" min="0" step="1" value="0"
          aria-label="${category.label} ${size}"></label>
      `).join("")}</div>
    </section>
  `).join("");
}

function readSize(category, size) {
  const input = $(`.size[data-category="${category}"][data-size="${size}"]`);
  const value = Number(input.value);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function updateSizes() {
  let total = 0;
  const groups = [];
  categories.forEach(category => {
    const items = sizes.map(size => ({ size, qty: readSize(category.id, size) })).filter(item => item.qty > 0);
    items.forEach(item => { total += item.qty; });
    if (items.length) {
      groups.push(`<div class="size-list-group"><div class="size-list-heading">${category.label}</div><div class="size-list-items">${items.map(item => `<span class="size-list-item">${item.size} : ${item.qty} pcs</span>`).join("")}</div></div>`);
    }
  });
  $("#previewSizeBreakdown").innerHTML = groups.length
    ? groups.join("")
    : '<div class="size-list-empty">Belum ada rincian ukuran.</div>';
  $("#sizeTotal").textContent = total;
  $("#quantity").value = total;
  $("#pQuantity").textContent = total;
}

function validateForm() {
  if (!$("#customer").value.trim()) return "Customer belum diisi.";
  if (!$("#order").value.trim()) return "Order belum diisi.";
  if ($$(".size").some(input => !Number.isSafeInteger(Number(input.value)) || Number(input.value) < 0)) {
    return "Jumlah size harus bilangan bulat positif atau nol.";
  }
  if (Number($("#sizeTotal").textContent) <= 0) return "Rincian size masih kosong.";
  return "";
}

function getCreatedTimestamp(record) {
  const createdAt = Number(record.createdAt);
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;
  if (typeof record.id === "number" && Number.isFinite(record.id)) return record.id;
  const parsed = Date.parse(record.savedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCreatedAt(timestamp) {
  if (!timestamp) return "Tanggal dibuat tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(timestamp));
}

function createRecordId(records) {
  let id;
  do {
    id = globalThis.crypto?.randomUUID
      ? `spk-${globalThis.crypto.randomUUID()}`
      : `spk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } while (records.some(record => String(record.id) === id));
  return id;
}

function collectForm() {
  const createdAt = Number(currentCreatedAt) || Date.now();
  return {
    id: currentRecordId,
    spkNo: currentSpkNo,
    createdAt,
    customer: $("#customer").value,
    order: $("#order").value,
    orderDate: $("#orderDate").value,
    deadline: $("#deadline").value,
    modelKerah: $("#modelKerah").value,
    material: $("#material").value,
    colour: $("#colour").value,
    quantity: $("#quantity").value,
    sizes: $$(".size").map(input => ({ category: input.dataset.category, size: input.dataset.size, value: input.value })),
    notes: $("#notes").value,
    apDesigner: $("#apDesigner").value,
    apCs: $("#apCs").value,
    apCustomer: $("#apCustomer").value,
    apProduction: $("#apProduction").value,
    designImage: $("#designPreview").getAttribute("src") || "",
    selectedLogoId,
    selectedLogoSnapshot: currentLogoSnapshot,
    designStoragePath: currentDesignStoragePath,
    designFileSize: currentDesignFileSize,
    designMimeType: currentDesignMimeType,
    version: currentRecordVersion,
    savedAt: new Date().toLocaleString("id-ID")
  };
}

async function persistCurrent(showMessage = false) {
  if (persistPromise) {
    await persistPromise;
    return persistCurrent(showMessage);
  }
  persistPromise = persistCurrentInternal(showMessage);
  try { return await persistPromise; }
  finally { persistPromise = null; }
}

async function persistCurrentInternal(showMessage = false) {
  const error = validateForm();
  if (error) { if (showMessage) toast(error, "error"); return false; }
  if (window.SpkCloud?.isActive() && currentRecordId === null && !spkNumberReady) {
    if (showMessage) toast("Nomor SPK cloud sedang disiapkan. Tunggu sebentar lalu simpan kembali.", "error");
    return false;
  }

  const saved = getSaved();
  if (storageReadFailed) return false;
  const data = collectForm();
  const index = currentRecordId === null ? -1 : saved.findIndex(item => String(item.id) === String(currentRecordId));
  if (currentRecordId !== null && index < 0) {
    if (showMessage) toast("SPK ini tidak lagi ditemukan di arsip. Gunakan SPK Baru untuk menyimpan sebagai dokumen baru.", "error");
    return false;
  }
  const isUpdate = index >= 0;

  if (window.SpkCloud?.isActive()) {
    try {
      data.id = isUpdate ? saved[index].id : createRecordId(saved);
      data.version = isUpdate ? Number(saved[index].version || currentRecordVersion || 0) : 0;
      if (isUpdate) data.spkNo = saved[index].spkNo || currentSpkNo;
      const serverRecord = await window.SpkCloud.saveRecord(data);
      if (serverRecord.designImage) designSlot.setImage(serverRecord.designImage, false, serverRecord.designStoragePath || null, serverRecord.designFileSize, serverRecord.designMimeType);
      const next = getSaved();
      if (storageReadFailed) throw new Error("Cache arsip lokal tidak dapat dibaca setelah server menyimpan SPK.");
      const existingIndex = next.findIndex(item => String(item.id) === String(serverRecord.id));
      if (existingIndex >= 0) next[existingIndex] = serverRecord;
      else next.unshift(serverRecord);
      if (!setSaved(next)) {
        await window.SpkCloud.refresh();
        throw new Error("SPK tersimpan di server, tetapi cache browser gagal diperbarui. Arsip server dimuat ulang; periksa ruang penyimpanan browser.");
      }
      currentRecordId = serverRecord.id;
      currentCreatedAt = serverRecord.createdAt;
      currentRecordVersion = Number(serverRecord.version) || 1;
      currentDesignStoragePath = serverRecord.designStoragePath || null;
      currentSpkNo = serverRecord.spkNo;
      if (serverRecord.selectedLogoSnapshot) currentLogoSnapshot = serverRecord.selectedLogoSnapshot;
      paintSpkNo(); renderSaved(); updatePrintDate(); updateDocumentLogo();
      if (showMessage) toast(isUpdate ? "SPK berhasil diperbarui di server." : "SPK berhasil disimpan di server.");
      return true;
    } catch (cloudError) {
      console.error("Cloud save failed", cloudError);
      if (/SPK_CONFLICT|40001/i.test(String(cloudError?.message || cloudError))) {
        try { await window.SpkCloud.refresh(); } catch (refreshError) { console.warn("Could not refresh archive after conflict", refreshError); }
        toast("Konflik edit terdeteksi. Arsip diperbarui; buka ulang SPK terbaru sebelum melanjutkan.", "error");
      } else toast(window.SpkCloud.errorMessage(cloudError), "error");
      return false;
    }
  }

  if (isUpdate) {
    data.id = saved[index].id;
    data.createdAt = getCreatedTimestamp(saved[index]) || Number(currentCreatedAt) || Date.now();
    data.spkNo = saved[index].spkNo || currentSpkNo;
    data.version = (Number(saved[index].version) || 0) + 1;
    saved[index] = data;
  } else {
    data.id = createRecordId(saved);
    data.createdAt = Date.now();
    data.version = 1;
    saved.push(data);
  }
  if (!setSaved(saved)) return false;
  currentRecordId = data.id;
  currentCreatedAt = data.createdAt;
  currentRecordVersion = data.version;
  currentDesignStoragePath = data.designStoragePath || null;
  currentSpkNo = data.spkNo;
  paintSpkNo(); renderSaved(); updatePrintDate();
  if (showMessage) toast(isUpdate ? "SPK berhasil diperbarui." : "SPK baru berhasil disimpan.");
  return true;
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);

  // Draft baru hanya masuk arsip saat pengguna menyimpan atau mencetaknya.
  if (currentRecordId === null) return;

  autoSaveTimer = setTimeout(() => {
    if (validateForm()) return;
    persistCurrent(false).catch(error => { console.error(error); toast("Penyimpanan otomatis gagal.", "error"); });
  }, 500);
}

function applyForm(record) {
  clearTimeout(autoSaveTimer);
  currentRecordId = record.id ?? null;
  currentSpkNo = record.spkNo || generateSpkNo();
  currentCreatedAt = getCreatedTimestamp(record) || null;
  currentRecordVersion = Number(record.version) || 0;
  currentDesignStoragePath = record.designStoragePath || null;
  currentDesignFileSize = Number(record.designFileSize) || 0;
  currentDesignMimeType = record.designMimeType || "image/jpeg";
  selectedLogoId = record.selectedLogoId !== undefined
    ? record.selectedLogoId
    : getLogos()[0]?.id || null;
  currentLogoSnapshot = record.selectedLogoSnapshot || (selectedLogoId
    ? logoSnapshot(getLogos().find(item => item.id === selectedLogoId))
    : null);
  paintSpkNo();
  renderLogoChoices();
  updateDocumentLogo();
  $("#customer").value = record.customer || "";
  $("#order").value = record.order || "";
  $("#orderDate").value = record.orderDate || "";
  $("#deadline").value = record.deadline || "";
  const model = record.modelKerah || record.designer || "O Neck";
  $("#modelKerah").value = [...$("#modelKerah").options].some(option => option.value === model) ? model : "O Neck";
  $("#material").value = record.material || "";
  $("#colour").value = record.colour || "";
  $("#notes").value = record.notes || "";
  $("#apDesigner").value = record.apDesigner || "";
  $("#apCs").value = record.apCs || "";
  $("#apCustomer").value = record.apCustomer || "";
  $("#apProduction").value = record.apProduction || "";

  $$(".size").forEach(input => { input.value = "0"; });
  (record.sizes || []).forEach(item => {
    const category = item.category || "dewasa-pendek";
    const input = $$(".size").find(field => field.dataset.category === category && field.dataset.size === item.size);
    if (input) input.value = item.value;
  });

  const image = record.designImage || record.designFront || record.designBack || "";
  if (image) designSlot.setImage(image, false, record.designStoragePath || null, record.designFileSize, record.designMimeType);
  else {
    designSlot.clearImage(false);
    // Preserve a cloud file reference when a signed URL temporarily fails to load.
    currentDesignStoragePath = record.designStoragePath || null;
    currentDesignFileSize = Number(record.designFileSize) || 0;
    currentDesignMimeType = record.designMimeType || "image/jpeg";
  }
  ["#customer", "#order", "#modelKerah", "#material", "#colour"].forEach(inputSelector => {
    const outputSelector = {
      "#customer": "#pCustomer", "#order": "#pOrder", "#modelKerah": "#pModelKerah",
      "#material": "#pMaterial", "#colour": "#pColour"
    }[inputSelector];
    $(outputSelector).textContent = $(inputSelector).value;
  });
  syncDates();
  $("#pNotes").textContent = $("#notes").value;
  $("#pApDesigner").textContent = $("#apDesigner").value;
  $("#pApCs").textContent = $("#apCs").value;
  $("#pApCustomer").textContent = $("#apCustomer").value;
  $("#pApProduction").textContent = $("#apProduction").value;
  updateSizes();
  updatePrintDate();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function renderSaved() {
  const list = $("#savedList");
  const records = getSaved();
  $("#savedCount").textContent = `${records.length} SPK`;
  const query = $("#savedTitleSearch").value.trim().toLocaleLowerCase("id-ID");
  const selectedDate = $("#savedDateSearch").value;
  const filtered = records.filter(record => {
    if (query) {
      const searchable = `${record.customer || ""} ${record.order || ""} ${record.spkNo || ""}`.toLocaleLowerCase("id-ID");
      if (!searchable.includes(query)) return false;
    }
    if (selectedDate) {
      const timestamp = getCreatedTimestamp(record);
      if (!timestamp) return false;
      const date = new Date(timestamp);
      const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
      if (key !== selectedDate) return false;
    }
    return true;
  });

  if (!filtered.length) {
    list.innerHTML = records.length
      ? '<div class="empty-saved">Tidak ada SPK yang sesuai dengan pencarian.</div>'
      : '<div class="empty-saved">Belum ada SPK tersimpan.</div>';
    return;
  }
  list.innerHTML = filtered.slice().reverse().map(record => `
    <article class="saved-item">
      <div><div class="saved-name">${escapeHtml(record.customer || "Tanpa Customer")} – ${escapeHtml(record.order || "Tanpa Order")}</div>
      <div class="saved-meta">${escapeHtml(record.spkNo || "")}<br>Dibuat: ${escapeHtml(formatCreatedAt(getCreatedTimestamp(record)))}</div></div>
      <div class="saved-actions"><button data-load="${escapeHtml(record.id)}" type="button">Buka</button><button data-duplicate="${escapeHtml(record.id)}" type="button">Duplikat</button><button class="delete" data-delete="${escapeHtml(record.id)}" type="button">Hapus</button></div>
    </article>
  `).join("");

  list.querySelectorAll("[data-load]").forEach(button => {
    button.addEventListener("click", () => {
      const record = getSaved().find(item => String(item.id) === button.dataset.load);
      if (record) { applyForm(record); toast("SPK dimuat ke formulir."); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  });
  list.querySelectorAll("[data-duplicate]").forEach(button => {
    button.addEventListener("click", async () => {
      const record = getSaved().find(item => String(item.id) === button.dataset.duplicate);
      if (!record) return;
      const duplicate = { ...record, id: null, spkNo: generateSpkNo(), createdAt: Date.now(), savedAt: new Date().toLocaleString("id-ID") };
      applyForm(duplicate);
      currentRecordId = null;
      currentCreatedAt = null;
      currentRecordVersion = 0;
      currentSpkNo = generateSpkNo();
      spkNumberReady = true;
      if (window.SpkCloud?.isActive()) {
        spkNumberReady = false; currentSpkNo = "Menyiapkan nomor…"; paintSpkNo();
        try { currentSpkNo = await window.SpkCloud.nextSpkNumber(); spkNumberReady = true; }
        catch (error) { toast(window.SpkCloud.errorMessage(error), "error"); }
      }
      paintSpkNo();
      toast("Salinan disiapkan. Simpan SPK untuk membuat arsip baru.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  list.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Hapus SPK ini dari daftar tersimpan?")) return;
      const id = button.dataset.delete;
      const records = getSaved();
      if (storageReadFailed) return;
      if (window.SpkCloud?.isActive()) {
        try { await window.SpkCloud.deleteRecord(id); }
        catch (error) { toast(window.SpkCloud.errorMessage(error), "error"); return; }
      }
      if (!setSaved(records.filter(item => String(item.id) !== id))) return;
      const deletingCurrent = String(currentRecordId) === id;
      if (deletingCurrent && !window.SpkCloud?.isActive()) {
        currentRecordId = null; currentCreatedAt = null; currentRecordVersion = 0; currentDesignStoragePath = null;
        currentSpkNo = generateSpkNo(); paintSpkNo(); updatePrintDate();
      }
      renderSaved();
      if (deletingCurrent && window.SpkCloud?.isActive()) startNewSpk(false);
      toast(window.SpkCloud?.isActive() ? "SPK dihapus dari arsip cloud." : "SPK dihapus dari penyimpanan browser.");
    });
  });
}


function getLogos() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOGO_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((logo, index) => logo && typeof logo.id === "string" &&
      (logo.dataUrl || logo.active === true || String(logo.label || `Logo ${index + 1}`) !== `Logo ${index + 1}`))
      .slice(0, LOGO_COUNT)
      .map((logo, index) => ({
        id: logo.id,
        label: String(logo.label || `Logo ${index + 1}`).slice(0, 40),
        dataUrl: typeof logo.dataUrl === "string" && (/^data:image\//i.test(logo.dataUrl) || /^https?:\/\//i.test(logo.dataUrl)) ? logo.dataUrl : "",
        storagePath: typeof logo.storagePath === "string" ? logo.storagePath : null,
        version: Number(logo.version) || 1, slot: Number(logo.slot) || index + 1,
        active: logo.active === true
      }));
  } catch {
    toast("Daftar logo tidak dapat dibaca.", "error");
    return [];
  }
}

function saveLogos(logos) {
  try {
    localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify(logos.slice(0, LOGO_COUNT)));
    return true;
  } catch {
    toast("Logo gagal disimpan. File mungkin terlalu besar untuk penyimpanan browser.", "error");
    return false;
  }
}

function logoSnapshot(logo) {
  return logo ? { id: logo.id, label: logo.label, dataUrl: logo.dataUrl || "", storagePath: logo.storagePath || null, version: Number(logo.version) || 1, slot: Number(logo.slot) || null } : null;
}

function updateDocumentLogo() {
  const logo = currentLogoSnapshot || getLogos().find(item => item.id === selectedLogoId);
  const image = $("#pCompanyLogo");
  const fallback = $("#pLogoFallback");
  if (logo?.dataUrl) {
    image.src = logo.dataUrl;
    image.hidden = false;
    image.alt = logo.label || "Logo perusahaan";
  } else {
    image.removeAttribute("src");
    image.hidden = true;
    image.alt = "";
  }
  fallback.hidden = Boolean(logo?.dataUrl);
}

function renderLogoChoices() {
  const container = $("#logoChoices");
  if (!container) return;
  const logos = getLogos();
  $("#logoCount").textContent = `${logos.length} dari ${LOGO_COUNT} logo`;
  $("#addLogoBtn").disabled = logos.length >= LOGO_COUNT || Boolean(window.SpkCloud?.isActive() && !window.SpkCloud.isAdmin());
  $("#logoLimitHint").hidden = logos.length < LOGO_COUNT;
  container.innerHTML = logos.length ? logos.map(logo => `
    <article class="logo-choice ${logo.id === selectedLogoId ? "selected" : ""}">
      <button class="logo-select" type="button" data-select-logo="${escapeHtml(logo.id)}" aria-pressed="${logo.id === selectedLogoId}">
        <span class="logo-thumb">${logo.dataUrl ? `<img src="${escapeHtml(logo.dataUrl)}" alt="">` : `<span class="logo-empty">Belum ada gambar</span>`}</span>
        <span class="logo-label">${escapeHtml(logo.label)}</span>
        <span class="logo-state">${logo.id === selectedLogoId ? "✓ Dipilih" : "Pilih logo"}</span>
      </button>
      <div class="logo-card-actions">
        <label class="logo-action ${window.SpkCloud?.isActive() && !window.SpkCloud.isAdmin() ? "is-disabled" : ""}">Ganti gambar<input ${window.SpkCloud?.isActive() && !window.SpkCloud.isAdmin() ? "disabled" : ""} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-upload-logo="${escapeHtml(logo.id)}" aria-label="Ganti gambar ${escapeHtml(logo.label)}"></label>
        <button class="logo-action danger-action" type="button" data-delete-logo="${escapeHtml(logo.id)}" ${window.SpkCloud?.isActive() && !window.SpkCloud.isAdmin() ? "disabled" : ""}>Hapus</button>
      </div>
      <label class="logo-name">Nama<input type="text" maxlength="40" ${window.SpkCloud?.isActive() && !window.SpkCloud.isAdmin() ? "disabled" : ""} value="${escapeHtml(logo.label)}" data-label-logo="${escapeHtml(logo.id)}" aria-label="Nama ${escapeHtml(logo.label)}"></label>
    </article>
  `).join("") : '<p class="logo-empty-state">Belum ada logo. Tambahkan logo untuk menampilkannya pada dokumen.</p>';

  container.querySelectorAll("[data-select-logo]").forEach(button => {
    button.addEventListener("click", () => {
      selectedLogoId = button.dataset.selectLogo;
      currentLogoSnapshot = logoSnapshot(getLogos().find(item => item.id === selectedLogoId));
      renderLogoChoices();
      updateDocumentLogo();
      scheduleAutoSave();
    });
  });
  container.querySelectorAll("[data-label-logo]").forEach(input => {
    input.addEventListener("change", async () => {
      const current = getLogos();
      const logo = current.find(item => item.id === input.dataset.labelLogo);
      if (logo) logo.label = input.value.trim() || "Logo";
      if (!saveLogos(current)) return;
      if (window.SpkCloud?.isActive()) {
        try {
          const savedLogo = await window.SpkCloud.saveLogo(logo);
          const latest = getLogos().map(item => item.id === savedLogo.id ? savedLogo : item);
          saveLogos(latest);
          if (selectedLogoId === savedLogo.id) currentLogoSnapshot = logoSnapshot(savedLogo);
        } catch (error) { toast(window.SpkCloud.errorMessage(error), "error"); }
      } else if (selectedLogoId === input.dataset.labelLogo) currentLogoSnapshot = logoSnapshot(logo);
      renderLogoChoices(); updateDocumentLogo(); scheduleAutoSave();
    });
  });
  container.querySelectorAll("[data-upload-logo]").forEach(input => {
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
      if (!allowed.includes(file.type) || file.size > 2 * 1024 * 1024) {
        toast("Logo harus PNG, JPG, WEBP, atau SVG dengan ukuran maksimal 2 MB.", "error");
        input.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const current = getLogos();
        const logo = current.find(item => item.id === input.dataset.uploadLogo);
        if (!logo) return;
        logo.dataUrl = String(reader.result);
        if (!saveLogos(current)) return;
        if (window.SpkCloud?.isActive()) {
          try {
            const savedLogo = await window.SpkCloud.saveLogo(logo);
            const latest = getLogos().map(item => item.id === savedLogo.id ? savedLogo : item);
            saveLogos(latest);
            if (selectedLogoId === savedLogo.id) currentLogoSnapshot = logoSnapshot(savedLogo);
            toast("Logo berhasil diunggah ke workspace.");
          } catch (error) { toast(window.SpkCloud.errorMessage(error), "error"); }
        } else {
          if (selectedLogoId === logo.id) currentLogoSnapshot = logoSnapshot(logo);
          toast("Logo tersimpan di browser.");
        }
        renderLogoChoices(); updateDocumentLogo(); scheduleAutoSave();
      };
      reader.onerror = () => toast("Logo tidak dapat dibaca.", "error");
      reader.readAsDataURL(file);
    });
  });
  container.querySelectorAll("[data-delete-logo]").forEach(button => {
    button.addEventListener("click", () => deleteLogo(button.dataset.deleteLogo));
  });
}

async function deleteLogo(id) {
  const logos = getLogos();
  const target = logos.find(logo => logo.id === id);
  if (!target || !confirm(`Hapus ${target.label}? SPK tersimpan akan mempertahankan salinan logo yang digunakannya.`)) return;

  if (window.SpkCloud?.isActive()) {
    try { await window.SpkCloud.deleteLogo(id); }
    catch (error) { toast(window.SpkCloud.errorMessage(error), "error"); return; }
  }
  const records = getSaved();
  if (storageReadFailed) return;
  let recordsChanged = false;
  records.forEach(record => {
    if (record.selectedLogoId === id && !record.selectedLogoSnapshot) {
      record.selectedLogoSnapshot = logoSnapshot(target);
      recordsChanged = true;
    }
  });
  if (recordsChanged && !setSaved(records)) return;

  const remaining = logos.filter(logo => logo.id !== id);
  if (!saveLogos(remaining)) return;
  if (selectedLogoId === id && currentRecordId === null) {
    selectedLogoId = remaining[0]?.id || null;
    currentLogoSnapshot = logoSnapshot(remaining[0]);
  }
  renderLogoChoices();
  updateDocumentLogo();
  toast("Logo dihapus. Logo pada SPK lama tetap dipertahankan.");
  if (window.SpkCloud?.isActive()) window.SpkCloud.refresh().catch(error => console.warn(error));
}

function addLogo() {
  const logos = getLogos();
  if (logos.length >= LOGO_COUNT) {
    toast("Batas maksimal empat logo sudah tercapai.", "error");
    return;
  }
  const index = Array.from({ length: LOGO_COUNT }, (_, i) => `logo-${i + 1}`)
    .find(id => !logos.some(logo => logo.id === id));
  const logo = { id: index || `logo-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, label: `Logo ${logos.length + 1}`, dataUrl: "", active: true };
  logos.push(logo);
  if (!saveLogos(logos)) return;
  selectedLogoId = logo.id;
  currentLogoSnapshot = logoSnapshot(logo);
  renderLogoChoices();
  updateDocumentLogo();
  if (window.SpkCloud?.isActive()) {
    window.SpkCloud.saveLogo(logo).then(savedLogo => {
      const latest = getLogos().map(item => item.id === savedLogo.id ? savedLogo : item);
      saveLogos(latest); renderLogoChoices();
    }).catch(error => toast(window.SpkCloud.errorMessage(error), "error"));
  }
  toast("Slot logo ditambahkan. Unggah gambar dan ubah namanya bila perlu.");
}

function setupImageSlot() {
  const input = $("#designImage");
  const preview = $("#designPreview");
  const dropzone = $("#designPasteZone");
  const thumbnail = dropzone.querySelector(".thumb");
  const removeButton = $("#removeDesign");
  let pasteInProgress = false;

  function setImage(dataUrl, save = true, storagePath = null, fileSize = 0, mimeType = "image/jpeg") {
    currentDesignStoragePath = storagePath || null;
    currentDesignFileSize = Number(fileSize) || 0;
    currentDesignMimeType = mimeType || "image/jpeg";
    preview.src = dataUrl;
    thumbnail.src = dataUrl;
    dropzone.classList.add("has-image");
    removeButton.hidden = false;
    if (save) scheduleAutoSave();
  }
  function clearImage(save = true) {
    currentDesignStoragePath = null;
    currentDesignFileSize = 0;
    currentDesignMimeType = "image/jpeg";
    preview.removeAttribute("src");
    thumbnail.removeAttribute("src");
    dropzone.classList.remove("has-image");
    removeButton.hidden = true;
    input.value = "";
    if (save) scheduleAutoSave();
  }
  function processFile(file) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast("Gunakan gambar JPG, PNG, atau WEBP.", "error");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast("Ukuran gambar maksimal 15 MB.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = event => {
      const image = new Image();
      image.onload = () => {
        try {
          const maxDimension = 1800;
          const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas tidak tersedia");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          setImage(canvas.toDataURL("image/jpeg", 0.88));
          toast("Gambar desain dimuat ke formulir. Simpan SPK agar perubahan tersimpan.");
        } catch (error) {
          console.error(error);
          toast("Gambar tidak dapat diproses. Gambar sebelumnya tetap digunakan.", "error");
        }
      };
      image.onerror = () => toast("Gambar tidak dapat diproses. Gambar sebelumnya tetap digunakan.", "error");
      image.src = event.target.result;
    };
    reader.onerror = () => toast("Gambar tidak dapat dibaca. Gambar sebelumnya tetap digunakan.", "error");
    reader.readAsDataURL(file);
  }

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) processFile(file);
    input.value = "";
  });
  dropzone.addEventListener("click", () => dropzone.focus());
  dropzone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dropzone.focus();
      toast("Tempel gambar dengan Ctrl + V atau ⌘ + V.");
    }
  });
  document.addEventListener("paste", event => {
    if (document.activeElement !== dropzone) return;
    const items = [...(event.clipboardData?.items || [])];
    const imageItem = items.find(item => item.kind === "file" && item.type.startsWith("image/"));
    if (!imageItem) {
      toast("Clipboard tidak berisi gambar. Gambar yang ada tidak diubah.", "error");
      return;
    }
    const file = imageItem.getAsFile();
    if (!file || pasteInProgress) return;
    event.preventDefault();
    pasteInProgress = true;
    processFile(file);
    setTimeout(() => { pasteInProgress = false; }, 700);
  });
  removeButton.addEventListener("click", event => { event.preventDefault(); clearImage(); });
  return { setImage, clearImage };
}

function setDefaultDates() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#orderDate").value = localDate;
  $("#deadline").value = localDate;
  syncDates();
}

function startNewSpk(showMessage = true) {
  clearTimeout(autoSaveTimer);
  currentRecordId = null;
  currentCreatedAt = null;
  currentRecordVersion = 0;
  currentDesignStoragePath = null;
  spkNumberReady = true;
  currentSpkNo = generateSpkNo();

  $("#customer").value = "";
  $("#order").value = "";
  $("#orderDate").value = "";
  $("#deadline").value = "";
  $("#modelKerah").selectedIndex = 0;
  $("#material").value = "";
  $("#colour").value = "";
  $("#notes").value = "";
  $("#apDesigner").value = "";
  $("#apCs").value = "";
  $("#apCustomer").value = "";
  $("#apProduction").value = "";
  $$(".size").forEach(input => { input.value = "0"; });
  designSlot.clearImage(false);
  const defaultLogo = getLogos()[0] || null;
  selectedLogoId = defaultLogo?.id || null;
  currentLogoSnapshot = logoSnapshot(defaultLogo);
  renderLogoChoices();
  updateDocumentLogo();

  setDefaultDates();
  paintSpkNo();
  updateSizes();
  $("#pCustomer").textContent = "";
  $("#pOrder").textContent = "";
  $("#pModelKerah").textContent = $("#modelKerah").value;
  $("#pMaterial").textContent = "";
  $("#pColour").textContent = "";
  $("#pNotes").textContent = "";
  $("#pApDesigner").textContent = "";
  $("#pApCs").textContent = "";
  $("#pApCustomer").textContent = "";
  $("#pApProduction").textContent = "";
  updatePrintDate();
  if (window.SpkCloud?.isActive()) {
    spkNumberReady = false;
    currentSpkNo = "Menyiapkan nomor…";
    paintSpkNo();
    window.SpkCloud.nextSpkNumber().then(number => {
      if (currentRecordId === null) { currentSpkNo = number; spkNumberReady = true; paintSpkNo(); }
    }).catch(error => { spkNumberReady = false; toast(window.SpkCloud.errorMessage(error), "error"); });
  }
  if (showMessage) toast("Formulir SPK baru siap digunakan.");
}

renderSizeInputs();
const designSlot = setupImageSlot();
paintSpkNo();
selectedLogoId = getLogos()[0]?.id || null;
renderLogoChoices();
currentLogoSnapshot = logoSnapshot(getLogos().find(item => item.id === selectedLogoId));
updateDocumentLogo();
$("#addLogoBtn").addEventListener("click", addLogo);
bindText("#customer", "#pCustomer");
bindText("#order", "#pOrder");
bindText("#modelKerah", "#pModelKerah");
bindText("#material", "#pMaterial");
bindText("#colour", "#pColour");
bindText("#apDesigner", "#pApDesigner");
bindText("#apCs", "#pApCs");
bindText("#apCustomer", "#pApCustomer");
bindText("#apProduction", "#pApProduction");
$("#notes").addEventListener("input", () => { $("#pNotes").textContent = $("#notes").value; });
["#orderDate", "#deadline"].forEach(selector => {
  $(selector).addEventListener("input", syncDates);
  $(selector).addEventListener("change", syncDates);
});
$$(".size").forEach(input => {
  input.addEventListener("input", updateSizes);
  input.addEventListener("change", () => {
    if (!Number.isSafeInteger(Number(input.value)) || Number(input.value) < 0) input.value = "0";
    updateSizes();
  });
});
setDefaultDates();
updateSizes();
updatePrintDate();
renderSaved();


window.SpkApp = {
  startNew: startNewSpk,
  setRecordNumber(number) {
    if (currentRecordId !== null) return;
    currentSpkNo = String(number || generateSpkNo()); spkNumberReady = true; paintSpkNo();
  },
  getCurrentRecordId: () => currentRecordId,
  refreshUI() { renderSaved(); renderLogoChoices(); updateDocumentLogo(); updatePrintDate(); }
};
window.addEventListener("spkcloud:loaded", () => {
  renderSaved(); renderLogoChoices();
  const current = getLogos().find(item => item.id === selectedLogoId) || getLogos()[0];
  if (current) { selectedLogoId = current.id; currentLogoSnapshot = logoSnapshot(current); }
  updateDocumentLogo(); updatePrintDate();
});

$$(".editor input, .editor textarea, .editor select").forEach(field => {
  field.addEventListener("input", scheduleAutoSave);
  field.addEventListener("change", scheduleAutoSave);
});
$("#savedDateSearch").addEventListener("input", renderSaved);
$("#savedTitleSearch").addEventListener("input", renderSaved);
$("#saveBtn").addEventListener("click", async () => {
  const isNewSpk = currentRecordId === null;
  const button = $("#saveBtn"); button.disabled = true;
  const success = await persistCurrent(true); button.disabled = false;
  if (!success) return;
  // SPK baru langsung diarsipkan lalu formulir disiapkan untuk dokumen berikutnya.
  // Saat memperbarui arsip, formulir tetap terbuka pada SPK yang sedang diedit.
  if (isNewSpk) startNewSpk(false);
});
$("#resetBtn").addEventListener("click", () => {
  if (!confirm("Mulai SPK baru? Pastikan SPK sebelumnya sudah disimpan.")) return;
  startNewSpk();
});
$("#printBtn").addEventListener("click", async () => {
  syncDates();
  if (!await persistCurrent(false)) return;
  window.print();
});
$("#pdfBtn").addEventListener("click", async () => {
  syncDates();
  if (!await persistCurrent(false)) return;
  window.print();
});

$("#jpgBtn").addEventListener("click", async event => {
  syncDates();
  if (!await persistCurrent(false)) return;
  if (typeof window.html2canvas !== "function") {
    toast("Fitur JPG belum tersedia karena pustaka gambar tidak termuat.", "error");
    return;
  }
  const button = event.currentTarget;
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "Membuat JPG…";
  try {
    const spk = $("#spk");
    const images = [...spk.querySelectorAll("img")].filter(image => image.getAttribute("src"));
    await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
      image.onload = resolve;
      image.onerror = resolve;
    })));
    const capture = await window.html2canvas(spk, {
      scale: 2480 / spk.getBoundingClientRect().width,
      backgroundColor: "#ffffff", useCORS: true, logging: false
    });
    const canvas = document.createElement("canvas");
    canvas.width = 2480;
    canvas.height = 3508;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const factor = Math.min(canvas.width / capture.width, canvas.height / capture.height);
    const width = capture.width * factor;
    const height = capture.height * factor;
    context.drawImage(capture, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    const customer = $("#customer").value.trim().replace(/[^\w-]+/g, "_") || "SPK";
    const order = $("#order").value.trim().replace(/[^\w-]+/g, "_");
    const link = document.createElement("a");
    link.download = `SPK_${customer}${order ? `_${order}` : ""}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
    toast("JPG berhasil dibuat.");
  } catch (error) {
    console.error(error);
    toast("Gagal membuat JPG. Coba lagi.", "error");
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
});


// Local backup/import. Import merges by record ID and does not erase existing records.
$("#backupBtn").addEventListener("click", async () => {
  const records = getSaved();
  if (storageReadFailed) return;
  const button = $("#backupBtn"); button.disabled = true;
  try {
    const backup = window.SpkCloud?.isActive()
      ? await window.SpkCloud.exportBackup(records, getLogos())
      : { format: "spk-generator-backup", version: 2, exportedAt: new Date().toISOString(), source: "local", records, logos: getLogos() };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = `backup-spk-${new Date().toISOString().slice(0, 10)}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`Backup dibuat: ${records.length} SPK, termasuk file gambar yang dapat diunduh.`);
  } catch (error) {
    console.error(error); toast(window.SpkCloud?.isActive() ? window.SpkCloud.errorMessage(error) : "Backup gagal dibuat.", "error");
  } finally { button.disabled = false; }
});

$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) {
    toast("File backup terlalu besar (maksimal 100 MB).", "error");
    event.target.value = "";
    return;
  }
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== "spk-generator-backup" || !Array.isArray(backup.records)) {
      throw new Error("Format backup tidak dikenali.");
    }
    if (window.SpkCloud?.isActive()) {
      const button = $("#importBtn"); button.disabled = true;
      try {
        const result = await window.SpkCloud.importRecords(backup.records, backup.logos || []);
        toast(`Impor cloud selesai: ${result.added} ditambahkan, ${result.skipped} dilewati.`);
      } finally { button.disabled = false; }
      return;
    }
    const existing = getSaved();
    if (storageReadFailed) return;
    const ids = new Set(existing.map(record => String(record.id)));
    const numbers = new Set(existing.map(record => String(record.spkNo)));
    let added = 0, skipped = 0;
    for (const record of backup.records) {
      if (!record || !record.id || !record.spkNo || !record.customer || !record.order ||
          !Array.isArray(record.sizes) || ids.has(String(record.id)) || numbers.has(String(record.spkNo))) {
        skipped++;
        continue;
      }
      existing.push(record);
      ids.add(String(record.id));
      numbers.add(String(record.spkNo));
      added++;
    }
    if (!setSaved(existing)) return;
    if (Array.isArray(backup.logos) && confirm("Backup juga berisi konfigurasi logo. Ganti daftar logo di browser ini?")) {
      const safeLogos = backup.logos.filter((item, index) => item && typeof item.id === "string" &&
        (item.dataUrl || item.active === true || String(item.label || `Logo ${index + 1}`) !== `Logo ${index + 1}`))
        .slice(0, LOGO_COUNT).map((item, index) => ({
          id: item.id,
          label: String(item.label || `Logo ${index + 1}`).slice(0, 40),
          dataUrl: typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/") ? item.dataUrl : "",
          active: true
        }));
      if (saveLogos(safeLogos)) {
        selectedLogoId = safeLogos.some(item => item.id === selectedLogoId) ? selectedLogoId : safeLogos[0]?.id || null;
        currentLogoSnapshot = logoSnapshot(safeLogos.find(item => item.id === selectedLogoId));
        renderLogoChoices();
        updateDocumentLogo();
      }
    }
    renderSaved();
    toast(`Impor selesai: ${added} ditambahkan, ${skipped} dilewati.`);
  } catch (error) {
    toast(error.message || "File backup tidak valid.", "error");
  } finally {
    event.target.value = "";
  }
});
