let receipts = [];
let currentIndex = 0;

// DOM references
const summaryStats = document.getElementById("summary-stats");
const navCounter = document.getElementById("nav-counter");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const emptyState = document.getElementById("empty-state");
const receiptView = document.getElementById("receipt-view");
const receiptImage = document.getElementById("receipt-image");
const receiptPdf = document.getElementById("receipt-pdf");
const rejectModal = document.getElementById("reject-modal");
const rejectNotes = document.getElementById("reject-notes");

// Form field references
const fieldVendor = document.getElementById("field-vendor");
const fieldDate = document.getElementById("field-date");
const fieldDescription = document.getElementById("field-description");
const fieldInvoiceNo = document.getElementById("field-invoice-no");
const fieldNet = document.getElementById("field-net");
const fieldVatRate = document.getElementById("field-vat-rate");
const fieldVatAmount = document.getElementById("field-vat-amount");
const fieldGross = document.getElementById("field-gross");
const fieldCurrency = document.getElementById("field-currency");
const fieldVatReg = document.getElementById("field-vat-reg");
const fieldCategory = document.getElementById("field-category");
const fieldPayment = document.getElementById("field-payment");

/**
 * Load all receipts awaiting approval from the API.
 */
async function loadReceipts() {
  try {
    const res = await fetch("/api/receipts");
    receipts = await res.json();
    currentIndex = 0;
    await Promise.all([loadCategories(), loadSummary()]);
    render();
  } catch (err) {
    console.error("Failed to load receipts:", err);
    summaryStats.textContent = "Error loading receipts";
  }
}

/**
 * Load categories and populate the category select dropdown.
 */
async function loadCategories() {
  try {
    const res = await fetch("/api/categories");
    const categories = await res.json();
    // Preserve current selection if possible
    const current = fieldCategory.value;
    // Clear existing options beyond the placeholder
    fieldCategory.innerHTML = '<option value="">-- Select category --</option>';
    for (const name of categories) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      fieldCategory.appendChild(option);
    }
    if (current) {
      fieldCategory.value = current;
    }
  } catch (err) {
    console.error("Failed to load categories:", err);
  }
}

/**
 * Load summary counts and update the header stats.
 */
async function loadSummary() {
  try {
    const res = await fetch("/api/summary");
    const data = await res.json();
    summaryStats.textContent =
      `${data.awaiting} to review | ${data.approved} approved | ${data.rejected} rejected`;
  } catch (err) {
    console.error("Failed to load summary:", err);
  }
}

/**
 * Render the current receipt or empty state.
 */
function render() {
  if (receipts.length === 0) {
    emptyState.style.display = "flex";
    receiptView.style.display = "none";
    navCounter.textContent = "0 / 0";
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }

  emptyState.style.display = "none";
  receiptView.style.display = "grid";

  // Clamp index
  if (currentIndex >= receipts.length) {
    currentIndex = receipts.length - 1;
  }
  if (currentIndex < 0) {
    currentIndex = 0;
  }

  const receipt = receipts[currentIndex];

  // Update navigation
  navCounter.textContent = `${currentIndex + 1} / ${receipts.length}`;
  btnPrev.disabled = currentIndex === 0;
  btnNext.disabled = currentIndex === receipts.length - 1;

  // Set image or PDF viewer
  const receiptUrl = `/receipts/${encodeURIComponent(receipt.filename)}`;
  const isPdf = receipt.filename?.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    receiptImage.style.display = "none";
    receiptPdf.style.display = "block";
    receiptPdf.src = receiptUrl;
  } else {
    receiptPdf.style.display = "none";
    receiptPdf.src = "";
    receiptImage.style.display = "block";
    receiptImage.src = receiptUrl;
    receiptImage.alt = `Receipt from ${receipt.vendor_name || "unknown vendor"}`;
  }

  // Fill form fields
  fieldVendor.value = receipt.vendor_name || "";
  fieldDate.value = receipt.date || "";
  fieldDescription.value = receipt.description || "";
  fieldInvoiceNo.value = receipt.invoice_number || "";
  fieldNet.value = receipt.net_amount != null ? receipt.net_amount : "";
  fieldVatRate.value = receipt.vat_rate != null ? String(receipt.vat_rate) : "20";
  fieldVatAmount.value = receipt.vat_amount != null ? receipt.vat_amount : "";
  fieldGross.value = receipt.gross_amount != null ? receipt.gross_amount : "";
  fieldCurrency.value = receipt.currency || "GBP";
  fieldVatReg.value = receipt.vat_registration_number || "";
  fieldCategory.value = receipt.suggested_category || "";
  fieldPayment.value = receipt.payment_method || "";
}

/**
 * Navigate through receipts.
 * @param {number} direction - +1 for next, -1 for previous
 */
function navigate(direction) {
  const newIndex = currentIndex + direction;
  if (newIndex < 0 || newIndex >= receipts.length) return;
  currentIndex = newIndex;
  render();
}

/**
 * Read all form fields and return an edits object.
 */
function getEdits() {
  const vatRate = fieldVatRate.value;
  return {
    vendor_name: fieldVendor.value.trim(),
    date: fieldDate.value,
    description: fieldDescription.value.trim(),
    invoice_number: fieldInvoiceNo.value.trim(),
    net_amount: fieldNet.value !== "" ? parseFloat(fieldNet.value) : null,
    vat_rate: vatRate === "exempt" ? null : parseFloat(vatRate),
    vat_amount: fieldVatAmount.value !== "" ? parseFloat(fieldVatAmount.value) : null,
    gross_amount: fieldGross.value !== "" ? parseFloat(fieldGross.value) : null,
    currency: fieldCurrency.value.trim() || "GBP",
    vat_registration_number: fieldVatReg.value.trim(),
    suggested_category: fieldCategory.value,
    payment_method: fieldPayment.value,
  };
}

/**
 * Approve the current receipt with any edits.
 */
async function approveReceipt() {
  if (receipts.length === 0) return;

  const receipt = receipts[currentIndex];
  const edits = getEdits();

  try {
    const res = await fetch(`/api/receipts/${encodeURIComponent(receipt.filename)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("Approve failed:", err);
      return;
    }

    // Remove from local array and re-render
    receipts.splice(currentIndex, 1);
    if (currentIndex >= receipts.length && currentIndex > 0) {
      currentIndex--;
    }
    await loadSummary();
    render();
  } catch (err) {
    console.error("Approve failed:", err);
  }
}

/**
 * Show the rejection modal.
 */
function rejectReceipt() {
  if (receipts.length === 0) return;
  rejectNotes.value = "";
  rejectModal.style.display = "flex";
  rejectNotes.focus();
}

/**
 * Hide the rejection modal.
 */
function cancelReject() {
  rejectModal.style.display = "none";
}

/**
 * Confirm rejection: send to API with notes, then remove from list.
 */
async function confirmReject() {
  if (receipts.length === 0) return;

  const receipt = receipts[currentIndex];
  const notes = rejectNotes.value.trim();

  try {
    const res = await fetch(`/api/receipts/${encodeURIComponent(receipt.filename)}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("Reject failed:", err);
      return;
    }

    rejectModal.style.display = "none";

    // Remove from local array and re-render
    receipts.splice(currentIndex, 1);
    if (currentIndex >= receipts.length && currentIndex > 0) {
      currentIndex--;
    }
    await loadSummary();
    render();
  } catch (err) {
    console.error("Reject failed:", err);
  }
}

/**
 * Keyboard shortcuts.
 * Only active when not focused on an input, select, or textarea.
 */
document.addEventListener("keydown", function (e) {
  // Skip if focused on a form element
  const tag = document.activeElement.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;

  // Skip if modal is open (only allow Escape to close it)
  const modalOpen = rejectModal.style.display === "flex";

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      if (!modalOpen) navigate(-1);
      break;
    case "ArrowRight":
      e.preventDefault();
      if (!modalOpen) navigate(1);
      break;
    case "Enter":
      e.preventDefault();
      if (!modalOpen) approveReceipt();
      break;
    case "Escape":
      if (modalOpen) {
        e.preventDefault();
        cancelReject();
      }
      break;
  }
});

// --- QuickBooks Integration ---

const qbIndicator = document.getElementById("qb-indicator");
const qbText = document.getElementById("qb-text");
const btnQbConnect = document.getElementById("btn-qb-connect");
const btnQbUpload = document.getElementById("btn-qb-upload");
const qbSetupModal = document.getElementById("qb-setup-modal");
const qbAccountSelect = document.getElementById("qb-account-select");

let qbConnected = false;
let qbConfigured = false;

async function loadQbStatus() {
  try {
    const res = await fetch("/api/qb/status");
    const data = await res.json();

    qbConnected = data.connected;
    qbConfigured = data.connected && data.hasDefaultAccount;

    if (data.connected) {
      qbIndicator.className = "qb-indicator qb-connected";
      qbText.textContent = `QuickBooks: Connected (${data.environment})`;
      btnQbConnect.textContent = "Reconnect";

      if (data.hasDefaultAccount) {
        btnQbUpload.style.display = "inline-flex";
      } else {
        btnQbUpload.style.display = "none";
        showQbSetup();
      }
    } else {
      qbIndicator.className = "qb-indicator qb-disconnected";
      qbText.textContent = "QuickBooks: Not connected";
      btnQbConnect.textContent = "Connect";
      btnQbUpload.style.display = "none";
    }

    // Check if just connected via redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("qb") === "connected") {
      window.history.replaceState({}, "", "/");
      if (!data.hasDefaultAccount) {
        showQbSetup();
      }
    }
  } catch (err) {
    console.error("Failed to load QB status:", err);
  }
}

function connectQuickBooks() {
  window.location.href = "/api/qb/authorize";
}

async function showQbSetup() {
  qbSetupModal.style.display = "flex";
  qbAccountSelect.innerHTML = '<option value="">Loading accounts...</option>';

  try {
    const res = await fetch("/api/qb/accounts");
    const data = await res.json();

    qbAccountSelect.innerHTML = '<option value="">-- Select account --</option>';

    if (data.bank?.length) {
      const group = document.createElement("optgroup");
      group.label = "Bank Accounts";
      for (const a of data.bank) {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        group.appendChild(opt);
      }
      qbAccountSelect.appendChild(group);
    }

    if (data.creditCard?.length) {
      const group = document.createElement("optgroup");
      group.label = "Credit Cards";
      for (const a of data.creditCard) {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        group.appendChild(opt);
      }
      qbAccountSelect.appendChild(group);
    }

    if (data.expense?.length) {
      const group = document.createElement("optgroup");
      group.label = "Expense Accounts";
      for (const a of data.expense) {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        group.appendChild(opt);
      }
      qbAccountSelect.appendChild(group);
    }

    // Show warning if no bank/CC accounts
    if (!data.bank?.length && !data.creditCard?.length) {
      const warn = document.createElement("option");
      warn.disabled = true;
      warn.textContent = "⚠ No bank/CC accounts found — select an expense account for now";
      qbAccountSelect.insertBefore(warn, qbAccountSelect.firstChild.nextSibling);
    }
  } catch (err) {
    console.error("Failed to load accounts:", err);
    qbAccountSelect.innerHTML = '<option value="">Error loading accounts</option>';
  }
}

function cancelQbSetup() {
  qbSetupModal.style.display = "none";
}

async function saveQbSetup() {
  const accountId = qbAccountSelect.value;
  if (!accountId) return;

  try {
    await fetch("/api/qb/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultAccountId: accountId }),
    });

    qbSetupModal.style.display = "none";
    await loadQbStatus();
  } catch (err) {
    console.error("Failed to save QB config:", err);
  }
}

async function uploadToQuickBooks() {
  btnQbUpload.disabled = true;
  btnQbUpload.textContent = "Uploading...";

  try {
    const res = await fetch("/api/qb/upload", { method: "POST" });
    const data = await res.json();

    if (data.error) {
      alert(`Upload error: ${data.error}`);
    } else if (data.failed > 0) {
      const errMsgs = data.errors.map((e) => `${e.filename}: ${e.error}`).join("\n");
      alert(`Uploaded: ${data.uploaded}, Failed: ${data.failed}\n\n${errMsgs}`);
    } else if (data.uploaded > 0) {
      alert(`Successfully uploaded ${data.uploaded} receipt(s) to QuickBooks!`);
    } else {
      alert("No approved receipts to upload.");
    }

    await loadSummary();
  } catch (err) {
    console.error("Upload failed:", err);
    alert("Upload failed. Check console for details.");
  } finally {
    btnQbUpload.disabled = false;
    btnQbUpload.textContent = "Upload to QB";
  }
}

// Load receipts and QB status on page load
loadReceipts();
loadQbStatus();
