const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxq7JWvraz16LFNFtd5cQ0yejA2YZr_3cfVFYP10WeaYeTsOfw99WzLxcgZwQC3e-XY8A/exec";
const API_KEY = "NV26182155";


// ==========================================
// 1. GLOBAL HELPERS (Utility Functions)
// ==========================================
function isEmpty(v) { return v === null || v === undefined || String(v).trim() === ""; }

function showError(msg) {
    alert(msg);
    showLoader(false);
    throw new Error(msg);
}

function showLoader(s) { 
    const loader = document.getElementById('loader');
    if(loader) loader.classList.toggle('hidden', !s); 
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function safeGetStorage(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSetStorage(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function getReminderKey(invoiceNo, emiDate) {
    return `emi_reminder_${invoiceNo}_${emiDate}_${getTodayKey()}`;
}

// Image Handling
async function compressImage(file, maxWidth = 300, quality = 0.7) {
    return new Promise(resolve => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = e => { img.src = e.target.result; };
        img.onload = () => {
            const scale = maxWidth / img.width;
            const canvas = document.createElement("canvas");
            canvas.width = maxWidth;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        reader.readAsDataURL(file);
    });
}

// ==========================================
// 2. UI & NAVIGATION LOGIC
// ==========================================
function switchPage(page, el) {
    document.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

    document.getElementById('page-' + page).classList.add('active');
    if(el) el.classList.add('active');

    const bottomBar = document.querySelector('.bottom-bar');
    if(bottomBar) bottomBar.style.display = (page === 'invoice' ? 'flex' : 'none');

    if (page === 'history') fetchHistory();
    if (page === 'emi-records') fetchEmiRecords();
    if (page === 'overdue-emi') fetchOverdueEmi(); 
    updateOverdueIndicator();
    // Auto close sidebar on mobile after navigation
    if(window.innerWidth <= 850){
      document.querySelector(".sidebar").classList.remove("open");
      document.getElementById("sidebarOverlay").classList.remove("show");
    }

}

function toggleEmiUI() {
    const isEmi = document.getElementById('payMode').value === 'EMI';
    const emiSection = document.getElementById('emiSection');
    if(emiSection) emiSection.classList.toggle('hidden', !isEmi);

    const emiInputs = ['downPay', 'months', 'interest', 'fileCharge', 'fName', 'aadhar', 'emiStart', 'pan', 'custImage'];
    emiInputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isEmi) {
            el.setAttribute('required', 'required');
        } else {
            el.removeAttribute('required');
            if (el.type !== 'file') el.value = '';
        }
    });
}

function closeModal() { document.getElementById('scheduleModal').classList.add('hidden'); }


// ==========================================
// 3. INVOICE & EMI CALCULATIONS
// ==========================================
function addItemRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
    <td>
      <input type="text" class="p-name" placeholder="Item Name">
      <textarea class="p-note" placeholder="IMEI/SN (Press Enter for 2nd row)"></textarea>
    </td>
    <td><input type="number" class="p-qty" value="1" oninput="calculateTotal()"></td>
    <td><input type="number" class="p-rate" readonly style="background:#f8fafc"></td>
    <td><input type="number" class="p-total" readonly style="background:#f8fafc"></td>
    <td><button class="item-del-btn" onclick="this.closest('tr').remove(); calculateTotal()">DELETE</button></td>`;
    document.getElementById('itemsBody').appendChild(tr);
    calculateTotal();
}

function calculateTotal() {
    const grand = Number(document.getElementById('grandInput').value) || 0;
    const taxable = grand / 1.18;
    const gst = (grand - taxable) / 2;
    document.getElementById('taxVal').innerText = taxable.toFixed(2);
    document.getElementById('cgstVal').innerText = gst.toFixed(2);
    document.getElementById('sgstVal').innerText = gst.toFixed(2);
    
    const rows = document.querySelectorAll('#itemsBody tr');
    let tQty = 0; 
    rows.forEach(r => tQty += (Number(r.querySelector('.p-qty').value) || 0));
    
    const rate = taxable / (tQty || 1);
    rows.forEach(r => {
        const q = Number(r.querySelector('.p-qty').value) || 1;
        r.querySelector('.p-rate').value = rate.toFixed(2);
        r.querySelector('.p-total').value = (rate * q).toFixed(2);
    });
    calculateEMI();
}

function calculateEMI() {
    const grandTotal = Number(document.getElementById('grandInput').value) || 0;
    const downPayment = Number(document.getElementById('downPay').value) || 0;
    const fileCharge = Number(document.getElementById('fileCharge').value) || 0;
    const n = Number(document.getElementById('months').value) || 1;
    const r = (Number(document.getElementById('interest').value) || 0) / 100;
    const p = (grandTotal - downPayment) + fileCharge;
    
    document.getElementById('loanAmt').innerText = p > 0 ? p.toFixed(2) : 0;
    if(p > 0) {
        const emi = r > 0 ? (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : (p / n);
        document.getElementById('emiLabel').innerText = "₹ " + emi.toFixed(2);
    } else { 
        document.getElementById('emiLabel').innerText = "₹ 0.00"; 
    }
}

// ==========================================
// 4. API OPERATIONS (Fetch, Save, Delete)
// ==========================================

async function saveInvoice() {
    showLoader(true);
    try {
        // Validation
        if (isEmpty(cName.value)) showError("Customer Name is required");
        if (isEmpty(cPhone.value)) showError("Mobile Number is required");
        if (isEmpty(invDate.value)) showError("Invoice Date is required");
        const grand = Number(grandInput.value);
        if (!grand || grand <= 0) showError("Grand Total must be greater than 0");

        const rows = document.querySelectorAll("#itemsBody tr");
        if (!rows.length) showError("At least one item is required");

        if (payMode.value === "EMI") {
            if (isEmpty(downPay.value)) showError("Down Payment is required");
            if (isEmpty(months.value)) showError("EMI Duration is required");
            if (isEmpty(fName.value)) showError("Father Name is required");
            if (isEmpty(aadhar.value)) showError("Aadhar Number is required");
            if (isEmpty(pan.value)) showError("PAN Number is required");
            if (!custImage.files.length) showError("Customer photo is required");
        }

        const imgBase64 = payMode.value === "EMI" && custImage.files[0] ? await compressImage(custImage.files[0]) : "";

        const payload = {
            invoiceNo: invNo.value,
            date: invDate.value,
            customer: cName.value,
            phone: cPhone.value,
            altPhone: document.getElementById("cAltPhone").value,
            address: cAddr.value,
            mop: payMode.value,
            grandTotal: grandInput.value,
            taxable: taxVal.innerText,
            cgst: cgstVal.innerText,
            sgst: sgstVal.innerText,
            items: Array.from(rows).map(r => ({
                name: r.querySelector('.p-name').value,
                qty: r.querySelector('.p-qty').value,
                amount: r.querySelector('.p-total').value,
                note: r.querySelector('.p-note').value 
            })),
            emi: payMode.value === 'EMI' ? {
                downPayment: downPay.value,
                duration: months.value,
                emiAmount: emiLabel.innerText.replace('₹ ', ''),
                fatherName: fName.value,
                aadharNumber: aadhar.value,
                panNumber: pan.value,
                customerImage: imgBase64,
                startDate: emiStart.value,
                fileCharge: fileCharge.value,
                interest: interest.value
            } : null
        };

        const fd = new FormData();
        fd.append("action", "createInvoice");
        fd.append("data", JSON.stringify(payload));
        fd.append("sheetId", localStorage.getItem("sheetId"));
        fd.append("key", API_KEY);

        const res = await fetch(SCRIPT_URL, { method: "POST", body: fd });
        const data = await res.json();

        if (!data.success) showError(data.error || "Invoice generation failed");

        window.open(data.pdfUrl, "_blank");
        resetInvoiceForm();
        setTimeout(()=>location.reload(),800);

    } catch (e) {
        console.error(e);
        if(e.message) alert(e.message);
    }
    showLoader(false);
}

async function fetchHistory() {
    showLoader(true);
    try {
        const sheetId = localStorage.getItem("sheetId");
        if(!sheetId){
          alert("Shop not logged in");
          return;
        }

        const res = await fetch(`${SCRIPT_URL}?action=allInvoices&sheetId=${sheetId}&key=${API_KEY}`);
        const data = await res.json();

        document.getElementById('historyBody').innerHTML = data.reverse().map(inv => `
            <tr>
                <td><b>${inv.InvoiceNo}</b></td>
                <td>${formatDisplayDate(inv.Date)}</td>
                <td>${inv.Customer}</td>
                <td>₹${inv.GrandTotal}</td>
                <td>
                  <div class="action-cell">
                    <button class="btn-action btn-view" onclick="window.open('${inv.PDF}','_blank')">Invoice</button>
                    <button class="btn-action btn-del" onclick="deleteInvoice('${inv.InvoiceNo}')">Delete</button>
                  </div>
                </td>
            </tr>`).join('');
    } catch(e) { 
        console.error(e); 
        alert("Failed to load invoice history");
    }
    showLoader(false);
}


async function deleteInvoice(id) {

    if(!confirm("Are you sure you want to delete Invoice " + id + "?")) return;

    showLoader(true);

    const sheetId = localStorage.getItem("sheetId");
    if(!sheetId){
      alert("Shop not logged in");
      return;
    }

    const fd = new FormData();
    fd.append("action", "deleteInvoice");
    fd.append("invoiceNo", id);
    fd.append("sheetId", sheetId);
    fd.append("key", API_KEY);

    await fetch(SCRIPT_URL, {
      method: "POST",
      body: fd
    });

    fetchHistory();
}


// ==========================================
// 1. FETCH EMI RECORDS (Only Schedule Icon)
// ==========================================
async function fetchEmiRecords() {
    showLoader(true);
    try {
        const sheetId = localStorage.getItem("sheetId");

        const [invoices, schedule] = await Promise.all([
          fetch(`${SCRIPT_URL}?action=emiInvoices&sheetId=${sheetId}&key=${API_KEY}`).then(r => r.json()),
          fetch(`${SCRIPT_URL}?action=emiSchedule&sheetId=${sheetId}&key=${API_KEY}`).then(r => r.json())
        ]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        document.getElementById('emiRecordBody').innerHTML = invoices.reverse().map(inv => {
            const s = schedule.filter(x => String(x.InvoiceNo) === String(inv.InvoiceNo));
            const pend = s.find(x => x.Status === "Pending");
            const isComplete = !pend && s.length > 0;
            
            let statusClass = isComplete ? 'row-paid-complete' : '';
            if (pend) {
                const dueDate = new Date(pend.EMI_Date);
                dueDate.setHours(0, 0, 0, 0);
                if (dueDate <= today) statusClass = 'row-overdue';
            }

            return `<tr class="${statusClass}">
                <td><b>${inv.InvoiceNo}</b></td>
                <td>${inv.Customer}</td>
                <td>${inv.Phone || '-'}</td>
                <td>₹${inv.EMIAmount}</td>
                <td>${isComplete ? 'PAID ✔' : (pend ? formatDisplayDate(pend.EMI_Date) : '-')}</td>
                <td style="text-align:center;">
                    <button class="schedule-icon" onclick="openSchedule('${inv.InvoiceNo}', '${inv.Customer}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7 2V5M17 2V5M3 9H21M5 5H19 C20.1046 5 21 5.89543 21 7V19 C21 20.1046 20.1046 21 19 21H5 C3.89543 21 3 20.1046 3 19V7 C3 5.89543 3.89543 5 5 5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </td>
            </tr>`;
        }).join('');
    } catch(e) { console.error(e); }
    showLoader(false);
}

// ==========================================
// 2. FETCH OVERDUE EMI (With Original Icons & Buttons)
// ==========================================
async function fetchOverdueEmi() {
    showLoader(true);
    try {
        const sheetId = localStorage.getItem("sheetId");

        const [invoices, schedule] = await Promise.all([
          fetch(`${SCRIPT_URL}?action=emiInvoices&sheetId=${sheetId}&key=${API_KEY}`).then(r => r.json()),
          fetch(`${SCRIPT_URL}?action=emiSchedule&sheetId=${sheetId}&key=${API_KEY}`).then(r => r.json())
        ]);


        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let totalDueCount = 0;
        let totalDueAmount = 0;
        const rows = [];

        invoices.forEach(inv => {
            const emiList = schedule.filter(s => String(s.InvoiceNo) === String(inv.InvoiceNo) && s.Status !== "Paid");
            
            emiList.forEach(s => {
                const emiDate = new Date(s.EMI_Date);
                emiDate.setHours(0, 0, 0, 0);

                let rowClass = "";
                if (emiDate < today) rowClass = "row-overdue";
                else if (emiDate.getTime() === today.getTime()) rowClass = "row-due-today";
                else return;

                totalDueCount++;
                totalDueAmount += Number(s.EMI_Amount) || 0;

                const shopName = localStorage.getItem("shopName") || "VyaparX";

                const waText = encodeURIComponent(`Hello ${inv.Customer},\nYour EMI payment is due.\n\nInvoice No: ${inv.InvoiceNo}\nEMI Amount: ₹${s.EMI_Amount}\nDue Date: ${formatDisplayDate(s.EMI_Date)}\n\nKindly clear the payment.\n– ${shopName}`);

                const reminderKey = getReminderKey(inv.InvoiceNo, s.EMI_Date);
                const isSentToday = safeGetStorage(reminderKey) === "sent";

                rows.push(`<tr class="${rowClass}">
                    <td><b>${inv.InvoiceNo}</b></td>
                    <td>${inv.Customer}</td>
                    <td>${inv.Phone || "-"}</td>
                    <td>₹${s.EMI_Amount}</td>
                    <td>${formatDisplayDate(s.EMI_Date)}</td>
                    <td style="text-align:center;">
                        <div class="icon-action-wrap-col">
                            <div class="icon-row">
                                <button class="schedule-icon" onclick="openSchedule('${inv.InvoiceNo}', '${inv.Customer}')">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M7 2V5M17 2V5M3 9H21M5 5H19 C20.1046 5 21 5.89543 21 7V19 C21 20.1046 20.1046 21 19 21H5 C3.89543 21 3 20.1046 3 19V7 C3 5.89543 3.89543 5 5 5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </button>
                                ${inv.Phone ? `<a href="tel:${inv.Phone}" class="call-icon">☎</a>` : ""}
                            </div>
                            ${inv.Phone ? `
                                <button class="whatsapp-btn ${isSentToday ? "sent" : ""}" 
                                    onclick="sendWhatsappReminder('${inv.InvoiceNo}','${s.EMI_Date}','${inv.Phone}','${waText}',this)">
                                    ${isSentToday ? "Sent ✔" : "WhatsApp"}
                                </button>` : ""}
                        </div>
                    </td>
                </tr>`);
            });
        });

        document.getElementById("totalDueCount").innerText = totalDueCount;
        document.getElementById("totalDueAmount").innerText = totalDueAmount.toFixed(2);
        document.getElementById("overdueEmiBody").innerHTML = rows.length ? rows.join("") : `<tr><td colspan="6" style="text-align:center;">No Due EMI 🎉</td></tr>`;

        // Update dot indicator
        const dot = document.getElementById("overdueDot");
        const nav = document.getElementById("overdueNav");
        if(totalDueCount > 0) {
            dot?.classList.add("show");
            nav?.classList.add("overdue-alert");
        } else {
            dot?.classList.remove("show");
            nav?.classList.remove("overdue-alert");
        }

    } catch (e) { console.error(e); }
    showLoader(false);
}

// ==========================================
// 5. EMI SCHEDULE & WHATSAPP
// ==========================================
async function openSchedule(id, custName) {
    document.getElementById('scheduleModal').classList.remove('hidden');
    document.getElementById('modalInvNo').innerText = "EMI Schedule: #" + id;
    document.getElementById('modalCustName').innerText = "Customer: " + custName;
    const tbody = document.getElementById('scheduleBody');
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>Syncing...</td></tr>";
    
    try {
        const sheetId = localStorage.getItem("sheetId");
        const res = await fetch(`${SCRIPT_URL}?action=emiSchedule&sheetId=${sheetId}&key=${API_KEY}`);
        const data = await res.json();
        const filtered = data.map((s, i) => ({...s, row: i+2})).filter(s => String(s.InvoiceNo) === String(id));
        
        tbody.innerHTML = filtered.map((s, index) => `
            <tr><td>#${index+1}</td><td>${formatDisplayDate(s.EMI_Date)}</td><td>₹${s.EMI_Amount}</td>
            <td><span class="badge ${s.Status==='Paid'?'badge-paid':'badge-pending'}">${s.Status}</span></td>
            <td>${s.PaidDate?formatDisplayDate(s.PaidDate):'—'}</td>
            <td>${s.Status==='Pending'?`<button class="btn-main" style="padding:5px 10px; font-size:11px;" onclick="markPaid(${s.row},'${id}','${custName}')">Receive</button>`:'✔'}</td></tr>`).join('');
    } catch(e) { tbody.innerHTML = "Error loading schedule."; }
}

async function markPaid(row, id, custName) {
    showLoader(true);
    const fd = new FormData(); 
    fd.append("action", "markEmiPaid");
    fd.append("rowIndex", row);
    fd.append("sheetId", localStorage.getItem("sheetId"));
    fd.append("key", API_KEY);
    await fetch(SCRIPT_URL, { method: "POST", body: fd });
    openSchedule(id, custName); 
    fetchEmiRecords();
    updateOverdueIndicator();
}

function sendWhatsappReminder(invoiceNo, emiDate, phone, waText, btn) {
    const key = getReminderKey(invoiceNo, emiDate);
    window.open(`https://wa.me/91${phone}?text=${waText}`, "_blank");
    safeSetStorage(key, "sent");
    btn.classList.add("sent");
    btn.innerText = "Sent ✔";
    btn.disabled = true;
}

async function updateOverdueIndicator() {
    // This is essentially a lighter version of fetchOverdueEmi just for the dot
    try {
        const sheetId = localStorage.getItem("sheetId");

            const [invoices, schedule] = await Promise.all([
             fetch(`${SCRIPT_URL}?action=emiInvoices&sheetId=${sheetId}&key=${API_KEY}`).then(r=>r.json()),
             fetch(`${SCRIPT_URL}?action=emiSchedule&sheetId=${sheetId}&key=${API_KEY}`).then(r=>r.json())
            ]);
        const today = new Date(); today.setHours(0,0,0,0);
        let hasOverdue = false;
        invoices.forEach(inv => {
            schedule.forEach(s => {
                if (String(s.InvoiceNo) === String(inv.InvoiceNo) && s.Status !== "Paid") {
                    const d = new Date(s.EMI_Date); d.setHours(0,0,0,0);
                    if (d <= today) hasOverdue = true;
                }
            });
        });
        const dot = document.getElementById("overdueDot");
        if (dot) hasOverdue ? dot.classList.add("show") : dot.classList.remove("show");
    } catch (e) { console.error(e); }
}

// ==========================================
// 6. SEARCH, FILTERS & RESET
// ==========================================
function filterInvoiceHistory() {
    const name = document.getElementById("invSearchName").value.toLowerCase();
    const no = document.getElementById("invSearchNo").value.toLowerCase();
    document.querySelectorAll("#historyBody tr").forEach(row => {
        const match = (!name || row.children[2].innerText.toLowerCase().includes(name)) && (!no || row.children[0].innerText.toLowerCase().includes(no));
        row.style.display = match ? "" : "none";
    });
}

function filterEmiRecords() {
    const name = document.getElementById("emiSearchName").value.toLowerCase();
    const no = document.getElementById("emiSearchNo").value.toLowerCase();
    document.querySelectorAll("#emiRecordBody tr").forEach(row => {
        const match = (!name || row.children[1].innerText.toLowerCase().includes(name)) && (!no || row.children[0].innerText.toLowerCase().includes(no));
        row.style.display = match ? "" : "none";
    });
}

function filterOverdueEmi() {
    const name = document.getElementById("overdueSearchName").value.toLowerCase();
    const no = document.getElementById("overdueSearchNo").value.toLowerCase();
    document.querySelectorAll("#overdueEmiBody tr").forEach(row => {
        const match = (!name || row.children[1].innerText.toLowerCase().includes(name)) && (!no || row.children[0].innerText.toLowerCase().includes(no));
        row.style.display = match ? "" : "none";
    });
}

function resetInvoiceForm() {
    cName.value = ""; cPhone.value = ""; cAltPhone.value = ""; cAddr.value = "";
    grandInput.value = "";
    taxVal.innerText = "0.00"; cgstVal.innerText = "0.00"; sgstVal.innerText = "0.00";
    document.getElementById("itemsBody").innerHTML = "";
    addItemRow();
    payMode.value = "Cash";
    toggleEmiUI();
    
}

async function initERP(){

  const sheetId = localStorage.getItem("sheetId");
  if(!sheetId) return;

  // set shop name
  const shop = localStorage.getItem("shopName");
  if(shop){
    document.querySelector(".logo").innerText = shop;
  }

  showLoader(true);

  try{

    const res = await fetch(`${SCRIPT_URL}?action=nextInvoice&sheetId=${sheetId}&key=${API_KEY}`);
    const data = await res.json();

    if(!data.invoiceNo){
      throw new Error("Invoice not received");
    }

    // ✅ Invoice number
    invNo.value = data.invoiceNo;

    // ✅ Date
    invDate.value = new Date().toISOString().split("T")[0];

    // ✅ Clear old rows first
    document.getElementById("itemsBody").innerHTML = "";

    // ✅ Add FIRST product row
    addItemRow();

    // ✅ Overdue fetch after core UI ready
    await fetchOverdueEmi();

  }catch(e){

    console.error(e);
    alert("ERP init failed");

  }finally{

    // ✅ NOW hide loader (after EVERYTHING ready)
    showLoader(false);

  }
}



// ==========================================
// 7. INITIALIZATION
// ==========================================
window.onload = async () => {

  const sheetId = localStorage.getItem("sheetId");

  if(!sheetId){
    document.getElementById("loginScreen").style.display = "flex";
    showLoader(false);
    return;
  }

  showLoader(true);

  const fd = new FormData();
  fd.append("action","checkStatus");
  fd.append("sheetId",sheetId);
  fd.append("key",API_KEY);

  const res = await fetch(SCRIPT_URL,{
    method:"POST",
    body:fd
  });

  const out = await res.json();

  if(!out.success || out.status === "BLOCK"){

    alert("Your shop is blocked. Contact support.");

    localStorage.clear();
    location.reload();
    return;
  }

  document.querySelector(".logo").innerText = out.shopName;

  document.getElementById("loginScreen").style.display="none";

  initERP();
};





// Global Exposure for HTML onclicks
window.switchPage = switchPage;
window.addItemRow = addItemRow;
window.calculateTotal = calculateTotal;
window.toggleEmiUI = toggleEmiUI;
window.saveInvoice = saveInvoice;
window.fetchHistory = fetchHistory;
window.fetchEmiRecords = fetchEmiRecords;
window.fetchOverdueEmi = fetchOverdueEmi;
window.openSchedule = openSchedule;
window.closeModal = closeModal;
window.markPaid = markPaid;
window.sendWhatsappReminder = sendWhatsappReminder;
window.filterInvoiceHistory = filterInvoiceHistory;
window.filterEmiRecords = filterEmiRecords;
window.filterOverdueEmi = filterOverdueEmi;
window.calculateEMI = calculateEMI;

async function loginShop(){

  showLoader(true);

  const shopId = document.getElementById("loginShopId").value.trim();
  const phone = document.getElementById("loginPhone").value.trim();

  if(!shopId || !phone){
    showLoader(false);
    alert("Enter Shop ID and Phone");
    return;
  }

  const fd = new FormData();
  fd.append("action","loginShop");
  fd.append("data",JSON.stringify({shopId,phone}));
  fd.append("key", API_KEY);

  try{

    const res = await fetch(SCRIPT_URL,{
      method:"POST",
      body:fd
    });

    const out = await res.json();

    if(!out.success){
      showLoader(false);
      alert(out.error);
      return;
    }

    localStorage.setItem("shopId", out.shopId);
    localStorage.setItem("sheetId", out.sheetId);
    localStorage.setItem("shopName", out.shopName);

    document.getElementById("loginScreen").style.display="none";
    initERP();


  }catch(e){

    console.error(e);
    alert("Login failed");

  }
}


function logoutShop(){
  localStorage.clear();
  location.reload();
}

document.querySelector(".logo").innerText =
 localStorage.getItem("shopName") || "ERP";


function showSignup(){
  document.getElementById("loginBox").style.display="none";
  document.getElementById("signupBox").style.display="block";
}

function showLogin(){
  document.getElementById("signupBox").style.display="none";
  document.getElementById("loginBox").style.display="block";
}

async function signupShop(){

  showLoader(true);

  const data = {
    shopName: sShop.value.trim(),
    owner: sOwner.value.trim(),
    phone: sPhone.value.trim(),
    address: sAddr.value.trim(),
    gst: sGst.value.trim()
  };

  if(!data.shopName || !data.owner || !data.phone || !data.address){
    alert("Fill all required fields");
    showLoader(false);
    return;
  }

  const fd = new FormData();
  fd.append("action","registerShop");
  fd.append("data",JSON.stringify(data));
  fd.append("key",API_KEY);

  try{

    const res = await fetch(SCRIPT_URL,{
      method:"POST",
      body:fd
    });

    const out = await res.json();

    if(!out.success){
      alert(out.error);
      return;
    }

    // ✅ Show Shop ID
    alert(
      "Shop Created Successfully!\n\n" +
      "Your Shop ID is:\n" +
      out.shopId +
      "\n\nPlease save this Shop ID.\nYou will need it to login."
    );

    // ✅ Clear signup form
    sShop.value = "";
    sOwner.value = "";
    sPhone.value = "";
    sAddr.value = "";
    sGst.value = "";

    // ✅ Go back to login screen
    showLogin();

  }catch(e){

    alert("Signup failed");

  }finally{

    showLoader(false);

  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}


function toggleSidebar(){
  document.querySelector(".sidebar").classList.toggle("open");
  document.getElementById("sidebarOverlay").classList.toggle("show");
}

/* mobile shop name */
const mShop = document.getElementById("mobileShopName");
if(mShop){
  mShop.innerText = localStorage.getItem("shopName") || "VyaparX";
}

