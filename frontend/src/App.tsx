import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  LayoutDashboard, Plus, Settings as SettingsIcon, Menu, X,
  Wifi, WifiOff, Camera, Sun, Moon, User,
} from "lucide-react";
import Dashboard from "./screens/Dashboard";
import PatientInfo from "./screens/PatientInfo";
import Capture from "./screens/Capture";
import AIResult from "./screens/AIResult";
import Landing from "./screens/Landing";
import Login from "./screens/Login";
import Register from "./screens/Register";
import Settings from "./screens/Settings";
import Avatar from "./Avatar";
import { I18nProvider, useI18n } from "./i18n";
import * as api from "./api";
import type { ApiExam, ApiUser, DeviceStatus } from "./api";

export type Screen = "landing" | "login" | "register" | "settings" | "dashboard" | "patient-info" | "capture" | "ai-result";

export interface Patient {
  id: string;
  name: string;
  dob: string;
  ear: "Left" | "Right";
  notes: string;
}

export interface NavProps {
  goTo: (screen: Screen, examId?: string) => void;
  patient: Patient | null;
  setPatient: (p: Patient) => void;
  exam: ApiExam | null;
  setExam: (e: ApiExam | null) => void;
  user: ApiUser | null;
  setUser: (u: ApiUser | null) => void;
  device: DeviceStatus;
  signOut: () => void;
}

const formatRes = (r?: string | null) => (r ? r.replace("x", "×") : "—");

function routeFor(screen: Screen, examId?: string) {
  if (screen === "landing") return "/";
  if (screen === "login") return "/login";
  if (screen === "register") return "/register";
  if (screen === "dashboard") return "/dashboard";
  if (screen === "settings") return "/settings";
  if (screen === "patient-info") return "/examinations/new";
  if (screen === "capture") return examId ? `/examinations/${encodeURIComponent(examId)}/capture` : "/examinations/new";
  return examId ? `/examinations/${encodeURIComponent(examId)}/result` : "/dashboard";
}

function routeFromLocation(): { screen: Screen; examId?: string } {
  const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { screen: api.getToken() ? "dashboard" : "landing" };
  if (parts.length === 1 && parts[0] === "login") return { screen: "login" };
  if (parts.length === 1 && parts[0] === "register") return { screen: api.getToken() ? "dashboard" : "register" };
  if (parts.length === 1 && parts[0] === "dashboard") return { screen: api.getToken() ? "dashboard" : "login" };
  if (parts.length === 1 && parts[0] === "settings") return { screen: api.getToken() ? "settings" : "login" };
  if (parts.length === 2 && parts[0] === "examinations" && parts[1] === "new") {
    return { screen: api.getToken() ? "patient-info" : "login" };
  }
  if (parts.length === 3 && parts[0] === "examinations") {
    if (parts[2] === "capture") return { screen: api.getToken() ? "capture" : "login", examId: parts[1] };
    if (parts[2] === "result") return { screen: api.getToken() ? "ai-result" : "login", examId: parts[1] };
  }
  return { screen: api.getToken() ? "dashboard" : "landing" };
}

export default function App() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}

function AppShell() {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>(() => routeFromLocation().screen);
  const [routeExamId, setRouteExamId] = useState<string | undefined>(() => routeFromLocation().examId);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [exam, setExam] = useState<ApiExam | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [device, setDevice] = useState<DeviceStatus>({ registered: false, connected: false });
  const [darkMode, setDarkModeState] = useState(false);
  const pointer = useRef({ x: window.innerWidth - 40, y: 28 });

  useEffect(() => {
    const track = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointerdown", track, true);
    return () => window.removeEventListener("pointerdown", track, true);
  }, []);

  const setDarkMode = (v: boolean) => {
    const root = document.documentElement;
    const apply = () => {
      flushSync(() => setDarkModeState(v));
      root.classList.toggle("dark", v);
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) return apply();
    root.style.setProperty("--vt-x", `${pointer.current.x}px`);
    root.style.setProperty("--vt-y", `${pointer.current.y}px`);
    root.classList.add("vt-active");
    document.startViewTransition(apply).finished.finally(() => root.classList.remove("vt-active"));
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // restore the session after a page reload; a stale token triggers UNAUTH_EVENT below
  useEffect(() => {
    if (api.getToken()) api.me().then(setUser).catch(() => {});
  }, []);

  // any 401 from the backend => back to the login screen
  useEffect(() => {
    const onUnauth = () => {
      setUser(null); setExam(null); setPatient(null);
      window.history.replaceState(null, "", "/login");
      setScreen("login");
      setRouteExamId(undefined);
    };
    window.addEventListener(api.UNAUTH_EVENT, onUnauth);
    return () => window.removeEventListener(api.UNAUTH_EVENT, onUnauth);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const route = routeFromLocation();
      setScreen(route.screen);
      setRouteExamId(route.examId);
      setSidebarOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!routeExamId || (screen !== "capture" && screen !== "ai-result") || exam?.id === routeExamId) return;
    api.getExam(routeExamId)
      .then((loaded) => {
        setExam(loaded);
        setPatient({
          id: loaded.patient.id,
          name: loaded.patient.name,
          dob: loaded.patient.dob ?? "",
          ear: loaded.patient.ear,
          notes: loaded.patient.notes ?? "",
        });
      })
      .catch(() => {
        window.history.replaceState(null, "", "/dashboard");
        setRouteExamId(undefined);
        setScreen("dashboard");
      });
  }, [exam?.id, routeExamId, screen]);

  // device chips: poll the backend (the Pi sends a heartbeat every 10s)
  const loggedIn = screen !== "landing" && screen !== "login" && screen !== "register";
  useEffect(() => {
    if (!loggedIn) return;
    let live = true;
    const tick = () =>
      api.deviceStatus()
        .then((d) => { if (live) setDevice(d); })
        .catch(() => { if (live) setDevice((d) => ({ ...d, connected: false })); });
    tick();
    const iv = setInterval(tick, 5000);
    return () => { live = false; clearInterval(iv); };
  }, [loggedIn]);

  const goTo = (s: Screen, examId?: string) => {
    if (s !== "landing" && s !== "login" && s !== "register" && !api.getToken()) s = "login";
    const target = routeFor(s, examId);
    window.history.pushState(null, "", target);
    setScreen(s);
    setRouteExamId(examId);
    setSidebarOpen(false);
    if (s === "patient-info") setExam(null);
  };

  const signOut = () => {
    void api.logout();
    setUser(null); setExam(null); setPatient(null);
    window.history.replaceState(null, "", "/login");
    setScreen("login");
  };

  const navProps: NavProps = { goTo, patient, setPatient, exam, setExam, user, setUser, device, signOut };

  useEffect(() => { window.scrollTo(0, 0); }, [screen]);

  if (screen === "landing" || screen === "login" || screen === "register") {
    return (
      <div className="min-h-screen">
        {screen === "landing" ? <Landing {...navProps} /> : screen === "login" ? <Login {...navProps} /> : <Register {...navProps} />}
      </div>
    );
  }

  return (
    <div className={`flex h-screen overflow-hidden bg-[#F5F7FA] dark:bg-[#0B1120] theme-transition`}>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[260px] shrink-0 bg-white dark:bg-[#111827] border-r border-[#E8E8E8] dark:border-[#1E293B]">
        <SidebarContent screen={screen} goTo={goTo} user={user} device={device} />
      </aside>

      {/* Mobile/Tablet Drawer Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-10 flex flex-col w-[260px] bg-white dark:bg-[#111827] border-r border-[#E8E8E8] dark:border-[#1E293B] animate-slide-in">
            <SidebarContent screen={screen} goTo={goTo} user={user} device={device} onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex items-center gap-2 min-h-14 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] sm:px-4 bg-white dark:bg-[#111827] border-b border-[#E8E8E8] dark:border-[#1E293B] shrink-0 z-10">
          <button
            className="lg:hidden p-2 -ml-1 rounded-xl text-muted hover:bg-[#F5F7FA] dark:text-muted-dark dark:hover:bg-[#1E2A3B]"
            onClick={() => setSidebarOpen(true)}
            aria-label={t("nav.openMenu")}
          >
            <Menu size={20} />
          </button>

          {/* OCEDA wordmark on mobile */}
          <div className="lg:hidden">
            <OcedaWordmark compact />
          </div>

          <div className="flex-1" />

          {/* Device chips */}
          <div className="flex items-center gap-2">
            <DeviceChip connected={device.connected} name={device.name} />
            {device.connected && <ResolutionChip res={formatRes(device.resolution)} />}
          </div>

          {/* Dark mode toggle */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-xl text-muted hover:bg-[#F5F7FA] dark:text-muted-dark dark:hover:bg-[#1E2A3B] transition-colors"
            aria-label={t("nav.toggleTheme")}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* User avatar */}
          <div className="flex items-center gap-2 pl-1">
            <Avatar name={user?.name} url={user?.avatar_url} size="w-8 h-8 text-xs" />
            <span className="hidden sm:block text-sm font-medium text-[#1F1F1F] dark:text-[#F1F5F9]">
              {user?.name ?? ""}
            </span>
          </div>
        </header>

        {/* Screen content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {screen === "dashboard" && <Dashboard {...navProps} />}
          {screen === "patient-info" && <PatientInfo {...navProps} />}
          {screen === "capture" && <Capture {...navProps} />}
          {screen === "ai-result" && <AIResult {...navProps} />}
          {screen === "settings" && <Settings {...navProps} darkMode={darkMode} setDarkMode={setDarkMode} />}
        </main>
      </div>
    </div>
  );
}

/* ── Sidebar ── */
function SidebarContent({
  screen,
  goTo,
  user,
  device,
  onClose,
}: {
  screen: Screen;
  goTo: (s: Screen) => void;
  user: ApiUser | null;
  device: DeviceStatus;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#1E293B]">
        <OcedaWordmark />
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:bg-[#F5F7FA] dark:text-muted-dark dark:hover:bg-[#1E2A3B]"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Section label */}
      <div className="px-6 pt-5 pb-2">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-coral-ink dark:text-coral-soft">
          {t("nav.navigation")}
        </span>
      </div>

      {/* Nav */}
      <nav className="px-3 space-y-0.5">
        <NavItem
          icon={<LayoutDashboard size={17} />}
          label={t("nav.dashboard")}
          active={screen === "dashboard"}
          onClick={() => goTo("dashboard")}
        />
        <NavItem
          icon={<Plus size={17} />}
          label={t("nav.newExam")}
          active={screen === "patient-info" || screen === "capture" || screen === "ai-result"}
          onClick={() => goTo("patient-info")}
        />
        <NavItem
          icon={<SettingsIcon size={17} />}
          label={t("nav.settings")}
          active={screen === "settings"}
          onClick={() => goTo("settings")}
        />
      </nav>

      {/* Device status in sidebar */}
      <div className="mx-4 mt-4">
        <div className="rounded-xl border border-[#E8E8E8] dark:border-[#1E293B] bg-[#F5F7FA] dark:bg-[#0B1120] p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${device.connected ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
            <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F5F9] truncate">
              {device.name ?? "OCEDA device"}
            </span>
            <span className={`ml-auto text-[10px] font-medium ${device.connected ? "text-green-900 dark:text-green-400" : "text-muted dark:text-muted-dark"}`}>
              {device.connected ? t("device.connected") : t("device.disconnected")}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted dark:text-muted-dark">
            <span className="flex items-center gap-1">
              <Camera size={11} /> {formatRes(device.resolution)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {/* User profile */}
      <div className="mx-3 mb-4 p-3 rounded-xl border border-[#E8E8E8] dark:border-[#1E293B] bg-white dark:bg-[#1E2A3B]">
        <div className="flex items-center gap-3">
          <Avatar name={user?.name} url={user?.avatar_url} size="w-9 h-9 text-sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1F1F1F] dark:text-[#F1F5F9] truncate font-display">
              {user?.name ?? ""}
            </p>
            <p className="text-xs text-muted dark:text-muted-dark truncate">
              {t("role.gp")}
            </p>
          </div>
          <User size={14} className="text-muted dark:text-muted-dark shrink-0 ml-auto" />
        </div>
      </div>
    </>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer hover:translate-x-0.5 ${
        active
          ? "bg-[#E6F7FF] dark:bg-primary/10 text-primary-ink dark:text-primary-soft"
          : "text-muted dark:text-muted-dark hover:bg-[#F5F7FA] dark:hover:bg-[#1E2A3B] hover:text-[#1F1F1F] dark:hover:text-white"
      }`}
    >
      <span className={active ? "text-primary-ink dark:text-primary-soft" : ""}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {active && (
        <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
      )}
    </button>
  );
}

/* ── Header chips ── */
function OcedaWordmark({ compact }: { compact?: boolean }) {
  const size = "text-xl";
  return (
    <div className="flex items-center gap-0.5">
      <span className={`font-display font-extrabold ${size} text-primary dark:text-primary-soft leading-none`}>
        OCEDA
      </span>
      <span className={`font-display font-extrabold ${size} text-[#1F1F1F] dark:text-white leading-none`}></span>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent ml-0.5 mb-0.5 dot-pulse shrink-0" />
    </div>
  );
}

function DeviceChip({ connected, name }: { connected: boolean; name?: string }) {
  const { t } = useI18n();
  return (
    <div
      className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
        connected
          ? "bg-green-50 text-green-900 dark:bg-green-900/20 dark:text-green-400"
          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
      }`}
    >
      {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
      <span>{connected ? name ?? "OCEDA device" : t("device.disconnected")}</span>
    </div>
  );
}

function ResolutionChip({ res }: { res: string }) {
  return (
    <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium text-muted dark:text-muted-dark bg-[#F5F7FA] dark:bg-[#1E2A3B]">
      <Camera size={11} />
      <span>{res}</span>
    </div>
  );
}
