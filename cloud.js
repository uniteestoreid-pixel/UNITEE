/* Supabase client adapter. The anon key is public by design; RLS protects every data operation. */
(() => {
  "use strict";
  const STORAGE_KEY = "spk_generator_data_v3";
  const LOGO_KEY = "spk_generator_logos_v1";
  const MIGRATION_RECORDS_KEY = "spk_generator_precloud_records_v1";
  const MIGRATION_LOGOS_KEY = "spk_generator_precloud_logos_v1";
  const CACHE_SOURCE_KEY = "spk_generator_cache_source_v1";
  const ACTIVE_WORKSPACE_KEY = "spk_generator_active_workspace_v1:";
  const BUCKET = "spk-files";
  let client = null;
  let session = null;
  let workspaceId = null;
  let workspaceName = "";
  let currentRole = "member";
  let memberships = [];
  let initialized = false;
  let switchingWorkspace = false;
  let recoveryMode = false;
  let accountPanelOpen = true;
  let sessionEpoch = 0;
  let workspaceLoadGeneration = 0;
  let activationGeneration = 0;
  let activeUserId = null;
  let signedUrlFailures = 0;

  const $ = selector => document.querySelector(selector);
  const configured = () => Boolean(String(window.SPK_CONFIG?.supabaseUrl || "").trim() && String(window.SPK_CONFIG?.supabaseAnonKey || "").trim());
  const isActive = () => Boolean(client && session && workspaceId);
  const isAdmin = () => currentRole === "admin";
  function captureWorkspaceContext(expected = {}) {
    const context = { workspaceId, userId: session?.user?.id || null, epoch: sessionEpoch, client };
    if (!isActive() || (expected.workspaceId && expected.workspaceId !== context.workspaceId) || (expected.userId && expected.userId !== context.userId)) {
      throw new Error("Workspace atau akun berubah. Muat ulang SPK sebelum menyimpan.");
    }
    return context;
  }
  function assertWorkspaceContext(context) {
    if (!isActive() || context.epoch !== sessionEpoch || context.workspaceId !== workspaceId || context.userId !== session?.user?.id || context.client !== client) {
      throw new Error("Akun atau workspace berubah saat penyimpanan berlangsung. Buka kembali SPK sebelum mencoba lagi.");
    }
  }
  const safeJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
  const emit = (type, detail = {}) => window.dispatchEvent(new CustomEvent(`spkcloud:${type}`, { detail }));

  function status(message, error = false) {
    const element = $("#cloudStatus");
    if (element) {
      element.textContent = message;
      element.classList.toggle("error-text", Boolean(error));
    }
    const notice = $("#modeNotice");
    if (notice) {
      notice.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = isActive() ? "Mode cloud: " : (configured() ? "Mode cloud belum aktif: " : "Mode lokal: ");
      notice.append(strong, document.createTextNode(message));
    }
  }

  function showAccountUI() {
    const loggedIn = Boolean(session);
    const cloudActive = isActive();
    $("#authForm")?.classList.toggle("hidden", loggedIn);
    $("#accountControls")?.classList.toggle("hidden", !loggedIn);
    $("#workspaceSetup")?.classList.toggle("hidden", !loggedIn || memberships.length > 0);
    $("#workspaceControls")?.classList.toggle("hidden", !loggedIn || memberships.length === 0);
    $("#cloudPanel")?.classList.toggle("hidden", cloudActive && !accountPanelOpen);
    const accountMenu = $("#accountMenuBtn");
    if (accountMenu) {
      accountMenu.classList.toggle("hidden", !cloudActive);
      accountMenu.textContent = workspaceName ? `${workspaceName} · ${currentRole}` : "Workspace";
      accountMenu.setAttribute("aria-expanded", String(cloudActive && accountPanelOpen));
    }
    $("#signedInEmail") && ( $("#signedInEmail").textContent = session?.user?.email || "" );
    $("#signedInId") && ( $("#signedInId").textContent = session?.user?.id || "" );
    $("#copyUserIdBtn") && ( $("#copyUserIdBtn").disabled = !session?.user?.id );
    $("#recoveryPanel")?.classList.toggle("hidden", !recoveryMode);
    document.body.classList.toggle("cloud-configured", configured());
    document.body.classList.toggle("cloud-active", isActive());
    updateRoleControls();
  }

  function updateRoleControls() {
    const admin = isActive() && isAdmin();
    $("#memberAdminPanel")?.classList.toggle("hidden", !admin);
    const addLogo = $("#addLogoBtn");
    if (addLogo && isActive()) addLogo.disabled = !admin || Number.parseInt($("#logoCount")?.textContent || "0", 10) >= 4;
  }

  function captureLocalSnapshot() {
    // Cloud cache is never treated as a local archive or copied into another user's migration backup.
    if (localStorage.getItem(CACHE_SOURCE_KEY) === "cloud") return;
    const recordsKeyExists = localStorage.getItem(MIGRATION_RECORDS_KEY) !== null;
    const logosKeyExists = localStorage.getItem(MIGRATION_LOGOS_KEY) !== null;
    if (recordsKeyExists && logosKeyExists) return;
    const records = safeJson(STORAGE_KEY, []);
    const logos = safeJson(LOGO_KEY, []);
    try {
      if (!recordsKeyExists) localStorage.setItem(MIGRATION_RECORDS_KEY, JSON.stringify(records));
      if (!logosKeyExists) localStorage.setItem(MIGRATION_LOGOS_KEY, JSON.stringify(logos));
    } catch (error) {
      throw new Error("Data lokal belum bisa dicadangkan di browser (ruang penyimpanan mungkin penuh). Klik Backup JSON, simpan filenya, lalu coba login lagi.");
    }
  }

  function setActiveCache(records, logos, source) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    localStorage.setItem(LOGO_KEY, JSON.stringify(logos));
    localStorage.setItem(CACHE_SOURCE_KEY, source);
    emit("loaded", { workspaceId, workspaceName, count: records.length, logos: logos.length });
  }

  function clearActiveCache(source = "cloud") {
    setActiveCache([], [], source);
    window.SpkApp?.refreshUI?.();
  }

  function restoreLocalSnapshot() {
    const hasLocalBackup = localStorage.getItem(MIGRATION_RECORDS_KEY) !== null || localStorage.getItem(MIGRATION_LOGOS_KEY) !== null;
    const wasCloudCache = localStorage.getItem(CACHE_SOURCE_KEY) === "cloud";
    const records = hasLocalBackup ? safeJson(MIGRATION_RECORDS_KEY, []) : (wasCloudCache ? [] : safeJson(STORAGE_KEY, []));
    const logos = hasLocalBackup ? safeJson(MIGRATION_LOGOS_KEY, []) : (wasCloudCache ? [] : safeJson(LOGO_KEY, []));
    setActiveCache(records, logos, "local");
  }

  const workspacePreferenceKey = userId => `${ACTIVE_WORKSPACE_KEY}${userId}`;

  function dataUrlBlob(dataUrl) {
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(dataUrl)) throw new Error("Format gambar tidak didukung untuk unggah.");
    return fetch(dataUrl).then(response => response.blob());
  }

  function extensionFor(mime) {
    return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" })[mime] || "bin";
  }

  async function uploadDataUrl(dataUrl, pathPrefix, targetWorkspaceId = workspaceId) {
    const blob = await dataUrlBlob(dataUrl);
    if (blob.size > 15 * 1024 * 1024) throw new Error("Gambar melebihi batas 15 MB.");
    const path = `${targetWorkspaceId}/${pathPrefix}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
    const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: "3600" });
    if (error) throw error;
    return { path, blob };
  }

  async function signPath(path) {
    if (!path) return "";
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  async function saveLogo(logo) {
    if (!isActive()) return { ...logo };
    if (!isAdmin()) throw new Error("Hanya admin workspace yang dapat mengelola logo bersama.");
    const context = captureWorkspaceContext();
    let path = logo.storagePath || null;
    let version = Number(logo.version) || 1;
    let blob = null;
    if (typeof logo.dataUrl === "string" && logo.dataUrl.startsWith("data:image/")) {
      const uploaded = await uploadDataUrl(logo.dataUrl, `logos/${logo.id}`, context.workspaceId);
      assertWorkspaceContext(context);
      path = uploaded.path;
      blob = uploaded.blob;
      version += 1;
    }
    const idMatch = String(logo.id).match(/(?:logo-)?([1-4])$/i);
    const slot = Number(logo.slot) || Number(idMatch?.[1]) || 1;
    const row = {
      id: String(logo.id), workspace_id: context.workspaceId, slot, label: String(logo.label || `Logo ${slot}`).slice(0, 40),
      storage_path: path, version, is_active: true, created_by: session.user.id, updated_at: new Date().toISOString()
    };
    assertWorkspaceContext(context);
    const { error } = await context.client.from("company_logos").upsert(row, { onConflict: "workspace_id,id" });
    if (error) throw error;
    return { ...logo, storagePath: path, version, slot, dataUrl: path ? await signPath(path) : "", active: true, fileSize: blob?.size || logo.fileSize || null };
  }

  async function deleteLogo(id) {
    if (!isActive() || !isAdmin()) throw new Error("Hanya admin workspace yang dapat menghapus logo bersama.");
    const { error } = await client.from("company_logos").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (error) throw error;
  }

  function mapSizeRows(sizeRows, recordId) {
    return sizeRows.filter(row => row.spk_id === recordId).map(row => ({ category: row.category, size: row.size_label, value: String(row.quantity) }));
  }

  function approvalName(approvalRows, recordId, type) {
    return approvalRows.find(row => row.spk_id === recordId && row.approval_type === type)?.approver_name || "";
  }

  async function loadWorkspaceData() {
    if (!isActive()) return;
    const loadWorkspaceId = workspaceId;
    const loadUserId = session.user.id;
    const loadEpoch = sessionEpoch;
    const loadGeneration = ++workspaceLoadGeneration;
    const isCurrentLoad = () => isActive() && workspaceId === loadWorkspaceId && session?.user?.id === loadUserId && sessionEpoch === loadEpoch && workspaceLoadGeneration === loadGeneration;
    signedUrlFailures = 0;
    status(`Memuat arsip workspace “${workspaceName}”…`);
    const rawRecords = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("spk_records").select("*").eq("workspace_id", loadWorkspaceId).is("deleted_at", null).order("updated_at", { ascending: false }).range(offset, offset + 499);
      if (error) throw error;
      if (!isCurrentLoad()) return;
      rawRecords.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    const recordIds = rawRecords.map(row => row.id);
    let sizeRows = [], approvalRows = [], designRows = [];
    for (let offset = 0; offset < recordIds.length; offset += 100) {
      const batch = recordIds.slice(offset, offset + 100);
      const [sizeResult, approvalResult, designResult] = await Promise.all([
        client.from("spk_sizes").select("spk_id,category,size_label,quantity").in("spk_id", batch),
        client.from("spk_approvals").select("spk_id,approval_type,approver_name").in("spk_id", batch),
        client.from("spk_design_files").select("spk_id,file_size,mime_type,file_name,storage_path").in("spk_id", batch)
      ]);
      if (sizeResult.error) throw sizeResult.error;
      if (approvalResult.error) throw approvalResult.error;
      if (designResult.error) throw designResult.error;
      if (!isCurrentLoad()) return;
      sizeRows.push(...(sizeResult.data || [])); approvalRows.push(...(approvalResult.data || [])); designRows.push(...(designResult.data || []));
    }
    const mappedRecords = await Promise.all((rawRecords || []).map(async row => {
      const [designImage, logoDataUrl] = await Promise.all([
        row.design_storage_path ? signPath(row.design_storage_path).catch(() => { signedUrlFailures++; return ""; }) : "",
        row.selected_logo_storage_path ? signPath(row.selected_logo_storage_path).catch(() => { signedUrlFailures++; return ""; }) : ""
      ]);
      return {
        id: row.id, spkNo: row.spk_no, createdAt: Date.parse(row.created_at), updatedAt: row.updated_at,
        version: row.version, customer: row.customer, order: row.order_name, orderDate: row.order_date || "", deadline: row.deadline || "",
        modelKerah: row.model_kerah, material: row.material, colour: row.colour, quantity: String(row.quantity), notes: row.notes,
        apDesigner: approvalName(approvalRows, row.id, "designer") || row.ap_designer,
        apCs: approvalName(approvalRows, row.id, "cs") || row.ap_cs,
        apCustomer: approvalName(approvalRows, row.id, "customer") || row.ap_customer,
        apProduction: approvalName(approvalRows, row.id, "production") || row.ap_production,
        sizes: mapSizeRows(sizeRows, row.id), designImage, designStoragePath: row.design_storage_path || null,
        designFileSize: Number(designRows.find(item => item.spk_id === row.id)?.file_size) || 0,
        designMimeType: designRows.find(item => item.spk_id === row.id)?.mime_type || "image/jpeg",
        selectedLogoId: row.selected_logo_id || null,
        selectedLogoSnapshot: row.selected_logo_id || row.selected_logo_storage_path ? {
          id: row.selected_logo_id || null, label: row.selected_logo_label || "Logo", dataUrl: logoDataUrl,
          storagePath: row.selected_logo_storage_path || null
        } : null, savedAt: row.updated_at
      };
    }));

    if (!isCurrentLoad()) return;
    const { data: logoRows, error: logoError } = await client.from("company_logos").select("id,workspace_id,slot,label,storage_path,version,is_active").eq("workspace_id", loadWorkspaceId).eq("is_active", true).order("slot");
    if (logoError) throw logoError;
    const mappedLogos = await Promise.all((logoRows || []).map(async row => ({
      id: row.id, label: row.label, dataUrl: row.storage_path ? await signPath(row.storage_path).catch(() => { signedUrlFailures++; return ""; }) : "",
      storagePath: row.storage_path, version: row.version, slot: row.slot, active: row.is_active
    })));

    // Cloud data replaces the active browser cache only after all server reads succeed and the account/workspace is still current.
    if (!isCurrentLoad()) return;
    setActiveCache(mappedRecords, mappedLogos, "cloud");
    status(signedUrlFailures
      ? `${mappedRecords.length} SPK dimuat dari “${workspaceName}”; ${signedUrlFailures} gambar belum bisa dibuka. Muat ulang arsip untuk mencoba lagi.`
      : `${mappedRecords.length} SPK dimuat dari “${workspaceName}”.`);
    $("#migrateLocalBtn")?.classList.toggle("hidden", safeJson(MIGRATION_RECORDS_KEY, []).length === 0);
    updateRoleControls();
  }

  async function nextSpkNumber() {
    if (!isActive()) throw new Error("Workspace cloud belum aktif.");
    const { data, error } = await client.rpc("next_spk_number", { p_workspace_id: workspaceId });
    if (error) throw error;
    return data;
  }

  async function saveRecord(data, expectedContext = {}) {
    if (!isActive()) throw new Error("Login dan pilih workspace sebelum menyimpan ke server.");
    const context = captureWorkspaceContext(expectedContext);
    const recordId = data.id || `spk-${crypto.randomUUID()}`;
    let designPath = data.designStoragePath || null;
    let designBlob = null;
    if (typeof data.designImage === "string" && data.designImage.startsWith("data:image/")) {
      const uploaded = await uploadDataUrl(data.designImage, `spk/${recordId}`, context.workspaceId);
      assertWorkspaceContext(context);
      designPath = uploaded.path;
      designBlob = uploaded.blob;
    } else if (!data.designImage && !data.designStoragePath) {
      designPath = null;
    }

    let logoSnapshot = data.selectedLogoSnapshot ? { ...data.selectedLogoSnapshot } : null;
    if (logoSnapshot && typeof logoSnapshot.dataUrl === "string" && logoSnapshot.dataUrl.startsWith("data:image/")) {
      const uploaded = await uploadDataUrl(logoSnapshot.dataUrl, `spk/${recordId}/logo-snapshot`, context.workspaceId);
      assertWorkspaceContext(context);
      logoSnapshot.storagePath = uploaded.path;
    }
    const sizes = (data.sizes || []).map(item => ({ category: String(item.category || "dewasa-pendek"), size: String(item.size || ""), quantity: Math.max(0, Number.parseInt(item.value ?? item.quantity ?? 0, 10) || 0) }));
    const approvals = [
      { type: "designer", name: data.apDesigner || "" }, { type: "cs", name: data.apCs || "" },
      { type: "customer", name: data.apCustomer || "" }, { type: "production", name: data.apProduction || "" }
    ];
    const payload = {
      id: recordId, workspace_id: context.workspaceId, spk_no: data.spkNo || await nextSpkNumber(), base_version: Number(data.version) || 0,
      customer: String(data.customer || "").trim(), order_name: String(data.order || "").trim(), order_date: data.orderDate || null,
      deadline: data.deadline || null, model_kerah: data.modelKerah || "", material: data.material || "", colour: data.colour || "",
      quantity: sizes.reduce((sum, item) => sum + item.quantity, 0), notes: data.notes || "",
      ap_designer: data.apDesigner || "", ap_cs: data.apCs || "", ap_customer: data.apCustomer || "", ap_production: data.apProduction || "",
      selected_logo_id: logoSnapshot?.id || data.selectedLogoId || null, selected_logo_label: logoSnapshot?.label || "",
      selected_logo_storage_path: logoSnapshot?.storagePath || null, design_storage_path: designPath,
      design_file_name: "design", design_mime_type: designBlob?.type || data.designMimeType || "image/jpeg", design_file_size: designBlob?.size || Number(data.designFileSize) || 1,
      sizes, approvals
    };
    assertWorkspaceContext(context);
    const { data: serverRow, error } = await context.client.rpc("save_spk", { p_payload: payload });
    if (error) throw error;
    assertWorkspaceContext(context);
    let designUrl = "";
    if (designPath) { try { designUrl = await signPath(designPath); } catch { designUrl = typeof data.designImage === "string" && data.designImage.startsWith("data:image/") ? data.designImage : ""; } }
    if (logoSnapshot?.storagePath) { try { logoSnapshot.dataUrl = await signPath(logoSnapshot.storagePath); } catch { /* Server save succeeded; keep the metadata and let reload retry the signed URL. */ } }
    const createdAt = Date.parse(serverRow.created_at) || data.createdAt || Date.now();
    return {
      ...data, id: serverRow.id, spkNo: serverRow.spk_no, createdAt, updatedAt: serverRow.updated_at,
      version: serverRow.version, quantity: String(serverRow.quantity), sizes: sizes.map(item => ({ category: item.category, size: item.size, value: String(item.quantity) })),
      designImage: designUrl, designStoragePath: designPath, designFileSize: designBlob?.size || Number(data.designFileSize) || 0,
      designMimeType: designBlob?.type || data.designMimeType || "image/jpeg", selectedLogoSnapshot: logoSnapshot,
      selectedLogoId: payload.selected_logo_id, savedAt: serverRow.updated_at
    };
  }

  async function deleteRecord(id) {
    if (!isActive()) throw new Error("Tidak ada workspace cloud aktif.");
    const context = captureWorkspaceContext();
    const { error } = await context.client.rpc("delete_spk", { p_id: String(id) });
    if (error) throw error;
    assertWorkspaceContext(context);
  }

  async function refreshMembers() {
    const container = $("#memberList");
    if (!container || !isActive() || !isAdmin()) return;
    const { data, error } = await client.from("workspace_members").select("user_id,role,status,created_at").eq("workspace_id", workspaceId).order("created_at");
    if (error) throw error;
    container.replaceChildren();
    (data || []).forEach(member => {
      const row = document.createElement("div"); row.className = "member-row";
      const details = document.createElement("div");
      const id = document.createElement("code"); id.textContent = member.user_id;
      const role = document.createElement("span"); role.textContent = `${member.role} · ${member.status}`;
      details.append(id, role);
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn small danger-action"; remove.textContent = "Keluarkan";
      remove.disabled = member.user_id === session.user.id && (data || []).filter(m => m.role === "admin" && m.status === "active").length < 2;
      remove.addEventListener("click", async () => {
        if (!confirm("Keluarkan anggota ini dari workspace? Aksesnya akan dihentikan.")) return;
        try { const context = captureWorkspaceContext(); const result = await context.client.rpc("remove_workspace_member", { p_workspace_id: context.workspaceId, p_user_id: member.user_id }); if (result.error) throw result.error; assertWorkspaceContext(context); await refreshMembers(); status("Daftar anggota diperbarui."); }
        catch (e) { status(errorMessage(e), true); }
      });
      row.append(details, remove); container.append(row);
    });
  }

  function errorMessage(error) {
    const raw = String(error?.message || error || "Operasi gagal.");
    if (/SPK_CONFLICT|40001/i.test(raw)) return "Konflik edit: SPK ini berubah di sesi lain. Muat ulang arsip sebelum menyimpan lagi.";
    if (/duplicate key|unique constraint/i.test(raw)) return "Nomor SPK atau identitas data sudah digunakan. Buat nomor SPK baru lalu coba lagi.";
    if (/JWT|token|session/i.test(raw)) return "Sesi login berakhir. Login kembali untuk melanjutkan.";
    return raw.slice(0, 240);
  }

  async function activateWorkspace(id) {
    const activation = ++activationGeneration;
    const activationEpoch = sessionEpoch;
    switchingWorkspace = true;
    try {
      captureLocalSnapshot();
      const membership = memberships.find(item => item.workspace_id === id);
      if (!membership) throw new Error("Workspace tidak ada dalam daftar keanggotaan akun ini.");
      const sameWorkspace = workspaceId === membership.workspace_id && session?.user?.id === activeUserId;
      workspaceId = membership.workspace_id;
      currentRole = membership.role;
      workspaceName = membership.workspaces?.name || "Workspace";
      localStorage.setItem(workspacePreferenceKey(session.user.id), workspaceId);
      document.body.classList.add("cloud-configured", "cloud-active");
      showAccountUI();
      $("#activeWorkspaceName") && ( $("#activeWorkspaceName").textContent = `${workspaceName} · ${currentRole}` );
      if (!sameWorkspace) clearActiveCache("cloud");
      await loadWorkspaceData();
      if (activation !== activationGeneration || activationEpoch !== sessionEpoch || !isActive()) return;
      if (isAdmin()) await refreshMembers();
      if (!sameWorkspace && window.SpkApp?.startNew) {
        window.SpkApp.startNew(false, { preserveDraft: true });
        await window.SpkApp.restoreDraft?.();
      }
      accountPanelOpen = false;
      showAccountUI();
    } catch (error) {
      if (activation === activationGeneration && activationEpoch === sessionEpoch) {
        workspaceId = null;
        document.body.classList.remove("cloud-active");
        clearActiveCache("cloud");
        status(errorMessage(error), true);
      }
    } finally {
      if (activation === activationGeneration) { switchingWorkspace = false; showAccountUI(); }
    }
  }

  async function loadMemberships(options = {}) {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    const requestEpoch = sessionEpoch;
    const { data, error } = await client.from("workspace_members").select("workspace_id,role,status,created_at,workspaces(id,name)").eq("user_id", session.user.id).eq("status", "active").order("created_at");
    if (error) throw error;
    if (requestEpoch !== sessionEpoch || userId !== session?.user?.id) return;
    memberships = data || [];
    const select = $("#workspaceSelect");
    if (select) {
      select.replaceChildren();
      memberships.forEach(item => {
        const option = document.createElement("option"); option.value = item.workspace_id; option.textContent = item.workspaces?.name || item.workspace_id; select.append(option);
      });
      select.disabled = memberships.length < 2;
    }
    showAccountUI();
    if (memberships.length) {
      const storedWorkspace = localStorage.getItem(workspacePreferenceKey(userId));
      const currentIsMember = memberships.some(item => item.workspace_id === workspaceId);
      const preferred = memberships.find(item => item.workspace_id === storedWorkspace);
      const selected = preferred || (options.keepCurrent && currentIsMember ? memberships.find(item => item.workspace_id === workspaceId) : null) || memberships[0];
      if (options.keepCurrent && currentIsMember && selected.workspace_id === workspaceId) {
        currentRole = selected.role;
        workspaceName = selected.workspaces?.name || "Workspace";
        $("#activeWorkspaceName") && ( $("#activeWorkspaceName").textContent = `${workspaceName} · ${currentRole}` );
        showAccountUI();
        await loadWorkspaceData();
        if (isAdmin()) await refreshMembers();
      } else await activateWorkspace(selected.workspace_id);
    } else {
      workspaceId = null; currentRole = "member"; workspaceName = "";
      clearActiveCache("cloud");
      status("Akun ini belum menjadi anggota workspace. Minta admin menambahkan UUID akun ini, lalu pilih Muat ulang workspace.");
    }
  }

  async function handleSession(nextSession, refreshMembership = false) {
    const nextUserId = nextSession?.user?.id || null;
    const identityChanged = nextUserId !== activeUserId;
    if (!identityChanged && !refreshMembership) {
      session = nextSession;
      showAccountUI();
      return;
    }
    if (identityChanged) {
      captureLocalSnapshot();
      sessionEpoch++;
      activationGeneration++;
      workspaceLoadGeneration++;
      activeUserId = nextUserId;
      workspaceId = null; memberships = []; currentRole = "member"; workspaceName = "";
      clearActiveCache(nextUserId ? "cloud" : "local");
    }
    session = nextSession;
    showAccountUI();
    if (!session) {
      document.body.classList.remove("cloud-active");
      restoreLocalSnapshot();
      window.SpkApp?.startNew?.(false, { preserveDraft: true });
      await window.SpkApp?.restoreDraft?.();
      status("Login diperlukan untuk membuka arsip cloud. Data lokal di browser tidak dihapus.");
      return;
    }
    try {
      status(`Login sebagai ${session.user.email}. Memeriksa workspace…`);
      await loadMemberships({ keepCurrent: !identityChanged });
    } catch (error) { status(errorMessage(error), true); }
  }

  function setupEvents() {
    $("#accountMenuBtn")?.addEventListener("click", () => {
      accountPanelOpen = !accountPanelOpen;
      showAccountUI();
      if (accountPanelOpen) $("#cloudPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("#authForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const email = $("#authEmail").value.trim(); const password = $("#authPassword").value;
      if (!email || !password) { status("Masukkan email dan kata sandi.", true); return; }
      const button = $("#loginBtn"); if (button) button.disabled = true;
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        status(`Login berhasil sebagai ${data.user?.email || email}. Memeriksa workspace…`);
      } catch (error) { status(errorMessage(error), true); }
      finally { if (button) button.disabled = false; }
    });
    $("#signupBtn")?.addEventListener("click", async () => {
      const email = $("#authEmail").value.trim(); const password = $("#authPassword").value;
      if (!email || password.length < 8) { status("Masukkan email dan kata sandi minimal 8 karakter.", true); return; }
      try {
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${location.pathname}`, data: { display_name: email.split("@")[0] } } });
        if (error) throw error;
        if (!data.session) status("Pendaftaran diterima. Periksa email untuk konfirmasi, lalu login.");
      } catch (error) { status(errorMessage(error), true); }
    });
    $("#resetPasswordBtn")?.addEventListener("click", async () => {
      const email = $("#authEmail").value.trim();
      if (!email) { status("Isi email terlebih dahulu untuk meminta tautan reset kata sandi.", true); return; }
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
        if (error) throw error;
        status("Jika email terdaftar, instruksi pemulihan akan dikirim. Periksa kotak masuk dan spam.");
      } catch (error) { status(errorMessage(error), true); }
    });
    $("#signOutBtn")?.addEventListener("click", async () => {
      try { const { error } = await client.auth.signOut(); if (error) throw error; }
      catch (error) { status(errorMessage(error), true); }
    });
    $("#createWorkspaceBtn")?.addEventListener("click", async () => {
      const name = $("#newWorkspaceName").value.trim();
      if (!name) { status("Isi nama workspace.", true); return; }
      try {
        const { data, error } = await client.rpc("create_workspace", { p_name: name });
        if (error) throw error;
        status(`Workspace “${data.name}” dibuat. Memuat arsip…`);
        await loadMemberships();
      } catch (error) { status(errorMessage(error), true); }
    });
    $("#workspaceSelect")?.addEventListener("change", async event => activateWorkspace(event.target.value));
    $("#refreshWorkspaceBtn")?.addEventListener("click", async () => {
      const button = $("#refreshWorkspaceBtn");
      if (button) button.disabled = true;
      try { await loadMemberships({ keepCurrent: true }); }
      catch (error) { status(errorMessage(error), true); }
      finally { if (button) button.disabled = false; }
    });
    $("#addMemberBtn")?.addEventListener("click", async () => {
      const userId = $("#memberUserId").value.trim(); const role = $("#memberRole").value;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) { status("Masukkan UUID pengguna yang valid. Pengguna harus mendaftar lebih dahulu.", true); return; }
      try {
        const context = captureWorkspaceContext();
        const { error } = await context.client.rpc("add_workspace_member", { p_workspace_id: context.workspaceId, p_user_id: userId, p_role: role });
        if (error) throw error;
        assertWorkspaceContext(context);
        $("#memberUserId").value = ""; await refreshMembers(); status("Anggota workspace ditambahkan/diperbarui.");
      } catch (error) { status(errorMessage(error), true); }
    });
    $("#saveNewPasswordBtn")?.addEventListener("click", async () => {
      const password = $("#newPassword").value;
      if (password.length < 8) { status("Kata sandi baru minimal 8 karakter.", true); return; }
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        recoveryMode = false; $("#newPassword").value = ""; showAccountUI();
        status("Kata sandi berhasil diperbarui. Gunakan kata sandi baru pada login berikutnya.");
      } catch (error) { status(errorMessage(error), true); }
    });
    $("#copyUserIdBtn")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(session.user.id); status("UUID akun disalin."); }
      catch { status(`UUID akun: ${session.user.id}`); }
    });
    $("#migrateLocalBtn")?.addEventListener("click", async () => {
      if (!isActive()) return;
      const localRecords = safeJson(MIGRATION_RECORDS_KEY, []);
      const localLogos = safeJson(MIGRATION_LOGOS_KEY, []);
      if (!localRecords.length && !localLogos.length) { status("Tidak ada backup lokal yang tersimpan untuk migrasi."); return; }
      if (!confirm(`Migrasikan ${localRecords.length} arsip lokal ke workspace “${workspaceName}”? Arsip cloud yang sudah ada tidak akan dihapus. Setiap SPK impor akan mendapat nomor cloud baru.`)) return;
      const button = $("#migrateLocalBtn"); button.disabled = true;
      try {
        if (isAdmin() && localLogos.length && confirm("Unggah konfigurasi logo lokal ke slot logo bersama workspace? Logo slot yang sama akan diperbarui, tetapi snapshot logo pada SPK lama tetap menggunakan berkas versi sebelumnya.")) {
          for (const logo of localLogos.slice(0, 4)) {
            const imported = await saveLogo({ ...logo, storagePath: null });
            const current = safeJson(LOGO_KEY, []); const idx = current.findIndex(item => item.id === imported.id);
            if (idx >= 0) current[idx] = imported; else if (current.length < 4) current.push(imported);
            localStorage.setItem(LOGO_KEY, JSON.stringify(current));
          }
        }
        let added = 0, failed = 0;
        const currentRecords = safeJson(STORAGE_KEY, []);
        for (const original of localRecords) {
          try {
            const draft = { ...original, id: `spk-${crypto.randomUUID()}`, spkNo: await nextSpkNumber(), version: 0, createdAt: Date.now() };
            // Preserve local design bytes and logo snapshot. saveRecord uploads them before committing rows.
            const saved = await saveRecord(draft);
            currentRecords.unshift(saved); added++;
          } catch (error) { failed++; console.warn("Local SPK migration failed", original?.spkNo, error); }
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentRecords));
        emit("loaded", { workspaceId, workspaceName, count: currentRecords.length });
        status(`Migrasi selesai: ${added} SPK masuk ke server, ${failed} gagal. Backup lokal tetap disimpan.` , failed > 0);
      } catch (error) { status(errorMessage(error), true); }
      finally { button.disabled = false; }
    });
  }

  async function importRecords(records, logos) {
    if (!isActive()) throw new Error("Login ke workspace cloud sebelum mengimpor.");
    if (isAdmin() && Array.isArray(logos) && logos.length && confirm("Ganti/perbarui logo bersama workspace dari file backup?")) {
      for (const logo of logos.slice(0, 4)) await saveLogo({ ...logo, storagePath: null });
    }
    let added = 0, skipped = 0;
    const cache = safeJson(STORAGE_KEY, []);
    for (const original of records) {
      if (!original || !original.customer || !original.order || !Array.isArray(original.sizes)) { skipped++; continue; }
      try {
        const draft = { ...original, id: `spk-${crypto.randomUUID()}`, spkNo: await nextSpkNumber(), version: 0, createdAt: Date.now() };
        const saved = await saveRecord(draft);
        cache.unshift(saved); added++;
      } catch (error) { skipped++; console.warn("Backup record skipped", original?.spkNo, error); }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    emit("loaded", { workspaceId, workspaceName, count: cache.length });
    return { added, skipped };
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error || new Error("File tidak bisa dibaca.")); reader.readAsDataURL(blob);
    });
  }

  async function exportBackup(records, logos) {
    if (!isActive()) throw new Error("Backup cloud memerlukan login dan workspace aktif.");
    async function hydrateImage(value, path) {
      if (typeof value === "string" && value.startsWith("data:image/")) return value;
      if (!path) return "";
      const { data, error } = await client.storage.from(BUCKET).download(path);
      if (error) throw error;
      return blobToDataUrl(data);
    }
    const fullRecords = await Promise.all(records.map(async row => {
      const record = { ...row };
      record.designImage = await hydrateImage(row.designImage, row.designStoragePath);
      if (record.selectedLogoSnapshot) record.selectedLogoSnapshot = { ...record.selectedLogoSnapshot, dataUrl: await hydrateImage(row.selectedLogoSnapshot?.dataUrl, row.selectedLogoSnapshot?.storagePath) };
      return record;
    }));
    const fullLogos = await Promise.all(logos.map(async logo => ({ ...logo, dataUrl: await hydrateImage(logo.dataUrl, logo.storagePath) })));
    return { format: "spk-generator-backup", version: 2, exportedAt: new Date().toISOString(), source: "supabase", workspace: { id: workspaceId, name: workspaceName }, records: fullRecords, logos: fullLogos };
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    setupEvents();
    if (!configured()) {
      $("#cloudPanel")?.classList.add("unconfigured");
      $("#authForm")?.classList.add("hidden");
      status("Mode lokal aktif. Untuk login dan sinkronisasi, isi supabaseUrl dan supabaseAnonKey di config.js lalu deploy ulang.");
      return;
    }
    if (!window.supabase?.createClient) {
      status("Pustaka Supabase gagal dimuat. Periksa koneksi CDN atau jaringan.", true);
      return;
    }
    document.body.classList.add("cloud-configured");
    try {
      client = window.supabase.createClient(window.SPK_CONFIG.supabaseUrl.trim(), window.SPK_CONFIG.supabaseAnonKey.trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange((event, nextSession) => {
        // A token refresh must not reload the workspace or reset the active form.
        if (event === "INITIAL_SESSION") return;
        const nextUserId = nextSession?.user?.id || null;
        const identityChanged = nextUserId !== activeUserId;
        if (identityChanged) {
          captureLocalSnapshot();
          void window.SpkApp?.preserveCurrentDraft?.().catch(error => console.warn("Could not preserve draft before account switch", error));
          session = null;
          workspaceId = null; memberships = []; currentRole = "member"; workspaceName = "";
          accountPanelOpen = true;
          document.body.classList.remove("cloud-active");
          showAccountUI();
          clearActiveCache(nextSession ? "cloud" : "local");
          window.SpkApp?.startNew?.(false, { preserveDraft: true });
        }
        if (event === "PASSWORD_RECOVERY") recoveryMode = true;
        if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          session = nextSession;
          showAccountUI();
          if (identityChanged) setTimeout(() => { void handleSession(nextSession, true); }, 0);
          return;
        }
        setTimeout(() => { void handleSession(nextSession, event === "SIGNED_IN" || event === "SIGNED_OUT"); }, 0);
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await handleSession(data.session);
    } catch (error) { status(errorMessage(error), true); }
  }

  window.SpkCloud = {
    init, configured, isActive, isAdmin, getWorkspaceId: () => workspaceId, getUserId: () => session?.user?.id || null, getRole: () => currentRole,
    saveRecord, deleteRecord, saveLogo, deleteLogo, nextSpkNumber, importRecords, exportBackup,
    signPath,
    getClient: () => client,
    errorMessage,
    refresh: loadWorkspaceData
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();


