import { FaAngleDown } from "react-icons/fa6";

interface Props {
  scrollToBottom: () => void;
  count: number;
}

const ScrollToBottom = ({ scrollToBottom, count }: Props) => {
  if (count <= 0) return null;

  return (
    <button
      type="button"
      aria-label={"رفتن به پیام‌های خوانده‌نشده (" + count + ")"}
      onClick={scrollToBottom}
      className="absolute right-1.5 bottom-25 transition-all duration-300 size-10 bg-[#2E323F] cursor-pointer rounded-full flex items-center justify-center"
    >
      <FaAngleDown className="size-5" />
      <span className="absolute flex-center -top-2.5 bg-darkBlue text-xs rounded-full size-6">
        {count > 99 ? "99+" : count}
      </span>
    </button>
  );
};
export default ScrollToBottom;
