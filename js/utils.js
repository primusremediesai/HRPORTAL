// ==========================================
// HR PORTAL — UTILITY FUNCTIONS
// Date parsing, formatting, calculations
// ==========================================

const Utils = {
  // Date parsing - handles DD-MMM-YY and DD-Mon-YY formats
  parseDate(dateStr) {
    if (!dateStr || dateStr === '' || dateStr === 'N/A' || dateStr === '-') return null;
    
    // Try DD-Mon-YY (e.g., 07-Apr-12)
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const monthStr = parts[1];
      const yearStr = parts[2];
      
      const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
      };
      
      const month = months[monthStr];
      if (month !== undefined) {
        let year = parseInt(yearStr);
        if (year < 100) year += year < 50 ? 2000 : 1900;
        return new Date(year, month, day);
      }
      
      // Try DD-MM-YYYY
      const m = parseInt(parts[1]) - 1;
      const y = parseInt(parts[2]);
      if (!isNaN(m) && !isNaN(y)) {
        return new Date(y < 100 ? y + 2000 : y, m, day);
      }
    }
    
    // Try ISO format
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  },

  formatDate(date) {
    if (!date) return '-';
    if (typeof date === 'string') date = this.parseDate(date);
    if (!date) return '-';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  },

  formatDateShort(date) {
    if (!date) return '-';
    if (typeof date === 'string') date = this.parseDate(date);
    if (!date) return '-';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  },

  formatMonthYear(date) {
    if (!date) return '-';
    if (typeof date === 'string') date = this.parseDate(date);
    if (!date) return '-';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  },

  // Calculate tenure
  calculateTenure(doj, endDate) {
    if (!doj) return { text: '-', years: 0, months: 0, days: 0, totalMonths: 0 };
    const start = typeof doj === 'string' ? this.parseDate(doj) : doj;
    const end = endDate || new Date();
    if (!start) return { text: '-', years: 0, months: 0, days: 0, totalMonths: 0 };
    
    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    let days = end.getDate() - start.getDate();
    
    if (days < 0) { months--; days += 30; }
    if (months < 0) { years--; months += 12; }
    
    const totalMonths = years * 12 + months;
    
    const parts = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0 && years === 0) parts.push(`${days}d`);
    
    return {
      text: parts.length ? parts.join(' ') : '< 1m',
      years, months, days, totalMonths
    };
  },

  // Tenure bracket
  getTenureBracket(doj) {
    const tenure = this.calculateTenure(doj);
    const tm = tenure.totalMonths;
    if (tm < 6) return '< 6 months';
    if (tm < 12) return '6-12 months';
    if (tm < 24) return '1-2 years';
    if (tm < 36) return '2-3 years';
    if (tm < 60) return '3-5 years';
    return '5+ years';
  },

  // Get initials
  getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  },

  // Escape HTML
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // Generate unique ID
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  },

  // Group by
  groupBy(arr, key) {
    return arr.reduce((groups, item) => {
      const val = item[key] || 'Unknown';
      (groups[val] = groups[val] || []).push(item);
      return groups;
    }, {});
  },

  // Count by
  countBy(arr, key) {
    const groups = this.groupBy(arr, key);
    const result = {};
    for (const [k, v] of Object.entries(groups)) {
      result[k] = v.length;
    }
    return result;
  },

  // Sort object by value
  sortObjByValue(obj, desc = true) {
    return Object.fromEntries(
      Object.entries(obj).sort(([,a], [,b]) => desc ? b - a : a - b)
    );
  },

  // Top N from object
  topN(obj, n = 10) {
    const sorted = this.sortObjByValue(obj);
    return Object.fromEntries(Object.entries(sorted).slice(0, n));
  },

  // Debounce
  debounce(fn, delay = 300) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  // Number formatting
  formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return num.toLocaleString('en-IN');
  },

  formatPercent(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return num.toFixed(1) + '%';
  },

  formatCurrency(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return '₹' + num.toLocaleString('en-IN');
  },

  // Month list generator
  getMonthsList(startYear = 2024, endYear = 2027) {
    const months = [];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    for (let y = startYear; y <= endYear; y++) {
      for (let m = 0; m < 12; m++) {
        months.push({
          value: `${y}-${String(m+1).padStart(2,'0')}`,
          label: `${monthNames[m]} ${y}`
        });
      }
    }
    return months;
  },

  // Parse tenure string from Excel (e.g., "3years,6months,30days")
  parseTenureString(str) {
    if (!str) return null;
    const y = str.match(/(\d+)years?/i);
    const m = str.match(/(\d+)months?/i);
    const d = str.match(/(\d+)days?/i);
    return {
      years: y ? parseInt(y[1]) : 0,
      months: m ? parseInt(m[1]) : 0,
      days: d ? parseInt(d[1]) : 0
    };
  },

  // Get month key from date
  getMonthKey(date) {
    if (!date) return null;
    if (typeof date === 'string') date = this.parseDate(date);
    if (!date) return null;
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  },

  // Chart color palette
  chartColors: [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#6366f1',
    '#84cc16', '#a855f7', '#0ea5e9', '#e11d48', '#22c55e',
    '#eab308', '#6d28d9', '#0891b2', '#c026d3', '#dc2626'
  ],

  // Status class mapping
  getStatusClass(status) {
    if (!status) return '';
    const s = status.toLowerCase();
    if (s === 'confirmed') return 'confirmed';
    if (s === 'probation') return 'probation';
    if (s === 'promoted') return 'promoted';
    if (s === 'resigned') return 'resigned';
    if (s === 'terminated') return 'terminated';
    if (s === 'transferred') return 'transferred';
    return '';
  },

  // Validate employee code format
  isValidEmployeeCode(code) {
    return code && /^PRI\d+$/i.test(code.trim());
  }
};
