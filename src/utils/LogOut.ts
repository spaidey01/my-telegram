import axios from "axios";
import toaster from "./Toaster";

const logout = async () => {
  try {
    await axios.post("/api/auth/logout");
    return location.reload();
  } catch (error) {
    console.log(error);
    toaster("error", "Network issues!");
  }
};

export default logout;
