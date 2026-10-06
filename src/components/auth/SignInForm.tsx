import useUserStore from "@/stores/userStore";
import { toaster } from "@/utils";
import axios from "axios";
import { SubmitHandler, useForm } from "react-hook-form";
import { useActionState, useTransition, useEffect } from "react";
import Loading from "../modules/ui/Loading";
import Button from "../modules/ui/Button";

type Inputs = {
  phone: number;
  password: string;
  totp?: string;
  recoveryCode?: string;
};

type SignInState =
  | { success: true; data: Record<string, unknown>; message: string }
  | { success: false; error: string }
  | null;

//  Server action for form submission
async function signInAction(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  try {
    const phone = formData.get("phone") as string;
    const password = formData.get("password") as string;
    const totp = formData.get("totp") as string;
    const recoveryCode = formData.get("recoveryCode") as string;

    const response = await axios.post("/api/auth/login", { phone, password, ...(totp ? { totp } : {}), ...(recoveryCode ? { recoveryCode } : {}) });

    if (response.status === 200) {
      return {
        success: true,
        data: response.data as Record<string, unknown>,
        message: "با موفقیت وارد Stargram شدی.",
      };
    }
    return { success: false, error: "Login failed" };
  } catch (error: unknown) {
    const message = axios.isAxiosError(error)
      ? error.response?.data?.message || "Login failed"
      : "Login failed";
    if (axios.isAxiosError(error) && error.response?.data?.requires2FA) return { success: false, error: "TWO_FACTOR_REQUIRED" };
    return { success: false, error: message };
  }
}

const SignInForm = () => {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors, isValid },
  } = useForm<Inputs>({ mode: "onChange" });

  const { setter } = useUserStore((state) => state);

  // Use useActionState for better form handling
  const [actionState, formAction, isPending] = useActionState(
    signInAction,
    null
  );
  const [isTransition, startTransition] = useTransition();
  const [requires2FA, setRequires2FA] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);

  // Handle action state updates
  useEffect(() => {
    if (actionState?.success) {
      setter({
        ...actionState.data,
        isLogin: true,
      });
      toaster("success", actionState.message);
    } else if (actionState?.error === "TWO_FACTOR_REQUIRED") {
      setRequires2FA(true);
      toaster("info", "کد تأیید دو مرحله‌ای را وارد کن.");
    } else if (actionState?.error) {
      toaster("error", actionState.error);
    }
  }, [actionState, setter]);

  const submitForm: SubmitHandler<Inputs> = async (data) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append("phone", data.phone.toString());
      formData.append("password", data.password);
      if (data.totp) formData.append("totp", data.totp);
      if (data.recoveryCode) formData.append("recoveryCode", data.recoveryCode);
      await formAction(formData);
    });
  };

  return (
    <div
      data-aos="zoom-in-down"
      className="flex w-full flex-col mt-10 space-y-6 "
      onKeyUp={(e) => e.key == "Enter" && handleSubmit(submitForm)()}
    >
      <label
        className={`input ${
          !!errors?.phone ? "input-error" : "input-info"
        } w-full  focus-within:outline-none mb-2 rounded-xl bg-inherit`}
      >
        <svg
          className="h-[1em] opacity-50"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
        >
          <g fill="none">
            <path
              d="M7.25 11.5C6.83579 11.5 6.5 11.8358 6.5 12.25C6.5 12.6642 6.83579 13 7.25 13H8.75C9.16421 13 9.5 12.6642 9.5 12.25C9.5 11.8358 9.16421 11.5 8.75 11.5H7.25Z"
              fill="currentColor"
            ></path>
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M6 1C4.61929 1 3.5 2.11929 3.5 3.5V12.5C3.5 13.8807 4.61929 15 6 15H10C11.3807 15 12.5 13.8807 12.5 12.5V3.5C12.5 2.11929 11.3807 1 10 1H6ZM10 2.5H9.5V3C9.5 3.27614 9.27614 3.5 9 3.5H7C6.72386 3.5 6.5 3.27614 6.5 3V2.5H6C5.44771 2.5 5 2.94772 5 3.5V12.5C5 13.0523 5.44772 13.5 6 13.5H10C10.5523 13.5 11 13.0523 11 12.5V3.5C11 2.94772 10.5523 2.5 10 2.5Z"
              fill="currentColor"
            ></path>
          </g>
        </svg>
        <span className="text-xs opacity-70">+98</span>
        <input
          {...register("phone", {
            required: " ",
            pattern: {
              value: /(^9[0-9]{9}$)|(^\u06F0\u06F9[\u06F0-\u06F9]{9})$/,
              message: "شماره تلفن معتبر نیست",
            },
          })}
          dir="auto"
          type="tel"
          placeholder="شماره تلفن"
          autoComplete="off"
        />
      </label>
      <p className="text-xs text-red-500">{errors.phone?.message}</p>

      <label
        className={`input ${
          !!errors?.password ? "input-error" : "input-info"
        } w-full  focus-within:outline-none mb-2 rounded-xl bg-inherit`}
      >
        <svg
          className="h-[1em] opacity-50"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
        >
          <g
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeWidth="2.5"
            fill="none"
            stroke="currentColor"
          >
            <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
            <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>
          </g>
        </svg>

        <input
          {...register("password", {
            required: " ",
            validate: (value) => {
              if (value.length) {
                if (value.length > 20 || value.length < 8) {
                  return "رمز عبور باید بین ۸ تا ۲۰ کاراکتر باشد";
                } else {
                  return true;
                }
              }
            },
          })}
          dir="auto"
          type="password"
          placeholder="رمز عبور"
          autoComplete="new-password"
        />
      </label>
      <p className="text-xs text-red-500">{errors.password?.message}</p>

      {requires2FA && <div className="space-y-2"><input {...register(useRecovery ? "recoveryCode" : "totp", { required: true })} inputMode={useRecovery ? "text" : "numeric"} className="input w-full rounded-xl bg-inherit" placeholder={useRecovery ? "کد بازیابی" : "کد ۶ رقمی"} autoComplete="one-time-code" /><button type="button" className="text-xs text-lightBlue" onClick={() => setUseRecovery(v=>!v)}>{useRecovery ? "Authenticator" : "کد بازیابی"}</button></div>}
      <Button
        size="lg"
        color="info"
        classNames="w-full rounded-xl"
        onClick={handleSubmit(submitForm)}
        disabled={!isValid || isSubmitting || isPending || isTransition}
      >
        {isSubmitting || isPending || isTransition ? (
          <Loading loading="dots" size="lg" color="info" />
        ) : (
          "ورود"
        )}
      </Button>
    </div>
  );
};

export default SignInForm;
