(() => {
  "use strict";

  const TABLE = "delivery_note_records";
  const $ = selector => document.querySelector(selector);
  const LOGOS = {
    venturo: "https://cdn.imagetourls.com/uploads/tyImg/85JRgOdI.png",
    unitee: "https://cdn.imagetourls.com/uploads/tyImg/Puo00N7a.png",
    forme: "https://cdn.imagetourls.com/uploads/tyImg/15137IkCT.png",
    rytmo: "https://cdn.imagetourls.com/uploads/tyImg/ANKg85ya.png"
  };
  const state = {
    records: [], activeId: null, version: 0,
    currentWorkspaceId: null, currentUserId: null,
    loadToken: 0, saving: false, printing: false
  };

  function cloud() { return window.SpkCloud; }
  function isCloudReady() { return Boolean(cloud()?.isActive?.()); }
  function getContext() {
    if (!isCloudReady()) throw new Error("Login dan pilih workspace terlebih dahulu untuk menyimpan Surat Jalan.");
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
  function localDateIso() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }
  function newNumber() {
    const date = localDateIso().replaceAll("-", "");
    const random = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 4).toUpperCase();
    return "SJ-" + date + "-" + random;
  }
  function status(message, error = false) {
    const node = $("#deliveryStatus");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("error-text", Boolean(error));
  }
  function text(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value == null || value === "" ? "—" : String(value);
  }
  function value(selector) { return String($(selector)?.value || "").trim(); }
  function formatDate(value) {
    if (!value) return "—";
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return String(value);
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(parts[0], parts[1] - 1, parts[2]));
  }
  function errorMessage(error) {
    const message = String(error?.message || error || "Operasi gagal.");
    if (/42501|permission denied|row-level security/i.test(message)) return "Akses ditolak. Pastikan akun menjadi anggota aktif workspace yang dipilih.";
    if (/duplicate key|unique constraint/i.test(message)) return "Nomor Surat Jalan sudah digunakan. Buat Surat Jalan baru agar nomornya berubah.";
    if (/JWT|token|session/i.test(message)) return "Sesi login berakhir. Login kembali untuk melanjutkan.";
    if (/Failed to fetch|network/i.test(message)) return "Koneksi cloud gagal. Periksa internet lalu coba muat ulang.";
    return message.slice(0, 240);
  }
  function setBusy(busy) {
    $("#deliveryPage").querySelectorAll("input, select, textarea, button").forEach(node => {
      if (busy) {
        node.dataset.deliveryWasDisabled = String(node.disabled);
        node.disabled = true;
      } else if (node.dataset.deliveryWasDisabled !== undefined) {
        node.disabled = node.dataset.deliveryWasDisabled === "true";
        delete node.dataset.deliveryWasDisabled;
      }
    });
  }
  function setPage() {
    document.body.classList.remove("accessory-mode");
    document.body.classList.add("delivery-mode");
    const accessoryPage = $("#accessoryPage");
    if (accessoryPage) accessoryPage.hidden = true;
    $("#deliveryPage").hidden = false;
    $("#spkPageTab").classList.remove("active");
    $("#accessoryPageTab").classList.remove("active");
    $("#deliveryPageTab").classList.add("active");
    $("#spkPageTab").setAttribute("aria-selected", "false");
    $("#accessoryPageTab").setAttribute("aria-selected", "false");
    $("#deliveryPageTab").setAttribute("aria-selected", "true");
    loadRecords().catch(error => status(errorMessage(error), true));
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }
  function renumberRows() {
    const rows = [...$("#deliveryItemRows").querySelectorAll(".delivery-item-row")];
    rows.forEach((row, index) => {
      row.querySelector(".delivery-row-index").textContent = String(index + 1);
      row.querySelectorAll("[data-item-field]").forEach(input => {
        input.setAttribute("aria-label", (input.dataset.itemField === "name" ? "Nama barang " : input.dataset.itemField === "quantity" ? "Jumlah barang " : "Keterangan barang ") + (index + 1));
      });
    });
    $("#deliveryItemCount").textContent = rows.length + " baris";
    $("#deliveryRemoveItemBtn").disabled = rows.length <= 1;
  }
  function addItemRow(item = {}) {
    const row = document.createElement("div");
    row.className = "delivery-item-row";
    const index = document.createElement("span");
    index.className = "delivery-row-index";
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 200;
    name.placeholder = "Nama barang";
    name.dataset.itemField = "name";
    name.value = item.name || "";
    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.min = "0";
    quantity.step = "1";
    quantity.inputMode = "numeric";
    quantity.placeholder = "0";
    quantity.dataset.itemField = "quantity";
    quantity.value = item.quantity == null ? "" : String(item.quantity);
    const note = document.createElement("input");
    note.type = "text";
    note.maxLength = 300;
    note.placeholder = "Keterangan";
    note.dataset.itemField = "note";
    note.value = item.note || "";
    row.append(index, name, quantity, note);
    $("#deliveryItemRows").append(row);
    renumberRows();
  }
  function getRawItems() {
    return [...$("#deliveryItemRows").querySelectorAll(".delivery-item-row")].map(row => {
      const read = key => String(row.querySelector('[data-item-field="' + key + '"]')?.value || "").trim();
      const rawQuantity = read("quantity");
      return {
        name: read("name"),
        quantity: rawQuantity === "" ? null : Number(rawQuantity),
        note: read("note")
      };
    });
  }
  function getNonEmptyItems() {
    return getRawItems().filter(item => item.name || item.quantity !== null || item.note);
  }
  function itemTotal(items) {
    return items.reduce((sum, item) => sum + (Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0), 0);
  }
  function renderItems() {
    const rows = getNonEmptyItems();
    const body = $("#delPreviewItems");
    body.replaceChildren();
    rows.forEach((item, index) => {
      const tr = document.createElement("tr");
      [String(index + 1), item.name || "—", item.quantity == null ? "" : new Intl.NumberFormat("id-ID").format(item.quantity), item.note || ""].forEach((content, cellIndex) => {
        const td = document.createElement("td");
        td.textContent = content;
        if (cellIndex === 0) td.className = "delivery-row-number";
        if (cellIndex === 2) td.className = "delivery-quantity";
        tr.append(td);
      });
      body.append(tr);
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "delivery-empty-row";
      td.textContent = "—";
      tr.append(td);
      body.append(tr);
    }
    const total = itemTotal(rows);
    text("#delPreviewTotal", new Intl.NumberFormat("id-ID").format(total));
    text("#deliveryEditorTotal", new Intl.NumberFormat("id-ID").format(total));
  }
  function updatePreview() {
    text("#delPreviewBusinessType", value("#delBusinessType"));
    text("#delPreviewBusinessAddress", value("#delBusinessAddress"));
    text("#delPreviewWhatsapp", value("#delBusinessWhatsapp"));
    text("#delPreviewCity", value("#delCity"));
    text("#delPreviewDate", value("#delDate") ? formatDate(value("#delDate")) : "");
    $("#delPreviewComma").hidden = !value("#delCity");
    text("#delPreviewRecipient", value("#delRecipient"));
    text("#delPreviewAddress1", value("#delAddress1"));
    text("#delPreviewAddress2", value("#delAddress2"));
    text("#delPreviewNumber", $("#deliveryNumber").textContent);
    text("#delPreviewReceivedBy", value("#delReceivedBy"));
    text("#delPreviewSenderName", value("#delSenderName"));
    const logoKey = value("#delLogoKey");
    const logo = $("#delPreviewLogo");
    if (logoKey && LOGOS[logoKey]) {
      logo.src = LOGOS[logoKey];
      logo.alt = "Logo " + logoKey;
      logo.hidden = false;
    } else {
      logo.removeAttribute("src");
      logo.hidden = true;
    }
    renderItems();
  }
  function setDocumentNumber(number) {
    $("#deliveryNumber").textContent = number || newNumber();
    updatePreview();
  }
  function startNew(showMessage = true) {
    state.activeId = null;
    state.version = 0;
    $("#delBusinessType").value = "Jersey Lari & Apparel Olahraga";
    $("#delBusinessAddress").value = "Jl. Watubelang 01, Noborejo, Salatiga.";
    $("#delBusinessWhatsapp").value = "085168185318";
    $("#delLogoKey").value = "rytmo";
    $("#delCity").value = "";
    $("#delDate").value = localDateIso();
    $("#delRecipient").value = "";
    $("#delAddress1").value = "";
    $("#delAddress2").value = "";
    $("#delReceivedBy").value = "";
    $("#delSenderName").value = "";
    $("#deliveryItemRows").replaceChildren();
    for (let i = 0; i < 8; i++) addItemRow();
    setDocumentNumber(newNumber());
    $("#deliverySaveBtn").textContent = "Simpan Surat Jalan";
    updatePreview();
    if (showMessage) status("Form Surat Jalan baru siap. Cetak/PDF tidak harus disimpan ke arsip.");
  }
  function validateItems() {
    const raw = getRawItems();
    const rows = raw.filter(item => item.name || item.quantity !== null || item.note);
    if (!rows.length) throw new Error("Isi minimal satu nama barang.");
    if (rows.length > 50) throw new Error("Maksimal 50 baris barang dalam satu Surat Jalan.");
    for (const item of rows) {
      if (!item.name) throw new Error("Setiap baris yang dipakai harus memiliki nama barang.");
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error("Jumlah setiap barang harus berupa angka bulat minimal 1.");
    }
    return rows;
  }
  function validateForSave() {
    if (!value("#delRecipient")) throw new Error("Nama penerima / perusahaan wajib diisi.");
    const items = validateItems();
    const total = itemTotal(items);
    if (!Number.isSafeInteger(total) || total > 2147483647) throw new Error("Total jumlah barang terlalu besar.");
    return { items, total };
  }
  function validateForPrint() {
    if (!value("#delRecipient")) {
      status("Isi nama penerima / perusahaan sebelum mencetak.", true);
      $("#delRecipient").focus();
      return false;
    }
    try { validateItems(); }
    catch (error) { status(errorMessage(error), true); return false; }
    return true;
  }
  function recordPayload(context, items, total) {
    return {
      workspace_id: context.workspaceId,
      delivery_no: $("#deliveryNumber").textContent.trim(),
      business_type: value("#delBusinessType"),
      business_address: value("#delBusinessAddress"),
      business_whatsapp: value("#delBusinessWhatsapp"),
      logo_key: value("#delLogoKey"),
      city: value("#delCity"),
      delivery_date: value("#delDate") || null,
      recipient_name: value("#delRecipient"),
      recipient_address_1: value("#delAddress1"),
      recipient_address_2: value("#delAddress2"),
      items,
      total_quantity: total,
      received_by: value("#delReceivedBy"),
      sender_name: value("#delSenderName"),
      updated_at: new Date().toISOString()
    };
  }
  async function loadRecords() {
    let context;
    try { context = getContext(); }
    catch (error) {
      state.records = [];
      state.currentWorkspaceId = null;
      state.currentUserId = null;
      renderHistory();
      status("Login dan pilih workspace untuk menyimpan serta membuka arsip Surat Jalan. Cetak/PDF tetap bisa digunakan.", true);
      return;
    }
    const token = ++state.loadToken;
    const result = await context.client.from(TABLE)
      .select("id,delivery_no,version,recipient_name,city,delivery_date,total_quantity,updated_at")
      .eq("workspace_id", context.workspaceId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    if (!contextStillMatches(context) || token !== state.loadToken) return;
    state.records = result.data || [];
    state.currentWorkspaceId = context.workspaceId;
    state.currentUserId = context.userId;
    renderHistory();
    status("Arsip Surat Jalan workspace berhasil dimuat.");
  }
  function renderHistory() {
    const target = $("#deliveryHistory");
    target.replaceChildren();
    $("#deliveryHistoryCount").textContent = state.records.length + " dokumen";
    if (!state.records.length) {
      const empty = document.createElement("div");
      empty.className = "delivery-empty-state";
      empty.textContent = "Belum ada Surat Jalan tersimpan di workspace ini.";
      target.append(empty);
      return;
    }
    state.records.forEach(record => {
      const row = document.createElement("div");
      row.className = "delivery-history-row";
      const info = document.createElement("div");
      info.className = "delivery-history-info";
      const title = document.createElement("strong");
      title.textContent = record.delivery_no || "Surat Jalan";
      const meta = document.createElement("span");
      meta.textContent = [record.recipient_name, record.city, record.delivery_date ? formatDate(record.delivery_date) : ""].filter(Boolean).join(" · ");
      const actions = document.createElement("div");
      actions.className = "delivery-history-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "delivery-history-open";
      open.textContent = "Buka";
      open.addEventListener("click", () => openRecord(record.id));
      const archive = document.createElement("button");
      archive.type = "button";
      archive.className = "delivery-history-archive";
      archive.textContent = "Arsipkan";
      archive.addEventListener("click", () => archiveRecord(record));
      info.append(title, meta);
      actions.append(open, archive);
      row.append(info, actions);
      target.append(row);
    });
  }
  async function openRecord(id) {
    if (state.saving || state.printing) return;
    let context;
    try { context = getContext(); }
    catch (error) { status(errorMessage(error), true); return; }
    status("Membuka Surat Jalan…");
    const result = await context.client.from(TABLE).select("*")
      .eq("id", id).eq("workspace_id", context.workspaceId).is("deleted_at", null).maybeSingle();
    if (result.error) { status(errorMessage(result.error), true); return; }
    if (!result.data) { status("Surat Jalan tidak ditemukan atau sudah diarsipkan.", true); await loadRecords(); return; }
    if (!contextStillMatches(context)) { status("Workspace berubah. Pilih kembali workspace sebelum membuka dokumen.", true); return; }
    const record = result.data;
    state.activeId = record.id;
    state.version = record.version;
    $("#delBusinessType").value = record.business_type || "";
    $("#delBusinessAddress").value = record.business_address || "";
    $("#delBusinessWhatsapp").value = record.business_whatsapp || "";
    $("#delLogoKey").value = record.logo_key || "";
    $("#delCity").value = record.city || "";
    $("#delDate").value = record.delivery_date || "";
    $("#delRecipient").value = record.recipient_name || "";
    $("#delAddress1").value = record.recipient_address_1 || "";
    $("#delAddress2").value = record.recipient_address_2 || "";
    $("#delReceivedBy").value = record.received_by || "";
    $("#delSenderName").value = record.sender_name || "";
    $("#deliveryItemRows").replaceChildren();
    (Array.isArray(record.items) && record.items.length ? record.items : [{}]).forEach(item => addItemRow(item));
    setDocumentNumber(record.delivery_no);
    $("#deliverySaveBtn").textContent = "Perbarui Surat Jalan";
    updatePreview();
    status(record.delivery_no + " dibuka. Perubahan baru masuk ke arsip setelah tombol Perbarui Surat Jalan ditekan.");
    $("#deliveryPage").scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
  async function saveRecord() {
    if (state.saving || state.printing) return;
    let checked;
    let context;
    try {
      checked = validateForSave();
      context = getContext();
    } catch (error) { status(errorMessage(error), true); return; }
    const button = $("#deliverySaveBtn");
    const previousActiveId = state.activeId;
    const previousVersion = state.version;
    state.saving = true;
    setBusy(true);
    button.textContent = previousActiveId ? "Memperbarui…" : "Menyimpan…";
    try {
      if (!contextStillMatches(context)) throw new Error("Akun atau workspace berubah. Pilih kembali workspace sebelum menyimpan.");
      const payload = recordPayload(context, checked.items, checked.total);
      let result;
      if (previousActiveId) {
        payload.version = previousVersion + 1;
        result = await context.client.from(TABLE).update(payload)
          .eq("id", previousActiveId).eq("workspace_id", context.workspaceId)
          .eq("version", previousVersion).is("deleted_at", null)
          .select("*").maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("Surat Jalan telah diubah oleh pengguna lain. Muat ulang arsip lalu buka versi terbaru.");
      } else {
        payload.version = 1;
        payload.created_by = context.userId;
        result = await context.client.from(TABLE).insert(payload).select("*").single();
        if (result.error) throw result.error;
      }
      if (!contextStillMatches(context)) throw new Error("Sesi berubah setelah penyimpanan. Periksa workspace aktif sebelum melanjutkan.");
      state.activeId = result.data.id;
      state.version = result.data.version;
      setDocumentNumber(result.data.delivery_no);
      $("#deliverySaveBtn").textContent = "Perbarui Surat Jalan";
      try {
        await loadRecords();
        status(result.data.delivery_no + " berhasil disimpan di arsip workspace.");
      } catch (refreshError) {
        status(result.data.delivery_no + " tersimpan, tetapi daftar arsip gagal dimuat ulang. " + errorMessage(refreshError), true);
      }
    } catch (error) {
      status(errorMessage(error), true);
    } finally {
      state.saving = false;
      setBusy(false);
      $("#deliverySaveBtn").textContent = state.activeId ? "Perbarui Surat Jalan" : "Simpan Surat Jalan";
    }
  }
  async function archiveRecord(record) {
    if (state.saving || state.printing) return;
    if (!confirm("Arsipkan Surat Jalan " + record.delivery_no + "? Dokumen disembunyikan dari daftar aktif, bukan dihapus permanen.")) return;
    let context;
    try { context = getContext(); }
    catch (error) { status(errorMessage(error), true); return; }
    state.saving = true;
    setBusy(true);
    try {
      const result = await context.client.from(TABLE)
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: record.version + 1 })
        .eq("id", record.id).eq("workspace_id", context.workspaceId)
        .eq("version", record.version).is("deleted_at", null)
        .select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Surat Jalan berubah di sesi lain. Muat ulang arsip terlebih dahulu.");
      if (state.activeId === record.id) startNew(false);
      await loadRecords();
      status(record.delivery_no + " berhasil diarsipkan.");
    } catch (error) {
      status(errorMessage(error), true);
    } finally {
      state.saving = false;
      setBusy(false);
    }
  }
  function waitForImage(image, timeout = 10000) {
    if (!image || image.hidden || !image.getAttribute("src")) return Promise.resolve(true);
    const ready = () => image.complete && image.naturalWidth > 0;
    if (image.complete) return Promise.resolve(ready());
    return new Promise(resolve => {
      let timer;
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
        resolve(Boolean(success && ready()));
      };
      const onLoad = () => finish(true);
      const onError = () => finish(false);
      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);
      timer = setTimeout(() => finish(ready()), timeout);
    });
  }
  async function printDocument() {
    if (state.printing || state.saving || !validateForPrint()) return;
    state.printing = true;
    setBusy(true);
    const originalTitle = document.title;
    const logo = $("#delPreviewLogo");
    const wasLogoHidden = logo.hidden;
    try {
      updatePreview();
      if (!await waitForImage(logo)) {
        status("Logo belum selesai dimuat. Periksa koneksi atau pilih logo lain, lalu coba cetak kembali.", true);
        return;
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.title = ($("#deliveryNumber").textContent + " Surat Jalan").replace(/[\\/:*?"<>|]/g, " ");
      status("Dokumen siap dicetak. Pilih “Simpan sebagai PDF” pada dialog cetak. Isian tidak otomatis masuk ke arsip.");
      window.print();
    } catch (error) {
      status("Surat Jalan tidak dapat disiapkan untuk dicetak. " + errorMessage(error), true);
    } finally {
      document.title = originalTitle;
      if (logo) logo.hidden = wasLogoHidden;
      state.printing = false;
      setBusy(false);
    }
  }
  function bind() {
    $("#deliveryPageTab").addEventListener("click", setPage);
    $("#pageNav").addEventListener("click", event => {
      if (event.target.closest("#deliveryPageTab")) return;
      document.body.classList.remove("delivery-mode");
      $("#deliveryPage").hidden = true;
      $("#deliveryPageTab").classList.remove("active");
      $("#deliveryPageTab").setAttribute("aria-selected", "false");
    });
    $("#deliveryEditor").addEventListener("input", updatePreview);
    $("#deliveryEditor").addEventListener("change", updatePreview);
    $("#deliveryAddItemBtn").addEventListener("click", () => {
      if ($("#deliveryItemRows").children.length >= 50) { status("Maksimal 50 baris barang.", true); return; }
      addItemRow();
      updatePreview();
    });
    $("#deliveryRemoveItemBtn").addEventListener("click", () => {
      const rows = $("#deliveryItemRows");
      if (rows.children.length > 1) rows.lastElementChild.remove();
      renumberRows();
      updatePreview();
    });
    $("#deliveryNewBtn").addEventListener("click", () => startNew(true));
    $("#deliverySaveBtn").addEventListener("click", saveRecord);
    $("#deliveryPrintBtn").addEventListener("click", printDocument);
    $("#deliveryRefreshBtn").addEventListener("click", () => loadRecords().catch(error => status(errorMessage(error), true)));
  }

  bind();
  startNew(false);
  window.addEventListener("spkcloud:loaded", () => {
    if (isCloudReady()) loadRecords().catch(error => status(errorMessage(error), true));
    else {
      state.loadToken++;
      state.records = [];
      state.currentWorkspaceId = null;
      state.currentUserId = null;
      renderHistory();
      if (state.activeId) startNew(false);
      status("Login dan pilih workspace untuk menyimpan serta membuka arsip Surat Jalan. Cetak/PDF tetap tersedia.", true);
    }
  });
})();