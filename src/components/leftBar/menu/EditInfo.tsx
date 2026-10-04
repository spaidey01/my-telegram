import LeftBarContainer from "./LeftBarContainer";
import { MdDone } from "react-icons/md";
import { useEffect, useRef, useState } from "react";
import useUserStore from "@/stores/userStore";
import useSockets from "@/stores/useSockets";
import LineSeparator from "@/components/modules/LineSeparator";
import Loading from "@/components/modules/ui/Loading";
import { toaster } from "@/utils";
import { toaster } from "@/utils";

const EditInfo = ({ getBack }: { getBack: () => void }) => {
  const { name = "", lastName = "", biography = "" } = useUserStore((state) => state);
  const [updatedName, setUpdatedName] = useState(name);
  const [updatedLastName, setUpdatedLastName] = useState(lastName);
  const [updatedBiography, setUpdatedBiography] = useState(biography);
  const [isLoading, setIsLoading] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textAreaRef.current) textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
  }, [updatedBiography.length]);

  const submitChanges = () => {
    const socket = useSockets.getState().rooms;
    const cleanName = updatedName.trim();
    const cleanLastName = updatedLastName.trim();
    const cleanBiography = updatedBiography.trim();

    if (cleanName.length < 3 || cleanName.length > 20) {
      toaster("error", "نام باید بین ۳ تا ۲۰ کاراکتر باشد.");
      return;
    }

    if (!socket) {
      toaster("error", "اتصال به سرور برقرار نیست.");
      return;
    }

    setIsLoading(true);
    socket.emit(
      "updateUserData",
      { name: cleanName, lastName: cleanLastName, biography: cleanBiography },
      (response: {
        success: boolean;
        error?: string;
        user?: { name: string; lastName: string; biography: string };
      }) => {
        setIsLoading(false);
        if (!response?.success || !response.user) {
          toaster("error", response?.error || "ذخیره اطلاعات ناموفق بود.");
          return;
        }
        useUserStore.getState().setter(response.user);
        toaster("success", "اطلاعات پروفایل ذخیره شد.");
        getBack();
      },
    );
  };

  return (
    <LeftBarContainer
      getBack={getBack}
      title="ویرایش اطلاعات"
      leftHeaderChild={
        (updatedBiography.trim() !== biography.trim() ||
          updatedLastName.trim() !== lastName.trim() ||
          updatedName.trim() !== name.trim()) &&
        (isLoading ? (
          <Loading size="sm" classNames="absolute right-2 bg-white" />
        ) : (
          <MdDone data-aos="zoom-right" onClick={submitChanges} className="size-6 absolute right-2 cursor-pointer" />
        ))
      }
    >
      <div className="flex flex-col gap-2 p-4 w-full text-white">
        <p className="text-darkBlue font-vazirRegular py-1 font-bold text-base">نام</p>
        <input dir="auto" type="text" value={updatedName} onChange={(e) => setUpdatedName(e.target.value)}
          placeholder="نام" className="outline-hidden bg-inherit w-full" maxLength={20} />
        <LineSeparator />
        <input dir="auto" type="text" value={updatedLastName} onChange={(e) => setUpdatedLastName(e.target.value)}
          placeholder="نام خانوادگی" className="outline-hidden bg-inherit w-full" maxLength={20} />
      </div>
      <p className="h-2 w-full bg-black/70" />
      <div className="flex flex-col gap-2 px-4 w-full h-full">
        <div className="flex items-center w-full justify-between pt-4">
          <p className="text-darkBlue font-vazirRegular font-bold text-base">بیو</p>
          <p className="text-darkGray">{70 - updatedBiography.length}</p>
        </div>
        <textarea ref={textAreaRef} value={updatedBiography} onChange={(e) => setUpdatedBiography(e.target.value.slice(0, 70))}
          className="resize-none w-full h-3 text-white bg-inherit outline-hidden" placeholder="چند کلمه درباره خودت..." />
      </div>
    </LeftBarContainer>
  );
};

export default EditInfo;
