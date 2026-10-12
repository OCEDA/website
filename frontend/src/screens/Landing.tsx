import { NavProps } from "../App";
import {
  ClipboardList, Camera, ScanEye, BrainCircuit,
  ArrowRight, ShieldCheck, Stethoscope,
  LayoutDashboard, Images, Smartphone,
} from "lucide-react";

const WHY = [
  { icon: Stethoscope, title: "Built for GPs", text: "A guided flow for general practitioners and non-ENT healthcare workers." },
  { icon: BrainCircuit, title: "Transparent AI", text: "Findings and confidence are shown exactly as the model returns them." },
  { icon: ShieldCheck, title: "Decision support", text: "Assists your judgment. It never replaces clinical decision-making." },
];

const FEATURES = [
  { icon: ClipboardList, title: "Patient records", text: "Capture patient ID, date of birth, ear side, and clinical notes up front." },
  { icon: Camera, title: "Device capture", text: "Receive frames from the Arducam IMX219 on the Raspberry Pi Zero W otoendoscope." },
  { icon: Images, title: "Frame review", text: "Compare captured images side by side and pick the clearest one." },
  { icon: ScanEye, title: "AI findings", text: "Normal or abnormal result with a real attention heatmap from the model." },
  { icon: LayoutDashboard, title: "Dashboard overview", text: "Recent examinations and device status in one place." },
  { icon: Smartphone, title: "Works everywhere", text: "Responsive from phone to desktop, with a dark mode for dim rooms." },
];

const STEPS = [
  { title: "Patient Info", text: "Record the patient and ear side." },
  { title: "Capture", text: "Frames arrive from the otoendoscope." },
  { title: "Review", text: "Select the clearest frame for analysis." },
  { title: "AI Result", text: "See the finding and confidence." },
];

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export default function Landing({ goTo }: NavProps) {
  const card =
    "rounded-2xl card-gradient card-lift border border-[#E8E8E8] dark:border-[#1E293B] p-5 shadow-sm";
  const iconBox =
    "w-10 h-10 rounded-xl bg-[#E6F7FF] dark:bg-primary/10 text-primary-ink dark:text-primary-soft flex items-center justify-center";
  const eyebrow =
    "text-[10px] font-bold tracking-widest uppercase text-coral-ink dark:text-coral-soft block mb-1";
  const h2 = "text-2xl sm:text-3xl font-extrabold text-[#1F1F1F] dark:text-white font-display";

  return (
    <div className="min-h-screen ambient bg-[#F5F7FA] dark:bg-[#0B1120] theme-transition">
      <header className="sticky top-0 z-20 flex items-center gap-2 min-h-14 pt-[env(safe-area-inset-top)] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] sm:px-8 bg-white/90 dark:bg-[#111827]/90 backdrop-blur border-b border-[#E8E8E8] dark:border-[#1E293B]">
        <div className="flex items-center gap-0.5">
          <span className="font-display font-extrabold text-xl text-primary dark:text-primary-soft leading-none">OCEDA</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent ml-0.5 mb-0.5 dot-pulse" />
        </div>
        <div className="flex-1" />
        <nav className="hidden sm:flex items-center gap-1 mr-2">
          {[
            ["why", "Why OCEDA"],
            ["features", "Features"],
            ["steps", "How it works"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="px-3 py-2 rounded-xl text-sm font-medium text-muted dark:text-muted-dark hover:text-primary-ink dark:hover:text-primary-soft hover:bg-[#E6F7FF] dark:hover:bg-primary/10 transition-colors cursor-pointer"
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => goTo("login")}
          className="px-5 py-2 rounded-xl btn-gradient text-sm font-semibold cursor-pointer"
        >
          Login
        </button>
      </header>

      <main className="max-w-[1080px] mx-auto px-5 sm:px-8 pb-10">
        {/* Hero */}
        <section className="grid lg:grid-cols-2 gap-10 items-center py-10 sm:py-16 stagger">
          <div>
            <div className="accent-rule mb-6" />
            <span className={`${eyebrow} mb-2`}>AI-assisted otoendoscopy</span>
            <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight text-[#1F1F1F] dark:text-white font-display">
              Examine ears with clarity and confidence.
            </h1>
            <p className="text-base text-muted dark:text-muted-dark mt-4 max-w-[480px]">
              OCEDA guides you from patient details to an AI-supported finding, so ear examinations are
              confident even outside an ENT clinic.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-7">
              <button
                onClick={() => goTo("login")}
                className="flex items-center gap-2 px-6 py-3 rounded-xl btn-gradient text-sm font-semibold cursor-pointer"
              >
                Get started <ArrowRight size={16} />
              </button>
              <button
                onClick={() => scrollTo("features")}
                className="px-6 py-3 rounded-xl border border-[#E8E8E8] dark:border-[#1E293B] bg-white dark:bg-[#1E2A3B] text-sm font-semibold text-[#1F1F1F] dark:text-[#F1F5F9] hover:border-primary transition-colors cursor-pointer"
              >
                See features
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { src: "/ear-normal.jpeg", label: "Capture" },
              { src: "/ear-normal-heatmap.jpeg", label: "AI heatmap" },
            ].map((img, i) => (
              <div
                key={img.src}
                className={`img-zoom float-slow ${i ? "delay" : ""} rounded-2xl overflow-hidden bg-medical-bg border border-[#E8E8E8] dark:border-[#1E293B] shadow-sm`}
              >
                <img src={img.src} alt={img.label} className="w-full aspect-square object-cover" />
                <div className="px-3 py-2 bg-white dark:bg-[#1E2A3B] text-xs font-semibold text-muted dark:text-muted-dark">
                  {img.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Why */}
        <section id="why" className="py-10 scroll-mt-20 scroll-reveal">
          <span className={eyebrow}>Why OCEDA</span>
          <h2 className={`${h2} mb-6`}>Confident exams, without the guesswork</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {WHY.map((w) => (
              <div key={w.title} className={card}>
                <span className={`${iconBox} mb-4`}><w.icon size={20} /></span>
                <h3 className="text-base font-bold text-[#1F1F1F] dark:text-white font-display">{w.title}</h3>
                <p className="text-sm text-muted dark:text-muted-dark mt-1">{w.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-10 scroll-mt-20 scroll-reveal">
          <span className={eyebrow}>Features</span>
          <h2 className={`${h2} mb-2`}>Everything for one examination</h2>
          <p className="text-sm text-muted dark:text-muted-dark mb-6 max-w-[520px]">
            From the first patient detail to the final AI result, each step lives in one guided flow.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FEATURES.map((f) => (
              <div key={f.title} className={card}>
                <span className={`${iconBox} mb-4`}><f.icon size={20} /></span>
                <h3 className="text-sm font-bold text-[#1F1F1F] dark:text-white">{f.title}</h3>
                <p className="text-sm text-muted dark:text-muted-dark mt-1">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Steps */}
        <section id="steps" className="py-10 scroll-mt-20 scroll-reveal">
          <span className={eyebrow}>How it works</span>
          <h2 className={`${h2} mb-6`}>Ready to begin?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className={card}>
                <span className="w-10 h-10 rounded-full bg-accent/15 text-coral-ink dark:text-coral-soft border border-accent/40 flex items-center justify-center text-sm font-extrabold font-display mb-4">
                  {i + 1}
                </span>
                <h3 className="text-sm font-bold text-[#1F1F1F] dark:text-white">{s.title}</h3>
                <p className="text-sm text-muted dark:text-muted-dark mt-1">{s.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <button
              onClick={() => goTo("login")}
              className="flex items-center gap-2 px-6 py-3 rounded-xl btn-gradient text-sm font-semibold cursor-pointer"
            >
              Start an examination <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E8E8E8] dark:border-[#1E293B] px-5 py-6 text-center text-xs text-muted dark:text-muted-dark">
        © 2026 OCEDA 
      </footer>
    </div>
  );
}
