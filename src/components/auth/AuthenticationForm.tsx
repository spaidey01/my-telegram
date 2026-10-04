"use client";

import { useState } from "react";
import SignInForm from "./SignInForm";
import SignUpForm from "./SignUpForm";
import Button from "../modules/ui/Button";

const AuthenticationForm = () => {
  const [isLogging, setIsLogging] = useState(true);

  return (
    <section className="bg-leftBarBg flex-center size-full h-dvh overflow-hidden px-4">
      <div className="flex-center transition-all duration-300 flex-col max-w-[380px] w-full text-white">
        <div className="stargram-logo-wrap" aria-label="Stargram">
          <div className="stargram-logo-orbit stargram-logo-orbit-one" />
          <div className="stargram-logo-orbit stargram-logo-orbit-two" />
          <div className="stargram-logo-glow" />
          <img
            src="/images/stargram-logo.svg"
            alt="Stargram"
            className="stargram-logo"
            onError={(event) => {
              event.currentTarget.src = "/images/favicon-96x96.png";
            }}
          />
        </div>

        <div className="text-center mt-1 animate-[fadeIn_.7s_ease-out]">
          <h1 className="font-bold font-vazirBold text-3xl sm:text-4xl">
            به Stargram خوش اومدی ❤️
          </h1>
          <p className="text-gray-400 text-center px-4 text-sm font-vazirLight mt-3 leading-7">
            جایی که با عشق ساخته شده، برای آدم‌هایی که دوستشون داری.
          </p>
        </div>

        <h2 className="font-vazirBold text-xl mt-7">
          {isLogging ? "ورود به Stargram" : "ساخت حساب Stargram"}
        </h2>

        <p className="text-gray-400 text-center px-4 text-sm font-vazirLight mt-2">
          {isLogging
            ? "لطفاً شماره تلفن و رمز عبورت رو وارد کن."
            : "اطلاعاتت رو وارد کن تا حسابت ساخته بشه."}
        </p>

        {isLogging ? <SignInForm /> : <SignUpForm />}

        <div className="text-center w-full mt-4 text-sm text-white/80">
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
    </section>
  );
};

export default AuthenticationForm;
