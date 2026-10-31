import { useState } from "react";
import * as api from "../api";
import { NavProps, Patient } from "../App";
import { useI18n, TKey } from "../i18n";
import {
  ClipboardList, Camera, ScanEye, BrainCircuit,
  ChevronRight, User, Calendar, Hash, FileText,
  ArrowRight, Ear,
} from "lucide-react";

const STAGES: { icon: typeof Camera; label: TKey }[] = [
  { icon: ClipboardList, label: "stage.patientInfo" },
  { icon: Camera, label: "stage.capture" },
  { icon: ScanEye, label: "stage.review" },
  { icon: BrainCircuit, label: "stage.aiResult" },
];

function generatePatientId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `PT-${yy}${mm}${dd}-${seq}`;
}

export default function PatientInfo({ goTo, setPatient, setExam }: NavProps) {
  const { t } = useI18n();
  const [patientId] = useState(generatePatientId);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [ear, setEar] = useState<"Left" | "Right" | "">("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{ name?: TKey; ear?: TKey }>({});
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState(false);

  const validate = () => {
    const e: { name?: TKey; ear?: TKey } = {};
    if (!name.trim()) e.name = "pi.errName";
    if (!ear) e.ear = "pi.errEar";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleContinue = async () => {
    if (!validate() || busy) return;
    const p = { id: patientId, name: name.trim(), dob, ear: ear as "Left" | "Right", notes };
    setBusy(true);
    setCreateError(false);
    try {
      // opens the examination on the backend: from now on frames from the device attach to it
      const created = await api.createExam(p);
      setExam(created);
      setPatient(p);
      goTo("capture", created.id);
    } catch {
      setCreateError(true);
    } finally {
      setBusy(false);
    }
  };

  const canContinue = name.trim() && ear && !busy;

  return (
    <div className="max-w-[780px] mx-auto px-5 sm:px-6 py-6 sm:py-8 stagger">
      {/* Coral accent rule */}
      <div className="accent-rule mb-6" />

      {/* Stage indicator */}
      <StageIndicator current={0} />

      {/* Page header */}
      <div className="mt-6 mb-6">
        <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-1">
          {t("stageOf", { n: 1 })}
        </span>
        <h2 className="text-2xl font-extrabold text-[#1F1F1F] dark:text-white font-display">
          {t("pi.title")}
        </h2>
        <p className="text-sm text-muted dark:text-muted-dark mt-1">
          {t("pi.subtitle")}
        </p>
      </div>

      {/* Form card */}
      <div className="rounded-2xl card-gradient border border-[#E8E8E8] dark:border-[#1E293B] p-6 shadow-sm">
        {/* Patient ID (read-only) */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-muted dark:text-muted-dark uppercase tracking-wide mb-1.5">
            <span className="flex items-center gap-1.5">
              <Hash size={12} />
              {t("pi.id")}
            </span>
          </label>
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#F5F7FA] dark:bg-[#0B1120] border border-[#E8E8E8] dark:border-[#1E293B]">
            <span className="text-sm font-mono font-medium text-primary-ink dark:text-primary-soft tracking-wider">{patientId}</span>
            <span className="ml-auto text-[11px] text-muted dark:text-muted-dark bg-[#E8E8E8] dark:bg-[#334155] px-2 py-0.5 rounded-full">
              {t("pi.auto")}
            </span>
          </div>
        </div>

        {/* Full Name */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-muted dark:text-muted-dark uppercase tracking-wide mb-1.5">
            <span className="flex items-center gap-1.5">
              <User size={12} />
              {t("pi.name")} <span className="text-coral-ink dark:text-coral-soft">*</span>
            </span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrors((err) => ({ ...err, name: undefined })); }}
            placeholder={t("pi.namePh")}
            className={`w-full px-4 py-3 rounded-xl border text-sm text-[#1F1F1F] dark:text-[#F1F5F9] bg-white dark:bg-[#0B1120] placeholder-[#4F5968] dark:placeholder-[#B4C0D0] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 ${
              errors.name
                ? "border-accent"
                : "border-[#E8E8E8] dark:border-[#1E293B]"
            }`}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-coral-ink dark:text-coral-soft">{t(errors.name)}</p>
          )}
        </div>

        {/* Date of Birth */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-muted dark:text-muted-dark uppercase tracking-wide mb-1.5">
            <span className="flex items-center gap-1.5">
              <Calendar size={12} />
              {t("pi.dob")}
            </span>
          </label>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-[#E8E8E8] dark:border-[#1E293B] text-sm text-[#1F1F1F] dark:text-[#F1F5F9] bg-white dark:bg-[#0B1120] outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-colors"
          />
        </div>

        {/* Ear Side */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-muted dark:text-muted-dark uppercase tracking-wide mb-1.5">
            <span className="flex items-center gap-1.5">
              <Ear size={12} />
              {t("pi.ear")} <span className="text-coral-ink dark:text-coral-soft">*</span>
            </span>
          </label>
          <div className="flex gap-3">
            {(["Left", "Right"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => { setEar(side); setErrors((err) => ({ ...err, ear: undefined })); }}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition-all ${
                  ear === side
                    ? "bg-primary-hover text-white border-primary shadow-sm"
                    : "bg-white dark:bg-[#0B1120] text-muted dark:text-muted-dark border-[#E8E8E8] dark:border-[#1E293B] hover:border-primary/40 hover:text-primary-ink dark:hover:text-primary-soft"
                }`}
              >
                <Ear size={16} className={ear === side ? "" : "opacity-60"} />
                {t("earLabel", { ear: t(`ear.${side}`) })}
              </button>
            ))}
          </div>
          {errors.ear && <p className="mt-1 text-xs text-coral-ink dark:text-coral-soft">{t(errors.ear)}</p>}
        </div>

        {/* Notes */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-muted dark:text-muted-dark uppercase tracking-wide mb-1.5">
            <span className="flex items-center gap-1.5">
              <FileText size={12} />
              {t("pi.notes")}
              <span className="text-muted dark:text-hint-dark font-normal normal-case tracking-normal">
                {t("pi.optional")}
              </span>
            </span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("pi.notesPh")}
            rows={3}
            className="w-full px-4 py-3 rounded-xl border border-[#E8E8E8] dark:border-[#1E293B] text-sm text-[#1F1F1F] dark:text-[#F1F5F9] bg-white dark:bg-[#0B1120] placeholder-[#4F5968] dark:placeholder-[#B4C0D0] outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-colors resize-none"
          />
        </div>

        {createError && (
          <p role="alert" className="mb-4 text-xs text-coral-ink dark:text-coral-soft">{t("pi.errCreate")}</p>
        )}

        {/* Divider + Actions */}
        <div className="pt-5 border-t border-[#E8E8E8] dark:border-[#1E293B] flex items-center justify-between gap-4">
          <button
            onClick={() => goTo("dashboard")}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted dark:text-muted-dark hover:bg-[#F5F7FA] dark:hover:bg-[#0B1120] transition-colors border border-[#E8E8E8] dark:border-[#1E293B]"
          >
            {t("pi.cancel")}
          </button>
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              canContinue
                ? "btn-gradient shadow-sm"
                : "bg-[#E8E8E8] dark:bg-[#1E293B] text-[#B0B8C4] dark:text-[#4B5563] cursor-not-allowed"
            }`}
          >
            {t("pi.continue")}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="mt-4 text-xs text-muted dark:text-muted-dark text-center">
        {t("pi.privacy")}
      </p>
    </div>
  );
}

export function StageIndicator({ current }: { current: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((stage, i) => {
        const Icon = stage.icon;
        const isActive = i === current;
        const isDone = i < current;
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                  isActive
                    ? "bg-primary-hover text-white shadow-sm"
                    : isDone
                    ? "bg-[#E6F7FF] dark:bg-primary/20 text-primary-ink dark:text-primary-soft"
                    : "bg-[#F5F7FA] dark:bg-[#1E2A3B] text-muted dark:text-hint-dark"
                }`}
              >
                <Icon size={15} />
              </div>
              <span
                className={`hidden sm:block text-[10px] mt-1 font-semibold ${
                  isActive
                    ? "text-primary-ink dark:text-primary-soft"
                    : isDone
                    ? "text-muted dark:text-muted-dark"
                    : "text-muted dark:text-hint-dark"
                }`}
              >
                {t(stage.label)}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={`w-8 sm:w-16 h-px mx-1 transition-colors ${
                  isDone ? "bg-primary/30" : "bg-[#E8E8E8] dark:bg-[#1E293B]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
