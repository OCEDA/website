import { useState } from "react";
import { NavProps } from "../App";
import { Mail, Lock, Eye, EyeOff, ArrowLeft, Loader2 } from "lucide-react";
import * as api from "../api";

export default function Login({ goTo, setUser }: NavProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const err: { email?: string; password?: string } = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) err.email = "Enter a valid email address";
    if (!password) err.password = "Password is required";
    setErrors(err);
    if (Object.keys(err).length > 0) return;
    setBusy(true);
    setServerError("");
    try {
      setUser(await api.login(email.trim(), password));
      goTo("dashboard");
    } catch (ex) {
      if (ex instanceof api.ApiError && ex.status === 401) setServerError("Incorrect email or password");
      else if (ex instanceof api.ApiError && ex.status === 0) setServerError("Cannot reach the backend. Is it running on port 8000?");
      else setServerError(`Server error${ex instanceof api.ApiError ? ` (HTTP ${ex.status})` : ""}. Check the backend terminal for details.`);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = (bad?: string) =>
    `w-full pl-10 pr-4 py-3 rounded-xl border text-sm text-[#1F1F1F] dark:text-[#F1F5F9] bg-white dark:bg-[#0B1120] placeholder-[#4F5968] dark:placeholder-[#B4C0D0] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 ${
      bad ? "border-accent" : "border-[#E8E8E8] dark:border-[#1E293B]"
    }`;

  const labelCls =
    "block text-xs font-semibold text-muted dark:text-muted-dark uppercase tracking-wide mb-1.5";

  return (
    <div className="min-h-screen ambient flex flex-col items-center justify-center px-5 py-10 bg-[#F5F7FA] dark:bg-[#0B1120] theme-transition">
      <div className="w-full max-w-[420px] stagger">
        <button
          onClick={() => goTo("landing")}
          className="flex items-center gap-1.5 text-sm font-medium text-muted dark:text-muted-dark hover:text-primary-ink dark:hover:text-primary-soft mb-6 cursor-pointer"
        >
          <ArrowLeft size={14} /> Back
        </button>

        <div className="accent-rule mb-6" />
        <div className="flex items-center gap-0.5 mb-5">
          <span className="font-display font-extrabold text-xl text-primary dark:text-primary-soft leading-none">OCEDA</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent ml-0.5 mb-0.5 dot-pulse" />
        </div>
        <h2 className="text-2xl font-extrabold text-[#1F1F1F] dark:text-white font-display">Welcome back</h2>
        <p className="text-sm text-muted dark:text-muted-dark mt-1 mb-6">
          Sign in to continue your examinations.
        </p>

        <form
          onSubmit={submit}
          noValidate
          className="rounded-2xl card-gradient border border-[#E8E8E8] dark:border-[#1E293B] p-6 shadow-sm"
        >
          <div className="mb-5">
            <label htmlFor="email" className={labelCls}>Email</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted dark:text-muted-dark" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }}
                placeholder="you@clinic.org"
                className={inputCls(errors.email)}
              />
            </div>
            {errors.email && <p className="mt-1 text-xs text-coral-ink dark:text-coral-soft">{errors.email}</p>}
          </div>

          <div className="mb-6">
            <label htmlFor="password" className={labelCls}>Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted dark:text-muted-dark" />
              <input
                id="password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }}
                placeholder="Enter your password"
                className={`${inputCls(errors.password)} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted dark:text-muted-dark hover:text-primary-ink dark:hover:text-primary-soft cursor-pointer"
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {errors.password && <p className="mt-1 text-xs text-coral-ink dark:text-coral-soft">{errors.password}</p>}
          </div>

          {serverError && <p role="alert" className="mb-4 -mt-2 text-xs text-coral-ink dark:text-coral-soft">{serverError}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl btn-gradient text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Sign in
          </button>
        </form>

        <p className="text-xs text-center text-muted dark:text-muted-dark mt-5">
          New here?{" "}
          <button onClick={() => goTo("register")} className="font-semibold text-primary-ink dark:text-primary-soft cursor-pointer">
            Create an account
          </button>
        </p>
        <p className="text-xs text-center text-muted dark:text-muted-dark mt-2">
          Prototype build. Demo account: dr.sari@oceda.local / oceda123
        </p>
      </div>
    </div>
  );
}
