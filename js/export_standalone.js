const StandaloneExport = {
  async download() {
    try {
      App.showToast('Preparing interactive report...', 'info');
      
      // Fetch CSS and Utils
      const cssResp = await fetch('css/styles.css');
      const cssContent = await cssResp.text();
      const utilsResp = await fetch('js/utils.js');
      const utilsContent = await utilsResp.text();
      
      const payload = {
        employees: State.employees,
        joining: State.joining,
        resignation: State.resignation,
        confirmation: State.confirmation
      };

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Executive Overview - Interactive Standalone Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
      ${cssContent}
      html, body { overflow: auto !important; height: auto !important; }
      body { background-color: var(--bg-tertiary); margin: 0; padding: 20px; }
      .standalone-container { max-width: 1400px; margin: 0 auto; }
      .header-title { padding-bottom: 20px; border-bottom: 1px solid var(--border-light); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
      #contentArea { background: transparent; box-shadow: none; padding: 0; overflow: visible !important; height: auto !important; }
    </style>
</head>
<body>
    <div class="standalone-container">
      <div class="header-title">
        <div>
          <h1 style="margin:0;color:var(--brand-primary);font-size:24px;">Executive Overview</h1>
          <p style="margin:5px 0 0;color:var(--text-tertiary);font-size:14px;">Interactive Standalone Report</p>
        </div>
        <div style="color:var(--text-secondary);font-size:12px;">
          Generated on: ${new Date().toLocaleString()}
        </div>
      </div>
      <div id="contentArea"></div>
    </div>

    <script>
      ${utilsContent}

      const State = {
        employees: ${JSON.stringify(payload.employees)},
        joining: ${JSON.stringify(payload.joining)},
        resignation: ${JSON.stringify(payload.resignation)},
        confirmation: ${JSON.stringify(payload.confirmation)},
        filters: {},
        charts: {}
      };

      const App = {
        getFilteredEmployees() {
          let emps = [...State.employees];
          const f = State.filters;
          if (f.division) emps = emps.filter(e => e.Division === f.division);
          if (f.hq) emps = emps.filter(e => e.HQ === f.hq);
          if (f.designation) emps = emps.filter(e => e.Designation === f.designation);
          if (f.status) emps = emps.filter(e => e.EmploymentStatus === f.status);
          if (f.month) emps = emps.filter(e => e.DOJ && e.DOJ.split('-')[1] === f.month);
          if (f.year) emps = emps.filter(e => e.DOJ && e.DOJ.split('-')[0] === f.year);
          return emps;
        },
        setFilter(key, value) {
          if (value) State.filters[key] = value;
          else delete State.filters[key];
          this.renderOverview();
        },
        clearFilters() {
          State.filters = {};
          this.renderOverview();
        },
        navigate() {
          console.log('Navigation is disabled in standalone report.');
        },
        renderFilterBar() {
          const divisions = [...new Set(State.employees.map(e => e.Division).filter(Boolean))].sort();
          const hqs = [...new Set(State.employees.map(e => e.HQ).filter(Boolean))].sort();
          const designations = [...new Set(State.employees.map(e => e.Designation).filter(Boolean))].sort();
          const statuses = [...new Set(State.employees.map(e => e.EmploymentStatus).filter(Boolean))].sort();
          const f = State.filters;
          
          return \`
            <div class="filter-bar">
              <div class="filter-bar-header">
                <div class="filter-bar-title">🔍 Filters</div>
                <div class="filter-bar-actions">
                  <button class="btn btn-xs btn-ghost" onclick="App.clearFilters()">Clear All</button>
                </div>
              </div>
              <div class="filter-grid">
                <div class="filter-group">
                  <label>Division</label>
                  <select onchange="App.setFilter('division', this.value)">
                    <option value="">All Divisions</option>
                    \${divisions.map(d => \`<option value="\${d}" \${f.division===d?'selected':''}>\${d}</option>\`).join('')}
                  </select>
                </div>
                <div class="filter-group">
                  <label>HQ / Location</label>
                  <select onchange="App.setFilter('hq', this.value)">
                    <option value="">All HQs</option>
                    \${hqs.map(h => \`<option value="\${h}" \${f.hq===h?'selected':''}>\${h}</option>\`).join('')}
                  </select>
                </div>
                <div class="filter-group">
                  <label>Designation</label>
                  <select onchange="App.setFilter('designation', this.value)">
                    <option value="">All Designations</option>
                    \${designations.map(d => \`<option value="\${d}" \${f.designation===d?'selected':''}>\${d}</option>\`).join('')}
                  </select>
                </div>
                <div class="filter-group">
                  <label>Status</label>
                  <select onchange="App.setFilter('status', this.value)">
                    <option value="">All Statuses</option>
                    \${statuses.map(s => \`<option value="\${s}" \${f.status===s?'selected':''}>\${s}</option>\`).join('')}
                  </select>
                </div>
                <div class="filter-group">
                  <label>Month</label>
                  <select onchange="App.setFilter('month', this.value)">
                    <option value="">All Months</option>
                    <option value="01" \${f.month==='01'?'selected':''}>Jan</option>
                    <option value="02" \${f.month==='02'?'selected':''}>Feb</option>
                    <option value="03" \${f.month==='03'?'selected':''}>Mar</option>
                    <option value="04" \${f.month==='04'?'selected':''}>Apr</option>
                    <option value="05" \${f.month==='05'?'selected':''}>May</option>
                    <option value="06" \${f.month==='06'?'selected':''}>Jun</option>
                    <option value="07" \${f.month==='07'?'selected':''}>Jul</option>
                    <option value="08" \${f.month==='08'?'selected':''}>Aug</option>
                    <option value="09" \${f.month==='09'?'selected':''}>Sep</option>
                    <option value="10" \${f.month==='10'?'selected':''}>Oct</option>
                    <option value="11" \${f.month==='11'?'selected':''}>Nov</option>
                    <option value="12" \${f.month==='12'?'selected':''}>Dec</option>
                  </select>
                </div>
                <div class="filter-group">
                  <label>Year</label>
                  <select onchange="App.setFilter('year', this.value)">
                    <option value="">All Years</option>
                    <option value="2023" \${f.year==='2023'?'selected':''}>2023</option>
                    <option value="2024" \${f.year==='2024'?'selected':''}>2024</option>
                    <option value="2025" \${f.year==='2025'?'selected':''}>2025</option>
                    <option value="2026" \${f.year==='2026'?'selected':''}>2026</option>
                    <option value="2027" \${f.year==='2027'?'selected':''}>2027</option>
                  </select>
                </div>
              </div>
            </div>
          \`;
        },
        createChart(canvasId, config) {
          setTimeout(() => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            if (State.charts[canvasId]) State.charts[canvasId].destroy();
            config.options = config.options || {};
            config.options.responsive = true;
            config.options.maintainAspectRatio = false;
            config.options.plugins = config.options.plugins || {};
            config.options.plugins.legend = config.options.plugins.legend || { position: 'bottom', labels: { font: { size: 11, family: 'Inter' }, padding: 12, usePointStyle: true, pointStyle: 'circle' } };
            State.charts[canvasId] = new Chart(canvas, config);
          }, 50);
        },
        renderOverview() {
          const emps = App.getFilteredEmployees();
          const active = emps.filter(e => e.EmploymentStatus !== 'Resigned' && e.EmploymentStatus !== 'Terminated');
          const resigned = emps.filter(e => e.EmploymentStatus === 'Resigned');
          const probation = emps.filter(e => e.EmploymentStatus === 'Probation');
          const confirmed = emps.filter(e => e.EmploymentStatus === 'Confirmed');
          
          const totalJoining = State.joining.length;
          const totalResignation = State.resignation.length;
          const confirmationsCount = State.confirmation.length;
          
          const divCounts = Utils.countBy(active, 'Division');
          const hqCounts = Utils.countBy(active, 'HQ');
          const desCounts = Utils.countBy(active, 'Designation');
          const statusCounts = Utils.countBy(emps, 'EmploymentStatus');
          
          const tenureBrackets = {};
          active.forEach(e => {
            const b = Utils.getTenureBracket(e.DOJ);
            tenureBrackets[b] = (tenureBrackets[b] || 0) + 1;
          });
          
          const joiningByMonth = {};
          State.joining.forEach(j => {
            const mk = Utils.getMonthKey(j.DOJ);
            if (mk) joiningByMonth[mk] = (joiningByMonth[mk] || 0) + 1;
          });
          
          const exitsByMonth = {};
          State.resignation.forEach(r => {
            const mk = Utils.getMonthKey(r.LWD);
            if (mk) exitsByMonth[mk] = (exitsByMonth[mk] || 0) + 1;
          });
          
          const exitsByDiv = Utils.countBy(State.resignation, 'Division');
          const exitsByHQ = Utils.countBy(State.resignation, 'HQ');
          const attritionRate = active.length > 0 ? (totalResignation / (active.length + totalResignation) * 100) : 0;
          const pendingConf = probation.length;
          
          const content = document.getElementById('contentArea');
          content.innerHTML = \`
            \${App.renderFilterBar()}
            
            <div class="kpi-grid">
              <div class="kpi-card accent-blue" onclick="App.navigate()">
                <div class="kpi-icon blue">👥</div>
                <div class="kpi-label">Total Headcount</div>
                <div class="kpi-value">\${active.length}</div>
                <div class="kpi-change neutral">All active employees</div>
              </div>
              <div class="kpi-card accent-green" onclick="App.navigate()">
                <div class="kpi-icon green">🤝</div>
                <div class="kpi-label">New Hires (Apr–Aug '26)</div>
                <div class="kpi-value">\${totalJoining}</div>
                <div class="kpi-change positive">From joining records</div>
              </div>
              <div class="kpi-card accent-red" onclick="App.navigate()">
                <div class="kpi-icon red">🚪</div>
                <div class="kpi-label">Exits (Apr–Aug '26)</div>
                <div class="kpi-value">\${totalResignation}</div>
                <div class="kpi-change negative">\${Utils.formatPercent(attritionRate)} attrition</div>
              </div>
              <div class="kpi-card accent-orange" onclick="App.navigate()">
                <div class="kpi-icon orange">⏳</div>
                <div class="kpi-label">Pending Confirmations</div>
                <div class="kpi-value">\${pendingConf}</div>
                <div class="kpi-change neutral">On probation</div>
              </div>
              <div class="kpi-card accent-purple" onclick="App.navigate()">
                <div class="kpi-icon purple">✅</div>
                <div class="kpi-label">Confirmations</div>
                <div class="kpi-value">\${confirmationsCount}</div>
                <div class="kpi-change neutral">Confirmed this period</div>
              </div>
            </div>

            <div class="chart-grid">
              <div class="card"><div class="card-header"><div class="card-title">Hires vs Exits Trend</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-hires-exits"></canvas></div></div></div>
              <div class="card"><div class="card-header"><div class="card-title">Status Distribution</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-status"></canvas></div></div></div>
              <div class="card"><div class="card-header"><div class="card-title">Headcount by Division</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-division"></canvas></div></div></div>
              <div class="card"><div class="card-header"><div class="card-title">Top 10 HQs / Locations</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-hq"></canvas></div></div></div>
              <div class="card"><div class="card-header"><div class="card-title">Designation Distribution</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-designation"></canvas></div></div></div>
              <div class="card"><div class="card-header"><div class="card-title">Tenure Analysis</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-tenure"></canvas></div></div></div>
              <div class="card"><div class="card-header"><div class="card-title">Exit Analytics (by Division)</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-exit-div"></canvas></div></div></div>
              <div class="card"><div class="card-header"><div class="card-title">Confirmation Trends</div></div><div class="card-body"><div class="chart-container"><canvas id="chart-conf-trend"></canvas></div></div></div>
            </div>
            
            <div class="card" style="margin-top:20px;">
              <div class="card-header"><div class="card-title">💡 Management Insights</div></div>
              <div class="card-body" style="background:var(--bg-secondary);">
                <ul style="margin:0;padding-left:20px;color:var(--text-secondary);font-size:14px;line-height:1.6;">
                  <li><strong>Growth:</strong> Net headcount changed by \${totalJoining - totalResignation} employees during the period.</li>
                  <li><strong>Retention:</strong> The current annualized attrition rate tracks at \${Utils.formatPercent(attritionRate)}.</li>
                  <li><strong>Distribution:</strong> The largest concentration of workforce is in the \${Object.keys(divCounts).sort((a,b)=>divCounts[b]-divCounts[a])[0] || 'N/A'} division.</li>
                  <li><strong>Pipeline:</strong> There are \${pendingConf} employees currently on probation requiring performance reviews.</li>
                </ul>
              </div>
            </div>
          \`;

          App.renderOverviewCharts(divCounts, hqCounts, desCounts, statusCounts, tenureBrackets, joiningByMonth, exitsByMonth, exitsByDiv, exitsByHQ);
        },
        renderOverviewCharts(divCounts, hqCounts, desCounts, statusCounts, tenureBrackets, joiningByMonth, exitsByMonth, exitsByDiv, exitsByHQ) {
          const mLabels = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
          App.createChart('chart-hires-exits', {
            type: 'bar',
            data: {
              labels: mLabels,
              datasets: [
                { label: 'Hires', data: mLabels.map(m => joiningByMonth[m]||0), backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'Exits', data: mLabels.map(m => exitsByMonth[m]||0), backgroundColor: '#ef4444', borderRadius: 4 }
              ]
            }
          });
          App.createChart('chart-status', { type: 'doughnut', data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'] }] }, options: { cutout: '65%' } });
          App.createChart('chart-division', { type: 'bar', data: { labels: Object.keys(divCounts), datasets: [{ label: 'Headcount', data: Object.values(divCounts), backgroundColor: '#3b82f6', borderRadius: 4 }] }, options: { indexAxis: 'y' } });
          const topHQs = Object.entries(hqCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
          App.createChart('chart-hq', { type: 'bar', data: { labels: topHQs.map(x=>x[0]), datasets: [{ label: 'Headcount', data: topHQs.map(x=>x[1]), backgroundColor: '#6366f1', borderRadius: 4 }] } });
          const topDes = Object.entries(desCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
          App.createChart('chart-designation', { type: 'doughnut', data: { labels: topDes.map(x=>x[0]), datasets: [{ data: topDes.map(x=>x[1]), backgroundColor: ['#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef'] }] }, options: { cutout: '50%' } });
          App.createChart('chart-tenure', { type: 'pie', data: { labels: Object.keys(tenureBrackets), datasets: [{ data: Object.values(tenureBrackets), backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'] }] } });
          App.createChart('chart-exit-div', { type: 'bar', data: { labels: Object.keys(exitsByDiv), datasets: [{ label: 'Exits', data: Object.values(exitsByDiv), backgroundColor: '#ef4444', borderRadius: 4 }] } });
          const confTrend = {};
          State.confirmation.forEach(c => { const m = Utils.getMonthKey(c.ConfirmationDate) || Utils.getMonthKey(c.CreatedAt); if (m) confTrend[m] = (confTrend[m]||0) + 1; });
          App.createChart('chart-conf-trend', { type: 'line', data: { labels: Object.keys(confTrend).sort(), datasets: [{ label: 'Confirmations', data: Object.keys(confTrend).sort().map(k => confTrend[k]), borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', fill: true, tension: 0.3 }] } });
        }
      };

      document.addEventListener('DOMContentLoaded', () => { App.renderOverview(); });
    <\/script>
</body>
</html>`;

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Executive_Overview_Interactive_${new Date().toISOString().slice(0,10)}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      App.showToast('Report downloaded successfully!', 'success');
    } catch(err) {
      console.error(err);
      App.showToast('Error exporting report: ' + err.message, 'error');
    }
  }
};
