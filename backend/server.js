// --- 1. IMPORT LIBRARIES ---
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const Excel = require("exceljs");

// --- 2. INITIALIZE APP & SETTINGS ---
const app = express();
const PORT = 3000;
const DB_FILE = "attendanceTrackerDB.db";

// --- 3. MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- 4. CONNECT TO DATABASE ---
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    return console.error("Error connecting to database:", err.message);
  }
  console.log("Connected to the CareSync SQLite database.");
});

// --- 5. CREATE DATABASE TABLES ---
db.serialize(() => {
  // Create Nurses table
  db.run(`
        CREATE TABLE IF NOT EXISTS Nurses (
            nurse_id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            group_id INTEGER NOT NULL
        )
    `);

  // Create Planned Roster table
  db.run(`
        CREATE TABLE IF NOT EXISTS Roster_Planned (
            plan_id INTEGER PRIMARY KEY AUTOINCREMENT,
            nurse_id INTEGER,
            date TEXT NOT NULL,
            shift_code TEXT,
            ward TEXT,
            FOREIGN KEY (nurse_id) REFERENCES Nurses (nurse_id),
            UNIQUE(nurse_id, date)
        )
    `);

  // Create Actual Roster table
  db.run(`
        CREATE TABLE IF NOT EXISTS Roster_Actual (
            actual_id INTEGER PRIMARY KEY AUTOINCREMENT,
            nurse_id INTEGER,
            date TEXT NOT NULL,
            shift_code TEXT,
            ward TEXT,
            FOREIGN KEY (nurse_id) REFERENCES Nurses (nurse_id),
            UNIQUE(nurse_id, date) 
        )
    `);
  console.log("Database tables are ready.");
});

// Helper functions for async
function dbAllAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
function dbRunAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// --- 6. API ENDPOINTS ---

// --- (A) Nurse Management API ---
app.get("/api/nurses", async (req, res) => {
  try {
    const nurses = await dbAllAsync(
      "SELECT * FROM Nurses ORDER BY group_id, full_name"
    );
    res.json(nurses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/nurses", async (req, res) => {
  const { name, group } = req.body;
  if (!name || !group) {
    return res.status(400).json({ error: "Name and group are required" });
  }
  try {
    const sql = "INSERT INTO Nurses (full_name, group_id) VALUES (?, ?)";
    const result = await dbRunAsync(sql, [name, group]);
    res.status(201).json({ id: result.lastID, name, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/nurses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await dbRunAsync("DELETE FROM Nurses WHERE nurse_id = ?", [id]);
    await dbRunAsync("DELETE FROM Roster_Planned WHERE nurse_id = ?", [id]);
    await dbRunAsync("DELETE FROM Roster_Actual WHERE nurse_id = ?", [id]);
    res.status(200).json({ message: "Nurse deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- (B) Roster Data API ---

app.get("/api/roster-status", async (req, res) => {
  const { month } = req.query;
  if (!month) {
    return res.status(400).json({ error: "Month query parameter is required" });
  }
  try {
    const plannedSql =
      "SELECT DISTINCT date FROM Roster_Planned WHERE strftime('%Y-%m', date) = ?";
    const actualSql =
      "SELECT DISTINCT date FROM Roster_Actual WHERE strftime('%Y-%m', date) = ?";

    const plannedDays = await dbAllAsync(plannedSql, [month]);
    const actualDays = await dbAllAsync(actualSql, [month]);

    const status = {};
    plannedDays.forEach((row) => {
      if (row.date && !status[row.date]) status[row.date] = {};
      if (row.date) status[row.date].planned = true;
    });
    actualDays.forEach((row) => {
      if (row.date && !status[row.date]) status[row.date] = {};
      if (row.date) status[row.date].actual = true;
    });

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/roster", async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: "Date query parameter is required" });
  }
  const sql = `
        SELECT 
            n.nurse_id, n.full_name, n.group_id,
            p.shift_code as planned_shift,
            p.ward as planned_ward,
            a.shift_code as actual_shift,
            a.ward as actual_ward
        FROM 
            Nurses n
        LEFT JOIN 
            Roster_Planned p ON n.nurse_id = p.nurse_id AND p.date = ?
        LEFT JOIN 
            Roster_Actual a ON n.nurse_id = a.nurse_id AND a.date = ?
        ORDER BY
            n.group_id, n.full_name;
    `;
  try {
    const rows = await dbAllAsync(sql, [date, date]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/roster-planned", async (req, res) => {
  const { date, roster } = req.body;
  if (!date || !roster) {
    return res.status(400).json({ error: "Missing date or roster data" });
  }
  const sql = `
        INSERT INTO Roster_Planned (nurse_id, date, shift_code, ward)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(nurse_id, date) DO UPDATE SET
            shift_code = excluded.shift_code,
            ward = excluded.ward;
    `;
  try {
    await Promise.all(
      roster.map((entry) =>
        dbRunAsync(sql, [entry.nurseId, date, entry.shift, entry.ward])
      )
    );
    res.status(200).json({ message: "Planned roster updated" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to update planned roster", details: err.message });
  }
});

app.post("/api/roster-actual", async (req, res) => {
  const { date, roster } = req.body;
  if (!date || !roster) {
    return res.status(400).json({ error: "Missing date or roster data" });
  }
  const sql = `
        INSERT INTO Roster_Actual (nurse_id, date, shift_code, ward)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(nurse_id, date) DO UPDATE SET
            shift_code = excluded.shift_code,
            ward = excluded.ward;
    `;
  try {
    await Promise.all(
      roster.map((entry) =>
        dbRunAsync(sql, [entry.nurseId, date, entry.shift, entry.ward])
      )
    );
    res.status(200).json({ message: "Actual roster updated" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to update actual roster", details: err.message });
  }
});

// --- (C) Report Generation API ---

/**
 * @route   GET /api/report-actual (The only report)
 */
app.get("/api/report-actual", async (req, res) => {
  const { month } = req.query;
  if (!month) {
    return res.status(400).json({ error: "Month query parameter is required" });
  }
  try {
    const nurses = await dbAllAsync(
      "SELECT * FROM Nurses ORDER BY group_id, full_name"
    );
    const planned = await dbAllAsync(
      "SELECT * FROM Roster_Planned WHERE strftime('%Y-%m', date) = ?",
      [month]
    );
    const actual = await dbAllAsync(
      "SELECT * FROM Roster_Actual WHERE strftime('%Y-%m', date) = ?",
      [month]
    );

    const dataMap = {};
    nurses.forEach((n) => (dataMap[n.nurse_id] = { nurse: n, shifts: {} }));

    const [year, monthNum] = month.split("-").map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      nurses.forEach(
        (n) => (dataMap[n.nurse_id].shifts[day] = { planned: "", actual: "" })
      );
    }

    planned.forEach((p) => {
      if (p.date && dataMap[p.nurse_id]) {
        try {
          const day = parseInt(p.date.split("-")[2], 10);
          if (day && dataMap[p.nurse_id].shifts[day]) {
            dataMap[p.nurse_id].shifts[day].planned = p.shift_code;
          }
        } catch (e) {
          console.error(`Skipping bad planned date: ${p.date}`);
        }
      }
    });

    actual.forEach((a) => {
      if (a.date && dataMap[a.nurse_id]) {
        try {
          const day = parseInt(a.date.split("-")[2], 10);
          if (day && dataMap[a.nurse_id].shifts[day]) {
            dataMap[a.nurse_id].shifts[day].actual = a.shift_code;
          }
        } catch (e) {
          console.error(`Skipping bad actual date: ${a.date}`);
        }
      }
    });

    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet(`${month} Actual Report`);

    const columns = [{ header: "Staff Name", key: "name", width: 30 }];
    for (let i = 1; i <= daysInMonth; i++) {
      columns.push({ header: i.toString(), key: `day${i}`, width: 5 });
    }
    columns.push({ header: "Deviation %", key: "deviation", width: 15 });
    worksheet.columns = columns;

    let currentGroup = 0;
    for (const nurse of nurses) {
      if (nurse.group_id !== currentGroup && currentGroup !== 0) {
        worksheet.addRow({});
      }
      currentGroup = nurse.group_id;
      let totalDeviations = 0;
      let totalPlannedShifts = 0;
      const rowData = { name: nurse.full_name };

      for (let day = 1; day <= daysInMonth; day++) {
        const shift = dataMap[nurse.nurse_id].shifts[day];
        if (shift) {
          const displayCode = shift.actual || shift.planned || "";
          rowData[`day${day}`] = displayCode;

          // --- UPDATED DEVIATION LOGIC ---
          // Planned work is A, M, N, or G
          const plannedWork = ["A", "M", "N", "G"].includes(shift.planned);
          // Actual leave is ANY non-work shift
          const actualLeave = [
            "PL",
            "SL",
            "NH",
            "PH",
            "WO",
            "NO",
            "SO",
          ].includes(shift.actual);

          if (plannedWork) totalPlannedShifts++;
          if (plannedWork && actualLeave) {
            totalDeviations++;
          }
          // --- END OF UPDATED LOGIC ---
        } else {
          rowData[`day${day}`] = "";
        }
      }

      const deviationPercent =
        totalPlannedShifts > 0
          ? (totalDeviations / totalPlannedShifts) * 100
          : 0;
      rowData["deviation"] = `${deviationPercent.toFixed(1)}%`;
      const row = worksheet.addRow(rowData);

      row.eachCell((cell, colNumber) => {
        if (colNumber > 1 && colNumber <= daysInMonth + 1) {
          // Updated coloring to match new leave codes
          if (["WO", "NO", "SO", "PL", "SL", "NH", "PH"].includes(cell.value)) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFFFF00" },
            };
          }
        }
      });
      row.getCell("deviation").font = { bold: true };
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ActualRoster_${month}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Failed to generate ACTUAL report:", err);
    res.status(500).json({
      error: "Failed to generate actual report",
      details: err.message,
    });
  }
});

// --- 7. START THE SERVER ---
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
