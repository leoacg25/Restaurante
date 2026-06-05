/**
 * GastroPOS - Single Page Application Core Logic
 * Vanilla JavaScript (ES6+) for POS & Inventory Recipe Management
 */

// ==========================================================================
// FIREBASE CONFIGURATION
// ==========================================================================
// Para compartir datos en tiempo real entre varios equipos:
// 1. Crea un proyecto en https://console.firebase.google.com
// 2. Activa Realtime Database (elige "modo test" para empezar)
// 3. Ve a "Configuración del proyecto → General → Tus apps → Web"
// 4. Copia aquí los valores de tu configuración
// Si dejas los placeholders, la app funciona solo con localStorage.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAqskEVToB1bb6bnilDPzxqDwWw0jhYukg",
  authDomain: "realtime-database-a3cc6.firebaseapp.com",
  databaseURL: "https://realtime-database-a3cc6-default-rtdb.firebaseio.com",
  projectId: "realtime-database-a3cc6",
  storageBucket: "realtime-database-a3cc6.firebasestorage.app",
  messagingSenderId: "1015674973637",
  appId: "1:1015674973637:web:37b7ea00aa79728455afac"
};

let firebaseDb = null;
let firebaseReady = false;

function initFirebase() {
  if (typeof firebase === 'undefined' || !FIREBASE_CONFIG.apiKey.startsWith('AIzaSy')) return;
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    firebaseDb = firebase.database();
    firebaseReady = true;
  } catch (e) {
    console.warn('Firebase init failed, using localStorage only:', e);
  }
}

// Sync keys that are SHARED across devices (not per-session)
const FIREBASE_SYNC_KEYS = [
  'gastropos_items', 'gastropos_saved_orders', 'gastropos_waiters',
  'gastropos_sales', 'gastropos_users', 'gastropos_table_count',
  'gastropos_rate', 'gastropos_ref_currency'
];

function handleFirebaseUpdate(key, snap) {
  const val = snap.val();
  if (val === null) return;
  const localRaw = localStorage.getItem(key);
  const remoteStr = JSON.stringify(val);
  if (remoteStr === localRaw) return; // Already in sync — skip feedback loop
  localStorage.setItem(key, remoteStr);
  // Update in-memory variable + re-render
  switch (key) {
    case 'gastropos_items':
      items = val;
      renderInventoryTable();
      renderPOSGrid();
      if (typeof recalculateAllRecipes === 'function') recalculateAllRecipes();
      break;
    case 'gastropos_saved_orders':
      savedOrders = Array.isArray(val) ? val : [];
      renderTableMap();
      updateSavedOrdersBadge();
      break;
    case 'gastropos_waiters':
      waiters = val;
      populateWaiterSelect();
      if (currentTab === 'settings') renderWaiterList();
      break;
    case 'gastropos_sales':
      salesHistory = val;
      if (currentTab === 'history') renderSalesHistory();
      break;
    case 'gastropos_users':
      loadUsers();
      if (currentTab === 'settings') renderUserList();
      break;
    case 'gastropos_table_count':
      tableCount = val;
      document.getElementById('table-count-display').textContent = tableCount;
      renderTableMap();
      break;
    case 'gastropos_rate':
      exchangeRate = val;
      document.getElementById('exchange-rate-val').value = val.toFixed(2);
      renderPOSGrid();
      renderOrder();
      renderInventoryTable();
      break;
    case 'gastropos_ref_currency':
      referenceCurrency = val;
      document.getElementById('currency-ref-select').value = val;
      updateCurrencyLabels();
      break;
  }
}

function subscribeFirebaseAll() {
  if (!firebaseReady) return;
  FIREBASE_SYNC_KEYS.forEach(key => {
    firebaseDb.ref(key).on('value', snap => handleFirebaseUpdate(key, snap));
  });
}

function firebaseSet(key, data) {
  if (firebaseReady) firebaseDb.ref(key).set(data).catch(() => {});
}

// ==========================================================================
// 1. STATE MANAGEMENT & DEFAULTS
// ==========================================================================

let items = [];
let currentOrder = [];
let editingItemId = null;
let currentTab = 'pos';
let activePOSFilter = 'all';

// Exchange rate and Venezuelan payment options
let exchangeRate = 36.50; // Initial fallback rate
let referenceCurrency = 'USD'; // Base reference currency: USD or EUR

// Pending transactions state (Comandas en espera)
let savedOrders = [];
let activeSavedOrderId = null; // ID of saved order being edited, null if new order
let selectedTable = null; // Name of the currently selected table (e.g. "Mesa 3")
let tableCount = 12; // Number of tables in the map

// Payment state in modal
let paymentMethod = 'efectivo'; // 'efectivo' | 'transferencia' | 'mixto'
let paymentDetails = {
  efectivo: { received: 0, currency: 'Bs' },
  transferencia: { refCode: '' },
  mixto: { transferAmount: 0, cashAmount: 0 }
};

// Waiters
let waiters = ['Mesero 1', 'Mesero 2', 'Mesero 3', 'Mesero 4', 'Mesero 5'];

// Sales history (completed payments)
let salesHistory = [];

// Default items loaded if LocalStorage is empty (stored in reference units, e.g., USD/EUR)
const DEFAULT_ITEMS = [
  // Artículos Simples
  { id: 's1', name: 'Refresco Coca Cola 350ml', type: 'simple', cost: 0.80, utility: 50.0, price: 1.20 },
  { id: 's2', name: 'Cerveza Corona Extra', type: 'simple', cost: 1.20, utility: 66.6, price: 2.00 },
  { id: 's3', name: 'Pan de Hamburguesa Brioche', type: 'simple', cost: 0.40, utility: 50.0, price: 0.60 },
  { id: 's4', name: 'Carne Molida de Res 150g', type: 'simple', cost: 1.50, utility: 60.0, price: 2.40 },
  { id: 's5', name: 'Queso Cheddar Rebanado', type: 'simple', cost: 0.25, utility: 60.0, price: 0.40 },
  { id: 's6', name: 'Papas Fritas Congeladas (Porción)', type: 'simple', cost: 0.60, utility: 150.0, price: 1.50 },
  
  // Recetas / Platos Compuestos
  { 
    id: 'r1', 
    name: 'Hamburguesa Clásica con Queso', 
    type: 'recipe', 
    cost: 2.15, // Brioche (0.40) + Carne (1.50) + Cheddar (0.25)
    utility: 100.0, 
    price: 4.30,
    ingredients: [
      { itemId: 's3', quantity: 1 },
      { itemId: 's4', quantity: 1 },
      { itemId: 's5', quantity: 1 }
    ]
  },
  { 
    id: 'r2', 
    name: 'Combo Hamburguesa Especial + Papas', 
    type: 'recipe', 
    cost: 2.75, // Hamburguesa (2.15) + Papas (0.60)
    utility: 118.18, 
    price: 6.00,
    ingredients: [
      { itemId: 's3', quantity: 1 },
      { itemId: 's4', quantity: 1 },
      { itemId: 's5', quantity: 1 },
      { itemId: 's6', quantity: 1 }
    ]
  }
];

// Load items from LocalStorage or initialize defaults
function initApp() {
  initFirebase(); // Initialize Firebase sync (works only if configured)
  const storedItems = localStorage.getItem('gastropos_items');
  if (storedItems) {
    try {
      items = JSON.parse(storedItems);
    } catch (e) {
      console.error('Error parsing stored items, loading defaults...', e);
      items = [...DEFAULT_ITEMS];
    }
  } else {
    items = [...DEFAULT_ITEMS];
    saveItemsToStorage();
  }
  
  // Load order if there's any active
  const storedOrder = localStorage.getItem('gastropos_current_order');
  if (storedOrder) {
    try {
      currentOrder = JSON.parse(storedOrder);
    } catch (e) {
      currentOrder = [];
    }
  }

  // Load saved pending orders (comandas en espera)
  const storedSavedOrders = localStorage.getItem('gastropos_saved_orders');
  if (storedSavedOrders) {
    try {
      savedOrders = JSON.parse(storedSavedOrders);
    } catch (e) {
      savedOrders = [];
    }
  }

  // Load active loaded saved order ID if any
  const storedActiveSavedId = localStorage.getItem('gastropos_active_saved_id');
  if (storedActiveSavedId) {
    activeSavedOrderId = storedActiveSavedId;
  }
  
  // Load active table if any
  const storedActiveTable = localStorage.getItem('gastropos_active_table');
  if (storedActiveTable) {
    selectedTable = storedActiveTable;
  }

  // Load table count
  const storedTableCount = localStorage.getItem('gastropos_table_count');
  if (storedTableCount) {
    tableCount = parseInt(storedTableCount, 10) || 12;
  }
  const tableCountDisplay = document.getElementById('table-count-display');
  if (tableCountDisplay) tableCountDisplay.textContent = tableCount;

  // Load exchange rate and reference currency
  const storedRate = localStorage.getItem('gastropos_rate');
  if (storedRate) {
    exchangeRate = parseFloat(storedRate) || 36.50;
  }
  const storedRefCurrency = localStorage.getItem('gastropos_ref_currency');
  if (storedRefCurrency) {
    referenceCurrency = storedRefCurrency;
  }

  // UI Setup for exchange rate
  const refCurrencySelect = document.getElementById('currency-ref-select');
  const rateInput = document.getElementById('exchange-rate-val');
  
  if (refCurrencySelect) refCurrencySelect.value = referenceCurrency;
  if (rateInput) rateInput.value = exchangeRate.toFixed(2);

  // Load waiters
  const storedWaiters = localStorage.getItem('gastropos_waiters');
  if (storedWaiters) {
    try {
      const parsed = JSON.parse(storedWaiters);
      if (Array.isArray(parsed) && parsed.length > 0) waiters = parsed;
    } catch (e) { /* ignore */ }
  }

  // Load sales history
  const storedSales = localStorage.getItem('gastropos_sales');
  if (storedSales) {
    try {
      salesHistory = JSON.parse(storedSales);
    } catch (e) { salesHistory = []; }
  }

  // Setup listeners for Exchange Rate UI
  if (refCurrencySelect) {
    refCurrencySelect.addEventListener('change', (e) => {
      referenceCurrency = e.target.value;
      localStorage.setItem('gastropos_ref_currency', referenceCurrency);
      firebaseSet('gastropos_ref_currency', referenceCurrency);
      updateCurrencyLabels();
      fetchExchangeRate(true);
    });
  }

  if (rateInput) {
    rateInput.addEventListener('input', (e) => {
      exchangeRate = parseFloat(e.target.value) || 0.01;
      localStorage.setItem('gastropos_rate', exchangeRate);
      firebaseSet('gastropos_rate', exchangeRate);
      renderPOSGrid();
      renderOrder();
      renderInventoryTable();
      if (selectedTable) {
        renderTableMap(); // Update totals on the map
      }
    });
  }

  const btnRefresh = document.getElementById('btn-refresh-rate');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchExchangeRate(false); // Manual fetch (show alerts)
    });
  }

  // MODAL INTERACTIVE CONTROLS
  
  // 1. Payment Modal Trigger (Pagar)
  const btnPay = document.getElementById('btn-pay-order');
  if (btnPay) {
    btnPay.addEventListener('click', () => {
      if (currentOrder.length === 0) {
        alert('No hay artículos en la orden para pagar.');
        return;
      }
      if (!selectedTable || selectedTable === 'Ninguna') {
        alert('Por favor seleccione una mesa primero.');
        return;
      }
      openPaymentModal();
    });
  }

  const btnClosePayModal = document.getElementById('btn-close-payment-modal');
  const btnCancelPay = document.getElementById('btn-cancel-payment');
  if (btnClosePayModal) btnClosePayModal.addEventListener('click', closePaymentModal);
  if (btnCancelPay) btnCancelPay.addEventListener('click', closePaymentModal);

  const modalPayMethodSelect = document.getElementById('modal-payment-method-select');
  if (modalPayMethodSelect) {
    modalPayMethodSelect.addEventListener('change', (e) => {
      paymentMethod = e.target.value;
      renderModalPaymentDetails();
    });
  }

  const btnConfirmPay = document.getElementById('btn-confirm-payment');
  if (btnConfirmPay) {
    btnConfirmPay.addEventListener('click', processPayment);
  }

  // 2. Saved Orders Modal Trigger (Comandas en Espera)
  const btnToggleSaved = document.getElementById('btn-toggle-saved');
  if (btnToggleSaved) {
    btnToggleSaved.addEventListener('click', () => {
      openSavedOrdersModal();
    });
  }

  const btnCloseSavedModal = document.getElementById('btn-close-saved-modal');
  if (btnCloseSavedModal) btnCloseSavedModal.addEventListener('click', closeSavedOrdersModal);

  // 3. Table Map navigation buttons
  const btnBackToMap = document.getElementById('btn-back-to-map');
  if (btnBackToMap) {
    btnBackToMap.addEventListener('click', () => {
      showTableMap();
    });
  }

  const btnChangeTableSidebar = document.getElementById('btn-change-table-sidebar');
  if (btnChangeTableSidebar) {
    btnChangeTableSidebar.addEventListener('click', () => {
      showTableMap();
    });
  }

  // Update clock
  setInterval(updateClock, 1000);
  updateClock();

  // Initial calculations & renders
  recalculateAllRecipes(); // Ensure recipe costs are fully updated based on current ingredient costs
  updateCurrencyLabels();
  renderInventoryTable();
  setupFormIngredients();
  updateSavedOrdersBadge();
  
  // Always start with the table map visible (Issue #1)
  showTableMap();
  
  // Set default form visibility
  toggleFormTypeFields();
  
  // Try auto-fetching the rate on load silently
  fetchExchangeRate(true);

  // ============================================================
  // TAB SWITCHING (Issue #3 - handlers were missing)
  // ============================================================
  document.getElementById('btn-tab-pos').addEventListener('click', () => switchTab('pos'));
  document.getElementById('btn-tab-inventory').addEventListener('click', () => switchTab('inventory'));
  document.getElementById('btn-tab-settings').addEventListener('click', () => {
    switchTab('settings');
    loadUsers();
    const isAdmin = users.find(u => u.username === currentUser)?.role === 'admin';
    document.getElementById('user-mgmt-panel').classList.toggle('hidden', !isAdmin);
    document.getElementById('backup-panel').classList.toggle('hidden', !isAdmin);
    if (isAdmin) renderUserList();
    renderWaiterList();
  });

  // ============================================================
  // POS SEARCH & FILTER CHIPS (handlers were missing)
  // ============================================================
  document.getElementById('pos-search').addEventListener('input', renderPOSGrid);

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activePOSFilter = chip.dataset.filter;
      renderPOSGrid();
    });
  });

  // ============================================================
  // AUTO-CALCULATE PRICE when cost or utility changes
  // ============================================================
  document.getElementById('item-cost').addEventListener('input', syncPriceFromCostAndUtility);
  document.getElementById('item-utility').addEventListener('input', syncPriceFromCostAndUtility);

  // ============================================================
  // ENTER KEY NAVIGATION in pricing fields (prevent form submit)
  // ============================================================
  document.getElementById('item-cost').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('item-utility').focus();
    }
  });
  document.getElementById('item-utility').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('item-price').focus();
    }
  });
  document.getElementById('item-price').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-save-item').click();
    }
  });

  // ============================================================
  // ADD / REMOVE TABLES
  // ============================================================
  document.getElementById('btn-add-table').addEventListener('click', () => {
    tableCount++;
    localStorage.setItem('gastropos_table_count', tableCount);
    firebaseSet('gastropos_table_count', tableCount);
    document.getElementById('table-count-display').textContent = tableCount;
    renderTableMap();
  });

  document.getElementById('btn-remove-table').addEventListener('click', () => {
    if (tableCount <= 1) {
      alert('Debe haber al menos 1 mesa.');
      return;
    }
    const tableToRemove = `Mesa ${tableCount}`;
    const hasActiveOrder = savedOrders.some(order => order.table === tableToRemove);
    if (hasActiveOrder) {
      if (!confirm(`La ${tableToRemove} tiene una comanda activa. ¿Está seguro de eliminarla? La comanda se perderá.`)) {
        return;
      }
      savedOrders = savedOrders.filter(order => order.table !== tableToRemove);
      saveSavedOrdersToStorage();
    }
    if (selectedTable === tableToRemove) {
      clearOrder();
      showTableMap();
    }
    tableCount--;
    localStorage.setItem('gastropos_table_count', tableCount);
    firebaseSet('gastropos_table_count', tableCount);
    document.getElementById('table-count-display').textContent = tableCount;
    renderTableMap();
  });

  // ============================================================
  // HISTORY TAB
  // ============================================================
  document.getElementById('btn-tab-history').addEventListener('click', () => {
    switchTab('history');
    populateHistoryFilters();
    renderSalesHistory();
  });

  document.getElementById('btn-apply-filters').addEventListener('click', renderSalesHistory);
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('filter-table').value = 'all';
    document.getElementById('filter-waiter').value = 'all';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    renderSalesHistory();
  });
  document.getElementById('btn-print-history').addEventListener('click', printSalesReport);

  // ============================================================
  // WAITERS
  // ============================================================
  populateWaiterSelect();
  renderWaiterList();

  // ============================================================
  // FIREBASE REAL-TIME SYNC (start listening after initial load)
  // ============================================================
  subscribeFirebaseAll();
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`);
  });
  currentTab = tabName;
}

function saveItemsToStorage() {
  localStorage.setItem('gastropos_items', JSON.stringify(items));
  firebaseSet('gastropos_items', items);
}

function saveOrderToStorage() {
  localStorage.setItem('gastropos_current_order', JSON.stringify(currentOrder));
}

function saveSavedOrdersToStorage() {
  localStorage.setItem('gastropos_saved_orders', JSON.stringify(savedOrders));
  firebaseSet('gastropos_saved_orders', savedOrders);
  updateSavedOrdersBadge();
  renderTableMap();
}

function saveSalesHistoryToStorage() {
  localStorage.setItem('gastropos_sales', JSON.stringify(salesHistory));
  firebaseSet('gastropos_sales', salesHistory);
}

function saveWaitersToStorage() {
  localStorage.setItem('gastropos_waiters', JSON.stringify(waiters));
  firebaseSet('gastropos_waiters', waiters);
}

function updateSavedOrdersBadge() {
  const countEl = document.getElementById('saved-orders-count');
  if (countEl) {
    countEl.textContent = savedOrders.length;
  }
}

// Helper to determine Food Icons based on names
function getItemIcon(name) {
  const cleanName = name.toLowerCase();
  if (cleanName.includes('coca') || cleanName.includes('cola') || cleanName.includes('refresco') || cleanName.includes('soda') || cleanName.includes('jugo') || cleanName.includes('bebida')) return '🥤';
  if (cleanName.includes('cerveza') || cleanName.includes('corona') || cleanName.includes('beer') || cleanName.includes('heineken') || cleanName.includes('trago')) return '🍺';
  if (cleanName.includes('hamburguesa') || cleanName.includes('burger')) return '🍔';
  if (cleanName.includes('papas') || cleanName.includes('fries') || cleanName.includes('patatas')) return '🍟';
  if (cleanName.includes('pizza')) return '🍕';
  if (cleanName.includes('carne') || cleanName.includes('res') || cleanName.includes('steak') || cleanName.includes('filete')) return '🥩';
  if (cleanName.includes('pan') || cleanName.includes('brioche') || cleanName.includes('bread')) return '🍞';
  if (cleanName.includes('queso') || cleanName.includes('cheese') || cleanName.includes('cheddar')) return '🧀';
  if (cleanName.includes('cafe') || cleanName.includes('café') || cleanName.includes('coffee') || cleanName.includes('té')) return '☕';
  if (cleanName.includes('agua') || cleanName.includes('water')) return '💧';
  if (cleanName.includes('ensalada') || cleanName.includes('salad')) return '🥗';
  if (cleanName.includes('taco')) return '🌮';
  if (cleanName.includes('pollo') || cleanName.includes('chicken') || cleanName.includes('alitas')) return '🍗';
  if (cleanName.includes('postre') || cleanName.includes('torta') || cleanName.includes('helado') || cleanName.includes('dulce')) return '🍰';
  return '🍽️';
}

// Clock updates in the Header
function updateClock() {
  const clockEl = document.getElementById('system-time');
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

// ==========================================================================
// 2. EXCHANGE RATE API FETCH & CURRENCY SYNC
// ==========================================================================

async function fetchExchangeRate(silent = false) {
  const btnRefresh = document.getElementById('btn-refresh-rate');
  if (btnRefresh) btnRefresh.classList.add('loading');
  
  try {
    const response = await fetch('https://bcv.today/api/v1/rate.json');
    if (!response.ok) throw new Error('API response not OK');
    const data = await response.json();
    
    const currencyKey = referenceCurrency === 'USD' ? 'USD' : 'EUR';
    const rate = data[currencyKey] ? parseFloat(data[currencyKey]) : null;
    
    if (rate && !isNaN(rate)) {
      exchangeRate = rate;
      localStorage.setItem('gastropos_rate', exchangeRate);
      firebaseSet('gastropos_rate', exchangeRate);
      
      const rateInput = document.getElementById('exchange-rate-val');
      if (rateInput) rateInput.value = exchangeRate.toFixed(2);
      
      if (!silent) {
        alert(`Tasa oficial cambiaria para ${referenceCurrency} cargada con éxito: ${exchangeRate.toFixed(2)} Bs.`);
      }
      
      // Re-render calculations
      renderPOSGrid();
      renderOrder();
      renderInventoryTable();
      renderTableMap();
    }
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    if (!silent) {
      alert(`No se pudo obtener la tasa desde el servidor. Se mantendrá la tasa actual: ${exchangeRate.toFixed(2)} Bs.`);
    }
  } finally {
    if (btnRefresh) btnRefresh.classList.remove('loading');
  }
}

function updateCurrencyLabels() {
  const symbol = referenceCurrency === 'USD' ? '$' : '€';
  
  document.querySelectorAll('.currency-label').forEach(el => {
    el.textContent = referenceCurrency;
  });
  
  const headers = document.querySelectorAll('.inventory-table th');
  if (headers.length >= 5) {
    headers[2].textContent = `Costo (${symbol})`;
    headers[4].textContent = `Precio Venta (${symbol})`;
  }

  const costLabel = document.querySelector('label[for="item-cost"]');
  const priceLabel = document.querySelector('label[for="item-price"]');
  if (costLabel) costLabel.textContent = `Costo (${symbol})`;
  if (priceLabel) priceLabel.textContent = `Precio de Venta (${symbol})`;

  setupFormIngredients();
}

// ==========================================================================
// 3. TABLE MAP (MAPA DE MESAS) LOGIC
// ==========================================================================

function showTableMap() {
  selectedTable = null;
  localStorage.removeItem('gastropos_active_table');
  
  // Sync sidebar table input to "Ninguna"
  document.getElementById('order-table').value = 'Ninguna';
  
  // Toggle subviews
  document.getElementById('pos-tables-map-view').classList.remove('hidden');
  document.getElementById('pos-menu-view').classList.add('hidden');
  
  renderTableMap();
  renderOrder(); // Empty order sidebar displays
}

function renderTableMap() {
  const gridEl = document.getElementById('tables-grid');
  if (!gridEl) return;

  gridEl.innerHTML = '';
  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  // Generate tables dynamically
  for (let i = 1; i <= tableCount; i++) {
    const tableName = `Mesa ${i}`;
    
    // Check if table is occupied (has an active saved pending comanda)
    const activeOrder = savedOrders.find(order => order.table === tableName);
    const isOccupied = !!activeOrder;
    
    const card = document.createElement('div');
    card.className = `table-card ${isOccupied ? 'ocupada' : 'libre'}`;
    
    if (isOccupied) {
      const totalBs = activeOrder.total * exchangeRate;
      const qtyItems = activeOrder.items.reduce((acc, curr) => acc + curr.quantity, 0);
      card.innerHTML = `
        <div class="table-card-number">${tableName}</div>
        <span class="table-card-status">Ocupada</span>
        <div class="table-card-total">${symbol}${activeOrder.total.toFixed(2)}</div>
        <div class="table-card-items">${qtyItems} ${qtyItems === 1 ? 'ítem' : 'ítems'}</div>
      `;
    } else {
      card.innerHTML = `
        <div class="table-card-number">${tableName}</div>
        <span class="table-card-status">Disponible</span>
      `;
    }
    
    // Click table handles loading or starting order
    card.addEventListener('click', () => {
      selectTable(tableName, true);
    });
    
    gridEl.appendChild(card);
  }
}

function selectTable(tableName, switchView = true) {
  selectedTable = tableName;
  localStorage.setItem('gastropos_active_table', selectedTable);
  
  document.getElementById('order-table').value = selectedTable;
  document.getElementById('pos-menu-active-table').textContent = selectedTable;
  
  // Check if table is occupied -> Auto load comanda items
  const activeOrder = savedOrders.find(order => order.table === tableName);
  if (activeOrder) {
    // Occupied! Load the items so waiter keeps adding items to this same table
    currentOrder = [...activeOrder.items];
    activeSavedOrderId = activeOrder.id;
    localStorage.setItem('gastropos_active_saved_id', activeSavedOrderId);
  } else {
    // Free! Reset order sidebar
    currentOrder = [];
    activeSavedOrderId = null;
    localStorage.removeItem('gastropos_active_saved_id');
  }

  saveOrderToStorage();
  renderOrder();

  if (switchView) {
    // Shift views to display menu grid
    document.getElementById('pos-tables-map-view').classList.add('hidden');
    document.getElementById('pos-menu-view').classList.remove('hidden');
    renderPOSGrid();
  }
}

// ==========================================================================
// 4. MATHEMATICAL CALCULATIONS (COST, UTILITY, FINAL PRICE & CASCADE UPDATES)
// ==========================================================================

// Recalculate all recipe costs from their ingredient costs
function recalculateAllRecipes() {
  items.forEach(item => {
    if (item.type === 'recipe' && item.ingredients) {
      let calculatedCost = 0;
      item.ingredients.forEach(ing => {
        const simpleItem = items.find(i => i.id === ing.itemId);
        if (simpleItem) {
          calculatedCost += simpleItem.cost * ing.quantity;
        }
      });
      item.cost = calculatedCost;
      item.price = calculatedCost * (1 + item.utility / 100);
    }
  });
}

// Sync price field from cost and utility percentage
function syncPriceFromCostAndUtility() {
  const cost = parseFloat(document.getElementById('item-cost').value) || 0;
  const utility = parseFloat(document.getElementById('item-utility').value) || 0;
  const price = cost * (1 + utility / 100);
  document.getElementById('item-price').value = price.toFixed(2);
}

// ==========================================================================
// 5. TAB 1: POS / COMANDAS LOGIC
// ==========================================================================

function renderPOSGrid() {
  const gridEl = document.getElementById('pos-items-grid');
  const searchVal = document.getElementById('pos-search').value.toLowerCase().trim();
  
  gridEl.innerHTML = '';
  
  const filtered = items.filter(item => {
    if (activePOSFilter !== 'all' && item.type !== activePOSFilter) return false;
    if (searchVal && !item.name.toLowerCase().includes(searchVal)) return false;
    return true;
  });

  if (filtered.length === 0) {
    gridEl.innerHTML = `
      <div class="empty-table-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">🍽️</div>
        <p>No se encontraron artículos</p>
        <span>Intenta con otra búsqueda o agrega artículos en configuración.</span>
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.setAttribute('data-id', item.id);
    
    const typeLabel = item.type === 'simple' ? 'Simple' : 'Receta';
    const typeClass = item.type;
    const emoji = getItemIcon(item.name);
    const symbol = referenceCurrency === 'USD' ? '$' : '€';
    const priceBs = item.price * exchangeRate;
    
    card.innerHTML = `
      <span class="item-type-badge ${typeClass}">${typeLabel}</span>
      <div class="item-card-icon">${emoji}</div>
      <h3 class="item-card-name">${item.name}</h3>
      <div class="item-card-price">
        ${symbol}${item.price.toFixed(2)} <span>c/u</span>
        <span class="currency-sub">${priceBs.toFixed(2)} Bs.</span>
      </div>
      <div class="item-card-add-indicator">+</div>
    `;
    
    card.addEventListener('click', () => {
      addItemToOrder(item.id);
    });
    
    gridEl.appendChild(card);
  });
}

function addItemToOrder(itemId) {
  // Guard check: cannot add items if no table is selected
  if (!selectedTable || selectedTable === 'Ninguna') {
    alert('Por favor, regrese al mapa y seleccione una mesa antes de agregar productos.');
    showTableMap();
    return;
  }

  const item = items.find(i => i.id === itemId);
  if (!item) return;

  const existing = currentOrder.find(o => o.itemId === itemId);
  if (existing) {
    existing.quantity += 1;
  } else {
    currentOrder.push({
      itemId: item.id,
      name: item.name,
      price: item.price,
      quantity: 1
    });
  }
  
  saveOrderToStorage();
  renderOrder();
}

function changeOrderQty(itemId, amount) {
  const orderItem = currentOrder.find(o => o.itemId === itemId);
  if (!orderItem) return;
  
  orderItem.quantity += amount;
  
  if (orderItem.quantity <= 0) {
    deleteItemFromOrder(itemId);
  } else {
    saveOrderToStorage();
    renderOrder();
  }
}

function deleteItemFromOrder(itemId) {
  currentOrder = currentOrder.filter(o => o.itemId !== itemId);
  saveOrderToStorage();
  renderOrder();
}

function clearOrder() {
  currentOrder = [];
  activeSavedOrderId = null;
  selectedTable = null;
  localStorage.removeItem('gastropos_active_saved_id');
  localStorage.removeItem('gastropos_active_table');
  
  document.getElementById('order-table').value = 'Ninguna';
  document.getElementById('order-waiter').value = waiters[0] || 'Mesero 1';
  
  saveOrderToStorage();
  renderOrder();
}

document.getElementById('btn-clear-order').addEventListener('click', () => {
  if (currentOrder.length > 0) {
    if (confirm('¿Está seguro de vaciar la comanda actual?')) {
      clearOrder();
      showTableMap();
    }
  }
});

function renderOrder() {
  const listEl = document.getElementById('order-items-list');
  const countEl = document.getElementById('order-item-count');
  const subtotalEl = document.getElementById('summary-subtotal');
  const totalEl = document.getElementById('summary-total');
  
  listEl.innerHTML = '';
  
  let totalAmount = 0;
  let totalItemsCount = 0;

  if (currentOrder.length === 0) {
    listEl.innerHTML = `
      <div class="empty-order-state">
        <div class="empty-icon">🍳</div>
        <p>La orden está vacía</p>
        <span>Selecciona una mesa en el mapa y agrega productos.</span>
      </div>
    `;
    countEl.textContent = '0 ítems';
    subtotalEl.textContent = '$0.00';
    totalEl.textContent = '$0.00';
    return;
  }

  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  currentOrder.forEach(orderItem => {
    const itemTotal = orderItem.price * orderItem.quantity;
    totalAmount += itemTotal;
    totalItemsCount += orderItem.quantity;
    const itemTotalBs = itemTotal * exchangeRate;

    const row = document.createElement('div');
    row.className = 'order-item-row';
    row.innerHTML = `
      <div class="order-item-info">
        <div class="order-item-name">${orderItem.name}</div>
        <div class="order-item-price">
          ${symbol}${orderItem.price.toFixed(2)} c/u
          <small class="currency-sub" style="display:inline-block; margin-left:4px;">(${(orderItem.price * exchangeRate).toFixed(2)} Bs.)</small>
        </div>
      </div>
      <div class="order-item-controls">
        <div class="qty-control">
          <button class="qty-btn btn-minus" data-id="${orderItem.itemId}">-</button>
          <span class="qty-val">${orderItem.quantity}</span>
          <button class="qty-btn btn-plus" data-id="${orderItem.itemId}">+</button>
        </div>
        <div class="order-item-total">
          ${symbol}${itemTotal.toFixed(2)}
          <small class="currency-sub">${itemTotalBs.toFixed(2)} Bs.</small>
        </div>
        <button class="btn-delete-item" data-id="${orderItem.itemId}">
          <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;

    row.querySelector('.btn-minus').addEventListener('click', (e) => {
      e.stopPropagation();
      changeOrderQty(orderItem.itemId, -1);
    });
    row.querySelector('.btn-plus').addEventListener('click', (e) => {
      e.stopPropagation();
      changeOrderQty(orderItem.itemId, 1);
    });
    row.querySelector('.btn-delete-item').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteItemFromOrder(orderItem.itemId);
    });

    listEl.appendChild(row);
  });

  const totalAmountBs = totalAmount * exchangeRate;

  countEl.textContent = `${totalItemsCount} ${totalItemsCount === 1 ? 'ítem' : 'ítems'}`;
  subtotalEl.innerHTML = `${symbol}${totalAmount.toFixed(2)} <small style="font-size:0.75rem; color:var(--text-muted);">(${totalAmountBs.toFixed(2)} Bs.)</small>`;
  totalEl.innerHTML = `${symbol}${totalAmount.toFixed(2)} <small style="font-size:0.85rem; color:var(--text-muted); font-weight:500;">(${totalAmountBs.toFixed(2)} Bs.)</small>`;
}

// Helper to calculate current order total (Issue #2 - was missing!)
function getOrderTotal() {
  return currentOrder.reduce((total, item) => total + (item.price * item.quantity), 0);
}

// ==========================================================================
// 6. COMANDA Y TRANSACCIONES EN ESPERA LOGIC
// ==========================================================================

// Handle Comanda Button click -> Prints ticket and saves/updates hold list
document.getElementById('btn-print-order').addEventListener('click', () => {
  if (currentOrder.length === 0) {
    alert('No se puede guardar una comanda vacía.');
    return;
  }
  if (!selectedTable || selectedTable === 'Ninguna') {
    alert('Por favor, seleccione una mesa primero.');
    showTableMap();
    return;
  }

  // Print comanda
  printTicket();

  // Save transaction to hold queue
  const tableNum = selectedTable;
  const waiterName = document.getElementById('order-waiter').value || 'Mesero 1';
  const totalVal = getOrderTotal();
  const dateObj = new Date();
  const dateStr = dateObj.toLocaleDateString('es-ES') + ' ' + dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  // Double validation check: ensure we merge or edit the table's comanda
  const existingOrderIndex = savedOrders.findIndex(o => o.table === tableNum);

  if (existingOrderIndex !== -1) {
    // Table is already occupied in the list. Overwrite it (merges/updates item counts)
    savedOrders[existingOrderIndex] = {
      id: savedOrders[existingOrderIndex].id,
      table: tableNum,
      waiter: waiterName,
      items: [...currentOrder],
      total: totalVal,
      timestamp: dateStr
    };
  } else {
    // Registering new saved order
    const newSavedId = 'saved_' + Date.now();
    savedOrders.push({
      id: newSavedId,
      table: tableNum,
      waiter: waiterName,
      items: [...currentOrder],
      total: totalVal,
      timestamp: dateStr
    });
  }

  saveSavedOrdersToStorage();
  
  // Clear sidebar order and return to map
  clearOrder();
  showTableMap();
  
  alert(`Comanda de la ${tableNum} impresa y guardada en espera de cobro.`);
});

function openSavedOrdersModal() {
  document.getElementById('saved-orders-modal').classList.remove('hidden');
  renderSavedOrdersList();
}

function closeSavedOrdersModal() {
  document.getElementById('saved-orders-modal').classList.add('hidden');
}

function renderSavedOrdersList() {
  const tbody = document.getElementById('saved-orders-modal-list');
  const emptyState = document.getElementById('empty-saved-orders-state');
  
  tbody.innerHTML = '';

  if (savedOrders.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  savedOrders.forEach(order => {
    const totalBs = order.total * exchangeRate;
    const qtyItems = order.items.reduce((acc, curr) => acc + curr.quantity, 0);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${order.table}</strong></td>
      <td>${order.timestamp}</td>
      <td>${order.waiter}</td>
      <td>${qtyItems}</td>
      <td><strong>${symbol}${order.total.toFixed(2)}</strong> <small style="display:block; font-size:0.75rem; color:var(--text-muted);">${totalBs.toFixed(2)} Bs.</small></td>
      <td style="text-align: right;">
        <div class="td-actions" style="justify-content: flex-end;">
          <button class="btn btn-secondary btn-action-load" data-id="${order.id}" style="padding: 4px 8px; font-size:0.75rem; background-color: var(--accent-light); color: var(--accent-hover); border-color: rgba(245,158,11,0.2);">
            Cargar al POS
          </button>
          <button class="btn btn-danger btn-action-delete-saved" data-id="${order.id}" style="padding: 4px 8px; font-size:0.75rem; background-color:var(--color-danger); color:#fff; border:none; margin-left: 5px;">
            Eliminar
          </button>
        </div>
      </td>
    `;

    // Load to POS trigger
    row.querySelector('.btn-action-load').addEventListener('click', () => {
      loadSavedOrderToPOS(order.id);
    });

    // Delete saved order trigger
    row.querySelector('.btn-action-delete-saved').addEventListener('click', () => {
      deleteSavedOrder(order.id);
    });

    tbody.appendChild(row);
  });
}

function loadSavedOrderToPOS(orderId) {
  const order = savedOrders.find(o => o.id === orderId);
  if (!order) return;

  // Set active active state
  selectedTable = order.table;
  localStorage.setItem('gastropos_active_table', selectedTable);
  
  currentOrder = [...order.items];
  activeSavedOrderId = order.id;
  localStorage.setItem('gastropos_active_saved_id', activeSavedOrderId);

  // Load client details
  document.getElementById('order-table').value = selectedTable;
  document.getElementById('pos-menu-active-table').textContent = selectedTable;
  document.getElementById('order-waiter').value = order.waiter;

  saveOrderToStorage();
  renderOrder();
  
  // Show menu view
  document.getElementById('pos-tables-map-view').classList.add('hidden');
  document.getElementById('pos-menu-view').classList.remove('hidden');
  renderPOSGrid();

  closeSavedOrdersModal();
}

function deleteSavedOrder(orderId) {
  if (confirm('¿Está seguro de eliminar esta transacción de la lista de espera?')) {
    savedOrders = savedOrders.filter(o => o.id !== orderId);
    saveSavedOrdersToStorage();
    renderSavedOrdersList();
    
    // If it was the active loaded order, disconnect the link and go back to map
    if (activeSavedOrderId === orderId) {
      clearOrder();
      showTableMap();
    }
  }
}

function printTicket() {
  const ticketLayout = document.getElementById('ticket-print-layout');
  const tableNum = selectedTable || 'Mesa General';
  const waiterName = document.getElementById('order-waiter').value || 'Mesero 1';
  const orderId = Math.floor(1000 + Math.random() * 9000);
  
  const now = new Date();
  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  function metaRow(l, r) {
    return `<tr><td>${l}</td><td class="right">${r || ''}</td></tr>`;
  }

  let ticketHTML = `
    <div class="ticket-header">
      <div class="ticket-title">GASTRO POS</div>
      <div class="ticket-sub">SABOR Y GESTIÓN PREMIUM</div>
      <div class="ticket-sub">Calle Ficticia 123, Ciudad</div>
    </div>
    <div class="ticket-divider"></div>

    <table class="ticket-meta-table">
      ${metaRow('ORDEN: #' + orderId, now.toLocaleDateString('es-ES'))}
      ${metaRow('MESA: ' + tableNum, now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}
      ${metaRow('ATIENDE: ' + waiterName, '')}
    </table>
    <div class="ticket-divider"></div>
    
    <table class="ticket-meta-table">
      ${metaRow('TASA: 1 ' + referenceCurrency + ' = ' + exchangeRate.toFixed(2) + ' Bs.', '')}
    </table>
    <div class="ticket-divider"></div>

    <table class="ticket-table">
      <thead>
        <tr><th class="col-qty">CANT</th><th class="col-desc">PRODUCTO</th><th class="col-total">TOTAL</th></tr>
      </thead>
      <tbody>
  `;

  let grandTotal = 0;
  currentOrder.forEach(item => {
    const itemTotal = item.price * item.quantity;
    grandTotal += itemTotal;
    const itemTotalBs = itemTotal * exchangeRate;
    ticketHTML += `
        <tr>
          <td class="col-qty">${item.quantity}</td>
          <td class="col-desc">
            ${item.name}
            <div class="ticket-item-sub">${symbol}${item.price.toFixed(2)} (${(item.price * exchangeRate).toFixed(2)} Bs) c/u &mdash; ${itemTotalBs.toFixed(2)} Bs</div>
          </td>
          <td class="col-total">${symbol}${itemTotal.toFixed(2)}</td>
        </tr>
    `;
  });

  const grandTotalBs = grandTotal * exchangeRate;

  ticketHTML += `
      </tbody>
    </table>
    <div class="ticket-divider"></div>

    <table class="ticket-summary-table">
      <tr><td>SUBTOTAL (${referenceCurrency}):</td><td class="right">${symbol}${grandTotal.toFixed(2)}</td></tr>
      <tr><td>SUBTOTAL (Bs):</td><td class="right">${grandTotalBs.toFixed(2)} Bs.</td></tr>
    </table>
    <div class="ticket-divider"></div>

    <table class="ticket-summary-table">
      <tr class="ticket-grand-total"><td>TOTAL NETO (${referenceCurrency}):</td><td class="right">${symbol}${grandTotal.toFixed(2)}</td></tr>
      <tr class="ticket-grand-total"><td>TOTAL NETO (Bs):</td><td class="right">${grandTotalBs.toFixed(2)} Bs.</td></tr>
    </table>

    <div class="ticket-footer">
      <div class="ticket-greeting">${'¡'}Comanda en Espera de Pago!</div>
      <div>GastroPOS - Comprobante de consumo interno</div>
    </div>
  `;

  ticketLayout.innerHTML = ticketHTML;
  window.print();
}

// ==========================================================================
// 7. TOTALIZAR VENTA / MODAL DE PAGO LOGIC
// ==========================================================================

function openPaymentModal() {
  document.getElementById('payment-modal').classList.remove('hidden');
  
  const totalCurrency = getOrderTotal();
  const totalBs = totalCurrency * exchangeRate;
  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  document.getElementById('modal-total-currency').textContent = `${symbol}${totalCurrency.toFixed(2)}`;
  document.getElementById('modal-total-bs').textContent = `${totalBs.toFixed(2)} Bs.`;
  document.getElementById('modal-exchange-rate').textContent = `1 ${referenceCurrency} = ${exchangeRate.toFixed(2)} Bs.`;

  // Default values
  paymentMethod = 'efectivo';
  document.getElementById('modal-payment-method-select').value = 'efectivo';
  
  paymentDetails.efectivo.received = 0;
  paymentDetails.efectivo.currency = 'Bs';
  paymentDetails.transferencia.refCode = '';
  paymentDetails.mixto.transferAmount = 0;
  paymentDetails.mixto.cashAmount = 0;

  renderModalPaymentDetails();
}

function closePaymentModal() {
  document.getElementById('payment-modal').classList.add('hidden');
}

function renderModalPaymentDetails() {
  const container = document.getElementById('modal-payment-details-dynamic');
  if (!container) return;

  const totalCurrency = getOrderTotal();
  const totalBs = totalCurrency * exchangeRate;
  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  container.innerHTML = '';

  if (paymentMethod === 'efectivo') {
    const cashData = paymentDetails.efectivo;
    const row = document.createElement('div');
    row.className = 'payment-row';
    row.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <label for="cash-currency-select">Moneda de Pago</label>
        <select id="cash-currency-select" class="payment-select" style="width: auto; padding: 4px 8px; font-size: 0.8rem;">
          <option value="Bs" ${cashData.currency === 'Bs' ? 'selected' : ''}>Bs (Bolívares)</option>
          <option value="Divisa" ${cashData.currency === 'Divisa' ? 'selected' : ''}>${referenceCurrency} (${symbol})</option>
        </select>
      </div>
      <div class="form-group">
        <label for="cash-received">Monto Recibido</label>
        <input type="number" id="cash-received" min="0" step="0.01" value="${cashData.received || ''}" placeholder="0.00" style="padding: 10px; font-size: 1rem;">
      </div>
      <div id="cash-change-feedback" class="payment-vuelto pending" style="margin-top: 10px; padding: 10px; font-size: 1rem;">
        Falta ingresar monto
      </div>
    `;

    container.appendChild(row);

    const cashInput = row.querySelector('#cash-received');
    const currencySelect = row.querySelector('#cash-currency-select');

    const updateCashFeedback = () => {
      const received = parseFloat(cashInput.value) || 0;
      cashData.received = received;
      cashData.currency = currencySelect.value;
      
      const feedbackEl = document.getElementById('cash-change-feedback');
      if (!feedbackEl) return;

      if (cashData.currency === 'Bs') {
        const diff = received - totalBs;
        if (received === 0) {
          feedbackEl.className = 'payment-vuelto pending';
          feedbackEl.textContent = `Pendiente: ${totalBs.toFixed(2)} Bs.`;
        } else if (diff >= 0) {
          feedbackEl.className = 'payment-vuelto success';
          feedbackEl.textContent = `Cambio (Vuelto): ${diff.toFixed(2)} Bs.`;
        } else {
          feedbackEl.className = 'payment-vuelto pending';
          feedbackEl.textContent = `Resta por pagar: ${Math.abs(diff).toFixed(2)} Bs.`;
        }
      } else {
        const diff = received - totalCurrency;
        if (received === 0) {
          feedbackEl.className = 'payment-vuelto pending';
          feedbackEl.textContent = `Pendiente: ${symbol}${totalCurrency.toFixed(2)}`;
        } else if (diff >= 0) {
          const changeBs = diff * exchangeRate;
          feedbackEl.className = 'payment-vuelto success';
          feedbackEl.innerHTML = `Cambio (Vuelto): ${symbol}${diff.toFixed(2)}<br><small>Equivalente a: <strong>${changeBs.toFixed(2)} Bs.</strong></small>`;
        } else {
          feedbackEl.className = 'payment-vuelto pending';
          feedbackEl.textContent = `Resta por pagar: ${symbol}${Math.abs(diff).toFixed(2)}`;
        }
      }
    };

    cashInput.addEventListener('input', updateCashFeedback);
    currencySelect.addEventListener('change', updateCashFeedback);
    
    setTimeout(() => cashInput.focus(), 100);
    updateCashFeedback();

  } else if (paymentMethod === 'transferencia') {
    const transfData = paymentDetails.transferencia;
    const row = document.createElement('div');
    row.className = 'payment-row';
    row.innerHTML = `
      <div class="form-group">
        <label for="transf-ref">Número de Referencia Bancaria</label>
        <input type="text" id="transf-ref" value="${transfData.refCode || ''}" placeholder="Últimos 4 o 6 dígitos del comprobante" style="padding: 10px; font-size: 1rem;">
      </div>
      <div class="payment-vuelto success" style="background-color: var(--bg-primary); color: var(--brand-dark); border: 1px solid var(--border-color); padding: 12px; margin-top: 10px;">
        Monto exacto a transferir: <strong style="font-size: 1.15rem; color: var(--brand-dark);">${totalBs.toFixed(2)} Bs.</strong>
      </div>
    `;

    container.appendChild(row);

    const refInput = row.querySelector('#transf-ref');
    refInput.addEventListener('input', (e) => {
      transfData.refCode = e.target.value.trim();
    });
    
    setTimeout(() => refInput.focus(), 100);

  } else if (paymentMethod === 'mixto') {
    const mixedData = paymentDetails.mixto;
    const row = document.createElement('div');
    row.className = 'payment-row';
    row.innerHTML = `
      <div style="font-size:0.9rem; text-align:center; padding: 6px; background-color: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom:12px; color: var(--brand-dark);">
        Total Neto a pagar: <strong>${totalBs.toFixed(2)} Bs.</strong>
      </div>
      <div class="form-group-inline" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label for="mixed-transfer">Transferencia Bs.</label>
          <input type="number" id="mixed-transfer" min="0" step="0.01" value="${mixedData.transferAmount || ''}" placeholder="0.00" style="padding: 10px;">
        </div>
        <div class="form-group">
          <label for="mixed-cash">Efectivo Bs.</label>
          <input type="number" id="mixed-cash" min="0" step="0.01" value="${mixedData.cashAmount || ''}" placeholder="0.00" style="padding: 10px;">
        </div>
      </div>
      <div id="mixed-change-feedback" class="payment-vuelto pending" style="margin-top: 12px; padding: 10px; font-size: 1rem;">
        Falta ingresar montos
      </div>
    `;

    container.appendChild(row);

    const transferInput = row.querySelector('#mixed-transfer');
    const cashInput = row.querySelector('#mixed-cash');

    const updateMixedFeedback = () => {
      const transfer = parseFloat(transferInput.value) || 0;
      const cash = parseFloat(cashInput.value) || 0;
      
      mixedData.transferAmount = transfer;
      mixedData.cashAmount = cash;

      const totalPaid = transfer + cash;
      const diff = totalPaid - totalBs;

      const feedbackEl = document.getElementById('mixed-change-feedback');
      if (!feedbackEl) return;

      if (totalPaid === 0) {
        feedbackEl.className = 'payment-vuelto pending';
        feedbackEl.textContent = `Pendiente: ${totalBs.toFixed(2)} Bs.`;
      } else if (diff >= 0) {
        feedbackEl.className = 'payment-vuelto success';
        feedbackEl.textContent = `Cambio (Vuelto): ${diff.toFixed(2)} Bs.`;
      } else {
        feedbackEl.className = 'payment-vuelto pending';
        feedbackEl.textContent = `Resta por pagar: ${Math.abs(diff).toFixed(2)} Bs.`;
      }
    };

    transferInput.addEventListener('input', updateMixedFeedback);
    cashInput.addEventListener('input', updateMixedFeedback);
    
    setTimeout(() => transferInput.focus(), 100);
    updateMixedFeedback();
  }
}

// Validate and process transaction payment in modal
function processPayment() {
  const totalCurrency = getOrderTotal();
  const totalBs = totalCurrency * exchangeRate;
  
  if (paymentMethod === 'efectivo') {
    const cash = paymentDetails.efectivo;
    const received = cash.received || 0;
    
    if (cash.currency === 'Bs') {
      if (received < totalBs) {
        alert(`Monto recibido insuficiente. Faltan ${(totalBs - received).toFixed(2)} Bs.`);
        return;
      }
    } else {
      if (received < totalCurrency) {
        const symbol = referenceCurrency === 'USD' ? '$' : '€';
        alert(`Monto recibido insuficiente. Faltan ${symbol}${(totalCurrency - received).toFixed(2)}`);
        return;
      }
    }
  } else if (paymentMethod === 'transferencia') {
    const transf = paymentDetails.transferencia;
    if (!transf.refCode) {
      alert('Por favor ingrese el código de referencia bancaria para validar la transferencia.');
      return;
    }
  } else if (paymentMethod === 'mixto') {
    const mixed = paymentDetails.mixto;
    const totalPaid = (mixed.transferAmount || 0) + (mixed.cashAmount || 0);
    if (totalPaid < totalBs) {
      alert(`Monto recibido insuficiente en pago mixto. Faltan ${(totalBs - totalPaid).toFixed(2)} Bs.`);
      return;
    }
  }

  // Print invoice ticket with final payment details
  printInvoiceTicket();

  // Delete from saved orders list if it was a loaded transaction
  if (activeSavedOrderId) {
    savedOrders = savedOrders.filter(o => o.id !== activeSavedOrderId);
    saveSavedOrdersToStorage();
  } else if (selectedTable) {
    // If it was not saved, but a table was active, also clean that table's comanda if any
    savedOrders = savedOrders.filter(o => o.table !== selectedTable);
    saveSavedOrdersToStorage();
  }

  // Record sale in history
  const waiterName = document.getElementById('order-waiter').value || 'Mesero 1';
  salesHistory.push({
    id: 'sale_' + Date.now(),
    date: new Date().toISOString(),
    table: selectedTable || 'Mesa General',
    waiter: waiterName,
    items: JSON.parse(JSON.stringify(currentOrder)),
    total: totalCurrency,
    totalBs: totalBs,
    paymentMethod: paymentMethod,
    paymentDetails: JSON.parse(JSON.stringify(paymentDetails)),
    exchangeRate: exchangeRate,
    referenceCurrency: referenceCurrency
  });
  saveSalesHistoryToStorage();

  // Clear POS order sidebar and return to map
  clearOrder();
  closePaymentModal();
  showTableMap();
  
  alert('¡Venta procesada con éxito y factura impresa!');
}

function printInvoiceTicket() {
  const ticketLayout = document.getElementById('ticket-print-layout');
  const tableNum = selectedTable || 'Mesa General';
  const waiterName = document.getElementById('order-waiter').value || 'Mesero 1';
  const orderId = Math.floor(1000 + Math.random() * 9000);
  
  const now = new Date();
  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  function metaRow(l, r) {
    return `<tr><td>${l}</td><td class="right">${r || ''}</td></tr>`;
  }

  let ticketHTML = `
    <div class="ticket-header">
      <div class="ticket-title">GASTRO POS</div>
      <div class="ticket-sub">SABOR Y GESTIÓN PREMIUM</div>
      <div class="ticket-sub">Calle Ficticia 123, Ciudad</div>
      <div class="ticket-invoice-badge">FACTURA / VENTA</div>
    </div>
    <div class="ticket-divider"></div>

    <table class="ticket-meta-table">
      ${metaRow('FACTURA: #' + orderId, now.toLocaleDateString('es-ES'))}
      ${metaRow('MESA: ' + tableNum, now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}
      ${metaRow('ATIENDE: ' + waiterName, '')}
    </table>
    <div class="ticket-divider"></div>

    <table class="ticket-meta-table">
      ${metaRow('TASA: 1 ' + referenceCurrency + ' = ' + exchangeRate.toFixed(2) + ' Bs.', '')}
    </table>
    <div class="ticket-divider"></div>

    <table class="ticket-table">
      <thead>
        <tr><th class="col-qty">CANT</th><th class="col-desc">PRODUCTO</th><th class="col-total">TOTAL</th></tr>
      </thead>
      <tbody>
  `;

  let grandTotal = 0;
  currentOrder.forEach(item => {
    const itemTotal = item.price * item.quantity;
    grandTotal += itemTotal;
    const itemTotalBs = itemTotal * exchangeRate;
    ticketHTML += `
        <tr>
          <td class="col-qty">${item.quantity}</td>
          <td class="col-desc">
            ${item.name}
            <div class="ticket-item-sub">${symbol}${item.price.toFixed(2)} (${(item.price * exchangeRate).toFixed(2)} Bs) c/u &mdash; ${itemTotalBs.toFixed(2)} Bs</div>
          </td>
          <td class="col-total">${symbol}${itemTotal.toFixed(2)}</td>
        </tr>
    `;
  });

  const grandTotalBs = grandTotal * exchangeRate;

  ticketHTML += `
      </tbody>
    </table>
    <div class="ticket-divider"></div>

    <table class="ticket-summary-table">
      <tr><td>SUBTOTAL (${referenceCurrency}):</td><td class="right">${symbol}${grandTotal.toFixed(2)}</td></tr>
      <tr><td>SUBTOTAL (Bs):</td><td class="right">${grandTotalBs.toFixed(2)} Bs.</td></tr>
    </table>
    <div class="ticket-divider"></div>

    <table class="ticket-summary-table">
      <tr class="ticket-grand-total"><td>TOTAL NETO (${referenceCurrency}):</td><td class="right">${symbol}${grandTotal.toFixed(2)}</td></tr>
      <tr class="ticket-grand-total"><td>TOTAL NETO (Bs):</td><td class="right">${grandTotalBs.toFixed(2)} Bs.</td></tr>
    </table>

    <div class="ticket-divider"></div>

    <div class="ticket-payment-label">MÉTODO DE PAGO: ${paymentMethod === 'efectivo' ? 'Efectivo' : paymentMethod === 'transferencia' ? 'Transferencia' : 'Mixto'}</div>
    <table class="ticket-payment-table">
  `;

  if (paymentMethod === 'efectivo') {
    const cash = paymentDetails.efectivo;
    const receivedVal = cash.received || 0;
    const currency = cash.currency;

    if (currency === 'Bs') {
      const change = Math.max(0, receivedVal - grandTotalBs);
      ticketHTML += `
        ${metaRow('Efectivo Recibido (Bs):', receivedVal.toFixed(2) + ' Bs.')}
        ${metaRow('Cambio / Vuelto (Bs):', change.toFixed(2) + ' Bs.')}
      `;
    } else {
      const change = Math.max(0, receivedVal - grandTotal);
      const changeBs = change * exchangeRate;
      ticketHTML += `
        ${metaRow('Efectivo Recibido (' + referenceCurrency + '):', symbol + receivedVal.toFixed(2))}
        ${metaRow('Cambio / Vuelto:', symbol + change.toFixed(2) + ' (' + changeBs.toFixed(2) + ' Bs.)')}
      `;
    }
  } else if (paymentMethod === 'transferencia') {
    const transf = paymentDetails.transferencia;
    ticketHTML += `
      ${metaRow('Referencia Bancaria:', transf.refCode || 'N/A')}
      ${metaRow('Monto Transferido:', grandTotalBs.toFixed(2) + ' Bs.')}
    `;
  } else if (paymentMethod === 'mixto') {
    const mixed = paymentDetails.mixto;
    const transfVal = mixed.transferAmount || 0;
    const cashVal = mixed.cashAmount || 0;
    const totalPaid = transfVal + cashVal;
    const change = Math.max(0, totalPaid - grandTotalBs);

    ticketHTML += `
      ${metaRow('Pago Transferencia (Bs):', transfVal.toFixed(2) + ' Bs.')}
      ${metaRow('Pago Efectivo (Bs):', cashVal.toFixed(2) + ' Bs.')}
      ${metaRow('Total Pagado:', totalPaid.toFixed(2) + ' Bs.')}
      ${metaRow('Cambio / Vuelto (Bs):', change.toFixed(2) + ' Bs.')}
    `;
  }

  ticketHTML += `
    </table>

    <div class="ticket-footer">
      <div class="ticket-greeting">${'¡'}Muchas gracias por su compra!</div>
      <div>GastroPOS - Factura de venta finalizada</div>
    </div>
  `;

  ticketLayout.innerHTML = ticketHTML;
  window.print();
}

// ==========================================================================
// 8. TAB 2: INVENTORY & RECIPES CONFIGURATION LOGIC
// ==========================================================================

const radioSimple = document.getElementById('type-simple');
const radioRecipe = document.getElementById('type-recipe');
const ingredientsSection = document.getElementById('recipe-ingredients-section');

radioSimple.addEventListener('change', toggleFormTypeFields);
radioRecipe.addEventListener('change', toggleFormTypeFields);

function toggleFormTypeFields() {
  const isRecipe = radioRecipe.checked;
  const costInput = document.getElementById('item-cost');
  
  if (isRecipe) {
    ingredientsSection.classList.remove('hidden');
    costInput.readOnly = true;
    costInput.classList.add('readonly-field');
    document.getElementById('cost-help-text').textContent = 'Calculado a partir de ingredientes.';
    updateRecipeFormCost();
  } else {
    ingredientsSection.classList.add('hidden');
    costInput.readOnly = false;
    costInput.classList.remove('readonly-field');
    document.getElementById('cost-help-text').textContent = 'Costo de compra directo.';
    syncPriceFromCostAndUtility();
  }
}

// Populating Simple items as potential ingredients for the Recipe form
function setupFormIngredients() {
  const container = document.getElementById('ingredients-pool-list');
  if (!container) return;

  const searchVal = document.getElementById('ingredient-search').value.toLowerCase().trim();
  const simpleItems = items.filter(item => item.type === 'simple' && item.id !== editingItemId);
  
  container.innerHTML = '';
  
  if (simpleItems.length === 0) {
    container.innerHTML = `<div class="empty-pool-message">Registra artículos simples primero para usarlos como ingredientes.</div>`;
    return;
  }

  const filtered = simpleItems.filter(item => !searchVal || item.name.toLowerCase().includes(searchVal));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-pool-message">No coincide ningún ingrediente.</div>`;
    return;
  }

  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'ingredient-pool-row';
    row.setAttribute('data-id', item.id);
    
    let isChecked = false;
    let currentQty = 1;
    
    if (editingItemId) {
      const editingItem = items.find(i => i.id === editingItemId);
      if (editingItem && editingItem.type === 'recipe' && editingItem.ingredients) {
        const foundIng = editingItem.ingredients.find(ing => ing.itemId === item.id);
        if (foundIng) {
          isChecked = true;
          currentQty = foundIng.quantity;
        }
      }
    }

    row.innerHTML = `
      <label class="ingredient-label-check">
        <input type="checkbox" class="ingredient-checkbox" data-id="${item.id}" ${isChecked ? 'checked' : ''}>
        <span>${item.name} (${symbol}${item.cost.toFixed(2)})</span>
      </label>
      <div class="ingredient-qty-input-wrapper">
        <input type="number" class="ingredient-qty-input" min="0.001" step="any" value="${currentQty}" data-id="${item.id}" ${isChecked ? '' : 'disabled'}>
        <span>cant.</span>
      </div>
    `;

    const checkbox = row.querySelector('.ingredient-checkbox');
    const qtyInput = row.querySelector('.ingredient-qty-input');
    
    checkbox.addEventListener('change', () => {
      qtyInput.disabled = !checkbox.checked;
      if (checkbox.checked) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
      updateRecipeFormCost();
    });

    qtyInput.addEventListener('input', () => {
      if (checkbox.checked) {
        updateRecipeFormCost();
      }
    });

    if (isChecked) {
      row.classList.add('selected');
    }

    container.appendChild(row);
  });
}

document.getElementById('ingredient-search').addEventListener('input', setupFormIngredients);

// Calculate cost of checked ingredients inside form and sync costs/pricing
function updateRecipeFormCost() {
  if (!radioRecipe.checked) return;
  
  let formCost = 0;
  const rows = document.querySelectorAll('.ingredient-pool-row');
  
  rows.forEach(row => {
    const checkbox = row.querySelector('.ingredient-checkbox');
    const qtyInput = row.querySelector('.ingredient-qty-input');
    
    if (checkbox && checkbox.checked) {
      const ingId = checkbox.dataset.id;
      const quantity = parseFloat(qtyInput.value) || 0;
      const simpleItem = items.find(i => i.id === ingId);
      
      if (simpleItem) {
        formCost += simpleItem.cost * quantity;
      }
    }
  });

  const costEl = document.getElementById('item-cost');
  const calcCostEl = document.getElementById('calculated-recipe-cost');
  const symbol = referenceCurrency === 'USD' ? '$' : '€';
  
  costEl.value = formCost.toFixed(2);
  calcCostEl.textContent = `${symbol}${formCost.toFixed(2)}`;
  
  syncPriceFromCostAndUtility();
}

// Form Submit Handling (Save Item / Recipe)
document.getElementById('item-editor-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const id = document.getElementById('edit-item-id').value;
  const name = document.getElementById('item-name').value.trim();
  const type = radioSimple.checked ? 'simple' : 'recipe';
  const cost = parseFloat(document.getElementById('item-cost').value) || 0;
  const utility = parseFloat(document.getElementById('item-utility').value) || 0;
  const price = parseFloat(document.getElementById('item-price').value) || 0;
  
  let recipeIngredients = [];
  if (type === 'recipe') {
    const rows = document.querySelectorAll('.ingredient-pool-row');
    rows.forEach(row => {
      const checkbox = row.querySelector('.ingredient-checkbox');
      const qtyInput = row.querySelector('.ingredient-qty-input');
      
      if (checkbox && checkbox.checked) {
        recipeIngredients.push({
          itemId: checkbox.dataset.id,
          quantity: parseFloat(qtyInput.value) || 1
        });
      }
    });
    
    if (recipeIngredients.length === 0) {
      alert('Una receta debe contener al menos un ingrediente simple.');
      return;
    }
  }

  if (id) {
    const index = items.findIndex(i => i.id === id);
    if (index !== -1) {
      items[index] = {
        id,
        name,
        type,
        cost,
        utility,
        price,
        ...(type === 'recipe' ? { ingredients: recipeIngredients } : {})
      };
    }
  } else {
    const newId = 'item_' + Date.now();
    items.push({
      id: newId,
      name,
      type,
      cost,
      utility,
      price,
      ...(type === 'recipe' ? { ingredients: recipeIngredients } : {})
    });
  }

  recalculateAllRecipes();
  saveItemsToStorage();
  
  resetEditorForm();
  
  renderInventoryTable();
  renderPOSGrid();
  renderOrder();
});

function resetEditorForm() {
  document.getElementById('edit-item-id').value = '';
  document.getElementById('item-name').value = '';
  radioSimple.checked = true;
  document.getElementById('item-cost').value = '0.00';
  document.getElementById('item-utility').value = '40.0';
  document.getElementById('item-price').value = '0.00';
  document.getElementById('ingredient-search').value = '';
  editingItemId = null;
  
  document.getElementById('form-title').textContent = 'Agregar Nuevo Artículo';
  document.getElementById('btn-cancel-edit').classList.add('hidden');
  document.getElementById('btn-save-item').innerHTML = `
    <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
    Guardar Artículo
  `;
  
  toggleFormTypeFields();
  setupFormIngredients();
  updateCurrencyLabels();
}

document.getElementById('btn-cancel-edit').addEventListener('click', resetEditorForm);

// Search inside Inventory Table
document.getElementById('inventory-search').addEventListener('input', renderInventoryTable);

// Render Inventory Table
function renderInventoryTable() {
  const tbody = document.getElementById('inventory-table-body');
  const searchVal = document.getElementById('inventory-search').value.toLowerCase().trim();
  const emptyState = document.getElementById('empty-inventory-state');
  
  tbody.innerHTML = '';
  
  const filtered = items.filter(item => !searchVal || item.name.toLowerCase().includes(searchVal));
  
  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');

  filtered.forEach(item => {
    const row = document.createElement('tr');
    const typeLabel = item.type === 'simple' ? 'Simple' : 'Receta';
    const typeClass = item.type;
    const symbol = referenceCurrency === 'USD' ? '$' : '€';
    const costBs = item.cost * exchangeRate;
    const priceBs = item.price * exchangeRate;

    row.innerHTML = `
      <td><strong>${item.name}</strong></td>
      <td><span class="badge-item-type ${typeClass}">${typeLabel}</span></td>
      <td>
        ${symbol}${item.cost.toFixed(2)}
        <small class="currency-sub">${costBs.toFixed(2)} Bs.</small>
      </td>
      <td>${item.utility.toFixed(1)}%</td>
      <td>
        <strong>${symbol}${item.price.toFixed(2)}</strong>
        <small class="currency-sub">${priceBs.toFixed(2)} Bs.</small>
      </td>
      <td>
        <div class="td-actions">
          <button class="btn-action-small btn-action-edit" data-id="${item.id}" title="Editar">
            <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn-action-small btn-action-delete" data-id="${item.id}" title="Eliminar">
            <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;

    row.querySelector('.btn-action-edit').addEventListener('click', () => {
      startEditingItem(item.id);
    });
    
    row.querySelector('.btn-action-delete').addEventListener('click', () => {
      deleteRegisteredItem(item.id);
    });

    tbody.appendChild(row);
  });
}

// Edit Mode Entry
function startEditingItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  
  editingItemId = itemId;
  
  document.getElementById('edit-item-id').value = item.id;
  document.getElementById('item-name').value = item.name;
  
  if (item.type === 'recipe') {
    radioRecipe.checked = true;
  } else {
    radioSimple.checked = true;
  }
  
  document.getElementById('item-cost').value = item.cost.toFixed(2);
  document.getElementById('item-utility').value = item.utility.toFixed(1);
  document.getElementById('item-price').value = item.price.toFixed(2);
  
  document.getElementById('form-title').textContent = 'Editar Artículo';
  document.getElementById('btn-cancel-edit').classList.remove('hidden');
  document.getElementById('btn-save-item').innerHTML = `
    <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
    Actualizar Artículo
  `;
  
  toggleFormTypeFields();
  setupFormIngredients();
  
  document.querySelector('.item-form-container').scrollIntoView({ behavior: 'smooth' });
}

// Delete Item
function deleteRegisteredItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  
  const recipesUsingIt = items.filter(i => i.type === 'recipe' && i.ingredients && i.ingredients.some(ing => ing.itemId === itemId));
  if (recipesUsingIt.length > 0) {
    const listNames = recipesUsingIt.map(i => `"${i.name}"`).join(', ');
    alert(`No se puede eliminar "${item.name}" porque se utiliza como ingrediente en las recetas: ${listNames}. Elimine las recetas o quite el ingrediente primero.`);
    return;
  }

  if (confirm(`¿Está seguro de que desea eliminar "${item.name}" del inventario?`)) {
    items = items.filter(i => i.id !== itemId);
    saveItemsToStorage();
    
    if (currentOrder.some(o => o.itemId === itemId)) {
      deleteItemFromOrder(itemId);
    }
    
    if (editingItemId === itemId) {
      resetEditorForm();
    }
    
    renderInventoryTable();
    renderPOSGrid();
    setupFormIngredients();
  }
}

// ==========================================================================
// 10. WAITER MANAGEMENT
// ==========================================================================

function renderWaiterList() {
  const container = document.getElementById('waiter-list');
  if (!container) return;
  container.innerHTML = '';

  waiters.forEach((name, idx) => {
    const row = document.createElement('div');
    row.className = 'waiter-row';
    row.innerHTML = `
      <span class="waiter-index">${idx + 1}.</span>
      <input type="text" class="waiter-name-input" value="${name}" data-idx="${idx}" maxlength="30">
      <button class="btn-action-small btn-waiter-save" data-idx="${idx}" title="Guardar">
        <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
      </button>
      ${waiters.length > 1 ? `<button class="btn-action-small btn-waiter-del" data-idx="${idx}" title="Eliminar">
        <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>` : ''}
    `;

    row.querySelector('.btn-waiter-save').addEventListener('click', () => {
      const input = row.querySelector('.waiter-name-input');
      const newName = input.value.trim();
      if (!newName) { input.value = waiters[idx]; return; }
      waiters[idx] = newName;
      saveWaitersToStorage();
      populateWaiterSelect();
      renderWaiterList();
    });

    const delBtn = row.querySelector('.btn-waiter-del');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (!confirm(`¿Eliminar "${waiters[idx]}" de la lista?`)) return;
        waiters.splice(idx, 1);
        saveWaitersToStorage();
        populateWaiterSelect();
        renderWaiterList();
      });
    }

    container.appendChild(row);
  });

  // Add waiter input + button (only if < 5)
  if (waiters.length < 5) {
    const addRow = document.createElement('div');
    addRow.className = 'waiter-row waiter-row-add';
    addRow.innerHTML = `
      <input type="text" id="waiter-name-input-add" class="waiter-name-input" placeholder="Nombre del mesero" maxlength="30">
      <button id="btn-add-waiter" class="btn btn-secondary" style="white-space:nowrap;">+ Agregar</button>
    `;
    addRow.querySelector('#btn-add-waiter').addEventListener('click', () => {
      const input = addRow.querySelector('#waiter-name-input-add');
      const name = input.value.trim();
      if (!name) { alert('Ingrese un nombre para el mesero.'); return; }
      if (waiters.includes(name)) { alert('Ese mesero ya existe.'); return; }
      waiters.push(name);
      saveWaitersToStorage();
      populateWaiterSelect();
      renderWaiterList();
    });
    addRow.querySelector('#waiter-name-input-add').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addRow.querySelector('#btn-add-waiter').click(); }
    });
    container.appendChild(addRow);
  }
}

function populateWaiterSelect() {
  const sel = document.getElementById('order-waiter');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '';
  waiters.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = w;
    sel.appendChild(opt);
  });
  if (waiters.includes(currentVal)) sel.value = currentVal;
}

// ==========================================================================
// 11. SALES HISTORY
// ==========================================================================

function renderSalesHistory() {
  const tbody = document.getElementById('history-table-body');
  const emptyState = document.getElementById('empty-history-state');
  const countEl = document.getElementById('history-count');
  const showingEl = document.getElementById('history-showing-count');
  const totalUsdEl = document.getElementById('history-total-usd');
  const totalBsEl = document.getElementById('history-total-bs');
  if (!tbody) return;

  const filterTable = document.getElementById('filter-table').value;
  const filterWaiter = document.getElementById('filter-waiter').value;
  const filterFrom = document.getElementById('filter-date-from').value;
  const filterTo = document.getElementById('filter-date-to').value;

  let filtered = [...salesHistory];

  if (filterTable !== 'all') {
    filtered = filtered.filter(s => s.table === filterTable);
  }
  if (filterWaiter !== 'all') {
    filtered = filtered.filter(s => s.waiter === filterWaiter);
  }
  if (filterFrom) {
    const fromDate = new Date(filterFrom);
    fromDate.setHours(0, 0, 0, 0);
    filtered = filtered.filter(s => new Date(s.date) >= fromDate);
  }
  if (filterTo) {
    const toDate = new Date(filterTo);
    toDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter(s => new Date(s.date) <= toDate);
  }

  tbody.innerHTML = '';
  const symbol = referenceCurrency === 'USD' ? '$' : '€';

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    if (countEl) countEl.textContent = '0 ventas';
    if (showingEl) showingEl.textContent = '0';
    if (totalUsdEl) totalUsdEl.textContent = symbol + '0.00';
    if (totalBsEl) totalBsEl.textContent = '0.00 Bs.';
    return;
  }
  emptyState.classList.add('hidden');

  let totalUsd = 0;
  let totalBs = 0;

  filtered.forEach((sale, idx) => {
    totalUsd += sale.total;
    totalBs += sale.totalBs;
    const dateObj = new Date(sale.date);
    const dateStr = dateObj.toLocaleDateString('es-ES') + ' ' + dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const qty = sale.items.reduce((acc, i) => acc + i.quantity, 0);
    const payLabel = sale.paymentMethod === 'efectivo' ? 'Efectivo' : sale.paymentMethod === 'transferencia' ? 'Transferencia' : 'Mixto';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${idx + 1}</td>
      <td>${dateStr}</td>
      <td><strong>${sale.table}</strong></td>
      <td>${sale.waiter}</td>
      <td>${qty}</td>
      <td><strong>${symbol}${sale.total.toFixed(2)}</strong> <small class="currency-sub">${sale.totalBs.toFixed(2)} Bs.</small></td>
      <td>${payLabel}</td>
    `;
    tbody.appendChild(row);
  });

  if (countEl) countEl.textContent = salesHistory.length + ' ventas';
  if (showingEl) showingEl.textContent = filtered.length;
  if (totalUsdEl) totalUsdEl.textContent = symbol + totalUsd.toFixed(2);
  if (totalBsEl) totalBsEl.textContent = totalBs.toFixed(2) + ' Bs.';
}

function populateHistoryFilters() {
  const tableSel = document.getElementById('filter-table');
  const waiterSel = document.getElementById('filter-waiter');
  if (!tableSel || !waiterSel) return;

  // Tables
  const currentTable = tableSel.value;
  tableSel.innerHTML = '<option value="all">Todas las mesas</option>';
  for (let i = 1; i <= tableCount; i++) {
    const opt = document.createElement('option');
    opt.value = 'Mesa ' + i;
    opt.textContent = 'Mesa ' + i;
    tableSel.appendChild(opt);
  }
  tableSel.value = currentTable;

  // Waiters
  const currentWaiter = waiterSel.value;
  waiterSel.innerHTML = '<option value="all">Todos los meseros</option>';
  waiters.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = w;
    waiterSel.appendChild(opt);
  });
  waiterSel.value = currentWaiter;
}

function printSalesReport() {
  const filterTable = document.getElementById('filter-table').value;
  const filterWaiter = document.getElementById('filter-waiter').value;
  const filterFrom = document.getElementById('filter-date-from').value;
  const filterTo = document.getElementById('filter-date-to').value;

  let filtered = [...salesHistory];

  if (filterTable !== 'all') filtered = filtered.filter(s => s.table === filterTable);
  if (filterWaiter !== 'all') filtered = filtered.filter(s => s.waiter === filterWaiter);
  if (filterFrom) { const d = new Date(filterFrom); d.setHours(0,0,0,0); filtered = filtered.filter(s => new Date(s.date) >= d); }
  if (filterTo) { const d = new Date(filterTo); d.setHours(23,59,59,999); filtered = filtered.filter(s => new Date(s.date) <= d); }

  const symbol = referenceCurrency === 'USD' ? '$' : '€';
  let totalUsd = 0, totalBs = 0;

  let html = `
    <div style="font-family:'Space Mono','Courier New',monospace; font-size:10px; width:72mm; margin:0 auto; padding:2mm 0;">
      <div style="text-align:center; margin-bottom:3mm;">
        <div style="font-size:14px; font-weight:700; text-transform:uppercase;">GASTRO POS</div>
        <div style="font-size:8px; text-transform:uppercase;">Reporte de Ventas</div>
        <div style="font-size:8px;">${new Date().toLocaleDateString('es-ES')} ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <div style="border-top:1px dashed #000; margin:2mm 0;"></div>
      <table style="width:100%; border-collapse:collapse; font-size:9px;">
        <tr><td style="padding:1px 0;"><strong>Filtro Mesa:</strong></td><td style="text-align:right;">${filterTable === 'all' ? 'Todas' : filterTable}</td></tr>
        <tr><td style="padding:1px 0;"><strong>Filtro Mesero:</strong></td><td style="text-align:right;">${filterWaiter === 'all' ? 'Todos' : filterWaiter}</td></tr>
        <tr><td style="padding:1px 0;"><strong>Desde:</strong></td><td style="text-align:right;">${filterFrom || 'Siempre'}</td></tr>
        <tr><td style="padding:1px 0;"><strong>Hasta:</strong></td><td style="text-align:right;">${filterTo || 'Siempre'}</td></tr>
      </table>
      <div style="border-top:1px dashed #000; margin:2mm 0;"></div>
      <table style="width:100%; border-collapse:collapse; font-size:9px;">
        <thead>
          <tr>
            <th style="border-bottom:1px dashed #000; text-align:left; padding:2px 0; font-size:8px; text-transform:uppercase;">#</th>
            <th style="border-bottom:1px dashed #000; text-align:left; padding:2px 0; font-size:8px; text-transform:uppercase;">Fecha</th>
            <th style="border-bottom:1px dashed #000; text-align:left; padding:2px 0; font-size:8px; text-transform:uppercase;">Mesa</th>
            <th style="border-bottom:1px dashed #000; text-align:left; padding:2px 0; font-size:8px; text-transform:uppercase;">Items</th>
            <th style="border-bottom:1px dashed #000; text-align:right; padding:2px 0; font-size:8px; text-transform:uppercase;">Total</th>
          </tr>
        </thead>
        <tbody>
  `;

  filtered.forEach((sale, idx) => {
    totalUsd += sale.total;
    totalBs += sale.totalBs;
    const dateObj = new Date(sale.date);
    const dateStr = dateObj.toLocaleDateString('es-ES') + ' ' + dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const qty = sale.items.reduce((acc, i) => acc + i.quantity, 0);
    html += `
      <tr>
        <td style="padding:2px 0; font-weight:700;">${idx + 1}</td>
        <td style="padding:2px 0;">${dateStr}</td>
        <td style="padding:2px 0; font-weight:700;">${sale.table}</td>
        <td style="padding:2px 0;">${qty}</td>
        <td style="padding:2px 0; text-align:right; font-weight:700;">${symbol}${sale.total.toFixed(2)}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <div style="border-top:1px dashed #000; margin:2mm 0;"></div>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <tr><td style="padding:1px 0; font-weight:700;">TOTAL VENTAS:</td><td style="text-align:right; font-weight:700;">${filtered.length}</td></tr>
        <tr><td style="padding:1px 0; font-weight:700;">TOTAL ${referenceCurrency}:</td><td style="text-align:right; font-weight:700;">${symbol}${totalUsd.toFixed(2)}</td></tr>
        <tr><td style="padding:1px 0; font-weight:700;">TOTAL Bs.:</td><td style="text-align:right; font-weight:700;">${totalBs.toFixed(2)} Bs.</td></tr>
      </table>
      <div style="text-align:center; margin-top:5mm; font-size:9px; border-top:1px dashed #000; padding-top:3mm;">
        <div style="font-weight:700; text-transform:uppercase;">GastroPOS - Reporte Generado</div>
      </div>
    </div>
  `;

  const printWin = window.open('', '_blank', 'width=300,height=600');
  printWin.document.write(`
    <html><head><meta charset="UTF-8"><title>Reporte de Ventas</title>
    <style>
      @page { margin: 0; size: 80mm auto; }
      body { margin: 0; padding: 0; font-family: 'Courier New', monospace; }
      table { width: 100%; border-collapse: collapse; }
      th, td { font-size: 9px; }
    </style>
    </head><body>${html}</body></html>
  `);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); }, 500);
}

// ==========================================================================
// LOGIN & AUTH — Multi-user
// ==========================================================================

let users = [];
let currentUser = null;

function loadUsers() {
  const stored = localStorage.getItem('gastropos_users');
  if (stored) {
    try {
      users = JSON.parse(stored);
      let migrated = false;
      // Ensure all passwords are base64 & all users have role
      users = users.map(u => {
        if (!u.role) { u.role = 'admin'; migrated = true; }
        try {
          const decoded = atob(u.password);
          if (btoa(decoded) === u.password) return u;
        } catch {}
        migrated = true;
        return { ...u, password: btoa(u.password) };
      });
      if (migrated) saveUsers();
      if (users.length === 0) {
        users = [{ username: 'admin', password: btoa('admin'), role: 'admin' }];
        saveUsers();
      }
    } catch {
      users = [{ username: 'admin', password: btoa('admin'), role: 'admin' }];
      saveUsers();
    }
  } else {
    const oldPwd = localStorage.getItem('gastropos_password');
    if (oldPwd) {
      users = [{ username: 'admin', password: btoa(oldPwd), role: 'admin' }];
      saveUsers();
      localStorage.removeItem('gastropos_password');
    } else {
      users = [{ username: 'admin', password: btoa('admin'), role: 'admin' }];
      saveUsers();
    }
  }
}

function saveUsers() {
  localStorage.setItem('gastropos_users', JSON.stringify(users));
  firebaseSet('gastropos_users', users);
}

function checkLogin() {
  loadUsers();
  const loggedIn = sessionStorage.getItem('gastropos_logged_in');
  if (loggedIn === 'true') {
    currentUser = sessionStorage.getItem('gastropos_logged_user') || 'admin';
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-badge').textContent = currentUser;
    return true;
  }
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-setup').classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('login-user').focus();
  return false;
}

function doLogout() {
  sessionStorage.removeItem('gastropos_logged_in');
  sessionStorage.removeItem('gastropos_logged_user');
  currentUser = null;
  location.reload();
}

document.getElementById('btn-logout').addEventListener('click', doLogout);

document.getElementById('btn-login-setup').addEventListener('click', () => {
  const username = document.getElementById('login-setup-user').value.trim().toLowerCase() || 'admin';
  const pwd = document.getElementById('login-setup-password').value.trim();
  const confirm = document.getElementById('login-setup-password-confirm').value.trim();
  if (!pwd) { alert('Ingrese una contraseña.'); return; }
  if (pwd !== confirm) { alert('Las contraseñas no coinciden.'); return; }
  if (pwd.length < 4) { alert('La contraseña debe tener al menos 4 caracteres.'); return; }
  if (users.some(u => u.username === username)) { alert('Ese usuario ya existe.'); return; }
  users.push({ username, password: btoa(pwd) });
  saveUsers();
  currentUser = username;
  sessionStorage.setItem('gastropos_logged_in', 'true');
  sessionStorage.setItem('gastropos_logged_user', username);
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-badge').textContent = username;
  document.getElementById('login-setup-user').value = '';
  document.getElementById('login-setup-password').value = '';
  document.getElementById('login-setup-password-confirm').value = '';
});

document.getElementById('btn-login').addEventListener('click', () => {
  const username = document.getElementById('login-user').value.trim().toLowerCase();
  const pwd = document.getElementById('login-password').value.trim();
  loadUsers();
  if (users.length === 0) { location.reload(); return; }
  const found = users.find(u => u.username === username && atob(u.password) === pwd);
  if (found) {
    currentUser = username;
    sessionStorage.setItem('gastropos_logged_in', 'true');
    sessionStorage.setItem('gastropos_logged_user', username);
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-badge').textContent = username;
    document.getElementById('login-user').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').classList.add('hidden');
  } else {
    document.getElementById('login-error').classList.remove('hidden');
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
  }
});

document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-login').click(); }
});
document.getElementById('login-user').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('login-password').focus(); }
});
document.getElementById('login-setup-user').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('login-setup-password').focus(); }
});
document.getElementById('login-setup-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('login-setup-password-confirm').focus(); }
});
document.getElementById('login-setup-password-confirm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-login-setup').click(); }
});

// ==========================================================================
// USER MANAGEMENT (settings panel)
// ==========================================================================

function renderUserList() {
  const container = document.getElementById('user-list');
  if (!container) return;
  loadUsers();
  container.innerHTML = '';
  const isAdmin = users.find(u => u.username === currentUser)?.role === 'admin';
  users.forEach((u, idx) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    const isCurrent = u.username === currentUser;
    const roleLabel = u.role === 'admin' ? 'Admin' : 'Usuario';
    row.innerHTML = `
      <span class="user-name">${u.username}</span>
      <span class="user-role-badge ${u.role}">${roleLabel}</span>
      ${isCurrent ? '<span class="user-current-badge">Sesión actual</span>' : ''}
      ${isAdmin ? `<button class="btn-action-small btn-user-del" data-idx="${idx}" title="Eliminar usuario">
        <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>` : ''}
    `;
    const delBtn = row.querySelector('.btn-user-del');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (users.length <= 1) { alert('Debe haber al menos un usuario.'); return; }
        if (isCurrent) { alert('No puedes eliminar tu propio usuario. Cierra sesión primero.'); return; }
        if (!confirm(`¿Eliminar usuario "${u.username}"?`)) return;
        users.splice(idx, 1);
        saveUsers();
        renderUserList();
      });
    }
    container.appendChild(row);
  });
}

document.getElementById('btn-add-user').addEventListener('click', () => {
  const username = document.getElementById('user-add-username').value.trim().toLowerCase();
  const password = document.getElementById('user-add-password').value.trim();
  const role = document.getElementById('user-add-role').value;
  if (!username) { alert('Ingrese un nombre de usuario.'); return; }
  if (!password || password.length < 4) { alert('La contraseña debe tener al menos 4 caracteres.'); return; }
  loadUsers();
  if (users.some(u => u.username === username)) { alert('Ese usuario ya existe.'); return; }
  users.push({ username, password: btoa(password), role });
  saveUsers();
  renderUserList();
  document.getElementById('user-add-username').value = '';
  document.getElementById('user-add-password').value = '';
});

document.getElementById('user-add-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-user').click(); }
});

// ==========================================================================
// JSON EXPORT / IMPORT
// ==========================================================================

function exportJSON() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('gastropos_'));
  const data = {};
  keys.forEach(k => {
    try { data[k] = JSON.parse(localStorage.getItem(k)); } catch { data[k] = localStorage.getItem(k); }
  });
  data._exportDate = new Date().toISOString();
  data._version = '1.0.0';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gastropos-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') { alert('Archivo JSON inválido.'); return; }
      const gastroKeys = Object.keys(data).filter(k => k.startsWith('gastropos_'));
      if (gastroKeys.length === 0) { alert('El archivo no contiene datos de GastroPOS.'); return; }
      if (!confirm(`Se restaurarán ${gastroKeys.length} datos. ¿Desea continuar? Se recargará la página.`)) return;
      gastroKeys.forEach(k => {
        localStorage.setItem(k, JSON.stringify(data[k]));
      });
      alert('Datos restaurados correctamente. La página se recargará.');
      sessionStorage.removeItem('gastropos_logged_in');
      location.reload();
    } catch (err) {
      alert('Error al leer el archivo JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

document.getElementById('btn-export-json').addEventListener('click', exportJSON);
document.getElementById('btn-import-json').addEventListener('click', () => {
  document.getElementById('import-json-input').click();
});
document.getElementById('import-json-input').addEventListener('change', (e) => {
  if (e.target.files.length > 0) { importJSON(e.target.files[0]); }
  e.target.value = '';
});

// ==========================================================================
// 12. LIFE-CYCLE BOOTSTRAP
// ==========================================================================

// Safe localStorage wrappers (handles file:// SecurityError)
function safeGet(key, fallback = null) {
  try { return localStorage.getItem(key); } catch { return fallback; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    initApp();
  } catch (e) {
    console.error('initApp error:', e);
  }
  try {
    checkLogin();
  } catch (e) {
    console.error('checkLogin error:', e);
  }
  // Fallback: if both login-screen and app are hidden, force show login
  const loginEl = document.getElementById('login-screen');
  const appEl = document.getElementById('app');
  if (loginEl && appEl && loginEl.classList.contains('hidden') && appEl.classList.contains('hidden')) {
    loginEl.classList.remove('hidden');
  }
});
