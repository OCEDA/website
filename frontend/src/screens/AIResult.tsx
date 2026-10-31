import { useState, useEffect } from "react";
import { NavProps } from "../App";
import * as api from "../api";
import type { ApiResult } from "../api";
import { StageIndicator } from "./PatientInfo";
import { useI18n } from "../i18n";
import type { TKey } from "../i18n";
import {
  BrainCircuit, CheckCircle2, AlertCircle, Loader2,
  RotateCcw, ArrowLeft, Mail, Info, Ear, Shield,
  ZapOff,
} from "lucide-react";

type AIStage = "processing" | "failure" | "success";

export default function AIResult({ goTo, patient, exam, setExam, user }: NavProps) {
  const { t } = useI18n();
  // Coming from the dashboard / back from captures with the same frame: show the stored result.
  const cached = exam?.result && exam.result.capture_id === exam.selected_capture_id ? exam.result : null;
  const [aiStage, setAIStage] = useState<AIStage>(cached ? "success" : "processing");
  const [result, setResult] = useState<ApiResult | null>(cached);
  const [attempt, setAttempt] = useState(0);
  const examId = exam?.id;
  const captureId = exam?.selected_capture_id;

  useEffect(() => {
    if (!examId || !captureId || cached) return;
    let live = true;
    setAIStage("processing");
    api.analyze(examId, captureId)
      .then((r) => {
        if (!live) return;
        setResult(r);
        setAIStage("success");
        setExam({ ...exam!, status: "analyzed", result: r });
      })
      .catch(() => { if (live) setAIStage("failure"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, captureId, attempt]);

  const handleRetry = () => setAttempt((n) => n + 1);

  if (!patient || !exam || !exam.selected_capture_id) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20 text-center px-4">
        <AlertCircle size={32} className="text-coral-ink dark:text-coral-soft" />
        <p className="text-muted dark:text-muted-dark text-sm">{t("ai.noPatient")}</p>
        <button
          onClick={() => goTo("dashboard")}
          className="px-4 py-2 bg-primary-hover text-white rounded-xl text-sm font-medium"
        >
          {t("ai.backDash")}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[960px] mx-auto px-5 sm:px-6 py-6 sm:py-8 stagger">
      <div className="accent-rule mb-6" />

      <StageIndicator current={3} />

      <div className="mt-6 mb-5">
        <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-1">
          {t("ai.stage")}
        </span>
        <h2 className="text-2xl font-extrabold text-[#1F1F1F] dark:text-white font-display">
          {t("ai.title")}
        </h2>
        <p className="text-sm text-muted dark:text-muted-dark mt-1">
          {t("ai.subtitle")}
        </p>
      </div>

      {/* Patient context */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-[#E6F7FF] dark:bg-primary/10 border border-primary/15 mb-6">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-primary-hover flex items-center justify-center text-white text-xs font-bold font-display shrink-0">
            {patient.name.charAt(0)}
          </span>
          <div>
            <span className="block text-xs font-bold text-[#1F1F1F] dark:text-[#F1F5F9] font-display">
              {patient.name}
            </span>
            <span className="block text-[11px] text-muted dark:text-muted-dark font-mono">
              {patient.id}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Ear size={13} className="text-coral-ink dark:text-coral-soft" />
          <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F5F9]">
            {t("earLabel", { ear: t(`ear.${patient.ear}`) })}
          </span>
        </div>
      </div>

      {/* ── Processing ── */}
      {aiStage === "processing" && (
        <div className="rounded-2xl card-gradient border border-[#E8E8E8] dark:border-[#1E293B] shadow-sm">
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-[#E6F7FF] dark:border-primary/10" />
              <div className="absolute inset-0 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
              <div className="absolute inset-3 rounded-full bg-[#E6F7FF] dark:bg-primary/10 flex items-center justify-center">
                <BrainCircuit size={22} className="text-primary-ink dark:text-primary-soft" />
              </div>
            </div>
            <p className="text-lg font-extrabold text-[#1F1F1F] dark:text-white font-display mb-2">
              {t("ai.analyzing")}
            </p>
            <p className="text-sm text-muted dark:text-muted-dark max-w-xs">
              {t("ai.analyzingDesc")}
            </p>
            <div className="mt-6 flex gap-2 items-center">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary"
                  style={{ animation: `ocedaPulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Failure ── */}
      {aiStage === "failure" && (
        <div className="rounded-2xl card-gradient border border-accent/30 shadow-sm">
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#FFF1F1] dark:bg-accent/10 flex items-center justify-center mb-5">
              <ZapOff size={28} className="text-coral-ink dark:text-coral-soft" />
            </div>
            <p className="text-base font-extrabold text-[#1F1F1F] dark:text-white font-display mb-2">
              {t("ai.failed")}
            </p>
            <p className="text-sm text-muted dark:text-muted-dark max-w-sm mb-6">
              {t("ai.failedDesc")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 btn-gradient rounded-xl text-sm font-semibold shadow-sm"
              >
                <RotateCcw size={15} />
                {t("ai.retry")}
              </button>
              <button
                onClick={() => goTo("capture")}
                className="px-5 py-2.5 border border-[#E8E8E8] dark:border-[#1E293B] text-muted dark:text-muted-dark rounded-xl text-sm font-medium hover:bg-[#F5F7FA] dark:hover:bg-[#0B1120]"
              >
                {t("ai.backCapture")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success ── */}
      {aiStage === "success" && result && (
        <div className="space-y-5">
          {/* Classification banner */}
          <div
            className={`rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 ${
              result.classification === "Normal"
                ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40"
                : "bg-[#FFF1F1] dark:bg-accent/10 border border-accent/25"
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                result.classification === "Normal"
                  ? "bg-emerald-100 dark:bg-emerald-900/40"
                  : "bg-[#FFE4E4] dark:bg-accent/20"
              }`}
            >
              {result.classification === "Normal" ? (
                <CheckCircle2 size={24} className="text-emerald-900 dark:text-emerald-400" />
              ) : (
                <AlertCircle size={24} className="text-coral-ink dark:text-coral-soft" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h3
                  className={`text-2xl font-extrabold font-display ${
                    result.classification === "Normal"
                      ? "text-emerald-900 dark:text-emerald-400"
                      : "text-coral-ink dark:text-coral-soft"
                  }`}
                >
                  {t(`cls.${result.classification}` as TKey)}
                </h3>
                <ConfidencePill confidence={result.confidence} classification={result.classification} />
              </div>
              <p
                className={`text-sm mt-1 ${
                  result.classification === "Normal"
                    ? "text-emerald-900/70 dark:text-emerald-400/70"
                    : "text-coral-ink dark:text-coral-soft/80"
                }`}
              >
                {result.classification === "Normal"
                  ? t("ai.normalMsg")
                  : t("ai.abnormalMsg")}
              </p>
            </div>
          </div>

          {result.mock && (
            <div role="status" className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/40 p-3 flex gap-2 items-start">
              <AlertCircle size={15} className="text-amber-800 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 dark:text-amber-300">{t("ai.mock")}</p>
            </div>
          )}

          {/* Image panels — side by side on desktop, stacked on mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ImagePanel label={t("ai.original")} src={api.mediaUrl(result.original_url)} tag={t("ai.originalTag")} />
            <ImagePanel label={t("ai.heatmap")} src={api.mediaUrl(`${result.heatmap_url}?v=${encodeURIComponent(result.created_at)}`)} tag={t("ai.heatmapTag")} accent />
          </div>

          {/* Disclaimer */}
          <div className="rounded-xl bg-[#F5F7FA] dark:bg-[#0B1120] border border-[#E8E8E8] dark:border-[#1E293B] p-4 flex gap-3">
            <Shield size={16} className="text-muted dark:text-muted-dark shrink-0 mt-0.5" />
            <p className="text-xs text-muted dark:text-muted-dark leading-relaxed">
              <strong className="text-[#1F1F1F] dark:text-[#E2E8F0]">{t("ai.disclaimerTitle")}</strong>{" "}
              {t("ai.disclaimer")}
            </p>
          </div>

          {/* Email confirmation */}
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
              <Mail size={15} className="text-emerald-900 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-400">
                {t("ai.emailTitle")}
              </p>
              <p className="text-xs text-emerald-900/70 dark:text-emerald-400/60 mt-0.5">
                {t("ai.emailDesc", { email: user?.email ?? "" })}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <button
              onClick={() => goTo("capture")}
              className="flex items-center gap-2 px-4 py-2.5 border border-[#E8E8E8] dark:border-[#1E293B] text-muted dark:text-muted-dark rounded-xl text-sm font-medium hover:bg-[#F5F7FA] dark:hover:bg-[#0B1120] transition-colors"
            >
              <ArrowLeft size={15} />
              {t("ai.backCaptures")}
            </button>
            <button
              onClick={() => goTo("dashboard")}
              className="flex items-center gap-2 px-6 py-2.5 btn-gradient rounded-xl text-sm font-semibold shadow-sm transition-colors"
            >
              {t("ai.backDash")}
              <ArrowLeft size={15} className="rotate-180" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function ConfidencePill({
  confidence,
  classification,
}: {
  confidence: number;
  classification: string;
}) {
  const { t } = useI18n();
  const color =
    classification === "Normal"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-400"
      : "bg-[#FFE4E4] text-coral-ink dark:text-coral-soft dark:bg-accent/20 dark:text-coral-soft";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${color}`}>
      <span className="font-mono">{confidence.toFixed(1)}%</span>
      <span className="font-normal text-xs opacity-70">{t("ai.confidence")}</span>
    </span>
  );
}

function ImagePanel({
  label,
  src,
  tag,
  accent,
}: {
  label: string;
  src: string;
  tag: string;
  accent?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl overflow-hidden border border-[#E8E8E8] dark:border-[#1E293B] shadow-sm card-gradient">
      {/* Label bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E8E8] dark:border-[#1E293B] bg-[#F5F7FA] dark:bg-[#0B1120]">
        <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F5F9]">{label}</span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
            accent
              ? "bg-primary/10 text-primary-ink dark:text-primary-soft"
              : "bg-[#E8E8E8] dark:bg-[#334155] text-muted dark:text-muted-dark"
          }`}
        >
          {tag}
        </span>
      </div>
      {/* Image */}
      <div className="bg-medical-bg flex items-center justify-center aspect-square overflow-hidden">
        <img
          src={src}
          alt={label}
          className="w-full h-full object-cover"
        />
      </div>
      {accent && (
        <div className="px-4 py-2.5 bg-[#F5F7FA] dark:bg-[#0B1120] border-t border-[#E8E8E8] dark:border-[#1E293B]">
          <p className="text-[10px] text-muted dark:text-muted-dark flex items-center gap-1">
            <Info size={10} />
            {t("ai.gradcam")}
          </p>
        </div>
      )}
    </div>
  );
}
