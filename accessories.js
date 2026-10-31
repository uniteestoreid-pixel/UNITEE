(() => {
  "use strict";

  const TABLE = "accessory_spk_records";
  const BUCKET = "spk-files";
  const CATEGORY_OPTIONS = [
    "Topi", "Tas", "Tote bag", "Pouch / dompet", "Kaos kaki",
    "Lanyard", "Gantungan kunci", "Pin / badge", "Patch / emblem", "Custom"
  ];
  const $ = selector => document.querySelector(selector);
  const state = {
    records: [], activeId: null, version: 0,
    currentWorkspaceId: null, currentUserId: null,
    referencePath: null, referenceUrl: "", referenceFile: null,
    removeReference: false, loading: false, loadToken: 0,
    saving: false, printing: false, previewObjectUrl: null
  };

  function cloud() { return window.SpkCloud; }
  function isCloudReady() { return Boolean(cloud()?.isActive?.()); }
  function getContext() {
    if (!isCloudReady()) throw new Error("Login dan pilih workspace terlebih dahulu untuk memakai SPK Aksesoris bersama.");
    const api = cloud();
    const client = api.getClient?.();
    const workspaceId = api.getWorkspaceId?.();
    const userId = api.getUserId?.();
    if (!client || !workspaceId || !userId) throw new Error("Sesi workspace belum siap. Muat ulang workspace lalu coba lagi.");
    return { client, workspaceId, userId };
  }
  function contextStillMatches(context) {
    return isCloudReady()
      && cloud().getWorkspaceId?.() === context.workspaceId
      && cloud().getUserId?.() === context.userId;
  }
  function makeId() {
    return globalThis.crypto?.randomUUID?.() || ("acc-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  }
  function todayIso() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
  }
  function newNumber() {
    const now = new Date();
    const date = now.getFullYear() + String(now.getMonth()+1).padStart(2,"0") + String(now.getDate()).padStart(2,"0");
    const suffix = Math.random().toString(36).slice(2,6).toUpperCase();
    return "AKS-" + date + "-" + suffix;
  }
  function status(message, error = false) {
    const node = $("#accessoryStatus");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("error-text", Boolean(error));
  }
  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(String(value) + "T00:00:00");
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("id-ID", { day:"2-digit", month:"long", year:"numeric" }).format(date);
  }
  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }).format(date);
  }
  function text(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value == null || value === "" ? "—" : String(value);
  }
  function value(selector) { return String($(selector)?.value || "").trim(); }
  function setButtonBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.oldLabel = button.textContent;
      button.disabled = true;
      if (label) button.textContent = label;
    } else {
      button.disabled = false;
      if (button.dataset.oldLabel) button.textContent = button.dataset.oldLabel;
      delete button.dataset.oldLabel;
    }
  }
  function setAccessoryBusy(busy) {
    const page = $("#accessoryPage");
    if (!page) return;
    const controls = [...page.querySelectorAll("input,select,textarea,button"), $("#spkPageTab"), $("#accessoryPageTab")].filter(Boolean);
    controls.forEach(control => {
      if (busy) {
        control.dataset.wasDisabled = String(control.disabled);
        control.disabled = true;
      } else if (control.dataset.wasDisabled !== undefined) {
        control.disabled = control.dataset.wasDisabled === "true";
        delete control.dataset.wasDisabled;
      }
    });
  }
  function errorMessage(error) {
    const message = String(error?.message || error || "Operasi gagal.");
    if (/42501|permission denied|row-level security/i.test(message)) return "Akses ditolak. Pastikan akun sudah menjadi anggota aktif workspace yang dipilih.";
    if (/duplicate key|unique constraint/i.test(message)) return "Nomor SPK Aksesoris sudah digunakan. Klik SPK Baru lalu simpan kembali.";
    if (/JWT|token|session/i.test(message)) return "Sesi login berakhir. Login kembali untuk melanjutkan.";
    if (/Failed to fetch|network/i.test(message)) return "Koneksi cloud gagal. Periksa internet lalu coba muat ulang.";
    return message.slice(0, 240);
  }

  function setPage(page) {
    const accessory = page === "accessories";
    document.body.classList.toggle("accessory-mode", accessory);
    $("#accessoryPage").hidden = !accessory;
    $("#spkPageTab").classList.toggle("active", !accessory);
    $("#accessoryPageTab").classList.toggle("active", accessory);
    $("#spkPageTab").setAttribute("aria-selected", String(!accessory));
    $("#accessoryPageTab").setAttribute("aria-selected", String(accessory));
    if (accessory) loadRecords().catch(error => status(errorMessage(error), true));
    else window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function field(labelText, key, currentValue, type = "text", placeholder = "") {
    const wrapper = document.createElement("label");
    wrapper.className = "accessory-field";
    const title = document.createElement("span");
    title.textContent = labelText;
    const input = document.createElement("input");
    input.type = type;
    input.dataset.field = key;
    input.value = currentValue ?? "";
    if (placeholder) input.placeholder = placeholder;
    if (type === "number") {
      input.min = "1";
      input.step = "1";
      input.inputMode = "numeric";
    }
    wrapper.append(title, input);
    return wrapper;
  }
  function selectField(labelText, key, currentValue, options) {
    const wrapper = document.createElement("label");
    wrapper.className = "accessory-field";
    const title = document.createElement("span");
    title.textContent = labelText;
    const select = document.createElement("select");
    select.dataset.field = key;
    options.forEach(optionText => {
      const option = document.createElement("option");
      option.value = optionText;
      option.textContent = optionText;
      option.selected = optionText === currentValue;
      select.append(option);
    });
    wrapper.append(title, select);
    return wrapper;
  }
  function readItems() {
    return [...$("#accessoryItemRows").querySelectorAll(".accessory-item-row")].map(row => {
      const read = key => [...row.querySelectorAll("[data-field]")].find(node => node.dataset.field === key)?.value?.trim() || "";
      return {
        category: read("category"), name: read("name"),
        material: read("material"), colour: read("colour"),
        variant: read("variant"), specification: read("specification"),
        quantity: Number(read("quantity")), unit: "pcs"
      };
    });
  }
  function createItemRow(item = {}) {
    const row = document.createElement("article");
    row.className = "accessory-item-row";
    const top = document.createElement("div");
    top.className = "accessory-item-row-head";
    const title = document.createElement("strong");
    title.textContent = "Item aksesoris";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn small danger-action";
    remove.textContent = "Hapus";
    remove.addEventListener("click", () => {
      row.remove();
      renumberItems();
      updatePreview();
    });
    top.append(title, remove);
    const fields = document.createElement("div");
    fields.className = "accessory-item-fields";
    fields.append(
      selectField("Kategori", "category", item.category || "Custom", CATEGORY_OPTIONS),
      field("Nama aksesoris", "name", item.name || "", "text", "Contoh: Topi trucker UNITEE"),
      field("Bahan", "material", item.material || "", "text", "Contoh: drill"),
      field("Warna", "colour", item.colour || "", "text", "Warna"),
      field("Varian / ukuran", "variant", item.variant || "", "text", "Contoh: all size"),
      field("Detail / spesifikasi", "specification", item.specification || "", "text", "Logo bordir, ukuran, finishing…"),
      field("Jumlah", "quantity", item.quantity || "", "number", "Qty")
    );
    row.append(top, fields);
    fields.querySelectorAll("input,select").forEach(input => {
      input.addEventListener("input", updatePreview);
      input.addEventListener("change", updatePreview);
    });
    return row;
  }
  function renumberItems() {
    [...$("#accessoryItemRows").children].forEach((row, index) => {
      const title = row.querySelector(".accessory-item-row-head strong");
      if (title) title.textContent = "Item " + (index + 1);
    });
    $("#accessoryItemCount").textContent = $("#accessoryItemRows").children.length + " item";
  }
  function renderItems(items) {
    const container = $("#accessoryItemRows");
    container.replaceChildren();
    (items?.length ? items : [{}]).forEach(item => container.append(createItemRow(item)));
    renumberItems();
  }
  function addItem() {
    const current = readItems();
    current.push({});
    renderItems(current);
    updatePreview();
    const lastRow = $("#accessoryItemRows .accessory-item-row:last-child");
    lastRow?.querySelector('input[data-field="name"]')?.focus();
  }
  function validateItems(items) {
    if (!items.length || items.length > 40) return "Isi minimal satu item aksesoris (maksimal 40 item).";
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item.name) return "Nama aksesoris pada item " + (index + 1) + " belum diisi.";
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) return "Jumlah item " + (index + 1) + " harus minimal 1 pcs.";
      if (item.name.length > 160 || item.specification.length > 500) return "Keterangan item " + (index + 1) + " terlalu panjang.";
    }
    return "";
  }

  function validateDocumentForPrint() {
    if (!value("#accCustomer")) {
      status("Nama customer / divisi belum diisi.", true);
      $("#accCustomer").focus();
      return false;
    }
    if (!value("#accOrder")) {
      status("Nama order belum diisi.", true);
      $("#accOrder").focus();
      return false;
    }
    if (state.referencePath && !state.referenceUrl && !state.referenceFile && !state.removeReference) {
      status("Gambar referensi arsip belum siap. Muat ulang arsip sebelum mencetak.", true);
      return false;
    }
    const items = readItems();
    const itemError = validateItems(items);
    if (itemError) {
      status(itemError, true);
      const match = itemError.match(/item (\d+)/i);
      const row = match ? $("#accessoryItemRows").children[Number(match[1]) - 1] : null;
      if (/nama aksesoris/i.test(itemError)) row?.querySelector('[data-field="name"]')?.focus();
      else if (/jumlah item/i.test(itemError)) row?.querySelector('[data-field="quantity"]')?.focus();
      else row?.querySelector("input,select")?.focus();
      return false;
    }
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(total) || total > 1000000) {
      status("Total jumlah aksesoris tidak valid.", true);
      return false;
    }
    return true;
  }

  function setFormMode(editing) {
    const eyebrow = $("#accessoryFormTop .eyebrow");
    const heading = $("#accessoryFormTop h2");
    if (eyebrow) eyebrow.textContent = editing ? "EDIT ARSIP" : "FORMULIR BARU";
    if (heading) heading.textContent = editing ? "Perbarui informasi pesanan" : "Informasi pesanan";
    const saveButton = $("#accessorySaveBtn");
    if (saveButton) saveButton.textContent = editing ? "Simpan perubahan" : "Simpan Aksesoris";
  }

  function updatePreview() {
    if (!$("#accessoryPrintDocument")) return;
    text("#accPreviewNumber", value("#accSpkNo"));
    text("#accPreviewCustomer", value("#accCustomer"));
    text("#accPreviewOrder", value("#accOrder"));
    text("#accPreviewDate", formatDate(value("#accOrderDate")));
    text("#accPreviewDeadline", formatDate(value("#accDeadline")));
    text("#accPreviewRequester", value("#accRequester"));
    text("#accPreviewNotes", value("#accNotes") || "—");
    text("#accPreviewDesigner", value("#accApDesigner"));
    text("#accPreviewCs", value("#accApCs"));
    text("#accPreviewCustomerApproval", value("#accApCustomer"));
    text("#accPreviewProduction", value("#accApProduction"));
    const items = readItems();
    const tbody = $("#accPreviewItems");
    tbody.replaceChildren();
    let total = 0;
    items.forEach((item, index) => {
      total += Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
      const row = document.createElement("tr");
      const itemLabel = (item.category || "—") + "\n" + (item.name || "Nama item belum diisi");
      const details = [item.material, item.colour, item.variant, item.specification].filter(Boolean).join(" · ") || "—";
      [String(index + 1), itemLabel, details, item.quantity > 0 ? item.quantity + " " + item.unit : "—"].forEach((cell, cellIndex) => {
        const td = document.createElement("td");
        td.textContent = cell;
        if (cellIndex === 3) td.className = "quantity-cell";
        row.append(td);
      });
      tbody.append(row);
    });
    text("#accPreviewTotal", total + " pcs");
    const img = $("#accPreviewImage");
    const empty = $("#accPreviewImageEmpty");
    if (state.referenceUrl) {
      img.src = state.referenceUrl;
      img.hidden = false;
      empty.hidden = true;
    } else if (state.referenceFile) {
      if (!state.previewObjectUrl) state.previewObjectUrl = URL.createObjectURL(state.referenceFile);
      img.src = state.previewObjectUrl;
      img.hidden = false;
      empty.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      empty.hidden = false;
    }
  }

  async function loadRecords() {
    if (!isCloudReady()) {
      const hadCloudContext = Boolean(state.currentWorkspaceId || state.currentUserId);
      state.loadToken++;
      state.records = [];
      state.currentWorkspaceId = null;
      state.currentUserId = null;
      if (hadCloudContext) startNew(false);
      renderHistory();
      status("Login dan pilih workspace untuk menyimpan arsip bersama. Formulir tetap bisa langsung dicetak atau disimpan sebagai PDF.");
      return;
    }
    const context = getContext();
    const workspaceChanged = state.currentWorkspaceId && state.currentWorkspaceId !== context.workspaceId;
    const accountChanged = state.currentUserId && state.currentUserId !== context.userId;
    if (workspaceChanged || accountChanged) startNew(false);
    const token = ++state.loadToken;
    state.loading = true;
    status("Memuat arsip aksesoris workspace…");
    try {
      const all = [];
      for (let offset = 0; ; offset += 500) {
        const result = await context.client.from(TABLE)
          .select("*")
          .eq("workspace_id", context.workspaceId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .range(offset, offset + 499);
        if (result.error) throw result.error;
        if (token !== state.loadToken || !contextStillMatches(context)) return;
        const data = result.data || [];
        all.push(...data);
        if (data.length < 500) break;
      }
      state.records = all;
      state.currentWorkspaceId = context.workspaceId;
      state.currentUserId = context.userId;
      if (state.activeId && !all.some(record => record.id === state.activeId)) startNew(false);
      renderHistory();
      status(all.length + " SPK Aksesoris dimuat dari workspace bersama.");
    } catch (error) {
      if (token === state.loadToken) status(errorMessage(error), true);
      throw error;
    } finally {
      if (token === state.loadToken) state.loading = false;
    }
  }

  function renderHistory() {
    const container = $("#accessoryHistory");
    if (!container) return;
    container.replaceChildren();
    text("#accessoryHistoryCount", state.records.length + " dokumen");
    if (!state.records.length) {
      const empty = document.createElement("div");
      empty.className = "accessory-empty-state";
      empty.textContent = isCloudReady() ? "Belum ada SPK aksesoris di workspace ini." : "Login ke workspace untuk melihat arsip bersama.";
      container.append(empty);
      return;
    }
    state.records.forEach(record => {
      const card = document.createElement("article");
      card.className = "accessory-history-row";
      const info = document.createElement("div");
      info.className = "accessory-history-info";
      const title = document.createElement("strong");
      title.textContent = record.customer + " · " + record.order_name;
      const meta = document.createElement("span");
      meta.textContent = record.spk_no + " · " + record.total_quantity + " pcs · " + formatDateTime(record.updated_at);
      info.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "accessory-history-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn small";
      edit.textContent = "Buka";
      edit.addEventListener("click", () => openRecord(record.id));
      const print = document.createElement("button");
      print.type = "button";
      print.className = "btn small";
      print.textContent = "Cetak";
      print.addEventListener("click", async () => {
        if (!await openRecord(record.id)) return;
        await printRecord(print);
      });
      actions.append(edit, print);
      card.append(info, actions);
      container.append(card);
    });
  }

  async function openRecord(recordId) {
    const record = state.records.find(item => item.id === recordId);
    if (!record) return false;
    let context;
    try { context = getContext(); }
    catch (error) { status(errorMessage(error), true); return false; }
    state.activeId = record.id;
    state.version = Number(record.version) || 1;
    state.referencePath = record.reference_image_path || null;
    state.referenceUrl = "";
    state.referenceFile = null;
    state.removeReference = false;
    if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
    state.previewObjectUrl = null;
    $("#accSpkNo").value = record.spk_no || "";
    $("#accCustomer").value = record.customer || "";
    $("#accOrder").value = record.order_name || "";
    $("#accOrderDate").value = record.order_date || "";
    $("#accDeadline").value = record.deadline || "";
    $("#accRequester").value = record.requested_by || "";
    $("#accNotes").value = record.notes || "";
    $("#accApDesigner").value = record.ap_designer || "";
    $("#accApCs").value = record.ap_cs || "";
    $("#accApCustomer").value = record.ap_customer || "";
    $("#accApProduction").value = record.ap_production || "";
    $("#accReferenceInput").value = "";
    setFormMode(true);
    renderItems(Array.isArray(record.items) ? record.items : []);
    updatePreview();
    if (state.referencePath) {
      try {
        state.referenceUrl = await cloud().signPath(state.referencePath);
        if (!contextStillMatches(context)) {
          startNew(false);
          return false;
        }
      } catch {
        if (!contextStillMatches(context)) {
          startNew(false);
          return false;
        }
        status("SPK dibuka, tetapi gambar referensi belum bisa dimuat. Coba muat ulang arsip.", true);
        return false;
      }
    }
    if (!contextStillMatches(context)) {
      startNew(false);
      return false;
    }
    updatePreview();
    status("Membuka " + record.spk_no + ". Perubahan baru tersimpan setelah tombol Simpan ditekan.");
    $("#accessoryFormTop")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  function startNew(showStatus = true) {
    state.activeId = null;
    state.version = 0;
    state.referencePath = null;
    state.referenceUrl = "";
    state.referenceFile = null;
    state.removeReference = false;
    setFormMode(false);
    if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
    state.previewObjectUrl = null;
    $("#accSpkNo").value = newNumber();
    $("#accCustomer").value = "";
    $("#accOrder").value = "";
    $("#accOrderDate").value = todayIso();
    $("#accDeadline").value = "";
    $("#accRequester").value = "";
    $("#accNotes").value = "";
    $("#accApDesigner").value = "";
    $("#accApCs").value = "";
    $("#accApCustomer").value = "";
    $("#accApProduction").value = "";
    $("#accReferenceInput").value = "";
    renderItems([{}]);
    updatePreview();
    if (showStatus) status("Form baru siap. Simpan Aksesoris untuk masuk arsip, atau cetak / simpan PDF langsung dari isian ini.");
  }

  async function uploadReference(context, recordId) {
    if (!state.referenceFile) return state.removeReference ? null : state.referencePath;
    const extension = state.referenceFile.type === "image/png" ? "png" : state.referenceFile.type === "image/webp" ? "webp" : "jpg";
    const path = context.workspaceId + "/accessories/" + recordId + "/" + makeId() + "." + extension;
    const { error } = await context.client.storage.from(BUCKET).upload(path, state.referenceFile, {
      upsert: false, contentType: state.referenceFile.type, cacheControl: "3600"
    });
    if (error) throw error;
    if (!contextStillMatches(context)) throw new Error("Workspace berubah saat gambar sedang diunggah. Ulangi dari workspace yang benar.");
    return path;
  }

  async function saveRecord() {
    if (state.saving || state.printing) return;
    let context;
    try { context = getContext(); }
    catch (error) { status(errorMessage(error), true); return; }
    const customer = value("#accCustomer");
    const orderName = value("#accOrder");
    const items = readItems();
    const itemError = validateItems(items);
    if (!customer) { status("Nama customer / divisi belum diisi.", true); $("#accCustomer").focus(); return; }
    if (!orderName) { status("Nama order belum diisi.", true); $("#accOrder").focus(); return; }
    if (itemError) { status(itemError, true); return; }
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(total) || total > 1000000) { status("Total jumlah aksesoris tidak valid.", true); return; }
    const button = $("#accessorySaveBtn");
    state.saving = true;
    setAccessoryBusy(true);
    setButtonBusy(button, true, "Menyimpan…");
    let uploadedReferencePath = null;
    let databaseSaved = false;
    try {
      const recordId = state.activeId || makeId();
      const referencePath = await uploadReference(context, recordId);
      if (state.referenceFile) uploadedReferencePath = referencePath;
      if (!contextStillMatches(context)) throw new Error("Akun atau workspace berubah. Data tidak disimpan ke workspace yang salah.");
      const now = new Date().toISOString();
      const previous = state.records.find(record => record.id === recordId);
      const payload = {
        workspace_id: context.workspaceId,
        spk_no: value("#accSpkNo") || newNumber(),
        customer, order_name: orderName,
        order_date: value("#accOrderDate") || null,
        deadline: value("#accDeadline") || null,
        requested_by: value("#accRequester"),
        items, total_quantity: total,
        notes: value("#accNotes"),
        ap_designer: value("#accApDesigner"),
        ap_cs: value("#accApCs"),
        ap_customer: value("#accApCustomer"),
        ap_production: value("#accApProduction"),
        reference_image_path: referencePath,
        reference_image_name: state.referenceFile?.name || (state.removeReference ? null : previous?.reference_image_name) || null,
        reference_image_mime_type: state.referenceFile?.type || (state.removeReference ? null : previous?.reference_image_mime_type) || null,
        updated_at: now
      };
      let saved;
      if (state.activeId) {
        payload.version = state.version + 1;
        const result = await context.client.from(TABLE).update(payload)
          .eq("id", state.activeId).eq("workspace_id", context.workspaceId)
          .eq("version", state.version).is("deleted_at", null)
          .select("*").maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("SPK aksesoris diubah oleh pengguna lain. Muat ulang arsip, buka versi terbaru, lalu simpan kembali.");
        saved = result.data;
      } else {
        payload.id = recordId;
        payload.version = 1;
        payload.created_by = context.userId;
        const result = await context.client.from(TABLE).insert(payload).select("*").single();
        if (result.error) throw result.error;
        saved = result.data;
      }
      databaseSaved = Boolean(saved);
      if (!contextStillMatches(context)) throw new Error("Sesi berubah setelah simpan. Pilih kembali workspace aktif sebelum melanjutkan.");
      state.activeId = saved.id;
      state.version = saved.version;
      state.referencePath = saved.reference_image_path;
      state.referenceFile = null;
      state.removeReference = false;
      state.referenceUrl = state.referencePath ? await cloud().signPath(state.referencePath).catch(() => "") : "";
      if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = null;
      updatePreview();
      try {
        await loadRecords();
        status(saved.spk_no + " berhasil disimpan di workspace. Anggota lain pada workspace yang sama dapat melihatnya.");
      } catch (refreshError) {
        status(saved.spk_no + " tersimpan, tetapi daftar arsip gagal dimuat ulang. Tekan Muat ulang arsip. " + errorMessage(refreshError), true);
      }
    } catch (error) {
      if (uploadedReferencePath && !databaseSaved && contextStillMatches(context)) {
        try { await context.client.storage.from(BUCKET).remove([uploadedReferencePath]); }
        catch (cleanupError) { console.warn("Could not clean up an unused accessory image", cleanupError); }
      }
      status(errorMessage(error), true);
    } finally {
      state.saving = false;
      setAccessoryBusy(false);
      setButtonBusy(button, false);
      setFormMode(Boolean(state.activeId));
    }
  }

  async function deleteRecord() {
    if (!state.activeId || state.saving || state.printing) return;
    if (!confirm("Arsip SPK Aksesoris ini akan disembunyikan dari daftar aktif. Lanjutkan?")) return;
    let context;
    try { context = getContext(); }
    catch (error) { status(errorMessage(error), true); return; }
    const button = $("#accessoryDeleteBtn");
    state.saving = true;
    setAccessoryBusy(true);
    setButtonBusy(button, true, "Mengarsipkan…");
    try {
      const now = new Date().toISOString();
      const result = await context.client.from(TABLE)
        .update({ deleted_at: now, updated_at: now, version: state.version + 1 })
        .eq("id", state.activeId).eq("workspace_id", context.workspaceId)
        .eq("version", state.version).is("deleted_at", null)
        .select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("SPK sudah berubah di sesi lain. Muat ulang arsip sebelum mengarsipkannya.");
      state.activeId = null;
      state.version = 0;
      await loadRecords();
      startNew(false);
      status("SPK Aksesoris diarsipkan. Data tidak dihapus permanen.");
    } catch (error) {
      status(errorMessage(error), true);
    } finally {
      state.saving = false;
      setAccessoryBusy(false);
      setButtonBusy(button, false);
    }
  }

  async function waitForImage(image, timeout = 15000) {
    if (!image || image.hidden || !image.getAttribute("src")) return true;
    const ready = () => image.complete && image.naturalWidth > 0;
    if (image.complete) return ready();
    return new Promise(resolve => {
      let timer;
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
        resolve(success && ready());
      };
      const onLoad = () => finish(true);
      const onError = () => finish(false);
      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);
      timer = setTimeout(() => finish(ready()), timeout);
    });
  }
  function getPrintTitle() {
    const parts = [value("#accSpkNo"), value("#accCustomer"), value("#accOrder")].filter(Boolean);
    return (parts.join(" - ").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)) || "SPK Aksesoris UNITEE";
  }
  async function printRecord(button = $("#accessoryPrintBtn")) {
    if (state.printing || state.saving || !validateDocumentForPrint()) return;
    state.printing = true;
    setAccessoryBusy(true);
    const originalTitle = document.title;
    const brandLogo = $("#accessoryPrintDocument .accessory-document-brand img");
    const originalLogoHidden = brandLogo?.hidden ?? false;
    setButtonBusy(button, true, "Menyiapkan cetak…");
    try {
      updatePreview();
      const referenceImage = $("#accPreviewImage");
      if (!await waitForImage(referenceImage)) {
        status("Cetak dibatalkan karena gambar referensi belum selesai dimuat.", true);
        return;
      }
      if (brandLogo && !await waitForImage(brandLogo, 6000)) brandLogo.hidden = true;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.title = getPrintTitle();
      status("Dokumen siap dicetak. Pilih “Simpan sebagai PDF” pada dialog cetak; isian ini tidak disimpan ke arsip.");
      window.print();
    } catch (error) {
      status("Dokumen tidak dapat disiapkan untuk dicetak. " + errorMessage(error), true);
    } finally {
      document.title = originalTitle;
      if (brandLogo) brandLogo.hidden = originalLogoHidden;
      state.printing = false;
      setAccessoryBusy(false);
      setButtonBusy(button, false);
    }
  }

  function setupImage() {
    $("#accReferenceInput").addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const allowed = ["image/jpeg","image/png","image/webp"];
      if (!allowed.includes(file.type) || file.size > 8 * 1024 * 1024) {
        status("Gambar referensi harus JPG, PNG, atau WEBP maksimal 8 MB.", true);
        event.target.value = "";
        return;
      }
      if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = null;
      state.referenceFile = file;
      state.removeReference = false;
      state.referenceUrl = "";
      updatePreview();
      status("Gambar referensi siap diunggah saat tombol Simpan ditekan.");
    });
    $("#accRemoveImageBtn").addEventListener("click", () => {
      state.referenceFile = null;
      state.referenceUrl = "";
      state.referencePath = null;
      state.removeReference = true;
      $("#accReferenceInput").value = "";
      if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = null;
      updatePreview();
    });
  }

  function bindForm() {
    $("#accessoryEditor").addEventListener("input", updatePreview);
    $("#accessoryEditor").addEventListener("change", updatePreview);
    $("#accessoryAddItemBtn").addEventListener("click", addItem);
    $("#accessoryNewBtn").addEventListener("click", () => startNew(true));
    $("#accessorySaveBtn").addEventListener("click", saveRecord);
    $("#accessoryDeleteBtn").addEventListener("click", deleteRecord);
    $("#accessoryPrintBtn").addEventListener("click", event => printRecord(event.currentTarget));
    $("#accessoryRefreshBtn").addEventListener("click", () => loadRecords().catch(error => status(errorMessage(error), true)));
    $("#spkPageTab").addEventListener("click", () => setPage("spk"));
    $("#accessoryPageTab").addEventListener("click", () => setPage("accessories"));
    setupImage();
  }

  bindForm();
  startNew(false);
  window.addEventListener("spkcloud:loaded", () => {
    if (isCloudReady()) loadRecords().catch(error => status(errorMessage(error), true));
    else {
      const hadCloudContext = Boolean(state.currentWorkspaceId || state.currentUserId);
      state.loadToken++;
      state.records = [];
      state.currentWorkspaceId = null;
      state.currentUserId = null;
      if (hadCloudContext) startNew(false);
      renderHistory();
      status("Login dan pilih workspace untuk melihat arsip bersama. Formulir tetap bisa langsung dicetak atau disimpan sebagai PDF.");
    }
  });
})();

