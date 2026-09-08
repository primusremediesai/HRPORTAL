// ==========================================
// HR PORTAL — DATABASE LAYER (IndexedDB)
// Persistent data storage with full CRUD
// ==========================================

const DB_NAME = 'HRPortalDB';
const DB_VERSION = 3;

const STORES = {
  employees: 'employees',
  joining: 'joining',
  resignation: 'resignation',
  confirmation: 'confirmation',
  attendance: 'attendance',
  leave: 'leave',
  payroll: 'payroll',
  recruitment: 'recruitment',
  probation: 'probation',
  headcount: 'headcount',
  audit: 'audit',
  masterData: 'masterData',
  settings: 'settings'
};

class HRDatabase {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Employees store
        if (!db.objectStoreNames.contains(STORES.employees)) {
          const empStore = db.createObjectStore(STORES.employees, { keyPath: 'EmployeeCode' });
          empStore.createIndex('Division', 'Division', { unique: false });
          empStore.createIndex('HQ', 'HQ', { unique: false });
          empStore.createIndex('Designation', 'Designation', { unique: false });
          empStore.createIndex('EmploymentStatus', 'EmploymentStatus', { unique: false });
          empStore.createIndex('EmployeeName', 'EmployeeName', { unique: false });
        }
        
        // Joining store
        if (!db.objectStoreNames.contains(STORES.joining)) {
          const joinStore = db.createObjectStore(STORES.joining, { keyPath: 'id', autoIncrement: true });
          joinStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
          joinStore.createIndex('DOJ', 'DOJ', { unique: false });
        }
        
        // Resignation store
        if (!db.objectStoreNames.contains(STORES.resignation)) {
          const resStore = db.createObjectStore(STORES.resignation, { keyPath: 'id', autoIncrement: true });
          resStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
        }
        
        // Confirmation store
        if (!db.objectStoreNames.contains(STORES.confirmation)) {
          const confStore = db.createObjectStore(STORES.confirmation, { keyPath: 'id', autoIncrement: true });
          confStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
        }
        
        // Attendance store
        if (!db.objectStoreNames.contains(STORES.attendance)) {
          const attStore = db.createObjectStore(STORES.attendance, { keyPath: 'id', autoIncrement: true });
          attStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
          attStore.createIndex('Month', 'Month', { unique: false });
          attStore.createIndex('EmpMonth', ['EmployeeCode', 'Month'], { unique: true });
        }
        
        // Leave store
        if (!db.objectStoreNames.contains(STORES.leave)) {
          const leaveStore = db.createObjectStore(STORES.leave, { keyPath: 'id', autoIncrement: true });
          leaveStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
          leaveStore.createIndex('Month', 'Month', { unique: false });
        }
        
        // Payroll store
        if (!db.objectStoreNames.contains(STORES.payroll)) {
          const payStore = db.createObjectStore(STORES.payroll, { keyPath: 'id', autoIncrement: true });
          payStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
          payStore.createIndex('Month', 'Month', { unique: false });
          payStore.createIndex('EmpMonth', ['EmployeeCode', 'Month'], { unique: true });
        }
        
        // Recruitment store
        if (!db.objectStoreNames.contains(STORES.recruitment)) {
          const recStore = db.createObjectStore(STORES.recruitment, { keyPath: 'id', autoIncrement: true });
          recStore.createIndex('Month', 'Month', { unique: false });
        }
        
        // Probation store
        if (!db.objectStoreNames.contains(STORES.probation)) {
          const probStore = db.createObjectStore(STORES.probation, { keyPath: 'id', autoIncrement: true });
          probStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
        }
        
        // Historical Headcount store
        if (!db.objectStoreNames.contains(STORES.headcount)) {
          const hcStore = db.createObjectStore(STORES.headcount, { keyPath: 'id', autoIncrement: true });
          hcStore.createIndex('Month', 'Month', { unique: false });
        }
        
        // Audit trail store
        if (!db.objectStoreNames.contains(STORES.audit)) {
          const auditStore = db.createObjectStore(STORES.audit, { keyPath: 'id', autoIncrement: true });
          auditStore.createIndex('EmployeeCode', 'EmployeeCode', { unique: false });
          auditStore.createIndex('Module', 'Module', { unique: false });
          auditStore.createIndex('Timestamp', 'Timestamp', { unique: false });
        }
        
        // Master Data store
        if (!db.objectStoreNames.contains(STORES.masterData)) {
          db.createObjectStore(STORES.masterData, { keyPath: 'category' });
        }
        
        // Settings store
        if (!db.objectStoreNames.contains(STORES.settings)) {
          db.createObjectStore(STORES.settings, { keyPath: 'key' });
        }
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
    });
  }

  // Generic CRUD operations
  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async add(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async count(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async bulkPut(storeName, items) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let count = 0;
      items.forEach(item => {
        const request = store.put(item);
        request.onsuccess = () => { count++; };
      });
      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Audit logging
  async logAudit(entry) {
    const auditEntry = {
      ...entry,
      Timestamp: new Date().toISOString(),
      User: 'HR Admin'
    };
    return this.add(STORES.audit, auditEntry);
  }
}

// Singleton instance
const db = new HRDatabase();
