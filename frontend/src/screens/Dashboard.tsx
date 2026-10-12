import { useEffect, useState } from "react";
import { NavProps } from "../App";
import * as api from "../api";
import type { ApiExam } from "../api";
import { useI18n, TKey } from "../i18n";
import {
  ArrowRight, ClipboardList, Camera, ScanEye, BrainCircuit,
  Wifi, Battery, Monitor, ChevronRight, Activity, CheckCircle2,
  AlertCircle, Clock,
} from "lucide-react";

type Session = {
  id: string; patientId: string; created: Date; exam: ApiExam;
  ear: "Left" | "Right"; classification: "Normal" | "Abnormal"; confidence: number;
};

// show only the tail of the patient id on the dashboard (PT-260618-427 -> PT-****-427)
const maskPatientId = (id: string) => `PT-****-${id.slice(-3)}`;

function toSession(e: ApiExam): Session | null {
  if (!e.result) return null;
  return {
    id: e.id, patientId: maskPatientId(e.patient.id), created: new Date(e.created_at), exam: e,
    ear: e.patient.ear, classification: e.result.classification as Session["classification"],
    confidence: e.result.confidence,
  };
}

const WORKFLOW_STEPS: { icon: typeof Camera; label: TKey; desc: TKey }[] = [
  { icon: ClipboardList, label: "wf.patient", desc: "wf.patientDesc" },
  { icon: Camera, label: "wf.capture", desc: "wf.captureDesc" },
  { icon: ScanEye, label: "wf.review", desc: "wf.reviewDesc" },
  { icon: BrainCircuit, label: "wf.ai", desc: "wf.aiDesc" },
];

function greetingKey(): TKey {
  const h = new Date().getHours();
  if (h < 12) return "dash.morning";
  if (h < 17) return "dash.afternoon";
  return "dash.evening";
}

export default function Dashboard({ goTo, user, device, setExam, setPatient }: NavProps) {
  const { t, lang } = useI18n();
  const [exams, setExams] = useState<ApiExam[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.listExams()
      .then((r) => { if (live) setExams(r); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, []);

  const sessions = (exams ?? []).map(toSession).filter((s): s is Session => s !== null);
  const locale = lang === "id" ? "id-ID" : "en-US";
  const stamp = (s: Session) => {
    const time = s.created.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(s.created).setHours(0, 0, 0, 0)) / 86400000);
    const day = days === 0 ? t("when.today") : days === 1 ? t("when.yesterday")
      : s.created.toLocaleDateString(locale, { day: "numeric", month: "short" });
    return `${day}, ${time}`;
  };
  const todayCount = sessions.filter((s) => s.created.toDateString() === new Date().toDateString()).length;
  const normalCount = sessions.filter((s) => s.classification === "Normal").length;
  const abnormalCount = sessions.filter((s) => s.classification === "Abnormal").length;
  const openAnalysis = (e: ApiExam) => {
    setExam(e);
    setPatient({ id: e.patient.id, name: e.patient.name, dob: e.patient.dob ?? "", ear: e.patient.ear, notes: e.patient.notes ?? "" });
    goTo("ai-result");
  };

  return (
    <div className="max-w-[1200px] mx-auto px-5 sm:px-6 py-6 sm:py-8 stagger">
      {/* Coral accent top rule */}
      <div className="accent-rule mb-6" />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left column (60%) ── */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {/* Greeting + CTA */}
          <div className="rounded-2xl card-gradient card-lift border border-[#E8E8E8] dark:border-[#1E293B] p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-coral-ink dark:text-coral-soft font-semibold tracking-wide uppercase mb-1">
                  {t(greetingKey())}
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1F1F1F] dark:text-white font-display leading-tight">
                  {user?.name ?? ""}
                </h1>
                <p className="mt-1.5 text-sm text-muted dark:text-muted-dark">
                  {new Date().toLocaleDateString(lang === "id" ? "id-ID" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                </p>
              </div>
              {/* Decorative accent mark */}
              <div className="shrink-0 w-12 h-12 rounded-2xl bg-[#E6F7FF] dark:bg-primary/10 flex items-center justify-center">
                <Activity size={22} className="text-primary-ink dark:text-primary-soft" />
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-[#E8E8E8] dark:border-[#1E293B]">
              <button
                onClick={() => goTo("patient-info")}
                className="inline-flex items-center gap-2.5 px-6 py-3.5 btn-gradient font-semibold rounded-xl transition-colors shadow-sm text-sm"
              >
                <span>{t("dash.startNew")}</span>
                <ArrowRight size={16} />
              </button>
              <p className="mt-3 text-xs text-muted dark:text-muted-dark">
                {t("dash.startNewHint")}
              </p>
            </div>
          </div>

          {/* Workflow visualization */}
          <div className="rounded-2xl card-gradient card-lift border border-[#E8E8E8] dark:border-[#1E293B] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft">
                {t("dash.workflow")}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              {WORKFLOW_STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="flex sm:flex-col gap-3 sm:gap-2 flex-1 items-start sm:items-center">
                    <div className="flex sm:flex-col items-center gap-2 sm:gap-0 w-full sm:text-center">
                      <div className="flex items-center gap-2 sm:flex-col sm:gap-2">
                        <div className="w-9 h-9 rounded-xl bg-[#E6F7FF] dark:bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon size={17} className="text-primary-ink dark:text-primary-soft" />
                        </div>
                        {i < WORKFLOW_STEPS.length - 1 && (
                          <div className="hidden sm:block w-full h-px bg-[#E8E8E8] dark:bg-[#1E293B] mt-4" />
                        )}
                      </div>
                      <div className="sm:mt-2">
                        <p className="text-xs font-semibold text-[#1F1F1F] dark:text-white font-display">
                          {i + 1}. {t(step.label)}
                        </p>
                        <p className="text-[11px] text-muted dark:text-muted-dark mt-0.5 hidden sm:block">
                          {t(step.desc)}
                        </p>
                      </div>
                    </div>
                    {i < WORKFLOW_STEPS.length - 1 && (
                      <ChevronRight size={14} className="text-[#6B7280] dark:text-[#334155] shrink-0 sm:hidden mt-2" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Sessions */}
          <div className="rounded-2xl card-gradient card-lift border border-[#E8E8E8] dark:border-[#1E293B] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8E8E8] dark:border-[#1E293B]">
              <div>
                <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-0.5">
                  {t("dash.recent")}
                </span>
                <h3 className="text-base font-bold text-[#1F1F1F] dark:text-white font-display">
                  {t("dash.history")}
                </h3>
              </div>
              <Clock size={16} className="text-muted dark:text-muted-dark" />
            </div>

            {/* Mobile: cards */}
            <div className="sm:hidden divide-y divide-[#E8E8E8] dark:divide-[#1E293B]">
              {sessions.map((s) => (
                <div key={s.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ClassificationBadge classification={s.classification} />
                      <span className="text-xs font-mono text-muted dark:text-muted-dark">{s.patientId}</span>
                    </div>
                    <span className="text-xs text-muted dark:text-muted-dark">{stamp(s)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted dark:text-muted-dark">
                      {t("dash.earConf", { ear: t(`ear.${s.ear}`), n: s.confidence.toFixed(1) })}
                    </span>
                    <button onClick={() => openAnalysis(s.exam)} className="text-xs text-primary-ink dark:text-primary-soft font-medium hover:underline">
                      {t("dash.viewAnalysis")}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#E8E8E8] dark:border-[#1E293B]">
                    {(["th.patientId", "th.dateTime", "th.ear", "th.classification", "th.confidence", ""] as const).map((h) => (
                      <th
                        key={h || "action"}
                        className="px-5 py-3 text-left text-[11px] font-semibold text-muted dark:text-muted-dark uppercase tracking-wide"
                      >
                        {h && t(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#1E293B]">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-[#F5F7FA] dark:hover:bg-[#1A2332] transition-colors">
                      <td className="px-5 py-3.5">
                        <span className="text-sm font-mono text-muted dark:text-muted-dark">{s.patientId}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm text-[#1F1F1F] dark:text-[#E2E8F0]">{stamp(s)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm text-[#1F1F1F] dark:text-[#E2E8F0]">{t(`ear.${s.ear}`)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <ClassificationBadge classification={s.classification} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[#E8E8E8] dark:bg-[#334155] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full bar-grow ${s.classification === "Normal" ? "bg-emerald-500" : "bg-accent"}`}
                              style={{ width: `${s.confidence}%` }}
                            />
                          </div>
                          <span className="text-sm text-[#1F1F1F] dark:text-[#E2E8F0]">{s.confidence.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button onClick={() => openAnalysis(s.exam)} className="text-xs font-semibold text-primary-ink dark:text-primary-soft hover:text-primary-hover transition-colors">
                          {t("dash.viewAnalysis")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(loadFailed || (exams && sessions.length === 0)) && (
              <p className="px-6 py-8 text-sm text-center text-muted dark:text-muted-dark">
                {loadFailed ? t("dash.loadError") : t("dash.empty")}
              </p>
            )}
          </div>
        </div>

        {/* ── Right column (40%) ── */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Device Diagnostics */}
          <div className="rounded-2xl card-gradient card-lift border border-[#E8E8E8] dark:border-[#1E293B] p-5 shadow-sm">
            <div className="mb-4">
              <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-0.5">
                {t("dash.hardware")}
              </span>
              <h3 className="text-base font-bold text-[#1F1F1F] dark:text-white font-display">
                {t("dash.diagnostics")}
              </h3>
            </div>

            <div className="space-y-3">
              <DiagRow
                icon={<Wifi size={15} />}
                label={device.name ?? "OCEDA device"}
                value={device.connected ? t("dash.connected") : t("device.disconnected")}
                status={device.connected ? "ok" : "warn"}
              />
              <DiagRow
                icon={<Battery size={15} />}
                label={t("dash.battery")}
                value={device.battery != null ? `${device.battery}%` : "—"}
                status="ok"
                extra={
                  device.battery != null ? (
                    <div className="w-full h-1.5 bg-[#E8E8E8] dark:bg-[#334155] rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-emerald-500 rounded-full bar-grow" style={{ width: `${device.battery}%` }} />
                    </div>
                  ) : undefined
                }
              />
              <DiagRow
                icon={<Monitor size={15} />}
                label={t("dash.cameraRes")}
                value={device.resolution ? device.resolution.replace("x", "×") : "—"}
                status="ok"
              />
            </div>

            <div className="mt-4 pt-4 border-t border-[#E8E8E8] dark:border-[#1E293B] flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${device.connected ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
              <span className="text-xs text-muted dark:text-muted-dark">
                {device.connected ? t("dash.deviceReady") : t("device.disconnected")}
              </span>
            </div>
          </div>

          {/* Quick stats */}
          <div className="rounded-2xl card-gradient card-lift border border-[#E8E8E8] dark:border-[#1E293B] p-5 shadow-sm">
            <div className="mb-4">
              <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-0.5">
                {t("dash.summary")}
              </span>
              <h3 className="text-base font-bold text-[#1F1F1F] dark:text-white font-display">
                {t("dash.glance")}
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatCard label={t("dash.statToday")} value={todayCount} unit={t("dash.unitExam")} />
              <StatCard label={t("dash.statNormal")} value={normalCount} unit={t("dash.unitResult")} accent="green" />
              <StatCard label={t("dash.statAbnormal")} value={abnormalCount} unit={t("dash.unitResult")} accent="coral" />
            </div>

            <div className="mt-4 p-3 rounded-xl bg-[#E6F7FF] dark:bg-primary/10 border border-primary/10">
              <p className="text-xs font-medium text-primary-ink dark:text-primary-soft leading-relaxed">
                {t("dash.assistive")}
              </p>
            </div>
          </div>

          {/* Start exam CTA (secondary, right column) */}
          <button
            onClick={() => goTo("patient-info")}
            className="w-full rounded-2xl bg-primary/5 dark:bg-primary/10 border border-primary/20 hover:border-primary/40 hover:bg-primary/10 dark:hover:bg-primary/20 transition-all p-5 text-left group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-primary-ink dark:text-primary-soft uppercase tracking-wide">
                {t("dash.beginExam")}
              </span>
              <ArrowRight size={16} className="text-primary-ink dark:text-primary-soft group-hover:translate-x-0.5 transition-transform" />
            </div>
            <p className="text-sm text-muted dark:text-muted-dark">
              {t("dash.beginExamDesc")}
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}

function ClassificationBadge({ classification }: { classification: "Normal" | "Abnormal" }) {
  const { t } = useI18n();
  const isNormal = classification === "Normal";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        isNormal
          ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-400"
          : "bg-[#FFF1F1] text-coral-ink dark:text-coral-soft dark:bg-accent/10 dark:text-coral-soft"
      }`}
    >
      {isNormal ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
      {t(`cls.${classification}`)}
    </span>
  );
}

function DiagRow({
  icon,
  label,
  value,
  status,
  extra,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "ok" | "warn" | "error";
  extra?: React.ReactNode;
}) {
  const statusColor =
    status === "ok"
      ? "text-emerald-900 dark:text-emerald-400"
      : status === "warn"
      ? "text-yellow-900 dark:text-yellow-400"
      : "text-coral-ink dark:text-coral-soft";

  return (
    <div className="p-3 rounded-xl bg-[#F5F7FA] dark:bg-[#0B1120] border border-[#E8E8E8] dark:border-[#1E293B]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted dark:text-muted-dark">
          {icon}
          <span className="text-xs font-medium text-[#1F1F1F] dark:text-[#E2E8F0]">{label}</span>
        </div>
        <span className={`text-xs font-semibold ${statusColor}`}>{value}</span>
      </div>
      {extra}
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: "green" | "coral";
}) {
  const valColor =
    accent === "green"
      ? "text-emerald-900 dark:text-emerald-400"
      : accent === "coral"
      ? "text-coral-ink dark:text-coral-soft"
      : "text-primary-ink dark:text-primary-soft";

  return (
    <div className="rounded-xl bg-[#F5F7FA] dark:bg-[#0B1120] border border-[#E8E8E8] dark:border-[#1E293B] p-3 text-center">
      <div className={`text-2xl font-extrabold font-display ${valColor}`}>{value}</div>
      <div className="text-[10px] text-muted dark:text-muted-dark mt-0.5 leading-tight">
        {label}
        <br />
        {unit}
      </div>
    </div>
  );
}
