import { useState, useEffect } from "react";
import { NavProps } from "../App";
import * as api from "../api";
import type { ApiCapture, ApiExam } from "../api";
import { StageIndicator } from "./PatientInfo";
import { useI18n } from "../i18n";
import {
  ChevronLeft, ChevronRight, CheckCircle2, Scan,
  Wifi, AlertTriangle, RotateCcw, Ear, ZapOff,
  Camera, Monitor,
} from "lucide-react";

type CaptureStage = "ready" | "received" | "selected" | "error";

function PatientContextBar({ patient }: { patient: NonNullable<NavProps["patient"]> }) {
  const { t } = useI18n();
  return (
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
  );
}

export default function Capture({ goTo, patient, exam, setExam, device }: NavProps) {
  const { t } = useI18n();
  const capLabel = (i: number) => t("cap.label", { n: i + 1 });
  const [captures, setCaptures] = useState<ApiCapture[]>([]);
  const [viewId, setViewId] = useState<string | null>(null); // null = follow the newest frame
  const [selectedId, setSelectedId] = useState<string | null>(exam?.selected_capture_id ?? null);
  const [connFailed, setConnFailed] = useState(false);
  const [selectFailed, setSelectFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const examId = exam?.id;

  // Live feed: the backend pushes a snapshot, then one event per frame the device uploads.
  useEffect(() => {
    if (!examId) return;
    setConnFailed(false);
    const es = new EventSource(api.eventsUrl(examId));
    es.onopen = () => setConnFailed(false);
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) setConnFailed(true); };
    es.addEventListener("snapshot", (e) => {
      const ex = JSON.parse((e as MessageEvent).data) as ApiExam;
      setCaptures(ex.captures ?? []);
      setSelectedId(ex.selected_capture_id);
      setViewId(ex.selected_capture_id); // coming back from the result screen: resume on the chosen frame
    });
    es.addEventListener("capture", (e) => {
      const c = JSON.parse((e as MessageEvent).data) as ApiCapture;
      setCaptures((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
    });
    es.addEventListener("selected", (e) => {
      setSelectedId((JSON.parse((e as MessageEvent).data) as { capture_id: string }).capture_id);
    });
    return () => es.close();
  }, [examId, retryKey]);

  const idxOf = (id: string | null) => (id ? captures.findIndex((c) => c.id === id) : -1);
  const captureIdx = Math.max(0, idxOf(viewId) >= 0 ? idxOf(viewId) : captures.length - 1);
  const shown: ApiCapture | undefined = captures[captureIdx];
  const selectedIdx = idxOf(selectedId) >= 0 ? idxOf(selectedId) : null;
  const setCaptureIdx = (i: number) => setViewId(captures[i]?.id ?? null);
  // heuristic hint only (sharpness + exposure): the doctor makes the call
  const recommendedId = captures.length
    ? captures.reduce((best, c) => (c.quality.score > best.quality.score ? c : best)).id
    : null;

  const stage: CaptureStage = connFailed ? "error" : captures.length === 0 ? "ready" : selectedIdx !== null ? "selected" : "received";
  const stageStep = selectedIdx !== null ? 2 : 1; // 1=Capture, 2=Review
  const currentStage = stageStep === 1 ? 1 : 2; // index for StageIndicator

  const handleChoose = async () => {
    if (!exam || !shown) return;
    setSelectFailed(false);
    try {
      await api.selectCapture(exam.id, shown.id);
      setSelectedId(shown.id);
      setExam({ ...exam, selected_capture_id: shown.id });
    } catch {
      setSelectFailed(true);
    }
  };

  const handleAnalyze = () => goTo("ai-result", exam?.id);
  const handleRetry = () => setRetryKey((k) => k + 1);

  const prev = () => setCaptureIdx(Math.max(0, captureIdx - 1));
  const next = () => setCaptureIdx(Math.min(captures.length - 1, captureIdx + 1));

  if (!patient || !exam) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20 text-center px-4">
        <AlertTriangle size={32} className="text-coral-ink dark:text-coral-soft" />
        <p className="text-muted dark:text-muted-dark text-sm">
          {t("cap.noPatient")}
        </p>
        <button
          onClick={() => goTo("patient-info")}
          className="px-4 py-2 bg-primary-hover text-white rounded-xl text-sm font-medium"
        >
          {t("cap.goPatient")}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-5 sm:px-6 py-6 sm:py-8 stagger">
      <div className="accent-rule mb-6" />

      <StageIndicator current={currentStage} />

      <div className="mt-6 mb-5">
        <span className="text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-1">
          {t("cap.stageTitle", { n: currentStage + 1, name: stageStep === 1 ? t("stage.capture") : t("stage.review") })}
        </span>
        <h2 className="text-2xl font-extrabold text-[#1F1F1F] dark:text-white font-display">
          {stageStep === 1 ? t("cap.titleCapture") : t("cap.titleReview")}
        </h2>
        <p className="text-sm text-muted dark:text-muted-dark mt-1">
          {stageStep === 1
            ? t("cap.subCapture")
            : t("cap.subReview")}
        </p>
      </div>

      <PatientContextBar patient={patient} />

      {/* ── State A: Ready ── */}
      {stage === "ready" && (
        <div className="rounded-2xl card-gradient border border-[#E8E8E8] dark:border-[#1E293B] shadow-sm overflow-hidden">
          {/* Device status bar */}
          <div className="flex items-center gap-2 px-5 py-3 bg-[#F5F7FA] dark:bg-[#0B1120] border-b border-[#E8E8E8] dark:border-[#1E293B]">
            <span className={`w-2 h-2 rounded-full ${device.connected ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
            <span className={`text-xs font-semibold ${device.connected ? "text-green-900 dark:text-green-400" : "text-muted dark:text-muted-dark"}`}>
              {device.connected ? t("cap.deviceConnected") : t("device.disconnected")}
            </span>
            {device.resolution && (
              <span className="ml-auto flex items-center gap-1 text-xs text-muted dark:text-muted-dark">
                <Monitor size={12} /> {device.resolution.replace("x", "×")}
              </span>
            )}
          </div>

          {/* Main ready area */}
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <>
                <div className="w-16 h-16 rounded-2xl bg-[#E6F7FF] dark:bg-primary/10 flex items-center justify-center mb-5 animate-oceda-pulse">
                  <Camera size={28} className="text-primary-ink dark:text-primary-soft" />
                </div>
                <p className="text-base font-bold text-[#1F1F1F] dark:text-white font-display mb-2">
                  {t("cap.awaiting")}
                </p>
                <p className="text-sm text-muted dark:text-muted-dark max-w-sm mb-6">
                  {t("cap.awaitingDesc")}
                </p>
                <div className="flex flex-col gap-3 items-start mb-8">
                  <DeviceStep n={1} text={t("cap.step1")} />
                  <DeviceStep n={2} text={t("cap.step2")} />
                  <DeviceStep n={3} text={t("cap.step3")} />
                </div>
            </>
          </div>
        </div>
      )}

      {/* ── State B/C: Image received / selected ── */}
      {(stage === "received" || stage === "selected") && shown && (
        <div className="rounded-2xl card-gradient border border-[stage === 'selected' ? 'primary' : '#E8E8E8'] dark:border-[#1E293B] shadow-sm overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center gap-3 px-5 py-3 bg-[#F5F7FA] dark:bg-[#0B1120] border-b border-[#E8E8E8] dark:border-[#1E293B]">
            <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F5F9]">
              {t("cap.of", { label: capLabel(captureIdx), total: captures.length })}
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              <Ear size={13} className="text-coral-ink dark:text-coral-soft" />
              <span className="text-xs text-muted dark:text-muted-dark">{t("earLabel", { ear: t(`ear.${patient.ear}`) })}</span>
              <span className="mx-1.5 text-[#E8E8E8] dark:text-[#1E293B]">·</span>
              <Monitor size={12} className="text-muted dark:text-muted-dark" />
              <span className="text-xs text-muted dark:text-muted-dark">
                {shown.width}×{shown.height}
              </span>
              <span className="mx-1.5 text-[#E8E8E8] dark:text-[#1E293B]">·</span>
              <Wifi size={12} className={device.connected ? "text-green-900" : "text-muted dark:text-muted-dark"} />
              <span className={`text-xs ${device.connected ? "text-green-900 dark:text-green-400" : "text-muted dark:text-muted-dark"}`}>
                {device.connected ? t("cap.connected") : t("device.disconnected")}
              </span>
            </div>
          </div>

          {/* Medical image viewer */}
          <div className="relative bg-medical-bg flex items-center justify-center" style={{ minHeight: 340 }}>
            {stage === "selected" && captureIdx === selectedIdx && (
              <div className="absolute inset-0 rounded-b-none pointer-events-none capture-selected z-10" />
            )}
            <img
              src={api.mediaUrl(shown.url)}
              alt={t("cap.alt", { n: captureIdx + 1, ear: t(`ear.${patient.ear}`) })}
              className="w-full object-contain"
              style={{ maxHeight: 420 }}
            />

            {/* Navigation arrows */}
            <button
              onClick={prev}
              disabled={captureIdx === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center disabled:opacity-30 transition-all"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={next}
              disabled={captureIdx === captures.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center disabled:opacity-30 transition-all"
            >
              <ChevronRight size={20} />
            </button>

            {/* Capture dots */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {captures.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => setCaptureIdx(i)}
                  className={`h-2.5 rounded-full transition-[width,background-color,transform] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-125 ${
                    i === captureIdx
                      ? "bg-white w-6"
                      : i === selectedIdx
                      ? "bg-primary"
                      : "bg-white/40"
                  } ${i === captureIdx ? "" : "w-2.5"}`}
                />
              ))}
            </div>

            {/* Selected badge overlay */}
            {stage === "selected" && captureIdx === selectedIdx && (
              <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-primary-hover text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg">
                <CheckCircle2 size={13} />
                {t("cap.selected")}
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div className="px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              {stage === "selected" && selectedIdx !== null ? (
                <p className="text-xs text-primary-ink dark:text-primary-soft font-semibold flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  {t("cap.selectedFor", { label: capLabel(selectedIdx) })}
                </p>
              ) : (
                <p className="text-xs text-muted dark:text-muted-dark">
                  {t("cap.navHint")}
                </p>
              )}
              <p className="text-[11px] text-muted dark:text-muted-dark mt-1">
                {t("cap.quality", { n: Math.round(shown.quality.score) })}
                {shown.id === recommendedId && captures.length > 1 && (
                  <span className="ml-1.5 font-semibold text-primary-ink dark:text-primary-soft">· {t("cap.recommended")}</span>
                )}
              </p>
              {selectFailed && <p role="alert" className="text-[11px] mt-1 text-coral-ink dark:text-coral-soft">{t("cap.selectFailed")}</p>}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => void handleChoose()}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                  stage === "selected" && captureIdx === selectedIdx
                    ? "border-primary/30 text-primary-ink dark:text-primary-soft bg-[#E6F7FF] dark:bg-primary/10"
                    : "border-[#E8E8E8] dark:border-[#1E293B] text-muted dark:text-muted-dark hover:border-primary/40 hover:text-primary-ink dark:hover:text-primary-soft"
                }`}
              >
                {stage === "selected" && captureIdx === selectedIdx ? t("cap.chosen") : t("cap.choose")}
              </button>

              <button
                onClick={handleAnalyze}
                disabled={stage !== "selected" || selectedIdx === null}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  stage === "selected" && selectedIdx !== null
                    ? "btn-gradient shadow-sm"
                    : "bg-[#E8E8E8] dark:bg-[#1E293B] text-[#B0B8C4] dark:text-[#4B5563] cursor-not-allowed"
                }`}
              >
                <Scan size={15} />
                {t("cap.analyze")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── State D: Error ── */}
      {stage === "error" && (
        <div className="rounded-2xl card-gradient border border-accent/30 shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#FFF1F1] dark:bg-accent/10 flex items-center justify-center mb-5">
              <ZapOff size={28} className="text-coral-ink dark:text-coral-soft" />
            </div>
            <p className="text-base font-bold text-[#1F1F1F] dark:text-white font-display mb-2">
              {t("cap.errTitle")}
            </p>
            <p className="text-sm text-muted dark:text-muted-dark max-w-sm mb-6">
              {t("cap.errDesc")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 btn-gradient rounded-xl text-sm font-semibold shadow-sm"
              >
                <RotateCcw size={15} />
                {t("cap.retry")}
              </button>
              <button
                onClick={() => goTo("dashboard")}
                className="px-5 py-2.5 border border-[#E8E8E8] dark:border-[#1E293B] text-muted dark:text-muted-dark rounded-xl text-sm font-medium hover:bg-[#F5F7FA] dark:hover:bg-[#0B1120]"
              >
                {t("cap.backDash")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thumbnail strip (B/C only) */}
      {(stage === "received" || stage === "selected") && (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {captures.map((cap, i) => (
            <button
              key={cap.id}
              onClick={() => setCaptureIdx(i)}
              className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                i === captureIdx
                  ? "border-primary shadow-md"
                  : i === selectedIdx
                  ? "border-accent"
                  : "border-[#E8E8E8] dark:border-[#1E293B] opacity-60 hover:opacity-100"
              }`}
              style={{ width: 80, height: 64 }}
            >
              <img src={api.mediaUrl(cap.url)} alt={capLabel(i)} className="w-full h-full object-cover" />
              {cap.id === recommendedId && captures.length > 1 && (
                <span className="absolute top-0.5 left-0.5 text-[10px] leading-none bg-black/60 text-yellow-300 rounded px-1 py-0.5" title={t("cap.recommended")}>★</span>
              )}
              {i === selectedIdx && (
                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                  <CheckCircle2 size={16} className="text-white" />
                </div>
              )}
              <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white font-medium py-0.5 text-center">
                {capLabel(i)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceStep({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 h-5 rounded-full bg-primary/10 text-primary-ink dark:text-primary-soft text-[10px] font-bold flex items-center justify-center shrink-0">
        {n}
      </span>
      <span className="text-xs text-muted dark:text-muted-dark">{text}</span>
    </div>
  );
}
