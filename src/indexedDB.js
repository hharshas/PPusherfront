import { openDB } from "idb";

const DB_NAME = "songDB";
const DB_VERSION = 1;
const DB_STORE_NAME = "songs";

let dbInstance = null;

export const initDB = async () => {
  try {
    if (dbInstance) {
      return dbInstance;
    }

    const db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
          const store = db.createObjectStore(DB_STORE_NAME, { keyPath: "id", autoIncrement: true });
          store.createIndex("fileName", "fileName", { unique: false });
        }
      },
    });

    dbInstance = db;
    return dbInstance;
  } catch (error) {
    console.error("Failed to initialize IndexedDB:", error);
    throw error;
  }
};

export const saveSongToDB = async (songData) => {
  try {
    const db = await initDB();
    const tx = db.transaction(DB_STORE_NAME, "readwrite");
    const store = tx.objectStore(DB_STORE_NAME);
    await store.add(songData);

    console.log(`Song ${songData.fileName} saved to IndexedDB`);
  } catch (error) {
    console.error("Error saving song to IndexedDB:", error);
    throw error;
  }
};

export const getAllSongs = async () => {
  try {
    const db = await initDB();
    const tx = db.transaction(DB_STORE_NAME, "readonly");
    const store = tx.objectStore(DB_STORE_NAME);

    const songs = await store.getAll();
    return songs;
  } catch (error) {
    console.error("Error fetching songs from IndexedDB:", error);
    throw error;
  }
};



