import { useEffect, useState } from "react";
import LeftBarContainer from "./LeftBarContainer";
import { MdDone } from "react-icons/md";
import axios from "axios";
import useUserStore from "@/stores/userStore";
import useSockets from "@/stores/useSockets";
import Loading from "@/components/modules/ui/Loading";
import { toaster } from "@/utils";

const EditUsername = ({ getBack }: { getBack: () => void }) => {
  const { username: currentUsername, setter } = useUserStore((state) => state);
  const socket = useSockets((state) => state.rooms);
  const [username, setUsername] = useState(currentUsername);
  const [isLoading, setIsLoading] = useState(false);
  const [isUsernameValid, setIsUsernameValid] = useState(true);
  const [isValidationLoading, setIsValidationLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const updateUsername = () => {
    if (!socket || !isUsernameValid || isValidationLoading) return;
    setIsLoading(true);
    socket.emit("updateUserData", { username }, (response: { success: boolean; error?: string; user?: { username: string } }) => {
      setIsLoading(false);
      if (!response?.success || !response.user) {
        toaster("error", response?.error || "ذخیره نام کاربری انجام نشد");
        return;
      }
      setter(response.user);
      toaster("success", "نام کاربری با موفقیت تغییر کرد");
      getBack();
    });
  };

  useEffect(() => {
    const updatedUsername = username.trim().replace(/^@/, "").toLowerCase();
    if (updatedUsername === currentUsername.trim().toLowerCase()) {
      setIsUsernameValid(true);
      setErrorMsg(null);
      setIsValidationLoading(false);
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(updatedUsername)) {
      setIsUsernameValid(false);
      setErrorMsg("نام کاربری باید ۳ تا ۲۰ کاراکتر باشد");
      setIsValidationLoading(false);
      return;
    }

    setIsValidationLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await axios.post("/api/users/updateUsername", { query: updatedUsername });
        setIsUsernameValid(Boolean(data?.isValid));
        setErrorMsg(data?.message || null);
      } catch (error: unknown) {
        const message = axios.isAxiosError(error) ? error.response?.data?.message : null;
        setIsUsernameValid(false);
        setErrorMsg(message || "بررسی نام کاربری انجام نشد");
      } finally {
        setIsValidationLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [username, currentUsername]);

  return (
    <LeftBarContainer getBack={getBack} title="نام کاربری"
      leftHeaderChild={
        currentUsername.trim() !== username.trim() &&
        (isLoading ? <Loading size="sm" classNames="absolute right-2 bg-white" /> :
          !isValidationLoading && isUsernameValid ? <MdDone onClick={updateUsername} className="size-6 absolute right-2 cursor-pointer" /> : null)
      }>
      <div className="flex flex-col gap-3 pb-4 w-full px-4 text-white">
        <p className="text-darkBlue font-vazirRegular pt-1 font-bold text-base">نام کاربری</p>
        <div className="flex gap-1">
          <span>@</span>
          <input type="text" value={username.replace(/^@/, "")} onChange={(e) => setUsername(e.target.value.replace(/^@/, ""))}
            placeholder="نام کاربری" className="outline-hidden bg-inherit w-full" maxLength={20} dir="ltr" />
        </div>
      </div>
      <div className="text-white/70 text-sm bg-black/70 px-4 pt-3 min-h-48 break-words">
        {isValidationLoading && <p className="my-2">در حال بررسی...</p>}
        {!isValidationLoading && currentUsername.trim() !== username.trim() && (
          <p className={isUsernameValid ? "text-green-500 my-2" : "text-red-500 my-2"}>
            {isUsernameValid ? "این نام کاربری آزاد است" : errorMsg}
          </p>
        )}
        <p>با نام کاربری دیگران می‌توانند بدون نیاز به شماره تلفن پیدایت کنند.</p>
        <p className="mt-3">فقط حروف انگلیسی، عدد و زیرخط مجاز است؛ طول نام کاربری ۳ تا ۲۰ کاراکتر.</p>
      </div>
    </LeftBarContainer>
  );
};

export default EditUsername;
