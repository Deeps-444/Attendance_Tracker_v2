document.addEventListener("DOMContentLoaded", () => {
  // --- STATE ---
  // NEW: Updated shift codes with full names
  const SHIFT_CODES = [
    { code: "A", full: "A (Afternoon)" },
    { code: "M", full: "M (Morning)" },
    { code: "N", full: "N (Night)" },
    { code: "G", full: "G (General Shift)" },
    { code: "WO", full: "WO (Weekly Off)" },
    { code: "NO", full: "NO (Night Off)" },
    { code: "SO", full: "SO (Saturday Off)" },
    { code: "PL", full: "PL (Planned Leave)" },
    { code: "SL", full: "SL (Sick Leave)" },
    { code: "NH", full: "NH (National Holiday)" },
    { code: "PH", full: "PH (Festival Holiday)" },
  ];

  let currentDate = new Date(2025, 6, 1);
  let currentMode = "actual"; // 'planned' or 'actual'
  let calendarStatus = {}; // Caches the status dots

  // --- DOM ELEMENTS ---
  const calendarGrid = document.getElementById("calendar-grid");
  const currentMonthEl = document.getElementById("current-month");

  const modePlannedBtn = document.getElementById("mode-planned");
  const modeActualBtn = document.getElementById("mode-actual");

  const rosterModal = document.getElementById("roster-modal");
  const modalDateEl = document.getElementById("modal-date");
  const rosterListEl = document.getElementById("roster-list");
  const closeRosterModalBtn = document.getElementById("close-roster-modal");
  const saveRosterBtn = document.getElementById("save-roster-btn");

  const nurseModal = document.getElementById("nurse-modal");
  const manageNursesBtn = document.getElementById("manage-nurses-btn");
  const closeNurseModalBtn = document.getElementById("close-nurse-modal");
  const addNurseBtn = document.getElementById("add-nurse-btn");
  const newNurseNameEl = document.getElementById("new-nurse-name");
  const newNurseGroupEl = document.getElementById("new-nurse-group");
  const nurseManageListEl = document.getElementById("nurse-manage-list");

  // --- CALENDAR FUNCTIONS ---

  async function fetchCalendarStatus() {
    const monthQuery = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1
    ).padStart(2, "0")}`;
    try {
      const response = await fetch(
        `https://attendancetracker-backend-04g3.onrender.com/api/roster-status?month=${monthQuery}`
      );
      if (!response.ok) throw new Error("Failed to fetch status");
      calendarStatus = await response.json();
    } catch (err) {
      console.error(err);
      calendarStatus = {};
    }
  }

  async function renderCalendar() {
    await fetchCalendarStatus();
    calendarGrid.innerHTML = `
            <div class="day-header">Sun</div> <div class="day-header">Mon</div>
            <div class="day-header">Tue</div> <div class="day-header">Wed</div>
            <div class="day-header">Thu</div> <div class="day-header">Fri</div>
            <div class="day-header">Sat</div>
        `;

    currentMonthEl.textContent = currentDate.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const lastDateOfMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDayOfMonth; i++) {
      calendarGrid.insertAdjacentHTML(
        "beforeend",
        `<div class="day-cell"></div>`
      );
    }

    for (let day = 1; day <= lastDateOfMonth; day++) {
      const dateString = `${year}-${String(month + 1).padStart(
        2,
        "0"
      )}-${String(day).padStart(2, "0")}`;
      const status = calendarStatus[dateString] || {};

      const cell = document.createElement("div");
      cell.className = "day-cell current-month";
      cell.dataset.date = dateString;

      if (status.planned && status.actual) {
        cell.classList.add("both");
      } else if (status.planned) {
        cell.classList.add("planned");
      } else if (status.actual) {
        cell.classList.add("actual");
      }

      cell.innerHTML = `
                <div class="day-number">${day}</div>
                <div class="day-status-dots">
                    ${
                      status.planned
                        ? '<div class="status-dot planned" title="Planned roster logged"></div>'
                        : ""
                    }
                    ${
                      status.actual
                        ? '<div class="status-dot actual" title="Actual roster logged"></div>'
                        : ""
                    }
                </div>
            `;
      calendarGrid.appendChild(cell);
    }
  }

  // --- ROSTER MODAL FUNCTIONS ---

  function toggleWardInput(shiftSelect, wardInput) {
    // UPDATED: Added 'G' as a work shift
    const isWorkShift = ["A", "M", "N", "G"].includes(shiftSelect.value);
    wardInput.classList.toggle("hidden", !isWorkShift);
    if (!isWorkShift) wardInput.value = "";
  }

  async function openRosterModal(date) {
    modalDateEl.textContent = `Edit ${currentMode} Roster: ${date}`;
    rosterModal.dataset.editingDate = date;

    const response = await fetch(
      `https://attendancetracker-backend-04g3.onrender.com/api/roster?date=${date}`
    );
    if (!response.ok) {
      alert("Error fetching roster data. See console.");
      console.error(await response.json());
      return;
    }
    const rosterData = await response.json();

    rosterListEl.innerHTML = "";
    let currentGroup = 0;
    let groupEl;

    rosterData.forEach((nurse) => {
      if (nurse.group_id !== currentGroup) {
        currentGroup = nurse.group_id;
        groupEl = document.createElement("div");
        groupEl.className = "nurse-group";
        rosterListEl.appendChild(groupEl);
      }

      let currentShift = "";
      let currentWard = "";
      if (currentMode === "planned") {
        currentShift = nurse.planned_shift || "";
        currentWard = nurse.planned_ward || "";
      } else {
        currentShift = nurse.actual_shift || nurse.planned_shift || "";
        currentWard = nurse.actual_ward || nurse.planned_ward || "";
      }

      const row = document.createElement("div");
      row.className = "nurse-row";
      row.dataset.nurseId = nurse.nurse_id;

      // UPDATED: Creates dropdown from the new SHIFT_CODES array
      row.innerHTML = `
                <label>${nurse.full_name}</label>
                <select class="shift-select">
                    <option value="">-- Select --</option>
                    ${SHIFT_CODES.map(
                      (code) =>
                        `<option value="${code.code}">${code.full}</option>`
                    ).join("")}
                </select>
                <input type="text" class="ward-input" placeholder="Enter ward..." />
            `;

      const shiftSelect = row.querySelector(".shift-select");
      const wardInput = row.querySelector(".ward-input");

      shiftSelect.value = currentShift;
      wardInput.value = currentWard;

      shiftSelect.addEventListener("change", () =>
        toggleWardInput(shiftSelect, wardInput)
      );
      toggleWardInput(shiftSelect, wardInput);
      groupEl.appendChild(row);
    });

    rosterModal.style.display = "block";
  }

  async function handleSaveRoster() {
    const date = rosterModal.dataset.editingDate;
    const rosterPayload = [];
    const nurseRows = rosterListEl.querySelectorAll(".nurse-row");

    nurseRows.forEach((row) => {
      rosterPayload.push({
        nurseId: row.dataset.nurseId,
        shift: row.querySelector(".shift-select").value,
        ward: row.querySelector(".ward-input").value,
      });
    });

    const endpoint =
      currentMode === "planned" ? "roster-planned" : "roster-actual";

    try {
      const response = await fetch(
        `https://attendancetracker-backend-04g3.onrender.com/api/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: date, roster: rosterPayload }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.details || "Failed to save");
      }

      alert("Roster Saved!");
      rosterModal.style.display = "none";
      renderCalendar();
    } catch (err) {
      console.error("Failed to save roster", err);
      alert(`Error: Could not save roster. ${err.message}`);
    }
  }

  // --- NURSE MODAL FUNCTIONS ---

  async function loadNurses() {
    nurseManageListEl.innerHTML = "Loading...";
    try {
      const response = await fetch(
        "https://attendancetracker-backend-04g3.onrender.com/api/nurses"
      );
      const nurses = await response.json();

      nurseManageListEl.innerHTML = "";
      if (nurses.length === 0) {
        nurseManageListEl.innerHTML = "<p>No nurses found. Add one above.</p>";
        return;
      }

      nurses.forEach((nurse) => {
        const item = document.createElement("div");
        item.className = "nurse-list-item";
        item.innerHTML = `
                    <span>${nurse.full_name} (Group: ${nurse.group_id})</span>
                    <button class="delete-nurse-btn" data-id="${nurse.nurse_id}">&times;</button>
                `;
        nurseManageListEl.appendChild(item);
      });
    } catch (err) {
      console.error(err);
      nurseManageListEl.innerHTML = "<p>Error loading nurses.</p>";
    }
  }

  async function handleAddNurse() {
    const name = newNurseNameEl.value;
    const group = newNurseGroupEl.value;
    if (!name || !group) {
      alert("Please enter both name and group ID.");
      return;
    }

    try {
      const response = await fetch(
        "https://attendancetracker-backend-04g3.onrender.com/api/nurses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, group }),
        }
      );
      if (!response.ok) throw new Error("Failed to add nurse");

      newNurseNameEl.value = "";
      newNurseGroupEl.value = "";
      loadNurses();
    } catch (err) {
      console.error(err);
      alert("Error adding nurse.");
    }
  }

  async function handleDeleteNurse(e) {
    if (!e.target.classList.contains("delete-nurse-btn")) return;

    const id = e.target.dataset.id;
    if (
      !confirm(
        "Are you sure you want to delete this nurse? This will remove all their roster data."
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `https://attendancetracker-backend-04g3.onrender.com/api/nurses/${id}`,
        {
          method: "DELETE",
        }
      );
      if (!response.ok) throw new Error("Failed to delete nurse");
      loadNurses();
    } catch (err) {
      console.error(err);
      alert("Error deleting nurse.");
    }
  }

  // --- EVENT LISTENERS ---

  // Mode Toggle
  modePlannedBtn.addEventListener("click", () => {
    currentMode = "planned";
    modePlannedBtn.classList.add("active");
    modeActualBtn.classList.remove("active");
  });
  modeActualBtn.addEventListener("click", () => {
    currentMode = "actual";
    modeActualBtn.classList.add("active");
    modePlannedBtn.classList.remove("active");
  });

  // Calendar
  calendarGrid.addEventListener("click", (e) => {
    const dayCell = e.target.closest(".day-cell.current-month");
    if (dayCell) {
      openRosterModal(dayCell.dataset.date);
    }
  });

  // Roster Modal
  closeRosterModalBtn.addEventListener(
    "click",
    () => (rosterModal.style.display = "none")
  );
  saveRosterBtn.addEventListener("click", handleSaveRoster);

  // Nurse Modal
  manageNursesBtn.addEventListener("click", () => {
    nurseModal.style.display = "block";
    loadNurses();
  });
  closeNurseModalBtn.addEventListener(
    "click",
    () => (nurseModal.style.display = "none")
  );
  addNurseBtn.addEventListener("click", handleAddNurse);
  nurseManageListEl.addEventListener("click", handleDeleteNurse);

  // Month Navigation
  document.getElementById("prev-month").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById("next-month").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
  });

  // Download Button
  document
    .getElementById("download-actual-btn")
    .addEventListener("click", () => {
      const year = currentDate.getFullYear();
      const monthNum = String(currentDate.getMonth() + 1).padStart(2, "0");
      const monthQuery = `${year}-${monthNum}`;
      const reportUrl = `https://attendancetracker-backend-04g3.onrender.com/api/report-actual?month=${monthQuery}`;
      window.location.href = reportUrl;
    });

  // Close modals on overlay click
  window.addEventListener("click", (e) => {
    if (e.target === rosterModal) rosterModal.style.display = "none";
    if (e.target === nurseModal) nurseModal.style.display = "none";
  });

  // --- INITIALIZATION ---
  renderCalendar();
});
