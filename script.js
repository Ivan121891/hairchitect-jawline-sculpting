(function () {
  "use strict";

  // ?test=1 -> QA mode: store leads but DO NOT fire Meta Schedule conversion.
  const TEST = new URLSearchParams(location.search).get('test') === '1';

  // ------- Configuration -------
  const SERVICE_NAME = "Jawline Sculpting Treatment";
  const SERVICE_DURATION_MIN = 60;

  // GHL credentials — Hairchitect Jawline Sculpting
  const GHL = {
    locationId: 'akCVeulrx9UG8kXb22pT',
    calendarId: 'WOD3OEYh0INcdR02lSc9',
    userId:     '2tQreqXcDpaAiSBqlK7T',
    apiKey:     'pit-b1b6cfdf-d979-44e7-a426-69f83361e436',
    apiBase:    'https://services.leadconnectorhq.com',
    version:    '2021-07-28',
  };

  const BUSINESS_TZ = "America/Los_Angeles";

  // Build specific time slots
  function buildAllSlots() {
    return [
      { label: '9:00 AM',  hour: 9,  minute: 0 },
      { label: '10:00 AM', hour: 10, minute: 0 },
      { label: '11:00 AM', hour: 11, minute: 0 },
      { label: '12:00 PM', hour: 12, minute: 0 },
      { label: '1:00 PM',  hour: 13, minute: 0 },
      { label: '2:00 PM',  hour: 14, minute: 0 },
      { label: '3:00 PM',  hour: 15, minute: 0 },
      { label: '4:00 PM',  hour: 16, minute: 0 },
      { label: '5:00 PM',  hour: 17, minute: 0 },
    ];
  }
  let ALL_SLOTS = buildAllSlots();

  const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const AVAILABLE_DOWS = [0,1,2,3,4,5]; // Sun — Fri

  const STEPS = ["date", "time", "details", "confirmed"];

  // ------- State -------
  const today = startOfDay(new Date());
  let selectedDate = null;
  let selectedTime = null;
  let ghlSlotLabels = null;

  // ------- Elements -------
  const $ = (id) => document.getElementById(id);
  const dateGrid = $("date-grid");
  const morningGrid = $("morning-grid");
  const afternoonGrid = $("afternoon-grid");

  const timeSummary    = $("time-summary");
  const detailsSummary = $("details-summary");
  const detailsForm    = $("details-form");
  const submitBtn      = $("submit-btn");
  const btnLabel       = submitBtn.querySelector(".btn-label");
  const spinner        = submitBtn.querySelector(".spinner");
  const errorText      = $("error-text");
  const resetBtn       = $("reset-btn");
  const gcalLink       = $("gcal-link");
  const confirmCard    = $("confirm-card");

  // ------- Helpers -------
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function offsetMinutesForTz(date, tz) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    const parts = dtf.formatToParts(date);
    const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
    const asUtc = Date.UTC(
      get("year"), get("month") - 1, get("day"),
      get("hour"), get("minute"), get("second"),
    );
    return Math.round((asUtc - date.getTime()) / 60000);
  }

  function dateFromWallTime(year, month, day, hour, minute, tz) {
    const approx = new Date(Date.UTC(year, month, day, hour, minute));
    const off = offsetMinutesForTz(approx, tz);
    return new Date(approx.getTime() - off * 60000);
  }

  function isoInTz(date, tz) {
    const off = offsetMinutesForTz(date, tz);
    const wall = new Date(date.getTime() + off * 60000);
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
           `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
           `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }
  function sameDay(a, b) {
    return a && b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function formatLongDate(d) {
    return d.toLocaleDateString('en-US', {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }

  // ------- GHL free-slots lookup -------
  async function fetchGhlSlots(date) {
    const startMs = date.getTime();
    const endMs = new Date(date);
    endMs.setHours(23, 59, 59, 999);
    const url = GHL.apiBase + '/calendars/' + GHL.calendarId
      + '/free-slots?startDate=' + startMs + '&endDate=' + endMs.getTime();
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + GHL.apiKey,
          'Version': '2021-04-15',
        },
      });
      const data = await res.json().catch(() => ({}));
      const dateStr = date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
      const dayData = data[dateStr];
      const set = new Set();
      if (dayData && dayData.slots && Array.isArray(dayData.slots)) {
        dayData.slots.forEach(function (ts) {
          var match = ts.match(/T(\d{2}):(\d{2})/);
          if (match) {
            var h = parseInt(match[1], 10);
            var m = parseInt(match[2], 10);
            var ampm = h < 12 ? 'AM' : 'PM';
            var display = h % 12 || 12;
            set.add(display + ':' + String(m).padStart(2, '0') + ' ' + ampm);
          }
        });
      }
      return set;
    } catch (_) {
      return null;
    }
  }

  // ------- Step navigation -------
  function showStep(step) {
    STEPS.forEach((s) => {
      const el = $("step-" + s);
      if (el) el.classList.toggle("hidden", s !== step);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------- Calendar render -------
  function renderMonth() {
    dateGrid.innerHTML = "";

    const cells = [];
    const cursor = new Date(today);
    while (cells.length < 6) {
      if (AVAILABLE_DOWS.includes(cursor.getDay())) {
        cells.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    cells.forEach((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "date-btn";
      if (sameDay(d, selectedDate)) btn.classList.add("selected");

      const dow = document.createElement("span");
      dow.className = "dow";
      dow.textContent = DOW_SHORT[d.getDay()];

      const day = document.createElement("span");
      day.className = "date-num";
      day.textContent = String(d.getDate());

      btn.appendChild(dow);
      btn.appendChild(day);

      btn.addEventListener("click", () => selectDate(d));
      dateGrid.appendChild(btn);
    });
  }

  function renderTimes() {
    // Check if selected day is a business day
    if (selectedDate && !AVAILABLE_DOWS.includes(selectedDate.getDay())) {
      morningGrid.innerHTML = '';
      afternoonGrid.innerHTML = '<p style="font-size:.9rem;color:var(--muted-foreground);text-align:center;grid-column:1/-1;padding:20px 0;">Closed on Saturdays — please select a different day</p>';
      return;
    }
    const now = new Date();
    const isToday = selectedDate && sameDay(selectedDate, today);

    function filterPast(slots) {
      if (!isToday) return slots;
      return slots.filter(s => {
        const slotTime = dateFromWallTime(
          selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
          s.hour, s.minute, BUSINESS_TZ
        );
        return slotTime.getTime() > now.getTime();
      });
    }

    // Filter by GHL available slots, or fallback to all if not loaded
    var availableSlots = ALL_SLOTS;
    if (ghlSlotLabels && ghlSlotLabels.size > 0) {
      availableSlots = ALL_SLOTS.filter(function (s) {
        return ghlSlotLabels.has(s.label);
      });
    }

    // Morning block (9 AM - 11 AM)
    const morning = availableSlots.filter(s => s.hour >= 9 && s.hour <= 11);
    const morningAvail = filterPast(morning);
    morningGrid.innerHTML = "";
    if (morningAvail.length > 0) {
      morningAvail.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "time-btn";
        if (selectedTime && selectedTime.label === s.label) b.classList.add("selected");
        b.textContent = s.label;
        b.addEventListener("click", () => selectTime(s));
        morningGrid.appendChild(b);
      });
    } else {
      morningGrid.innerHTML = '<p style="font-size:.8rem;color:var(--muted-foreground);text-align:center;grid-column:1/-1;padding:6px 0;">No available morning slots</p>';
    }

    // Afternoon block (12 PM - 5 PM)
    const afternoon = availableSlots.filter(s => s.hour >= 12 && s.hour <= 17);
    const afternoonAvail = filterPast(afternoon);
    afternoonGrid.innerHTML = "";
    if (afternoonAvail.length > 0) {
      afternoonAvail.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "time-btn";
        if (selectedTime && selectedTime.label === s.label) b.classList.add("selected");
        b.textContent = s.label;
        b.addEventListener("click", () => selectTime(s));
        afternoonGrid.appendChild(b);
      });
    } else {
      afternoonGrid.innerHTML = '<p style="font-size:.8rem;color:var(--muted-foreground);text-align:center;grid-column:1/-1;padding:6px 0;">No available afternoon slots</p>';
    }
  }

  const PIXEL_ID = '1178133073434960';
  const DEDICATED_PIXEL_ID = '3984133078554067';

  function track(event, params) {
    if (typeof window.fbq === "function") {
      try {
        window.fbq("trackSingle", PIXEL_ID, event, params || {});
      } catch (_) {}
    }
  }

  function trackDedicated(event, params, eventId) {
    if (typeof window.fbq === "function") {
      try {
        var opts = eventId ? { eventID: eventId } : {};
        window.fbq("trackSingle", DEDICATED_PIXEL_ID, event, params || {}, opts);
      } catch (_) {}
    }
  }

  // ViewContent on load — fires to dedicated pixel only
  var vcFired = false;
  (function fireViewContent() {
    if (vcFired) return;
    vcFired = true;
    trackDedicated("ViewContent", { content_name: SERVICE_NAME });
  })();

    // ------- Selection handlers -------
  function selectDate(d) {
    selectedDate = startOfDay(d);
    selectedTime = null;
    ghlSlotLabels = null;
    renderMonth();
    // Fetch GHL free slots for this date
    fetchGhlSlots(selectedDate).then(function (labels) {
      ghlSlotLabels = labels;
      renderTimes();
    }).catch(function () {
      ghlSlotLabels = null;
      renderTimes();
    });
    timeSummary.textContent = formatLongDate(selectedDate);
    showStep("time");
  }

  function selectTime(slot) {
    selectedTime = slot;
    renderTimes();
    detailsSummary.textContent =
      `${formatLongDate(selectedDate)} • ${selectedTime.label}`;
    showStep("details");
  }

  // ------- Form submit -------
  detailsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorText.classList.add("hidden");

    const name  = $("name").value.trim();
    const email = $("email").value.trim();
    const phone = $("phone").value.trim();

    if (!name || !email || !phone || !selectedDate || !selectedTime) {
      errorText.textContent = "Please fill in all fields.";
      errorText.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    btnLabel.textContent = "Booking";
    spinner.classList.remove("hidden");

    const start = dateFromWallTime(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      selectedTime.hour, selectedTime.minute, BUSINESS_TZ,
    );
    const end = new Date(start.getTime() + SERVICE_DURATION_MIN * 60000);
    const [firstName, ...rest] = name.split(/\s+/);
    const lastName = rest.join(" ");

    try {
      // Generate eventId for deduplication
      var eventId = "sch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      // Persist the lead + chosen slot BEFORE any GHL call (non-blocking).
      var leadId = null;
      try {
        const _leadRes = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            locationId: GHL.locationId,
            client: location.hostname.split('.')[0].split('-')[0],
            page: location.hostname,
            treatment: SERVICE_NAME,
            calendarId: GHL.calendarId,
            startTime: isoInTz(start, BUSINESS_TZ),
            endTime: isoInTz(end, BUSINESS_TZ),
            name, email, phone,
            fbclid: (new URLSearchParams(location.search)).get('fbclid') || undefined,
            fbp: (document.cookie.match(/_fbp=([^;]+)/) || [])[1],
            fbc: (document.cookie.match(/_fbc=([^;]+)/) || [])[1],
            test: TEST,
          }),
        });
        const _leadJson = await _leadRes.json().catch(function () { return {}; });
        leadId = _leadJson.leadId || null;
      } catch (_) { /* never block booking on lead persistence */ }

      // 1) Upsert contact in GHL
      const contactRes = await ghlFetch('/contacts/upsert', {
        locationId: GHL.locationId,
        firstName: (TEST ? "[TEST] " : "") + (firstName || name),
        lastName: lastName || '-',
        email,
        phone,
        source: 'Jawline Sculpting Treatment LP',
        tags: TEST ? ['Jawline Sculpting Treatment', 'TEST-DONOTCOUNT'] : ['Jawline Sculpting Treatment'],
      });
      const contactId = contactRes.contact?.id || contactRes.id;

      // 2) Book appointment
      // RoundRobin calendar — omit assignedUserId so GHL auto-assigns
      const _aptRes = await ghlFetch('/calendars/events/appointments', {
        assignedUserId: '2tQreqXcDpaAiSBqlK7T', // calendar team member (round-robin 422 fix)
        calendarId: GHL.calendarId,
        ignoreFreeSlotValidation: true,
        locationId: GHL.locationId,
        contactId,
        startTime:      isoInTz(start, BUSINESS_TZ),
        endTime:        isoInTz(end,   BUSINESS_TZ),
        title:          `${name} — Jawline Sculpting Treatment`,
        selectedTimezone: BUSINESS_TZ,
        autoConfirm: false,
      });

      // Pixel tracking
      const appointmentId = (_aptRes && (_aptRes.id || _aptRes.appointmentId || (_aptRes.appointment && _aptRes.appointment.id))) || null;
      // Record the TRUE outcome: ghl call throws on non-2xx (-> outer catch ->
      // 'fail'), so reaching here means 2xx; a missing id is a captured lead,
      // not a booking — gate status + Schedule pixels on a real booking.
      const bookingStatus = appointmentId ? 'success' : 'lead_only';
      // Persist booking success (non-blocking).
      try {
        fetch('/api/lead/result', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ leadId: leadId, locationId: GHL.locationId, status: bookingStatus, appointmentId: appointmentId, eventId: eventId, scheduleFired: (!TEST && bookingStatus === 'success'), test: TEST }),
        }).catch(function () {});
      } catch (_) {}

      track("Lead", { content_name: SERVICE_NAME });
      if (!TEST && bookingStatus === 'success') track("Schedule", { content_name: SERVICE_NAME });
      track("CompleteRegistration", { content_name: SERVICE_NAME });
      if (!TEST && bookingStatus === 'success') trackDedicated("Schedule", { content_name: SERVICE_NAME }, eventId);
      if (!TEST && bookingStatus === 'success') trackDedicated("CompleteRegistration", { content_name: SERVICE_NAME }, eventId);

      // CAPI call
      try {
        const getCookie = (n) =>
          document.cookie.match("(^|;)\\s*" + n + "\\s*=\\s*([^;]+)")?.pop() || "";
        if (!TEST) fetch("/api/capi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            eventId,
            email,
            phone,
            eventSourceUrl: location.href,
            fbp: getCookie("_fbp"),
            fbc: getCookie("_fbc"),
          }),
        }).catch(() => {});
      } catch (e) {}

      renderConfirmation({
        service: SERVICE_NAME,
        name, email, phone,
        time: selectedTime.label,
      });
      showStep("confirmed");
    } catch (err) {
      console.error("GHL booking error", err);
      try {
        fetch('/api/lead/result', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ leadId: leadId, locationId: GHL.locationId, status: 'fail', error: (err && err.message) ? err.message : String(err), test: TEST }),
        }).catch(function () {});
      } catch (_) {}
      const detail = (err && err.message) ? err.message : "Booking failed. Please try again or call us.";
      errorText.textContent = detail;
      errorText.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      btnLabel.textContent = "Schedule Appointment";
      spinner.classList.add("hidden");
    }
  });

  // ------- GHL API call -------
  async function ghlFetch(path, body) {
    const res = await fetch(GHL.apiBase + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GHL.apiKey,
        'Version': GHL.version,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
    return data;
  }

  // ------- Confirmation rendering -------
  function renderConfirmation(p) {
    confirmCard.innerHTML = `
      <div class="confirm-row"><span class="label">Service</span><span class="value">${escapeHtml(p.service)}</span></div>
      <div class="confirm-row"><span class="label">Date</span><span class="value">${escapeHtml(formatLongDate(selectedDate))}</span></div>
      <div class="confirm-row"><span class="label">Time</span><span class="value">${escapeHtml(p.time)}</span></div>
      <div class="confirm-row"><span class="label">Name</span><span class="value">${escapeHtml(p.name)}</span></div>
      <div class="confirm-row"><span class="label">Email</span><span class="value">${escapeHtml(p.email)}</span></div>
      <div class="confirm-row"><span class="label">Phone</span><span class="value">${escapeHtml(p.phone)}</span></div>
    `;
    gcalLink.href = buildGCalUrl(p);
  }

  function buildGCalUrl(p) {
    const start = dateFromWallTime(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      selectedTime.hour, selectedTime.minute, BUSINESS_TZ,
    );
    const end = new Date(start.getTime() + SERVICE_DURATION_MIN * 60000);
    const fmt = (d) =>
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) + "Z";
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: SERVICE_NAME,
      dates: `${fmt(start)}/${fmt(end)}`,
      details: `Booking for ${p.name} (${p.email}, ${p.phone}).`,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ------- Reset -------
  resetBtn.addEventListener("click", () => {
    selectedDate = null;
    selectedTime = null;
    detailsForm.reset();
    renderMonth();
    showStep("date");
  });

  // ------- Init -------
  renderMonth();
  renderTimes();
  showStep("date");
})();
