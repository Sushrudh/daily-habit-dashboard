import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Tooltip
} from 'recharts';

// --- Firebase Global Setup ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'habit-tracker-pro';

let app, auth, db;
if (firebaseConfig) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (err) {
    console.warn("Firebase initialization skipped:", err);
  }
}

// --- Theme Design Tokens (Strict Match to Taupe/Beige/Grey Spreadsheet Theme) ---
const THEME = {
  headerBg: '#7A766B',
  headerText: '#FFFFFF',
  subHeaderBg: '#A6A298',
  subHeaderDark: '#8C887E',
  bgBeige: '#EBE9E1',
  panelBeige: '#DCDAD1',
  cellBg: '#F5F4EF',
  border: '#9E9A8F',
  barGrey: '#7A766B',
  pieDark: '#6E6A5F',
  pieLight: '#C4C1B8',
  rowEven: '#DCDAD1',
  rowOdd: '#E4E2DA',
  lineMood: '#6E6A5F',
  lineMotivation: '#A8A49A',
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// Default Habits with Stable Identifiers
const INITIAL_HABITS = [
  { id: 'habit_1', name: 'Wake up at 06:00', emoji: '⏰', enabled: true },
  { id: 'habit_2', name: 'Meditation', emoji: '🧘', enabled: true },
  { id: 'habit_3', name: 'GYM', emoji: '💪', enabled: true },
  { id: 'habit_4', name: 'Cold Shower', emoji: '🚿', enabled: true },
  { id: 'habit_5', name: 'Work', emoji: '🎯', enabled: true },
  { id: 'habit_6', name: 'Read 10 pages', emoji: '📖', enabled: true },
  { id: 'habit_7', name: 'Learn a skill', emoji: '📈', enabled: true },
  { id: 'habit_8', name: 'No sugar', emoji: '🥩', enabled: true },
  { id: 'habit_9', name: 'No alcohol', emoji: '🍾', enabled: true },
  { id: 'habit_10', name: '1H social media', emoji: '🪐', enabled: true },
  { id: 'habit_11', name: 'Planning', emoji: '📋', enabled: true },
  { id: 'habit_12', name: 'Sleep before 11:00', emoji: '🛌', enabled: true },
];

const INITIAL_TOP_10 = [
  "Read 10 pages 📖", "Work 🎯", "No alcohol 🍾", "No sugar 🥩",
  "Planning 📋", "Sleep before 11:00 🛌", "GYM 💪", "Cold Shower 🚿",
  "Wake up at 06:00 ⏰", "Meditation 🧘"
];

// Leap year calculation helper
const isLeapYear = (year) => {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
};

const getDaysInMonth = (year, monthIdx) => {
  return new Date(year, monthIdx + 1, 0).getDate();
};

const getDayAbbr = (year, monthIdx, dayNum, startDayPref = 'auto') => {
  if (startDayPref === 'auto') {
    const date = new Date(year, monthIdx, dayNum);
    const abbrs = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    return abbrs[date.getDay()];
  }
  // Fixed offset mode if requested
  const abbrs = ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'];
  return abbrs[(dayNum - 1) % 7];
};

export default function App() {
  const [user, setUser] = useState(null);

  // --- Core Application State ---
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState("January");
  const [habits, setHabits] = useState(INITIAL_HABITS);
  const [calendarStartDay, setCalendarStartDay] = useState('auto'); // 'auto' | 'Sa' | 'Su' | 'Mo'
  const [top10Mode, setTop10Mode] = useState('auto'); // 'auto' | 'manual'
  const [customTop10, setCustomTop10] = useState(INITIAL_TOP_10);
  
  // Logs keyed by `YYYY-MM-DD`: logs["2026-01-15"]["habit_1"] = true
  const [logs, setLogs] = useState({});
  // Mental logs: mentalLogs["2026-01-15"] = { mood: '9', motivation: '10' }
  const [mentalLogs, setMentalLogs] = useState({});

  // Toast Banner Notification
  const [toastMessage, setToastMessage] = useState('');

  // --- Centralized Customization Modal State ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('habits'); // 'general' | 'habits' | 'calendar' | 'year' | 'top10'
  
  // Draft modal states (discarded on cancel, saved on confirm)
  const [draftYear, setDraftYear] = useState(year);
  const [draftMonth, setDraftMonth] = useState(month);
  const [draftHabits, setDraftHabits] = useState([...habits]);
  const [draftCalendarStartDay, setDraftCalendarStartDay] = useState(calendarStartDay);
  const [draftTop10Mode, setDraftTop10Mode] = useState(top10Mode);
  const [draftCustomTop10, setDraftCustomTop10] = useState([...customTop10]);
  const [newHabitName, setNewHabitName] = useState('');
  const [newHabitEmoji, setNewHabitEmoji] = useState('✨');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const monthIdx = useMemo(() => {
    const idx = MONTH_NAMES.indexOf(month);
    return idx >= 0 ? idx : 0;
  }, [month]);

  const numDays = useMemo(() => {
    return getDaysInMonth(year, monthIdx);
  }, [year, monthIdx]);

  const activeHabits = useMemo(() => {
    return habits.filter(h => h.enabled !== false);
  }, [habits]);

  const dayNames = useMemo(() => {
    return Array.from({ length: numDays }, (_, i) => getDayAbbr(year, monthIdx, i + 1, calendarStartDay));
  }, [year, monthIdx, numDays, calendarStartDay]);

  const dateKey = useCallback((dayNum) => {
    const mStr = String(monthIdx + 1).padStart(2, '0');
    const dStr = String(dayNum).padStart(2, '0');
    return `${year}-${mStr}-${dStr}`;
  }, [year, monthIdx]);

  // --- Toast Trigger ---
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // --- Initial Data Load (LocalStorage + Firebase Sync) ---
  useEffect(() => {
    const localData = localStorage.getItem('habit_tracker_master_data');
    if (localData) {
      try {
        const parsed = JSON.parse(localData);
        if (parsed.habits) setHabits(parsed.habits);
        if (parsed.year) setYear(parsed.year);
        if (parsed.month) setMonth(parsed.month);
        if (parsed.calendarStartDay) setCalendarStartDay(parsed.calendarStartDay);
        if (parsed.top10Mode) setTop10Mode(parsed.top10Mode);
        if (parsed.customTop10) setCustomTop10(parsed.customTop10);
        if (parsed.logs) setLogs(parsed.logs);
        if (parsed.mentalLogs) setMentalLogs(parsed.mentalLogs);
      } catch (e) {
        console.error("Error reading localStorage data", e);
      }
    }
  }, []);

  // Sync state to LocalStorage
  const saveDataLocally = useCallback((updatedState) => {
    const dataToSave = {
      habits, year, month, calendarStartDay, top10Mode, customTop10, logs, mentalLogs,
      ...updatedState
    };
    localStorage.setItem('habit_tracker_master_data', JSON.stringify(dataToSave));
  }, [habits, year, month, calendarStartDay, top10Mode, customTop10, logs, mentalLogs]);

  // --- Firebase Auth & Firestore Listener ---
  useEffect(() => {
    if (!auth || !db) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Firebase Auth error:", err);
      }
    };
    initAuth();
    const unsubAuth = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'habitTracker', 'mainDoc');
    const unsub = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.habits) setHabits(JSON.parse(data.habits));
        if (data.logs) setLogs(JSON.parse(data.logs));
        if (data.mentalLogs) setMentalLogs(JSON.parse(data.mentalLogs));
        if (data.year) setYear(data.year);
        if (data.month) setMonth(data.month);
        if (data.calendarStartDay) setCalendarStartDay(data.calendarStartDay);
        if (data.top10Mode) setTop10Mode(data.top10Mode);
        if (data.customTop10) setCustomTop10(JSON.parse(data.customTop10));
      }
    }, (err) => console.error("Firestore sync error:", err));
    return () => unsub();
  }, [user]);

  const saveToFirebase = useCallback(async (updatePayload) => {
    saveDataLocally(updatePayload);
    if (!user || !db) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'habitTracker', 'mainDoc');
      const payload = { ...updatePayload };
      if (payload.habits) payload.habits = JSON.stringify(payload.habits);
      if (payload.logs) payload.logs = JSON.stringify(payload.logs);
      if (payload.mentalLogs) payload.mentalLogs = JSON.stringify(payload.mentalLogs);
      if (payload.customTop10) payload.customTop10 = JSON.stringify(payload.customTop10);
      await setDoc(docRef, payload, { merge: true });
    } catch (err) {
      console.error("Firestore save error:", err);
    }
  }, [user, saveDataLocally]);

  // --- Interaction Handlers ---
  const handleToggleCheck = (habitId, dayNum) => {
    const dk = dateKey(dayNum);
    const dayLog = logs[dk] || {};
    const isChecked = !!dayLog[habitId];

    const updatedLogs = {
      ...logs,
      [dk]: {
        ...dayLog,
        [habitId]: !isChecked
      }
    };

    setLogs(updatedLogs);
    saveToFirebase({ logs: updatedLogs });
  };

  const handleMentalInput = (type, dayNum, val) => {
    let cleanVal = val.trim();
    if (cleanVal !== '') {
      const num = parseInt(cleanVal, 10);
      if (isNaN(num)) cleanVal = '';
      else if (num < 1) cleanVal = '1';
      else if (num > 10) cleanVal = '10';
      else cleanVal = String(num);
    }

    const dk = dateKey(dayNum);
    const dayObj = mentalLogs[dk] || { mood: '', motivation: '' };
    const updatedMental = {
      ...mentalLogs,
      [dk]: {
        ...dayObj,
        [type]: cleanVal
      }
    };

    setMentalLogs(updatedMental);
    saveToFirebase({ mentalLogs: updatedMental });
  };

  // --- Settings Modal Handlers ---
  const openModal = () => {
    setDraftYear(year);
    setDraftMonth(month);
    setDraftHabits(JSON.parse(JSON.stringify(habits)));
    setDraftCalendarStartDay(calendarStartDay);
    setDraftTop10Mode(top10Mode);
    setDraftCustomTop10([...customTop10]);
    setNewHabitName('');
    setNewHabitEmoji('✨');
    setDeleteConfirmId(null);
    setIsModalOpen(true);
  };

  const saveModalSettings = () => {
    setYear(draftYear);
    setMonth(draftMonth);
    setHabits(draftHabits);
    setCalendarStartDay(draftCalendarStartDay);
    setTop10Mode(draftTop10Mode);
    setCustomTop10(draftCustomTop10);
    setIsModalOpen(false);

    saveToFirebase({
      year: draftYear,
      month: draftMonth,
      habits: draftHabits,
      calendarStartDay: draftCalendarStartDay,
      top10Mode: draftTop10Mode,
      customTop10: draftCustomTop10
    });

    showToast("Settings & Customization applied successfully!");
  };

  // Habit draft actions
  const addDraftHabit = () => {
    if (!newHabitName.trim()) return;
    const newHabit = {
      id: `habit_${Date.now()}`,
      name: newHabitName.trim(),
      emoji: newHabitEmoji || '✨',
      enabled: true
    };
    setDraftHabits([...draftHabits, newHabit]);
    setNewHabitName('');
  };

  const removeDraftHabit = (id) => {
    setDraftHabits(draftHabits.filter(h => h.id !== id));
    setDeleteConfirmId(null);
  };

  const moveDraftHabit = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= draftHabits.length) return;
    const arr = [...draftHabits];
    const temp = arr[idx];
    arr[idx] = arr[targetIdx];
    arr[targetIdx] = temp;
    setDraftHabits(arr);
  };

  // --- Analytics & Mathematical Calculations ---
  const dailyProgressData = useMemo(() => {
    const totalActive = activeHabits.length;
    return Array.from({ length: numDays }, (_, i) => {
      const dayNum = i + 1;
      const dk = dateKey(dayNum);
      const dayLog = logs[dk] || {};
      let completedCount = 0;
      activeHabits.forEach(h => {
        if (dayLog[h.id]) completedCount++;
      });
      const pct = totalActive > 0 ? Math.round((completedCount / totalActive) * 100) : 0;
      return { day: dayNames[i], val: pct, dayNum };
    });
  }, [numDays, activeHabits, logs, dateKey, dayNames]);

  const weeklyProgressData = useMemo(() => {
    const totalActive = activeHabits.length;
    const weeks = [
      { name: 'week 1', start: 1, end: 7 },
      { name: 'week 2', start: 8, end: 14 },
      { name: 'week 3', start: 15, end: 21 },
      { name: 'week 4', start: 22, end: 28 },
      { name: 'week 5', start: 29, end: numDays }
    ];

    return weeks.map(w => {
      if (w.start > numDays) return { name: w.name, val: 0 };
      const actualEnd = Math.min(w.end, numDays);
      const daysCount = actualEnd - w.start + 1;
      let totalChecked = 0;

      for (let d = w.start; d <= actualEnd; d++) {
        const dk = dateKey(d);
        const dayLog = logs[dk] || {};
        activeHabits.forEach(h => {
          if (dayLog[h.id]) totalChecked++;
        });
      }

      const possible = totalActive * daysCount;
      const pct = possible > 0 ? Math.round((totalChecked / possible) * 100) : 0;
      return { name: w.name, val: pct };
    });
  }, [activeHabits, numDays, logs, dateKey]);

  const overallStats = useMemo(() => {
    const totalActive = activeHabits.length;
    const goal = totalActive * numDays;
    let completed = 0;

    for (let d = 1; d <= numDays; d++) {
      const dk = dateKey(d);
      const dayLog = logs[dk] || {};
      activeHabits.forEach(h => {
        if (dayLog[h.id]) completed++;
      });
    }

    const left = Math.max(0, goal - completed);
    const pct = goal > 0 ? (completed / goal) * 100 : 0;
    return { goal, completed, left, pct };
  }, [activeHabits, numDays, logs, dateKey]);

  const habitAnalysis = useMemo(() => {
    return activeHabits.map(h => {
      let actual = 0;
      for (let d = 1; d <= numDays; d++) {
        const dk = dateKey(d);
        if (logs[dk] && logs[dk][h.id]) actual++;
      }
      const goal = numDays;
      const left = Math.max(0, goal - actual);
      const pct = Math.round((actual / goal) * 100);
      return { ...h, goal, actual, left, pct };
    });
  }, [activeHabits, numDays, logs, dateKey]);

  const autoTop10Habits = useMemo(() => {
    const ranked = habitAnalysis.map(h => ({
      name: `${h.name} ${h.emoji}`,
      actual: h.actual,
      pct: h.pct
    })).sort((a, b) => b.actual - a.actual || a.name.localeCompare(b.name));

    return ranked.slice(0, 10);
  }, [habitAnalysis]);

  const displayTop10 = useMemo(() => {
    if (top10Mode === 'auto') {
      return autoTop10Habits.map(h => h.name);
    }
    return customTop10;
  }, [top10Mode, autoTop10Habits, customTop10]);

  const mentalChartData = useMemo(() => {
    return Array.from({ length: numDays }, (_, i) => {
      const dayNum = i + 1;
      const dk = dateKey(dayNum);
      const entry = mentalLogs[dk] || {};
      return {
        day: dayNum,
        mood: entry.mood !== '' && entry.mood !== undefined ? Number(entry.mood) : null,
        motivation: entry.motivation !== '' && entry.motivation !== undefined ? Number(entry.motivation) : null
      };
    });
  }, [numDays, dateKey, mentalLogs]);

  return (
    <div className="min-h-screen bg-[#EBE9E1] text-[#222] font-sans p-2 sm:p-4 text-[11px] sm:text-xs selection:bg-[#7A766B] selection:text-white">
      
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-4 right-4 bg-[#7A766B] text-white px-4 py-2 rounded shadow-lg z-50 transition-all font-medium flex items-center gap-2">
          <span>✅</span> {toastMessage}
        </div>
      )}

      <div className="max-w-[1450px] mx-auto flex flex-col gap-3">

        {/* ================= TOP HEADER & STATS ROW ================= */}
        <div className="flex flex-col xl:flex-row gap-3">

          {/* 1. Header Banner & Calendar Settings Box */}
          <div className="flex flex-col gap-2 w-full xl:w-64 shrink-0">
            <div className="bg-[#7A766B] text-white font-bold text-center py-3 rounded-xs border border-[#69655B] shadow-xs flex flex-col items-center justify-center">
              <span className="text-base tracking-wider uppercase">HABIT TRACKER</span>
              <span className="text-xs font-normal tracking-wide text-[#E2E0D8]">- {month.toUpperCase()} -</span>
            </div>

            <div className="bg-[#DCDAD1] border border-[#9E9A8F] rounded-xs overflow-hidden">
              <div className="bg-[#7A766B] text-white font-bold text-center py-1 uppercase text-[10px] tracking-wider border-b border-[#9E9A8F]">
                CALENDER SETTINGS
              </div>
              <div className="flex border-b border-[#9E9A8F]">
                <div className="w-1/3 bg-[#A6A298] text-white font-bold text-center py-1.5 border-r border-[#9E9A8F] flex items-center justify-center text-[10px]">
                  YEARS
                </div>
                <div className="w-2/3 bg-[#F5F4EF] flex items-center justify-center font-semibold text-[#333]">
                  {year}
                </div>
              </div>
              <div className="flex">
                <div className="w-1/3 bg-[#A6A298] text-white font-bold text-center py-1.5 border-r border-[#9E9A8F] flex items-center justify-center text-[10px]">
                  Mounth
                </div>
                <div className="w-2/3 bg-[#F5F4EF] flex items-center justify-center font-semibold text-[#333]">
                  {month}
                </div>
              </div>
            </div>

            {/* Centralized Settings Button */}
            <button
              onClick={openModal}
              className="w-full bg-[#7A766B] hover:bg-[#68645A] text-white font-semibold py-2 px-3 rounded-xs border border-[#5A574F] transition-all flex items-center justify-center gap-1.5 shadow-xs text-xs cursor-pointer"
            >
              <span>⚙️</span> Settings & Customization
            </button>
          </div>

          {/* 2. Charts: Daily Progress & Weekly Progress */}
          <div className="flex-1 flex flex-col md:flex-row gap-3 min-h-[160px]">
            {/* Daily Progress */}
            <div className="flex-1 bg-[#DCDAD1] border border-[#9E9A8F] p-2 flex flex-col rounded-xs">
              <div className="flex justify-between items-center px-2 mb-1">
                <span className="text-emerald-700 font-bold text-base leading-none">↗</span>
                <span className="font-bold text-[#444] text-xs">Daily Progress</span>
                <span className="w-4"></span>
              </div>
              <div className="flex-1 w-full min-h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyProgressData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 8, fill: '#444' }} interval={0} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 8, fill: '#444' }} axisLine={false} tickLine={false} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
                    <Bar dataKey="val" fill="#7A766B" barSize={6} radius={[1, 1, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Weekly Progress */}
            <div className="flex-1 bg-[#DCDAD1] border border-[#9E9A8F] p-2 flex flex-col rounded-xs">
              <div className="flex justify-between items-center px-2 mb-1">
                <span className="text-emerald-700 font-bold text-base leading-none">↗</span>
                <span className="font-bold text-[#444] text-xs">Weekly Progress</span>
                <span className="w-4"></span>
              </div>
              <div className="flex-1 w-full min-h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyProgressData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#444' }} interval={0} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 8, fill: '#444' }} axisLine={false} tickLine={false} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
                    <Bar dataKey="val" fill="#7A766B" barSize={34} radius={[1, 1, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 3. Overall Stats Summary Cards & Doughnut Chart */}
          <div className="flex flex-row md:flex-col lg:flex-row gap-2 w-full xl:w-72 shrink-0">
            <div className="flex flex-col gap-1.5 w-1/3 lg:w-[32%] justify-between">
              <div className="bg-[#DCDAD1] border border-[#9E9A8F] flex flex-col items-center justify-center p-1.5 flex-1 rounded-xs">
                <span className="text-[#555] font-bold text-[10px]">Goal</span>
                <span className="text-sm font-bold text-[#222]">{overallStats.goal}</span>
              </div>
              <div className="bg-[#DCDAD1] border border-[#9E9A8F] flex flex-col items-center justify-center p-1.5 flex-1 rounded-xs">
                <span className="text-[#555] font-bold text-[10px]">Completed</span>
                <span className="text-sm font-bold text-[#222]">{overallStats.completed}</span>
              </div>
              <div className="bg-[#DCDAD1] border border-[#9E9A8F] flex flex-col items-center justify-center p-1.5 flex-1 rounded-xs">
                <span className="text-[#555] font-bold text-[10px]">Left</span>
                <span className="text-sm font-bold text-[#222]">{overallStats.left}</span>
              </div>
            </div>

            <div className="flex-1 bg-[#DCDAD1] border border-[#9E9A8F] flex flex-col rounded-xs overflow-hidden">
              <div className="bg-[#7A766B] text-white text-center font-bold py-1 border-b border-[#9E9A8F] text-xs">
                Overall Stats
              </div>
              <div className="flex-1 relative min-h-[110px] flex items-center justify-center p-1">
                <div className="w-[120px] h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { value: overallStats.completed },
                          { value: overallStats.left }
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius="48%"
                        outerRadius="82%"
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                        stroke="none"
                      >
                        <Cell fill={THEME.pieDark} />
                        <Cell fill={THEME.pieLight} />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-xs font-bold text-[#222]">{overallStats.pct.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* ================= MAIN 31-DAY SPREADSHEET GRID & ANALYSIS ================= */}
        <div className="overflow-x-auto w-full border border-[#9E9A8F] rounded-xs bg-[#EBE9E1]">
          <table className="w-full border-collapse table-fixed whitespace-nowrap text-center">
            <thead>
              {/* Row 1: Weeks & Main Analysis Header */}
              <tr>
                <th rowSpan={2} className="border border-[#9E9A8F] bg-[#A6A298] text-white font-bold w-44 md:w-52 px-2 py-1 text-left text-xs">
                  My Habits
                </th>
                <th colSpan={7} className="border border-[#9E9A8F] bg-[#A6A298] text-[#222] font-bold py-0.5 text-xs">Week 1</th>
                <th colSpan={7} className="border border-[#9E9A8F] bg-[#A6A298] text-[#222] font-bold py-0.5 text-xs">Week 2</th>
                <th colSpan={7} className="border border-[#9E9A8F] bg-[#A6A298] text-[#222] font-bold py-0.5 text-xs">Week 3</th>
                <th colSpan={7} className="border border-[#9E9A8F] bg-[#A6A298] text-[#222] font-bold py-0.5 text-xs">Week 4</th>
                {numDays > 28 && (
                  <th colSpan={numDays - 28} className="border border-[#9E9A8F] bg-[#A6A298] text-[#222] font-bold py-0.5 text-xs">week 5</th>
                )}
                <th colSpan={5} rowSpan={2} className="border border-[#9E9A8F] bg-[#7A766B] text-white font-bold py-1 text-xs">Analysis</th>
              </tr>
              {/* Row 2: Days of Week Abbreviations */}
              <tr>
                {dayNames.map((dName, i) => (
                  <th key={i} className="border border-[#9E9A8F] bg-[#C7C4BB] text-[#222] font-medium w-6 text-[9px] py-0.5">
                    {dName}
                  </th>
                ))}
              </tr>
              {/* Row 3: Day Numbers & Analysis Subheaders */}
              <tr>
                <th className="border border-[#9E9A8F] bg-[#C7C4BB]"></th>
                {Array.from({ length: numDays }, (_, i) => (
                  <th key={i} className="border border-[#9E9A8F] bg-[#B3B0A6] text-[#222] font-semibold text-[9px] py-0.5">
                    {i + 1}
                  </th>
                ))}
                <th className="border border-[#9E9A8F] bg-[#C7C4BB] text-[#222] font-bold w-8 text-[9px]">Goal</th>
                <th className="border border-[#9E9A8F] bg-[#C7C4BB] text-[#222] font-bold w-10 text-[9px]">Actual</th>
                <th className="border border-[#9E9A8F] bg-[#C7C4BB] text-[#222] font-bold w-8 text-[9px]">Left</th>
                <th className="border border-[#9E9A8F] bg-[#C7C4BB] text-[#222] font-bold w-28 text-[9px]">Progress</th>
                <th className="border border-[#9E9A8F] bg-[#C7C4BB] text-[#222] font-bold w-10 text-[9px]">%</th>
              </tr>
            </thead>

            <tbody>
              {habitAnalysis.map((item, rIdx) => (
                <tr key={item.id} className={rIdx % 2 === 0 ? 'bg-[#DCDAD1]' : 'bg-[#E4E2DA]'}>
                  {/* Habit Title */}
                  <td className="border border-[#9E9A8F] text-right font-medium px-2 py-1 truncate text-xs text-[#333]">
                    {item.name} {item.emoji}
                  </td>

                  {/* 1..31 Checkboxes */}
                  {Array.from({ length: numDays }, (_, cIdx) => {
                    const dayNum = cIdx + 1;
                    const dk = dateKey(dayNum);
                    const isChecked = !!(logs[dk] && logs[dk][item.id]);

                    return (
                      <td key={cIdx} className="border border-[#9E9A8F] bg-[#F5F4EF] p-0 text-center hover:bg-white transition-colors">
                        <input
                          type="checkbox"
                          className="cursor-pointer accent-[#7A766B] w-3.5 h-3.5 align-middle m-0"
                          checked={isChecked}
                          onChange={() => handleToggleCheck(item.id, dayNum)}
                        />
                      </td>
                    );
                  })}

                  {/* Dynamic Analysis Calculations */}
                  <td className="border border-[#9E9A8F] bg-[#F5F4EF] font-semibold text-[#444] text-[10px]">
                    {item.goal}
                  </td>
                  <td className="border border-[#9E9A8F] bg-[#F5F4EF] font-semibold text-[#444] text-[10px]">
                    {item.actual}
                  </td>
                  <td className="border border-[#9E9A8F] bg-[#F5F4EF] font-semibold text-[#444] text-[10px]">
                    {item.left}
                  </td>
                  <td className="border border-[#9E9A8F] bg-[#F5F4EF] p-1">
                    <div className="w-full bg-[#D5D3CA] h-3 rounded-xs overflow-hidden">
                      <div
                        className="h-full bg-[#7A766B] transition-all duration-300"
                        style={{ width: `${item.pct}%` }}
                      ></div>
                    </div>
                  </td>
                  <td className="border border-[#9E9A8F] bg-[#F5F4EF] font-semibold text-[#444] text-[10px]">
                    {item.pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ================= BOTTOM SECTION: MENTAL STATE & TOP 10 ================= */}
        <div className="flex flex-col xl:flex-row gap-3">
          
          {/* Mental State Section */}
          <div className="flex-1 flex flex-col gap-2">
            <div className="overflow-x-auto border border-[#9E9A8F] rounded-xs bg-[#EBE9E1]">
              <table className="w-full border-collapse table-fixed text-center">
                <thead>
                  <tr>
                    <th colSpan={numDays + 1} className="border border-[#9E9A8F] bg-[#7A766B] text-white font-bold py-1 text-xs">
                      Mental state
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {['mood', 'motivation'].map((type) => (
                    <tr key={type}>
                      <td className="border border-[#9E9A8F] bg-[#A6A298] font-bold text-[#222] w-44 md:w-52 py-1 text-xs capitalize">
                        {type}
                      </td>
                      {Array.from({ length: numDays }, (_, cIdx) => {
                        const dayNum = cIdx + 1;
                        const dk = dateKey(dayNum);
                        const val = mentalLogs[dk]?.[type] || '';

                        return (
                          <td key={cIdx} className="border border-[#9E9A8F] bg-[#F5F4EF] p-0 w-6">
                            <input
                              type="text"
                              maxLength={2}
                              className="w-full h-full text-center bg-transparent border-none outline-none font-medium text-[9px] py-1 text-[#222] focus:bg-white"
                              value={val}
                              onChange={(e) => handleMentalInput(type, dayNum, e.target.value)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mental State Dual Line Chart */}
            <div className="bg-[#DCDAD1] border border-[#9E9A8F] p-3 rounded-xs h-52 flex flex-col">
              <div className="flex items-center justify-between mb-1 px-2 text-[10px] text-[#555] font-semibold">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#6E6A5F] inline-block"></span> Mood
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#A8A49A] inline-block"></span> Motivation
                  </span>
                </div>
                <span>Rating Scale (1-10)</span>
              </div>
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mentalChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid stroke="#C2C0B6" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#444' }} interval={1} />
                    <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 9, fill: '#444' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#F5F4EF', borderColor: '#9E9A8F', fontSize: '11px' }} />
                    <Line
                      type="monotone"
                      dataKey="mood"
                      stroke={THEME.lineMood}
                      strokeWidth={2}
                      dot={{ r: 3, fill: THEME.lineMood }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="motivation"
                      stroke={THEME.lineMotivation}
                      strokeWidth={2}
                      dot={{ r: 3, fill: THEME.lineMotivation }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Top 10 Daily Habits Card */}
          <div className="w-full xl:w-72 shrink-0">
            <div className="border border-[#9E9A8F] rounded-xs bg-[#EBE9E1] overflow-hidden">
              <div className="bg-[#7A766B] text-white font-bold text-center py-1.5 border-b border-[#9E9A8F] text-xs uppercase tracking-wider">
                TOP 10 DAILY HABIT
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {Array.from({ length: 10 }, (_, idx) => {
                    const habitText = displayTop10[idx] || '—';
                    return (
                      <tr key={idx} className="border-b border-[#9E9A8F] bg-[#F5F4EF] hover:bg-white transition-colors">
                        <td className="w-9 border-r border-[#9E9A8F] text-center font-bold text-[#555] py-1 text-xs">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-1 font-medium text-[#222] text-xs truncate">
                          {habitText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>

      </div>

      {/* ================= CENTRALIZED SETTINGS & CUSTOMIZATION MODAL ================= */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-[#EBE9E1] border-2 border-[#7A766B] rounded-xs max-w-2xl w-full p-4 sm:p-5 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-hidden">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-[#9E9A8F] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚙️</span>
                <h2 className="text-base font-bold text-[#222] uppercase tracking-wide">
                  Centralized Tracker Settings
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#666] hover:text-[#000] font-bold text-base px-2 py-0.5 rounded"
              >
                ✕
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-[#9E9A8F] overflow-x-auto gap-1">
              {[
                { id: 'habits', label: '📝 Habits Management' },
                { id: 'year', label: '🗓️ Year & Month' },
                { id: 'calendar', label: '📅 Calendar Settings' },
                { id: 'top10', label: '🏆 Top 10 Ranking' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-t-xs border-t border-l border-r border-[#9E9A8F] transition-all whitespace-nowrap cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-[#7A766B] text-white border-b-transparent'
                      : 'bg-[#DCDAD1] text-[#555] hover:bg-[#C7C4BB]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto pr-1">

              {/* TAB 1: HABITS MANAGEMENT */}
              {activeTab === 'habits' && (
                <div className="flex flex-col gap-4">
                  {/* Add New Habit Bar */}
                  <div className="bg-[#DCDAD1] p-3 border border-[#9E9A8F] rounded-xs flex flex-col sm:flex-row gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Emoji (e.g. 🚴)"
                      className="w-16 bg-white border border-[#9E9A8F] p-1.5 text-xs text-center rounded-xs"
                      value={newHabitEmoji}
                      onChange={(e) => setNewHabitEmoji(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Enter new habit name..."
                      className="flex-1 w-full bg-white border border-[#9E9A8F] p-1.5 text-xs rounded-xs"
                      value={newHabitName}
                      onChange={(e) => setNewHabitName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addDraftHabit()}
                    />
                    <button
                      onClick={addDraftHabit}
                      className="w-full sm:w-auto bg-[#7A766B] hover:bg-[#68645A] text-white font-bold px-3 py-1.5 text-xs rounded-xs whitespace-nowrap"
                    >
                      + Add Habit
                    </button>
                  </div>

                  {/* Habit List Editor */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-[#444] mb-1">
                      Edit, Reorder, Enable/Disable, or Delete Habits ({draftHabits.length}):
                    </span>

                    {draftHabits.map((h, idx) => (
                      <div key={h.id} className="flex items-center gap-2 bg-[#F5F4EF] p-2 border border-[#9E9A8F] rounded-xs">
                        <input
                          type="checkbox"
                          title="Toggle active status"
                          className="accent-[#7A766B] cursor-pointer"
                          checked={h.enabled !== false}
                          onChange={(e) => {
                            const updated = [...draftHabits];
                            updated[idx].enabled = e.target.checked;
                            setDraftHabits(updated);
                          }}
                        />
                        <input
                          type="text"
                          className="w-10 bg-white border border-[#9E9A8F] p-1 text-xs text-center rounded-xs"
                          value={h.emoji}
                          onChange={(e) => {
                            const updated = [...draftHabits];
                            updated[idx].emoji = e.target.value;
                            setDraftHabits(updated);
                          }}
                        />
                        <input
                          type="text"
                          className="flex-1 bg-white border border-[#9E9A8F] p-1 text-xs rounded-xs font-medium"
                          value={h.name}
                          onChange={(e) => {
                            const updated = [...draftHabits];
                            updated[idx].name = e.target.value;
                            setDraftHabits(updated);
                          }}
                        />

                        {/* Order Controls */}
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => moveDraftHabit(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 text-xs hover:bg-[#DCDAD1] disabled:opacity-30 rounded"
                            title="Move Up"
                          >
                            ⬆️
                          </button>
                          <button
                            onClick={() => moveDraftHabit(idx, 1)}
                            disabled={idx === draftHabits.length - 1}
                            className="p-1 text-xs hover:bg-[#DCDAD1] disabled:opacity-30 rounded"
                            title="Move Down"
                          >
                            ⬇️
                          </button>
                        </div>

                        {/* Delete Button & Inline Modal Confirmation */}
                        {deleteConfirmId === h.id ? (
                          <div className="flex items-center gap-1 bg-red-100 p-1 rounded border border-red-300">
                            <span className="text-[10px] text-red-700 font-bold">Confirm?</span>
                            <button
                              onClick={() => removeDraftHabit(h.id)}
                              className="bg-red-600 text-white font-bold px-1.5 py-0.5 text-[10px] rounded"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="bg-gray-300 text-black px-1.5 py-0.5 text-[10px] rounded"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(h.id)}
                            className="text-red-600 hover:text-red-800 font-bold px-1 text-xs"
                            title="Delete habit"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 2: YEAR & MONTH SETTINGS */}
              {activeTab === 'year' && (
                <div className="flex flex-col gap-4">
                  <div className="bg-[#DCDAD1] p-4 border border-[#9E9A8F] rounded-xs flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-[#333] border-b border-[#9E9A8F] pb-1">
                      Calendar Year & Month Navigation
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-[#444] mb-1">Select Year</label>
                        <select
                          className="w-full bg-white border border-[#9E9A8F] p-2 text-xs rounded-xs font-semibold"
                          value={draftYear}
                          onChange={(e) => setDraftYear(parseInt(e.target.value, 10))}
                        >
                          {Array.from({ length: 16 }, (_, i) => 2020 + i).map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-[#444] mb-1">Select Month</label>
                        <select
                          className="w-full bg-white border border-[#9E9A8F] p-2 text-xs rounded-xs font-semibold"
                          value={draftMonth}
                          onChange={(e) => setDraftMonth(e.target.value)}
                        >
                          {MONTH_NAMES.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-2 bg-[#F5F4EF] p-2 border border-[#9E9A8F] rounded-xs text-[11px] text-[#555]">
                      ℹ️ <strong>Date Info:</strong> {draftMonth} {draftYear} has <strong>{getDaysInMonth(draftYear, MONTH_NAMES.indexOf(draftMonth))} days</strong>. 
                      {isLeapYear(draftYear) && draftMonth === 'February' && (
                        <span className="text-emerald-700 font-bold ml-1">✨ Leap Year Active (29 Days)!</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: CALENDAR SETTINGS */}
              {activeTab === 'calendar' && (
                <div className="flex flex-col gap-4">
                  <div className="bg-[#DCDAD1] p-4 border border-[#9E9A8F] rounded-xs flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-[#333] border-b border-[#9E9A8F] pb-1">
                      Weekday Calculation & Display Format
                    </h3>

                    <div>
                      <label className="block text-xs font-bold text-[#444] mb-2">Weekday Header Mode:</label>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 cursor-pointer text-xs bg-white p-2 border border-[#9E9A8F] rounded-xs">
                          <input
                            type="radio"
                            name="calStart"
                            className="accent-[#7A766B]"
                            checked={draftCalendarStartDay === 'auto'}
                            onChange={() => setDraftCalendarStartDay('auto')}
                          />
                          <span><strong>Real Calendar Days</strong> (Jan 1, 2026 aligns with actual weekday Thursday, Friday, etc.)</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer text-xs bg-white p-2 border border-[#9E9A8F] rounded-xs">
                          <input
                            type="radio"
                            name="calStart"
                            className="accent-[#7A766B]"
                            checked={draftCalendarStartDay === 'Sa'}
                            onChange={() => setDraftCalendarStartDay('Sa')}
                          />
                          <span><strong>Saturday Start Sequence</strong> (Matches original layout image: Sa, Su, Mo...)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: TOP 10 RANKING SETTINGS */}
              {activeTab === 'top10' && (
                <div className="flex flex-col gap-4">
                  <div className="bg-[#DCDAD1] p-4 border border-[#9E9A8F] rounded-xs flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-[#333] border-b border-[#9E9A8F] pb-1">
                      Top 10 Daily Habits Display Mode
                    </h3>

                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 cursor-pointer text-xs bg-white p-2 border border-[#9E9A8F] rounded-xs">
                        <input
                          type="radio"
                          name="top10Mode"
                          className="accent-[#7A766B]"
                          checked={draftTop10Mode === 'auto'}
                          onChange={() => setDraftTop10Mode('auto')}
                        />
                        <span><strong>Auto-Ranked Live:</strong> Ranks habits dynamically based on highest completion counts this month.</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer text-xs bg-white p-2 border border-[#9E9A8F] rounded-xs">
                        <input
                          type="radio"
                          name="top10Mode"
                          className="accent-[#7A766B]"
                          checked={draftTop10Mode === 'manual'}
                          onChange={() => setDraftTop10Mode('manual')}
                        />
                        <span><strong>Custom Priority List:</strong> Define your own explicit Top 10 list order.</span>
                      </label>
                    </div>

                    {draftTop10Mode === 'manual' && (
                      <div className="mt-3 flex flex-col gap-1.5">
                        <span className="text-xs font-bold text-[#444]">Custom Top 10 List:</span>
                        {draftCustomTop10.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="w-5 text-right font-bold text-[#666] text-xs">{idx + 1}.</span>
                            <input
                              type="text"
                              className="flex-1 bg-white border border-[#9E9A8F] p-1 text-xs rounded-xs"
                              value={item}
                              onChange={(e) => {
                                const arr = [...draftCustomTop10];
                                arr[idx] = e.target.value;
                                setDraftCustomTop10(arr);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Modal Actions Footer */}
            <div className="flex justify-end gap-2 border-t border-[#9E9A8F] pt-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="bg-[#A6A298] hover:bg-[#969288] text-white font-semibold px-4 py-1.5 text-xs rounded-xs transition-all"
              >
                Cancel
              </button>
              <button
                onClick={saveModalSettings}
                className="bg-[#7A766B] hover:bg-[#68645A] text-white font-bold px-5 py-1.5 text-xs rounded-xs transition-all shadow-xs cursor-pointer flex items-center gap-1"
              >
                <span>💾</span> Save All Changes
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}