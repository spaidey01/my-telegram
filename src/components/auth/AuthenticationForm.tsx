"use client";

import { useState } from "react";
import SignInForm from "./SignInForm";
import SignUpForm from "./SignUpForm";
import Button from "../modules/ui/Button";

const AuthenticationForm = () => {
  const [isLogging, setIsLogging] = useState(true);

  return (
    <section className="relative flex-center size-full h-dvh overflow-hidden bg-[radial-gradient(circle_at_50%_18%,rgba(37,99,235,.20),transparent_34%),linear-gradient(145deg,#070b16_0%,#0b1020_48%,#080b14_100%)] px-4 text-white">
      <div className="pointer-events-none absolute -left-28 top-1/4 size-72 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-1/4 size-80 rounded-full bg-blue-600/10 blur-3xl" />

      <div className="relative flex w-full max-w-[400px] flex-col items-center text-white">
        <div className="group relative mb-3 flex size-[104px] items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-sky-400/15 blur-2xl animate-pulse" />
          <div className="absolute inset-1 rounded-full border border-sky-300/20 animate-[spin_14s_linear_infinite]" />
          <div className="absolute inset-3 rounded-full border border-blue-400/20 border-dashed animate-[spin_10s_linear_infinite_reverse]" />
          <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-sky-400/20 to-blue-600/20 opacity-70 blur-md transition-opacity duration-500 group-hover:opacity-100" />
          <img
            src="/images/stargram-logo.svg"
            alt="Stargram"
            className="relative z-10 size-[82px] drop-shadow-[0_0_28px_rgba(56,189,248,.35)] transition-transform duration-500 group-hover:scale-105"
          />
        </div>

        <div className="animate-[fadeIn_.7s_ease-out] text-center">
          <h1 className="font-vazirBold text-3xl font-bold tracking-tight sm:text-4xl">
            Welcome to Stargram
          </h1>
          <p className="mt-2 px-4 text-sm leading-6 text-white/55">
            a place made with love
          </p>
        </div>

        <div className="mt-7 w-full rounded-[28px] border border-white/10 bg-white/[.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-6">
          <h2 className="text-center font-vazirBold text-xl">
            {isLogging ? "ورود به Stargram" : "ساخت حساب Stargram"}
          </h2>

          <p className="mt-2 px-2 text-center text-sm text-white/45">
            {isLogging
              ? "لطفاً شماره تلفن و رمز عبورت رو وارد کن."
              : "اطلاعاتت رو وارد کن تا حسابت ساخته بشه."}
          </p>

          <div className="mt-4">
            {isLogging ? <SignInForm /> : <SignUpForm />}
          </div>

          <div className="mt-4 w-full text-center text-sm text-white/70">
            {isLogging ? "حساب نداری؟ " : "قبلاً حساب ساختی؟"}
            <Button
              variant="ghost"
              color="info"
              size="xs"
              classNames="ml-1"
              onClick={() => setIsLogging((prev) => !prev)}
            >
              {isLogging ? "ثبت‌نام" : "ورود"}
            </Button>
          </div>
        </div>

        <footer className="mt-6 text-center">
          <p className="text-xs tracking-wide text-white/40">
            Crafted with <span className="text-sky-300">♥</span> by{" "}
            <span className="font-semibold text-white/70">Spidey</span>
          </p>
          <a
            href="https://t.me/bedboy_op"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[11px] text-sky-300/65 transition-colors hover:text-sky-200"
          >
            Telegram · @bedboy_op
          </a>
        </footer>
      </div>
    </section>
  );
};

export default AuthenticationForm;
