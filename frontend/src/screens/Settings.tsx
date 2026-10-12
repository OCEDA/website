import { useState, useRef, useEffect } from "react";
import { NavProps } from "../App";
import { useI18n, Lang } from "../i18n";
import { User, Sun, Camera, Bell, LogOut, Check, ChevronDown, Languages } from "lucide-react";

interface SettingsProps extends NavProps {
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
}

function Card({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl card-gradient border border-[#E8E8E8] dark:border-[#1E293B] p-6 shadow-sm mb-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-[#1F1F1F] dark:text-white font-display mb-5">
        <span className="w-8 h-8 rounded-xl bg-[#E6F7FF] dark:bg-primary/10 text-primary-ink dark:text-primary-soft flex items-center justify-center">
          <Icon size={16} />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors cursor-pointer ${
        checked ? "bg-primary" : "bg-[#E8E8E8] dark:bg-[#334155]"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

function Row({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1F1F1F] dark:text-[#F1F5F9]">{title}</p>
        <p className="text-xs text-muted dark:text-muted-dark">{text}</p>
      </div>
      {children}
    </div>
  );
}

const labelCls = "block text-xs font-semibold text-muted dark:text-muted-dark uppercase tracking-wide mb-1.5";
const fieldCls =
  "w-full px-4 py-3 rounded-xl border border-[#E8E8E8] dark:border-[#1E293B] text-sm text-[#1F1F1F] dark:text-[#F1F5F9] bg-white dark:bg-[#0B1120] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10";

function Dropdown({
  id, value, onChange, options,
}: { id: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${fieldCls} flex items-center justify-between gap-3 text-left ${open ? "border-primary ring-2 ring-primary/10" : ""}`}
      >
        <span>{current?.label}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted dark:text-muted-dark transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="animate-fade-up absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl border border-primary bg-white dark:bg-[#1E2A3B] shadow-lg p-1"
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-3 rounded-lg text-sm text-left transition-colors ${
                  o.value === value
                    ? "bg-[#E6F7FF] dark:bg-primary/10 text-primary-ink dark:text-primary-soft font-semibold"
                    : "text-[#1F1F1F] dark:text-[#F1F5F9] hover:bg-[#F5F7FA] dark:hover:bg-[#0B1120]"
                }`}
              >
                {o.label}
                {o.value === value && <Check size={15} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Settings({ user, signOut, darkMode, setDarkMode }: SettingsProps) {
  const { t, lang, setLang } = useI18n();
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState(() => t("role.gp"));
  const [clinic, setClinic] = useState("");
  const [resolution, setResolution] = useState("3280x2464");
  const [autoSave, setAutoSave] = useState(true);
  const [notify, setNotify] = useState(true);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-[780px] mx-auto px-5 sm:px-6 py-6 sm:py-8 stagger">
      <div className="accent-rule mb-6" />
      <div className="mb-6">
        <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-1">{t("set.preferences")}</span>
        <h2 className="text-2xl font-extrabold text-[#1F1F1F] dark:text-white font-display">{t("set.title")}</h2>
        <p className="text-sm text-muted dark:text-muted-dark mt-1">
          {t("set.subtitle")}
        </p>
      </div>

      <Card icon={User} title={t("set.profile")}>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="s-name" className={labelCls}>{t("set.fullName")}</label>
            <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label htmlFor="s-role" className={labelCls}>{t("set.role")}</label>
            <input id="s-role" value={role} onChange={(e) => setRole(e.target.value)} className={fieldCls} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="s-clinic" className={labelCls}>{t("set.clinic")}</label>
            <input
              id="s-clinic"
              value={clinic}
              onChange={(e) => setClinic(e.target.value)}
              placeholder={t("set.clinicPh")}
              className={`${fieldCls} placeholder-[#4F5968] dark:placeholder-[#B4C0D0]`}
            />
          </div>
        </div>
      </Card>

      <Card icon={Sun} title={t("set.appearance")}>
        <Row title={t("set.dark")} text={t("set.darkText")}>
          <Toggle checked={darkMode} onChange={setDarkMode} label={t("set.dark")} />
        </Row>
      </Card>

      <Card icon={Languages} title={t("set.language")}>
        <label htmlFor="s-lang" className={labelCls}>{t("set.languageLabel")}</label>
        <Dropdown
          id="s-lang"
          value={lang}
          onChange={(v) => setLang(v as Lang)}
          options={[
            { value: "en", label: "English" },
            { value: "id", label: "Bahasa Indonesia" },
          ]}
        />
        <p className="text-xs text-muted dark:text-muted-dark mt-2">{t("set.languageText")}</p>
      </Card>

      <Card icon={Camera} title={t("set.device")}>
        <div className="mb-5">
          <label htmlFor="s-res" className={labelCls}>{t("set.resolution")}</label>
          <Dropdown
            id="s-res"
            value={resolution}
            onChange={setResolution}
            options={[
              { value: "3280x2464", label: t("set.resFull") },
              { value: "1920x1080", label: t("set.resHd") },
              { value: "1640x1232", label: t("set.resBinned") },
            ]}
          />
        </div>
        <Row title={t("set.autosave")} text={t("set.autosaveText")}>
          <Toggle checked={autoSave} onChange={setAutoSave} label={t("set.autosave")} />
        </Row>
      </Card>

      <Card icon={Bell} title={t("set.notifications")}>
        <Row title={t("set.resultAlerts")} text={t("set.resultAlertsText")}>
          <Toggle checked={notify} onChange={setNotify} label={t("set.resultAlerts")} />
        </Row>
      </Card>

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <button
          onClick={save}
          className="flex items-center gap-2 px-6 py-3 rounded-xl btn-gradient text-sm font-semibold transition-colors cursor-pointer"
        >
          {saved ? <><Check size={16} /> {t("set.saved")}</> : t("set.save")}
        </button>
        <button
          onClick={signOut}
          className="flex items-center gap-2 px-6 py-3 rounded-xl border border-[#E8E8E8] dark:border-[#1E293B] bg-white dark:bg-[#1E2A3B] text-sm font-semibold text-coral-ink dark:text-coral-soft hover:border-accent transition-colors cursor-pointer"
        >
          <LogOut size={16} /> {t("set.signOut")}
        </button>
      </div>
    </div>
  );
}
