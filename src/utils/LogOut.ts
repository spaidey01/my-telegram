import axios from "axios";
import toaster from "./Toaster";

const logout = async () => {
  try {
    await axios.post("/api/auth/logout");
    localStorage.clear();
    if ("indexedDB" in window && "databases" in indexedDB) {
      const databases = await indexedDB.databases();
      await Promise.all(databases.map((db) => db.name ? new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(db.name as string);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      }) : Promise.resolve()));
    }
    return location.reload();
  } catch (error) {
    console.log(error);
    toaster("error", "Network issues!");
  }
};

export default logout;
