import { MdDeleteOutline, MdOutlineLockClock } from "react-icons/md";
import LeftBarContainer from "./LeftBarContainer";
import { BsThreeDotsVertical } from "react-icons/bs";
import { GoBell, GoPencil } from "react-icons/go";
import {
  IoChatbubbleEllipsesOutline,
  IoLogOutOutline,
  IoSettingsOutline,
} from "react-icons/io5";

import { TbCameraPlus } from "react-icons/tb";
import { GoShieldCheck } from "react-icons/go";
import { AiOutlineQuestionCircle } from "react-icons/ai";
import { MdLanguage } from "react-icons/md";
import Image from "next/image";
import MenuItem from "@/components/leftBar/menu/MenuItem";
import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { deleteFile, logout, toaster, uploadFile } from "@/utils";
import useUserStore from "@/stores/userStore";
import useSockets from "@/stores/useSockets";
import DropDown from "@/components/modules/ui/DropDown";
import LineSeparator from "@/components/modules/LineSeparator";
import Loading from "@/components/modules/ui/Loading";
import Modal from "@/components/modules/ui/Modal";
import { CgLock } from "react-icons/cg";
import { FaRegFolderClosed } from "react-icons/fa6";
import useModalStore from "@/stores/modalStore";
import ProfileImageViewer from "@/components/modules/ProfileImageViewer";
import useGlobalStore from "@/stores/globalStore";

interface Props {
  getBack: () => void;
  updateRoute: (route: string) => void;
}

const Settings = ({ getBack, updateRoute }: Props) => {
  const {
    avatar,
    name,
    lastName,
    username,
    biography,
    phone,
    _id,
    setter: userStateUpdater,
  } = useUserStore((state) => state);

  const { setter: modalSetter } = useModalStore((state) => state);
  const { setter: globalSetter, onlineUsers } = useGlobalStore((state) => state);
  const [isDropDownOpen, setIsDropDownOpen] = useState(false);

  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const displayPhone = phone ? String(phone).replace(/(\d{3})(?=\d)/g, "$1 ") : "شماره ثبت نشده";
  const displayName = `${name || ""} ${lastName || ""}`.trim() || "کاربر Stargram";

  const avatarElem = () => {
    const inputElem = document.createElement("input");

    inputElem.type = "file";
    inputElem.className = "hidden";
    inputElem.accept = ".jpg, .jpeg, .png, .gif";

    inputElem.onchange = (e: Event) => {
      const changeEvent = e as unknown as ChangeEvent<HTMLInputElement>;
      if (changeEvent.target?.files?.length && changeEvent.target?.files![0]) {
        const imageFile = changeEvent.target.files[0];
        const fileReader = new FileReader();

        setUploadedImageFile(imageFile);
        fileReader.readAsDataURL(imageFile);
        fileReader.onload = (readerEv) =>
          setUploadedImageUrl(readerEv?.target!.result as string);
      }
      inputElem.remove();
    };

    document.body.append(inputElem!);
    inputElem.click();
  };

  const uploadAvatar = useCallback(async () => {
    if (!uploadedImageFile) return;

    try {
      const socket = useSockets.getState().rooms;
      if (!socket) {
        toaster("error", "اتصال به سرور برقرار نیست.");
        return;
      }

      setIsLoading(true);
      const uploadResult = await uploadFile(uploadedImageFile);
      if (!uploadResult.success || !uploadResult.downloadUrl) {
        toaster("error", uploadResult.error || "آپلود عکس ناموفق بود.");
        return;
      }

      socket.emit(
        "updateUserData",
        { avatar: uploadResult.downloadUrl },
        (response: { success: boolean; error?: string; user?: { avatar: string } }) => {
          if (!response?.success || !response.user) {
            toaster("error", response?.error || "تغییر عکس پروفایل ناموفق بود.");
            return;
          }
          userStateUpdater((prev) => ({ ...prev, avatar: response.user!.avatar }));
          setUploadedImageFile(null);
          setUploadedImageUrl(null);
          toaster("success", "عکس پروفایل با موفقیت تغییر کرد.");
        },
      );
    } catch (error) {
      console.error("uploadAvatar:", error);
      toaster("error", "آپلود عکس ناموفق بود؛ اتصال اینترنت را بررسی کن.");
    } finally {
      setIsLoading(false);
    }
  }, [uploadedImageFile, userStateUpdater]);

  useEffect(() => {
    if (!uploadedImageUrl) return;
    uploadAvatar();
  }, [uploadAvatar, uploadedImageUrl]);

  const dropDownItems = [
    {
      title: "ویرایش اطلاعات",
      onClick: () => {
        updateRoute("edit-info");
        setIsDropDownOpen(false);
      },
      icon: <GoPencil className="size-5  text-gray-400" />,
    },
    {
      title: "تغییر عکس پروفایل",
      onClick: () => {
        avatarElem();
        setIsDropDownOpen(false);
      },
      icon: <TbCameraPlus className="size-5  text-gray-400" />,
    },
    avatar && {
      title: "حذف عکس پروفایل",
      onClick: () => {
        modalSetter({
          isOpen: true,
          title: "حذف عکس",
          bodyText: "از حذف عکس پروفایل مطمئنی؟",
          okText: "حذف",
          onSubmit: async () => {
            const socket = useSockets.getState().rooms;
            if (!socket) return;
            socket.emit(
              "updateUserData",
              { avatar: "" },
              async (response: { success: boolean; error?: string }) => {
                if (!response?.success) {
                  toaster("error", response?.error || "حذف عکس پروفایل ناموفق بود.");
                  return;
                }
                userStateUpdater((prev) => ({ ...prev, avatar: "" }));
                try {
                  await deleteFile(avatar);
                } catch {
                  // Profile update succeeded; remote cleanup can be retried later.
                }
                toaster("success", "عکس پروفایل حذف شد.");
              },
            );
          },
        });
        setIsDropDownOpen(false);
      },
      icon: <MdDeleteOutline className="size-5  text-gray-400" />,
    },

    {
      title: "خروج از حساب",
      onClick: () => {
        modalSetter({
          isOpen: true,
          title: "خروج از حساب",
          bodyText: "مطمئنی می‌خواهی از حساب خارج شوی؟",
          okText: "بله",
          onSubmit: logout,
        });
        setIsDropDownOpen(false);
      },
      icon: <IoLogOutOutline className="size-5 pl-0.5 text-gray-400" />,
    },
  ]
    .map((item) => item || null)
    .filter((item) => item !== null);

  return (
    <div className="w-full">
      <LeftBarContainer
        getBack={() => {
          getBack();
          globalSetter({ showCreateRoomBtn: true });
        }}
        leftHeaderChild={
          <>
            <DropDown
              isOpen={isDropDownOpen}
              setIsOpen={setIsDropDownOpen}
              dropDownItems={dropDownItems}
              classNames="top-0 right-0 w-48"
              button={
                <BsThreeDotsVertical className="size-8 cursor-pointer ml-auto p-1.5" />
              }
            />
          </>
        }
      >
        <div className="relative text-white min-h-dvh overflow-y-auto">
          <div className="absolute px-4 inset-x-0 w-full ">
            <div className="flex items-center gap-3 my-3 ">
              {
                <div
                  className={`flex-center relative size-14 ${
                    !avatar && "bg-darkBlue"
                  } overflow-hidden rounded-full`}
                >
                  {avatar ? (
                    <Image
                      src={`${avatar}${
                        avatar.includes("?") ? "&" : "?"
                      }t=${Date.now()}`}
                      className="cursor-pointer object-cover size-full rounded-full"
                      width={55}
                      height={55}
                      alt="avatar"
                      onClick={() => setIsViewerOpen(true)}
                      priority
                    />
                  ) : (
                    <div className="flex-center bg-darkBlue shrink-0 text-center font-bold text-xl mt-1">
                      {name?.length && name![0]}
                    </div>
                  )}

                  {isLoading && <Loading classNames="absolute w-11 bg-white" />}
                </div>
              }

              <div className="flex justify-center flex-col gap-1">
                <h3 className="font-bold text-lg font-vazirBold line-clamp-1 text-ellipsis">
                  {displayName}
                </h3>

                <div className="font-bold text-[14px] text-darkGray font-vazirBold line-clamp-1 whitespace-normal text-nowrap">
                  {onlineUsers.some((user) => user.userID === _id) ? "آنلاین" : "آفلاین"}
                </div>
              </div>
            </div>

            <span className="absolute right-5 top-12 size-14 rounded-full cursor-pointer bg-darkBlue flex-center">
              <TbCameraPlus className="size-6" onClick={avatarElem} />
            </span>
          </div>

          <div className="h-20"></div>

          <div className="flex flex-col mt-4">
            <p className="text-darkBlue font-vazirBold py-2 px-4 font-bold text-sm">
              حساب
            </p>

            <div className="cursor-pointer px-4 py-2 hover:bg-white/5 transition-all duration-200">
              <p className="text-sm">{displayPhone}</p>             <p className="text-darkGray text-[13px]">
                شماره تلفن
              </p>
            </div>

            <LineSeparator />

            <div
              onClick={() => updateRoute("edit-username")}
              className="cursor-pointer px-4 py-2 hover:bg-white/5 transition-all duration-200"
            >
              <p className="text-sm">@{username}</p>
              <p className="text-darkGray text-[13px]">نام کاربری</p>
            </div>

            <LineSeparator />

            <div
              onClick={() => updateRoute("edit-info")}
              className="cursor-pointer px-4 py-2 hover:bg-white/5 transition-all duration-200"
            >
              <p className="text-sm">{biography ? biography : "بیوگرافی"}</p>
              <p className="text-darkGray text-[13px]">
                {biography ? "بیوگرافی" : "چند کلمه درباره خودت بنویس"}
              </p>
            </div>
          </div>

          <p className="h-2 w-full bg-black/70  absolute"></p>

          <div className="flex flex-col pt-1">
            <p className="text-darkBlue font-vazirBold px-4 py-2 mt-2 text-sm">
              تنظیمات
            </p>

            <div className="flex item-center relative">
              <MenuItem
                icon={<IoSettingsOutline />}
                title="تنظیمات عمومی"
                onClick={() => {}}
              />
              <span className="flex items-center gap-1 text-xs text-gray-400 absolute right-3 top-4">
                <MdOutlineLockClock fill="teal" size={15} />
                <span>به‌زودی</span>
              </span>
            </div>

            <LineSeparator />

            <div className="flex item-center relative">
              <MenuItem
                icon={<GoBell />}
                title="اعلان‌ها"
                onClick={() => {}}
              />
              <span className="flex items-center gap-1 text-xs text-gray-400 absolute right-3 top-4">
                <MdOutlineLockClock fill="teal" size={15} />
                <span>به‌زودی</span>
              </span>
            </div>

            <LineSeparator />

            <div className="flex item-center relative">
              <MenuItem
                icon={<CgLock />}
                title="حریم خصوصی و امنیت"
                onClick={() => {}}
              />
              <span className="flex items-center gap-1 text-xs text-gray-400 absolute right-3 top-4">
                <MdOutlineLockClock fill="teal" size={15} />
                <span>به‌زودی</span>
              </span>
            </div>

            <LineSeparator />

            <div className="flex item-center relative">
              <MenuItem
                icon={<FaRegFolderClosed />}
                title="پوشه‌های چت"
                onClick={() => {}}
              />
              <span className="flex items-center gap-1 text-xs text-gray-400 absolute right-3 top-4">
                <MdOutlineLockClock fill="teal" size={15} />
                <span>به‌زودی</span>
              </span>
            </div>

            <LineSeparator />

            <span className="relative flex items-center">
              <MenuItem
                icon={<MdLanguage />}
                title="زبان"
                onClick={() => {}}
              />
              <span className="text-darkBlue absolute right-4 text-sm">
                فارسی
              </span>
            </span>
          </div>

          <p className="h-2 w-full bg-black/70  absolute"></p>

          <div className="flex flex-col pt-1">
            <p className="text-darkBlue font-vazirBold px-4 py-2 mt-2 text-sm">
              راهنما
            </p>

            <MenuItem
              icon={<IoChatbubbleEllipsesOutline />}
              title="پرسش و پشتیبانی"
              onClick={() => {}}
            />

            <LineSeparator />

            <MenuItem
              icon={<AiOutlineQuestionCircle />}
              title="سؤالات متداول"
              onClick={() =>
                window.open("https://telegram.org/faq?setln=en", "_blank")
              }
            />

            <LineSeparator />

            <MenuItem
              icon={<GoShieldCheck />}
              title="حریم خصوصی"
              onClick={() =>
                window.open(
                  "https://telegram.org/privacy/de?setln=en",
                  "_blank"
                )
              }
            />
          </div>

          <div className="w-full  py-5 px-4 text-center bg-black/70">
            ساخته شده با 💙 توسط{" "}
            <a
              target="_blank"
              href="https://github.com/SaeedNix"
              className="text-darkBlue"
            >
              SaeedNix
            </a>{" "}
          </div>
        </div>
      </LeftBarContainer>
      <Modal />
      {isViewerOpen && (
        <ProfileImageViewer
          imageUrl={avatar}
          onClose={() => setIsViewerOpen(false)}
        />
      )}
    </div>
  );
};

export default Settings;
