import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { io } from "socket.io-client";
import { initDB, saveSongToDB, getAllSongs } from "./indexedDB";
import Crunker from 'crunker';


function App() {
  const socket = useRef();
  const audioContext = useRef(new (window.AudioContext || window.webkitAudioContext)());
  const [selectedFile, setSelectedFile] = useState(null);
  const [songName, setSongName] = useState("");
  const [receivedSongs, setReceivedSongs] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [mergedAudioBuffer, setMergedAudioBuffer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const crunker = new Crunker();

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
          if (resultsFromUsers.length > 0) {
            setSearchResults(prevResults => [...prevResults, ...resultsFromUsers]);
            // mergeAndPlaySongs(resultsFromUsers);
          } else {
            console.log("No songs found.");
          }
        });

        socket.current.on("performSearch", async ({ searchTerm, requesterId }) => {
          try {
            const allSongs = await getAllSongs();
            const filteredSongs = allSongs.filter(song => song.fileName.includes(searchTerm.trim()));
            console.log("Filtered songs:", filteredSongs);
            socket.current.emit("searchResultsFromUser", { requesterId: requesterId, searchResults: filteredSongs });
          } catch (error) {
            console.error("Error searching songs:", error);
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

  const handleSendSong = async () => {
    if (!selectedFile || !songName.trim()) return;

    const audioContext = new AudioContext();
    const reader = new FileReader();

    reader.onload = async (event) => {
        const arrayBuffer = event.target.result;
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const duration = audioBuffer.duration;
        const splitPoint = duration / 2;

        const firstHalfBuffer = sliceAudioBuffer(audioBuffer, 0, splitPoint, audioContext);
        const secondHalfBuffer = sliceAudioBuffer(audioBuffer, splitPoint, duration, audioContext);

        const firstHalfDataURL = await exportAudioBufferAsWav(firstHalfBuffer, audioContext);
        const secondHalfDataURL = await exportAudioBufferAsWav(secondHalfBuffer, audioContext);

        socket.current.emit("sendSong", { songData: { fileName: `${songName.trim()}_firsthalf`, fileType: 'audio/wav', dataURL: firstHalfDataURL } });
        socket.current.emit("sendSong", { songData: { fileName: `${songName.trim()}_secondhalf`, fileType: 'audio/wav', dataURL: secondHalfDataURL } });

        setSelectedFile(null);
        setSongName("");
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  const mergeAndPlaySongs = async () => {
      try {
          const audioContext = new AudioContext();
          const buffers = await Promise.all(searchResults.map(async (song) => {
              const arrayBuffer = await fetch(song.dataURL).then(response => response.arrayBuffer());
              return await audioContext.decodeAudioData(arrayBuffer);
          }));

          const mergedBuffer = mergeAudioBuffers(buffers, audioContext);
          setMergedAudioBuffer(mergedBuffer);
          playMergedAudio(mergedBuffer, audioContext);
      } catch (error) {
          console.error("Error processing audio files:", error);
      }
  };

  const sliceAudioBuffer = (audioBuffer, start, end, audioContext) => {
      const channels = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
          channels.push(audioBuffer.getChannelData(i).subarray(start * audioBuffer.sampleRate, end * audioBuffer.sampleRate));
      }
      const slicedBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, (end - start) * audioBuffer.sampleRate, audioBuffer.sampleRate);
      channels.forEach((channelData, index) => {
          slicedBuffer.copyToChannel(channelData, index);
      });
      return slicedBuffer;
  };

  const exportAudioBufferAsWav = async (audioBuffer, audioContext) => {
      const offlineContext = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate);
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineContext.destination);
      source.start();

      const renderedBuffer = await offlineContext.startRendering();
      const wavBlob = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(renderedBufferToWav(renderedBuffer));
      });
      return wavBlob;
  };

  const mergeAudioBuffers = (buffers, audioContext) => {
      const totalDuration = buffers.reduce((acc, buffer) => acc + buffer.duration, 0);
      const mergedBuffer = audioContext.createBuffer(buffers[0].numberOfChannels, totalDuration * audioContext.sampleRate, audioContext.sampleRate);
      let offset = 0;
      buffers.forEach(buffer => {
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
              mergedBuffer.getChannelData(channel).set(buffer.getChannelData(channel), offset);
          }
          offset += buffer.duration * audioContext.sampleRate;
      });
      return mergedBuffer;
  };

  const playMergedAudio = (mergedBuffer, audioContext) => {
      const source = audioContext.createBufferSource();
      source.buffer = mergedBuffer;
      source.connect(audioContext.destination);
      source.start();
  };

  const renderedBufferToWav = (renderedBuffer) => {
    const interleaved = interleave(renderedBuffer);
    const buffer = new ArrayBuffer(44 + interleaved.length * 2);
    const view = new DataView(buffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // RIFF chunk length
    view.setUint32(4, 36 + interleaved.length * 2, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 2, true);
    // sample rate
    view.setUint32(24, renderedBuffer.sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, renderedBuffer.sampleRate * 4, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 4, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, interleaved.length * 2, true);

    // write the PCM samples
    let offset = 44;
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
      let sample = Math.max(-1, Math.min(1, interleaved[i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  };

  const interleave = (buffer) => {
    const interleaved = new Float32Array(buffer.length * 2);
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      const channelData = buffer.getChannelData(i);
      for (let j = 0; j < buffer.length; j++) {
        interleaved[j * 2] = channelData[j];
        interleaved[j * 2 + 1] = channelData[j];
      }
    }
    return interleaved;
  };

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // Rest of the code...


  
  const handleSearch = () => {
    if (searchTerm.trim() !== "") {
      setSearchResults([]);
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
          {searchResults.length > 0 && searchResults.map((song, index) => (
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

      <button type="button" onClick={mergeAndPlaySongs} disabled={isPlaying}>
        Play Merged Audio
      </button>
    </div>
  );
}

export default App;
