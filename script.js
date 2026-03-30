const SUPABASE_URL = "https://hrcprceresaiqdmlwmqe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyY3ByY2VyZXNhaXFkbWx3bXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTM2MDQsImV4cCI6MjA5MDQyOTYwNH0.T1FypV5K7rSuAZ0NCgd8Jr7mUu3_EI6zxkLp1H2wkV8";

const ENABLE_REALTIME_SYNC = true;

const defaultSettings = {
  id: null,
  pricePerLb: 9,
  maxPerSlot: 60,
  cornPrice: 0.5,
  sausagePrice: 1.5,
  potatoPrice: 0.75
};

let supabaseClient = null;
let settings = { ...defaultSettings };
let timeSlots = [];
let orders = [];
let editingOrderId = null;
let settingsSaveTimer = null;
let realtimeChannel = null;
let isInitializing = true;

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
const settingsPanel = document.getElementById("settingsPanel");

const pricePerLbInput = document.getElementById("pricePerLb");
const maxPerSlotInput = document.getElementById("maxPerSlot");
const cornPriceInput = document.getElementById("cornPrice");
const sausagePriceInput = document.getElementById("sausagePrice");
const potatoPriceInput = document.getElementById("potatoPrice");

const newSlotStartInput = document.getElementById("newSlotStart");
const newSlotEndInput = document.getElementById("newSlotEnd");
const addTimeSlotBtn = document.getElementById("addTimeSlotBtn");
const timeSlotList = document.getElementById("timeSlotList");

const orderDateInput = document.getElementById("orderDate");
const timeSlotSelect = document.getElementById("timeSlot");
const customerNameInput = document.getElementById("customerName");
const customerInfoInput = document.getElementById("customerInfo");
const weightInput = document.getElementById("weight");
const spiceLevelInput = document.getElementById("spiceLevel");
const paymentStatusInput = document.getElementById("paymentStatus");
const orderTypeInput = document.getElementById("orderType");
const notesInput = document.getElementById("notes");

const cornQtyInput = document.getElementById("cornQty");
const sausageQtyInput = document.getElementById("sausageQty");
const potatoQtyInput = document.getElementById("potatoQty");

const cornSubtotalSpan = document.getElementById("cornSubtotal");
const sausageSubtotalSpan = document.getElementById("sausageSubtotal");
const potatoSubtotalSpan = document.getElementById("potatoSubtotal");

const crawfishTotalSpan = document.getElementById("crawfishTotal");
const sidesTotalSpan = document.getElementById("sidesTotal");
const grandTotalSpan = document.getElementById("grandTotal");
const slotAvailabilityEl = document.getElementById("slotAvailability");
const slotVisualizer = document.getElementById("slotVisualizer");

const saveOrderBtn = document.getElementById("saveOrderBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const formMessage = document.getElementById("formMessage");

const ordersDateFilterInput = document.getElementById("ordersDateFilter");
const searchCustomerInput = document.getElementById("searchCustomer");
const ordersSlotSummary = document.getElementById("ordersSlotSummary");
const ordersList = document.getElementById("ordersList");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const clearOrdersBtn = document.getElementById("clearOrdersBtn");

init();

async function init() {
  bindEvents();

  const today = getTodayString();
  orderDateInput.value = today;
  ordersDateFilterInput.value = today;

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    showFormMessage("Supabase library did not load. Check the script tag in index.html.", true);
    return;
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_URL.includes("PASTE_YOUR") ||
    SUPABASE_ANON_KEY.includes("PASTE_YOUR")
  ) {
    showFormMessage("Paste your Supabase URL and anon key at the top of script.js first.", true);
    return;
  }

  try {
    setUiDisabled(true);
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    await loadAllFromDatabase();
    fillSettingsInputs();
    populateTimeSlotSelect();
    renderTimeSlotChips();
    updateTotalsPreview();
    renderSlotVisualizer();
    renderOrdersPage();

    if (ENABLE_REALTIME_SYNC) {
      await setupRealtime();
    }

    isInitializing = false;
    showFormMessage(
      ENABLE_REALTIME_SYNC
        ? "Connected to Supabase. Real-time sync is on."
        : "Connected to Supabase."
    );
  } catch (error) {
    console.error(error);
    showFormMessage(`Supabase connection failed: ${error.message}`, true);
  } finally {
    setUiDisabled(false);
  }
}

function bindEvents() {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  toggleSettingsBtn.addEventListener("click", toggleSettingsVisibility);
  addTimeSlotBtn.addEventListener("click", handleAddTimeSlot);

  [
    pricePerLbInput,
    maxPerSlotInput,
    cornPriceInput,
    sausagePriceInput,
    potatoPriceInput
  ].forEach((input) => {
    input.addEventListener("input", handleSettingsChange);
  });

  [
    orderDateInput,
    timeSlotSelect,
    weightInput,
    cornQtyInput,
    sausageQtyInput,
    potatoQtyInput
  ].forEach((input) => {
    input.addEventListener("input", () => {
      updateTotalsPreview();
      renderSlotVisualizer();
    });
    input.addEventListener("change", () => {
      updateTotalsPreview();
      renderSlotVisualizer();
    });
  });

  saveOrderBtn.addEventListener("click", handleSaveOrder);
  cancelEditBtn.addEventListener("click", cancelEdit);

  ordersDateFilterInput.addEventListener("change", renderOrdersPage);
  searchCustomerInput.addEventListener("input", renderOrdersPage);

  exportCsvBtn.addEventListener("click", exportFilteredOrdersToCSV);
  clearOrdersBtn.addEventListener("click", clearAllOrders);
}

async function loadAllFromDatabase() {
  const [settingsRow, slotRows, orderRows] = await Promise.all([
    fetchSettingsFromDb(),
    fetchTimeSlotsFromDb(),
    fetchOrdersFromDb()
  ]);

  settings = settingsRow;
  timeSlots = slotRows;
  orders = orderRows.map(mapDbOrderToUiOrder);
}

async function fetchSettingsFromDb() {
  const { data, error } = await supabaseClient
    .from("business_settings")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No row found in business_settings. Run the SQL seed block first.");

  return {
    id: data.id,
    pricePerLb: Number(data.price_per_lb ?? defaultSettings.pricePerLb),
    maxPerSlot: Number(data.max_per_slot ?? defaultSettings.maxPerSlot),
    cornPrice: Number(data.corn_price ?? defaultSettings.cornPrice),
    sausagePrice: Number(data.sausage_price ?? defaultSettings.sausagePrice),
    potatoPrice: Number(data.potato_price ?? defaultSettings.potatoPrice)
  };
}

async function fetchTimeSlotsFromDb() {
  const { data, error } = await supabaseClient
    .from("time_slots")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;

  return (data || []).map((slot) => ({
    id: slot.id,
    start: slot.start_time,
    end: slot.end_time,
    sortOrder: slot.sort_order ?? 0
  }));
}

async function fetchOrdersFromDb() {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

function mapDbOrderToUiOrder(order) {
  return {
    id: order.id,
    name: order.customer_name,
    info: order.customer_info || "",
    date: order.order_date,
    timeSlotId: order.time_slot_id,
    timeSlotLabel: order.time_slot_label,
    slotStart: order.slot_start,
    slotEnd: order.slot_end,
    weight: Number(order.weight || 0),
    spiceLevel: order.spice_level || "Medium",
    paymentStatus: order.payment_status || "Unpaid",
    orderType: order.order_type || "Pickup",
    isPickupPending: Boolean(order.is_pickup_pending),
    notes: order.notes || "",
    sides: {
      cornQty: Number(order.corn_qty || 0),
      sausageQty: Number(order.sausage_qty || 0),
      potatoQty: Number(order.potato_qty || 0),
      cornPrice: Number(order.corn_price || 0),
      sausagePrice: Number(order.sausage_price || 0),
      potatoPrice: Number(order.potato_price || 0),
      sidesTotal: Number(order.sides_total || 0)
    },
    crawfishPricePerLb: Number(order.crawfish_price_per_lb || 0),
    crawfishTotal: Number(order.crawfish_total || 0),
    grandTotal: Number(order.grand_total || 0),
    createdAt: order.created_at,
    updatedAt: order.updated_at
  };
}

function switchTab(tabId) {
  tabButtons.forEach((btn) => btn.classList.remove("active"));
  tabPanels.forEach((panel) => panel.classList.remove("active"));

  document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add("active");
  document.getElementById(tabId).classList.add("active");

  if (tabId === "ordersTab") {
    renderOrdersPage();
  } else {
    renderSlotVisualizer();
  }
}

function fillSettingsInputs() {
  pricePerLbInput.value = settings.pricePerLb;
  maxPerSlotInput.value = settings.maxPerSlot;
  cornPriceInput.value = settings.cornPrice;
  sausagePriceInput.value = settings.sausagePrice;
  potatoPriceInput.value = settings.potatoPrice;
}

function handleSettingsChange() {
  settings.pricePerLb = parseFloat(pricePerLbInput.value) || 0;
  settings.maxPerSlot = parseFloat(maxPerSlotInput.value) || 0;
  settings.cornPrice = parseFloat(cornPriceInput.value) || 0;
  settings.sausagePrice = parseFloat(sausagePriceInput.value) || 0;
  settings.potatoPrice = parseFloat(potatoPriceInput.value) || 0;

  updateTotalsPreview();
  renderSlotVisualizer();
  renderOrdersPage();

  if (!isInitializing) {
    queueSettingsSave();
  }
}

function queueSettingsSave() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    try {
      const { error } = await supabaseClient
        .from("business_settings")
        .update({
          price_per_lb: settings.pricePerLb,
          max_per_slot: settings.maxPerSlot,
          corn_price: settings.cornPrice,
          sausage_price: settings.sausagePrice,
          potato_price: settings.potatoPrice
        })
        .eq("id", settings.id);

      if (error) throw error;
      showFormMessage("Settings saved.");
    } catch (error) {
      console.error(error);
      showFormMessage(`Could not save settings: ${error.message}`, true);
    }
  }, 300);
}

function toggleSettingsVisibility() {
  settingsPanel.classList.toggle("hidden-panel");
  const hidden = settingsPanel.classList.contains("hidden-panel");
  toggleSettingsBtn.textContent = hidden ? "Show Settings" : "Hide Settings";
}

function getSortedTimeSlots() {
  return [...timeSlots].sort((a, b) => {
    const sortCompare = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (sortCompare !== 0) return sortCompare;
    return String(a.start).localeCompare(String(b.start));
  });
}

function populateTimeSlotSelect() {
  const currentValue = timeSlotSelect.value;
  timeSlotSelect.innerHTML = `<option value="">Select a slot</option>`;

  getSortedTimeSlots().forEach((slot) => {
    const option = document.createElement("option");
    option.value = slot.id;
    option.textContent = formatSlotLabel(slot.start, slot.end);
    timeSlotSelect.appendChild(option);
  });

  if ([...timeSlotSelect.options].some((opt) => opt.value === currentValue)) {
    timeSlotSelect.value = currentValue;
  }
}

function renderTimeSlotChips() {
  timeSlotList.innerHTML = "";

  if (!timeSlots.length) {
    timeSlotList.innerHTML = `<div class="empty-state">No time slots yet.</div>`;
    return;
  }

  getSortedTimeSlots().forEach((slot) => {
    const chip = document.createElement("div");
    chip.className = "slot-chip";
    chip.innerHTML = `
      <span>${formatSlotLabel(slot.start, slot.end)}</span>
      <button type="button" class="delete-chip-btn" data-id="${slot.id}">x</button>
    `;

    chip.querySelector(".delete-chip-btn").addEventListener("click", async () => {
      await removeTimeSlot(slot.id);
    });

    timeSlotList.appendChild(chip);
  });
}

async function handleAddTimeSlot() {
  const start = newSlotStartInput.value;
  const end = newSlotEndInput.value;

  if (!start || !end) {
    alert("Please choose both start and end time.");
    return;
  }

  if (start >= end) {
    alert("End time must be later than start time.");
    return;
  }

  const exists = timeSlots.some((slot) => slot.start === start && slot.end === end);
  if (exists) {
    alert("That time slot already exists.");
    return;
  }

  try {
    const nextSortOrder = timeSlots.length
      ? Math.max(...timeSlots.map((slot) => Number(slot.sortOrder || 0))) + 1
      : 1;

    const { error } = await supabaseClient.from("time_slots").insert({
      start_time: start,
      end_time: end,
      sort_order: nextSortOrder
    });

    if (error) throw error;

    timeSlots = await fetchTimeSlotsFromDb();
    populateTimeSlotSelect();
    renderTimeSlotChips();
    renderSlotVisualizer();

    newSlotStartInput.value = "";
    newSlotEndInput.value = "";
  } catch (error) {
    console.error(error);
    alert(`Could not add time slot: ${error.message}`);
  }
}

async function removeTimeSlot(slotId) {
  const inUse = orders.some((order) => order.timeSlotId === slotId);
  if (inUse) {
    alert("This time slot is used by existing orders. Delete or move those orders first.");
    return;
  }

  const ok = confirm("Delete this time slot?");
  if (!ok) return;

  try {
    const { error } = await supabaseClient.from("time_slots").delete().eq("id", slotId);
    if (error) throw error;

    timeSlots = await fetchTimeSlotsFromDb();
    populateTimeSlotSelect();
    renderTimeSlotChips();
    renderSlotVisualizer();
  } catch (error) {
    console.error(error);
    alert(`Could not delete time slot: ${error.message}`);
  }
}

function getSidesTotal() {
  const cornQty = parseInt(cornQtyInput.value, 10) || 0;
  const sausageQty = parseInt(sausageQtyInput.value, 10) || 0;
  const potatoQty = parseInt(potatoQtyInput.value, 10) || 0;

  return (
    cornQty * settings.cornPrice +
    sausageQty * settings.sausagePrice +
    potatoQty * settings.potatoPrice
  );
}

function getCrawfishTotal() {
  const weight = parseFloat(weightInput.value) || 0;
  return weight * settings.pricePerLb;
}

function updateTotalsPreview() {
  const cornQty = parseInt(cornQtyInput.value, 10) || 0;
  const sausageQty = parseInt(sausageQtyInput.value, 10) || 0;
  const potatoQty = parseInt(potatoQtyInput.value, 10) || 0;

  const cornSubtotal = cornQty * settings.cornPrice;
  const sausageSubtotal = sausageQty * settings.sausagePrice;
  const potatoSubtotal = potatoQty * settings.potatoPrice;
  const crawfishTotal = getCrawfishTotal();
  const sidesTotal = cornSubtotal + sausageSubtotal + potatoSubtotal;
  const grandTotal = crawfishTotal + sidesTotal;

  cornSubtotalSpan.textContent = cornSubtotal.toFixed(2);
  sausageSubtotalSpan.textContent = sausageSubtotal.toFixed(2);
  potatoSubtotalSpan.textContent = potatoSubtotal.toFixed(2);
  crawfishTotalSpan.textContent = crawfishTotal.toFixed(2);
  sidesTotalSpan.textContent = sidesTotal.toFixed(2);
  grandTotalSpan.textContent = grandTotal.toFixed(2);

  updateSlotAvailabilityMessage();
}

function updateSlotAvailabilityMessage() {
  const date = orderDateInput.value;
  const timeSlotId = timeSlotSelect.value;
  const newWeight = parseFloat(weightInput.value) || 0;

  if (!date || !timeSlotId) {
    slotAvailabilityEl.textContent = "Choose date and slot to see availability.";
    return;
  }

  const taken = getTakenWeightForDateAndSlot(date, timeSlotId, editingOrderId);
  const remaining = settings.maxPerSlot - taken;
  const afterSave = remaining - newWeight;

  slotAvailabilityEl.textContent =
    `Taken: ${taken.toFixed(1)} lbs | Remaining: ${remaining.toFixed(1)} lbs` +
    (newWeight > 0 ? ` | After this order: ${afterSave.toFixed(1)} lbs` : "");
}

function resetForm() {
  editingOrderId = null;
  customerNameInput.value = "";
  customerInfoInput.value = "";
  weightInput.value = "";
  spiceLevelInput.value = "Medium";
  paymentStatusInput.value = "Unpaid";
  orderTypeInput.value = "Pickup";
  notesInput.value = "";
  cornQtyInput.value = 0;
  sausageQtyInput.value = 0;
  potatoQtyInput.value = 0;
  cancelEditBtn.classList.add("hidden");
  saveOrderBtn.textContent = "Add Order";
  formMessage.textContent = "";
  updateTotalsPreview();
}

function fillFormForEdit(order) {
  if (!order) return;

  editingOrderId = order.id;
  orderDateInput.value = order.date;
  timeSlotSelect.value = order.timeSlotId;
  customerNameInput.value = order.name;
  customerInfoInput.value = order.info || "";
  weightInput.value = order.weight;
  spiceLevelInput.value = order.spiceLevel;
  paymentStatusInput.value = order.paymentStatus;
  orderTypeInput.value = order.orderType;
  notesInput.value = order.notes || "";
  cornQtyInput.value = order.sides.cornQty;
  sausageQtyInput.value = order.sides.sausageQty;
  potatoQtyInput.value = order.sides.potatoQty;

  cancelEditBtn.classList.remove("hidden");
  saveOrderBtn.textContent = "Update Order";

  updateTotalsPreview();
  renderSlotVisualizer();
  switchTab("calculatorTab");
  showFormMessage(`Editing order for ${order.name}`);
}

function cancelEdit() {
  resetForm();
  renderSlotVisualizer();
}

async function handleSaveOrder() {
  const date = orderDateInput.value;
  const timeSlotId = timeSlotSelect.value;
  const name = customerNameInput.value.trim();
  const info = customerInfoInput.value.trim();
  const weight = parseFloat(weightInput.value) || 0;
  const spiceLevel = spiceLevelInput.value;
  const paymentStatus = paymentStatusInput.value;
  const orderType = orderTypeInput.value;
  const notes = notesInput.value.trim();

  const cornQty = parseInt(cornQtyInput.value, 10) || 0;
  const sausageQty = parseInt(sausageQtyInput.value, 10) || 0;
  const potatoQty = parseInt(potatoQtyInput.value, 10) || 0;

  if (!date) {
    showFormMessage("Please choose a date.", true);
    return;
  }

  if (!name) {
    showFormMessage("Please enter customer name.", true);
    return;
  }

  if (!timeSlotId) {
    showFormMessage("Please choose a time slot.", true);
    return;
  }

  if (!weight || weight <= 0) {
    showFormMessage("Please enter a valid crawfish weight.", true);
    return;
  }

  const existingTaken = getTakenWeightForDateAndSlot(date, timeSlotId, editingOrderId);
  const available = settings.maxPerSlot - existingTaken;
  if (weight > available) {
    showFormMessage(`Not enough capacity in that slot. Only ${available.toFixed(1)} lbs left.`, true);
    return;
  }

  const timeSlot = timeSlots.find((slot) => slot.id === timeSlotId);
  if (!timeSlot) {
    showFormMessage("Selected time slot was not found.", true);
    return;
  }

  const crawfishTotal = getCrawfishTotal();
  const sidesTotal = getSidesTotal();
  const grandTotal = crawfishTotal + sidesTotal;

  const payload = {
    customer_name: name,
    customer_info: info,
    order_date: date,
    time_slot_id: timeSlotId,
    time_slot_label: formatSlotLabel(timeSlot.start, timeSlot.end),
    slot_start: timeSlot.start,
    slot_end: timeSlot.end,
    weight,
    spice_level: spiceLevel,
    payment_status: paymentStatus,
    order_type: orderType,
    is_pickup_pending: orderType === "Pickup",
    notes,
    corn_qty: cornQty,
    sausage_qty: sausageQty,
    potato_qty: potatoQty,
    corn_price: settings.cornPrice,
    sausage_price: settings.sausagePrice,
    potato_price: settings.potatoPrice,
    sides_total: sidesTotal,
    crawfish_price_per_lb: settings.pricePerLb,
    crawfish_total: crawfishTotal,
    grand_total: grandTotal
  };

  try {
    if (editingOrderId) {
      const { error } = await supabaseClient.from("orders").update(payload).eq("id", editingOrderId);
      if (error) throw error;
      showFormMessage("Order updated.");
    } else {
      const { error } = await supabaseClient.from("orders").insert(payload);
      if (error) throw error;
      showFormMessage("Order added.");
    }

    const orderRows = await fetchOrdersFromDb();
    orders = orderRows.map(mapDbOrderToUiOrder);
    resetForm();
    renderSlotVisualizer();
    renderOrdersPage();
  } catch (error) {
    console.error(error);
    showFormMessage(`Could not save order: ${error.message}`, true);
  }
}

function renderOrdersPage() {
  renderOrdersSlotSummary();
  renderOrdersList();
}

function getFilteredOrdersForOrdersPage() {
  const selectedDate = ordersDateFilterInput.value;
  const searchTerm = searchCustomerInput.value.trim().toLowerCase();

  return orders
    .filter((order) => !selectedDate || order.date === selectedDate)
    .filter((order) => order.name.toLowerCase().includes(searchTerm))
    .sort((a, b) => {
      if (a.isPickupPending !== b.isPickupPending) {
        return a.isPickupPending ? -1 : 1;
      }

      const slotCompare = String(a.slotStart || "").localeCompare(String(b.slotStart || ""));
      if (slotCompare !== 0) return slotCompare;

      return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

function renderOrdersList() {
  const filteredOrders = getFilteredOrdersForOrdersPage();
  ordersList.innerHTML = "";

  if (!filteredOrders.length) {
    ordersList.innerHTML = `<div class="empty-state">No orders found for this filter.</div>`;
    return;
  }

  filteredOrders.forEach((order) => {
    const pickupPending = Boolean(order.isPickupPending);
    const card = document.createElement("div");
    card.className = "order-card";

    card.innerHTML = `
      <div class="order-top">
        <div>
          <div class="order-name">${escapeHtml(order.name)}</div>
          <div class="muted">${escapeHtml(order.timeSlotLabel)} | ${escapeHtml(order.date)}</div>
        </div>

        <div class="badges">
          <span class="badge ${order.paymentStatus === "Paid" ? "paid" : "unpaid"}">
            ${escapeHtml(order.paymentStatus)}
          </span>
          <span class="badge type">${escapeHtml(order.orderType)}</span>
          <span class="badge ${pickupPending ? "pickup-pending" : "pickup-done"}">
            ${pickupPending ? "Waiting Pickup" : "Picked Up"}
          </span>
        </div>
      </div>

      <div class="order-grid">
        <div><strong>Contact:</strong> ${escapeHtml(order.info || "-")}</div>
        <div><strong>Weight:</strong> ${order.weight.toFixed(1)} lbs</div>
        <div><strong>Spice:</strong> ${escapeHtml(order.spiceLevel)}</div>
        <div><strong>Crawfish Total:</strong> $${order.crawfishTotal.toFixed(2)}</div>
        <div><strong>Sides:</strong> Corn ${order.sides.cornQty}, Sausage ${order.sides.sausageQty}, Potato ${order.sides.potatoQty}</div>
        <div><strong>Sides Total:</strong> $${order.sides.sidesTotal.toFixed(2)}</div>
        <div><strong>Grand Total:</strong> $${order.grandTotal.toFixed(2)}</div>
        <div><strong>Created:</strong> ${formatDateTime(order.createdAt)}</div>
      </div>

      <div class="order-notes">
        <strong>Notes:</strong> ${escapeHtml(order.notes || "-")}
      </div>

      <div class="order-actions">
        <button class="small-btn edit-btn" data-id="${order.id}">Edit</button>
        <button class="small-btn toggle-paid-btn" data-id="${order.id}">
          Mark as ${order.paymentStatus === "Paid" ? "Unpaid" : "Paid"}
        </button>
        <button class="small-btn toggle-pickup-btn" data-id="${order.id}">
          ${order.isPickupPending ? "Mark Picked Up" : "Move Back to Pickup"}
        </button>
        <button class="small-btn delete-btn" data-id="${order.id}">Delete</button>
      </div>
    `;

    card.querySelector(".edit-btn").addEventListener("click", () => {
      const target = orders.find((item) => item.id === order.id);
      fillFormForEdit(target);
    });

    card.querySelector(".toggle-paid-btn").addEventListener("click", () => {
      togglePaidStatus(order.id);
    });

    card.querySelector(".toggle-pickup-btn").addEventListener("click", () => {
      togglePickupStatus(order.id);
    });

    card.querySelector(".delete-btn").addEventListener("click", () => {
      deleteOrder(order.id);
    });

    ordersList.appendChild(card);
  });
}

function renderOrdersSlotSummary() {
  const date = ordersDateFilterInput.value;
  ordersSlotSummary.innerHTML = "";

  if (!date) {
    ordersSlotSummary.innerHTML = `<div class="empty-state">Choose a date to see slot capacity.</div>`;
    return;
  }

  getSortedTimeSlots().forEach((slot) => {
    const taken = getTakenWeightForDateAndSlot(date, slot.id);
    const available = settings.maxPerSlot - taken;
    const statusClass = getSlotStatusClass(taken, settings.maxPerSlot);

    const div = document.createElement("div");
    div.className = `slot-card ${statusClass}`;
    div.innerHTML = `
      <h4>${formatSlotLabel(slot.start, slot.end)}</h4>
      <div class="line"><span>Taken</span><strong>${taken.toFixed(1)} lbs</strong></div>
      <div class="line"><span>Available</span><strong>${available.toFixed(1)} lbs</strong></div>
      <div class="line"><span>Max</span><strong>${settings.maxPerSlot.toFixed(1)} lbs</strong></div>
    `;
    ordersSlotSummary.appendChild(div);
  });
}

async function togglePaidStatus(orderId) {
  const target = orders.find((order) => order.id === orderId);
  if (!target) return;

  try {
    const { error } = await supabaseClient
      .from("orders")
      .update({
        payment_status: target.paymentStatus === "Paid" ? "Unpaid" : "Paid"
      })
      .eq("id", orderId);

    if (error) throw error;

    const orderRows = await fetchOrdersFromDb();
    orders = orderRows.map(mapDbOrderToUiOrder);
    renderOrdersPage();
  } catch (error) {
    console.error(error);
    showFormMessage(`Could not update payment status: ${error.message}`, true);
  }
}

async function togglePickupStatus(orderId) {
  const target = orders.find((order) => order.id === orderId);
  if (!target) return;

  try {
    const { error } = await supabaseClient
      .from("orders")
      .update({
        is_pickup_pending: !target.isPickupPending
      })
      .eq("id", orderId);

    if (error) throw error;

    const orderRows = await fetchOrdersFromDb();
    orders = orderRows.map(mapDbOrderToUiOrder);
    renderOrdersPage();
  } catch (error) {
    console.error(error);
    showFormMessage(`Could not update pickup status: ${error.message}`, true);
  }
}

async function deleteOrder(orderId) {
  const ok = confirm("Delete this order?");
  if (!ok) return;

  try {
    const { error } = await supabaseClient.from("orders").delete().eq("id", orderId);
    if (error) throw error;

    const orderRows = await fetchOrdersFromDb();
    orders = orderRows.map(mapDbOrderToUiOrder);

    if (editingOrderId === orderId) {
      resetForm();
    }

    renderSlotVisualizer();
    renderOrdersPage();
    showFormMessage("Order deleted.");
  } catch (error) {
    console.error(error);
    showFormMessage(`Could not delete order: ${error.message}`, true);
  }
}

async function clearAllOrders() {
  const ok = confirm("Are you sure you want to delete all orders?");
  if (!ok) return;

  try {
    const { error } = await supabaseClient.from("orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;

    orders = [];
    resetForm();
    renderSlotVisualizer();
    renderOrdersPage();
    showFormMessage("All orders deleted.");
  } catch (error) {
    console.error(error);
    showFormMessage(`Could not clear orders: ${error.message}`, true);
  }
}

function renderSlotVisualizer() {
  const date = orderDateInput.value;
  slotVisualizer.innerHTML = "";

  if (!date) {
    slotVisualizer.innerHTML = `<div class="empty-state">Choose a date to see slot capacity.</div>`;
    return;
  }

  getSortedTimeSlots().forEach((slot) => {
    const taken = getTakenWeightForDateAndSlot(date, slot.id);
    const available = settings.maxPerSlot - taken;
    const statusClass = getSlotStatusClass(taken, settings.maxPerSlot);

    const div = document.createElement("div");
    div.className = `slot-card ${statusClass}`;
    div.innerHTML = `
      <h4>${formatSlotLabel(slot.start, slot.end)}</h4>
      <div class="line"><span>Taken</span><strong>${taken.toFixed(1)} lbs</strong></div>
      <div class="line"><span>Available</span><strong>${available.toFixed(1)} lbs</strong></div>
      <div class="line"><span>Max</span><strong>${settings.maxPerSlot.toFixed(1)} lbs</strong></div>
    `;
    slotVisualizer.appendChild(div);
  });
}

function getSlotStatusClass(taken, max) {
  if (taken >= max) return "full";
  if (taken > 0) return "partial";
  return "available";
}

function getTakenWeightForDateAndSlot(date, slotId, excludeOrderId = null) {
  return orders
    .filter((order) => order.date === date && order.timeSlotId === slotId)
    .filter((order) => order.id !== excludeOrderId)
    .reduce((sum, order) => sum + Number(order.weight), 0);
}

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSlotLabel(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatTime(time24) {
  const [hourStr, minuteStr] = time24.split(":");
  const hour = Number(hourStr);
  const minute = minuteStr;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${suffix}`;
}

function formatDateTime(isoString) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  return date.toLocaleString();
}

function showFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.style.color = isError ? "#b91c1c" : "#15803d";
}

function setUiDisabled(disabled) {
  [
    toggleSettingsBtn,
    addTimeSlotBtn,
    saveOrderBtn,
    cancelEditBtn,
    exportCsvBtn,
    clearOrdersBtn,
    pricePerLbInput,
    maxPerSlotInput,
    cornPriceInput,
    sausagePriceInput,
    potatoPriceInput,
    newSlotStartInput,
    newSlotEndInput,
    orderDateInput,
    timeSlotSelect,
    customerNameInput,
    customerInfoInput,
    weightInput,
    spiceLevelInput,
    paymentStatusInput,
    orderTypeInput,
    notesInput,
    cornQtyInput,
    sausageQtyInput,
    potatoQtyInput,
    ordersDateFilterInput,
    searchCustomerInput
  ].forEach((el) => {
    if (el) el.disabled = disabled;
  });
}

function exportFilteredOrdersToCSV() {
  const rows = getFilteredOrdersForOrdersPage();

  if (!rows.length) {
    alert("No orders to export for the current filter.");
    return;
  }

  const headers = [
    "Date",
    "Time Slot",
    "Customer Name",
    "Contact Info",
    "Weight (lbs)",
    "Crawfish Price Per Lb",
    "Crawfish Total",
    "Corn Qty",
    "Sausage Qty",
    "Potato Qty",
    "Sides Total",
    "Grand Total",
    "Payment Status",
    "Order Type",
    "Spice Level",
    "Notes",
    "Created At",
    "Updated At"
  ];

  const csvRows = rows.map((order) => [
    order.date,
    order.timeSlotLabel,
    order.name,
    order.info,
    order.weight,
    order.crawfishPricePerLb,
    order.crawfishTotal,
    order.sides.cornQty,
    order.sides.sausageQty,
    order.sides.potatoQty,
    order.sides.sidesTotal,
    order.grandTotal,
    order.paymentStatus,
    order.orderType,
    order.spiceLevel,
    order.notes,
    order.createdAt,
    order.updatedAt || ""
  ]);

  const csvContent = [headers, ...csvRows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const selectedDate = ordersDateFilterInput.value || "all-dates";
  const link = document.createElement("a");
  link.href = url;
  link.download = `crawfish-orders-${selectedDate}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

async function setupRealtime() {
  if (!supabaseClient) return;

  if (realtimeChannel) {
    await supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel("crawfish-live-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "business_settings" },
      async () => {
        settings = await fetchSettingsFromDb();
        fillSettingsInputs();
        updateTotalsPreview();
        renderSlotVisualizer();
        renderOrdersPage();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "time_slots" },
      async () => {
        timeSlots = await fetchTimeSlotsFromDb();
        populateTimeSlotSelect();
        renderTimeSlotChips();
        updateTotalsPreview();
        renderSlotVisualizer();
        renderOrdersPage();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      async () => {
        const orderRows = await fetchOrdersFromDb();
        orders = orderRows.map(mapDbOrderToUiOrder);
        renderSlotVisualizer();
        renderOrdersPage();
      }
    )
    .subscribe((status) => {
      console.log("Realtime status:", status);
    });
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
    .then(() => console.log("SW registered"));
}