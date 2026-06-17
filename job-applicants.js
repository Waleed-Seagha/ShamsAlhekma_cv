/**
 * صفحة المتقدمين للوظائف - مدرسة شمس الحكمة 2026
 * جلب البيانات من Google Sheets وبناء الجدول ديناميكياً
 */

(function () {
  'use strict';

  /* ===== إعدادات مصدر البيانات ===== */
  var SPREADSHEET_ID = '1jGIo7Hff6MjgbxfHS-1h3K1SFgmdzvev';
  var SHEET_NAME = 'المتقدمين_للوظائف_مدرسة_شمس_الحكمة_2026';
  var SHEETS_URL =
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID +
    '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(SHEET_NAME);

  /* قيم الفلترة للوظائف */
  var JOB_CLASS_TEACHER = 'معلم صف';
  var JOB_ENGLISH_TEACHER = 'معلم لغة إنكليزية';

  /* ===== عناصر DOM ===== */
  var loadingState = document.getElementById('loadingState');
  var errorState = document.getElementById('errorState');
  var errorMessage = document.getElementById('errorMessage');
  var retryBtn = document.getElementById('retryBtn');
  var dashboardContent = document.getElementById('dashboardContent');
  var searchInput = document.getElementById('searchInput');
  var clearSearchBtn = document.getElementById('clearSearchBtn');
  var filterBtns = document.querySelectorAll('.applicants-filter-btn');
  var statsCards = document.getElementById('statsCards');
  var tableHead = document.getElementById('tableHead');
  var tableBody = document.getElementById('tableBody');
  var resultsCount = document.getElementById('resultsCount');
  var emptyState = document.getElementById('emptyState');
  var sortBtns = document.querySelectorAll('.applicants-sort-btn');
  var exportExcelBtn = document.getElementById('exportExcelBtn');
  var printBtn = document.getElementById('printBtn');
  var mobileCardsView = document.getElementById('mobileCardsView');
  var scrollHint = document.getElementById('scrollHint');
  var tableWrap = document.getElementById('tableWrap');
  var printHeader = document.getElementById('printHeader');
  var printMeta = document.getElementById('printMeta');

  /* تسميات الفلترة والترتيب */
  var FILTER_LABELS = {
    all: 'الكل',
    'class-teacher': 'معلم صف',
    'english-teacher': 'معلم لغة إنكليزية',
    other: 'وظائف أخرى'
  };

  var SORT_LABELS = {
    default: 'الترتيب الأصلي',
    name: 'حسب الاسم (أبجدي)',
    age: 'حسب العمر'
  };

  /* ===== حالة التطبيق ===== */
  var columns = [];       /* تعريف الأعمدة من Google Sheets */
  var allRows = [];       /* جميع الصفوف بعد التحويل */
  var filteredRows = [];  /* الصفوف بعد الفلترة والبحث */
  var currentFilter = 'all';
  var currentSort = 'default';
  var searchQuery = '';

  /* مفاتيح الأعمدة المهمة (تُحدَّد ديناميكياً من التسميات) */
  var colKeys = {
    name: null,
    qualification: null,
    age: null,
    jobTitle: null,
    phone: null,
    job: null
  };

  /**
   * تحويل استجابة Google Visualization API إلى كائن JSON
   */
  function parseGvizResponse(text) {
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('استجابة غير صالحة من Google Sheets');
    return JSON.parse(text.substring(start, end + 1));
  }

  /**
   * استخراج تعريف الأعمدة من الاستجابة
   */
  function extractColumns(table) {
    return (table.cols || []).map(function (col, index) {
      return {
        id: col.id || String.fromCharCode(65 + index),
        label: (col.label || '').trim(),
        type: col.type || 'string',
        index: index
      };
    });
  }

  /**
   * تحويل صف واحد إلى كائن بمفاتيح ديناميكية
   */
  function rowToObject(row, cols) {
    var obj = {};
    var cells = row.c || [];
    cols.forEach(function (col, i) {
      var cell = cells[i];
      var value = '';
      if (cell) {
        value = cell.f != null && cell.f !== '' ? cell.f : (cell.v != null ? String(cell.v) : '');
      }
      obj[col.label] = value;
    });
    return obj;
  }

  /**
   * ربط مفاتيح الأعمدة المهمة بالتسميات القادمة من الجدول
   */
  function mapColumnKeys(cols) {
    var labels = cols.map(function (c) { return c.label; });

    function findLabel(candidates) {
      for (var i = 0; i < candidates.length; i++) {
        var match = labels.find(function (l) { return l === candidates[i]; });
        if (match) return match;
      }
      return null;
    }

    colKeys.name = findLabel(['الاسم']);
    colKeys.qualification = findLabel(['المؤهل العلمي']);
    colKeys.age = findLabel(['العمر']);
    colKeys.jobTitle = findLabel(['المسمى الوظيفي']);
    colKeys.phone = findLabel(['رقم الهاتف']);
    colKeys.job = findLabel(['الوظيفة']);
  }

  /**
   * تصنيف الوظيفة للفلترة
   */
  function getJobCategory(jobValue) {
    var job = (jobValue || '').trim().replace(/\s+/g, ' ');
    if (job === JOB_CLASS_TEACHER) return 'class-teacher';
    if (job === JOB_ENGLISH_TEACHER) return 'english-teacher';
    return 'other';
  }

  /**
   * تنسيق التاريخ بالعربية
   */
  function formatDateAr() {
    try {
      return new Date().toLocaleDateString('ar-SY', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return new Date().toLocaleString('ar');
    }
  }

  /**
   * تهريب HTML للتصدير الآمن
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * ضبط placeholder البحث حسب حجم الشاشة
   */
  function setupSearchPlaceholder() {
    if (!searchInput) return;
    var update = function () {
      var isMobile = window.matchMedia('(max-width: 767px)').matches;
      searchInput.placeholder = isMobile
        ? (searchInput.getAttribute('data-placeholder-mobile') || 'ابحث...')
        : (searchInput.getAttribute('data-placeholder-desktop') || searchInput.placeholder);
    };
    update();
    window.addEventListener('resize', update);
  }

  /**
   * تحديث وضع العرض (بطاقات على الموبايل / جدول على الكمبيوتر)
   */
  function updateViewMode() {
    var isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (tableWrap) tableWrap.classList.toggle('is-mobile-hidden', isMobile);
    if (scrollHint) scrollHint.classList.toggle('is-mobile-only', isMobile);
    if (mobileCardsView) mobileCardsView.classList.toggle('is-mobile-only', isMobile);
  }

  /**
   * تحليل العمر كرقم للترتيب
   */
  function parseAge(value) {
    if (!value || value === '—' || value === '-') return -1;
    var num = parseInt(String(value).replace(/[^\d]/g, ''), 10);
    return isNaN(num) ? -1 : num;
  }

  /**
   * جلب البيانات من Google Sheets
   */
  function fetchData() {
    showLoading();
    return fetch(SHEETS_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('فشل الاتصال بالخادم: ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var data = parseGvizResponse(text);
        if (!data.table || !data.table.cols) {
          throw new Error('صيغة البيانات غير متوقعة من Google Sheets');
        }
        columns = extractColumns(data.table);
        mapColumnKeys(columns);
        allRows = (data.table.rows || []).map(function (row) {
          return rowToObject(row, columns);
        }).filter(function (row) {
          /* تجاهل الصفوف الفارغة تماماً */
          return Object.values(row).some(function (v) { return String(v).trim() !== ''; });
        });
        showDashboard();
        applyFiltersAndRender();
      })
      .catch(function (err) {
        showError(err.message || 'تعذّر تحميل البيانات');
      });
  }

  function showLoading() {
    loadingState.hidden = false;
    errorState.hidden = true;
    dashboardContent.hidden = true;
  }

  function showError(msg) {
    loadingState.hidden = true;
    errorState.hidden = false;
    dashboardContent.hidden = true;
    errorMessage.textContent = msg;
  }

  function showDashboard() {
    loadingState.hidden = true;
    errorState.hidden = true;
    dashboardContent.hidden = false;
    buildTableHeader();
    buildStatsCards();
    setupSearchPlaceholder();
    updateViewMode();
  }

  /**
   * بناء رأس الجدول ديناميكياً + عمود الترقيم
   */
  function buildTableHeader() {
    var tr = document.createElement('tr');
    var thNum = document.createElement('th');
    thNum.scope = 'col';
    thNum.textContent = 'م';
    tr.appendChild(thNum);

    columns.forEach(function (col) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = col.label;
      tr.appendChild(th);
    });

    tableHead.innerHTML = '';
    tableHead.appendChild(tr);
  }

  /**
   * بناء بطاقات الإحصائيات
   */
  function buildStatsCards() {
    var total = allRows.length;
    var classCount = 0;
    var englishCount = 0;
    var otherCount = 0;

    allRows.forEach(function (row) {
      var cat = getJobCategory(colKeys.job ? row[colKeys.job] : '');
      if (cat === 'class-teacher') classCount++;
      else if (cat === 'english-teacher') englishCount++;
      else otherCount++;
    });

    var stats = [
      { icon: 'groups', label: 'إجمالي المتقدمين', value: total, variant: 'total' },
      { icon: 'school', label: 'عدد معلمي الصف', value: classCount, variant: 'class' },
      { icon: 'translate', label: 'عدد معلمي اللغة الإنكليزية', value: englishCount, variant: 'english' },
      { icon: 'work', label: 'عدد الوظائف الأخرى', value: otherCount, variant: 'other' }
    ];

    statsCards.innerHTML = '';
    stats.forEach(function (stat) {
      var card = document.createElement('article');
      card.className = 'applicants-stat-card applicants-stat-card--' + stat.variant;
      card.innerHTML =
        '<span class="material-symbols-outlined applicants-stat-card__icon" aria-hidden="true">' + stat.icon + '</span>' +
        '<div class="applicants-stat-card__body">' +
          '<span class="applicants-stat-card__value">' + stat.value + '</span>' +
          '<span class="applicants-stat-card__label">' + stat.label + '</span>' +
        '</div>';
      statsCards.appendChild(card);
    });
  }

  /**
   * تطبيق البحث والفلترة والترتيب
   */
  function applyFiltersAndRender() {
    var q = searchQuery.trim().toLowerCase();

    filteredRows = allRows.filter(function (row) {
      /* فلتر الوظيفة */
      if (currentFilter !== 'all') {
        var cat = getJobCategory(colKeys.job ? row[colKeys.job] : '');
        if (cat !== currentFilter) return false;
      }

      /* البحث النصي */
      if (q) {
        var searchFields = [
          colKeys.name,
          colKeys.qualification,
          colKeys.phone,
          colKeys.job
        ].filter(Boolean);

        var matches = searchFields.some(function (key) {
          return String(row[key] || '').toLowerCase().indexOf(q) !== -1;
        });
        if (!matches) return false;
      }

      return true;
    });

    /* الترتيب */
    if (currentSort === 'name' && colKeys.name) {
      filteredRows.sort(function (a, b) {
        return String(a[colKeys.name]).localeCompare(String(b[colKeys.name]), 'ar');
      });
    } else if (currentSort === 'age' && colKeys.age) {
      filteredRows.sort(function (a, b) {
        return parseAge(b[colKeys.age]) - parseAge(a[colKeys.age]);
      });
    }

    renderTable();
    renderMobileCards();
    updateResultsCount();
    updateViewMode();
  }

  /**
   * رسم صفوف الجدول
   */
  function renderTable() {
    tableBody.innerHTML = '';

    if (filteredRows.length === 0) {
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;

    filteredRows.forEach(function (row, index) {
      var tr = document.createElement('tr');

      /* عمود الترقيم التلقائي */
      var tdNum = document.createElement('td');
      tdNum.className = 'applicants-table__num';
      tdNum.textContent = index + 1;
      tr.appendChild(tdNum);

      columns.forEach(function (col) {
        var td = document.createElement('td');
        var val = row[col.label] || '—';
      
        /* تنسيق رقم الهاتف */
        if (col.label === colKeys.phone) {
          td.dir = 'ltr';
          td.className = 'applicants-table__phone';
        }
      
        /* عمود السيرة الذاتية */
        if (
          col.label.toLowerCase() === 'cv' &&
          val &&
          val !== '—'
        ) {
          var link = document.createElement('a');
      
          link.href = val;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
      
          link.className = 'cv-btn';
          link.textContent = 'عرض CV';
      
          td.appendChild(link);
        } else {
          td.textContent = val;
        }
      
        tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });
  }

  /**
   * رسم بطاقات الموبايل
   */
  function renderMobileCards() {
    if (!mobileCardsView) return;
    mobileCardsView.innerHTML = '';

    if (filteredRows.length === 0) return;

    filteredRows.forEach(function (row, index) {
      var card = document.createElement('article');
      card.className = 'applicant-card';

      var jobVal = colKeys.job ? (row[colKeys.job] || '—') : '—';
      var jobCat = getJobCategory(jobVal);
      card.classList.add('applicant-card--' + jobCat);

      var name = colKeys.name ? (row[colKeys.name] || '—') : '—';
      var phone = colKeys.phone ? (row[colKeys.phone] || '') : '';
      var phoneDigits = phone.replace(/[^\d+]/g, '');

      var headerHtml =
        '<div class="applicant-card__header">' +
          '<span class="applicant-card__num">' + (index + 1) + '</span>' +
          '<h3 class="applicant-card__name">' + escapeHtml(name) + '</h3>' +
          '<span class="applicant-card__badge">' + escapeHtml(jobVal) + '</span>' +
        '</div>';

      var bodyHtml = '<dl class="applicant-card__fields">';
      columns.forEach(function (col) {
        if (col.label === colKeys.name || col.label === colKeys.job) return;
      
        var val = row[col.label] || '—';
      
        if (col.label.toLowerCase() === 'cv' && val !== '—') {
      
          bodyHtml +=
            '<div class="applicant-card__field">' +
              '<dt>CV</dt>' +
              '<dd>' +
                '<a href="' + val + '" target="_blank" rel="noopener noreferrer" class="cv-btn">' +
                  'عرض CV' +
                '</a>' +
              '</dd>' +
            '</div>';
      
        } else {
      
          bodyHtml +=
            '<div class="applicant-card__field">' +
              '<dt>' + escapeHtml(col.label) + '</dt>' +
              '<dd>' + escapeHtml(val) + '</dd>' +
            '</div>';
      
        }
      });
      bodyHtml += '</dl>';

      var actionsHtml = '';
      if (phoneDigits) {
        actionsHtml =
          '<div class="applicant-card__actions">' +
            '<a href="tel:' + phoneDigits + '" class="applicant-card__call" dir="ltr">' +
              '<span class="material-symbols-outlined" aria-hidden="true">call</span>' +
              escapeHtml(phone) +
            '</a>' +
          '</div>';
      }

      card.innerHTML = headerHtml + bodyHtml + actionsHtml;
      mobileCardsView.appendChild(card);
    });
  }

  /**
   * بناء معلومات التصدير/الطباعة
   */
  function getExportMeta() {
    var parts = [
      'تاريخ التصدير: ' + formatDateAr(),
      'الفلتر: ' + (FILTER_LABELS[currentFilter] || currentFilter),
      'الترتيب: ' + (SORT_LABELS[currentSort] || currentSort),
      'عدد النتائج: ' + filteredRows.length + ' من ' + allRows.length
    ];
    if (searchQuery.trim()) {
      parts.push('البحث: ' + searchQuery.trim());
    }
    return parts;
  }

  /**
   * تحديث رأس الطباعة
   */
  function updatePrintHeader() {
    if (!printMeta) return;
    printMeta.innerHTML = getExportMeta()
      .map(function (line) { return '<span>' + escapeHtml(line) + '</span>'; })
      .join('');
  }

  /**
   * تحديث عداد النتائج
   */
  function updateResultsCount() {
    var total = allRows.length;
    var shown = filteredRows.length;
    if (shown === total) {
      resultsCount.textContent = 'عرض ' + shown + ' متقدم';
    } else {
      resultsCount.textContent = 'عرض ' + shown + ' من أصل ' + total + ' متقدم';
    }
  }

  /**
   * تصدير احترافي إلى Excel (HTML Spreadsheet مع تنسيق كامل)
   */
  function exportToExcel() {
    if (filteredRows.length === 0) {
      alert('لا توجد بيانات للتصدير.');
      return;
    }

    var colCount = columns.length + 1;
    var metaRows = getExportMeta();
    var headers = ['م'].concat(columns.map(function (c) { return c.label; }));

    var html = [
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
      ' xmlns="http://www.w3.org/TR/REC-html40" dir="rtl">',
      '<head>',
      '<meta charset="UTF-8"/>',
      '<meta name="ProgId" content="Excel.Sheet"/>',
      '<meta name="Generator" content="Shams Al-Hekma School"/>',
      '<style>',
      'body { font-family: Cairo, Tahoma, Arial, sans-serif; direction: rtl; }',
      'table { border-collapse: collapse; width: 100%; }',
      '.title { font-size: 18pt; font-weight: bold; color: #0056B3; text-align: center; padding: 12px; }',
      '.subtitle { font-size: 11pt; color: #475569; text-align: center; padding: 4px 8px; }',
      '.meta { font-size: 10pt; color: #334155; background: #EAF6FF; padding: 8px 12px; border: 1px solid #B8D4F0; }',
      '.header th { background: #0056B3; color: #FFFFFF; font-weight: bold; font-size: 11pt;',
      ' border: 1px solid #003D82; padding: 10px 12px; text-align: center; }',
      '.data td { border: 1px solid #CBD5E1; padding: 8px 10px; font-size: 10pt; text-align: right; vertical-align: middle; }',
      '.data .num { background: #DBEAFE; color: #0056B3; font-weight: bold; text-align: center; width: 40px; }',
      '.even td { background: #F8FAFC; }',
      '.odd td { background: #FFFFFF; }',
      '.phone { mso-number-format:"\\@"; direction: ltr; text-align: left; }',
      '.footer-note { font-size: 9pt; color: #64748B; text-align: center; padding: 10px; }',
      '</style>',
      '</head>',
      '<body>',
      '<table>',
      '<tr><td colspan="' + colCount + '" class="title">مدرسة شمس الحكمة — طلبات التوظيف 2026</td></tr>',
      '<tr><td colspan="' + colCount + '" class="subtitle">إدارة طلبات التوظيف — تقرير المتقدمين</td></tr>'
    ];

    metaRows.forEach(function (line) {
      html.push('<tr><td colspan="' + colCount + '" class="meta">' + escapeHtml(line) + '</td></tr>');
    });

    html.push('<tr><td colspan="' + colCount + '" style="height:8px;border:none;"></td></tr>');
    html.push('<tr class="header">');
    headers.forEach(function (h) {
      html.push('<th>' + escapeHtml(h) + '</th>');
    });
    html.push('</tr>');

    filteredRows.forEach(function (row, index) {
      var rowClass = index % 2 === 0 ? 'data odd' : 'data even';
      html.push('<tr class="' + rowClass + '">');
      html.push('<td class="num">' + (index + 1) + '</td>');
      columns.forEach(function (col) {
        var val = row[col.label] || '—';
        var cellClass = col.label === colKeys.phone ? ' phone' : '';
        html.push('<td class="' + cellClass.trim() + '">' + escapeHtml(val) + '</td>');
      });
      html.push('</tr>');
    });

    html.push(
      '<tr><td colspan="' + colCount + '" class="footer-note">',
      '© مدرسة شمس الحكمة — تم التصدير آلياً من نظام إدارة طلبات التوظيف',
      '</td></tr>',
      '</table></body></html>'
    );

    var blob = new Blob(['\uFEFF' + html.join('')], {
      type: 'application/vnd.ms-excel;charset=utf-8;'
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = 'متقدمين_شمس_الحكمة_2026_' + dateStamp + '.xls';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * طباعة الجدول مع رأس احترافي
   */
  function printTable() {
    if (filteredRows.length === 0) {
      alert('لا توجد بيانات للطباعة.');
      return;
    }
    updatePrintHeader();
    document.body.classList.add('is-printing');
    window.print();
  }

  /* ===== ربط الأحداث ===== */

  if (retryBtn) {
    retryBtn.addEventListener('click', fetchData);
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      searchQuery = searchInput.value;
      clearSearchBtn.hidden = !searchQuery;
      applyFiltersAndRender();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', function () {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.hidden = true;
      searchInput.focus();
      applyFiltersAndRender();
    });
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      currentFilter = btn.getAttribute('data-filter');
      applyFiltersAndRender();
    });
  });

  sortBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      sortBtns.forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      currentSort = btn.getAttribute('data-sort');
      applyFiltersAndRender();
    });
  });

  if (exportExcelBtn) {
    exportExcelBtn.addEventListener('click', exportToExcel);
  }

  if (printBtn) {
    printBtn.addEventListener('click', printTable);
  }

  window.addEventListener('resize', updateViewMode);

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('is-printing');
  });

  /* بدء التحميل */
  fetchData();
})();
