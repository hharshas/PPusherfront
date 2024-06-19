import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { io } from "socket.io-client";
import { initDB, saveSongToDB, getAllSongs } from "./indexedDB";

function App() {
  const socket = useRef();
  const [selectedFile, setSelectedFile] = useState(null);
  const [songName, setSongName] = useState("");
  const [receivedSongs, setReceivedSongs] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [sendSongName, setSendSongName] = useState("");
  const [allSongs, setAllSongs] = useState([]);


  useEffect(() => {
    initDB()
      .then(() => {
        socket.current = io("ws://localhost:8000");
  
        socket.current.on("connect", () => {
          console.log("Connected to server, socket ID:", socket.current.id);
        });
  
        socket.current.on("receiveSong", ({ senderId, songData }) => {
          console.log(`Received song from ${senderId}: ${songData.fileName}`);
          setReceivedSongs((prevSongs) => [...prevSongs, { senderId, songData }]);
          saveSongToDB(songData);
        });
  
        socket.current.on("searchResults", (resultsFromUsers) => {
          console.log("Received search results:", resultsFromUsers);
          setSearchResults([]);
          if (resultsFromUsers.length > 0) {
            setSearchResults(resultsFromUsers);
            // console.log(resultsFromUsers);
          } else {
            // setSearchResults([]);
            console.log("No songs found.");
          }
        });

        socket.current.on("performSearch", async ({ searchTerm, requesterId }) => {
          try {
            // const results = await searchSongsByName(searchTerm);
            // console.log("Search results:", results);
            const allSongs = await getAllSongs();
            const filteredSongs = allSongs.filter(song => song.fileName.includes(searchTerm.trim()));
            console.log("Filtered songs:", filteredSongs);
            socket.current.emit("searchResultsFromUser", { requesterId: socket.current.id, searchResults: filteredSongs });
            // getAllSongs().then((songs) => {
            //   console.log("All songs from IndexedDB:", songs);
            //   socket.current.emit("searchResultsFromUser", { requesterId, searchResults: songs});
            // });
          } catch (error) {
            console.error("Error searching songs:", error);
            // Handle error display or logging as needed
          }
        });

        socket.current.on("error", (error) => {
          console.error("Socket error:", error);
        });
      })
      .catch(error => {
        console.error("Failed to initialize IndexedDB:", error);
      });
  
    return () => {
      if (socket.current) {
        socket.current.disconnect();
      }
    };
  }, []);  

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setSelectedFile(file);
  };

  const handleSendSong = () => {
    if (selectedFile && songName.trim() !== "") {
      const reader = new FileReader();
      reader.onload = (event) => {
        const songData = {
          fileName: songName.trim(),
          fileType: selectedFile.type,
          dataURL: event.target.result,
        };

        socket.current.emit("sendSong", { songData });
        setSelectedFile(null);
        setSongName("");
      };

      reader.readAsDataURL(selectedFile);
    }
  };

  const handleSearch = () => {
    if (searchTerm.trim() !== "") {
      console.log("Emitting searchSongAcrossUsers with term:", searchTerm.trim());
      socket.current.emit("searchSongAcrossUsers", searchTerm.trim());
    }
  };

  return (
    <div className="App">
      <h1>Socket.io app</h1>

      <input
        type="file"
        accept=".mp3,.wav,.ogg"
        onChange={handleFileChange}
      />
      <br />
      <input
        type="text"
        placeholder="Enter song name"
        value={songName}
        onChange={(e) => setSongName(e.target.value)}
      />
      <button type="button" onClick={handleSendSong}>
        Send Song to 2 Random Users
      </button>

      <br />
      <br />

      <input
        type="text"
        placeholder="Search for song by name"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      <button type="button" onClick={handleSearch}>
        Search
      </button>

      <div>
        <h2>Received Songs</h2>
        <ul>
          {receivedSongs.map((songItem, index) => (
            <li key={index}>
              <strong>From: </strong> {songItem.senderId}
              <br />
              <audio controls>
                <source src={songItem.songData.dataURL} type={songItem.songData.fileType} />
                Your browser does not support the audio element.
              </audio>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2>Search Results</h2>
        <ul>
          {searchResults.length>0 && searchResults.map((song, index) => (
            <li key={index}>
                  <strong>Song Name: </strong> {song.fileName}
                  <br />
                  <audio controls>
                    <source src={song.dataURL} type={song.fileType} />
                    Your browser does not support the audio element.
                  </audio>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
