import LeftBar from "./leftBar/LeftBar";
import MiddleBar from "./middleBar/MiddleBar";
import RightBar from "./rightBar/RightBar";
import CallOverlay from "./CallOverlay";

const MainPage = () => {
  return (
    <div className="size-full flex items-center bg-leftBarBg transition-all duration-400 relative overflow-hidden">
      <LeftBar />
      <MiddleBar />
      <RightBar />
      <CallOverlay />
    </div>
  );
};

export default MainPage;
